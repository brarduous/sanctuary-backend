const {evaluatePublicationEligibility}=require('../utils/newsEditorialPolicy');
const POLICY='news-auto-publication-v1';
function publicationForSavedArticle(row,{sources=[],scores=[],claims=[]}) {
  const score=scores.filter(s=>s.outlook_id===row.id).sort((a,b)=>b.version-a.version)[0];
  const savedSources=sources.filter(s=>s.outlook_id===row.id);
  const generated={...row.ai_outlook,sources:savedSources.map(s=>({title:s.title,url:s.url,publisher:s.publisher}))};
  const verification={confidenceScore:score?.confidence_score,unresolvedEvidenceGaps:score?.unresolved_evidence_gaps,claims:claims.filter(c=>c.outlook_id===row.id)};
  const result=evaluatePublicationEligibility({article:{title:row.article_title,url:row.article_url,publish_date:row.publish_date},generated,verification});
  if(!score)result.reasons.push('missing_verification');
  if(!row.slug || !row.article_title || !row.article_thumbnail_url)result.reasons.push('incomplete_article');
  result.eligible=result.reasons.length===0;
  return {...result,generated};
}
async function reconcilePendingNews(db,{apply=false,hours=72,limit=200,now=new Date()}={}) {
  const since=new Date(now.getTime()-Math.min(72,Math.max(1,hours))*3600000).toISOString();
  const {data:rows,error}=await db.from('scriptural_outlooks').select('id,slug,article_title,article_url,article_thumbnail_url,publish_date,ai_outlook').eq('publication_status','pending_review').is('superseded_by_outlook_id',null).gte('created_at',since).order('created_at',{ascending:false}).limit(Math.min(200,Math.max(1,limit)));
  if(error)throw error;
  const result={policyVersion:POLICY,apply,since,examined:rows?.length || 0,publishable:[],published:[],held:[],failed:[]};
  for(let offset=0;offset<(rows || []).length;offset+=50){
    const batch=rows.slice(offset,offset+50),ids=batch.map(row=>row.id);
    const packets=await Promise.all([
      db.from('news_article_sources').select('outlook_id,publisher,title,url').in('outlook_id',ids),
      db.from('news_score_versions').select('outlook_id,version,confidence_score,unresolved_evidence_gaps').in('outlook_id',ids).order('version',{ascending:false}).limit(1000),
      db.from('news_claims').select('outlook_id,status').in('outlook_id',ids).limit(1000),
    ]);
    for(const packet of packets)if(packet.error)throw packet.error;
    const [sources,scores,claims]=packets.map(packet=>packet.data || []);
    for(const row of batch){
      // Manual rejection/archival must never be reversed by an automatic retry.
      if(['rejected','archived'].includes(row.ai_outlook?.editorialReview?.status)){result.held.push({id:row.id,reasons:['editorially_withheld']});continue;}
      const assessment=publicationForSavedArticle(row,{sources,scores,claims});
      if(!assessment.eligible){result.held.push({id:row.id,reasons:assessment.reasons});continue;}
      result.publishable.push(row.id);if(!apply)continue;
      const checkedAt=now.toISOString();
      const aiOutlook={...assessment.generated,editorialReview:{status:'automated_approved',reviewerName:null,reviewedAt:null},automatedPublication:{policyVersion:POLICY,checkedAt,notices:assessment.notices}};
      const {data:updated,error:updateError}=await db.from('scriptural_outlooks').update({publication_status:'published',publication_review_reasons:[],publication_checked_at:checkedAt,ai_outlook:aiOutlook}).eq('id',row.id).eq('publication_status','pending_review').select('id');
      if(updateError){result.failed.push({id:row.id,error:updateError.message});continue;}
      if(!updated?.length)continue;
      result.published.push(row.id);
      const {error:alertError}=await db.from('editorial_alerts').update({status:'resolved',last_detected_at:checkedAt}).eq('outlook_id',row.id).eq('alert_type','publication_review').eq('status','open');
      if(alertError)result.failed.push({id:row.id,error:'Published; old review alert could not be resolved.'});
    }
  }
  return result;
}
module.exports={POLICY,publicationForSavedArticle,reconcilePendingNews};
