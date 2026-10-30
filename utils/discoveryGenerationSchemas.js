const object=properties=>({type:'object',additionalProperties:false,properties,required:Object.keys(properties)});
const text={type:'string'};
const bool={type:'boolean'};
const score={type:'integer',minimum:0,maximum:100};
const list=items=>({type:'array',items});
const optionId={type:'string',enum:['option-1','option-2','option-3','option-4']};
const claimId={type:'string',enum:['claim-1','claim-2']};
const choice=object({id:optionId,text:{type:'string',pattern:'^\\S+(?:\\s+\\S+){0,9}$',description:'A parallel answer choice, at most ten words and 64 characters. Only the correct choice must be verbatim from the passage.'}});
const claim=object({id:claimId,text:{type:'string',pattern:'^\\S+(?:\\s+\\S+){0,13}$',description:'One complete factual sentence shown to the player after answering, at most fourteen words. Describe the passage only; never include ratings, choice analysis, reviewer commentary or writing advice.'}});
const draft=object({prompt:{type:'string',pattern:'^\\S+(?:\\s+\\S+){0,21}$',description:'A brief context-first question, at most twenty-two words and 140 characters, with the source book framed naturally.'},choices:{...list(choice),minItems:4,maxItems:4},correctOptionId:optionId,claims:{...list(claim),minItems:1,maxItems:2},answerClaimId:claimId,explanationClaimIds:{...list(claimId),minItems:1,maxItems:2}});
const citation=object({sourceId:{type:'string',enum:['passage']},verseNumber:{type:'integer',minimum:1}});
const review=object({
  solvedOptionId:text,
  questionAccuracy:score,scopeAccuracy:score,explanationCoverage:score,
  simpleTextualFact:bool,unresolvedIssues:list(text),
  questionPremises:list(object({text,status:{type:'string',enum:['supported','partially_supported','unsupported','contradicted','uncertain']},confidence:score,evidence:list(citation)})),
  questionCraft:object({context:{type:'integer',minimum:0,maximum:2},interest:{type:'integer',minimum:0,maximum:2},fairChallenge:{type:'integer',minimum:0,maximum:2},choiceQuality:{type:'integer',minimum:0,maximum:2},rationale:text}),
  claims:list(object({claimId:text,status:{type:'string',enum:['supported','partially_supported','unsupported','contradicted','uncertain']},confidence:score,evidence:list(citation)})),
  options:list(object({optionId:text,status:{type:'string',enum:['supported','not_supported','ambiguous']},verdictConfidence:score,rationale:text,evidence:list(citation)})),
  difficulty:object({familiarity:{type:'integer',minimum:0,maximum:2},evidenceNavigation:{type:'integer',minimum:0,maximum:2},reasoningSteps:{type:'integer',minimum:0,maximum:2},distractorSimilarity:{type:'integer',minimum:0,maximum:2},rationale:text}),
});
function reviewForVerses(verseNumbers) {
  if(!verseNumbers.length || verseNumbers.some(number=>!Number.isInteger(number) || number<1))throw new Error('Trusted verse IDs are required.');
  const schema=structuredClone(review);
  const visit=node=>{
    if(!node || typeof node!=='object')return;
    if(node.properties?.verseNumber)node.properties.verseNumber={type:'integer',enum:[...new Set(verseNumbers)]};
    Object.values(node).forEach(value=>{if(Array.isArray(value))value.forEach(visit);else visit(value);});
  };
  visit(schema);return schema;
}
const setReview=object({approved:bool,issues:list(text),rationale:text});
module.exports={draft,review,reviewForVerses,setReview};
