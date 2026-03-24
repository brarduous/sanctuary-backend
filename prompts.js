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
const getPersonalizedDevotionalPrompt = async (userData, generalDevoData, tuningNotes = "") => {
    const basePrompt = await fetchPrompt('daily_devotional_generator'); // Your base JSON instructions
    
    return `
${formatTuning(tuningNotes)}
${basePrompt}

=== TODAY'S CHURCH CURRICULUM ===
You MUST anchor your devotional on this exact message today. 
- Title: ${generalDevoData.title}
- Scripture: ${generalDevoData.scripture_reference}
- Scripture Text: ${generalDevoData.scripture_text || 'Use the reference above.'}
- Core Message: ${generalDevoData.content}

=== USER PROFILE ===
Adapt the application of today's core message for this specific person:
- Name: ${userData.first_name || 'The User'}
- Focus Areas: ${userData.focusAreas?.join(', ') || 'General spiritual growth'}
- Improvement Areas: ${userData.improvementAreas?.join(', ') || 'None specified'}
- Pastoral/Background Notes: ${userData.pastoral_notes || 'None available.'}

=== INSTRUCTIONS ===
1. Keep the EXACT same Title and Scripture Reference as the Church Curriculum.
2. Rewrite the "Core Message" to speak directly to the user (use their name, "you", etc.).
3. Weave their "Focus Areas", "Improvement Areas", and "Background Notes" into the application of the scripture. 
4. Provide a personalized prayer based on their struggles/focus areas and today's scripture.
5. Provide a relevant song search query for YouTube.
OUTPUT MUST BE A VALID JSON OBJECT matching the keys: title, scripture, content, daily_prayer, song_search_query.
`;
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

const generateSermonSeriesOutlinePrompt = async (tuningNotes = "") => {
    const basePrompt = await fetchPrompt('sermon_series_outline_generator');
    return `${formatTuning(tuningNotes)}\n\n${basePrompt}`;
};

module.exports = {
    getPersonalizedDevotionalPrompt,
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