const object=properties=>({type:'object',additionalProperties:false,properties,required:Object.keys(properties)});
const text={type:'string'};
const bool={type:'boolean'};
const score={type:'integer',minimum:0,maximum:100};
const list=items=>({type:'array',items});
const choice=object({id:text,text});
const claim=object({id:text,text});
const draft=object({prompt:text,choices:list(choice),correctOptionId:text,claims:list(claim),answerClaimId:text,explanationClaimIds:list(text)});
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
module.exports={draft,review,reviewForVerses};
