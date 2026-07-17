const { execFileSync } = require('node:child_process');
const { createClient } = require('@supabase/supabase-js');

const ref = process.env.REHEARSAL_SUPABASE_REF;
const parentRef = process.env.PRODUCTION_SUPABASE_PROJECT_REF || 'cmakuvkjxknwhonfqbit';
if (!ref || [parentRef, 'yfijluyktqfzhwfgjsbb'].includes(ref)) throw new Error('Use a disposable readiness rehearsal branch, never staging or production.');
const branches = JSON.parse(execFileSync('npx', ['supabase', 'branches', 'list', '--project-ref', parentRef, '--output', 'json'], { encoding: 'utf8' }));
const branch = branches.find((candidate) => candidate.project_ref === ref);
if (!branch || !branch.name.startsWith('readiness-rehearsal-') || branch.with_data) throw new Error('The target must be an empty readiness-rehearsal preview branch.');
const keys = JSON.parse(execFileSync('npx', ['supabase', 'projects', 'api-keys', '--project-ref', ref, '--output', 'json'], { encoding: 'utf8' }));
const serviceKey = keys.find((key) => key.id === 'service_role')?.api_key;
if (!serviceKey) throw new Error('Could not retrieve the rehearsal service role.');
const admin = createClient(`https://${ref}.supabase.co`, serviceKey, { auth: { persistSession: false } });
const expected = { congregations: 12, households: 480, church_crm_profiles: 2160, events: 360, pastoral_messages: 960, prayer_requests: 720 };

(async () => {
  const counts = {};
  for (const [table, minimum] of Object.entries(expected)) {
    const { count, error } = await admin.from(table).select('*', { count: 'exact', head: true });
    if (error) throw new Error(`${table}: ${error.message}`);
    if (count < minimum) throw new Error(`${table}: expected at least ${minimum}, found ${count}`);
    counts[table] = count;
  }
  const { count: orphanPeople, error: orphanError } = await admin.from('church_crm_profiles').select('*', { count: 'exact', head: true }).is('congregation_id', null);
  if (orphanError) throw orphanError;
  if (orphanPeople !== 0) throw new Error(`Found ${orphanPeople} people without a tenant.`);
  for (const table of ['communication_groups', 'care_cases', 'giving_gifts', 'content_versions', 'checkin_rooms']) {
    const { error } = await admin.from(table).select('*', { count: 'exact', head: true });
    if (error) throw new Error(`${table}: ${error.message}`);
  }
  const { data: sample, error: sampleError } = await admin.from('church_crm_profiles').select('id,lifecycle_status,tags,custom_fields,consent_status').limit(1).single();
  if (sampleError) throw sampleError;
  if (!sample.lifecycle_status || !Array.isArray(sample.tags) || sample.custom_fields === null || !sample.consent_status) throw new Error('Migrated person defaults are incomplete.');
  console.log(JSON.stringify({ branch: branch.name, verified: true, counts, invariants: { orphanPeople, newTablesReadable: true, personDefaultsBackfilled: true } }));
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
