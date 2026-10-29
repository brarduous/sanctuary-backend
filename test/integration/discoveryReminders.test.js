const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {createRequire}=require('node:module');
const {createHarness,seedReviewed,ADMIN,MEMBER,OTHER}=require('../helpers/discoveryHarness');
const {fingerprint,nativeCapabilities,discoveryReminderChannel}=require('../../services/discoveryReminders');
const candidates=require('../../content/discoveries/biblical-candidates.json');
const token='ExponentPushToken[reminder-test]';

test('native capability is validated and bound to the current device token',()=>{
 const capabilities=nativeCapabilities({expoPushToken:token,features:['discoveries'],appVersion:'1.2.11'});
 assert.equal(capabilities.discoveries.tokenSha256,fingerprint(token));
 assert.equal(discoveryReminderChannel({expo_push_token:token,notification_capabilities:capabilities}),'native');
 assert.equal(discoveryReminderChannel({expo_push_token:'ExponentPushToken[old-device]',notification_capabilities:capabilities}),null);
 assert.equal(discoveryReminderChannel({expo_push_token:token,webSubscription:{id:'web'}}),'web');
 for(const input of [{},{expoPushToken:'plain-token',features:['discoveries'],appVersion:'1'}, {expoPushToken:token,features:['other'],appVersion:'1'}])assert.throws(()=>nativeCapabilities(input),{status:400});
});

test('reminder dispatch respects consent, completion, content visibility, spacing, and daily deduplication',async t=>{
 const h=await createHarness();t.after(()=>h.close());
 // Keep the SQL publication/completion guards on the same fixed clock as the
 // injected dispatcher time below. This override exists only in this PGlite DB.
 await h.db.exec(`create or replace function pg_catalog.now() returns timestamptz
 language sql stable as $$select '2026-10-28T22:00:00Z'::timestamptz$$;`);
 await h.db.exec(`alter table user_profiles add user_preferences jsonb default '{}',add subscription_tier text default 'free',add expo_push_token text;
 create table push_subscriptions(id uuid primary key,user_id uuid,subscription jsonb,created_at timestamptz default now());`);
 await h.db.exec(`insert into auth.users(id) select ('10000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid from generate_series(1,1100) i;
 insert into user_profiles(user_id) select id from auth.users where id::text like '10000000-%';`);
 for(const file of ['20260721153000_notification_calendar.sql','20261028230000_discovery_reminders.sql'])await h.db.exec(fs.readFileSync(path.join(__dirname,'../../supabase/migrations',file),'utf8'));
 await seedReviewed(h,candidates[0],'2026-10-28');
 await h.db.exec(`update discovery_runtime_settings set enabled=true,rollout_percentage=100;
 update notification_runtime_settings set enabled=true,rollout_stage='100' where category='discovery';`);
 const filename=path.join(__dirname,'../../services/notificationCalendar.js');
 const originalRequire=createRequire(filename);const module={exports:{}};const sent=[];
 class Expo {static isExpoPushToken(value){return typeof value==='string'&&value.startsWith('ExponentPushToken[');}async sendPushNotificationsAsync(payload){sent.push(...payload);return [{status:'ok',id:'fake-ticket'}];}}
 vm.runInNewContext(fs.readFileSync(filename,'utf8'),{module,console,process,Date,Set,Map,require:name=>name==='../config/supabase'?h.client:name==='expo-server-sdk'?{Expo}:name==='web-push'?{setVapidDetails(){},async sendNotification(){throw new Error('Unexpected web push');}}:originalRequire(name)});
 const calendar=module.exports;
 const now=new Date('2026-10-28T22:00:00Z'); // 18:00 New York, including DST.
 const run=()=>calendar.dispatchCalendar({now,category:'discovery',dryRun:true});
 const result=async()=> (await run()).results[0];
 const setPrefs=async value=>h.db.query('update user_profiles set user_preferences=$1 where user_id=$2',[{notifications:{trivia:value}},MEMBER]);
 await h.db.query('update user_profiles set expo_push_token=$1,notification_capabilities=$2 where user_id=$3',[token,nativeCapabilities({expoPushToken:token,features:['discoveries'],appVersion:'1.2.11'}),MEMBER]);
 assert.equal((await result()).eligible,0,'missing consent never opts users in');
 await setPrefs('true');assert.equal((await result()).eligible,0,'string true is not consent');
 await setPrefs(true);assert.equal((await result()).eligible,1);
 await h.db.query('update user_profiles set notification_time_zone=$1 where user_id=$2',['Europe/London',MEMBER]);assert.equal((await result()).eligible,0);
 await h.db.query('update user_profiles set notification_time_zone=$1 where user_id=$2',['America/New_York',MEMBER]);
 await h.db.exec("update notification_runtime_settings set quiet_hours_start='17:00' where category='discovery'");assert.equal((await result()).quietHours,1);
 await h.db.exec("update notification_runtime_settings set quiet_hours_start='21:00' where category='discovery'; update discovery_runtime_settings set enabled=false");assert.equal((await result()).eligible,0);
 await h.db.exec('update discovery_runtime_settings set enabled=true;update discoveries set withdrawn=true');assert.equal((await result()).missingContent,1);
 await h.db.exec('update discoveries set withdrawn=false');
 const completion=await h.client.rpc('discovery_complete',{p_user:MEMBER,p_events:[{eventId:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',discoveryId:candidates[0].id,revision:1,mode:'answered',optionId:candidates[0].content.correctOptionId,occurredAt:now.toISOString(),localDate:'2026-10-28',timeZone:'America/New_York',elapsedMs:4000}]});
 assert.ifError(completion.error);
 assert.equal((await result()).alreadyPlayed,1);
 await h.db.exec('delete from discovery_completions');
 const live=await calendar.dispatchCalendar({now,category:'discovery'});assert.equal(live.results[0].accepted,1);assert.equal(sent.length,1);
 assert.equal(sent[0].data.url,`/discoveries/${candidates[0].id}`);assert.ok(!JSON.stringify(sent[0]).includes(candidates[0].content.prompt));
 assert.equal((await result()).frequencyCapped,1);
 await h.db.exec("update notification_deliveries set accepted_at=null,status='failed'");
 const retry=await calendar.dispatchCalendar({now,category:'discovery'});assert.equal(retry.results[0].deduplicated,1);assert.equal(sent.length,1);
 const rows=await h.db.query("select count(*)::int n from notification_preference_events where category='discovery' and enabled=false");
 await h.db.query('update user_profiles set user_preferences=$1 where user_id=$2',[{notifications:{trivia:false}},OTHER]);
 assert.equal((await h.db.query("select count(*)::int n from notification_preference_events where category='discovery' and enabled=false")).rows[0].n,rows.rows[0].n,'initial missing-to-false preference is not an opt-out');
 await setPrefs(false);assert.equal((await h.db.query("select count(*)::int n from notification_preference_events where category='discovery' and enabled=false")).rows[0].n,rows.rows[0].n+1);
 await h.db.exec(fs.readFileSync(path.join(__dirname,'../../supabase/rollbacks/20261028230000.sql'),'utf8'));
 assert.equal((await h.db.query("select enabled from notification_runtime_settings where category='discovery'")).rows[0].enabled,false);
});
