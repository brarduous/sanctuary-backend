const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluatePublicationEligibility } = require('../utils/newsEditorialPolicy');

const baseArticle = { title: 'City council approves housing plan', url: 'https://example.com/story', publish_date: '2026-09-20T12:00:00Z' };
const baseGenerated = { title: baseArticle.title, synopsis: 'The council approved a housing plan.', sources: [
  { title: 'Report one', publisher: 'Publisher One', url: 'https://one.example/story' },
  { title: 'Report two', publisher: 'Publisher Two', url: 'https://two.example/story' },
] };

test('publishes a complete, high-confidence, non-sensitive story', () => {
  assert.deepEqual(evaluatePublicationEligibility({ article: baseArticle, generated: baseGenerated, verification: { confidenceScore: 90, unresolvedEvidenceGaps: [] } }).reasons, []);
});

test('queues low-confidence and single-source stories', () => {
  const result = evaluatePublicationEligibility({ article: baseArticle, generated: { ...baseGenerated, sources: baseGenerated.sources.slice(0, 1) }, verification: { confidenceScore: 84 } });
  assert.equal(result.eligible, false);
  assert.ok(result.reasons.includes('low_confidence'));
  assert.ok(result.reasons.includes('insufficient_independent_sources'));
});

test('queues sensitive stories even with strong evidence', () => {
  const result = evaluatePublicationEligibility({ article: { ...baseArticle, title: 'Two killed in election violence' }, generated: baseGenerated, verification: { confidenceScore: 99, unresolvedEvidenceGaps: [] } });
  assert.ok(result.reasons.includes('sensitive_subject'));
});
