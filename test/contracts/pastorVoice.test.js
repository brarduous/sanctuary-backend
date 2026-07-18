const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { checkSourceSimilarity } = require('../../utils/sourceSimilarity');
const { summarizeTheologicalReview } = require('../../utils/theologicalReview');
const { generationRequestsMatch } = require('../../utils/generationRequests');

const read = (relative) => fs.readFileSync(path.join(__dirname, '../..', relative), 'utf8');
const sermonRoute = read('routes/sermons.js');
const studyRoute = read('routes/bibleStudies.js');
const analysisRoute = read('routes/analysis.js');
const aiRoute = read('routes/ai.js');
const pastorVoice = read('utils/pastorVoice.js');
const theologicalReview = read('utils/theologicalReview.js');
const pastorReviewGate = read('utils/pastorReviewGate.js');
const openaiResponses = read('utils/openaiResponses.js');
const contentImages = read('utils/contentImages.js');
const openaiConfig = read('config/openai.js');
const resetScript = read('scripts/resetProductionAccount.js');
const migration = read('supabase/migrations/20260718120000_pastor_voice_profiles.sql');

test('quality-critical generation is server-owned and uses structured Responses calls', () => {
  for (const source of [sermonRoute, studyRoute, analysisRoute, aiRoute]) {
    assert.match(source, /callStructuredResponse/);
    assert.doesNotMatch(source, /gpt-4\.1|chat\.completions/);
  }
  assert.doesNotMatch(sermonRoute, /getStylePrompts|sermon_preferences:\s*req\.body|userProfile/);
  assert.match(sermonRoute, /getActiveVoiceContext\(userId\)/);
  assert.match(studyRoute, /buildVoiceInstructions\(voiceContext, 'bible_study'\)/);
});

test('OpenAI configuration initializes lazily so CI imports require no production secret', () => {
  assert.match(openaiConfig, /getOpenAIClient/);
  assert.match(openaiConfig, /new Proxy/);
  assert.ok(openaiConfig.indexOf('if (!process.env.OPENAI_API_KEY)') < openaiConfig.indexOf('new OpenAI'));
});

test('generated and rewritten pastoral content is gated for canonical and doctrinal integrity', () => {
  for (const source of [sermonRoute, studyRoute, aiRoute]) assert.match(source, /reviewPastoralContent/);
  assert.match(aiRoute, /authenticateUser, aiLimiter/);
  assert.doesNotMatch(aiRoute, /x-user-id|gpt-4o-mini|Instruction: \$\{instruction\}/);
  assert.match(pastorVoice, /Scriptural integrity contract/);
  assert.match(pastorVoice, /Declared church tradition/);
  assert.match(theologicalReview, /THEOLOGICAL_REVIEW_REJECTED/);

  assert.deepEqual(summarizeTheologicalReview({
    passed: false,
    requiresPastorReview: true,
    attributedSpeechIssues: [{ severity: 'blocking' }],
    canonicalConsistencyIssues: [{ severity: 'review' }],
    doctrinalIssues: [],
  }), {
    status: 'rejected',
    requiresPastorReview: true,
    blockingIssueCount: 1,
    reviewIssueCount: 1,
  });
});

test('pastor-review requirements are persisted, returned to editors, and enforced at publish', () => {
  assert.match(pastorReviewGate, /pastorReviewAcknowledgement/);
  assert.match(pastorReviewGate, /acknowledgedBy: ownerUserId/);
  assert.match(studyRoute, /PASTOR_REVIEW_REQUIRED/);
  assert.match(studyRoute, /CONTENT_REVIEW_REJECTED/);
  assert.match(studyRoute, /acknowledge_pastor_review !== true/);
  assert.match(studyRoute, /pastor_review/);
  assert.match(sermonRoute, /pastor_review/);
});

test('quality generations are persisted before the model call and finalized with usage and cost', () => {
  for (const source of [sermonRoute, studyRoute, aiRoute]) {
    assert.match(source, /ai_generation_runs/);
    assert.match(source, /status:\s*'running'/);
    assert.match(source, /estimated_cost_usd/);
    assert.match(source, /input_token_count/);
    assert.match(source, /output_token_count/);
  }
  assert.ok(studyRoute.indexOf("status: 'running'") < studyRoute.indexOf('const generation = await callStructuredResponse({'));
  assert.ok(aiRoute.indexOf("status: 'running'") < aiRoute.indexOf('callStructuredResponse({'));
});

test('generation retries twice before a soft failure and preserves exact retry lineage', () => {
  assert.match(openaiResponses, /OPENAI_QUALITY_MAX_RETRIES \|\| 2/);
  assert.match(contentImages, /OPENAI_IMAGE_MAX_RETRIES \|\| 2/);
  assert.match(openaiResponses, /timeoutMs = QUALITY_TIMEOUT_MS/);
  assert.match(openaiResponses, /maxRetries = QUALITY_MAX_RETRIES/);
  assert.match(studyRoute, /OPENAI_BIBLE_STUDY_TIMEOUT_MS \|\| 420000/);
  assert.match(studyRoute, /OPENAI_BIBLE_STUDY_MAX_OUTPUT_TOKENS \|\| 10000/);
  assert.match(studyRoute, /timeoutMs: BIBLE_STUDY_GENERATION_TIMEOUT_MS/);
  assert.match(studyRoute, /450–650 words of commentary per lesson/);
  assert.match(studyRoute, /maxOutputTokens: BIBLE_STUDY_MAX_OUTPUT_TOKENS/);
  for (const source of [sermonRoute, studyRoute]) {
    assert.match(source, /retryOfGenerationRunId/);
    assert.match(source, /retry_of_id/);
    assert.match(source, /request: requestMetadata/);
    assert.match(source, /Retry inputs must exactly match/);
  }
  assert.equal(generationRequestsMatch(
    { topic: 'Mark 5', lessonCount: 4, method: 'Expository' },
    { method: 'Expository', topic: 'Mark 5', lessonCount: 4 }
  ), true);
  assert.equal(generationRequestsMatch(
    { topic: 'Mark 5', lessonCount: 4, method: 'Expository' },
    { topic: 'Mark 5', lessonCount: 3, method: 'Expository' }
  ), false);
});

test('style analysis uses complete balanced in-memory extraction and delayed persistence', () => {
  assert.match(analysisRoute, /memoryStorage/);
  assert.match(analysisRoute, /Promise\.all\(files\.map/);
  assert.match(analysisRoute, /SOURCE \$\{index \+ 1\} OF \$\{extracted\.length\}/);
  assert.doesNotMatch(analysisRoute, /substring\(0,\s*25000\)|dest:\s*['"]uploads/);
  assert.ok(analysisRoute.indexOf('callStructuredResponse') < analysisRoute.indexOf("from('sermons').insert"));
  assert.match(analysisRoute, /finally[\s\S]*req\.files = undefined/);
});

test('source similarity hard-fails attribution, twelve-word copying, and excessive eight-word matches', () => {
  const source = 'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen';
  assert.equal(checkSourceSimilarity('Dr. King would say something original.', [{ text: source }]).passed, false);
  assert.equal(checkSourceSimilarity('one two three four five six seven eight nine ten eleven twelve', [{ text: source }]).passed, false);
  assert.equal(checkSourceSimilarity('A completely fresh pastoral application for this congregation today.', [{ text: source }]).passed, true);
});

test('production reset is exact-account guarded, dry-run by default, and preserves audit/auth/tier', () => {
  assert.match(resetScript, /REQUIRED_EMAIL = 'brandon\.arduous@gmail\.com'/);
  assert.match(resetScript, /REQUIRED_PROJECT_REF = 'cmakuvkjxknwhonfqbit'/);
  assert.match(resetScript, /const apply = args\.includes\('--apply'\)/);
  assert.match(resetScript, /audit_events/);
  assert.match(resetScript, /authIdentityPreserved: true/);
  assert.match(resetScript, /subscription_tier/);
  assert.doesNotMatch(resetScript, /deleteUser/);
});

test('voice profile migration versions profiles, tracks source rights and locks direct writes', () => {
  for (const required of ['pastor_voice_profiles', 'pastor_voice_sources', 'rights_attested', 'temporary_evaluation', 'retention_until', 'voice_profile_id', 'prompt_version']) assert.match(migration, new RegExp(required));
  assert.match(migration, /force row level security/);
  assert.match(migration, /revoke all on public\.pastor_voice_profiles, public\.pastor_voice_sources from anon, authenticated/);
});
