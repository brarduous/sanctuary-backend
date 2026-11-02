// Read-only production QC. No service-role credentials are required.
const fs = require('node:fs');
const API = process.env.NEWS_AUDIT_API || 'https://sanctuary-backend-qts0.onrender.com';
async function auditNewsFreshness({api = API, now = new Date(), output} = {}) {
 const since = new Date(now.getTime() - 14 * 86400000).toISOString();
 const request = async path => { const response = await fetch(`${api}/${path}`, {signal: AbortSignal.timeout(30000)}); if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`); return response.json(); };
 const [categories, topics, brief] = await Promise.all(['categories', 'topics', 'daily-news-synopses?limit=1'].map(request));
 const articles = [];
 for (let page = 1; page <= 100; page++) {
  const rows = await request(`scriptural-outlooks?limit=100&page=${page}&sort=latest&startDate=${since}&endDate=${now.toISOString()}`);
  articles.push(...rows); if (rows.length < 100) break;
  if (page === 100) throw new Error('Audit candidate limit reached.');
 }
 const checks = [], violations = [];
 const targets = [...categories.map(row => ({...row, type: 'category'})), ...topics.map(row => ({...row, type: 'topic'}))];
 let cursor = 0;
 async function worker() {
  while (cursor < targets.length) {
   const target = targets[cursor++], started = Date.now();
   try {
    const rows = await request(`scriptural-outlooks?limit=12&sort=latest&${target.type}=${encodeURIComponent(target.slug || target.id)}&startDate=${since}&endDate=${now.toISOString()}`);
    const expected = articles.filter(article => (target.type === 'category' ? article.categories : article.topics)?.some(item => String(item.id) === String(target.id))).slice(0, 12).map(row => row.id);
    const actual = rows.map(row => row.id);
    if (JSON.stringify(actual) !== JSON.stringify(expected)) violations.push({type: target.type, id: target.id, slug: target.slug, issue: 'Taxonomy results differ from current canonical coverage', expected, actual});
    checks.push({type: target.type, slug: target.slug, count: rows.length, ms: Date.now() - started});
   } catch (error) { violations.push({type: target.type, slug: target.slug, issue: error.message}); }
  }
 }
 await Promise.all(Array.from({length: 4}, worker));
 const age = article => now.getTime() - Date.parse(article.publish_date || article.created_at);
 const report = {asOf: now.toISOString(), windowDays: 14, recentArticles: articles.length, categories: categories.length, activeTopics: topics.length, taxonomyChecks: checks.length, violations, invalidOrOutOfWindow: articles.filter(row => !Number.isFinite(age(row)) || age(row) < 0 || age(row) > 14 * 86400000).map(row => row.id), readerCopy: {v3: articles.filter(row => row.ai_outlook?.readerCopyVersion === 'news-reader-copy-v3').length, legacy: articles.filter(row => row.ai_outlook?.readerCopyVersion !== 'news-reader-copy-v3').length, responseVerdicts: articles.filter(row => row.ai_outlook?.tldr?.christianAssessment?.focusType === 'recommended_response').map(row => row.id)}, briefAgeHours: brief[0] ? (now.getTime() - Date.parse(brief[0].created_at)) / 3600000 : null, maxTaxonomyMs: Math.max(0, ...checks.map(row => row.ms))};
 if (output) fs.writeFileSync(output, JSON.stringify(report, null, 2));
 return report;
}
module.exports = {auditNewsFreshness};
if (require.main === module) auditNewsFreshness({output: process.env.NEWS_AUDIT_OUTPUT}).then(report => {console.log(JSON.stringify(report, null, 2)); if (report.violations.length || report.invalidOrOutOfWindow.length) process.exitCode = 1;}).catch(error => {console.error(error.message); process.exitCode = 1;});
