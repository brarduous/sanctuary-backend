const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const authenticateUser = require('../middleware/auth');

// GET: Mobile Hub - Fetch User's Schedule & Team Memberships
router.get('/hub', authenticateUser, async (req, res) => {
    const userId = req.user.id;
    try {
        // 1. Get Upcoming Schedule (Pending & Accepted)
        const { data: schedule } = await supabase
            .from('event_volunteers')
            .select(`
                id, status, 
                events(id, title, event_date, location), 
                volunteer_roles(name, color_code)
            `)
            .eq('user_id', userId)
            .gte('events.event_date', new Date().toISOString())
            .order('events.event_date', { ascending: true });

        // 2. Get Teams they are currently on
        const { data: myTeams } = await supabase
            .from('role_members')
            .select(`status, volunteer_roles(id, name, color_code)`)
            .eq('user_id', userId);

        res.json({ schedule: schedule || [], myTeams: myTeams || [] });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch volunteer hub data' });
    }
});

// GET: Browse Available Teams to Join
router.get('/browse-teams/:congregationId', authenticateUser, async (req, res) => {
    try {
        // Only fetch roles that are NOT invite_only
        const { data, error } = await supabase
            .from('volunteer_roles')
            .select('id, name, description, color_code, join_policy')
            .eq('congregation_id', req.params.congregationId)
            .neq('join_policy', 'invite_only')
            .order('name', { ascending: true });

        if (error) throw error;
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch available teams' });
    }
});

// POST: Request to join a team
router.post('/join-team', authenticateUser, async (req, res) => {
    const { roleId, joinPolicy } = req.body;
    const userId = req.user.id;
    
    // If it's open, they are instantly active. If it requires approval, set to pending.
    const status = joinPolicy === 'open' ? 'active' : 'pending_approval';

    try {
        const { data, error } = await supabase
            .from('role_members')
            .insert({ role_id: roleId, user_id: userId, status })
            .select()
            .single();

        if (error) {
            if (error.code === '23505') return res.status(400).json({ error: 'You have already joined or requested to join this team.' });
            throw error;
        }
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: 'Failed to join team' });
    }
});

module.exports = router;