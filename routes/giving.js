const express = require('express');
const supabase = require('../config/supabase');
const authenticateUser = require('../middleware/auth');
const { requireCapability } = require('../middleware/authorization');

const router = express.Router();
const cents = (value) => Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;

router.get('/:congregationId/funds', authenticateUser, requireCapability('finance.read'), async (req, res, next) => {
  try {
    const { data, error } = await supabase.from('giving_funds').select('id,name,description,restricted,active').eq('congregation_id', req.congregationId).order('name');
    if (error) throw error;
    res.json({ data });
  } catch (error) { next(error); }
});

router.get('/:congregationId/ledger', authenticateUser, requireCapability('finance.read'), async (req, res, next) => {
  try {
    const { data, error } = await supabase.from('gifts').select('id,donor_profile_id,fund_id,batch_id,amount_cents,currency,source,received_at,status,refunded_amount_cents,created_at').eq('congregation_id', req.congregationId).order('received_at', { ascending: false }).limit(Math.min(Number(req.query.limit) || 100, 500));
    if (error) throw error;
    await supabase.from('audit_events').insert({ congregation_id: req.congregationId, actor_user_id: req.user.id, action: 'finance.ledger_accessed', resource_type: 'gift', request_id: req.requestId, metadata: { resultCount: data.length } });
    res.json({ data });
  } catch (error) { next(error); }
});

router.post('/:congregationId/funds', authenticateUser, requireCapability('finance.write'), async (req, res, next) => {
  try {
    const name = String(req.body?.name || '').trim();
    if (!name) return res.status(400).json({ error: { code: 'FUND_NAME_REQUIRED', message: 'Fund name is required.', requestId: req.requestId } });
    const { data, error } = await supabase.from('giving_funds').insert({ congregation_id: req.congregationId, name, description: req.body.description || null, restricted: Boolean(req.body.restricted) }).select().single();
    if (error) throw error;
    await supabase.from('audit_events').insert({ congregation_id: req.congregationId, actor_user_id: req.user.id, action: 'finance.fund_created', resource_type: 'giving_fund', resource_id: data.id, request_id: req.requestId });
    res.status(201).json({ data });
  } catch (error) { next(error); }
});

router.post('/:congregationId/gifts', authenticateUser, requireCapability('finance.write'), async (req, res, next) => {
  try {
    const amount = cents(req.body?.amountCents);
    if (!amount || !req.body?.fundId) return res.status(400).json({ error: { code: 'GIFT_INVALID', message: 'A positive amount and valid fund are required.', fieldErrors: { amountCents: amount ? undefined : 'Must be positive', fundId: req.body?.fundId ? undefined : 'Required' }, requestId: req.requestId } });
    const { data: fund } = await supabase.from('giving_funds').select('id').eq('id', req.body.fundId).eq('congregation_id', req.congregationId).eq('active', true).maybeSingle();
    if (!fund) return res.status(400).json({ error: { code: 'FUND_INVALID', message: 'Fund is not active in this organization.', requestId: req.requestId } });
    const { data, error } = await supabase.from('gifts').insert({ congregation_id: req.congregationId, donor_profile_id: req.body.donorProfileId || null, fund_id: fund.id, batch_id: req.body.batchId || null, amount_cents: amount, source: req.body.source || 'offline', received_at: req.body.receivedAt || new Date().toISOString(), recorded_by: req.user.id, metadata: req.body.metadata || {} }).select().single();
    if (error) throw error;
    await supabase.from('audit_events').insert({ congregation_id: req.congregationId, actor_user_id: req.user.id, action: 'finance.gift_recorded', resource_type: 'gift', resource_id: data.id, request_id: req.requestId, metadata: { amountCents: amount, source: data.source } });
    res.status(201).json({ data });
  } catch (error) { next(error); }
});

router.post('/:congregationId/gifts/:giftId/refunds', authenticateUser, requireCapability('finance.write'), async (req, res, next) => {
  try {
    const amount = cents(req.body?.amountCents); const reason = String(req.body?.reason || '').trim();
    const { data: gift, error: giftError } = await supabase.from('gifts').select('id,amount_cents,refunded_amount_cents').eq('id', req.params.giftId).eq('congregation_id', req.congregationId).maybeSingle();
    if (giftError) throw giftError;
    if (!gift) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Gift not found.', requestId: req.requestId } });
    if (!amount || !reason || amount + gift.refunded_amount_cents > gift.amount_cents) return res.status(400).json({ error: { code: 'REFUND_INVALID', message: 'Refund amount or reason is invalid.', requestId: req.requestId } });
    const { data, error } = await supabase.from('gift_refunds').insert({ congregation_id: req.congregationId, gift_id: gift.id, amount_cents: amount, reason, refunded_by: req.user.id }).select().single();
    if (error) throw error;
    const refunded = gift.refunded_amount_cents + amount;
    await supabase.from('gifts').update({ refunded_amount_cents: refunded, status: refunded === gift.amount_cents ? 'refunded' : 'partially_refunded' }).eq('id', gift.id);
    await supabase.from('audit_events').insert({ congregation_id: req.congregationId, actor_user_id: req.user.id, action: 'finance.gift_refunded', resource_type: 'gift', resource_id: gift.id, request_id: req.requestId, metadata: { amountCents: amount, reason } });
    res.status(201).json({ data });
  } catch (error) { next(error); }
});

router.post('/:congregationId/batches/:batchId/reconcile', authenticateUser, requireCapability('finance.write'), async (req, res, next) => {
  try {
    const { data: gifts, error } = await supabase.from('gifts').select('amount_cents').eq('batch_id', req.params.batchId).eq('congregation_id', req.congregationId).eq('status', 'succeeded');
    if (error) throw error;
    const actual = gifts.reduce((total, gift) => total + Number(gift.amount_cents), 0);
    const { data, error: updateError } = await supabase.from('giving_batches').update({ actual_total_cents: actual, status: 'closed', closed_by: req.user.id, closed_at: new Date().toISOString() }).eq('id', req.params.batchId).eq('congregation_id', req.congregationId).select().maybeSingle();
    if (updateError) throw updateError;
    if (!data) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Giving batch not found.', requestId: req.requestId } });
    await supabase.from('audit_events').insert({ congregation_id: req.congregationId, actor_user_id: req.user.id, action: 'finance.batch_reconciled', resource_type: 'giving_batch', resource_id: data.id, request_id: req.requestId, metadata: { actualTotalCents: actual } });
    res.json({ data });
  } catch (error) { next(error); }
});

module.exports = router;
