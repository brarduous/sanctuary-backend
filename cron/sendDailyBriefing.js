require('dotenv').config();
const supabase = require('../config/supabase');
const { briefingHtml, createManageToken, sendEmailWithRetry } = require('../services/newsletter');

async function main() {
  const easternHour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false }).format(new Date()));
  if (process.env.FORCE_CRON !== '1' && easternHour !== 7) return console.log('Outside the 7 a.m. Eastern delivery window.');
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
  const [{ data: subscribers, error: subscriberError }, { data: synopsis }, { data: articles, error: articleError }] = await Promise.all([
    supabase.from('newsletter_subscribers').select('id,email,unsubscribe_token_hash').eq('status', 'active').limit(5000),
    supabase.from('daily_news_synopses').select('*').order('created_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('scriptural_outlooks').select('id,slug,article_title,news_impact_summary,ai_outlook').eq('publication_status', 'published').order('news_impact_score', { ascending: false }).limit(3),
  ]);
  if (subscriberError) throw subscriberError;
  if (articleError) throw articleError;
  if (!articles?.length) throw new Error('No eligible stories are available for the Daily Briefing');
  for (const subscriber of subscribers || []) {
    const { data: existing } = await supabase.from('newsletter_deliveries').select('id,status').eq('subscriber_id', subscriber.id).eq('briefing_date', date).maybeSingle();
    if (existing?.status === 'sent') continue;
    const token = createManageToken(subscriber.id);
    try {
      const email = await sendEmailWithRetry({ to: subscriber.email, subject: `The Sanctuary Briefing · ${date}`, html: briefingHtml({ date, synopsis, articles, unsubscribeToken: token }) }, `daily-briefing-${date}-${subscriber.id}`);
      await supabase.from('newsletter_deliveries').upsert({ subscriber_id: subscriber.id, briefing_date: date, resend_email_id: email?.id || null, status: 'sent', sent_at: new Date().toISOString(), updated_at: new Date().toISOString() }, { onConflict: 'subscriber_id,briefing_date' });
    } catch (error) {
      await supabase.from('newsletter_deliveries').upsert({ subscriber_id: subscriber.id, briefing_date: date, status: 'failed', error_message: String(error.message || error).slice(0, 1000), updated_at: new Date().toISOString() }, { onConflict: 'subscriber_id,briefing_date' });
    }
  }
}

if (require.main === module) main().catch((error) => { console.error(error); process.exit(1); });
module.exports = { main };
