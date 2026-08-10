const MATCH_THRESHOLD = 0.38;
const STOP_WORDS = new Set(['about','after','again','against','amid','among','from','into','near','over','says','that','their','this','through','under','with','would','news','live','updates']);

function tokens(value) {
  return new Set(String(value || '').toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/).filter((word) => word.length > 3 && !STOP_WORDS.has(word)));
}

function overlapScore(left, right) {
  const a = tokens(left);
  const b = tokens(right);
  if (!a.size || !b.size) return 0;
  const overlap = [...a].filter((word) => b.has(word)).length;
  return (2 * overlap) / (a.size + b.size);
}

module.exports = { MATCH_THRESHOLD, overlapScore, tokens };
