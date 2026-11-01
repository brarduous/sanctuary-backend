const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');
const { repetitionReport, normalizeReview, mayPromote, defaults, validateRuntime } = require('../utils/devotionalQuality');
const { reviewWindow, selectPersonalized, validateTrial, runDevotionalQualityReview } = require('../services/devotionalQualityReview');
const grade = (id, value = 85) => ({ id, helpfulness:value, accuracy:95, audience:value, freshness:value, seriousConcern:false, evidence:['Specific supporting excerpt'] });

test('weekly window uses seven completed Monday-Sunday UTC publication dates', () => {
  assert.deepEqual(reviewWindow(new Date('2026-11-02T06:00:00Z')), { start:'2026-10-26', end:'2026-11-02' });
  assert.deepEqual(reviewWindow(new Date('2026-11-01T23:59:59Z')), { start:'2026-10-19', end:'2026-10-26' });
});
test('repetition is counted per reader/day across body and slides', () => {
  const rows = [
    {user_id:'a',date:'2026-10-30',content:'A group text is buzzing'},
    {user_id:'a',date:'2026-10-30',content:'A duplicate group text request'},
    {user_id:'a',date:'2026-10-31',short_form:{slides:[{text:'Your group-chat gets tense'}]}},
    {user_id:'b',date:'2026-10-31',content:'A group chat'},
  ];
  assert.deepEqual(repetitionReport(rows),{sampleCount:3,groupChatCount:3,dates:['2026-10-30','2026-10-31'],repeatedReaderCount:1});
});
test('personalized sampling preserves chronological reader histories and removes retries', () => {
  const rows = ['a','b'].flatMap(user_id => Array.from({length:7},(_,i) => ({user_id,created_at:`2026-10-${26+i}T09:00:00Z`}))) ;
  const selected = selectPersonalized([...rows,rows[0]],10);
  assert.equal(selected.length,10);
  assert.equal(selected.filter(row => row.user_id==='a').length,7);
});
test('promotion requires meaningful gain and no per-case accuracy or other dimension regression', () => {
  const baseline = [grade('a',80),grade('b',80),grade('c',80)];
  const candidate = [grade('x',90),grade('y',90),grade('z',90)];
  assert.equal(mayPromote(baseline,candidate),true);
  assert.equal(mayPromote(baseline,baseline),false);
  assert.equal(mayPromote(baseline,[...candidate.slice(0,2),{...candidate[2],accuracy:94}]),false);
  assert.equal(mayPromote(baseline,[...candidate.slice(0,2),{...candidate[2],seriousConcern:true}]),false);
  assert.equal(mayPromote(baseline,candidate.slice(0,2)),false);
});
test('review validation fails closed on incomplete, duplicated and invalid model grades', () => {
  assert.deepEqual(normalizeReview({reviews:[grade('a')]},['a']),[grade('a')]);
  assert.throws(()=>normalizeReview({reviews:[]},['a']),/Incomplete/);
  assert.throws(()=>normalizeReview({reviews:[grade('a'),grade('a')]},['a','b']),/duplicate/);
  assert.throws(()=>normalizeReview({reviews:[{...grade('a'),accuracy:NaN}]},['a']),/score/);
  assert.throws(()=>normalizeReview({reviews:[{...grade('a'),evidence:[]}]},['a']),/evidence/);
  assert.throws(()=>validateRuntime({...defaults(),general_model:'unbounded-new-model'}),/Unapproved/);
  assert.throws(()=>validateRuntime({...defaults(),general_rules:['rewrite-core-doctrine']}),/Invalid/);
});
test('experiments reject changed Scripture, invalid length, and broken slides', () => {
  const source={title:'A Specific Title',scripture_reference:'Romans 12:18',scripture_text:'If possible, live peaceably with all.'};
  const output={...source,content:'word '.repeat(130).trim(),prayer:'Help us make peace.',short_form:{format:'instagram_story_3_slide',slides:[{text:'word '.repeat(8).trim()},{text:'word '.repeat(18).trim()},{text:'word '.repeat(15).trim()}]}};
  assert.equal(validateTrial(output,source,'general'),output);
  assert.throws(()=>validateTrial({...output,scripture_reference:'Romans 12:19'},source,'general'),/Scripture/);
  assert.throws(()=>validateTrial({...output,content:'Too short'},source,'general'),/length/);
  assert.throws(()=>validateTrial({...output,short_form:{}},source,'general'),/slide/);
});
test('idempotent cron skips completed weeks before querying or invoking the model', async () => {
  let called=false;
  const report=await runDevotionalQualityReview({db:{rpc:async()=>({data:false}),from:()=>{called=true;throw Error('unexpected query');}},client:{}});
  assert.equal(report.skipped,true);
  assert.equal(called,false);
});
test('migration protects private review data, claims once, permits failed/stale retry, and rolls back', async () => {
  const db=await PGlite.create();
  try {
    await db.exec('create role anon; create role authenticated; create role service_role;');
    await db.exec(fs.readFileSync('supabase/migrations/20261101160000_devotional_quality.sql','utf8'));
    await db.exec(fs.readFileSync('supabase/migrations/20261101160000_devotional_quality.sql','utf8'));
    const claim=async()=> (await db.query("select claim_devotional_quality_week('2026-10-26') as claimed")).rows[0].claimed;
    assert.equal(await claim(),true);
    assert.equal(await claim(),false);
    await db.exec("update devotional_quality_runs set status='failed'");
    assert.equal(await claim(),true);
    await db.exec("update devotional_quality_runs set started_at=now()-interval '3 hours'");
    assert.equal(await claim(),true);
    await db.exec("update devotional_quality_runs set status='completed'");
    assert.equal(await claim(),false);
    await db.exec("update devotional_quality_runs set status='running'");
    const report = { changes:[{lane:'general'}],after:{general_model:'gpt-6.1-sol',personalized_model:'gpt-4o',general_rules:['variety'],personalized_rules:[]} };
    await assert.rejects(db.query("select finish_devotional_quality_week('2026-10-26',99,$1::jsonb)",[JSON.stringify(report)]),/concurrently/);
    assert.equal((await db.query('select revision from devotional_quality_runtime')).rows[0].revision,0);
    await db.query("select finish_devotional_quality_week('2026-10-26',0,$1::jsonb)",[JSON.stringify(report)]);
    assert.equal((await db.query('select revision,general_model from devotional_quality_runtime')).rows[0].revision,1);
    assert.equal((await db.query('select status from devotional_quality_runs')).rows[0].status,'completed');
    await assert.rejects(db.query("select finish_devotional_quality_week('2026-10-26',0,$1::jsonb)",[JSON.stringify(report)]),/concurrently/);
    const security=await db.query("select has_table_privilege('authenticated','devotional_quality_runtime','select') as can_read, has_function_privilege('anon','claim_devotional_quality_week(date)','execute') as can_claim");
    assert.deepEqual(security.rows[0],{can_read:false,can_claim:false});
    await db.exec(fs.readFileSync('supabase/rollbacks/20261101160000.sql','utf8'));
    assert.equal((await db.query("select to_regclass('devotional_quality_runtime') as tbl")).rows[0].tbl,null);
  } finally { await db.close(); }
});
