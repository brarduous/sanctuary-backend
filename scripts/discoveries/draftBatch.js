// Uses the cron's actual model adapters and acceptance gates, with no DB connection.
const fs=require('node:fs/promises');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {createDiscoveryModels,WRITER_VERSION,WRITER,REVIEWER}=require('../../utils/discoveryModels');
const {configFromEnv,safeFailure}=require('../../utils/discoveryCurriculum');
const {scriptureEvidence,loadCorpus,sha}=require('../../utils/discoveryScripture');
const {deterministicChecks,assessCandidate,retryFeedback,POLICY}=require('../../utils/discoveryAccuracy');
const {validateContent}=require('../../utils/discoveries');

function expandReference(reference) {
 if(reference==='John 11:35')return 'John 11:32-44';
 const original=scriptureEvidence(reference);
 const match=original.source.locator.match(/^(.+?) (\d+):(\d+)(?:-(\d+))?$/);
 const chapter=loadCorpus().books.find(book=>book.name===match[1]).chapters.find(chapter=>chapter.number===Number(match[2]));
 let start=Number(match[3]),end=Number(match[4] || match[3]);
 while(start>Math.max(1,Number(match[3])-3) && chapter.verses.some(verse=>verse.number===start-1))start--;
 while(end<start+11 && chapter.verses.some(verse=>verse.number===end+1))end++;
 return `${match[1]} ${match[2]}:${start}-${end}`;
}
async function main(args=process.argv.slice(2),{models,config=configFromEnv()}={}) {
 const arg=(name,fallback)=>{const i=args.indexOf(name);return i<0 ? fallback:args[i+1];};
 const count=Number(arg('--count','7')),concurrency=Number(arg('--concurrency','2')),maxTokens=Number(arg('--max-tokens','150000'));
 if(!Number.isInteger(count) || count<1 || count>36 || !Number.isInteger(concurrency) || concurrency<1 || concurrency>3 || !Number.isInteger(maxTokens) || maxTokens<40000 || maxTokens>500000)throw new Error('Invalid bounded batch configuration.');
 const seedPath=path.resolve(arg('--input','content/discoveries/biblical-candidates.json'));
 const output=path.resolve(arg('--output','content/discoveries/generated-candidates.json'));
 const auditPath=output.replace(/\.json$/,'')+'.audit.json';
 if(output===seedPath || auditPath===output)throw new Error('Use a separate JSON output file; the current bank is never overwritten by generation.');
 const planFile=arg('--plan',null);
 const items=planFile ? JSON.parse(await fs.readFile(path.resolve(planFile),'utf8')).slice(0,count)
   : JSON.parse(await fs.readFile(seedPath,'utf8')).slice(0,count).map(entry=>({slug:entry.slug,sourceReference:expandReference(entry.content.scriptureReference),targetDifficulty:'moderate',angle:`Stay with this scene: ${entry.content.heading}. Connect a grounded detail to a useful clue.`}));
 for(const item of items){scriptureEvidence(item.sourceReference);if(!item.slug || !['easy','moderate','challenging'].includes(item.targetDifficulty) || typeof item.angle!=='string')throw new Error('Invalid reviewed source plan.');}
 if(!args.includes('--live')){console.log(JSON.stringify({live:false,count:items.length,items,output,auditPath,noDatabaseWrites:true},null,2));return;}
 models ||= createDiscoveryModels(config);
 let audit;
 try {audit=JSON.parse(await fs.readFile(auditPath,'utf8'));if(!args.includes('--resume'))throw new Error('Existing audit requires --resume or a new output path.');}
 catch(error){if(error.code!=='ENOENT')throw error;}
 const promptHashes={writer:sha(WRITER),reviewer:sha(REVIEWER)};
 const batchSha=sha({policy:POLICY,writer:WRITER_VERSION,promptHashes,models:{generator:config.generatorModel,reviewers:config.reviewModels},items});
 if(audit && audit.batchSha!==batchSha)throw new Error('The batch no longer matches the saved policy/passages. Use a new output path.');
 audit ||= {id:randomUUID(),createdAt:new Date().toISOString(),policy:POLICY,writerVersion:WRITER_VERSION,promptHashes,batchSha,models:{generator:config.generatorModel,reviewers:config.reviewModels},totalTokens:0,noDatabaseWrites:true,items:items.map(item=>({...item,id:randomUUID(),status:'pending',attempts:[]}))};
 delete audit.stopReason;
 let writes=Promise.resolve(),reserved=0,stopped=false;
 const capacityWaiters=[];
 const save=()=>{
  const snapshot=JSON.stringify(audit,null,2)+'\n';
  writes=writes.then(async()=>{await fs.mkdir(path.dirname(auditPath),{recursive:true});await fs.writeFile(auditPath+'.tmp',snapshot,{mode:0o600});await fs.rename(auditPath+'.tmp',auditPath);});return writes;
 };
 // A previous interrupted API call consumes an attempt, as it does in the cron.
 for(const item of audit.items)for(const attempt of item.attempts)if(attempt.status==='running'){attempt.status='interrupted';attempt.reasons=['previous_attempt_interrupted'];}
 const recent=()=>audit.items.flatMap(item=>item.status==='accepted' ? [item.content]:[]);
 async function processItem(item) {
  if(item.status==='accepted' || item.status==='exhausted')return;
  const evidence=scriptureEvidence(item.sourceReference);
  for(let n=item.attempts.length;n<3 && !stopped;n++) {
   while(audit.totalTokens+reserved+40000>maxTokens) {
    if(reserved===0){item.status='budget_limited';await save();return;}
    await new Promise(resolve=>capacityWaiters.push(resolve));
   }
   if(stopped){item.status='pending';await save();return;}
   reserved+=40000;
   const attempt={number:n+1,status:'running',startedAt:new Date().toISOString()};item.attempts.push(attempt);item.status='generating';await save();
   try {
    const generated=await models.generate({plan:{theme:'Stories worth a second look',learningGoal:'Connect a concrete biblical scene to an interesting, unambiguous textual detail.'},day:{targetDifficulty:item.targetDifficulty,angle:item.angle},evidence,recent:recent(),failures:item.attempts.flatMap(row=>retryFeedback(row.verification,row.reasons || []))});
    audit.totalTokens+=generated.usage?.totalTokens || 0;
    attempt.generated={model:generated.model,responseId:generated.responseId,usage:generated.usage};
    attempt.content=generated.content;await save();
    let reasons=deterministicChecks(generated.content,evidence,{recent:recent(),targetDifficulty:item.targetDifficulty});
    if(!reasons.length) {
     const reviews=await models.review({content:generated.content,evidence});
     audit.totalTokens+=reviews.reduce((sum,row)=>sum+(row.usage?.totalTokens || 0),0);
     attempt.reviewResponses=reviews.map(row=>({model:row.model,responseId:row.responseId,usage:row.usage}));
     attempt.verification=assessCandidate(generated.content,evidence,reviews.map(row=>row.data),{minimumScore:config.minimumScore,recent:recent(),targetDifficulty:item.targetDifficulty});
     reasons=attempt.verification.reasons;
    }
    attempt.reasons=reasons;attempt.status=reasons.length ? 'rejected':'accepted';
    if(!reasons.length){item.status='accepted';item.content=validateContent({...generated.content,difficulty:attempt.verification.difficulty});item.verification={method:'Generated and assessed by the actual curriculum model pipeline; unpublished draft, not a human approval or measured probability of truth.',evidenceSha256:evidence.sourceSha256,answerText:item.content.choices.find(choice=>choice.id===item.content.correctOptionId).text,humanReviewStatus:'pending',automatedReviewStatus:'passed',auditFile:path.basename(auditPath),writerVersion:WRITER_VERSION,writerModel:generated.model,writerResponseId:generated.responseId,reviewModels:attempt.verification.reviews.map(row=>row.model),reviewResponseIds:attempt.verification.reviews.map(row=>row.responseId),policyVersion:POLICY,evidenceScore:attempt.verification.evidenceScore,questionCraftScore:attempt.verification.questionCraft.score};}
   } catch(error) {
    if(error.discoveryGeneration){audit.totalTokens+=error.discoveryGeneration.usage?.totalTokens || 0;attempt.invalidGeneration=error.discoveryGeneration;}
    attempt.status='rejected';attempt.reasons=[error.code==='candidate_contract_invalid' ? 'candidate_contract_invalid':safeFailure(error)];attempt.errorStatus=error.status || null;
    if(['provider_authentication','provider_invalid_request','provider_rate_limit'].includes(attempt.reasons[0])){stopped=true;audit.stopReason=attempt.reasons[0];}
   } finally {reserved-=40000;capacityWaiters.splice(0).forEach(resolve=>resolve());attempt.completedAt=new Date().toISOString();await save();}
   console.log(JSON.stringify({slug:item.slug,attempt:attempt.number,status:attempt.status,reasons:attempt.reasons,totalTokens:audit.totalTokens}));
   if(item.status==='accepted')return;
  }
  item.status=item.attempts.length>=3 ? 'exhausted':'pending';await save();
 }
 let cursor=0;
 const workers=Array.from({length:concurrency},async()=>{while(cursor<audit.items.length && !stopped){const item=audit.items[cursor++];await processItem(item);}});
 await Promise.all(workers);
 audit.completedAt=new Date().toISOString();await save();
 const accepted=audit.items.filter(item=>item.status==='accepted').map(({id,slug,content,verification})=>({id,slug,content,verification}));
 await fs.writeFile(output,JSON.stringify(accepted,null,2)+'\n');
 console.log(JSON.stringify({accepted:accepted.length,exhausted:audit.items.filter(item=>item.status==='exhausted').length,pending:audit.items.filter(item=>!['accepted','exhausted'].includes(item.status)).length,totalTokens:audit.totalTokens,stopReason:audit.stopReason || null,output,auditPath,noDatabaseWrites:true}));
 if(accepted.length!==audit.items.length)process.exitCode=1;
 return {accepted,audit};
}
if(require.main===module){require('dotenv').config({quiet:true});main().catch(()=>{console.error('Draft batch failed; inspect the saved audit and configuration. No database write was attempted.');process.exitCode=1;});}
module.exports={main,expandReference};
