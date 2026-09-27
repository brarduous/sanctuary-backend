const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SUPABASE_URL ||= 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';
process.env.OPENAI_API_KEY ||= 'test-openai-key';

const {
  buildSingleDayPrompt,
  buildWeeklyPlanPrompt,
  validateWeeklyEntries,
  validateWeeklyPlan,
} = require('../../cron/generateGeneralDevotionals');

const reflection = Array.from({ length: 120 }, (_, index) => `word${index}`).join(' ');
const entryTitles = ['Choose Honesty Before Taking Shortcuts', 'Listen Before Giving Your Answer', 'Name the Fear Beneath Control', 'Receive Grace Without Proving Yourself', 'Keep One Quiet Promise Today', 'Invite Someone Into Shared Prayer', 'Review the Week With Gratitude'];
const planTitles = ['Trust Starts With God’s Character', 'Release the Demand for Certainty', 'Bring Your Honest Fear to God', 'Receive Wisdom One Step at Time', 'Choose One Faithful Next Action', 'Ask a Friend to Discern Together', 'Review Where God Met You'];
const planClaims = ['God’s character grounds trust', 'Control cannot create certainty', 'Lament brings fear into prayer', 'Grace supplies wisdom for today', 'Faith becomes visible through obedience', 'Christian discernment belongs in community', 'Gratitude helps us notice formation'];

const entry = dayOffset => ({
  day_offset: dayOffset,
  title: entryTitles[dayOffset],
  scripture_reference: `Psalm 1:${dayOffset + 1}`,
  scripture_text: `Verse ${dayOffset + 1}`,
  content: reflection,
  prayer: `Prayer ${dayOffset + 1}`,
  topics: [],
  short_form: {
    format: 'instagram_story_3_slide',
    slides: [{ slide: 1, text: 'Notice' }, { slide: 2, text: 'Ground' }, { slide: 3, text: 'Practice' }],
  },
});

const plan = () => ({
  formation_goal: 'Move from anxious control toward faithful action.',
  theological_claim: 'God is trustworthy when the way is unclear.',
  pastoral_need: 'Decision fatigue',
  guardrails: ['Do not promise certainty.'],
  days: Array.from({ length: 7 }, (_, index) => ({
    day_offset: index,
    movement: ['encounter', 'expose', 'lament', 'receive', 'practice', 'community', 'integrate'][index],
    daily_angle: `Unique angle ${index + 1}`,
    human_situation: `Situation ${index + 1}`,
    central_claim: planClaims[index],
    scripture_reference: `Psalm ${index + 1}:1`,
    interpretation_note: `Psalm ${index + 1} addresses its original worshiping community.`,
    practice_type: `practice-${index + 1}`,
    practice_brief: `Before dinner, write action ${index + 1} on paper.`,
    title_direction: planTitles[index],
    share_mode: index > 4 ? 'discuss' : 'none',
  })),
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

test('weekly plan validation requires a differentiated seven-day arc', () => {
  const result = validateWeeklyPlan(plan());
  assert.equal(result.days.length, 7);
  const repeated = plan();
  repeated.days[6].central_claim = repeated.days[0].central_claim;
  assert.throws(() => validateWeeklyPlan(repeated), /central claims must be distinct/i);
});

test('weekly planner excludes recent content and generic title openings', () => {
  const prompt = buildWeeklyPlanPrompt(
    { theme_title: 'Trust in God', scripture_focus: 'Proverbs 3:5-6' },
    [{ title: 'A Familiar Title', scripture_reference: 'Psalm 46:10' }]
  );
  assert.match(prompt, /seven-day Christian formation journey/i);
  assert.match(prompt, /A Familiar Title — Psalm 46:10/);
  assert.match(prompt, /Do not begin titles with/i);
});

test('single-day prompt applies the research-grounded formation playbook', () => {
  const prompt = buildSingleDayPrompt(
    { theme_title: 'Peace in uncertainty', scripture_focus: 'Philippians 4' },
    plan(),
    2,
    [],
    [{ title: 'A Familiar Title', scripture_reference: 'Psalm 46:10' }]
  );

  assert.match(prompt, /Arrive:/);
  assert.match(prompt, /Read in context:/);
  assert.match(prompt, /Practice:/);
  assert.match(prompt, /do not proof-text/i);
  assert.match(prompt, /Never claim that prayer or a devotional replaces medical/);
  assert.match(prompt, /Slide 1 — Notice/);
  assert.match(prompt, /Required Scripture: Psalm 3:1/);
  assert.match(prompt, /A Familiar Title/);
  assert.match(prompt, /Other days in this week/);
});
