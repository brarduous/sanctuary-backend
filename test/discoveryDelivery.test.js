const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{randomUUID}=require('node:crypto');
const {PGlite,types}=require('@electric-sql/pglite');const {localDate,shiftDate}=require('../utils/discoveries');
const {presentCompletions}=require('../utils/discoveryDelivery');
test('unused coherent sets carry forward after admin-only play; ordinary answers advance once next day, with immutable canonical identity',async()=>{
 const db=await PGlite.create({parsers:{[types.DATE]:v=>v}});try{
 await db.exec(`create schema auth;create role anon;create role authenticated;create role service_role bypassrls;create table auth.users(id uuid,email text,raw_user_meta_data jsonb default '{}');create table user_profiles(user_id uuid,role text);create table admin_emails(email text);create table discovery_runtime_settings(singleton boolean,internal_user_ids uuid[] default '{}');create table discoveries(id uuid primary key,withdrawn boolean default false);create table discovery_daily_sets(publication_date date primary key);create table discovery_daily_set_items(publication_date date,position int,discovery_id uuid,revision int);create table discovery_metrics(event text,discovery_id uuid);create table discovery_completions(user_id uuid,discovery_id uuid,mode text);grant usage on schema public to service_role;`);
 const sql=fs.readFileSync('supabase/migrations/20261102100000_engagement_trivia_delivery.sql','utf8');await db.exec(sql);await db.exec(sql);
 const a=randomUUID(),b=randomUUID(),qa=randomUUID();for(const [id,role,email,metadata]of [[a,'admin','owner@example.test',{}],[b,'member','reader@example.test',{}],[qa,'member','test@example.test',{quality_test:true}]]){await db.query('insert into auth.users values($1,$2,$3)',[id,email,metadata]);await db.query('insert into user_profiles values($1,$2)',[id,role]);}
 const start=shiftDate(localDate(),-3),next=shiftDate(start,1),third=shiftDate(start,2),last=shiftDate(start,3);let ids=[];
 for(const day of [start,next,third,last]){await db.query('insert into discovery_daily_sets values($1)',[day]);for(let i=1;i<=3;i++){const id=randomUUID();ids.push(id);await db.query('insert into discoveries(id) values($1)',[id]);await db.query('insert into discovery_daily_set_items values($1,$2,$3,1)',[day,i,id]);}}
 const serve=async day=>(await db.query('select discovery_delivery_set($1) as rows',[day])).rows[0].rows;
 assert.deepEqual((await serve(start)).map(i=>i.discovery_id),ids.slice(0,3));
 await db.query("insert into discovery_completions values($1,$2,'answered'),($3,$2,'answered')",[a,ids[0],qa]);
 assert.deepEqual((await serve(next)).map(i=>i.discovery_id),ids.slice(0,3));
 assert.ok((await serve(next)).every(i=>i.publication_date===next&&i.source_publication_date===start));
 await db.query("insert into discovery_completions values($1,$2,'revealed')",[b,ids[1]]);assert.deepEqual((await serve(next)).map(i=>i.discovery_id),ids.slice(0,3));
 await db.query("insert into discovery_completions values($1,$2,'answered')",[b,ids[1]]);
 assert.deepEqual((await serve(next)).map(i=>i.discovery_id),ids.slice(0,3),'today remains fixed after an answer');
 assert.deepEqual((await serve(third)).map(i=>i.discovery_id),ids.slice(3,6),'advance to oldest unused approved set, not latest calendar set');
 await db.query("insert into discovery_metrics values('answer_committed',$1,true)",[ids[3]]);
 assert.deepEqual((await serve(last)).map(i=>i.discovery_id),ids.slice(6,9),'eligible anonymous answer can advance too');
 await db.query('update discoveries set withdrawn=true where id=$1',[ids[6]]);assert.deepEqual((await serve(last)).map(i=>i.discovery_id),ids.slice(9,12),'withdrawal substitutes another complete approved set, never mixes questions');
 for(const role of ['anon','authenticated']){await db.exec('set role '+role);await assert.rejects(db.query('select discovery_delivery_set($1)',[last]),/permission denied/);await assert.rejects(db.query('select * from discovery_delivery_days'),/permission denied/);await db.exec('reset role');}
 const canonical={discovery_id:ids[0],puzzle_date:start,local_date:start};const fake={from(){return{select(){return this;},in(){return Promise.resolve({data:[{publication_date:next,discovery_id:ids[0],source_publication_date:start}],error:null});}}}};
 const displayed=await presentCompletions(fake,[canonical],next);assert.equal(displayed[0].puzzle_date,next);assert.equal(displayed[0].local_date,start);assert.equal(canonical.puzzle_date,start,'no stored completion or credit is rewritten');
 }finally{await db.close();}
});
