// index.js
const express = require('express');
const cors = require('cors');
const OpenAI = require('openai'); // Use the v4 client
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');
const { sample_sermons } = require('./vars');
const {
    sermon_prompt,
    bible_study_prompt,
    daily_prayer_prompt,
    advice_guidance_prompt,
    daily_devotional_prompt,
    generateTopicSermonPrompt,
    generateScriptureSermonPrompt,
    generateBibleStudyPrompt
} = require('./prompts');
const nodemailer = require('nodemailer');
const { log } = require('console');
require('dotenv').config();

// Initialize Stripe
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const app = express();
app.use(cors());

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
        return res.status(500).json({ error: 'Failed to fetch user.' });
    }
    // Check if user is whitelisted
    const { data: whitelistEntry, error: whitelistError } = await supabase
        .from('whitelist')
        .select('*')
        .eq('email', authUser.email)
        .single();
    if (whitelistError && whitelistError.code !== 'PGRST116') {
        console.error('Error checking whitelist:', whitelistError);
        return res.status(500).json({ error: 'Failed to check whitelist.' });
    }
    if (whitelistEntry) {
        // User is whitelisted, ensure their tier is set to pro
        await supabase
            .from('user_profiles')
            .upsert({ user_id: userId, tier: 'pro' })
            .eq('user_id', userId);
        console.log(`Whitelisted user ${userId} set to pro tier.`);
        return res.json({ received: true });
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

app.use(express.json());

// --- Supabase Client Initialization ---
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

// --- OpenAI Client Initialization ---
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});


// --- Helper function for making OpenAI API calls and parsing JSON ---
async function callOpenAIAndProcessResult(systemPrompt, userPrompt, model, maxTokens, responseFormatType = "text") {
    try {

        console.log("Calling OpenAI with prompt:", systemPrompt, userPrompt);
        const chatCompletion = await openai.chat.completions.create({
            model: 'gpt-5-nano',
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt },
            ],
            response_format: { type: responseFormatType },
        });

        let generatedContent = chatCompletion.choices[0].message.content;
        console.log("AI Generated Content:", await generatedContent);
        if (responseFormatType === "json_object") {
            try {
                return JSON.parse(await generatedContent);
            } catch (jsonError) {
                console.warn("Failed to parse AI response as JSON. Returning raw text.", jsonError);
                return generatedContent; // Return raw text if parsing fails
            }
        }
        return generatedContent; // Return raw text for 'text' format
    } catch (error) {
        console.error("Error during OpenAI API call:", error);
        throw error;
    }
}
app.get('/app-options', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('app_options')
            .select('*')
            .order('created_at', { ascending: false })
        if (error) {
            console.error('Error fetching app option:', error);
            return res.status(500).json({ error: 'Failed to fetch app options.' });
        }
        res.json(data);
    } catch (error) {
        console.error('Unhandled error in /app-options:', error);
        res.status(500).json({ error: 'An unexpected error occurred.' });
    }
});
// --- API Endpoints ---
// Search articles by relevance: title > body > synopsis
app.get('/search', async (req, res) => {
    try {
        const q = (req.query.q || '').trim();
        const limit = Math.min(parseInt(req.query.limit || '50', 10) || 50, 200);
        console.log('Search query:', q, 'Limit:', limit);
        if (!q) {
            return res.status(400).json({ error: 'Query parameter `q` is required.' });
        }

        const pattern = `%${q}%`;
        const { data, error } = await supabase
            .from('scriptural_outlooks')
            .select('id, article_title, article_url, article_thumbnail_url, created_at, publish_date, slug, ai_outlook, article_body')
            .or(`article_title.ilike.${pattern},article_body.ilike.${pattern},ai_outlook->>synopsis.ilike.${pattern}`)
            .limit(limit);

        if (error) {
            console.error('Search query error:', error);
            return res.status(500).json({ error: 'Failed to search articles.' });
        }

        const term = q.toLowerCase();
        const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = new RegExp(escapeRegExp(term), 'g');
        const scoreFor = (text, weight) => {
            if (!text) return 0;
            const t = String(text).toLowerCase();
            const matches = t.match(re) || [];
            return matches.length * weight + (t.includes(term) ? weight : 0);
        };

        const ranked = (data || []).map((row) => {
            const synopsis = row.ai_outlook && row.ai_outlook.synopsis ? row.ai_outlook.synopsis : '';
            const titleScore = scoreFor(row.article_title, 6);
            const bodyScore = scoreFor(row.article_body, 3);
            const synopsisScore = scoreFor(synopsis, 2);
            const totalScore = titleScore + bodyScore + synopsisScore;
            return { ...row, _score: totalScore };
        })
            .filter(r => r._score > 0)
            .sort((a, b) => {
                if (b._score !== a._score) return b._score - a._score;
                const ad = a.publish_date ? new Date(a.publish_date).getTime() : 0;
                const bd = b.publish_date ? new Date(b.publish_date).getTime() : 0;
                return bd - ad;
            });

        return res.json({ query: q, count: ranked.length, results: ranked });
    } catch (err) {
        console.error('Search endpoint error:', err);
        return res.status(500).json({ error: 'Unexpected error during search.' });
    }
});

// New: Endpoint to fetch all canonical categories
app.get('/categories', async (req, res) => {
    try {
        const days = 7;
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);
        const isoDate = startDate.toISOString();

        // 1. Get all categories
        const { data: cats, error: catError } = await supabase.from('categories').select('*');
        if (catError) throw catError;

        // 2. Get recent counts by joining with scriptural_outlooks date
        const { data: counts, error: countErr } = await supabase
            .from('outlook_categories')
            .select('category_id, scriptural_outlooks!inner(created_at)')
            .gte('scriptural_outlooks.created_at', isoDate);

        if (countErr) throw countErr;

        // Aggregate counts in JS
        const activityMap = {};
        counts.forEach(c => {
            activityMap[c.category_id] = (activityMap[c.category_id] || 0) + 1;
        });

        const result = cats.map(c => ({
            ...c,
            recent_article_count: activityMap[c.id] || 0
        })).sort((a, b) => b.recent_article_count - a.recent_article_count);

        res.json(result);
    } catch (error) {
        console.error('Error in /categories:', error);
        res.status(500).json({ error: 'Failed to fetch categories.' });
    }
});

//New: Endpoint to fetch category by ID
app.get('/categories/:id', async (req, res) => {
    const { id } = req.params;
    console.log('Fetching category with ID:', id);
    try {
        const isNumeric = /^\d+$/.test(id);
        const { data, error } = await supabase
            .from('categories')
            .select('*')
        [isNumeric ? 'eq' : 'eq'](isNumeric ? 'id' : 'slug', id)
            .single();

        if (error) {
            console.error('Error fetching category:', error);
            return res.status(404).json({ error: 'Category not found' });
        }
        console.log('Fetched category data:', data);
        res.json(data);
    } catch (error) {
        console.error('Server error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
// New: Endpoint to fetch all canonical topics
app.get('/topics', async (req, res) => {
    try {
        const days = 7;
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);
        const isoDate = startDate.toISOString();

        const { data: topics, error: topError } = await supabase.from('topics').select('*');
        if (topError) throw topError;

        const { data: counts, error: countErr } = await supabase
            .from('outlook_topics')
            .select('topic_id, scriptural_outlooks!inner(created_at)')
            .gte('scriptural_outlooks.created_at', isoDate);

        if (countErr) throw countErr;

        const activityMap = {};
        counts.forEach(t => {
            activityMap[t.topic_id] = (activityMap[t.topic_id] || 0) + 1;
        });

        const result = topics.map(t => ({
            ...t,
            recent_article_count: activityMap[t.id] || 0
        })).sort((a, b) => b.recent_article_count - a.recent_article_count);

        res.json(result);
    } catch (error) {
        console.error('Error in /topics:', error);
        res.status(500).json({ error: 'Failed to fetch topics.' });
    }
});


//New: Endpoint to fetch topic by ID
app.get('/topics/:id', async (req, res) => {
    const { id } = req.params;
    console.log('Fetching topic with ID:', id);
    try {
        const isNumeric = /^\d+$/.test(id);
        const { data, error } = await supabase
            .from('topics')
            .select('*')
        [isNumeric ? 'eq' : 'eq'](isNumeric ? 'id' : 'slug', id)
            .single();
        if (error) {
            console.error('Error fetching topic:', error);
            return res.status(404).json({ error: 'Topic not found' });
        }
        res.json(data);
    } catch (error) {
        console.error('Server error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }


});
// --- GET Single Scriptural Outlook by ID ---
app.get('/scriptural-outlooks/:id', async (req, res) => {
    const { id } = req.params;
    console.log('Fetching scriptural outlook with ID:', id);
    try {
        const isNumeric = /^\d+$/.test(id);
        const { data, error } = await supabase
            .from('scriptural_outlooks')
            .select('*')
        [isNumeric ? 'eq' : 'eq'](isNumeric ? 'id' : 'slug', id)
            .single();

        if (error) {
            console.error('Error fetching article:', error);
            return res.status(404).json({ error: 'Article not found' });
        }

        res.json(data);
    } catch (error) {
        console.error('Server error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

//Endpoint to get news articles from scriptural_outlooks table of database
app.get('/scriptural-outlooks', async (req, res) => {

    //receive params for page and limit
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;
    const topic_id = req.query.topic_id;
    const category_id = req.query.category_id;
    const category_ids = req.query.category_ids; // comma separated list
    const topic_slug = req.query.topic_slug;
    const category_slug = req.query.category_slug;
    const topic = req.query.topic; // can be id or slug
    const category = req.query.category; // can be id or slug

    const hasTopicFilter = Boolean(topic_id || topic_slug || topic);
    const hasCategoryFilter = Boolean(category_id || category_slug || category);
    const topicIsNumeric = topic && /^\d+$/.test(topic);
    const categoryIsNumeric = category && /^\d+$/.test(category);

    try {
        // Construct the select query dynamically based on filters
        // If filtering by a relation, we must use !inner to filter the parent rows
        let outlookTopicsSelect = 'outlook_topics ( topic_id, topics (id, slug, name, description) )';
        let outlookCategoriesSelect = 'outlook_categories ( category_id, categories (id, slug, name, description) )';

        if (hasTopicFilter) {
            outlookTopicsSelect = 'outlook_topics!inner ( topic_id, topics (id, slug, name, description) )';
        }
        if (hasCategoryFilter) {
            outlookCategoriesSelect = 'outlook_categories!inner ( category_id, categories (id, slug, name, description) )';
        }

        const selectQuery = `*, ${outlookCategoriesSelect}, ${outlookTopicsSelect}`;

        let query = supabase
            .from('scriptural_outlooks')
            .select(selectQuery)
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1);

        if (topic_id) {
            if (/^\d+$/.test(topic_id)) {
                query = query.eq('outlook_topics.topic_id', topic_id);
            } else {
                // If a non-numeric topic_id is passed, treat it like a slug
                query = query.eq('outlook_topics.topics.slug', topic_id);
            }
        } else if (topic_slug) {
            query = query.eq('outlook_topics.topics.slug', topic_slug);
        } else if (topic) {
            query = topicIsNumeric
                ? query.eq('outlook_topics.topic_id', topic)
                : query.eq('outlook_topics.topics.slug', topic);
        }
        if (category_id) {
            if (/^\d+$/.test(category_id)) {
                query = query.eq('outlook_categories.category_id', category_id);
            } else {
                // If a non-numeric category_id is passed, treat it like a slug
                query = query.eq('outlook_categories.categories.slug', category_id);
            }
        } else if (category_slug) {
            query = query.eq('outlook_categories.categories.slug', category_slug);
        } else if (category) {
            query = categoryIsNumeric
                ? query.eq('outlook_categories.category_id', category)
                : query.eq('outlook_categories.categories.slug', category);
        } else if (category_ids) {
            const ids = category_ids.split(','); // Expecting "1,2,3"
            query = query.in('category_id', ids);
        }


        const { data, error } = await query;

        if (error) {
            console.error('Error fetching scriptural outlooks:', error);
            return res.status(500).json({ error: 'Failed to fetch scriptural outlooks.' });
        }

        // Map the results to a cleaner format for the frontend
        const cleanedData = data.map(outlook => {
            return {
                ...outlook,
                // Restructure categories array to just include category data
                categories: outlook.outlook_categories ? outlook.outlook_categories.map(oc => oc.categories) : [],
                // Restructure topics array to just include topic data
                topics: outlook.outlook_topics ? outlook.outlook_topics.map(ot => ot.topics) : [],
                // Remove the intermediary join table properties for cleanliness
                outlook_categories: undefined,
                outlook_topics: undefined,
            };
        });

        res.json(cleanedData);
    } catch (error) {
        console.error('Unhandled error in /scriptural-outlooks:', error);
        res.status(500).json({ error: 'An unexpected error occurred.' });
    }
});



// Endpoint to initiate Daily Devotional generation
app.post('/generate-devotional', async (req, res) => {
    try {
        const startTime = Date.now();
        const { userId, focusAreas, improvementAreas, recentDevotionals } = req.body;
        const generationDate = new Date().toISOString().split('T')[0];
        console.log('generate-devotional', userId, focusAreas, improvementAreas, recentDevotionals);
        console.log('generate-devotional, and prayer');
        // 1. Create a placeholder in the database immediately
        const { data: newDevotional, error: insertError } = await supabase
            .from('daily_devotionals')
            .insert({
                user_id: userId,
                // Assuming 'content' or another field is the primary AI output placeholder
                content: 'Generating devotional...',
                status: 'pending', // IMPORTANT: This assumes you have a 'status' column
                // scripture: null, // Placeholder if scripture is a separate output from AI
                created_at: new Date().toISOString(), // Ensure created_at is set
                updated_at: new Date().toISOString(), // Ensure updated_at is set
            })
            .select('devotional_id')
            .single();

        if (insertError) {
            console.error('Error creating placeholder devotional:', insertError);
            return res.status(500).json({ error: 'Failed to initiate devotional generation.' });
        }
        // 1-a. Create a placeholder for prayer in the daily_prayer table
        const { data: newPrayer, error: insertPrayerError } = await supabase
            .from('daily_prayers')
            .insert({
                user_id: userId,
                generated_prayer: 'Generating prayer...',
                status: 'pending', // Assuming you have a status column
                date: generationDate,
                went_through_guided_prayer: false,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
            })
            .select('prayer_id')
            .single();
        if (insertPrayerError) {
            console.error('Error creating placeholder prayer:', insertPrayerError);
            return res.status(500).json({ error: 'Failed to initiate prayer generation.' });
        }

        // 2. Return the placeholder ID to the frontend immediately
        res.status(202).json({
            message: 'Devotional generation initiated.',
            devotionalId: newDevotional.devotional_id,
            status: 'pending'
        });

        // 3. Start AI generation in the background (after sending response)
        const userPrompt = `
        Focus areas: ${focusAreas.join(', ')}.
        Improvement areas: ${improvementAreas.join(', ')}.
        Recent devotionals: ${JSON.stringify(recentDevotionals)}
        `;

        try {
            const generatedContent = await callOpenAIAndProcessResult(
                daily_devotional_prompt,
                userPrompt,
                'gpt-4.1-2025-04-14', // Model for devotional
                5000, // Max tokens
                "text" // Devotional expected as plain text
            );

            //parse generatedContent to json
            const parsedContent = JSON.parse(generatedContent);
            const { title, scripture, content, daily_prayer } = parsedContent;
            // Assuming the AI directly outputs the devotional text for the 'content' column
            const { error: updateError } = await supabase
                .from('daily_devotionals')
                .update({
                    title: title,
                    content: content,
                    scripture: scripture,
                    status: 'completed',
                    updated_at: new Date().toISOString(),
                    // If AI also generates scripture, you'd parse and include it here
                })
                .eq('devotional_id', newDevotional.devotional_id);

            if (updateError) {
                console.error(`Error updating devotional record ${newDevotional.devotional_id}:`, updateError);
                // Update status to 'failed' if update fails
                await supabase.from('daily_devotionals').update({ status: 'failed' }).eq('devotional_id', newDevotional.devotional_id);
            } else {
                console.log(`Devotional record ${newDevotional.devotional_id} successfully generated and updated.`);
            }
            // Now update the prayer record with the generated prayer
            const { error: updatePrayerError } = await supabase

                .from('daily_prayers')
                .update({
                    generated_prayer: daily_prayer,
                    updated_at: new Date().toISOString(),
                    status: 'completed'
                })
                .eq('prayer_id', newPrayer.prayer_id);

            const duration = Date.now() - startTime;
            logEvent('info', 'backend', userId, 'generate_devotional', 'Successfully generated devotional', {}, duration);
            if (updatePrayerError) {
                console.error(`Error updating prayer record for devotional ${newDevotional.devotional_id}:`, updatePrayerError);
                await supabase.from('daily_prayers').update({ prayer_text: 'Failed to generate prayer.' }).eq('prayer_id', newPrayer.prayer_id);
                logEvent('error', 'backend', userId, 'generate_devotional', 'Failed to update prayer record', { error: updatePrayerError.message }, duration);
            } else {
                console.log(`Prayer record for devotional ${newDevotional.devotional_id} successfully generated and updated.`);
            }
        } catch (aiError) {
            console.error(`AI generation failed for devotional ${newDevotional.devotional_id}:`, aiError);
            await supabase.from('daily_devotionals').update({ status: 'failed' }).eq('devotional_id', newDevotional.devotional_id);
            logEvent('error', 'backend', userId, 'generate_devotional', 'AI generation failed', { error: aiError.message }, Date.now() - startTime);
        }

    } catch (error) {
        console.error('Unhandled error in /generate-devotional:', error);
        logEvent('error', 'backend', null, 'generate_devotional', 'Unhandled error', { error: error.message }, 0);
        res.status(500).json({ error: 'An unexpected error occurred.' });
    }
});

//Endpoint to get Sermons by user id
app.get('/sermons/:userId', async (req, res) => {
    const { userId } = req.params;
    console.log('Fetching sermons for user ID:', userId);
    try {
        const { data, error } = await supabase
            .from('sermons')
            .select('*')
            .eq('user_id', userId)
            .neq('status', 'failed')
            .order('created_at', { ascending: false });
        if (error) {
            console.error('Error fetching sermons:', error);
            return res.status(500).json({ error: 'Failed to fetch sermons.' });
        }
        res.json(data);
    } catch (error) {
        console.error('Unhandled error in /sermons/:userId:', error);
        res.status(500).json({ error: 'An unexpected error occurred.' });
    }
});
// Helper to get tuning notes
async function getTuningNotes(userId) {
    const { data } = await supabase
        .from('user_profiles')
        .select('ai_tuning_notes')
        .eq('user_id', userId)
        .single();
    return data?.ai_tuning_notes || "";
}
// Endpoint to initiate Sermon generation by Topic
app.post('/generate-sermon-by-topic', async (req, res) => {
    try {
        const startTime = Date.now();
        const { userId, topic, userProfile } = req.body;
        console.log(userId, topic, userProfile);
        // 1. Create a placeholder in the database immediately
        const { data: newSermon, error: insertError } = await supabase
            .from('sermons')
            .insert({
                user_id: userId,
                title: `Generating Sermon: ${topic}`,
                sermon_outline: 'Generating outline...',
                sermon_body: 'Generating content...',
                status: 'pending',
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
            })
            .select('sermon_id')
            .single();

        if (insertError) {
            console.error('Error creating placeholder sermon:', insertError);
            return res.status(500).json({ error: 'Failed to initiate sermon generation.' });
        }

        // 2. Return the placeholder ID to the frontend immediately
        res.status(202).json({
            message: 'Sermon generation initiated.',
            sermonId: newSermon.sermon_id,
            status: 'pending'
        });

        // 3. Start AI generation in the background
        const userPrompt = 'Topic: ' + topic + '\nInclude Illustration: true\nGenerate the sermon based on this topic. You may select a relevant scripture passage to include in the "scripture" field of the JSON, or leave it null if no single passage is central.' + (userProfile && userProfile.sermon_preferences ? '\nUser Preferences: ' + JSON.stringify(userProfile.sermon_preferences) : '' + ' If the sermon generated does not have the length defined, please run int back through to expand or contract to meet the lenght prescriped.');

        const systemPrompt = generateTopicSermonPrompt(await getTuningNotes(userId));
        try {
            const generatedSermon = await callOpenAIAndProcessResult(
                await systemPrompt,
                userPrompt,
                'gpt-4.1-2025-04-14', // Model for sermon
                4000, // Max tokens
                "json_object", // Sermon expected as JSON
            );

            // Update the record with parsed content
            const { error: updateError } = await supabase
                .from('sermons')
                .update({
                    title: generatedSermon.title || `Sermon on ${topic}`,
                    scripture: generatedSermon.scripture || null,
                    illustration: generatedSermon.illustration || null,
                    sermon_outline: generatedSermon.sermon_outline || null, // Assuming this is text, or stringified JSON
                    key_takeaways: generatedSermon.key_takeaways || null, // Assuming this is text, or stringified JSON
                    sermon_body: generatedSermon.sermon_body || null,
                    status: 'completed',
                    user_id: userId, // Associate sermon with user
                    updated_at: new Date().toISOString(),
                })
                .eq('sermon_id', newSermon.sermon_id);
                const duration = Date.now() - startTime;
            if (updateError) {
                console.error(`Error updating sermon record ${newSermon.sermon_id}:`, updateError);
                await supabase.from('sermons').update({ status: 'failed' }).eq('sermon_id', newSermon.sermon_id);
                logEvent('error', 'backend', userId, 'generate_sermon_by_topic', 'Failed to update sermon record', { error: updateError.message }, duration);
            } else {
                console.log(`Sermon record ${newSermon.sermon_id} successfully generated and updated.`);
                logEvent('info', 'backend', userId, 'generate_sermon_by_topic', 'Successfully generated sermon', {}, duration);
            }
        } catch (aiError) {
            console.error(`AI generation failed for sermon ${newSermon.sermon_id}:`, aiError);
            await supabase.from('sermons').update({ status: 'failed' }).eq('sermon_id', newSermon.sermon_id);
            logEvent('error', 'backend', userId, 'generate_sermon_by_topic', 'AI generation failed', { error: aiError.message }, Date.now() - startTime);
        }

    } catch (error) {
        console.error('Unhandled error in /generate-sermon-by-topic:', error);
        res.status(500).json({ error: 'An unexpected error occurred.' });
        logEvent('error', 'backend', null, 'generate_sermon_by_topic', 'Unhandled error', { error: error.message }, 0);
    }
});

// Endpoint to initiate Sermon generation by Scripture
app.post('/generate-sermon-by-scripture', async (req, res) => {
    try {
        const startTime = Date.now();
        const { userId, scripture, userProfile } = req.body;

        const { data: newSermon, error: insertError } = await supabase
            .from('sermons')
            .insert({
                user_id: userId,
                title: `Generating Sermon for ${scripture}`,
                date_preached: new Date().toISOString().split('T')[0],
                sermon_outline: 'Generating outline...',
                sermon_body: 'Generating content...',
                status: 'pending',
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
            })
            .select('sermon_id')
            .single();

        if (insertError) {
            console.error('Error creating placeholder sermon:', insertError);
            return res.status(500).json({ error: 'Failed to initiate sermon generation.' });
        }

        res.status(202).json({
            message: 'Sermon generation initiated.',
            sermonId: newSermon.sermon_id,
            status: 'pending'
        });

        const userPrompt = 'Scripture: ' + scripture + '\nInclude Illustration: true\nGenerate the sermon based on this scripture. ' + (userProfile && userProfile.sermon_preferences ? '\nUser Preferences: ' + JSON.stringify(userProfile.sermon_preferences) : '');
        const systemPrompt = generateScriptureSermonPrompt(await getTuningNotes(userId));
        try {
            const generatedSermon = await callOpenAIAndProcessResult(
                systemPrompt,
                userPrompt,
                'gpt-4.1-2025-04-14',
                4000,
                "json_object"
            );

            const { error: updateError } = await supabase
                .from('sermons')
                .update({
                    title: generatedSermon.title || `Sermon for ${scripture}`,
                    scripture: generatedSermon.scripture || null,
                    illustration: generatedSermon.illustration || null,
                    sermon_outline: generatedSermon.sermon_outline || null,
                    key_takeaways: generatedSermon.key_takeaways || null,
                    sermon_body: generatedSermon.sermon_body || null,
                    status: 'completed',
                    updated_at: new Date().toISOString(),
                })
                .eq('sermon_id', newSermon.sermon_id);
                const duration = Date.now() - startTime;
            if (updateError) {
                console.error(`Error updating sermon record ${newSermon.sermon_id}:`, updateError);
                await supabase.from('sermons').update({ status: 'failed' }).eq('sermon_id', newSermon.sermon_id);
                logEvent('error', 'backend', userId, 'generate_sermon_by_scripture', 'Failed to update sermon record', { error: updateError.message }, duration);
            } else {
                console.log(`Sermon record ${newSermon.sermon_id} successfully generated and updated.`);
                logEvent('info', 'backend', userId, 'generate_sermon_by_scripture', 'Successfully generated sermon', {}, duration);
            }
        } catch (aiError) {
            console.error(`AI generation failed for sermon ${newSermon.sermon_id}:`, aiError);
            await supabase.from('sermons').update({ status: 'failed' }).eq('sermon_id', newSermon.sermon_id);
            logEvent('error', 'backend', userId, 'generate_sermon_by_scripture', 'AI generation failed', { error: aiError.message }, Date.now() - startTime);
        }

    } catch (error) {
        console.error('Unhandled error in /generate-sermon-by-scripture:', error);
        res.status(500).json({ error: 'An unexpected error occurred.' });
        logEvent('error', 'backend', null, 'generate_sermon_by_scripture', 'Unhandled error', { error: error.message }, 0);
    }
});

//Endpoint to get Bible Studies by user id
app.get('/bible-studies/:userId', async (req, res) => {
    const { userId } = req.params;
    console.log('Fetching bible studies for user ID:', userId);
    try {
        const { data, error } = await supabase
            .from('bible_studies')
            .select('*, bible_study_lessons(lesson_number)')
            .eq('user_id', userId)
            .neq('status', 'failed')
            .order('created_at', { ascending: false });
        if (error) {
            console.error('Error fetching bible studies:', error);
            return res.status(500).json({ error: 'Failed to fetch bible studies.' });
        }

        res.json(data);
    } catch (error) {
        console.error('Unhandled error in /bible-studies/:userId:', error);
        res.status(500).json({ error: 'An unexpected error occurred.' });
    }
});

//Endpoing to get a single Bible study by study id
app.get('/bible-study/:studyId', async (req, res) => {
    const { studyId } = req.params;
    console.log('Fetching bible study with ID:', studyId);
    try {
        const isNumeric = /^\d+$/.test(studyId);
        const { data, error } = await supabase
            .from('bible_studies')
            .select('*')
        [isNumeric ? 'eq' : 'eq'](isNumeric ? 'study_id' : 'slug', studyId)
            .single();
        if (error) {
            console.error('Error fetching bible study:', error);
            return res.status(404).json({ error: 'Bible study not found' });
        }
        //get lessons for this study and add to data
        const { data: lessons, error: lessonsError } = await supabase
            .from('bible_study_lessons')
            .select('*')
            .eq('study_id', studyId)
            .order('lesson_number', { ascending: true });
        if (lessonsError) {
            console.error('Error fetching bible study lessons for detail:', lessonsError);
            return res.status(500).json({ error: 'Failed to fetch bible study lessons for detail.' });
        }
        data.lessons = lessons;
        res.json(data);
    } catch (error) {
        console.error('Server error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
//endpoint to get Bible Study Lessons by study id
app.get('/bible-study-lessons/:studyId', async (req, res) => {
    const { studyId } = req.params;
    console.log('Fetching bible study lessons for study ID:', studyId);
    try {
        const { data, error } = await supabase
            .from('bible_study_lessons')
            .select('*')
            .eq('study_id', studyId)
            .order('lesson_number', { ascending: true });
        if (error) {
            console.error('Error fetching bible study lessons:', error);
            return res.status(500).json({ error: 'Failed to fetch bible study lessons.' });
        }
        res.json(data);
    } catch (error) {
        console.error('Unhandled error in /bible-study-lessons/:studyId:', error);
        res.status(500).json({ error: 'An unexpected error occurred.' });
    }
});

//Endpoint to get a single Bible Study Lesson by lesson id
app.get('/bible-study-lessons/detail/:lessonId', async (req, res) => {
    const { lessonId } = req.params;
    console.log('Fetching bible study detail for lesson ID:', lessonId);
    try {
        const { data, error } = await supabase
            .from('bible_study_lessons')
            .select('*')
            .eq('lesson_id', lessonId)
            .single();
        if (error) {
            console.error('Error fetching bible study detail:', error);
            return res.status(500).json({ error: 'Failed to fetch bible study detail.' });
        }
        res.json(data);
    } catch (error) {
        console.error('Unhandled error in /bible-studies/detail/:lessonId:', error);
        res.status(500).json({ error: 'An unexpected error occurred.' });
    }
});

// upsert bible study lesson (create or update)
app.post('/bible-study-lessons/:lessonId', async (req, res) => {
    try {
        const lessonData = req.body;
        const { lessonId } = req.params;
        console.log('Upserting bible study lesson:', lessonData);
        const { data, error } = await supabase
            .from('bible_study_lessons')
            .upsert({
                lesson_id: lessonId,
                ...lessonData,
                updated_at: new Date().toISOString(),
            })
            .select()
            .single();
        if (error) {
            console.error('Error upserting bible study lesson:', error);
            return res.status(500).json({ error: 'Failed to upsert bible study lesson.' });
        }
        res.json(data);
    } catch (error) {
        console.error('Unhandled error in /bible-study-lessons/:lessonId:', error);
        res.status(500).json({ error: 'An unexpected error occurred.' });
    }
});

// Endpoint to initiate Bible Study generation
app.post('/generate-bible-study', async (req, res) => {
    try {
        const { userId, topic, length, method } = req.body;
        const startTime = Date.now();
        // 1. Create a placeholder in the `bible_studies` table immediately
        const { data: newStudy, error: insertStudyError } = await supabase
            .from('bible_studies')
            .insert({
                user_id: userId,
                title: `Generating Bible Study: ${topic}`,
                subtitle: 'Content being generated...', // Placeholder
                study_method: method, // Initial method
                illustration: 'Generating illustration prompt...', // Placeholder
                status: 'pending',
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
            })
            .select('study_id')
            .single();

        if (insertStudyError) {
            console.error('Error creating placeholder Bible study:', insertStudyError);
            return res.status(500).json({ error: 'Failed to initiate Bible study generation.' });
        }

        // 2. Return the placeholder ID to the frontend immediately
        res.status(202).json({
            message: 'Bible Study generation initiated.',
            studyId: newStudy.study_id,
            status: 'pending'
        });

        // 3. Start AI generation in the background
        const userPrompt = 'Topic: ' + topic + '\n Number of Lessons:' + length + '\n Bible Study Type: ' + method + '\n Include Illustration: true\n ';
        //const systemPrompt = generateBibleStudyPrompt(await getTuningNotes(userId));
        try {
            const generatedStudy = await callOpenAIAndProcessResult(
                bible_study_prompt,
                userPrompt,
                'gpt-4.1-2025-04-14',
                5000,
                "json_object"
            );

            // Update the parent bible_studies record with top-level data
            const { error: updateStudyError } = await supabase
                .from('bible_studies')
                .update({
                    title: generatedStudy.title || `Bible Study on ${topic}`,
                    subtitle: generatedStudy.subtitle || null,
                    illustration: generatedStudy.illustration || null,
                    study_method: generatedStudy.study_method || method,
                    status: 'completed',
                    updated_at: new Date().toISOString(),
                })
                .eq('study_id', newStudy.study_id);
                const duration = Date.now() - startTime;
            if (updateStudyError) {
                console.error(`Error updating bible_studies record ${newStudy.study_id}:`, updateStudyError);
                await supabase.from('bible_studies').update({ status: 'failed' }).eq('study_id', newStudy.study_id);
                logEvent('error', 'backend', userId, 'generate_bible_study', 'Failed to update bible_studies record', { error: updateStudyError.message }, duration);
                return; // Stop here if parent update fails
            }

            // Insert individual lessons into bible_study_lessons table
            if (generatedStudy.studies && Array.isArray(generatedStudy.studies)) {
                for (const lesson of generatedStudy.studies) {
                    const { error: insertLessonError } = await supabase
                        .from('bible_study_lessons')
                        .insert({
                            study_id: newStudy.study_id, // Link to parent study
                            lesson_number: lesson.lesson_number,
                            title: lesson.title,
                            scripture: lesson.scripture || null,
                            key_verse: lesson.key_verse || null,
                            lesson_aims: lesson.lesson_aims || null,
                            study_outline: lesson.study_outline || null,
                            introduction: lesson.introduction || null,
                            commentary: lesson.commentary || null,
                            discussion_starters: lesson.discussion_starters || null,
                            application_sidebar: lesson.application_sidebar || null,
                            conclusion: lesson.conclusion || null,
                            reflection_questions: lesson.reflection_questions || null, // Assuming this is also present in AI output
                            user_id: userId, // Associate lesson with user
                            created_at: new Date().toISOString(),
                            updated_at: new Date().toISOString(),
                        });
                    if (insertLessonError) {
                        logEvent('error', 'backend', userId, 'generate_bible_study', `Failed to insert bible_study_lesson for study ${newStudy.study_id}`, { error: insertLessonError.message }, Date.now() - startTime);
                        console.error(`Error inserting bible_study_lesson for study ${newStudy.study_id}:`, insertLessonError);
                        // Consider rolling back parent study status to failed or partial
                    }
                }
                logEvent('info', 'backend', userId, 'generate_bible_study', 'Successfully generated bible study and lessons', {}, duration);
                console.log(`Bible study ${newStudy.study_id} and its lessons successfully generated and updated.`);
            } else {
                logEvent('error', 'backend', userId, 'generate_bible_study', `No 'studies' array found in generated Bible study for ID ${newStudy.study_id}`, {}, Date.now() - startTime);
                console.warn(`No 'studies' array found in generated Bible study for ID ${newStudy.study_id}.`);
            }

        } catch (aiError) {
            logEvent('error', 'backend', userId, 'generate_bible_study', 'AI generation failed', { error: aiError.message }, Date.now() - startTime);
            console.error(`AI generation failed for Bible study ${newStudy.study_id}:`, aiError);
            await supabase.from('bible_studies').update({ status: 'failed' }).eq('study_id', newStudy.study_id);
        }

    } catch (error) {
        logEvent('error', 'backend', null, 'generate_bible_study', 'Unhandled error', { error: error.message }, 0);
        console.error('Unhandled error in /generate-bible-study:', error);
        res.status(500).json({ error: 'An unexpected error occurred.' });
    }
});

// New Endpoint: Generate Daily Prayer
app.post('/generate-prayer', async (req, res) => {
    try {
        const startTime = Date.now();
        const { userId, focusAreas, improvementAreas } = req.body;
        const prayerDate = new Date().toISOString().split('T')[0];

        // 1. Create placeholder
        const { data: newPrayer, error: insertError } = await supabase
            .from('daily_prayers')
            .insert({
                user_id: userId,
                date: prayerDate,
                generated_prayer: 'Generating prayer...',
                went_through_guided_prayer: false, // Default
                status: 'pending', // IMPORTANT: Assumes 'status' column exists
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
            })
            .select('prayer_id')
            .single();

        if (insertError) {
            console.error('Error creating placeholder prayer:', insertError);
            return res.status(500).json({ error: 'Failed to initiate prayer generation.' });
        }

        res.status(202).json({
            message: 'Prayer generation initiated.',
            prayerId: newPrayer.prayer_id,
            status: 'pending'
        });

        // 3. Start AI generation in background
        const userPrompt = `Focus Areas: ${focusAreas.join(', ')}\nImprovement Areas: ${improvementAreas.join(', ')}`;
        try {
            const generatedPrayer = await callOpenAIAndProcessResult(
                daily_prayer_prompt,
                userPrompt,
                'gpt-4.1-2025-04-14',
                4000, // Max tokens for prayer
                "text"
            );

            const { error: updateError } = await supabase
                .from('daily_prayers')
                .update({
                    generated_prayer: generatedPrayer,
                    status: 'completed',
                    updated_at: new Date().toISOString(),
                })
                .eq('prayer_id', newPrayer.prayer_id);
                const duration = Date.now() - startTime;    
            if (updateError) {
                console.error(`Error updating prayer record ${newPrayer.prayer_id}:`, updateError);
                await supabase.from('daily_prayers').update({ status: 'failed' }).eq('prayer_id', newPrayer.prayer_id);
                logEvent('error', 'backend', userId, 'generate_prayer', 'Failed to update prayer record', { error: updateError.message }, duration);
            } else {
                logEvent('info', 'backend', userId, 'generate_prayer', 'Successfully generated prayer', {}, duration);
                console.log(`Prayer record ${newPrayer.prayer_id} successfully generated and updated.`);
            }
        } catch (aiError) {
            logEvent('error', 'backend', userId, 'generate_prayer', 'AI generation failed', { error: aiError.message }, Date.now() - startTime);
            console.error(`AI generation failed for prayer ${newPrayer.prayer_id}:`, aiError);
            await supabase.from('daily_prayers').update({ status: 'failed' }).eq('prayer_id', newPrayer.prayer_id);
        }

    } catch (error) {
        logEvent('error', 'backend', null, 'generate_prayer', 'Unhandled error', { error: error.message }, 0);
        console.error('Unhandled error in /generate-prayer:', error);
        res.status(500).json({ error: 'An unexpected error occurred.' });
    }
});

// New Endpoint: Generate Advice/Guidance
app.post('/generate-advice', async (req, res) => {
    try {
        const startTime = Date.now();
        const { userId, situation } = req.body;

        // 1. Create placeholder
        const { data: newAdvice, error: insertError } = await supabase
            .from('advice_guidance')
            .insert({
                user_id: userId,
                situation: situation,
                advice_points: 'Generating advice...', // Placeholder
                status: 'pending', // IMPORTANT: Assumes 'status' column exists
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
            })
            .select('advice_id')
            .single();

        if (insertError) {
            console.error('Error creating placeholder advice:', insertError);
            return res.status(500).json({ error: 'Failed to initiate advice generation.' });
        }

        res.status(202).json({
            message: 'Advice generation initiated.',
            adviceId: newAdvice.advice_id,
            status: 'pending'
        });

        // 3. Start AI generation in background
        const userPrompt = `Situation: ${situation}`;
        try {
            const generatedAdvice = await callOpenAIAndProcessResult(
                advice_guidance_prompt,
                userPrompt,
                'gpt-4.1-2025-04-14',
                4000, // Max tokens for advice
                "json_object"
            );

            // The AI output is a JSON with 'situation_summary' and 'advice_points'
            const { error: updateError } = await supabase
                .from('advice_guidance')
                .update({
                    situation: generatedAdvice.situation_summary || situation, // Update situation with AI summary
                    advice_points: JSON.stringify(generatedAdvice.advice_points || []), // Store array as JSON string or JSONB if column is JSONB
                    status: 'completed',
                    updated_at: new Date().toISOString(),
                })
                .eq('advice_id', newAdvice.advice_id);
                const duration = Date.now() - startTime;
            if (updateError) {
                logEvent('error', 'backend', userId, 'generate_advice', 'Failed to update advice record', { error: updateError.message }, duration);
                console.error(`Error updating advice record ${newAdvice.advice_id}:`, updateError);
                await supabase.from('advice_guidance').update({ status: 'failed' }).eq('advice_id', newAdvice.advice_id);
            } else {
                logEvent('info', 'backend', userId, 'generate_advice', 'Successfully generated advice', {}, duration);
                console.log(`Advice record ${newAdvice.advice_id} successfully generated and updated.`);
            }
        } catch (aiError) {
            logEvent('error', 'backend', userId, 'generate_advice', 'AI generation failed', { error: aiError.message }, Date.now() - startTime);
            console.error(`AI generation failed for advice ${newAdvice.advice_id}:`, aiError);
            await supabase.from('advice_guidance').update({ status: 'failed' }).eq('advice_id', newAdvice.advice_id);
        }

    } catch (error) {
        logEvent('error', 'backend', null, 'generate_advice', 'Unhandled error', { error: error.message }, 0);
        console.error('Unhandled error in /generate-advice:', error);
        res.status(500).json({ error: 'An unexpected error occurred.' });
    }
});


// --- Fetching Endpoints (for frontend to check status and retrieve completed content) ---
// These endpoints directly query Supabase.

// Fetch daily news synopses with optional limit and ordering, with optional query parameters for date range
app.get('/daily-news-synopses', async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit || '50', 10) || 50, 200);
        const startDate = req.query.startDate;
        const endDate = req.query.endDate;
        const order = (req.query.order || 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc';
        const { data, error } = await supabase
            .from('daily_news_synopses')
            .select('*')
            .gte(startDate ? 'created_at' : 'created_at', startDate || '1970-01-01')
            .lte(endDate ? 'created_at' : 'created_at', endDate || new Date().toISOString())
            .order('created_at', { ascending: order === 'asc' })
            .limit(limit);

        if (error) {
            console.error('Error fetching daily news synopses:', error);
            return res.status(500).json({ error: 'Failed to fetch daily news synopses.' });
        }

        return res.json(data);
    } catch (err) {
        console.error('Unhandled error in /daily-news-synopses:', err);
        return res.status(500).json({ error: 'An unexpected error occurred.' });
    }
});

app.get('/sermon/:sermonId', async (req, res) => {
    const { sermonId } = req.params;
    const { data, error } = await supabase
        .from('sermons')
        .select('*')
        .eq('sermon_id', sermonId)
        .single();

    if (error) {
        console.error('Error fetching sermon:', error);
        return res.status(500).json({ error: 'Failed to fetch sermon.' });
    }
    if (!data) {
        return res.status(404).json({ error: 'Sermon not found.' });
    }
    res.json(data);
});


app.get('/devotionals/:userId', async (req, res) => {
    const { userId } = req.params;
    const { data, error } = await supabase
        .from('daily_devotionals')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false }); // Assuming created_at for ordering
    if (error) {
        console.error('Error fetching devotionals:', error);
        return res.status(500).json({ error: 'Failed to fetch devotionals.' });
    }
    res.json(data);
});

//get devotional by devotionalId
app.get('/devotional/:userId/:devotionalId', async (req, res) => {
    const { userId, devotionalId } = req.params;
    const { data, error } = await supabase
        .from('daily_devotionals')
        .select('*')
        .eq('user_id', userId)
        .eq('devotional_id', devotionalId)
        .single();
    if (error) {
        console.error('Error fetching devotional by ID:', error);
        return res.status(500).json({ error: 'Failed to fetch devotional by ID.' });
    }
    if (!data) {
        return res.status(404).json({ error: 'Devotional not found.' });
    }
    res.json(data);
});
app.delete('/devotional/:devotionalId', async (req, res) => {
    const { devotionalId } = req.params;
    try {
        const { error } = await supabase
            .from('daily_devotionals')
            .delete()
            .eq('devotional_id', devotionalId);

        if (error) throw error;
        res.json({ message: 'Devotional deleted successfully' });
    } catch (error) {
        console.error('Error deleting devotional:', error);
        res.status(500).json({ error: 'Failed to delete devotional' });
    }
});

app.delete('/prayer/:prayerId', async (req, res) => {
    const { prayerId } = req.params;
    try {
        const { error } = await supabase
            .from('daily_prayers')
            .delete()
            .eq('prayer_id', prayerId);

        if (error) throw error;
        res.json({ message: 'Prayer deleted successfully' });
    } catch (error) {
        console.error('Error deleting prayer:', error);
        res.status(500).json({ error: 'Failed to delete prayer' });
    }
});
// New Fetching Endpoint: Get Daily Prayers for a user
app.get('/prayers/:userId', async (req, res) => {
    const { userId } = req.params;
    const { data, error } = await supabase
        .from('daily_prayers')
        .select('*')
        .eq('user_id', userId)
        .order('date', { ascending: false }); // Order by date

    if (error) {
        console.error('Error fetching daily prayers:', error);
        return res.status(500).json({ error: 'Failed to fetch daily prayers.' });
    }
    res.json(data);
});
//get prayer by prayerId
app.get('/prayer/:userId/:prayerId', async (req, res) => {
    const { prayerId, userId } = req.params;
    const { data, error } = await supabase
        .from('daily_prayers')
        .select('*')
        .eq('user_id', userId)
        .eq('prayer_id', prayerId)
        .single();
    if (error) {
        console.error('Error fetching prayer by ID:', error);
        return res.status(500).json({ error: 'Failed to fetch prayer by ID.' });
    }
    if (!data) {
        return res.status(404).json({ error: 'Prayer not found.' });
    }
    res.json(data);
});
// New Fetching Endpoint: Get Advice/Guidance for a user
app.get('/advice/:userId', async (req, res) => {
    const { userId } = req.params;
    const { data, error } = await supabase
        .from('advice_guidance')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

    if (error) {
        console.error('Error fetching advice:', error);
        return res.status(500).json({ error: 'Failed to fetch advice.' });
    }
    res.json(data);
});
//New Fetching Endpoint: Get Advice/Guidance by adviceId
app.get('/advice/:userId/:adviceId', async (req, res) => {

    const { adviceId, userId } = req.params;
    const { data, error } = await supabase
        .from('advice_guidance')
        .select('*')
        .eq('user_id', userId)
        .eq('advice_id', adviceId)
        .single();
    if (error) {
        console.error('Error fetching advice by ID:', error);
        return res.status(500).json({ error: 'Failed to fetch advice by ID.' });
    }
    if (!data) {
        return res.status(404).json({ error: 'Advice not found.' });
    }
    res.json(data);
});

// DELETE Advice Endpoint
app.delete('/advice/:adviceId', async (req, res) => {
    const { adviceId } = req.params;
    try {
        const { error } = await supabase
            .from('advice_guidance')
            .delete()
            .eq('advice_id', adviceId);

        if (error) throw error;
        res.json({ message: 'Advice deleted successfully' });
    } catch (error) {
        console.error('Error deleting advice:', error);
        res.status(500).json({ error: 'Failed to delete advice' });
    }
});
// Get user_profile by userId
app.get('/user-profile/:userId', async (req, res) => {
    const { userId } = req.params;
    const { data, error } = await supabase
        .from('user_profiles')
        .select('*')
        .eq('user_id', userId)
        .single();
    //get email address from auth.users table
    const authData = await supabase.auth.admin.getUserById(userId);
    const user = authData.data.user;
    console.log('Fetched user email for whitelist check:', user);
    //check if user email is whitelisted, and update profile tielr to pro
    const { data: whitelistEntry, error: whitelistError } = await supabase
        .from('whitelist')
        .select('*')
        .eq('email', user.email)
        .single();

    if (whitelistError && whitelistError.code !== 'PGRST116') {
        console.error('Error checking whitelist:', whitelistError);
        return res.status(500).json({ error: 'Failed to check whitelist.' });
    }
    if (whitelistEntry) {
        // User is whitelisted, ensure their tier is set to pro
        const whitelistProfile = await supabase
            .from('user_profiles')
            .upsert({ user_id: userId, tier: 'pro' })
            .select('*')
            .single();
        console.log(`Whitelisted user ${userId} set to pro tier.`);
        return res.status(200).json(whitelistProfile);
    } else {
        const nonWhitelistProfile = await supabase
            .from('user_profiles')
            .select('*')
            .eq('user_id', userId)
            .single();
        return res.status(200).json(nonWhitelistProfile);
    }

    if (error) {

        console.error('Error fetching user profile:', error);
        return res.status(500).json({ error: 'Failed to fetch user profile.' });
    }
    if (!data) {
        return res.status(404).json({ error: 'User profile not found.' });
    }
    res.json(data);
});
//save or update user_profile by userId
app.post('/user-profile/:userId', async (req, res) => {
    const { userId } = req.params;
    const profileData = req.body;
    if (!profileData.user_id) {
        profileData.user_id = userId;
    }
    const { data, error } = await supabase
        .from('user_profiles')
        .upsert(profileData)
        .eq('user_id', userId);
    if (error) {
        console.error('Error saving or updating user profile:', error);
        return res.status(500).json({ error: 'Failed to save or update user profile.' });
    }
    res.json(data);
});

// Example Node.js/Express route for a Supabase backend
app.post('/log-activity', async (req, res) => {
    const { userId, activityType, activityId } = req.body;

    if (!userId || !activityType || !activityId) {
        return res.status(400).send('Missing user ID or activity type.');
    }

    // Check if a record for this user and activity type already exists for today
    const { data: existingEntry, error: fetchError } = await supabase
        .from('user_activities')
        .select('id')
        .eq('user_id', userId)
        .eq('activity_type', activityType)
        .eq('activity_date', new Date().toISOString().split('T')[0]); // Use just the date

    if (fetchError) {
        console.error('Error checking for existing activity:', fetchError);
        return res.status(500).send('Database error.');
    }

    if (existingEntry.length > 0) {
        // Activity already logged for today, do nothing
        return res.status(200).send('Activity already logged for today.');
    }

    // Log the new activity
    const { data, error } = await supabase
        .from('user_activities')
        .insert([
            {
                user_id: userId,
                activity_type: activityType,
                activity_date: new Date().toISOString().split('T')[0],
                activity_id: activityId,
            },
        ]);

    if (error) {
        console.error('Error logging user activity:', error);
        return res.status(500).send('Failed to log activity.');
    }

    res.status(200).json({ message: 'Activity logged successfully.' });
});

// New API route to calculate and return the user's streak
app.get('/streak/:userId/:activityType', async (req, res) => {
    const { userId, activityType } = req.params;

    if (!userId || !activityType) {
        return res.status(400).send('Missing user ID or activity type.');
    }

    try {
        const { data: activities, error } = await supabase
            .from('user_activities')
            .select('activity_date')
            .eq('user_id', userId)
            .eq('activity_type', activityType)
            .order('activity_date', { ascending: false }); // Get most recent activities first

        if (error) {
            console.error('Error fetching activities for streak:', error);
            return res.status(500).send('Database error.');
        }

        if (!activities || activities.length === 0) {
            return res.status(200).json({ streak: 0 }); // No activities found, streak is 0
        }

        // Streak calculation logic
        let streak = 0;
        let today = new Date();
        today.setHours(0, 0, 0, 0); // Set time to midnight for accurate date comparison

        // Check if the most recent activity was today. If not, the streak is 0.
        const mostRecentDate = new Date(activities[0].activity_date);
        //check and see if the most recent date was yesterday
        if (mostRecentDate.getTime() === today.getTime() - 86400000) {
            streak = 1;
        }
        //else if most recent date was two days ago 
        else if (mostRecentDate.getTime() < today.getTime() - 172800000) {
            // Most recent activity was yesterday, streak starts at 1
            const yesterday = new Date(today);
            yesterday.setDate(today.getDate() - 2);
            if (mostRecentDate.getTime() === yesterday.getTime()) {
                streak = 1;
            } else {
                return res.status(200).json({ streak: 0 }); // No activity yesterday or today, so streak is 0
            }
        }

        // Iterate through the rest of the activities
        for (let i = 1; i < activities.length; i++) {
            const currentDate = new Date(activities[i - 1].activity_date);
            const previousDate = new Date(activities[i].activity_date);

            // Calculate the difference in days
            const oneDay = 1000 * 60 * 60 * 24;
            const diffInDays = Math.round((currentDate.getTime() - previousDate.getTime()) / oneDay);

            // If consecutive, increment the streak
            if (diffInDays === 1) {
                streak++;
            } else {
                // If the dates are not consecutive, the streak is broken
                break;
            }
        }

        return res.status(200).json({ streak });

    } catch (err) {
        console.error('Error calculating streak:', err);
        res.status(500).send('Server error.');
    }
});

// New Endpoint: Contact Form
app.post('/contact', async (req, res) => {
    const { name, email, message } = req.body;

    if (!name || !email || !message) {
        return res.status(400).json({ error: 'Name, email, and message are required.' });
    }

    try {
        const { data, error } = await supabase
            .from('contact')
            .insert([
                { name, email, message, created_at: new Date().toISOString() }
            ]);

        if (error) {
            console.error('Error saving contact:', error);
            return res.status(500).json({ error: 'Failed to save contact message.' });
        }

        res.status(200).json({ message: 'Contact message saved successfully.' });
    } catch (error) {
        console.error('Unhandled error in /contact:', error);
        res.status(500).json({ error: 'An unexpected error occurred.' });
    }
});
// Add this new endpoint to index.js

app.post('/feedback', async (req, res) => {
    const { userId, contentId, contentType, feedback } = req.body;
    // feedback = { rating, positive, negative }

    try {
        // 1. Archive the raw feedback
        const { error: insertError } = await supabase
            .from('content_feedback')
            .insert({
                user_id: userId,
                content_id: contentId,
                content_type: contentType,
                rating: feedback.rating,
                what_worked: feedback.positive,
                what_didnt_work: feedback.negative
            });

        if (insertError) throw insertError;

        // 2. Fetch current tuning notes
        const { data: profile } = await supabase
            .from('user_profiles')
            .select('ai_tuning_notes')
            .eq('user_id', userId)
            .single();

        const currentNotes = profile?.ai_tuning_notes || "No specific tuning yet.";

        // 3. AI Analysis: Generate new tuning instructions
        const systemPrompt = `
      You are an AI Optimization Engineer. 
      Your goal is to maintain a concise set of "Style Instructions" for a user based on their feedback history.
      
      Current Instructions: "${currentNotes}"
      
      New Feedback:
      - Rating: ${feedback.rating}/5
      - Good: ${feedback.positive}
      - Bad: ${feedback.negative}
      
      TASK: Write a new, consolidated set of instructions (max 3 sentences) that incorporates the new feedback.
      If the feedback is positive (4-5 stars), reinforce the current style.
      If negative, adjust strictly to fix the complaints.
      Write ONLY the instructions.
    `;

        const completion = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: [{ role: "system", content: systemPrompt }]
        });

        const newTuningNotes = completion.choices[0].message.content;

        // 4. Update Profile
        await supabase
            .from('user_profiles')
            .update({ ai_tuning_notes: newTuningNotes })
            .eq('user_id', userId);

        res.json({ success: true, newNotes: newTuningNotes });

    } catch (error) {
        console.error('Feedback Error:', error);
        res.status(500).json({ error: error.message });
    }
});


// GET Followed Categories
app.get('/user-followed-categories/:userId', async (req, res) => {
    const { userId } = req.params;
    try {
        const { data, error } = await supabase
            .from('user_followed_categories')
            .select('category_id')
            .eq('user_id', userId);

        if (error) throw error;
        // Return simple array of IDs: [1, 2, 5]
        res.json(data.map(row => row.category_id));
    } catch (error) {
        console.error('Error fetching followed categories:', error);
        res.status(500).json({ error: 'Failed to fetch followed categories' });
    }
});

// UPDATE Followed Categories (Bulk Replace)
app.post('/user-followed-categories/:userId', async (req, res) => {
    const { userId } = req.params;
    const { categoryIds } = req.body; // Expects: { categoryIds: [1, 2, 3] }

    try {
        // 1. Delete existing relationships for this user
        const { error: deleteError } = await supabase
            .from('user_followed_categories')
            .delete()
            .eq('user_id', userId);

        if (deleteError) throw deleteError;

        // 2. Insert new relationships (if any selected)
        if (categoryIds && categoryIds.length > 0) {
            const rows = categoryIds.map(id => ({ user_id: userId, category_id: id }));
            const { error: insertError } = await supabase
                .from('user_followed_categories')
                .insert(rows);

            if (insertError) throw insertError;
        }

        res.json({ success: true });
    } catch (error) {
        console.error('Error updating followed categories:', error);
        res.status(500).json({ error: 'Failed to update followed categories' });
    }
});

// GET Followed Topics
app.get('/user-followed-topics/:userId', async (req, res) => {
    const { userId } = req.params;
    try {
        const { data, error } = await supabase
            .from('user_followed_topics')
            .select('topic_id')
            .eq('user_id', userId);

        if (error) throw error;
        res.json(data.map(row => row.topic_id));
    } catch (error) {
        console.error('Error fetching followed topics:', error);
        res.status(500).json({ error: 'Failed to fetch followed topics' });
    }
});

// UPDATE Followed Topics (Bulk Replace)
app.post('/user-followed-topics/:userId', async (req, res) => {
    const { userId } = req.params;
    const { topicIds } = req.body;

    try {
        const { error: deleteError } = await supabase
            .from('user_followed_topics')
            .delete()
            .eq('user_id', userId);

        if (deleteError) throw deleteError;

        if (topicIds && topicIds.length > 0) {
            const rows = topicIds.map(id => ({ user_id: userId, topic_id: id }));
            const { error: insertError } = await supabase
                .from('user_followed_topics')
                .insert(rows);

            if (insertError) throw insertError;
        }

        res.json({ success: true });
    } catch (error) {
        console.error('Error updating followed topics:', error);
        res.status(500).json({ error: 'Failed to update followed topics' });
    }
});

// 1. UPDATE logEvent signature
const logEvent = async (level, source, userId, action, message, details = {}, duration = null) => {
    try {
        const timestamp = new Date().toISOString();
        // Include duration in console log for immediate visibility
        const durationStr = duration ? ` (${duration}ms)` : '';
        console.log(`[${timestamp}] [${level.toUpperCase()}] [${source}] ${message}${durationStr}`);

        await supabase.from('system_logs').insert({
            level,
            source,
            user_id: userId || null,
            action,
            message,
            details,
            duration_ms: duration // <--- New Field
        });
    } catch (err) {
        console.error('FAILED TO LOG TO DB:', err);
    }
};

// 2. UPDATE Middleware to log duration properly
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

// 3. UPDATE /log Endpoint (for Frontend)
app.post('/log', async (req, res) => {
    const { level, action, message, details, userId, duration } = req.body;

    await logEvent(
        level || 'info',
        'frontend',
        userId,
        action || 'client_event',
        message,
        details,
        duration // <--- Pass duration here
    );

    res.status(200).send({ received: true });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`Backend server running on port ${PORT}`);
});