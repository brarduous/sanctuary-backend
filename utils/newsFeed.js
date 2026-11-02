// Match taxonomies against chronological published candidates, never a truncated
// lifetime relationship list. Each IN query stays below the PostgREST URL limit.
const BATCH_SIZE = 200;
const MAX_SCAN = 30000;
const articleTime = row => new Date(row.publish_date || row.created_at).getTime();
const publicArticle = row => !['rejected', 'archived'].includes(row.ai_outlook?.editorialReview?.status);
function applyNewsDates(query, { startDate, endDate, now = new Date().toISOString() } = {}) {
  query = query.or(`publish_date.lte.${now},and(publish_date.is.null,created_at.lte.${now})`);
  if (startDate) query = query.or(`publish_date.gte.${startDate},and(publish_date.is.null,created_at.gte.${startDate})`);
  if (endDate) query = query.or(`publish_date.lte.${endDate},and(publish_date.is.null,created_at.lte.${endDate})`);
  return query;
}
async function matchTaxonomyBatch(db, rows, { topicId, categoryId, categoryIds = [] }) {
  const ids = rows.map(row => row.id);
  const tasks = [];
  if (topicId) tasks.push(db.from('outlook_topics').select('outlook_id').eq('topic_id', topicId).in('outlook_id', ids));
  const categories = categoryId ? [categoryId] : categoryIds;
  if (categories.length) tasks.push(db.from('outlook_categories').select('outlook_id').in('category_id', categories).in('outlook_id', ids));
  const results = await Promise.all(tasks);
  for (const result of results) if (result.error) throw result.error;
  const sets = results.map(result => new Set((result.data || []).map(row => row.outlook_id)));
  return rows.filter(row => sets.every(set => set.has(row.id)));
}
async function filteredNewsPage(db, { columns, topicId, categoryId, categoryIds = [], offset = 0, limit = 12, startDate, endDate, sort = 'latest', now = new Date().toISOString() }) {
  const ranked = ['weighted', 'balanced', 'impact', 'featured'].includes(sort);
  // Ranking always compares current reporting. An explicit window can narrow it.
  const since = startDate || (ranked ? new Date(new Date(now).getTime() - 7 * 86400000).toISOString() : null);
  const matches = [];
  for (let from = 0; from < MAX_SCAN; from += BATCH_SIZE) {
    let query = db.from('scriptural_outlooks').select(columns).eq('publication_status', 'published').is('superseded_by_outlook_id', null);
    query = applyNewsDates(query, { startDate: since, endDate, now });
    const { data, error } = await query.order('publish_date', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false }).order('id', { ascending: false }).range(from, from + BATCH_SIZE - 1);
    if (error) throw error;
    const rows = data || [];
    if (rows.length) matches.push(...(await matchTaxonomyBatch(db, rows, { topicId, categoryId, categoryIds })).filter(publicArticle));
    if ((!ranked && matches.length >= offset + limit) || rows.length < BATCH_SIZE) {
      if (ranked) matches.sort((a, b) => {
        const score = row => {
          const impact = Number(row.news_impact_score) || 0;
          if (['impact', 'featured'].includes(sort)) return impact;
          // Decay impact as well as recency; yesterday's major story cannot
          // permanently outrank all newer reporting once recency reaches zero.
          const age = Math.max(0, (new Date(now).getTime() - articleTime(row)) / 3600000);
          return (impact * .7 + 30) * Math.pow(.5, age / 24);
        };
        return score(b) - score(a) || articleTime(b) - articleTime(a) || Number(b.id) - Number(a.id);
      });
      return matches.slice(offset, offset + limit);
    }
  }
  throw new Error('News archive scan exceeded its request budget; narrow the date range.');
}
async function taxonomyActivity(db, relationTable, idColumn, now = new Date()) {
  const since = new Date(now.getTime() - 7 * 86400000).toISOString();
  const map = {};
  for (let from = 0; from < MAX_SCAN; from += BATCH_SIZE) {
    const { data, error } = await applyNewsDates(db.from('scriptural_outlooks').select('id,news_impact_score,ai_outlook').eq('publication_status', 'published').is('superseded_by_outlook_id', null), { startDate: since, now: now.toISOString() }).order('id').range(from, from + BATCH_SIZE - 1);
    if (error) throw error;
    const rows = (data || []).filter(publicArticle);
    if (rows.length) {
      const byId = new Map(rows.map(row => [row.id, row]));
      // A story may have many tags, so page the relationships too.
      for (let relationFrom = 0; ; relationFrom += 1000) {
        const result = await db.from(relationTable).select(`outlook_id,${idColumn}`).in('outlook_id', rows.map(row => row.id)).order('outlook_id').order(idColumn).range(relationFrom, relationFrom + 999);
        if (result.error) throw result.error;
        for (const relation of result.data || []) {
          const id = relation[idColumn];
          map[id] ||= { recentArticleCount: 0, impactScoreWeek: 0 };
          map[id].recentArticleCount++;
          map[id].impactScoreWeek += Number(byId.get(relation.outlook_id)?.news_impact_score) || 0;
        }
        if ((result.data || []).length < 1000) break;
      }
    }
    if ((data || []).length < BATCH_SIZE) return map;
  }
  throw new Error('News activity exceeds request budget.');
}
async function allTaxonomies(db, table) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from(table).select('*').order('id').range(from, from + 999);
    if (error) throw error;
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
}
async function activeTopics(db, activity) {
  const ids = Object.keys(activity);
  if (!ids.length) {
    const {data, error} = await db.from('topics').select('id,slug,name,description').order('id', {ascending: false}).limit(100);
    if (error) throw error;
    return data || [];
  }
  const rows = [];
  for (let from = 0; from < ids.length; from += 200) {
    const {data, error} = await db.from('topics').select('id,slug,name,description').in('id', ids.slice(from, from + 200));
    if (error) throw error;
    rows.push(...(data || []));
  }
  return rows;
}
module.exports = { filteredNewsPage, applyNewsDates, taxonomyActivity, allTaxonomies, activeTopics };
