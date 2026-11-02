const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');const {A,B}=require('./helpers/accountHarness');
test('billing and allowlists are server-written while accounts retain their own reads',async()=>{
 const db=await PGlite.create();try{
  await db.exec(`create schema auth;create role anon;create role authenticated;create role service_role bypassrls;grant usage on schema public,auth to anon,authenticated,service_role;create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create function auth.jwt() returns jsonb language sql stable as $$select jsonb_build_object('email',current_setting('request.jwt.claim.email',true))$$;create table subscriptions(id text primary key,user_id uuid,status text);create table whitelist(email text primary key);create table admin_emails(email text primary key);grant all on subscriptions,whitelist,admin_emails to public,anon,authenticated,service_role;`);
  await db.query("insert into subscriptions values('a',$1,'active'),('b',$2,'active')",[A,B]);await db.exec("insert into whitelist values('a@example.test'),('b@example.test');insert into admin_emails values('admin@example.test')");
  const sql=fs.readFileSync('supabase/migrations/20261101200000_server_managed_entitlements.sql','utf8');await db.exec(sql);await db.exec(sql);
  await db.exec('set role authenticated');await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.email','a@example.test',false)",[A]);
  assert.deepEqual((await db.query('select id from subscriptions')).rows,[{id:'a'}]);assert.deepEqual((await db.query('select email from whitelist')).rows,[{email:'a@example.test'}]);
  for(const table of ['subscriptions','whitelist','admin_emails']){
   await assert.rejects(db.exec(`delete from ${table}`),/permission denied/);
   await assert.rejects(db.exec(table==='subscriptions'?"insert into subscriptions values('forged',auth.uid(),'active')":`insert into ${table} values('forged@example.test')`),/permission denied/);
  }
  await assert.rejects(db.exec("update subscriptions set status='active'"),/permission denied/);
  await assert.rejects(db.exec('select * from admin_emails'),/permission denied/);
  await db.exec('reset role;set role anon');await assert.rejects(db.exec('select * from subscriptions'),/permission denied/);await assert.rejects(db.exec('select * from whitelist'),/permission denied/);
  await db.exec('reset role;set role service_role');assert.equal((await db.query('select * from subscriptions')).rows.length,2);await db.exec("insert into whitelist values('server@example.test')");
  await db.exec('reset role');await db.exec(fs.readFileSync('supabase/rollbacks/20261101200000.sql','utf8'));await db.exec('set role authenticated');await assert.rejects(db.exec('select * from subscriptions'),/permission denied/);
 }finally{await db.close();}
});
