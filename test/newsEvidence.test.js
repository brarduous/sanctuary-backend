const test = require('node:test');
const assert = require('node:assert/strict');
const { assessEvidencePackage, discoveryRankFor } = require('../utils/newsEvidence');

function words(count) {
    return Array.from({ length: count }, (_, index) => `word${index}`).join(' ');
}

function report(publisher, overrides = {}) {
    return {
        publisher,
        sourceType: 'reporting',
        isIndependent: true,
        fullTextAuthorized: true,
        analysisEligible: true,
        body: words(450),
        ...overrides,
    };
}

test('an excerpt-only package is never eligible for analysis', () => {
    const result = assessEvidencePackage(report('CNN', {
        accessMode: 'discovery_only',
        fullTextAuthorized: false,
        analysisEligible: false,
        body: 'A short feed excerpt.',
    }));
    assert.equal(result.eligible, false);
    assert.match(result.reason, /No authorized full-text evidence/);
});

test('two authorized substantive reports make a package eligible', () => {
    const result = assessEvidencePackage({
        ...report('CNN'),
        corroboratingSources: [report('NPR')],
    });
    assert.equal(result.eligible, true);
    assert.equal(result.substantiveReportingCount, 2);
});

test('one substantive report plus an authorized primary document is eligible', () => {
    const result = assessEvidencePackage({
        ...report('NPR'),
        corroboratingSources: [report('Federal Register', {
            sourceType: 'official_document',
            isIndependent: false,
            body: words(200),
        })],
    });
    assert.equal(result.eligible, true);
    assert.equal(result.primaryDocumentCount, 1);
});

test('discovery ranking matches related headlines without using discovery text as evidence', () => {
    const match = discoveryRankFor(
        'Major storm approaches Florida coast',
        [{ title: 'Major storm approaches the Florida coast' }, { title: 'Markets close higher' }],
        (left, right) => left.toLowerCase().includes('storm') && right.toLowerCase().includes('storm') ? 0.9 : 0,
    );
    assert.deepEqual(match, { rank: 1, matchScore: 0.9 });
});
