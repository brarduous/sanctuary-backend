const express = require('express');
const supabase = require('../config/supabase');
const authenticateUser = require('../middleware/auth');
const { requireCapability } = require('../middleware/authorization');

const router = express.Router();
const resources = {
  people: { table: 'church_crm_profiles', id: 'id', capability: 'people.write', columns: 'id,first_name,last_name,email,deleted_at,deletion_reason,merged_into_id' },
  households: { table: 'households', id: 'id', capability: 'people.write', columns: 'id,name,deleted_at,deletion_reason' },
  events: { table: 'events', id: 'id', capability: 'events.write' },
  communications: { table: 'pastoral_messages', id: 'message_id', capability: 'communications.write' },
  prayers: { table: 'prayer_requests', id: 'id', capability: 'care.write' },
  checkins: { table: 'check_ins', id: 'id', capability: 'check_in.write' },
  care: { table: 'care_cases', id: 'id', capability: 'care.write' },
};

function resolveResource(req, res, next) {
  const resource = resources[req.params.resource];
  if (!resource) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Recoverable resource not found.', requestId: req.requestId } });
  req.recoveryResource = resource;
  next();
}

const authorizeResource = (req, res, next) => requireCapability(req.recoveryResource.capability)(req, res, next);

router.get('/:congregationId/:resource', authenticateUser, resolveResource, authorizeResource, async (req, res, next) => {
  try {
    const resource = req.recoveryResource;
    if (!resource.columns) return res.status(400).json({ error: { code: 'RECOVERY_LIST_UNSUPPORTED', message: 'This resource does not expose a deleted-record list.', requestId: req.requestId } });
    const { data, error } = await supabase.from(resource.table).select(resource.columns).eq('congregation_id', req.congregationId).not('deleted_at', 'is', null).order('deleted_at', { ascending: false }).limit(200);
    if (error) throw error;
    res.json({ data });
  } catch (error) { next(error); }
});

router.post('/:congregationId/:resource/:id/delete', authenticateUser, resolveResource, authorizeResource, async (req, res, next) => {
  try {
    const reason = String(req.body?.reason || '').trim();
    if (reason.length < 5) return res.status(400).json({ error: { code: 'DELETION_REASON_REQUIRED', message: 'Provide a deletion reason.', requestId: req.requestId } });
    const resource = req.recoveryResource;
    const deletedAt = new Date().toISOString();
    const { data, error } = await supabase.from(resource.table).update({ deleted_at: deletedAt, deleted_by: req.user.id, deletion_reason: reason }).eq(resource.id, req.params.id).eq('congregation_id', req.congregationId).is('deleted_at', null).select(resource.id).maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Active record not found.', requestId: req.requestId } });
    await supabase.from('audit_events').insert({ congregation_id: req.congregationId, actor_user_id: req.user.id, action: `${req.params.resource}.soft_deleted`, resource_type: req.params.resource, resource_id: req.params.id, request_id: req.requestId, metadata: { reason } });
    res.json({ deletedAt });
  } catch (error) { next(error); }
});

router.post('/:congregationId/:resource/:id/restore', authenticateUser, resolveResource, authorizeResource, async (req, res, next) => {
  try {
    const resource = req.recoveryResource;
    const { data, error } = await supabase.from(resource.table).update({ deleted_at: null, deleted_by: null, deletion_reason: null }).eq(resource.id, req.params.id).eq('congregation_id', req.congregationId).not('deleted_at', 'is', null).select(resource.id).maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Deleted record not found.', requestId: req.requestId } });
    await supabase.from('audit_events').insert({ congregation_id: req.congregationId, actor_user_id: req.user.id, action: `${req.params.resource}.restored`, resource_type: req.params.resource, resource_id: req.params.id, request_id: req.requestId });
    res.json({ restored: true });
  } catch (error) { next(error); }
});

module.exports = router;
