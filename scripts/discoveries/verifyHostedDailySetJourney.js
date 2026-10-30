// Explicit staging-only QA with disposable accounts. Never sends notifications.
const fs=require('node:fs'),assert=require('node:assert/strict');
const {randomUUID,randomBytes}=require('node:crypto');
const {createClient}=require('@supabase/supabase-js');
async function main(){
 const url=process.env.SUPABASE_URL,base=process.env.DISCOVERY_QA_API_URL,output=process.argv[2];
 if(!url || !base || !output || fs.existsSync(output) || new URL(url).hostname==='cmakuvkjxknwhonfqbit.supabase.co' || process.env.NODE_ENV==='production')throw Error('Explicit non-production configuration and fresh audit path required.');
 const db=createClient(url,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}}),created=[];
 const audit={project:new URL(url).hostname,startedAt:new Date().toISOString(),checks:[],cleanup:[]};
 const check=(name,ok)=>{assert.ok(ok,name);audit.checks.push(name);},unwrap=r=>{if(r.error)throw r.error;return r.data;};
 const request=async(path,token,body)=>{const r=await fetch(base+path,{method:body?'POST':'GET',headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json()};};
 try{
  const bundle=await request('/api/v1/discoveries/bundle?dailySet=1&timeZone=America%2FNew_York');
  check('Three hosted questions in fixed order',bundle.status===200 && JSON.stringify(bundle.data.items.map(i=>i.setPosition))==='[1,2,3]');
  const users=[];
  for(let i=0;i<2;i++){
   const email='trivia-three-qa-'+randomUUID()+'@example.invalid',password='Qa!'+randomBytes(24).toString('hex');
   const user=unwrap(await db.auth.admin.createUser({email,password,email_confirm:true})).user;created.push(user.id);
   unwrap(await db.from('user_profiles').upsert({user_id:user.id,first_name:'Trivia',last_name:'QA',user_preferences:{onboardingCompleted:true,notifications:{trivia:false}}}));
   const client=createClient(url,process.env.SUPABASE_ANON_KEY,{auth:{persistSession:false}}),session=unwrap(await client.auth.signInWithPassword({email,password})).session;users.push({id:user.id,client,token:session.access_token});
  }
  const [a,b]=users,date=bundle.data.items[0].publicationDate;
  const events=bundle.data.items.map((item,i)=>({eventId:randomUUID(),discoveryId:item.id,revision:item.revision,mode:i===2?'revealed':'answered',optionId:i===2?null:i===0?item.correctOptionId:item.choices.find(c=>c.id!==item.correctOptionId).id,occurredAt:new Date().toISOString(),localDate:date,timeZone:'America/New_York',elapsedMs:3000}));
  const complete=await request('/api/v1/discoveries/completions',a.token,{userId:b.id,events});
  check('Server derives three outcomes and positions',complete.status===200 && JSON.stringify(complete.data.results.map(r=>r.completion.outcome))==='["correct","incorrect","revealed"]' && JSON.stringify(complete.data.results.map(r=>r.completion.set_position))==='[1,2,3]');
  check('Authenticated owner is canonical',complete.data.results.every(r=>r.completion.user_id===a.id && r.completion.puzzle_date===date));
  const repeat=await request('/api/v1/discoveries/completions',a.token,{events:events.map(e=>({...e,eventId:randomUUID(),mode:'revealed',optionId:null}))});
  check('First accepted results survive retries',repeat.data.results.every((r,i)=>r.completion.event_id===events[i].eventId));
  const other=await request('/api/v1/discoveries/progress?userId='+a.id,b.token);check('Second JWT cannot read another player',other.status===200 && other.data.total===0);
  check('Direct table reads denied',!!(await a.client.from('discovery_completions').select('user_id')).error);
  check('Weekly context RPC denied to client',!!(await a.client.rpc('discovery_daily_week_context',{p_date:date})).error);
  const admin=await request('/admin/discoveries/daily-sets',a.token);check('Ordinary member cannot inspect generation audits',admin.status===403);
  audit.passed=true;
 }catch(e){audit.error=e.message;audit.passed=false;throw e;}
 finally{
  for(const id of created){const p=await db.from('user_profiles').delete().eq('user_id',id),r=p.error?p:await db.auth.admin.deleteUser(id);audit.cleanup.push({id,deleted:!r.error});if(r.error)audit.passed=false;}
  audit.completedAt=new Date().toISOString();fs.writeFileSync(output,JSON.stringify(audit,null,2)+'\n',{mode:0o600});console.log(JSON.stringify({passed:audit.passed,checks:audit.checks.length,cleaned:audit.cleanup.filter(r=>r.deleted).length}));
 }
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
