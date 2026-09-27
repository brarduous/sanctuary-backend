const { execFileSync } = require('node:child_process');
const { createClient } = require('@supabase/supabase-js');

const PROJECT_REF = process.env.SUPABASE_PROJECT_REF || 'cmakuvkjxknwhonfqbit';
const START_DATE = process.env.DEVOTIONAL_REGEN_START_DATE || process.argv[2];
const START_THEME_WEEK = Number.parseInt(process.env.DEVOTIONAL_REGEN_START_THEME_WEEK || process.argv[3], 10);
const WEEK_COUNT = Number.parseInt(process.env.DEVOTIONAL_REGEN_WEEK_COUNT || process.argv[4] || '4', 10);

const fail = message => { throw new Error(message); };
const toDateString = date => date.toISOString().slice(0, 10);
const addDays = (date, days) => {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
};

if (!/^\d{4}-\d{2}-\d{2}$/.test(START_DATE || '')) fail('Usage: node scripts/regenerateFutureDevotionals.js YYYY-MM-DD START_THEME_WEEK [WEEK_COUNT]');
if (!Number.isInteger(START_THEME_WEEK) || START_THEME_WEEK < 1 || START_THEME_WEEK > 52) fail('START_THEME_WEEK must be 1-52.');
if (!Number.isInteger(WEEK_COUNT) || WEEK_COUNT < 1 || WEEK_COUNT > 8) fail('WEEK_COUNT must be 1-8.');
if (process.env.DEVOTIONAL_REGEN_CONFIRM !== START_DATE) fail(`Set DEVOTIONAL_REGEN_CONFIRM=${START_DATE} after reviewing the replacement window.`);
if (!process.env.OPENAI_API_KEY) fail('OPENAI_API_KEY is required.');

const today = toDateString(new Date());
if (START_DATE <= today) fail(`Start date must be after today (${today}); published devotionals are immutable through this tool.`);

const loadServiceRoleKey = () => {
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) return process.env.SUPABASE_SERVICE_ROLE_KEY;
  const keys = JSON.parse(execFileSync('npx', ['supabase', 'projects', 'api-keys', '--project-ref', PROJECT_REF, '--output', 'json'], { encoding: 'utf8' }));
  return keys.find(candidate => candidate.name === 'service_role')?.api_key;
};

process.env.SUPABASE_URL ||= `https://${PROJECT_REF}.supabase.co`;
process.env.SUPABASE_SERVICE_ROLE_KEY ||= loadServiceRoleKey();

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { generateEntries, validateWeeklyEntries } = require('../cron/generateGeneralDevotionals');

async function main() {
  const start = new Date(`${START_DATE}T00:00:00.000Z`);
  const end = addDays(start, WEEK_COUNT * 7 - 1);
  const themeWeeks = Array.from({ length: WEEK_COUNT }, (_, index) => START_THEME_WEEK + index);
  if (themeWeeks.some(week => week > 52)) fail('Requested theme window extends beyond week 52.');

  const [{ data: themes, error: themeError }, { data: recent, error: recentError }, { data: existing, error: existingError }] = await Promise.all([
    db.from('devotional_themes').select('*').in('week_number', themeWeeks).order('week_number'),
    db.from('general_devotionals').select('date,title,scripture_reference').gte('date', toDateString(addDays(start, -90))).lt('date', START_DATE).order('date', { ascending: false }),
    db.from('general_devotionals').select('*').gte('date', START_DATE).lte('date', toDateString(end)).order('date'),
  ]);
  if (themeError || recentError || existingError) throw themeError || recentError || existingError;
  if ((themes || []).length !== WEEK_COUNT) fail(`Expected ${WEEK_COUNT} curriculum themes; received ${(themes || []).length}.`);

  console.log(`[Devotional Regeneration] Preparing ${WEEK_COUNT} weeks for ${START_DATE} through ${toDateString(end)}. Existing rows: ${(existing || []).length}.`);
  const preparedWeeks = [];
  const rollingRecent = [...(recent || [])];

  for (let index = 0; index < themes.length; index += 1) {
    const weekStart = addDays(start, index * 7);
    const theme = themes[index];
    console.log(`[Devotional Regeneration] Planning theme ${theme.week_number}: ${theme.theme_title}`);
    const generated = await generateEntries(theme, rollingRecent);
    const entries = validateWeeklyEntries(generated.entries);
    preparedWeeks.push({ weekStart, theme, plan: generated.plan, entries, tokens: generated.tokens });
    rollingRecent.unshift(...entries.map((entry, dayOffset) => ({
      date: toDateString(addDays(weekStart, dayOffset)),
      title: entry.title,
      scripture_reference: entry.scripture_reference,
    })));
  }

  const devotionalRows = preparedWeeks.flatMap(({ weekStart, theme, entries }) => entries.map(entry => ({
    date: toDateString(addDays(weekStart, entry.day_offset)),
    title: entry.title,
    scripture_reference: entry.scripture_reference,
    scripture_text: entry.scripture_text,
    content: entry.content,
    prayer: entry.prayer,
    topics: [...new Set([...(entry.topics || []), theme.theme_title])],
    short_form: entry.short_form,
  })));
  const planRows = preparedWeeks.map(({ weekStart, theme, plan }) => ({
    start_date: toDateString(weekStart),
    end_date: toDateString(addDays(weekStart, 6)),
    theme_week_number: theme.week_number,
    theme_title: theme.theme_title,
    formation_goal: plan.formation_goal,
    plan,
    prompt_version: 'weekly-formation-v2',
    model: process.env.GENERAL_DEVOTIONAL_MODEL || 'gpt-5-mini',
    status: 'generated',
    updated_at: new Date().toISOString(),
  }));

  const { error: planError } = await db.from('devotional_week_plans').upsert(planRows, { onConflict: 'start_date' });
  if (planError) throw planError;
  const { error: devotionalError } = await db.from('general_devotionals').upsert(devotionalRows, { onConflict: 'date' });
  if (devotionalError) throw devotionalError;
  const { error: publishError } = await db.from('devotional_week_plans').update({ status: 'published', updated_at: new Date().toISOString() }).in('start_date', planRows.map(row => row.start_date));
  if (publishError) throw publishError;

  console.log(JSON.stringify({
    success: true,
    startDate: START_DATE,
    endDate: toDateString(end),
    weeks: preparedWeeks.map(item => ({
      themeWeek: item.theme.week_number,
      theme: item.theme.theme_title,
      formationGoal: item.plan.formation_goal,
      titles: item.entries.map(entry => entry.title),
    })),
    replacedRows: (existing || []).length,
    writtenRows: devotionalRows.length,
    archivedByDatabaseTrigger: (existing || []).length,
  }, null, 2));
}

main().catch(error => {
  console.error('[Devotional Regeneration] Failed:', error.message);
  process.exitCode = 1;
});
