const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const { aiLimiter } = require('../middleware/limiters');
const authenticateUser = require('../middleware/auth');
const { logEvent, callOpenAIAndProcessResult } = require('../utils/helpers');
const { bible_study_prompt } = require('../prompts');

//Endpoint to get Bible Studies by user id
router.get('/bible-studies/:userId', authenticateUser, async (req, res) => {
    const { userId } = req.params;
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

//Endpoing to get a single Bible study by study id
router.get('/bible-study/:studyId', authenticateUser, async (req, res) => {
    const { studyId } = req.params;
    console.log('Fetching bible study with ID:', studyId);
    try {
        const isNumeric = /^\d+$/.test(studyId);
        const { data, error } = await supabase
            .from('bible_studies')
            .select('*')
        [isNumeric ? 'eq' : 'eq'](isNumeric ? 'study_id' : 'slug', studyId)
            .single();
        if (error) {
            console.error('Error fetching bible study:', error);
            return res.status(404).json({ error: 'Bible study not found' });
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
//endpoint to get Bible Study Lessons by study id
router.get('/bible-study-lessons/:studyId', authenticateUser, async (req, res) => {
    const { studyId } = req.params;
    console.log('Fetching bible study lessons for study ID:', studyId);
    try {
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
            .select('*')
            .eq('lesson_id', lessonId)
            .single();
        if (error) {
            console.error('Error fetching bible study detail:', error);
            return res.status(500).json({ error: 'Failed to fetch bible study detail.' });
        }
        res.json(data);
    } catch (error) {
        console.error('Unhandled error in /bible-studies/detail/:lessonId:', error);
        res.status(500).json({ error: 'An unexpected error occurred.' });
    }
});

// upsert bible study lesson (create or update)
router.post('/bible-study-lessons/:lessonId', authenticateUser, async (req, res) => {
    try {
        const lessonData = req.body;
        const { lessonId } = req.params;
        console.log('Upserting bible study lesson:', lessonData);
        const { data, error } = await supabase
            .from('bible_study_lessons')
            .upsert({
                lesson_id: lessonId,
                ...lessonData,
                updated_at: new Date().toISOString(),
            })
            .select()
            .single();
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

// Endpoint to initiate Bible Study generation
router.post('/generate-bible-study', authenticateUser, aiLimiter, async (req, res) => {
    try {
        const { userId, topic, length, method } = req.body;
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
        //const systemPrompt = generateBibleStudyPrompt(await getTuningNotes(userId));
        try {
            const generatedStudy = await callOpenAIAndProcessResult(
                bible_study_prompt,
                userPrompt,
                'gpt-4.1-2025-04-14',
                5000,
                "json_object"
            );

            // Update the parent bible_studies record with top-level data
            const { error: updateStudyError } = await supabase
                .from('bible_studies')
                .update({
                    title: generatedStudy.title || `Bible Study on ${topic}`,
                    subtitle: generatedStudy.subtitle || null,
                    illustration: generatedStudy.illustration || null,
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
                            study_id: newStudy.study_id, // Link to parent study
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
                            reflection_questions: lesson.reflection_questions || null, // Assuming this is also present in AI output
                            user_id: userId, // Associate lesson with user
                            created_at: new Date().toISOString(),
                            updated_at: new Date().toISOString(),
                        });
                    if (insertLessonError) {
                        logEvent('error', 'backend', userId, 'generate_bible_study', `Failed to insert bible_study_lesson for study ${newStudy.study_id}`, { error: insertLessonError.message }, Date.now() - startTime);
                        console.error(`Error inserting bible_study_lesson for study ${newStudy.study_id}:`, insertLessonError);
                        // Consider rolling back parent study status to failed or partial
                    }
                }
                logEvent('info', 'backend', userId, 'generate_bible_study', 'Successfully generated bible study and lessons', {}, duration);
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
