const {scriptureEvidence}=require('./discoveryScripture');
const VERSION='news-reader-copy-v2';
const LABELS={aligned:'Consistent with Christian teaching',concerns:'Conflicts with Christian teaching',mixed:'Mixed',unclear:'Not enough information for a judgment'};
const words=value=>String(value || '').trim().split(/\s+/).filter(Boolean).length;
function validateNewsTldr(value){
 if(!value || typeof value.summary!=='string' || words(value.summary)<3 || words(value.summary)>65)throw new Error('News TLDR needs a short reported summary.');
 const assessment=value.christianAssessment;
 if(!assessment || !Object.hasOwn(LABELS,assessment.verdict) || typeof assessment.reason!=='string' || words(assessment.reason)<3 || words(assessment.reason)>50 || typeof assessment.focus!=='string' || !assessment.focus.trim())throw new Error('News TLDR needs an explicit, reasoned Christian assessment of the reported conduct or response.');
 if(!['reported_conduct','recommended_response'].includes(assessment.focusType))throw new Error('Identify whether the Christian assessment concerns reported conduct or a recommended response.');
 if(assessment.focusType==='recommended_response' && assessment.verdict!=='aligned')throw new Error('A recommended Christian response must be clearly aligned; use reported_conduct for unknown causes or culpability.');
 const evidence=scriptureEvidence(assessment.scriptureReference);
 if(evidence.verses.length>4)throw new Error('Use a focused Scripture reference for the TLDR assessment.');
 return {summary:value.summary.trim(),christianAssessment:{verdict:assessment.verdict,focusType:assessment.focusType,label:LABELS[assessment.verdict],focus:assessment.focus.trim().slice(0,180),reason:assessment.reason.trim(),scriptureReference:evidence.source.locator,scriptureExcerpt:evidence.source.excerpt}};
}
function formatNewsTldr(tldr){const a=tldr.christianAssessment;return `${tldr.summary}\n\nChristian assessment — ${LABELS[a.verdict]}: ${a.reason} (${a.scriptureReference})`;}
function normalizeNewsReaderCopy(value){
 const tldr=validateNewsTldr(value.tldr);
 if(typeof value.newsSummary!=='string' || words(value.newsSummary)<15 || words(value.newsSummary)>200)throw new Error('News needs a little more factual detail below the TLDR.');
 return {...value,tldr,synopsis:formatNewsTldr(tldr),readerCopyVersion:VERSION};
}
module.exports={VERSION,LABELS,validateNewsTldr,formatNewsTldr,normalizeNewsReaderCopy};
