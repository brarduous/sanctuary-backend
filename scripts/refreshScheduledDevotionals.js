// Refresh already-scheduled dates, retaining their original week
// boundaries and themes. Prepare and validate the entire window before writes.
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { generateEntries, generatePlannedEntries, validateWeeklyPlan, validateWeeklyEntries } = require('../cron/generateGeneralDevotionals');
const { DEVOTIONAL_PLAN_VERSION } = require('../utils/featuredScripture');
const { createHash } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const { VERSION: AUDIENCE_VERSION } = require('../utils/audienceContentPolicy');

const dateInNewYork = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const dateAtOffset = (start, offset) => new Date(new Date(`${start}T00:00:00Z`).getTime() + offset * 86400000).toISOString().slice(0, 10);
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const digest = rows => createHash('sha256').update(JSON.stringify(canonical(rows))).digest('hex');

const isRefreshDate = (date, cutoff, includeToday = false) => includeToday ? date >= cutoff : date > cutoff;
const buildScheduledRows = (week, entries, scheduledDates, cutoff, includeToday = false) => entries
  .map(entry => ({
    date: dateAtOffset(week.start_date, entry.day_offset),
    title: entry.title,
    scripture_reference: entry.scripture_reference,
    scripture_text: entry.scripture_text,
    content: entry.content,
    prayer: entry.prayer,
    topics: [...new Set([...(entry.topics || []), week.theme_title, 'curriculum-v2', AUDIENCE_VERSION])],
    short_form: entry.short_form,
  }))
  .filter(row => isRefreshDate(row.date, cutoff, includeToday) && scheduledDates.has(row.date));

async function refreshScheduledDevotionals() {
  const cutoff = dateInNewYork();
  const includeToday = process.env.DEVOTIONAL_REFRESH_INCLUDE_TODAY === 'true';
  const concurrency = Number(process.env.DEVOTIONAL_REFRESH_CONCURRENCY || 1);
  const preservePlan = process.env.DEVOTIONAL_REFRESH_PRESERVE_PLAN === 'true';
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 3) throw new Error('Refresh concurrency must be 1-3.');
  if (process.env.DEVOTIONAL_REFRESH_CONFIRM !== cutoff) throw new Error(`Set DEVOTIONAL_REFRESH_CONFIRM=${cutoff} to refresh future scheduled content.`);
  const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const query = async q => { const { data, error } = await q; if (error) throw error; return data || []; };
  const windowQuery = q => includeToday ? q.gte('date', cutoff) : q.gt('date', cutoff);
  const [scheduled, weeks, themes] = await Promise.all([
    query(windowQuery(db.from('general_devotionals').select('*')).order('date')),
    query(db.from('devotional_week_plans').select('*').gte('end_date', cutoff).order('start_date')),
    query(db.from('devotional_themes').select('*')),
  ]);
  if (!scheduled.length) throw new Error('No future scheduled devotionals to refresh.');
  for (const row of scheduled) {
    if (weeks.filter(week => row.date >= week.start_date && row.date <= week.end_date).length !== 1) throw new Error(`Expected exactly one week plan covering ${row.date}.`);
  }
  // Confirm revision storage exists before publishing anything.
  await query(db.from('general_devotional_revisions').select('id').limit(1));
  console.log(JSON.stringify({ phase: 'snapshot', cutoff, includeToday, dates: scheduled.map(row => row.date), previousDigest: digest(scheduled) }));
  const dates = new Set(scheduled.map(row => row.date));
  const firstWeekStart = weeks[0].start_date;
  const recent = await query(db.from('general_devotionals').select('date,title,scripture_reference').gte('date', dateAtOffset(firstWeekStart, -90)).lt('date', firstWeekStart).order('date', { ascending: false }));
  const prepared = [];
  for (const week of weeks.filter(week => scheduled.some(row => row.date >= week.start_date && row.date <= week.end_date))) {
    const theme = themes.find(item => item.week_number === week.theme_week_number);
    if (!theme) throw new Error(`Missing theme ${week.theme_week_number}.`);
    console.log(JSON.stringify({ phase: 'generating', startDate: week.start_date, theme: theme.theme_title }));
    const assignment = { ...theme, formation_goal: week.formation_goal || theme.formation_goal };
    const existingPlan = preservePlan ? validateWeeklyPlan(week.plan) : null;
    const generated = existingPlan
      ? { ...await generatePlannedEntries(assignment, existingPlan, recent, { concurrency }), plan: existingPlan }
      : await generateEntries(assignment, recent, { concurrency });
    const entries = validateWeeklyEntries(generated.entries);
    const rows = buildScheduledRows(week, entries, dates, cutoff, includeToday);
    // Preserve published day briefs for the partially elapsed current week.
    const plan = {
      ...generated.plan,
      audience_policy_version: AUDIENCE_VERSION,
      short_verse_effective_from: rows[0].date,
      days: generated.plan.days.map(day => !isRefreshDate(dateAtOffset(week.start_date, day.day_offset), cutoff, includeToday)
        ? week.plan.days.find(old => old.day_offset === day.day_offset) || day
        : day),
    };
    prepared.push({ week, plan, rows });
    recent.unshift(...rows.map(({ date, title, scripture_reference }) => ({ date, title, scripture_reference })));
    console.log(JSON.stringify({ phase: 'prepared', startDate: week.start_date, selections: rows.map(({ date, scripture_reference }) => ({ date, scripture_reference })) }));
  }
  const rows = prepared.flatMap(item => item.rows);
  if (rows.length !== scheduled.length || new Set(rows.map(row => row.date)).size !== scheduled.length) throw new Error('Prepared dates do not exactly match the existing schedule.');
  if (dateInNewYork() !== cutoff) throw new Error('Calendar day changed during preparation; rerun with a fresh cutoff.');
  const current = await query(windowQuery(db.from('general_devotionals').select('*')).order('date'));
  if (digest(current) !== digest(scheduled)) throw new Error('The schedule changed during preparation; nothing was written.');
  // Updating rows in place preserves IDs used by favorites and deep links.
  for (const row of rows) {
    const before = scheduled.find(item => item.date === row.date);
    const updated = await query(windowQuery(db.from('general_devotionals').update(row).eq('id', before.id).eq('date', row.date)).select('id'));
    if (updated.length !== 1) throw new Error(`Expected to update one scheduled row for ${row.date}.`);
    const revisions = await query(db.from('general_devotional_revisions').select('previous_row').eq('devotional_id', before.id).order('archived_at', { ascending: false }).limit(1));
    if (!revisions[0] || !isDeepStrictEqual(revisions[0].previous_row, before)) throw new Error(`Revision archive verification failed for ${row.date}.`);
  }
  for (const { week, plan } of prepared) {
    const updated = await query(db.from('devotional_week_plans').update({
      plan, formation_goal: plan.formation_goal, prompt_version: DEVOTIONAL_PLAN_VERSION,
      model: process.env.GENERAL_DEVOTIONAL_MODEL || 'gpt-5-mini', status: 'published', updated_at: new Date().toISOString(),
    }).eq('id', week.id).select('id'));
    if (updated.length !== 1) throw new Error(`Failed to update week plan ${week.start_date}.`);
  }
  const saved = await query(windowQuery(db.from('general_devotionals').select('*')).order('date'));
  for (const row of rows) {
    const actual = saved.find(item => item.date === row.date);
    if (!actual || Object.keys(row).some(key => !isDeepStrictEqual(actual[key], row[key]))) throw new Error(`Readback mismatch for ${row.date}.`);
  }
  console.log(JSON.stringify({ phase: 'complete', updatedRows: rows.length, from: rows[0].date, through: rows.at(-1).date, archivedRows: rows.length, weeks: prepared.length }));
}

if (require.main === module) refreshScheduledDevotionals().catch(error => { console.error('[Scheduled devotional refresh]', error.message); process.exitCode = 1; });
module.exports = { buildScheduledRows, dateAtOffset, isRefreshDate };
