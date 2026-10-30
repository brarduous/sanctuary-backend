const {validateContent}=require('./discoveries');
const {sha,normalize}=require('./discoveryScripture');
const {consensusDifficulty,DAILY_VERSION}=require('./discoveryDifficulty');
const {copyIssues}=require('./discoveryCopy');
const {VERSION:CRAFT_POLICY,questionCraftIssues,assessQuestionCraft,hasBiblicalFrame}=require('./discoveryQuestionCraft');
const {COPY_POLICY}=require('./discoveryCopy');
const {isDeepStrictEqual}=require('node:util');
const POLICY='discovery-evidence-v3';
const MIN_SCORE=95;
const SCOPE='This discovery describes what the cited passage says in the World English Bible.';
function candidateFromDraft(draft,evidence) {
  if(!Array.isArray(draft?.claims) || !draft.claims.length || draft.claims.length>3)throw new Error('Use one to three explicit, evidenced claims.');
  return validateContent({kind:'biblical_text',category:'Bible and context',prompt:draft.prompt,heading:`A detail in ${evidence.source.locator}`,scopeNote:SCOPE,choices:draft.choices,correctOptionId:draft.correctOptionId,sources:[evidence.source],claims:draft.claims.map(claim=>({...claim,sourceIds:['passage']})),answerClaimId:draft.answerClaimId,explanationClaimIds:draft.explanationClaimIds,scriptureReference:evidence.source.locator,translation:'WEB'});
}
function fingerprint(content) {return sha(normalize(content.prompt));}
function similarity(a,b) {
  const tokens=value=>new Set(normalize(value).split(' ').filter(word=>word.length>2 && !['according','what','where','which','does','the','and','this','that','with','from'].includes(word)));
  const left=tokens(a),right=tokens(b);
  return [...left].filter(word=>right.has(word)).length/(new Set([...left,...right]).size || 1);
}
function exactQuote(quote,text) {
  return typeof quote==='string' && quote.trim().length>=5 && text.replace(/\s+/g,' ').includes(quote.trim().replace(/\s+/g,' '));
}
function validCitation(citation,evidence) {
  const verse=evidence.verses.find(verse=>verse.verseNumber===citation.verseNumber);
  return citation.sourceId==='passage' && Boolean(verse) && citation.quote===verse.text && exactQuote(citation.quote,evidence.source.excerpt);
}
function deterministicChecks(content,evidence,{recent=[],targetDifficulty}={}) {
  const reasons=[];
  try {validateContent(content);}catch{reasons.push('invalid_content');return reasons;}
  reasons.push(...copyIssues(content));
  if(content.kind!=='biblical_text' || content.translation!=='WEB' || content.traditionLabel || content.sources.length!==1 || content.scopeNote!==SCOPE)reasons.push('not_simple_biblical_text');
  if(content.scriptureReference!==evidence.source.locator || !isDeepStrictEqual(content.sources[0],evidence.source) || sha(content.sources[0].excerpt)!==evidence.sourceSha256)reasons.push('source_integrity');
  if(content.claims.some(claim=>claim.sourceIds.length!==1 || claim.sourceIds[0]!=='passage'))reasons.push('claim_source_mismatch');
  const correct=content.choices.find(choice=>choice.id===content.correctOptionId)?.text;
  if(!correct || !(` ${normalize(evidence.source.excerpt)} `).includes(` ${normalize(correct)} `))reasons.push('answer_not_explicit_in_text');
  const answerClaim=content.claims.find(claim=>claim.id===content.answerClaimId);
  const answerWords=normalize(correct).replace(/^(?:a|an|the|his|her|its|their) /,'');
  if(!answerWords || !(` ${normalize(answerClaim?.text)} `).includes(` ${answerWords} `))reasons.push('answer_claim_does_not_identify_key');
  if(/\b(not|except|least|never|first ever|oldest|shortest|only person|authored|written by|historically proven)\b/i.test(content.prompt))reasons.push('disputed_or_negative_question');
  if(!hasBiblicalFrame(content.prompt,evidence.source.locator))reasons.push('question_reference_mismatch');
  reasons.push(...questionCraftIssues(content));
  if(!content.explanationClaimIds.includes(content.answerClaimId))reasons.push('explanation_omits_answer');
  if(content.claims.map(claim=>claim.text).join(' ').split(/\s+/).length>120)reasons.push('explanation_too_long');
  if(recent.some(row=>fingerprint(row)===fingerprint(content) || similarity(row.prompt,content.prompt)>=0.8))reasons.push('duplicate_question');
  if(targetDifficulty && !['easy','moderate','challenging'].includes(targetDifficulty))reasons.push('invalid_difficulty_target');
  return reasons;
}
function assessCandidate(content,evidence,reviews,options={}) {
  const reasons=deterministicChecks(content,evidence,options);
  const scores=[],craft=[];
  const threshold=Math.max(MIN_SCORE,options.minimumScore || MIN_SCORE);
  const recordScore=(score,reason)=>{if(!Number.isInteger(score) || score<0 || score>100){reasons.push('malformed_assessment');scores.push(0);}else{scores.push(score);if(score<threshold)reasons.push(reason);}};
  if(!Array.isArray(reviews) || reviews.length!==2 || new Set(reviews.map(row=>row.model)).size!==2 || new Set(reviews.map(row=>row.requestedModel)).size!==2)reasons.push('two_distinct_review_models_required');
  for(const review of reviews || []) {
    if(options.dailySet && (review.difficultyAssessment?.rubricVersion!==DAILY_VERSION || review.difficultyAssessment?.model!==review.model || typeof review.difficultyAssessment?.responseId!=='string' || review.difficultyAssessment.responseId.length<5 || review.difficultyAssessment.questionPromptSha256!==sha(content.prompt)))reasons.push('daily_difficulty_review_missing');
    for(const field of ['questionAccuracy','scopeAccuracy','explanationCoverage'])recordScore(review[field],`${field}_below_threshold`);
    if(review.simpleTextualFact!==true || !Array.isArray(review.unresolvedIssues) || review.unresolvedIssues.length)reasons.push('unresolved_or_complex_claim');
    try {const rating=assessQuestionCraft(review.questionCraft);craft.push(rating);if(!rating.accepted)reasons.push('question_craft_below_threshold');if(options.dailySet && (rating.score<7 || rating.dimensions.fairChallenge!==2))reasons.push('daily_set_editorial_gate');}catch{reasons.push('question_craft_missing_or_invalid');}
    if(!Array.isArray(review.questionPremises) || !review.questionPremises.length)reasons.push('question_premises_not_verified');
    for(const premise of review.questionPremises || []) {
      if(typeof premise.text!=='string' || !premise.text.trim() || premise.status!=='supported')reasons.push('question_context_unsupported');
      recordScore(premise.confidence,'question_context_below_threshold');
      if(!premise.evidence?.length || premise.evidence.some(citation=>!validCitation(citation,evidence)))reasons.push('question_context_quote_missing_or_invalid');
    }
    if(review.solvedOptionId!==content.correctOptionId)reasons.push('blind_answer_disagrees');
    if(!Array.isArray(review.claims) || review.claims.length!==content.claims.length || new Set(review.claims?.map(claim=>claim.claimId)).size!==content.claims.length)reasons.push('incomplete_claim_coverage');
    for(const claim of content.claims) {
      const assessment=review.claims?.find(row=>row.claimId===claim.id);
      if(!assessment || assessment.status!=='supported')reasons.push('unsupported_claim');
      recordScore(assessment?.confidence,'claim_below_threshold');
      if(!assessment?.evidence?.length || assessment.evidence.some(citation=>!validCitation(citation,evidence)))reasons.push('fabricated_or_missing_quote');
    }
    if(!Array.isArray(review.options) || review.options.length!==4 || new Set(review.options?.map(option=>option.optionId)).size!==4)reasons.push('incomplete_option_coverage');
    for(const option of content.choices) {
      const assessment=review.options?.find(row=>row.optionId===option.id);
      if(!assessment || assessment.status!==(option.id===content.correctOptionId ? 'supported':'not_supported'))reasons.push('ambiguous_answer');
      recordScore(assessment?.confidence,'option_below_threshold');
      if(typeof assessment?.rationale!=='string' || assessment.rationale.trim().length<10)reasons.push('missing_option_rationale');
      if(assessment?.evidence?.some(citation=>!validCitation(citation,evidence)))reasons.push('fabricated_or_missing_quote');
      if(option.id===content.correctOptionId && !assessment?.evidence?.length)reasons.push('correct_answer_without_evidence');
    }
  }
  let difficulty=null;
  try {difficulty=consensusDifficulty(reviews,options.dailySet ? DAILY_VERSION:undefined);}catch{reasons.push('difficulty_disagreement');}
  if(options.dailySet && difficulty?.level!==options.targetDifficulty)reasons.push('daily_set_difficulty_mismatch');
  return {policyVersion:POLICY,copyPolicyVersion:COPY_POLICY,questionCraft:{policyVersion:CRAFT_POLICY,minimumScore:6,score:craft.length===2 ? Math.min(...craft.map(rating=>rating.score)):0,assessments:craft},accepted:reasons.length===0,minimumScore:threshold,evidenceScore:scores.length ? Math.min(...scores) : 0,candidateSha256:sha(content),sourceSha256:evidence.sourceSha256,corpusVersion:evidence.corpusVersion,corpusSha256:evidence.corpusSha256,questionFingerprint:fingerprint(content),difficulty,difficultyTargetMet:difficulty?.level===options.targetDifficulty,reasons:[...new Set(reasons)],reviews};
}
function retryFeedback(verification,reasons=[]) {
  const comments=(verification?.reviews || []).flatMap(review=>[...(review.unresolvedIssues || []),review.questionCraft?.rationale,review.difficulty?.rationale]).filter(value=>typeof value==='string').map(value=>value.slice(0,700));
  return [...new Set([...reasons,...comments])].slice(0,12);
}
module.exports={POLICY,MIN_SCORE,SCOPE,candidateFromDraft,fingerprint,similarity,exactQuote,deterministicChecks,assessCandidate,retryFeedback};
