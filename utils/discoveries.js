const {hasBiblicalFrame}=require('./discoveryQuestionCraft');
const { createHash } = require('node:crypto');
const { VERSION: DIFFICULTY_VERSION, levelFor } = require('./discoveryDifficulty');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ID = /^[a-z][a-z0-9-]{0,79}$/;
const TYPES = new Set(['biblical_text', 'historical', 'tradition']);
const SOURCE_TYPES = new Set(['scripture', 'primary', 'scholarly', 'official_tradition']);
const ATTESTATIONS = ['sourcesReadInContext', 'everyClaimSupported', 'oneUnambiguousAnswer', 'scopeAndUncertaintyAccurate', 'rightsChecked'];

function invalid(message) {
  const error = new Error(message);
  error.status = 400;
  error.code = 'DISCOVERY_INVALID';
  throw error;
}
function string(value, name, min = 1, max = 1000) {
  if (typeof value !== 'string' || value.trim().length < min || value.length > max) invalid(`${name} must contain ${min}–${max} characters.`);
  return value.trim();
}
function https(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch { return false; }
}
function date(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
function validateContent(input) {
  if (!input || typeof input !== 'object') invalid('Content is required.');
  const { kind, category, prompt, heading, scopeNote, traditionLabel, scriptureReference, translation } = input;
  if (!TYPES.has(kind)) invalid('Choose biblical_text, historical, or tradition.');
  string(category, 'category', 3, 80);
  string(prompt, 'prompt', 12, 260);
  string(heading, 'heading', 5, 120);
  string(scopeNote, 'scopeNote', 12, 500);
  if (!Array.isArray(input.choices) || input.choices.length !== 4) invalid('Exactly four choices are required.');
  const choices = input.choices.map(choice => ({ id: string(choice.id, 'choice ID', 1, 80), text: string(choice.text, 'choice', 1, 160) }));
  if (choices.some(choice => !ID.test(choice.id)) || new Set(choices.map(choice => choice.id)).size !== 4 || new Set(choices.map(choice => choice.text.toLowerCase())).size !== 4) invalid('Choices must have distinct IDs and text.');
  if (!choices.some(choice => choice.id === input.correctOptionId)) invalid('The correct option must exist.');
  if (!Array.isArray(input.sources) || input.sources.length < 1 || input.sources.length > 8) invalid('One to eight sources are required.');
  const sources = input.sources.map(source => {
    if (!ID.test(source.id) || !SOURCE_TYPES.has(source.type) || !https(source.url)) invalid('Each source requires an ID, an evidence type, and an HTTPS URL.');
    return { id: source.id, type: source.type, title: string(source.title, 'source title', 3, 180), publisher: string(source.publisher, 'publisher', 2, 160), url: source.url, locator: string(source.locator, 'source locator', 2, 180), excerpt: string(source.excerpt, 'evidence excerpt', 10, 8000), rights: string(source.rights, 'rights', 5, 500) };
  });
  if (new Set(sources.map(source => source.id)).size !== sources.length) invalid('Source IDs must be unique.');
  if (!Array.isArray(input.claims) || !input.claims.length || input.claims.length > 8) invalid('Claims must be mapped to evidence.');
  const claims = input.claims.map(claim => {
    if (!ID.test(claim.id) || !Array.isArray(claim.sourceIds) || !claim.sourceIds.length || claim.sourceIds.some(id => !sources.some(source => source.id === id))) invalid('Every claim needs existing source IDs.');
    return { id: claim.id, text: string(claim.text, 'claim', 10, 1000), sourceIds: [...new Set(claim.sourceIds)] };
  });
  if (new Set(claims.map(claim => claim.id)).size !== claims.length || !claims.some(claim => claim.id === input.answerClaimId)) invalid('A unique, evidenced answer claim is required.');
  if (!Array.isArray(input.explanationClaimIds) || !input.explanationClaimIds.length || new Set(input.explanationClaimIds).size !== input.explanationClaimIds.length || input.explanationClaimIds.some(id => !claims.some(claim => claim.id === id))) invalid('Explanation must consist of evidenced claims.');
  const explanation = input.explanationClaimIds.map(id => claims.find(claim => claim.id === id).text).join(' ');
  if (explanation.length > 1600) invalid('Explanation is too long.');
  if (kind === 'biblical_text' && (!hasBiblicalFrame(prompt,scriptureReference) || !sources.some(source => source.type === 'scripture') || !scriptureReference || translation !== 'WEB')) invalid('Biblical questions must identify the account, reference, and reviewed WEB translation.');
  if (kind === 'historical') {
    if (!sources.some(source => source.type === 'primary') || !sources.some(source => source.type === 'scholarly') || new Set(sources.map(source => source.publisher.toLowerCase())).size < 2) invalid('History requires a primary source and an independent scholarly source, with uncertainties stated.');
    for (const claim of claims) {
      const evidence = sources.filter(source => claim.sourceIds.includes(source.id));
      if (!evidence.some(source => source.type==='primary') || !evidence.some(source => source.type==='scholarly') || new Set(evidence.map(source => source.publisher.toLowerCase())).size < 2) invalid('Every historical claim requires both primary and independent scholarly evidence.');
    }
  }
  if (kind === 'tradition' && (!traditionLabel || !sources.some(source => source.type === 'official_tradition'))) invalid('Tradition-specific claims need an explicit label and an official source.');
  if (kind === 'tradition' && claims.some(claim => !sources.some(source => source.type==='official_tradition' && claim.sourceIds.includes(source.id)))) invalid('Every tradition-specific claim needs an official source.');
  let difficulty;
  if (input.difficulty != null) {
    const d=input.difficulty;
    if(d.rubricVersion!==DIFFICULTY_VERSION || !Number.isInteger(d.score) || d.score<0 || d.score>8 || d.level!==levelFor(d.score)) invalid('Difficulty must match the versioned rubric and score.');
    difficulty={rubricVersion:d.rubricVersion,level:d.level,score:d.score};
  }
  return { kind, category: category.trim(), prompt: prompt.trim(), heading: heading.trim(), scopeNote: scopeNote.trim(), choices, correctOptionId: input.correctOptionId, sources, claims, answerClaimId: input.answerClaimId, explanationClaimIds: input.explanationClaimIds, ...(scriptureReference ? { scriptureReference: string(scriptureReference, 'Scripture reference', 3, 100), translation } : {}), ...(traditionLabel ? { traditionLabel: string(traditionLabel, 'tradition label', 3, 120) } : {}), ...(difficulty ? {difficulty}: {}) };
}
function validateReview(input) {
  if (!input || ATTESTATIONS.some(key => input.attestations?.[key] !== true)) invalid('A human reviewer must read the sources and explicitly attest to every review criterion.');
  return { note: string(input.note, 'review rationale', 40, 4000), attestations: Object.fromEntries(ATTESTATIONS.map(key => [key, true])) };
}
function publicDiscovery(row, publicationDate) {
  const content = validateContent(row.content);
  return { id: row.discovery_id, revision: row.revision, publicationDate: publicationDate || null, ...content, explanation: content.explanationClaimIds.map(id => content.claims.find(claim => claim.id === id).text).join(' '), url: `https://sanctuaryapp.us/discoveries/${row.discovery_id}` };
}
function localDate(now = new Date(), timeZone = 'UTC') {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
    return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type).value).join('-');
  } catch { invalid('An IANA time zone is required.'); }
}
function shiftDate(value, days) {
  const shifted = new Date(`${value}T12:00:00Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}
function cohort(identity) { return createHash('sha256').update(`discovery:${identity}`).digest().readUInt32BE(0) % 100; }
function validateCompletion(event) {
  if (!event || !UUID.test(event.eventId) || !UUID.test(event.discoveryId) || !Number.isInteger(event.revision) || event.revision < 1 || !['answered', 'revealed'].includes(event.mode) || !date(event.localDate) || typeof event.timeZone !== 'string' || !event.timeZone || event.timeZone.length > 100 || typeof event.occurredAt !== 'string' || !Number.isFinite(Date.parse(event.occurredAt))) invalid('Invalid completion.');
  localDate(new Date(), event.timeZone);
  if ((event.mode === 'answered' && !ID.test(event.optionId)) || (event.mode === 'revealed' && event.optionId != null)) invalid('Answer choice does not match completion mode.');
  if(event.elapsedMs!=null && (!Number.isInteger(event.elapsedMs) || event.elapsedMs<0 || event.elapsedMs>20000 || (event.mode==='answered' && event.elapsedMs>=20000)))invalid('Invalid response time.');
  if(event.timedOut!==undefined && typeof event.timedOut!=='boolean')invalid('Invalid timeout.');
  if(event.timedOut && (event.mode!=='revealed' || event.elapsedMs!==20000))invalid('Invalid timeout.');
  if(localDate(new Date(event.occurredAt),event.timeZone)!==event.localDate)invalid('Completion date does not match its time zone.');
  return { eventId: event.eventId, discoveryId: event.discoveryId, revision: event.revision, mode: event.mode, optionId: event.optionId || null, occurredAt: event.occurredAt, localDate: event.localDate, timeZone: event.timeZone,...(event.elapsedMs!=null ? {elapsedMs:event.elapsedMs}:{}),...(event.timedOut!==undefined ? {timedOut:event.timedOut}:{}) };
}
module.exports = { UUID, ATTESTATIONS, date, https, invalid, validateContent, validateReview, validateCompletion, publicDiscovery, localDate, shiftDate, cohort };
