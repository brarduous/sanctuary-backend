const VERSION='discovery-difficulty-v1';
const DAILY_VERSION='discovery-difficulty-v2';
const DIMENSIONS=['familiarity','evidenceNavigation','reasoningSteps','distractorSimilarity'];
const LABELS={easy:'Easy',moderate:'Moderate',challenging:'Challenging'};
const RUBRIC=`Rate difficulty for late teens and young adults, including readers new to church, independently of factual accuracy.
Score each dimension 0, 1, or 2:
- familiarity: judge the tested fact, not just whether the wider story is famous. 0 widely recognizable even beyond regular church attendance (for example David facing Goliath); 1 a less familiar concrete detail of a recognizable scene; 2 a little-known person/place/word distinction or relational role (for example identifying the brother who offers substitution in a lengthy appeal). The target is a young adult including someone new to church, not a Bible-study specialist. Audience familiarity remains an estimate.
- evidenceNavigation: 0 answer located directly in one verse; 1 connect two nearby explicit statements; 2 follow several explicit details across the supplied passage.
- reasoningSteps: 0 direct identification; 1 one textual connection; 2 two clearly supported connections. Never require external assumptions. Direct recall is a difficulty measure, not a craft defect.
- distractorSimilarity: 0 obviously different categories; 1 plausible alternatives in the same category; 2 closely related alternatives distinguished by explicit evidence, such as siblings competing for the same narrative role or nearby locations with different roles in a journey. Plausibility and similarity are separate: four credible objects can still be visually/functionally distinct and score 1 here.
Sum 0-2 = Easy; 3-5 = Moderate; 6-8 = Challenging.
Ambiguity, misleading wording, translation disputes, unsupported inference, and multiple valid answers are accuracy failures, never reasons to increase difficulty.
Return a concise explanation for the difficulty rating. Do not invent audience statistics.`;
const DAILY_RUBRIC=RUBRIC.replace('- evidenceNavigation: 0 answer located directly in one verse; 1 connect two nearby explicit statements; 2 follow several explicit details across the supplied passage.', '- evidenceNavigation: 0 one fact or association; 1 connect two explicit relationships or distinguish roles; 2 follow several roles or events, such as stages of a journey. Judge the connections a player must recall, not how long an editor searches the excerpt.').replace('Rate difficulty for late teens', 'CLOSED-BOOK DAILY TRIVIA: Players answer before seeing the source excerpt. Estimate knowledge needed to solve the question, not how long it takes an editor to locate its answer. Do not manufacture Hard by demanding more clauses. Rate difficulty for late teens').replace('Sum 0-2 = Easy; 3-5 = Moderate; 6-8 = Challenging.', 'Version discovery-difficulty-v2: weight familiarity twice because closed-book knowledge is central. Score = 2*familiarity + evidenceNavigation + reasoningSteps + distractorSimilarity (0–10). 0–3 = Easy; 4–6 = Medium; 7–10 = Hard. A bare obscure name lookup is still normally Medium; Hard additionally needs a meaningful distinction or connection. Navigation means relationships the player must recall, not simply the length of the saved excerpt. These are estimated relative bands, not measured success rates.');
function levelFor(score,version=VERSION) {return version===DAILY_VERSION ? score<=3 ? 'easy':score<=6 ? 'moderate':'challenging':score<=2 ? 'easy':score<=5 ? 'moderate':'challenging';}
function validateDifficulty(raw,version=VERSION) {
  if(![VERSION,DAILY_VERSION].includes(version))throw new Error('Unknown difficulty rubric.');
  if(!raw || DIMENSIONS.some(key=>!Number.isInteger(raw[key]) || raw[key]<0 || raw[key]>2) || typeof raw.rationale!=='string' || raw.rationale.trim().length<15)throw new Error('Incomplete difficulty rubric.');
  const score=DIMENSIONS.reduce((sum,key)=>sum+raw[key]*(version===DAILY_VERSION && key==='familiarity' ? 2:1),0);
  return {rubricVersion:version,level:levelFor(score,version),score,dimensions:Object.fromEntries(DIMENSIONS.map(key=>[key,raw[key]])),rationale:raw.rationale.trim().slice(0,1000)};
}
function consensusDifficulty(reviews,version=VERSION) {
  const ratings=reviews.map(review=>validateDifficulty(review.difficulty,version));
  if(ratings.length!==2)throw new Error('Two difficulty assessments are required.');
  if(Math.abs(ratings[0].score-ratings[1].score)>2)throw new Error('Difficulty reviewers disagree; regenerate the question.');
  const score=Math.round((ratings[0].score+ratings[1].score)/2);
  return {rubricVersion:version,level:levelFor(score,version),score};
}
module.exports={VERSION,DAILY_VERSION,DIMENSIONS,LABELS,RUBRIC,DAILY_RUBRIC,levelFor,validateDifficulty,consensusDifficulty};
