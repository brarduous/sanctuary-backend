const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const { aiLimiter } = require('../middleware/limiters');
const authenticateUser = require('../middleware/auth');
const { logEvent, callOpenAIAndProcessResult, getTuningNotes } = require('../utils/helpers');
const { generateTopicSermonPrompt, generateScriptureSermonPrompt, generateSermonSeriesOutlinePrompt } = require('../prompts');

const getStylePrompts = (userProfile) => {
    let instructions = "";
    if (userProfile && userProfile.sermon_preferences) {
        const prefs = userProfile.sermon_preferences;
        if (prefs.customPreachingDesc && prefs.customPreachingDesc.trim() !== "") {
            instructions += `\n\nCRITICAL - CUSTOM PREACHING STYLE:\nThe user has a unique preaching structure described as: "${prefs.customPreachingDesc}".\nYou MUST organize the sermon outline and content to reflect this specific approach.`;
        } else if (prefs.preachingStyle) {
             instructions += `\n\nPreaching Style: ${prefs.preachingStyle}`;
        }

        if (prefs.customOratoricalDesc && prefs.customOratoricalDesc.trim() !== "") {
            instructions += `\n\nCRITICAL - CUSTOM ORATORICAL VOICE:\nThe user has a unique speaking voice described as: "${prefs.customOratoricalDesc}".\nYou MUST write the sermon body using this specific tone, vocabulary, and rhetorical flair.`;
        } else if (prefs.oratoricalStyle) {
             instructions += `\n\nOratorical Voice: ${prefs.oratoricalStyle}`;
        }
        instructions += `\n\nGeneral Preferences: ${JSON.stringify(prefs)}`;
    }
    return instructions;
};

// --- Series Endpoints ---
router.get('/sermons/series/:userId', authenticateUser, async (req, res) => {
    const { userId } = req.params;
    try {
        const { data, error } = await supabase.from('sermon_series').select('*').eq('user_id', userId).order('created_at', { ascending: false });
        if (error) throw error;
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch series.' });
    }
});

router.post('/series', authenticateUser, async (req, res) => {
    try {
        const { series_name, description } = req.body;
        const { data, error } = await supabase.from('sermon_series').insert({ user_id: req.user.id, series_name, description }).select().single();
        if (error) throw error;
        res.status(201).json(data);
    } catch (error) {
        res.status(500).json({ error: 'Failed to create series.' });
    }
});

router.get('/sermons/series/:seriesId/details', authenticateUser, async (req, res) => {
    const { seriesId } = req.params;
    try {
        const { data: series, error: seriesError } = await supabase.from('sermon_series').select('*').eq('series_id', seriesId).single();
        if (seriesError) throw seriesError;

        const { data: sermons, error: sermonsError } = await supabase.from('sermons').select('*').eq('series_id', seriesId).order('created_at', { ascending: true });
        if (sermonsError) throw sermonsError;

        // Calculate series status (If all sermons are completed, series is completed)
        const isCompleted = sermons.length > 0 && sermons.every(s => s.status === 'completed');

        res.json({ ...series, sermons, status: isCompleted ? 'completed' : 'pending' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch series details.' });
    }
});

// --- NEW: Deep Generation Sermon Series Flow ---
router.post('/generate-sermon-series', authenticateUser, aiLimiter, async (req, res) => {
    try {
        const { userId, topic, details, numberOfSermons, userProfile } = req.body;
        const startTime = Date.now();

        // 1. Create a Placeholder Series immediately
        const { data: newSeries, error: insertError } = await supabase.from('sermon_series').insert({
            user_id: userId,
            series_name: `Generating Series: ${topic}`,
            description: 'Drafting curriculum outline...',
        }).select().single();
        if (insertError) throw insertError;

        // 2. Return 202 Accepted so frontend can start loading UI
        res.status(202).json({ message: 'Series generation initiated.', seriesId: newSeries.series_id, status: 'pending' });

        // 3. Background Process: Outline Generation
        const styleInstructions = getStylePrompts(userProfile);
        const outlinePrompt = `Topic: ${topic}\nAdditional Context: ${details}\nNumber of Sermons: ${numberOfSermons}\n\nCreate a cohesive sermon series outline. Return a JSON object with 'series_name', 'description', and a 'sermons' array containing 'title' and 'scripture' for each sermon.`;
        const systemPromptOutline = await generateSermonSeriesOutlinePrompt(await getTuningNotes(userId));

        try {
            const generatedOutline = await callOpenAIAndProcessResult(systemPromptOutline, outlinePrompt, 'gpt-4.1-2025-04-14', 2000, "json_object");

            await supabase.from('sermon_series').update({
                series_name: generatedOutline.series_name || `Series on ${topic}`,
                description: generatedOutline.description || details
            }).eq('series_id', newSeries.series_id);

            const sermonsList = generatedOutline.sermons || [];
            
            // 4. Background Process: Sequential Individual Sermon Generation
            for (let i = 0; i < sermonsList.length; i++) {
                const sermonOutline = sermonsList[i];

                // Create placeholder for this specific sermon
                const { data: sermonRecord } = await supabase.from('sermons').insert({
                    user_id: userId,
                    series_id: newSeries.series_id,
                    title: `${i+1}. ${sermonOutline.title}`, // Number the title
                    sermon_body: 'Generating deep content...',
                    status: 'pending'
                }).select().single();

                // Generate the individual sermon deeply
                const sermonUserPrompt = `Series Topic: ${topic}\nSermon Title: ${sermonOutline.title}\nScripture: ${sermonOutline.scripture}\nInclude Illustration: true\n\nGenerate this specific sermon.\n${styleInstructions}`;
                const sermonSystemPrompt = await generateTopicSermonPrompt(await getTuningNotes(userId));

                try {
                    const generatedSermon = await callOpenAIAndProcessResult(sermonSystemPrompt, sermonUserPrompt, 'gpt-4.1-2025-04-14', 4000, "json_object");
                    await supabase.from('sermons').update({
                        title: generatedSermon.title || sermonOutline.title,
                        scripture: generatedSermon.scripture || sermonOutline.scripture,
                        illustration: generatedSermon.illustration,
                        sermon_outline: generatedSermon.sermon_outline,
                        key_takeaways: generatedSermon.key_takeaways,
                        sermon_body: generatedSermon.sermon_body,
                        status: 'completed'
                    }).eq('sermon_id', sermonRecord.sermon_id);
                } catch (sermonErr) {
                    await supabase.from('sermons').update({ status: 'failed' }).eq('sermon_id', sermonRecord.sermon_id);
                }
            }
        } catch (aiErr) {
            await supabase.from('sermon_series').update({ description: 'Failed to generate series.' }).eq('series_id', newSeries.series_id);
        }
    } catch (error) {
        res.status(500).json({ error: 'Failed to initiate series generation' });
    }
});

// --- Standard Sermon Endpoints ---
router.get('/sermons/:userId', authenticateUser, async (req, res) => {
    try {
        const { data, error } = await supabase.from('sermons').select('*').eq('user_id', req.params.userId).neq('status', 'failed').order('created_at', { ascending: false });
        if (error) throw error;
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch sermons.' });
    }
});


router.get('/sermon/:sermonId', authenticateUser, async (req, res) => {
    const { data, error } = await supabase.from('sermons').select('*').eq('sermon_id', req.params.sermonId).single();
    if (error || !data) return res.status(404).json({ error: 'Sermon not found.' });
    res.json(data);
});

router.post('/sermons/:sermonId', authenticateUser, async (req, res) => {
    try {
        const { data, error } = await supabase.from('sermons').update({ ...req.body, updated_at: new Date().toISOString() }).eq('sermon_id', req.params.sermonId).select('*').single();
        if (error) throw error;
        res.status(201).json(data);
    } catch (error) {
        res.status(500).json({ error: 'Failed to save sermon.' });
    }
});

router.post('/generate-sermon-by-topic', authenticateUser, aiLimiter, async (req, res) => {
    // Keep your existing generate-sermon-by-topic code here verbatim
    try {
        const startTime = Date.now();
        const { userId, topic, userProfile, seriesId } = req.body; 

        const { data: newSermon, error: insertError } = await supabase
            .from('sermons')
            .insert({
                user_id: userId,
                series_id: seriesId || null, 
                title: `Generating Sermon: ${topic}`,
                sermon_outline: 'Generating outline...',
                sermon_body: 'Generating content...',
                status: 'pending',
            })
            .select('sermon_id')
            .single();

        if (insertError) throw insertError;
        res.status(202).json({ message: 'Sermon generation initiated.', sermonId: newSermon.sermon_id, status: 'pending' });

        const styleInstructions = getStylePrompts(userProfile);
        const userPrompt = `Topic: ${topic}\nInclude Illustration: true\nGenerate the sermon based on this topic.\n${styleInstructions}`;
        const systemPrompt = generateTopicSermonPrompt(await getTuningNotes(userId));

        try {
            const generatedSermon = await callOpenAIAndProcessResult(await systemPrompt, userPrompt, 'gpt-4.1-2025-04-14', 4000, "json_object");
            await supabase.from('sermons').update({
                title: generatedSermon.title || `Sermon on ${topic}`,
                scripture: generatedSermon.scripture || null,
                illustration: generatedSermon.illustration || null,
                sermon_outline: generatedSermon.sermon_outline || null,
                key_takeaways: generatedSermon.key_takeaways || null,
                sermon_body: generatedSermon.sermon_body || null,
                status: 'completed',
            }).eq('sermon_id', newSermon.sermon_id);
        } catch (aiError) {
            await supabase.from('sermons').update({ status: 'failed' }).eq('sermon_id', newSermon.sermon_id);
        }
    } catch (error) { res.status(500).json({ error: 'An unexpected error occurred.' }); }
});

router.post('/generate-sermon-by-scripture', authenticateUser, aiLimiter, async (req, res) => {
    // Keep your existing generate-sermon-by-scripture code here verbatim
    try {
        const startTime = Date.now();
        const { userId, scripture, userProfile, seriesId } = req.body; 

        const { data: newSermon, error: insertError } = await supabase
            .from('sermons')
            .insert({
                user_id: userId,
                series_id: seriesId || null, 
                title: `Generating Sermon for ${scripture}`,
                sermon_outline: 'Generating outline...',
                sermon_body: 'Generating content...',
                status: 'pending',
            })
            .select('sermon_id')
            .single();

        if (insertError) throw insertError;
        res.status(202).json({ message: 'Sermon generation initiated.', sermonId: newSermon.sermon_id, status: 'pending' });

        const styleInstructions = getStylePrompts(userProfile);
        const userPrompt = `Scripture: ${scripture}\nInclude Illustration: true\nGenerate the sermon based on this scripture.\n${styleInstructions}`;
        const systemPrompt = generateScriptureSermonPrompt(await getTuningNotes(userId));

        try {
            const generatedSermon = await callOpenAIAndProcessResult(await systemPrompt, userPrompt, 'gpt-4.1-2025-04-14', 4000, "json_object");
            await supabase.from('sermons').update({
                title: generatedSermon.title || `Sermon for ${scripture}`,
                scripture: generatedSermon.scripture || null,
                illustration: generatedSermon.illustration || null,
                sermon_outline: generatedSermon.sermon_outline || null,
                key_takeaways: generatedSermon.key_takeaways || null,
                sermon_body: generatedSermon.sermon_body || null,
                status: 'completed',
            }).eq('sermon_id', newSermon.sermon_id);
        } catch (aiError) {
            await supabase.from('sermons').update({ status: 'failed' }).eq('sermon_id', newSermon.sermon_id);
        }
    } catch (error) { res.status(500).json({ error: 'An unexpected error occurred.' }); }
});

module.exports = router;