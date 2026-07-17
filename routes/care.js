const express = require('express');
const supabase = require('../config/supabase');
const authenticateUser = require('../middleware/auth');
const { requireCapability } = require('../middleware/authorization');

const router = express.Router();
const priorities = new Set(['low', 'normal', 'high', 'urgent']);
const statuses = new Set(['open', 'in_progress', 'waiting', 'resolved', 'closed']);

router.get('/:congregationId', authenticateUser, requireCapability('care.read'), async (req, res, next) => {
  try {
    let query = supabase.from('care_cases').select('*').eq('congregation_id', req.congregationId).is('deleted_at', null).order('created_at', { ascending: false });
    if (req.query.status) query = query.eq('status', req.query.status);
    if (req.query.assignee === 'me') query = query.eq('assignee_user_id', req.user.id);
    const { data, error } = await query;
    if (error) throw error;
    await supabase.from('audit_events').insert({ congregation_id: req.congregationId, actor_user_id: req.user.id, action: 'care.queue_accessed', resource_type: 'care_case', request_id: req.requestId, metadata: { resultCount: data.length } });
    res.json({ data });
  } catch (error) { next(error); }
});

router.post('/:congregationId', authenticateUser, requireCapability('care.write'), async (req, res, next) => {
  try {
    const title = String(req.body?.title || '').trim();
    if (!title) return res.status(400).json({ error: { code: 'TITLE_REQUIRED', message: 'A care-case title is required.', fieldErrors: { title: 'Required' }, requestId: req.requestId } });
    if (req.body.priority && !priorities.has(req.body.priority)) return res.status(400).json({ error: { code: 'PRIORITY_INVALID', message: 'Priority is invalid.', requestId: req.requestId } });
    const payload = {
      congregation_id: req.congregationId, profile_id: req.body.profileId || null, prayer_request_id: req.body.prayerRequestId || null,
      assignee_user_id: req.body.assigneeUserId || req.user.id, title, description: String(req.body.description || ''),
      priority: req.body.priority || 'normal', confidentiality: req.body.confidentiality || 'care_team', follow_up_at: req.body.followUpAt || null,
      reminder_at: req.body.reminderAt || null, retention_until: req.body.retentionUntil || null, created_by: req.user.id,
    };
    const { data, error } = await supabase.from('care_cases').insert(payload).select().single();
    if (error) throw error;
    await supabase.from('audit_events').insert({ congregation_id: req.congregationId, actor_user_id: req.user.id, action: 'care.created', resource_type: 'care_case', resource_id: data.id, request_id: req.requestId, metadata: { priority: data.priority, confidentiality: data.confidentiality } });
    res.status(201).json({ data });
  } catch (error) { next(error); }
});

router.patch('/:congregationId/:caseId', authenticateUser, requireCapability('care.write'), async (req, res, next) => {
  try {
    const allowed = new Set(['assignee_user_id','priority','status','follow_up_at','reminder_at','escalated_at','outcome','retention_until','title','description','confidentiality']);
    const updates = Object.fromEntries(Object.entries(req.body || {}).filter(([key]) => allowed.has(key)));
    if (updates.status && !statuses.has(updates.status)) return res.status(400).json({ error: { code: 'STATUS_INVALID', message: 'Care-case status is invalid.', requestId: req.requestId } });
    if (updates.priority && !priorities.has(updates.priority)) return res.status(400).json({ error: { code: 'PRIORITY_INVALID', message: 'Priority is invalid.', requestId: req.requestId } });
    updates.updated_at = new Date().toISOString();
    if (updates.status === 'closed') updates.closed_at = updates.updated_at;
    const { data, error } = await supabase.from('care_cases').update(updates).eq('id', req.params.caseId).eq('congregation_id', req.congregationId).is('deleted_at', null).select().maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Care case not found.', requestId: req.requestId } });
    await supabase.from('audit_events').insert({ congregation_id: req.congregationId, actor_user_id: req.user.id, action: 'care.updated', resource_type: 'care_case', resource_id: data.id, request_id: req.requestId, metadata: { fields: Object.keys(updates) } });
    res.json({ data });
  } catch (error) { next(error); }
});

module.exports = router;
