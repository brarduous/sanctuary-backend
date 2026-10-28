// Reassess an unchanged earlier draft under the current policy; never approve or publish.
const fs=require('node:fs/promises');
const path=require('node:path');
const {createDiscoveryModels}=require('../../utils/discoveryModels');
const {configFromEnv}=require('../../utils/discoveryCurriculum');
const {scriptureEvidence}=require('../../utils/discoveryScripture');
const {deterministicChecks,assessCandidate,POLICY}=require('../../utils/discoveryAccuracy');
async function main(args=process.argv.slice(2)) {
 const arg=name=>{const i=args.indexOf(name);return i<0 ? null:args[i+1];};
 const input=arg('--input'),slug=arg('--slug'),output=arg('--output');
 if(!input || !slug || !output || path.resolve(input)===path.resolve(output))throw new Error('Supply separate --input, --slug and --output.');
 const entry=JSON.parse(await fs.readFile(input,'utf8')).find(entry=>entry.slug===slug);
 if(!entry)throw new Error('Draft not found.');
 const evidence=scriptureEvidence(entry.content.scriptureReference);
 const reasons=deterministicChecks(entry.content,evidence);
 if(reasons.length)throw new Error(`Draft failed deterministic checks: ${reasons.join(', ')}`);
 if(!args.includes('--live')){console.log(JSON.stringify({live:false,slug,policy:POLICY,noDatabaseWrites:true}));return;}
 const config=configFromEnv(),models=createDiscoveryModels(config);
 const responses=await models.review({content:entry.content,evidence});
 const decision=assessCandidate(entry.content,evidence,responses.map(response=>response.data),{minimumScore:config.minimumScore});
 const audit={id:require('node:crypto').randomUUID(),recheckedAt:new Date().toISOString(),input:path.basename(input),originalDraft:entry,noDatabaseWrites:true,decision,responses:responses.map(response=>({model:response.model,responseId:response.responseId,usage:response.usage}))};
 const auditFile=output.replace(/\.json$/,'')+'.audit.json';
 await fs.writeFile(auditFile,JSON.stringify(audit,null,2)+'\n');
 const result=decision.accepted ? [{...entry,content:{...entry.content,difficulty:decision.difficulty},verification:{...entry.verification,auditFile:path.basename(auditFile),originalWriterAudit:entry.verification.auditFile,policyVersion:POLICY,automatedReviewStatus:'passed',humanReviewStatus:'pending',reviewModels:decision.reviews.map(review=>review.model),reviewResponseIds:decision.reviews.map(review=>review.responseId),evidenceScore:decision.evidenceScore,questionCraftScore:decision.questionCraft.score}}]:[];
 await fs.writeFile(output,JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify({slug,accepted:decision.accepted,reasons:decision.reasons,evidence:decision.evidenceScore,craft:decision.questionCraft.score,noDatabaseWrites:true}));
 if(!decision.accepted)process.exitCode=1;
}
if(require.main===module){require('dotenv').config({quiet:true});main().catch(()=>{console.error('Draft recheck failed; no approval or database write occurred.');process.exitCode=1;});}
module.exports={main};
