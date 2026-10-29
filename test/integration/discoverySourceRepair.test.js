const test=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {createHarness,ADMIN,MEMBER}=require('../helpers/discoveryHarness');
const {getWeek}=require('../../utils/discoveryCurriculum');
const {localDate,shiftDate}=require('../../utils/discoveries');
const {loadCorpus,scriptureEvidence}=require('../../utils/discoveryScripture');
const {prepareSourceRepair,sourceRepairSql}=require('../../utils/discoverySourceRepair');
async function setup() {
 const h=await createHarness({curriculum:true}),date=shiftDate(localDate(new Date(),'UTC'),5);
 const plan=await getWeek(h.client,date,loadCorpus());
 await h.db.query("insert into discovery_curriculum_slots(publication_date,week_start,status,generation_epoch,attempts) values($1,$2,'exhausted',2,3)",[date,plan.startDate]);
 const manifest={id:'synthetic-source-repair',reason:'Synthetic test repair of exhausted source selections; no production questions or human factual approval is represented.',days:[{date,sources:[['John 20:11-18','Connect the missing body and Mary’s first mistaken supposition about the gardener.'],['Exodus 2:1-10','Connect the sister finding a nurse with the child’s mother being paid to nurse him.'],['Acts 18:1-4','Connect Paul working and living with the couple with their shared tent-making trade.']]}]};
 const before=(await h.db.query('select plan from discovery_week_plans')).rows[0].plan;
 // Keep this fixture independent of the planner's evolving scene catalogue.
 before.days.find(d=>d.date===date).sourceOptions=[{sourceReference:'Genesis 9:12-17',sourceSha256:'synthetic-old-source',angle:'Synthetic source before repair.'}];
 await h.db.query('update discovery_week_plans set plan=$1',[before]);
 const snapshot={plans:[{start_date:plan.startDate,plan:before}],slots:(await h.db.query('select * from discovery_curriculum_slots')).rows,schedules:[],runs:[],actor:ADMIN,manifest};
 return {h,date,before,snapshot,repair:prepareSourceRepair(snapshot)};
}
test('explicit source repair preserves history and unrelated days while resetting only the exhausted epoch',async t=>{
 const {h,date,before,repair}=await setup();t.after(()=>h.close());
 await h.db.exec(sourceRepairSql(repair));
 const after=(await h.db.query('select plan from discovery_week_plans')).rows[0].plan;
 assert.deepEqual(after.days.filter(d=>d.date!==date),before.days.filter(d=>d.date!==date));
 assert.deepEqual(after.sourceRepairs[0].changes[0].previousSources,before.days.find(d=>d.date===date).sourceOptions);
 assert.equal(after.days.find(d=>d.date===date).sourceOptions.length,3);
 const slot=(await h.db.query('select * from discovery_curriculum_slots')).rows[0];
 assert.equal(slot.status,'pending');assert.equal(slot.generation_epoch,3);assert.equal(slot.attempts,0);
 assert.equal((await h.db.query('select * from discovery_reviews')).rows.length,0,'a plan repair does not approve a question');
});
test('a concurrent source-plan edit makes the entire repair roll back',async t=>{
 const {h,before,repair}=await setup();t.after(()=>h.close());
 await h.db.query('update discovery_week_plans set plan=$1',[{...before,concurrentEdit:true}]);
 await assert.rejects(h.db.exec(sourceRepairSql(repair)),/Source plan changed/);await h.db.exec('rollback');
 assert.equal((await h.db.query('select generation_epoch from discovery_curriculum_slots')).rows[0].generation_epoch,2);
});
test('non-administrators and newly started workers cannot apply the prepared repair',async t=>{
 const {h,snapshot,repair}=await setup();t.after(()=>h.close());
 const denied=prepareSourceRepair({...snapshot,actor:MEMBER});
 await assert.rejects(h.db.exec(sourceRepairSql(denied)),/Global admin required/i);await h.db.exec('rollback');
 await h.db.query('insert into discovery_generation_runs(id,policy_version,corpus_version,corpus_sha256,models) values($1,$2,$3,$4,$5)',[randomUUID(),'synthetic','synthetic','0'.repeat(64),{}]);
 await assert.rejects(h.db.exec(sourceRepairSql(repair)),/worker started/);await h.db.exec('rollback');
 assert.equal((await h.db.query('select generation_epoch from discovery_curriculum_slots')).rows[0].generation_epoch,2);
});
test('scheduled, released, unchanged or active-worker source repairs fail before mutation',async t=>{
 const {h,date,snapshot}=await setup();t.after(()=>h.close());
 assert.throws(()=>prepareSourceRepair({...snapshot,schedules:[{publication_date:date}]}),/unscheduled exhausted/);
 assert.throws(()=>prepareSourceRepair({...snapshot,runs:[{status:'running'}]}),/active generation/);
 assert.throws(()=>prepareSourceRepair({...snapshot,manifest:{...snapshot.manifest,days:[{...snapshot.manifest.days[0],date:localDate()}]}}),/unreleased future/);
});
test('a writer-policy repair can reuse sources once, only with three audited earlier-writer rejections',async t=>{
 const {h,date,before,snapshot}=await setup();t.after(()=>h.close());
 const options=snapshot.manifest.days[0].sources.map(([reference,angle])=>{const e=scriptureEvidence(reference);return {sourceReference:reference,sourceSha256:e.sourceSha256,angle};});
 before.days.find(d=>d.date===date).sourceOptions=options;
 await h.db.query('update discovery_week_plans set plan=$1',[before]);
 const run=randomUUID();
 await h.db.query("insert into discovery_generation_runs(id,policy_version,corpus_version,corpus_sha256,models,status) values($1,'synthetic','synthetic',$2,'{}','completed')",[run,'0'.repeat(64)]);
 for(let attempt=1;attempt<=3;attempt++)await h.db.query("insert into discovery_generation_attempts(publication_date,generation_epoch,attempt,run_id,status,source_sha256,verification) values($1,2,$2,$3,'rejected',$4,$5)",[date,attempt,run,options[attempt-1].sourceSha256,{generation:{writerVersion:'sanctuary-trivia-writer-v3'}}]);
 const manifest={...snapshot.manifest,mode:'writer_revision',previousWriterVersion:'sanctuary-trivia-writer-v3',writerVersion:'sanctuary-trivia-writer-v4'};
 const attempts=options.map((_,index)=>({publication_date:date,generation_epoch:2,attempt:index+1,status:'rejected',writer_version:'sanctuary-trivia-writer-v3'}));
 assert.throws(()=>prepareSourceRepair({...snapshot,manifest:{...manifest,previousWriterVersion:manifest.writerVersion},attempts}),/earlier audited writer/);
 assert.throws(()=>prepareSourceRepair({...snapshot,manifest,attempts:attempts.map(a=>({...a,writer_version:manifest.writerVersion}))}),/three rejected attempts/);
 const repair=prepareSourceRepair({...snapshot,manifest,attempts});
 await h.db.exec(sourceRepairSql(repair));
 assert.equal((await h.db.query('select generation_epoch from discovery_curriculum_slots')).rows[0].generation_epoch,3);
 assert.equal((await h.db.query('select count(*)::int n from discovery_generation_attempts')).rows[0].n,3,'earlier rejections remain intact');
});
