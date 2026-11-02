require('dotenv').config();
if(require.main===module){
 const db=require('../config/supabase');
 require('../services/contentQualityReplacement').runReplacements({db,limit:3}).then(summary=>console.log(JSON.stringify(summary))).catch(()=>{console.error('Automatic content replacement will retry on the next scheduled run.');process.exitCode=1;});
}
