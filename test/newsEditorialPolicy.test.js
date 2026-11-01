const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluatePublicationEligibility } = require('../utils/newsEditorialPolicy');

const baseArticle = { title: 'City council approves housing plan', url: 'https://example.com/story', publish_date: '2026-09-20T12:00:00Z' };
const verified={confidenceScore:90,unresolvedEvidenceGaps:[],claims:[{status:'supported'}]};
const baseGenerated = { title: baseArticle.title, synopsis: 'The council approved a housing plan.', sources: [
  { title: 'Report one', publisher: 'Publisher One', url: 'https://one.example/story' },
  { title: 'Report two', publisher: 'Publisher Two', url: 'https://two.example/story' },
] };

test('publishes a complete, high-confidence, non-sensitive story', () => {
  assert.deepEqual(evaluatePublicationEligibility({ article: baseArticle, generated: baseGenerated, verification: verified }).reasons, []);
});

test('single-source stories publish with an explicit evidence limitation', () => {
  const result = evaluatePublicationEligibility({ article: baseArticle, generated: { ...baseGenerated, sources: baseGenerated.sources.slice(0, 1) }, verification: {...verified,confidenceScore:84} });
  assert.equal(result.eligible, true);
  assert.ok(result.notices.includes('limited_source_confidence'));
  assert.ok(!result.reasons.includes('low_confidence'));
  assert.ok(result.notices.includes('single_source_reporting'));
});

test('publishes sensitive stories automatically when factual evidence passes', () => {
  const result = evaluatePublicationEligibility({ article: { ...baseArticle, title: 'Two killed in election violence' }, generated: baseGenerated, verification: {...verified,confidenceScore:99} });
  assert.equal(result.eligible,true);assert.ok(result.notices.includes('sensitive_subject'));
});


test('missing publisher labels use source hostnames and unresolved context does not require a human',()=>{
 const sources=baseGenerated.sources.map(({publisher,...source})=>source);
 const result=evaluatePublicationEligibility({article:baseArticle,generated:{...baseGenerated,sources},verification:{...verified,confidenceScore:68,unresolvedEvidenceGaps:['Future developments are not known.']}});
 assert.equal(result.eligible,true);assert.deepEqual(result.reasons,[]);
 assert.ok(result.notices.includes('limited_source_confidence'));assert.ok(result.notices.includes('unresolved_evidence_gaps'));
});
test('automatic publication still rejects missing verification and unsupported factual claims',()=>{
 for(const claims of [[],[{status:'contradicted'}],[{status:'unsupported'}],[{status:'unverifiable'}]])assert.equal(evaluatePublicationEligibility({article:baseArticle,generated:baseGenerated,verification:{...verified,claims}}).eligible,false);
});
test('two URLs from one publisher do not count as independent reporting',()=>{
 const generated={...baseGenerated,sources:[baseGenerated.sources[0],{title:'Another report',publisher:'Another label',url:'https://www.one.example/another'}]};
 const result=evaluatePublicationEligibility({article:baseArticle,generated,verification:verified});assert.equal(result.independentSourceCount,1);assert.ok(result.notices.includes('single_source_reporting'));
});
