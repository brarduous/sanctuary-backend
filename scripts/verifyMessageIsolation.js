const { createClient } = require('@supabase/supabase-js');

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const password = process.env.STAGING_ISOLATION_TEST_PASSWORD;

if (!url || !serviceKey || !anonKey || !password) {
  throw new Error('Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_SUPABASE_ANON_KEY, and STAGING_ISOLATION_TEST_PASSWORD.');
}
if (process.env.NODE_ENV === 'production') throw new Error('Isolation fixtures must never run in production.');

const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
const fixtures = [
  { email: 'message-harbor@example.com', congregationId: 900001, role: 'lead_pastor' },
  { email: 'message-hillside@example.com', congregationId: 900002, role: 'lead_pastor' },
  { email: 'message-restricted@example.com', congregationId: 900001, role: 'care' },
];

async function ensureUser(fixture) {
  let page = 1;
  let user;
  while (!user) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 100 });
    if (error) throw error;
    user = data.users.find((candidate) => candidate.email === fixture.email);
    if (user || data.users.length < 100) break;
    page += 1;
  }
  if (!user) {
    const { data, error } = await admin.auth.admin.createUser({ email: fixture.email, password, email_confirm: true });
    if (error) throw error;
    user = data.user;
  } else {
    const { error } = await admin.auth.admin.updateUserById(user.id, { password });
    if (error) throw error;
  }

  const { data: membership, error: membershipReadError } = await admin.from('organization_memberships')
    .select('id').eq('congregation_id', fixture.congregationId).eq('user_id', user.id).is('campus_id', null).maybeSingle();
  if (membershipReadError) throw membershipReadError;
  if (!membership) {
    const { error } = await admin.from('organization_memberships').insert({ congregation_id: fixture.congregationId, user_id: user.id, role: fixture.role });
    if (error) throw error;
  } else {
    const { error } = await admin.from('organization_memberships').update({ role: fixture.role, active: true }).eq('id', membership.id);
    if (error) throw error;
  }
  return user;
}

async function signedInClient(email) {
  const client = createClient(url, anonKey, { auth: { persistSession: false } });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return client;
}

(async () => {
  const users = await Promise.all(fixtures.map(ensureUser));
  await admin.from('pastoral_messages').upsert([
    { congregation_id: 900001, author_id: users[0].id, title: 'Harbor isolation fixture', message_body: 'Harbor only', is_published: false },
    { congregation_id: 900002, author_id: users[1].id, title: 'Hillside isolation fixture', message_body: 'Hillside only', is_published: false },
  ], { onConflict: 'congregation_id,title' }).then(({ error }) => { if (error && error.code !== '42P10') throw error; });

  const [harbor, hillside, restricted] = await Promise.all(fixtures.map((fixture) => signedInClient(fixture.email)));
  const results = await Promise.all([harbor, hillside, restricted].map((client) => client.from('pastoral_messages').select('congregation_id')));
  results.forEach(({ error }) => { if (error) throw error; });
  const tenantSets = results.map(({ data }) => [...new Set(data.map((row) => row.congregation_id))]);
  if (tenantSets[0].some((id) => id !== 900001) || tenantSets[1].some((id) => id !== 900002) || tenantSets[2].length !== 0) {
    throw new Error(`Message isolation failed: ${JSON.stringify(tenantSets)}`);
  }
  const crossTenant = await harbor.from('pastoral_messages').insert({ congregation_id: 900002, author_id: users[0].id, title: 'Cross-tenant denial probe' });
  const spoofedAuthor = await harbor.from('pastoral_messages').insert({ congregation_id: 900001, author_id: users[1].id, title: 'Authorship denial probe' });
  if (!crossTenant.error || !spoofedAuthor.error) throw new Error('A prohibited message insert succeeded.');
  for (const table of ['church_crm_profiles','households','prayer_requests']) {
    const { data, error } = await restricted.from(table).select('congregation_id');
    if (error) throw error;
    if (data.some((row) => row.congregation_id !== 900001)) throw new Error(`${table} leaked across tenants to restricted care staff.`);
  }
  const financialProbe = await restricted.from('congregations').select('stripe_account_id,stripe_charges_enabled,stripe_details_submitted').eq('congregation_id',900001);
  if (!financialProbe.error) throw new Error('Unauthorized care staff could read financial provider details.');

  const tenantTables = ['audit_events', 'bible_studies', 'campuses', 'check_ins', 'church_crm_profiles', 'congregation_members', 'congregations', 'events', 'guardian_relationships', 'households', 'kiosk_sessions', 'medical_alerts', 'organization_memberships', 'pastoral_messages', 'pickup_credentials', 'prayer_requests', 'volunteer_roles'];
  for (const [client, expectedTenant] of [[harbor, 900001], [hillside, 900002]]) {
    for (const table of tenantTables) {
      const { data, error } = await client.from(table).select('congregation_id');
      if (error) throw new Error(`${table}: ${error.message}`);
      const unexpected = data.find((row) => row.congregation_id !== expectedTenant && !(table === 'bible_studies' && row.congregation_id === null));
      if (unexpected) throw new Error(`${table} leaked tenant ${unexpected.congregation_id} to ${expectedTenant}`);
    }
  }

  const app = require('../index');
  const server = await new Promise((resolve) => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
  let apiJourney;
  try {
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const [{ data: harborSession }, { data: hillsideSession }] = await Promise.all([harbor.auth.getSession(), hillside.auth.getSession()]);
    const title = `Automated communications journey ${Date.now()}`;
    const send = await fetch(`${baseUrl}/messages/save-message`, { method: 'POST', headers: { authorization: `Bearer ${harborSession.session.access_token}`, 'content-type': 'application/json' }, body: JSON.stringify({ congregationId: 900001, title, messageType: 'announcement', messageBody: 'Automated staging delivery verification.' }) });
    const sent = await send.json();
    if (send.status !== 200 || sent.author_id !== users[0].id || sent.congregation_id !== 900001) throw new Error(`Send journey failed (${send.status})`);
    const history = await fetch(`${baseUrl}/messages?congregationId=900001`, { headers: { authorization: `Bearer ${harborSession.session.access_token}` } });
    const historyPayload = await history.json();
    if (history.status !== 200 || !historyPayload.data.some((message) => message.message_id === sent.message_id)) throw new Error('Sent message was not received in tenant history.');
    const deniedDetail = await fetch(`${baseUrl}/messages/detail/${sent.message_id}`, { headers: { authorization: `Bearer ${hillsideSession.session.access_token}` } });
    if (deniedDetail.status !== 403) throw new Error(`Cross-tenant message detail returned ${deniedDetail.status}, expected 403.`);
    const { error: cleanupError } = await admin.from('pastoral_messages').delete().eq('message_id', sent.message_id).eq('title', title);
    if (cleanupError) throw cleanupError;
    apiJourney = { send: 200, history: 200, received: true, crossTenantDetail: 403, serverAuthor: true };
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }

  console.log(JSON.stringify({ harborVisibleTenants: tenantSets[0], hillsideVisibleTenants: tenantSets[1], restrictedVisibleTenants: tenantSets[2], crossTenantInsert: 'denied', spoofedAuthorInsert: 'denied', tenantTablesVerified: tenantTables.length, careIsolation: 'verified', unauthorizedFinancialColumns: 'denied', apiJourney }));
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
