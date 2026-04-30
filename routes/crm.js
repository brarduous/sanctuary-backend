const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const authenticateUser = require('../middleware/auth');

const getNameParts = (user) => {
    const metadata = user?.user_metadata || {};
    const fullName = metadata.full_name || metadata.name || '';
    const parts = fullName.trim().split(/\s+/).filter(Boolean);

    return {
        firstName: metadata.first_name || parts[0] || 'Church',
        lastName: metadata.last_name || parts.slice(1).join(' ') || 'Member'
    };
};

const ensurePastorOwnsCongregation = async (congregationId, userId) => {
    const { data, error } = await supabase
        .from('congregations')
        .select('congregation_id')
        .eq('congregation_id', congregationId)
        .eq('leader_user_id', userId)
        .single();

    if (error || !data) {
        const forbidden = new Error('Congregation not found');
        forbidden.status = 404;
        throw forbidden;
    }
};

const syncCrmProfilesFromMembers = async (congregationId) => {
    const { data: members, error: memberError } = await supabase
        .from('congregation_members')
        .select('user_id')
        .eq('congregation_id', congregationId)
        .not('user_id', 'is', null);

    if (memberError) throw memberError;

    const userIds = [...new Set((members || []).map(member => member.user_id).filter(Boolean))];
    if (userIds.length === 0) return;

    const { data: existingProfiles, error: profileError } = await supabase
        .from('church_crm_profiles')
        .select('id, user_id, email')
        .eq('congregation_id', congregationId);

    if (profileError) throw profileError;

    const linkedUserIds = new Set((existingProfiles || []).map(profile => profile.user_id).filter(Boolean));

    for (const userId of userIds) {
        if (linkedUserIds.has(userId)) continue;

        const { data: authData, error: authError } = await supabase.auth.admin.getUserById(userId);
        if (authError || !authData?.user) {
            console.warn(`[CRM] Could not fetch auth user ${userId} for congregation ${congregationId}`);
            continue;
        }

        const user = authData.user;
        const email = user.email || user.user_metadata?.email || null;

        if (email) {
            const shadowProfile = (existingProfiles || []).find(profile =>
                !profile.user_id && profile.email && profile.email.toLowerCase() === email.toLowerCase()
            );

            if (shadowProfile) {
                const { error: linkError } = await supabase
                    .from('church_crm_profiles')
                    .update({ user_id: userId })
                    .eq('id', shadowProfile.id);

                if (linkError) throw linkError;
                linkedUserIds.add(userId);
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
        linkedUserIds.add(userId);
    }
};

// GET: Fetch all CRM profiles for a pastor's congregation
router.get('/:congregationId', authenticateUser, async (req, res) => {
    try {
        await ensurePastorOwnsCongregation(req.params.congregationId, req.user.id);
        await syncCrmProfilesFromMembers(req.params.congregationId);

        const { data, error } = await supabase
            .from('church_crm_profiles')
            .select('*, pastoral_notes(id)') // Also get a count of notes
            .eq('congregation_id', req.params.congregationId)
            .order('last_name', { ascending: true });

        if (error) throw error;
        res.json(data);
    } catch (error) {
        console.error('[CRM] Failed to fetch profiles:', error);
        res.status(error.status || 500).json({ error: 'Failed to fetch CRM profiles' });
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
