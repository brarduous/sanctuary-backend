const test=require('node:test'),assert=require('node:assert/strict');
const {buildDailySetPlan}=require('../utils/discoveryDailyPlan');
const {shiftDate}=require('../utils/discoveries');
test('scheduled plans freeze nine distinct chapter options and remain deterministic across two months',()=>{
 for(let i=0;i<60;i++){
  const date=shiftDate('2026-10-30',i),plan=buildDailySetPlan(date);
  assert.deepEqual(plan,buildDailySetPlan(date));
  assert.deepEqual(plan.slots.map(s=>s.targetDifficulty),['easy','moderate','challenging']);
  const sources=plan.slots.flatMap(s=>s.sourceOptions);
  assert.equal(new Set(sources.map(s=>s.sourceReference.replace(/:\d.*$/,''))).size,9);
  assert.ok(sources.every(s=>s.sourceSha256.length===64));
 }
});
