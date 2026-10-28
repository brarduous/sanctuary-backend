const {createHash}=require('node:crypto');
const {cohort}=require('../utils/discoveries');
const {DAY_MS}=require('../utils/notificationCalendarRules');
const fingerprint=token=>createHash('sha256').update(token).digest('hex');
function supportsNativeDiscovery(profile) {
  const capability=profile.notification_capabilities?.discoveries;
  return Boolean(profile.expo_push_token && capability?.version===1 && capability.tokenSha256===fingerprint(profile.expo_push_token));
}
function discoveryReminderChannel(profile) {
  if(supportsNativeDiscovery(profile))return 'native';
  return profile.webSubscription ? 'web':null;
}
function discoveryVisible(runtime,userId) {
  return Boolean(runtime?.enabled && (runtime.internal_user_ids?.includes(userId) || cohort(userId)<runtime.rollout_percentage));
}
async function loadDiscoveryReminderContext(db,now,userIds) {
  const setting=await db.from('discovery_runtime_settings').select('enabled,rollout_percentage,internal_user_ids').eq('singleton',true).maybeSingle();
  if(setting.error){if(['42P01','PGRST205'].includes(setting.error.code))return {runtime:null,schedule:[],completed:new Set()};throw setting.error;}
  if(!setting.data?.enabled)return {runtime:setting.data,schedule:[],completed:new Set()};
  const date=offset=>new Date(now.getTime()+offset*DAY_MS).toISOString().slice(0,10);
  const rows=await db.from('discovery_schedule').select('publication_date,discovery_id,revision').gte('publication_date',date(-1)).lte('publication_date',date(1));
  if(rows.error)throw rows.error;
  const ids=[...new Set((rows.data || []).map(row=>row.discovery_id))];
  if(!ids.length)return {runtime:setting.data,schedule:[],completed:new Set()};
  const parents=await db.from('discoveries').select('id,withdrawn').in('id',ids);
  if(parents.error)throw parents.error;
  const visible=new Set(parents.data.filter(row=>!row.withdrawn).map(row=>row.id));
  const completed=new Set();
  // At most three daily discoveries x 250 users, below the API row cap.
  for(let offset=0;offset<userIds.length;offset+=250) {
    const result=await db.from('discovery_completions').select('user_id,discovery_id').in('discovery_id',ids).in('user_id',userIds.slice(offset,offset+250));
    if(result.error)throw result.error;
    for(const row of result.data || [])completed.add(`${row.user_id}:${row.discovery_id}`);
  }
  return {runtime:setting.data,schedule:rows.data.filter(row=>visible.has(row.discovery_id)),completed};
}
function selectDiscoveryReminder(context,profile,localDate) {
  if(!discoveryVisible(context.runtime,profile.user_id))return {reason:'outsideRollout'};
  const item=context.schedule.find(row=>row.publication_date===localDate);
  if(!item)return {reason:'missingContent'};
  if(context.completed.has(`${profile.user_id}:${item.discovery_id}`))return {reason:'alreadyPlayed'};
  if(!discoveryReminderChannel(profile))return {reason:'unsupportedClient'};
  return {content:{contentId:item.discovery_id,revision:item.revision,url:`/discoveries/${item.discovery_id}`}};
}
function nativeCapabilities(input) {
  if(typeof input?.expoPushToken!=='string' || !/^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$/.test(input.expoPushToken) || !Array.isArray(input.features) || input.features.length!==1 || input.features[0]!=='discoveries' || typeof input.appVersion!=='string' || input.appVersion.length>40)throw Object.assign(new Error('Invalid notification capabilities.'),{status:400});
  return {discoveries:{version:1,tokenSha256:fingerprint(input.expoPushToken),appVersion:input.appVersion}};
}
module.exports={fingerprint,supportsNativeDiscovery,discoveryReminderChannel,discoveryVisible,loadDiscoveryReminderContext,selectDiscoveryReminder,nativeCapabilities};
