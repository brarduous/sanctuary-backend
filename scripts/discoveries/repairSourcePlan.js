const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const {prepareSourceRepair,sourceRepairSql}=require('../../utils/discoverySourceRepair');
function main(args=process.argv.slice(2)) {
  const arg=name=>{const index=args.indexOf(name);return index<0 ? undefined:args[index+1];};
  const project=arg('--project-ref'),actor=arg('--actor'),manifestPath=arg('--manifest'),output=arg('--output');
  if(!/^[a-z]{20}$/.test(project || '') || !manifestPath || !output)throw new Error('Provide --project-ref, --actor, --manifest and a new --output audit path.');
  if(fs.existsSync(output))throw new Error('Use a new audit path; never overwrite a previous repair.');
  const manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'sanctuary-source-repair-'));
  const query=sql=>{
    const file=path.join(temp,'query.sql');fs.writeFileSync(file,sql,{mode:0o600});
    const child=spawnSync(process.env.SUPABASE_BIN || 'supabase',['db','query','--linked','--project-ref',project,'--file',file,'--output','json'],{encoding:'utf8',maxBuffer:20*1024*1024});
    if(child.error?.code==='ENOENT')throw new Error('Supabase CLI was not found. Set SUPABASE_BIN to the installed CLI path.');
    if(child.status!==0)throw new Error('Source repair database command failed. Inspect the local CLI session; no credentials are logged.');
    return JSON.parse(child.stdout);
  };
  try {
    const snapshot=query(`select jsonb_build_object(
      'plans',(select coalesce(jsonb_agg(t),'[]') from discovery_week_plans t),
      'slots',(select coalesce(jsonb_agg(t),'[]') from discovery_curriculum_slots t),
      'schedules',(select coalesce(jsonb_agg(t),'[]') from discovery_schedule t),
      'runs',(select coalesce(jsonb_agg(t),'[]') from (select id,status from discovery_generation_runs) t),
      'attempts',(select coalesce(jsonb_agg(t),'[]') from (select a.publication_date,a.generation_epoch,a.attempt,a.status,a.verification#>>'{generation,writerVersion}' as writer_version,r.models->'verifiers' as review_models from discovery_generation_attempts a join discovery_generation_runs r on r.id=a.run_id) t)
    ) as snapshot;`).rows[0].snapshot;
    const repair=prepareSourceRepair({...snapshot,manifest,actor});
    const record={project,applied:false,...repair};
    fs.writeFileSync(output,JSON.stringify(record,null,2)+'\n',{mode:0o600});
    if(args.includes('--apply')) {
      query(sourceRepairSql(repair));record.applied=true;record.appliedAt=new Date().toISOString();
      fs.writeFileSync(output,JSON.stringify(record,null,2)+'\n',{mode:0o600});
    }
    console.log(JSON.stringify({project,applied:record.applied,auditId:repair.audit.id,dates:repair.audit.changes.map(row=>row.date),output}));
    return record;
  } finally {fs.rmSync(temp,{recursive:true,force:true});}
}
if(require.main===module)main();
module.exports={main};
