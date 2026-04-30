const supabase = require('../config/supabase');

const getNameParts = (user) => {
  const metadata = user?.user_metadata || {};
  const fullName = metadata.full_name || metadata.name || '';
  const parts = fullName.trim().split(/\s+/).filter(Boolean);

  return {
    firstName: metadata.first_name || parts[0] || 'Church',
    lastName: metadata.last_name || parts.slice(1).join(' ') || 'Member'
  };
};

const run = async () => {
  const { data: memberships, error } = await supabase
    .from('congregation_members')
    .select('member_id, congregation_id, user_id, join_date')
    .not('user_id', 'is', null)
    .order('join_date', { ascending: false })
    .order('member_id', { ascending: false });

  if (error) throw error;

  const latestMembershipByUser = new Map();

  for (const membership of memberships || []) {
    const key = `${membership.congregation_id}:${membership.user_id}`;
    if (!latestMembershipByUser.has(key)) {
      latestMembershipByUser.set(key, membership);
    }
  }

  let created = 0;
  let linked = 0;
  let skipped = 0;

  for (const membership of latestMembershipByUser.values()) {
    const { congregation_id: congregationId, user_id: userId } = membership;

    const { data: existingProfiles, error: existingError } = await supabase
      .from('church_crm_profiles')
      .select('id')
      .eq('congregation_id', congregationId)
      .eq('user_id', userId)
      .limit(1);

    if (existingError) throw existingError;
    if (existingProfiles?.length) {
      skipped += 1;
      continue;
    }

    const { data: authData, error: authError } = await supabase.auth.admin.getUserById(userId);
    if (authError || !authData?.user) {
      console.warn(`Skipping ${userId}: unable to fetch auth user`);
      skipped += 1;
      continue;
    }

    const user = authData.user;
    const email = user.email || user.user_metadata?.email || null;

    if (email) {
      const { data: shadowProfiles, error: shadowError } = await supabase
        .from('church_crm_profiles')
        .select('id')
        .eq('congregation_id', congregationId)
        .is('user_id', null)
        .ilike('email', email)
        .limit(1);

      if (shadowError) throw shadowError;

      if (shadowProfiles?.[0]) {
        const { error: linkError } = await supabase
          .from('church_crm_profiles')
          .update({ user_id: userId })
          .eq('id', shadowProfiles[0].id);

        if (linkError) throw linkError;
        linked += 1;
        continue;
      }
    }

    const { firstName, lastName } = getNameParts(user);
    const { error: insertError } = await supabase
      .from('church_crm_profiles')
      .insert({
        congregation_id: congregationId,
        first_name: firstName,
        last_name: lastName,
        email,
        user_id: userId
      });

    if (insertError) throw insertError;
    created += 1;
  }

  console.log(`CRM backfill complete. Created: ${created}. Linked shadows: ${linked}. Skipped: ${skipped}.`);
};

run().catch((error) => {
  console.error('CRM backfill failed:', error);
  process.exitCode = 1;
});
