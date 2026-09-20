const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const { aiLimiter } = require('../middleware/limiters');
const authenticateUser = require('../middleware/auth');
const { logEvent, callOpenAIAndProcessResult } = require('../utils/helpers');
const { getDailyDevotionalPrompt, getPersonalizedDevotionalPrompt } = require('../prompts');
const { searchSpotifyTracks, selectMinistrySafeTrack } = require('../utils/spotify');

const normalizeStringList = (value, limit = 25) => Array.isArray(value)
    ? [...new Set(value.map((item) => String(item || '').trim()).filter(Boolean))].slice(0, limit)
    : [];

const normalizeFavoriteGospelArtists = (value) => Array.isArray(value)
    ? value.map((artist) => ({
        id: String(typeof artist === 'string' ? '' : artist?.id || '').trim(),
        name: String(typeof artist === 'string' ? artist : artist?.name || '').trim(),
    })).filter((artist) => artist.name).slice(0, 20)
    : [];

//Endpoint to initiate Daily Devotional generation
router.post('/generate-devotional', authenticateUser, aiLimiter, async (req, res) => {
    try {
        const startTime = Date.now();
        const { focusAreas, improvementAreas, recentDevotionals } = req.body;
        const userId = req.user.id;
        const generationDate = new Date().toISOString().split('T')[0];
        
        // 1. Fetch Today's General Devotional (Curriculum)
        // Personalized content must use today's curriculum. Reusing the latest
        // older row can silently repeat yesterday's scripture.
        const { data: generalDevo, error: devoErr } = await supabase
            .from('general_devotionals')
            .select('*')
            .eq('date', generationDate)
            .maybeSingle();

        if (devoErr || !generalDevo) {
            console.error("No general devotional found to base curriculum on.", devoErr);
            return res.status(400).json({ error: 'Daily curriculum not available yet. Please try again later.' });
        }

        // 2. Fetch private, server-owned personalization context. Request values
        // remain a compatibility fallback, never the identity authority.
        const [crmResult, growthResult, preferenceResult] = await Promise.all([
            supabase.from('church_crm_profiles').select('first_name, last_name').eq('user_id', userId).maybeSingle(),
            supabase.from('personal_growth_profiles').select('focus_areas, improvement_areas').eq('user_id', userId).maybeSingle(),
            supabase.from('user_profiles').select('user_preferences, ai_tuning_notes').eq('user_id', userId).maybeSingle(),
        ]);
        const userProfile = crmResult.data;
        const savedPreferences = preferenceResult.data?.user_preferences || {};
        const savedFocusAreas = normalizeStringList(growthResult.data?.focus_areas);
        const savedImprovementAreas = normalizeStringList(growthResult.data?.improvement_areas);
        const effectiveFocusAreas = savedFocusAreas.length
            ? savedFocusAreas
            : normalizeStringList(focusAreas?.length ? focusAreas : savedPreferences.focusAreas);
        const effectiveImprovementAreas = savedImprovementAreas.length
            ? savedImprovementAreas
            : normalizeStringList(improvementAreas?.length ? improvementAreas : savedPreferences.improvementAreas);
        const favoriteGospelArtists = normalizeFavoriteGospelArtists(
            savedPreferences.musicPreferences?.favoriteGospelArtists
        );
        const recentContext = Array.isArray(recentDevotionals)
            ? recentDevotionals.slice(0, 7).map((item) => ({
                title: String(item?.title || '').trim(),
                scripture: String(item?.scripture || item?.scripture_reference || '').trim(),
            })).filter((item) => item.title || item.scripture)
            : [];

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
            focusAreas: effectiveFocusAreas,
            improvementAreas: effectiveImprovementAreas,
            recentDevotionals: recentContext,
            favoriteGospelArtists,
        };

        try {
            // Use the new dynamic prompt!
            const systemPrompt = await getPersonalizedDevotionalPrompt(
                userData,
                generalDevo,
                preferenceResult.data?.ai_tuning_notes || ''
            );
            
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

            const { title, scripture, content, daily_prayer, song_search_query, short_form } = parsedContent;

            let songData = {};
            if (song_search_query) {
                try {
                    const artistPreference = favoriteGospelArtists.slice(0, 2).map((artist) => artist.name).join(' ');
                    const tracks = await searchSpotifyTracks(
                        `${song_search_query} ${artistPreference} gospel worship christian`.trim(),
                        20
                    );
                    const track = selectMinistrySafeTrack(tracks, { favoriteArtists: favoriteGospelArtists });
                    if (track) {
                        songData = {
                            song_title: track.title,
                            song_video_id: track.id,
                            song_url: track.spotifyUrl,
                            song_thumbnail: track.imageUrl,
                            song_channel: track.artist,
                        };
                    }
                } catch (spotifyError) {
                    console.error('Error fetching song from Spotify:', spotifyError);
                }
            }

            // Update devotional record
            await supabase
                .from('daily_devotionals')
                .update({
                    title: title || generalDevo.title, // Fallback to curriculum
                    content: content,
                    scripture: scripture || generalDevo.scripture_reference,
                    short_form: short_form || null,
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
