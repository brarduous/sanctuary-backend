require('dotenv').config();
const fs=require('node:fs');
const {scriptureEvidence}=require('../../utils/discoveryScripture');
const {candidateFromDraft,deterministicChecks,assessCandidate}=require('../../utils/discoveryAccuracy');
const {configFromEnv}=require('../../utils/discoveryCurriculum');
const {createDiscoveryModels}=require('../../utils/discoveryModels');
const {summarizeEvaluation}=require('../../utils/discoveryCalibration');
async function main() {
  const filename=process.argv.slice(2).find(arg=>!arg.startsWith('--'));
  if(!filename)throw new Error('Provide an independently labeled hold-out JSON file. Each case needs id, reference, draft, expectedDecision, and labelRationale.');
  const cases=JSON.parse(fs.readFileSync(filename,'utf8'));
  if(!Array.isArray(cases) || !cases.length || cases.length>200 || new Set(cases.map(row=>row.id)).size!==cases.length)throw new Error('Use 1–200 uniquely identified hold-out cases.');
  for(const row of cases)if(typeof row.id!=='string' || !['accept','reject'].includes(row.expectedDecision) || typeof row.labelRationale!=='string' || row.labelRationale.trim().length<30)throw new Error('Expected decisions require an independent written rationale; model confidence is not a correctness label.');
  if(!process.argv.includes('--live')) {console.log(`Validated ${cases.length} labeled cases. No API calls or database writes. Add --live to evaluate the configured verifier pair.`);return;}
  const models=createDiscoveryModels(configFromEnv());
  const results=[];
  for(const row of cases) {
    const evidence=scriptureEvidence(row.reference);
    const content=candidateFromDraft(row.draft,evidence);
    let actual='reject',verification=null;
    const structural=deterministicChecks(content,evidence);
    if(!structural.length) {
      const reviewed=await models.review({content,evidence});
      verification=assessCandidate(content,evidence,reviewed.map(result=>result.data));
      actual=verification.accepted ? 'accept':'reject';
    }
    results.push({id:row.id,expected:row.expectedDecision,actual,reasonCodes:verification?.reasons || structural});
  }
  const summary=summarizeEvaluation(results);
  console.log(JSON.stringify({models:configFromEnv().reviewModels,summary,results},null,2));
  if(!summary.meets95PercentPrecisionEvidence || summary.falseAccepts.length)process.exitCode=1;
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
