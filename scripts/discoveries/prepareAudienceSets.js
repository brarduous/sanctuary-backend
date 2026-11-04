// Prepare bounded, independently reviewed replacements. Never changes schedules.
require('dotenv').config();
const {randomUUID}=require('node:crypto');
const {configFromEnv,safeFailure}=require('../../utils/discoveryCurriculum');
const {createDiscoveryModels}=require('../../utils/discoveryModels');
const {buildDailySetPlan}=require('../../utils/discoveryDailyPlan');
const {loadCorpus,scriptureEvidence,sha}=require('../../utils/discoveryScripture');
const {assessCandidate,deterministicChecks,retryFeedback,POLICY}=require('../../utils/discoveryAccuracy');
const {validateContent,shiftDate}=require('../../utils/discoveries');
const {buildResearchPacket}=require('../../utils/triviaReferences');
const unwrap=r=>{if(r.error)throw r.error;return r.data;};
async function prepare({db,models,from='2026-11-04',days=2,config=configFromEnv(),budget=180000}){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(from)||!Number.isInteger(days)||days<1||days>7)throw Error('Use a valid date and one to seven days.');
 const corpus=loadCorpus(),runId=randomUUID(),report={kind:'general-audience-replacement-v1',from,days,sets:[],attempts:[],totalTokens:0,noScheduleWrites:true};
 unwrap(await db.from('discovery_generation_runs').insert({id:runId,policy_version:POLICY,corpus_version:corpus.version,corpus_sha256:corpus.sha256,models:{generator:config.generatorModel,verifiers:config.reviewModels},summary:report}));
 const save=async status=>unwrap(await db.from('discovery_generation_runs').update({summary:report,...(status ? {status,completed_at:new Date().toISOString()}:{})}).eq('id',runId));
 console.log(JSON.stringify({runId,from,days,noScheduleWrites:true}));
 let recent=unwrap(await db.from('discovery_revisions').select('content').order('created_at',{ascending:false}).limit(1000)).map(r=>r.content);
 try{
  for(let day=0;day<days;day++){
   const date=shiftDate(from,day),plan=buildDailySetPlan(date),items=[],verifications=[];
   for(const slot of plan.slots){
    let feedback=[];
    for(const [index,source] of slot.sourceOptions.entries()){
     if(report.totalTokens>=budget)throw Error('Bounded token budget reached.');
     const evidence=scriptureEvidence(source.sourceReference),research=buildResearchPacket(evidence);
     let content,verification,generation,reasons=[];
     try{
      const generated=await models.generate({plan,day:{...source,targetDifficulty:slot.targetDifficulty,setPosition:slot.position,siblingQuestions:items},evidence,recent,failures:feedback,research});
      report.totalTokens+=generated.usage?.totalTokens||0;
      generation={model:generated.model,responseId:generated.responseId,writerVersion:generated.writerVersion,writerPromptSha256:generated.writerPromptSha256,usage:generated.usage,researchPacketSha256:sha(research)};
      content=validateContent(generated.content);reasons=deterministicChecks(content,evidence,{recent});
      if(!reasons.length){const reviews=await models.review({content,evidence,dailySet:true});report.totalTokens+=reviews.reduce((n,r)=>n+(r.usage?.totalTokens||0),0);verification=assessCandidate(content,evidence,reviews.map(r=>r.data),{dailySet:true,targetDifficulty:slot.targetDifficulty,recent});reasons=verification.reasons;}
     }catch(error){generation=error.discoveryGeneration||generation;report.totalTokens+=error.discoveryGeneration?.usage?.totalTokens||0;reasons=[safeFailure(error),error.message.slice(0,400)];}
     report.attempts.push({date,position:slot.position,attempt:index+1,source:source.sourceReference,content,generation,verification,reasons});await save();
     console.log(JSON.stringify({date,position:slot.position,attempt:index+1,accepted:verification?.accepted===true,reasons,totalTokens:report.totalTokens}));
     if(verification?.accepted){content=validateContent({...content,difficulty:verification.difficulty});items.push(content);verifications.push(verification);recent.unshift(content);break;}
     feedback=retryFeedback(verification,reasons);
    }
    if(items.length!==slot.position)throw Error(`Question ${date}/${slot.position} exhausted; prior rejections retained.`);
   }
   const weekContext=unwrap(await db.rpc('discovery_daily_week_context',{p_date:date}));
   const reviews=await models.reviewSet(items,{weekContext});report.totalTokens+=reviews.reduce((n,r)=>n+(r.usage?.totalTokens||0),0);
   const approved=reviews.length===2&&reviews.every(r=>r.approved===true&&r.issues.length===0);
   report.sets.push({date,plan,items,verifications,reviews,approved});await save();
   if(!approved)throw Error(`Final editors withheld ${date}; revise the concrete defects before retrying.`);
  }
  report.prepared=true;await save('completed');return {runId,...report};
 }catch(error){report.failure=error.message;await save('failed');throw error;}
}
if(require.main===module){const config={...configFromEnv(),timeoutMs:180000};prepare({db:require('../../config/supabase'),models:createDiscoveryModels(config),from:process.argv[2]||'2026-11-04',days:Number(process.argv[3]||2),config}).then(r=>console.log(JSON.stringify({runId:r.runId,prepared:r.prepared,sets:r.sets.map(s=>s.date),totalTokens:r.totalTokens}))).catch(e=>{console.error(e.message);process.exitCode=1;});}
module.exports={prepare};
