const test=require('node:test'),assert=require('node:assert/strict');
const {publicationForSavedArticle,reconcilePendingNews}=require('../services/newsPublication');
const now=new Date('2026-11-01T22:00:00Z');
const row={id:7,slug:'a-story',article_title:'Council approves housing',article_url:'https://one.example/story',article_thumbnail_url:'https://one.example/image.jpg',publish_date:now.toISOString(),created_at:now.toISOString(),publication_status:'pending_review',superseded_by_outlook_id:null,ai_outlook:{synopsis:'The council approved housing.',editorialReview:{status:'pending_human_review'}}};
const packet={sources:[{outlook_id:7,publisher:'One',title:'First report',url:'https://one.example/story'},{outlook_id:7,publisher:'Two',title:'Second report',url:'https://two.example/story'}],scores:[{outlook_id:7,version:1,confidence_score:70,unresolved_evidence_gaps:['Future details are unknown.']}],claims:[{outlook_id:7,status:'supported'}]};
function database(article=row,{failUpdate=false}={}){
 const data={scriptural_outlooks:[structuredClone(article)],news_article_sources:packet.sources,news_score_versions:packet.scores,news_claims:packet.claims,editorial_alerts:[{outlook_id:7,alert_type:'publication_review',status:'open'}]};
 let updates=0;
 return {data,get updates(){return updates;},from(table){let filters=[],patch,limit=Infinity;
  const q={select(){return q;},eq(k,v){filters.push(x=>x[k]===v);return q;},is(k,v){return q.eq(k,v);},gte(k,v){filters.push(x=>x[k]>=v);return q;},in(k,v){filters.push(x=>v.includes(x[k]));return q;},order(){return q;},limit(n){limit=n;return q;},update(value){patch=value;return q;},then(resolve){const rows=data[table].filter(x=>filters.every(f=>f(x))).slice(0,limit);if(patch){updates++;if(failUpdate && table==='scriptural_outlooks')return Promise.resolve({data:null,error:{message:'Update failed'}}).then(resolve);rows.forEach(x=>Object.assign(x,patch));}return Promise.resolve({data:rows,error:null}).then(resolve);}};
  return q;
 }};
}
test('saved evidence supplies missing model publisher labels while incomplete rows stay held',()=>{
 assert.equal(publicationForSavedArticle(row,packet).eligible,true);
 assert.equal(publicationForSavedArticle({...row,article_title:null},packet).eligible,false);
 assert.equal(publicationForSavedArticle(row,{...packet,scores:[]}).eligible,false);
});
test('dry-run is read-only; applying publishes once and resolves the obsolete review alert',async()=>{
 const db=database();let result=await reconcilePendingNews(db,{now});
 assert.deepEqual(result.publishable,[7]);assert.equal(db.updates,0);
 result=await reconcilePendingNews(db,{now,apply:true});assert.deepEqual(result.published,[7]);
 assert.equal(db.data.scriptural_outlooks[0].publication_status,'published');assert.equal(db.data.scriptural_outlooks[0].ai_outlook.editorialReview.reviewerName,null);
 assert.equal(db.data.editorial_alerts[0].status,'resolved');
 assert.deepEqual((await reconcilePendingNews(db,{now,apply:true})).published,[]);
});
test('manual withholding and failed writes cannot be reported as successful publication',async()=>{
 const withheld=database({...row,ai_outlook:{...row.ai_outlook,editorialReview:{status:'archived'}}});
 assert.deepEqual((await reconcilePendingNews(withheld,{now,apply:true})).published,[]);assert.equal(withheld.updates,0);
 const failed=await reconcilePendingNews(database(row,{failUpdate:true}),{now,apply:true});assert.deepEqual(failed.published,[]);assert.equal(failed.failed.length,1);
});
