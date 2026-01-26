const express = require('express');
const cors = require('cors');
require('dotenv').config();

// Imports from refactoring
const supabase = require('./config/supabase');
const { logEvent } = require('./utils/helpers');

const adminRouter = require('./routes/admin'); // <--- Add this

// Initialize Stripe (needed for webhooks)
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const stripeLayperson = require('stripe')(process.env.STRIPE_SECRET_KEY_LAYPERSON);

const app = express();

// --- SECURE CORS CONFIGURATION ---
const allowedOrigins = [
    'https://sanctuaryapp.us',
    'https://www.sanctuaryapp.us',
    'https://beta.sanctuaryapp.us',
    'https://staging.sanctuaryapp.us',
    'https://clergy.sanctuaryapp.us',
    'https://admin.sanctuaryapp.us',
    'https://staging-clergy.sanctuaryapp.us',
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'https://sanctuarynews.org',
    'https://www.sanctuarynews.org'
];

const corsOptions = {
    origin: function (origin, callback) {
        // Allow requests with no origin (like mobile apps, curl, server-to-server)
        if (!origin) return callback(null, true);

        if (allowedOrigins.includes(origin)) {
            return callback(null, true);
        }

        console.warn(`Blocked CORS request from: ${origin}`);
        return callback(new Error('Not allowed by CORS'));
    },
    credentials: true, // Allow cookies/auth headers
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-user-id']
};

app.use(cors(corsOptions));


// Stripe Webhook Endpoint
app.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;
    try {
        event = stripe.webhooks.constructEvent(
            req.body,
            sig,
            process.env.STRIPE_WEBHOOK_SECRET
        );
    } catch (err) {
        console.error(`Webhook signature verification failed: ${err.message}`);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Handle the event
    const session = event.data.object;

    const userId = session.client_reference_id; // Ensure this is passed during checkout creation
    //get email address for user from auth user table. Then cross reference whitelist table to see if user is whitelisted. If whitelisted
    //bypass subscription handling, set user tier to pro directly.
    const { data: authUser, error: authError } = await supabase
        .from('auth.users')
        .select('email')
        .eq('id', userId)
        .single();
    if (authError) {
        console.error('Error fetching auth user:', authError);
        // return res.status(500).json({ error: 'Failed to fetch user.' }); // Don't fail webhook for this
    }
    // Check if user is whitelisted
    if (authUser) {
        const { data: whitelistEntry, error: whitelistError } = await supabase
            .from('whitelist')
            .select('*')
            .eq('email', authUser.email)
            .single();
        
        if (whitelistEntry) {
            // User is whitelisted, ensure their tier is set to pro
            await supabase
                .from('user_profiles')
                .upsert({ user_id: userId, tier: 'pro' })
                .eq('user_id', userId);
            console.log(`Whitelisted user ${userId} set to pro tier.`);
            return res.json({ received: true });
        }
    }
    
    try {
        if (event.type === 'checkout.session.completed') {
            const subscription = await stripe.subscriptions.retrieve(session.subscription);
            const userId = session.client_reference_id; // Ensure this is passed during checkout creation

            // 1. Create Subscription Record
            await supabase.from('subscriptions').insert({
                id: subscription.id,
                user_id: userId,
                status: subscription.status,
                price_id: subscription.items.data[0].price.id,
                cancel_at_period_end: subscription.cancel_at_period_end,
            });

            // 2. Update Profile Tier
            // Note: Your app uses 'user_profiles'. Ensure this matches your DB.
            await supabase
                .from('user_profiles')
                .update({ tier: 'pro' }) // Ensure you have a 'tier' column
                .eq('user_id', userId);

            console.log(`User ${userId} upgraded to pro.`);
        }

        if (event.type === 'customer.subscription.updated') {
            const subscription = event.data.object;
            // Stripe doesn't always send client_reference_id on updates, 
            // so we might need to look up the user by subscription ID if userId is missing.

            // Upsert ensures we update if exists, insert if not (though usually it exists)
            const { error } = await supabase.from('subscriptions').upsert({
                id: subscription.id,
                status: subscription.status,
                cancel_at_period_end: subscription.cancel_at_period_end,
                // We might not have user_id easily here if it's not in metadata, 
                // but upserting by ID usually preserves other fields if you don't overwrite them.
                // Ideally, store user_id in Stripe metadata during checkout.
            });

            if (error) console.error('Error updating subscription:', error);

            // Handle Downgrades/Cancellations
            if (['canceled', 'unpaid', 'past_due'].includes(subscription.status)) {
                // Find the user associated with this subscription
                const { data: subData } = await supabase
                    .from('subscriptions')
                    .select('user_id')
                    .eq('id', subscription.id)
                    .single();

                if (subData && subData.user_id) {
                    await supabase
                        .from('user_profiles')
                        .update({ tier: 'free' })
                        .eq('user_id', subData.user_id);
                    console.log(`User ${subData.user_id} downgraded due to status: ${subscription.status}`);
                }
            }
        }

        if (event.type === 'customer.subscription.deleted') {
            const subscription = event.data.object;

            await supabase
                .from('subscriptions')
                .update({ status: 'canceled' })
                .eq('id', subscription.id);

            const { data: subData } = await supabase
                .from('subscriptions')
                .select('user_id')
                .eq('id', subscription.id)
                .single();

            if (subData && subData.user_id) {
                await supabase
                    .from('user_profiles')
                    .update({ tier: 'free' })
                    .eq('user_id', subData.user_id);
            }
        }
    } catch (err) {
        console.error('Error processing webhook event:', err);
        // Return 200 anyway so Stripe doesn't keep retrying if it's a logic error on our end
        return res.json({ received: true });
    }

    // Return a 200 response to acknowledge receipt of the event
    res.json({ received: true });
});


// --- NEW: Layperson Webhook Endpoint ---
// Handles subscriptions for the Layperson App (writing to 'subscription_tier')
app.post('/webhook-layperson', express.raw({ type: 'application/json' }), async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;

    try {
        // USE THE NEW SECRET SPECIFIC TO THIS ENDPOINT
        event = stripeLayperson.webhooks.constructEvent(
            req.body,
            sig,
            process.env.STRIPE_WEBHOOK_SECRET_LAYPERSON 
        );
    } catch (err) {
        console.error(`Layperson Webhook signature verification failed: ${err.message}`);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    const session = event.data.object;

    // Optional: Whitelist Check for Layperson (if you want to keep this feature)
    if (session.client_reference_id) {
        const userId = session.client_reference_id;
        const { data: authUser } = await supabase.from('auth.users').select('email').eq('id', userId).single();
        if (authUser) {
             const { data: whitelistEntry } = await supabase.from('whitelist').select('*').eq('email', authUser.email).single();
             if (whitelistEntry) {
                 await supabase.from('user_profiles').upsert({ 
                     user_id: userId, 
                     subscription_tier: 'pro' // Writing to NEW column
                 });
                 console.log(`Whitelisted Layperson user ${userId} set to pro.`);
                 return res.json({ received: true });
             }
        }
    }

    try {
        // 1. Checkout Completed
        if (event.type === 'checkout.session.completed') {
            const subscription = await stripeLayperson.subscriptions.retrieve(session.subscription);
            const userId = session.client_reference_id;
            console.log('Processing Layperson checkout.session.completed for user:', userId);
            // Log to shared subscriptions table (optional, but good for history)
            await supabase.from('subscriptions').insert({
                id: subscription.id,
                user_id: userId,
                status: subscription.status,
                price_id: subscription.items.data[0].price.id,
                cancel_at_period_end: subscription.cancel_at_period_end,
                // You might want to add a 'type': 'layperson' column to this table later if you share it
            });
            console.log('Inserted subscription record for Layperson user:', userId);
            // UPDATE PROFILE: Write to 'subscription_tier'
            await supabase
                .from('user_profiles')
                .update({ 
                    subscription_tier: 'pro',
                    stripe_customer_id: session.customer,
                    stripe_subscription_id: subscription.id
                }) 
                .eq('user_id', userId);

            console.log(`Layperson User ${userId} upgraded to pro.`);
        }

        // 2. Subscription Updated (Renewals, Cancellations, Payment Failures)
        if (event.type === 'customer.subscription.updated') {
            const subscription = event.data.object;
            
            // Sync subscriptions table
            await supabase.from('subscriptions').upsert({
                id: subscription.id,
                status: subscription.status,
                cancel_at_period_end: subscription.cancel_at_period_end,
            });

            // Logic: 'active' or 'trialing' = PRO. Everything else = FREE.
            const shouldBePro = ['active', 'trialing'].includes(subscription.status);
            const newTier = shouldBePro ? 'pro' : 'free';

            // Find user by subscription ID (since client_reference_id isn't always in update events)
            const { data: subData } = await supabase
                .from('subscriptions')
                .select('user_id')
                .eq('id', subscription.id)
                .single();

            if (subData && subData.user_id) {
                await supabase
                    .from('user_profiles')
                    .update({ subscription_tier: newTier }) // Writing to NEW column
                    .eq('user_id', subData.user_id);
                
                console.log(`Layperson User ${subData.user_id} subscription updated to: ${newTier}`);
            }
        }

        // 3. Subscription Deleted (Immediate Cancellation)
        if (event.type === 'customer.subscription.deleted') {
            const subscription = event.data.object;

            await supabase
                .from('subscriptions')
                .update({ status: 'canceled' })
                .eq('id', subscription.id);

            const { data: subData } = await supabase
                .from('subscriptions')
                .select('user_id')
                .eq('id', subscription.id)
                .single();

            if (subData && subData.user_id) {
                await supabase
                    .from('user_profiles')
                    .update({ subscription_tier: 'free' }) // Reset to free
                    .eq('user_id', subData.user_id);
                
                console.log(`Layperson User ${subData.user_id} downgraded to free (Subscription deleted)`);
            }
        }
    } catch (err) {
        console.error('Error processing Layperson webhook:', err);
        return res.json({ received: true }); 
    }

    res.json({ received: true });
});

app.use(express.json());

// Logging middleware
app.use(async (req, res, next) => {
    const start = Date.now();
    const userId = req.headers['x-user-id'] || null;

    res.on('finish', () => {
        const duration = Date.now() - start;
        const level = res.statusCode >= 400 ? 'error' : 'info';

        logEvent(
            level,
            'backend',
            userId,
            'http_request',
            `${req.method} ${req.originalUrl} - ${res.statusCode}`,
            { ip: req.ip },
            duration // <--- Pass duration here
        );
    });

    next();
});

// Import Routes
const devotionalsRouter = require('./routes/devotionals');
const sermonsRouter = require('./routes/sermons');
const bibleStudiesRouter = require('./routes/bibleStudies');
const prayersRouter = require('./routes/prayers');
const adviceRouter = require('./routes/advice');
const newsRouter = require('./routes/news');
const userRouter = require('./routes/user');
const communityRouter = require('./routes/community');
const videoRoutes = require('./routes/videos');

// Use Routes
app.use('/', devotionalsRouter);
app.use('/', sermonsRouter);
app.use('/', bibleStudiesRouter);
app.use('/', prayersRouter);
app.use('/', adviceRouter);
app.use('/', newsRouter);
app.use('/', userRouter);
app.use('/', communityRouter); 
app.use('/admin', adminRouter);
app.use('/', videoRoutes);

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`Backend server running on port ${PORT}`);
});
