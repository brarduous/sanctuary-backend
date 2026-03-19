const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const authenticateUser = require('../middleware/auth');

// GET: Fetch all CRM profiles for a pastor's congregation
router.get('/:congregationId', authenticateUser, async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('church_crm_profiles')
            .select('*, pastoral_notes(id)') // Also get a count of notes
            .eq('congregation_id', req.params.congregationId)
            .order('last_name', { ascending: true });

        if (error) throw error;
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch CRM profiles' });
    }
});

// POST: Create a "John Doe" shadow profile
router.post('/shadow', authenticateUser, async (req, res) => {
    const { congregationId, firstName, lastName, email, phone } = req.body;
    try {
        const { data, error } = await supabase
            .from('church_crm_profiles')
            .insert({
                congregation_id: congregationId,
                first_name: firstName,
                last_name: lastName,
                email: email,
                phone: phone,
                user_id: null // Explicitly null for John Doe
            })
            .select().single();

        if (error) throw error;
        res.status(201).json(data);
    } catch (error) {
        res.status(500).json({ error: 'Failed to create profile' });
    }
});

// PUT: Merge a Shadow Profile with a newly registered App User
router.put('/:profileId/merge', authenticateUser, async (req, res) => {
    const { profileId } = req.params;
    const { newUserId } = req.body; // The ID of the user who just joined the app
    try {
        const { data, error } = await supabase
            .from('church_crm_profiles')
            .update({ user_id: newUserId })
            .eq('id', profileId)
            .select().single();

        if (error) throw error;
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: 'Failed to merge profile' });
    }
});

// POST: Add a Pastoral Note
router.post('/:profileId/notes', authenticateUser, async (req, res) => {
    const { profileId } = req.params;
    const { noteText } = req.body;
    try {
        const { data, error } = await supabase
            .from('pastoral_notes')
            .insert({
                crm_profile_id: profileId,
                author_id: req.user.id,
                note_text: noteText
            })
            .select().single();

        if (error) throw error;
        res.status(201).json(data);
    } catch (error) {
        res.status(500).json({ error: 'Failed to add note' });
    }
});

module.exports = router;