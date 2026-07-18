const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeGeneratedNumbering, normalizeGeneratedListItems, normalizeGeneratedLessonLists } = require('../../utils/normalizeGeneratedLists');

test('normalizes inline generated numbering without changing ordinary prose', () => {
  assert.equal(normalizeGeneratedNumbering('1) First 2) Second 3) Third'), '1. First\n2. Second\n3. Third');
  assert.equal(normalizeGeneratedNumbering('See chapter 2) for context.'), 'See chapter 2) for context.');
});

test('splits malformed list fields before generated lessons are persisted', () => {
  assert.deepEqual(normalizeGeneratedListItems(['1) First 2) Second 3) Third']), ['First', 'Second', 'Third']);
  const lesson = normalizeGeneratedLessonLists({ commentary: '1) One 2) Two 3) Three', study_outline: ['1) A 2) B 3) C'] });
  assert.equal(lesson.commentary, '1. One\n2. Two\n3. Three');
  assert.deepEqual(lesson.study_outline, ['A', 'B', 'C']);
});
