const {createHash}=require('node:crypto');
const {cohort,shiftDate}=require('../utils/discoveries');
const {DAY_MS}=require('../utils/notificationCalendarRules');
const {deliveryHistory,participationDate}=require('../utils/discoveryDelivery');
const {participationDays}=require('../utils/triviaParticipation');
const fingerprint=token=>createHash('sha256').update(token).digest('hex');
function supportsNativeDiscovery(profile) {
 const capability=profile.notification_capabilities?.discoveries;
 return Boolean(profile.user_id&&profile.expo_push_token&&capability?.version===2&&capability.tokenSha256===fingerprint(profile.expo_push_token));
}
// Begin with signed-in daily-set native clients. Guests/web need separate consent and identity design.
function discoveryReminderChannel(profile){return supportsNativeDiscovery(profile)?'native':null;}
function discoveryVisible(runtime,userId){return Boolean(runtime?.enabled&&(runtime.internal_user_ids?.includes(userId)||cohort(userId)<runtime.rollout_percentage));}
async function pages(query){const rows=[];for(let offset=0;;offset+=500){const r=await query().range(offset,offset+499);if(r.error)throw r.error;rows.push(...(r.data||[]));if(!r.data||r.data.length<500)return rows;}}
async function loadDiscoveryReminderContext(db,now,userIds,recipientDates){
 const setting=await db.from('discovery_runtime_settings').select('*').eq('singleton',true).maybeSingle();
 const empty={runtime:setting.data,schedule:[],completed:new Map(),participation:new Map(),streakKnown:true};
 if(setting.error){if(['42P01','PGRST205'].includes(setting.error.code))return {...empty,runtime:null};throw setting.error;}
 if(!setting.data?.enabled)return empty;
 const date=offset=>new Date(now.getTime()+offset*DAY_MS).toISOString().slice(0,10);
 const dates=recipientDates?.length?[...new Set(recipientDates)]:[date(-1),date(0),date(1)];
 const historicalDates=[...new Set(dates.flatMap(day=>[shiftDate(day,-1),day]))];
 const rows=await db.from('discovery_daily_set_items').select('publication_date,discovery_id,revision,position').gte('publication_date',date(-2)).lte('publication_date',date(1));
 if(rows.error)throw rows.error;
 let schedule=rows.data||[];
 if(setting.data.recycle_unplayed_sets){
  const delivered=[];
  for(const day of dates){const r=await db.rpc('discovery_delivery_set',{p_date:day});if(r.error)throw r.error;delivered.push(...(r.data||[]));}
  schedule=delivered;
 }
 const ids=[...new Set(schedule.map(row=>row.discovery_id))];
 if(!ids.length)return empty;
 const parents=await db.from('discoveries').select('id,withdrawn').in('id',ids);if(parents.error)throw parents.error;
 const visible=new Set((parents.data||[]).filter(row=>!row.withdrawn).map(row=>row.id));
 schedule=schedule.filter(row=>visible.has(row.discovery_id));
 const deliveries=await deliveryHistory(db,historicalDates);
 const completed=new Map(),byUser=new Map();
 for(let offset=0;offset<userIds.length;offset+=100){
  const users=userIds.slice(offset,offset+100);
  const columns='user_id,discovery_id,mode,puzzle_date,local_date,set_position';
  const [forSet,recent]=await Promise.all([
   pages(()=>db.from('discovery_completions').select(columns).in('user_id',users).in('discovery_id',ids).order('user_id').order('discovery_id')),
   pages(()=>db.from('discovery_completions').select(columns).in('user_id',users).gte('local_date',date(-2)).lte('local_date',date(1)).order('user_id').order('discovery_id')),
  ]);
  for(const row of [...forSet,...recent])completed.set(`${row.user_id}:${row.discovery_id}`,row);
 }
 for(const row of completed.values()){
  const history=byUser.get(row.user_id)||[];
  history.push({discoveryId:row.discovery_id,mode:row.mode,puzzleDate:row.puzzle_date,localDate:row.local_date,setPosition:row.set_position,dailyPlayDate:participationDate(row,deliveries)});
  byUser.set(row.user_id,history);
 }
 return {runtime:setting.data,schedule,completed,participation:new Map([...byUser].map(([id,history])=>[id,participationDays(history)])),streakKnown:true};
}
function selectDiscoveryReminder(context,profile,localDate){
 if(!discoveryVisible(context.runtime,profile.user_id))return {reason:'outsideRollout'};
 const items=context.schedule.filter(row=>row.publication_date===localDate).sort((a,b)=>a.position-b.position);
 if(items.length!==3||new Set(items.map(row=>row.discovery_id)).size!==3||items.some((row,index)=>row.position!==index+1))return {reason:'missingContent'};
 const played=items.filter(row=>context.completed.has(`${profile.user_id}:${row.discovery_id}`)).length;
 if(played===3)return {reason:'alreadyPlayed'};
 if(!discoveryReminderChannel(profile))return {reason:'unsupportedClient'};
 const continuingStreak=context.participation?.get(profile.user_id)?.has(shiftDate(localDate,-1))||false;
 return {content:{contentId:`daily-${localDate}`,url:'/discoveries?source=push',reminderState:{played,continuingStreak,streakKnown:context.streakKnown===true}}};
}
function nativeCapabilities(input){
 const features=input?.features;
 if(typeof input?.expoPushToken!=='string'||!/^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$/.test(input.expoPushToken)||!Array.isArray(features)||!features.includes('discoveries')||features.length<1||features.length>2||new Set(features).size!==features.length||features.some(value=>!['discoveries','trivia-daily-set-v1'].includes(value))||typeof input.appVersion!=='string'||input.appVersion.length>40)throw Object.assign(new Error('Invalid notification capabilities.'),{status:400});
 return {discoveries:{version:features.includes('trivia-daily-set-v1')?2:1,tokenSha256:fingerprint(input.expoPushToken),appVersion:input.appVersion}};
}
module.exports={fingerprint,supportsNativeDiscovery,discoveryReminderChannel,discoveryVisible,loadDiscoveryReminderContext,selectDiscoveryReminder,nativeCapabilities};
