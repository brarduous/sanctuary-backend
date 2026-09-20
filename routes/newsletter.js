const express = require('express');
const rateLimit = require('express-rate-limit');
const supabase = require('../config/supabase');
const { createManageToken, createToken, hashToken, parseManageToken, sendConfirmation, sendWelcome } = require('../services/newsletter');
const { logEvent } = require('../utils/helpers');

const router = express.Router();
const subscribeLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false });
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.post('/newsletter/subscribe', subscribeLimiter, async (req, res, next) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const source = String(req.body?.source || 'unknown').trim().slice(0, 100);
    if (!emailPattern.test(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
    const confirmationToken = createToken();
    const unsubscribeToken = createToken();
    const { data: existing } = await supabase.from('newsletter_subscribers').select('id,status,unsubscribe_token_hash').eq('email', email).maybeSingle();
    if (existing?.status === 'active') return res.status(202).json({ ok: true, message: 'Check your inbox for the next briefing.' });
    const { error } = await supabase.from('newsletter_subscribers').upsert({
      email,
      status: 'pending',
      acquisition_source: source,
      consented_at: new Date().toISOString(),
      confirmation_token_hash: hashToken(confirmationToken),
      confirmation_expires_at: new Date(Date.now() + (24 * 60 * 60 * 1000)).toISOString(),
      unsubscribe_token_hash: existing?.unsubscribe_token_hash || hashToken(unsubscribeToken),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'email' });
    if (error) throw error;
    await sendConfirmation(email, confirmationToken);
    await logEvent('info', 'newsletter', null, 'newsletter_confirmation_sent', 'Daily Briefing confirmation sent', { source });
    return res.status(202).json({ ok: true, message: 'Check your email to confirm your subscription.' });
  } catch (error) { next(error); }
});

router.post('/newsletter/confirm', async (req, res, next) => {
  try {
    const token = String(req.body?.token || '');
    if (token.length < 20) return res.status(400).json({ error: 'This confirmation link is invalid.' });
    const { data, error } = await supabase.from('newsletter_subscribers').select('*').eq('confirmation_token_hash', hashToken(token)).gt('confirmation_expires_at', new Date().toISOString()).maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'This confirmation link is invalid or expired.' });
    const manageToken = createManageToken(data.id);
    const { error: updateError } = await supabase.from('newsletter_subscribers').update({ status: 'active', confirmed_at: new Date().toISOString(), confirmation_token_hash: null, confirmation_expires_at: null, updated_at: new Date().toISOString() }).eq('id', data.id);
    if (updateError) throw updateError;
    await sendWelcome(data.email, manageToken);
    return res.json({ ok: true, preferencesToken: manageToken });
  } catch (error) { next(error); }
});

router.get('/newsletter/preferences', async (req, res, next) => {
  try {
    const token = String(req.query.token || '');
    const subscriberId = parseManageToken(token);
    if (!subscriberId) return res.status(404).json({ error: 'Preference link not found.' });
    const { data, error } = await supabase.from('newsletter_subscribers').select('email,status,topic_preferences').eq('id', subscriberId).maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Preference link not found.' });
    return res.json({ email: data.email, status: data.status, topics: data.topic_preferences || [] });
  } catch (error) { next(error); }
});

router.post('/newsletter/preferences', async (req, res, next) => {
  try {
    const token = String(req.body?.token || '');
    const topics = [...new Set((Array.isArray(req.body?.topics) ? req.body.topics : []).map(String).map((value) => value.trim()).filter(Boolean))].slice(0, 20);
    const subscriberId = parseManageToken(token);
    if (!subscriberId) return res.status(404).json({ error: 'Preference link not found.' });
    const { data, error } = await supabase.from('newsletter_subscribers').update({ topic_preferences: topics, updated_at: new Date().toISOString() }).eq('id', subscriberId).select('id').maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Preference link not found.' });
    return res.json({ ok: true, topics });
  } catch (error) { next(error); }
});

router.post('/newsletter/unsubscribe', async (req, res, next) => {
  try {
    const token = String(req.body?.token || '');
    const subscriberId = parseManageToken(token);
    if (!subscriberId) return res.status(404).json({ error: 'Unsubscribe link not found.' });
    const { data, error } = await supabase.from('newsletter_subscribers').update({ status: 'unsubscribed', unsubscribed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', subscriberId).select('id').maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Unsubscribe link not found.' });
    return res.json({ ok: true });
  } catch (error) { next(error); }
});

module.exports = router;
