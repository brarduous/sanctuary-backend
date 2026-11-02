const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const {A,B}=require('./helpers/accountHarness');
test('direct-client private content is owner-only, blocks reassignment and forged inserts, and rolls back closed',async()=>{
 const db=await PGlite.create();try{
  await db.exec(`create schema auth;create role anon;create role authenticated;create role service_role bypassrls;grant usage on schema public,auth to anon,authenticated,service_role;create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant execute on function auth.uid() to anon,authenticated,service_role;`);
  const tables=['daily_devotionals','daily_prayers','advice_guidance','content_feedback','user_activities','sermons','sermon_series'];
  for(const table of tables){await db.exec(`create table ${table}(id integer primary key,user_id uuid,content text);grant all on ${table} to anon,authenticated,service_role;`);await db.query(`insert into ${table} values(1,$1,'A'),(2,$2,'B')`,[A,B]);}
  await db.exec(`create table user_profiles(user_id uuid primary key,first_name text,role text default 'user',tier text default 'free',subscription_tier text default 'free');grant all on user_profiles to anon,authenticated,service_role;create table system_logs(id int);create table prompt_evaluations(id int);grant all on system_logs,prompt_evaluations to anon,authenticated,service_role;create table bible_studies(study_id int primary key,user_id uuid,is_published boolean);alter table bible_studies enable row level security;grant select on bible_studies to authenticated;create policy study_read on bible_studies for select to authenticated using(user_id=auth.uid() or is_published);create table bible_study_lessons(lesson_id int primary key,study_id int,user_id uuid,content text);grant all on bible_study_lessons to anon,authenticated,service_role;`);
  await db.query("insert into user_profiles(user_id,first_name) values($1,'A'),($2,'B');",[A,B]);
  await db.query('insert into bible_studies values(1,$1,false),(2,$2,false),(3,$2,true)',[A,B]);
  await db.query("insert into bible_study_lessons values(1,1,$1,'Own'),(2,2,$2,'Other private'),(3,3,$2,'Published')",[A,B]);
  await db.exec('alter table daily_devotionals enable row level security;create policy legacy on daily_devotionals for all using(auth.uid()=user_id) with check(true);');
  const migration=fs.readFileSync('supabase/migrations/20261101190000_private_content_owner_boundaries.sql','utf8');await db.exec(migration);await db.exec(migration);
  await db.query("update user_profiles set subscription_tier='pro' where user_id=$1",[A]);
  await db.exec('set role authenticated');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[A]);
  for(const table of tables){
   assert.deepEqual((await db.query(`select content from ${table}`)).rows.map(row=>row.content),['A']);
   await assert.rejects(db.query(`insert into ${table} values(3,$1,'forged')`,[B]),/row.level security/i);
   await assert.rejects(db.query(`update ${table} set user_id=$1 where id=1`,[B]),/row.level security/i);
   assert.equal((await db.query(`delete from ${table} where id=2 returning id`)).rows.length,0);
   assert.equal((await db.query(`update ${table} set content='Owned update' where id=1 returning id`)).rows.length,1);
  }
  assert.equal((await db.query('select * from user_profiles')).rows.length,1);
  await db.exec("update user_profiles set first_name='Changed' where first_name='A'");
  await assert.rejects(db.exec("update user_profiles set role='admin'"),/server.managed/);
  await assert.rejects(db.exec("update user_profiles set subscription_tier='free'"),/server.managed/);
  await db.query("insert into user_profiles(user_id,first_name) values($1,'Upserted') on conflict(user_id) do update set first_name=excluded.first_name,subscription_tier=excluded.subscription_tier",[A]);
  assert.equal((await db.query('select subscription_tier from user_profiles')).rows[0].subscription_tier,'pro');
  assert.deepEqual((await db.query('select lesson_id from bible_study_lessons order by lesson_id')).rows.map(row=>row.lesson_id),[1,3]);
  assert.equal((await db.query("update bible_study_lessons set content='No' where lesson_id=3 returning lesson_id")).rows.length,0);
  await assert.rejects(db.query('update bible_study_lessons set study_id=2 where lesson_id=1'),/row.level security/);
  await db.exec('reset role;set role anon');await db.query("select set_config('request.jwt.claim.sub','',false)");
  for(const table of tables)assert.equal((await db.query(`select * from ${table}`)).rows.length,0);
  await assert.rejects(db.query('select * from system_logs'),/permission denied/);
  await assert.rejects(db.query('select * from prompt_evaluations'),/permission denied/);
  await db.exec('reset role;set role service_role');assert.equal((await db.query('select * from daily_prayers')).rows.length,2);
  await db.exec('reset role');await db.exec(fs.readFileSync('supabase/rollbacks/20261101190000.sql','utf8'));
  await db.exec('set role authenticated');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[A]);
  assert.equal((await db.query('select * from daily_prayers')).rows.length,0);
  await assert.rejects(db.query('insert into daily_devotionals values(3,$1,\'forged\')',[B]),/row.level security/i);
 }finally{await db.close();}
});
