const crypto = require('crypto');
const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const authenticateUser = require('../middleware/auth');
const { requireCapability } = require('../middleware/authorization');

const snapshotHash = (snapshot) => crypto.createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');

router.post('/studio/studies/:studyId/ready', authenticateUser, async (req, res, next) => {
  try {
    const { data: study, error } = await supabase.from('bible_studies').select('*').eq('study_id', req.params.studyId).eq('user_id', req.user.id).maybeSingle();
    if (error) throw error;
    if (!study) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Study not found.', requestId: req.requestId } });
    const { data: lessons, error: lessonsError } = await supabase.from('bible_study_lessons').select('*').eq('study_id', study.study_id).order('lesson_number');
    if (lessonsError) throw lessonsError;
    if (!lessons?.length) return res.status(409).json({ error: { code: 'STUDY_INCOMPLETE', message: 'Add at least one lesson before handoff.', requestId: req.requestId } });
    const snapshot = { schemaVersion: 1, study: { ...study, congregation_id: undefined, is_published: undefined }, lessons };
    const contentHash = snapshotHash(snapshot);
    const { data: existing } = await supabase.from('bible_study_versions').select('*').eq('study_id', study.study_id).eq('content_hash', contentHash).maybeSingle();
    if (existing) return res.json({ data: existing, reused: true });
    const { data: latest } = await supabase.from('bible_study_versions').select('version_number').eq('study_id', study.study_id).order('version_number', { ascending: false }).limit(1).maybeSingle();
    await supabase.from('bible_study_versions').update({ status: 'superseded' }).eq('study_id', study.study_id).eq('status', 'ready');
    const { data: version, error: versionError } = await supabase.from('bible_study_versions').insert({ study_id: study.study_id, version_number: (latest?.version_number || 0) + 1, owner_user_id: req.user.id, snapshot, content_hash: contentHash }).select().single();
    if (versionError) throw versionError;
    res.status(201).json({ data: version, reused: false });
  } catch (error) { next(error); }
});

router.get('/clergy/study-deliveries', authenticateUser, requireCapability('communications.read'), async (req, res, next) => {
  try {
    const { data: memberships, error: membershipError } = await supabase.from('organization_memberships').select('user_id').eq('congregation_id', req.congregationId).eq('active', true);
    if (membershipError) throw membershipError;
    const ownerIds = (memberships || []).map((membership) => membership.user_id);
    const versionQuery = supabase.from('bible_study_versions').select('id,study_id,version_number,status,created_at,snapshot').in('status', ['ready','superseded']).order('created_at', { ascending: false });
    const { data: versions, error } = ownerIds.length ? await versionQuery.in('owner_user_id', ownerIds) : { data: [], error: null };
    if (error) throw error;
    const { data: deliveries, error: deliveryError } = await supabase.from('bible_study_deliveries').select('*').eq('congregation_id', req.congregationId).order('updated_at', { ascending: false });
    if (deliveryError) throw deliveryError;
    res.json({ data: { versions: versions || [], deliveries: deliveries || [] } });
  } catch (error) { next(error); }
});

router.post('/clergy/study-deliveries', authenticateUser, requireCapability('communications.write'), async (req, res, next) => {
  try {
    const { versionId, recipientScope = { type: 'all' }, placement = 'church_home', notifications = { in_app: true }, availableFrom, availableUntil, status = 'draft' } = req.body || {};
    if (!versionId) return res.status(400).json({ error: { code: 'VERSION_REQUIRED', message: 'Choose a ready Studio version.', requestId: req.requestId } });
    if (!['draft','scheduled','published'].includes(status)) return res.status(400).json({ error: { code: 'STATUS_INVALID', message: 'Choose draft, scheduled, or published.', requestId: req.requestId } });
    const from = availableFrom ? new Date(availableFrom) : new Date();
    const until = availableUntil ? new Date(availableUntil) : null;
    if (Number.isNaN(from.getTime()) || (until && (Number.isNaN(until.getTime()) || until <= from))) return res.status(400).json({ error: { code: 'AVAILABILITY_INVALID', message: 'The availability window is invalid.', requestId: req.requestId } });
    const effectiveStatus = status === 'published' && from > new Date() ? 'scheduled' : status;
    const { data, error } = await supabase.from('bible_study_deliveries').insert({ version_id: versionId, congregation_id: req.congregationId, created_by: req.user.id, status: effectiveStatus, recipient_scope: recipientScope, placement, notifications, available_from: from.toISOString(), available_until: until?.toISOString() || null, published_at: effectiveStatus === 'published' ? new Date().toISOString() : null }).select().single();
    if (error) throw error;
    res.status(201).json({ data });
  } catch (error) { next(error); }
});

router.patch('/clergy/study-deliveries/:deliveryId', authenticateUser, requireCapability('communications.write'), async (req, res, next) => {
  try {
    const allowed = Object.fromEntries(Object.entries(req.body || {}).filter(([key]) => ['recipient_scope','placement','notifications','available_from','available_until'].includes(key)));
    const { data, error } = await supabase.from('bible_study_deliveries').update({ ...allowed, updated_at: new Date().toISOString() }).eq('id', req.params.deliveryId).eq('congregation_id', req.congregationId).in('status', ['draft','scheduled']).select().maybeSingle();
    if (error) throw error;
    if (!data) return res.status(409).json({ error: { code: 'DELIVERY_IMMUTABLE', message: 'Published deliveries cannot be edited; unpublish and create a new delivery.', requestId: req.requestId } });
    res.json({ data });
  } catch (error) { next(error); }
});

router.post('/clergy/study-deliveries/:deliveryId/cancel', authenticateUser, requireCapability('communications.write'), async (req, res, next) => {
  try {
    const now = new Date().toISOString();
    const { data: current } = await supabase.from('bible_study_deliveries').select('status').eq('id', req.params.deliveryId).eq('congregation_id', req.congregationId).maybeSingle();
    if (!current) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Delivery not found.', requestId: req.requestId } });
    const status = current.status === 'published' ? 'unpublished' : 'cancelled';
    const { data, error } = await supabase.from('bible_study_deliveries').update({ status, cancelled_at: now, updated_at: now }).eq('id', req.params.deliveryId).select().single();
    if (error) throw error;
    res.json({ data });
  } catch (error) { next(error); }
});

module.exports = router;
