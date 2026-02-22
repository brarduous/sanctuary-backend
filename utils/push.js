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

        const userIds = members.map(m => m.user_id);

        // 2. Get the Expo Push Tokens for those users
        // Note: Make sure this matches the table where your mobile app saves the token!
        // Your mobile app code saves to 'profiles' with column 'expo_push_token'.
        const { data: profiles, error: profileError } = await supabase
            .from('profiles')
            .select('expo_push_token')
            .in('id', userIds)
            .not('expo_push_token', 'is', null);

        if (profileError || !profiles || profiles.length === 0) {
            console.log('[Push] No active push tokens found for these members.');
            return;
        }

        // 3. Construct the messages
        let messages = [];
        for (let profile of profiles) {
            // Check that all your push tokens appear to be valid Expo push tokens
            if (!Expo.isExpoPushToken(profile.expo_push_token)) {
                console.error(`[Push] Push token ${profile.expo_push_token} is not a valid Expo push token`);
                continue;
            }

            messages.push({
                to: profile.expo_push_token,
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
    } catch (error) {
        console.error('[Push] Global Error sending push to congregation:', error);
    }
};

module.exports = {
    sendPushToCongregation
};