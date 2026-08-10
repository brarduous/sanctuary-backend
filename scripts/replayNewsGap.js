require('dotenv').config();

const axios = require('axios');
const cheerio = require('cheerio');
const supabase = require('../config/supabase');
const { generateAndSaveScripturalOutlook } = require('../cron/generateScripturalOutlook');
const { wordCount } = require('../utils/newsEvidence');

const since = process.env.NEWS_REPLAY_SINCE || '2026-07-27T00:00:00.000Z';
const before = process.env.NEWS_REPLAY_BEFORE || '2026-08-10T00:00:00.000Z';
const batchSize = Math.min(24, Math.max(1, Number.parseInt(process.env.NEWS_REPLAY_LIMIT, 10) || 12));
const minWords = 60;
const maxWords = 180;

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function boundedPreview($) {
  const candidates = [
    $('meta[property="og:description"]').attr('content'),
    $('meta[name="description"]').attr('content'),
    $('meta[name="twitter:description"]').attr('content'),
  ].map(clean).filter(Boolean);
  $('script[type="application/ld+json"]').each((_, element) => {
    try {
      const value = JSON.parse($(element).text());
      const records = Array.isArray(value) ? value : [value];
      for (const record of records) {
        const nodes = Array.isArray(record?.['@graph']) ? record['@graph'] : [record];
        for (const node of nodes) if (node?.description) candidates.push(clean(node.description));
      }
    } catch { /* Ignore malformed publisher metadata. */ }
  });
  const unique = [...new Set(candidates)];
  let preview = unique.sort((left, right) => wordCount(right) - wordCount(left))[0] || '';
  if (wordCount(preview) < minWords) {
    const paragraphs = $('article p, main p').map((_, element) => clean($(element).text())).get().filter((text) => wordCount(text) >= 20);
    preview = [preview, ...paragraphs.slice(0, 3)].filter(Boolean).join(' ');
  }
  return preview.split(/\s+/).slice(0, maxWords).join(' ');
}

async function restoreCandidate(row) {
  if (/federalregister\.gov/i.test(row.canonical_url) || /Federal Register/i.test(row.publisher || '')) return null;
  try {
    const response = await axios.get(row.canonical_url, {
      timeout: 20000,
      maxRedirects: 5,
      headers: { 'User-Agent': 'SanctuaryNewsBot/1.0 (+https://www.sanctuarynews.org)' },
    });
    const $ = cheerio.load(response.data);
    const body = boundedPreview($);
    if (wordCount(body) < minWords) {
      console.warn(`Replay skipped thin preview (${wordCount(body)} words): ${row.title}`);
      return null;
    }
    const image = $('meta[property="og:image"]').attr('content') || $('meta[name="twitter:image"]').attr('content') || row.thumbnail_url;
    return {
      title: row.title,
      url: response.request?.res?.responseUrl || row.canonical_url,
      thumbnail_url: image ? new URL(image, row.canonical_url).toString() : null,
      body,
      description: body,
      publish_date: row.published_at,
      publisher: row.publisher,
      accessMode: 'publisher_page_preview',
      publisherExcerpt: true,
      analysisEligible: true,
      fullTextAuthorized: false,
      sourceType: 'reporting',
      isIndependent: true,
      discoveryProvider: 'historical_replay',
      discoveryRank: null,
      corroboratingSources: [],
    };
  } catch (error) {
    console.warn(`Replay could not fetch ${row.canonical_url}: ${error.message}`);
    return null;
  }
}

async function replay() {
  const { data: candidates, error } = await supabase
    .from('news_discovery_candidates')
    .select('id,canonical_url,title,publisher,published_at,thumbnail_url')
    .gte('published_at', since)
    .lt('published_at', before)
    .neq('evidence_status', 'generated')
    .order('published_at', { ascending: false })
    .limit(batchSize * 4);
  if (error) throw error;
  const restored = [];
  for (const candidate of candidates || []) {
    const { data: existing } = await supabase.from('scriptural_outlooks').select('id').eq('article_url', candidate.canonical_url).maybeSingle();
    if (existing) continue;
    const article = await restoreCandidate(candidate);
    if (article) restored.push(article);
    if (restored.length >= batchSize) break;
  }
  if (!restored.length) return console.log(JSON.stringify({ candidates: candidates?.length || 0, restored: 0 }));
  console.log(JSON.stringify({ candidates: candidates?.length || 0, restored: restored.length, since, before }));
  await generateAndSaveScripturalOutlook({ articles: restored });
}

replay().catch((error) => { console.error(error); process.exit(1); });
