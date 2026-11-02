const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const {freshness,percentile,operationalReport}=require('../services/appQuality');
const {summarizeFeedback}=require('../services/readerFeedback');
const {createDatabase,A,B}=require('./helpers/accountHarness');
const now=new Date('2026-11-02T12:00:00Z');
test('freshness fails on stale, missing or future timestamps and preserves warning boundaries',()=>{
 assert.equal(freshness('2026-11-02T00:00:00Z',now).status,'pass');
 assert.equal(freshness('2026-11-01T10:00:00Z',now).status,'warn');
 for(const date of ['2026-10-30T00:00:00Z','2099-01-01',undefined])assert.equal(freshness(date,now).status,'fail');
 assert.equal(percentile([],0.95),null);assert.equal(percentile([90,20,5,10,30],.95),90);
});
test('real reader responses remain separate from model scores and small cohorts stay insufficient',()=>{
 const rows=[{content_type:'devotional',user_id:A,rating:5,issue_tags:[],channel:'web'},{content_type:'devotional',user_id:B,rating:1,practice_feasible:false,issue_tags:['repetitive'],channel:'mobile'}];
 const result=summarizeFeedback(rows).devotional;assert.equal(result.status,'insufficient_sample');assert.equal(result.respondents,2);assert.equal(result.averageRating,3);assert.equal(result.helpfulRate,.5);assert.equal(result.practiceFeasibleRate,0);assert.equal(result.issues.repetitive,1);assert.equal(result.user_id,undefined);
});
test('operations measure public delivery and keep unavailable audience, device and billing evidence unmeasured',async()=>{
 const db=createDatabase();db.tables.general_devotionals=Array.from({length:7},(_,i)=>({date:new Date(+now+i*86400000).toISOString().slice(0,10)}));db.tables.discovery_daily_sets=db.tables.general_devotionals.map(row=>({publication_date:row.date}));db.tables.discovery_daily_jobs=[];db.tables.notification_deliveries=[];db.tables.system_logs=[];db.tables.app_quality_reports=[];db.tables.devotional_quality_runs=[];
 const fetcher=async url=>({ok:true,json:async()=>url.includes('discoveries')?{enabled:true,items:[{id:1},{id:2},{id:3}]}:[{created_at:now.toISOString()}]});
 const report=await operationalReport({db,now,fetcher});assert.equal(report.areas.delivery.status,'pass');assert.equal(report.areas.helpfulness.status,'unmeasured');assert.equal(report.areas.subscriptions.status,'unmeasured');assert.equal(report.areas.usability.status,'unmeasured');assert.equal(report.overallGrade,null);
 const stale=await operationalReport({db,now,fetcher:async url=>url.includes('scriptural-outlooks')?{ok:true,json:async()=>[{created_at:'2026-09-24T00:00:00Z'}]}:fetcher(url)});assert.equal(stale.areas.delivery.status,'fail');assert.equal(stale.releaseGate,'needs_attention');
 db.fail('general_devotionals');const failure=await operationalReport({db,now,fetcher});assert.equal(failure.checks.devotional_runway.status,'fail');
});
test('feedback storage validates ratings, enforces unique votes, protects direct access, claims jobs once and rolls back',async()=>{
 const db=await PGlite.create();try{
 await db.exec('create schema auth;create table auth.users(id uuid primary key);create role anon;create role authenticated;create role service_role;');
 const sql=fs.readFileSync('supabase/migrations/20261101180000_app_quality_and_reader_feedback.sql','utf8');await db.exec(sql);await db.exec(sql);
 await db.query('insert into auth.users values($1)',[A]);
 await db.query("insert into reader_content_feedback(user_id,content_type,content_id,rating,channel) values($1,'devotional','1',5,'web')",[A]);
 await assert.rejects(db.query("insert into reader_content_feedback(user_id,content_type,content_id,rating,channel) values($1,'devotional','1',5,'web')",[A]),/unique/);
 await assert.rejects(db.query("insert into reader_content_feedback(user_id,content_type,content_id,rating,channel) values($1,'devotional','2',9,'web')",[A]),/check/);
 assert.equal((await db.query("select has_table_privilege('authenticated','reader_content_feedback','select') as allowed")).rows[0].allowed,false);
 assert.equal((await db.query("select claim_app_quality_run('operations:test','operations','commit') as claimed")).rows[0].claimed,true);
 assert.equal((await db.query("select claim_app_quality_run('operations:test','operations','commit') as claimed")).rows[0].claimed,false);
 await db.exec("update app_quality_reports set status='failed'");assert.equal((await db.query("select claim_app_quality_run('operations:test','operations','commit') as claimed")).rows[0].claimed,true);
 await db.query('delete from auth.users where id=$1',[A]);assert.equal((await db.query('select count(*) as n from reader_content_feedback')).rows[0].n,0);
 await db.exec(fs.readFileSync('supabase/rollbacks/20261101180000.sql','utf8'));assert.equal((await db.query("select to_regclass('reader_content_feedback') as value")).rows[0].value,null);
 }finally{await db.close();}
});
