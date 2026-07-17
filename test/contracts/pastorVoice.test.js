const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { checkSourceSimilarity } = require('../../utils/sourceSimilarity');

const read = (relative) => fs.readFileSync(path.join(__dirname, '../..', relative), 'utf8');
const sermonRoute = read('routes/sermons.js');
const studyRoute = read('routes/bibleStudies.js');
const analysisRoute = read('routes/analysis.js');
const resetScript = read('scripts/resetProductionAccount.js');
const migration = read('supabase/migrations/20260718120000_pastor_voice_profiles.sql');

test('quality-critical generation is server-owned and uses structured Responses calls', () => {
  for (const source of [sermonRoute, studyRoute, analysisRoute]) {
    assert.match(source, /callStructuredResponse/);
    assert.doesNotMatch(source, /gpt-4\.1|chat\.completions/);
  }
  assert.doesNotMatch(sermonRoute, /getStylePrompts|sermon_preferences:\s*req\.body|userProfile/);
  assert.match(sermonRoute, /getActiveVoiceContext\(userId\)/);
  assert.match(studyRoute, /buildVoiceInstructions\(voiceContext, 'bible_study'\)/);
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
