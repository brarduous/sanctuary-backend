const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase'); // Admin client

// Middleware to verify the RevenueCat secret
const verifyRevenueCatAuth = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const expectedHeader = `Bearer ${process.env.REVENUECAT_WEBHOOK_SECRET}`;

  if (!authHeader || authHeader !== expectedHeader) {
    console.error('[Webhooks] Unauthorized RevenueCat attempt');
    return res.status(403).send('Unauthorized');
  }
  next();
};

router.post('/revenuecat', verifyRevenueCatAuth, async (req, res) => {
  const { event } = req.body;

  if (!event) {
    return res.status(400).send('No event data');
  }

  const userId = event.app_user_id; // Must match Supabase UUID
  const type = event.type;

  console.log(`[RC Webhook] User: ${userId} | Event: ${type}`);

  let newTier = null;

  // --- LOGIC: MAP EVENTS TO TIERS ---
  switch (type) {
    // EVENTS THAT GRANT ACCESS
    case 'INITIAL_PURCHASE':
    case 'RENEWAL':
    case 'UNCANCELLATION': // User turned auto-renew back on
    case 'PRODUCT_CHANGE': // Switched plans
      newTier = 'pro';
      break;

    // EVENTS THAT REVOKE ACCESS
    case 'EXPIRATION': 
      newTier = 'free';
      break;

    // EVENTS TO IGNORE (Status hasn't technically changed yet)
    case 'CANCELLATION':
      // Cancellation just means "Auto-renew is OFF". 
      // They are still Pro until the 'EXPIRATION' event fires later.
      // So we do nothing.
      console.log(`[RC Webhook] Cancellation received for ${userId}. Waiting for Expiration event.`);
      return res.status(200).send('Ignored');

    case 'BILLING_ISSUE':
      // Usually we wait for expiration, or you could downgrade immediately.
      // For simplicity, we'll let the grace period expire naturally via EXPIRATION.
      return res.status(200).send('Ignored');

    case 'TEST':
      console.log("RevenueCat Test Event Received");
      return res.status(200).send('Test OK');

    default:
      console.log(`[RC Webhook] Unhandled event type: ${type}`);
      return res.status(200).send('Ignored');
  }

  // --- UPDATE SUPABASE ---
  if (newTier) {
    try {
      const { error } = await supabase
        .from('user_profiles')
        .update({ subscription_tier: newTier })
        .eq('user_id', userId);

      if (error) throw error;

      console.log(`[RC Webhook] Success: ${userId} is now ${newTier}`);
      return res.status(200).send('OK');

    } catch (err) {
      console.error('[RC Webhook] Database Update Failed:', err.message);
      return res.status(500).send('Database Error');
    }
  }

  return res.status(200).send('No Action Required');
});

module.exports = router;