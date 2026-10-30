// Publish previously reviewed originals through the same SQL gates as the cron.
// No model calls, synthetic approvals, notification delivery, or content rewrites.
const fs=require('node:fs'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const {isDeepStrictEqual}=require('node:util');
const {ensureDailySets}=require('../../utils/discoveryDailySets');
const {assessCandidate}=require('../../utils/discoveryAccuracy');
const {scriptureEvidence,loadCorpus,sha}=require('../../utils/discoveryScripture');
const {configFromEnv}=require('../../utils/discoveryCurriculum');
const {localDate}=require('../../utils/discoveries');
const unwrap=r=>{if(r.error)throw r.error;return r.data;};
function validateBank(bank){
 if(!['reviewed-daily-bank-v2','reviewed-daily-bank-v3'].includes(bank.version) || !Array.isArray(bank.sets) || !bank.sets.length || bank.sets.length>30)throw new Error('Use a bounded, versioned reviewed bank.');
 const dates=new Set(),prompts=new Set();
 for(const set of bank.sets){
  if(dates.has(set.date) || !/^\d{4}-\d{2}-\d{2}$/.test(set.date) || !Array.isArray(set.items) || set.items.length!==3 || set.verifications?.length!==3 || set.reviews?.length!==2)throw new Error('Use unique dates and complete reviewed sets.');dates.add(set.date);
  for(let i=0;i<3;i++){
   const item=set.items[i],raw={...item};delete raw.difficulty;
   if(set.verifications[i].candidateSha256!==sha(raw))throw new Error('The manuscript changed after its saved assessment.');
   const verified=assessCandidate(raw,scriptureEvidence(item.scriptureReference),set.verifications[i].reviews,{dailySet:true,targetDifficulty:['easy','moderate','challenging'][i]});
   if(!verified.accepted || JSON.stringify(verified.difficulty)!==JSON.stringify(item.difficulty))throw new Error(`Question failed its saved evidence/editorial gates: ${set.date}/${i+1}: ${verified.reasons}`);
   if(prompts.has(sha(item.prompt)))throw new Error('Do not repeat a question within the bank.');prompts.add(sha(item.prompt));
  }
  if(new Set(set.reviews.map(r=>r.model)).size!==2 || set.reviews.some(r=>r.setEditorialVersion!=='sanctuary-trivia-set-editor-v4' || r.weekReviewVersion!=='sanctuary-trivia-rolling-week-v1' || !isDeepStrictEqual(r.questionContents,set.items) || !Array.isArray(r.weekContext) || r.approved!==true || r.issues?.length!==0 || r.questionPromptHashes?.some((hash,i)=>hash!==sha(set.items[i].prompt)) || r.questionPromptHashes?.length!==3 || typeof r.responseId!=='string' || r.responseId.length<5))throw new Error('Missing independent, bound final set approval.');
 }
 return {dates:[...dates].sort(),questions:prompts.size};
}
function productionGuard(){
 const verified=Date.parse(process.env.PRODUCTION_BACKUP_VERIFIED_AT || '');
 if(process.env.PRODUCTION_CHANGE_APPROVED!=='reviewed' || !process.env.PRODUCTION_APPROVED_BY || !process.env.PRODUCTION_CHANGE_TICKET || !process.env.PRODUCTION_BACKUP_RESTORE_EVIDENCE || !Number.isFinite(verified) || Date.now()-verified>86400000 || verified>Date.now()+300000)throw new Error('Production requires reviewed deployment authorization, change ticket, fresh recovery evidence and a clean commit.');
 if(execFileSync('git',['status','--porcelain'],{cwd:path.join(__dirname,'../..'),encoding:'utf8'}).trim())throw new Error('Production publication requires a clean reviewed source commit.');
}
async function publish({bank,db,replaceLegacy=true}){
 const corpus=loadCorpus(),summary={bankVersion:bank.version,corpusSha256:corpus.sha256,sets:[],legacyReplacements:[]};
 for(const set of [...bank.sets].sort((a,b)=>a.date.localeCompare(b.date))){
  const date=set.date;
  const plan={version:bank.version,date,writerVersion:'reviewed-original-manuscripts',editorialVersion:'sanctuary-trivia-editorial-v2',corpusVersion:corpus.version,corpusSha256:corpus.sha256,theme:'Three discoveries worth sharing',slots:set.items.map((item,i)=>({position:i+1,targetDifficulty:['easy','moderate','challenging'][i],sourceOptions:Array.from({length:3},()=>({sourceReference:item.scriptureReference,sourceSha256:scriptureEvidence(item.scriptureReference).sourceSha256,angle:'Previously independently reviewed original manuscript. No new model calls during publication.'}))}))};
  const models={async generate({day}){return {content:set.items[day.setPosition-1],model:'reviewed-original-manuscript',writerVersion:'reviewed-original-manuscripts',writerPromptSha256:sha(set.items[day.setPosition-1]),usage:{totalTokens:0}};},async review({content}){const i=set.items.findIndex(item=>item.prompt===content.prompt);return set.verifications[i].reviews.map(data=>({data,usage:{totalTokens:0}}));},async reviewSet(items,{weekContext}){if(!set.reviews.every(r=>isDeepStrictEqual(r.weekContext,weekContext)))throw new Error('Saved weekly context differs; obtain a new review for the changed context.');return set.reviews.map(review=>({...review,usage:{totalTokens:0}}));}};
  const result=await ensureDailySets({db,models,config:{...configFromEnv({}),generatorModel:'reviewed-original-manuscripts'},now:new Date(date+'T12:00:00Z'),runwayDays:1,maxDaysPerRun:1,corpus,planForDate:()=>plan});
  const membership=unwrap(await db.from('discovery_daily_set_items').select('position,discovery_id,revision').eq('publication_date',date).order('position'));
  if(membership.length!==3)throw new Error('Date remains unpublished: '+date);
  const stored=unwrap(await db.from('discovery_revisions').select('discovery_id,revision,content').in('discovery_id',membership.map(item=>item.discovery_id)));
  for(let i=0;i<3;i++){const row=stored.find(r=>r.discovery_id===membership[i].discovery_id && r.revision===membership[i].revision);if(!row || !isDeepStrictEqual(row.content,set.items[i]))throw new Error('Existing immutable day differs from this bank; no replacement attempted.');}
  if(replaceLegacy){
   const prior=unwrap(await db.from('discovery_schedule').select('publication_date,discovery_id,revision,locale').eq('publication_date',date));
   const first=membership[0];
   if(!prior.some(row=>row.discovery_id===first.discovery_id && row.revision===first.revision)){
    summary.legacyReplacements.push({date,prior,firstQuestion:first.discovery_id});
    // The existing history trigger retains already-released revisions. Optional
    // v2 grading is omitted by the legacy API projection, never falsified.
    unwrap(await db.from('discovery_schedule').upsert({publication_date:date,locale:'en',discovery_id:first.discovery_id,revision:first.revision},{onConflict:'publication_date,locale'}));
   }
  }
  summary.sets.push({date,published:result.published || 0,alreadyPublished:result.generated===false,items:membership});
 }
 return summary;
}
async function main(args=process.argv.slice(2)){
 const filename=args.find(a=>!a.startsWith('--'));if(!filename)throw new Error('Provide a reviewed bank file; default is validation only. Add --verify-local or --apply.');
 const bank=JSON.parse(fs.readFileSync(filename,'utf8')),validation=validateBank(bank);
 if(args.includes('--verify-local')){
  const {createHarness}=require('../../test/helpers/discoveryHarness');const h=await createHarness({curriculum:true,dailySets:true});
  try{const summary=await publish({bank,db:h.client,replaceLegacy:false});console.log(JSON.stringify({validation,isolated:true,summary},null,2));}finally{await h.close();}return;
 }
 if(!args.includes('--apply')){console.log(JSON.stringify({validation,mutations:false,approvedSets:bank.sets.length},null,2));return;}
 const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!url || !key)throw new Error('Explicit server-side Supabase credentials are required.');
 if(new URL(url).hostname==='cmakuvkjxknwhonfqbit.supabase.co')productionGuard();
 const {createClient}=require('@supabase/supabase-js'),db=createClient(url,key,{auth:{persistSession:false}});
 const summary=await publish({bank,db,replaceLegacy:!args.includes('--no-legacy-update')});
 console.log(JSON.stringify({completedAt:new Date().toISOString(),project:new URL(url).hostname,today:localDate(),summary},null,2));
}
if(require.main===module)main().catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={validateBank,publish};
