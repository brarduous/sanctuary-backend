require('dotenv').config();

const supabase = require('../config/supabase');
const { createAndStoreNewsImage } = require('../cron/generateScripturalOutlook');

async function run() {
    if (process.env.NODE_ENV !== 'production' || process.env.NEWS_IMAGE_BACKFILL_APPROVED !== 'recent-missing') {
        throw new Error('Set NODE_ENV=production and NEWS_IMAGE_BACKFILL_APPROVED=recent-missing.');
    }
    const hours = Math.min(168, Math.max(1, Number.parseInt(process.env.NEWS_IMAGE_BACKFILL_HOURS, 10) || 72));
    const limit = Math.min(100, Math.max(1, Number.parseInt(process.env.NEWS_IMAGE_BACKFILL_LIMIT, 10) || 24));
    const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabase
        .from('scriptural_outlooks')
        .select('id,article_title,article_url,article_thumbnail_url,ai_outlook,created_at')
        .gte('created_at', since)
        .is('article_thumbnail_url', null)
        .order('created_at', { ascending: false })
        .limit(limit);
    if (error) throw error;

    let completed = 0;
    let failed = 0;
    for (const row of data || []) {
        try {
            const imageUrl = await createAndStoreNewsImage({
                title: row.article_title,
                url: row.article_url,
                ai_outlook: row.ai_outlook || {},
            }, `${row.id}-${Date.now()}`);
            if (!imageUrl) throw new Error('image generation returned no asset');
            const { error: updateError } = await supabase
                .from('scriptural_outlooks')
                .update({ article_thumbnail_url: imageUrl })
                .eq('id', row.id)
                .is('article_thumbnail_url', null);
            if (updateError) throw updateError;
            completed += 1;
            console.log(`Backfilled image ${completed}/${data.length}: ${row.id} ${row.article_title}`);
        } catch (error) {
            failed += 1;
            console.error(`Image backfill failed for ${row.id}: ${error.message}`);
        }
    }
    console.log(JSON.stringify({ scanned: data?.length || 0, completed, failed, since }));
    if (failed) process.exitCode = 1;
}

run().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
});
