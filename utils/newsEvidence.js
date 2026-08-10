const DEFAULT_MIN_REPORTING_WORDS = 400;
const DEFAULT_MIN_PRIMARY_DOCUMENT_WORDS = 150;
const DEFAULT_MIN_PUBLISHER_EXCERPT_WORDS = 60;

function wordCount(value) {
    return String(value || '').trim().split(/\s+/).filter(Boolean).length;
}

function isAuthorizedFullText(source) {
    return source?.fullTextAuthorized === true
        && source?.analysisEligible === true
        && wordCount(source.body) >= DEFAULT_MIN_REPORTING_WORDS;
}

function isAuthorizedPrimaryDocument(source) {
    return source?.sourceType === 'official_document'
        && source?.fullTextAuthorized === true
        && source?.analysisEligible === true
        && wordCount(source.body) >= DEFAULT_MIN_PRIMARY_DOCUMENT_WORDS;
}

function isPublisherSuppliedExcerpt(source) {
    return source?.publisherExcerpt === true
        && source?.analysisEligible === true
        && wordCount(source.body) >= DEFAULT_MIN_PUBLISHER_EXCERPT_WORDS;
}

function assessEvidencePackage(article) {
    const sources = [article, ...(article?.corroboratingSources || [])].filter(Boolean);
    const substantiveReporting = sources.filter((source) => source.sourceType !== 'official_document' && isAuthorizedFullText(source));
    const primaryDocuments = sources.filter(isAuthorizedPrimaryDocument);
    const publisherExcerpts = sources.filter(isPublisherSuppliedExcerpt);
    const independentPublishers = new Set(substantiveReporting.filter((source) => source.isIndependent).map((source) => source.publisher));
    // A complete public-domain primary document is itself an authoritative
    // evidence package. Reporting still needs corroboration because Sanctuary
    // does not own or license ordinary publisher article text.
    const eligible = primaryDocuments.length >= 1
        || substantiveReporting.length >= 2
        || publisherExcerpts.length >= 1;

    let reason = null;
    if (!eligible && substantiveReporting.length === 0 && primaryDocuments.length === 0) {
        reason = 'No authorized full-text evidence is available.';
    } else if (!eligible && substantiveReporting.length === 1) {
        reason = 'A second substantive report or authorized primary document is required.';
    } else if (!eligible) {
        reason = 'The evidence package does not meet the publication threshold.';
    }

    return {
        eligible,
        reason,
        substantiveReportingCount: substantiveReporting.length,
        primaryDocumentCount: primaryDocuments.length,
        publisherExcerptCount: publisherExcerpts.length,
        independentPublisherCount: independentPublishers.size,
        sourceCount: sources.length,
    };
}

function discoveryRankFor(title, discoveryItems, relatedTitleScore) {
    let best = null;
    for (let index = 0; index < discoveryItems.length; index += 1) {
        const score = relatedTitleScore(title, discoveryItems[index].title);
        if (score >= 0.45 && (!best || score > best.matchScore)) {
            best = { rank: index + 1, matchScore: score };
        }
    }
    return best;
}

module.exports = {
    DEFAULT_MIN_REPORTING_WORDS,
    DEFAULT_MIN_PRIMARY_DOCUMENT_WORDS,
    DEFAULT_MIN_PUBLISHER_EXCERPT_WORDS,
    wordCount,
    assessEvidencePackage,
    discoveryRankFor,
};
