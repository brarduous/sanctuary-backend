const test = require('node:test');
const assert = require('node:assert/strict');
const { isStaffJourneyVisible } = require('../../utils/staffJourneys');

const visible = (capabilities, status, isOwner = false) => isStaffJourneyVisible({ capabilities: new Set(capabilities), status, isOwner });

test('authors see every status only for their own journeys', () => {
  for (const status of ['generating', 'draft', 'in_review', 'failed', 'ready', 'scheduled', 'published', 'cancelled', 'unpublished']) assert.equal(visible(['content.write'], status, true), true);
  assert.equal(visible(['content.write'], 'draft', false), false);
  assert.equal(visible(['content.write'], 'failed', false), false);
});

test('publishers see congregation-wide ready, scheduled, and published journeys', () => {
  for (const status of ['ready', 'scheduled', 'published']) assert.equal(visible(['communications.write'], status), true);
  for (const status of ['draft', 'in_review', 'failed', 'cancelled', 'unpublished']) assert.equal(visible(['communications.write'], status), false);
});

test('read-only staff see only published journeys', () => {
  assert.equal(visible(['content.read'], 'published'), true);
  assert.equal(visible(['content.read'], 'ready'), false);
  assert.equal(visible(['content.read'], 'scheduled'), false);
});

test('capability combinations form a union without broadening individual rules', () => {
  const combined = ['content.read', 'content.write', 'communications.write'];
  assert.equal(visible(combined, 'failed', true), true);
  assert.equal(visible(combined, 'failed', false), false);
  assert.equal(visible(combined, 'ready', false), true);
  assert.equal(visible(combined, 'published', false), true);
  assert.equal(visible([], 'published', true), false);
});
