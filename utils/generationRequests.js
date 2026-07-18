function normalizeForComparison(value) {
  if (Array.isArray(value)) return value.map(normalizeForComparison);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, normalizeForComparison(nested)])
    );
  }
  return value;
}

function generationRequestsMatch(left, right) {
  return JSON.stringify(normalizeForComparison(left)) === JSON.stringify(normalizeForComparison(right));
}

module.exports = { generationRequestsMatch };
