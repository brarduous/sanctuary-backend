const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID,createHmac}=require('node:crypto');
const {createHarness,seedReviewed,MEMBER}=require('../helpers/discoveryHarness');
const candidates=require('../../content/discoveries/biblical-candidates.json');
const {localDate}=require('../../utils/discoveries');
test('daily metrics validate attribution, pseudonymize accounts, and deduplicate retries',async t=>{
 const previous=process.env.DISCOVERY_METRICS_SALT;process.env.DISCOVERY_METRICS_SALT='isolated-test-only';
 t.after(()=>{if(previous===undefined)delete process.env.DISCOVERY_METRICS_SALT;else process.env.DISCOVERY_METRICS_SALT=previous;});
 const h=await createHarness({listen:true});t.after(()=>h.close());await seedReviewed(h,candidates[0]);
 const metric={eventId:randomUUID(),discoveryId:candidates[0].id,event:'set_opened',platform:'mobile',entrySource:'home',sessionId:randomUUID(),installationId:randomUUID(),setDate:localDate()};
 const send=body=>fetch(h.base+'/api/v1/discoveries/metrics',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${MEMBER}`},body:JSON.stringify(body)});
 assert.equal((await send(metric)).status,204);assert.equal((await send(metric)).status,204);
 const rows=(await h.db.query('select * from discovery_metrics')).rows;assert.equal(rows.length,1);assert.equal(rows[0].entry_source,'home');assert.equal(rows[0].player_key,createHmac('sha256','isolated-test-only').update('account:'+MEMBER).digest('hex'));assert.ok(!JSON.stringify(rows).includes(MEMBER));assert.ok(!JSON.stringify(rows).includes(metric.installationId));
 for(const patch of [{entrySource:'made_up'},{sessionId:'invalid'},{setDate:'2099-01-01'}])assert.equal((await send({...metric,eventId:randomUUID(),...patch})).status,400);
});
