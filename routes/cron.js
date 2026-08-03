const express = require('express');
const { ensureDevotionalRunway, generateWeeklyBatch, getCurriculumStatus } = require('../cron/generateGeneralDevotionals');
const supabase = require('../config/supabase');
const { sendPushToAll, sendPushToUsers } = require('../utils/push');

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
    const result = force
      ? await generateWeeklyBatch({ force: true })
      : await ensureDevotionalRunway();
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('[Cron] General devotional generation failed:', error);
    res.status(500).json({ error: error.message || 'Failed to generate general devotionals' });
  }
};

router.get('/general-devotionals', handleGeneralDevotionalsCron);
router.post('/general-devotionals', handleGeneralDevotionalsCron);

router.get('/general-devotionals/status', async (req, res) => {
  if (!hasValidCronSecret(req)) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const status = await getCurriculumStatus();
    res.status(status.healthy ? 200 : 503).json({ success: status.healthy, ...status });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to inspect general devotional runway' });
  }
});

router.get('/notifications/daily-devotional', async (req, res) => {
  if (!hasValidCronSecret(req)) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const today = new Date().toISOString().slice(0, 10);
    const { data: devotional, error } = await supabase
      .from('general_devotionals')
      .select('title, scripture_reference')
      .eq('date', today)
      .maybeSingle();
    if (error) throw error;
    if (!devotional) {
      return res.status(503).json({
        error: 'Today\'s general devotional has not been generated; no notification was sent.',
        date: today,
      });
    }
    const generalBody = devotional?.title && devotional?.scripture_reference
      ? `${devotional.title} — ${devotional.scripture_reference}. Read it, then share today's verse with a friend.`
      : devotional?.title
        ? `Today's reflection: ${devotional.title}. Read it, then share the devotional with a friend.`
        : 'Your daily devotional is ready.';
    const dayStart = `${today}T00:00:00.000Z`;
    const [{ data: personalized, error: personalizedError }, { data: authProfiles }, { data: userProfiles }] = await Promise.all([
      supabase.from('daily_devotionals').select('devotional_id, user_id, title, scripture, created_at').gte('created_at', dayStart).eq('status', 'completed').order('created_at', { ascending: false }),
      supabase.from('profiles').select('id'),
      supabase.from('user_profiles').select('user_id'),
    ]);
    if (personalizedError) throw personalizedError;

    const latestByUser = new Map();
    for (const item of personalized || []) {
      if (item.user_id && !latestByUser.has(item.user_id)) latestByUser.set(item.user_id, item);
    }
    let sent = 0;
    for (const [userId, item] of latestByUser) {
      const body = item.title && item.scripture
        ? `${item.title} — ${item.scripture}. Read it, then share today's verse with a friend.`
        : item.title ? `Today's reflection: ${item.title}. Read it, then share the devotional with a friend.` : generalBody;
      const result = await sendPushToUsers({ userIds: [userId], title: 'Today’s devotional is ready', body, data: { url: `/devotional/${item.devotional_id}` }, preference: 'devotionals', requireExplicitPreference: true });
      sent += result.sent;
    }

    const allUserIds = new Set([
      ...(authProfiles || []).map(profile => profile.id),
      ...(userProfiles || []).map(profile => profile.user_id),
    ].filter(Boolean));
    const generalUserIds = [...allUserIds].filter(userId => !latestByUser.has(userId));
    if (generalUserIds.length) {
      const result = await sendPushToUsers({ userIds: generalUserIds, title: 'Today’s devotional is ready', body: generalBody, data: { url: '/(tabs)' }, preference: 'devotionals', requireExplicitPreference: true });
      sent += result.sent;
    }
    res.json({ success: true, sent, personalized: latestByUser.size });
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
