// Read-only editorial evaluation. Never imports Supabase or publishes content.
const fs=require('node:fs');
const path=require('node:path');
const {createDiscoveryModels,DAILY_REVIEWER}=require('../../utils/discoveryModels');
const {VERSION:editorialVersion}=require('../../utils/discoveryEditorial');
const {configFromEnv}=require('../../utils/discoveryCurriculum');
const {scriptureEvidence,sha}=require('../../utils/discoveryScripture');
const {candidateFromDraft,assessCandidate}=require('../../utils/discoveryAccuracy');
const {consensusDifficulty,DAILY_VERSION}=require('../../utils/discoveryDifficulty');

async function evaluate({output,benchmarkFile=path.join(__dirname,'../../content/discoveries/editorial-benchmark-v1.json'),models,tokenBudget=250000,reuseAudit}={}) {
 if(!output)throw new Error('An explicit audit output path is required.');
 if(fs.existsSync(output))throw new Error('Audit already exists; preserve it. Do not resample the same evaluator to obtain a pass.');
 const benchmark=JSON.parse(fs.readFileSync(benchmarkFile,'utf8'));
 const config=configFromEnv();
 models=models || createDiscoveryModels({...config,timeoutMs:120000});
 const report={noProductionWrites:true,benchmarkVersion:benchmark.version,benchmarkSha256:sha(benchmark),editorialVersion,reviewerPromptSha256:sha(DAILY_REVIEWER),startedAt:new Date().toISOString(),tokenBudget,totalTokens:0,results:[]};
 const previous=reuseAudit ? JSON.parse(fs.readFileSync(reuseAudit,'utf8')):null;
 if(previous && previous.reviewerPromptSha256!==report.reviewerPromptSha256)throw new Error('Cached reviews use a different evaluator.');
 const save=()=>fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n',{mode:0o600});
 save();
 // Small, bounded concurrency. Each review calls two separate model families.
 const pending=[...benchmark.cases];
 async function worker() {
  for(let row;(row=pending.shift());) {
   if(report.totalTokens>=tokenBudget)throw new Error('Editorial evaluation token budget exhausted.');
   const evidence=scriptureEvidence(row.reference);
   const claims=row.claims.map((text,i)=>({id:`claim-${i+1}`,text}));
   const content=candidateFromDraft({prompt:row.prompt,choices:row.choices.map((text,i)=>({id:`option-${i+1}`,text})),correctOptionId:`option-${row.choices.indexOf(row.correct)+1}`,claims,answerClaimId:'claim-1',explanationClaimIds:claims.map(claim=>claim.id)},evidence);
   // Intended decisions, difficulty labels and rationales never reach reviewers.
   const cached=previous?.results.find(r=>sha(r.content)===sha(content));
   const responses=cached ? cached.responses.map((r,i)=>({...r,data:cached.verification.reviews[i]})):await models.review({content,evidence,dailySet:true});
   if(!cached)report.totalTokens+=responses.reduce((sum,r)=>sum+(r.usage?.totalTokens || 0),0);
   const reviews=responses.map(r=>r.data);
   let assessedLevel;try{assessedLevel=consensusDifficulty(reviews,DAILY_VERSION).level;}catch{}
   // Negative examples have no target band. A missing label must not make a
   // bad example appear successfully rejected without testing its actual defect.
   const verification=assessCandidate(content,evidence,reviews,{dailySet:true,targetDifficulty:row.proposedDifficulty || assessedLevel});
   const decisionMatches=verification.accepted===(row.expectedDecision==='accept');
   const result={id:row.id,split:row.split,expectedDecision:row.expectedDecision,proposedDifficulty:row.proposedDifficulty,decisionMatches,content,verification,responses:responses.map(r=>({model:r.model,responseId:r.responseId,usage:r.usage})),...(cached ? {reusedFromAudit:path.basename(reuseAudit)}:{})};
   report.results.push(result);save();
   process.stdout.write(JSON.stringify({id:row.id,accepted:verification.accepted,decisionMatches,reasons:verification.reasons,evidenceScore:verification.evidenceScore,craftScore:verification.questionCraft.score,difficulty:verification.difficulty})+'\n');
  }
 }
 const outcomes=await Promise.allSettled([worker(),worker()]);
 report.completedAt=new Date().toISOString();
 report.errors=outcomes.filter(r=>r.status==='rejected').map(r=>r.reason.message);
 report.matched=report.results.filter(r=>r.decisionMatches).length;
 report.complete=report.results.length===benchmark.cases.length && !report.errors.length;
 save();
 if(!report.complete)throw new Error(`Benchmark incomplete: ${report.errors.join('; ')}`);
 return report;
}
if(require.main===module)evaluate({output:process.argv[2]}).then(report=>process.stdout.write(JSON.stringify({complete:report.complete,matched:report.matched,cases:report.results.length,totalTokens:report.totalTokens})+'\n')).catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={evaluate};
