const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const { aiLimiter } = require('../middleware/limiters');
const authenticateUser = require('../middleware/auth');
const { logEvent, callOpenAIAndProcessResult } = require('../utils/helpers');
const { generateBibleStudyPrompt } = require('../prompts');
const { sendPushToCongregation } = require('../utils/push');
const { generateContentImage } = require('../utils/contentImages');

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

        // 2. Return the placeholder ID to the frontend immediately
        res.status(202).json({
            message: 'Bible Study generation initiated.',
            studyId: newStudy.study_id,
            status: 'pending'
        });

        // 3. Start AI generation in the background
        const userPrompt = 'Topic: ' + topic + '\n Number of Lessons:' + length + '\n Bible Study Type: ' + method + '\n Include Illustration: true\n ';
        const bible_study_prompt = await generateBibleStudyPrompt();
        try {
            const generatedStudy = await callOpenAIAndProcessResult(
                bible_study_prompt,
                userPrompt,
                'gpt-4.1-2025-04-14',
                5000,
                "json_object"
            );
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
                    study_method: generatedStudy.study_method || method,
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
                logEvent('ai', 'backend', userId, 'generate_bible_study', 'Successfully generated bible study and lessons', {tokens: generatedStudy.tokens}, duration);
                console.log(`Bible study ${newStudy.study_id} and its lessons successfully generated and updated.`);
            } else {
                logEvent('error', 'backend', userId, 'generate_bible_study', `No 'studies' array found in generated Bible study for ID ${newStudy.study_id}`, {}, Date.now() - startTime);
                console.warn(`No 'studies' array found in generated Bible study for ID ${newStudy.study_id}.`);
            }

        } catch (aiError) {
            logEvent('error', 'backend', userId, 'generate_bible_study', 'AI generation failed', { error: aiError.message }, Date.now() - startTime);
            console.error(`AI generation failed for Bible study ${newStudy.study_id}:`, aiError);
            await supabase.from('bible_studies').update({ status: 'failed' }).eq('study_id', newStudy.study_id);
        }

    } catch (error) {
        logEvent('error', 'backend', null, 'generate_bible_study', 'Unhandled error', { error: error.message }, 0);
        console.error('Unhandled error in /generate-bible-study:', error);
        res.status(500).json({ error: 'An unexpected error occurred.' });
    }
});

module.exports = router;
