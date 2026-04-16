const supabase = require('../config/supabase');
const openai = require('../config/openai');

const logEvent = async (level, source, userId, action, message, details = {}, duration = null) => {
    try {
        const timestamp = new Date().toISOString();
        // Include duration in console log for immediate visibility
        const durationStr = duration ? ` (${duration}ms)` : '';
        console.log(`[${timestamp}] [${level.toUpperCase()}] [${source}] ${message}${durationStr}`);

        await supabase.from('system_logs').insert({
            level,
            source,
            user_id: userId || null,
            action,
            message,
            details,
            duration_ms: duration ,
            is_local: process.env.NODE_ENV === 'development'
        });
    } catch (err) {
        console.error('FAILED TO LOG TO DB:', err);
    }
};

async function callOpenAIAndProcessResult(systemPrompt, userPrompt, model, maxTokens, responseFormatType = "text") {
    try {

        console.log("Calling OpenAI with prompt:", systemPrompt, userPrompt);
        const chatCompletion = await openai.chat.completions.create({
            model: model || 'gpt-5-nano',
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt },
            ],
            response_format: { type: responseFormatType },
        });

        const generatedContent = chatCompletion.choices?.[0]?.message?.content || '';
        const totalTokens = chatCompletion.usage?.total_tokens || null;
        console.log("AI Generated Content:", generatedContent);

        if (responseFormatType === "json_object") {
            try {
                const parsed = JSON.parse(generatedContent);
                if (parsed && typeof parsed === 'object' && totalTokens !== null) {
                    parsed.tokens = totalTokens;
                }
                return parsed;
            } catch (jsonError) {
                console.warn("Failed to parse AI response as JSON. Returning raw text.", jsonError);
                return generatedContent; // Return raw text if parsing fails
            }
        }
        return generatedContent; // Return raw text for 'text' format
    } catch (error) {
        console.error("Error during OpenAI API call:", error);
        throw error;
    }
}

async function getTuningNotes(userId) {
    const { data } = await supabase
        .from('user_profiles')
        .select('ai_tuning_notes')
        .eq('user_id', userId)
        .single();
    return data?.ai_tuning_notes || "";
}

module.exports = {
    logEvent,
    callOpenAIAndProcessResult,
    getTuningNotes
};
