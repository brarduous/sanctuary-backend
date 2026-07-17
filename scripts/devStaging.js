const { execFileSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const STAGING_REF = 'yfijluyktqfzhwfgjsbb';
const stagingUrl = `https://${STAGING_REF}.supabase.co`;
const workspace = path.resolve(__dirname, '../..');
for (const app of ['sanctuary-clergy-web', 'sanctuary-layperson-web']) {
  if (fs.existsSync(path.join(workspace, app, '.next/dev/lock'))) {
    throw new Error(`${app} already has a development server running. Stop it before starting the staging stack.`);
  }
}

function fetchKeys() {
  const output = execFileSync('npx', ['supabase', 'projects', 'api-keys', '--project-ref', STAGING_REF, '--output', 'json'], {
    cwd: path.join(workspace, 'sanctuary-backend'), encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'],
  });
  const keys = JSON.parse(output);
  const anon = keys.find((key) => key.id === 'anon')?.api_key;
  const service = keys.find((key) => key.id === 'service_role')?.api_key;
  if (!anon || !service) throw new Error('Could not fetch staging Supabase credentials. Run `supabase login` first.');
  return { anon, service };
}

const { anon, service } = fetchKeys();
const shared = {
  ...process.env,
  NODE_ENV: 'development',
  SUPABASE_ENVIRONMENT: 'staging',
  SUPABASE_PROJECT_REF: STAGING_REF,
  NEXT_PUBLIC_DEPLOYMENT_ENV: 'staging',
  NEXT_PUBLIC_BYPASS_PAYWALL: 'true',
  NEXT_PUBLIC_SUPABASE_URL: stagingUrl,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: anon,
};

const services = [
  { name: 'backend', cwd: path.join(workspace, 'sanctuary-backend'), env: { ...shared, PORT: '3101', SUPABASE_URL: stagingUrl, SUPABASE_SERVICE_ROLE_KEY: service } },
  { name: 'clergy', cwd: path.join(workspace, 'sanctuary-clergy-web'), env: { ...shared, PORT: '3100', NEXT_PUBLIC_API_URL: 'http://localhost:3101' } },
  { name: 'layperson', cwd: path.join(workspace, 'sanctuary-layperson-web'), env: { ...shared, PORT: '3102', NEXT_PUBLIC_API_URL: 'http://localhost:3101' } },
];

const children = services.map(({ name, cwd, env }) => {
  const child = spawn('npm', ['run', 'dev'], { cwd, env, stdio: 'inherit' });
  child.on('exit', (code, signal) => {
    if (code && code !== 0) console.error(`${name} exited with code ${code}${signal ? ` (${signal})` : ''}`);
  });
  return child;
});

function stop() {
  children.forEach((child) => { if (!child.killed) child.kill('SIGTERM'); });
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
process.on('exit', stop);
