const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const authenticateUser = require('../middleware/auth');

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