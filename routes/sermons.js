const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const { aiLimiter } = require('../middleware/limiters');
const authenticateUser = require('../middleware/auth');
const { logEvent, callOpenAIAndProcessResult, getTuningNotes } = require('../utils/helpers');
const { generateTopicSermonPrompt, generateScriptureSermonPrompt, generateSermonSeriesOutlinePrompt } = require('../prompts');

const ALLOWED_CONTENT_FORMATS = ['sermon', 'sermonette', 'podcast_episode', 'youtube_video'];
const ALLOWED_DISTRIBUTION_CHANNELS = ['pulpit', 'podcast', 'youtube', 'multi'];
const ALLOWED_SERIES_FORMATS = ['standard', 'short_form'];

const normalizeContentFormat = (value) => {
    if (!value || typeof value !== 'string') return 'sermon';
    const normalized = value.trim().toLowerCase();
    return normalized.length === 0 ? 'sermon' : normalized;
};

const normalizeDistributionChannel = (value, contentFormat) => {
    if (value && typeof value === 'string' && value.trim().length > 0) {
        return value.trim().toLowerCase();
    }

    if (contentFormat === 'podcast_episode') return 'podcast';
    if (contentFormat === 'youtube_video' || contentFormat === 'sermonette') return 'youtube';
    return 'pulpit';
};

const normalizeSeriesFormat = (value) => {
    if (!value || typeof value !== 'string') return 'standard';
    const normalized = value.trim().toLowerCase();
    return normalized.length === 0 ? 'standard' : normalized;
};

const parseTargetDuration = (value) => {
    if (value === undefined || value === null || value === '') return null;
    const parsed = Number(value);
    if (!Number.isInteger(parsed)) return { error: 'targetDurationMin must be an integer.' };
    if (parsed < 1 || parsed > 240) return { error: 'targetDurationMin must be between 1 and 240.' };
    return { value: parsed };
};

const buildFormatInstructions = ({ contentFormat, targetDurationMin, distributionChannel }) => {
    const durationLine = targetDurationMin
        ? `Target Length: approximately ${targetDurationMin} minutes.`
        : 'Target Length: choose a sensible length for the requested format.';

    return `\n\nOUTPUT FORMAT REQUIREMENTS:\n- Content Format: ${contentFormat}\n- Distribution Channel: ${distributionChannel}\n- ${durationLine}\n- Keep structure, tone, and pacing appropriate for this format and channel.`;
};

const sanitizeSermonUpdatePayload = (body) => {
    const errors = [];
    const payload = { ...body };

    if (Object.prototype.hasOwnProperty.call(body, 'content_format')) {
        const contentFormat = normalizeContentFormat(body.content_format);
        if (!ALLOWED_CONTENT_FORMATS.includes(contentFormat)) {
            errors.push(`content_format must be one of: ${ALLOWED_CONTENT_FORMATS.join(', ')}`);
        } else {
            payload.content_format = contentFormat;
        }
    }

    if (Object.prototype.hasOwnProperty.call(body, 'distribution_channel')) {
        const distributionChannel = body.distribution_channel ? String(body.distribution_channel).trim().toLowerCase() : '';
        if (!ALLOWED_DISTRIBUTION_CHANNELS.includes(distributionChannel)) {
            errors.push(`distribution_channel must be one of: ${ALLOWED_DISTRIBUTION_CHANNELS.join(', ')}`);
        } else {
            payload.distribution_channel = distributionChannel;
        }
    }

    if (Object.prototype.hasOwnProperty.call(body, 'target_duration_min')) {
        const parsed = parseTargetDuration(body.target_duration_min);
        if (parsed && parsed.error) {
            errors.push(parsed.error.replace('targetDurationMin', 'target_duration_min'));
        } else {
            payload.target_duration_min = parsed ? parsed.value : null;
        }
    }

    if (Object.prototype.hasOwnProperty.call(body, 'actual_duration_min')) {
        const parsed = parseTargetDuration(body.actual_duration_min);
        if (parsed && parsed.error) {
            errors.push(parsed.error.replace('targetDurationMin', 'actual_duration_min'));
        } else {
            payload.actual_duration_min = parsed ? parsed.value : null;
        }
    }

    return { payload, errors };
};

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
    const seriesFormat = req.query.seriesFormat ? normalizeSeriesFormat(req.query.seriesFormat) : null;

    if (seriesFormat && !ALLOWED_SERIES_FORMATS.includes(seriesFormat)) {
        return res.status(400).json({ error: `seriesFormat must be one of: ${ALLOWED_SERIES_FORMATS.join(', ')}` });
    }

    try {
        let query = supabase.from('sermon_series').select('*').eq('user_id', userId);
        if (seriesFormat) {
            query = query.eq('series_format', seriesFormat);
        }
        const { data, error } = await query.order('created_at', { ascending: false });
        if (error) throw error;
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch series.' });
    }
});

router.post('/series', authenticateUser, async (req, res) => {
    try {
        const { series_name, description, seriesFormat } = req.body;
        const normalizedSeriesFormat = normalizeSeriesFormat(seriesFormat);

        if (!ALLOWED_SERIES_FORMATS.includes(normalizedSeriesFormat)) {
            return res.status(400).json({ error: `seriesFormat must be one of: ${ALLOWED_SERIES_FORMATS.join(', ')}` });
        }

        const { data, error } = await supabase.from('sermon_series').insert({
            user_id: req.user.id,
            series_name,
            description,
            series_format: normalizedSeriesFormat,
        }).select().single();
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
        const { userId, topic, details, numberOfSermons, userProfile, contentFormat, targetDurationMin, distributionChannel, seriesFormat } = req.body;
        const startTime = Date.now();

        const normalizedContentFormat = normalizeContentFormat(contentFormat);
        const normalizedDistributionChannel = normalizeDistributionChannel(distributionChannel, normalizedContentFormat);
        const normalizedSeriesFormat = normalizeSeriesFormat(seriesFormat);
        const parsedDuration = parseTargetDuration(targetDurationMin);

        if (!ALLOWED_CONTENT_FORMATS.includes(normalizedContentFormat)) {
            return res.status(400).json({ error: `contentFormat must be one of: ${ALLOWED_CONTENT_FORMATS.join(', ')}` });
        }
        if (!ALLOWED_DISTRIBUTION_CHANNELS.includes(normalizedDistributionChannel)) {
            return res.status(400).json({ error: `distributionChannel must be one of: ${ALLOWED_DISTRIBUTION_CHANNELS.join(', ')}` });
        }
        if (!ALLOWED_SERIES_FORMATS.includes(normalizedSeriesFormat)) {
            return res.status(400).json({ error: `seriesFormat must be one of: ${ALLOWED_SERIES_FORMATS.join(', ')}` });
        }
        if (parsedDuration && parsedDuration.error) {
            return res.status(400).json({ error: parsedDuration.error });
        }
        const safeDuration = parsedDuration ? parsedDuration.value : null;

        // 1. Create a Placeholder Series immediately
        const { data: newSeries, error: insertError } = await supabase.from('sermon_series').insert({
            user_id: userId,
            series_name: `Generating Series: ${topic}`,
            description: 'Drafting curriculum outline...',
            series_format: normalizedSeriesFormat,
        }).select().single();
        if (insertError) throw insertError;

        // 2. Return 202 Accepted so frontend can start loading UI
        res.status(202).json({ message: 'Series generation initiated.', seriesId: newSeries.series_id, status: 'pending' });

        // 3. Background Process: Outline Generation
        const styleInstructions = getStylePrompts(userProfile);
        const outlinePrompt = `Topic: ${topic}\nAdditional Context: ${details}\nNumber of Sermons: ${numberOfSermons}\nSeries Format: ${normalizedSeriesFormat}\nContent Format: ${normalizedContentFormat}\nDistribution Channel: ${normalizedDistributionChannel}\nTarget Duration (minutes): ${safeDuration || 'auto'}\n\nCreate a cohesive sermon series outline. Return a JSON object with 'series_name', 'description', and a 'sermons' array containing 'title' and 'scripture' for each sermon.`;
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
                    status: 'pending',
                    content_format: normalizedContentFormat,
                    target_duration_min: safeDuration,
                    distribution_channel: normalizedDistributionChannel,
                }).select().single();

                // Generate the individual sermon deeply
                const sermonUserPrompt = `Series Topic: ${topic}\nSermon Title: ${sermonOutline.title}\nScripture: ${sermonOutline.scripture}\nInclude Illustration: true\n\nGenerate this specific sermon.${buildFormatInstructions({ contentFormat: normalizedContentFormat, targetDurationMin: safeDuration, distributionChannel: normalizedDistributionChannel })}\n${styleInstructions}`;
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
                        status: 'completed',
                        content_format: normalizedContentFormat,
                        target_duration_min: safeDuration,
                        distribution_channel: normalizedDistributionChannel,
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
    const contentFormat = req.query.contentFormat ? normalizeContentFormat(req.query.contentFormat) : null;
    const distributionChannel = req.query.distributionChannel ? String(req.query.distributionChannel).trim().toLowerCase() : null;
    const seriesId = req.query.seriesId || null;

    if (contentFormat && !ALLOWED_CONTENT_FORMATS.includes(contentFormat)) {
        return res.status(400).json({ error: `contentFormat must be one of: ${ALLOWED_CONTENT_FORMATS.join(', ')}` });
    }
    if (distributionChannel && !ALLOWED_DISTRIBUTION_CHANNELS.includes(distributionChannel)) {
        return res.status(400).json({ error: `distributionChannel must be one of: ${ALLOWED_DISTRIBUTION_CHANNELS.join(', ')}` });
    }

    try {
        let query = supabase.from('sermons').select('*').eq('user_id', req.params.userId).neq('status', 'failed');
        if (contentFormat) {
            query = query.eq('content_format', contentFormat);
        }
        if (distributionChannel) {
            query = query.eq('distribution_channel', distributionChannel);
        }
        if (seriesId) {
            query = query.eq('series_id', seriesId);
        }

        const { data, error } = await query.order('created_at', { ascending: false });
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
        const { payload, errors } = sanitizeSermonUpdatePayload(req.body);
        if (errors.length > 0) {
            return res.status(400).json({ error: errors.join(' ') });
        }

        const { data, error } = await supabase.from('sermons').update({ ...payload, updated_at: new Date().toISOString() }).eq('sermon_id', req.params.sermonId).select('*').single();
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
        const { userId, topic, userProfile, seriesId, contentFormat, targetDurationMin, distributionChannel } = req.body;

        const normalizedContentFormat = normalizeContentFormat(contentFormat);
        const normalizedDistributionChannel = normalizeDistributionChannel(distributionChannel, normalizedContentFormat);
        const parsedDuration = parseTargetDuration(targetDurationMin);

        if (!ALLOWED_CONTENT_FORMATS.includes(normalizedContentFormat)) {
            return res.status(400).json({ error: `contentFormat must be one of: ${ALLOWED_CONTENT_FORMATS.join(', ')}` });
        }
        if (!ALLOWED_DISTRIBUTION_CHANNELS.includes(normalizedDistributionChannel)) {
            return res.status(400).json({ error: `distributionChannel must be one of: ${ALLOWED_DISTRIBUTION_CHANNELS.join(', ')}` });
        }
        if (parsedDuration && parsedDuration.error) {
            return res.status(400).json({ error: parsedDuration.error });
        }
        const safeDuration = parsedDuration ? parsedDuration.value : null;

        const { data: newSermon, error: insertError } = await supabase
            .from('sermons')
            .insert({
                user_id: userId,
                series_id: seriesId || null, 
                title: `Generating Sermon: ${topic}`,
                sermon_outline: 'Generating outline...',
                sermon_body: 'Generating content...',
                status: 'pending',
                content_format: normalizedContentFormat,
                target_duration_min: safeDuration,
                distribution_channel: normalizedDistributionChannel,
            })
            .select('sermon_id')
            .single();

        if (insertError) throw insertError;
        res.status(202).json({ message: 'Sermon generation initiated.', sermonId: newSermon.sermon_id, status: 'pending' });

        const styleInstructions = getStylePrompts(userProfile);
    const userPrompt = `Topic: ${topic}\nInclude Illustration: true\nGenerate the sermon based on this topic.${buildFormatInstructions({ contentFormat: normalizedContentFormat, targetDurationMin: safeDuration, distributionChannel: normalizedDistributionChannel })}\n${styleInstructions}`;
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
                content_format: normalizedContentFormat,
                target_duration_min: safeDuration,
                distribution_channel: normalizedDistributionChannel,
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
        const { userId, scripture, userProfile, seriesId, contentFormat, targetDurationMin, distributionChannel } = req.body;

        const normalizedContentFormat = normalizeContentFormat(contentFormat);
        const normalizedDistributionChannel = normalizeDistributionChannel(distributionChannel, normalizedContentFormat);
        const parsedDuration = parseTargetDuration(targetDurationMin);

        if (!ALLOWED_CONTENT_FORMATS.includes(normalizedContentFormat)) {
            return res.status(400).json({ error: `contentFormat must be one of: ${ALLOWED_CONTENT_FORMATS.join(', ')}` });
        }
        if (!ALLOWED_DISTRIBUTION_CHANNELS.includes(normalizedDistributionChannel)) {
            return res.status(400).json({ error: `distributionChannel must be one of: ${ALLOWED_DISTRIBUTION_CHANNELS.join(', ')}` });
        }
        if (parsedDuration && parsedDuration.error) {
            return res.status(400).json({ error: parsedDuration.error });
        }
        const safeDuration = parsedDuration ? parsedDuration.value : null;

        const { data: newSermon, error: insertError } = await supabase
            .from('sermons')
            .insert({
                user_id: userId,
                series_id: seriesId || null, 
                title: `Generating Sermon for ${scripture}`,
                sermon_outline: 'Generating outline...',
                sermon_body: 'Generating content...',
                status: 'pending',
                content_format: normalizedContentFormat,
                target_duration_min: safeDuration,
                distribution_channel: normalizedDistributionChannel,
            })
            .select('sermon_id')
            .single();

        if (insertError) throw insertError;
        res.status(202).json({ message: 'Sermon generation initiated.', sermonId: newSermon.sermon_id, status: 'pending' });

        const styleInstructions = getStylePrompts(userProfile);
    const userPrompt = `Scripture: ${scripture}\nInclude Illustration: true\nGenerate the sermon based on this scripture.${buildFormatInstructions({ contentFormat: normalizedContentFormat, targetDurationMin: safeDuration, distributionChannel: normalizedDistributionChannel })}\n${styleInstructions}`;
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
                content_format: normalizedContentFormat,
                target_duration_min: safeDuration,
                distribution_channel: normalizedDistributionChannel,
            }).eq('sermon_id', newSermon.sermon_id);
        } catch (aiError) {
            await supabase.from('sermons').update({ status: 'failed' }).eq('sermon_id', newSermon.sermon_id);
        }
    } catch (error) { res.status(500).json({ error: 'An unexpected error occurred.' }); }
});

module.exports = router;