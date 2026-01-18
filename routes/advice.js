const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const { aiLimiter } = require('../middleware/limiters');
const authenticateUser = require('../middleware/auth');
const { logEvent, callOpenAIAndProcessResult } = require('../utils/helpers');
const { getAdviceGuidancePrompt } = require('../prompts');

const FREE_TIER_ADVICE_LIMIT = 1; // 1 advice per month for free users

// Updated Endpoint: Generate Advice/Guidance with Freemium Checks
router.post('/generate-advice', authenticateUser, aiLimiter, async (req, res) => {
    try {
        const startTime = Date.now();
        const { userId, situation } = req.body;

        // --- 1. FREEMIUM CHECK START ---
        
        // Fetch user profile to check tier and usage
        const { data: profile, error: profileError } = await supabase
            .from('user_profiles')
            .select('subscription_tier, advice_usage_count, advice_reset_date')
            .eq('user_id', userId)
            .single();

        if (profileError) {
            console.error('Error fetching profile for quota check:', profileError);
            return res.status(500).json({ error: 'Failed to verify subscription status.' });
        }

        const isFree = profile.subscription_tier === 'free';
        
        // Logic to Reset Quota (Monthly)
        const now = new Date();
        const lastReset = new Date(profile.advice_reset_date || 0); // Default to epoch if null
        const oneMonthAgo = new Date();
        oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);

        // If last reset was more than a month ago, reset the count
        if (lastReset < oneMonthAgo) {
            await supabase
                .from('user_profiles')
                .update({ 
                    advice_usage_count: 0, 
                    advice_reset_date: now.toISOString() 
                })
                .eq('user_id', userId);
            
            // Update local variable so we don't block them immediately
            profile.advice_usage_count = 0;
        }

        // BLOCK if limit reached
        if (isFree && profile.advice_usage_count >= FREE_TIER_ADVICE_LIMIT) {
            return res.status(403).json({ 
                error: 'Free limit reached', 
                code: 'UPGRADE_REQUIRED',
                message: 'You have used your free advice for this month. Upgrade to Pro for unlimited guidance.' 
            });
        }
        // --- FREEMIUM CHECK END ---


        // 2. Create placeholder (Existing Code)
        const { data: newAdvice, error: insertError } = await supabase
            .from('advice_guidance')
            .insert({
                user_id: userId,
                situation: situation,
                advice_points: 'Generating advice...', 
                status: 'pending', 
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

        // 3. Start AI generation (Existing Code)
        const systemPrompt = await getAdviceGuidancePrompt();
        const userPrompt = `Situation: ${situation}`;   
        try {
            const generatedAdvice = await callOpenAIAndProcessResult(
                systemPrompt,
                userPrompt,
                'gpt-4.1-2025-04-14',
                4000, 
                "json_object"
            );

            // Update advice content
            const { error: updateError } = await supabase
                .from('advice_guidance')
                .update({
                    situation: generatedAdvice.situation_summary || situation, 
                    advice_points: JSON.stringify(generatedAdvice.advice_points || []), 
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
                // --- 4. INCREMENT USAGE (NEW) ---
                if (isFree) {
                    // We increment the count we fetched earlier
                    const newCount = (profile.advice_usage_count || 0) + 1;
                    await supabase
                        .from('user_profiles')
                        .update({ advice_usage_count: newCount })
                        .eq('user_id', userId);
                    console.log(`Incremented advice usage for user ${userId} to ${newCount}`);
                }
                // -------------------------------

                logEvent('info', 'backend', userId, 'generate_advice', 'Successfully generated advice', {}, duration);
                console.log(`Advice record ${newAdvice.advice_id} successfully generated and updated.`);
            }
        } catch (aiError) {
            // ... (Existing Error Handling) ...
            logEvent('error', 'backend', userId, 'generate_advice', 'AI generation failed', { error: aiError.message }, Date.now() - startTime);
            console.error(`AI generation failed for advice ${newAdvice.advice_id}:`, aiError);
            await supabase.from('advice_guidance').update({ status: 'failed' }).eq('advice_id', newAdvice.advice_id);
        }

    } catch (error) {
        // ... (Existing Error Handling) ...
        logEvent('error', 'backend', null, 'generate_advice', 'Unhandled error', { error: error.message }, 0);
        console.error('Unhandled error in /generate-advice:', error);
        res.status(500).json({ error: 'An unexpected error occurred.' });
    }
});

// New Fetching Endpoint: Get Advice/Guidance for a user
router.get('/advice/:userId', authenticateUser, async (req, res) => {
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
router.get('/advice/:userId/:adviceId', authenticateUser, async (req, res) => {

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

// DELETE ADVICE (AND CLEANUP FAVORITES)
router.delete('/advice/:adviceId', authenticateUser, async (req, res) => {
    const { adviceId } = req.params;
    const userId = req.user.id; // From auth middleware

    try {
        // 1. Remove from Favorites/Saved Items first
        // (Replace 'user_favorites' with your actual table name, e.g., 'saved_items')
        const { error: favError } = await supabase
            .from('user_favorites') 
            .delete()
            .eq('item_id', adviceId); // Delete ALL favorites for this item, regardless of user
        
        if (favError) {
            console.warn(`[Cleanup] Failed to remove favorites for advice ${adviceId}:`, favError.message);
            // We continue anyway because we want to delete the advice
        }

        // 2. Delete the Advice Item
        const { error } = await supabase
            .from('advice')
            .delete()
            .eq('id', adviceId)
            .eq('user_id', userId); // Security: Ensure they own the advice

        if (error) throw error;

        res.status(200).json({ success: true });

    } catch (error) {
        console.error("Delete Error:", error.message);
        res.status(500).json({ error: "Failed to delete advice." });
    }
});

module.exports = router;
