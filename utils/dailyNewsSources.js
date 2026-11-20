const axios = require('axios');
const xml2js = require('xml2js');
const cheerio = require('cheerio');
const { NEWS_SOURCES } = require('./newsSources');

const MAX_SOURCES = 24;
const MAX_EXCERPT_CHARS = 900;
function clean(value, limit) {
  return cheerio.load(String(value || '')).text().replace(/\s+/g, ' ').trim().slice(0, limit);
}
function selectDailyBriefSources(feeds, now = Date.now()) {
  const selected = [], seen = new Set();
  // Round robin gives each publisher space within the fixed input budget.
  const queues = feeds.map(({ source, items }) => source.analysisEligible && source.publisherExcerpt
    ? items.map(item => {
      let url;
      try { url = new URL(item.link?.[0]); } catch { return null; }
      if (!['https:', 'http:'].includes(url.protocol)) return null;
      url.hash = '';
      for (const key of [...url.searchParams.keys()]) {
        if (key.startsWith('utm_')) url.searchParams.delete(key);
      }
      const published = Date.parse(item.pubDate?.[0]);
      if (!Number.isFinite(published) || published > now || now - published > 86400000) return null;
      const title = clean(item.title?.[0], 180);
      const excerpt = clean(item.description?.[0], MAX_EXCERPT_CHARS);
      if (!title || excerpt.length < 80) return null;
      return { title, excerpt, publisher: source.publisher, url: url.href, published_at: new Date(published).toISOString() };
    }).filter(Boolean).sort((a,b) => b.published_at.localeCompare(a.published_at)) : []);
  while (selected.length < MAX_SOURCES && queues.some(queue => queue.length)) {
    for (const queue of queues) {
      const item = queue.shift();
      if (!item || seen.has(item.url)) continue;
      seen.add(item.url);
      selected.push(item);
      if (selected.length === MAX_SOURCES) break;
    }
  }
  return selected;
}
async function fetchDailyBriefSources() {
  const parser = new xml2js.Parser();
  const results = await Promise.allSettled(NEWS_SOURCES.filter(s => s.analysisEligible && s.publisherExcerpt).map(async source => {
    const response = await axios.get(source.url, {timeout:15000,maxContentLength:2*1024*1024,headers:{'User-Agent':'SanctuaryNewsBot/1.0 (+https://sanctuarynews.com)'}});
    const parsed = await parser.parseStringPromise(response.data);
    return {source,items:parsed?.rss?.channel?.[0]?.item || []};
  }));
  for (const result of results) if (result.status === 'rejected') console.warn('Daily news feed unavailable:', result.reason.message);
  return selectDailyBriefSources(results.filter(r => r.status === 'fulfilled').map(r => r.value));
}
module.exports = { fetchDailyBriefSources, selectDailyBriefSources, MAX_SOURCES, MAX_EXCERPT_CHARS };
