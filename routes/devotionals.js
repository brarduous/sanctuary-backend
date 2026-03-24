const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const { aiLimiter } = require('../middleware/limiters');
const authenticateUser = require('../middleware/auth');
const { logEvent, callOpenAIAndProcessResult } = require('../utils/helpers');
const { getDailyDevotionalPrompt } = require('../prompts');
const { google } = require('googleapis');
const youtube = google.youtube({ version: 'v3', auth: process.env.YOUTUBE_API_KEY });

//Endpoint to initiate Daily Devotional generation
router.post('/generate-devotional', authenticateUser, aiLimiter, async (req, res) => {
    try {
        const startTime = Date.now();
        const { userId, focusAreas, improvementAreas, recentDevotionals } = req.body;
        const generationDate = new Date().toISOString().split('T')[0];
        
        // 1. Fetch Today's General Devotional (Curriculum)
        // We use .lte and .order to safely get the most recent one if today's isn't published yet
        const { data: generalDevo, error: devoErr } = await supabase
            .from('general_devotionals')
            .select('*')
            .lte('date', generationDate)
            .order('date', { ascending: false })
            .limit(1)
            .single();

        if (devoErr || !generalDevo) {
            console.error("No general devotional found to base curriculum on.", devoErr);
            return res.status(400).json({ error: 'Daily curriculum not available yet. Please try again later.' });
        }

        // 2. Fetch User's CRM Profile for deep personalization
        const { data: userProfile } = await supabase
            .from('church_crm_profiles')
            .select('first_name, last_name') // Add pastoral_notes here if your schema links them directly!
            .eq('user_id', userId)
            .single();

        // 3. Create placeholders in the database
        const { data: newDevotional, error: insertError } = await supabase
            .from('daily_devotionals')
            .insert({
                user_id: userId,
                content: 'Generating devotional...',
                status: 'pending',
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
            })
            .select('devotional_id')
            .single();

        const { data: newPrayer, error: insertPrayerError } = await supabase
            .from('daily_prayers')
            .insert({
                user_id: userId,
                generated_prayer: 'Generating prayer...',
                status: 'pending',
                date: generationDate,
                went_through_guided_prayer: false,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
            })
            .select('prayer_id')
            .single();

        if (insertError || insertPrayerError) {
            return res.status(500).json({ error: 'Failed to initiate generation.' });
        }

        // 4. Return placeholder IDs to the frontend immediately
        res.status(202).json({
            message: 'Devotional generation initiated.',
            devotionalId: newDevotional.devotional_id,
            status: 'pending'
        });

        // 5. Start AI generation in the background
        const userData = {
            first_name: userProfile?.first_name || '',
            focusAreas: focusAreas || [],
            improvementAreas: improvementAreas || [],
            // You can fetch pastoral notes and inject them here to give the AI pastoral context!
        };

        try {
            // Use the new dynamic prompt!
            const systemPrompt = await getPersonalizedDevotionalPrompt(userData, generalDevo);
            
            // Note: Keep user prompt simple since the system prompt now holds the context
            const userPrompt = `Please write today's personalized devotional.`;

            const generatedContent = await callOpenAIAndProcessResult(
                systemPrompt,
                userPrompt,
                'gpt-4o', // Consider bumping to gpt-4o for complex JSON adherence
                5000, 
                "json_object" // Using JSON mode ensures we reliably get the fields we need
            );

            // parse generatedContent to json
            let parsedContent;
            if (typeof generatedContent === 'string') {
                parsedContent = JSON.parse(generatedContent);
            } else {
                parsedContent = generatedContent; // In case your helper already parsed it
            }

            const { title, scripture, content, daily_prayer, song_search_query } = parsedContent;

            let songData = {};
            if (song_search_query) {
                try {
                    const youtubeResponse = await youtube.search.list({
                        part: 'snippet',
                        q: song_search_query + ' worship lyric video', // Better search query targeting
                        type: 'video',
                        videoCategoryId: '10', // Music
                        maxResults: 1,
                    });

                    const video = youtubeResponse.data.items[0];
                    if (video) {
                        songData = {
                            song_title: video.snippet.title,
                            song_video_id: video.id.videoId,
                            song_url: `https://www.youtube.com/watch?v=${video.id.videoId}`,
                            song_thumbnail: video.snippet.thumbnails?.high?.url || null,
                            song_channel: video.snippet.channelTitle || null,
                        };
                    }
                } catch (youtubeError) {
                    console.error('Error fetching song from YouTube:', youtubeError);
                }
            }

            // Update devotional record
            await supabase
                .from('daily_devotionals')
                .update({
                    title: title || generalDevo.title, // Fallback to curriculum
                    content: content,
                    scripture: scripture || generalDevo.scripture_reference,
                    status: 'completed',
                    updated_at: new Date().toISOString(),
                    ...songData
                })
                .eq('devotional_id', newDevotional.devotional_id);

            // Update prayer record
            await supabase
                .from('daily_prayers')
                .update({
                    generated_prayer: daily_prayer,
                    updated_at: new Date().toISOString(),
                    status: 'completed'
                })
                .eq('prayer_id', newPrayer.prayer_id);

            logEvent('ai', 'backend', userId, 'generate_devotional', 'Successfully generated personalized curriculum devotional', { tokens: generatedContent.tokens }, Date.now() - startTime);

        } catch (aiError) {
            console.error(`AI generation failed for devotional ${newDevotional.devotional_id}:`, aiError);
            await supabase.from('daily_devotionals').update({ status: 'failed' }).eq('devotional_id', newDevotional.devotional_id);
            await supabase.from('daily_prayers').update({ status: 'failed' }).eq('prayer_id', newPrayer.prayer_id);
        }

    } catch (error) {
        console.error('Unhandled error in /generate-devotional:', error);
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
        logEvent('error', 'backend', userId, 'fetch_devotionals', 'Failed to fetch devotionals', { error: error.message }, 0);
        return res.status(500).json({ error: 'Failed to fetch devotionals.' });
    }
    res.json(data);
});

//get devotional by devotionalId
router.get('/devotional/:userId/:devotionalId', authenticateUser, async (req, res) => {
    const startTime = Date.now();
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
    logEvent('info', 'backend', userId, 'fetch_devotional_by_id', `Fetched devotional ${devotionalId}`, {}, Date.now() - startTime);
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
        logEvent('info', 'backend', req.user.id, 'delete_devotional', `Deleted devotional ${devotionalId}`, {}, 0);
        res.json({ message: 'Devotional deleted successfully' });
    } catch (error) {
        console.error('Error deleting devotional:', error);
        res.status(500).json({ error: 'Failed to delete devotional' });
    }
});

module.exports = router;
