const webPush = require('web-push');
const { Expo } = require('expo-server-sdk');
const supabase = require('../config/supabase');
const {
  DAY_MS, DEFAULT_TIME_ZONE, cohortBucket, copyVariant, devotionalCopy,
  isInRollout: ruleIsInRollout, isValidTimeZone, isWithinQuietHours,
  isWithinWindow, localParts, stagePercentage,
} = require('../utils/notificationCalendarRules');

const expo = new Expo();
const STAGES = new Set(['dry_run', 'internal', '10', '50', '100']);
const CATEGORY_PREFERENCE = { devotional: 'devotionals', advice: 'advice', news: 'news', church: 'announcements' };

function internalUserIds() {
  return new Set(String(process.env.NOTIFICATION_INTERNAL_USER_IDS || '')
    .split(',').map(value => value.trim()).filter(Boolean));
}

function isInRollout(profile, stage) {
  return ruleIsInRollout(profile, stage, internalUserIds());
}

function configureWebPush() {
  const publicKey = process.env.VAPID_PUBLIC_KEY || process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!process.env.VAPID_PRIVATE_KEY || !publicKey) return false;
  webPush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:support@sanctuaryapp.us',
    publicKey,
    process.env.VAPID_PRIVATE_KEY,
  );
  return true;
}

async function loadAudience() {
  const [{ data: profiles, error: profileError }, { data: subscriptions, error: subscriptionError }] = await Promise.all([
    supabase.from('user_profiles').select('user_id, subscription_tier, user_preferences, expo_push_token, notification_time_zone'),
    supabase.from('push_subscriptions').select('id, user_id, subscription, created_at').order('created_at', { ascending: false }),
  ]);
  if (profileError) throw profileError;
  if (subscriptionError) throw subscriptionError;
  const webByUser = new Map();
  for (const subscription of subscriptions || []) {
    if (!webByUser.has(subscription.user_id)) webByUser.set(subscription.user_id, subscription);
  }
  return (profiles || []).map(profile => ({ ...profile, webSubscription: webByUser.get(profile.user_id) }));
}

async function loadContent(now) {
  const utcDate = now.toISOString().slice(0, 10);
  const nextUtcDate = new Date(now.getTime() + DAY_MS).toISOString().slice(0, 10);
  const previousUtcDate = new Date(now.getTime() - DAY_MS).toISOString().slice(0, 10);
  const since = new Date(now.getTime() - 36 * 60 * 60 * 1000).toISOString();
  const [{ data: general, error: generalError }, { data: personalized, error: personalizedError }] = await Promise.all([
    // Include adjacent UTC dates because a recipient's local date can be one day
    // ahead of or behind UTC while the dispatcher is running.
    supabase.from('general_devotionals').select('id, title, scripture_reference, date')
      .gte('date', previousUtcDate).lte('date', nextUtcDate).order('date', { ascending: true }),
    supabase.from('daily_devotionals').select('devotional_id, user_id, title, scripture, created_at').gte('created_at', since).eq('status', 'completed').order('created_at', { ascending: false }),
  ]);
  if (generalError) throw generalError;
  if (personalizedError) throw personalizedError;
  return { general: general || [], personalized: personalized || [] };
}

function selectDevotional(profile, localDate, content) {
  const personalized = content.personalized.find(item => item.user_id === profile.user_id
    && localParts(new Date(item.created_at), profile.notification_time_zone).date === localDate);
  if (personalized?.title) return {
    title: personalized.title.trim(), scripture: personalized.scripture?.trim(),
    contentId: String(personalized.devotional_id), url: `/devotional/${personalized.devotional_id}`,
  };
  // Never label an older devotional as today's content. If the content runway is
  // stale, skip the push and let the dispatch report surface missingContent.
  const general = content.general.find(item => item.date === localDate);
  if (!general?.title) return null;
  return {
    title: general.title.trim(), scripture: general.scripture_reference?.trim(),
    contentId: `general-${general.id}`, url: `/devotional/general-${general.id}`,
  };
}

async function ensureCampaign({ category, localDate, setting, variant, contentId = null, dryRun }) {
  const campaignKey = `${category}:${localDate}:${contentId || 'scheduled'}`;
  if (dryRun) return { id: null, campaign_key: campaignKey, rollout_stage: setting.rollout_stage };
  const payload = {
    category, campaign_key: campaignKey, campaign_date: localDate,
    content_type: category === 'devotional' ? 'devotional' : category,
    content_id: contentId, copy_variant: variant,
    scheduled_local_time: setting.send_local_time,
    rollout_stage: setting.rollout_stage,
    rollout_percentage: stagePercentage(setting.rollout_stage), status: 'sending',
  };
  const { data, error } = await supabase.from('notification_campaigns')
    .upsert(payload, { onConflict: 'campaign_key', ignoreDuplicates: false }).select('*').single();
  if (error) throw error;
  return data;
}

async function resolveNewsCampaign({ setting, now, dryRun }) {
  const sinceDay = new Date(now.getTime() - DAY_MS).toISOString();
  const { data: active, error: activeError } = await supabase.from('notification_campaigns')
    .select('*').eq('category', 'news').gte('created_at', sinceDay)
    .in('status', ['scheduled', 'sending']).order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (activeError) throw activeError;
  if (active) return { campaign: active, content: active.metadata, capped: false };
  const weekAgo = new Date(now.getTime() - 7 * DAY_MS).toISOString();
  const { count, error: countError } = await supabase.from('notification_campaigns')
    .select('id', { count: 'exact', head: true }).eq('category', 'news').gte('created_at', weekAgo);
  if (countError) throw countError;
  if ((count || 0) >= 2) return { campaign: null, content: null, capped: true };
  const threshold = Number(process.env.NEWS_PUSH_IMPACT_THRESHOLD || 85);
  const { data: article, error } = await supabase.from('scriptural_outlooks')
    .select('id, slug, article_title, news_impact_score').gte('news_impact_score', threshold)
    .gte('created_at', sinceDay).is('push_alerted_at', null)
    .order('news_impact_score', { ascending: false }).order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  if (!article) return { campaign: null, content: null, capped: false };
  const content = { title: article.article_title, contentId: String(article.id), url: `/news/${article.slug || article.id}`, articleId: article.id };
  if (dryRun) return { campaign: { id: null, content_id: content.contentId }, content, capped: false };
  const campaignKey = `news:${article.id}`;
  const payload = {
    category: 'news', campaign_key: campaignKey, campaign_date: now.toISOString().slice(0, 10),
    content_type: 'news', content_id: content.contentId, copy_variant: copyVariant(now),
    scheduled_local_time: setting.send_local_time, rollout_stage: setting.rollout_stage,
    rollout_percentage: stagePercentage(setting.rollout_stage), status: 'sending', metadata: content,
  };
  const { data: campaign, error: campaignError } = await supabase.from('notification_campaigns')
    .upsert(payload, { onConflict: 'campaign_key' }).select('*').single();
  if (campaignError) throw campaignError;
  await supabase.from('scriptural_outlooks').update({ push_alerted_at: now.toISOString() }).eq('id', article.id);
  return { campaign, content, capped: false };
}

async function recentAcceptedByUser(userIds, now) {
  if (!userIds.length) return new Map();
  const since = new Date(now.getTime() - 6 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase.from('notification_deliveries')
    .select('user_id, accepted_at').in('user_id', userIds).gte('accepted_at', since)
    .in('status', ['accepted', 'opened']).order('accepted_at', { ascending: false });
  if (error) throw error;
  const result = new Map();
  for (const row of data || []) if (!result.has(row.user_id)) result.set(row.user_id, row.accepted_at);
  return result;
}

async function createDelivery(payload) {
  const { data, error } = await supabase.from('notification_deliveries')
    .insert(payload).select('id').maybeSingle();
  if (error?.code === '23505') return null;
  if (error) throw error;
  return data;
}

async function updateDelivery(id, values) {
  const { error } = await supabase.from('notification_deliveries')
    .update({ ...values, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
}

async function sendNative(token, payload) {
  if (!Expo.isExpoPushToken(token)) throw Object.assign(new Error('Invalid Expo push token'), { code: 'INVALID_ENDPOINT', permanent: true });
  const tickets = await expo.sendPushNotificationsAsync([{ to: token, sound: 'default', ...payload }]);
  const ticket = tickets[0];
  if (ticket.status === 'error') {
    const code = ticket.details?.error || 'EXPO_REJECTED';
    throw Object.assign(new Error(ticket.message || code), { code, permanent: code === 'DeviceNotRegistered' });
  }
  return ticket.id;
}

async function sendWeb(subscription, payload) {
  if (!configureWebPush()) throw Object.assign(new Error('Web push is not configured'), { code: 'WEB_PUSH_UNCONFIGURED' });
  try {
    const pushSubscription = typeof subscription === 'string' ? JSON.parse(subscription) : subscription;
    await webPush.sendNotification(pushSubscription, JSON.stringify({ ...payload, icon: '/icon' }));
    return null;
  } catch (error) {
    error.permanent = error.statusCode === 404 || error.statusCode === 410;
    error.code = error.permanent ? 'INVALID_ENDPOINT' : `WEB_PUSH_${error.statusCode || 'FAILED'}`;
    throw error;
  }
}

async function dispatchToRecipient({ profile, campaign, category, local, content, variant, now, dryRun }) {
  const channel = Expo.isExpoPushToken(profile.expo_push_token)
    ? 'native'
    : profile.webSubscription ? 'web' : null;
  if (!channel) return { status: 'invalidEndpoint' };
  if (dryRun) return { status: 'eligible', channel };
  const delivery = await createDelivery({
    campaign_id: campaign.id, user_id: profile.user_id, category,
    content_id: content?.contentId || campaign.content_id, local_date: local.date,
    channel, status: 'planned', scheduled_for: now.toISOString(), copy_variant: variant,
    metadata: { url: content?.url || '/(tabs)/advice' },
  });
  if (!delivery) return { status: 'deduplicated' };
  const trackingUrl = content?.url || '/(tabs)/advice';
  const copy = category === 'devotional'
    ? devotionalCopy({ title: content.title, scripture: content.scripture, variant, weekday: local.weekday })
    : category === 'news'
      ? { heading: 'News worth a thoughtful pause', body: `${content.title} — look beyond the headline with a scriptural perspective.` }
      : { heading: 'Need a little wisdom?', body: 'What decision or relationship could use a prayerful, scriptural perspective?' };
  const payload = { title: copy.heading, body: copy.body, data: { url: trackingUrl, notificationDeliveryId: delivery.id }, url: trackingUrl, tag: `${category}-${local.date}` };
  await updateDelivery(delivery.id, { status: 'attempted', attempted_at: now.toISOString() });
  try {
    const providerId = channel === 'native'
      ? await sendNative(profile.expo_push_token, payload)
      : await sendWeb(profile.webSubscription.subscription, payload);
    await updateDelivery(delivery.id, { status: 'accepted', accepted_at: new Date().toISOString(), provider_message_id: providerId });
    return { status: 'accepted', channel };
  } catch (error) {
    await updateDelivery(delivery.id, { status: 'failed', failure_code: error.code || 'SEND_FAILED' });
    if (error.permanent) {
      if (channel === 'native') await supabase.from('user_profiles').update({ expo_push_token: null }).eq('user_id', profile.user_id);
      else await supabase.from('push_subscriptions').delete().eq('id', profile.webSubscription.id);
    }
    return { status: 'failed', channel, failureCode: error.code || 'SEND_FAILED' };
  }
}

function emptySummary() {
  return { eligible: 0, attempted: 0, accepted: 0, optedOut: 0, quietHours: 0, frequencyCapped: 0, missingContent: 0, invalidEndpoint: 0, outsideWindow: 0, outsideRollout: 0, deduplicated: 0, failed: 0 };
}

async function dispatchCategory({ category, now, dryRun, rolloutStage }) {
  const { data: setting, error } = await supabase.from('notification_runtime_settings').select('*').eq('category', category).maybeSingle();
  if (error) throw error;
  if (!setting) return { category, skipped: 'missing_setting', ...emptySummary() };
  const activeSetting = { ...setting, rollout_stage: rolloutStage || setting.rollout_stage };
  if (!STAGES.has(activeSetting.rollout_stage)) throw new Error('Invalid rollout stage');
  if (!activeSetting.enabled && !dryRun) return { category, skipped: 'disabled', ...emptySummary() };
  if (category === 'church') return { category, skipped: 'organization_driven', ...emptySummary() };
  const audience = await loadAudience();
  const recent = await recentAcceptedByUser(audience.map(profile => profile.user_id), now);
  const content = category === 'devotional' ? await loadContent(now) : null;
  const news = category === 'news' ? await resolveNewsCampaign({ setting: activeSetting, now, dryRun }) : null;
  if (news?.capped) return { category, skipped: 'weekly_cap', ...emptySummary(), frequencyCapped: audience.length };
  if (category === 'news' && !news?.campaign) return { category, skipped: 'no_qualifying_content', ...emptySummary(), missingContent: audience.length };
  const variant = copyVariant(now);
  const summary = emptySummary();
  const campaignCache = new Map();
  for (const profile of audience) {
    const local = localParts(now, profile.notification_time_zone);
    if (category === 'advice' && local.weekday !== 'Wed') { summary.outsideWindow++; continue; }
    if (!isWithinWindow(local.minutes, activeSetting.send_local_time)) { summary.outsideWindow++; continue; }
    const preference = profile.user_preferences?.notifications?.[CATEGORY_PREFERENCE[category]];
    if (preference !== true) { summary.optedOut++; continue; }
    if (isWithinQuietHours(local.minutes, activeSetting.quiet_hours_start, activeSetting.quiet_hours_end)) { summary.quietHours++; continue; }
    if (!isInRollout(profile, activeSetting.rollout_stage) && !dryRun) { summary.outsideRollout++; continue; }
    if (recent.has(profile.user_id)) { summary.frequencyCapped++; continue; }
    const selectedContent = category === 'devotional' ? selectDevotional(profile, local.date, content) : category === 'news' ? news.content : null;
    if (category === 'devotional' && !selectedContent) { summary.missingContent++; continue; }
    const campaignContentId = category === 'devotional' ? `daily-${local.date}` : category === 'news' ? news.content.contentId : null;
    const cacheKey = `${local.date}:${campaignContentId || category}`;
    let campaign = campaignCache.get(cacheKey);
    if (!campaign) {
      campaign = category === 'news'
        ? news.campaign
        : await ensureCampaign({ category, localDate: local.date, setting: activeSetting, variant, contentId: campaignContentId, dryRun });
      campaignCache.set(cacheKey, campaign);
    }
    const result = await dispatchToRecipient({ profile, campaign, category, local, content: selectedContent, variant, now, dryRun });
    if (result.status === 'eligible') summary.eligible++;
    else if (result.status === 'accepted') { summary.eligible++; summary.attempted++; summary.accepted++; }
    else if (result.status === 'invalidEndpoint') summary.invalidEndpoint++;
    else if (result.status === 'deduplicated') summary.deduplicated++;
    else if (result.status === 'failed') { summary.eligible++; summary.attempted++; summary.failed++; }
  }
  if (!dryRun) {
    for (const campaign of campaignCache.values()) {
      if (category === 'news') continue;
      await supabase.from('notification_campaigns').update({ status: 'complete', updated_at: new Date().toISOString() }).eq('id', campaign.id);
    }
  }
  if (summary.missingContent > 0) console.error('[Notifications] Required content is missing', { category, count: summary.missingContent });
  const result = { category, dryRun, rolloutStage: activeSetting.rollout_stage, ...summary };
  const { error: runError } = await supabase.from('notification_dispatch_runs').insert({
    category, dry_run: dryRun, rollout_stage: activeSetting.rollout_stage, summary,
  });
  if (runError) throw runError;
  return result;
}

async function evaluateRolloutGates(now = new Date()) {
  const { data: settings, error } = await supabase.from('notification_runtime_settings')
    .select('*').in('category', ['devotional', 'advice']).eq('enabled', true);
  if (error) throw error;
  const results = [];
  for (const setting of settings || []) {
    if (!['internal', '10', '50'].includes(setting.rollout_stage)) continue;
    const stageAge = now.getTime() - new Date(setting.stage_started_at).getTime();
    const requiredAge = setting.rollout_stage === 'internal' ? 3 * DAY_MS : DAY_MS;
    if (stageAge < requiredAge) continue;
    const since = new Date(setting.stage_started_at).toISOString();
    const [{ data: deliveries }, { count: optOuts }] = await Promise.all([
      supabase.from('notification_deliveries').select('status').eq('category', setting.category).gte('created_at', since),
      supabase.from('notification_preference_events').select('id', { count: 'exact', head: true }).eq('category', setting.category).eq('enabled', false).gte('created_at', since),
    ]);
    const attempted = (deliveries || []).filter(row => ['attempted', 'accepted', 'failed', 'opened'].includes(row.status)).length;
    const failed = (deliveries || []).filter(row => row.status === 'failed').length;
    const hardFailureRate = attempted ? failed / attempted : 0;
    const optOutRate = attempted ? (optOuts || 0) / attempted : 0;
    if (attempted === 0) { results.push({ category: setting.category, action: 'hold', reason: 'no_attempts' }); continue; }
    if (hardFailureRate >= 0.02 || optOutRate >= 0.005) {
      await supabase.from('notification_runtime_settings').update({ enabled: false, last_gate_evaluated_at: now.toISOString() }).eq('category', setting.category);
      results.push({ category: setting.category, action: 'halted', hardFailureRate, optOutRate });
      continue;
    }
    const next = { internal: '10', 10: '50', 50: '100' }[setting.rollout_stage];
    await supabase.from('notification_runtime_settings').update({ rollout_stage: next, stage_started_at: now.toISOString(), last_gate_evaluated_at: now.toISOString() }).eq('category', setting.category);
    results.push({ category: setting.category, action: 'promoted', rolloutStage: next, hardFailureRate, optOutRate });
  }
  return results;
}

async function dispatchCalendar({ now = new Date(), dryRun = false, category = null, rolloutStage = null } = {}) {
  const categories = category ? [category] : ['devotional', 'advice', 'news'];
  if (categories.some(value => !['devotional', 'advice', 'news', 'church'].includes(value))) throw new Error('Invalid notification category');
  if (rolloutStage && !STAGES.has(rolloutStage)) throw new Error('Invalid rollout stage');
  const results = [];
  for (const value of categories) results.push(await dispatchCategory({ category: value, now, dryRun, rolloutStage }));
  const gates = dryRun ? [] : await evaluateRolloutGates(now);
  return { generatedAt: now.toISOString(), results, gates };
}

async function notificationReport({ since }) {
  let query = supabase.from('notification_deliveries').select('category, channel, status, copy_variant, failure_code, created_at');
  if (since) query = query.gte('created_at', since);
  const { data, error } = await query;
  if (error) throw error;
  const totals = {};
  for (const row of data || []) {
    const key = `${row.category}:${row.channel}:v${row.copy_variant}`;
    totals[key] ||= { attempted: 0, accepted: 0, opened: 0, failed: 0 };
    if (['attempted', 'accepted', 'opened', 'failed'].includes(row.status)) totals[key].attempted++;
    if (['accepted', 'opened'].includes(row.status)) totals[key].accepted++;
    if (row.status === 'opened') totals[key].opened++;
    if (row.status === 'failed') totals[key].failed++;
  }
  let runQuery = supabase.from('notification_dispatch_runs').select('category, dry_run, rollout_stage, summary, created_at');
  if (since) runQuery = runQuery.gte('created_at', since);
  const { data: runs, error: runError } = await runQuery;
  if (runError) throw runError;
  return { deliveries: totals, dispatchRuns: runs || [] };
}

async function markOpened(userId, deliveryId) {
  const now = new Date().toISOString();
  const { data, error } = await supabase.from('notification_deliveries')
    .update({ status: 'opened', opened_at: now, updated_at: now })
    .eq('id', deliveryId).eq('user_id', userId).select('id').maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

async function updateTimeZone(userId, timeZone) {
  if (!isValidTimeZone(timeZone)) throw Object.assign(new Error('A valid IANA timezone is required'), { status: 400, code: 'TIME_ZONE_INVALID' });
  const { data, error } = await supabase.from('user_profiles')
    .update({ notification_time_zone: timeZone }).eq('user_id', userId)
    .select('notification_time_zone').maybeSingle();
  if (error) throw error;
  return data;
}

async function processExpoReceipts() {
  const since = new Date(Date.now() - DAY_MS).toISOString();
  const { data: deliveries, error } = await supabase.from('notification_deliveries')
    .select('id, user_id, provider_message_id').eq('channel', 'native')
    .in('status', ['accepted']).not('provider_message_id', 'is', null).gte('accepted_at', since).limit(1000);
  if (error) throw error;
  let checked = 0;
  let failed = 0;
  for (const chunk of expo.chunkPushNotificationReceiptIds((deliveries || []).map(row => row.provider_message_id))) {
    const receipts = await expo.getPushNotificationReceiptsAsync(chunk);
    for (const delivery of deliveries || []) {
      const receipt = receipts[delivery.provider_message_id];
      if (!receipt) continue;
      checked++;
      if (receipt.status === 'error') {
        failed++;
        const code = receipt.details?.error || 'EXPO_RECEIPT_FAILED';
        await updateDelivery(delivery.id, { status: 'failed', failure_code: code });
        if (code === 'DeviceNotRegistered') {
          await supabase.from('user_profiles').update({ expo_push_token: null }).eq('user_id', delivery.user_id);
        }
      }
    }
  }
  return { checked, failed };
}

module.exports = {
  DEFAULT_TIME_ZONE, cohortBucket, copyVariant, devotionalCopy, dispatchCalendar,
  evaluateRolloutGates, isInRollout, isValidTimeZone, isWithinQuietHours,
  isWithinWindow, localParts, markOpened, notificationReport,
  processExpoReceipts, stagePercentage, updateTimeZone,
};
