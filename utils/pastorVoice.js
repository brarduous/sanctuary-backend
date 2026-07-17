const supabase = require('../config/supabase');
const { normalizeWords, buildNgrams, checkSourceSimilarity } = require('./sourceSimilarity');

const PROMPT_VERSION = 'pastor-voice-v2-canonical-review';

async function getCongregationContext(userId) {
  const { data: membership, error: membershipError } = await supabase
    .from('organization_memberships')
    .select('congregation_id')
    .eq('user_id', userId)
    .eq('active', true)
    .limit(1)
    .maybeSingle();
  if (membershipError) throw membershipError;

  let congregationId = membership?.congregation_id || null;
  if (!congregationId) {
    const { data: owned, error: ownedError } = await supabase
      .from('congregations')
      .select('congregation_id')
      .eq('leader_user_id', userId)
      .limit(1)
      .maybeSingle();
    if (ownedError) throw ownedError;
    congregationId = owned?.congregation_id || null;
  }
  if (!congregationId) return null;

  const { data, error } = await supabase
    .from('congregations')
    .select('congregation_id, name, description')
    .eq('congregation_id', congregationId)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function getActiveVoiceContext(userId) {
  const [congregation, profileResult, preferencesResult] = await Promise.all([
    getCongregationContext(userId),
    supabase.from('pastor_voice_profiles').select('*').eq('user_id', userId).eq('status', 'active').order('version', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('user_profiles').select('sermon_preferences').eq('user_id', userId).limit(1).maybeSingle(),
  ]);
  if (profileResult.error) throw profileResult.error;
  if (preferencesResult.error) throw preferencesResult.error;

  return {
    congregation,
    profileRecord: profileResult.data || null,
    profile: profileResult.data?.profile || null,
    legacyPreferences: preferencesResult.data?.sermon_preferences || null,
    declaredTradition: preferencesResult.data?.sermon_preferences?.denomination
      || congregation?.description
      || null,
  };
}

async function getVoiceSourceTexts(userId, profileId) {
  if (!profileId) return [];
  const { data: sources, error: sourceError } = await supabase
    .from('pastor_voice_sources')
    .select('title, sermon_id')
    .eq('user_id', userId)
    .eq('profile_id', profileId);
  if (sourceError) throw sourceError;
  const sermonIds = (sources || []).map((source) => source.sermon_id).filter(Boolean);
  if (!sermonIds.length) return [];
  const { data: sermons, error: sermonError } = await supabase
    .from('sermons')
    .select('sermon_id, sermon_body')
    .eq('user_id', userId)
    .in('sermon_id', sermonIds);
  if (sermonError) throw sermonError;
  const bodyById = new Map((sermons || []).map((sermon) => [sermon.sermon_id, sermon.sermon_body]));
  return (sources || []).map((source) => ({ title: source.title, text: bodyById.get(source.sermon_id) || '' })).filter((source) => source.text);
}

function buildVoiceInstructions(context, artifactType) {
  const congregationLine = context.congregation
    ? `Congregation: ${context.congregation.name}. ${context.congregation.description || ''}`
    : 'Congregation: not yet configured. Do not invent a church name, location, or congregational history.';
  const profile = context.profile;
  const legacy = context.legacyPreferences;

  if (!profile && !legacy) {
    return `${congregationLine}\nNo reviewed pastor voice profile is active. Use a warm, biblically grounded pastoral voice without inventing personal stories.`;
  }

  const voice = profile || {
    preachingStructure: legacy.customPreachingDesc ? [legacy.customPreachingDesc] : [legacy.preachingStyle].filter(Boolean),
    cadence: { summary: legacy.customOratoricalDesc || legacy.oratoricalStyle || 'natural pastoral speech' },
    vocabularyTendencies: [], illustrationPatterns: [], theologicalConstraints: [], congregationalContext: [], prohibitedCopying: [],
  };
  const artifactRule = artifactType === 'bible_study'
    ? 'Apply the pastor’s vocabulary, theological convictions, illustration habits, and application style. Keep commentary explanatory, facilitator guidance practical, and questions genuinely discussable. Do not turn lessons into sermon transcripts.'
    : 'Apply the full rhetorical profile to structure, cadence, transitions, imagery, and pastoral application while preserving the requested sermon format, channel, scripture, and duration.';

  return [
    congregationLine,
    `Declared church tradition: ${context.declaredTradition || 'not specified'}. Do not invent a more specific confession or position. Where this tradition contains meaningful internal diversity, avoid presenting one disputed position as universal and flag it for pastor review.`,
    `Pastor voice profile (derived traits, not source prose): ${JSON.stringify(voice)}`,
    artifactRule,
    'Scriptural integrity contract: never put words in the mouth of God, Jesus, a biblical narrator, or another biblical character unless the wording is present in the cited passage. Clearly label paraphrase as paraphrase; never turn inference, composite wording, or application into a quotation. No interpretation or application may contradict the requested passage or the wider canonical witness of Scripture.',
    'Doctrinal integrity contract: keep theological claims within the declared church tradition and the profile’s explicit theological constraints. Do not manufacture a position from a denomination label. Treat internally disputed or unspecified issues as matters for pastor review rather than asserting them as settled doctrine.',
    'Originality contract: never name or attribute language to a source author; never quote or closely paraphrase the samples; never reproduce a distinctive 12-word source sequence; minimize matching eight-word phrases; invent no quotations or personal experiences.',
  ].join('\n');
}

module.exports = {
  PROMPT_VERSION,
  normalizeWords,
  buildNgrams,
  checkSourceSimilarity,
  getActiveVoiceContext,
  getVoiceSourceTexts,
  buildVoiceInstructions,
};
