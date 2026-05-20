const supabase = require('../config/supabase');
const openai = require('../config/openai'); // Using your existing config
const { getRenderedPrompt } = require('../prompts');
require('dotenv').config();

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

    return {
        speechRateWpm,
        targetWords,
        minWords: Math.max(60, Math.floor(targetWords * 0.9)),
        maxWords: Math.ceil(targetWords * 1.1),
    };
};

const safeStringify = (value) => {
    if (value === null || value === undefined) return '';
    return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
};

const getProfilesByUserId = async (userIds) => {
    const uniqueUserIds = [...new Set(userIds.filter(Boolean))];
    if (uniqueUserIds.length === 0) return {};

    const { data, error } = await supabase
        .from('user_profiles')
        .select('user_id, sermon_preferences')
        .in('user_id', uniqueUserIds);

    if (error) {
        console.error('[Warn] Could not fetch sermon preferences for evaluation:', error.message);
        return {};
    }

    return (data || []).reduce((acc, profile) => {
        acc[profile.user_id] = profile;
        return acc;
    }, {});
};

const formatStandardSample = (sample, config, index) => {
    const rawContent = sample[config.contentField];
    return `SAMPLE ${index + 1} (ID: ${sample[config.idField]}):\n${safeStringify(rawContent)}`;
};

const formatSermonSample = (sermon, index, profileMap) => {
    const wordCount = countWords(sermon.sermon_body || '');
    const budget = getWordBudget({
        targetDurationMin: sermon.target_duration_min,
        contentFormat: sermon.content_format,
        distributionChannel: sermon.distribution_channel,
    });
    const profile = profileMap[sermon.user_id];

    return `SERMON SAMPLE ${index + 1} (ID: ${sermon.sermon_id})
Title: ${sermon.title || 'Untitled'}
Scripture: ${sermon.scripture || 'Not specified'}
Status: ${sermon.status}
Content Format Selected: ${sermon.content_format || 'not recorded'}
Distribution Channel Selected: ${sermon.distribution_channel || 'not recorded'}
Target Duration Selected: ${sermon.target_duration_min || 'auto'} minutes
Actual Duration Recorded: ${sermon.actual_duration_min || 'not recorded'} minutes
Observed Word Count: ${wordCount}
Expected Word Budget: ${budget ? `${budget.minWords}-${budget.maxWords} words, target ~${budget.targetWords} at ${budget.speechRateWpm} wpm` : 'no explicit budget'}
User Sermon Preferences / Style Properties:
${safeStringify(profile?.sermon_preferences || {})}

Outline:
${safeStringify(sermon.sermon_outline)}

Key Takeaways:
${safeStringify(sermon.key_takeaways)}

Sermon Body:
${sermon.sermon_body || ''}`;
};

const formatSeriesSample = (series, sermons, index, profileMap) => {
    const profile = profileMap[series.user_id];
    const sermonSummaries = sermons.map((sermon, sermonIndex) => {
        const wordCount = countWords(sermon.sermon_body || '');
        return `${sermonIndex + 1}. ${sermon.title || 'Untitled'}
   Scripture: ${sermon.scripture || 'Not specified'}
   Status: ${sermon.status}
   Format: ${sermon.content_format || 'not recorded'} / ${sermon.distribution_channel || 'not recorded'}
   Target/Actual Duration: ${sermon.target_duration_min || 'auto'} / ${sermon.actual_duration_min || 'not recorded'} minutes
   Word Count: ${wordCount}
   Body Preview: ${(sermon.sermon_body || '').slice(0, 900)}`;
    }).join('\n\n');

    return `SERIES SAMPLE ${index + 1} (ID: ${series.series_id})
Series Name: ${series.series_name}
Series Format Selected: ${series.series_format || 'not recorded'}
Description:
${series.description || ''}
User Sermon Preferences / Style Properties:
${safeStringify(profile?.sermon_preferences || {})}
Number of Generated Sermons: ${sermons.length}

Generated Sermons:
${sermonSummaries}`;
};

const EVAL_CONFIG = [
    { 
        table: 'daily_devotionals', 
        promptKey: 'daily_devotional_generator', 
        contentField: 'content',
        idField: 'devotional_id' // Corrected ID
    },
    { 
        table: 'daily_prayers', 
        promptKey: 'daily_prayer_generator', 
        contentField: 'generated_prayer',
        idField: 'prayer_id' 
    },
    { 
        table: 'scriptural_outlooks', 
        promptKey: 'news_generator', 
        contentField: 'ai_outlook',
        idField: 'id' // Corrected ID
    },
    { 
        table: 'advice_guidance', 
        promptKey: 'advice_guidance_generator', 
        contentField: 'advice_points',
        idField: 'advice_id' // Corrected ID
    },
    {
        table: 'sermons',
        promptKey: 'sermon_generator',
        contentField: 'sermon_body',
        idField: 'sermon_id',
        prepareQuery: (query) => query
            .eq('status', 'completed')
            .not('sermon_body', 'is', null)
            .neq('sermon_body', 'Generating content...')
            .neq('sermon_body', 'Generating deep content...'),
        sampleBuilder: async (samples) => {
            const profileMap = await getProfilesByUserId(samples.map(sample => sample.user_id));
            return samples.map((sample, index) => formatSermonSample(sample, index, profileMap)).join('\n\n---\n\n');
        },
        criteria: `
            SERMON-SPECIFIC EVALUATION CRITERIA:
            - Judge whether each sermon honors the selected content_format: sermon, sermonette, podcast_episode, or youtube_video.
            - Judge whether the pacing and rhetorical structure match the selected distribution_channel: pulpit, podcast, youtube, or multi.
            - Compare observed word count and recorded actual_duration_min against selected target_duration_min when present.
            - Evaluate whether the generated sermon reflects the user's sermon_preferences/style properties, including preaching structure and oratorical voice.
            - Evaluate theological depth, biblical fidelity, clarity of outline, usefulness of illustration, and pastoral application.
            - Penalize outputs that ignore selected length, format, channel, or style instructions even if the prose is otherwise strong.
        `
    },
    {
        table: 'sermon_series',
        promptKey: 'sermon_series_outline_generator',
        contentField: 'description',
        idField: 'series_id',
        prepareQuery: (query) => query
            .neq('description', 'Drafting curriculum outline...')
            .neq('description', 'Failed to generate series.'),
        sampleBuilder: async (samples) => {
            const profileMap = await getProfilesByUserId(samples.map(sample => sample.user_id));
            const seriesBlocks = [];

            for (let index = 0; index < samples.length; index++) {
                const series = samples[index];
                const { data: sermons, error } = await supabase
                    .from('sermons')
                    .select('*')
                    .eq('series_id', series.series_id)
                    .order('created_at', { ascending: true });

                if (error) {
                    console.error(`[Warn] Could not fetch sermons for series ${series.series_id}:`, error.message);
                }

                seriesBlocks.push(formatSeriesSample(series, sermons || [], index, profileMap));
            }

            return seriesBlocks.join('\n\n---\n\n');
        },
        criteria: `
            SERMON SERIES-SPECIFIC EVALUATION CRITERIA:
            - Judge whether the outline prompt creates a coherent series arc rather than disconnected sermons.
            - Judge whether series_name and description clearly communicate the theme and pastoral aim.
            - Judge whether sermon titles and scriptures progress naturally across the series.
            - Compare the generated sermons against the selected series_format, especially standard vs short_form expectations.
            - Check whether sermon-level format, channel, target duration, and actual length remain consistent across the series.
            - Evaluate whether user sermon_preferences/style properties appear consistently across the series.
            - Penalize series that look generic, repetitive, too thin for the selected format, or inconsistent with selected style/length.
        `
    }
];

async function evaluate() {
    console.log('🚀 Starting Batch Prompt Evaluation...');

    for (const config of EVAL_CONFIG) {
        console.log(`\n--- Batch Evaluating ${config.table} ---`);

        // 1. Fetch System Prompt
        const { data: promptData, error: promptError } = await supabase
            .from('system_prompts')
            .select('content')
            .eq('key', config.promptKey)
            .single();

        if (promptError || !promptData) {
            console.error(`[Error] Could not find prompt: ${config.promptKey}`, promptError);
            continue;
        }

        // 2. Fetch 5 latest samples using the correct ID fields
        let samplesQuery = supabase
            .from(config.table)
            .select(`*`)
            .order('created_at', { ascending: false })
            .limit(5);

        if (config.prepareQuery) {
            samplesQuery = config.prepareQuery(samplesQuery);
        }

        const { data: samples, error: sampleError } = await samplesQuery;

        if (sampleError || !samples || samples.length === 0) {
            console.error(`[Error] No samples found for ${config.table}`, sampleError);
            continue;
        }

        // Prepare the batch of content for the AI to review
        const batchContent = config.sampleBuilder
            ? await config.sampleBuilder(samples)
            : samples.map((sample, index) => formatStandardSample(sample, config, index)).join('\n\n---\n\n');
        const sampleIds = samples.map(s => s[config.idField]).join(', ');

        // 3. The "Batch Judge" Prompt
        const judgeSystemPrompt = await getRenderedPrompt('prompt_batch_evaluator', {
            source_table: config.table,
            system_prompt: promptData.content,
            generated_batch: batchContent,
            extra_criteria: config.criteria || ''
        });

        try {
            const response = await openai.chat.completions.create({
                model: "gpt-4o",
                messages: [{ role: "system", content: judgeSystemPrompt }],
                response_format: { type: "json_object" }
            });

            const result = JSON.parse(response.choices[0].message.content);

            // 4. Save Batch Evaluation
            const { error: saveError } = await supabase
                .from('prompt_evaluations')
                .insert({
                    prompt_key: config.promptKey,
                    source_table: config.table,
                    source_id: samples[0][config.idField], // Link to the first ID in the batch as reference
                    generated_content: `Batch of 5 IDs: ${sampleIds}`,
                    original_prompt: promptData.content,
                    ...result
                });

            if (saveError) {
                console.error(`[Error] Failed to save evaluation for ${config.table}:`, saveError);
            } else {
                console.log(`✅ Batch Evaluation Saved for ${config.table} (Prompt Grade: ${result.prompt_grade})`);
            }
        } catch (err) {
            console.error(`[Error] AI evaluation failed for ${config.table}:`, err.message);
        }
    }
    console.log('\n✨ All batches processed.');
}

evaluate();
