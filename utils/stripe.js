let stripeClient;

function getStripe() {
  if (!process.env.STRIPE_SECRET_KEY) {
    const error = new Error('Stripe is not configured.');
    error.status = 503;
    error.code = 'INTEGRATION_UNAVAILABLE';
    throw error;
  }
  stripeClient ||= require('stripe')(process.env.STRIPE_SECRET_KEY);
  return stripeClient;
}

module.exports = { getStripe };
