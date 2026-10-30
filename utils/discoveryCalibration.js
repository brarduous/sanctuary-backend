// Wilson lower bound for precision at 95% confidence. Model scores are never
// used as correctness labels; only independently labeled hold-out decisions are.
function precisionLowerBound(correct,accepted) {
  if(!accepted)return 0;
  const z=1.959963984540054,p=correct/accepted,z2=z*z;
  return (p+z2/(2*accepted)-z*Math.sqrt((p*(1-p)+z2/(4*accepted))/accepted))/(1+z2/accepted);
}
function summarizeEvaluation(results) {
  const accepted=results.filter(row=>row.actual==='accept');
  const correct=accepted.filter(row=>row.expected==='accept').length;
  const falseAccepts=accepted.filter(row=>row.expected==='reject');
  const lower=precisionLowerBound(correct,accepted.length);
  const disagreements=results.filter(row=>row.actual!==row.expected).map(row=>row.id);
  return {caseCount:results.length,accepted:accepted.length,trueAccepts:correct,falseAccepts:falseAccepts.map(row=>row.id),rejected:results.length-accepted.length,precision:accepted.length ? correct/accepted.length:null,precisionLowerBound95:lower,meets95PercentPrecisionEvidence:lower>=0.95,disagreements};
}
module.exports={precisionLowerBound,summarizeEvaluation};
