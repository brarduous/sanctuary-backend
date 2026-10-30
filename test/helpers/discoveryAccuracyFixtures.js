const {candidateFromDraft}=require('../../utils/discoveryAccuracy');
function draftFor(evidence) {
  return candidateFromDraft({prompt:'In Genesis, what sign in the clouds marks God’s covenant with every living creature?',choices:[{id:'option-1',text:'Rainbow'},{id:'option-2',text:'A lamp'},{id:'option-3',text:'A pillar'},{id:'option-4',text:'A star'}],correctOptionId:'option-1',claims:[{id:'sign',text:'Genesis 9 describes the rainbow as a sign of the covenant between God and the earth.'}],answerClaimId:'sign',explanationClaimIds:['sign']},evidence);
}
function reviewFor(content,evidence,model='test-verifier-a',difficulty='easy') {
  const dimensions=difficulty==='easy' ? {familiarity:0,evidenceNavigation:0,reasoningSteps:0,distractorSimilarity:1}:difficulty==='moderate' ? {familiarity:1,evidenceNavigation:1,reasoningSteps:0,distractorSimilarity:1}:{familiarity:2,evidenceNavigation:2,reasoningSteps:1,distractorSimilarity:2};
  const citation={sourceId:'passage',verseNumber:evidence.verses[0].verseNumber,quote:evidence.verses[0].text};
  return {questionCraft:{context:2,interest:2,fairChallenge:2,choiceQuality:1,rationale:'A grounded scene and covenant clue connect an accessible answer to a worthwhile textual detail.'},questionPremises:[{text:'The sign is set in the cloud.',status:'supported',confidence:99,evidence:[citation]}],model,requestedModel:model,responseId:'synthetic-test-response',questionAccuracy:99,scopeAccuracy:99,explanationCoverage:99,simpleTextualFact:true,solvedOptionId:content.correctOptionId,unresolvedIssues:[],claims:content.claims.map(claim=>({claimId:claim.id,status:'supported',confidence:99,evidence:[citation]})),options:content.choices.map(option=>({optionId:option.id,status:option.id===content.correctOptionId ? 'supported':'not_supported',confidence:99,rationale:option.id===content.correctOptionId ? 'The source explicitly names the rainbow.':'The text does not name this option as the covenant sign.',evidence:option.id===content.correctOptionId ? [citation]:[]})),difficulty:{...dimensions,rationale:'A familiar detail is stated directly in the source, with distinguishable alternatives.'}};
}
function modelReviewFor(content,evidence,model) {
 const review=reviewFor(content,evidence,model);
 const citations=row=>({...row,evidence:row.evidence.map(()=>({sourceId:'passage',verseNumber:evidence.verses[0].verseNumber}))});
 return {...review,claims:review.claims.map(citations),questionPremises:review.questionPremises.map(citations),options:review.options.map(({confidence,...row})=>({...citations(row),verdictConfidence:confidence}))};
}
module.exports={draftFor,reviewFor,modelReviewFor};
