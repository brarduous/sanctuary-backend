const VERSION='discovery-difficulty-v1';
const DIMENSIONS=['familiarity','evidenceNavigation','reasoningSteps','distractorSimilarity'];
const LABELS={easy:'Easy',moderate:'Moderate',challenging:'Challenging'};
const RUBRIC=`Rate difficulty for a general adult Christian audience, independently of factual accuracy.
Score each dimension 0, 1, or 2:
- familiarity: 0 widely familiar story/detail; 1 recognizable account but less familiar detail; 2 a little-known detail. Audience familiarity is an estimate.
- evidenceNavigation: 0 answer located directly in one verse; 1 connect two nearby explicit statements; 2 follow several explicit details across the supplied passage.
- reasoningSteps: 0 direct identification; 1 one textual connection; 2 two clearly supported connections. Never require external assumptions.
- distractorSimilarity: 0 obviously different categories; 1 plausible alternatives in the same category; 2 closely related alternatives distinguished by explicit evidence.
Sum 0-2 = Easy; 3-5 = Moderate; 6-8 = Challenging.
Ambiguity, misleading wording, translation disputes, unsupported inference, and multiple valid answers are accuracy failures, never reasons to increase difficulty.
Return a concise explanation for the difficulty rating. Do not invent audience statistics.`;
function levelFor(score) {return score<=2 ? 'easy':score<=5 ? 'moderate':'challenging';}
function validateDifficulty(raw) {
  if(!raw || DIMENSIONS.some(key=>!Number.isInteger(raw[key]) || raw[key]<0 || raw[key]>2) || typeof raw.rationale!=='string' || raw.rationale.trim().length<15)throw new Error('Incomplete difficulty rubric.');
  const score=DIMENSIONS.reduce((sum,key)=>sum+raw[key],0);
  return {rubricVersion:VERSION,level:levelFor(score),score,dimensions:Object.fromEntries(DIMENSIONS.map(key=>[key,raw[key]])),rationale:raw.rationale.trim().slice(0,1000)};
}
function consensusDifficulty(reviews) {
  const ratings=reviews.map(review=>validateDifficulty(review.difficulty));
  if(ratings.length!==2)throw new Error('Two difficulty assessments are required.');
  if(Math.abs(ratings[0].score-ratings[1].score)>2)throw new Error('Difficulty reviewers disagree; regenerate the question.');
  const score=Math.round((ratings[0].score+ratings[1].score)/2);
  return {rubricVersion:VERSION,level:levelFor(score),score};
}
module.exports={VERSION,DIMENSIONS,LABELS,RUBRIC,levelFor,validateDifficulty,consensusDifficulty};
