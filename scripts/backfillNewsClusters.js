require('dotenv').config();

const supabase = require('../config/supabase');
const { reconcileOutlookCluster } = require('../utils/newsClusters');

const LIMIT = Math.min(500, Math.max(1, Number(process.env.NEWS_CLUSTER_BACKFILL_LIMIT || 100)));

async function fetchRows() {
  const columns = 'id,article_title,article_url,article_body,article_thumbnail_url,publish_date,ai_outlook,story_cluster_id,superseded_by_outlook_id';
  const [{ data: vaccine, error: vaccineError }, { data: recent, error: recentError }] = await Promise.all([
    supabase.from('scriptural_outlooks').select(columns).ilike('article_title', '%vaccin%').is('story_cluster_id', null).order('publish_date', { ascending: false }).limit(50),
    supabase.from('scriptural_outlooks').select(columns).is('story_cluster_id', null).order('publish_date', { ascending: false, nullsFirst: false }).limit(LIMIT),
  ]);
  if (vaccineError || recentError) throw vaccineError || recentError;
  const seen = new Set();
  return [...(vaccine || []), ...(recent || [])].filter((row) => !seen.has(row.id) && seen.add(row.id)).slice(0, LIMIT);
}

async function backfillNewsClusters() {
  const rows = await fetchRows();
  console.log(`Backfilling ${rows.length} outlooks into story clusters, vaccine coverage first.`);
  let clustered = 0;
  let superseded = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      const article = { title: row.article_title, url: row.article_url, body: row.article_body, thumbnail_url: row.article_thumbnail_url, publish_date: row.publish_date, publisher: row.ai_outlook?.sources?.[0]?.publisher || row.ai_outlook?.sources?.[0]?.title || new URL(row.article_url).hostname.replace(/^www\./, '') };
      const result = await reconcileOutlookCluster(row.id, article, row.ai_outlook || {});
      clustered++;
      if (result.superseded) superseded++;
      console.log(`[${clustered}/${rows.length}] ${result.superseded ? 'attached' : 'created'}: ${row.article_title}`);
    } catch (error) {
      failed++;
      console.error(`Failed to cluster ${row.id} ${row.article_title}: ${error.message}`);
    }
  }
  console.log(JSON.stringify({ examined: rows.length, clustered, superseded, failed }));
}

if (require.main === module) backfillNewsClusters().then(() => process.exit(0)).catch((error) => { console.error(error); process.exit(1); });

module.exports = { backfillNewsClusters };
