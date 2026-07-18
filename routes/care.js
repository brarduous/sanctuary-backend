const express = require('express');
const supabase = require('../config/supabase');
const authenticateUser = require('../middleware/auth');
const { requireCapability } = require('../middleware/authorization');

const router = express.Router();
const priorities = new Set(['low', 'normal', 'high', 'urgent']);
const statuses = new Set(['open', 'in_progress', 'waiting', 'resolved', 'closed']);
const confidentialityLevels = new Set(['standard', 'care_team', 'pastor_only']);

async function hasCapability(req, capability) {
  const { data, error } = await supabase.rpc('has_congregation_capability', {
    requested_congregation_id: req.congregationId,
    requested_capability: capability,
    requested_user_id: req.user.id,
    requested_campus_id: req.body?.campusId || req.query?.campusId || null,
  });
  if (!error) return Boolean(data);
  if (!['PGRST202', '42883'].includes(error.code)) throw error;
  const { data: congregation, error: leaderError } = await supabase.from('congregations').select('leader_user_id').eq('congregation_id', req.congregationId).maybeSingle();
  if (leaderError) throw leaderError;
  return congregation?.leader_user_id === req.user.id;
}

router.get('/:congregationId', authenticateUser, requireCapability('care.read'), async (req, res, next) => {
  try {
    const canReadConfidential = await hasCapability(req, 'care.confidential');
    const canReadPastorOnly = await hasCapability(req, 'staff.manage');
    let query = supabase.from('care_cases').select('*').eq('congregation_id', req.congregationId).is('deleted_at', null).order('created_at', { ascending: false });
    if (!canReadConfidential) query = query.or(`confidentiality.eq.standard,assignee_user_id.eq.${req.user.id},created_by.eq.${req.user.id}`);
    else if (!canReadPastorOnly) query = query.or(`confidentiality.neq.pastor_only,assignee_user_id.eq.${req.user.id},created_by.eq.${req.user.id}`);
    if (req.query.status) query = query.eq('status', req.query.status);
    if (req.query.assignee === 'me') query = query.eq('assignee_user_id', req.user.id);
    const { data, error } = await query;
    if (error) throw error;
    await supabase.from('audit_events').insert({ congregation_id: req.congregationId, actor_user_id: req.user.id, action: 'care.queue_accessed', resource_type: 'care_case', request_id: req.requestId, metadata: { resultCount: data.length, confidentialAccess: canReadConfidential, pastorOnlyAccess: canReadPastorOnly } });
    res.json({ data });
  } catch (error) { next(error); }
});

router.post('/:congregationId', authenticateUser, requireCapability('care.write'), async (req, res, next) => {
  try {
    const title = String(req.body?.title || '').trim();
    if (!title) return res.status(400).json({ error: { code: 'TITLE_REQUIRED', message: 'A care-case title is required.', fieldErrors: { title: 'Required' }, requestId: req.requestId } });
    if (req.body.priority && !priorities.has(req.body.priority)) return res.status(400).json({ error: { code: 'PRIORITY_INVALID', message: 'Priority is invalid.', requestId: req.requestId } });
    const confidentiality = req.body.confidentiality || 'care_team';
    if (!confidentialityLevels.has(confidentiality)) return res.status(400).json({ error: { code: 'CONFIDENTIALITY_INVALID', message: 'Confidentiality is invalid.', requestId: req.requestId } });
    if (confidentiality !== 'standard' && !(await hasCapability(req, 'care.confidential'))) return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'You do not have permission to create a confidential care case.', requestId: req.requestId } });
    if (confidentiality === 'pastor_only' && !(await hasCapability(req, 'staff.manage'))) return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'You do not have permission to create a pastor-only care case.', requestId: req.requestId } });
    const payload = {
      congregation_id: req.congregationId, profile_id: req.body.profileId || null, prayer_request_id: req.body.prayerRequestId || null,
      assignee_user_id: req.body.assigneeUserId || req.user.id, title, description: String(req.body.description || ''),
      priority: req.body.priority || 'normal', confidentiality, follow_up_at: req.body.followUpAt || null,
      reminder_at: req.body.reminderAt || null, retention_until: req.body.retentionUntil || null, created_by: req.user.id,
    };
    const { data, error } = await supabase.from('care_cases').insert(payload).select().single();
    if (error) throw error;
    if (data.profile_id) await supabase.from('person_timeline_events').insert({ congregation_id: req.congregationId, profile_id: data.profile_id, event_type: 'care_case_created', summary: 'Care follow-up opened', visibility_capability: data.confidentiality === 'standard' ? 'care.read' : 'care.confidential', source_type: 'care_case', source_id: data.id, created_by: req.user.id });
    await supabase.from('audit_events').insert({ congregation_id: req.congregationId, actor_user_id: req.user.id, action: 'care.created', resource_type: 'care_case', resource_id: data.id, request_id: req.requestId, metadata: { priority: data.priority, confidentiality: data.confidentiality } });
    res.status(201).json({ data });
  } catch (error) { next(error); }
});

router.patch('/:congregationId/:caseId', authenticateUser, requireCapability('care.write'), async (req, res, next) => {
  try {
    const { data: existing, error: existingError } = await supabase.from('care_cases').select('id,profile_id,confidentiality,created_by,assignee_user_id').eq('id', req.params.caseId).eq('congregation_id', req.congregationId).is('deleted_at', null).maybeSingle();
    if (existingError) throw existingError;
    if (!existing) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Care case not found.', requestId: req.requestId } });
    const canManageConfidential = await hasCapability(req, 'care.confidential');
    const canManagePastorOnly = await hasCapability(req, 'staff.manage');
    if (existing.confidentiality === 'pastor_only' && !canManagePastorOnly && existing.assignee_user_id !== req.user.id && existing.created_by !== req.user.id) return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'You do not have permission to update this pastor-only care case.', requestId: req.requestId } });
    if (existing.confidentiality !== 'standard' && !canManageConfidential && existing.assignee_user_id !== req.user.id && existing.created_by !== req.user.id) return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'You do not have permission to update this care case.', requestId: req.requestId } });
    const allowed = new Set(['assignee_user_id','priority','status','follow_up_at','reminder_at','escalated_at','outcome','retention_until','title','description','confidentiality']);
    const updates = Object.fromEntries(Object.entries(req.body || {}).filter(([key]) => allowed.has(key)));
    if (updates.status && !statuses.has(updates.status)) return res.status(400).json({ error: { code: 'STATUS_INVALID', message: 'Care-case status is invalid.', requestId: req.requestId } });
    if (updates.priority && !priorities.has(updates.priority)) return res.status(400).json({ error: { code: 'PRIORITY_INVALID', message: 'Priority is invalid.', requestId: req.requestId } });
    if (updates.confidentiality && !confidentialityLevels.has(updates.confidentiality)) return res.status(400).json({ error: { code: 'CONFIDENTIALITY_INVALID', message: 'Confidentiality is invalid.', requestId: req.requestId } });
    if (updates.confidentiality && updates.confidentiality !== 'standard' && !canManageConfidential) return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'You do not have permission to mark a care case confidential.', requestId: req.requestId } });
    if (updates.confidentiality === 'pastor_only' && !canManagePastorOnly) return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'You do not have permission to mark a care case pastor-only.', requestId: req.requestId } });
    updates.updated_at = new Date().toISOString();
    if (updates.status === 'closed') updates.closed_at = updates.updated_at;
    const { data, error } = await supabase.from('care_cases').update(updates).eq('id', req.params.caseId).eq('congregation_id', req.congregationId).is('deleted_at', null).select().maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Care case not found.', requestId: req.requestId } });
    if (data.profile_id) await supabase.from('person_timeline_events').insert({ congregation_id: req.congregationId, profile_id: data.profile_id, event_type: 'care_case_updated', summary: updates.status ? `Care follow-up marked ${updates.status.replace('_', ' ')}` : 'Care follow-up updated', visibility_capability: data.confidentiality === 'standard' ? 'care.read' : 'care.confidential', source_type: 'care_case', source_id: data.id, created_by: req.user.id });
    await supabase.from('audit_events').insert({ congregation_id: req.congregationId, actor_user_id: req.user.id, action: 'care.updated', resource_type: 'care_case', resource_id: data.id, request_id: req.requestId, metadata: { fields: Object.keys(updates) } });
    res.json({ data });
  } catch (error) { next(error); }
});

module.exports = router;
