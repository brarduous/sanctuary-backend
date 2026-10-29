const {randomUUID}=require('node:crypto');
const {localDate,shiftDate}=require('./discoveries');
const {scriptureEvidence,sha}=require('./discoveryScripture');
const {VERSION}=require('./discoveryCurriculumPlan');
const {VERSION:WRITER_VERSION}=require('./discoveryWriterPolicy');
const {configFromEnv}=require('./discoveryCurriculum');

// Operator-only data repair, never invoked by the generation cron. A repair
// changes source selections, not approval policy or the rejected audit records.
function prepareSourceRepair({manifest,plans,slots,schedules,runs,attempts=[],actor,now=new Date(),corpus}) {
  if(!/^[0-9a-f-]{36}$/i.test(actor || ''))throw new Error('An administrator actor is required.');
  if(!manifest?.id || typeof manifest.reason!=='string' || manifest.reason.length<80 || !Array.isArray(manifest.days) || !manifest.days.length || manifest.days.length>14)throw new Error('A bounded source repair needs an explicit written rationale.');
  if(runs.some(run=>run.status==='running'))throw new Error('Wait for active generation workers before repairing sources.');
  const writerRepair=manifest.mode==='writer_revision';
  const reviewerRepair=manifest.mode==='reviewer_revision';
  if(writerRepair && (manifest.writerVersion!==WRITER_VERSION || !/^sanctuary-trivia-writer-v\d+$/.test(manifest.previousWriterVersion || '') || Number(manifest.previousWriterVersion.split('-v').at(-1))>=Number(WRITER_VERSION.split('-v').at(-1))))throw new Error('A writer repair must move from an earlier audited writer to the deployed code policy.');
  if(reviewerRepair && (manifest.writerVersion!==WRITER_VERSION || JSON.stringify(manifest.reviewModels)!==JSON.stringify(configFromEnv({}).reviewModels) || !Array.isArray(manifest.previousReviewModels) || manifest.previousReviewModels.length!==2 || manifest.previousReviewModels.some(model=>!/^[-a-z0-9._]+$/.test(model)) || JSON.stringify(manifest.previousReviewModels)===JSON.stringify(manifest.reviewModels)))throw new Error('A reviewer repair requires a changed, source-checked model pair matching the current code policy.');
  const dates=manifest.days.map(day=>day.date);
  if(new Set(dates).size!==dates.length)throw new Error('Repair dates must be unique.');
  const changes=new Map();
  const audit={id:randomUUID(),manifestId:manifest.id,manifestSha256:sha(manifest),createdAt:now.toISOString(),actor,reason:manifest.reason,method:'Explicit operator source repair under owner authorization; not human factual approval.',...(writerRepair ? {mode:'writer_revision',previousWriterVersion:manifest.previousWriterVersion,writerVersion:WRITER_VERSION}:{}),changes:[]};
  if(reviewerRepair)Object.assign(audit,{mode:'reviewer_revision',writerVersion:WRITER_VERSION,previousReviewModels:manifest.previousReviewModels,reviewModels:manifest.reviewModels});
  for(const item of manifest.days) {
    if(!/^\d{4}-\d{2}-\d{2}$/.test(item.date) || item.date<=localDate(now,'Pacific/Kiritimati') || item.date>shiftDate(localDate(now,'UTC'),90))throw new Error('Repair only unreleased future dates in the generation window.');
    const slot=slots.find(row=>row.publication_date===item.date);
    if(!slot || slot.status!=='exhausted' || schedules.some(row=>row.publication_date===item.date))throw new Error('Only unscheduled exhausted dates can be repaired.');
    const stored=plans.find(row=>row.start_date===slot.week_start);
    const prior=stored?.plan.days.find(day=>day.date===item.date);
    if(!prior || stored.plan.version!==VERSION)throw new Error('The source plan must use the current curriculum policy.');
    if(writerRepair) {
      const old=attempts.filter(row=>row.publication_date===item.date && row.generation_epoch===slot.generation_epoch);
      if(old.length!==3 || old.some(row=>row.status!=='rejected' || row.writer_version!==manifest.previousWriterVersion))throw new Error('Writer repair requires three rejected attempts from the named earlier writer; never reset current-policy attempts.');
    }
    if(reviewerRepair) {
      const old=attempts.filter(row=>row.publication_date===item.date && row.generation_epoch===slot.generation_epoch);
      if(old.length!==3 || old.some(row=>row.status!=='rejected' || row.writer_version!==WRITER_VERSION || JSON.stringify(row.review_models)!==JSON.stringify(manifest.previousReviewModels)))throw new Error('Reviewer repair requires three rejected attempts from the named previous model pair; never reset current-pair attempts.');
    }
    if(!Array.isArray(item.sources) || item.sources.length!==3)throw new Error('Precommit exactly three replacement sources.');
    const options=item.sources.map(([reference,angle])=>{
      if(typeof angle!=='string' || angle.length<40)throw new Error('Each replacement source needs a concrete writing angle.');
      const evidence=scriptureEvidence(reference,corpus);
      return {sourceReference:evidence.source.locator,sourceSha256:evidence.sourceSha256,angle};
    });
    if(new Set(options.map(row=>row.sourceReference)).size!==3 || (!writerRepair && !reviewerRepair && options.some(row=>(prior.sourceOptions || [prior]).some(old=>old.sourceSha256===row.sourceSha256))))throw new Error('Replacement sources must be distinct and genuinely new for this slot.');
    if(!changes.has(stored.start_date))changes.set(stored.start_date,{startDate:stored.start_date,before:stored.plan,after:structuredClone(stored.plan)});
    const change=changes.get(stored.start_date),index=change.after.days.findIndex(day=>day.date===item.date);
    change.after.days[index]={...prior,...options[0],sourceOptions:options,devotionalAligned:false};
    audit.changes.push({date:item.date,weekStart:slot.week_start,previousEpoch:slot.generation_epoch,previousAttempts:slot.attempts,previousSources:prior.sourceOptions || [prior],sources:options});
  }
  for(const change of changes.values())change.after.sourceRepairs=[...(change.after.sourceRepairs || []),{...audit,changes:audit.changes.filter(item=>item.weekStart===change.startDate)}];
  return {audit,plans:[...changes.values()]};
}
const literal=value=>"'"+JSON.stringify(value).replaceAll("'","''")+"'::jsonb";
function sourceRepairSql(repair) {
  const actor=repair.audit.actor;
  let sql="begin; set local lock_timeout='3s'; set local statement_timeout='60s';\n";
  sql+=`select discovery_require_admin('${actor}');\n`;
  // Lock acquisition serializes competing repairs; state guards catch a cron
  // that started after the read-only preparation and roll back every change.
  sql+="lock table discovery_generation_runs in share mode;\ndo $repair$ begin if exists(select 1 from discovery_generation_runs where status='running') then raise exception 'A generation worker started during source review'; end if; end $repair$;\n";
  for(const plan of repair.plans)sql+=`do $repair$ begin perform 1 from discovery_week_plans where start_date='${plan.startDate}' and plan=${literal(plan.before)} for update; if not found then raise exception 'Source plan changed during review'; end if; end $repair$;\n`;
  for(const item of repair.audit.changes)sql+=`do $repair$ begin perform 1 from discovery_curriculum_slots where publication_date='${item.date}' and publication_date>(now() at time zone 'Pacific/Kiritimati')::date and publication_date<=(now() at time zone 'UTC')::date+90 and status='exhausted' and generation_epoch=${item.previousEpoch} and attempts=${item.previousAttempts} for update; if not found or exists(select 1 from discovery_schedule where publication_date='${item.date}') then raise exception 'Slot changed during source review'; end if; end $repair$;\n`;
  if(repair.audit.mode==='writer_revision')for(const item of repair.audit.changes)sql+=`do $repair$ begin if (select count(*)=3 and bool_and(status='rejected' and coalesce(verification#>>'{generation,writerVersion}'='${repair.audit.previousWriterVersion}',false)) from discovery_generation_attempts where publication_date='${item.date}' and generation_epoch=${item.previousEpoch}) is distinct from true then raise exception 'Prior writer audit changed during review'; end if; end $repair$;\n`;
  if(repair.audit.mode==='reviewer_revision')for(const item of repair.audit.changes)sql+=`do $repair$ begin if (select count(*)=3 and bool_and(a.status='rejected' and coalesce(a.verification#>>'{generation,writerVersion}'='${repair.audit.writerVersion}',false) and coalesce(r.models->'verifiers'=${literal(repair.audit.previousReviewModels)},false)) from discovery_generation_attempts a join discovery_generation_runs r on r.id=a.run_id where a.publication_date='${item.date}' and a.generation_epoch=${item.previousEpoch}) is distinct from true then raise exception 'Prior reviewer audit changed during review'; end if; end $repair$;\n`;
  for(const plan of repair.plans)sql+=`update discovery_week_plans set plan=${literal(plan.after)} where start_date='${plan.startDate}';\n`;
  for(const item of repair.audit.changes)sql+=`select discovery_curriculum_retry('${item.date}','${actor}');\n`;
  return sql+'commit;\n';
}
module.exports={prepareSourceRepair,sourceRepairSql};
