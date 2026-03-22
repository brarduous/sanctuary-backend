const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const authenticateUser = require('../middleware/auth');
const { sendPushNotification } = require('../utils/push');

// POST: Lookup Household by Phone Number
router.post('/lookup', authenticateUser, async (req, res) => {
    const { congregationId, phone } = req.body;
    try {
        // Find the household based on the primary phone
        const { data: household, error: hhError } = await supabase
            .from('households')
            .select('id, name')
            .eq('congregation_id', congregationId)
            .eq('primary_phone', phone)
            .single();

        if (hhError || !household) {
            return res.status(404).json({ error: 'No household found with this number.' });
        }

        // Get all members of this household
        const { data: members, error: memError } = await supabase
            .from('church_crm_profiles')
            .select('id, first_name, last_name, household_role, medical_notes')
            .eq('household_id', household.id)
            .order('first_name');

        if (memError) throw memError;

        const parents = members.filter(m => ['primary', 'adult'].includes(m.household_role));
        const children = members.filter(m => ['child', 'dependent'].includes(m.household_role));

        res.json({ household, parents, children });
    } catch (error) {
        console.error('Kiosk Lookup Error:', error);
        res.status(500).json({ error: 'Failed to lookup household.' });
    }
});

// POST: Process the Check-In
router.post('/checkin', authenticateUser, async (req, res) => {
    const { congregationId, eventId, childIds, parentId } = req.body;
    
    // Generate a secure 4-character alphanumeric code
    const secureCode = Math.random().toString(36).substring(2, 6).toUpperCase();

    try {
        // Create an array of check-in records for each selected child
        const checkInRecords = childIds.map(childId => ({
            congregation_id: congregationId,
            event_id: eventId,
            profile_id: childId,
            checked_in_by: parentId,
            secure_code: secureCode
        }));

        const { data, error } = await supabase
            .from('check_ins')
            .insert(checkInRecords)
            .select('id');

        if (error) throw error;
        
        // Return the secure code so the UI can display it (or send it to a label printer)
        res.json({ success: true, secureCode });
    } catch (error) {
        console.error('Kiosk Check-in Error:', error);
        res.status(500).json({ error: 'Failed to process check-in.' });
    }
});


router.post('/page-parent', authenticateUser, async (req, res) => {
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
router.post('/dismiss-all', authenticateUser, async (req, res) => {
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


module.exports = router;