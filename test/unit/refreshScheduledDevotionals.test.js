const test = require('node:test');
const assert = require('node:assert/strict');
process.env.SUPABASE_URL ||= 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';
process.env.OPENAI_API_KEY ||= 'test-openai-key';
const { buildScheduledRows, dateAtOffset } = require('../../scripts/refreshScheduledDevotionals');
test('partial-week refresh preserves original dates and skips published or unscheduled days', () => {
  const week = {start_date:'2026-10-19', theme_title:'Stewardship'};
  const entries = Array.from({length:7}, (_,day_offset)=>({day_offset,title:`Day ${day_offset}`,topics:[]}));
  const dates = new Set(['2026-10-20','2026-10-21','2026-10-23']);
  const rows = buildScheduledRows(week, entries, dates, '2026-10-20');
  assert.deepEqual(rows.map(row=>row.date), ['2026-10-21','2026-10-23']);
  assert.deepEqual(rows.map(row=>row.title), ['Day 2','Day 4']);
  assert.ok(rows.every(row=>row.topics.includes('curriculum-v2')));
  assert.equal(dateAtOffset('2026-10-26',6),'2026-11-01');
});
