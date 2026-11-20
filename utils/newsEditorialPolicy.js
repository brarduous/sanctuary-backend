const REVIEW_THRESHOLD = 85;

const SENSITIVE_TERMS = [
  'alleged', 'allegation', 'assault', 'child', 'children', 'death', 'died',
  'election', 'fraud', 'hostage', 'killed', 'medical', 'minor', 'murder',
  'shooting', 'suicide', 'terror', 'war', 'wounded',
];

function httpUrl(value) { try { return ['http:','https:'].includes(new URL(value).protocol); } catch { return false; } }
function normalizeSources(sources) {
  return Array.isArray(sources) ? sources.filter((source) => httpUrl(source?.url) && String(source?.title || '').trim()) : [];
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
    sources.map((source) => { try { return new URL(source.url).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; } }).filter(Boolean),
  );
  const reasons = [];
  const notices = [];
  const slugSource = String(generated.title || article.title || '').trim();

  if (!slugSource) reasons.push('missing_headline');
  if (!httpUrl(article.url)) reasons.push('invalid_source_url');
  if (!article.publish_date || Number.isNaN(new Date(article.publish_date).getTime())) reasons.push('invalid_publish_date');
  if (!String(generated.synopsis || '').trim()) reasons.push('missing_summary');
  if (!sources.length) reasons.push('missing_sources');
  else if (independentPublishers.size < 2) notices.push('single_source_reporting');
  if (Number(verification.confidenceScore || 0) < REVIEW_THRESHOLD) notices.push('limited_source_confidence');
  if (Array.isArray(verification.unresolvedEvidenceGaps) && verification.unresolvedEvidenceGaps.length) notices.push('unresolved_evidence_gaps');
  if (isSensitiveStory(article, generated)) notices.push('sensitive_subject');
  if (!Array.isArray(verification.claims) || !verification.claims.length) reasons.push('missing_verification');
  else if (verification.claims.some(claim => !['supported', 'partially_supported'].includes(claim.status))) reasons.push('unsupported_claims');

  return {
    eligible: reasons.length === 0,
    reasons,
    notices,
    threshold: REVIEW_THRESHOLD,
    sourceCount: sources.length,
    independentSourceCount: independentPublishers.size,
  };
}

module.exports = { REVIEW_THRESHOLD, SENSITIVE_TERMS, evaluatePublicationEligibility, isSensitiveStory };
