const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const PRODUCTION_REF = process.env.PRODUCTION_SUPABASE_PROJECT_REF || 'cmakuvkjxknwhonfqbit';
const command = process.argv[2];
const migration = process.argv[3];
const repository = path.resolve(__dirname, '..');
const linkedRefPath = path.join(repository, 'supabase/.temp/project-ref');

function fail(message) { throw new Error(message); }
function requireReviewedApproval(action) {
  if (process.env.PRODUCTION_CHANGE_APPROVED !== 'reviewed') fail(`Set PRODUCTION_CHANGE_APPROVED=reviewed only after separate review for ${action}.`);
  if (!process.env.PRODUCTION_APPROVED_BY || !process.env.PRODUCTION_CHANGE_TICKET) fail('PRODUCTION_APPROVED_BY and PRODUCTION_CHANGE_TICKET are required.');
  if (!fs.existsSync(linkedRefPath) || fs.readFileSync(linkedRefPath, 'utf8').trim() !== PRODUCTION_REF) fail(`Supabase CLI must already be explicitly linked to production ref ${PRODUCTION_REF}. This command never relinks projects.`);
}
function requireFreshBackup() {
  const value = process.env.PRODUCTION_BACKUP_VERIFIED_AT;
  const timestamp = Date.parse(value || '');
  if (!Number.isFinite(timestamp) || Date.now() - timestamp > 24 * 60 * 60 * 1000 || timestamp > Date.now() + 5 * 60 * 1000) fail('PRODUCTION_BACKUP_VERIFIED_AT must identify a recoverable backup verified within the last 24 hours.');
  if (!process.env.PRODUCTION_BACKUP_RESTORE_EVIDENCE) fail('PRODUCTION_BACKUP_RESTORE_EVIDENCE is required.');
}
function run(binary, args, options = {}) { return execFileSync(binary, args, { cwd: repository, stdio: 'inherit', ...options }); }

if (command === 'preflight') {
  requireReviewedApproval('migration preflight');
  requireFreshBackup();
  const status = execFileSync('git', ['status', '--porcelain'], { cwd: repository, encoding: 'utf8' });
  if (status.trim()) fail('Production preflight requires a clean, reviewed release commit.');
  run('npm', ['run', 'typecheck']);
  run('npm', ['test']);
  run('npx', ['supabase', 'migration', 'list']);
  run('npx', ['supabase', 'db', 'push', '--dry-run']);
  console.log(`Production migration preflight passed for ticket ${process.env.PRODUCTION_CHANGE_TICKET}; no migration was applied.`);
} else if (command === 'rollback') {
  if (!migration || !/^\d{14}$/.test(migration)) fail('Usage: npm run db:production:rollback -- <14-digit-migration-version>');
  requireReviewedApproval(`rollback ${migration}`);
  requireFreshBackup();
  if (process.env.PRODUCTION_ROLLBACK_CONFIRM !== migration) fail(`Set PRODUCTION_ROLLBACK_CONFIRM=${migration} after reviewing the version-specific rollback.`);
  if (!process.env.PRODUCTION_DATABASE_URL) fail('PRODUCTION_DATABASE_URL is required for an approved rollback window.');
  const rollback = path.join(repository, `supabase/rollbacks/${migration}.sql`);
  if (!fs.existsSync(rollback)) fail(`No reviewed rollback exists for migration ${migration}.`);
  run('psql', [process.env.PRODUCTION_DATABASE_URL, '-v', 'ON_ERROR_STOP=1', '-v', `approved_by=${process.env.PRODUCTION_APPROVED_BY}`, '-v', `change_ticket=${process.env.PRODUCTION_CHANGE_TICKET}`, '-f', rollback]);
  console.log(`Rollback ${migration} applied. Run the read-only post-rollback verification documented in docs/PRODUCTION_MIGRATION_SAFETY.md.`);
} else {
  fail('Use `preflight` or `rollback <migration-version>`.');
}
