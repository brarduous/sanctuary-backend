const {normalize}=require('./discoveryScripture');
const VERSION='discovery-question-craft-v2';
const DIMENSIONS=['context','interest','fairChallenge','choiceQuality'];
const MINIMUM=6;
const RUBRIC=`Assess question craft separately from truth and difficulty, for late teens and young adults including readers new to church.
Judge accessibility and curiosity within the existing dimensions: context cannot score 2 if the scene needs unexplained church jargon; interest cannot score 2 for an obscure detail without a rewarding connection. Recognizable human stakes must be explicit in the source, never imagined. Penalize condescension, forced slang, anachronistic scenarios, and shame in the relevant dimension. Familiar stories can earn full marks; obscurity is not quality.
Rate each dimension 0, 1, or 2, with a specific rationale:
- context: 0 bare chapter/verse lookup or detached recall; 1 a useful scene or situation; 2 a concise scene and a second grounded clue that help identify one answer.
- interest: 0 arbitrary minutiae or a dull fact restated as a question; 1 a worthwhile detail; 2 an interesting contrast, connection, action or consequence worth discovering.
- fairChallenge: 0 answer given away, opinion, trick, arbitrary verse-number recall or unsupported inference; 1 clear and answerable from ordinary familiarity or clues; 2 a satisfying supported connection without a giveaway. Easy questions can score 2.
- choiceQuality: 0 another valid answer, overlapping meanings, a broad category containing the key, grammatical giveaway, absurd filler or incomparable types; 1 distinct parallel alternatives with at least two plausible distractors; 2 all three alternatives are plausible for the scene and are clearly wrong for the exact question.
All dimensions must be at least 1 and each review must total at least 6/8. Accuracy of at least 95 does not compensate for weak craft. Explain rejections rather than quietly rewriting the candidate.`;
function hasBiblicalFrame(prompt,reference) {
  const book=String(reference || '').replace(/\s+\d.*$/,'');
  if(!book)return false;
  const escaped=book.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const names=book==='Psalms' ? '(?:Psalms|Psalm)':escaped;
  return new RegExp(`\\b(?:according to|in|from) ${names}\\b|\\b${names}[’']s (?:account|story|parable|vision|poem|song|letter|Gospel)\\b`,'i').test(prompt);
}
function questionCraftIssues(content) {
  const reasons=[];
  if(/\b(?:verse|chapter)\s+(?:number\s+)?\d+\b/i.test(content.prompt))reasons.push('bare_verse_lookup');
  const answer=content.choices.find(choice=>choice.id===content.correctOptionId)?.text;
  if(answer && normalize(answer).length>=3 && ` ${normalize(content.prompt)} `.includes(` ${normalize(answer)} `))reasons.push('answer_given_in_question');
  return reasons;
}
function assessQuestionCraft(raw) {
  if(!raw || DIMENSIONS.some(key=>!Number.isInteger(raw[key]) || raw[key]<0 || raw[key]>2) || typeof raw.rationale!=='string' || raw.rationale.trim().length<15)throw new Error('Incomplete question-craft assessment.');
  const score=DIMENSIONS.reduce((sum,key)=>sum+raw[key],0);
  return {policyVersion:VERSION,score,accepted:score>=MINIMUM && DIMENSIONS.every(key=>raw[key]>=1),dimensions:Object.fromEntries(DIMENSIONS.map(key=>[key,raw[key]])),rationale:raw.rationale.trim().slice(0,1500)};
}
module.exports={VERSION,DIMENSIONS,MINIMUM,RUBRIC,hasBiblicalFrame,questionCraftIssues,assessQuestionCraft};
