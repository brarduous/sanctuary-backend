// Explicitly migrate frozen pre-calibration plans; preserve all attempts/epochs.
require('dotenv').config();
const {buildDailySetPlan}=require('../../utils/discoveryDailyPlan');
const {shiftDate}=require('../../utils/discoveries');
const unwrap=r=>{if(r.error)throw r.error;return r.data;};
async function repair({db,from='2026-11-04',apply=false,operator='Codex for Sanctuary owner',now=new Date()}){
 const through=shiftDate(from,6),jobs=unwrap(await db.from('discovery_daily_jobs').select('publication_date,status,plan,lease_until,updated_at').gte('publication_date',from).lte('publication_date',through));
 const results=[];
 for(const job of jobs){
  if(job.status==='published')continue;
  const plan=buildDailySetPlan(job.publication_date);
  if(job.plan.version===plan.version&&job.plan.writerVersion===plan.writerVersion&&job.plan.editorialVersion===plan.editorialVersion)continue;
  if(job.status==='generating'&&job.lease_until&&Date.parse(job.lease_until)>now.getTime()){results.push({date:job.publication_date,status:'active_lease_held'});continue;}
  const entry={date:job.publication_date,previousVersion:job.plan.version,newVersion:plan.version,status:apply?'revised':'planned'};
  if(apply){
   if(job.status!=='exhausted'){
    const changed=unwrap(await db.from('discovery_daily_jobs').update({status:'exhausted',lease_until:null}).eq('publication_date',job.publication_date).eq('updated_at',job.updated_at).eq('status',job.status).select('publication_date'));
    if(changed.length!==1)throw Error('Daily plan changed concurrently; inspect before retrying.');
   }
   const result=unwrap(await db.rpc('discovery_daily_retry',{p_date:job.publication_date,p_plan:plan,p_reason:'Owner requested much easier Easy, Medium and Hard questions for ordinary players starting November 4. Replace the frozen specialist source plan with the general-audience v3 calibration; retain prior rejected attempts.',p_operator:operator}));entry.epoch=result.epoch;
  }
  results.push(entry);
 }
 return {from,through,applied:apply,results};
}
if(require.main===module)repair({db:require('../../config/supabase'),apply:process.argv.includes('--apply')}).then(r=>console.log(JSON.stringify(r))).catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={repair};
