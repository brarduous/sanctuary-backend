const axios = require('axios');
const cheerio = require('cheerio');
const supabase = require('../config/supabase');

require('dotenv').config();

const PAGE_SIZE = 200;
const CONCURRENCY = Math.max(1, Number(process.env.CBS_IMAGE_BACKFILL_CONCURRENCY || 12));

function isFullSizeCbsImage(imageUrl) {
    return /\/thumbnail\/(?:1200x630|1200x630g\d*|1280x720|1920x1080)\//i.test(imageUrl || '');
}

async function publisherImageUrl(articleUrl) {
    const response = await axios.get(articleUrl, {
        timeout: 10000,
        maxRedirects: 5,
        headers: { 'User-Agent': 'SanctuaryNewsBot/1.0 (+https://sanctuarynews.org)' },
    });
    const $ = cheerio.load(response.data);
    const imageUrl = $('meta[property="og:image"]').attr('content')
        || $('meta[name="twitter:image"]').attr('content')
        || $('meta[property="twitter:image"]').attr('content');
    return imageUrl ? new URL(imageUrl, response.request?.res?.responseUrl || articleUrl).toString() : null;
}

async function fetchCbsArticles() {
    const articles = [];
    for (let offset = 0; ; offset += PAGE_SIZE) {
        const { data, error } = await supabase
            .from('scriptural_outlooks')
            .select('id,article_title,article_url,article_thumbnail_url')
            .ilike('article_url', '%cbsnews.com%')
            .order('created_at', { ascending: false })
            .range(offset, offset + PAGE_SIZE - 1);
        if (error) throw error;
        articles.push(...(data || []));
        if (!data || data.length < PAGE_SIZE) break;
    }
    return articles;
}

async function backfillCbsNewsImages() {
    const articles = await fetchCbsArticles();
    const candidates = articles.filter((article) => !isFullSizeCbsImage(article.article_thumbnail_url));
    console.log(`Found ${articles.length} CBS News articles; ${candidates.length} need a full-size image.`);
    let updated = 0;
    let unchanged = 0;
    let failed = 0;

    for (let offset = 0; offset < candidates.length; offset += CONCURRENCY) {
        const batch = candidates.slice(offset, offset + CONCURRENCY);
        await Promise.all(batch.map(async (article) => {
            try {
                const imageUrl = await publisherImageUrl(article.article_url);
                if (!imageUrl || imageUrl === article.article_thumbnail_url) {
                    unchanged++;
                    return;
                }
                const { error } = await supabase
                    .from('scriptural_outlooks')
                    .update({ article_thumbnail_url: imageUrl })
                    .eq('id', article.id);
                if (error) throw error;
                updated++;
            } catch (error) {
                failed++;
                console.error(`Failed: ${article.article_title}: ${error.message}`);
            }
        }));
        console.log(`Processed ${Math.min(offset + batch.length, candidates.length)}/${candidates.length}; updated ${updated}, failed ${failed}.`);
    }

    if (!candidates.length) {
        console.log('All CBS News articles already use full-size images.');
    } else {
        unchanged += articles.length - candidates.length;
        if (updated + failed + unchanged < articles.length) {
            unchanged += articles.length - (updated + failed + unchanged);
        }
    }

    console.log(`CBS image backfill complete. Updated: ${updated}. Unchanged: ${unchanged}. Failed: ${failed}.`);
}

if (require.main === module) {
    backfillCbsNewsImages()
        .then(() => process.exit(0))
        .catch((error) => {
            console.error('CBS image backfill failed:', error);
            process.exit(1);
        });
}

module.exports = { backfillCbsNewsImages };
