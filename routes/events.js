const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const authenticateUser = require('../middleware/auth');

// GET: Fetch events for the Dashboard (Handles Pastor vs. Organizer permissions)
router.get('/dashboard/:congregationId', authenticateUser, async (req, res) => {
    try {
        const userId = req.user.id;
        const { congregationId } = req.params;

        // 1. Check if the user is the Head Pastor of this congregation
        const { data: cong } = await supabase
            .from('congregations')
            .select('leader_user_id')
            .eq('congregation_id', congregationId)
            .single();

        const isHeadPastor = cong?.leader_user_id === userId;

        // 2. Build the query
        let query = supabase
            .from('events')
            .select('*, profiles:organizer_id(first_name, last_name)')
            .eq('congregation_id', congregationId)
            .order('event_date', { ascending: true });

        // If they aren't the pastor, ONLY show events they are organizing
        if (!isHeadPastor) {
            query = query.eq('organizer_id', userId);
        }

        const { data, error } = await query;
        if (error) throw error;

        res.json({ isHeadPastor, events: data });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch events' });
    }
});

// POST: Create an Event Shell (Usually done by the Pastor)
router.post('/', authenticateUser, async (req, res) => {
    const { congregationId, title, eventType } = req.body;
    
    // We create a shell. The date/time can be filled in later by the delegated leader.
    try {
        const { data, error } = await supabase
            .from('events')
            .insert({
                congregation_id: congregationId,
                title,
                event_type: eventType || 'service',
                status: 'draft',
                event_date: new Date().toISOString() // Placeholder
            })
            .select()
            .single();

        if (error) throw error;
        res.status(201).json(data);
    } catch (error) {
        res.status(500).json({ error: 'Failed to create event shell' });
    }
});

// POST: Claim an Event via Magic Token
router.post('/claim/:token', authenticateUser, async (req, res) => {
    try {
        const userId = req.user.id;
        const { token } = req.params;

        // Assign the logged-in user as the organizer
        const { data, error } = await supabase
            .from('events')
            .update({ organizer_id: userId })
            .eq('manage_token', token)
            .select()
            .single();

        if (error || !data) throw new Error('Invalid or expired token.');
        
        res.json({ message: 'Event successfully claimed!', eventId: data.id });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

module.exports = router;