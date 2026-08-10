const test = require('node:test');
const assert = require('node:assert/strict');
const { overlapScore, MATCH_THRESHOLD } = require('../utils/newsClusterMatching');

test('clusters reports describing the same concrete vaccine guidance', () => {
  const score = overlapScore('Trump orders changes to childhood vaccine guidance CDC MMR', 'Trump signs executive order on childhood vaccine schedule MMR CDC');
  assert.ok(score >= MATCH_THRESHOLD);
});

test('does not cluster unrelated stories that merely share a public figure', () => {
  const score = overlapScore('Trump orders changes to childhood vaccine guidance', 'Trump meets leaders to discuss Gaza ceasefire');
  assert.ok(score < MATCH_THRESHOLD);
});

test('cluster migration preserves superseded outlooks and restricts direct access', () => {
  const migration = require('node:fs').readFileSync(require('node:path').join(__dirname, '../supabase/migrations/20260810231000_news_story_clusters.sql'), 'utf8');
  assert.match(migration, /superseded_by_outlook_id/);
  assert.match(migration, /force row level security/i);
  assert.match(migration, /canonical_outlook_id/);
});
