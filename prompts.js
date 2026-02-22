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

const generateSermonSeriesOutlinePrompt = async (tuningNotes = "") => {
    const basePrompt = await fetchPrompt('sermon_series_outline_generator');
    return `${formatTuning(tuningNotes)}\n\n${basePrompt}`;
};

module.exports = {
    generateTopicSermonPrompt,
    generateScriptureSermonPrompt,
    generateBibleStudyPrompt,
    getDailyPrayerPrompt,
    getAdviceGuidancePrompt,
    getDailyDevotionalPrompt,
    getCommunityPrayerPrompt,
    getDailyNewsSynopsisPrompt,
    generateSermonSeriesOutlinePrompt
};