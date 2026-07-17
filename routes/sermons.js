const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const { aiLimiter } = require('../middleware/limiters');
const authenticateUser = require('../middleware/auth');
const { logEvent, getTuningNotes } = require('../utils/helpers');
const { QUALITY_MODEL, callStructuredResponse, estimateQualityCostUsd } = require('../utils/openaiResponses');
const { reviewPastoralContent } = require('../utils/theologicalReview');
const {
    PROMPT_VERSION,
    buildVoiceInstructions,
    checkSourceSimilarity,
    getActiveVoiceContext,
    getVoiceSourceTexts,
} = require('../utils/pastorVoice');
const { generateContentImage } = require('../utils/contentImages');
const {
    generateTopicSermonPrompt,
    generateScriptureSermonPrompt,
    generateSermonSeriesOutlinePrompt,
    getRenderedPrompt
} = require('../prompts');

const ALLOWED_CONTENT_FORMATS = ['sermon', 'sermonette', 'podcast_episode', 'youtube_video'];
const ALLOWED_DISTRIBUTION_CHANNELS = ['pulpit', 'podcast', 'youtube', 'multi'];
const ALLOWED_SERIES_FORMATS = ['standard', 'short_form'];

const sermonSchema = {
    type: 'object', additionalProperties: false,
    required: ['title', 'scripture', 'illustration', 'sermon_outline', 'key_takeaways', 'sermon_body'],
    properties: {
        title: { type: 'string' },
        scripture: { type: ['string', 'null'] },
        illustration: { type: ['string', 'null'] },
        sermon_outline: { type: 'array', items: { type: 'string' } },
        key_takeaways: { type: 'array', items: { type: 'string' } },
        sermon_body: { type: 'string' },
    },
};

const seriesOutlineSchema = {
    type: 'object', additionalProperties: false,
    required: ['series_name', 'description', 'sermons'],
    properties: {
        series_name: { type: 'string' },
        description: { type: 'string' },
        sermons: {
            type: 'array',
            items: {
                type: 'object', additionalProperties: false,
                required: ['title', 'scripture'],
                properties: { title: { type: 'string' }, scripture: { type: 'string' } },
            },
        },
    },
};

async function generateStructuredSermon({ systemPrompt, userPrompt }) {
    return callStructuredResponse({
        instructions: systemPrompt,
        input: userPrompt,
        schema: sermonSchema,
        schemaName: 'generated_sermon',
        maxOutputTokens: 12000,
    });
}

async function enforceOriginality({ userId, voiceContext, sermon }) {
    const sources = await getVoiceSourceTexts(userId, voiceContext.profileRecord?.id);
    const result = checkSourceSimilarity(sermon.sermon_body || '', sources);
    if (!result.passed) {
        const error = new Error('Generated sermon failed the source-originality gate.');
        error.code = 'SOURCE_SIMILARITY_REJECTED';
        error.similarity = result;
        throw error;
    }
    return result;
}

async function createGenerationRun({ userId, contentId, voiceContext }) {
    const { data, error } = await supabase.from('ai_generation_runs').insert({
        owner_user_id: userId,
        content_type: 'sermon',
        content_id: String(contentId),
        status: 'running',
        model: QUALITY_MODEL,
        voice_profile_id: voiceContext.profileRecord?.id || null,
        voice_treatment: voiceContext.profileRecord ? 'structured_profile' : 'baseline',
        prompt_version: PROMPT_VERSION,
        input_provenance: { requestedTradition: voiceContext.declaredTradition || null },
    }).select('id').single();
    if (error) throw error;
    return data.id;
}

async function recordGeneration({ generationRunId = null, userId, contentId, voiceContext, response, review = null, status = 'completed', failureCode = null }) {
    const generationCost = estimateQualityCostUsd(response?.usage);
    const reviewCost = estimateQualityCostUsd(review?.usage);
    const payload = {
        owner_user_id: userId,
        content_type: 'sermon',
        content_id: String(contentId),
        status,
        model: response?.model || null,
        failure_code: failureCode,
        voice_profile_id: voiceContext.profileRecord?.id || null,
        voice_treatment: voiceContext.profileRecord ? 'structured_profile' : 'baseline',
        prompt_version: PROMPT_VERSION,
        input_token_count: response?.usage?.inputTokens || null,
        output_token_count: response?.usage?.outputTokens || null,
        duration_ms: response?.durationMs || null,
        estimated_cost_usd: Number((generationCost + reviewCost).toFixed(6)),
        input_provenance: {
            requestedTradition: voiceContext.declaredTradition || null,
            theologicalReview: review ? {
                ...review.summary,
                model: review.model,
                reasoningEffort: review.reasoningEffort,
                inputTokens: review.usage?.inputTokens || 0,
                outputTokens: review.usage?.outputTokens || 0,
                durationMs: review.durationMs,
            } : null,
        },
        completed_at: new Date().toISOString(),
    };
    const mutation = generationRunId
        ? supabase.from('ai_generation_runs').update(payload).eq('id', generationRunId)
        : supabase.from('ai_generation_runs').insert(payload);
    await mutation;
}

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

const countWords = (text = '') => {
    if (!text || typeof text !== 'string') return 0;
    const words = text.trim().match(/\S+/g);
    return words ? words.length : 0;
};

const getSpeechRateWpm = ({ contentFormat, distributionChannel }) => {
    if (contentFormat === 'podcast_episode' || distributionChannel === 'podcast') return 150;
    if (contentFormat === 'youtube_video' || contentFormat === 'sermonette' || distributionChannel === 'youtube') return 140;
    return 130;
};

const getWordBudget = ({ targetDurationMin, contentFormat, distributionChannel }) => {
    if (!targetDurationMin) return null;
    const speechRateWpm = getSpeechRateWpm({ contentFormat, distributionChannel });
    const targetWords = targetDurationMin * speechRateWpm;
    const minWords = Math.max(60, Math.floor(targetWords * 0.9));
    const maxWords = Math.ceil(targetWords * 1.1);

    return {
        speechRateWpm,
        targetWords,
        minWords,
        maxWords,
    };
};

const estimateDurationMin = (wordCount, speechRateWpm) => {
    if (!wordCount || !speechRateWpm) return null;
    return Math.max(1, Math.round(wordCount / speechRateWpm));
};

const buildFormatInstructions = ({ contentFormat, targetDurationMin, distributionChannel }) => {
    const wordBudget = getWordBudget({ targetDurationMin, contentFormat, distributionChannel });
    const durationLine = targetDurationMin
        ? `Target Length: approximately ${targetDurationMin} minutes.`
        : 'Target Length: choose a sensible length for the requested format.';

    const wordLine = wordBudget
        ? `- Word Count Constraint: sermon_body MUST be between ${wordBudget.minWords} and ${wordBudget.maxWords} words (target ~${wordBudget.targetWords}).`
        : '- Word Count Constraint: choose a natural word count for the requested format.';

    return `\n\nOUTPUT FORMAT REQUIREMENTS:\n- Content Format: ${contentFormat}\n- Distribution Channel: ${distributionChannel}\n- ${durationLine}\n${wordLine}\n- Keep structure, tone, and pacing appropriate for this format and channel.\n- Return valid JSON only and ensure sermon_body meets the word constraint when provided.`;
};

const enforceLengthWithRewrite = async ({
    generatedSermon,
    systemPrompt,
    contentFormat,
    distributionChannel,
    targetDurationMin,
    contextLabel,
}) => {
    const budget = getWordBudget({ targetDurationMin, contentFormat, distributionChannel });
    let currentSermon = generatedSermon || {};

    if (!budget || !currentSermon.sermon_body) {
        const fallbackWordCount = countWords(currentSermon.sermon_body || '');
        return {
            sermon: currentSermon,
            wordCount: fallbackWordCount,
            estimatedDurationMin: budget ? estimateDurationMin(fallbackWordCount, budget.speechRateWpm) : null,
        };
    }

    for (let attempt = 1; attempt <= 2; attempt++) {
        const currentWordCount = countWords(currentSermon.sermon_body || '');
        const isWithinRange = currentWordCount >= budget.minWords && currentWordCount <= budget.maxWords;
        if (isWithinRange) {
            return {
                sermon: currentSermon,
                wordCount: currentWordCount,
                estimatedDurationMin: estimateDurationMin(currentWordCount, budget.speechRateWpm),
            };
        }

        const rewritePrompt = await getRenderedPrompt('sermon_length_rewrite_generator', {
            context_label: contextLabel,
            min_words: budget.minWords,
            max_words: budget.maxWords,
            current_word_count: currentWordCount,
            current_sermon_json: JSON.stringify(currentSermon)
        });

        try {
            const revised = (await generateStructuredSermon({ systemPrompt, userPrompt: rewritePrompt })).data;

            if (revised && typeof revised === 'object') {
                currentSermon = {
                    ...currentSermon,
                    ...revised,
                };
            }
        } catch (error) {
            break;
        }
    }

    const finalWordCount = countWords(currentSermon.sermon_body || '');
    return {
        sermon: currentSermon,
        wordCount: finalWordCount,
        estimatedDurationMin: estimateDurationMin(finalWordCount, budget.speechRateWpm),
    };
};

const sanitizeSermonUpdatePayload = (body) => {
    const errors = [];
    const allowed = new Set(['title', 'date_preached', 'sermon_outline', 'sermon_body', 'illustration', 'key_takeaways', 'scripture', 'status', 'tags', 'content_format', 'target_duration_min', 'actual_duration_min', 'distribution_channel']);
    const payload = Object.fromEntries(Object.entries(body || {}).filter(([key]) => allowed.has(key)));
    if (Object.prototype.hasOwnProperty.call(body, 'status') && !['draft', 'completed'].includes(body.status)) {
        errors.push('status must be draft or completed.');
        delete payload.status;
    }

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

const tryGenerateSermonImage = async ({ userId, sermonId, sermon, contextLabel, startTime }) => {
    try {
        const image = await generateContentImage({
            contentType: 'sermon',
            contentId: sermonId,
            userId,
            title: sermon.title,
            scripture: sermon.scripture,
            illustration: sermon.illustration,
            outline: sermon.sermon_outline,
            body: sermon.sermon_body,
        });

        return {
            illustration_prompt: image.imagePrompt,
            illustration_image_url: image.imageUrl,
            thumbnail_url: image.imageUrl,
        };
    } catch (error) {
        logEvent(
            'error',
            'backend',
            userId,
            'generate_sermon_image',
            `Failed to generate sermon image for ${contextLabel}`,
            { error: error.message, sermonId },
            Date.now() - startTime
        );
        return {};
    }
};

// --- Series Endpoints ---
router.get('/sermons/series/:userId', authenticateUser, async (req, res) => {
    const { userId } = req.params;
    if (userId !== req.user.id) return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'You cannot access another user’s sermon series.', requestId: req.requestId } });
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
        const { data: series, error: seriesError } = await supabase.from('sermon_series').select('*').eq('series_id', seriesId).eq('user_id', req.user.id).maybeSingle();
        if (seriesError) throw seriesError;
        if (!series) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Sermon series not found.', requestId: req.requestId } });

        const { data: sermons, error: sermonsError } = await supabase.from('sermons').select('*').eq('series_id', seriesId).eq('user_id', req.user.id).order('created_at', { ascending: true });
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
        const { topic, details, numberOfSermons, contentFormat, targetDurationMin, distributionChannel, seriesFormat } = req.body;
        const userId = req.user.id;
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
        const voiceContext = await getActiveVoiceContext(userId);
        const styleInstructions = buildVoiceInstructions(voiceContext, 'sermon');

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
        const outlinePrompt = `Topic: ${topic}\nAdditional Context: ${details}\nNumber of Sermons: ${numberOfSermons}\nSeries Format: ${normalizedSeriesFormat}\nContent Format: ${normalizedContentFormat}\nDistribution Channel: ${normalizedDistributionChannel}\nTarget Duration (minutes): ${safeDuration || 'auto'}\n\nCreate a cohesive sermon series outline.\n${styleInstructions}`;
        const systemPromptOutline = await generateSermonSeriesOutlinePrompt(await getTuningNotes(userId));

        try {
            const generatedOutline = (await callStructuredResponse({ instructions: systemPromptOutline, input: outlinePrompt, schema: seriesOutlineSchema, schemaName: 'sermon_series_outline', maxOutputTokens: 4000 })).data;

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
                const generationRunId = await createGenerationRun({
                    userId,
                    contentId: sermonRecord.sermon_id,
                    voiceContext,
                });

                // Generate the individual sermon deeply
                const sermonUserPrompt = `Series Topic: ${topic}\nSermon Title: ${sermonOutline.title}\nScripture: ${sermonOutline.scripture}\nInclude Illustration: true\n\nGenerate this specific sermon.${buildFormatInstructions({ contentFormat: normalizedContentFormat, targetDurationMin: safeDuration, distributionChannel: normalizedDistributionChannel })}\n${styleInstructions}`;
                const sermonSystemPrompt = await generateTopicSermonPrompt(await getTuningNotes(userId));

                try {
                    const generation = await generateStructuredSermon({ systemPrompt: sermonSystemPrompt, userPrompt: sermonUserPrompt });
                    const generatedSermon = generation.data;
                    const lengthManaged = await enforceLengthWithRewrite({
                        generatedSermon,
                        systemPrompt: sermonSystemPrompt,
                        contentFormat: normalizedContentFormat,
                        distributionChannel: normalizedDistributionChannel,
                        targetDurationMin: safeDuration,
                        contextLabel: `Series Topic: ${topic} | Sermon Title: ${sermonOutline.title} | Scripture: ${sermonOutline.scripture || 'N/A'}`,
                    });
                    const sermonPayload = {
                        title: lengthManaged.sermon.title || sermonOutline.title,
                        scripture: lengthManaged.sermon.scripture || sermonOutline.scripture,
                        illustration: lengthManaged.sermon.illustration,
                        sermon_outline: lengthManaged.sermon.sermon_outline,
                        key_takeaways: lengthManaged.sermon.key_takeaways,
                        sermon_body: lengthManaged.sermon.sermon_body,
                    };
                    const theologicalReview = await reviewPastoralContent({
                        artifactType: 'sermon',
                        requestedScripture: sermonOutline.scripture,
                        content: sermonPayload,
                        voiceContext,
                    });
                    await enforceOriginality({ userId, voiceContext, sermon: sermonPayload });
                    const imagePayload = await tryGenerateSermonImage({
                        userId,
                        sermonId: sermonRecord.sermon_id,
                        sermon: sermonPayload,
                        contextLabel: `series sermon "${sermonOutline.title}"`,
                        startTime,
                    });

                    await supabase.from('sermons').update({
                        ...sermonPayload,
                        ...imagePayload,
                        status: 'completed',
                        content_format: normalizedContentFormat,
                        target_duration_min: safeDuration,
                        actual_duration_min: lengthManaged.estimatedDurationMin,
                        distribution_channel: normalizedDistributionChannel,
                    }).eq('sermon_id', sermonRecord.sermon_id);
                    await recordGeneration({ generationRunId, userId, contentId: sermonRecord.sermon_id, voiceContext, response: generation, review: theologicalReview });
                } catch (sermonErr) {
                    await supabase.from('sermons').update({ status: 'failed' }).eq('sermon_id', sermonRecord.sermon_id);
                    await recordGeneration({ generationRunId, userId, contentId: sermonRecord.sermon_id, voiceContext, review: sermonErr.reviewResult || null, status: 'failed', failureCode: sermonErr.code || 'GENERATION_FAILED' });
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
router.post('/sermon-drafts', authenticateUser, async (req, res, next) => {
    const title = String(req.body?.title || '').trim() || 'Untitled Sermon';
    const body = String(req.body?.sermon_body || '');
    try {
        const { data, error } = await supabase.from('sermons').insert({
            user_id: req.user.id, title, sermon_body: body, scripture: req.body?.scripture || null,
            status: 'draft', content_format: normalizeContentFormat(req.body?.content_format),
            distribution_channel: normalizeDistributionChannel(req.body?.distribution_channel, normalizeContentFormat(req.body?.content_format)),
            target_duration_min: parseTargetDuration(req.body?.target_duration_min)?.value || null,
            tags: Array.isArray(req.body?.tags) ? req.body.tags.slice(0, 20).map(String) : [],
        }).select('*').single();
        if (error) throw error;
        res.status(201).json(data);
    } catch (error) { next(error); }
});

router.get('/sermons/:userId', authenticateUser, async (req, res) => {
    if (req.params.userId !== req.user.id) return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'You cannot access another user’s sermon library.', requestId: req.requestId } });
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
        let query = supabase.from('sermons').select('*').eq('user_id', req.params.userId).neq('status', 'failed').not('tags', 'cs', '{voice-source}');
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
    const { data, error } = await supabase.from('sermons').select('*').eq('sermon_id', req.params.sermonId).eq('user_id', req.user.id).maybeSingle();
    if (error || !data) return res.status(404).json({ error: 'Sermon not found.' });
    res.json(data);
});

router.post('/sermons/:sermonId', authenticateUser, async (req, res) => {
    try {
        const { payload, errors } = sanitizeSermonUpdatePayload(req.body);
        if (errors.length > 0) {
            return res.status(400).json({ error: errors.join(' ') });
        }

        const { data, error } = await supabase.from('sermons').update({ ...payload, updated_at: new Date().toISOString() }).eq('sermon_id', req.params.sermonId).eq('user_id', req.user.id).select('*').maybeSingle();
        if (error) throw error;
        if (!data) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Sermon not found.', requestId: req.requestId } });
        res.status(201).json(data);
    } catch (error) {
        res.status(500).json({ error: 'Failed to save sermon.' });
    }
});

router.post('/generate-sermon-by-topic', authenticateUser, aiLimiter, async (req, res) => {
    // Keep your existing generate-sermon-by-topic code here verbatim
    try {
        const startTime = Date.now();
        const { topic, seriesId, contentFormat, targetDurationMin, distributionChannel } = req.body;
        const userId = req.user.id;

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
        const voiceContext = await getActiveVoiceContext(userId);
        const styleInstructions = buildVoiceInstructions(voiceContext, 'sermon');

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
        const generationRunId = await createGenerationRun({
            userId,
            contentId: newSermon.sermon_id,
            voiceContext,
        }).catch(async (error) => {
            await supabase.from('sermons').update({ status: 'failed' }).eq('sermon_id', newSermon.sermon_id);
            throw error;
        });
        res.status(202).json({ message: 'Sermon generation initiated.', sermonId: newSermon.sermon_id, status: 'pending' });

        const userPrompt = `Topic: ${topic}\nInclude Illustration: true\nGenerate the sermon based on this topic.${buildFormatInstructions({ contentFormat: normalizedContentFormat, targetDurationMin: safeDuration, distributionChannel: normalizedDistributionChannel })}\n${styleInstructions}`;
        const systemPrompt = await generateTopicSermonPrompt(await getTuningNotes(userId));

        try {
            const generation = await generateStructuredSermon({ systemPrompt, userPrompt });
            const generatedSermon = generation.data;
            const lengthManaged = await enforceLengthWithRewrite({
                generatedSermon,
                systemPrompt,
                contentFormat: normalizedContentFormat,
                distributionChannel: normalizedDistributionChannel,
                targetDurationMin: safeDuration,
                contextLabel: `Topic: ${topic}`,
            });
            const sermonPayload = {
                title: lengthManaged.sermon.title || `Sermon on ${topic}`,
                scripture: lengthManaged.sermon.scripture || null,
                illustration: lengthManaged.sermon.illustration || null,
                sermon_outline: lengthManaged.sermon.sermon_outline || null,
                key_takeaways: lengthManaged.sermon.key_takeaways || null,
                sermon_body: lengthManaged.sermon.sermon_body || null,
            };
            const theologicalReview = await reviewPastoralContent({
                artifactType: 'sermon',
                requestedScripture: sermonPayload.scripture,
                content: sermonPayload,
                voiceContext,
            });
            await enforceOriginality({ userId, voiceContext, sermon: sermonPayload });
            const imagePayload = await tryGenerateSermonImage({
                userId,
                sermonId: newSermon.sermon_id,
                sermon: sermonPayload,
                contextLabel: `topic "${topic}"`,
                startTime,
            });

            await supabase.from('sermons').update({
                ...sermonPayload,
                ...imagePayload,
                status: 'completed',
                content_format: normalizedContentFormat,
                target_duration_min: safeDuration,
                actual_duration_min: lengthManaged.estimatedDurationMin,
                distribution_channel: normalizedDistributionChannel,
            }).eq('sermon_id', newSermon.sermon_id);
            await recordGeneration({ generationRunId, userId, contentId: newSermon.sermon_id, voiceContext, response: generation, review: theologicalReview });
        } catch (aiError) {
            await supabase.from('sermons').update({ status: 'failed' }).eq('sermon_id', newSermon.sermon_id);
            await recordGeneration({ generationRunId, userId, contentId: newSermon.sermon_id, voiceContext, review: aiError.reviewResult || null, status: 'failed', failureCode: aiError.code || 'GENERATION_FAILED' });
        }
    } catch (error) { res.status(500).json({ error: 'An unexpected error occurred.' }); }
});

router.post('/generate-sermon-by-scripture', authenticateUser, aiLimiter, async (req, res) => {
    // Keep your existing generate-sermon-by-scripture code here verbatim
    try {
        const startTime = Date.now();
        const { scripture, seriesId, contentFormat, targetDurationMin, distributionChannel } = req.body;
        const userId = req.user.id;

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
        const voiceContext = await getActiveVoiceContext(userId);
        const styleInstructions = buildVoiceInstructions(voiceContext, 'sermon');

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
        const generationRunId = await createGenerationRun({
            userId,
            contentId: newSermon.sermon_id,
            voiceContext,
        }).catch(async (error) => {
            await supabase.from('sermons').update({ status: 'failed' }).eq('sermon_id', newSermon.sermon_id);
            throw error;
        });
        res.status(202).json({ message: 'Sermon generation initiated.', sermonId: newSermon.sermon_id, status: 'pending' });

        const userPrompt = `Scripture: ${scripture}\nInclude Illustration: true\nGenerate the sermon based on this scripture.${buildFormatInstructions({ contentFormat: normalizedContentFormat, targetDurationMin: safeDuration, distributionChannel: normalizedDistributionChannel })}\n${styleInstructions}`;
        const systemPrompt = await generateScriptureSermonPrompt(await getTuningNotes(userId));

        try {
            const generation = await generateStructuredSermon({ systemPrompt, userPrompt });
            const generatedSermon = generation.data;
            const lengthManaged = await enforceLengthWithRewrite({
                generatedSermon,
                systemPrompt,
                contentFormat: normalizedContentFormat,
                distributionChannel: normalizedDistributionChannel,
                targetDurationMin: safeDuration,
                contextLabel: `Scripture: ${scripture}`,
            });
            const sermonPayload = {
                title: lengthManaged.sermon.title || `Sermon for ${scripture}`,
                scripture: lengthManaged.sermon.scripture || null,
                illustration: lengthManaged.sermon.illustration || null,
                sermon_outline: lengthManaged.sermon.sermon_outline || null,
                key_takeaways: lengthManaged.sermon.key_takeaways || null,
                sermon_body: lengthManaged.sermon.sermon_body || null,
            };
            const theologicalReview = await reviewPastoralContent({
                artifactType: 'sermon',
                requestedScripture: scripture,
                content: sermonPayload,
                voiceContext,
            });
            await enforceOriginality({ userId, voiceContext, sermon: sermonPayload });
            const imagePayload = await tryGenerateSermonImage({
                userId,
                sermonId: newSermon.sermon_id,
                sermon: sermonPayload,
                contextLabel: `scripture "${scripture}"`,
                startTime,
            });

            await supabase.from('sermons').update({
                ...sermonPayload,
                ...imagePayload,
                status: 'completed',
                content_format: normalizedContentFormat,
                target_duration_min: safeDuration,
                actual_duration_min: lengthManaged.estimatedDurationMin,
                distribution_channel: normalizedDistributionChannel,
            }).eq('sermon_id', newSermon.sermon_id);
            await recordGeneration({ generationRunId, userId, contentId: newSermon.sermon_id, voiceContext, response: generation, review: theologicalReview });
        } catch (aiError) {
            await supabase.from('sermons').update({ status: 'failed' }).eq('sermon_id', newSermon.sermon_id);
            await recordGeneration({ generationRunId, userId, contentId: newSermon.sermon_id, voiceContext, review: aiError.reviewResult || null, status: 'failed', failureCode: aiError.code || 'GENERATION_FAILED' });
        }
    } catch (error) { res.status(500).json({ error: 'An unexpected error occurred.' }); }
});

module.exports = router;
