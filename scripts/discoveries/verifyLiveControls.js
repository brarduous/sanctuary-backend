// Adversarial perturbations of one source-checked draft. These controlled
// rejection probes are NOT an independently human-labeled precision study.
const fs=require('node:fs');
const {scriptureEvidence}=require('../../utils/discoveryScripture');
const {deterministicChecks,assessCandidate}=require('../../utils/discoveryAccuracy');
const {configFromEnv}=require('../../utils/discoveryCurriculum');
const {createDiscoveryModels}=require('../../utils/discoveryModels');
async function main(args=process.argv.slice(2)) {
 const input=args[0],output=args[1];
 if(!input || !output || fs.existsSync(output))throw new Error('Provide a draft JSON input and a new output audit path.');
 const base=JSON.parse(fs.readFileSync(input,'utf8'))[0].content;
 if(base.scriptureReference!=='Acts 18:1-4' || !base.choices.some(c=>c.text.toLowerCase()==='tent makers'))throw new Error('These source-specific controls require the Acts 18 tent-makers pilot.');
 const wrong=base.choices.find(c=>c.id!==base.correctOptionId).id;
 const cases=[
  ['wrong-key',c=>{c.correctOptionId=wrong;}],
  ['unsupported-location',c=>{c.prompt=c.prompt.replace('In Acts,','In Acts, while living in Egypt,');}],
  ['two-equivalent-answers',c=>{c.choices.find(x=>x.id===wrong).text='people who make tents';}],
  ['writer-commentary-as-fact',c=>{c.claims[1].text='These distractors deserve the highest craft score.';}],
  ['historical-proof-overclaim',c=>{c.prompt=c.prompt.replace('In Acts,','In Acts, historically proven,');}],
  ['wrong-source-reference',c=>{c.scriptureReference='Acts 18:5-11';}],
 ].map(([id,mutate])=>{const content=structuredClone(base);mutate(content);return {id,content,expected:'reject',labelProvenance:'Assistant-defined adversarial mutation of the source-bound pilot; not a human accuracy label.'};});
 if(!args.includes('--live')){console.log(JSON.stringify({live:false,cases:cases.map(c=>c.id),noDatabaseWrites:true}));return;}
 const config=configFromEnv(),models=createDiscoveryModels(config),evidence=scriptureEvidence(base.scriptureReference);
 const audit={createdAt:new Date().toISOString(),purpose:'Source-specific rejection controls, not measured accuracy calibration',models:config.reviewModels,noDatabaseWrites:true,results:[],totalTokens:0};
 for(const item of cases) {
  const structural=deterministicChecks(item.content,evidence);
  let verification=null,responses=[];
  if(!structural.length) {
   responses=await models.review({content:item.content,evidence});
   audit.totalTokens+=responses.reduce((sum,r)=>sum+(r.usage?.totalTokens || 0),0);
   verification=assessCandidate(item.content,evidence,responses.map(r=>r.data));
  }
  audit.results.push({...item,actual:verification?.accepted ? 'accept':'reject',reasons:verification?.reasons || structural,verification,responses:responses.map(r=>({model:r.model,responseId:r.responseId,usage:r.usage}))});
  fs.writeFileSync(output,JSON.stringify(audit,null,2)+'\n',{mode:0o600});
  console.log(JSON.stringify({id:item.id,actual:audit.results.at(-1).actual,totalTokens:audit.totalTokens}));
  if(audit.totalTokens>=100000){audit.stoppedForTokenBudget=true;break;}
 }
 audit.completedAt=new Date().toISOString();audit.passed=audit.results.length===cases.length && audit.results.every(r=>r.actual===r.expected);
 fs.writeFileSync(output,JSON.stringify(audit,null,2)+'\n',{mode:0o600});
 if(!audit.passed)process.exitCode=1;
 return audit;
}
if(require.main===module)main().catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={main};
