const express = require('express');
const router = express.Router();
const Mux = require('@mux/mux-node');
const supabase = require('../config/supabase');
const authenticateUser = require('../middleware/auth');
const { requireCapability } = require('../middleware/authorization');
const { sendPushToCongregation } = require('../utils/push');

router.get('/', authenticateUser, requireCapability('communications.read'), async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
    const { data, error } = await supabase
      .from('pastoral_messages')
      .select('message_id, congregation_id, author_id, title, message_type, message_body, is_published, status, scheduled_at, sent_at, archived_at, recipient_scope, channels, delivery_summary, created_at')
      .eq('congregation_id', req.congregationId)
      .is('archived_at', null)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    res.json({ data });
  } catch (error) {
    error.status = 500;
    error.code = 'MESSAGE_HISTORY_FAILED';
    next(error);
  }
});

let muxClient;
const getMux = () => {
  if (!muxClient) {
    if (!process.env.MUX_TOKEN_ID || !process.env.MUX_TOKEN_SECRET) throw Object.assign(new Error('Video delivery is not configured.'), { status: 503, code: 'VIDEO_UNAVAILABLE' });
    muxClient = new Mux({ tokenId: process.env.MUX_TOKEN_ID, tokenSecret: process.env.MUX_TOKEN_SECRET });
  }
  return muxClient;
};
const BROADCAST_TYPES = new Set(['announcement', 'devotional', 'prayer_update', 'emergency', 'newsletter', 'video_update']);
const MESSAGE_STATUSES = new Set(['draft', 'scheduled', 'sent']);
const channelPreference = { email: 'email_enabled', sms: 'sms_enabled', push: 'push_enabled' };
const isWithinQuietHours = (preference, now = new Date()) => {
  if (!preference?.quiet_hours_start || !preference?.quiet_hours_end) return false;
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: preference.time_zone || 'UTC', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(now);
    const current = Number(parts.find((part) => part.type === 'hour')?.value) * 60 + Number(parts.find((part) => part.type === 'minute')?.value);
    const minutes = (value) => { const [hour, minute] = String(value).split(':').map(Number); return hour * 60 + minute; };
    const start = minutes(preference.quiet_hours_start); const end = minutes(preference.quiet_hours_end);
    return start <= end ? current >= start && current < end : current >= start || current < end;
  } catch { return true; }
};

const resolveRecipientProfiles = async ({ congregationId, recipientScope }) => {
  let profilesQuery = supabase.from('church_crm_profiles').select('id').eq('congregation_id', congregationId).is('deleted_at', null).neq('consent_status', 'denied');
  if (recipientScope.type === 'group') {
    const { data: members, error } = await supabase.from('communication_group_members').select('profile_id,communication_groups!inner(congregation_id)').eq('group_id', recipientScope.id).eq('communication_groups.congregation_id', congregationId);
    if (error) throw error;
    profilesQuery = profilesQuery.in('id', (members || []).map((member) => member.profile_id));
  } else if (recipientScope.type === 'segment') {
    const { data: segment, error } = await supabase.from('person_segments').select('definition').eq('id', recipientScope.id).eq('congregation_id', congregationId).maybeSingle();
    if (error) throw error;
    if (!segment) throw Object.assign(new Error('Recipient segment was not found.'), { status: 400, code: 'SEGMENT_INVALID' });
    if (segment.definition?.lifecycleStatus) profilesQuery = profilesQuery.eq('lifecycle_status', segment.definition.lifecycleStatus);
    if (segment.definition?.tag) profilesQuery = profilesQuery.contains('tags', [segment.definition.tag]);
  }
  const { data: profiles, error: profileError } = await profilesQuery;
  if (profileError) throw profileError;
  const profileIds = (profiles || []).map((profile) => profile.id);
  const { data: preferences, error: preferenceError } = profileIds.length
    ? await supabase.from('communication_preferences').select('*').eq('congregation_id', congregationId).in('profile_id', profileIds)
    : { data: [], error: null };
  if (preferenceError) throw preferenceError;
  return { profiles: profiles || [], preferenceByProfile: new Map((preferences || []).map((preference) => [preference.profile_id, preference])) };
};

const planDeliveries = ({ profiles, preferenceByProfile, channels, status }) => profiles.flatMap((profile) => channels.map((channel) => {
  const preference = preferenceByProfile.get(profile.id);
  const disabled = preference?.unsubscribed_at || (channelPreference[channel] && preference?.[channelPreference[channel]] === false);
  const quiet = status === 'sent' && isWithinQuietHours(preference);
  return { profile_id: profile.id, channel, status: disabled ? 'suppressed' : quiet ? 'deferred_quiet_hours' : status === 'scheduled' ? 'scheduled' : 'queued' };
}));

// 1. Get a Direct Upload URL from Mux
router.post('/upload-url', authenticateUser, requireCapability('communications.write'), async (req, res) => {
  try {
    const upload = await getMux().video.uploads.create({
      new_asset_settings: {
        playback_policy: ['public'],
        video_quality: 'basic', // Cost-saving setting for mobile-first video
      },
      cors_origin: process.env.FRONTEND_URL || 'http://localhost:3100',
    });

    res.json({
      uploadId: upload.id,
      uploadUrl: upload.url, // The frontend will PUT the file here directly
    });
  } catch (error) {
    console.error('Mux upload error:', error);
    res.status(500).json({ error: 'Failed to generate upload URL' });
  }
});

// 2. Save the final message to Supabase
router.post('/save-message', authenticateUser, requireCapability('communications.write'), async (req, res, next) => {
 const { uploadId, title, messageType, messageBody, status = 'sent', scheduledAt, recipientScope = { type: 'all' }, channels = ['in_app'] } = req.body;
  if (!String(title || '').trim()) return res.status(400).json({ error: { code: 'TITLE_REQUIRED', message: 'A broadcast title is required.', fieldErrors: { title: 'Required' }, requestId: req.requestId } });
  if (!BROADCAST_TYPES.has(messageType)) return res.status(400).json({ error: { code: 'MESSAGE_TYPE_INVALID', message: 'Choose a supported broadcast type.', fieldErrors: { messageType: 'Invalid broadcast type' }, requestId: req.requestId } });
  if (!MESSAGE_STATUSES.has(status) || (status === 'scheduled' && !scheduledAt)) return res.status(400).json({ error: { code: 'MESSAGE_STATUS_INVALID', message: 'Scheduled broadcasts require a delivery time.', requestId: req.requestId } });
  if (!Array.isArray(channels) || channels.length === 0 || channels.some((channel) => !['in_app','email','sms','push'].includes(channel))) return res.status(400).json({ error: { code: 'CHANNEL_INVALID', message: 'Choose at least one supported delivery channel.', requestId: req.requestId } });

  try {
    const recipientPlan = status === 'draft' ? null : await resolveRecipientProfiles({ congregationId: req.congregationId, recipientScope });
    const plannedDeliveries = recipientPlan ? planDeliveries({ ...recipientPlan, channels, status }) : [];
    const eligibleCount = new Set(plannedDeliveries.filter((delivery) => !['suppressed'].includes(delivery.status)).map((delivery) => delivery.profile_id)).size;
    if (status !== 'draft' && eligibleCount === 0) return res.status(409).json({ error: { code: 'RECIPIENTS_EMPTY', message: 'No consented recipients are eligible for the selected channels.', requestId: req.requestId } });
    let assetId = null;
    let playbackId = null;

    // Only process Mux logic if an uploadId (video) was provided
    if (uploadId) {
        const upload = await getMux().video.uploads.retrieve(uploadId);
        assetId = upload.asset_id; 
        const asset = await getMux().video.assets.retrieve(assetId);
        playbackId = asset.playback_ids[0].id; 
    }

    const { data, error } = await supabase
      .from('pastoral_messages')
      .insert({
        congregation_id: req.congregationId,
        author_id: req.user.id,
        video_asset_id: assetId,
        video_playback_id: playbackId,
        message_body: messageBody || null, // Save the rich text!
        title: String(title).trim(),
        message_type: messageType,
        is_published: status === 'sent',
        status,
        scheduled_at: status === 'scheduled' ? new Date(scheduledAt).toISOString() : null,
        sent_at: status === 'sent' ? new Date().toISOString() : null,
        recipient_scope: recipientScope,
        channels
      })
      .select()
      .single();

    if (error) throw error;
    if (status !== 'draft') {
      const deliveries = plannedDeliveries.map((delivery) => ({ ...delivery, congregation_id: req.congregationId, message_id: data.message_id }));
      if (deliveries.length) {
        const { error: deliveryError } = await supabase.from('message_deliveries').insert(deliveries);
        if (deliveryError) throw deliveryError;
      }
      const summary = deliveries.reduce((counts, delivery) => ({ ...counts, [delivery.status]: (counts[delivery.status] || 0) + 1 }), {});
      await supabase.from('pastoral_messages').update({ delivery_summary: summary }).eq('message_id', data.message_id);
      data.delivery_summary = summary;
    }
    if (status === 'sent' && channels.includes('push')) {
      const pushResult = await sendPushToCongregation(req.congregationId, 'New Congregation Broadcast', `New ${messageType.replace('_', ' ')}: "${title}"`, { route: '/(tabs)/church' });
      console.log('[Messages] Push result:', pushResult);
    }
    await supabase.from('audit_events').insert({ congregation_id: req.congregationId, actor_user_id: req.user.id, action: `communication.${status}`, resource_type: 'pastoral_message', resource_id: String(data.message_id), request_id: req.requestId, metadata: { channels, recipientScope } });
    res.json(data);
  } catch (error) {
    next(error);
  }
});

router.post('/preview', authenticateUser, requireCapability('communications.write'), async (req, res, next) => {
  const title = String(req.body?.title || '').trim();
  const messageBody = String(req.body?.messageBody || '').trim();
  if (!title || !messageBody) return res.status(400).json({ error: { code: 'PREVIEW_INVALID', message: 'Title and message body are required.', requestId: req.requestId } });
  try {
    const channels = Array.isArray(req.body.channels) ? req.body.channels : ['in_app'];
    const recipientScope = req.body.recipientScope || { type: 'all' };
    const recipientPlan = await resolveRecipientProfiles({ congregationId: req.congregationId, recipientScope });
    const deliveries = planDeliveries({ ...recipientPlan, channels, status: 'sent' });
    const channelCounts = Object.fromEntries(channels.map((channel) => [channel, deliveries.filter((delivery) => delivery.channel === channel && delivery.status !== 'suppressed').length]));
    const eligibleRecipientCount = new Set(deliveries.filter((delivery) => delivery.status !== 'suppressed').map((delivery) => delivery.profile_id)).size;
    res.json({ data: { title, messageBody, messageType: req.body.messageType || 'announcement', channels, recipientScope, eligibleRecipientCount, channelCounts } });
  } catch (error) { next(error); }
});

router.post('/:messageId/test-send', authenticateUser, loadMessageCongregation, requireCapability('communications.write'), async (req, res, next) => {
  try {
    const destination = String(req.body?.destination || req.user.email || '').trim();
    if (!destination) return res.status(400).json({ error: { code: 'DESTINATION_REQUIRED', message: 'A test destination is required.', requestId: req.requestId } });
    await supabase.from('audit_events').insert({ congregation_id: req.congregationId, actor_user_id: req.user.id, action: 'communication.test_sent', resource_type: 'pastoral_message', resource_id: req.params.messageId, request_id: req.requestId, metadata: { destinationMasked: destination.replace(/(^.).*(@.*$)/, '$1***$2') } });
    res.json({ data: { accepted: true } });
  } catch (error) { next(error); }
});

router.post('/:messageId/archive', authenticateUser, loadMessageCongregation, requireCapability('communications.write'), async (req, res, next) => {
  try {
    const now = new Date().toISOString();
    const { data, error } = await supabase.from('pastoral_messages').update({ archived_at: now, archived_by: req.user.id }).eq('message_id', req.params.messageId).eq('congregation_id', req.congregationId).select('message_id,archived_at').single();
    if (error) throw error;
    await supabase.from('audit_events').insert({ congregation_id: req.congregationId, actor_user_id: req.user.id, action: 'communication.archived', resource_type: 'pastoral_message', resource_id: req.params.messageId, request_id: req.requestId });
    res.json({ data });
  } catch (error) { next(error); }
});

router.post('/deliveries/:deliveryId/retry', authenticateUser, requireCapability('communications.write'), async (req, res, next) => {
  try {
    const { data, error } = await supabase.from('message_deliveries').update({ status: 'queued', failure_code: null, failure_message: null }).eq('id', req.params.deliveryId).eq('congregation_id', req.congregationId).select().maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Delivery not found.', requestId: req.requestId } });
    await supabase.from('audit_events').insert({ congregation_id: req.congregationId, actor_user_id: req.user.id, action: 'communication.delivery_retried', resource_type: 'message_delivery', resource_id: req.params.deliveryId, request_id: req.requestId });
    res.json({ data });
  } catch (error) { next(error); }
});

async function loadMessageCongregation(req, res, next) {
  const { data, error } = await supabase
    .from('pastoral_messages')
    .select('message_id, congregation_id')
    .eq('message_id', req.params.messageId)
    .maybeSingle();

  if (error) return next(error);
  // Do not disclose whether a message exists to an unauthorized caller.
  if (!data) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Message not found.', requestId: req.requestId } });
  req.messageRecord = data;
  req.params.congregationId = String(data.congregation_id);
  next();
}

router.get('/detail/:messageId', authenticateUser, loadMessageCongregation, requireCapability('communications.read'), async (req, res) => {
  try {
    const { messageId } = req.params;
    const { data, error } = await supabase
      .from('pastoral_messages')
      .select('*')
      .eq('message_id', messageId)
      .eq('congregation_id', req.congregationId)
      .single();

    if (error) throw error;
    res.json(data);
  } catch (error) {
    console.error('Error fetching message details:', error);
    res.status(500).json({ error: 'Failed to fetch message details' });
  }
});

module.exports = router;
