const REVIEW_THRESHOLD = 85;

const SENSITIVE_TERMS = [
  'alleged', 'allegation', 'assault', 'child', 'children', 'death', 'died',
  'election', 'fraud', 'hostage', 'killed', 'medical', 'minor', 'murder',
  'shooting', 'suicide', 'terror', 'war', 'wounded',
];

function normalizeSources(sources) {
  return Array.isArray(sources) ? sources.filter((source) => source?.url && source?.title) : [];
}

function isSensitiveStory(article = {}, generated = {}) {
  const text = [article.title, article.body, generated.title, generated.synopsis]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return SENSITIVE_TERMS.some((term) => new RegExp(`\\b${term}\\b`, 'i').test(text));
}

function evaluatePublicationEligibility({ article = {}, generated = {}, verification = {} }) {
  const sources = normalizeSources(generated.sources);
  const independentPublishers = new Set(
    sources.map((source) => String(source.publisher || '').trim().toLowerCase()).filter(Boolean),
  );
  const reasons = [];
  const slugSource = String(generated.title || article.title || '').trim();

  if (!slugSource) reasons.push('missing_headline');
  if (!String(article.url || '').startsWith('http')) reasons.push('invalid_source_url');
  if (!article.publish_date || Number.isNaN(new Date(article.publish_date).getTime())) reasons.push('invalid_publish_date');
  if (!String(generated.synopsis || '').trim()) reasons.push('missing_summary');
  if (sources.length < 2 || independentPublishers.size < 2) reasons.push('insufficient_independent_sources');
  if (Number(verification.confidenceScore || 0) < REVIEW_THRESHOLD) reasons.push('low_confidence');
  if (Array.isArray(verification.unresolvedEvidenceGaps) && verification.unresolvedEvidenceGaps.length) reasons.push('unresolved_evidence_gaps');
  if (isSensitiveStory(article, generated)) reasons.push('sensitive_subject');

  return {
    eligible: reasons.length === 0,
    reasons,
    threshold: REVIEW_THRESHOLD,
    sourceCount: sources.length,
    independentSourceCount: independentPublishers.size,
  };
}

module.exports = { REVIEW_THRESHOLD, SENSITIVE_TERMS, evaluatePublicationEligibility, isSensitiveStory };
