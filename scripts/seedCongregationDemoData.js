const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { createClient } = require('@supabase/supabase-js');

const TARGET_EMAIL = String(process.env.TARGET_EMAIL || '').trim().toLowerCase();
const TARGET_CONGREGATION_ID = Number(process.env.TARGET_CONGREGATION_ID);
const PROJECT_REF = String(process.env.SUPABASE_PROJECT_REF || '').trim();
const APPLY = process.env.APPLY_DEMO_SEED === 'yes';
const EXPECTED_GUARD = `${TARGET_EMAIL}:${TARGET_CONGREGATION_ID}`;

if (!TARGET_EMAIL || !Number.isInteger(TARGET_CONGREGATION_ID) || !PROJECT_REF) {
  throw new Error('TARGET_EMAIL, TARGET_CONGREGATION_ID, and SUPABASE_PROJECT_REF are required.');
}
if (APPLY && process.env.ALLOW_PRODUCTION_DEMO_SEED !== EXPECTED_GUARD) {
  throw new Error(`Set ALLOW_PRODUCTION_DEMO_SEED=${EXPECTED_GUARD} to apply this non-destructive seed.`);
}

const stableUuid = (label) => {
  const chars = crypto.createHash('sha256').update(`sanctuary-demo-v1:${TARGET_CONGREGATION_ID}:${label}`).digest('hex').slice(0, 32).split('');
  chars[12] = '5';
  chars[16] = (Number.parseInt(chars[16], 16) & 0x3 | 0x8).toString(16);
  const hex = chars.join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

const daysFromNow = (days, hour = 12, minute = 0) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(hour, minute, 0, 0);
  return date.toISOString();
};

const nextWeekday = (weekday, hour, minute = 0, weeksAhead = 0) => {
  const date = new Date();
  let delta = (weekday - date.getDay() + 7) % 7;
  if (delta === 0) delta = 7;
  date.setDate(date.getDate() + delta + weeksAhead * 7);
  date.setHours(hour, minute, 0, 0);
  return date.toISOString();
};

const loadServiceRoleKey = () => {
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) return process.env.SUPABASE_SERVICE_ROLE_KEY;
  const keys = JSON.parse(execFileSync('npx', ['supabase', 'projects', 'api-keys', '--project-ref', PROJECT_REF, '--output', 'json'], { encoding: 'utf8' }));
  const key = keys.find((candidate) => candidate.name === 'service_role');
  if (!key) throw new Error(`No service-role key available for project ${PROJECT_REF}.`);
  return key.api_key || key.key;
};

const db = createClient(`https://${PROJECT_REF}.supabase.co`, loadServiceRoleKey(), { auth: { persistSession: false } });

const assertResult = (result, label) => {
  if (result.error) {
    result.error.message = `${label}: ${result.error.message}`;
    throw result.error;
  }
  return result.data;
};

const upsert = async (table, rows, onConflict = 'id') => {
  if (!APPLY) return rows;
  return assertResult(await db.from(table).upsert(rows, { onConflict }).select(), `Upsert ${table}`);
};

const findAuthUser = async (email) => {
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 100 });
    if (error) throw error;
    const user = data.users.find((candidate) => candidate.email?.toLowerCase() === email);
    if (user) return user;
    if (data.users.length < 100) break;
  }
  return null;
};

const ensureMessage = async (message) => {
  if (!APPLY) return message;
  const existing = assertResult(await db.from('pastoral_messages').select('message_id').eq('congregation_id', TARGET_CONGREGATION_ID).eq('title', message.title).maybeSingle(), `Find message ${message.title}`);
  if (existing) return assertResult(await db.from('pastoral_messages').update(message).eq('message_id', existing.message_id).select().single(), `Update message ${message.title}`);
  return assertResult(await db.from('pastoral_messages').insert(message).select().single(), `Insert message ${message.title}`);
};

const ensureActivity = async (activity) => {
  if (!APPLY) return activity;
  const existing = assertResult(await db.from('user_activities').select('id').eq('user_id', activity.user_id).eq('activity_id', activity.activity_id).maybeSingle(), `Find activity ${activity.activity_id}`);
  if (existing) return assertResult(await db.from('user_activities').update(activity).eq('id', existing.id).select().single(), `Update activity ${activity.activity_id}`);
  return assertResult(await db.from('user_activities').insert(activity).select().single(), `Insert activity ${activity.activity_id}`);
};

const countRows = async (table, filters = []) => {
  let query = db.from(table).select('*', { count: 'exact', head: true });
  for (const [column, value] of filters) query = query.eq(column, value);
  const result = await query;
  if (result.error) throw result.error;
  return result.count || 0;
};

const main = async () => {
  const user = await findAuthUser(TARGET_EMAIL);
  if (!user) throw new Error(`No Supabase auth user exists for ${TARGET_EMAIL}.`);

  const congregation = assertResult(await db.from('congregations').select('congregation_id,name,leader_user_id').eq('congregation_id', TARGET_CONGREGATION_ID).single(), 'Load target congregation');
  if (congregation.leader_user_id !== user.id) throw new Error(`Refusing seed: ${TARGET_EMAIL} is not the leader of congregation ${TARGET_CONGREGATION_ID}.`);

  const before = {
    households: await countRows('households', [['congregation_id', TARGET_CONGREGATION_ID]]),
    people: await countRows('church_crm_profiles', [['congregation_id', TARGET_CONGREGATION_ID]]),
    prayers: await countRows('prayer_requests', [['congregation_id', TARGET_CONGREGATION_ID]]),
    events: await countRows('events', [['congregation_id', TARGET_CONGREGATION_ID]]),
    roles: await countRows('volunteer_roles', [['congregation_id', TARGET_CONGREGATION_ID]]),
    gifts: await countRows('gifts', [['congregation_id', TARGET_CONGREGATION_ID]]),
  };

  const householdDefinitions = [
    ['martinez', 'Martinez Household', '555-010-2001', '124 Maple Ridge Drive', ['families', 'newcomers']],
    ['johnson', 'Johnson Household', '555-010-2002', '48 Cedar Lane', ['families', 'care-follow-up']],
    ['chen', 'Chen Household', '555-010-2003', '905 Harbor View Court', ['members']],
    ['williams', 'Williams Household', '555-010-2004', '17 Meadow Park Avenue', ['families', 'kids-ministry']],
    ['patel', 'Patel Household', '555-010-2005', '310 Sycamore Street', ['volunteers']],
    ['garcia', 'Garcia Household', '555-010-2006', '82 Willow Creek Road', ['newcomers']],
  ];
  const households = householdDefinitions.map(([key, name, primaryPhone, street, tags]) => ({
    id: stableUuid(`household:${key}`),
    congregation_id: TARGET_CONGREGATION_ID,
    name,
    primary_phone: primaryPhone,
    address: { street, city: 'Lilburn', state: 'GA', postalCode: '30047' },
    tags: [...tags, 'demo-qa'],
    deleted_at: null,
  }));
  await upsert('households', households);
  const householdId = Object.fromEntries(householdDefinitions.map(([key], index) => [key, households[index].id]));

  const peopleDefinitions = [
    ['elena', 'martinez', 'Elena', 'Martinez', 'primary', 'elena.martinez@example.invalid', 'adult', ['member', 'small-group-leader'], null],
    ['marco', 'martinez', 'Marco', 'Martinez', 'adult', 'marco.martinez@example.invalid', 'adult', ['member'], null],
    ['sofia', 'martinez', 'Sofia', 'Martinez', 'child', null, 'child', ['kids-ministry'], 'Synthetic demo alert: peanut allergy; EpiPen noted.'],
    ['leo', 'martinez', 'Leo', 'Martinez', 'child', null, 'child', ['kids-ministry'], null],
    ['maya', 'johnson', 'Maya', 'Johnson', 'primary', 'maya.johnson@example.invalid', 'adult', ['member', 'care-follow-up'], null],
    ['caleb', 'johnson', 'Caleb', 'Johnson', 'child', null, 'child', ['kids-ministry', 'care-follow-up'], 'Synthetic demo note: prefers a quiet check-in transition.'],
    ['daniel', 'chen', 'Daniel', 'Chen', 'primary', 'daniel.chen@example.invalid', 'adult', ['member', 'volunteer'], null],
    ['priya', 'chen', 'Priya', 'Chen', 'adult', 'priya.chen@example.invalid', 'adult', ['member', 'volunteer'], null],
    ['noah', 'chen', 'Noah', 'Chen', 'child', null, 'youth', ['youth'], null],
    ['harper', 'williams', 'Harper', 'Williams', 'primary', 'harper.williams@example.invalid', 'adult', ['member'], null],
    ['ava', 'williams', 'Ava', 'Williams', 'child', null, 'child', ['kids-ministry'], 'Synthetic demo alert: gluten-free snack only.'],
    ['rohan', 'patel', 'Rohan', 'Patel', 'primary', 'rohan.patel@example.invalid', 'adult', ['member', 'volunteer'], null],
    ['anika', 'patel', 'Anika', 'Patel', 'adult', 'anika.patel@example.invalid', 'adult', ['member', 'volunteer'], null],
    ['isabel', 'garcia', 'Isabel', 'Garcia', 'primary', 'isabel.garcia@example.invalid', 'adult', ['newcomer'], null],
  ];
  const people = peopleDefinitions.map(([key, household, firstName, lastName, householdRole, email, ageGroup, tags, medicalNotes], index) => ({
    id: stableUuid(`profile:${key}`),
    congregation_id: TARGET_CONGREGATION_ID,
    household_id: householdId[household],
    first_name: firstName,
    last_name: lastName,
    email,
    phone: householdDefinitions.find(([householdKey]) => householdKey === household)[2],
    household_role: householdRole,
    medical_notes: medicalNotes,
    lifecycle_status: key === 'isabel' ? 'newcomer' : 'active',
    tags: [...tags, 'demo-qa'],
    custom_fields: { demoSeed: 'sanctuary-qa-v1', ageGroup, preferredContact: email ? 'email' : 'household' },
    consent_status: email ? 'granted' : 'unknown',
    consent_updated_at: email ? daysFromNow(-30 - index) : null,
    deleted_at: null,
  }));
  await upsert('church_crm_profiles', people);
  const profileId = Object.fromEntries(peopleDefinitions.map(([key], index) => [key, people[index].id]));

  await upsert('pastoral_notes', [
    { id: stableUuid('pastoral-note:elena'), crm_profile_id: profileId.elena, author_id: user.id, note_text: '[Demo QA] Interested in helping lead the next newcomer lunch. Follow up after Sunday.' },
    { id: stableUuid('pastoral-note:maya'), crm_profile_id: profileId.maya, author_id: user.id, note_text: '[Demo QA] Family requested a check-in during a job transition.' },
    { id: stableUuid('pastoral-note:harper'), crm_profile_id: profileId.harper, author_id: user.id, note_text: '[Demo QA] Coordinate the meal-train volunteer schedule.' },
  ]);

  await upsert('prayer_requests', [
    { id: stableUuid('prayer:diagnosis'), congregation_id: TARGET_CONGREGATION_ID, user_id: user.id, request_text: '[Demo QA] Please pray for a family navigating a difficult diagnosis and a week of appointments.', visibility: 'pastor', created_at: daysFromNow(-1, 9) },
    { id: stableUuid('prayer:food-pantry'), congregation_id: TARGET_CONGREGATION_ID, user_id: user.id, request_text: '[Demo QA] Pray for volunteers serving at the city food pantry this weekend.', visibility: 'congregation', created_at: daysFromNow(-2, 14) },
    { id: stableUuid('prayer:student'), congregation_id: TARGET_CONGREGATION_ID, user_id: user.id, request_text: '[Demo QA] A student in our youth group is preparing for exams and needs peace.', visibility: 'congregation', created_at: daysFromNow(-4, 16) },
    { id: stableUuid('prayer:gratitude'), congregation_id: TARGET_CONGREGATION_ID, user_id: user.id, request_text: '[Demo QA] Give thanks for a neighbor who found stable housing this week.', visibility: 'congregation', created_at: daysFromNow(-6, 11) },
  ]);

  await upsert('care_cases', [
    { id: stableUuid('care:maya'), congregation_id: TARGET_CONGREGATION_ID, profile_id: profileId.maya, title: '[Demo QA] Job-transition follow-up', description: 'Call this week and offer practical support resources.', priority: 'high', status: 'open', confidentiality: 'care_team', follow_up_at: daysFromNow(2, 10), created_by: user.id, deleted_at: null },
    { id: stableUuid('care:elena'), congregation_id: TARGET_CONGREGATION_ID, profile_id: profileId.elena, title: '[Demo QA] New leader discernment', description: 'Discuss the newcomer lunch facilitator role.', priority: 'normal', status: 'open', confidentiality: 'care_team', follow_up_at: daysFromNow(5, 13), created_by: user.id, deleted_at: null },
  ]);

  const roles = [
    { id: stableUuid('role:greeters'), congregation_id: TARGET_CONGREGATION_ID, name: 'Greeter Team', description: 'Welcome guests and help families find their way.', color_code: '#10b981', join_policy: 'open', qualifications: ['Hospitality orientation'], background_check_required: false, minimum_volunteers: 4 },
    { id: stableUuid('role:kids'), congregation_id: TARGET_CONGREGATION_ID, name: 'Kids Ministry', description: 'Care for children during worship and support secure check-in.', color_code: '#3b82f6', join_policy: 'approval_required', qualifications: ['Kids safety training'], background_check_required: true, minimum_volunteers: 6 },
    { id: stableUuid('role:production'), congregation_id: TARGET_CONGREGATION_ID, name: 'Production & Tech', description: 'Run slides, livestream, and room audio.', color_code: '#64748b', join_policy: 'approval_required', qualifications: ['Production orientation'], background_check_required: false, minimum_volunteers: 3 },
    { id: stableUuid('role:hospitality'), congregation_id: TARGET_CONGREGATION_ID, name: 'Hospitality & Coffee', description: 'Prepare coffee and connection space after service.', color_code: '#f59e0b', join_policy: 'open', qualifications: [], background_check_required: false, minimum_volunteers: 3 },
  ];
  await upsert('volunteer_roles', roles);
  await upsert('role_members', roles.map((role, index) => ({ id: stableUuid(`role-member:${index}`), congregation_id: TARGET_CONGREGATION_ID, role_id: role.id, user_id: user.id, status: index < 3 ? 'active' : 'pending_approval', joined_at: daysFromNow(-90 + index * 10) })));

  const sunday = nextWeekday(0, 10);
  const events = [
    { id: stableUuid('event:sunday-worship'), congregation_id: TARGET_CONGREGATION_ID, title: 'Sunday Worship Service', description: 'Weekly worship, teaching, prayer, and communion.', event_type: 'service', event_date: sunday, end_time: new Date(new Date(sunday).getTime() + 90 * 60000).toISOString(), location: 'Main Sanctuary', status: 'published', organizer_id: user.id, is_public: true, capacity: 250, follow_up_status: 'not_started' },
    { id: stableUuid('event:kids'), congregation_id: TARGET_CONGREGATION_ID, title: 'Kids Ministry Classrooms', description: 'Age-group classrooms during Sunday worship.', event_type: 'ministry', event_date: sunday, end_time: new Date(new Date(sunday).getTime() + 90 * 60000).toISOString(), location: 'Education Wing', status: 'published', organizer_id: user.id, is_public: false, capacity: 60, follow_up_status: 'not_started' },
    { id: stableUuid('event:small-groups'), congregation_id: TARGET_CONGREGATION_ID, title: 'Midweek Community Groups', description: 'Dinner, prayer, and neighborhood small groups.', event_type: 'group', event_date: nextWeekday(3, 18, 30), end_time: nextWeekday(3, 20, 0), location: 'Homes across Lilburn', status: 'published', organizer_id: user.id, is_public: true, capacity: 80, follow_up_status: 'not_started' },
    { id: stableUuid('event:newcomer-lunch'), congregation_id: TARGET_CONGREGATION_ID, title: 'Newcomer Lunch', description: 'Meet ministry leaders and learn how to connect.', event_type: 'fellowship', event_date: nextWeekday(0, 12, 0), end_time: nextWeekday(0, 13, 30), location: 'Fellowship Hall', status: 'published', organizer_id: user.id, is_public: true, capacity: 40, follow_up_status: 'not_started' },
  ];
  await upsert('events', events);

  await upsert('event_registrations', [
    { id: stableUuid('registration:elena:newcomer'), congregation_id: TARGET_CONGREGATION_ID, event_id: events[3].id, profile_id: profileId.elena, status: 'registered', response_data: { dietaryNotes: 'None', demoSeed: true } },
    { id: stableUuid('registration:isabel:newcomer'), congregation_id: TARGET_CONGREGATION_ID, event_id: events[3].id, profile_id: profileId.isabel, status: 'registered', response_data: { dietaryNotes: 'Vegetarian', demoSeed: true } },
  ]);
  await upsert('event_volunteers', [
    { id: stableUuid('event-volunteer:greeter'), congregation_id: TARGET_CONGREGATION_ID, event_id: events[0].id, role_id: roles[0].id, user_id: user.id, status: 'accepted', notified_at: daysFromNow(-2) },
    { id: stableUuid('event-volunteer:production'), congregation_id: TARGET_CONGREGATION_ID, event_id: events[0].id, role_id: roles[2].id, user_id: user.id, status: 'accepted', notified_at: daysFromNow(-2) },
    { id: stableUuid('event-volunteer:kids'), congregation_id: TARGET_CONGREGATION_ID, event_id: events[1].id, role_id: roles[1].id, user_id: user.id, status: 'pending', notified_at: daysFromNow(-1) },
  ]);

  const room = { id: stableUuid('checkin-room:elementary'), congregation_id: TARGET_CONGREGATION_ID, name: 'Elementary Room', capacity: 24, age_min_months: 60, age_max_months: 132, active: true };
  await upsert('checkin_rooms', [room]);
  const kioskSession = { id: stableUuid('kiosk-session:sunday'), congregation_id: TARGET_CONGREGATION_ID, event_id: events[1].id, opened_by: user.id, created_at: daysFromNow(-7, 9, 30), expires_at: daysFromNow(14, 13), locked_at: null };
  await upsert('kiosk_sessions', [kioskSession]);
  await upsert('check_ins', [
    { id: stableUuid('checkin:sofia'), congregation_id: TARGET_CONGREGATION_ID, event_id: events[1].id, profile_id: profileId.sofia, checked_in_by: profileId.elena, checked_in_at: daysFromNow(-7, 9, 48), checked_out_at: daysFromNow(-7, 11, 35), secure_code: '482731', status: 'checked_out', room_id: room.id, kiosk_session_id: kioskSession.id, idempotency_key: stableUuid('checkin-key:sofia') },
    { id: stableUuid('checkin:caleb'), congregation_id: TARGET_CONGREGATION_ID, event_id: events[1].id, profile_id: profileId.caleb, checked_in_by: profileId.maya, checked_in_at: daysFromNow(-7, 9, 52), checked_out_at: daysFromNow(-7, 11, 30), secure_code: '639205', status: 'checked_out', room_id: room.id, kiosk_session_id: kioskSession.id, idempotency_key: stableUuid('checkin-key:caleb') },
    { id: stableUuid('checkin:ava'), congregation_id: TARGET_CONGREGATION_ID, event_id: events[1].id, profile_id: profileId.ava, checked_in_by: profileId.harper, checked_in_at: daysFromNow(-7, 9, 55), checked_out_at: daysFromNow(-7, 11, 42), secure_code: '174860', status: 'checked_out', room_id: room.id, kiosk_session_id: kioskSession.id, idempotency_key: stableUuid('checkin-key:ava') },
  ]);

  const funds = [
    { id: stableUuid('fund:general'), congregation_id: TARGET_CONGREGATION_ID, name: 'General Ministry', description: 'Supports weekly ministry and operations.', restricted: false, active: true },
    { id: stableUuid('fund:benevolence'), congregation_id: TARGET_CONGREGATION_ID, name: 'Benevolence', description: 'Direct assistance for neighbors in need.', restricted: true, active: true },
    { id: stableUuid('fund:missions'), congregation_id: TARGET_CONGREGATION_ID, name: 'Local Missions', description: 'Community partnerships and service projects.', restricted: true, active: true },
  ];
  await upsert('giving_funds', funds);
  await upsert('gifts', [
    { id: stableUuid('gift:1'), congregation_id: TARGET_CONGREGATION_ID, donor_profile_id: profileId.elena, fund_id: funds[0].id, amount_cents: 12500, source: 'online', received_at: daysFromNow(-2, 8), status: 'succeeded', recorded_by: user.id, metadata: { demoSeed: true } },
    { id: stableUuid('gift:2'), congregation_id: TARGET_CONGREGATION_ID, donor_profile_id: profileId.daniel, fund_id: funds[0].id, amount_cents: 20000, source: 'online', received_at: daysFromNow(-3, 12), status: 'succeeded', recorded_by: user.id, metadata: { demoSeed: true } },
    { id: stableUuid('gift:3'), congregation_id: TARGET_CONGREGATION_ID, donor_profile_id: profileId.rohan, fund_id: funds[1].id, amount_cents: 7500, source: 'check', received_at: daysFromNow(-5, 10), status: 'succeeded', recorded_by: user.id, metadata: { demoSeed: true } },
    { id: stableUuid('gift:4'), congregation_id: TARGET_CONGREGATION_ID, donor_profile_id: profileId.priya, fund_id: funds[2].id, amount_cents: 15000, source: 'online', received_at: daysFromNow(-8, 9), status: 'succeeded', recorded_by: user.id, metadata: { demoSeed: true } },
    { id: stableUuid('gift:5'), congregation_id: TARGET_CONGREGATION_ID, donor_profile_id: profileId.harper, fund_id: funds[0].id, amount_cents: 10000, source: 'cash', received_at: daysFromNow(-9, 11), status: 'succeeded', recorded_by: user.id, metadata: { demoSeed: true } },
  ]);

  for (const message of [
    { congregation_id: TARGET_CONGREGATION_ID, author_id: user.id, title: '[Demo QA] Sunday Preview: Practicing Hospitality', message_type: 'announcement', message_body: '<p>This Sunday we will look at Romans 12 and the ordinary courage of making room for one another.</p>', is_published: true, status: 'sent', sent_at: daysFromNow(-2, 15), recipient_scope: { type: 'all' }, channels: ['in_app', 'email'], delivery_summary: { delivered: 9, queued: 2 } },
    { congregation_id: TARGET_CONGREGATION_ID, author_id: user.id, title: '[Demo QA] Midweek Care Note', message_type: 'devotional', message_body: '<p>Take a moment today to call someone you have not seen in a few weeks. Presence is ministry.</p>', is_published: true, status: 'sent', sent_at: daysFromNow(-5, 9), recipient_scope: { type: 'all' }, channels: ['in_app'], delivery_summary: { delivered: 14 } },
    { congregation_id: TARGET_CONGREGATION_ID, author_id: user.id, title: '[Demo QA] Food Pantry Volunteer Reminder', message_type: 'announcement', message_body: '<p>Please arrive Saturday at 8:30 a.m. for assignments and prayer.</p>', is_published: false, status: 'scheduled', scheduled_at: daysFromNow(2, 8), recipient_scope: { type: 'all' }, channels: ['in_app', 'email'], delivery_summary: { scheduled: 9 } },
    { congregation_id: TARGET_CONGREGATION_ID, author_id: user.id, title: '[Demo QA] Easter Newsletter Draft', message_type: 'newsletter', message_body: '<h2>Hope is alive</h2><p>Here are the worship, service, and family opportunities planned for Easter week.</p>', is_published: false, status: 'draft', recipient_scope: { type: 'all' }, channels: ['email'], delivery_summary: {} },
  ]) await ensureMessage(message);

  await upsert('person_timeline_events', [
    { id: stableUuid('timeline:elena-joined'), congregation_id: TARGET_CONGREGATION_ID, profile_id: profileId.elena, event_type: 'membership', occurred_at: daysFromNow(-180), summary: '[Demo QA] Joined the congregation', source_type: 'demo_seed', source_id: 'sanctuary-qa-v1', metadata: { demoSeed: true }, created_by: user.id },
    { id: stableUuid('timeline:isabel-visit'), congregation_id: TARGET_CONGREGATION_ID, profile_id: profileId.isabel, event_type: 'visit', occurred_at: daysFromNow(-8), summary: '[Demo QA] First Sunday visit', source_type: 'demo_seed', source_id: 'sanctuary-qa-v1', metadata: { demoSeed: true }, created_by: user.id },
    { id: stableUuid('timeline:maya-care'), congregation_id: TARGET_CONGREGATION_ID, profile_id: profileId.maya, event_type: 'care_follow_up', occurred_at: daysFromNow(-3), summary: '[Demo QA] Care-team follow-up recorded', source_type: 'demo_seed', source_id: 'sanctuary-qa-v1', metadata: { demoSeed: true }, created_by: user.id },
  ]);

  for (const [index, description] of [
    'Added fourteen demo people across six households',
    'Scheduled the newcomer lunch',
    'Recorded five representative gifts',
    'Prepared a congregation broadcast draft',
  ].entries()) {
    await ensureActivity({ user_id: user.id, activity_id: stableUuid(`activity:${index}`), activity_type: 'demo_qa', activity_date: daysFromNow(-index, 12), description: `[Demo QA] ${description}` });
  }

  const after = APPLY ? {
    households: await countRows('households', [['congregation_id', TARGET_CONGREGATION_ID]]),
    people: await countRows('church_crm_profiles', [['congregation_id', TARGET_CONGREGATION_ID]]),
    prayers: await countRows('prayer_requests', [['congregation_id', TARGET_CONGREGATION_ID]]),
    events: await countRows('events', [['congregation_id', TARGET_CONGREGATION_ID]]),
    roles: await countRows('volunteer_roles', [['congregation_id', TARGET_CONGREGATION_ID]]),
    gifts: await countRows('gifts', [['congregation_id', TARGET_CONGREGATION_ID]]),
  } : null;

  console.log(JSON.stringify({ mode: APPLY ? 'applied' : 'dry-run', projectRef: PROJECT_REF, congregation: { id: congregation.congregation_id, name: congregation.name }, owner: TARGET_EMAIL, before, planned: { households: households.length, people: people.length, prayers: 4, careCases: 2, events: events.length, roles: roles.length, checkIns: 3, givingFunds: funds.length, gifts: 5, messages: 4, activities: 4 }, after }, null, 2));
};

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
