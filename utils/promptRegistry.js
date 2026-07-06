const EVALUATION_SOURCES = {
    daily_devotional_generator: {
        table: 'daily_devotionals',
        contentField: 'content',
        idField: 'devotional_id',
        outputLabel: 'Personalized devotional body',
        sampleCount: 5,
    },
    daily_prayer_generator: {
        table: 'daily_prayers',
        contentField: 'generated_prayer',
        idField: 'prayer_id',
        outputLabel: 'Generated prayer text',
        sampleCount: 5,
    },
    news_generator: {
        table: 'scriptural_outlooks',
        contentField: 'ai_outlook',
        idField: 'id',
        outputLabel: 'Scriptural outlook JSON',
        sampleCount: 5,
    },
    advice_guidance_generator: {
        table: 'advice_guidance',
        contentField: 'advice_points',
        idField: 'advice_id',
        outputLabel: 'Advice guidance points',
        sampleCount: 5,
    },
    sermon_generator: {
        table: 'sermons',
        contentField: 'sermon_body',
        idField: 'sermon_id',
        outputLabel: 'Sermon body',
        sampleCount: 5,
    },
    sermon_series_outline_generator: {
        table: 'sermon_series',
        contentField: 'description',
        idField: 'series_id',
        outputLabel: 'Series description and generated child sermons',
        sampleCount: 5,
    },
};

const promptUsage = {
    daily_devotional_generator: {
        label: 'Daily devotional generator',
        status: 'evaluated',
        category: 'Layperson',
        role: 'Base system prompt',
        usedBy: ['getDailyDevotionalPrompt', 'getPersonalizedDevotionalPrompt', 'routes/devotionals.js'],
        outputs: [
            { table: 'daily_devotionals', contentField: 'content', idField: 'devotional_id', description: 'Stored devotional content shown to users.' },
        ],
        notes: 'Also used as the base prompt inside the personalization wrapper.',
    },
    daily_devotional_personalization_wrapper: {
        label: 'Devotional personalization wrapper',
        status: 'indirect',
        category: 'Layperson',
        role: 'Wrapper prompt',
        usedBy: ['getPersonalizedDevotionalPrompt', 'routes/devotionals.js'],
        outputs: [
            { table: 'daily_devotionals', contentField: 'content', idField: 'devotional_id', description: 'Personalized devotional content generated from a general devotional.' },
        ],
        notes: 'The batch evaluator currently grades daily_devotional_generator samples, not this wrapper directly.',
    },
    daily_prayer_generator: {
        label: 'Daily prayer generator',
        status: 'evaluated',
        category: 'Layperson',
        role: 'System prompt',
        usedBy: ['getDailyPrayerPrompt', 'routes/devotionals.js'],
        outputs: [
            { table: 'daily_prayers', contentField: 'generated_prayer', idField: 'prayer_id', description: 'Stored daily prayer generated for the user.' },
        ],
    },
    advice_guidance_generator: {
        label: 'Advice guidance generator',
        status: 'evaluated',
        category: 'Layperson',
        role: 'System prompt',
        usedBy: ['getAdviceGuidancePrompt', 'routes/devotionals.js'],
        outputs: [
            { table: 'advice_guidance', contentField: 'advice_points', idField: 'advice_id', description: 'Generated advice points returned and stored for the user.' },
        ],
    },
    sermon_generator: {
        label: 'Sermon generator',
        status: 'evaluated',
        category: 'Clergy',
        role: 'Base system prompt',
        usedBy: ['generateTopicSermonPrompt', 'generateScriptureSermonPrompt', 'routes/sermons.js'],
        outputs: [
            { table: 'sermons', contentField: 'sermon_body', idField: 'sermon_id', description: 'Completed sermon body, with outline, takeaways, and illustration fields nearby.' },
        ],
        notes: 'Evaluator samples completed sermons and includes content format, channel, duration, and clergy style preferences.',
    },
    sermon_series_outline_generator: {
        label: 'Sermon series outline generator',
        status: 'evaluated',
        category: 'Clergy',
        role: 'Base system prompt',
        usedBy: ['generateSermonSeriesOutlinePrompt', 'routes/sermons.js'],
        outputs: [
            { table: 'sermon_series', contentField: 'description', idField: 'series_id', description: 'Series arc and generated sermon outline metadata.' },
            { table: 'sermons', contentField: 'sermon_body', idField: 'sermon_id', description: 'Child sermons generated from the outline.' },
        ],
        notes: 'Evaluator joins child sermons so the outline is judged against the whole series package.',
    },
    bible_study_generator: {
        label: 'Bible study generator',
        status: 'live_uncovered',
        category: 'Clergy',
        role: 'System prompt',
        usedBy: ['generateBibleStudyPrompt', 'routes/bibleStudies.js'],
        outputs: [
            { table: 'bible_studies', contentField: 'title/description', idField: 'study_id', description: 'Parent Bible study metadata.' },
            { table: 'bible_study_lessons', contentField: 'lesson_content', idField: 'lesson_id', description: 'Generated lesson records.' },
        ],
        notes: 'No batch evaluator coverage exists yet for Bible study outputs.',
    },
    community_prayer_moderator: {
        label: 'Community prayer moderator',
        status: 'live_uncovered',
        category: 'Community',
        role: 'Moderation prompt',
        usedBy: ['getCommunityPrayerPrompt', 'routes/community.js'],
        outputs: [
            { table: 'community_prayers', contentField: 'anonymized_content/status', idField: 'id', description: 'Moderation and anonymization result for submitted prayers.' },
        ],
    },
    daily_news_synopsis: {
        label: 'Daily news synopsis',
        status: 'live_uncovered',
        category: 'News',
        role: 'System prompt',
        usedBy: ['getDailyNewsSynopsisPrompt', 'news ingestion jobs'],
        outputs: [
            { table: 'news_articles', contentField: 'synopsis', idField: 'id', description: 'Article synopsis used downstream by news features.' },
        ],
    },
    general_devotional_generator: {
        label: 'General devotional generator',
        status: 'live_uncovered',
        category: 'Layperson',
        role: 'Batch generator prompt',
        usedBy: ['getGeneralDevotionalBatchPrompt', 'routes/devotionals.js'],
        outputs: [
            { table: 'general_devotionals', contentField: 'content', idField: 'id', description: 'General curriculum devotional used for later personalization.' },
        ],
    },
    news_generator: {
        label: 'Scriptural outlook generator',
        status: 'evaluated',
        category: 'News',
        role: 'System prompt',
        usedBy: ['getScripturalOutlookPrompt', 'news ingestion jobs'],
        outputs: [
            { table: 'scriptural_outlooks', contentField: 'ai_outlook', idField: 'id', description: 'JSON outlook, synopsis, pastoral framing, and news impact score.' },
        ],
        notes: 'Backend appends hardcoded news impact scoring instructions after this prompt.',
    },
    news_generator_article_input: {
        label: 'News article input prompt',
        status: 'companion',
        category: 'News',
        role: 'User-message template',
        usedBy: ['getScripturalOutlookArticleInputPrompt', 'news ingestion jobs'],
        outputs: [
            { table: 'scriptural_outlooks', contentField: 'ai_outlook', idField: 'id', description: 'Input companion for the news_generator system prompt.' },
        ],
        notes: 'Judge news_generator when looking at scriptural outlook outputs; this prompt shapes the user message.',
    },
    news_taxonomy_breakdown_generator: {
        label: 'News taxonomy breakdown generator',
        status: 'live_uncovered',
        category: 'News',
        role: 'Taxonomy summarizer',
        usedBy: ['getNewsTaxonomyBreakdownPrompt', 'scripts/refreshTaxonomyBreakdowns.js'],
        outputs: [
            { table: 'categories/topics', contentField: 'scriptural_breakdown', idField: 'id', description: 'Category and topic breakdown text refreshed from recent synopses.' },
        ],
    },
    sermon_style_analysis_system: {
        label: 'Sermon style analysis system',
        status: 'live_uncovered',
        category: 'Clergy',
        role: 'System prompt',
        usedBy: ['getSermonStyleAnalysisSystemPrompt', 'style analysis routes'],
        outputs: [
            { table: 'user_profiles', contentField: 'sermon_preferences', idField: 'user_id', description: 'Extracted clergy style preferences.' },
        ],
    },
    sermon_style_analysis_generator: {
        label: 'Sermon style analysis generator',
        status: 'companion',
        category: 'Clergy',
        role: 'User-message template',
        usedBy: ['getSermonStyleAnalysisPrompt', 'style analysis routes'],
        outputs: [
            { table: 'user_profiles', contentField: 'sermon_preferences', idField: 'user_id', description: 'Input prompt paired with the style analysis system prompt.' },
        ],
    },
    sermon_length_rewrite_generator: {
        label: 'Sermon length rewrite generator',
        status: 'live_uncovered',
        category: 'Clergy',
        role: 'Repair prompt',
        usedBy: ['routes/sermons.js enforceLengthWithRewrite'],
        outputs: [
            { table: 'sermons', contentField: 'sermon_body', idField: 'sermon_id', description: 'Revised sermon JSON when generated content misses the requested length.' },
        ],
    },
    ai_editor_system: {
        label: 'AI editor system',
        status: 'live_uncovered',
        category: 'Editor',
        role: 'System prompt',
        usedBy: ['getAiEditorSystemPrompt', 'AI editor routes'],
        outputs: [
            { table: 'not_persisted', contentField: 'edited_text', idField: 'request', description: 'Edited text returned to the caller.' },
        ],
    },
    ai_editor_user_edit: {
        label: 'AI editor user edit',
        status: 'companion',
        category: 'Editor',
        role: 'User-message template',
        usedBy: ['getAiEditorUserPrompt', 'AI editor routes'],
        outputs: [
            { table: 'not_persisted', contentField: 'edited_text', idField: 'request', description: 'Instruction and text template paired with ai_editor_system.' },
        ],
    },
    music_curation_generator: {
        label: 'Music curation generator',
        status: 'live_uncovered',
        category: 'Media',
        role: 'Batch classifier',
        usedBy: ['scripts/curateMusicLibrary.js'],
        outputs: [
            { table: 'music_library', contentField: 'curation fields', idField: 'id', description: 'Music curation metadata.' },
        ],
    },
    video_curation_batch_classifier: {
        label: 'Video curation batch classifier',
        status: 'live_uncovered',
        category: 'Media',
        role: 'Batch classifier',
        usedBy: ['scripts/curateVideos.js'],
        outputs: [
            { table: 'video_library', contentField: 'classification fields', idField: 'id', description: 'Video curation classification metadata.' },
        ],
    },
    user_feedback_tuning_generator: {
        label: 'User feedback tuning generator',
        status: 'live_uncovered',
        category: 'Personalization',
        role: 'Tuning prompt',
        usedBy: ['routes/user.js /feedback'],
        outputs: [
            { table: 'user_profiles', contentField: 'ai_tuning_notes', idField: 'user_id', description: 'Personal tuning notes derived from feedback.' },
        ],
    },
    devotional_syllabus_generator: {
        label: 'Devotional syllabus generator',
        status: 'live_uncovered',
        category: 'Layperson',
        role: 'Batch generator prompt',
        usedBy: ['scripts/generateSyllabus.js'],
        outputs: [
            { table: 'general_devotionals', contentField: 'syllabus/curriculum fields', idField: 'id', description: 'Generated devotional curriculum planning data.' },
        ],
    },
    prompt_batch_evaluator: {
        label: 'Prompt batch evaluator',
        status: 'judge_only',
        category: 'Admin',
        role: 'Judge prompt',
        usedBy: ['scripts/evaluatePrompts.js'],
        outputs: [
            { table: 'prompt_evaluations', contentField: 'quality_critique/prompt_critique/suggested_prompt_update', idField: 'id', description: 'Administrative prompt evaluation records.' },
        ],
        notes: 'This prompt judges other prompts. Do not grade it against user-facing generated content.',
    },
};

const withEvaluation = (key, metadata) => {
    const evaluationSource = EVALUATION_SOURCES[key];
    return {
        key,
        ...metadata,
        evaluation: evaluationSource
            ? {
                supported: true,
                sourceTable: evaluationSource.table,
                contentField: evaluationSource.contentField,
                idField: evaluationSource.idField,
                sampleCount: evaluationSource.sampleCount,
                outputLabel: evaluationSource.outputLabel,
            }
            : {
                supported: false,
            },
    };
};

function getPromptUsageMetadata(key) {
    return withEvaluation(key, promptUsage[key] || {
        label: key,
        status: 'unmapped',
        category: 'Unknown',
        role: 'Unmapped database prompt',
        usedBy: [],
        outputs: [],
        notes: 'This prompt exists in the database but is not mapped in the backend prompt registry yet.',
    });
}

function listPromptUsageMetadata(keys = []) {
    const registryKeys = Object.keys(promptUsage);
    const allKeys = [...new Set([...registryKeys, ...keys])].sort();
    return allKeys.map(getPromptUsageMetadata);
}

module.exports = {
    EVALUATION_SOURCES,
    getPromptUsageMetadata,
    listPromptUsageMetadata,
};
