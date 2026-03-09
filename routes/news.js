const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const authenticateUser = require('../middleware/auth');
const optionalAuth = require('../middleware/optionalAuth');
const { logEvent } = require('../utils/helpers');

// --- 1. SEARCH ARTICLES ---
// Optimized: Fetches article_body for scoring, but strips it before sending to client to save bandwidth.
router.get('/search', optionalAuth, async (req, res) => {
    const startTime = Date.now();
    try {
        const q = (req.query.q || '').trim();
        const limit = Math.min(parseInt(req.query.limit || '50', 10) || 50, 200);
        console.log('Search query:', q, 'Limit:', limit);
        
        if (!q) return res.status(400).json({ error: 'Query parameter `q` is required.' });

        const pattern = `%${q}%`;
        const { data, error } = await supabase
            .from('scriptural_outlooks')
            .select('id, article_title, article_url, article_thumbnail_url, created_at, publish_date, slug, ai_outlook, article_body')
            .or(`article_title.ilike.${pattern},article_body.ilike.${pattern},ai_outlook->>synopsis.ilike.${pattern}`)
            .limit(limit);

        if (error) {
            console.error('Search query error:', error);
            return res.status(500).json({ error: 'Failed to search articles.' });
        }

        const term = q.toLowerCase();
        const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = new RegExp(escapeRegExp(term), 'g');
        const scoreFor = (text, weight) => {
            if (!text) return 0;
            const t = String(text).toLowerCase();
            const matches = t.match(re) || [];
            return matches.length * weight + (t.includes(term) ? weight : 0);
        };

        const ranked = (data || []).map((row) => {
            const synopsis = row.ai_outlook && row.ai_outlook.synopsis ? row.ai_outlook.synopsis : '';
            const titleScore = scoreFor(row.article_title, 6);
            const bodyScore = scoreFor(row.article_body, 3);
            const synopsisScore = scoreFor(synopsis, 2);
            
            // OPTIMIZATION: Delete the massive article_body before sending over the network
            delete row.article_body; 
            
            return { ...row, _score: (titleScore + bodyScore + synopsisScore) };
        })
        .filter(r => r._score > 0)
        .sort((a, b) => {
            if (b._score !== a._score) return b._score - a._score;
            const ad = a.publish_date ? new Date(a.publish_date).getTime() : 0;
            const bd = b.publish_date ? new Date(b.publish_date).getTime() : 0;
            return bd - ad;
        });

        logEvent('info', 'backend', req.user?.id ?? null, 'search_articles', `Searched for: ${q}`, { count: ranked.length }, Date.now() - startTime);
        return res.json({ query: q, count: ranked.length, results: ranked });
    } catch (err) {
        console.error('Search endpoint error:', err);
        return res.status(500).json({ error: 'Unexpected error during search.' });
    }
});

// --- 2. GET ALL CATEGORIES (WITH RECENT COUNTS) ---
router.get('/categories', async (req, res) => {
    try {
        const days = 7;
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);
        const isoDate = startDate.toISOString();

        const { data: cats, error: catError } = await supabase.from('categories').select('*');
        if (catError) throw catError;

        // Optimized: Only select what's needed for the count
        const { data: counts, error: countErr } = await supabase
            .from('outlook_categories')
            .select('category_id, scriptural_outlooks!inner(created_at)')
            .gte('scriptural_outlooks.created_at', isoDate);

        if (countErr) throw countErr;

        const activityMap = {};
        counts.forEach(c => {
            activityMap[c.category_id] = (activityMap[c.category_id] || 0) + 1;
        });

        const result = cats.map(c => ({
            ...c,
            recent_article_count: activityMap[c.id] || 0
        })).sort((a, b) => b.recent_article_count - a.recent_article_count);

        res.json(result);
    } catch (error) {
        console.error('Error in /categories:', error);
        res.status(500).json({ error: 'Failed to fetch categories.' });
    }
});

// --- 3. GET SINGLE CATEGORY ---
router.get('/categories/:id', optionalAuth, async (req, res) => {
    const { id } = req.params;
    try {
        const isNumeric = /^\d+$/.test(id);
        const { data, error } = await supabase
            .from('categories')
            .select('*')
            [isNumeric ? 'eq' : 'eq'](isNumeric ? 'id' : 'slug', id)
            .single();

        if (error) return res.status(404).json({ error: 'Category not found' });
        res.json(data);
    } catch (error) {
        console.error('Server error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// --- 4. GET ALL TOPICS (WITH RECENT COUNTS) ---
router.get('/topics', async (req, res) => {
    try {
        const days = 7;
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);
        const isoDate = startDate.toISOString();

        const { data: topics, error: topError } = await supabase.from('topics').select('*');
        if (topError) throw topError;

        const { data: counts, error: countErr } = await supabase
            .from('outlook_topics')
            .select('topic_id, scriptural_outlooks!inner(created_at)')
            .gte('scriptural_outlooks.created_at', isoDate);

        if (countErr) throw countErr;

        const activityMap = {};
        counts.forEach(t => {
            activityMap[t.topic_id] = (activityMap[t.topic_id] || 0) + 1;
        });

        const result = topics.map(t => ({
            ...t,
            recent_article_count: activityMap[t.id] || 0
        })).sort((a, b) => b.recent_article_count - a.recent_article_count);

        res.json(result);
    } catch (error) {
        console.error('Error in /topics:', error);
        res.status(500).json({ error: 'Failed to fetch topics.' });
    }
});

// --- 5. GET SINGLE TOPIC ---
router.get('/topics/:id', optionalAuth, async (req, res) => {
    const { id } = req.params;
    try {
        const isNumeric = /^\d+$/.test(id);
        const { data, error } = await supabase
            .from('topics')
            .select('*')
            [isNumeric ? 'eq' : 'eq'](isNumeric ? 'id' : 'slug', id)
            .single();
            
        if (error) return res.status(404).json({ error: 'Topic not found' });
        res.json(data);
    } catch (error) {
        console.error('Server error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// --- 6. GET SINGLE SCRIPTURAL OUTLOOK (FULL DETAIL) ---
// This is the ONLY route that should select '*' because it needs the full article_body
router.get('/scriptural-outlooks/:id', optionalAuth , async (req, res) => {
    const { id } = req.params;
    try {
        const isNumeric = /^\d+$/.test(id);
        const { data, error } = await supabase
            .from('scriptural_outlooks')
            .select('*')
            [isNumeric ? 'eq' : 'eq'](isNumeric ? 'id' : 'slug', id)
            .single();

        if (error) return res.status(404).json({ error: 'Article not found' });
        res.json(data);
    } catch (error) {
        console.error('Server error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// --- 7. GET ALL SCRIPTURAL OUTLOOKS (LIST/FEED VIEW) ---
// HIGHLY OPTIMIZED: Uses targeted selects, explicit dates, and prevents full table scans on inner joins.
router.get('/scriptural-outlooks', optionalAuth, async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;
    
    // Date Filters
    const startDate = req.query.startDate;
    const endDate = req.query.endDate;

    // Taxonomy Filters
    const topic_id = req.query.topic_id;
    const category_id = req.query.category_id;
    const category_ids = req.query.category_ids; 
    const topic_slug = req.query.topic_slug;
    const category_slug = req.query.category_slug;
    const topic = req.query.topic; 
    const category = req.query.category; 

    const hasTopicFilter = Boolean(topic_id || topic_slug || topic);
    const hasCategoryFilter = Boolean(category_id || category_slug || category);
    const topicIsNumeric = topic && /^\d+$/.test(topic);
    const categoryIsNumeric = category && /^\d+$/.test(category);

    try {
        const startTime = Date.now();
        
        // Dynamically build relationship queries based on whether we are filtering by them
        let outlookTopicsSelect = 'outlook_topics ( topic_id, topics (id, slug, name, description) )';
        let outlookCategoriesSelect = 'outlook_categories ( category_id, categories (id, slug, name, description) )';

        if (hasTopicFilter) {
            outlookTopicsSelect = 'outlook_topics!inner ( topic_id, topics (id, slug, name, description) )';
        }
        if (hasCategoryFilter) {
            outlookCategoriesSelect = 'outlook_categories!inner ( category_id, categories (id, slug, name, description) )';
        }

        // OPTIMIZATION: Explicitly exclude `article_body` from the list view
        const baseColumns = 'id, article_title, article_url, article_thumbnail_url, created_at, publish_date, slug, ai_outlook';
        const selectQuery = `${baseColumns}, ${outlookCategoriesSelect}, ${outlookTopicsSelect}`;

        let query = supabase
            .from('scriptural_outlooks')
            .select(selectQuery)
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1);

        // Apply Date Filters
        if (startDate) query = query.gte('created_at', startDate);
        if (endDate) query = query.lte('created_at', endDate);

        // Apply Topic Filters
        if (topic_id) {
            query = /^\d+$/.test(topic_id) 
                ? query.eq('outlook_topics.topic_id', topic_id) 
                : query.eq('outlook_topics.topics.slug', topic_id);
        } else if (topic_slug) {
            query = query.eq('outlook_topics.topics.slug', topic_slug);
        } else if (topic) {
            query = topicIsNumeric ? query.eq('outlook_topics.topic_id', topic) : query.eq('outlook_topics.topics.slug', topic);
        }
        
        // Apply Category Filters
        if (category_id) {
            query = /^\d+$/.test(category_id) 
                ? query.eq('outlook_categories.category_id', category_id) 
                : query.eq('outlook_categories.categories.slug', category_id);
        } else if (category_slug) {
            query = query.eq('outlook_categories.categories.slug', category_slug);
        } else if (category) {
            query = categoryIsNumeric ? query.eq('outlook_categories.category_id', category) : query.eq('outlook_categories.categories.slug', category);
        } else if (category_ids) {
            query = query.in('outlook_categories.category_id', category_ids.split(','));
        }

        const { data, error } = await query;

        if (error) throw error;

        // Clean up nested Supabase formatting
        const cleanedData = data.map(outlook => ({
            ...outlook,
            categories: outlook.outlook_categories ? outlook.outlook_categories.map(oc => oc.categories) : [],
            topics: outlook.outlook_topics ? outlook.outlook_topics.map(ot => ot.topics) : [],
            outlook_categories: undefined,
            outlook_topics: undefined,
        }));
        
        logEvent('info', 'backend', req.user?.id ?? null, 'fetch_scriptural_outlooks', 'Fetched outlooks list', { page, limit, hasTopicFilter, hasCategoryFilter }, Date.now() - startTime);
        res.json(cleanedData);
    } catch (error) {
        console.error('Unhandled error in /scriptural-outlooks:', error);
        res.status(500).json({ error: 'An unexpected error occurred.' });
    }
});

// --- 8. GET DAILY NEWS SYNOPSES ---
router.get('/daily-news-synopses', async (req, res) => {
    const startTime = Date.now();
    try {
        const limit = Math.min(parseInt(req.query.limit || '50', 10) || 50, 200);
        const startDate = req.query.startDate;
        const endDate = req.query.endDate;
        const order = (req.query.order || 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc';
        
        const { data, error } = await supabase
            .from('daily_news_synopses')
            .select('*')
            .gte('created_at', startDate || '1970-01-01')
            .lte('created_at', endDate || new Date().toISOString())
            .order('created_at', { ascending: order === 'asc' })
            .limit(limit);

        if (error) throw error;

        logEvent('info', 'backend', req.user?.id ?? null, 'daily_news_synopses', 'Fetched daily news', {}, Date.now() - startTime);
        return res.json(data);
    } catch (err) {
        console.error('Unhandled error in /daily-news-synopses:', err);
        return res.status(500).json({ error: 'An unexpected error occurred.' });
    }
});

module.exports = router;