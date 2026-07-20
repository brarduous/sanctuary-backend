const express = require('express');
const { generateWeeklyBatch } = require('../cron/generateGeneralDevotionals');
const supabase = require('../config/supabase');
const { sendPushToAll } = require('../utils/push');

const router = express.Router();

const hasValidCronSecret = (req) => {
  const configuredSecret = process.env.CRON_SECRET || process.env.GENERAL_DEVOTIONAL_CRON_SECRET;
  if (!configuredSecret) return false;

  const authHeader = req.headers.authorization || '';
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const headerSecret = req.headers['x-cron-secret'];

  return bearerToken === configuredSecret || headerSecret === configuredSecret;
};

const handleGeneralDevotionalsCron = async (req, res) => {
  if (!hasValidCronSecret(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const force = req.body?.force === true;
    const result = await generateWeeklyBatch({ force });
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('[Cron] General devotional generation failed:', error);
    res.status(500).json({ error: error.message || 'Failed to generate general devotionals' });
  }
};

router.get('/general-devotionals', handleGeneralDevotionalsCron);
router.post('/general-devotionals', handleGeneralDevotionalsCron);

router.get('/notifications/daily-devotional', async (req, res) => {
  if (!hasValidCronSecret(req)) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const today = new Date().toISOString().slice(0, 10);
    const { data: devotional, error } = await supabase
      .from('general_devotionals')
      .select('title, scripture_reference')
      .lte('date', today)
      .order('date', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    const body = devotional?.title && devotional?.scripture_reference
      ? `${devotional.title} — reflecting on ${devotional.scripture_reference}.`
      : devotional?.title
        ? `Today's reflection: ${devotional.title}.`
        : 'Your daily devotional is ready.';
    const result = await sendPushToAll('Today’s devotional is ready', body, { url: '/(tabs)' }, 'devotionals');
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/notifications/advice', async (req, res) => {
  if (!hasValidCronSecret(req)) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const result = await sendPushToAll(
      'Need a little wisdom?',
      'What decision or relationship could use a prayerful, scriptural perspective?',
      { url: '/(tabs)/advice' },
      'advice'
    );
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/notifications/news', async (req, res) => {
  if (!hasValidCronSecret(req)) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const threshold = Number(process.env.NEWS_PUSH_IMPACT_THRESHOLD || 85);
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: article, error } = await supabase
      .from('scriptural_outlooks')
      .select('id, slug, article_title, news_impact_score')
      .gte('news_impact_score', threshold)
      .gte('created_at', since)
      .is('push_alerted_at', null)
      .order('news_impact_score', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (!article) return res.json({ success: true, sent: 0, reason: 'no_unalerted_high_impact_article' });

    const result = await sendPushToAll(
      'News worth a thoughtful pause',
      `${article.article_title} — look beyond the headline with a scriptural perspective.`,
      { url: `/news/${article.slug || article.id}`, articleId: article.id },
      'news'
    );
    if (result.sent > 0) {
      await supabase.from('scriptural_outlooks').update({ push_alerted_at: new Date().toISOString() }).eq('id', article.id);
    }
    res.json({ success: true, articleId: article.id, impactScore: article.news_impact_score, ...result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
