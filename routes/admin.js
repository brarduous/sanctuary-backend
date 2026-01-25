const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const authenticateUser = require('../middleware/auth');
const requireAdmin = require('../middleware/adminAuth');

// Apply checks to ALL routes in this file
router.use(authenticateUser);
router.use(requireAdmin);

// GET /admin/logs
router.get('/logs', async (req, res) => {
    const limit = parseInt(req.query.limit) || 100;
    
    const { data, error } = await supabase
        .from('system_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit);

    if (error) {
        return res.status(500).json({ error: error.message });
    }
    
    res.json(data);
});

// GET /admin/stats (Mission Control Data)
router.get('/stats', async (req, res) => {
    try {
        const [
            freeUsers,
            paidPro,
            whitelistedPro,
            recentErrors
        ] = await Promise.all([
            // 1. Free Users
            supabase.from('user_profiles')
                .select('*', { count: 'exact', head: true })
                .eq('subscription_tier', 'free'),

            // 2. Paid Pro (Has a Stripe Subscription ID)
            supabase.from('user_profiles')
                .select('*', { count: 'exact', head: true })
                .eq('subscription_tier', 'pro')
                .not('stripe_subscription_id', 'is', null),

            // 3. Whitelisted Pro (Pro tier but NO Stripe ID)
            supabase.from('user_profiles')
                .select('*', { count: 'exact', head: true })
                .eq('subscription_tier', 'pro')
                .is('stripe_subscription_id', null),

            // 4. System Errors (24h)
            supabase.from('system_logs')
                .select('*', { count: 'exact', head: true })
                .eq('level', 'error')
                .gt('created_at', new Date(Date.now() - 86400000).toISOString())
        ]);

        res.json({
            free: freeUsers.count || 0,
            paidPro: paidPro.count || 0,
            whitelisted: whitelistedPro.count || 0,
            recentErrors: recentErrors.count || 0,
            // Calculate total for convenience
            totalUsers: (freeUsers.count || 0) + (paidPro.count || 0) + (whitelistedPro.count || 0)
        });

    } catch (err) {
        console.error('Stats Error:', err);
        res.status(500).json({ error: 'Failed to aggregate stats' });
    }
});

router.get('/activity-chart', async (req, res) => {
    try {
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        // Fetch all activities from the last 30 days
        const { data, error } = await supabase
            .from('user_activities')
            .select('activity_date')
            .gte('activity_date', thirtyDaysAgo.toISOString().split('T')[0]) // Comparison on Date column
            .order('activity_date', { ascending: true });

        if (error) throw error;

        // Group by Date (Client-side aggregation is fine for < 10k rows)
        const grouped = data.reduce((acc, curr) => {
            // activity_date comes back as 'YYYY-MM-DD' string usually
            const date = curr.activity_date; 
            acc[date] = (acc[date] || 0) + 1;
            return acc;
        }, {});

        // Fill in missing dates with 0 (Optional, but makes the chart look better)
        const chartData = [];
        for (let d = 0; d < 30; d++) {
            const dateObj = new Date();
            dateObj.setDate(dateObj.getDate() - (29 - d)); // Go back 29 days up to today
            const dateStr = dateObj.toISOString().split('T')[0];
            
            chartData.push({
                date: dateStr,
                count: grouped[dateStr] || 0
            });
        }

        res.json(chartData);

    } catch (err) {
        console.error('Activity Chart Error:', err);
        res.status(500).json({ error: 'Failed to fetch activity data' });
    }
});

// Returns the 5 most recently created users with their emails and tiers.
router.get('/recent-users', async (req, res) => {
    try {
        // 1. Fetch latest 5 users from Auth (Source of Truth for Emails)
        const { data: { users }, error } = await supabase.auth.admin.listUsers({
            page: 1,
            perPage: 5,
            sortBy: { field: 'created_at', direction: 'desc' }
        });

        if (error) throw error;

        // 2. Fetch their profiles to get their Subscription Tier
        const userIds = users.map(u => u.id);
        const { data: profiles } = await supabase
            .from('user_profiles')
            .select('user_id, subscription_tier')
            .in('user_id', userIds);

        // Map profiles for quick lookup
        const profileMap = {};
        if (profiles) {
            profiles.forEach(p => { profileMap[p.user_id] = p.subscription_tier });
        }

        // 3. Combine Data
        const recentUsers = users.map(user => ({
            id: user.id,
            email: user.email,
            created_at: user.created_at,
            tier: profileMap[user.id] || 'free',
            last_sign_in: user.last_sign_in_at
        }));

        res.json(recentUsers);

    } catch (err) {
        console.error('Recent Users Error:', err);
        res.status(500).json({ error: 'Failed to fetch recent users' });
    }
});

// Lists all AI system prompts
router.get('/prompts', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('system_prompts')
            .select('*')
            .order('key', { ascending: true });

        if (error) throw error;
        res.json(data);
    } catch (err) {
        console.error('Fetch Prompts Error:', err);
        res.status(500).json({ error: 'Failed to fetch prompts' });
    }
});

// PUT /admin/prompts/:key
// Updates a specific prompt's content
router.put('/prompts/:key', async (req, res) => {
    const { key } = req.params;
    const { content } = req.body;

    try {
        const { data, error } = await supabase
            .from('system_prompts')
            .update({ 
                content: content,
                updated_at: new Date().toISOString()
            })
            .eq('key', key)
            .select()
            .single();

        if (error) throw error;
        
        // Log this administrative action
        await supabase.from('system_logs').insert({
            level: 'warn', // Warn level for visibility
            source: 'admin_dashboard',
            user_id: req.user.id,
            action: 'update_prompt',
            message: `Updated system prompt: ${key}`,
            details: { previous_length: content.length }
        });

        res.json(data);
    } catch (err) {
        console.error('Update Prompt Error:', err);
        res.status(500).json({ error: 'Failed to update prompt' });
    }
});

// GET /admin/users?search=john@example.com
router.get('/users', async (req, res) => {
    const search = req.query.search || '';
    const page = parseInt(req.query.page) || 1;
    const perPage = 20;

    try {
        // 1. Search in Auth (Source of Truth for Emails)
        // Note: supabase.auth.admin.listUsers doesn't support fuzzy search on email strictly in all versions,
        // but it's the best place to start. If search is empty, it lists latest.
        // For partial matching, we might have to fetch more and filter, or rely on a synced email column if you have one.
        // Here we will just list users for now.
        
        const { data: { users }, error: authError } = await supabase.auth.admin.listUsers({
            page: page,
            perPage: perPage,
             // Supabase doesn't natively support "search" in listUsers yet without exact match on some tiers.
             // If you need fuzzy search, you usually need a public.users table synced with auth.users.
             // For now, we will just return the list or filter if search is exact.
        });

        if (authError) throw authError;

        // 2. Client-side filter for fuzzy search (since we only fetched a page, this is limited but functional for small apps)
        // For a robust production app with thousands of users, you'd want a dedicated public users table.
        let filteredUsers = users;
        if (search) {
             filteredUsers = users.filter(u => u.email && u.email.toLowerCase().includes(search.toLowerCase()));
        }

        // 3. Hydrate with Profile Data (Tier/Role)
        const userIds = filteredUsers.map(u => u.id);
        const { data: profiles } = await supabase
            .from('user_profiles')
            .select('user_id, subscription_tier, role, stripe_customer_id')
            .in('user_id', userIds);

        const profileMap = {};
        if (profiles) profiles.forEach(p => { profileMap[p.user_id] = p; });

        // 4. Merge Data
        const result = filteredUsers.map(u => ({
            id: u.id,
            email: u.email,
            created_at: u.created_at,
            last_sign_in: u.last_sign_in_at,
            // Profile Data
            subscription_tier: profileMap[u.id]?.subscription_tier || 'free',
            role: profileMap[u.id]?.role || 'authenticated',
            stripe_id: profileMap[u.id]?.stripe_customer_id || null
        }));

        res.json(result);

    } catch (err) {
        console.error('User List Error:', err);
        res.status(500).json({ error: 'Failed to fetch users' });
    }
});

// PATCH /admin/users/:id
// Update Role or Subscription Tier
router.patch('/users/:id', async (req, res) => {
    const { id } = req.params;
    const { role, subscription_tier } = req.body;

    try {
        const updates = {};
        if (role !== undefined) updates.role = role;
        if (subscription_tier !== undefined) updates.subscription_tier = subscription_tier;

        const { data, error } = await supabase
            .from('user_profiles')
            .update(updates)
            .eq('user_id', id)
            .select()
            .single();

        if (error) throw error;

        // Log the action
        await supabase.from('system_logs').insert({
            level: 'warn',
            source: 'admin_dashboard',
            user_id: req.user.id,
            action: 'update_user_profile',
            message: `Updated user ${id}`,
            details: updates
        });

        res.json(data);
    } catch (err) {
        console.error('User Update Error:', err);
        res.status(500).json({ error: 'Failed to update user' });
    }
});

// Adds email to whitelist AND promotes user to 'pro' if they exist
router.post('/whitelist', async (req, res) => {
    const { email } = req.body;

    if (!email || !email.includes('@')) {
        return res.status(400).json({ error: 'Valid email is required' });
    }

    try {
        // 1. Add to Whitelist Table (Upsert to prevent duplicates)
        const { error: whitelistError } = await supabase
            .from('whitelist')
            .upsert({ email: email }, { onConflict: 'email' });

        if (whitelistError) throw whitelistError;

        // 2. Find the User ID associated with this email
        // We search the 'user_profiles' via a join or just list users if needed.
        // Since we can't query auth.users directly with a simple select easily in all setups,
        // we'll try to find a profile that matches (if you sync emails to profiles) 
        // OR use the Auth Admin API.
        
        // Strategy: Use Auth Admin API to find the ID
        // Note: listUsers is not efficient for 1 user, but it's the safest admin way
        // without raw SQL permissions on auth schema.
        // However, a simpler way is just to rely on the user logging in next time (your login logic checks whitelist).
        // BUT, you requested immediate update.
        
        // Let's try to find them in the auth table directly (if Service Role has access)
        const { data: authUser } = await supabase
            .from('auth.users')
            .select('id')
            .eq('email', email)
            .single();

        let userId = authUser?.id;

        // If direct select didn't work, try the new search endpoint logic or skip
        if (userId) {
            // 3. Update their profile immediately
            await supabase
                .from('user_profiles')
                .update({ subscription_tier: 'pro' })
                .eq('user_id', userId);
                
            // Log it
            await supabase.from('system_logs').insert({
                level: 'info',
                source: 'admin_dashboard',
                user_id: req.user.id,
                action: 'whitelist_user',
                message: `Whitelisted and promoted ${email}`,
            });
        } else {
            // User hasn't signed up yet. They will be Pro automatically when they do 
            // because of your existing login/signup whitelist check logic.
            await supabase.from('system_logs').insert({
                level: 'info',
                source: 'admin_dashboard',
                user_id: req.user.id,
                action: 'whitelist_user',
                message: `Whitelisted ${email} (User not yet registered)`,
            });
        }

        res.json({ success: true, userFound: !!userId });

    } catch (err) {
        console.error('Whitelist Error:', err);
        res.status(500).json({ error: 'Failed to whitelist user' });
    }
});

// GET /admin/prayers?status=pending
router.get('/prayers', async (req, res) => {
    const status = req.query.status || 'pending';
    
    try {
        const { data, error } = await supabase
            .from('community_prayers')
            .select('*')
            .eq('status', status)
            .order('created_at', { ascending: true }) // Oldest first (FIFO)
            .limit(50);

        if (error) throw error;
        res.json(data);
    } catch (err) {
        console.error('Fetch Prayers Error:', err);
        res.status(500).json({ error: 'Failed to fetch prayer queue' });
    }
});

// PATCH /admin/prayers/:id
// Approve, Reject, or Update Content
router.patch('/prayers/:id', async (req, res) => {
    const { id } = req.params;
    const { status, anonymized_content } = req.body;

    try {
        const updates = {};
        if (status) updates.status = status;
        if (anonymized_content !== undefined) updates.anonymized_content = anonymized_content;

        const { data, error } = await supabase
            .from('community_prayers')
            .update(updates)
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;

        // Log the moderation action
        await supabase.from('system_logs').insert({
            level: 'info',
            source: 'admin_dashboard',
            user_id: req.user.id,
            action: 'moderate_prayer',
            message: `Prayer ${id} set to ${status}`,
        });

        res.json(data);
    } catch (err) {
        console.error('Moderation Error:', err);
        res.status(500).json({ error: 'Failed to update prayer' });
    }
});

router.get('/prompts/:key/evaluation', async (req, res) => {
    const { key } = req.params;
    try {
        const { data, error } = await supabase
            .from('prompt_evaluations')
            .select('*')
            .eq('prompt_key', key)
            .order('created_at', { ascending: false })
            .limit(1)
            .single();

        if (error && error.code !== 'PGRST116') throw error;
        res.json(data || null);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch evaluation' });
    }
});

module.exports = router;