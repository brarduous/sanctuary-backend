const test=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {createHarness,MEMBER}=require('../helpers/discoveryHarness');
const {loadCorpus,scriptureEvidence,sha}=require('../../utils/discoveryScripture');
const {candidateFromDraft,assessCandidate}=require('../../utils/discoveryAccuracy');
const {reviewFor}=require('../helpers/discoveryAccuracyFixtures');
const {ensureDailySets}=require('../../utils/discoveryDailySets');
const {configFromEnv}=require('../../utils/discoveryCurriculum');
const {localDate}=require('../../utils/discoveries');
const today=localDate(),corpus=loadCorpus();
const config={...configFromEnv({}),maxTokensPerRun:150000};
const refs=['Genesis 9:12-17','Luke 19:1-10','Mark 4:35-41'];
const levels=['easy','moderate','challenging'];
function plan(date){return {version:'discovery-daily-set-plan-v1',date,corpusSha256:corpus.sha256,slots:refs.map((ref,i)=>({position:i+1,targetDifficulty:levels[i],sourceOptions:Array.from({length:3},()=>({sourceReference:ref,sourceSha256:scriptureEvidence(ref).sourceSha256,angle:'Isolated synthetic regression fixture, not production content.'}))}))};}
function contentFor(evidence){
 const ref=evidence.source.locator;
 const [prompt,answer,options,claim]=ref.startsWith('Genesis') ? ['In Genesis, which sign in the clouds marks the covenant?','rainbow',['rainbow','lamp','pillar','star'],'The rainbow is the sign of the covenant.']:ref.startsWith('Luke') ? ['In Luke, what tree did Zacchaeus climb to see Jesus?','sycamore tree',['sycamore tree','olive tree','fig tree','palm tree'],'Zacchaeus climbed a sycamore tree.']:['In Mark, where in the boat was the sleeper during the storm?','stern',['stern','bow','mast','deck'],'The sleeper was in the stern.'];
 return candidateFromDraft({prompt,choices:options.map((text,i)=>({id:'option-'+(i+1),text})),correctOptionId:'option-1',claims:[{id:'claim-1',text:claim}],answerClaimId:'claim-1',explanationClaimIds:['claim-1']},evidence);
}
function reviewed(content,evidence,level){
 return ['test-a','test-b'].map(model=>{
  const r=reviewFor(content,evidence,model,level);
  r.questionCraft={context:2,interest:2,fairChallenge:2,choiceQuality:2,rationale:'Synthetic complete editorial assessment for isolated database tests.'};
  return r;
 });
}
function pair(items){return ['set-a','set-b'].map(model=>({model,responseId:randomUUID(),approved:true,issues:[],rationale:'Synthetic set review covering distinct knowledge targets and no answer leakage.',questionPromptHashes:items.map(i=>sha(i.prompt))}));}
function adapter(h,{rejectFirst=false,rejectSet=false}={}){
 let generated=0;
 return {get generated(){return generated;},async generate({evidence}){generated++;assert.equal((await h.db.query('select * from discovery_daily_set_items')).rows.length,0,'no partial public set');return {content:contentFor(evidence),usage:{totalTokens:10}};},async review({content,evidence}){const level=levels[refs.indexOf(evidence.source.locator)];const rows=reviewed(content,evidence,level);if(rejectFirst && generated===1)rows[0].questionCraft.fairChallenge=1;return rows.map(data=>({data,usage:{totalTokens:10}}));},async reviewSet(items){assert.equal(items.length,3);assert.equal((await h.db.query('select * from discovery_daily_set_items')).rows.length,0);const rows=pair(items);if(rejectSet){rows[1].approved=false;rows[1].issues=['Question two reveals question three.'];}return rows;}};
}
async function run(h,models){return ensureDailySets({db:h.client,models,config,runwayDays:1,maxDaysPerRun:1,planForDate:plan,corpus});}
test('three accepted, distinct, independently rated questions publish atomically; v1 clients remain compatible',async()=>{
 const h=await createHarness({curriculum:true,dailySets:true,listen:true});
 try{
  const m=adapter(h,{rejectFirst:true}),result=await run(h,m);
  assert.equal(result.published,1);assert.equal(result.rejectedAttempts,1);assert.equal(m.generated,4);
  assert.equal((await h.db.query('select * from discovery_daily_set_items')).rows.length,3);
  assert.equal((await run(h,m)).generated,false,'restarting does not regenerate a published set');
  await h.db.exec('update discovery_runtime_settings set enabled=true,rollout_percentage=100');
  const response=await fetch(h.base+'/api/v1/discoveries/bundle?dailySet=1');assert.equal(response.status,200);
  const bundle=await response.json();assert.equal(bundle.items.length,3);assert.deepEqual(bundle.items.map(i=>i.setPosition),[1,2,3]);assert.deepEqual(bundle.items.map(i=>i.difficulty.level),levels);
  assert.equal((await (await fetch(h.base+'/api/v1/discoveries/bundle')).json()).items.length,0,'legacy bundle is not expanded past its contract');
  for(const item of bundle.items)assert.equal((await fetch(h.base+'/api/v1/discoveries/'+item.id)).status,200);
  const events=bundle.items.map((item,i)=>({eventId:randomUUID(),discoveryId:item.id,revision:item.revision,mode:i===2 ? 'revealed':'answered',optionId:i===2 ? null:i===1 ? 'option-2':'option-1',occurredAt:new Date().toISOString(),localDate:today,timeZone:'UTC',elapsedMs:1000}));
  const completed=await fetch(h.base+'/api/v1/discoveries/completions',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+MEMBER},body:JSON.stringify({events})});assert.equal(completed.status,200);
  const results=(await completed.json()).results;assert.deepEqual(results.map(r=>r.completion.outcome),['correct','incorrect','revealed']);assert.deepEqual(results.map(r=>r.completion.set_position),[1,2,3]);
  assert.ok(results.every(r=>r.completion.puzzle_date===today));
  const duplicate=await h.client.rpc('discovery_complete',{p_user:MEMBER,p_events:events});assert.equal(duplicate.error,null);assert.equal((await h.db.query('select * from discovery_completions')).rows.length,3);
  await h.db.query('update discoveries set withdrawn=true where id=$1',[bundle.items[1].id]);
  assert.equal((await (await fetch(h.base+'/api/v1/discoveries/bundle?dailySet=1')).json()).items.length,0,'withdrawal hides the incomplete set');
 }finally{await h.close();}
});
test('final set review can block three individually accepted questions without exposing any of them',async()=>{
 const h=await createHarness({curriculum:true,dailySets:true});try{
  const result=await run(h,adapter(h,{rejectSet:true}));assert.equal(result.published,0);assert.equal(result.exhausted,1);
  assert.equal((await h.db.query('select * from discovery_daily_set_items')).rows.length,0);
  assert.equal((await h.db.query("select * from discovery_daily_attempts where status='accepted'")).rows.length,3);
  const again=await run(h,adapter(h));assert.equal(again.published,0);
 }finally{await h.close();}
});
test('SQL independently rejects forged craft and difficulty labels and client roles cannot invoke workers',async()=>{
 const h=await createHarness({curriculum:true,dailySets:true});try{
  const evidence=scriptureEvidence(refs[0]),content=contentFor(evidence),rows=reviewed(content,evidence,'easy');
  const v=assessCandidate(content,evidence,rows,{dailySet:true,targetDifficulty:'easy'}),rated={...content,difficulty:v.difficulty};
  const args=[rated,v,evidence.sourceSha256,refs[0],corpus.sha256,'easy'];
  await h.db.query('select discovery_validate_set_candidate($1,$2,$3,$4,$5,$6)',args);
  const weak=structuredClone(v);weak.reviews[0].questionCraft.choiceQuality=0;weak.questionCraft.score=6;
  await assert.rejects(h.db.query('select discovery_validate_set_candidate($1,$2,$3,$4,$5,$6)',[rated,weak,...args.slice(2)]));
  await assert.rejects(h.db.query('select discovery_validate_set_candidate($1,$2,$3,$4,$5,$6)',[...args.slice(0,5),'challenging']));
  const forged=structuredClone(v);forged.reviews[0].claims[0].confidence=94;
  await assert.rejects(h.db.query('select discovery_validate_set_candidate($1,$2,$3,$4,$5,$6)',[rated,forged,...args.slice(2)]));
  for(const role of ['anon','authenticated']){
   await h.db.exec('set role '+role);
   await assert.rejects(h.db.query('select discovery_daily_claim($1,$2,$3)',[today,plan(today),randomUUID()]));
   await assert.rejects(h.db.query('select * from discovery_daily_attempts'));
   await h.db.exec('reset role');
  }
 }finally{await h.close();}
});

test('a crashed third attempt remains exhausted and disabling auto-approval is read-only',async()=>{
 const h=await createHarness({curriculum:true,dailySets:true});try{
  const disabled=await ensureDailySets({db:h.client,models:{},config:{...config,autoApprove:false},runwayDays:1});assert.equal(disabled.generated,false);
  assert.equal((await h.db.query('select * from discovery_generation_runs')).rows.length,0);
  const run=randomUUID();await h.db.query('insert into discovery_generation_runs(id,policy_version,corpus_version,corpus_sha256,models) values($1,$2,$3,$4,$5)',[run,'discovery-evidence-v3',corpus.version,corpus.sha256,{}]);
  assert.equal((await h.client.rpc('discovery_daily_claim',{p_date:today,p_plan:plan(today),p_run:run})).error,null);
  for(let i=0;i<3;i++){const began=await h.client.rpc('discovery_daily_begin',{p_date:today,p_position:1,p_run:run,p_source_sha256:scriptureEvidence(refs[0]).sourceSha256});assert.equal(began.data,i+1);}
  assert.ok((await h.client.rpc('discovery_daily_begin',{p_date:today,p_position:1,p_run:run,p_source_sha256:scriptureEvidence(refs[0]).sourceSha256})).error);
  const other=randomUUID();await h.db.query('insert into discovery_generation_runs(id,policy_version,corpus_version,corpus_sha256,models) values($1,$2,$3,$4,$5)',[other,'discovery-evidence-v3',corpus.version,corpus.sha256,{}]);
  assert.equal((await h.client.rpc('discovery_daily_claim',{p_date:today,p_plan:plan(today),p_run:other})).data,null,'another live worker cannot interrupt a third attempt');
  assert.equal((await h.db.query('select status from discovery_daily_jobs')).rows[0].status,'generating');
  assert.equal((await h.client.rpc('discovery_daily_claim',{p_date:today,p_plan:plan(today),p_run:run})).data,null);
  assert.equal((await h.db.query('select status from discovery_daily_jobs')).rows[0].status,'exhausted');
  assert.equal((await h.db.query('select * from discovery_daily_attempts')).rows.length,3);
 }finally{await h.close();}
});
