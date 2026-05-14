const supabase = require('../config/supabase');

const DEMO_CONGREGATION_ID = process.env.DEMO_CONGREGATION_ID || '900001';
const DEMO_CONGREGATION_NAME = process.env.DEMO_CONGREGATION_NAME || 'Sanctuary Demo Church';
const DEMO_LEADER_EMAIL = process.env.DEMO_LEADER_EMAIL || 'brandon@paperplanes.digital';

const iso = (date) => date.toISOString();

const nextSundayAt = (hour, minute = 0) => {
  const date = new Date();
  const day = date.getDay();
  const daysUntilSunday = day === 0 ? 7 : 7 - day;
  date.setDate(date.getDate() + daysUntilSunday);
  date.setHours(hour, minute, 0, 0);
  return date;
};

const assertOk = ({ error }, label) => {
  if (error) {
    error.message = `${label}: ${error.message}`;
    throw error;
  }
};

const maybeDelete = async (table, column, value) => {
  const result = await supabase.from(table).delete().eq(column, value);
  assertOk(result, `Delete ${table}`);
};

const maybeDeleteIn = async (table, column, values) => {
  if (!values.length) return;
  const result = await supabase.from(table).delete().in(column, values);
  assertOk(result, `Delete ${table}`);
};

const findAuthUserByEmail = async (email) => {
  let page = 1;

  while (page < 20) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 100 });
    if (error) throw error;

    const user = data.users.find((candidate) => candidate.email?.toLowerCase() === email.toLowerCase());
    if (user) return user;
    if (data.users.length < 100) return null;
    page += 1;
  }

  return null;
};

const ensureDemoLeader = async () => {
  if (process.env.DEMO_LEADER_USER_ID) return process.env.DEMO_LEADER_USER_ID;

  const { data: existingCongregation, error } = await supabase
    .from('congregations')
    .select('leader_user_id')
    .eq('congregation_id', DEMO_CONGREGATION_ID)
    .maybeSingle();

  if (error) throw error;
  if (existingCongregation?.leader_user_id) return existingCongregation.leader_user_id;

  const email = DEMO_LEADER_EMAIL;
  const password = process.env.DEMO_LEADER_PASSWORD;

  if (!email) {
    throw new Error(
      'Set DEMO_LEADER_USER_ID or DEMO_LEADER_EMAIL so the demo congregation can be owned by a clergy account.'
    );
  }

  const existingUser = await findAuthUserByEmail(email);
  if (existingUser) return existingUser.id;

  if (!password) {
    throw new Error(
      `No Supabase auth user found for ${email}. Sign into the Clergy app with Google once, then rerun this seed, or set DEMO_LEADER_USER_ID directly.`
    );
  }

  const { data: created, error: createError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      full_name: 'Pastor Avery Brooks',
      first_name: 'Avery',
      last_name: 'Brooks',
    },
  });

  if (createError) throw createError;

  await supabase.from('user_profiles').upsert({
    user_id: created.user.id,
    first_name: 'Avery',
    last_name: 'Brooks',
    email,
    tier: 'pro',
    subscription_tier: 'pro',
    sermon_preferences: { churchName: DEMO_CONGREGATION_NAME },
  });

  return created.user.id;
};

const wipeDemoData = async () => {
  const [{ data: profiles }, { data: events }, { data: roles }] = await Promise.all([
    supabase.from('church_crm_profiles').select('id').eq('congregation_id', DEMO_CONGREGATION_ID),
    supabase.from('events').select('id').eq('congregation_id', DEMO_CONGREGATION_ID),
    supabase.from('volunteer_roles').select('id').eq('congregation_id', DEMO_CONGREGATION_ID),
  ]);

  const profileIds = (profiles || []).map((profile) => profile.id);
  const eventIds = (events || []).map((event) => event.id);
  const roleIds = (roles || []).map((role) => role.id);

  await maybeDeleteIn('event_volunteers', 'event_id', eventIds);
  await maybeDeleteIn('role_members', 'role_id', roleIds);
  await maybeDeleteIn('pastoral_notes', 'crm_profile_id', profileIds);

  await maybeDelete('check_ins', 'congregation_id', DEMO_CONGREGATION_ID);
  await maybeDelete('prayer_requests', 'congregation_id', DEMO_CONGREGATION_ID);
  await maybeDelete('pastoral_messages', 'congregation_id', DEMO_CONGREGATION_ID);
  await maybeDelete('congregation_members', 'congregation_id', DEMO_CONGREGATION_ID);
  await maybeDelete('church_crm_profiles', 'congregation_id', DEMO_CONGREGATION_ID);
  await maybeDelete('households', 'congregation_id', DEMO_CONGREGATION_ID);
  await maybeDelete('events', 'congregation_id', DEMO_CONGREGATION_ID);
  await maybeDelete('volunteer_roles', 'congregation_id', DEMO_CONGREGATION_ID);
  await maybeDelete('congregations', 'congregation_id', DEMO_CONGREGATION_ID);
};

const buildDemoData = async (leaderUserId) => {
  const sundayService = nextSundayAt(10, 0);
  const kidsClass = nextSundayAt(10, 15);

  const { data: congregation, error: congregationError } = await supabase
    .from('congregations')
    .insert({
      congregation_id: DEMO_CONGREGATION_ID,
      name: DEMO_CONGREGATION_NAME,
      description: 'A resettable demo congregation for Sanctuary Clergy sales walkthroughs.',
      leader_user_id: leaderUserId,
      invite_token: 'DEMO-CHURCH',
    })
    .select()
    .single();

  assertOk({ error: congregationError }, 'Create demo congregation');

  const { error: membershipError } = await supabase.from('congregation_members').insert({
    congregation_id: DEMO_CONGREGATION_ID,
    user_id: leaderUserId,
    last_active_date: iso(new Date()),
  });

  assertOk({ error: membershipError }, 'Create demo leader membership');

  const householdRows = [
    { name: 'Martinez Household', primary_phone: '5551002001', address: '124 Maple Ridge Dr' },
    { name: 'Johnson Household', primary_phone: '5551002002', address: '48 Cedar Lane' },
    { name: 'Chen Household', primary_phone: '5551002003', address: '905 Harbor View Ct' },
    { name: 'Williams Household', primary_phone: '5551002004', address: '17 Meadow Park Ave' },
    { name: 'Patel Household', primary_phone: '5551002005', address: '310 Sycamore St' },
    { name: 'Garcia Household', primary_phone: '5551002006', address: '82 Willow Creek Rd' },
    { name: 'Thompson Household', primary_phone: '5551002007', address: '601 North Pine Blvd' },
    { name: 'Nguyen Household', primary_phone: '5551002008', address: '73 Lakefront Way' },
  ].map((household) => ({ ...household, congregation_id: DEMO_CONGREGATION_ID }));

  const { data: households, error: householdsError } = await supabase
    .from('households')
    .insert(householdRows)
    .select('id, name, primary_phone');

  assertOk({ error: householdsError }, 'Create demo households');

  const householdByName = new Map(households.map((household) => [household.name, household]));

  const personRows = [
    ['Martinez Household', 'Elena', 'Martinez', 'elena.martinez@example.com', 'primary', null],
    ['Martinez Household', 'Marco', 'Martinez', 'marco.martinez@example.com', 'adult', null],
    ['Martinez Household', 'Sofia', 'Martinez', null, 'child', 'Peanut allergy. EpiPen in backpack.'],
    ['Martinez Household', 'Leo', 'Martinez', null, 'child', null],
    ['Johnson Household', 'Maya', 'Johnson', 'maya.johnson@example.com', 'primary', null],
    ['Johnson Household', 'Caleb', 'Johnson', null, 'child', 'Gets anxious at drop-off; prefers quiet corner.'],
    ['Chen Household', 'Daniel', 'Chen', 'daniel.chen@example.com', 'primary', null],
    ['Chen Household', 'Priya', 'Chen', 'priya.chen@example.com', 'adult', null],
    ['Chen Household', 'Noah', 'Chen', null, 'child', null],
    ['Williams Household', 'Harper', 'Williams', 'harper.williams@example.com', 'primary', null],
    ['Williams Household', 'Ava', 'Williams', null, 'child', 'Gluten-free snack only.'],
    ['Williams Household', 'Miles', 'Williams', null, 'child', null],
    ['Patel Household', 'Anika', 'Patel', 'anika.patel@example.com', 'primary', null],
    ['Patel Household', 'Rohan', 'Patel', 'rohan.patel@example.com', 'adult', null],
    ['Garcia Household', 'Isabel', 'Garcia', 'isabel.garcia@example.com', 'primary', null],
    ['Garcia Household', 'Mateo', 'Garcia', null, 'dependent', null],
    ['Thompson Household', 'James', 'Thompson', 'james.thompson@example.com', 'primary', null],
    ['Nguyen Household', 'Linh', 'Nguyen', 'linh.nguyen@example.com', 'primary', null],
    ['Nguyen Household', 'Grace', 'Nguyen', null, 'child', null],
  ].map(([householdName, firstName, lastName, email, householdRole, medicalNotes]) => {
    const household = householdByName.get(householdName);
    return {
      congregation_id: DEMO_CONGREGATION_ID,
      household_id: household.id,
      first_name: firstName,
      last_name: lastName,
      email,
      phone: household.primary_phone,
      household_role: householdRole,
      medical_notes: medicalNotes,
    };
  });

  const { data: profiles, error: profilesError } = await supabase
    .from('church_crm_profiles')
    .insert(personRows)
    .select('id, first_name, last_name, household_role');

  assertOk({ error: profilesError }, 'Create demo CRM profiles');

  const profileByName = new Map(profiles.map((profile) => [`${profile.first_name} ${profile.last_name}`, profile]));

  const { error: noteError } = await supabase.from('pastoral_notes').insert([
    {
      crm_profile_id: profileByName.get('Elena Martinez').id,
      author_id: leaderUserId,
      note_text: 'Interested in helping lead the next newcomer lunch. Follow up after Sunday.',
    },
    {
      crm_profile_id: profileByName.get('Caleb Johnson').id,
      author_id: leaderUserId,
      note_text: 'Family requested prayer during job transition. Check in midweek.',
    },
    {
      crm_profile_id: profileByName.get('James Thompson').id,
      author_id: leaderUserId,
      note_text: 'Recovering from knee surgery; arrange meal train and elder visit.',
    },
  ]);

  assertOk({ error: noteError }, 'Create demo pastoral notes');

  const { error: prayerError } = await supabase.from('prayer_requests').insert([
    {
      congregation_id: DEMO_CONGREGATION_ID,
      user_id: leaderUserId,
      request_text: 'Please pray for a family navigating a difficult diagnosis and a week of appointments.',
      visibility: 'pastor',
    },
    {
      congregation_id: DEMO_CONGREGATION_ID,
      user_id: leaderUserId,
      request_text: 'Pray for volunteers serving at the city food pantry this weekend.',
      visibility: 'congregation',
    },
    {
      congregation_id: DEMO_CONGREGATION_ID,
      user_id: leaderUserId,
      request_text: 'A student in our youth group is preparing for finals and needs peace.',
      visibility: 'congregation',
    },
  ]);

  assertOk({ error: prayerError }, 'Create demo prayer requests');

  const { error: messageError } = await supabase.from('pastoral_messages').insert([
    {
      congregation_id: DEMO_CONGREGATION_ID,
      title: 'Sunday Preview: Practicing Hospitality',
      message_type: 'text_update',
      message_body: '<p>This Sunday we will look at Romans 12 and the ordinary courage of making room for one another.</p>',
      is_published: true,
    },
    {
      congregation_id: DEMO_CONGREGATION_ID,
      title: 'Midweek Care Note',
      message_type: 'text_update',
      message_body: '<p>Take a moment today to call someone you have not seen in a few weeks. Presence is ministry.</p>',
      is_published: true,
    },
  ]);

  assertOk({ error: messageError }, 'Create demo pastoral messages');

  const { data: roles, error: rolesError } = await supabase
    .from('volunteer_roles')
    .insert([
      {
        congregation_id: DEMO_CONGREGATION_ID,
        name: 'Greeter Team',
        description: 'Welcome guests and help families find their way.',
        color_code: '#10b981',
        join_policy: 'open',
      },
      {
        congregation_id: DEMO_CONGREGATION_ID,
        name: 'Kids Ministry',
        description: 'Care for children during worship and support secure check-in.',
        color_code: '#3b82f6',
        join_policy: 'approval_required',
      },
      {
        congregation_id: DEMO_CONGREGATION_ID,
        name: 'Production & Tech',
        description: 'Run slides, livestream, and room audio.',
        color_code: '#64748b',
        join_policy: 'approval_required',
      },
      {
        congregation_id: DEMO_CONGREGATION_ID,
        name: 'Hospitality & Coffee',
        description: 'Prepare coffee and connection space after service.',
        color_code: '#f59e0b',
        join_policy: 'open',
      },
    ])
    .select('id, name');

  assertOk({ error: rolesError }, 'Create demo volunteer roles');

  const roleByName = new Map(roles.map((role) => [role.name, role]));

  const { data: events, error: eventsError } = await supabase
    .from('events')
    .insert([
      {
        congregation_id: DEMO_CONGREGATION_ID,
        title: 'Sunday Worship Service',
        event_type: 'service',
        event_date: iso(sundayService),
        status: 'published',
        organizer_id: leaderUserId,
      },
      {
        congregation_id: DEMO_CONGREGATION_ID,
        title: 'Kids Ministry Classroom',
        event_type: 'service',
        event_date: iso(kidsClass),
        status: 'published',
        organizer_id: leaderUserId,
      },
    ])
    .select('id, title');

  assertOk({ error: eventsError }, 'Create demo events');

  const serviceEvent = events.find((event) => event.title === 'Sunday Worship Service');
  const kidsEvent = events.find((event) => event.title === 'Kids Ministry Classroom');

  const { error: volunteersError } = await supabase.from('event_volunteers').insert([
    {
      event_id: serviceEvent.id,
      role_id: roleByName.get('Greeter Team').id,
      user_id: leaderUserId,
      status: 'accepted',
    },
    {
      event_id: serviceEvent.id,
      role_id: roleByName.get('Production & Tech').id,
      user_id: leaderUserId,
      status: 'pending',
    },
    {
      event_id: kidsEvent.id,
      role_id: roleByName.get('Kids Ministry').id,
      user_id: leaderUserId,
      status: 'accepted',
    },
    {
      event_id: serviceEvent.id,
      role_id: roleByName.get('Hospitality & Coffee').id,
      user_id: leaderUserId,
      status: 'accepted',
    },
  ]);

  assertOk({ error: volunteersError }, 'Create demo volunteer schedule');

  return {
    congregationId: congregation.congregation_id,
    congregationName: congregation.name,
    households: households.length,
    profiles: profiles.length,
    prayerRequests: 3,
    pastoralNotes: 3,
    volunteerRoles: roles.length,
    events: events.length,
    nextSunday: iso(sundayService),
  };
};

const resetDemoData = async () => {
  const leaderUserId = await ensureDemoLeader();
  await wipeDemoData();
  return buildDemoData(leaderUserId);
};

if (require.main === module) {
  resetDemoData()
    .then((summary) => {
      console.log('Demo data reset complete:', summary);
      process.exit(0);
    })
    .catch((error) => {
      console.error('Demo data reset failed:', error);
      process.exit(1);
    });
}

module.exports = {
  DEMO_CONGREGATION_ID,
  resetDemoData,
};
