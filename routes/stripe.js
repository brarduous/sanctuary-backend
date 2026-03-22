const express = require('express');
const router = express.Router();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const supabase = require('../config/supabase');
const authenticateUser = require('../middleware/auth');

// POST: Start the Stripe Onboarding Flow
router.post('/onboard/:congregationId', authenticateUser, async (req, res) => {
    const { congregationId } = req.params;

    try {
        // 1. Get the congregation
        const { data: cong, error } = await supabase
            .from('congregations')
            .select('stripe_account_id, name')
            .eq('congregation_id', congregationId)
            .single();

        if (error) throw error;

        let stripeAccountId = cong.stripe_account_id;

        // 2. If they don't have a Stripe Account yet, create one
        if (!stripeAccountId) {
            const account = await stripe.accounts.create({
                type: 'express', // Express gives a great white-labeled UI managed by Stripe
                company: { name: cong.name },
                capabilities: {
                    card_payments: { requested: true },
                    transfers: { requested: true },
                },
            });
            stripeAccountId = account.id;

            // Save the ID to your database
            await supabase
                .from('congregations')
                .update({ stripe_account_id: stripeAccountId })
                .eq('congregation_id', congregationId);
        }

        // 3. Generate the secure onboarding link
        // Replace these URLs with your actual frontend Clergy app URLs
        const origin = process.env.CLIENT_URL || 'http://localhost:3000'; 
        
        const accountLink = await stripe.accountLinks.create({
            account: stripeAccountId,
            refresh_url: `${origin}/congregation/giving?stripe_refresh=true`,
            return_url: `${origin}/congregation/giving?stripe_return=true`,
            type: 'account_onboarding',
        });

        res.json({ url: accountLink.url });
    } catch (error) {
        console.error('Stripe Connect Error:', error);
        res.status(500).json({ error: 'Failed to generate Stripe onboarding link.' });
    }
});

// GET: Check the status of the Stripe Account
router.get('/status/:congregationId', authenticateUser, async (req, res) => {
    const { congregationId } = req.params;

    try {
        const { data: cong } = await supabase
            .from('congregations')
            .select('stripe_account_id, stripe_charges_enabled')
            .eq('congregation_id', congregationId)
            .single();

        if (!cong || !cong.stripe_account_id) {
            return res.json({ isConnected: false });
        }

        // Fetch the live status from Stripe
        const account = await stripe.accounts.retrieve(cong.stripe_account_id);

        const chargesEnabled = account.charges_enabled;
        const detailsSubmitted = account.details_submitted;

        // Sync it back to your database so you don't have to ping Stripe constantly later
        if (cong.stripe_charges_enabled !== chargesEnabled) {
            await supabase
                .from('congregations')
                .update({ 
                    stripe_charges_enabled: chargesEnabled,
                    stripe_details_submitted: detailsSubmitted
                })
                .eq('congregation_id', congregationId);
        }

        res.json({ 
            isConnected: chargesEnabled, 
            detailsSubmitted: detailsSubmitted,
            accountId: account.id
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to check Stripe status.' });
    }
});

// GET: Generate a link for the Pastor to view their payouts/tax docs
router.post('/dashboard/:congregationId', authenticateUser, async (req, res) => {
    try {
        const { data: cong } = await supabase.from('congregations').select('stripe_account_id').eq('congregation_id', req.params.congregationId).single();
        
        const loginLink = await stripe.accounts.createLoginLink(cong.stripe_account_id);
        res.json({ url: loginLink.url });
    } catch (error) {
        res.status(500).json({ error: 'Failed to generate dashboard link.' });
    }
});

// --- MOBILE: Generate a Checkout Session ---
router.post('/checkout', authenticateUser, async (req, res) => {
    const { amount, fund, congregationId } = req.body;
    const userId = req.user.id;

    try {
        // 1. Verify the congregation is active on Stripe
        const { data: cong, error } = await supabase
            .from('congregations')
            .select('stripe_account_id, stripe_charges_enabled, name')
            .eq('congregation_id', congregationId)
            .single();

        if (error || !cong.stripe_account_id || !cong.stripe_charges_enabled) {
            return res.status(400).json({ error: 'This church is not currently accepting digital donations.' });
        }

        // 2. Calculate the Platform Fee (e.g., 1%)
        // Amount is received in dollars, Stripe needs cents.
        const amountInCents = Math.round(parseFloat(amount) * 100);
        const platformFeeInCents = Math.round(amountInCents * 0.01); 

        // 3. Create the Stripe Checkout Session
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card', 'us_bank_account'],
            line_items: [{
                price_data: {
                    currency: 'usd',
                    product_data: {
                        name: `${cong.name} - ${fund} Fund`,
                        description: 'Tax-deductible charitable contribution.',
                    },
                    unit_amount: amountInCents,
                },
                quantity: 1,
            }],
            mode: 'payment',
            payment_intent_data: {
                // Route the money to the church
                transfer_data: {
                    destination: cong.stripe_account_id,
                },
                // Extract Sanctuary's Revenue
                application_fee_amount: platformFeeInCents, 
            },
            // Since this opens in an in-app browser, they just close the modal when done.
            // You can point these to a simple success/cancel page hosted on your website.
            success_url: `${process.env.CLIENT_URL}/give/success`, 
            cancel_url: `${process.env.CLIENT_URL}/give/cancel`,
            client_reference_id: userId, // Tracks who gave for the end-of-year statement
        });

        res.json({ url: session.url });
    } catch (error) {
        console.error('Checkout Error:', error);
        res.status(500).json({ error: 'Failed to initiate secure checkout.' });
    }
});

// --- MOBILE: Check if Giving is Enabled ---
router.get('/status/:congregationId/public', authenticateUser, async (req, res) => {
    try {
        const { data: cong } = await supabase
            .from('congregations')
            .select('stripe_charges_enabled')
            .eq('congregation_id', req.params.congregationId)
            .single();

        res.json({ isGivingEnabled: cong?.stripe_charges_enabled || false });
    } catch (error) {
        res.status(500).json({ error: 'Failed to check giving status.' });
    }
});

module.exports = router;