const test=require('node:test'),assert=require('node:assert/strict');
const {participationStreak}=require('../utils/triviaParticipation');
const {participationDate}=require('../utils/discoveryDelivery');
const {discoveryCopy}=require('../utils/notificationCalendarRules');
const {selectDiscoveryReminder,nativeCapabilities}=require('../services/discoveryReminders');
const day=(date)=>[1,2,3].map(i=>({discoveryId:`${date}-${i}`,mode:i===2?'revealed':'answered',puzzleDate:date,localDate:date,setPosition:i}));
test('participation ignores accuracy, preserves yesterday with partial today, and excludes archive repeats',()=>{
 const history=[...day('2026-10-31'),...day('2026-11-01'),...day('2026-11-02').slice(0,1)];
 assert.equal(participationStreak(history,'2026-11-02'),2);
 assert.equal(participationStreak([...history,...day('2026-11-02')],'2026-11-02'),3);
 assert.equal(participationStreak(history,'2026-11-03'),0);
 assert.equal(participationStreak(day('2026-11-01').map(r=>({...r,localDate:'2026-11-02',dailyPlayDate:null})),'2026-11-02'),0);
 assert.equal(participationDate({discovery_id:'a',mode:'revealed',set_position:1,puzzle_date:'2026-10-31',local_date:'2026-11-02'},[{publication_date:'2026-11-02',discovery_id:'a',source_publication_date:'2026-10-31'}]),'2026-11-02');
});
test('reminders use complete sets and honest state-aware copy with no fabricated count',()=>{
 const profile={user_id:'reader',expo_push_token:'ExponentPushToken[test]',notification_capabilities:nativeCapabilities({expoPushToken:'ExponentPushToken[test]',features:['discoveries','trivia-daily-set-v1'],appVersion:'1.2.13'})};
 const context={runtime:{enabled:true,rollout_percentage:100},schedule:day('2026-11-02').map(r=>({publication_date:r.puzzleDate,discovery_id:r.discoveryId,position:r.setPosition})),completed:new Map(),participation:new Map([['reader',new Set(['2026-11-01'])]]),streakKnown:true};
 const selected=selectDiscoveryReminder(context,profile,'2026-11-02');
 assert.equal(selected.content.url,'/discoveries?source=push');
 assert.equal(discoveryCopy(1,selected.content.reminderState).heading,'Keep your streak going');
 context.participation.clear();assert.equal(discoveryCopy(1,selectDiscoveryReminder(context,profile,'2026-11-02').content.reminderState).heading,'Start your streak');
 context.completed.set('reader:2026-11-02-1',{});assert.equal(discoveryCopy(1,selectDiscoveryReminder(context,profile,'2026-11-02').content.reminderState).heading,'Finish today’s three');
 context.streakKnown=false;assert.equal(discoveryCopy(1,selectDiscoveryReminder(context,profile,'2026-11-02').content.reminderState).heading,'Today’s Trivia is ready');
 for(let i=2;i<=3;i++)context.completed.set(`reader:2026-11-02-${i}`,{});
 assert.equal(selectDiscoveryReminder(context,profile,'2026-11-02').reason,'alreadyPlayed');
 context.schedule.pop();assert.equal(selectDiscoveryReminder(context,profile,'2026-11-02').reason,'missingContent');
});
