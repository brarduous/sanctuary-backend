const { execFileSync } = require('node:child_process');
const { createClient } = require('@supabase/supabase-js');

const REQUIRED_EMAIL = 'brandon.arduous@gmail.com';
const REQUIRED_PROJECT_REF = 'cmakuvkjxknwhonfqbit';
const args = process.argv.slice(2);
const valueAfter = (flag) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : null;
};
const email = String(valueAfter('--email') || '').trim().toLowerCase();
const projectRef = String(valueAfter('--project-ref') || '').trim();
const apply = args.includes('--apply');

if (email !== REQUIRED_EMAIL || projectRef !== REQUIRED_PROJECT_REF) {
  throw new Error(`Refusing reset. Supply --email ${REQUIRED_EMAIL} --project-ref ${REQUIRED_PROJECT_REF}.`);
}
const knownArgs = new Set(['--email', email, '--project-ref', projectRef, '--apply']);
for (const arg of args) if (!knownArgs.has(arg)) throw new Error(`Unknown reset argument: ${arg}`);

const loadServiceRoleKey = () => {
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) return process.env.SUPABASE_SERVICE_ROLE_KEY;
  const keys = JSON.parse(execFileSync('npx', ['supabase', 'projects', 'api-keys', '--project-ref', projectRef, '--output', 'json'], { encoding: 'utf8' }));
  const key = keys.find((candidate) => candidate.name === 'service_role');
  if (!key) throw new Error(`No service-role key is available for ${projectRef}.`);
  return key.api_key || key.key;
};
const db = createClient(`https://${projectRef}.supabase.co`, loadServiceRoleKey(), { auth: { persistSession: false } });

const assertResult = (result, label) => {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data;
};
const findAuthUser = async () => {
  for (let page = 1; page <= 50; page += 1) {
    const result = await db.auth.admin.listUsers({ page, perPage: 100 });
    if (result.error) throw result.error;
    const match = result.data.users.find((candidate) => candidate.email?.toLowerCase() === email);
    if (match) return match;
    if (result.data.users.length < 100) break;
  }
  return null;
};
const count = async (table, filters) => {
  let query = db.from(table).select('*', { count: 'exact', head: true });
  for (const [column, operator, value] of filters) query = query[operator](column, value);
  const result = await query;
  if (result.error) throw new Error(`Count ${table}: ${result.error.message}`);
  return result.count || 0;
};
const remove = async (table, filters) => {
  let query = db.from(table).delete();
  for (const [column, operator, value] of filters) query = query[operator](column, value);
  assertResult(await query, `Delete ${table}`);
};

const congregationTables = [
  'message_deliveries', 'communication_preferences', 'communication_groups', 'pastoral_messages',
  'gift_refunds', 'gifts', 'recurring_gifts', 'giving_batches', 'giving_funds',
  'checkin_labels', 'pickup_credentials', 'check_ins', 'kiosk_sessions', 'medical_alerts', 'guardian_relationships', 'checkin_rooms',
  'event_resource_bookings', 'event_registrations', 'event_volunteers', 'volunteer_rotations', 'volunteer_availability', 'volunteer_profiles', 'event_resources', 'events', 'volunteer_roles',
  'care_cases', 'person_timeline_events', 'person_segments', 'prayer_requests', 'church_crm_profiles', 'households',
  'staff_invitations', 'campuses', 'organization_memberships', 'congregation_members',
];
const userTables = [
  ['ai_generation_runs', 'owner_user_id'],
  ['content_versions', 'owner_user_id'],
  ['content_feedback', 'user_id'],
  ['user_activities', 'user_id'],
  ['api_idempotency_records', 'actor_user_id'],
  ['bible_study_lessons', 'user_id'],
  ['bible_studies', 'user_id'],
  ['sermons', 'user_id'],
  ['sermon_series', 'user_id'],
  ['pastor_voice_profiles', 'user_id'],
];

async function main() {
  const user = await findAuthUser();
  if (!user) throw new Error(`No auth identity exists for ${email}.`);
  const congregation = assertResult(await db.from('congregations').select('congregation_id,name,leader_user_id').eq('leader_user_id', user.id).limit(1).single(), 'Load owned congregation');
  if (congregation.leader_user_id !== user.id) throw new Error('The target user is not the congregation owner.');
  const congregationId = congregation.congregation_id;
  const profileBefore = assertResult(await db.from('user_profiles').select('tier,subscription_tier,stripe_customer_id,stripe_subscription_id').eq('user_id', user.id).single(), 'Load retained subscription profile');

  const targetCounts = {};
  for (const table of congregationTables) targetCounts[table] = await count(table, [['congregation_id', 'eq', congregationId]]);
  for (const [table, column] of userTables) targetCounts[table] = await count(table, [[column, 'eq', user.id]]);
  targetCounts.audit_events_preserved = await count('audit_events', [['congregation_id', 'eq', congregationId]]);

  const isolationTables = ['church_crm_profiles', 'events', 'prayer_requests', 'pastoral_messages', 'organization_memberships'];
  const unrelatedBefore = {};
  for (const table of isolationTables) unrelatedBefore[table] = await count(table, [['congregation_id', 'neq', congregationId]]);

  console.log(JSON.stringify({ mode: apply ? 'APPLY' : 'DRY_RUN', projectRef, email, userId: user.id, congregation: { id: congregationId, name: congregation.name }, retained: profileBefore, targetCounts, unrelatedBefore }, null, 2));
  if (!apply) {
    console.log('Dry run complete. No rows were changed. Re-run the exact command with --apply to execute this scoped reset.');
    return;
  }

  // User-owned children first. Voice sources and sermon revisions cascade from
  // their parent rows; Bible-study lessons are explicit because their FK does not cascade.
  await remove('ai_generation_runs', [['owner_user_id', 'eq', user.id]]);
  await remove('content_versions', [['owner_user_id', 'eq', user.id]]);
  await remove('content_feedback', [['user_id', 'eq', user.id]]);
  await remove('user_activities', [['user_id', 'eq', user.id]]);
  await remove('api_idempotency_records', [['actor_user_id', 'eq', user.id]]);
  await remove('bible_study_lessons', [['user_id', 'eq', user.id]]);
  await remove('bible_studies', [['user_id', 'eq', user.id]]);
  await remove('pastor_voice_profiles', [['user_id', 'eq', user.id]]);
  await remove('sermons', [['user_id', 'eq', user.id]]);
  await remove('sermon_series', [['user_id', 'eq', user.id]]);

  // Congregation-owned records in foreign-key-safe order.
  for (const table of congregationTables) {
    await remove(table, [['congregation_id', 'eq', congregationId]]);
  }

  assertResult(await db.from('user_profiles').update({
    sermon_preferences: null,
    ai_tuning_notes: '',
    user_preferences: null,
    updated_at: new Date().toISOString(),
  }).eq('user_id', user.id), 'Clear onboarding preferences');
  assertResult(await db.from('congregations').update({
    name: 'New Congregation',
    description: null,
    invite_token: null,
    youtube_channel_id: null,
    stripe_account_id: null,
    stripe_charges_enabled: false,
    stripe_details_submitted: false,
    onboarding_reset_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('congregation_id', congregationId).eq('leader_user_id', user.id), 'Reset congregation shell');

  assertResult(await db.from('audit_events').insert({
    congregation_id: congregationId,
    actor_user_id: user.id,
    action: 'operator.account_product_data_reset',
    resource_type: 'user_account',
    resource_id: user.id,
    metadata: { email, project_ref: projectRef, deleted_row_counts: targetCounts, content_backup_created: false, auth_identity_preserved: true },
  }), 'Write reset audit event');

  const authAfter = await db.auth.admin.getUserById(user.id);
  if (authAfter.error || authAfter.data.user?.email?.toLowerCase() !== email) throw new Error('Post-reset auth identity verification failed.');
  const profileAfter = assertResult(await db.from('user_profiles').select('tier,subscription_tier,stripe_customer_id,stripe_subscription_id,sermon_preferences,ai_tuning_notes').eq('user_id', user.id).single(), 'Verify retained subscription profile');
  for (const field of ['tier', 'subscription_tier', 'stripe_customer_id', 'stripe_subscription_id']) {
    if (profileAfter[field] !== profileBefore[field]) throw new Error(`Post-reset retained field changed: ${field}`);
  }

  const remaining = {};
  for (const table of congregationTables) remaining[table] = await count(table, [['congregation_id', 'eq', congregationId]]);
  for (const [table, column] of userTables) remaining[table] = await count(table, [[column, 'eq', user.id]]);
  const nonEmpty = Object.entries(remaining).filter(([, rowCount]) => rowCount !== 0);
  if (nonEmpty.length) throw new Error(`Post-reset scoped rows remain: ${JSON.stringify(nonEmpty)}`);
  const unrelatedAfter = {};
  for (const table of isolationTables) unrelatedAfter[table] = await count(table, [['congregation_id', 'neq', congregationId]]);
  if (JSON.stringify(unrelatedAfter) !== JSON.stringify(unrelatedBefore)) throw new Error('Cross-tenant isolation verification failed.');

  console.log(JSON.stringify({ status: 'reset_complete', remaining, unrelatedAfter, authIdentityPreserved: true, retained: profileAfter, auditEventsNow: await count('audit_events', [['congregation_id', 'eq', congregationId]]) }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
