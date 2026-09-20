const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SUPABASE_URL ||= 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';
process.env.OPENAI_API_KEY ||= 'test-openai-key';

const { buildSingleDayPrompt, validateWeeklyEntries } = require('../../cron/generateGeneralDevotionals');

const entry = dayOffset => ({
  day_offset: dayOffset,
  title: `Day ${dayOffset + 1}`,
  scripture_reference: `Psalm 1:${dayOffset + 1}`,
  scripture_text: `Verse ${dayOffset + 1}`,
  content: `Reflection ${dayOffset + 1}`,
  prayer: `Prayer ${dayOffset + 1}`,
  topics: [],
  short_form: { format: 'instagram_story_3_slide', slides: [] },
});

test('weekly devotional validation accepts one complete entry for every day', () => {
  const result = validateWeeklyEntries(Array.from({ length: 7 }, (_, index) => entry(index)));
  assert.deepEqual(result.map(item => item.day_offset), [0, 1, 2, 3, 4, 5, 6]);
});

test('weekly devotional validation rejects incomplete weeks and missing scripture', () => {
  assert.throws(() => validateWeeklyEntries([entry(0)]), /exactly 7/);
  const entries = Array.from({ length: 7 }, (_, index) => entry(index));
  entries[3].scripture_reference = '';
  assert.throws(() => validateWeeklyEntries(entries), /missing required devotional or scripture content/);
});

test('weekly devotional validation rejects duplicate dates', () => {
  const entries = Array.from({ length: 7 }, (_, index) => entry(index));
  entries[6].day_offset = 5;
  assert.throws(() => validateWeeklyEntries(entries), /invalid or duplicate day offsets/);
});

test('weekly devotional validation rejects repeated scripture references', () => {
  const entries = Array.from({ length: 7 }, (_, index) => entry(index));
  entries[6].scripture_reference = entries[0].scripture_reference;
  assert.throws(() => validateWeeklyEntries(entries), /distinct scripture reference/);
});

test('single-day prompt applies the research-grounded formation playbook', () => {
  const prompt = buildSingleDayPrompt(
    { theme_title: 'Peace in uncertainty', scripture_focus: 'Philippians 4' },
    2,
    ['Psalm 46:10']
  );

  assert.match(prompt, /Arrive:/);
  assert.match(prompt, /Read in context:/);
  assert.match(prompt, /Practice:/);
  assert.match(prompt, /do not proof-text/i);
  assert.match(prompt, /Never claim that prayer or a devotional replaces medical/);
  assert.match(prompt, /Slide 1 — Notice/);
  assert.match(prompt, /Psalm 46:10/);
});
