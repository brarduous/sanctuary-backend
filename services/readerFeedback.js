const SOURCES={
 devotional:{table:'daily_devotionals',id:'devotional_id',private:true,completed:true},
 general_devotional:{table:'general_devotionals',id:'id',date:'date'},
 advice:{table:'advice_guidance',id:'advice_id',private:true,completed:true},
 prayer:{table:'daily_prayers',id:'prayer_id',private:true,completed:true},
 sermon:{table:'sermons',id:'sermon_id',private:true,completed:true},
 bible_study:{table:'bible_studies',id:'study_id',private:true},
 news:{table:'scriptural_outlooks',id:'id',published:true},
};
const TAGS=['repetitive','confusing','not_relevant','too_long','accuracy','unsafe'];
function invalid(message){const error=Error(message);error.status=400;throw error;}
function contentKey(type,id){
 if(!Object.hasOwn(SOURCES,type))invalid('Unsupported content type.');
 const value=String(id || '').replace(type==='general_devotional'?/^general-/:/^$/, '');
 if(!/^[1-9]\d{0,18}$/.test(value))invalid('Invalid content identifier.');
 return value;
}
function validateFeedback(body={}){
 const result={};
 for(const key of ['rating','clarity','relevance']){
  if(body[key]==null&&key!=='rating'){result[key]=null;continue;}
  if(!Number.isInteger(body[key])||body[key]<1||body[key]>5)invalid('Choose a valid rating.');
  result[key]=body[key];
 }
 if(body.practice_feasible!=null&&typeof body.practice_feasible!=='boolean')invalid('Invalid practice response.');
 result.practice_feasible=body.practice_feasible??null;
 if(body.issue_tags!==undefined&&(!Array.isArray(body.issue_tags)||body.issue_tags.length>6||body.issue_tags.some(tag=>!TAGS.includes(tag))))invalid('Invalid feedback category.');
 result.issue_tags=[...new Set(body.issue_tags || [])];
 if(body.channel!==undefined&&!['web','mobile','unknown'].includes(body.channel))invalid('Invalid feedback channel.');
 result.channel=body.channel || 'unknown';
 return result;
}
async function availableContent(db,userId,type,id,now=new Date()){
 const source=SOURCES[type];
 let q=db.from(source.table).select(source.date?`${source.id},${source.date}`:source.published?'id,ai_outlook':source.id).eq(source.id,id);
 if(source.private)q=q.eq('user_id',userId);
 if(source.completed)q=q.eq('status','completed');
 if(source.published)q=q.eq('publication_status','published');
 if(source.date)q=q.lte(source.date,now.toISOString().slice(0,10));
 const result=await q.maybeSingle();if(result.error)throw result.error;
 return Boolean(result.data&&!['rejected','archived'].includes(result.data.ai_outlook?.editorialReview?.status));
}
function summarizeFeedback(rows,{minimumReaders=5}={}){
 const groups={};
 for(const row of rows){const key=row.content_type;if(!groups[key])groups[key]={responses:0,readers:new Set(),total:0,helpful:0,feasible:0,feasibilityResponses:0,issues:{},channels:{}};const g=groups[key];g.responses++;g.readers.add(row.user_id);g.total+=row.rating;g.helpful+=Number(row.rating>=4);g.channels[row.channel]=(g.channels[row.channel]||0)+1;if(typeof row.practice_feasible==='boolean'){g.feasibilityResponses++;g.feasible+=Number(row.practice_feasible);}for(const tag of row.issue_tags || [])g.issues[tag]=(g.issues[tag]||0)+1;}
 return Object.fromEntries(Object.entries(groups).map(([key,g])=>[key,{status:g.readers.size>=minimumReaders?'measured':'insufficient_sample',responses:g.responses,respondents:g.readers.size,averageRating:Number((g.total/g.responses).toFixed(2)),helpfulRate:g.helpful/g.responses,practiceFeasibleRate:g.feasibilityResponses?g.feasible/g.feasibilityResponses:null,feasibilityResponses:g.feasibilityResponses,issues:g.issues,channels:g.channels,limitation:'Optional self-selected feedback; not representative of every reader or evidence of spiritual growth.'}]));
}
module.exports={SOURCES,TAGS,contentKey,validateFeedback,availableContent,summarizeFeedback};
