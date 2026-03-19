const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const { aiLimiter } = require('../middleware/limiters');
const authenticateUser = require('../middleware/auth');
const { logEvent, callOpenAIAndProcessResult } = require('../utils/helpers');
const { getDailyPrayerPrompt } = require('../prompts');

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
            const systemPrompt = await getDailyPrayerPrompt();
            const generatedPrayer = await callOpenAIAndProcessResult(
                systemPrompt,
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

// POST: Submit a new community prayer request
router.post('/request', authenticateUser, async (req, res) => {
    const { requestText, visibility, congregationId } = req.body;
    const userId = req.user.id;

    try {
        const { data, error } = await supabase
            .from('prayer_requests')
            .insert({
                user_id: userId,
                congregation_id: congregationId || null,
                request_text: requestText,
                visibility: visibility // 'public_anonymous', 'congregation', or 'pastor'
            })
            .select()
            .single();

        if (error) throw error;
        res.status(201).json(data);
    } catch (error) {
        console.error('Error submitting prayer:', error);
        res.status(500).json({ error: 'Failed to submit prayer.' });
    }
});

// GET: Fetch Prayer Feed for Mobile App (Respects Visibility Rules)
router.get('/feed', authenticateUser, async (req, res) => {
    const { congregationId } = req.query; // Pass the user's congregation if they have one

    try {
        let query = supabase
            .from('prayer_requests')
            .select('id, request_text, visibility, created_at, user_id, user_profiles(first_name, last_name, avatar_url)')
            .order('created_at', { ascending: false })
            .limit(50);

        if (congregationId) {
            // User IS in a church: See Public + Their Congregation's prayers
            query = query.or(`visibility.eq.public_anonymous,and(visibility.eq.congregation,congregation_id.eq.${congregationId})`);
        } else {
            // User IS NOT in a church: See ONLY Public prayers
            query = query.eq('visibility', 'public_anonymous');
        }

        const { data, error } = await query;
        if (error) throw error;

        // SANITIZE: Strip names from public_anonymous requests!
        const sanitizedData = data.map(prayer => {
            if (prayer.visibility === 'public_anonymous') {
                return { ...prayer, user_id: null, user_profiles: null, author_name: 'Anonymous' };
            }
            return { ...prayer, author_name: `${prayer.user_profiles?.first_name} ${prayer.user_profiles?.last_name}` };
        });

        res.json(sanitizedData);
    } catch (error) {
        console.error('Error fetching prayer feed:', error);
        res.status(500).json({ error: 'Failed to fetch prayers.' });
    }
});

// GET: Fetch a random prayer (Prioritizes local congregation, falls back to public)
router.get('/random', authenticateUser, async (req, res) => {
    const { congregationId } = req.query;

    try {
        let selectedPrayer = null;

        // 1. Try to get a congregational prayer first (if user is in a church)
        if (congregationId && congregationId !== 'null' && congregationId !== 'undefined') {
            const { data: congPrayers, error: congErr } = await supabase
                .from('prayer_requests')
                .select('id, request_text, visibility, created_at, user_profiles(first_name, last_name)')
                .eq('congregation_id', congregationId)
                .eq('visibility', 'congregation')
                .order('created_at', { ascending: false })
                .limit(20); // Pull from the 20 most recent

            if (!congErr && congPrayers && congPrayers.length > 0) {
                selectedPrayer = congPrayers[Math.floor(Math.random() * congPrayers.length)];
                selectedPrayer.author_name = `${selectedPrayer.user_profiles?.first_name} ${selectedPrayer.user_profiles?.last_name}`;
            }
        }

        // 2. Fallback: If no congregational prayer found (or user isn't in a church), get a public one
        if (!selectedPrayer) {
            const { data: publicPrayers, error: pubErr } = await supabase
                .from('prayer_requests')
                .select('id, request_text, visibility, created_at')
                .eq('visibility', 'public_anonymous')
                .order('created_at', { ascending: false })
                .limit(50); // Pull from the 50 most recent global prayers

            if (!pubErr && publicPrayers && publicPrayers.length > 0) {
                selectedPrayer = publicPrayers[Math.floor(Math.random() * publicPrayers.length)];
                selectedPrayer.author_name = 'Anonymous';
            }
        }

        // 3. Handle Edge Case: Literally zero prayers in the database
        if (!selectedPrayer) {
            return res.status(404).json({ error: 'No prayer requests available right now.' });
        }

        // Clean up the payload
        delete selectedPrayer.user_profiles; 
        res.json(selectedPrayer);

    } catch (error) {
        console.error('Error fetching random prayer:', error);
        res.status(500).json({ error: 'Failed to fetch a random prayer.' });
    }
});

module.exports = router;
