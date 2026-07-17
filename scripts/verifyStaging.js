const { execFileSync } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const STAGING_REF = 'yfijluyktqfzhwfgjsbb';
const PRODUCTION_REF = process.env.PRODUCTION_SUPABASE_PROJECT_REF || 'cmakuvkjxknwhonfqbit';
const repository = path.resolve(__dirname, '..');
const linkedRef = fs.readFileSync(path.join(repository, 'supabase/.temp/project-ref'), 'utf8').trim();
if (linkedRef !== STAGING_REF || linkedRef === PRODUCTION_REF) throw new Error('Staging verification requires an explicit link to the dedicated staging branch.');

const keys = JSON.parse(execFileSync('npx', ['supabase', 'projects', 'api-keys', '--project-ref', STAGING_REF, '--output', 'json'], { cwd: repository, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }));
const anon = keys.find((key) => key.id === 'anon')?.api_key;
const service = keys.find((key) => key.id === 'service_role')?.api_key;
if (!anon || !service) throw new Error('Could not fetch staging API credentials.');

const env = {
  ...process.env,
  NODE_ENV: 'test',
  SUPABASE_ENVIRONMENT: 'staging',
  SUPABASE_URL: `https://${STAGING_REF}.supabase.co`,
  NEXT_PUBLIC_SUPABASE_URL: `https://${STAGING_REF}.supabase.co`,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: anon,
  SUPABASE_SERVICE_ROLE_KEY: service,
  STAGING_ISOLATION_TEST_PASSWORD: `Staging-${randomBytes(18).toString('base64url')}!9a`,
};

for (const script of ['verifyMessageIsolation.js', 'verifyEventVolunteerJourney.js', 'verifyCheckinJourney.js', 'verifyContentProductionJourney.js']) {
  console.log(`Running ${script} against dedicated staging...`);
  execFileSync(process.execPath, [path.join(__dirname, script)], { cwd: repository, env, stdio: 'inherit' });
}

console.log('All dedicated staging verification journeys passed.');
