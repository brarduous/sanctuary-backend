const test = require('node:test');
const assert = require('node:assert/strict');
const { requiredSlots, slugify, journeyReminderAt, extractScriptureReferences } = require('../../utils/contentPacks');

test('Phase 1 Content Pack requests every roadmap resource', () => {
  const count = (type) => requiredSlots.filter(([itemType]) => itemType === type).length;
  assert.equal(count('daily_devotional'), 5);
  assert.equal(count('guided_prayer'), 5);
  assert.equal(count('social_caption'), 3);
  assert.equal(count('shareable_quote'), 3);
  for (const type of ['sermon_summary','key_ideas','small_group_guide','family_prompts','member_reflection','congregational_response','email_draft']) assert.equal(count(type), 1);
});

test('scripture provenance is extracted without duplicates', () => {
  assert.deepEqual(extractScriptureReferences('Read John 3:16 and then John 3:16 alongside 1 Corinthians 13:4-7.'), ['John 3:16', '1 Corinthians 13:4-7']);
});

test('journey URLs are stable and reminders advance by release day', () => {
  assert.equal(slugify('Grace & Truth: Week One!'), 'grace-truth-week-one');
  assert.equal(journeyReminderAt('2026-08-11T12:00:00.000Z', 2, '08:30', 'America/New_York').toISOString(), '2026-08-13T12:30:00.000Z');
});
