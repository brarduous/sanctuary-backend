const STATUS_VALUES = Object.freeze({
    supported: 100,
    partially_supported: 70,
    unverifiable: 50,
    unsupported: 25,
    contradicted: 0,
});

function boundedScore(value, fallback = 0) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.max(0, Math.min(100, Math.round(numeric))) : fallback;
}

function truthfulnessBand(score) {
    if (score >= 85) return 'Strongly supported';
    if (score >= 70) return 'Mostly supported';
    if (score >= 50) return 'Mixed or partially verified';
    if (score >= 25) return 'Weakly supported';
    return 'Substantially contradicted';
}

function normalizeClaims(rawClaims) {
    if (!Array.isArray(rawClaims)) return [];
    return rawClaims.slice(0, 10).map((claim) => {
        const status = Object.hasOwn(STATUS_VALUES, claim?.status) ? claim.status : 'unverifiable';
        return {
            claimText: String(claim?.claimText || '').trim().slice(0, 2000),
            materiality: Math.max(1, Math.min(5, Math.round(Number(claim?.materiality) || 1))),
            status,
            rationale: String(claim?.rationale || '').trim().slice(0, 3000),
            evidenceUrls: Array.isArray(claim?.evidenceUrls)
                ? [...new Set(claim.evidenceUrls.map(String))].slice(0, 10)
                : [],
        };
    }).filter((claim) => claim.claimText && claim.rationale);
}

function calculateTruthfulnessScore(claims) {
    const normalized = normalizeClaims(claims);
    const totalWeight = normalized.reduce((sum, claim) => sum + claim.materiality, 0);
    if (!totalWeight) return 50;
    return Math.round(normalized.reduce((sum, claim) => sum + STATUS_VALUES[claim.status] * claim.materiality, 0) / totalWeight);
}

function normalizeVerificationAssessment(raw, sources = []) {
    const claims = normalizeClaims(raw?.claims);
    const truthfulnessScore = calculateTruthfulnessScore(claims);
    const independentPublishers = new Set(sources.filter((source) => source.isIndependent).map((source) => source.publisher)).size;
    const factors = {
        evidenceCoverage: boundedScore(raw?.confidenceFactors?.evidenceCoverage, claims.length ? 50 : 0),
        publisherIndependence: boundedScore(raw?.confidenceFactors?.publisherIndependence, independentPublishers >= 2 ? 80 : independentPublishers ? 50 : 20),
        sourceQuality: boundedScore(raw?.confidenceFactors?.sourceQuality, 50),
        claimSpecificity: boundedScore(raw?.confidenceFactors?.claimSpecificity, 50),
        freshness: boundedScore(raw?.confidenceFactors?.freshness, 50),
        conflictResolution: boundedScore(raw?.confidenceFactors?.conflictResolution, 50),
    };
    const confidenceScore = Math.round(Object.values(factors).reduce((sum, value) => sum + value, 0) / Object.keys(factors).length);
    return {
        truthfulnessScore,
        truthfulnessBand: truthfulnessBand(truthfulnessScore),
        assessmentSummary: String(raw?.assessmentSummary || 'Available evidence is incomplete; review the claim findings and linked sources.').trim().slice(0, 2000),
        confidenceScore,
        confidenceFactors: factors,
        unresolvedEvidenceGaps: Array.isArray(raw?.unresolvedEvidenceGaps)
            ? raw.unresolvedEvidenceGaps.map(String).filter(Boolean).slice(0, 20)
            : [],
        claims,
    };
}

function publicAssessment(scoreVersion, claims = [], sources = [], corrections = []) {
    if (!scoreVersion) return null;
    return {
        truthfulnessScore: scoreVersion.truthfulness_score,
        truthfulnessBand: scoreVersion.truthfulness_band,
        assessmentSummary: scoreVersion.assessment_summary,
        assessedAt: scoreVersion.assessed_at,
        assessmentVersion: scoreVersion.version,
        claims: claims.map((claim) => ({
            id: claim.id,
            claimText: claim.claim_text,
            materiality: claim.materiality,
            status: claim.status,
            rationale: claim.rationale,
        })),
        sources: sources.map((source) => ({
            id: source.id,
            publisher: source.publisher,
            title: source.title,
            url: source.url,
            publishedAt: source.published_at,
            sourceType: source.source_type,
            isIndependent: source.is_independent,
        })),
        corrections: corrections.map((notice) => ({ id: notice.id, notice: notice.notice, publishedAt: notice.published_at })),
        automatedAssessmentNotice: 'This automated score estimates evidentiary support for factual claims. It does not establish absolute truth, intent, or publisher honesty.',
    };
}

module.exports = { calculateTruthfulnessScore, normalizeVerificationAssessment, publicAssessment, truthfulnessBand };
