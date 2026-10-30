const test=require('node:test');
const assert=require('node:assert/strict');
const {scriptureEvidence,contextualEvidence,loadCorpus}=require('../utils/discoveryScripture');
const {MIN_SCORE,assessCandidate,deterministicChecks}=require('../utils/discoveryAccuracy');
const {validateDifficulty,consensusDifficulty,levelFor}=require('../utils/discoveryDifficulty');
const {buildWeekPlan}=require('../utils/discoveryCurriculumPlan');
const {configFromEnv}=require('../utils/discoveryCurriculum');
const {draftFor,reviewFor,modelReviewFor}=require('./helpers/discoveryAccuracyFixtures');
const {precisionLowerBound,summarizeEvaluation}=require('../utils/discoveryCalibration');
const {createDiscoveryModels}=require('../utils/discoveryModels');
const evidence=scriptureEvidence('Genesis 9:13-16');
const content=draftFor(evidence);
const reviews=()=>[reviewFor(content,evidence),reviewFor(content,evidence,'test-verifier-b')];
test('wordy questions and factoids fail before evidence review; every curated item meets the copy budget',()=>{
 const {copyIssues}=require('../utils/discoveryCopy');
 const entries=require('../content/discoveries/biblical-candidates.json');
 for(const entry of entries)assert.deepEqual(copyIssues(entry.content),[],entry.slug);
 let c=structuredClone(content);c.prompt='According to Genesis 9, what '+Array(22).fill('detail').join(' ')+'?';
 assert.ok(deterministicChecks(c,evidence).includes('question_too_wordy'));
 c=structuredClone(content);c.claims[0].text=Array(31).fill('word').join(' ');
 assert.ok(deterministicChecks(c,evidence).includes('factoid_too_wordy'));
});
test('a fully sourced candidate passes with separate assessed difficulty',()=>{
 const result=assessCandidate(content,evidence,reviews(),{targetDifficulty:'challenging'});
 assert.equal(result.accepted,true);assert.equal(result.evidenceScore,99);assert.equal(result.difficulty.level,'easy');assert.equal(result.difficultyTargetMet,false,'a curriculum target must never inflate the label');
});
test('source integrity tolerates database object key ordering but rejects changed source values',()=>{
 const reordered=structuredClone(content);reordered.sources[0]=Object.fromEntries(Object.entries(reordered.sources[0]).reverse());
 assert.deepEqual(deterministicChecks(reordered,evidence),[]);
 reordered.sources[0].url='https://example.invalid/different-source';
 assert.ok(deterministicChecks(reordered,evidence).includes('source_integrity'));
});
test('daily difficulty is a separate blinded closed-book task with independently bound response IDs',async()=>{
 const calls=[];
 const client={responses:{async create(request){
  const input=JSON.parse(request.input);assert.equal(input.candidate.correctOptionId,undefined);assert.equal(input.candidate.difficulty,undefined);assert.equal(input.targetDifficulty,undefined);
  calls.push(request.text.format.name);
  const data=request.text.format.name==='discovery_closed_book_difficulty' ? {familiarity:0,evidenceNavigation:0,reasoningSteps:0,distractorSimilarity:1,rationale:'A familiar image; no additional knowledge connections are required.'}:modelReviewFor(content,evidence,request.model);
  return {status:'completed',model:request.model,id:request.text.format.name+'-'+request.model,output_text:JSON.stringify(data),usage:{input_tokens:10,output_tokens:10,total_tokens:20}};
 }}};
 const adapter=createDiscoveryModels({generatorModel:'writer',reviewModels:['test-a','test-b'],client});
 const result=await adapter.review({content,evidence,dailySet:true});
 assert.equal(calls.filter(name=>name==='discovery_verification').length,2);assert.equal(calls.filter(name=>name==='discovery_closed_book_difficulty').length,2);
 assert.equal(result[0].usage.totalTokens,40);assert.ok(result[0].data.verificationDifficulty);
 assert.equal(result[0].data.difficultyAssessment.rubricVersion,'discovery-difficulty-v2');
 assert.notEqual(result[0].data.responseId,result[0].data.difficultyAssessment.responseId);
 const assessed=assessCandidate(content,evidence,result.map(r=>r.data),{dailySet:true,targetDifficulty:'easy'});assert.equal(assessed.accepted,true);
 result[0].data.difficultyAssessment.questionPromptSha256='changed';assert.ok(assessCandidate(content,evidence,result.map(r=>r.data),{dailySet:true,targetDifficulty:'easy'}).reasons.includes('daily_difficulty_review_missing'));
});
test('one score of 94 rejects even when every other score is 100; 95 is inclusive',()=>{
 const r=reviews();r[0].claims[0].confidence=94;
 assert.equal(assessCandidate(content,evidence,r).accepted,false);assert.equal(assessCandidate(content,evidence,r).evidenceScore,94);
 r[0].claims[0].confidence=95;assert.equal(assessCandidate(content,evidence,r).accepted,true);
});
for(const [name,mutate] of [
 ['contradicted claim',r=>{r[0].claims[0].status='contradicted';}],
 ['uncertain claim',r=>{r[0].claims[0].status='uncertain';}],
 ['omitted claim',r=>{r[0].claims=[];}],
 ['second valid option',r=>{r[0].options[1].status='supported';}],
 ['ambiguous option',r=>{r[1].options[2].status='ambiguous';}],
 ['missing option',r=>{r[1].options.pop();}],
 ['wrong independently solved key',r=>{r[1].solvedOptionId='option-4';}],
 ['fabricated supporting quotation',r=>{r[0].claims[0].evidence[0].quote='A quotation which is not in Genesis.';}],
 ['correct quotation with an incorrect verse ID',r=>{r[0].claims[0].evidence[0].verseNumber=999;}],
 ['unresolved issue',r=>{r[1].unresolvedIssues=['Requires a disputed interpretation'];}],
 ['complex historical assertion',r=>{r[0].simpleTextualFact=false;}],
 ['same reviewer model twice',r=>{r[1].model=r[0].model;}],
 ['fractional score',r=>{r[0].questionAccuracy=99.5;}],
 ['difficulty disagreement',r=>{r[1].difficulty={familiarity:2,evidenceNavigation:2,reasoningSteps:2,distractorSimilarity:2,rationale:'Much more difficult according to every component.'};}],
])test(`${name} is rejected, without averaging it away`,()=>{
 const r=reviews();mutate(r);assert.equal(assessCandidate(content,evidence,r).accepted,false);
});
test('source drift, non-textual scope, negative questions, and duplicates fail deterministic checks',()=>{
 let c=structuredClone(content);c.sources[0].excerpt+=' Invented text.';assert.ok(deterministicChecks(c,evidence).includes('source_integrity'));
 c=structuredClone(content);c.prompt='According to Genesis 9, which sign is NOT set in the cloud?';assert.ok(deterministicChecks(c,evidence).includes('disputed_or_negative_question'));
 assert.ok(deterministicChecks(content,evidence,{recent:[content]}).includes('duplicate_question'));
 c=structuredClone(content);c.choices[0].text='Rain';assert.ok(deterministicChecks(c,evidence).includes('answer_not_explicit_in_text'),'a substring is not a literal answer phrase');
});
test('missing textual-variant verses are refused, never completed from model memory',()=>{
 const corpus=loadCorpus();assert.equal(corpus.omittedVerses.length,5);
 for(const reference of corpus.omittedVerses)assert.throws(()=>scriptureEvidence(reference),/missing verse/);
 assert.ok(scriptureEvidence('Acts 24').source.locator.endsWith(':1-6'));
 assert.ok(contextualEvidence('Genesis 9:13').source.locator.endsWith(':8-19'));
});
test('difficulty bands and per-dimension validation are stable',()=>{
 assert.deepEqual([0,2,3,5,6,8].map(levelFor),['easy','easy','moderate','moderate','challenging','challenging']);
 assert.throws(()=>validateDifficulty({familiarity:3,evidenceNavigation:0,reasoningSteps:0,distractorSimilarity:0,rationale:'An invalid score outside the rubric.'}));
 assert.equal(consensusDifficulty(reviews()).level,'easy');
});
test('all 52 curriculum weeks resolve source passages and the planned difficulty mix',()=>{
 for(let week=0;week<52;week++) {
  const date=new Date(Date.parse('2026-10-26')+week*7*86400000).toISOString().slice(0,10);
  const plan=buildWeekPlan(date);assert.equal(plan.days.length,7);
  assert.equal(plan.days.filter(day=>day.targetDifficulty==='easy').length,3);
  assert.equal(plan.days.filter(day=>day.targetDifficulty==='moderate').length,3);
  assert.equal(plan.days.filter(day=>day.targetDifficulty==='challenging').length,1);
  for(const day of plan.days)assert.equal(scriptureEvidence(day.sourceReference).sourceSha256,day.sourceSha256);
 }
});
test('the minimum score cannot be weakened below 95 and reviewers cannot share a model',()=>{
 assert.equal(MIN_SCORE,95);assert.equal(configFromEnv({}).autoApprove,true);
 assert.throws(()=>configFromEnv({DISCOVERY_MIN_EVIDENCE_SCORE:'94'}));
 assert.throws(()=>configFromEnv({DISCOVERY_VERIFIER_MODEL:'same',DISCOVERY_ADVERSARIAL_MODEL:'same'}));
});
test('a small perfect sample is not mislabeled as measured 95-percent precision',()=>{
 assert.ok(precisionLowerBound(20,20)<0.95);
 assert.ok(precisionLowerBound(100,100)>0.95);
 assert.equal(summarizeEvaluation(Array.from({length:20},(_,i)=>({id:String(i),expected:'accept',actual:'accept'}))).meets95PercentPrecisionEvidence,false);
 assert.deepEqual(summarizeEvaluation([{id:'unsupported-fact',expected:'reject',actual:'accept'}]).falseAccepts,['unsupported-fact']);
});
test('verifiers use strict JSON, hide the answer key and target difficulty, and reject incomplete responses',async()=>{
 const calls=[];
 const client={responses:{async create(request,options){calls.push({request,options});return {status:'completed',model:request.model,id:'test-model-response',output_text:JSON.stringify(modelReviewFor(content,evidence,request.model)),usage:{total_tokens:10}};}}};
 const adapter=createDiscoveryModels({generatorModel:'writer',reviewModels:['reviewer-a','reviewer-b'],client});
 const reviewed=await adapter.review({content,evidence});assert.equal(reviewed.length,2);assert.equal(calls.length,2);
 for(const {request,options} of calls) {
  const input=JSON.parse(request.input);assert.deepEqual(request.text.format.schema.properties.claims.items.properties.evidence.items.properties.verseNumber.enum,evidence.verses.map(verse=>verse.verseNumber));assert.equal(input.candidate.correctOptionId,undefined);assert.equal(input.candidate.answerClaimId,undefined);assert.equal(input.candidate.difficulty,undefined);assert.equal(input.targetDifficulty,undefined);
  assert.equal(request.text.format.strict,true);assert.equal(request.store,false);assert.equal(options.maxRetries,0);
 }
 const interrupted=createDiscoveryModels({generatorModel:'writer',reviewModels:['reviewer-a','reviewer-b'],client:{responses:{async create(){return {status:'incomplete',output_text:JSON.stringify(reviewFor(content,evidence))};}}}});
 await assert.rejects(interrupted.review({content,evidence}),/did not complete/);
});

test('context-first wording keeps its biblical frame without a forced chapter prefix',()=>{
 const c=structuredClone(content);c.prompt='In Genesis, which colorful sign marks a covenant with every living creature?';
 assert.deepEqual(deterministicChecks(c,evidence),[]);
 c.prompt='Which colorful sign marks a covenant with every living creature?';
 assert.ok(deterministicChecks(c,evidence).includes('invalid_content'));
});
test('bare verse lookups and answer giveaways are rejected before model review',()=>{
 let c=structuredClone(content);c.prompt='According to Genesis 9, what happens in verse 13?';
 assert.ok(deterministicChecks(c,evidence).includes('bare_verse_lookup'));
 c.prompt='In Genesis, what covenant sign is the rainbow?';
 assert.ok(deterministicChecks(c,evidence).includes('answer_given_in_question'));
});
test('accuracy does not compensate for weak writing or unverified contextual clues',()=>{
 for(const mutate of [
   r=>{delete r[0].questionCraft;},
   r=>{r[0].questionCraft.context=0;},
   r=>{r[1].questionCraft={context:1,interest:1,fairChallenge:1,choiceQuality:1,rationale:'Adequate individual dimensions still do not meet the total requirement.'};},
   r=>{r[0].questionPremises=[];},
   r=>{r[1].questionPremises[0].status='unsupported';},
   r=>{r[1].questionPremises[0].confidence=94;},
   r=>{r[0].questionPremises[0].evidence[0].quote='A fabricated context detail.';},
 ]) {const r=reviews();mutate(r);assert.equal(assessCandidate(content,evidence,r).accepted,false);}
 const result=assessCandidate(content,evidence,reviews());assert.equal(result.accepted,true);assert.equal(result.questionCraft.score,7);assert.equal(result.policyVersion,'discovery-evidence-v3');
});

test('retry feedback includes concrete editorial criticism without lowering factual thresholds',()=>{
 const {retryFeedback}=require('../utils/discoveryAccuracy');
 const r=reviews();r[1].questionCraft.choiceQuality=0;r[1].unresolvedIssues=['The alternatives are quotations rather than removable items.'];
 const assessment=assessCandidate(content,evidence,r);
 const feedback=retryFeedback(assessment,assessment.reasons);
 assert.ok(feedback.includes('The alternatives are quotations rather than removable items.'));
 assert.equal(assessment.accepted,false);assert.equal(assessment.minimumScore,95);
});

test('reviewer citations are assembled from trusted verse IDs and verdict confidence is normalized',async()=>{
 let outside=false;
 const client={responses:{async create(request){const raw=modelReviewFor(content,evidence,request.model);if(outside)raw.claims[0].evidence[0].verseNumber=999;return {status:'completed',model:request.model,id:'synthetic-review',output_text:JSON.stringify(raw)};}}};
 const adapter=createDiscoveryModels({generatorModel:'test-writer',reviewModels:['test-a','test-b'],client});
 const result=await adapter.review({content,evidence});
 assert.equal(result[0].data.options[1].status,'not_supported');assert.equal(result[0].data.options[1].confidence,99);assert.equal(result[0].data.options[1].verdictConfidence,undefined);
 assert.equal(result[0].data.claims[0].evidence[0].quote,evidence.verses[0].text);
 outside=true;const invalid=await adapter.review({content,evidence});assert.equal(invalid[0].data.claims[0].evidence[0].quote,'');assert.equal(assessCandidate(content,evidence,invalid.map(row=>row.data)).accepted,false);
});

test('app/corpus validation shares whitespace-only canonicalization without concealing changed words',()=>{
 const {canonicalVerseText}=require('../utils/discoveryScripture');
 assert.equal(canonicalVerseText('<span>He said &quot;Go.&quot;  Immediately</span>'),'He said "Go." Immediately');
 assert.equal(canonicalVerseText('A &apos;word&apos;'),'A \'word\'');
 assert.notEqual(canonicalVerseText('He was well.'),canonicalVerseText('He was ill.'));
});

test('narrative planning does not force a devotional psalm into trivia and precommits three source choices',()=>{
 const plan=buildWeekPlan('2026-10-26',{devotionals:[{date:'2026-10-28',scripture_reference:'Psalms 51:10'}]});
 const day=plan.days.find(row=>row.date==='2026-10-28');
 assert.equal(day.devotionalAligned,false);assert.equal(day.sourceReference,'John 11:32-44');
 for(const item of plan.days){assert.equal(item.sourceOptions.length,3);assert.equal(new Set(item.sourceOptions.map(row=>row.sourceReference)).size,3);for(const option of item.sourceOptions)assert.equal(scriptureEvidence(option.sourceReference).sourceSha256,option.sourceSha256);}
 const aligned=buildWeekPlan('2026-10-26',{devotionals:[{date:'2026-10-28',scripture_reference:'Luke 19:5'}]}).days.find(row=>row.date==='2026-10-28');
 assert.equal(aligned.devotionalAligned,true);assert.match(aligned.sourceReference,/^Luke 19:/);
});
