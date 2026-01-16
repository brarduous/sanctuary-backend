const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const { aiLimiter } = require('../middleware/limiters');
const authenticateUser = require('../middleware/auth');
const { logEvent, callOpenAIAndProcessResult, getTuningNotes } = require('../utils/helpers');
const { generateTopicSermonPrompt, generateScriptureSermonPrompt } = require('../prompts');

//Endpoint to get Sermons by user id
router.get('/sermons/:userId', authenticateUser, async (req, res) => {
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
//Endpoint to save Sermons by user id
router.post('/sermons/:sermonId', authenticateUser, async (req, res) => {
    const { sermonId } = req.params;
    const sermonData = req.body;
    console.log('Saving sermon for sermon ID:', sermonId, sermonData);
    try {
        const { data, error } = await supabase
            .from('sermons')
            .update({
                title: sermonData.title,
                sermon_body: sermonData.sermon_body,
                updated_at: new Date().toISOString(),
            })
            .eq('sermon_id', sermonId)
            .select('*')
            .single();

        if (error) {
            console.error('Error saving sermon:', error);
            return res.status(500).json({ error: 'Failed to save sermon.' });
        }

        res.status(201).json(data);
    } catch (error) {
        console.error('Unhandled error in POST /sermons/:userId:', error);
        res.status(500).json({ error: 'An unexpected error occurred.' });
    }
});

// Endpoint to initiate Sermon generation by Topic
router.post('/generate-sermon-by-topic', authenticateUser, aiLimiter, async (req, res) => {
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
router.post('/generate-sermon-by-scripture', authenticateUser, aiLimiter, async (req, res) => {
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

router.get('/sermon/:sermonId', authenticateUser, async (req, res) => {
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

module.exports = router;
