const test=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {createHarness,seedReviewed,ADMIN,MEMBER,OTHER}=require('../helpers/discoveryHarness');
const {validateContent,validateReview,localDate,shiftDate,publicDiscovery}=require('../../utils/discoveries');
const candidates=require('../../content/discoveries/biblical-candidates.json');
let h;
const today=localDate();
async function request(path,{user=ADMIN,method='GET',body,headers={}}={}) {
 const response=await fetch(h.base+path,{method,headers:{...(user ? {Authorization:`Bearer ${user}`} : {}),'Content-Type':'application/json',...headers},...(body ? {body:JSON.stringify(body)}:{})});
 const raw=await response.text();
 return {response,body:raw && response.headers.get('content-type')?.includes('json') ? JSON.parse(raw) : raw || null};
}
function event(entry=candidates[0],overrides={}) {return {eventId:randomUUID(),discoveryId:entry.id,revision:1,mode:'answered',optionId:entry.content.correctOptionId,occurredAt:new Date().toISOString(),localDate:today,timeZone:'UTC',...overrides};}
test.before(async()=>{h=await createHarness({listen:true});});
test.after(async()=>{await h.close();});
test('content validation requires scoped, fully sourced, unambiguous structures',()=>{
 const copy=()=>structuredClone(candidates[0].content);
 assert.doesNotThrow(()=>validateContent(copy()));
 let c=copy();c.claims[0].sourceIds=['invented'];assert.throws(()=>validateContent(c),/claim/);
 c=copy();c.choices[1].text=c.choices[0].text;assert.throws(()=>validateContent(c),/distinct/);
 c=copy();c.sources[0].url='javascript:alert(1)';assert.throws(()=>validateContent(c),/HTTPS/);
 c=copy();c.prompt='An undisputed historical fact about Noah';assert.throws(()=>validateContent(c),/Biblical/);
 c=copy();c.kind='historical';assert.throws(()=>validateContent(c),/independent scholarly/);
 c.sources.push({...c.sources[0],id:'primary-record',type:'primary',publisher:'Primary test archive'},{...c.sources[0],id:'scholarship',type:'scholarly',publisher:'Independent test publisher'});
 assert.throws(()=>validateContent(c),/Every historical claim/,'unused sources cannot satisfy the evidence requirement');
 c.claims.forEach(claim=>{claim.sourceIds=['primary-record','scholarship'];});assert.doesNotThrow(()=>validateContent(c));
 c=copy();c.kind='tradition';assert.throws(()=>validateContent(c),/explicit label/);
 assert.throws(()=>validateReview({note:'An automated process says this looks right.'}),/human reviewer/);
});
test('visibility is off by default; non-admins cannot import, approve, schedule, or enable it',async()=>{
 const {body}=await request('/api/v1/discoveries/bundle',{user:null});assert.equal(body.enabled,false);assert.deepEqual(body.items,[]);
 for(const [path,payload] of [['/import',candidates[0]],[`/${candidates[0].id}/approve`,{}],[`/${candidates[0].id}/schedule`,{}],['/settings',{}]]) {
  assert.equal((await request('/admin/discoveries'+path,{user:MEMBER,method:'POST',body:payload})).response.status,403);
  assert.equal((await request('/admin/discoveries'+path,{user:null,method:'POST',body:payload})).response.status,401);
 }
});
test('drafts cannot be scheduled or exposed, even with a visibility flag',async()=>{
 const draft=candidates[1];
 assert.equal((await request('/admin/discoveries/import',{method:'POST',body:draft})).response.status,201);
 const schedule=await h.client.rpc('discovery_schedule_item',{p_id:draft.id,p_revision:1,p_date:shiftDate(today,1),p_actor:ADMIN});assert.ok(schedule.error);
 assert.equal((await request(`/api/v1/discoveries/${draft.id}`,{user:null})).response.status,404);
 const denied=await h.client.rpc('discovery_import',{p_id:draft.id,p_slug:draft.slug,p_content:draft.content,p_actor:MEMBER});assert.equal(denied.error.code,'42501');
});
test('released content projects no reviewer identity, editorial note, or draft fields',async()=>{
 await seedReviewed(h,candidates[0]);
 await request('/admin/discoveries/settings',{method:'POST',body:{enabled:true,rolloutPercentage:100,internalUserIds:[]}});
 const {body,response}=await request('/api/v1/discoveries/bundle?timeZone=UTC',{user:null});assert.equal(response.status,200);assert.equal(body.enabled,true);assert.equal(body.items.length,1);
 assert.equal(body.items[0].id,candidates[0].id);assert.equal(body.items[0].sources[0].excerpt,candidates[0].content.sources[0].excerpt);
 const json=JSON.stringify(body);assert.ok(!json.includes('reviewer_id'));assert.ok(!json.includes('Synthetic test approval'));assert.ok(!json.includes('created_by'));
 assert.equal((await request('/api/v1/discoveries/bundle?timeZone=UTC',{user:null,headers:{'If-None-Match':response.headers.get('etag')}})).response.status,304);
 const preview=await request(`/admin/discoveries/${candidates[0].id}/revisions/1`);assert.equal(preview.body.preview.id,candidates[0].id);
});
test('future approved content is prefetchable but cannot be shared or completed yet',async()=>{
 await seedReviewed(h,candidates[2],shiftDate(today,3));
 const bundle=await request('/api/v1/discoveries/bundle',{user:null});assert.ok(bundle.body.items.some(item=>item.id===candidates[2].id));
 assert.equal((await request(`/api/v1/discoveries/${candidates[2].id}`,{user:null})).response.status,404);
 const result=await request('/api/v1/discoveries/completions',{user:MEMBER,method:'POST',body:{events:[event(candidates[2])]}});assert.equal(result.body.results[0].status,'unavailable');
});
test('completion is idempotent and first accepted answer is canonical across devices',async()=>{
 const first=event();
 const a=await request('/api/v1/discoveries/completions',{user:MEMBER,method:'POST',body:{userId:OTHER,events:[first]}});assert.equal(a.response.status,200);assert.equal(a.body.results[0].completion.user_id,MEMBER);
 const second=event(candidates[0],{mode:'revealed',optionId:null});
 for(const e of [first,second]){
  const r=await request('/api/v1/discoveries/completions',{user:MEMBER,method:'POST',body:{events:[e]}});assert.equal(r.body.results[0].completion.event_id,first.eventId);assert.equal(r.body.results[0].completion.mode,'answered');
 }
 assert.equal((await request('/api/v1/discoveries/progress',{user:MEMBER})).body.total,1);
 assert.equal((await request('/api/v1/discoveries/progress',{user:OTHER})).body.total,0);
 assert.equal((await request('/api/v1/discoveries/progress',{user:null})).response.status,401);
});
test('invalid batch and option IDs fail without creating a completion',async()=>{
 for(const e of [event(candidates[0],{optionId:'invented'}),event(candidates[0],{timeZone:'not-a-zone'}),event(candidates[0],{timeZone:undefined})]) {
  const r=await request('/api/v1/discoveries/completions',{user:OTHER,method:'POST',body:{events:[e]}});assert.ok(r.response.status>=400);
 }
 assert.equal((await request('/api/v1/discoveries/progress',{user:OTHER})).body.total,0);
});
test('an approved correction is immutable and old released revisions can still sync',async()=>{
 const corrected=structuredClone(candidates[0]);corrected.content.heading='The sign Genesis describes';
 await seedReviewed(h,corrected,today,2);
 const r=await request(`/api/v1/discoveries/${corrected.id}`,{user:null});assert.equal(r.body.discovery.revision,2);
 const old=await request('/api/v1/discoveries/completions',{user:OTHER,method:'POST',body:{events:[event()]}});assert.equal(old.body.results[0].status,'accepted');
 await assert.rejects(h.db.query('update discovery_revisions set content=$1 where discovery_id=$2 and revision=1',[corrected.content,corrected.id]),/immutable/);
 await assert.rejects(h.db.query('update discovery_reviews set note=$1 where discovery_id=$2 and revision=1',['Changed without a new review, which is not allowed.',corrected.id]),/immutable/);
});
test('reports are persisted for editorial follow-up; metrics exclude identity',async()=>{
 const report=await request(`/api/v1/discoveries/${candidates[0].id}/reports`,{user:null,method:'POST',body:{revision:1,reason:'Please recheck the passage and its interpretation.'}});assert.equal(report.response.status,201);
 const metricId=randomUUID();for(let i=0;i<2;i++)assert.equal((await request('/api/v1/discoveries/metrics',{user:null,method:'POST',body:{eventId:metricId,discoveryId:candidates[0].id,event:'share_initiated',platform:'web',userId:MEMBER}})).response.status,204);
 const metrics=await h.db.query('select * from discovery_metrics');assert.equal(metrics.rows.length,1);assert.ok(!('user_id' in metrics.rows[0]));
});
test('withdrawal removes cached-bundle eligibility and denies direct public reads',async()=>{
 assert.equal((await request(`/admin/discoveries/${candidates[0].id}/withdraw`,{method:'POST',body:{notice:'Withdrawn while the source context is checked.'}})).response.status,200);
 assert.equal((await request(`/api/v1/discoveries/${candidates[0].id}`,{user:null})).response.status,410);
 const bundle=await request('/api/v1/discoveries/bundle',{user:null});assert.ok(bundle.body.withdrawnIds.includes(candidates[0].id));assert.ok(!bundle.body.items.some(item=>item.id===candidates[0].id));
});
test('restoration requires a new human-reviewed revision and a public correction notice',async()=>{
 assert.equal((await request(`/admin/discoveries/${candidates[0].id}/restore`,{method:'POST',body:{revision:2,notice:'Restored with a checked source and clearer wording.'}})).response.status,400);
 const corrected=structuredClone(candidates[0]);corrected.content.heading='The covenant sign in Genesis';
 const imported=await request('/admin/discoveries/import',{method:'POST',body:corrected});assert.equal(imported.body.revision,3);
 const attestations={sourcesReadInContext:true,everyClaimSupported:true,oneUnambiguousAnswer:true,scopeAndUncertaintyAccurate:true,rightsChecked:true};
 assert.equal((await request(`/admin/discoveries/${corrected.id}/approve`,{method:'POST',body:{revision:3,attestations,note:'Synthetic test approval after a correction, used only for isolated testing.'}})).response.status,200);
 assert.equal((await request(`/admin/discoveries/${corrected.id}/restore`,{method:'POST',body:{revision:3,notice:'Restored with a checked source and clearer wording.'}})).response.status,200);
 const released=await request(`/api/v1/discoveries/${corrected.id}`,{user:null});assert.equal(released.body.discovery.revision,3);assert.match(released.body.discovery.correctionNotice,/Restored/);
});
test('direct-client roles cannot read private content, progress, reviews, or invoke editorial RPCs',async()=>{
 for(const role of ['anon','authenticated']) {
  await h.db.exec(`set role ${role}`);
  try {
   for(const table of ['discoveries','discovery_revisions','discovery_reviews','discovery_completions','discovery_schedule','discovery_runtime_settings','discovery_issue_reports']) await assert.rejects(h.db.query(`select * from ${table}`),/permission denied/);
   await assert.rejects(h.db.query('select discovery_import($1,$2,$3,$4)',[candidates[0].id,candidates[0].slug,candidates[0].content,ADMIN]),/permission denied/);
  } finally {await h.db.exec('reset role');}
 }
});
test('account deletion cascades private completion history',async()=>{
 await h.db.query('delete from auth.users where id=$1',[MEMBER]);
 assert.equal((await h.db.query('select * from discovery_completions where user_id=$1',[MEMBER])).rows.length,0);
});
test('the additive migration has an executable rollback',async()=>{
 const fs=require('node:fs'),path=require('node:path');
 await h.db.exec(fs.readFileSync(path.join(__dirname,'../../supabase/rollbacks/20261028120000.sql'),'utf8'));
 assert.equal((await h.db.query("select to_regclass('public.discovery_revisions') as table_name")).rows[0].table_name,null);
 assert.equal((await h.db.query("select to_regclass('public.user_profiles') as table_name")).rows[0].table_name,'user_profiles');
});

test('timed results are derived by SQL, first completion remains canonical, and the game migration rolls back',async()=>{
 const game=await createHarness({listen:true});
 try {
  await seedReviewed(game,candidates[0]);
  const send=async(user,e)=>{
   const r=await fetch(game.base+'/api/v1/discoveries/completions',{method:'POST',headers:{Authorization:`Bearer ${user}`,'Content-Type':'application/json'},body:JSON.stringify({events:[e]})});
   return {status:r.status,body:await r.json()};
  };
  const first=event(candidates[0],{elapsedMs:1234,outcome:'incorrect',puzzleDate:'2000-01-01'});
  let r=await send(MEMBER,first);assert.equal(r.status,200);
  assert.equal(r.body.results[0].completion.outcome,'correct');assert.equal(r.body.results[0].completion.elapsed_ms,1234);assert.equal(r.body.results[0].completion.puzzle_date,today);
  r=await send(MEMBER,event(candidates[0],{elapsedMs:9999}));assert.equal(r.body.results[0].completion.elapsed_ms,1234);
  r=await send(OTHER,event(candidates[0],{optionId:candidates[0].content.choices.find(c=>c.id!==candidates[0].content.correctOptionId).id,elapsedMs:3210,outcome:'correct'}));
  assert.equal(r.body.results[0].completion.outcome,'incorrect');
  r=await send(ADMIN,event(candidates[0],{mode:'revealed',optionId:null,elapsedMs:20000,timedOut:true}));assert.equal(r.body.results[0].completion.outcome,'timeout');
  for(const elapsedMs of [-1,20000,20001,1.5])assert.equal((await send(MEMBER,event(candidates[0],{elapsedMs}))).status,400);
  assert.equal((await send(MEMBER,event(candidates[0],{elapsedMs:1000,timedOut:true}))).status,400);
  const direct=await game.client.rpc('discovery_complete',{p_user:MEMBER,p_events:[event(candidates[0],{elapsedMs:20001})]});assert.ok(direct.error,'direct RPC cannot bypass the timer limit');
  await game.db.exec(require('node:fs').readFileSync(require('node:path').join(__dirname,'../../supabase/rollbacks/20261028200000.sql'),'utf8'));
  const columns=await game.db.query("select column_name from information_schema.columns where table_name='discovery_completions' and column_name in ('elapsed_ms','outcome','puzzle_date')");assert.equal(columns.rows.length,0);
 } finally {await game.close();}
});
