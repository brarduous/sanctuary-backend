const express = require('express');
const supabase = require('../config/supabase');
const authenticateUser = require('../middleware/auth');
const { requireCapability } = require('../middleware/authorization');
const { aiLimiter } = require('../middleware/limiters');
const { callStructuredResponse, QUALITY_MODEL } = require('../utils/openaiResponses');
const { sendPushToUsers } = require('../utils/push');
const { ITEM_TYPES, requiredSlots, slugify, journeyReminderAt, extractScriptureReferences } = require('../utils/contentPacks');

const router = express.Router();
const ITEM_STATES = new Set(['draft','in_review','approved','rejected','published']);

const packSchema = {
  type: 'object', additionalProperties: false, required: ['items'], properties: {
    items: { type: 'array', items: { type: 'object', additionalProperties: false,
      required: ['itemType','sequence','title','body','scriptureReferences','sourceExcerpts','reviewWarnings'],
      properties: {
        itemType: { type: 'string', enum: [...ITEM_TYPES] }, sequence: { type: 'integer' }, title: { type: 'string' }, body: { type: 'string' },
        scriptureReferences: { type: 'array', items: { type: 'string' } }, sourceExcerpts: { type: 'array', items: { type: 'string' } }, reviewWarnings: { type: 'array', items: { type: 'string' } },
      },
    } },
  },
};

const audit = (req, action, resourceType, resourceId, metadata = {}) => supabase.from('audit_events').insert({ congregation_id: req.congregationId, actor_user_id: req.user.id, action, resource_type: resourceType, resource_id: String(resourceId), request_id: req.requestId, metadata });

async function loadPack(req, res, next) {
  const { data, error } = await supabase.from('sermon_content_packs').select('*').eq('id', req.params.packId).maybeSingle();
  if (error) return next(error);
  if (!data) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Content Pack not found.', requestId: req.requestId } });
  req.pack = data; req.params.congregationId = String(data.congregation_id); next();
}

async function loadItem(req, res, next) {
  const { data, error } = await supabase.from('content_pack_items').select('*,sermon_content_packs(*)').eq('id', req.params.itemId).maybeSingle();
  if (error) return next(error);
  if (!data) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Content Pack item not found.', requestId: req.requestId } });
  req.item = data; req.params.congregationId = String(data.congregation_id); next();
}

async function generateItems(sermon, selectedSlots = requiredSlots) {
  const source = String(sermon.transcript || sermon.sermon_body || '').slice(0, 65000);
  if (!source.trim()) throw Object.assign(new Error('Add a sermon manuscript or transcript before generating a Content Pack.'), { status: 409, code: 'SERMON_SOURCE_REQUIRED' });
  const requested = selectedSlots.map(([type, sequence]) => `${type} #${sequence}`).join(', ');
  const response = await callStructuredResponse({
    instructions: `You assist a Christian ministry leader by transforming their supplied sermon into pastoral resources. Generate only the requested resources. Stay faithful to the source; do not invent quotations, doctrine, events, or claims. Each item must cite short exact source excerpts and scripture references it uses. Put any uncertainty in reviewWarnings. AI assists ministry and never speaks as God or impersonates the pastor.`,
    input: `SERMON TITLE: ${sermon.title || 'Untitled'}\nSCRIPTURE: ${sermon.scripture || ''}\nREQUESTED ITEMS: ${requested}\n\nSERMON SOURCE:\n${source}`,
    schema: packSchema, schemaName: 'sermon_content_pack', maxOutputTokens: 18000,
  });
  const allowed = new Set(selectedSlots.map(([type, sequence]) => `${type}:${sequence}`));
  const items = response.data.items.filter((item) => allowed.has(`${item.itemType}:${item.sequence}`));
  const returned = new Set(items.map((item) => `${item.itemType}:${item.sequence}`));
  const missing = [...allowed].filter((slot) => !returned.has(slot));
  if (missing.length) throw Object.assign(new Error(`Content Pack generation was incomplete. Missing: ${missing.join(', ')}.`), { code: 'CONTENT_PACK_INCOMPLETE' });
  return { response, items };
}

router.post('/sermons/:sermonId/content-pack/generate', authenticateUser, aiLimiter, requireCapability('content.write'), async (req, res, next) => {
  const started = Date.now();
  try {
    const { data: sermon, error } = await supabase.from('sermons').select('*').eq('sermon_id', req.params.sermonId).eq('user_id', req.user.id).maybeSingle();
    if (error) throw error;
    if (!sermon) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Sermon not found.', requestId: req.requestId } });
    const congregationId = Number(req.congregationId);
    const { data: congregation, error: congregationError } = await supabase.from('congregations').select('feature_flags').eq('congregation_id', congregationId).maybeSingle();
    if (congregationError) throw congregationError;
    if (congregation?.feature_flags?.sermonToSanctuary === false) return res.status(404).json({ error: { code: 'FEATURE_DISABLED', message: 'Sermon to Sanctuary is not enabled for this congregation.', requestId: req.requestId } });
    const extractedReferences = extractScriptureReferences(`${sermon.scripture || ''}\n${sermon.transcript || sermon.sermon_body || ''}`);
    await supabase.from('sermons').update({ congregation_id: congregationId, extracted_scripture_references: extractedReferences, source_processed_at: sermon.source_processed_at || new Date().toISOString() }).eq('sermon_id', sermon.sermon_id);
    const sourceSnapshot = { title: sermon.title, scripture: sermon.scripture, bodyUpdatedAt: sermon.updated_at, sourceType: sermon.source_type || 'editor' };
    const { data: pack, error: packError } = await supabase.from('sermon_content_packs').upsert({ sermon_id: sermon.sermon_id, congregation_id: congregationId, owner_user_id: req.user.id, title: `${sermon.title || 'Sermon'} — Weekly Journey`, status: 'generating', source_snapshot: sourceSnapshot, generation_error: null, updated_at: new Date().toISOString() }, { onConflict: 'sermon_id,congregation_id' }).select().single();
    if (packError) throw packError;
    try {
      const generated = await generateItems(sermon);
      const { data: protectedItems, error: protectedError } = await supabase.from('content_pack_items').select('item_type,sequence').eq('pack_id', pack.id).in('status', ['approved','published']);
      if (protectedError) throw protectedError;
      const protectedSlots = new Set((protectedItems || []).map((item) => `${item.item_type}:${item.sequence}`));
      const rows = generated.items.filter((item) => !protectedSlots.has(`${item.itemType}:${item.sequence}`)).map((item) => ({ pack_id: pack.id, congregation_id: congregationId, item_type: item.itemType, sequence: item.sequence, title: item.title, content: { body: item.body }, source_excerpts: item.sourceExcerpts, scripture_references: item.scriptureReferences, review_warnings: item.reviewWarnings, generated_by: generated.response.model || QUALITY_MODEL, generated_at: new Date().toISOString() }));
      const { error: deleteError } = await supabase.from('content_pack_items').delete().eq('pack_id', pack.id).in('status', ['draft','in_review','rejected']);
      if (deleteError) throw deleteError;
      const { data: items, error: itemError } = rows.length ? await supabase.from('content_pack_items').insert(rows).select() : { data: [], error: null };
      if (itemError) throw itemError;
      const generationStatus = { requested: requiredSlots.length, generated: items.length, preservedApproved: protectedSlots.size, model: generated.response.model, durationMs: Date.now() - started, usage: generated.response.usage };
      await supabase.from('sermon_content_packs').update({ status: 'in_review', generation_status: generationStatus, updated_at: new Date().toISOString() }).eq('id', pack.id);
      await audit(req, 'content_pack.generated', 'sermon_content_pack', pack.id, generationStatus);
      res.status(201).json({ data: { ...pack, status: 'in_review', generation_status: generationStatus, items } });
    } catch (generationError) {
      await supabase.from('sermon_content_packs').update({ status: 'failed', generation_error: generationError.message, updated_at: new Date().toISOString() }).eq('id', pack.id);
      throw generationError;
    }
  } catch (error) { next(error); }
});

router.get('/sermons/:sermonId/content-pack', authenticateUser, async (req, res, next) => {
  try {
    const { data: pack, error } = await supabase.from('sermon_content_packs').select('*').eq('sermon_id', req.params.sermonId).eq('owner_user_id', req.user.id).maybeSingle();
    if (error) throw error;
    if (!pack) return res.json({ data: null });
    const { data: items, error: itemsError } = await supabase.from('content_pack_items').select('*').eq('pack_id', pack.id).order('item_type').order('sequence').order('revision', { ascending: false });
    if (itemsError) throw itemsError;
    const { data: publication, error: pubError } = await supabase.from('church_content_publications').select('*').eq('pack_id', pack.id).maybeSingle();
    if (pubError) throw pubError;
    res.json({ data: { ...pack, items, publication } });
  } catch (error) { next(error); }
});

router.patch('/content-pack/items/:itemId', authenticateUser, loadItem, requireCapability('content.write'), async (req, res, next) => {
  try {
    if (req.item.status === 'published') return res.status(409).json({ error: { code: 'PUBLISHED_ITEM_IMMUTABLE', message: 'Published content must be corrected through a new revision.', requestId: req.requestId } });
    const title = req.body.title === undefined ? req.item.title : String(req.body.title).trim();
    const content = req.body.content === undefined ? req.item.content : req.body.content;
    if (!title || !content || typeof content !== 'object') return res.status(400).json({ error: { code: 'ITEM_INVALID', message: 'Title and structured content are required.', requestId: req.requestId } });
    await supabase.from('content_pack_item_revisions').insert({ item_id: req.item.id, pack_id: req.item.pack_id, congregation_id: req.congregationId, revision: req.item.revision, title: req.item.title, content: req.item.content, status: req.item.status, source_excerpts: req.item.source_excerpts, scripture_references: req.item.scripture_references, changed_by: req.user.id, change_reason: 'manual_edit' });
    const { data, error } = await supabase.from('content_pack_items').update({ title, content, status: 'in_review', revision: req.item.revision + 1, reviewed_by: null, reviewed_at: null, approved_at: null, updated_at: new Date().toISOString() }).eq('id', req.item.id).select().single();
    if (error) throw error;
    await audit(req, 'content_pack.item_edited', 'content_pack_item', data.id, { revision: data.revision });
    res.json({ data });
  } catch (error) { next(error); }
});

router.post('/content-pack/items/:itemId/status', authenticateUser, loadItem, requireCapability('content.write'), async (req, res, next) => {
  try {
    const status = String(req.body.status || '');
    if (!ITEM_STATES.has(status) || status === 'published') return res.status(400).json({ error: { code: 'STATUS_INVALID', message: 'Choose draft, in_review, approved, or rejected.', requestId: req.requestId } });
    const now = new Date().toISOString();
    const { data, error } = await supabase.from('content_pack_items').update({ status, reviewed_by: req.user.id, reviewed_at: now, approved_at: status === 'approved' ? now : null, rejected_at: status === 'rejected' ? now : null, updated_at: now }).eq('id', req.item.id).select().single();
    if (error) throw error;
    await audit(req, `content_pack.item_${status}`, 'content_pack_item', data.id, { warningsVisible: true });
    res.json({ data });
  } catch (error) { next(error); }
});

router.post('/content-packs/:packId/bulk-approve', authenticateUser, loadPack, requireCapability('content.write'), async (req, res, next) => {
  try {
    const itemIds = Array.isArray(req.body.itemIds) ? [...new Set(req.body.itemIds.map(String))] : [];
    if (!itemIds.length || req.body.confirmReviewed !== true) return res.status(400).json({ error: { code: 'REVIEW_CONFIRMATION_REQUIRED', message: 'Select items and confirm they were individually reviewed.', requestId: req.requestId } });
    const now = new Date().toISOString();
    const { data, error } = await supabase.from('content_pack_items').update({ status: 'approved', reviewed_by: req.user.id, reviewed_at: now, approved_at: now, updated_at: now }).eq('pack_id', req.pack.id).in('id', itemIds).in('status', ['draft','in_review']).select();
    if (error) throw error;
    await audit(req, 'content_pack.bulk_approved', 'sermon_content_pack', req.pack.id, { itemIds: (data || []).map((item) => item.id) });
    res.json({ data });
  } catch (error) { next(error); }
});

router.post('/content-pack/items/:itemId/regenerate', authenticateUser, aiLimiter, loadItem, requireCapability('content.write'), async (req, res, next) => {
  try {
    const pack = req.item.sermon_content_packs;
    const { data: sermon, error } = await supabase.from('sermons').select('*').eq('sermon_id', pack.sermon_id).maybeSingle();
    if (error) throw error;
    const generated = await generateItems(sermon, [[req.item.item_type, req.item.sequence]]);
    const item = generated.items[0];
    if (!item) throw new Error('The generator did not return the requested resource.');
    const nextRevision = req.item.revision + 1;
    const { data, error: insertError } = await supabase.from('content_pack_items').insert({ pack_id: pack.id, congregation_id: req.congregationId, item_type: item.itemType, sequence: item.sequence, title: item.title, content: { body: item.body }, status: 'draft', generation_version: req.item.generation_version + 1, revision: nextRevision, source_excerpts: item.sourceExcerpts, scripture_references: item.scriptureReferences, review_warnings: item.reviewWarnings, generated_by: generated.response.model, generated_at: new Date().toISOString() }).select().single();
    if (insertError) throw insertError;
    await audit(req, 'content_pack.item_regenerated', 'content_pack_item', data.id, { priorItemId: req.item.id });
    res.status(201).json({ data });
  } catch (error) { next(error); }
});

async function resolveUsers(congregationId, scope) {
  let query = supabase.from('church_crm_profiles').select('id,user_id').eq('congregation_id', congregationId).not('user_id', 'is', null).is('deleted_at', null).neq('consent_status', 'denied');
  if (scope.type === 'group') {
    const { data } = await supabase.from('communication_group_members').select('profile_id,communication_groups!inner(congregation_id)').eq('group_id', scope.id).eq('communication_groups.congregation_id', congregationId);
    query = query.in('id', (data || []).map((row) => row.profile_id));
  } else if (scope.type === 'segment') {
    const { data: segment } = await supabase.from('person_segments').select('definition').eq('id', scope.id).eq('congregation_id', congregationId).maybeSingle();
    if (!segment) throw Object.assign(new Error('Recipient segment was not found.'), { status: 400, code: 'SEGMENT_INVALID' });
    if (segment.definition?.lifecycleStatus) query = query.eq('lifecycle_status', segment.definition.lifecycleStatus);
    if (segment.definition?.tag) query = query.contains('tags', [segment.definition.tag]);
  }
  const { data, error } = await query;
  if (error) throw error;
  return [...new Set((data || []).map((row) => row.user_id).filter(Boolean))];
}

async function previewPublication(pack, body) {
  const { data: approved, error } = await supabase.from('content_pack_items').select('*').eq('pack_id', pack.id).eq('status', 'approved');
  if (error) throw error;
  const scope = body.recipientScope || { type: 'all' };
  const users = await resolveUsers(pack.congregation_id, scope);
  return { approvedItems: approved || [], recipientScope: scope, eligibleRecipientCount: users.length, startsAt: body.startsAt || new Date().toISOString(), pushMode: body.pushMode || 'none', pushTitle: body.pushTitle || `A new weekly journey is ready`, pushBody: body.pushBody || pack.title };
}

router.post('/content-packs/:packId/publication-preview', authenticateUser, loadPack, requireCapability('communications.write'), async (req, res, next) => {
  try { res.json({ data: await previewPublication(req.pack, req.body || {}) }); } catch (error) { next(error); }
});

router.post('/content-packs/:packId/publish', authenticateUser, loadPack, requireCapability('communications.write'), async (req, res, next) => {
  try {
    const preview = await previewPublication(req.pack, req.body || {});
    if (!preview.approvedItems.length) return res.status(409).json({ error: { code: 'NO_APPROVED_ITEMS', message: 'Approve at least one reviewed item before publishing.', requestId: req.requestId } });
    const pushMode = String(req.body.pushMode || 'none');
    if (!['none','now','scheduled'].includes(pushMode)) return res.status(400).json({ error: { code: 'PUSH_MODE_INVALID', message: 'Choose none, now, or scheduled.', requestId: req.requestId } });
    const startsAt = new Date(preview.startsAt);
    const firstNotificationAt = pushMode === 'scheduled' ? new Date(req.body.firstNotificationAt || '') : pushMode === 'now' ? new Date() : null;
    if (Number.isNaN(startsAt.getTime()) || (firstNotificationAt && Number.isNaN(firstNotificationAt.getTime()))) return res.status(400).json({ error: { code: 'SCHEDULE_INVALID', message: 'Provide valid publication and notification times.', requestId: req.requestId } });
    const slug = `${slugify(req.body.slug || req.pack.title)}-${req.pack.id.slice(0, 8)}`;
    const payload = { pack_id: req.pack.id, congregation_id: req.pack.congregation_id, slug, title: req.body.title || req.pack.title, description: req.body.description || null, status: startsAt > new Date() ? 'scheduled' : 'published', starts_at: startsAt.toISOString(), daily_release_time: req.body.dailyReleaseTime || '08:00', time_zone: req.body.timeZone || 'America/New_York', recipient_scope: preview.recipientScope, push_mode: pushMode, push_title: preview.pushTitle, push_body: preview.pushBody, first_notification_at: firstNotificationAt?.toISOString() || null, published_at: startsAt <= new Date() ? new Date().toISOString() : null, created_by: req.user.id, updated_at: new Date().toISOString() };
    const { data: publication, error } = await supabase.from('church_content_publications').upsert(payload, { onConflict: 'pack_id' }).select().single();
    if (error) throw error;
    await supabase.from('church_content_publication_items').delete().eq('publication_id', publication.id);
    const publicationItems = preview.approvedItems.map((item, index) => ({ publication_id: publication.id, item_id: item.id, congregation_id: req.pack.congregation_id, release_day: ['daily_devotional','guided_prayer'].includes(item.item_type) ? Math.max(0, item.sequence - 1) : 0, display_order: index }));
    const { error: publicationItemError } = await supabase.from('church_content_publication_items').insert(publicationItems);
    if (publicationItemError) throw publicationItemError;
    await supabase.from('content_pack_items').update({ status: 'published', updated_at: new Date().toISOString() }).in('id', preview.approvedItems.map((item) => item.id));
    await supabase.from('sermon_content_packs').update({ status: 'published', updated_at: new Date().toISOString() }).eq('id', req.pack.id);
    if (firstNotificationAt) {
      const userIds = await resolveUsers(req.pack.congregation_id, preview.recipientScope);
      const key = `${publication.id}:launch`;
      const dailyItems = preview.approvedItems.filter((item) => item.item_type === 'daily_devotional' && item.sequence > 1).sort((a, b) => a.sequence - b.sequence);
      const deliveries = userIds.flatMap((userId) => [
        { publication_id: publication.id, congregation_id: req.pack.congregation_id, user_id: userId, delivery_key: key, scheduled_for: firstNotificationAt.toISOString(), metadata: { type: 'journey_launch', preference: 'churchJourneys' } },
        ...dailyItems.map((item) => ({ publication_id: publication.id, congregation_id: req.pack.congregation_id, user_id: userId, item_id: item.id, delivery_key: `${publication.id}:day:${Math.max(0, item.sequence - 1)}`, scheduled_for: journeyReminderAt(startsAt, Math.max(0, item.sequence - 1), payload.daily_release_time, payload.time_zone).toISOString(), metadata: { type: 'journey_reminder', preference: 'journeyReminders' } })),
      ]);
      if (deliveries.length) await supabase.from('church_content_notification_deliveries').upsert(deliveries, { onConflict: 'delivery_key,user_id', ignoreDuplicates: true });
      if (pushMode === 'now') await dispatchDuePublicationNotifications(new Date(), publication.id);
    }
    await audit(req, `content_pack.${publication.status}`, 'church_content_publication', publication.id, { pushMode, recipientScope: preview.recipientScope, itemCount: preview.approvedItems.length });
    res.status(201).json({ data: { ...publication, itemCount: preview.approvedItems.length, eligibleRecipientCount: preview.eligibleRecipientCount } });
  } catch (error) { next(error); }
});

router.post('/publications/:publicationId/unpublish', authenticateUser, async (req, res, next) => {
  try {
    const { data: publication, error } = await supabase.from('church_content_publications').select('*').eq('id', req.params.publicationId).maybeSingle();
    if (error) throw error;
    if (!publication) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Publication not found.', requestId: req.requestId } });
    req.params.congregationId = String(publication.congregation_id);
    return requireCapability('communications.write')(req, res, async () => {
      const now = new Date().toISOString();
      const status = publication.status === 'scheduled' ? 'cancelled' : 'unpublished';
      const { data, error: updateError } = await supabase.from('church_content_publications').update({ status, cancelled_at: status === 'cancelled' ? now : null, unpublished_at: status === 'unpublished' ? now : null, updated_at: now }).eq('id', publication.id).select().single();
      if (updateError) return next(updateError);
      await supabase.from('church_content_notification_deliveries').update({ status: 'cancelled', updated_at: now }).eq('publication_id', publication.id).eq('status', 'planned');
      await audit(req, `content_pack.${status}`, 'church_content_publication', publication.id);
      res.json({ data });
    });
  } catch (error) { next(error); }
});

async function requireMember(userId, congregationId) {
  const { data, error } = await supabase.from('congregation_members').select('member_id').eq('user_id', userId).eq('congregation_id', congregationId).maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

async function hydratePublication(publication, userId) {
  const { data: links, error } = await supabase.from('church_content_publication_items').select('release_day,display_order,content_pack_items(*)').eq('publication_id', publication.id).order('display_order');
  if (error) throw error;
  const { data: progress } = await supabase.from('church_content_progress').select('*').eq('publication_id', publication.id).eq('user_id', userId);
  const progressByItem = new Map((progress || []).map((row) => [row.item_id, row]));
  const elapsed = Math.max(0, Math.floor((Date.now() - new Date(publication.starts_at).getTime()) / 86400000));
  return { ...publication, items: (links || []).filter((link) => link.release_day <= elapsed).map((link) => ({ ...link.content_pack_items, releaseDay: link.release_day, progress: progressByItem.get(link.content_pack_items.id) || null })) };
}

router.get('/congregations/:congregationId/journeys', authenticateUser, async (req, res, next) => {
  try {
    if (!await requireMember(req.user.id, Number(req.params.congregationId))) return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'This content is available to congregation members.', requestId: req.requestId } });
    const { data, error } = await supabase.from('church_content_publications').select('id,slug,title,description,starts_at,published_at,updated_at,pack_id').eq('congregation_id', req.params.congregationId).eq('status', 'published').lte('starts_at', new Date().toISOString()).order('starts_at', { ascending: false }).limit(20);
    if (error) throw error;
    res.json({ data: data || [] });
  } catch (error) { next(error); }
});

router.get('/journeys/:journeyId', authenticateUser, async (req, res, next) => {
  try {
    const { data, error } = await supabase.from('church_content_publications').select('*,sermon_content_packs(sermon_id,sermons(title,scripture,illustration_image_url,thumbnail_url))').or(`id.eq.${req.params.journeyId},slug.eq.${req.params.journeyId}`).eq('status', 'published').maybeSingle();
    if (error) throw error;
    if (!data || !await requireMember(req.user.id, data.congregation_id)) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Journey not found.', requestId: req.requestId } });
    res.json({ data: await hydratePublication(data, req.user.id) });
  } catch (error) { next(error); }
});

router.put('/journeys/:journeyId/items/:itemId/progress', authenticateUser, async (req, res, next) => {
  try {
    const { data: publication, error } = await supabase.from('church_content_publications').select('id,congregation_id,status').eq('id', req.params.journeyId).eq('status', 'published').maybeSingle();
    if (error) throw error;
    if (!publication || !await requireMember(req.user.id, publication.congregation_id)) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Journey not found.', requestId: req.requestId } });
    const { data: link } = await supabase.from('church_content_publication_items').select('item_id').eq('publication_id', publication.id).eq('item_id', req.params.itemId).maybeSingle();
    if (!link) return res.status(404).json({ error: { code: 'ITEM_NOT_FOUND', message: 'Journey item not found.', requestId: req.requestId } });
    const now = new Date().toISOString();
    const payload = { publication_id: publication.id, item_id: link.item_id, congregation_id: publication.congregation_id, user_id: req.user.id, opened_at: req.body.opened === false ? null : now, completed_at: req.body.completed === true ? now : req.body.completed === false ? null : undefined, saved_at: req.body.saved === true ? now : req.body.saved === false ? null : undefined, response: req.body.response && typeof req.body.response === 'object' ? req.body.response : {}, updated_at: now };
    Object.keys(payload).forEach((key) => payload[key] === undefined && delete payload[key]);
    const { data, error: upsertError } = await supabase.from('church_content_progress').upsert(payload, { onConflict: 'publication_id,item_id,user_id' }).select().single();
    if (upsertError) throw upsertError;
    res.json({ data });
  } catch (error) { next(error); }
});

router.get('/content-packs/:packId/impact', authenticateUser, loadPack, requireCapability('content.read'), async (req, res, next) => {
  try {
    const { data: publication } = await supabase.from('church_content_publications').select('id').eq('pack_id', req.pack.id).maybeSingle();
    if (!publication) return res.json({ data: { opens: 0, starts: 0, completions: 0 } });
    const { data, error } = await supabase.from('church_content_progress').select('user_id,opened_at,completed_at').eq('publication_id', publication.id);
    if (error) throw error;
    res.json({ data: { opens: (data || []).filter((row) => row.opened_at).length, starts: new Set((data || []).filter((row) => row.opened_at).map((row) => row.user_id)).size, completions: (data || []).filter((row) => row.completed_at).length } });
  } catch (error) { next(error); }
});

async function dispatchDuePublicationNotifications(now = new Date(), publicationId = null) {
  await supabase.from('church_content_publications').update({ status: 'published', published_at: now.toISOString(), updated_at: now.toISOString() }).eq('status', 'scheduled').lte('starts_at', now.toISOString());
  let query = supabase.from('church_content_notification_deliveries').select('*,church_content_publications(title,push_title,push_body,slug,status)').eq('status', 'planned').lte('scheduled_for', now.toISOString()).limit(500);
  if (publicationId) query = query.eq('publication_id', publicationId);
  const { data, error } = await query;
  if (error) throw error;
  const summary = { attempted: 0, accepted: 0, suppressed: 0, failed: 0 };
  for (const delivery of data || []) {
    if (delivery.church_content_publications?.status !== 'published') { await supabase.from('church_content_notification_deliveries').update({ status: 'cancelled' }).eq('id', delivery.id); continue; }
    const { data: claimed, error: claimError } = await supabase.from('church_content_notification_deliveries').update({ status: 'attempted', attempted_at: now.toISOString(), updated_at: now.toISOString() }).eq('id', delivery.id).eq('status', 'planned').select('id').maybeSingle();
    if (claimError) throw claimError;
    if (!claimed) continue;
    const { data: profile } = await supabase.from('user_profiles').select('user_preferences').eq('user_id', delivery.user_id).maybeSingle();
    const preference = delivery.metadata?.preference || 'churchJourneys';
    const enabled = profile?.user_preferences?.notifications?.[preference] !== false;
    if (!enabled) { summary.suppressed++; await supabase.from('church_content_notification_deliveries').update({ status: 'suppressed', updated_at: now.toISOString() }).eq('id', delivery.id).eq('status', 'attempted'); continue; }
    summary.attempted++;
    try {
      const pub = delivery.church_content_publications;
      const isReminder = delivery.metadata?.type === 'journey_reminder';
      const result = await sendPushToUsers({ userIds: [delivery.user_id], title: isReminder ? 'Today’s church reflection is ready' : pub.push_title || 'A new weekly journey is ready', body: isReminder ? pub.title : pub.push_body || pub.title, data: { url: `/church/journey/${delivery.publication_id}${delivery.item_id ? `?step=${delivery.item_id}` : ''}`, contentType: 'church_journey', journeyId: delivery.publication_id, stepId: delivery.item_id, congregationId: delivery.congregation_id, notificationDeliveryId: delivery.id }, preference });
      const accepted = result.sent > 0;
      summary[accepted ? 'accepted' : 'suppressed']++;
      await supabase.from('church_content_notification_deliveries').update({ status: accepted ? 'accepted' : 'suppressed', accepted_at: accepted ? now.toISOString() : null, updated_at: now.toISOString() }).eq('id', delivery.id).eq('status', 'attempted');
    } catch (pushError) {
      summary.failed++; await supabase.from('church_content_notification_deliveries').update({ status: 'failed', failure_code: pushError.code || 'PUSH_FAILED', metadata: { error: pushError.message }, updated_at: now.toISOString() }).eq('id', delivery.id).eq('status', 'attempted');
    }
  }
  return summary;
}

router.post('/notifications/church-content/dispatch', async (req, res, next) => {
  if (req.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) return res.status(401).json({ error: 'Unauthorized' });
  try { res.json({ data: await dispatchDuePublicationNotifications(new Date()) }); } catch (error) { next(error); }
});

router.post('/notifications/church-content/open', authenticateUser, async (req, res, next) => {
  try {
    const { data, error } = await supabase.from('church_content_notification_deliveries').update({ status: 'opened', opened_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', req.body.deliveryId).eq('user_id', req.user.id).in('status', ['accepted','opened']).select('id').maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Notification delivery not found.', requestId: req.requestId } });
    res.json({ data });
  } catch (error) { next(error); }
});

router.post('/notifications/church-content/:deliveryId/retry', authenticateUser, async (req, res, next) => {
  try {
    const { data: delivery, error } = await supabase.from('church_content_notification_deliveries').select('id,congregation_id,publication_id').eq('id', req.params.deliveryId).maybeSingle();
    if (error) throw error;
    if (!delivery) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Delivery not found.', requestId: req.requestId } });
    req.params.congregationId = String(delivery.congregation_id);
    return requireCapability('communications.write')(req, res, async () => {
      const { data, error: updateError } = await supabase.from('church_content_notification_deliveries').update({ status: 'planned', failure_code: null, scheduled_for: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', delivery.id).in('status', ['failed','suppressed']).select().maybeSingle();
      if (updateError) return next(updateError);
      await audit(req, 'content_pack.notification_retried', 'church_content_notification_delivery', delivery.id);
      res.json({ data });
    });
  } catch (error) { next(error); }
});

module.exports = { router, dispatchDuePublicationNotifications };
