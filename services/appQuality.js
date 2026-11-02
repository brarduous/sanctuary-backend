const {summarizeFeedback}=require('./readerFeedback');
const HOUR=3600000;
const read=async q=>{const result=await q;if(result.error)throw result.error;return result.data || [];};
const missing=reason=>({status:'unmeasured',score:null,reason});
function freshness(timestamp,now,{warnHours=24,failHours=36}={}){
 const time=Date.parse(timestamp),ageHours=(+now-time)/HOUR;
 if(!Number.isFinite(time)||ageHours < -0.1)return{status:'fail',score:0,ageHours:null,reason:'Missing or invalid publication timestamp.'};
 return{status:ageHours>failHours?'fail':ageHours>warnHours?'warn':'pass',score:ageHours>failHours?0:ageHours>warnHours?60:100,ageHours:Number(ageHours.toFixed(2))};
}
function percentile(values,p){if(!values.length)return null;const sorted=[...values].sort((a,b)=>a-b);return sorted[Math.max(0,Math.ceil(p*sorted.length)-1)];}
async function probeJson(url,fetcher=fetch,headers={}){const started=Date.now();const response=await fetcher(url,{signal:AbortSignal.timeout(15000),headers:{Accept:'application/json',...headers}});if(!response.ok)throw Error(`Public endpoint returned ${response.status}`);return{data:await response.json(),durationMs:Date.now()-started};}
async function operationalReport({db,now=new Date(),fetcher=fetch,baseUrl=process.env.QUALITY_API_BASE_URL || 'https://api.sanctuaryapp.us',anonKey=process.env.SUPABASE_ANON_KEY,supabaseUrl=process.env.SUPABASE_URL}={}){
 const since=new Date(+now-24*HOUR).toISOString(),today=now.toISOString().slice(0,10);
 const inputs=await Promise.allSettled([
  read(db.from('general_devotionals').select('date').gte('date',today).order('date').limit(35)),
  probeJson(`${baseUrl}/api/v1/scriptural-outlooks?limit=5&sort=recent`,fetcher),
  probeJson(`${baseUrl}/api/v1/daily-news-synopses?limit=1`,fetcher),
  probeJson(`${baseUrl}/api/v1/discoveries/bundle?dailySet=1&timeZone=America%2FNew_York`,fetcher),
  read(db.from('reader_content_feedback').select('user_id,content_type,rating,practice_feasible,issue_tags,channel').gte('updated_at',new Date(+now-7*24*HOUR).toISOString()).limit(1000)),
  read(db.from('notification_deliveries').select('status').gte('created_at',since).limit(1000)),
  read(db.from('system_logs').select('level,action,duration_ms,details').eq('source','backend').gte('created_at',since).order('created_at',{ascending:false}).limit(1000)),
  read(db.from('app_quality_reports').select('report,status,completed_at,source_commit').eq('kind','release').order('completed_at',{ascending:false}).limit(1)),
  read(db.from('devotional_quality_runs').select('status,completed_at,report').order('week_start',{ascending:false}).limit(1)),
  anonKey&&supabaseUrl?probeJson(`${supabaseUrl}/rest/v1/general_devotionals?select=id,date&date=eq.${today}`,fetcher,{apikey:anonKey,Authorization:`Bearer ${anonKey}`}):Promise.resolve(null),
  require('../utils/discoveryDailySets').dailySetStatus(db,{now,runwayDays:7}),
 ]);
 const report={version:'app-quality-v1',at:now.toISOString(),publicationDatePolicy:'UTC curriculum dates; trivia probe uses America/New_York',areas:{},checks:{},limitations:[]};
 const value=(index,name)=>{const result=inputs[index];if(result.status==='rejected'){report.checks[name]={status:'fail',reason:'Measurement unavailable; inspect the private service logs.'};return null;}return result.value;};
 const general=value(0,'devotional_runway'),news=value(1,'public_news'),brief=value(2,'public_brief'),trivia=value(3,'public_trivia');
 if(general){const dates=new Set(general.map(row=>row.date));let contiguousDays=0;while(contiguousDays<35&&dates.has(new Date(Date.parse(today)+contiguousDays*24*HOUR).toISOString().slice(0,10)))contiguousDays++;report.checks.devotional_runway={status:contiguousDays===0?'fail':contiguousDays<7?'warn':'pass',contiguousDays,minimumDays:7};}
 for(const [name,result,dateFields] of [['public_news',news,['created_at']],['public_brief',brief,['created_at']]])if(result){if(!Array.isArray(result.data))report.checks[name]={status:'fail',reason:'Invalid reader-facing response.'};else{const latest=result.data.map(row=>dateFields.map(key=>row[key]).find(Boolean)).filter(Boolean).sort().at(-1);report.checks[name]={...freshness(latest,now),visibleRecords:result.data.length,latestCreatedAt:latest||null,probeDurationMs:result.durationMs};}}
 if(trivia){const data=trivia.data,items=data?.items;report.checks.public_trivia=!data?.enabled?{status:'disabled',reason:'Public rollout disabled; no availability claim.'}:{status:Array.isArray(items)&&items.length===3&&new Set(items.map(item=>item.id)).size===3?'pass':'fail',visibleItems:items?.length||0,probeDurationMs:trivia.durationMs};}
 const generalPublic=value(9,'public_devotional');
 report.checks.public_devotional=generalPublic?{status:Array.isArray(generalPublic.data)&&generalPublic.data.some(row=>row.date===today)?'pass':'fail',probeDurationMs:generalPublic.durationMs}:report.checks.public_devotional||missing('Anonymous devotional API probe is not configured.');
 const triviaRunway=value(10,'trivia_runway');if(triviaRunway)report.checks.trivia_runway={status:triviaRunway.missingDates.includes(today)?'fail':triviaRunway.missingDates.length?'warn':'pass',publishedDays:triviaRunway.published,missingDates:triviaRunway.missingDates,exhaustedDates:triviaRunway.exhaustedDates};
 const deliveryChecks=['devotional_runway','trivia_runway','public_devotional','public_news','public_brief','public_trivia'].map(key=>report.checks[key]);
 report.areas.delivery={status:deliveryChecks.some(item=>item.status==='fail')?'fail':deliveryChecks.some(item=>item.status==='warn')?'warn':'pass',scope:'Stored devotional continuity plus actual anonymous news, brief and trivia API reads; not a native rendering test.'};
 const feedback=value(4,'reader_feedback');
 report.areas.helpfulness=feedback?{status:feedback.length?'collecting':'unmeasured',score:null,windowDays:7,byContent:summarizeFeedback(feedback),populationCapped:feedback.length===1000,reason:feedback.length?'Reader responses are separate from model estimates.':'No reader responses yet.'}:missing('Feedback measurement unavailable.');
 const deliveries=value(5,'notifications');
 if(deliveries?.length){const sent=deliveries.filter(row=>['accepted','opened','failed'].includes(row.status));report.areas.notifications={status:'measured',attempts:sent.length,accepted:sent.filter(row=>row.status!=='failed').length,failed:sent.filter(row=>row.status==='failed').length,opened:sent.filter(row=>row.status==='opened').length,populationCapped:deliveries.length===1000,limitation:'Provider acceptance is not proof of device delivery; opt-out, quiet-hour and duplicate checks remain separate release gates.'};}else report.areas.notifications=missing('No delivery outcomes in the last 24 hours.');
 const logs=value(6,'performance');
 const durations=(logs||[]).map(row=>Number(row.duration_ms)).filter(n=>Number.isFinite(n)&&n>0);
 const tokens=(logs||[]).filter(row=>Number.isFinite(Number(row.details?.tokens))&&Number(row.details.tokens)>0);
 report.areas.performance=durations.length?{status:'measured',sampleCount:durations.length,p50ServerDurationMs:percentile(durations,.5),p95ServerDurationMs:percentile(durations,.95),errorRecords:(logs||[]).filter(row=>row.level==='error').length,populationCapped:logs.length===1000,limitation:'Mixed server-operation durations; not crash-free sessions, screen loading time or a user error rate.'}:missing('No timed backend operations recorded.');
 report.areas.cost={status:tokens.length?'partially_measured':'unmeasured',reportedTokens:tokens.reduce((sum,row)=>sum+Number(row.details.tokens),0),operationsWithTokenCounts:tokens.length,dollars:null,reason:'No complete input/output token pricing ledger; dollar costs are not inferred from incomplete totals.'};
 const release=value(7,'release_evidence')?.[0];
 report.areas.privacy=release&&+now-Date.parse(release.completed_at)<7*24*HOUR?{status:release.status==='completed'?'partially_verified':'fail',evidence:release.report,sourceCommit:release.source_commit,verifiedAt:release.completed_at,scope:'Only the recorded ownership and tenant tests; not a complete security certification.'}:missing('Awaiting dated two-account production evidence.');
 report.areas.usability=missing('Needs observed completion of signup, reading, sharing and recovery on real devices, including VoiceOver/TalkBack and large text.');
 report.areas.subscriptions=missing('Needs recorded sandbox purchase, restore, cancellation and cross-device entitlement journeys; no real charge is made by this monitor.');
 const review=value(8,'devotional_review')?.[0];
 report.areas.improvement=review?{status:review.status==='failed'?'fail':review.status==='completed'?'measured':'running',completedAt:review.completed_at,editorialGrades:Object.fromEntries(Object.entries(review.report?.lanes||{}).map(([lane,result])=>[lane,result.averages||null])),limitation:'Model editorial estimates, not audience validation.'}:missing('Awaiting the first scheduled weekly editorial report.');
 report.overallGrade=null;
 report.releaseGate=['fail','warn'].includes(report.areas.delivery.status)||report.areas.privacy.status==='fail'?'needs_attention':'no_observed_delivery_failure';
 report.limitations.push('Unknown areas remain unmeasured. Scores are never averaged to hide a failed safety, privacy, billing, or availability check.');
 return report;
}
async function runQualityJob({kind='operations',db=require('../config/supabase'),now=new Date(),...options}={}){
 const key=kind==='operations'?`operations:${now.toISOString().slice(0,13)}`:`content:${now.toISOString().slice(0,10)}`;
 const commit=process.env.RENDER_GIT_COMMIT || null;
 const claim=await db.rpc('claim_app_quality_run',{p_key:key,p_kind:kind,p_commit:commit});if(claim.error)throw claim.error;if(!claim.data)return{skipped:true,key};
 try{const report=kind==='operations'?await operationalReport({db,now,...options}):await require('./contentQualityAudit').contentQualityAudit({db,now,...options});const saved=await db.from('app_quality_reports').update({status:'completed',completed_at:new Date().toISOString(),report}).eq('run_key',key);if(saved.error)throw saved.error;return{key,report};}
 catch(error){await db.from('app_quality_reports').update({status:'failed',completed_at:new Date().toISOString(),report:{error:'Quality measurement failed; inspect service logs.'}}).eq('run_key',key);throw error;}
}
module.exports={freshness,percentile,operationalReport,runQualityJob};
