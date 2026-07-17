const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createClient } = require('@supabase/supabase-js');

const REQUIRED_EMAIL = 'brandon.arduous@gmail.com';
const REQUIRED_REF = 'cmakuvkjxknwhonfqbit';
const args = process.argv.slice(2);
const after = (flag) => { const index = args.indexOf(flag); return index >= 0 ? args[index + 1] : null; };
const email = String(after('--email') || '').toLowerCase();
const projectRef = String(after('--project-ref') || '');
const profileId = String(after('--profile-id') || '');
const apply = args.includes('--apply');
const ownerReviewed = args.includes('--owner-reviewed');
if (email !== REQUIRED_EMAIL || projectRef !== REQUIRED_REF || !/^[0-9a-f-]{36}$/i.test(profileId)) throw new Error('Supply the exact production email, project ref, and evaluated profile UUID.');
if (apply && !ownerReviewed) throw new Error('Cleanup requires --owner-reviewed after Brandon records a final treatment preference.');

const keys = process.env.SUPABASE_SERVICE_ROLE_KEY ? null : JSON.parse(execFileSync('npx', ['supabase', 'projects', 'api-keys', '--project-ref', projectRef, '--output', 'json'], { encoding: 'utf8' }));
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || keys.find((key) => key.name === 'service_role')?.api_key;
const db = createClient(`https://${projectRef}.supabase.co`, serviceKey, { auth: { persistSession: false } });
const resultDir = path.resolve(__dirname, '../../sanctuary-clergy-web/qa-fixtures/sermon-voice/evaluation-private');

async function main() {
  let user = null;
  for (let page = 1; page <= 20 && !user; page += 1) {
    const result = await db.auth.admin.listUsers({ page, perPage: 100 });
    if (result.error) throw result.error;
    user = result.data.users.find((candidate) => candidate.email?.toLowerCase() === email) || null;
  }
  if (!user) throw new Error('Target auth user not found.');
  const profileResult = await db.from('pastor_voice_profiles').select('id,status,temporary_evaluation,source_hashes').eq('id', profileId).eq('user_id', user.id).single();
  if (profileResult.error) throw profileResult.error;
  if (!profileResult.data.temporary_evaluation) throw new Error('Refusing cleanup because the profile is not marked temporary evaluation.');
  const sourceResult = await db.from('pastor_voice_sources').select('id,sermon_id,checksum_sha256').eq('profile_id', profileId).eq('user_id', user.id);
  if (sourceResult.error) throw sourceResult.error;
  const sermonIds = sourceResult.data.map((source) => source.sermon_id).filter(Boolean);
  console.log(JSON.stringify({ mode: apply ? 'APPLY' : 'DRY_RUN', profile: profileResult.data, sources: sourceResult.data.length, sermonIds, privateResultDirectory: resultDir }, null, 2));
  if (!apply) return;
  const profileDelete = await db.from('pastor_voice_profiles').delete().eq('id', profileId).eq('user_id', user.id).eq('temporary_evaluation', true);
  if (profileDelete.error) throw profileDelete.error;
  if (sermonIds.length) {
    const sermonDelete = await db.from('sermons').delete().eq('user_id', user.id).in('sermon_id', sermonIds);
    if (sermonDelete.error) throw sermonDelete.error;
  }
  if (fs.existsSync(resultDir)) {
    for (const filename of fs.readdirSync(resultDir)) {
      if (filename.endsWith('-private-results.json')) fs.rmSync(path.join(resultDir, filename));
    }
  }
  console.log(JSON.stringify({ status: 'temporary_sources_deleted', profileId, sourceCount: sourceResult.data.length, sermonCount: sermonIds.length, aggregateScoresRetained: true }, null, 2));
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
