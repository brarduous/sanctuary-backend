const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const { aiLimiter } = require('../middleware/limiters');
const authenticateUser = require('../middleware/auth');
const { logEvent } = require('../utils/helpers');
const { QUALITY_MODEL, callStructuredResponse, estimateQualityCostUsd } = require('../utils/openaiResponses');
const { reviewPastoralContent } = require('../utils/theologicalReview');
const {
    PROMPT_VERSION,
    buildVoiceInstructions,
    checkSourceSimilarity,
    getActiveVoiceContext,
    getVoiceSourceTexts,
} = require('../utils/pastorVoice');
const { generateBibleStudyPrompt } = require('../prompts');
const { sendPushToCongregation } = require('../utils/push');
const { generateContentImage } = require('../utils/contentImages');

const bibleStudySchema = {
    type: 'object', additionalProperties: false,
    required: ['title', 'subtitle', 'illustration', 'study_method', 'studies'],
    properties: {
        title: { type: 'string' }, subtitle: { type: 'string' }, illustration: { type: 'string' }, study_method: { type: 'string' },
        studies: {
            type: 'array',
            items: {
                type: 'object', additionalProperties: false,
                required: ['lesson_number', 'title', 'scripture', 'key_verse', 'lesson_aims', 'study_outline', 'introduction', 'commentary', 'discussion_starters', 'application_sidebar', 'conclusion', 'reflection_questions'],
                properties: {
                    lesson_number: { type: 'integer' }, title: { type: 'string' }, scripture: { type: 'string' }, key_verse: { type: 'string' },
                    lesson_aims: { type: 'array', items: { type: 'string' } }, study_outline: { type: 'array', items: { type: 'string' } },
                    introduction: {
                        type: 'object', additionalProperties: false, required: ['hook', 'background'],
                        properties: { hook: { type: 'string' }, background: { type: 'string' } },
                    }, commentary: { type: 'string' },
                    discussion_starters: { type: 'array', items: { type: 'string' } }, application_sidebar: { type: 'array', items: { type: 'string' } },
                    conclusion: {
                        type: 'object', additionalProperties: false, required: ['summary', 'prayer', 'thoughtToRemember'],
                        properties: { summary: { type: 'string' }, prayer: { type: 'string' }, thoughtToRemember: { type: 'string' } },
                    }, reflection_questions: { type: 'array', items: { type: 'string' } },
                },
            },
        },
    },
};

router.post('/bible-study-drafts', authenticateUser, async (req, res, next) => {
    const title = String(req.body?.title || '').trim();
    if (!title) return res.status(400).json({ error: { code: 'TITLE_REQUIRED', message: 'A study title is required.', requestId: req.requestId } });
    try {
        const { data: study, error } = await supabase.from('bible_studies').insert({ user_id: req.user.id, title, subtitle: String(req.body?.subtitle || ''), study_method: String(req.body?.study_method || 'Expositional Method Blueprint'), status: 'draft', is_published: false }).select('*').single();
        if (error) throw error;
        const { data: lesson, error: lessonError } = await supabase.from('bible_study_lessons').insert({ study_id: study.study_id, lesson_number: 1, title: String(req.body?.lesson_title || 'Lesson 1'), scripture: String(req.body?.scripture || ''), user_id: req.user.id }).select('*').single();
        if (lessonError) {
            await supabase.from('bible_studies').delete().eq('study_id', study.study_id);
            throw lessonError;
        }
        res.status(201).json({ ...study, lessons: [lesson] });
    } catch (error) { next(error); }
});

//Endpoint to get Bible Studies by user id
router.get('/bible-studies/:userId', authenticateUser, async (req, res) => {
    const { userId } = req.params;
    if (userId !== req.user.id) return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'You cannot access another user’s study library.', requestId: req.requestId } });
    console.log('Fetching bible studies for user ID:', userId);
    try {
        const { data, error } = await supabase
            .from('bible_studies')
            .select('*, bible_study_lessons(lesson_number)')
            .eq('user_id', userId)
            .neq('status', 'failed')
            .order('created_at', { ascending: false });
        if (error) {
            console.error('Error fetching bible studies:', error);
            return res.status(500).json({ error: 'Failed to fetch bible studies.' });
        }

        res.json(data);
    } catch (error) {
        console.error('Unhandled error in /bible-studies/:userId:', error);
        res.status(500).json({ error: 'An unexpected error occurred.' });
    }
});

//Endpoint to get a single Bible study by study id
router.get('/bible-study/:studyId', authenticateUser, async (req, res) => {
    const { studyId } = req.params;
    console.log('Fetching bible study with ID:', studyId);
    try {
        const isNumeric = /^\d+$/.test(studyId);
        const { data, error } = await supabase
            .from('bible_studies')
            .select('*')
        [isNumeric ? 'eq' : 'eq'](isNumeric ? 'study_id' : 'slug', studyId)
            .eq('user_id', req.user.id)
            .maybeSingle();
        if (error || !data) {
            console.error('Error fetching bible study:', error);
            return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Bible study not found.', requestId: req.requestId } });
        }
        //get lessons for this study and add to data
        const { data: lessons, error: lessonsError } = await supabase
            .from('bible_study_lessons')
            .select('*')
            .eq('study_id', studyId)
            .order('lesson_number', { ascending: true });
        if (lessonsError) {
            console.error('Error fetching bible study lessons for detail:', lessonsError);
            return res.status(500).json({ error: 'Failed to fetch bible study lessons for detail.' });
        }
        data.lessons = lessons;
        res.json(data);
    } catch (error) {
        console.error('Server error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

//Endpoint to get Bible Study Lessons by study id
router.get('/bible-study-lessons/:studyId', authenticateUser, async (req, res) => {
    const { studyId } = req.params;
    console.log('Fetching bible study lessons for study ID:', studyId);
    try {
        const { data: ownedStudy, error: ownedError } = await supabase.from('bible_studies').select('study_id').eq('study_id', studyId).eq('user_id', req.user.id).maybeSingle();
        if (ownedError) throw ownedError;
        if (!ownedStudy) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Bible study not found.', requestId: req.requestId } });
        const { data, error } = await supabase
            .from('bible_study_lessons')
            .select('*')
            .eq('study_id', studyId)
            .order('lesson_number', { ascending: true });
        if (error) {
            console.error('Error fetching bible study lessons:', error);
            return res.status(500).json({ error: 'Failed to fetch bible study lessons.' });
        }
        res.json(data);
    } catch (error) {
        console.error('Unhandled error in /bible-study-lessons/:studyId:', error);
        res.status(500).json({ error: 'An unexpected error occurred.' });
    }
});

//Endpoint to get a single Bible Study Lesson by lesson id
router.get('/bible-study-lessons/detail/:lessonId', authenticateUser, async (req, res) => {
    const { lessonId } = req.params;
    console.log('Fetching bible study detail for lesson ID:', lessonId);
    try {
        const { data, error } = await supabase
            .from('bible_study_lessons')
            .select('*, bible_studies!inner(user_id)')
            .eq('lesson_id', lessonId)
            .eq('bible_studies.user_id', req.user.id)
            .maybeSingle();
        if (error || !data) {
            console.error('Error fetching bible study detail:', error);
            return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Bible study lesson not found.', requestId: req.requestId } });
        }
        res.json(data);
    } catch (error) {
        console.error('Unhandled error in /bible-studies/detail/:lessonId:', error);
        res.status(500).json({ error: 'An unexpected error occurred.' });
    }
});

// Upsert bible study lesson (create or update)
router.post('/bible-study-lessons/:lessonId', authenticateUser, async (req, res) => {
    try {
        const allowedLessonFields = new Set(['study_id','lesson_number','title','study_outline','commentary','reflection_questions','scripture','key_verse','lesson_aims','introduction','discussion_starters','application_sidebar','conclusion']);
        const lessonData = Object.fromEntries(Object.entries(req.body || {}).filter(([key]) => allowedLessonFields.has(key)));
        const { lessonId } = req.params;
        const { data: existing } = await supabase.from('bible_study_lessons').select('study_id').eq('lesson_id', lessonId).maybeSingle();
        const studyId = existing?.study_id || lessonData.study_id;
        const { data: ownedStudy, error: ownedError } = await supabase.from('bible_studies').select('study_id').eq('study_id', studyId).eq('user_id', req.user.id).maybeSingle();
        if (ownedError) throw ownedError;
        if (!ownedStudy) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Bible study not found.', requestId: req.requestId } });
        console.log('Upserting bible study lesson:', lessonData);
        const mutation = existing
            ? supabase.from('bible_study_lessons').update({ ...lessonData, study_id: existing.study_id, updated_at: new Date().toISOString() }).eq('lesson_id', lessonId)
            : supabase.from('bible_study_lessons').insert({ lesson_id: lessonId, ...lessonData, user_id: req.user.id, updated_at: new Date().toISOString() });
        const { data, error } = await mutation.select().single();
        if (error) {
            console.error('Error upserting bible study lesson:', error);
            return res.status(500).json({ error: 'Failed to upsert bible study lesson.' });
        }
        res.json(data);
    } catch (error) {
        console.error('Unhandled error in /bible-study-lessons/:lessonId:', error);
        res.status(500).json({ error: 'An unexpected error occurred.' });
    }
});

// NEW: Endpoint to update the parent Bible Study (e.g., publishing)
router.put('/bible-study/:studyId', authenticateUser, async (req, res) => {
    try {
        const { studyId } = req.params;
        const { is_published, congregation_id } = req.body;
        const { data: ownedStudy, error: ownedError } = await supabase.from('bible_studies').select('study_id').eq('study_id', studyId).eq('user_id', req.user.id).maybeSingle();
        if (ownedError) throw ownedError;
        if (!ownedStudy) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Bible study not found.', requestId: req.requestId } });
        if (congregation_id !== undefined) {
            const { data: allowed, error: authorizationError } = await supabase.rpc('has_congregation_capability', { requested_congregation_id: Number(congregation_id), requested_capability: 'content.write', requested_user_id: req.user.id, requested_campus_id: null });
            if (authorizationError) throw authorizationError;
            if (!allowed) return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'You cannot publish to this organization.', requestId: req.requestId } });
        }
        
        const payload = { updated_at: new Date().toISOString() };
        if (is_published !== undefined) payload.is_published = is_published;
        if (congregation_id !== undefined) payload.congregation_id = congregation_id;

        const { data, error } = await supabase
            .from('bible_studies')
            .update(payload)
            .eq('study_id', studyId)
            .select()
            .single();

        if (error) throw error;
        
        //send push notification to congregation if study is now published
        const suppressStagingNotification = process.env.NODE_ENV !== 'production' && req.get('x-suppress-notifications') === 'true';
        if (is_published === true && congregation_id && !suppressStagingNotification) {
            const pushResult = await sendPushToCongregation(
                congregation_id,
                "New Church Curriculum 📖",
                `A new Bible Study is available: "${data.title}"`,
                { route: `/(tabs)/church` }
            );
            console.log('[BibleStudies] Push result:', pushResult);
        }

        res.json(data);
    } catch (error) {
        console.error('Error updating bible study:', error);
        res.status(500).json({ error: 'Failed to update bible study.' });
    }
});

// Endpoint to initiate Bible Study generation
router.post('/generate-bible-study', authenticateUser, aiLimiter, async (req, res) => {
    try {
        const { topic, length, method } = req.body;
        const userId = req.user.id;
        const startTime = Date.now();
        const lessonCount = Number(length);
        if (!String(topic || '').trim()) return res.status(400).json({ error: 'A study topic or passage is required.' });
        if (!Number.isInteger(lessonCount) || lessonCount < 1 || lessonCount > 12) return res.status(400).json({ error: 'Number of lessons must be between 1 and 12.' });
        if (!String(method || '').trim()) return res.status(400).json({ error: 'A study method is required.' });
        const voiceContext = await getActiveVoiceContext(userId);
        const voiceInstructions = buildVoiceInstructions(voiceContext, 'bible_study');
        // 1. Create a placeholder in the `bible_studies` table immediately
        const { data: newStudy, error: insertStudyError } = await supabase
            .from('bible_studies')
            .insert({
                user_id: userId,
                title: `Generating Bible Study: ${topic}`,
                subtitle: 'Content being generated...', // Placeholder
                study_method: method, // Initial method
                illustration: 'Generating illustration prompt...', // Placeholder
                status: 'pending',
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
            })
            .select('study_id')
            .single();

        if (insertStudyError) {
            console.error('Error creating placeholder Bible study:', insertStudyError);
            return res.status(500).json({ error: 'Failed to initiate Bible study generation.' });
        }

        const { data: generationRun, error: generationRunError } = await supabase
            .from('ai_generation_runs')
            .insert({
                owner_user_id: userId,
                content_type: 'bible_study',
                content_id: String(newStudy.study_id),
                status: 'running',
                model: QUALITY_MODEL,
                voice_profile_id: voiceContext.profileRecord?.id || null,
                voice_treatment: voiceContext.profileRecord ? 'structured_profile' : 'baseline',
                prompt_version: PROMPT_VERSION,
                input_provenance: { requestedTradition: voiceContext.declaredTradition || null },
            })
            .select('id')
            .single();
        if (generationRunError) {
            await supabase.from('bible_studies').update({ status: 'failed' }).eq('study_id', newStudy.study_id);
            return res.status(500).json({ error: 'Failed to register Bible study generation.' });
        }

        // 2. Return the placeholder ID to the frontend immediately
        res.status(202).json({
            message: 'Bible Study generation initiated.',
            studyId: newStudy.study_id,
            status: 'pending'
        });

        // 3. Start AI generation in the background
        const userPrompt = [
            `Topic or passage: ${topic}`,
            `Exact number of lessons: ${lessonCount}`,
            `Required Bible study method: ${method}`,
            'Include one original illustration concept.',
            'The method, passage, and lesson count are hard constraints. Voice personalization must never override them.',
            voiceInstructions,
        ].join('\n');
        const bible_study_prompt = await generateBibleStudyPrompt();
        try {
            const generation = await callStructuredResponse({ instructions: bible_study_prompt, input: userPrompt, schema: bibleStudySchema, schemaName: 'generated_bible_study', maxOutputTokens: 14000 });
            const generatedStudy = generation.data;
            if (generatedStudy.studies.length !== lessonCount) throw Object.assign(new Error('Generated study did not follow the requested lesson count.'), { code: 'FORMAT_NONCOMPLIANCE' });
            const voiceSources = await getVoiceSourceTexts(userId, voiceContext.profileRecord?.id);
            const similarity = checkSourceSimilarity(generatedStudy.studies.map((lesson) => lesson.commentary).join('\n'), voiceSources);
            if (!similarity.passed) throw Object.assign(new Error('Generated study failed the source-originality gate.'), { code: 'SOURCE_SIMILARITY_REJECTED' });
            const theologicalReview = await reviewPastoralContent({
                artifactType: 'bible_study',
                requestedScripture: topic,
                content: generatedStudy,
                voiceContext,
            });
            let imagePayload = {};
            try {
                const image = await generateContentImage({
                    contentType: 'bible-study',
                    contentId: newStudy.study_id,
                    userId,
                    title: generatedStudy.title || `Bible Study on ${topic}`,
                    scripture: generatedStudy.studies?.map((lesson) => lesson.scripture).filter(Boolean).join(', '),
                    illustration: generatedStudy.illustration,
                    outline: generatedStudy.studies?.map((lesson) => `${lesson.title}: ${lesson.study_outline || lesson.lesson_aims || ''}`).join('\n'),
                    body: generatedStudy.subtitle,
                });

                imagePayload = {
                    illustration: image.imageUrl,
                    illustration_prompt: image.imagePrompt,
                    illustration_image_url: image.imageUrl,
                    thumbnail_url: image.imageUrl,
                };
            } catch (imageError) {
                logEvent(
                    'error',
                    'backend',
                    userId,
                    'generate_bible_study_image',
                    `Failed to generate Bible study image for ${newStudy.study_id}`,
                    { error: imageError.message },
                    Date.now() - startTime
                );
                imagePayload = {
                    illustration: generatedStudy.illustration || null,
                    illustration_prompt: generatedStudy.illustration || null,
                };
            }

            // Update the parent bible_studies record with top-level data
            const { error: updateStudyError } = await supabase
                .from('bible_studies')
                .update({
                    title: generatedStudy.title || `Bible Study on ${topic}`,
                    subtitle: generatedStudy.subtitle || null,
                    ...imagePayload,
                    study_method: method,
                    status: 'completed',
                    updated_at: new Date().toISOString(),
                })
                .eq('study_id', newStudy.study_id);
                const duration = Date.now() - startTime;
            if (updateStudyError) {
                console.error(`Error updating bible_studies record ${newStudy.study_id}:`, updateStudyError);
                await supabase.from('bible_studies').update({ status: 'failed' }).eq('study_id', newStudy.study_id);
                logEvent('error', 'backend', userId, 'generate_bible_study', 'Failed to update bible_studies record', { error: updateStudyError.message }, duration);
                return; // Stop here if parent update fails
            }

            // Insert individual lessons into bible_study_lessons table
            if (generatedStudy.studies && Array.isArray(generatedStudy.studies)) {
                for (const lesson of generatedStudy.studies) {
                    const { error: insertLessonError } = await supabase
                        .from('bible_study_lessons')
                        .insert({
                            study_id: newStudy.study_id, 
                            lesson_number: lesson.lesson_number,
                            title: lesson.title,
                            scripture: lesson.scripture || null,
                            key_verse: lesson.key_verse || null,
                            lesson_aims: lesson.lesson_aims || null,
                            study_outline: lesson.study_outline || null,
                            introduction: lesson.introduction || null,
                            commentary: lesson.commentary || null,
                            discussion_starters: lesson.discussion_starters || null,
                            application_sidebar: lesson.application_sidebar || null,
                            conclusion: lesson.conclusion || null,
                            reflection_questions: lesson.reflection_questions || null, 
                            user_id: userId, 
                            created_at: new Date().toISOString(),
                            updated_at: new Date().toISOString(),
                        });
                    if (insertLessonError) {
                        logEvent('error', 'backend', userId, 'generate_bible_study', `Failed to insert bible_study_lesson for study ${newStudy.study_id}`, { error: insertLessonError.message }, Date.now() - startTime);
                        console.error(`Error inserting bible_study_lesson for study ${newStudy.study_id}:`, insertLessonError);
                    }
                }
                await supabase.from('ai_generation_runs').update({
                    owner_user_id: userId, content_type: 'bible_study', content_id: String(newStudy.study_id), status: 'completed',
                    model: generation.model, voice_profile_id: voiceContext.profileRecord?.id || null,
                    voice_treatment: voiceContext.profileRecord ? 'structured_profile' : 'baseline', prompt_version: PROMPT_VERSION,
                    input_token_count: generation.usage.inputTokens, output_token_count: generation.usage.outputTokens,
                    duration_ms: generation.durationMs, completed_at: new Date().toISOString(),
                    estimated_cost_usd: Number((estimateQualityCostUsd(generation.usage) + estimateQualityCostUsd(theologicalReview.usage)).toFixed(6)),
                    input_provenance: {
                        requestedTradition: voiceContext.declaredTradition || null,
                        theologicalReview: {
                            ...theologicalReview.summary,
                            model: theologicalReview.model,
                            reasoningEffort: theologicalReview.reasoningEffort,
                            inputTokens: theologicalReview.usage?.inputTokens || 0,
                            outputTokens: theologicalReview.usage?.outputTokens || 0,
                            durationMs: theologicalReview.durationMs,
                        },
                    },
                }).eq('id', generationRun.id);
                logEvent('ai', 'backend', userId, 'generate_bible_study', 'Successfully generated bible study and lessons', { model: generation.model, promptVersion: PROMPT_VERSION }, duration);
                console.log(`Bible study ${newStudy.study_id} and its lessons successfully generated and updated.`);
            } else {
                logEvent('error', 'backend', userId, 'generate_bible_study', `No 'studies' array found in generated Bible study for ID ${newStudy.study_id}`, {}, Date.now() - startTime);
                console.warn(`No 'studies' array found in generated Bible study for ID ${newStudy.study_id}.`);
            }

        } catch (aiError) {
            logEvent('error', 'backend', userId, 'generate_bible_study', 'AI generation failed', { error: aiError.message }, Date.now() - startTime);
            console.error(`AI generation failed for Bible study ${newStudy.study_id}:`, aiError);
            await supabase.from('bible_studies').update({ status: 'failed' }).eq('study_id', newStudy.study_id);
            await supabase.from('ai_generation_runs').update({
                owner_user_id: userId, content_type: 'bible_study', content_id: String(newStudy.study_id), status: 'failed',
                failure_code: aiError.code || 'GENERATION_FAILED', voice_profile_id: voiceContext.profileRecord?.id || null,
                voice_treatment: voiceContext.profileRecord ? 'structured_profile' : 'baseline', prompt_version: PROMPT_VERSION,
                input_provenance: {
                    requestedTradition: voiceContext.declaredTradition || null,
                    theologicalReview: aiError.reviewResult ? {
                        ...aiError.reviewResult.summary,
                        model: aiError.reviewResult.model,
                        reasoningEffort: aiError.reviewResult.reasoningEffort,
                        inputTokens: aiError.reviewResult.usage?.inputTokens || 0,
                        outputTokens: aiError.reviewResult.usage?.outputTokens || 0,
                        durationMs: aiError.reviewResult.durationMs,
                    } : null,
                },
                completed_at: new Date().toISOString(),
            }).eq('id', generationRun.id);
        }

    } catch (error) {
        logEvent('error', 'backend', null, 'generate_bible_study', 'Unhandled error', { error: error.message }, 0);
        console.error('Unhandled error in /generate-bible-study:', error);
        res.status(500).json({ error: 'An unexpected error occurred.' });
    }
});

module.exports = router;
