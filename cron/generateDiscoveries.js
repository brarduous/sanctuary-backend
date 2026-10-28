require('dotenv').config();
const {configFromEnv,curriculumStatus,ensureDiscoveryRunway}=require('../utils/discoveryCurriculum');
async function getDiscoveryCurriculumStatus() {
  const config=configFromEnv();
  return curriculumStatus(require('../config/supabase'),{runwayDays:config.runwayDays});
}
async function generateDiscoveries() {
  const config=configFromEnv();
  // Provision the cron before migrations without touching an older database.
  if(!config.enabled)return {generated:false,reason:'disabled'};
  const {createDiscoveryModels}=require('../utils/discoveryModels');
  return ensureDiscoveryRunway({db:require('../config/supabase'),models:createDiscoveryModels(config),config});
}
if(require.main===module) {
  const statusOnly=process.argv.includes('--status');
  (statusOnly ? getDiscoveryCurriculumStatus():generateDiscoveries()).then(result=>{
    console.log('[Daily Discovery]',JSON.stringify(result));
    if(result.status?.exhaustedDates?.length || (statusOnly && !result.healthy))process.exitCode=1;
  }).catch(error=>{console.error('[Daily Discovery] Job failed:',error.message);process.exitCode=1;});
}
module.exports={getDiscoveryCurriculumStatus,generateDiscoveries};
