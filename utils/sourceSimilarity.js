const COMMON_EXCLUSIONS = new Set([
  'in the name of the father and of the son and of the holy spirit',
  'may the words of my mouth and the meditation of my heart be acceptable',
  'he who has ears to hear let him hear',
]);

const normalizeWords = (value = '') => String(value)
  .toLowerCase()
  .replace(/[’']/g, '')
  .replace(/[^a-z0-9\s]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .split(' ')
  .filter(Boolean);

const buildNgrams = (words, size) => {
  const grams = new Set();
  for (let index = 0; index <= words.length - size; index += 1) {
    const phrase = words.slice(index, index + size).join(' ');
    if (!COMMON_EXCLUSIONS.has(phrase)) grams.add(phrase);
  }
  return grams;
};

function checkSourceSimilarity(output, sources, { maxEightWordMatches = 8 } = {}) {
  const outputWords = normalizeWords(output);
  const output12 = buildNgrams(outputWords, 12);
  const output8 = buildNgrams(outputWords, 8);
  const twelveWordMatches = new Set();
  const eightWordMatches = new Set();

  for (const source of sources || []) {
    const sourceWords = normalizeWords(source.text || source.sermon_body || '');
    for (const phrase of buildNgrams(sourceWords, 12)) if (output12.has(phrase)) twelveWordMatches.add(phrase);
    for (const phrase of buildNgrams(sourceWords, 8)) if (output8.has(phrase)) eightWordMatches.add(phrase);
  }

  const fabricatedAttribution = /\b(?:dr\.?\s+)?(?:martin\s+luther\s+)?king(?:\s+jr\.?)?\b/i.test(String(output));
  return {
    passed: !fabricatedAttribution && twelveWordMatches.size === 0 && eightWordMatches.size <= maxEightWordMatches,
    fabricatedAttribution,
    twelveWordMatchCount: twelveWordMatches.size,
    eightWordMatchCount: eightWordMatches.size,
    sampleMatches: [...new Set([...twelveWordMatches, ...eightWordMatches])].slice(0, 3),
  };
}

module.exports = { normalizeWords, buildNgrams, checkSourceSimilarity };
