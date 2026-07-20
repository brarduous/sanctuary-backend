const { Expo } = require('expo-server-sdk');
const supabase = require('../config/supabase');

// Create a new Expo SDK client
let expo = new Expo();

const fetchPushRecipients = async (userIds = null, preference = null) => {
    let authQuery = supabase.from('profiles').select('id, expo_push_token').not('expo_push_token', 'is', null);
    let userProfileQuery = supabase.from('user_profiles').select('user_id, expo_push_token, user_preferences');
    if (userIds) {
        authQuery = authQuery.in('id', userIds);
        userProfileQuery = userProfileQuery.in('user_id', userIds);
    }

    const [{ data: authProfiles, error: authError }, { data: userProfiles, error: userProfileError }] = await Promise.all([
        authQuery,
        userProfileQuery,
    ]);
    // Some production projects use only user_profiles. Treat a missing legacy
    // profiles table as an empty token source while surfacing all other errors.
    if (authError && authError.code !== '42P01') throw authError;
    if (userProfileError) throw userProfileError;

    const preferencesByUser = new Map((userProfiles || []).map(profile => [
        profile.user_id,
        profile.user_preferences?.notifications || {},
    ]));
    const recipients = [
        ...(authProfiles || []).map(profile => ({
            userId: profile.id,
            token: profile.expo_push_token,
            preferences: preferencesByUser.get(profile.id) || {},
        })),
        ...(userProfiles || []).filter(profile => profile.expo_push_token).map(profile => ({
            userId: profile.user_id,
            token: profile.expo_push_token,
            preferences: profile.user_preferences?.notifications || {},
        })),
    ];

    return [...new Map(recipients
        .filter(recipient => !preference || recipient.preferences[preference] !== false)
        .map(recipient => [recipient.token, recipient])).values()];
};

const sendPushToUsers = async ({ userIds = null, title, body, data = {}, preference = null }) => {
    const recipients = await fetchPushRecipients(userIds, preference);
    const messages = recipients
        .filter(recipient => Expo.isExpoPushToken(recipient.token))
        .map(recipient => ({
            to: recipient.token,
            sound: 'default',
            title,
            body,
            data,
        }));
    const tickets = [];
    for (const chunk of expo.chunkPushNotifications(messages)) {
        tickets.push(...await expo.sendPushNotificationsAsync(chunk));
    }
    return { sent: messages.length, tickets };
};

const sendPushToAll = async (title, body, data = {}, preference = null) =>
    sendPushToUsers({ title, body, data, preference });

const sendPushToCongregation = async (congregationId, title, body, dataPayload = {}) => {
    try {
        console.log(`[Push] Initiating push to congregation ${congregationId}`);

        // 1. Get all user IDs belonging to this congregation
        const { data: members, error: memberError } = await supabase
            .from('congregation_members')
            .select('user_id')
            .eq('congregation_id', congregationId);

        if (memberError || !members || members.length === 0) {
            console.log('[Push] No members found for congregation.');
            return;
        }

        const userIds = [...new Set(members.map(m => m.user_id).filter(Boolean))];

        if (userIds.length === 0) {
            console.log('[Push] No valid member user IDs found for congregation.');
            return { sent: 0, reason: 'no_user_ids' };
        }

        return await sendPushToUsers({ userIds, title, body, data: dataPayload });
    } catch (error) {
        console.error('[Push] Global Error sending push to congregation:', error);
        return { sent: 0, error };
    }
};

module.exports = {
    sendPushToCongregation,
    sendPushToUsers,
    sendPushToAll,
};
