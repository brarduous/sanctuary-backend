const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const authenticateUser = require('../middleware/auth');
const { requireCapability } = require('../middleware/authorization');

const loadEventTenant = async (req, res, next) => {
    const { data, error } = await supabase.from('events').select('id,congregation_id').eq('id', req.params.eventId).maybeSingle();
    if (error) return next(error);
    if (!data) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Event not found.', requestId: req.requestId } });
    req.body = { ...req.body, congregationId: data.congregation_id };
    req.event = data;
    next();
};

// GET: Fetch events for the Dashboard (Handles Pastor vs. Organizer permissions)
router.get('/dashboard/:congregationId', authenticateUser, requireCapability('events.read'), async (req, res) => {
    try {
        const userId = req.user.id;
        const { congregationId } = req.params;

        const { data: canManage } = await supabase.rpc('has_congregation_capability', {
            requested_congregation_id: Number(congregationId), requested_capability: 'events.write', requested_user_id: userId, requested_campus_id: null,
        });
        const query = supabase
            .from('events')
            .select('*')
            .eq('congregation_id', congregationId)
            .order('event_date', { ascending: true });

        const { data, error } = await query;
        if (error) throw error;

        res.json({ isHeadPastor: Boolean(canManage), canManage: Boolean(canManage), events: data });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch events' });
    }
});

// POST: Create an Event Shell (Usually done by the Pastor)
router.post('/', authenticateUser, requireCapability('events.write'), async (req, res) => {
    const { title, eventType } = req.body;
    if (!String(title || '').trim()) return res.status(400).json({ error: { code: 'TITLE_REQUIRED', message: 'Event title is required.', requestId: req.requestId } });
    
    // We create a shell. The date/time can be filled in later by the delegated leader.
    try {
        const { data, error } = await supabase
            .from('events')
            .insert({
                congregation_id: req.congregationId,
                title: String(title).trim(),
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

router.patch('/:eventId', authenticateUser, loadEventTenant, requireCapability('events.write'), async (req, res, next) => {
    try {
        const allowed = new Set(['title','description','event_date','end_time','location','event_type','is_public','status','capacity','recurrence_rule','registration_opens_at','registration_closes_at','registration_form','cancellation_reason','follow_up_status']);
        const updates = Object.fromEntries(Object.entries(req.body || {}).filter(([key]) => allowed.has(key)));
        const { data, error } = await supabase.from('events').update(updates).eq('id', req.params.eventId).eq('congregation_id', req.congregationId).select().single();
        if (error) throw error;
        await supabase.from('audit_events').insert({ congregation_id: req.congregationId, actor_user_id: req.user.id, action: 'event.updated', resource_type: 'event', resource_id: data.id, request_id: req.requestId, metadata: { fields: Object.keys(updates) } });
        res.json({ data });
    } catch (error) { next(error); }
});

router.post('/:eventId/resources', authenticateUser, loadEventTenant, requireCapability('events.write'), async (req, res, next) => {
    try {
        const { resourceId, startsAt, endsAt } = req.body;
        const { data: resource } = await supabase.from('event_resources').select('id').eq('id', resourceId).eq('congregation_id', req.congregationId).eq('active', true).maybeSingle();
        if (!resource || !startsAt || !endsAt || new Date(startsAt) >= new Date(endsAt)) return res.status(400).json({ error: { code: 'BOOKING_INVALID', message: 'Choose an active resource and valid time range.', requestId: req.requestId } });
        const { data: conflicts, error: conflictError } = await supabase.from('event_resource_bookings').select('event_id').eq('resource_id', resourceId).lt('starts_at', endsAt).gt('ends_at', startsAt).neq('event_id', req.params.eventId);
        if (conflictError) throw conflictError;
        if (conflicts.length) return res.status(409).json({ error: { code: 'RESOURCE_CONFLICT', message: 'The resource is already booked during that time.', requestId: req.requestId } });
        const { data, error } = await supabase.from('event_resource_bookings').upsert({ event_id: req.params.eventId, resource_id: resourceId, congregation_id: req.congregationId, starts_at: startsAt, ends_at: endsAt }).select().single();
        if (error) throw error;
        res.status(201).json({ data });
    } catch (error) { next(error); }
});

router.post('/:eventId/register', authenticateUser, loadEventTenant, requireCapability('events.read'), async (req, res, next) => {
    try {
        const { data: event, error: eventError } = await supabase.from('events').select('capacity,registration_opens_at,registration_closes_at,status').eq('id', req.params.eventId).eq('congregation_id', req.congregationId).single();
        if (eventError) throw eventError;
        const now = new Date();
        if (event.status !== 'published' || (event.registration_opens_at && now < new Date(event.registration_opens_at)) || (event.registration_closes_at && now > new Date(event.registration_closes_at))) return res.status(409).json({ error: { code: 'REGISTRATION_CLOSED', message: 'Registration is not currently open.', requestId: req.requestId } });
        const { count, error: countError } = await supabase.from('event_registrations').select('id', { count: 'exact', head: true }).eq('event_id', req.params.eventId).eq('status', 'registered');
        if (countError) throw countError;
        const waitlisted = event.capacity !== null && count >= event.capacity;
        const { data, error } = await supabase.from('event_registrations').insert({ congregation_id: req.congregationId, event_id: req.params.eventId, profile_id: req.body.profileId || null, guest_email: req.body.guestEmail || null, status: waitlisted ? 'waitlisted' : 'registered', waitlist_position: waitlisted ? count - event.capacity + 1 : null, response_data: req.body.responseData || {} }).select().single();
        if (error) throw error;
        await supabase.from('audit_events').insert({ congregation_id: req.congregationId, actor_user_id: req.user.id, action: `event.${data.status}`, resource_type: 'event_registration', resource_id: data.id, request_id: req.requestId });
        res.status(201).json({ data });
    } catch (error) { next(error); }
});

router.post('/:eventId/registrations/:registrationId/attendance', authenticateUser, loadEventTenant, requireCapability('events.write'), async (req, res, next) => {
    try {
        const attended = req.body.attended !== false;
        const { data, error } = await supabase.from('event_registrations').update({ attended_at: attended ? new Date().toISOString() : null }).eq('id', req.params.registrationId).eq('event_id', req.params.eventId).eq('congregation_id', req.congregationId).select().maybeSingle();
        if (error) throw error;
        if (!data) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Registration not found.', requestId: req.requestId } });
        res.json({ data });
    } catch (error) { next(error); }
});

router.post('/:eventId/cancel', authenticateUser, loadEventTenant, requireCapability('events.write'), async (req, res, next) => {
    try {
        const reason = String(req.body?.reason || '').trim();
        if (reason.length < 5) return res.status(400).json({ error: { code: 'CANCELLATION_REASON_REQUIRED', message: 'Provide a cancellation reason.', requestId: req.requestId } });
        const { data, error } = await supabase.from('events').update({ status: 'cancelled', cancellation_reason: reason }).eq('id', req.params.eventId).eq('congregation_id', req.congregationId).select().single();
        if (error) throw error;
        await supabase.from('event_registrations').update({ status: 'cancelled', cancelled_at: new Date().toISOString() }).eq('event_id', req.params.eventId).in('status', ['registered','waitlisted']);
        await supabase.from('audit_events').insert({ congregation_id: req.congregationId, actor_user_id: req.user.id, action: 'event.cancelled', resource_type: 'event', resource_id: data.id, request_id: req.requestId, metadata: { reason } });
        res.json({ data });
    } catch (error) { next(error); }
});

router.post('/:eventId/schedule', authenticateUser, loadEventTenant, requireCapability('volunteers.write'), async (req, res, next) => {
    const { roleId, userId } = req.body;
    if (!roleId || !userId) return res.status(400).json({ error: { code: 'ASSIGNMENT_INVALID', message: 'Role and volunteer are required.', requestId: req.requestId } });
    try {
        const { data: role, error: roleError } = await supabase.from('volunteer_roles').select('id').eq('id', roleId).eq('congregation_id', req.congregationId).maybeSingle();
        if (roleError) throw roleError;
        if (!role) return res.status(404).json({ error: { code: 'ROLE_NOT_FOUND', message: 'Volunteer role was not found in this organization.', requestId: req.requestId } });
        const { data, error } = await supabase.from('event_volunteers').insert({ congregation_id: req.congregationId, event_id: req.params.eventId, role_id: roleId, user_id: userId, status: 'pending', notified_at: new Date().toISOString() }).select().single();
        if (error) {
            if (error.code === '23505') return res.status(409).json({ error: { code: 'ASSIGNMENT_EXISTS', message: 'This volunteer is already assigned to that role.', requestId: req.requestId } });
            throw error;
        }
        await supabase.from('audit_events').insert({ congregation_id: req.congregationId, actor_user_id: req.user.id, action: 'volunteer.scheduled', resource_type: 'event_volunteer', resource_id: data.id, metadata: { eventId: req.params.eventId, roleId, userId } });
        res.status(201).json(data);
    } catch (error) { next(error); }
});

router.post('/:eventId/respond', authenticateUser, loadEventTenant, async (req, res, next) => {
    const status = String(req.body?.status || '');
    if (!['accepted', 'declined'].includes(status)) return res.status(400).json({ error: { code: 'RESPONSE_INVALID', message: 'Response must be accepted or declined.', requestId: req.requestId } });
    try {
        const { data, error } = await supabase.from('event_volunteers').update({ status, responded_at: new Date().toISOString() }).eq('id', req.body.assignmentId).eq('event_id', req.params.eventId).eq('user_id', req.user.id).select().maybeSingle();
        if (error) throw error;
        if (!data) return res.status(404).json({ error: { code: 'ASSIGNMENT_NOT_FOUND', message: 'Assignment not found.', requestId: req.requestId } });
        await supabase.from('audit_events').insert({ congregation_id: req.event.congregation_id, actor_user_id: req.user.id, action: `volunteer.${status}`, resource_type: 'event_volunteer', resource_id: data.id });
        res.json(data);
    } catch (error) { next(error); }
});

router.post('/:eventId/substitute', authenticateUser, loadEventTenant, requireCapability('volunteers.write'), async (req, res, next) => {
    try {
        const { assignmentId, substituteUserId } = req.body;
        const { data: assignment } = await supabase.from('event_volunteers').select('*').eq('id', assignmentId).eq('event_id', req.params.eventId).eq('congregation_id', req.congregationId).maybeSingle();
        if (!assignment || !substituteUserId) return res.status(404).json({ error: { code: 'ASSIGNMENT_NOT_FOUND', message: 'Assignment not found.', requestId: req.requestId } });
        const { data, error } = await supabase.from('event_volunteers').insert({ congregation_id: req.congregationId, event_id: req.params.eventId, role_id: assignment.role_id, user_id: substituteUserId, status: 'pending', substituted_for_id: assignment.id, notified_at: new Date().toISOString() }).select().single();
        if (error) throw error;
        await supabase.from('event_volunteers').update({ status: 'substituted' }).eq('id', assignment.id);
        await supabase.from('audit_events').insert({ congregation_id: req.congregationId, actor_user_id: req.user.id, action: 'volunteer.substituted', resource_type: 'event_volunteer', resource_id: data.id, request_id: req.requestId, metadata: { replacedAssignmentId: assignment.id } });
        res.status(201).json({ data });
    } catch (error) { next(error); }
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
