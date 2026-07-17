const { createClient } = require('@supabase/supabase-js');

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const password = process.env.STAGING_ISOLATION_TEST_PASSWORD;
if (!url || !serviceKey || !anonKey || !password) throw new Error('Set the staging Supabase URL, service key, anon key, and test password.');
if (process.env.NODE_ENV === 'production') throw new Error('The event journey must never run in production.');
const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

async function signIn(email) {
  const client = createClient(url, anonKey, { auth: { persistSession: false } });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return { client, token: data.session.access_token, user: data.user };
}
async function request(baseUrl, path, token, method = 'GET', body) {
  const response = await fetch(`${baseUrl}${path}`, { method, headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { response, payload: await response.json() };
}

(async () => {
  const [harbor, hillside, volunteer] = await Promise.all([
    signIn('message-harbor@example.com'), signIn('message-hillside@example.com'), signIn('message-restricted@example.com'),
  ]);
  const app = require('../index');
  const server = await new Promise((resolve) => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
  let eventId;
  let assignmentId;
  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const title = `Automated staffing journey ${Date.now()}`;
    const created = await request(baseUrl, '/events', harbor.token, 'POST', { congregationId: 900001, title, eventType: 'service' });
    if (created.response.status !== 201 || created.payload.congregation_id !== 900001) throw new Error(`Event creation failed (${created.response.status}).`);
    eventId = created.payload.id;
    const denied = await request(baseUrl, `/events/${eventId}/schedule`, hillside.token, 'POST', { roleId: '91300000-0000-0000-0000-000000000001', userId: volunteer.user.id });
    if (denied.response.status !== 403) throw new Error(`Cross-tenant scheduling returned ${denied.response.status}, expected 403.`);
    const scheduled = await request(baseUrl, `/events/${eventId}/schedule`, harbor.token, 'POST', { roleId: '91300000-0000-0000-0000-000000000001', userId: volunteer.user.id });
    if (scheduled.response.status !== 201 || scheduled.payload.status !== 'pending') throw new Error(`Volunteer scheduling failed (${scheduled.response.status}).`);
    assignmentId = scheduled.payload.id;
    const responded = await request(baseUrl, `/events/${eventId}/respond`, volunteer.token, 'POST', { assignmentId, status: 'accepted' });
    if (responded.response.status !== 200 || responded.payload.status !== 'accepted') throw new Error(`Volunteer response failed (${responded.response.status}).`);
    const [harborList, hillsideList] = await Promise.all([
      request(baseUrl, '/events/dashboard/900001', harbor.token), request(baseUrl, '/events/dashboard/900002', hillside.token),
    ]);
    if (harborList.response.status !== 200 || !harborList.payload.events.some((event) => event.id === eventId)) throw new Error('Created event missing from Harbor list.');
    if (hillsideList.response.status !== 200 || hillsideList.payload.events.some((event) => event.id === eventId || event.congregation_id !== 900002)) throw new Error('Event list tenant isolation failed.');
    const crossAssignmentRead = await hillside.client.from('event_volunteers').select('id').eq('id', assignmentId);
    if (crossAssignmentRead.error || crossAssignmentRead.data.length !== 0) throw new Error('Assignment RLS isolation failed.');
    const { data: audits, error: auditError } = await admin.from('audit_events').select('action').eq('resource_id', assignmentId);
    if (auditError || !audits.some((row) => row.action === 'volunteer.scheduled') || !audits.some((row) => row.action === 'volunteer.accepted')) throw new Error('Volunteer audit trail is incomplete.');
    console.log(JSON.stringify({ creation: 201, crossTenantSchedule: 403, staffing: 201, response: 'accepted', tenantLists: 'isolated', assignmentRls: 'isolated', audit: ['volunteer.scheduled', 'volunteer.accepted'] }));
  } finally {
    if (assignmentId) await admin.from('event_volunteers').delete().eq('id', assignmentId);
    if (eventId) await admin.from('events').delete().eq('id', eventId);
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
