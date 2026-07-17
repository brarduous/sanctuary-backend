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

const tenantCount = 12;
const householdsPerTenant = 40;
const peoplePerTenant = 180;
const eventsPerTenant = 30;
const messagesPerTenant = 80;
const prayersPerTenant = 60;
const chunk = async (table, rows, size = 500) => { for (let index = 0; index < rows.length; index += size) { const { error } = await admin.from(table).insert(rows.slice(index, index + size)); if (error) throw new Error(`${table}: ${error.message}`); } };

(async () => {
  const counts = { congregations: 0, households: 0, people: 0, events: 0, messages: 0, prayers: 0 };
  for (let tenant = 1; tenant <= tenantCount; tenant += 1) {
    const email = `rehearsal-leader-${tenant}@example.invalid`;
    const { data: created, error: userError } = await admin.auth.admin.createUser({ email, password: `Rehearsal-${tenant}-Only!29x`, email_confirm: true });
    if (userError) throw userError;
    const { data: congregation, error: congregationError } = await admin.from('congregations').insert({ name: `Anonymized Congregation ${tenant}`, description: 'Synthetic production-shape rehearsal tenant', leader_user_id: created.user.id }).select('congregation_id').single();
    if (congregationError) throw congregationError;
    counts.congregations += 1;
    const congregationId = congregation.congregation_id;
    const households = Array.from({ length: householdsPerTenant }, (_, index) => ({ congregation_id: congregationId, name: `Household ${tenant}-${index + 1}`, primary_phone: `555${String(tenant).padStart(3, '0')}${String(index).padStart(4, '0')}` }));
    const { data: insertedHouseholds, error: householdError } = await admin.from('households').insert(households).select('id');
    if (householdError) throw householdError;
    counts.households += insertedHouseholds.length;
    const people = Array.from({ length: peoplePerTenant }, (_, index) => ({ congregation_id: congregationId, household_id: insertedHouseholds[index % insertedHouseholds.length].id, first_name: `Person${index + 1}`, last_name: `Tenant${tenant}`, email: `person-${tenant}-${index + 1}@example.invalid`, phone: `555${String(tenant).padStart(3, '0')}${String(index + 100).padStart(4, '0')}`, household_role: index % 5 === 0 ? 'child' : 'adult' }));
    await chunk('church_crm_profiles', people); counts.people += people.length;
    const events = Array.from({ length: eventsPerTenant }, (_, index) => ({ congregation_id: congregationId, title: `Synthetic Event ${index + 1}`, description: 'Anonymized event rehearsal record', event_date: new Date(Date.now() + index * 86400000).toISOString(), status: index % 3 === 0 ? 'published' : 'draft' }));
    await chunk('events', events); counts.events += events.length;
    const messages = Array.from({ length: messagesPerTenant }, (_, index) => ({ congregation_id: congregationId, title: `Synthetic Broadcast ${index + 1}`, message_type: 'announcement', message_body: 'Anonymized production-shape communication.', is_published: index % 2 === 0 }));
    await chunk('pastoral_messages', messages); counts.messages += messages.length;
    const prayers = Array.from({ length: prayersPerTenant }, (_, index) => ({ congregation_id: congregationId, user_id: created.user.id, request_text: `Anonymized care request ${index + 1}`, visibility: index % 3 === 0 ? 'pastor' : 'congregation' }));
    await chunk('prayer_requests', prayers); counts.prayers += prayers.length;
  }
  console.log(JSON.stringify({ branch: branch.name, synthetic: true, counts }));
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
