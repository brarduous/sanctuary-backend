const DEFAULT_MIN_REPORTING_WORDS = 400;
const DEFAULT_MIN_PRIMARY_DOCUMENT_WORDS = 150;
const DEFAULT_MIN_PUBLISHER_EXCERPT_WORDS = 35;
const DEFAULT_MIN_CORROBORATING_EXCERPT_WORDS = 20;

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

function isPublisherSuppliedExcerpt(source, minimumWords = DEFAULT_MIN_PUBLISHER_EXCERPT_WORDS) {
    return source?.publisherExcerpt === true
        && source?.analysisEligible === true
        && wordCount(source.body) >= minimumWords;
}

function assessEvidencePackage(article) {
    const sources = [article, ...(article?.corroboratingSources || [])].filter(Boolean);
    const substantiveReporting = sources.filter((source) => source.sourceType !== 'official_document' && isAuthorizedFullText(source));
    const primaryDocuments = sources.filter(isAuthorizedPrimaryDocument);
    const publisherExcerpts = sources.filter((source) => isPublisherSuppliedExcerpt(source));
    const corroboratingExcerpts = sources.filter((source) => isPublisherSuppliedExcerpt(source, DEFAULT_MIN_CORROBORATING_EXCERPT_WORDS));
    const independentPublishers = new Set(substantiveReporting.filter((source) => source.isIndependent).map((source) => source.publisher));
    const independentExcerptPublishers = new Set(corroboratingExcerpts.filter((source) => source.isIndependent).map((source) => source.publisher));
    // A complete public-domain primary document is itself an authoritative
    // evidence package. Reporting still needs corroboration because Sanctuary
    // does not own or license ordinary publisher article text.
    const eligible = primaryDocuments.length >= 1
        || substantiveReporting.length >= 2
        || publisherExcerpts.length >= 1
        || independentExcerptPublishers.size >= 2;

    let reason = null;
    if (!eligible && corroboratingExcerpts.length > 0) {
        reason = 'The available publisher excerpts are too brief to support analysis without corroboration.';
    } else if (!eligible && substantiveReporting.length === 0 && primaryDocuments.length === 0) {
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
        corroboratingExcerptCount: corroboratingExcerpts.length,
        independentExcerptPublisherCount: independentExcerptPublishers.size,
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
    DEFAULT_MIN_CORROBORATING_EXCERPT_WORDS,
    wordCount,
    assessEvidencePackage,
    discoveryRankFor,
};
