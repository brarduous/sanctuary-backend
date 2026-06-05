const OpenAI = require('openai');
const supabase = require('../config/supabase');
const { evaluateNewsImpactWithAI } = require('../utils/newsImpact');

require('dotenv').config();

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

const HOURS_TO_BACKFILL = Number(process.env.NEWS_IMPACT_BACKFILL_HOURS || 24);
const BATCH_LIMIT = Number(process.env.NEWS_IMPACT_BACKFILL_LIMIT || 250);

async function fetchRecentOutlooks() {
    const startDate = new Date(Date.now() - HOURS_TO_BACKFILL * 60 * 60 * 1000).toISOString();

    const { data, error } = await supabase
        .from('scriptural_outlooks')
        .select('id, article_title, article_url, article_body, article_thumbnail_url, created_at, publish_date, ai_outlook, news_impact_score')
        .gte('created_at', startDate)
        .order('created_at', { ascending: false })
        .limit(BATCH_LIMIT);

    if (error) {
        throw error;
    }

    return data || [];
}

async function backfillNewsImpactScores() {
    console.log(`Backfilling AI news impact scores for the last ${HOURS_TO_BACKFILL} hours...`);
    const outlooks = await fetchRecentOutlooks();
    console.log(`Found ${outlooks.length} recent outlooks.`);

    let updated = 0;
    let failed = 0;

    for (const outlook of outlooks) {
        try {
            const impact = await evaluateNewsImpactWithAI(openai, outlook);
            const { error } = await supabase
                .from('scriptural_outlooks')
                .update({
                    news_impact_score: impact.newsImpactScore,
                    news_impact_summary: impact.newsImpactSummary
                })
                .eq('id', outlook.id);

            if (error) {
                failed++;
                console.error(`Failed to update outlook ${outlook.id}:`, error);
                continue;
            }

            updated++;
            console.log(`[${updated}/${outlooks.length}] ${impact.newsImpactScore} - ${outlook.article_title}`);
        } catch (error) {
            failed++;
            console.error(`Failed to score outlook ${outlook.id}:`, error);
        }
    }

    console.log(`Backfill complete. Updated: ${updated}. Failed: ${failed}.`);
}

if (require.main === module) {
    backfillNewsImpactScores()
        .then(() => process.exit(0))
        .catch((error) => {
            console.error('Backfill failed:', error);
            process.exit(1);
        });
}

module.exports = {
    backfillNewsImpactScores
};
