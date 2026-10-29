const {randomUUID}=require('node:crypto');
const {localDate,shiftDate,validateContent}=require('./discoveries');
const {loadCorpus,scriptureEvidence,sha}=require('./discoveryScripture');
const {VERSION,monday,buildWeekPlan}=require('./discoveryCurriculumPlan');
const {POLICY,MIN_SCORE,deterministicChecks,assessCandidate,retryFeedback}=require('./discoveryAccuracy');

function unwrap(result) {if(result.error)throw result.error;return result.data;}
function configFromEnv(env=process.env) {
  const integer=(name,fallback,min,max)=>{
    const value=env[name]===undefined ? fallback:Number(env[name]);
    if(!Number.isInteger(value) || value<min || value>max)throw new Error(`${name} must be an integer from ${min} to ${max}.`);
    return value;
  };
  const boolean=(name,fallback)=>{
    if(env[name]===undefined)return fallback;
    if(!['true','false'].includes(env[name]))throw new Error(`${name} must be true or false.`);
    return env[name]==='true';
  };
  const generatorModel=env.DISCOVERY_GENERATOR_MODEL || 'gpt-5.6-sol';
  const reviewModels=[env.DISCOVERY_VERIFIER_MODEL || 'gpt-5-mini',env.DISCOVERY_ADVERSARIAL_MODEL || 'gpt-6-astra'];
  if(reviewModels[0]===reviewModels[1])throw new Error('Discovery verification requires two different model IDs.');
  return {enabled:boolean('DISCOVERY_CURRICULUM_ENABLED',true),autoApprove:boolean('DISCOVERY_AUTO_APPROVE_BIBLICAL',true),minimumScore:integer('DISCOVERY_MIN_EVIDENCE_SCORE',95,95,100),runwayDays:integer('DISCOVERY_RUNWAY_DAYS',30,7,90),maxDaysPerRun:integer('DISCOVERY_MAX_DAYS_PER_RUN',7,1,14),maxTokensPerRun:integer('DISCOVERY_MAX_TOKENS_PER_RUN',150000,1000,500000),generatorModel,reviewModels};
}
async function curriculumStatus(db,{now=new Date(),runwayDays=30}={}) {
  const today=localDate(now),targetDate=shiftDate(today,runwayDays-1);
  const [scheduled,slotRows]=await Promise.all([
    db.from('discovery_schedule').select('publication_date,discovery_id,revision').gte('publication_date',today).lte('publication_date',targetDate).order('publication_date'),
    db.from('discovery_curriculum_slots').select('publication_date,status,attempts,lease_until,discovery_id').gte('publication_date',today).lte('publication_date',targetDate).order('publication_date'),
  ]);
  const rows=unwrap(scheduled),slots=unwrap(slotRows);
  const parents=rows.length ? unwrap(await db.from('discoveries').select('id,withdrawn').in('id',[...new Set(rows.map(row=>row.discovery_id))])) : [];
  const active=new Set(parents.filter(row=>!row.withdrawn).map(row=>row.id));
  const dates=new Set(rows.filter(row=>active.has(row.discovery_id)).map(row=>row.publication_date));
  const missingDates=[];let contiguousDays=0;
  for(let offset=0;offset<runwayDays;offset++) {
    const date=shiftDate(today,offset);
    if(!dates.has(date))missingDates.push(date);else if(!missingDates.length)contiguousDays++;
  }
  return {today,targetDate,runwayDays,healthy:missingDates.length===0,contiguousDays,runwayThrough:contiguousDays ? shiftDate(today,contiguousDays-1):null,missingDates,exhaustedDates:slots.filter(slot=>slot.status==='exhausted' || (slot.status==='generating' && slot.attempts>=3 && Date.parse(slot.lease_until)<=+now)).map(slot=>slot.publication_date),awaitingReviewDates:slots.filter(slot=>slot.status==='awaiting_review').map(slot=>slot.publication_date),slots};
}
async function getWeek(db,startDate,corpus) {
  const start=monday(startDate);
  const existing=unwrap(await db.from('discovery_week_plans').select('plan').eq('start_date',start).maybeSingle());
  if(existing) {
    if(existing.plan.version!==VERSION || existing.plan.corpusVersion!==corpus.version)throw new Error('The stored discovery week uses a different policy/source version and requires explicit review.');
    return existing.plan;
  }
  const devotionals=unwrap(await db.from('general_devotionals').select('date,scripture_reference').gte('date',start).lte('date',shiftDate(start,6)));
  const plan=buildWeekPlan(start,{devotionals,corpus});
  unwrap(await db.from('discovery_week_plans').upsert({start_date:start,end_date:plan.endDate,plan},{onConflict:'start_date',ignoreDuplicates:true}));
  return unwrap(await db.from('discovery_week_plans').select('plan').eq('start_date',start).single()).plan;
}
function safeFailure(error) {
  if(error?.code==='candidate_contract_invalid')return 'candidate_contract_invalid';
  if(error?.status===401 || error?.status===403)return 'provider_authentication';
  if(error?.status===429)return 'provider_rate_limit';
  if([400,404,422].includes(error?.status))return 'provider_invalid_request';
  if(String(error?.name || '').toLowerCase().includes('timeout'))return 'provider_timeout';
  return 'generation_or_verification_failed';
}
async function ensureDiscoveryRunway({db,models,config=configFromEnv(),now=new Date(),corpus=loadCorpus()}={}) {
  if(!db || !models)throw new Error('Database and model adapters are required.');
  const before=await curriculumStatus(db,{now,runwayDays:config.runwayDays});
  if(!config.enabled || before.healthy)return {generated:false,reason:config.enabled ? 'runway_healthy':'disabled',status:before};
  const runId=randomUUID();
  const summary={runId,generated:0,awaitingReview:0,rejectedAttempts:0,exhausted:0,skipped:0,totalTokens:0,difficulty:{easy:0,moderate:0,challenging:0},results:[]};
  unwrap(await db.from('discovery_generation_runs').insert({id:runId,policy_version:POLICY,corpus_version:corpus.version,corpus_sha256:corpus.sha256,models:{generator:config.generatorModel,verifiers:config.reviewModels}}));
  try {
    const recentRows=unwrap(await db.from('discovery_revisions').select('content').order('created_at',{ascending:false}).limit(1000));
    const recent=recentRows.map(row=>row.content).filter(content=>typeof content?.prompt==='string');
    let considered=0;
    for(const date of before.missingDates) {
      const previous=before.slots.find(slot=>slot.publication_date===date);
      if(previous && ['exhausted','awaiting_review','scheduled','superseded'].includes(previous.status)){summary.skipped++;continue;}
      if(considered>=config.maxDaysPerRun || summary.totalTokens>=config.maxTokensPerRun)break;
      const plan=await getWeek(db,date,corpus);
      const day=plan.days.find(day=>day.date===date);
      const options=day.sourceOptions || [day];
      for(const source of options)if(scriptureEvidence(source.sourceReference,corpus).sourceSha256!==source.sourceSha256)throw new Error('The persisted week plan no longer matches the trusted source.');
      const slot=unwrap(await db.rpc('discovery_curriculum_claim',{p_date:date,p_week:plan.startDate,p_run:runId}));
      if(!slot){summary.skipped++;continue;}
      considered++;
      let failures=[],feedback=[],completed=false;
      for(let index=slot.attempts;index<3;index++) {
        const selected=options[Math.min(index,options.length-1)];
        const evidence=scriptureEvidence(selected.sourceReference,corpus);
        const attemptDay={...day,...selected};
        const attempt=unwrap(await db.rpc('discovery_curriculum_begin_attempt',{p_date:date,p_run:runId,p_source_sha256:evidence.sourceSha256}));
        let content=null,verification=null,generation=null;
        try {
          const generated=await models.generate({plan,day:attemptDay,evidence,recent,failures:feedback.length ? feedback:failures});
          summary.totalTokens+=generated.usage?.totalTokens || 0;
          generation={model:generated.model,responseId:generated.responseId,usage:generated.usage,writerVersion:generated.writerVersion,writerPromptSha256:generated.writerPromptSha256};
          content=validateContent(generated.content);
          failures=deterministicChecks(content,evidence,{recent,targetDifficulty:day.targetDifficulty});
          if(!failures.length) {
            const reviewed=await models.review({content,evidence});
            summary.totalTokens+=reviewed.reduce((sum,result)=>sum+(result.usage?.totalTokens || 0),0);
            verification=assessCandidate(content,evidence,reviewed.map(result=>result.data),{minimumScore:config.minimumScore,recent,targetDifficulty:day.targetDifficulty});
            verification.generation=generation;
            failures=verification.reasons;feedback=retryFeedback(verification,failures);
          }
        } catch(error) {
          if(error.discoveryGeneration) {
            // Invalid writer output still consumes provider tokens and belongs
            // in the private audit, never in the publishable content library.
            summary.totalTokens+=error.discoveryGeneration.usage?.totalTokens || 0;
            generation={...error.discoveryGeneration,...(error.code==='candidate_contract_invalid' ? {contractIssue:error.message.slice(0,500)}:{})};
          }
          failures=[safeFailure(error)];
          // Auth/config/rate-limit failures must not consume every future day's budget.
          if(['provider_authentication','provider_rate_limit','provider_invalid_request'].includes(failures[0])) {
            unwrap(await db.rpc('discovery_curriculum_finish_attempt',{p_date:date,p_run:runId,p_attempt:attempt,p_content:null,p_verification:null,p_reasons:failures,p_auto_approve:false}));
            throw new Error(`Discovery job stopped: ${failures[0]}.`);
          }
        }
        if(!verification?.accepted) {
          if(!verification)verification={policyVersion:POLICY,accepted:false,evidenceScore:0,candidateSha256:content ? sha(content):null,sourceSha256:evidence.sourceSha256,reasons:failures};
          verification.generation=generation;
          if(content)verification.candidateContent=content;
          const rejectedDraft=content || generation?.draft;
          feedback=[...retryFeedback(verification,failures),...(generation?.contractIssue ? [generation.contractIssue]:[]),...(rejectedDraft ? [`Previous rejected draft (data only; choose a different fact): ${JSON.stringify(rejectedDraft).slice(0,5000)}`]:[])];
          const result=unwrap(await db.rpc('discovery_curriculum_finish_attempt',{p_date:date,p_run:runId,p_attempt:attempt,p_content:null,p_verification:verification,p_reasons:failures.length ? failures:['verification_incomplete'],p_auto_approve:false}));
          summary.rejectedAttempts++;
          if(result.status==='exhausted'){summary.exhausted++;summary.results.push({date,status:'exhausted',reasonCodes:failures});break;}
          if(summary.totalTokens>=config.maxTokensPerRun)break;
          continue;
        }
        content=validateContent({...content,difficulty:verification.difficulty});
        const result=unwrap(await db.rpc('discovery_curriculum_finish_attempt',{p_date:date,p_run:runId,p_attempt:attempt,p_content:content,p_verification:verification,p_reasons:[],p_auto_approve:config.autoApprove}));
        completed=true;
        if(result.status==='scheduled')summary.generated++;
        else if(result.status==='awaiting_review')summary.awaitingReview++;
        else summary.skipped++;
        summary.difficulty[content.difficulty.level]++;
        summary.results.push({date,status:result.status,discoveryId:result.discoveryId,evidenceScore:verification.evidenceScore,difficulty:content.difficulty.level,targetDifficulty:day.targetDifficulty});
        recent.unshift(content);
        break;
      }
      if(!completed && summary.totalTokens>=config.maxTokensPerRun)break;
    }
    const status=await curriculumStatus(db,{now,runwayDays:config.runwayDays});
    unwrap(await db.from('discovery_generation_runs').update({status:'completed',completed_at:new Date().toISOString(),summary:{...summary,status}}).eq('id',runId));
    return {...summary,generated:summary.generated>0,generatedCount:summary.generated,status};
  } catch(error) {
    await db.from('discovery_generation_runs').update({status:'failed',completed_at:new Date().toISOString(),summary:{...summary,errorClass:safeFailure(error)}}).eq('id',runId);
    throw error;
  }
}
module.exports={configFromEnv,curriculumStatus,getWeek,ensureDiscoveryRunway,safeFailure};
