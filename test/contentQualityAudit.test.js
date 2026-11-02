const test=require('node:test'),assert=require('node:assert/strict');
const {contentQualityAudit}=require('../services/contentQualityAudit');
const {createDatabase,A}=require('./helpers/accountHarness');
test('content audit saves grades and source hashes, leaves empty areas unmeasured and never writes source content',async()=>{
 const db=createDatabase();db.tables.daily_prayers=[{prayer_id:1,user_id:A,status:'completed',created_at:'2026-11-01',generated_prayer:'God, help us love our neighbors today.'}];
 const before=JSON.stringify(db.tables.daily_prayers);
 const client={chat:{completions:{create:async request=>({id:'review',model:request.model,choices:[{finish_reason:'stop',message:{content:JSON.stringify({reviews:JSON.parse(request.messages[1].content).samples.map(sample=>({id:sample.id,helpfulness:85,accuracy:95,audience:90,freshness:80,seriousConcern:false,evidence:['Specific compassionate prayer.']}))})}}]})}}};
 const report=await contentQualityAudit({db,now:new Date('2026-11-02'),client});
 assert.equal(report.content.prayers.status,'editorially_graded');assert.equal(report.content.prayers.sampleRefs[0].sourceId,'1');assert.match(report.content.prayers.sampleRefs[0].contentSha256,/^[a-f0-9]{64}$/);assert.equal(report.content.guidance.status,'unmeasured');assert.equal(JSON.stringify(db.tables.daily_prayers),before);assert.ok(!JSON.stringify(report).includes(A));
 const failed=await contentQualityAudit({db,now:new Date('2026-11-02'),client:{chat:{completions:{create:async()=>{throw Error('Provider unavailable');}}}}});
 assert.equal(failed.content.prayers.status,'unmeasured');assert.equal(failed.content.prayers.measurementError,true);assert.equal(failed.releaseGate,'needs_attention');
});
