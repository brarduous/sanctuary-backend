const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const authenticateUser = require('../middleware/auth');
const { requireCapability } = require('../middleware/authorization');

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
router.get('/browse-teams/:congregationId', authenticateUser, requireCapability('volunteers.read'), async (req, res) => {
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
    const { roleId } = req.body;
    const userId = req.user.id;
    
    try {
        const { data: role, error: roleError } = await supabase.from('volunteer_roles').select('id,congregation_id,join_policy').eq('id', roleId).maybeSingle();
        if (roleError) throw roleError;
        if (!role || role.join_policy === 'invite_only') return res.status(404).json({ error: { code: 'ROLE_NOT_AVAILABLE', message: 'That team is not available to join.', requestId: req.requestId } });
        const { data: membership, error: membershipError } = await supabase.from('organization_memberships').select('id').eq('congregation_id', role.congregation_id).eq('user_id', userId).eq('active', true).maybeSingle();
        if (membershipError) throw membershipError;
        if (!membership) return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'You cannot join a team in another organization.', requestId: req.requestId } });
        const status = role.join_policy === 'open' ? 'active' : 'pending_approval';
        const { data, error } = await supabase
            .from('role_members')
            .insert({ congregation_id: role.congregation_id, role_id: roleId, user_id: userId, status })
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

router.put('/:congregationId/profile', authenticateUser, requireCapability('volunteers.read'), async (req, res, next) => {
    try {
        const qualifications = Array.isArray(req.body?.qualifications) ? req.body.qualifications.map(String).slice(0, 50) : [];
        const { data, error } = await supabase.from('volunteer_profiles').upsert({ congregation_id: req.congregationId, user_id: req.user.id, qualifications, active: req.body.active !== false, updated_at: new Date().toISOString() }, { onConflict: 'congregation_id,user_id' }).select().single();
        if (error) throw error;
        res.json({ data });
    } catch (error) { next(error); }
});

router.post('/:congregationId/availability', authenticateUser, requireCapability('volunteers.read'), async (req, res, next) => {
    try {
        const { startsAt, endsAt, availability = 'unavailable' } = req.body || {};
        if (!startsAt || !endsAt || new Date(startsAt) >= new Date(endsAt) || !['available','unavailable','preferred'].includes(availability)) return res.status(400).json({ error: { code: 'AVAILABILITY_INVALID', message: 'Provide a valid availability window.', requestId: req.requestId } });
        const { data, error } = await supabase.from('volunteer_availability').insert({ congregation_id: req.congregationId, user_id: req.user.id, starts_at: startsAt, ends_at: endsAt, availability, reason: req.body.reason || null, recurrence_rule: req.body.recurrenceRule || null }).select().single();
        if (error) throw error;
        res.status(201).json({ data });
    } catch (error) { next(error); }
});

router.post('/:congregationId/rotations', authenticateUser, requireCapability('volunteers.write'), async (req, res, next) => {
    try {
        const name = String(req.body?.name || '').trim(); const recurrenceRule = String(req.body?.recurrenceRule || '').trim();
        const { data: role } = await supabase.from('volunteer_roles').select('id').eq('id', req.body.roleId).eq('congregation_id', req.congregationId).maybeSingle();
        if (!name || !recurrenceRule || !role) return res.status(400).json({ error: { code: 'ROTATION_INVALID', message: 'Name, role, and recurrence rule are required.', requestId: req.requestId } });
        const { data, error } = await supabase.from('volunteer_rotations').insert({ congregation_id: req.congregationId, role_id: role.id, name, recurrence_rule: recurrenceRule, reminder_hours: Number(req.body.reminderHours) || 48, created_by: req.user.id }).select().single();
        if (error) throw error;
        await supabase.from('audit_events').insert({ congregation_id: req.congregationId, actor_user_id: req.user.id, action: 'volunteer.rotation_created', resource_type: 'volunteer_rotation', resource_id: data.id, request_id: req.requestId });
        res.status(201).json({ data });
    } catch (error) { next(error); }
});

router.patch('/:congregationId/background-checks/:userId', authenticateUser, requireCapability('volunteers.write'), async (req, res, next) => {
    try {
        const status = String(req.body?.status || '');
        if (!['pending','clear','review','expired','not_required'].includes(status)) return res.status(400).json({ error: { code: 'BACKGROUND_STATUS_INVALID', message: 'Background-check status is invalid.', requestId: req.requestId } });
        const { data, error } = await supabase.from('volunteer_profiles').upsert({ congregation_id: req.congregationId, user_id: req.params.userId, background_check_status: status, background_check_expires_at: req.body.expiresAt || null, updated_at: new Date().toISOString() }, { onConflict: 'congregation_id,user_id' }).select().single();
        if (error) throw error;
        await supabase.from('audit_events').insert({ congregation_id: req.congregationId, actor_user_id: req.user.id, action: 'volunteer.background_check_changed', resource_type: 'volunteer_profile', resource_id: req.params.userId, request_id: req.requestId, metadata: { status, expiresAt: req.body.expiresAt || null } });
        res.json({ data });
    } catch (error) { next(error); }
});

module.exports = router;
