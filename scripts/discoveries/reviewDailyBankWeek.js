// Read-only model evaluation; no database access, publication or notifications.
const fs=require('node:fs');
const {isDeepStrictEqual}=require('node:util');
const {createDiscoveryModels}=require('../../utils/discoveryModels');
const {configFromEnv}=require('../../utils/discoveryCurriculum');
const {shiftDate}=require('../../utils/discoveries');
const {sha}=require('../../utils/discoveryScripture');
function contextFor(sets,date){return sets.filter(s=>s.date!==date && s.date>=shiftDate(date,-6) && s.date<=shiftDate(date,6)).sort((a,b)=>a.date.localeCompare(b.date)).flatMap(s=>s.items.map((content,i)=>({date:s.date,position:i+1,content})));}
async function evaluate({bank,output,models=createDiscoveryModels({...configFromEnv(),timeoutMs:120000})}){
 if(!output || fs.existsSync(output))throw new Error('Use a new audit path; preserve previous approvals and rejections.');
 const report={version:'trivia-bank-week-review-v1',startedAt:new Date().toISOString(),inputSha256:sha(bank),noProductionWrites:true,totalTokens:0,sets:[]};
 const save=()=>fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n',{mode:0o600});save();
 const published=[];
 for(const set of [...bank.sets].sort((a,b)=>a.date.localeCompare(b.date))){
  const weekContext=contextFor(published,set.date);
  const reviews=await models.reviewSet(set.items,{weekContext});
  report.totalTokens+=reviews.reduce((sum,r)=>sum+(r.usage?.totalTokens || 0),0);
  const approved=reviews.length===2 && reviews.every(r=>r.approved && !r.issues.length && isDeepStrictEqual(r.weekContext,weekContext));
  report.sets.push({date:set.date,approved,reviews});save();
  console.log(JSON.stringify({date:set.date,approved,issues:reviews.flatMap(r=>r.issues)}));
  if(!approved){report.stoppedOnRejection=true;save();return report;}
  published.push(set);
 }
 report.completedAt=new Date().toISOString();report.approved=report.sets.length===bank.sets.length;save();return report;
}
if(require.main===module){const [input,output]=process.argv.slice(2);evaluate({bank:JSON.parse(fs.readFileSync(input,'utf8')),output}).catch(e=>{console.error(e.message);process.exitCode=1;});}
module.exports={evaluate,contextFor};
