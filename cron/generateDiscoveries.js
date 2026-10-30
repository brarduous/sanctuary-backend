require('dotenv').config();
const {configFromEnv,curriculumStatus}=require('../utils/discoveryCurriculum');
async function getDiscoveryCurriculumStatus() {
  const config=configFromEnv();
  const db=require('../config/supabase');
  const legacy=await curriculumStatus(db,{runwayDays:config.runwayDays}),dailySets=await require('../utils/discoveryDailySets').dailySetStatus(db);
  return {healthy:dailySets.missingDates.length===0 && dailySets.exhaustedDates.length===0,dailySets,legacy};
}
async function generateDiscoveries() {
  const config=configFromEnv();
  // Provision the cron before migrations without touching an older database.
  if(!config.enabled)return {generated:false,reason:'disabled'};
  const {createDiscoveryModels}=require('../utils/discoveryModels');
  const db=require('../config/supabase'),models=createDiscoveryModels(config);
  const dailySets=await require('../utils/discoveryDailySets').ensureDailySets({db,models,config});
  return {generated:dailySets.published>0,dailySets,status:dailySets.status};
}
if(require.main===module) {
  const statusOnly=process.argv.includes('--status');
  (statusOnly ? getDiscoveryCurriculumStatus():generateDiscoveries()).then(result=>{
    console.log('[Daily Discovery]',JSON.stringify(result));
    if(result.status?.exhaustedDates?.length || result.status?.missingDates?.length || (statusOnly && !result.healthy))process.exitCode=1;
  }).catch(error=>{console.error('[Daily Discovery] Job failed:',error.message);process.exitCode=1;});
}
module.exports={getDiscoveryCurriculumStatus,generateDiscoveries};
