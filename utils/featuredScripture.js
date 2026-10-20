// Editorial limits informed by the October 2026 samples in docs/VERSE_OF_THE_DAY.md.
const DEVOTIONAL_PLAN_VERSION = 'weekly-formation-v3-short-verse';
// Match the book titles in the Bible corpus used by the mobile verse card.
const normalizeFeaturedReference = reference => String(reference || '').trim().replace(/\s+/g, ' ')
  .replace(/^Psalm\s+/i, 'Psalms ')
  .replace(/^Song of Songs\s+/i, 'Song of Solomon ');
const FEATURED_SCRIPTURE_POLICY = `
## Verse of the day selection
These rules replace any earlier instruction to return a shortened Scripture excerpt.
- scripture_reference is the featured verse of the day: one clear, quotable, memorable thought a reader can carry into the day.
- Normally select one complete verse. At least five days per week must use a single verse; at most two days may use two short adjacent verses from one chapter when they form one inseparable thought.
- Target 10-30 words in scripture_text, with a hard maximum of 40 words and 300 characters. Shorter complete verses are welcome. Choose a different reference if the full quotation is too long.
- Quote the complete selected verse(s) faithfully from one translation. Never paraphrase, truncate, use ellipses, omit clauses, or stitch fragments together to fit. Do not select whole chapters, cross-chapter ranges, or multiple separate references.
- Select for clarity and contextual integrity, not merely shortness or familiarity. Preserve biblical breadth, lament, hope, instruction, and promise. Avoid fragments that become misleading outside their surrounding argument.
- Keep broader reading separate: supporting_scriptures may contain zero to two objects with reference and context explaining each passage's contribution. These may be longer readings. Cite them explicitly in the devotional body while keeping the featured reference unchanged.
- Preserve the existing 120-160 word reflection, pastoral depth, contextual interpretation, and concrete practice. Do not expand the featured reference to accommodate the devotional.
`;
const featuredVerseCount = reference => {
  const match = String(reference || '').trim().match(/^(?:[1-3]\s+)?[A-Za-z]+(?:\s+[A-Za-z]+)*\s+([1-9]\d*):([1-9]\d*)(?:\s*[-–]\s*([1-9]\d*))?$/);
  if (!match) throw new Error('Featured Scripture must be one verse or two adjacent verses in one chapter.');
  const count = Number(match[3] || match[2]) - Number(match[2]) + 1;
  if (count < 1 || count > 2) throw new Error('Featured Scripture must be one verse or two adjacent verses in one chapter.');
  return count;
};
const validateFeaturedScripture = ({ scripture_reference, scripture_text }) => {
  const count = featuredVerseCount(scripture_reference);
  const text = String(scripture_text || '').trim();
  const words = (text.match(/\b[\w’'-]+\b/g) || []).length;
  if (!words || words > 40 || text.length > 300) throw new Error(`Featured Scripture must contain 1-40 words and at most 300 characters; received ${words} words and ${text.length} characters. Choose a shorter complete verse.`);
  if (/\.{3}|…/.test(text)) throw new Error('Featured Scripture must quote complete verses without ellipses.');
  return count;
};
const validateFeaturedWeek = days => {
  if (days.filter(day => validateFeaturedScripture(day) === 2).length > 2) throw new Error('Featured Scripture must use a single verse on at least five days per week.');
};
module.exports = { DEVOTIONAL_PLAN_VERSION, FEATURED_SCRIPTURE_POLICY, normalizeFeaturedReference, featuredVerseCount, validateFeaturedScripture, validateFeaturedWeek };
