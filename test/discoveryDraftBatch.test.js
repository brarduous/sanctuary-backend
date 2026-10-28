const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {main}=require('../scripts/discoveries/draftBatch');
const {draftFor,reviewFor}=require('./helpers/discoveryAccuracyFixtures');

test('offline batch uses the live adapters/gates, retains provenance, retries criticism, and resumes without new calls',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'sanctuary-discovery-batch-'));
 try {
  const plan=path.join(dir,'plan.json'),output=path.join(dir,'drafts.json');
  await fs.writeFile(plan,JSON.stringify([{slug:'test-rainbow',sourceReference:'Genesis 9:13-16',targetDifficulty:'easy',angle:'A synthetic integration fixture, never production content.'}]));
  let calls=0;const feedback=[];
  const models={async generate({evidence,failures}){calls++;feedback.push(failures);return {content:draftFor(evidence),model:'test-writer',responseId:`synthetic-writer-${calls}`,usage:{totalTokens:1}};},async review({content,evidence}){
   const rows=[reviewFor(content,evidence),reviewFor(content,evidence,'test-verifier-b')];
   if(calls===1){rows[1].questionCraft.choiceQuality=0;rows[1].unresolvedIssues=['Use plausible parallel choices instead of mismatched phrases.'];}
   return rows.map(data=>({data,model:data.model,responseId:data.responseId,usage:{totalTokens:1}}));
  }};
  const config={generatorModel:'test-writer',reviewModels:['test-verifier-a','test-verifier-b'],minimumScore:95};
  const args=['--plan',plan,'--count','1','--concurrency','1','--output',output];
  await main(args,{models,config});assert.equal(calls,0);await assert.rejects(fs.stat(output),{code:'ENOENT'});
  await main([...args,'--live'],{models,config});
  const drafts=JSON.parse(await fs.readFile(output));assert.equal(drafts.length,1);assert.equal(drafts[0].verification.humanReviewStatus,'pending');assert.equal(drafts[0].verification.writerResponseId,'synthetic-writer-2');assert.equal(drafts[0].verification.reviewResponseIds.length,2);assert.equal(drafts[0].verification.automatedReviewStatus,'passed');
  assert.ok(feedback[1].includes('Use plausible parallel choices instead of mismatched phrases.'));
  await main([...args,'--live','--resume'],{models,config});assert.equal(calls,2);assert.equal(JSON.parse(await fs.readFile(output))[0].id,drafts[0].id);
  const audit=JSON.parse(await fs.readFile(output.replace('.json','.audit.json')));assert.deepEqual(audit.items[0].attempts.map(row=>row.status),['rejected','accepted']);assert.equal(audit.noDatabaseWrites,true);assert.ok(audit.promptHashes.writer);assert.equal(audit.totalTokens,6);
 } finally {await fs.rm(dir,{recursive:true,force:true});}
});
