const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const { aiLimiter } = require('../middleware/limiters');
const authenticateUser = require('../middleware/auth');
const { logEvent, callOpenAIAndProcessResult } = require('../utils/helpers');
const { getDailyDevotionalPrompt } = require('../prompts');

//Endpoint to initiate Daily Devotional generation
router.post('/generate-devotional', authenticateUser, aiLimiter, async (req, res) => {
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
            const systemPrompt = await getDailyDevotionalPrompt();
            const generatedContent = await callOpenAIAndProcessResult(
                systemPrompt,
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

router.get('/devotionals/:userId', authenticateUser, async (req, res) => {
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
router.get('/devotional/:userId/:devotionalId', authenticateUser, async (req, res) => {
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

router.delete('/devotional/:devotionalId', authenticateUser, async (req, res) => {
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

module.exports = router;
