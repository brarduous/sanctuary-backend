require('dotenv').config();
const supabase = require('../config/supabase');
const { escapeHtml, sendEmailWithRetry, siteUrl } = require('../services/newsletter');

async function main() {
  const easternHour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false }).format(new Date()));
  if (process.env.FORCE_CRON !== '1' && ![7, 16].includes(easternHour)) return console.log('Outside the 7 a.m./4 p.m. Eastern audit windows.');
  if (!process.env.EDITORIAL_ALERT_EMAIL) throw new Error('EDITORIAL_ALERT_EMAIL is not configured');
  const { data: alerts, error } = await supabase.from('editorial_alerts').select('id,outlook_id,reasons,scriptural_outlooks(slug,article_title)').eq('status', 'open').is('notified_at', null).order('first_detected_at').limit(100);
  if (error) throw error;
  if (!alerts?.length) return console.log('No editorial alerts require attention.');
  const enriched = await Promise.all(alerts.map(async (alert) => {
    const [{ data: score }, { data: claims }, { data: sources }] = await Promise.all([
      supabase.from('news_score_versions').select('confidence_score').eq('outlook_id', alert.outlook_id).order('version', { ascending: false }).limit(1).maybeSingle(),
      supabase.from('news_claims').select('claim_text,status').eq('outlook_id', alert.outlook_id).neq('status', 'supported').limit(3),
      supabase.from('news_article_sources').select('publisher,url').eq('outlook_id', alert.outlook_id).limit(10),
    ]);
    return { ...alert, confidence: score?.confidence_score, claims: claims || [], sources: sources || [] };
  }));
  const items = enriched.map((alert) => `<li><p><strong><a href="${siteUrl}/editorial/articles/${alert.outlook_id}">${escapeHtml(alert.scriptural_outlooks?.article_title || `Article ${alert.outlook_id}`)}</a></strong></p><p>Reason: ${escapeHtml((alert.reasons || []).join(', '))}</p><p>Confidence: ${escapeHtml(alert.confidence ?? 'not scored')}%</p><p>Disputed or unresolved claims: ${alert.claims.length ? alert.claims.map((claim) => `${escapeHtml(claim.claim_text)} (${escapeHtml(claim.status)})`).join('; ') : 'See the review page.'}</p><p>Sources: ${alert.sources.length ? alert.sources.map((source) => `<a href="${escapeHtml(source.url)}">${escapeHtml(source.publisher)}</a>`).join(', ') : 'Fewer than two sources.'}</p><p>Recommended action: verify the disputed claim against the listed sources, add independent corroboration where needed, then approve, revise, or reject the story.</p></li>`).join('');
  await sendEmailWithRetry({ to: process.env.EDITORIAL_ALERT_EMAIL, subject: `${alerts.length} Sanctuary News item${alerts.length === 1 ? '' : 's'} need editorial review`, html: `<h1>Editorial review required</h1><p>These stories remain out of public feeds until reviewed:</p><ul>${items}</ul>` }, `editorial-audit-${new Date().toISOString().slice(0, 13)}-${alerts.length}`);
  await supabase.from('editorial_alerts').update({ notified_at: new Date().toISOString(), last_detected_at: new Date().toISOString() }).in('id', alerts.map((alert) => alert.id));
}

if (require.main === module) main().catch((error) => { console.error(error); process.exit(1); });
module.exports = { main };
