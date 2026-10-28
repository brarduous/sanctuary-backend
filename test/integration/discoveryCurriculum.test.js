const test=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {createHarness,ADMIN,MEMBER}=require('../helpers/discoveryHarness');
const {draftFor,reviewFor}=require('../helpers/discoveryAccuracyFixtures');
const {configFromEnv,ensureDiscoveryRunway,curriculumStatus,getWeek}=require('../../utils/discoveryCurriculum');
const {loadCorpus,scriptureEvidence}=require('../../utils/discoveryScripture');
const {assessCandidate,POLICY}=require('../../utils/discoveryAccuracy');
const {localDate}=require('../../utils/discoveries');
const corpus=loadCorpus(),today=localDate();
const config={...configFromEnv({}),runwayDays:7,maxDaysPerRun:1,generatorModel:'test-writer',reviewModels:['test-verifier-a','test-verifier-b']};
async function setup({listen=false}={}) {
 const h=await createHarness({curriculum:true,listen});
 await h.db.query('insert into general_devotionals values ($1,$2)',[today,'Genesis 9:13']);
 const plan=await getWeek(h.client,today,corpus);
 plan.days.find(day=>day.date===today).sourceOptions=[{sourceReference:'Genesis 9:12-17',sourceSha256:scriptureEvidence('Genesis 9:12-17').sourceSha256,angle:'A covenant sign in the clouds.'},{sourceReference:'Genesis 9:13-16',sourceSha256:scriptureEvidence('Genesis 9:13-16').sourceSha256,angle:'A covenant sign in the clouds.'},{sourceReference:'Genesis 9:12-16',sourceSha256:scriptureEvidence('Genesis 9:12-16').sourceSha256,angle:'A covenant sign in the clouds.'}];
 const first=plan.days.find(day=>day.date===today).sourceOptions[0];
 Object.assign(plan.days.find(day=>day.date===today),first);
 await h.db.query('update discovery_week_plans set plan=$1 where start_date=$2',[plan,plan.startDate]);
 return h;
}
function modelAdapter({rejectFirst=false,alwaysReject=false}={}) {
 let generated=0;
 return {get count(){return generated;},async generate({evidence}){generated++;return {content:draftFor(evidence),usage:{totalTokens:100}};},async review({content,evidence}){
  const rows=[reviewFor(content,evidence),reviewFor(content,evidence,'test-verifier-b')];
  if(alwaysReject || (rejectFirst && generated===1))rows[0].claims[0].confidence=94;
  return rows.map(data=>({data,usage:{totalTokens:100}}));
 }};
}
test('cron retries a rejected candidate then auto-approves and schedules only the passing revision',async()=>{
 const h=await setup({listen:true});
 try {
  const models=modelAdapter({rejectFirst:true});
  const result=await ensureDiscoveryRunway({db:h.client,models,config,corpus});
  assert.equal(result.generatedCount,1);assert.equal(result.rejectedAttempts,1);assert.equal(models.count,2);
  const scheduled=await h.db.query('select * from discovery_schedule');assert.equal(scheduled.rows.length,1);assert.equal(scheduled.rows[0].publication_date,today);
  const reviews=await h.db.query('select * from discovery_reviews');assert.equal(reviews.rows[0].review_method,'automated_evidence');assert.equal(reviews.rows[0].reviewer_id,null);assert.equal(reviews.rows[0].attestations.sourcesReadInContext,undefined,'automation must not forge a human attestation');
  const revisions=await h.db.query('select * from discovery_revisions');assert.equal(revisions.rows.length,1,'rejected drafts are discarded from the content library');assert.equal(revisions.rows[0].content.difficulty.level,'easy');
  const publicResponse=await fetch(`${h.base}/api/v1/discoveries/${revisions.rows[0].discovery_id}`);assert.equal(publicResponse.status,200);
  const projected=await publicResponse.json();assert.equal(projected.discovery.difficulty.level,'easy');assert.equal(projected.discovery.evidenceScore,undefined);assert.equal(projected.discovery.review_method,undefined,'private verification records are not public content');
  const attempts=await h.db.query('select status,evidence_score,verification,source_sha256 from discovery_generation_attempts order by attempt');assert.deepEqual(attempts.rows.map(row=>row.status),['rejected','auto_approved']);assert.equal(attempts.rows[0].evidence_score,94);
  assert.notEqual(attempts.rows[0].source_sha256,attempts.rows[1].source_sha256,'a rejected draft moves to the next precommitted source');
  assert.equal(typeof attempts.rows[0].verification.candidateContent.prompt,'string','rejected candidates stay available in the private audit');
 }finally{await h.close();}
});
test('three failures exhaust the persistent budget and no content, approval, or schedule is created',async()=>{
 const h=await setup();
 try {
  const models=modelAdapter({alwaysReject:true});
  const result=await ensureDiscoveryRunway({db:h.client,models,config,corpus});
  assert.equal(result.exhausted,1);assert.equal(models.count,3);assert.equal(result.generatedCount,0);
  assert.equal((await h.db.query('select * from discovery_revisions')).rows.length,0);
  assert.equal((await h.db.query('select * from discovery_reviews')).rows.length,0);
  assert.equal((await h.db.query('select * from discovery_schedule')).rows.length,0);
  assert.ok((await curriculumStatus(h.client,{runwayDays:7})).exhaustedDates.includes(today));
  const run=randomUUID();await h.db.query('insert into discovery_generation_runs(id,policy_version,corpus_version,corpus_sha256,models) values($1,$2,$3,$4,$5)',[run,POLICY,corpus.version,corpus.sha256,{}]);
  const claimed=await h.client.rpc('discovery_curriculum_claim',{p_date:today,p_week:(await getWeek(h.client,today,corpus)).startDate,p_run:run});assert.equal(claimed.data,null,'restarting the cron does not reset the budget');
  assert.ok((await h.client.rpc('discovery_curriculum_retry',{p_date:today,p_actor:MEMBER})).error);
  assert.equal((await h.client.rpc('discovery_curriculum_retry',{p_date:today,p_actor:ADMIN})).error,null);
  assert.equal((await h.db.query('select generation_epoch,attempts from discovery_curriculum_slots where publication_date=$1',[today])).rows[0].generation_epoch,2);
 }finally{await h.close();}
});
test('opting out of auto-approval retains a verified draft without a forged review',async()=>{
 const h=await setup();
 try {
  const result=await ensureDiscoveryRunway({db:h.client,models:modelAdapter(),config:{...config,autoApprove:false},corpus});
  assert.equal(result.awaitingReview,1);assert.equal((await h.db.query('select * from discovery_reviews')).rows.length,0);assert.equal((await h.db.query('select * from discovery_schedule')).rows.length,0);
 }finally{await h.close();}
});
test('leases prevent concurrent workers and SQL rejects a below-threshold approval directly',async()=>{
 const h=await setup();
 try {
  const plan=await getWeek(h.client,today,corpus),day=plan.days.find(day=>day.date===today),evidence=scriptureEvidence(day.sourceReference);
  const runs=[randomUUID(),randomUUID()];
  for(const id of runs)await h.db.query('insert into discovery_generation_runs(id,policy_version,corpus_version,corpus_sha256,models) values($1,$2,$3,$4,$5)',[id,POLICY,corpus.version,corpus.sha256,{}]);
  assert.ok((await h.client.rpc('discovery_curriculum_claim',{p_date:today,p_week:plan.startDate,p_run:runs[0]})).data);
  assert.equal((await h.client.rpc('discovery_curriculum_claim',{p_date:today,p_week:plan.startDate,p_run:runs[1]})).data,null);
  const attempt=(await h.client.rpc('discovery_curriculum_begin_attempt',{p_date:today,p_run:runs[0],p_source_sha256:evidence.sourceSha256})).data;
  const content=draftFor(evidence),reviews=[reviewFor(content,evidence),reviewFor(content,evidence,'test-verifier-b')];
  const verification=assessCandidate(content,evidence,reviews);verification.evidenceScore=94;
  const result=await h.client.rpc('discovery_curriculum_finish_attempt',{p_date:today,p_run:runs[0],p_attempt:attempt,p_content:{...content,difficulty:verification.difficulty},p_verification:verification,p_reasons:[],p_auto_approve:true});assert.match(result.error.message,/gate/);
  const good=assessCandidate(content,evidence,reviews);
  for(const mutate of [
    v=>{delete v.reviews[0].questionCraft;},
    v=>{v.reviews[1].questionCraft.choiceQuality=0;},
    v=>{v.questionCraft.score=8;},
    v=>{v.reviews[0].questionPremises=[];},
    v=>{v.reviews[0].questionPremises[0].confidence=94;},
    v=>{v.reviews[0].questionPremises[0].evidence[0].quote='An invented scene.';},
    v=>{v.reviews[0].questionPremises[0].evidence[0].verseNumber=999;},
    v=>{v.policyVersion='discovery-evidence-v1';},
  ]) {
    const forged=structuredClone(good);mutate(forged);
    const rejected=await h.client.rpc('discovery_curriculum_finish_attempt',{p_date:today,p_run:runs[0],p_attempt:attempt,p_content:{...content,difficulty:good.difficulty},p_verification:forged,p_reasons:[],p_auto_approve:true});
    assert.ok(rejected.error,'SQL must recompute craft/context checks even when accepted=true is forged');
  }
  await h.db.exec('set role authenticated');
  try {await assert.rejects(h.db.query('select discovery_curriculum_claim($1,$2,$3)',[today,plan.startDate,runs[0]]),/permission denied/);await assert.rejects(h.db.query('select * from discovery_generation_attempts'),/permission denied/);}finally{await h.db.exec('reset role');}
 }finally{await h.close();}
});
test('disabled generation is read-only and the curriculum rollback preserves human review semantics',async()=>{
 const h=await setup();
 try {
  const result=await ensureDiscoveryRunway({db:h.client,models:modelAdapter(),config:{...config,enabled:false},corpus});assert.equal(result.reason,'disabled');assert.equal((await h.db.query('select * from discovery_generation_runs')).rows.length,0);
  await h.db.exec(require('fs').readFileSync(require('path').join(__dirname,'../../supabase/rollbacks/20261028153000.sql'),'utf8'));
  assert.equal((await h.db.query("select to_regclass('public.discovery_week_plans') as name")).rows[0].name,null);
  assert.equal((await h.db.query("select to_regclass('public.discovery_reviews') as name")).rows[0].name,'discovery_reviews');
 }finally{await h.close();}
});
test('a worker killed on its third attempt is reported exhausted and cannot obtain a fourth attempt',async()=>{
 const h=await setup();
 try {
  const plan=await getWeek(h.client,today,corpus),day=plan.days.find(day=>day.date===today),run=randomUUID();
  await h.db.query('insert into discovery_generation_runs(id,policy_version,corpus_version,corpus_sha256,models) values($1,$2,$3,$4,$5)',[run,POLICY,corpus.version,corpus.sha256,{}]);
  await h.client.rpc('discovery_curriculum_claim',{p_date:today,p_week:plan.startDate,p_run:run});
  for(let i=0;i<3;i++)assert.equal((await h.client.rpc('discovery_curriculum_begin_attempt',{p_date:today,p_run:run,p_source_sha256:day.sourceOptions?.[i]?.sourceSha256 || day.sourceSha256})).error,null);
  await h.db.query("update discovery_curriculum_slots set lease_until=now()-interval '1 minute' where publication_date=$1",[today]);
  assert.ok((await curriculumStatus(h.client,{runwayDays:7})).exhaustedDates.includes(today));
  const again=await h.client.rpc('discovery_curriculum_claim',{p_date:today,p_week:plan.startDate,p_run:run});assert.equal(again.data,null);
  assert.equal((await h.db.query('select status from discovery_curriculum_slots where publication_date=$1',[today])).rows[0].status,'exhausted');
  assert.ok((await h.client.rpc('discovery_curriculum_begin_attempt',{p_date:today,p_run:run,p_source_sha256:day.sourceSha256})).error);
 }finally{await h.close();}
});

test('invalid writer output is privately audited and still consumes the run budget',async()=>{
 const h=await setup();
 try {
  const result=await ensureDiscoveryRunway({db:h.client,config:{...config,maxTokensPerRun:1000},corpus,models:{async generate(){const error=Object.assign(new Error('Invalid candidate'),{status:400,code:'candidate_contract_invalid'});error.discoveryGeneration={model:'test-writer',responseId:'test-response',usage:{totalTokens:2000},draft:{prompt:'Invalid draft'}};throw error;}}});
  assert.equal(result.totalTokens,2000);assert.equal(result.rejectedAttempts,1);
  const audit=(await h.db.query('select verification from discovery_generation_attempts')).rows[0].verification;
  assert.equal(audit.generation.responseId,'test-response');assert.equal(audit.generation.draft.prompt,'Invalid draft');
  assert.equal((await h.db.query('select * from discovery_revisions')).rows.length,0);
 }finally{await h.close();}
});

test('SQL binds each retry to its precommitted source and source-options rollback restores the old selector',async()=>{
 const h=await setup();
 try {
  const plan=await getWeek(h.client,today,corpus),day=plan.days.find(row=>row.date===today),run=randomUUID();
  await h.db.query('insert into discovery_generation_runs(id,policy_version,corpus_version,corpus_sha256,models) values($1,$2,$3,$4,$5)',[run,POLICY,corpus.version,corpus.sha256,{}]);
  await h.client.rpc('discovery_curriculum_claim',{p_date:today,p_week:plan.startDate,p_run:run});
  const forged=await h.client.rpc('discovery_curriculum_begin_attempt',{p_date:today,p_run:run,p_source_sha256:day.sourceOptions[1].sourceSha256});assert.match(forged.error.message,/evidence changed/);
  assert.equal((await h.db.query('select attempts from discovery_curriculum_slots')).rows[0].attempts,0);
  await h.db.exec('set role authenticated');try{await assert.rejects(h.db.query('select discovery_attempt_source($1,$2,1)',[plan.startDate,today]),/permission denied/);}finally{await h.db.exec('reset role');}
  await h.db.exec(require('fs').readFileSync(require('path').join(__dirname,'../../supabase/rollbacks/20261028234500.sql'),'utf8'));
  assert.equal((await h.db.query("select to_regprocedure('public.discovery_attempt_source(date,date,integer)') as fn")).rows[0].fn,null);
  assert.equal((await h.client.rpc('discovery_curriculum_begin_attempt',{p_date:today,p_run:run,p_source_sha256:day.sourceSha256})).error,null);
 }finally{await h.close();}
});
