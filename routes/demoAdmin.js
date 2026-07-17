const express = require('express');
const router = express.Router();
const { resetDemoData } = require('../scripts/resetDemoData');
const supabase = require('../config/supabase');

const hasValidResetSecret = (req) => {
  const configuredSecret = process.env.DEMO_RESET_SECRET;
  if (!configuredSecret) return false;

  const authHeader = req.headers.authorization || '';
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const headerSecret = req.headers['x-demo-reset-secret'];

  return bearerToken === configuredSecret || headerSecret === configuredSecret;
};

router.post('/reset-demo', async (req, res) => {
  if (!hasValidResetSecret(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    if (process.env.SUPABASE_ENVIRONMENT === 'production') return res.status(403).json({ error: 'Demo reset is disabled in production.' });
    const actorUserId = req.headers['x-demo-actor-id'] || null;
    const actorEmail = req.headers['x-demo-actor-email'] || null;
    const summary = await resetDemoData();
    const { error: auditError } = await supabase.from('audit_events').insert({ congregation_id: summary.congregationId, actor_user_id: actorUserId, action: 'demo.reset', resource_type: 'congregation', resource_id: String(summary.congregationId), request_id: req.requestId, metadata: { actorEmail, summary } });
    if (auditError) throw auditError;
    res.json({ success: true, summary });
  } catch (error) {
    console.error('[Demo Admin] Reset failed:', error);
    res.status(500).json({ error: error.message || 'Failed to reset demo data' });
  }
});

module.exports = router;
