// A content policy, applied before verification/import. Do not truncate reviewed
// text on the client: changing a factual claim requires checking its new wording.
const COPY_POLICY='discovery-concise-v2';
const words=value=>String(value || '').trim().split(/\s+/u).filter(Boolean).length;
function copyIssues(content) {
 const issues=[];
 if(content.prompt.length>140 || words(content.prompt)>22)issues.push('question_too_wordy');
 const fact=content.explanationClaimIds.map(id=>content.claims.find(claim=>claim.id===id)?.text || '').join(' ');
 if(fact.length>220 || words(fact)>30)issues.push('factoid_too_wordy');
 if(content.choices.some(choice=>choice.text.length>64 || words(choice.text)>10))issues.push('answer_too_wordy');
 return issues;
}
module.exports={COPY_POLICY,copyIssues};
