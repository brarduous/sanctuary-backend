require('dotenv').config();
const {runQualityJob}=require('../services/appQuality');
if(require.main===module)runQualityJob({kind:process.argv.includes('--content')?'content':'operations'})
 .then(({key,report,skipped})=>{console.log(JSON.stringify({key,skipped,releaseGate:report?.releaseGate,areas:report?.areas,content:report?.content?Object.fromEntries(Object.entries(report.content).map(([name,value])=>[name,{status:value.status,averages:value.averages,sampleCount:value.sampleCount,seriousConcernCount:value.seriousConcernCount}])):undefined}));if(report?.releaseGate==='needs_attention')process.exitCode=1;})
 .catch(error=>{console.error('[App Quality]',error.message);process.exitCode=1;});
