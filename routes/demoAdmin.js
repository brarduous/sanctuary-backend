const express = require('express');
const router = express.Router();
const { resetDemoData } = require('../scripts/resetDemoData');

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
    const summary = await resetDemoData();
    res.json({ success: true, summary });
  } catch (error) {
    console.error('[Demo Admin] Reset failed:', error);
    res.status(500).json({ error: error.message || 'Failed to reset demo data' });
  }
});

module.exports = router;
