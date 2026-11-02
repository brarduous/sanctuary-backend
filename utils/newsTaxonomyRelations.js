// Production relation tables do not guarantee an ON CONFLICT target. Preserve
// existing links and insert only the missing taxonomy values during consolidation.
async function copyOutlookTaxonomies(db, sourceId, targetId) {
  for (const [table, column] of [['outlook_categories', 'category_id'], ['outlook_topics', 'topic_id']]) {
    const [source, target] = await Promise.all([
      db.from(table).select(column).eq('outlook_id', sourceId),
      db.from(table).select(column).eq('outlook_id', targetId),
    ]);
    if (source.error) throw source.error;
    if (target.error) throw target.error;
    const existing = new Set((target.data || []).map(row => row[column]));
    const missing = [...new Set((source.data || []).map(row => row[column]))].filter(id => id != null && !existing.has(id));
    if (missing.length) {
      const {error} = await db.from(table).insert(missing.map(id => ({outlook_id: targetId, [column]: id})));
      if (error) throw error;
    }
  }
}
module.exports = {copyOutlookTaxonomies};
