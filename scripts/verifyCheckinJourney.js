const { createClient } = require('@supabase/supabase-js');

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const password = process.env.STAGING_ISOLATION_TEST_PASSWORD;
if (!url || !serviceKey || !anonKey || !password) throw new Error('Set the staging Supabase URL, service key, anon key, and test password.');
if (process.env.NODE_ENV === 'production') throw new Error('The check-in journey must never run in production.');

const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
const harborEmail = 'message-harbor@example.com';
const hillsideEmail = 'message-hillside@example.com';
const eventId = '91200000-0000-0000-0000-000000000001';
const guardianId = '91100000-0000-0000-0000-000000000001';
const childId = '91100000-0000-0000-0000-000000000002';

async function signIn(email) {
  const client = createClient(url, anonKey, { auth: { persistSession: false } });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data.session.access_token;
}

async function request(baseUrl, path, token, body, headers = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  return { response, payload };
}

(async () => {
  const [harborToken, hillsideToken] = await Promise.all([signIn(harborEmail), signIn(hillsideEmail)]);
  await admin.from('check_ins').update({ status: 'checked_out', checked_out_at: new Date().toISOString() }).eq('event_id', eventId).eq('profile_id', childId).eq('status', 'active');

  const app = require('../index');
  const server = await new Promise((resolve) => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
  const createdIds = [];
  let roomId;
  let kioskSessionId;
  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const lookup = await request(baseUrl, '/kiosk/lookup', harborToken, { congregationId: 900001, phone: '(555) 010-1001' });
    if (lookup.response.status !== 200 || !lookup.payload.children.some((child) => child.id === childId)) throw new Error(`Normalized household lookup failed (${lookup.response.status}).`);
    const deniedLookup = await request(baseUrl, '/kiosk/lookup', hillsideToken, { congregationId: 900001, phone: '5550101001' });
    if (deniedLookup.response.status !== 403) throw new Error(`Cross-tenant lookup returned ${deniedLookup.response.status}, expected 403.`);

    const { data: room, error: roomError } = await admin.from('checkin_rooms').insert({ congregation_id: 900001, name: `Staging room ${Date.now()}`, capacity: 1 }).select().single();
    if (roomError) throw roomError;
    roomId = room.id;
    const opened = await request(baseUrl, '/kiosk/sessions', harborToken, { congregationId: 900001, eventId, durationMinutes: 30 });
    if (opened.response.status !== 201) throw new Error(`Kiosk session creation failed (${opened.response.status}).`);
    kioskSessionId = opened.payload.data.id;
    const checkinBody = { congregationId: 900001, eventId, childIds: [childId], parentId: guardianId, roomId, kioskSessionId };
    const retryKey = `checkin_retry_${Date.now()}`;
    const first = await request(baseUrl, '/kiosk/checkin', harborToken, checkinBody, { 'idempotency-key': retryKey });
    if (first.response.status !== 201 || first.payload.checkInIds?.length !== 1 || !/^\d{6}$/.test(first.payload.secureCode)) throw new Error(`Initial check-in failed (${first.response.status}).`);
    createdIds.push(first.payload.checkInIds[0]);
    const replay = await request(baseUrl, '/kiosk/checkin', harborToken, checkinBody, { 'idempotency-key': retryKey });
    const sameReplay = replay.payload.success === first.payload.success
      && replay.payload.secureCode === first.payload.secureCode
      && replay.payload.checkInIds?.length === first.payload.checkInIds.length
      && replay.payload.checkInIds.every((id, index) => id === first.payload.checkInIds[index]);
    if (replay.response.status !== 200 || replay.response.headers.get('idempotent-replayed') !== 'true' || !sameReplay) throw new Error('Idempotent retry did not replay the original response.');
    const { count, error: countError } = await admin.from('check_ins').select('id', { count: 'exact', head: true }).eq('id', first.payload.checkInIds[0]);
    if (countError || count !== 1) throw new Error('Retry created an unexpected check-in record.');
    const capacity = await request(baseUrl, '/kiosk/checkin', harborToken, checkinBody, { 'idempotency-key': `checkin_capacity_${Date.now()}` });
    if (capacity.response.status !== 409 || capacity.payload.error?.code !== 'ROOM_CAPACITY_REACHED') throw new Error('Room capacity was not enforced.');

    const checkout = await request(baseUrl, '/kiosk/checkout', harborToken, { checkInId: first.payload.checkInIds[0], secureCode: first.payload.secureCode });
    if (checkout.response.status !== 200) throw new Error(`Credential checkout failed (${checkout.response.status}).`);

    const overrideCheckin = await request(baseUrl, '/kiosk/checkin', harborToken, checkinBody, { 'idempotency-key': `checkin_override_${Date.now()}` });
    if (overrideCheckin.response.status !== 201) throw new Error(`Override setup check-in failed (${overrideCheckin.response.status}).`);
    createdIds.push(overrideCheckin.payload.checkInIds[0]);
    const override = await request(baseUrl, '/kiosk/checkout-override', harborToken, { checkInId: overrideCheckin.payload.checkInIds[0], reason: 'Guardian identity confirmed by ministry lead.' });
    if (override.response.status !== 200) throw new Error(`Audited override failed (${override.response.status}).`);

    const { data: audits, error: auditError } = await admin.from('audit_events').select('action,resource_id').in('resource_id', createdIds);
    if (auditError) throw auditError;
    for (const action of ['check_in.checked_out', 'check_in.checkout_overridden']) if (!audits.some((event) => event.action === action)) throw new Error(`Missing ${action} audit event.`);
    const locked = await request(baseUrl, `/kiosk/sessions/${kioskSessionId}/lock`, harborToken, { congregationId: 900001 });
    if (locked.response.status !== 200) throw new Error('Kiosk session did not lock.');
    console.log(JSON.stringify({ normalizedLookup: 200, crossTenantLookup: 403, kioskSession: 'locked', roomCapacity: 'enforced', checkin: 201, retryReplay: true, duplicateRecords: 0, checkout: 200, override: 200, labels: 'created', auditActions: audits.map((event) => event.action) }));
  } finally {
    await admin.from('api_idempotency_records').delete().like('idempotency_key', 'checkin\\_%');
    if (kioskSessionId) await admin.from('kiosk_sessions').delete().eq('id', kioskSessionId);
    if (roomId) await admin.from('checkin_rooms').delete().eq('id', roomId);
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
