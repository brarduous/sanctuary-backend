const express = require('express');
const { generateWeeklyBatch } = require('../cron/generateGeneralDevotionals');

const router = express.Router();

const hasValidCronSecret = (req) => {
  const configuredSecret = process.env.CRON_SECRET || process.env.GENERAL_DEVOTIONAL_CRON_SECRET;
  if (!configuredSecret) return false;

  const authHeader = req.headers.authorization || '';
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const headerSecret = req.headers['x-cron-secret'];

  return bearerToken === configuredSecret || headerSecret === configuredSecret;
};

router.post('/general-devotionals', async (req, res) => {
  if (!hasValidCronSecret(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const force = req.body?.force === true;
    const result = await generateWeeklyBatch({ force });
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('[Cron] General devotional generation failed:', error);
    res.status(500).json({ error: error.message || 'Failed to generate general devotionals' });
  }
});

module.exports = router;
