const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{randomUUID}=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite');
const {passes,candidatePatch,runReplacements}=require('../services/contentQualityReplacement');
const grade={id:'prayers-0',helpfulness:85,accuracy:85,audience:85,freshness:85,seriousConcern:false,evidence:['Grounded, useful and audience appropriate.']};
test('85 is an editorial floor, never a probability or an average that hides a factual concern',()=>{
 assert.equal(passes(grade),true);assert.equal(passes({...grade,freshness:84}),false);assert.equal(passes({...grade,accuracy:84,helpfulness:100,audience:100,freshness:100}),false);assert.equal(passes({...grade,seriousConcern:true}),false);assert.equal(passes({...grade,accuracy:null}),false);
 assert.throws(()=>candidatePatch('prayers',{generated_prayer:'New prayer',user_id:'someone-else'},{generated_prayer:'Old'}),/Unexpected/);
 assert.throws(()=>candidatePatch('guidance',{advice_points:'Dropped JSON'},{advice_points:[{title:'One'}]}));
});
test('persistent replacements claim once, preserve original versions, reject low grades/identity changes and stale writes, retry after failures and cascade private data',async()=>{
 const db=await PGlite.create();try{
  await db.exec(`create schema auth;create role anon;create role authenticated;create role service_role bypassrls;create table auth.users(id uuid primary key);create table daily_news_synopses(id bigint primary key,synopsis text);create table bible_studies(study_id integer,user_id uuid);create table daily_prayers(prayer_id integer primary key,user_id uuid,generated_prayer text,status text);`);
  const sql=fs.readFileSync('supabase/migrations/20261102110000_automatic_content_replacement.sql','utf8');await db.exec(sql);await db.exec(sql);
  const user=randomUUID();await db.query('insert into auth.users values($1)',[user]);await db.query("insert into daily_prayers values(1,$1,'Original private prayer','completed')",[user]);
  const snapshot=(await db.query('select to_jsonb(t) as row from daily_prayers t')).rows[0].row;
  const enqueue=async()=> (await db.query('select content_quality_enqueue($1,$2,$3,$4,$5) as id',['prayers','1',snapshot,{...grade,helpfulness:70},{}])).rows[0].id;
  const id=await enqueue();assert.equal(await enqueue(),id);const token=randomUUID();
  const job=(await db.query('select content_quality_claim($1) as job',[token])).rows[0].job;assert.equal(job.attempts,1);assert.equal((await db.query('select content_quality_claim($1) as job',[randomUUID()])).rows[0].job,null);
  const finish=(action,patch,g=grade,t=token)=>db.query('select content_quality_finish($1,$2,$3,$4,$5,$6) as result',[id,t,action,patch,g,{writerResponseId:'writer',reviewerResponseId:'judge'}]);
  await assert.rejects(finish('replaced',{generated_prayer:'New'},{...grade,seriousConcern:true}),/85.point/);
  await assert.rejects(finish('replaced',{user_id:randomUUID()}),/unsupported fields/);
  await assert.rejects(finish('replaced',{generated_prayer:'New'},grade,randomUUID()),/lease/);
  await finish('retry_wait',{generated_prayer:'Rejected candidate'},{...grade,accuracy:70});assert.equal((await db.query('select generated_prayer from daily_prayers')).rows[0].generated_prayer,'Original private prayer');
  assert.equal((await db.query('select content_quality_claim($1) as job',[randomUUID()])).rows[0].job,null,'backoff prevents hot retry loops');
  await db.exec("update content_quality_replacements set next_attempt_at=now()-interval '1 second'");const token2=randomUUID();await db.query('select content_quality_claim($1)',[token2]);
  await finish('replaced',{generated_prayer:'Verified fresh prayer'},grade,token2);assert.equal((await db.query('select generated_prayer from daily_prayers')).rows[0].generated_prayer,'Verified fresh prayer');
  const saved=(await db.query('select * from content_quality_replacements')).rows[0];assert.equal(saved.snapshot.generated_prayer,'Original private prayer');assert.equal(saved.history.length,2);assert.equal(saved.status,'replaced');
  for(const role of ['anon','authenticated']){await db.exec('set role '+role);await assert.rejects(db.exec('select * from content_quality_replacements'),/permission denied/);await assert.rejects(db.query('select content_quality_claim($1)',[randomUUID()]),/permission denied/);await db.exec('reset role');}
  await db.query("insert into daily_prayers values(2,$1,'Second prayer','completed')",[user]);
  const second=(await db.query('select to_jsonb(t) as row from daily_prayers t where prayer_id=2')).rows[0].row;
  const id2=(await db.query('select content_quality_enqueue($1,$2,$3,$4,$5) as id',['prayers','2',second,{...grade,accuracy:60},{}])).rows[0].id;
  const token3=randomUUID();await db.query('select content_quality_claim($1)',[token3]);
  await db.exec("update daily_prayers set generated_prayer='Newer owner edit' where prayer_id=2");
  const stale=(await db.query('select content_quality_finish($1,$2,$3,$4,$5,$6) as result',[id2,token3,'replaced',{generated_prayer:'Must not overwrite'},grade,{}])).rows[0].result;
  assert.equal(stale.status,'obsolete');assert.equal((await db.query('select generated_prayer from daily_prayers where prayer_id=2')).rows[0].generated_prayer,'Newer owner edit');
  await db.query('delete from auth.users where id=$1',[user]);assert.equal((await db.query('select * from content_quality_replacements')).rows.length,0);
 }finally{await db.close();}
});
test('worker runs a separate assessment, replaces only passing candidates, and retains retryable failures without a manual approval state',async()=>{
 const job={id:1,kind:'prayers',attempts:1,initial_grade:{...grade,helpfulness:60},snapshot:{prayer_id:1,generated_prayer:'Old prayer',status:'completed'},context:{config:{key:'prayers',id:'prayer_id',fields:'prayer_id,generated_prayer',rubric:'Prayer rubric'}},history:[]};let claimed=false,calls=0,finished;
 const db={rpc:async(name,args)=>{if(name==='content_quality_claim'){if(claimed)return{data:null};claimed=true;return{data:job};}finished=args;return{data:{id:1,status:args.p_action}};}};
 const client={chat:{completions:{create:async request=>{calls++;return{id:'response-'+calls,model:request.model,choices:[{finish_reason:'stop',message:{content:JSON.stringify(calls===1?{generated_prayer:'Lord, help me offer practical kindness to one neighbor today.'}:{reviews:[grade]})}}]};}}}};
 const result=await runReplacements({db,client,scanPending:false});assert.equal(calls,2);assert.equal(result.replaced,1);assert.equal(finished.p_action,'replaced');assert.equal(finished.p_evidence.writerResponseId,'response-1');assert.equal(finished.p_evidence.reviewerResponseId,'response-2');
 claimed=false;const failed=await runReplacements({db,scanPending:false,client:{chat:{completions:{create:async()=>{throw Error('Provider down');}}}}});assert.equal(failed.retrying,1);assert.equal(finished.p_action,'retry_wait');
});
