const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const { aiLimiter } = require('../middleware/limiters');
const authenticateUser = require('../middleware/auth');
const { logEvent, callOpenAIAndProcessResult, getTuningNotes } = require('../utils/helpers');
const { generateTopicSermonPrompt, generateScriptureSermonPrompt } = require('../prompts');

// Helper to construct style instructions
const getStylePrompts = (userProfile) => {
    let instructions = "";
    if (userProfile && userProfile.sermon_preferences) {
        const prefs = userProfile.sermon_preferences;
        
        // 1. Custom Preaching Style Directive
        if (prefs.customPreachingDesc && prefs.customPreachingDesc.trim() !== "") {
            instructions += `\n\nCRITICAL - CUSTOM PREACHING STYLE:\nThe user has a unique preaching structure described as: "${prefs.customPreachingDesc}".\nYou MUST organize the sermon outline and content to reflect this specific approach rather than a generic structure.`;
        } else if (prefs.preachingStyle) {
             // Fallback to standard if no custom description
             instructions += `\n\nPreaching Style: ${prefs.preachingStyle}`;
        }

        // 2. Custom Oratorical Voice Directive
        if (prefs.customOratoricalDesc && prefs.customOratoricalDesc.trim() !== "") {
            instructions += `\n\nCRITICAL - CUSTOM ORATORICAL VOICE:\nThe user has a unique speaking voice described as: "${prefs.customOratoricalDesc}".\nYou MUST write the sermon body using this specific tone, vocabulary, and rhetorical flair.`;
        } else if (prefs.oratoricalStyle) {
             instructions += `\n\nOratorical Voice: ${prefs.oratoricalStyle}`;
        }
        
        // 3. General Preferences
        instructions += `\n\nGeneral Preferences: ${JSON.stringify(prefs)}`;
    }
    return instructions;
};

// ... [Existing GET /sermons/:userId endpoint] ...
router.get('/sermons/:userId', authenticateUser, async (req, res) => {
    const { userId } = req.params;
    try {
        const { data, error } = await supabase
            .from('sermons')
            .select('*')
            .eq('user_id', userId)
            .neq('status', 'failed')
            .order('created_at', { ascending: false });
        if (error) throw error;
        res.json(data);
    } catch (error) {
        console.error('Error fetching sermons:', error);
        res.status(500).json({ error: 'Failed to fetch sermons.' });
    }
});

// ... [Existing POST /sermons/:sermonId endpoint] ...
router.post('/sermons/:sermonId', authenticateUser, async (req, res) => {
    const { sermonId } = req.params;
    const sermonData = req.body;
    try {
        const { data, error } = await supabase
            .from('sermons')
            .update({
                title: sermonData.title,
                sermon_body: sermonData.sermon_body,
                tags: sermonData.tags,
                updated_at: new Date().toISOString(),
            })
            .eq('sermon_id', sermonId)
            .select('*')
            .single();
        if (error) throw error;
        res.status(201).json(data);
    } catch (error) {
        console.error('Error saving sermon:', error);
        res.status(500).json({ error: 'Failed to save sermon.' });
    }
});

// Endpoint to initiate Sermon generation by Topic
router.post('/generate-sermon-by-topic', authenticateUser, aiLimiter, async (req, res) => {
    try {
        const startTime = Date.now();
        const { userId, topic, userProfile } = req.body;

        // 1. Create Placeholder
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

        if (insertError) throw insertError;

        // 2. Return Placeholder ID
        res.status(202).json({
            message: 'Sermon generation initiated.',
            sermonId: newSermon.sermon_id,
            status: 'pending'
        });

        // 3. Build Enhanced Prompt
        const styleInstructions = getStylePrompts(userProfile);
        const userPrompt = `Topic: ${topic}
Include Illustration: true
Generate the sermon based on this topic. You may select a relevant scripture passage to include in the "scripture" field.
${styleInstructions}
If the sermon generated does not meet the expected length/depth, expand on the theological implications.`;

        const systemPrompt = generateTopicSermonPrompt(await getTuningNotes(userId));

        // 4. Generate
        try {
            const generatedSermon = await callOpenAIAndProcessResult(
                await systemPrompt,
                userPrompt,
                'gpt-4.1-2025-04-14',
                4000,
                "json_object",
            );

            const { error: updateError } = await supabase
                .from('sermons')
                .update({
                    title: generatedSermon.title || `Sermon on ${topic}`,
                    scripture: generatedSermon.scripture || null,
                    illustration: generatedSermon.illustration || null,
                    sermon_outline: generatedSermon.sermon_outline || null,
                    key_takeaways: generatedSermon.key_takeaways || null,
                    sermon_body: generatedSermon.sermon_body || null,
                    status: 'completed',
                    user_id: userId,
                    updated_at: new Date().toISOString(),
                })
                .eq('sermon_id', newSermon.sermon_id);

            const duration = Date.now() - startTime;
            if (updateError) {
                throw updateError;
            } else {
                logEvent('ai', 'backend', userId, 'generate_sermon_by_topic', 'Success', {tokens: generatedSermon.tokens}, duration);
            }
        } catch (aiError) {
            console.error(`AI generation failed:`, aiError);
            await supabase.from('sermons').update({ status: 'failed' }).eq('sermon_id', newSermon.sermon_id);
            logEvent('error', 'backend', userId, 'generate_sermon_by_topic', 'Failed', { error: aiError.message }, Date.now() - startTime);
        }

    } catch (error) {
        console.error('Unhandled error:', error);
        res.status(500).json({ error: 'An unexpected error occurred.' });
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

        if (insertError) throw insertError;

        res.status(202).json({
            message: 'Sermon generation initiated.',
            sermonId: newSermon.sermon_id,
            status: 'pending'
        });

        // Build Enhanced Prompt
        const styleInstructions = getStylePrompts(userProfile);
        const userPrompt = `Scripture: ${scripture}
Include Illustration: true
Generate the sermon based on this scripture.
${styleInstructions}`;

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
                throw updateError;
            } else {
                logEvent('ai', 'backend', userId, 'generate_sermon_by_scripture', 'Success', {tokens: generatedSermon.tokens}, duration);
            }
        } catch (aiError) {
            console.error(`AI generation failed:`, aiError);
            await supabase.from('sermons').update({ status: 'failed' }).eq('sermon_id', newSermon.sermon_id);
            logEvent('error', 'backend', userId, 'generate_sermon_by_scripture', 'Failed', { error: aiError.message }, Date.now() - startTime);
        }

    } catch (error) {
        console.error('Unhandled error:', error);
        res.status(500).json({ error: 'An unexpected error occurred.' });
    }
});

// ... [Existing GET /sermon/:sermonId endpoint] ...
router.get('/sermon/:sermonId', authenticateUser, async (req, res) => {
    const { sermonId } = req.params;
    const { data, error } = await supabase.from('sermons').select('*').eq('sermon_id', sermonId).single();
    if (error || !data) {
        return res.status(404).json({ error: 'Sermon not found.' });
    }
    res.json(data);
});

module.exports = router;