const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const authenticateUser = require('../middleware/auth');

const getDisplayNameParts = (user, profile = null) => {
  const metadata = user?.user_metadata || {};
  const fullName = metadata.full_name || metadata.name || '';
  const firstName = profile?.first_name || metadata.first_name || fullName.trim().split(/\s+/)[0] || 'Church';
  const lastName = profile?.last_name || metadata.last_name || fullName.trim().split(/\s+/).slice(1).join(' ') || 'Member';

  return { firstName, lastName };
};

const ensureCrmProfile = async ({ congregationId, user }) => {
  const userId = user.id;
  const { data: userProfile, error: userProfileError } = await supabase
    .from('user_profiles')
    .select('first_name, last_name, email')
    .eq('user_id', userId)
    .limit(1);

  if (userProfileError) throw userProfileError;

  const profile = userProfile?.[0] || null;
  const email = profile?.email || user.email || user.user_metadata?.email || null;
  const { firstName, lastName } = getDisplayNameParts(user, profile);

  const { data: existingProfile, error: existingError } = await supabase
    .from('church_crm_profiles')
    .select('id')
    .eq('congregation_id', congregationId)
    .eq('user_id', userId)
    .limit(1);

  if (existingError) throw existingError;
  if (existingProfile?.[0]) return existingProfile[0];

  if (email) {
    const { data: shadowProfile, error: shadowError } = await supabase
      .from('church_crm_profiles')
      .select('id')
      .eq('congregation_id', congregationId)
      .is('user_id', null)
      .ilike('email', email)
      .limit(1);

    if (shadowError) throw shadowError;

    if (shadowProfile?.[0]) {
      const { data, error } = await supabase
        .from('church_crm_profiles')
        .update({ user_id: userId })
        .eq('id', shadowProfile[0].id)
        .select()
        .single();

      if (error) throw error;
      return data;
    }
  }

  const { data, error } = await supabase
    .from('church_crm_profiles')
    .insert({
      congregation_id: congregationId,
      first_name: firstName,
      last_name: lastName,
      email,
      user_id: userId
    })
    .select()
    .single();

  if (error) throw error;
  return data;
};

const getCurrentMembership = async (userId) => {
  const { data, error } = await supabase
    .from('congregation_members')
    .select('member_id, congregation_id')
    .eq('user_id', userId)
    .order('join_date', { ascending: false })
    .order('member_id', { ascending: false })
    .limit(1);

  if (error) throw error;
  return data?.[0] || null;
};

// GET: Fetch congregation and member stats for the logged-in Pastor
router.get('/', authenticateUser, async (req, res) => {
  try {
    const userId = req.user.id;
    const requestedCongregationId = Number(req.get('x-congregation-id')) || null;

    let membershipQuery = supabase.from('organization_memberships').select('congregation_id').eq('user_id', userId).eq('active', true).order('created_at').limit(1);
    if (requestedCongregationId) membershipQuery = membershipQuery.eq('congregation_id', requestedCongregationId);
    const { data: memberships, error: membershipError } = await membershipQuery;
    if (membershipError) throw membershipError;
    let congregationId = memberships?.[0]?.congregation_id || null;
    if (!congregationId) {
      const { data: legacy } = await supabase.from('congregations').select('congregation_id').eq('leader_user_id', userId).limit(1).maybeSingle();
      congregationId = legacy?.congregation_id || null;
    }
    if (!congregationId) return res.status(200).json(null);
    const { data: congregation, error: congError } = await supabase
      .from('congregations')
      .select('*')
      .eq('congregation_id', congregationId)
      .single();

    if (congError && congError.code !== 'PGRST116') { // PGRST116 is Supabase "No rows found"
      throw congError;
    }

    if (!congregation) return res.status(200).json(null);

    // CRM people are the congregation roster. App-auth memberships are access
    // records and must not be presented as the church's member count.
    const { count: totalMembers, error: totalError } = await supabase
      .from('church_crm_profiles')
      .select('*', { count: 'exact', head: true })
      .eq('congregation_id', congregation.congregation_id)
      .is('deleted_at', null);

    if (totalError) throw totalError;

    // Active this week means people with a real check-in, not accounts whose
    // membership row happened to be created or refreshed.
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const { data: recentCheckIns, error: activeError } = await supabase
      .from('check_ins')
      .select('profile_id')
      .eq('congregation_id', congregation.congregation_id)
      .gte('checked_in_at', sevenDaysAgo.toISOString());

    if (activeError) throw activeError;

    // Return the congregation object merged with the calculated stats
    res.status(200).json({
      ...congregation,
      stats: {
        totalMembers: totalMembers || 0,
        activeThisWeek: new Set((recentCheckIns || []).map((row) => row.profile_id).filter(Boolean)).size
      }
    });

  } catch (error) {
    console.error('[Congregations API] Error fetching:', error);
    res.status(500).json({ error: 'Failed to fetch congregation details' });
  }
});

// GET: Fetch the logged-in layperson's current congregation membership
router.get('/membership/me', authenticateUser, async (req, res) => {
  try {
    const membership = await getCurrentMembership(req.user.id);
    res.status(200).json({
      congregation_id: membership?.congregation_id || null,
      member_id: membership?.member_id || null
    });
  } catch (error) {
    console.error('[Congregations API] Error fetching membership:', error);
    res.status(500).json({ error: 'Failed to fetch congregation membership' });
  }
});

// POST: Join a congregation from an invite token and mirror the member into the CRM
router.post('/join', authenticateUser, async (req, res) => {
  try {
    const userId = req.user.id;
    const token = String(req.body?.token || '').trim();

    if (!token) {
      return res.status(400).json({ error: 'Invite token is required' });
    }

    const { data: congregation, error: congregationError } = await supabase
      .from('congregations')
      .select('congregation_id, name')
      .eq('invite_token', token)
      .single();

    if (congregationError || !congregation) {
      return res.status(404).json({ error: 'Invalid or expired invite code' });
    }

    const currentMembership = await getCurrentMembership(userId);

    if (currentMembership?.congregation_id !== congregation.congregation_id) {
      const { error: deleteError } = await supabase
        .from('congregation_members')
        .delete()
        .eq('user_id', userId);

      if (deleteError) throw deleteError;

      const { error: insertError } = await supabase
        .from('congregation_members')
        .insert({
          congregation_id: congregation.congregation_id,
          user_id: userId
        });

      if (insertError) throw insertError;
    } else {
      const { error: activeError } = await supabase
        .from('congregation_members')
        .update({ last_active_date: new Date().toISOString() })
        .eq('member_id', currentMembership.member_id);

      if (activeError) throw activeError;

      const { error: duplicateDeleteError } = await supabase
        .from('congregation_members')
        .delete()
        .eq('user_id', userId)
        .neq('member_id', currentMembership.member_id);

      if (duplicateDeleteError) throw duplicateDeleteError;
    }

    await ensureCrmProfile({ congregationId: congregation.congregation_id, user: req.user });

    res.status(200).json({
      congregation_id: congregation.congregation_id,
      church: congregation
    });
  } catch (error) {
    console.error('[Congregations API] Error joining:', error);
    res.status(500).json({ error: 'Failed to join congregation' });
  }
});

// POST: Create a new congregation
router.post('/', authenticateUser, async (req, res) => {
  try {
    const userId = req.user.id;
    const { name, description } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Congregation name is required' });
    }

    const { data: existingMembership } = await supabase.from('organization_memberships').select('congregation_id').eq('user_id', userId).eq('active', true).limit(1).maybeSingle();
    const { data: existingLegacy } = await supabase.from('congregations').select('congregation_id, onboarding_reset_at').eq('leader_user_id', userId).limit(1).maybeSingle();
    const existing = existingMembership || existingLegacy;

    if (existing) {
      if (existingLegacy?.onboarding_reset_at) {
        const { data: restored, error: restoreError } = await supabase.from('congregations').update({
          name: String(name).trim(),
          description: description || null,
          onboarding_reset_at: null,
          invite_token: null,
          updated_at: new Date().toISOString(),
        }).eq('congregation_id', existingLegacy.congregation_id).eq('leader_user_id', userId).select().single();
        if (restoreError) throw restoreError;
        const { error: membershipRestoreError } = await supabase.from('organization_memberships').insert({
          congregation_id: restored.congregation_id, user_id: userId, role: 'lead_pastor', active: true,
        });
        if (membershipRestoreError) throw membershipRestoreError;
        await ensureCrmProfile({ congregationId: restored.congregation_id, user: req.user });
        return res.status(200).json(restored);
      }
      if (existingLegacy && existingLegacy.congregation_id === existing.congregation_id) {
        const { data: ownedCongregation, error: ownedError } = await supabase.from('congregations').select('*').eq('congregation_id', existingLegacy.congregation_id).eq('leader_user_id', userId).single();
        if (ownedError) throw ownedError;
        return res.status(200).json(ownedCongregation);
      }
      return res.status(409).json({ error: { code: 'CONGREGATION_EXISTS', message: 'This account already belongs to an organization.', requestId: req.requestId }, congregation_id: existing.congregation_id });
    }

    // Create the congregation
    const { data, error } = await supabase
      .from('congregations')
      .insert({
        name: name,
        description: description || null,
        leader_user_id: userId
      })
      .select()
      .single();

    if (error) throw error;
    const { error: membershipInsertError } = await supabase.from('organization_memberships').insert({ congregation_id: data.congregation_id, user_id: userId, role: 'lead_pastor', active: true });
    if (membershipInsertError) throw membershipInsertError;

    res.status(201).json(data);
  } catch (error) {
    console.error('[Congregations API] Error creating congregation:', error.message);
    res.status(500).json({ error: 'Failed to create congregation' });
  }
});

// GET: Fetch published content for a specific congregation (For Layperson App)
router.get('/:congregationId/content', authenticateUser, async (req, res) => {
  try {
    const { congregationId } = req.params;

    // 1. Get Church details
    const { data: church, error: churchErr } = await supabase
      .from('congregations')
      .select('*')
      .eq('congregation_id', congregationId)
      .single();
    
    if (churchErr) throw churchErr;

    // 2. Get Published Studies (Bypasses RLS because backend uses secure client)
    const { data: studies, error: studiesErr } = await supabase
      .from('bible_studies')
      .select('*')
      .eq('congregation_id', congregationId)
      .eq('is_published', true)
      .order('created_at', { ascending: false });

    // 3. Get Published Messages
    const { data: messages, error: messagesErr } = await supabase
      .from('pastoral_messages')
      .select('*')
      .eq('congregation_id', congregationId)
      .eq('is_published', true)
      .order('created_at', { ascending: false });

    res.json({
      church,
      studies: studies || [],
      messages: messages || []
    });
  } catch (error) {
    console.error('[Congregations API] Error fetching church content:', error);
    res.status(500).json({ error: 'Failed to fetch church content' });
  }
});

// DELETE: Allow a user to leave their current congregation
router.delete('/leave', authenticateUser, async (req, res) => {
    try {
        const userId = req.user.id;
        const { error } = await supabase
            .from('congregation_members')
            .delete()
            .eq('user_id', userId);

        if (error) throw error;
        res.json({ message: 'Successfully left the congregation.' });
    } catch (error) {
        console.error('[Congregations API] Error leaving:', error);
        res.status(500).json({ error: 'Failed to leave congregation.' });
    }
});

module.exports = router;
