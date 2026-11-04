const VERSION='discovery-difficulty-v1';
const LEGACY_DAILY_VERSION='discovery-difficulty-v2';
const DAILY_VERSION='discovery-difficulty-v3';
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
const DAILY_RUBRIC=`CLOSED-BOOK DAILY TRIVIA for ordinary players, including people new to church. Rate the question WITH its contextual clue, before the answer or passage is shown. Never rate how easily an editor can find a quotation.
Use the four dimensions below. Values of 2 describe an unsuitable question and MUST be returned honestly so the server can reject it:
- familiarity: 0 a widely known Bible person, object, animal or event; 1 an accessible detail within a recognizable story, with a helpful scene-setting clue; 2 obscure names, geography, chronology, terminology or details requiring specialist study. A famous story does not make an obscure tested fact accessible.
- evidenceNavigation: 0 one fact or association; 1 one clear relationship in a familiar scene; 2 multiple roles, stages or relationships to keep track of.
- reasoningSteps: 0 direct recognition or recall; 1 one simple connection supported by the question's contextual clue; 2 two or more connections or unstated assumptions.
- distractorSimilarity: 0 plainly distinct alternatives; 1 credible but clearly distinguishable alternatives of the same category; 2 fine distinctions among similar names, places, roles or wording.
Score = 2*familiarity + evidenceNavigation + reasoningSteps + distractorSimilarity. In v3, accepted dimensions are all <=1 (maximum score 5). Easy 0: broad recognition with plainly distinct alternatives, no connection or little-known detail. Medium 1-2: common Bible knowledge with credible distinguishable choices or a single helpful connection. Hard 3-5: an accessible detail or one attainable connection about a recognizable story, helped by context. Hard never means specialist recall. Do not inflate dimensions to fill a slot; report the actual rating and let the writer choose another fact.
Examples of intended knowledge, not manuscripts to copy: Easy identifies Noah's ark or Daniel's lions; Medium connects Moses with removing sandals at the burning bush; Hard connects Joseph's robe with the evidence his brothers showed their father. Naaman's requested earth, Lydia's city, obscure hometowns and minor-name distinctions are unsuitable for EVERY tier. The question must be short and understandable on one reading; familiar direct recall can have excellent craft.
Accuracy failures, ambiguity and misleading options always reject, independently of difficulty. Explain the rating briefly. These are editorial estimates, never measured audience success rates.`;
function levelFor(score,version=VERSION) {return version===DAILY_VERSION ? score===0 ? 'easy':score<=2 ? 'moderate':'challenging':version===LEGACY_DAILY_VERSION ? score<=3 ? 'easy':score<=6 ? 'moderate':'challenging':score<=2 ? 'easy':score<=5 ? 'moderate':'challenging';}
function validateDifficulty(raw,version=VERSION) {
  if(![VERSION,LEGACY_DAILY_VERSION,DAILY_VERSION].includes(version))throw new Error('Unknown difficulty rubric.');
  if(!raw || DIMENSIONS.some(key=>!Number.isInteger(raw[key]) || raw[key]<0 || raw[key]>(version===DAILY_VERSION ? 1:2)) || typeof raw.rationale!=='string' || raw.rationale.trim().length<15)throw new Error('Incomplete difficulty rubric.');
  const score=DIMENSIONS.reduce((sum,key)=>sum+raw[key]*(version!==VERSION && key==='familiarity' ? 2:1),0);
  return {rubricVersion:version,level:levelFor(score,version),score,dimensions:Object.fromEntries(DIMENSIONS.map(key=>[key,raw[key]])),rationale:raw.rationale.trim().slice(0,1000)};
}
function consensusDifficulty(reviews,version=VERSION) {
  const ratings=reviews.map(review=>validateDifficulty(review.difficulty,version));
  if(ratings.length!==2)throw new Error('Two difficulty assessments are required.');
  if(Math.abs(ratings[0].score-ratings[1].score)>2)throw new Error('Difficulty reviewers disagree; regenerate the question.');
  const score=(version===DAILY_VERSION ? Math.floor:Math.round)((ratings[0].score+ratings[1].score)/2);
  return {rubricVersion:version,level:levelFor(score,version),score};
}
module.exports={VERSION,LEGACY_DAILY_VERSION,DAILY_VERSION,DIMENSIONS,LABELS,RUBRIC,DAILY_RUBRIC,levelFor,validateDifficulty,consensusDifficulty};
