const {randomUUID}=require('node:crypto');
const {localDate,shiftDate,validateContent}=require('./discoveries');
const {loadCorpus,scriptureEvidence}=require('./discoveryScripture');
const {POLICY,deterministicChecks,assessCandidate,retryFeedback}=require('./discoveryAccuracy');
const {configFromEnv,safeFailure}=require('./discoveryCurriculum');
const {buildDailySetPlan}=require('./discoveryDailyPlan');
const unwrap=result=>{if(result.error)throw result.error;return result.data;};
async function dailySetStatus(db,{now=new Date(),runwayDays=7}={}) {
 const today=localDate(now),through=shiftDate(today,runwayDays-1);
 const [sets,jobs]=await Promise.all([db.from('discovery_daily_sets').select('publication_date').gte('publication_date',today).lte('publication_date',through),db.from('discovery_daily_jobs').select('publication_date,status').gte('publication_date',today).lte('publication_date',through)]);
 const dates=new Set(unwrap(sets).map(row=>row.publication_date));
 return {today,through,missingDates:Array.from({length:runwayDays},(_,i)=>shiftDate(today,i)).filter(date=>!dates.has(date)),exhaustedDates:unwrap(jobs).filter(row=>row.status==='exhausted').map(row=>row.publication_date),published:dates.size};
}
async function ensureDailySets({db,models,config=configFromEnv(),now=new Date(),runwayDays=7,maxDaysPerRun=2,corpus=loadCorpus(),planForDate=buildDailySetPlan}={}) {
 const before=await dailySetStatus(db,{now,runwayDays});
 if(!config.enabled || config.autoApprove===false || !before.missingDates.length)return {generated:false,status:before};
 const runId=randomUUID();
 unwrap(await db.from('discovery_generation_runs').insert({id:runId,policy_version:POLICY,corpus_version:corpus.version,corpus_sha256:corpus.sha256,models:{generator:config.generatorModel,verifiers:config.reviewModels,format:'daily-set-v1'}}));
 const summary={runId,published:0,rejectedAttempts:0,exhausted:0,totalTokens:0,results:[]};
 const recent=unwrap(await db.from('discovery_revisions').select('content').order('created_at',{ascending:false}).limit(1000)).map(row=>row.content);
 try {
  for(const date of before.missingDates.filter(date=>!before.exhaustedDates.includes(date)).slice(0,maxDaysPerRun)) {
   if(summary.totalTokens>=config.maxTokensPerRun)break;
   const proposed=planForDate(date,corpus);
   const job=unwrap(await db.rpc('discovery_daily_claim',{p_date:date,p_plan:proposed,p_run:runId}));
   if(!job)continue;
   const plan=job.plan;
   if(plan.version!==proposed.version || plan.corpusSha256!==corpus.sha256)throw new Error('Frozen daily plan requires explicit version review.');
   let exhausted=false;
   for(const slot of plan.slots) {
    const attempts=unwrap(await db.from('discovery_daily_attempts').select('attempt,status,content,verification,reason_codes').eq('publication_date',date).eq('position',slot.position).order('attempt'));
    if(attempts.some(a=>a.status==='accepted'))continue;
    let feedback=attempts.flatMap(a=>retryFeedback(a.verification,a.reason_codes));
    for(let n=attempts.length;n<3;n++) {
     if(summary.totalTokens>=config.maxTokensPerRun)break;
     const selected=slot.sourceOptions[n],evidence=scriptureEvidence(selected.sourceReference,corpus);
     if(evidence.sourceSha256!==selected.sourceSha256)throw new Error('Frozen daily source changed.');
     const attempt=unwrap(await db.rpc('discovery_daily_begin',{p_date:date,p_position:slot.position,p_run:runId,p_source_sha256:evidence.sourceSha256}));
     const siblings=unwrap(await db.from('discovery_daily_attempts').select('content').eq('publication_date',date).eq('status','accepted')).map(a=>a.content);
     let content=null,verification=null,reasons=[],generation=null;
     try {
      const generated=await models.generate({plan,day:{...selected,targetDifficulty:slot.targetDifficulty,setPosition:slot.position,siblingQuestions:siblings},evidence,recent,failures:feedback});
      summary.totalTokens+=generated.usage?.totalTokens || 0;
      generation={model:generated.model,responseId:generated.responseId,usage:generated.usage,writerVersion:generated.writerVersion,writerPromptSha256:generated.writerPromptSha256};
      content=validateContent(generated.content);
      reasons=deterministicChecks(content,evidence,{recent});
      if(!reasons.length) {
       const responses=await models.review({content,evidence});summary.totalTokens+=responses.reduce((s,r)=>s+(r.usage?.totalTokens || 0),0);
       verification=assessCandidate(content,evidence,responses.map(r=>r.data),{minimumScore:config.minimumScore,dailySet:true,targetDifficulty:slot.targetDifficulty,recent});
       reasons=verification.reasons;
      }
     } catch(error) {
      if(error.discoveryGeneration)summary.totalTokens+=error.discoveryGeneration.usage?.totalTokens || 0;
      reasons=[safeFailure(error)];
      if(['provider_authentication','provider_invalid_request','provider_rate_limit'].includes(reasons[0]))throw error;
     }
     verification={...(verification || {accepted:false,policyVersion:POLICY,reasons}),generation,...(content ? {candidateContent:content}:{})};
     if(!reasons.length && verification.accepted) {
      content=validateContent({...content,difficulty:verification.difficulty});
      unwrap(await db.rpc('discovery_daily_finish',{p_date:date,p_position:slot.position,p_run:runId,p_attempt:attempt,p_content:content,p_verification:verification,p_reasons:[]}));
      recent.unshift(content);break;
     }
     feedback=retryFeedback(verification,reasons);
     const result=unwrap(await db.rpc('discovery_daily_finish',{p_date:date,p_position:slot.position,p_run:runId,p_attempt:attempt,p_content:null,p_verification:verification,p_reasons:reasons.length ? reasons:['verification_incomplete']}));
     summary.rejectedAttempts++;
     if(result.status==='exhausted'){summary.exhausted++;exhausted=true;break;}
    }
    if(exhausted || summary.totalTokens>=config.maxTokensPerRun)break;
   }
   const accepted=unwrap(await db.from('discovery_daily_attempts').select('position,content').eq('publication_date',date).eq('status','accepted').order('position'));
   if(!exhausted && accepted.length===3) {
    const reviews=await models.reviewSet(accepted.map(a=>a.content));summary.totalTokens+=reviews.reduce((s,r)=>s+(r.usage?.totalTokens || 0),0);
    const result=unwrap(await db.rpc('discovery_daily_publish',{p_date:date,p_run:runId,p_reviews:reviews}));
    summary.published+=result.status==='published' ? 1:0;summary.exhausted+=result.status==='exhausted' ? 1:0;summary.results.push({date,...result});
   }
  }
  unwrap(await db.from('discovery_generation_runs').update({status:'completed',summary,completed_at:new Date().toISOString()}).eq('id',runId));
 } catch(error) {
  await db.from('discovery_generation_runs').update({status:'failed',summary:{...summary,failure:safeFailure(error)},completed_at:new Date().toISOString()}).eq('id',runId);throw error;
 }
 return {...summary,status:await dailySetStatus(db,{now,runwayDays})};
}
module.exports={dailySetStatus,ensureDailySets};
