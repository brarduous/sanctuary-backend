const test = require('node:test');
const assert = require('node:assert/strict');
const { featuredVerseCount, validateFeaturedScripture, validateFeaturedWeek, normalizeFeaturedReference } = require('../../utils/featuredScripture');
test('featured book aliases match the mobile Bible corpus', () => {
  assert.equal(normalizeFeaturedReference(' Psalm  51:10 '), 'Psalms 51:10');
  assert.equal(normalizeFeaturedReference('Song of Songs 2:4'), 'Song of Solomon 2:4');
  assert.equal(normalizeFeaturedReference('Psalms 51:10'), 'Psalms 51:10');
  assert.equal(normalizeFeaturedReference('1 John 4:19'), '1 John 4:19');
});
test('featured references support numbered books and adjacent pairs', () => {
  for (const reference of ['Psalm 51:12', '1 John 4:19', 'Song of Songs 2:4']) assert.equal(featuredVerseCount(reference), 1);
  assert.equal(featuredVerseCount('Proverbs 3:5–6'), 2);
});
test('featured references reject study passages and disconnected selections', () => {
  for (const reference of ['Psalm 23', 'Psalm 23:1-6', 'John 3:16-4:2', 'John 3:16,18', 'John 3:16; Romans 5:8', 'Psalm 23:2-1']) assert.throws(() => featuredVerseCount(reference), /one verse or two adjacent verses/);
});
test('featured quotation limits reject long or omitted text without clipping', () => {
  const scripture_reference = 'Psalm 51:12';
  assert.equal(validateFeaturedScripture({ scripture_reference, scripture_text: 'Restore to me the joy of your salvation.' }), 1);
  for (const scripture_text of ['', 'word '.repeat(41), 'longword'.repeat(40)]) assert.throws(() => validateFeaturedScripture({ scripture_reference, scripture_text }), /1-40 words/);
  for (const scripture_text of ['Restore ... salvation.', 'Restore … salvation.']) assert.throws(() => validateFeaturedScripture({ scripture_reference, scripture_text }), /without ellipses/);
});
test('at least five featured selections per week are single verses', () => {
  const days = Array.from({length: 7}, (_, i) => ({scripture_reference: `Psalm ${i+1}:1`, scripture_text: 'A short quotation.'}));
  days[0].scripture_reference = 'Psalm 23:1-2';
  days[1].scripture_reference = 'Proverbs 3:5-6';
  validateFeaturedWeek(days);
  days[2].scripture_reference = '1 Thessalonians 5:16-17';
  assert.throws(() => validateFeaturedWeek(days), /single verse on at least five days/);
});
