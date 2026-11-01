require('dotenv').config();
const {reconcilePendingNews}=require('../services/newsPublication');
async function main(){
 const apply=process.argv.includes('--apply');
 const db=require('../config/supabase');
 const result=await reconcilePendingNews(db,{apply});
 console.log(JSON.stringify(result,null,2));
 if(result.failed.length)process.exitCode=1;
}
if(require.main===module)main().catch(error=>{console.error(error.message);process.exitCode=1;});
