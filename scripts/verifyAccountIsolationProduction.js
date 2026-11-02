// Creates disposable accounts and private records, checks actual HTTP access,
// then removes only the fixtures it created. Never reads another real user.
require('dotenv').config();
const {randomUUID,randomBytes}=require('node:crypto');
const {execFileSync}=require('node:child_process');
const {createClient}=require('@supabase/supabase-js');
async function verify(){
 if(process.env.QA_CONFIRM_PRODUCTION!=='account-isolation')throw Error('Set QA_CONFIRM_PRODUCTION=account-isolation for this disposable-fixture verification.');
 const url=process.env.SUPABASE_URL,base=process.env.QUALITY_API_BASE_URL || 'https://api.sanctuaryapp.us';
 if(new URL(url).hostname!=='cmakuvkjxknwhonfqbit.supabase.co'||!['api.sanctuaryapp.us','sanctuary-backend-qts0.onrender.com'].includes(new URL(base).hostname))throw Error('Unexpected production target.');
 const db=createClient(url,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
 const users=[],records=[],checks=[],started=new Date().toISOString();let failure,cleanupFailed=false;
 const commit=process.env.QUALITY_RELEASE_COMMIT || execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
 const unwrap=r=>{if(r.error)throw r.error;return r.data;};
 const check=(name,ok)=>{checks.push({name,passed:Boolean(ok)});if(!ok)throw Error(`Production verification failed: ${name}`);};
 const call=async(path,token,method='GET',body)=>{const r=await fetch(base+path,{method,signal:AbortSignal.timeout(15000),headers:{...(token?{Authorization:`Bearer ${token}`}:{ }),'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return{status:r.status,body:r.status===204?null:await r.json()};};
 try{
  for(const label of ['a','b']){
   const email=`qa-quality-${label}-${randomUUID()}@example.invalid`,password=randomBytes(24).toString('base64url')+'aA1!';
   const data=unwrap(await db.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{quality_test:true}}));users.push({id:data.user.id});
   const client=createClient(url,process.env.SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
   users.at(-1).client=client;
   users.at(-1).token=unwrap(await client.auth.signInWithPassword({email,password})).session.access_token;
   unwrap(await db.from('user_profiles').upsert({user_id:data.user.id,role:'authenticated',subscription_tier:'free'}));
   const record=unwrap(await db.from('daily_devotionals').insert({user_id:data.user.id,title:'Disposable ownership check',content:'Synthetic quality-verification fixture. Not reader content.',status:'completed'}).select('devotional_id').single());records.push(record.devotional_id);
  }
  const [a,b]=users;
  const anonymous=createClient(url,process.env.SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  const ownRaw=await a.client.from('daily_devotionals').select('devotional_id').eq('devotional_id',records[0]);
  check('direct_owner_read_allowed',!ownRaw.error&&ownRaw.data.length===1);
  const foreignRaw=await a.client.from('daily_devotionals').select('devotional_id').eq('devotional_id',records[1]);
  check('direct_other_account_read_hidden',!foreignRaw.error&&foreignRaw.data.length===0);
  for(const table of ['daily_devotionals','daily_prayers','advice_guidance','content_feedback','user_activities','sermons','sermon_series','user_profiles']){
   const result=await anonymous.from(table).select('user_id').eq('user_id',a.id).limit(1);
   check(`anonymous_${table}_hidden`,Boolean(result.error)||result.data.length===0);
  }
  const reassigned=await a.client.from('daily_devotionals').update({user_id:b.id}).eq('devotional_id',records[0]);
  check('direct_owner_reassignment_denied',Boolean(reassigned.error));
  const role=await a.client.from('user_profiles').update({role:'admin'}).eq('user_id',a.id);
  check('direct_profile_privilege_change_denied',Boolean(role.error));
  const tier=await a.client.from('user_profiles').update({subscription_tier:'pro'}).eq('user_id',a.id);
  check('direct_profile_entitlement_change_denied',Boolean(tier.error));
  const profile=await a.client.from('user_profiles').update({first_name:'Disposable QA'}).eq('user_id',a.id).select('user_id');
  check('direct_profile_display_update_allowed',!profile.error&&profile.data.length===1);

  check('anonymous_private_library_denied',(await call(`/api/v1/devotionals/${a.id}`)).status===401);
  check('owner_can_read_private_record',(await call(`/api/v1/devotional/${a.id}/${records[0]}`,a.token)).status===200);
  check('other_account_library_denied',(await call(`/api/v1/devotionals/${b.id}`,a.token)).status===403);
  check('other_account_detail_denied',(await call(`/api/v1/devotional/${b.id}/${records[1]}`,a.token)).status===403);
  check('record_id_cannot_bypass_owner_scope',(await call(`/api/v1/devotional/${a.id}/${records[1]}`,a.token)).status===404);
  await call(`/api/v1/devotional/${records[1]}`,a.token,'DELETE');
  check('foreign_delete_preserves_record',(await call(`/api/v1/devotional/${b.id}/${records[1]}`,b.token)).status===200);
  check('forged_preferences_denied',(await call(`/api/v1/user-followed-topics/${b.id}`,a.token,'POST',{topicIds:[]})).status===403);
  check('forged_checkout_denied_without_payment',(await call('/api/v1/create-checkout-session',a.token,'POST',{userId:b.id})).status===403);
  check('nonmember_prayer_feed_denied',(await call('/api/v1/feed?congregationId=1',a.token)).status===403);
  check('feedback_for_other_private_content_denied',(await call(`/api/v1/content-feedback/devotional/${records[1]}`,a.token,'PUT',{rating:5})).status===404);
  check('reader_response_can_be_saved',(await call(`/api/v1/content-feedback/devotional/${records[0]}`,a.token,'PUT',{rating:5,channel:'unknown'})).status===200);
  check('saved_reader_response_is_readable',(await call(`/api/v1/content-feedback/devotional/${records[0]}`,a.token)).body?.feedback?.rating===5);
  check('reader_response_can_be_removed',(await call(`/api/v1/content-feedback/devotional/${records[0]}`,a.token,'DELETE')).status===204);
  check('nonadmin_quality_reports_denied',(await call('/admin/quality',a.token)).status===403);
 }catch(error){failure=error;}
 finally{
  for(const user of users){
   for(const remove of [...['reader_content_feedback','system_logs','user_activities','users'].map(table=>()=>db.from(table).delete().eq('user_id',user.id)),()=>db.from('daily_devotionals').delete().eq('user_id',user.id).in('devotional_id',records),()=>db.from('user_profiles').delete().eq('user_id',user.id),()=>db.auth.admin.deleteUser(user.id)]){
    try{unwrap(await remove());}catch(error){cleanupFailed=true;failure ||= Error('Disposable account cleanup failed; inspect the private verification process.');console.error('Fixture cleanup requires attention:',error.code || 'unknown');}
   }
  }
 }
 const report={version:'account-isolation-v1',scope:'Disposable production accounts: direct database owner boundaries, anonymous isolation, profile privilege protection; private devotional reads/deletes, preferences, checkout impersonation, nonmember prayer access, reader feedback and admin report access.',checks,fixturesRemoved:!cleanupFailed,limitations:['Two-church membership and role combinations are covered by isolated HTTP integration tests, not this hosted probe.','This is not a complete application security certification.']};
 const saved=await db.from('app_quality_reports').upsert({run_key:`release:${commit}`,kind:'release',status:failure?'failed':'completed',started_at:started,completed_at:new Date().toISOString(),source_commit:commit,report},{onConflict:'run_key'});if(saved.error)throw saved.error;
 if(failure)throw failure;
 console.log(JSON.stringify({passed:checks.length,fixturesRemoved:true,commit}));
 return report;
}
if(require.main===module)verify().catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={verify};
