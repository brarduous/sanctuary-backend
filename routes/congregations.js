const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const authenticateUser = require('../middleware/auth');

const getDisplayNameParts = (user) => {
  const metadata = user?.user_metadata || {};
  const fullName = metadata.full_name || metadata.name || '';
  const firstName = metadata.first_name || fullName.trim().split(/\s+/)[0] || 'Church';
  const lastName = metadata.last_name || fullName.trim().split(/\s+/).slice(1).join(' ') || 'Member';

  return { firstName, lastName };
};

const ensureCrmProfile = async ({ congregationId, user }) => {
  const userId = user.id;
  const email = user.email || user.user_metadata?.email || null;
  const { firstName, lastName } = getDisplayNameParts(user);

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

    // 1. Get the Congregation
    const { data: congregation, error: congError } = await supabase
      .from('congregations')
      .select('*')
      .eq('leader_user_id', userId)
      .single();

    if (congError && congError.code !== 'PGRST116') { // PGRST116 is Supabase "No rows found"
      throw congError;
    }

    if (!congregation) {
      return res.status(200).json(null); // Return clean null if they haven't created one
    }

    // 2. Fetch Total Member Count
    const { count: totalMembers, error: totalError } = await supabase
      .from('congregation_members')
      .select('*', { count: 'exact', head: true })
      .eq('congregation_id', congregation.congregation_id);

    if (totalError) throw totalError;

    // 3. Fetch Active Member Count (Last 7 Days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    const { count: activeThisWeek, error: activeError } = await supabase
      .from('congregation_members')
      .select('*', { count: 'exact', head: true })
      .eq('congregation_id', congregation.congregation_id)
      .gte('last_active_date', sevenDaysAgo.toISOString());

    if (activeError) throw activeError;

    // Return the congregation object merged with the calculated stats
    res.status(200).json({
      ...congregation,
      stats: {
        totalMembers: totalMembers || 0,
        activeThisWeek: activeThisWeek || 0
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

    // Check if one already exists
    const { data: existing } = await supabase
      .from('congregations')
      .select('congregation_id')
      .eq('leader_user_id', userId)
      .single();

    if (existing) {
      return res.status(400).json({ error: 'A congregation already exists for this user', congregation_id: existing.congregation_id });
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
