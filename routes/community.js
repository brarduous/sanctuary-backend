const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const authenticateUser = require('../middleware/auth');
const { callOpenAIAndProcessResult } = require('../utils/helpers');
const { community_prayer_prompt } = require('../prompts');

// 1. Submit a Prayer Request
router.post('/community/request', authenticateUser, async (req, res) => {
    const { userId, content } = req.body;

    try {
        // A. Check Limits (1 per week for Free)
        const { data: profile } = await supabase.from('user_profiles').select('*').eq('user_id', userId).single();
        const isFree = profile.subscription_tier === 'free';
        
        // Reset logic (Weekly)
        const now = new Date();
        const lastReset = new Date(profile.community_requests_reset_date || 0);
        const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

        let currentCount = profile.community_requests_count;
        if (lastReset < oneWeekAgo) {
            currentCount = 0;
            await supabase.from('user_profiles').update({ community_requests_count: 0, community_requests_reset_date: now }).eq('user_id', userId);
        }

        if (isFree && currentCount >= 1) {
            return res.status(403).json({ error: 'Weekly limit reached. Upgrade to Pro to share more requests.' });
        }

        // B. AI Processing
        const aiResponse = await callOpenAIAndProcessResult(
            community_prayer_prompt,
            `Request: "${content}"`,
            'gpt-4o-mini', // Fast & cheap
            500,
            "json_object"
        );

        // C. Save to DB
        const status = aiResponse.status === 'approved' ? 'approved' : 'rejected';
        const { data, error } = await supabase.from('community_prayers').insert({
            user_id: userId,
            original_content: content,
            anonymized_content: aiResponse.anonymized_text,
            status: status
        }).select().single();

        if (error) throw error;

        // Increment usage
        await supabase.from('user_profiles').update({ community_requests_count: currentCount + 1 }).eq('user_id', userId);

        res.json({ success: true, status, prayer: data });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to submit prayer.' });
    }
});

// 2. Fetch a Random Prayer to Pray For
router.get('/community/pray-for-others', authenticateUser, async (req, res) => {
    const userId = req.user.id;

    // Fetch IDs of prayers this user has ALREADY prayed for
    const { data: interactions } = await supabase
        .from('community_prayer_interactions')
        .select('prayer_id')
        .eq('praying_user_id', userId);
    
    const ignoreIds = interactions.map(i => i.prayer_id);
    ignoreIds.push('00000000-0000-0000-0000-000000000000'); // Dummy UUID to prevent SQL syntax error if empty

    // Fetch a random approved prayer that is NOT mine and NOT already prayed for
    // Note: Supabase doesn't have native "RANDOM()" in simple queries easily, 
    // so we fetch a batch and pick one in JS for simplicity on small datasets.
    const { data: candidates, error } = await supabase
        .from('community_prayers')
        .select('id, anonymized_content, created_at')
        .eq('status', 'approved')
        .neq('user_id', userId) // Don't show my own
        .not('id', 'in', `(${ignoreIds.join(',')})`)
        .limit(20);

    if (error) return res.status(500).json({ error: error.message });
    if (!candidates || candidates.length === 0) return res.json({ empty: true });

    // Pick random
    const randomPrayer = candidates[Math.floor(Math.random() * candidates.length)];
    res.json(randomPrayer);
});

// 3. Mark as Prayed
router.post('/community/pray/:prayerId', authenticateUser, async (req, res) => {
    const { prayerId } = req.params;
    const userId = req.user.id;

    // Record interaction
    const { error } = await supabase.from('community_prayer_interactions').insert({
        prayer_id: prayerId,
        praying_user_id: userId
    });

    if (error) return res.status(400).json({ error: 'Already prayed or error.' });

    // Increment counter (RPC is safer for concurrency, but simple update works for MVP)
    // We will use a raw SQL call or just a fetch-update pattern
    const { data: prayer } = await supabase.from('community_prayers').select('prayer_count').eq('id', prayerId).single();
    await supabase.from('community_prayers').update({ prayer_count: (prayer.prayer_count || 0) + 1 }).eq('id', prayerId);

    res.json({ success: true });
});

// 4. Get User Stats (For "X prayed for you")
router.get('/community/stats', authenticateUser, async (req, res) => {
    const userId = req.user.id;
    
    const { data } = await supabase
        .from('community_prayers')
        .select('prayer_count')
        .eq('user_id', userId);
    
    const totalPrayedForYou = data.reduce((sum, row) => sum + (row.prayer_count || 0), 0);
    
    res.json({ totalPrayedForYou });
});

module.exports = router;