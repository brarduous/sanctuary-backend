require('dotenv').config();

const supabase = require('../config/supabase');
const { getScripturalOutlookPrompt, getScripturalOutlookArticleInputPrompt } = require('../prompts');
const { attachCorroboratingSources, callOpenAIAndProcessResult, persistNewsVerification } = require('../cron/generateScripturalOutlook');
const { logEvent } = require('../utils/helpers');

const EDITORIAL_FIELDS = [
  'newsSummary', 'sourceAndFramingAnalysis', 'biblicalReflection', 'citedPassages',
  'faithfulResponse', 'congregationalImplications', 'ministryActions',
  'sermonDiscussionPrompts', 'reflectionQuestions', 'closingPrayer', 'sources',
  'additionalSourcesNeeded',
];

function publisherFor(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    if (host.includes('npr.org')) return 'NPR';
    if (host.includes('cbsnews.com')) return 'CBS News';
    if (host.includes('foxnews.com')) return 'Fox News';
    return host;
  } catch {
    return 'Original publisher';
  }
}

async function run() {
  if (process.env.NODE_ENV !== 'production' || process.env.NEWS_BACKFILL_APPROVED !== 'recent-24h') {
    throw new Error('Set NODE_ENV=production and NEWS_BACKFILL_APPROVED=recent-24h for the bounded production backfill.');
  }
  const hours = Math.min(24, Math.max(1, Number.parseInt(process.env.NEWS_BACKFILL_HOURS, 10) || 24));
  const limit = Math.min(200, Math.max(1, Number.parseInt(process.env.NEWS_BACKFILL_LIMIT, 10) || 100));
  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  const { data: rows, error } = await supabase.from('scriptural_outlooks').select('id,article_title,article_url,article_body,article_thumbnail_url,publish_date,created_at,ai_outlook').gte('created_at', since).order('created_at', { ascending: true }).limit(limit);
  if (error) throw error;
  const ids = (rows || []).map((row) => row.id);
  const { data: scores, error: scoreError } = ids.length ? await supabase.from('news_score_versions').select('outlook_id').in('outlook_id', ids) : { data: [], error: null };
  if (scoreError) throw scoreError;
  const scoredIds = new Set((scores || []).map((score) => score.outlook_id));
  const candidates = (rows || []).filter((row) => !scoredIds.has(row.id)).map((row) => ({
    id: row.id,
    title: row.article_title,
    url: row.article_url,
    body: row.article_body,
    thumbnail_url: row.article_thumbnail_url,
    publish_date: row.publish_date,
    publisher: publisherFor(row.article_url),
    ai_outlook: row.ai_outlook || {},
  }));
  const clustered = attachCorroboratingSources(candidates);
  const systemPrompt = await getScripturalOutlookPrompt();
  let completed = 0;
  let failed = 0;
  console.log(`Backfilling ${clustered.length} of ${rows?.length || 0} articles created since ${since}.`);
  for (const article of clustered) {
    try {
      const promptInput = await getScripturalOutlookArticleInputPrompt(article, { categories: [], topics: [] });
      const generated = await callOpenAIAndProcessResult(systemPrompt, promptInput, 'gpt-5-mini', 10000, 'json_object');
      if (!generated || typeof generated !== 'object') throw new Error('Model did not return structured JSON.');
      const verification = await persistNewsVerification(article.id, article, generated.originalArticleAssessment || {});
      if (verification.confidenceScore < 90) {
        await logEvent('warn', 'news', null, 'news_low_confidence_review_required', 'News article requires editorial review', { outlookId: article.id, confidenceScore: verification.confidenceScore, threshold: 90 });
      }
      const editorialUpdates = Object.fromEntries(EDITORIAL_FIELDS.filter((field) => generated[field] !== undefined).map((field) => [field, generated[field]]));
      const aiOutlook = {
        ...article.ai_outlook,
        ...editorialUpdates,
        contentSchemaVersion: 2,
        originalArticleAssessment: {
          truthfulnessScore: verification.truthfulnessScore,
          truthfulnessBand: verification.truthfulnessBand,
          assessmentSummary: verification.assessmentSummary,
          assessedAt: new Date().toISOString(),
          assessmentVersion: 1,
        },
      };
      const { error: updateError } = await supabase.from('scriptural_outlooks').update({ ai_outlook: aiOutlook }).eq('id', article.id);
      if (updateError) throw updateError;
      completed += 1;
      console.log(`Backfilled ${article.id}: ${article.title} (${verification.truthfulnessScore}, confidence ${verification.confidenceScore})`);
    } catch (backfillError) {
      failed += 1;
      console.error(`Backfill failed for ${article.id}: ${article.title}`, backfillError);
    }
  }
  console.log(JSON.stringify({ scanned: rows?.length || 0, candidates: clustered.length, completed, failed, since }));
  if (failed) process.exitCode = 1;
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
