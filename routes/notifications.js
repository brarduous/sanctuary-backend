const express = require('express');
const authenticateUser = require('../middleware/auth');
const supabase = require('../config/supabase');
const {
  dispatchCalendar,
  markOpened,
  notificationReport,
  processExpoReceipts,
  updateTimeZone,
} = require('../services/notificationCalendar');

const router = express.Router();

const hasCronSecret = (req) => {
  const configured = process.env.CRON_SECRET || process.env.GENERAL_DEVOTIONAL_CRON_SECRET;
  const authorization = req.headers.authorization || '';
  return Boolean(configured) && authorization === `Bearer ${configured}`;
};

router.post('/timezone', authenticateUser, async (req, res, next) => {
  try {
    const data = await updateTimeZone(req.user.id, req.body?.timeZone);
    res.json({ data });
  } catch (error) {
    next(error);
  }
});

router.post('/open', authenticateUser, async (req, res, next) => {
  try {
    if (!req.body?.deliveryId) return res.status(400).json({ error: { code: 'DELIVERY_ID_REQUIRED', message: 'A delivery ID is required.', requestId: req.requestId } });
    const recorded = await markOpened(req.user.id, req.body.deliveryId);
    res.status(recorded ? 200 : 404).json({ recorded });
  } catch (error) {
    next(error);
  }
});

router.all('/dispatch', async (req, res, next) => {
  if (!hasCronSecret(req)) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const input = req.method === 'GET' ? req.query : req.body || {};
    const result = await dispatchCalendar({
      dryRun: input.dryRun === true || input.dryRun === 'true',
      category: input.category || null,
      rolloutStage: input.rolloutStage || null,
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post('/receipts', async (req, res, next) => {
  if (!hasCronSecret(req)) return res.status(401).json({ error: 'Unauthorized' });
  try {
    res.json(await processExpoReceipts());
  } catch (error) {
    next(error);
  }
});

router.get('/report', async (req, res, next) => {
  if (!hasCronSecret(req)) return res.status(401).json({ error: 'Unauthorized' });
  try {
    res.json({ data: await notificationReport({ since: req.query.since }) });
  } catch (error) {
    next(error);
  }
});

router.patch('/settings/:category', async (req, res, next) => {
  if (!hasCronSecret(req)) return res.status(401).json({ error: 'Unauthorized' });
  const allowedCategories = new Set(['devotional', 'advice', 'news', 'church']);
  const allowedStages = new Set(['dry_run', 'internal', '10', '50', '100']);
  if (!allowedCategories.has(req.params.category)) return res.status(400).json({ error: 'Invalid category' });
  const values = {};
  if (typeof req.body?.enabled === 'boolean') values.enabled = req.body.enabled;
  if (req.body?.rolloutStage) {
    if (!allowedStages.has(req.body.rolloutStage)) return res.status(400).json({ error: 'Invalid rollout stage' });
    values.rollout_stage = req.body.rolloutStage;
    values.stage_started_at = new Date().toISOString();
  }
  if (!Object.keys(values).length) return res.status(400).json({ error: 'No supported settings supplied' });
  try {
    const { data, error } = await supabase.from('notification_runtime_settings')
      .update({ ...values, updated_at: new Date().toISOString() }).eq('category', req.params.category)
      .select('category, enabled, rollout_stage, send_local_time, stage_started_at').single();
    if (error) throw error;
    res.json({ data });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
