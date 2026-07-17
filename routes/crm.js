const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const authenticateUser = require('../middleware/auth');
const { requireCapability } = require('../middleware/authorization');

const getNameParts = (user, profile = null) => {
    const metadata = user?.user_metadata || {};
    const fullName = metadata.full_name || metadata.name || '';
    const parts = fullName.trim().split(/\s+/).filter(Boolean);

    return {
        firstName: profile?.first_name || metadata.first_name || parts[0] || 'Church',
        lastName: profile?.last_name || metadata.last_name || parts.slice(1).join(' ') || 'Member'
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

    const { data: userProfiles, error: userProfileError } = await supabase
        .from('user_profiles')
        .select('user_id, first_name, last_name, email')
        .in('user_id', userIds);

    if (userProfileError) throw userProfileError;

    const userProfileById = new Map((userProfiles || []).map(profile => [profile.user_id, profile]));

    for (const userId of userIds) {
        if (linkedUserIds.has(userId)) continue;

        const { data: authData, error: authError } = await supabase.auth.admin.getUserById(userId);
        if (authError || !authData?.user) {
            console.warn(`[CRM] Could not fetch auth user ${userId} for congregation ${congregationId}`);
            continue;
        }

        const user = authData.user;
        const userProfile = userProfileById.get(userId);
        const email = userProfile?.email || user.email || user.user_metadata?.email || null;

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

        const { firstName, lastName } = getNameParts(user, userProfile);
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
router.get('/:congregationId', authenticateUser, requireCapability('people.read'), async (req, res) => {
    try {
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
router.post('/shadow', authenticateUser, requireCapability('people.write'), async (req, res) => {
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
const loadProfileTenant = async (req, res, next) => {
    const { data, error } = await supabase.from('church_crm_profiles').select('id,congregation_id').eq('id', req.params.profileId).maybeSingle();
    if (error) return next(error);
    if (!data) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Person not found.', requestId: req.requestId } });
    req.body = { ...req.body, congregationId: data.congregation_id };
    req.profileRecord = data;
    next();
};

router.put('/:profileId/merge', authenticateUser, loadProfileTenant, requireCapability('people.write'), async (req, res, next) => {
    const { profileId } = req.params;
    const { sourceProfileId, newUserId } = req.body;
    try {
        if (sourceProfileId) {
            const { data: source } = await supabase.from('church_crm_profiles').select('*').eq('id', sourceProfileId).eq('congregation_id', req.congregationId).is('deleted_at', null).maybeSingle();
            if (!source || source.id === profileId) return res.status(400).json({ error: { code: 'MERGE_INVALID', message: 'Choose two active people in this organization.', requestId: req.requestId } });
            await Promise.all([
                supabase.from('person_timeline_events').update({ profile_id: profileId }).eq('profile_id', source.id).eq('congregation_id', req.congregationId),
                supabase.from('care_cases').update({ profile_id: profileId }).eq('profile_id', source.id).eq('congregation_id', req.congregationId),
                supabase.from('church_crm_profiles').update({ merged_into_id: profileId, deleted_at: new Date().toISOString(), deleted_by: req.user.id, deletion_reason: 'Merged duplicate' }).eq('id', source.id),
            ]);
        } else if (newUserId) {
            await supabase.from('church_crm_profiles').update({ user_id: newUserId }).eq('id', profileId).eq('congregation_id', req.congregationId);
        } else return res.status(400).json({ error: { code: 'MERGE_INVALID', message: 'A duplicate person or user link is required.', requestId: req.requestId } });
        const { data, error } = await supabase.from('church_crm_profiles').select('*').eq('id', profileId).eq('congregation_id', req.congregationId).single();
        if (error) throw error;
        await supabase.from('audit_events').insert({ congregation_id: req.congregationId, actor_user_id: req.user.id, action: 'people.merged', resource_type: 'person', resource_id: profileId, request_id: req.requestId, metadata: { sourceProfileId: sourceProfileId || null, linkedUser: Boolean(newUserId) } });
        res.json({ data });
    } catch (error) {
        next(error);
    }
});

// POST: Add a Pastoral Note
router.post('/:profileId/notes', authenticateUser, loadProfileTenant, requireCapability('care.write'), async (req, res, next) => {
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
        await supabase.from('audit_events').insert({ congregation_id: req.congregationId, actor_user_id: req.user.id, action: 'care.confidential_note_created', resource_type: 'person', resource_id: profileId, request_id: req.requestId });
        res.status(201).json(data);
    } catch (error) {
        next(error);
    }
});

router.post('/:congregationId/import', authenticateUser, requireCapability('people.write'), async (req, res, next) => {
    try {
        const rows = Array.isArray(req.body?.rows) ? req.body.rows.slice(0, 500) : [];
        if (!rows.length) return res.status(400).json({ error: { code: 'IMPORT_EMPTY', message: 'Provide at least one person row.', requestId: req.requestId } });
        const seen = new Set(); const accepted = []; const rejected = [];
        rows.forEach((row, index) => {
            const firstName = String(row.firstName || '').trim(); const email = String(row.email || '').trim().toLowerCase();
            const key = email || `${firstName}|${String(row.lastName || '').trim()}|${String(row.phone || '').replace(/\D/g, '')}`;
            if (!firstName || seen.has(key)) rejected.push({ row: index + 1, reason: !firstName ? 'First name is required.' : 'Duplicate in import.' });
            else { seen.add(key); accepted.push({ congregation_id: req.congregationId, first_name: firstName, last_name: String(row.lastName || '').trim() || null, email: email || null, phone: String(row.phone || '').trim() || null, lifecycle_status: row.lifecycleStatus || 'active', tags: Array.isArray(row.tags) ? row.tags.map(String) : [], custom_fields: row.customFields || {}, consent_status: row.consentStatus || 'unknown' }); }
        });
        const { data, error } = accepted.length ? await supabase.from('church_crm_profiles').insert(accepted).select('id') : { data: [], error: null };
        if (error) throw error;
        await supabase.from('audit_events').insert({ congregation_id: req.congregationId, actor_user_id: req.user.id, action: 'people.imported', resource_type: 'person', request_id: req.requestId, metadata: { accepted: data.length, rejected: rejected.length } });
        res.status(201).json({ data: { imported: data.length, rejected } });
    } catch (error) { next(error); }
});

router.patch('/:congregationId/bulk', authenticateUser, requireCapability('people.write'), async (req, res, next) => {
    try {
        const ids = Array.isArray(req.body?.profileIds) ? [...new Set(req.body.profileIds)].slice(0, 500) : [];
        const allowed = new Set(['lifecycle_status','household_id','tags','consent_status','custom_fields']);
        const updates = Object.fromEntries(Object.entries(req.body?.updates || {}).filter(([key]) => allowed.has(key)));
        if (!ids.length || !Object.keys(updates).length) return res.status(400).json({ error: { code: 'BULK_INVALID', message: 'Choose people and at least one supported update.', requestId: req.requestId } });
        const { data, error } = await supabase.from('church_crm_profiles').update(updates).in('id', ids).eq('congregation_id', req.congregationId).is('deleted_at', null).select('id');
        if (error) throw error;
        await supabase.from('audit_events').insert({ congregation_id: req.congregationId, actor_user_id: req.user.id, action: 'people.bulk_updated', resource_type: 'person', request_id: req.requestId, metadata: { count: data.length, fields: Object.keys(updates) } });
        res.json({ data: { updated: data.length } });
    } catch (error) { next(error); }
});

router.post('/:congregationId/segments', authenticateUser, requireCapability('people.write'), async (req, res, next) => {
    try {
        const name = String(req.body?.name || '').trim();
        if (!name) return res.status(400).json({ error: { code: 'SEGMENT_NAME_REQUIRED', message: 'Segment name is required.', requestId: req.requestId } });
        const { data, error } = await supabase.from('person_segments').insert({ congregation_id: req.congregationId, name, definition: req.body.definition || {}, created_by: req.user.id }).select().single();
        if (error) throw error;
        res.status(201).json({ data });
    } catch (error) { next(error); }
});

router.get('/:congregationId/:profileId/timeline', authenticateUser, requireCapability('people.read'), async (req, res, next) => {
    try {
        const { data, error } = await supabase.from('person_timeline_events').select('*').eq('congregation_id', req.congregationId).eq('profile_id', req.params.profileId).order('occurred_at', { ascending: false });
        if (error) throw error;
        res.json({ data });
    } catch (error) { next(error); }
});

module.exports = router;
