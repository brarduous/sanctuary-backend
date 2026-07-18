const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const authenticateUser = require('../middleware/auth');
const { requireCapability } = require('../middleware/authorization');
const { createHash, randomInt, timingSafeEqual } = require('node:crypto');
const { sendPushNotification } = require('../utils/push');

// POST: Lookup Household by Phone Number
const normalizePhone = (value) => String(value || '').replace(/\D/g, '').slice(-10);
const hashCredential = (value) => createHash('sha256').update(String(value)).digest('hex');

const loadEventTenant = async (req, res, next) => {
    const eventId = req.body?.eventId;
    if (!eventId) return res.status(400).json({ error: { code: 'EVENT_REQUIRED', message: 'Event is required.', requestId: req.requestId } });
    const { data, error } = await supabase.from('events').select('id, congregation_id').eq('id', eventId).maybeSingle();
    if (error) return next(error);
    if (!data) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Event not found.', requestId: req.requestId } });
    req.body.congregationId = data.congregation_id;
    next();
};

const loadCheckInTenant = async (req, res, next) => {
    const { data, error } = await supabase.from('check_ins').select('id, congregation_id, status').eq('id', req.body?.checkInId).maybeSingle();
    if (error) return next(error);
    if (!data) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Check-in not found.', requestId: req.requestId } });
    req.checkIn = data;
    req.body.congregationId = data.congregation_id;
    next();
};

const loadSessionTenant = async (req, res, next) => {
    const { data, error } = await supabase.from('kiosk_sessions').select('id, congregation_id').eq('id', req.params.sessionId).maybeSingle();
    if (error) return next(error);
    if (!data) return res.status(404).json({ error: { code: 'SESSION_NOT_FOUND', message: 'Kiosk session not found.', requestId: req.requestId } });
    req.body = { ...(req.body || {}), congregationId: data.congregation_id };
    next();
};

const loadIncidentTenant = async (req, res, next) => {
    const { data, error } = await supabase.from('safeguarding_incidents').select('id,congregation_id,status').eq('id', req.params.incidentId).maybeSingle();
    if (error) return next(error);
    if (!data) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Safeguarding incident not found.', requestId: req.requestId } });
    req.incident = data;
    req.body = { ...(req.body || {}), congregationId: data.congregation_id };
    next();
};

router.get('/events/:eventId/rooms', authenticateUser, async (req, res, next) => {
    try {
        const { data: event, error: eventError } = await supabase.from('events').select('congregation_id').eq('id', req.params.eventId).maybeSingle();
        if (eventError) throw eventError;
        if (!event) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Event not found.', requestId: req.requestId } });
        req.body = { congregationId: event.congregation_id };
        return requireCapability('check_in.read')(req, res, async () => {
            const { data, error } = await supabase.from('checkin_rooms').select('id,name,capacity,active').eq('congregation_id', event.congregation_id).eq('active', true).order('name');
            if (error) return next(error);
            res.json({ data });
        });
    } catch (error) { next(error); }
});

router.post('/events/:eventId/rooms', authenticateUser, async (req, res, next) => {
    try {
        const { data: event, error: eventError } = await supabase.from('events').select('congregation_id').eq('id', req.params.eventId).maybeSingle();
        if (eventError) throw eventError;
        if (!event) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Event not found.', requestId: req.requestId } });
        req.body = { ...(req.body || {}), congregationId: event.congregation_id };
        return requireCapability('check_in.write')(req, res, async () => {
            const name = String(req.body.name || '').trim();
            const capacity = Number(req.body.capacity);
            if (!name || !Number.isInteger(capacity) || capacity < 1 || capacity > 1000) return res.status(400).json({ error: { code: 'ROOM_INVALID', message: 'Room name and a capacity from 1 to 1000 are required.', requestId: req.requestId } });
            const { data, error } = await supabase.from('checkin_rooms').insert({ congregation_id: event.congregation_id, name, capacity }).select().single();
            if (error) return next(error);
            res.status(201).json({ data });
        });
    } catch (error) { next(error); }
});

router.post('/sessions', authenticateUser, loadEventTenant, requireCapability('check_in.write'), async (req, res, next) => {
    try {
        const durationMinutes = Math.min(Math.max(Number(req.body?.durationMinutes) || 240, 15), 720);
        const expiresAt = new Date(Date.now() + durationMinutes * 60 * 1000).toISOString();
        const { data, error } = await supabase.from('kiosk_sessions').insert({ congregation_id: req.congregationId, event_id: req.body.eventId, opened_by: req.user.id, expires_at: expiresAt }).select().single();
        if (error) throw error;
        await supabase.from('audit_events').insert({ congregation_id: req.congregationId, actor_user_id: req.user.id, action: 'check_in.kiosk_opened', resource_type: 'kiosk_session', resource_id: data.id, request_id: req.requestId });
        res.status(201).json({ data });
    } catch (error) { next(error); }
});

router.post('/sessions/:sessionId/lock', authenticateUser, loadSessionTenant, requireCapability('check_in.write'), async (req, res, next) => {
    try {
        const now = new Date().toISOString();
        const { data, error } = await supabase.from('kiosk_sessions').update({ locked_at: now }).eq('id', req.params.sessionId).eq('congregation_id', req.congregationId).is('locked_at', null).select().maybeSingle();
        if (error) throw error;
        if (!data) return res.status(404).json({ error: { code: 'SESSION_NOT_FOUND', message: 'Active kiosk session not found.', requestId: req.requestId } });
        await supabase.from('audit_events').insert({ congregation_id: req.congregationId, actor_user_id: req.user.id, action: 'check_in.kiosk_locked', resource_type: 'kiosk_session', resource_id: data.id, request_id: req.requestId });
        res.json({ data });
    } catch (error) { next(error); }
});

router.post('/lookup', authenticateUser, requireCapability('check_in.read'), async (req, res, next) => {
    const { congregationId, phone } = req.body;
    try {
        const normalizedPhone = normalizePhone(phone);
        if (normalizedPhone.length !== 10) return res.status(400).json({ error: { code: 'PHONE_INVALID', message: 'Enter a valid 10-digit phone number.', requestId: req.requestId } });
        // Find the household based on the primary phone
        let { data: household, error: hhError } = await supabase
            .from('households')
            .select('id, name')
            .eq('congregation_id', congregationId)
            .eq('primary_phone_normalized', normalizedPhone)
            .maybeSingle();

        if ((hhError && ['42703', 'PGRST204'].includes(hhError.code)) || (!hhError && !household)) {
            const legacy = await supabase.from('households').select('id,name,primary_phone').eq('congregation_id', congregationId).limit(500);
            if (legacy.error) throw legacy.error;
            household = (legacy.data || []).find((candidate) => normalizePhone(candidate.primary_phone) === normalizedPhone) || null;
            hhError = null;
        }

        if (hhError) throw hhError;
        if (!household) return res.status(404).json({ error: { code: 'HOUSEHOLD_NOT_FOUND', message: 'No household found with this number.', requestId: req.requestId } });

        // Get all members of this household
        const { data: members, error: memError } = await supabase
            .from('church_crm_profiles')
            .select('id, first_name, last_name, household_role')
            .eq('congregation_id', req.congregationId)
            .eq('household_id', household.id)
            .order('first_name');

        if (memError) throw memError;

        const parents = members.filter(m => ['primary', 'adult'].includes(m.household_role));
        const children = members.filter(m => ['child', 'dependent'].includes(m.household_role));

        const childIds = children.map((child) => child.id);
        const { data: alerts, error: alertsError } = childIds.length ? await supabase.from('medical_alerts')
            .select('child_profile_id, alert_type, description').eq('congregation_id', req.congregationId).in('child_profile_id', childIds).eq('active', true) : { data: [], error: null };
        if (alertsError) throw alertsError;
        res.json({ household: { id: household.id, name: household.name }, parents, children: children.map((child) => ({ ...child, medicalAlerts: alerts.filter((alert) => alert.child_profile_id === child.id).map(({ alert_type, description }) => ({ type: alert_type, description })) })) });
    } catch (error) { next(error); }
});

// POST: Process the Check-In
router.post('/checkin', authenticateUser, loadEventTenant, requireCapability('check_in.write'), async (req, res) => {
    const { eventId, childIds, parentId, roomId, kioskSessionId } = req.body;
    const idempotencyKey = String(req.get('idempotency-key') || '');
    if (!/^[A-Za-z0-9_-]{16,100}$/.test(idempotencyKey)) return res.status(400).json({ error: { code: 'IDEMPOTENCY_KEY_REQUIRED', message: 'A valid idempotency key is required.', requestId: req.requestId } });
    // Generate a secure 4-character alphanumeric code
    const secureCode = String(randomInt(0, 1000000)).padStart(6, '0');

    try {
        const { data: replay, error: replayError } = await supabase.from('api_idempotency_records').select('response').eq('actor_user_id', req.user.id).eq('operation', 'kiosk.checkin').eq('idempotency_key', idempotencyKey).gt('expires_at', new Date().toISOString()).maybeSingle();
        if (replayError) throw replayError;
        if (replay) return res.set('Idempotent-Replayed', 'true').json(replay.response);
        if (!Array.isArray(childIds) || childIds.length === 0 || !parentId || !roomId || !kioskSessionId) return res.status(400).json({ error: { code: 'CHECKIN_INVALID', message: 'Select an active kiosk session, room, authorized guardian, and at least one child.', requestId: req.requestId } });
        const { data: session, error: sessionError } = await supabase.from('kiosk_sessions').select('id').eq('id', kioskSessionId).eq('event_id', eventId).eq('congregation_id', req.congregationId).is('locked_at', null).gt('expires_at', new Date().toISOString()).maybeSingle();
        if (sessionError) throw sessionError;
        if (!session) return res.status(409).json({ error: { code: 'KIOSK_SESSION_INACTIVE', message: 'The kiosk session is locked or expired.', requestId: req.requestId } });
        const { data: room, error: roomError } = await supabase.from('checkin_rooms').select('id,capacity').eq('id', roomId).eq('congregation_id', req.congregationId).eq('active', true).maybeSingle();
        if (roomError) throw roomError;
        if (!room) return res.status(400).json({ error: { code: 'ROOM_INVALID', message: 'Choose an active check-in room.', requestId: req.requestId } });
        const { count: occupied, error: occupiedError } = await supabase.from('check_ins').select('id', { count: 'exact', head: true }).eq('event_id', eventId).eq('room_id', roomId).eq('status', 'active');
        if (occupiedError) throw occupiedError;
        if ((occupied || 0) + childIds.length > room.capacity) return res.status(409).json({ error: { code: 'ROOM_CAPACITY_REACHED', message: 'This room does not have enough remaining capacity.', requestId: req.requestId } });
        const { data: authorized, error: guardianError } = await supabase.from('guardian_relationships')
            .select('child_profile_id').eq('congregation_id', req.congregationId).eq('guardian_profile_id', parentId).eq('pickup_authorized', true).in('child_profile_id', childIds);
        if (guardianError) throw guardianError;
        const authorizedIds = new Set(authorized.map((row) => row.child_profile_id));
        if (childIds.some((id) => !authorizedIds.has(id))) return res.status(403).json({ error: { code: 'GUARDIAN_NOT_AUTHORIZED', message: 'This guardian is not authorized for every selected child.', requestId: req.requestId } });

        const checkInRecords = childIds.map(childId => ({
            congregation_id: req.congregationId,
            event_id: eventId,
            profile_id: childId,
            checked_in_by: parentId,
            secure_code: secureCode,
            room_id: roomId,
            kiosk_session_id: kioskSessionId,
            idempotency_key: idempotencyKey
        }));

        const { data, error } = await supabase
            .from('check_ins')
            .insert(checkInRecords)
            .select('id');

        if (error) throw error;
        
        const credentialHash = hashCredential(secureCode);
        const { error: credentialError } = await supabase.from('pickup_credentials').insert(data.map((record) => ({ congregation_id: req.congregationId, check_in_id: record.id, credential_hash: credentialHash, expires_at: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString() })));
        if (credentialError) throw credentialError;
        const labels = data.flatMap((record) => [
            { congregation_id: req.congregationId, check_in_id: record.id, label_type: 'child', payload: { checkInId: record.id, secureCode, roomId } },
            { congregation_id: req.congregationId, check_in_id: record.id, label_type: 'guardian', payload: { checkInId: record.id, secureCode } },
        ]);
        const { error: labelError } = await supabase.from('checkin_labels').insert(labels);
        if (labelError) throw labelError;
        await supabase.from('audit_events').insert({ congregation_id: req.congregationId, actor_user_id: req.user.id, action: 'check_in.created', resource_type: 'check_in', metadata: { checkInIds: data.map((record) => record.id), childCount: data.length } });
        const response = { success: true, secureCode, checkInIds: data.map((record) => record.id) };
        const { error: idempotencyError } = await supabase.from('api_idempotency_records').insert({ actor_user_id: req.user.id, operation: 'kiosk.checkin', idempotency_key: idempotencyKey, response });
        if (idempotencyError) throw idempotencyError;
        res.status(201).json(response);
    } catch (error) {
        console.error('Kiosk Check-in Error:', error);
        res.status(500).json({ error: 'Failed to process check-in.' });
    }
});

router.get('/labels/:checkInId', authenticateUser, requireCapability('check_in.read'), async (req, res, next) => {
    try {
        const { data, error } = await supabase.from('checkin_labels').select('id,check_in_id,label_type,payload,print_status,attempts,printed_at').eq('check_in_id', req.params.checkInId).eq('congregation_id', req.congregationId).order('label_type');
        if (error) throw error;
        res.json({ data });
    } catch (error) { next(error); }
});

router.post('/labels/:labelId/printed', authenticateUser, requireCapability('check_in.write'), async (req, res, next) => {
    try {
        const now = new Date().toISOString();
        const { data, error } = await supabase.from('checkin_labels').update({ print_status: 'printed', printed_at: now }).eq('id', req.params.labelId).eq('congregation_id', req.congregationId).select().maybeSingle();
        if (error) throw error;
        if (!data) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Label not found.', requestId: req.requestId } });
        await supabase.from('check_ins').update({ label_printed_at: now }).eq('id', data.check_in_id);
        res.json({ data });
    } catch (error) { next(error); }
});


router.post('/page-parent', authenticateUser, loadEventTenant, requireCapability('check_in.write'), async (req, res) => {
    const { eventId, profileId } = req.body;

    try {
        // Find the active check-in and join the CRM profiles to get the parent's auth.users ID
        const { data: checkIn, error } = await supabase
            .from('check_ins')
            .select(`
                id,
                parent:checked_in_by(user_id),
                child:profile_id(first_name)
            `)
            .eq('event_id', eventId)
            .eq('profile_id', profileId)
            .eq('status', 'active')
            .single();

        if (error || !checkIn) throw new Error('Active check-in not found.');
        
        // If the parent is a "John Doe" visitor without an app account, we can't push them
        const parentUserId = checkIn.parent?.user_id;
        if (!parentUserId) throw new Error('The person who checked this child in does not have the app installed.');

        const childName = checkIn.child?.first_name || 'your child';
        
        await sendPushNotification(parentUserId, {
            title: "Classroom Alert 🚨",
            body: `Please come to the classroom. Your attention is needed for ${childName}.`,
            data: { route: `/church/events/${eventId}` }
        });

        res.json({ success: true, message: `Paged parent for ${childName}.` });
    } catch (error) {
        console.error('Error paging parent:', error);
        res.status(500).json({ error: error.message || 'Failed to page parent.' });
    }
});

// --- DISMISS ALL (MASS PAGE) ---
router.post('/dismiss-all', authenticateUser, loadEventTenant, requireCapability('check_in.write'), async (req, res) => {
    const { eventId } = req.body;

    try {
        const { data: activeCheckIns, error } = await supabase
            .from('check_ins')
            .select('parent:checked_in_by(user_id)')
            .eq('event_id', eventId)
            .eq('status', 'active');

        if (error) throw error;

        // Extract user IDs, filter out nulls (visitors), and deduplicate (so parents with 3 kids only get 1 push)
        const parentUserIds = activeCheckIns
            .map(c => c.parent?.user_id)
            .filter(Boolean);
        const uniqueParentIds = [...new Set(parentUserIds)];

        // Fire batch push notifications
        const pushPromises = uniqueParentIds.map(parentId => 
            sendPushNotification(parentId, {
                title: "Class Dismissed ✅",
                body: "Service has concluded! Please head to the classroom area with your pickup tag to collect your child.",
                data: { route: `/church/events/${eventId}` }
            })
        );

        await Promise.all(pushPromises);

        res.json({ success: true, pagedCount: uniqueParentIds.length });
    } catch (error) {
        console.error('Error dismissing class:', error);
        res.status(500).json({ error: 'Failed to trigger mass dismissal.' });
    }
});

router.post('/checkout', authenticateUser, loadCheckInTenant, requireCapability('check_in.write'), async (req, res) => {
    const { checkInId, secureCode } = req.body;
    const { data: credential, error } = await supabase.from('pickup_credentials').select('credential_hash, expires_at, verified_at').eq('check_in_id', checkInId).maybeSingle();
    if (error) throw error;
    const supplied = Buffer.from(hashCredential(secureCode));
    const expected = Buffer.from(credential?.credential_hash || '');
    const valid = credential && !credential.verified_at && new Date(credential.expires_at) > new Date() && supplied.length === expected.length && timingSafeEqual(supplied, expected);
    if (!valid) return res.status(403).json({ error: { code: 'PICKUP_DENIED', message: 'Pickup credential is invalid or expired.', requestId: req.requestId } });
    const now = new Date().toISOString();
    const { error: updateError } = await supabase.from('check_ins').update({ status: 'checked_out', checked_out_at: now }).eq('id', checkInId).eq('status', 'active');
    if (updateError) throw updateError;
    await supabase.from('pickup_credentials').update({ verified_at: now, verified_by: req.user.id }).eq('check_in_id', checkInId).is('verified_at', null);
    await supabase.from('audit_events').insert({ congregation_id: req.congregationId, actor_user_id: req.user.id, action: 'check_in.checked_out', resource_type: 'check_in', resource_id: checkInId });
    res.json({ success: true, checkedOutAt: now });
});

router.post('/checkout-override', authenticateUser, loadCheckInTenant, requireCapability('check_in.override'), async (req, res) => {
    const reason = String(req.body?.reason || '').trim();
    if (reason.length < 10) return res.status(400).json({ error: { code: 'OVERRIDE_REASON_REQUIRED', message: 'Provide a specific override reason.', requestId: req.requestId } });
    const now = new Date().toISOString();
    const { error } = await supabase.from('check_ins').update({ status: 'checked_out', checked_out_at: now }).eq('id', req.body.checkInId).eq('status', 'active');
    if (error) throw error;
    await supabase.from('pickup_credentials').update({ verified_at: now, verified_by: req.user.id, override_reason: reason }).eq('check_in_id', req.body.checkInId);
    await supabase.from('audit_events').insert({ congregation_id: req.congregationId, actor_user_id: req.user.id, action: 'check_in.checkout_overridden', resource_type: 'check_in', resource_id: req.body.checkInId, metadata: { reason } });
    res.json({ success: true, checkedOutAt: now });
});

router.get('/incidents', authenticateUser, requireCapability('check_in.override'), async (req, res, next) => {
    try {
        const { data, error } = await supabase.from('safeguarding_incidents').select('id,event_id,check_in_id,subject_profile_id,incident_type,severity,summary,actions_taken,status,occurred_at,reported_by,closed_at,closed_by,outcome,retention_until,created_at').eq('congregation_id', req.congregationId).order('occurred_at', { ascending: false }).limit(100);
        if (error) throw error;
        res.json({ data });
    } catch (error) { next(error); }
});

router.post('/incidents', authenticateUser, requireCapability('check_in.override'), async (req, res, next) => {
    const incidentType = String(req.body?.incidentType || '');
    const severity = String(req.body?.severity || '');
    const summary = String(req.body?.summary || '').trim();
    const actionsTaken = String(req.body?.actionsTaken || '').trim();
    if (!['injury','medical','guardian_dispute','missing_child','behavior','facility','other'].includes(incidentType) || !['low','moderate','high','critical'].includes(severity) || summary.length < 20 || actionsTaken.length < 10) {
        return res.status(400).json({ error: { code: 'INCIDENT_INVALID', message: 'Choose an incident type and severity, then document a specific summary and actions taken.', requestId: req.requestId } });
    }
    try {
        const row = { congregation_id: req.congregationId, event_id: req.body.eventId || null, check_in_id: req.body.checkInId || null, subject_profile_id: req.body.subjectProfileId || null, incident_type: incidentType, severity, summary, actions_taken: actionsTaken, occurred_at: req.body.occurredAt ? new Date(req.body.occurredAt).toISOString() : new Date().toISOString(), reported_by: req.user.id, retention_until: req.body.retentionUntil || null };
        const { data, error } = await supabase.from('safeguarding_incidents').insert(row).select('*').single();
        if (error) throw error;
        await supabase.from('audit_events').insert({ congregation_id: req.congregationId, actor_user_id: req.user.id, action: 'safeguarding.incident_recorded', resource_type: 'safeguarding_incident', resource_id: data.id, request_id: req.requestId, metadata: { incidentType, severity } });
        res.status(201).json({ data });
    } catch (error) { next(error); }
});

router.patch('/incidents/:incidentId/close', authenticateUser, loadIncidentTenant, requireCapability('check_in.override'), async (req, res, next) => {
    const outcome = String(req.body?.outcome || '').trim();
    if (outcome.length < 10) return res.status(400).json({ error: { code: 'OUTCOME_REQUIRED', message: 'Document the safeguarding outcome before closing.', requestId: req.requestId } });
    try {
        const now = new Date().toISOString();
        const { data, error } = await supabase.from('safeguarding_incidents').update({ status: 'closed', outcome, closed_at: now, closed_by: req.user.id, updated_at: now }).eq('id', req.params.incidentId).eq('congregation_id', req.congregationId).eq('status', 'open').select('*').maybeSingle();
        if (error) throw error;
        if (!data) return res.status(409).json({ error: { code: 'INCIDENT_NOT_OPEN', message: 'This incident is already closed.', requestId: req.requestId } });
        await supabase.from('audit_events').insert({ congregation_id: req.congregationId, actor_user_id: req.user.id, action: 'safeguarding.incident_closed', resource_type: 'safeguarding_incident', resource_id: data.id, request_id: req.requestId });
        res.json({ data });
    } catch (error) { next(error); }
});


module.exports = router;
