const { Expo } = require('expo-server-sdk');
const supabase = require('../config/supabase');

// Create a new Expo SDK client
let expo = new Expo();

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

        // 2. Get the Expo Push Tokens for those users
        // The mobile app can save tokens during startup to profiles, and during
        // onboarding through user_profiles. Check both so either path works.
        const { data: authProfiles, error: profileError } = await supabase
            .from('profiles')
            .select('expo_push_token')
            .in('id', userIds)
            .not('expo_push_token', 'is', null);

        if (profileError) {
            console.error('[Push] Error fetching profile push tokens:', profileError);
        }

        const { data: userProfiles, error: userProfileError } = await supabase
            .from('user_profiles')
            .select('expo_push_token')
            .in('user_id', userIds)
            .not('expo_push_token', 'is', null);

        if (userProfileError) {
            console.error('[Push] Error fetching user_profile push tokens:', userProfileError);
        }

        const pushTokens = [
            ...(authProfiles || []).map(profile => profile.expo_push_token),
            ...(userProfiles || []).map(profile => profile.expo_push_token)
        ].filter(Boolean);

        const uniquePushTokens = [...new Set(pushTokens)];

        if (uniquePushTokens.length === 0) {
            console.log('[Push] No active push tokens found for these members.');
            return { sent: 0, reason: 'no_push_tokens' };
        }

        // 3. Construct the messages
        let messages = [];
        for (let pushToken of uniquePushTokens) {
            // Check that all your push tokens appear to be valid Expo push tokens
            if (!Expo.isExpoPushToken(pushToken)) {
                console.error(`[Push] Push token ${pushToken} is not a valid Expo push token`);
                continue;
            }

            messages.push({
                to: pushToken,
                sound: 'default',
                title: title,
                body: body,
                data: dataPayload,
            });
        }

        // 4. Send the notifications in batches (Expo requirement)
        let chunks = expo.chunkPushNotifications(messages);
        let tickets = [];
        
        for (let chunk of chunks) {
            try {
                let ticketChunk = await expo.sendPushNotificationsAsync(chunk);
                tickets.push(...ticketChunk);
            } catch (error) {
                console.error('[Push] Error sending chunk:', error);
            }
        }
        
        console.log(`[Push] Successfully sent ${messages.length} notifications.`);
        return { sent: messages.length, tickets };
    } catch (error) {
        console.error('[Push] Global Error sending push to congregation:', error);
        return { sent: 0, error };
    }
};

module.exports = {
    sendPushToCongregation
};
