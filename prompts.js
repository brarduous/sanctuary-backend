const supabase = require('./config/supabase');

// --- CACHING SYSTEM ---
let promptCache = {};
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes (adjust as needed)

async function fetchPrompt(key) {
    const now = Date.now();
    
    // 1. Check Cache
    if (promptCache[key] && (now - promptCache[key].timestamp < CACHE_TTL)) {
        return promptCache[key].content;
    }

    // 2. Fetch from DB
    console.log(`[Prompts] Fetching fresh prompt for: ${key}`);
    const { data, error } = await supabase
        .from('system_prompts')
        .select('content')
        .eq('key', key)
        .single();

    if (error || !data) {
        console.error(`[Prompts] CRITICAL ERROR: Could not fetch prompt '${key}'`, error);
        // Fallback: If cache exists (even if stale), use it. Otherwise throw.
        if (promptCache[key]) return promptCache[key].content;
        throw new Error(`System prompt ${key} not found.`);
    }

    // 3. Update Cache
    promptCache[key] = {
        content: data.content,
        timestamp: now
    };

    return data.content;
}

const stringifyPromptVar = (value) => {
    if (value === null || value === undefined) return '';
    if (Array.isArray(value)) return value.join(', ');
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
};

const renderPromptTemplate = (template, variables = {}) => {
    return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => stringifyPromptVar(variables[key]));
};

const getRenderedPrompt = async (key, variables = {}) => {
    const template = await fetchPrompt(key);
    return renderPromptTemplate(template, variables);
};

// --- HELPER: Tuning Formatting ---
const formatTuning = (notes) => {
  if (!notes) return "";
  return `
    CRITICAL PERSONALIZATION INSTRUCTIONS:
    The user has provided feedback on previous outputs. You MUST adjust your style as follows:
    ${notes}
    (These instructions override any conflicting standard guidelines below.)
  `;
};

// --- EXPORTED GENERATORS (Now Async) ---
const getPersonalizedDevotionalPrompt = async (userData, generalDevoData, tuningNotes = "") => {
    const basePrompt = await fetchPrompt('daily_devotional_generator');

    return await getRenderedPrompt('daily_devotional_personalization_wrapper', {
        base_prompt: basePrompt,
        tuning_instructions: formatTuning(tuningNotes),
        curriculum_title: generalDevoData.title,
        curriculum_scripture_reference: generalDevoData.scripture_reference,
        curriculum_scripture_text: generalDevoData.scripture_text || 'Use the reference above.',
        curriculum_core_message: generalDevoData.content,
        user_focus_areas: userData.focusAreas?.join(', ') || 'General spiritual growth',
        user_improvement_areas: userData.improvementAreas?.join(', ') || 'None specified',
        user_pastoral_notes: userData.pastoral_notes || 'None available.'
    });
};

const generateTopicSermonPrompt = async (tuningNotes = "") => {
    const basePrompt = await fetchPrompt('sermon_generator');
    return `${formatTuning(tuningNotes)}\n\n${basePrompt}`;
};

const generateScriptureSermonPrompt = async (tuningNotes = "") => {
    const basePrompt = await fetchPrompt('sermon_generator');
    return `${formatTuning(tuningNotes)}\n\n${basePrompt}`;
};

const generateBibleStudyPrompt = async (tuningNotes = "") => {
    const basePrompt = await fetchPrompt('bible_study_generator');
    return `${formatTuning(tuningNotes)}\n\n${basePrompt}`;
};

const getDailyPrayerPrompt = async () => {
    return await fetchPrompt('daily_prayer_generator');
};

const getAdviceGuidancePrompt = async () => {
    return await fetchPrompt('advice_guidance_generator');
};

const getDailyDevotionalPrompt = async () => {
    return await fetchPrompt('daily_devotional_generator');
};

const getCommunityPrayerPrompt = async () => {
    return await fetchPrompt('community_prayer_moderator');
};

const getDailyNewsSynopsisPrompt = async () => {
    return await fetchPrompt('daily_news_synopsis');
};

const getGeneralDevotionalBatchPrompt = async (themeData) => {
    return await getRenderedPrompt('general_devotional_generator', {
        theme_title: themeData.theme_title,
        scripture_focus: themeData.scripture_focus
    });
};

const getScripturalOutlookPrompt = async () => {
    return await fetchPrompt('news_generator');
};

const getScripturalOutlookArticleInputPrompt = async (article, existingTaxonomies) => {
    return await getRenderedPrompt('news_generator_article_input', {
        article_title: article.title,
        article_body: article.body,
        article_description: article.description,
        existing_categories: existingTaxonomies.categories,
        existing_topics: existingTaxonomies.topics
    });
};

const getNewsTaxonomyBreakdownPrompt = async ({ taxonomyName, synopses }) => {
    return await getRenderedPrompt('news_taxonomy_breakdown_generator', {
        taxonomy_name: taxonomyName,
        synopses
    });
};

const getSermonStyleAnalysisSystemPrompt = async () => {
    return await fetchPrompt('sermon_style_analysis_system');
};

const getSermonStyleAnalysisPrompt = async ({ combinedText }) => {
    return await getRenderedPrompt('sermon_style_analysis_generator', {
        combined_text: combinedText
    });
};

const getAiEditorSystemPrompt = async () => {
    return await fetchPrompt('ai_editor_system');
};

const getAiEditorUserPrompt = async ({ instruction, text }) => {
    return await getRenderedPrompt('ai_editor_user_edit', {
        instruction,
        text
    });
};

const generateSermonSeriesOutlinePrompt = async (tuningNotes = "") => {
    const basePrompt = await fetchPrompt('sermon_series_outline_generator');
    return `${formatTuning(tuningNotes)}\n\n${basePrompt}`;
};

module.exports = {
    fetchPrompt,
    getRenderedPrompt,
    getPersonalizedDevotionalPrompt,
    generateTopicSermonPrompt,
    generateScriptureSermonPrompt,
    generateBibleStudyPrompt,
    getDailyPrayerPrompt,
    getAdviceGuidancePrompt,
    getDailyDevotionalPrompt,
    getCommunityPrayerPrompt,
    getDailyNewsSynopsisPrompt,
    getGeneralDevotionalBatchPrompt,
    getScripturalOutlookPrompt,
    getScripturalOutlookArticleInputPrompt,
    getNewsTaxonomyBreakdownPrompt,
    getSermonStyleAnalysisSystemPrompt,
    getSermonStyleAnalysisPrompt,
    getAiEditorSystemPrompt,
    getAiEditorUserPrompt,
    generateSermonSeriesOutlinePrompt
};