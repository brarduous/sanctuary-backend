const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateTruthfulnessScore, normalizeVerificationAssessment, publicAssessment, truthfulnessBand } = require('../utils/newsVerification');

test('truthfulness is materiality weighted and deterministically banded', () => {
    const score = calculateTruthfulnessScore([
        { claimText: 'Material claim', materiality: 5, status: 'contradicted', rationale: 'Conflicts with both supplied reports.' },
        { claimText: 'Minor claim', materiality: 1, status: 'supported', rationale: 'Confirmed by supplied reporting.' },
    ]);
    assert.equal(score, 17);
    assert.equal(truthfulnessBand(score), 'Substantially contradicted');
});

test('confidence is bounded, private, and distinct from public truthfulness', () => {
    const normalized = normalizeVerificationAssessment({
        assessmentSummary: 'The principal claim is supported.',
        claims: [{ claimText: 'Principal claim', materiality: 5, status: 'supported', rationale: 'Two reports agree.' }],
        confidenceFactors: { evidenceCoverage: 90, publisherIndependence: 88, sourceQuality: 82, claimSpecificity: 77, freshness: 95, conflictResolution: 80 },
    }, [{ publisher: 'A', isIndependent: true }, { publisher: 'B', isIndependent: true }]);
    assert.equal(normalized.truthfulnessScore, 100);
    assert.equal(normalized.confidenceScore, 85);
    const publicValue = publicAssessment({ version: 1, truthfulness_score: 100, truthfulness_band: normalized.truthfulnessBand, assessment_summary: normalized.assessmentSummary, assessed_at: '2026-07-18T00:00:00Z', confidence_score: 85, confidence_factors: normalized.confidenceFactors }, [], [], []);
    assert.equal('confidenceScore' in publicValue, false);
    assert.equal('confidenceFactors' in publicValue, false);
});

test('unknown and absent claims default to an explicitly mixed score', () => {
    assert.equal(calculateTruthfulnessScore([]), 50);
    assert.equal(calculateTruthfulnessScore([{ claimText: 'Claim', materiality: 3, status: 'invented', rationale: 'Unknown.' }]), 50);
});
