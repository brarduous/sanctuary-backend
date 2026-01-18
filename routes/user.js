const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const openai = require('../config/openai');
const authenticateUser = require('../middleware/auth');
const { logEvent } = require('../utils/helpers');
require('dotenv').config();

const stripeLayperson = require('stripe')(process.env.STRIPE_SECRET_KEY_LAYPERSON);

router.get('/app-options', authenticateUser, async (req, res) => {
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

// Get user_profile by userId
router.get('/user-profile/:userId', authenticateUser, async (req, res) => {
    const { userId } = req.params;
    const { data, error } = await supabase
        .from('user_profiles')
        .select('*')
        .eq('user_id', userId)
        .single();
    //get email address from auth.users table
    const authData = await supabase.auth.admin.getUserById(userId);
    const user = authData.data.user;
    // console.log('Fetched user email for whitelist check:', user);
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
            .upsert({ user_id: userId, tier: 'pro', subscription_tier: 'pro' })
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
router.post('/user-profile/:userId', authenticateUser, async (req, res) => {
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
router.post('/log-activity', async (req, res) => {
    const { userId, activityType, activityId, description } = req.body;

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
                description: description || null,
            },
        ]);

    if (error) {
        console.error('Error logging user activity:', error);
        return res.status(500).send('Failed to log activity.');
    }

    res.status(200).json({ message: 'Activity logged successfully.' });
});

// New API route to calculate and return the user's streak
router.get('/streak/:userId/:activityType', async (req, res) => {
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
router.post('/contact', async (req, res) => {
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

router.post('/feedback', authenticateUser, async (req, res) => {
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
router.get('/user-followed-categories/:userId', authenticateUser, async (req, res) => {
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
router.post('/user-followed-categories/:userId', authenticateUser, async (req, res) => {
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
router.get('/user-followed-topics/:userId', authenticateUser, async (req, res) => {
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
router.post('/user-followed-topics/:userId', authenticateUser, async (req, res) => {
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

// UPDATE /log Endpoint (for Frontend)
router.post('/log', async (req, res) => {
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

// --- NEW: Create Stripe Checkout Session (Updated for Trials) ---
router.post('/create-checkout-session', authenticateUser,async (req, res) => {
    const { userId, email, isTrial } = req.body; // Accept isTrial flag

    try {
        const sessionConfig = {
            payment_method_types: ['card'],
            line_items: [
                {
                    price: process.env.STRIPE_PRICE_ID_PRO, 
                    quantity: 1,
                },
            ],
            mode: 'subscription',
            client_reference_id: userId,
            customer_email: email,
            // Use different redirect for onboarding success vs profile upgrade
            success_url: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/home?success=true`,
            cancel_url: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/home?canceled=true`,
        };

        // Add Trial Logic
        if (isTrial) {
            sessionConfig.subscription_data = {
                trial_period_days: 7
            };
        }

        const session = await stripeLayperson.checkout.sessions.create(sessionConfig);

        res.json({ url: session.url });
    } catch (error) {
        console.error('Error creating checkout session:', error);
        res.status(500).json({ error: 'Failed to create checkout session' });
    }
});

module.exports = router;
