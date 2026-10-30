// Live, non-production integration check. Accounts/passwords/tokens are temporary
// and are never printed. No push provider is called; reminder checks are dry-run.
const fs=require('node:fs');
const {randomUUID,randomBytes}=require('node:crypto');
const assert=require('node:assert/strict');
const {createClient}=require('@supabase/supabase-js');
const {localParts}=require('../../utils/notificationCalendarRules');
async function main(args=process.argv.slice(2)) {
 const project=new URL(process.env.SUPABASE_URL || '').hostname.split('.')[0];
 const base=process.env.DISCOVERY_QA_API_URL || 'http://127.0.0.1:4013';
 const target=new URL(base),output=args.find(arg=>!arg.startsWith('--'));
 if(project==='cmakuvkjxknwhonfqbit' || process.env.NODE_ENV==='production' || !project || !output)throw new Error('Use an explicit non-production Supabase project, QA API origin and output audit.');
 if(target.protocol!=='https:' && !(target.protocol==='http:' && ['127.0.0.1','localhost'].includes(target.hostname)))throw new Error('QA API must use HTTPS or loopback.');
 if(fs.existsSync(output))throw new Error('Use a new audit path.');
 if(!args.includes('--apply')){console.log(JSON.stringify({project,api:target.origin,mutations:false,requires:'--apply to create and clean up two disposable staging accounts'}));return;}
 const db=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
 const created=[],audit={startedAt:new Date().toISOString(),project,api:target.origin,method:'Real hosted auth, backend HTTP and private database checks using disposable staging accounts. No production users or live push delivery.',checks:[],cleanup:[]};
 const unwrap=result=>{if(result.error)throw result.error;return result.data;};
 const check=(name,condition)=>{assert.ok(condition,name);audit.checks.push(name);};
 const request=async(path,{token,body,method='GET'}={})=>{
  const response=await fetch(base+path,{method,headers:{'content-type':'application/json',...(token ? {authorization:`Bearer ${token}`}:{})},...(body ? {body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});
  return {status:response.status,body:await response.json()};
 };
 try {
  const today=localParts(new Date(),'America/New_York').date;
  const bundle=await request('/api/v1/discoveries/bundle?timeZone=America%2FNew_York');
  check('Hosted staging bundle is enabled',bundle.status===200 && bundle.body.enabled===true);
  const item=bundle.body.items.find(item=>item.publicationDate===today);
  check('A real automated question is scheduled for the test date',Boolean(item));
  const profiles=[];
  for(let index=0;index<2;index++) {
   const email=`discovery-qa-${randomUUID()}@example.invalid`,password=`Qa-${randomBytes(24).toString('hex')}!1`;
   const user=unwrap(await db.auth.admin.createUser({email,password,email_confirm:true})).user;
   created.push(user.id);
   unwrap(await db.from('user_profiles').upsert({user_id:user.id,first_name:'Discovery',last_name:'QA',user_preferences:{onboardingCompleted:true,notifications:{trivia:false}}},{onConflict:'user_id'}));
   const client=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_ANON_KEY,{auth:{persistSession:false}});
   const session=unwrap(await client.auth.signInWithPassword({email,password})).session;
   profiles.push({id:user.id,token:session.access_token,client});
  }
  const [a,b]=profiles;
  const event={eventId:randomUUID(),discoveryId:item.id,revision:item.revision,mode:'answered',optionId:item.correctOptionId,occurredAt:new Date().toISOString(),localDate:today,timeZone:'America/New_York',elapsedMs:3500,outcome:'incorrect'};
  const completed=await request('/api/v1/discoveries/completions',{token:a.token,method:'POST',body:{userId:b.id,events:[event]}});
  check('Real JWT completion succeeds',completed.status===200);
  const canonical=completed.body.results[0].completion;
  check('Server derives the outcome and authenticated owner',canonical.user_id===a.id && canonical.outcome==='correct' && canonical.elapsed_ms===3500);
  const repeated=await request('/api/v1/discoveries/completions',{token:a.token,method:'POST',body:{events:[{...event,eventId:randomUUID(),mode:'revealed',optionId:null}]}});
  check('First accepted event remains canonical',repeated.body.results[0].completion.event_id===event.eventId);
  const other=await request('/api/v1/discoveries/progress?userId='+a.id,{token:b.token});
  check('A second authenticated account cannot read the first account progress',other.status===200 && other.body.total===0);
  const denied=await a.client.from('discovery_completions').select('user_id');
  check('Authenticated direct table access remains denied',Boolean(denied.error));
  const preferences=unwrap(await db.from('user_profiles').select('user_preferences').eq('user_id',b.id).single());
  check('Trivia is not opted in by default',preferences.user_preferences.notifications.trivia===false);
  for(const profile of profiles) {
   const token=`ExpoPushToken[DiscoveryQa_${randomUUID().replaceAll('-','_')}]`;
   const capability=await request('/api/notifications/capabilities',{token:profile.token,method:'POST',body:{expoPushToken:token,features:['discoveries'],appVersion:'1.2.11-qa'}});
   check('Authenticated native capability registered for a disposable account',capability.status===200);
   const zone=await request('/api/notifications/timezone',{token:profile.token,method:'POST',body:{timeZone:'America/New_York'}});
   check('Recipient timezone registered through the real API',zone.status===200);
   unwrap(await db.from('user_profiles').update({user_preferences:{onboardingCompleted:true,notifications:{trivia:true}}}).eq('user_id',profile.id));
  }
  const {dispatchCalendar}=require('../../services/notificationCalendar');
  const before=await db.from('notification_deliveries').select('id',{count:'exact',head:true}).eq('category','discovery');
  if(before.error)throw before.error;
  const start=Date.parse(today+'T00:00:00Z');
  const now=Array.from({length:48},(_,h)=>new Date(start+h*3600000)).find(date=>{const local=localParts(date,'America/New_York');return local.date===today && local.minutes===18*60;});
  const dry=await dispatchCalendar({now,category:'discovery',dryRun:true,rolloutStage:'100'});
  const result=dry.results[0];
  check('Dry run skips the completed account',result.alreadyPlayed>=1);
  check('Dry run selects the opted-in, supported, unplayed account',result.eligible>=1);
  check('Dry run sends no notifications',result.attempted===0 && result.accepted===0 && result.failed===0);
  const after=await db.from('notification_deliveries').select('id',{count:'exact',head:true}).eq('category','discovery');
  if(after.error)throw after.error;
  check('No delivery row is created by dry run',before.count===after.count);
  audit.reminderDryRun=result;audit.passed=true;
 } catch(error) {audit.passed=false;audit.error=error.message;throw error;}
 finally {
  for(const id of created){
   // The legacy profile foreign key is not ON DELETE CASCADE. Remove only the
   // profile this runner created, then delete its disposable auth account.
   const profile=await db.from('user_profiles').delete().eq('user_id',id);
   const result=profile.error ? profile:await db.auth.admin.deleteUser(id);
   audit.cleanup.push({accountId:id,deleted:!result.error,...(result.error ? {error:result.error.message}: {})});
   if(result.error)audit.passed=false;
  }
  if(created.length && audit.cleanup.every(row=>row.deleted)) {
   const remaining=await db.from('discovery_completions').select('user_id',{count:'exact',head:true}).in('user_id',created);
   audit.completionsRemainingAfterCleanup=remaining.count;
   if(remaining.error || remaining.count!==0)audit.passed=false;
  }
  audit.completedAt=new Date().toISOString();
  fs.writeFileSync(output,JSON.stringify(audit,null,2)+'\n',{mode:0o600});
  console.log(JSON.stringify({project,passed:audit.passed,checks:audit.checks.length,accountsCleaned:audit.cleanup.filter(row=>row.deleted).length,output}));
  if(!audit.passed)process.exitCode=1;
 }
 return audit;
}
if(require.main===module)main().catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={main};
