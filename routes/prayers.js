const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const { aiLimiter } = require('../middleware/limiters');
const authenticateUser = require('../middleware/auth');
const { logEvent, callOpenAIAndProcessResult } = require('../utils/helpers');
const { daily_prayer_prompt } = require('../prompts');

// New Endpoint: Generate Daily Prayer
router.post('/generate-prayer', authenticateUser, aiLimiter, async (req, res) => {
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

router.delete('/prayer/:prayerId', authenticateUser,    async (req, res) => {
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
router.get('/prayers/:userId', authenticateUser, async (req, res) => {
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
router.get('/prayer/:userId/:prayerId', authenticateUser, async (req, res) => {
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

module.exports = router;
