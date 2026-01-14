const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const authenticateUser = require('../middleware/auth');
const { logEvent } = require('../utils/helpers');

// Search articles by relevance: title > body > synopsis
router.get('/search', authenticateUser, async (req, res) => {
    try {
        const q = (req.query.q || '').trim();
        const limit = Math.min(parseInt(req.query.limit || '50', 10) || 50, 200);
        console.log('Search query:', q, 'Limit:', limit);
        if (!q) {
            return res.status(400).json({ error: 'Query parameter `q` is required.' });
        }

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
            const totalScore = titleScore + bodyScore + synopsisScore;
            return { ...row, _score: totalScore };
        })
            .filter(r => r._score > 0)
            .sort((a, b) => {
                if (b._score !== a._score) return b._score - a._score;
                const ad = a.publish_date ? new Date(a.publish_date).getTime() : 0;
                const bd = b.publish_date ? new Date(b.publish_date).getTime() : 0;
                return bd - ad;
            });

        return res.json({ query: q, count: ranked.length, results: ranked });
    } catch (err) {
        console.error('Search endpoint error:', err);
        return res.status(500).json({ error: 'Unexpected error during search.' });
    }
});

// New: Endpoint to fetch all canonical categories
router.get('/categories', async (req, res) => {
    try {
        const days = 7;
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);
        const isoDate = startDate.toISOString();

        // 1. Get all categories
        const { data: cats, error: catError } = await supabase.from('categories').select('*');
        if (catError) throw catError;

        // 2. Get recent counts by joining with scriptural_outlooks date
        const { data: counts, error: countErr } = await supabase
            .from('outlook_categories')
            .select('category_id, scriptural_outlooks!inner(created_at)')
            .gte('scriptural_outlooks.created_at', isoDate);

        if (countErr) throw countErr;

        // Aggregate counts in JS
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

//New: Endpoint to fetch category by ID
router.get('/categories/:id', authenticateUser, async (req, res) => {
    const { id } = req.params;
    console.log('Fetching category with ID:', id);
    try {
        const isNumeric = /^\d+$/.test(id);
        const { data, error } = await supabase
            .from('categories')
            .select('*')
        [isNumeric ? 'eq' : 'eq'](isNumeric ? 'id' : 'slug', id)
            .single();

        if (error) {
            console.error('Error fetching category:', error);
            return res.status(404).json({ error: 'Category not found' });
        }
        console.log('Fetched category data:', data);
        res.json(data);
    } catch (error) {
        console.error('Server error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
// New: Endpoint to fetch all canonical topics
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


//New: Endpoint to fetch topic by ID
router.get('/topics/:id', authenticateUser, async (req, res) => {
    const { id } = req.params;
    console.log('Fetching topic with ID:', id);
    try {
        const isNumeric = /^\d+$/.test(id);
        const { data, error } = await supabase
            .from('topics')
            .select('*')
        [isNumeric ? 'eq' : 'eq'](isNumeric ? 'id' : 'slug', id)
            .single();
        if (error) {
            console.error('Error fetching topic:', error);
            return res.status(404).json({ error: 'Topic not found' });
        }
        res.json(data);
    } catch (error) {
        console.error('Server error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }


});
// --- GET Single Scriptural Outlook by ID ---
router.get('/scriptural-outlooks/:id', authenticateUser, async (req, res) => {
    const { id } = req.params;
    console.log('Fetching scriptural outlook with ID:', id);
    try {
        const isNumeric = /^\d+$/.test(id);
        const { data, error } = await supabase
            .from('scriptural_outlooks')
            .select('*')
        [isNumeric ? 'eq' : 'eq'](isNumeric ? 'id' : 'slug', id)
            .single();

        if (error) {
            console.error('Error fetching article:', error);
            return res.status(404).json({ error: 'Article not found' });
        }

        res.json(data);
    } catch (error) {
        console.error('Server error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

//Endpoint to get news articles from scriptural_outlooks table of database
router.get('/scriptural-outlooks', authenticateUser, async (req, res) => {
    //receive params for page and limit
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;
    const topic_id = req.query.topic_id;
    const category_id = req.query.category_id;
    const category_ids = req.query.category_ids; // comma separated list
    const topic_slug = req.query.topic_slug;
    const category_slug = req.query.category_slug;
    const topic = req.query.topic; // can be id or slug
    const category = req.query.category; // can be id or slug

    const hasTopicFilter = Boolean(topic_id || topic_slug || topic);
    const hasCategoryFilter = Boolean(category_id || category_slug || category);
    const topicIsNumeric = topic && /^\d+$/.test(topic);
    const categoryIsNumeric = category && /^\d+$/.test(category);

    try {
        const startTime = Date.now();
        // Construct the select query dynamically based on filters
        // If filtering by a relation, we must use !inner to filter the parent rows
        let outlookTopicsSelect = 'outlook_topics ( topic_id, topics (id, slug, name, description) )';
        let outlookCategoriesSelect = 'outlook_categories ( category_id, categories (id, slug, name, description) )';

        if (hasTopicFilter) {
            outlookTopicsSelect = 'outlook_topics!inner ( topic_id, topics (id, slug, name, description) )';
        }
        if (hasCategoryFilter) {
            outlookCategoriesSelect = 'outlook_categories!inner ( category_id, categories (id, slug, name, description) )';
        }

        const selectQuery = `*, ${outlookCategoriesSelect}, ${outlookTopicsSelect}`;

        let query = supabase
            .from('scriptural_outlooks')
            .select(selectQuery)
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1);

        if (topic_id) {
            if (/^\d+$/.test(topic_id)) {
                query = query.eq('outlook_topics.topic_id', topic_id);
            } else {
                // If a non-numeric topic_id is passed, treat it like a slug
                query = query.eq('outlook_topics.topics.slug', topic_id);
            }
        } else if (topic_slug) {
            query = query.eq('outlook_topics.topics.slug', topic_slug);
        } else if (topic) {
            query = topicIsNumeric
                ? query.eq('outlook_topics.topic_id', topic)
                : query.eq('outlook_topics.topics.slug', topic);
        }
        if (category_id) {
            if (/^\d+$/.test(category_id)) {
                query = query.eq('outlook_categories.category_id', category_id);
            } else {
                // If a non-numeric category_id is passed, treat it like a slug
                query = query.eq('outlook_categories.categories.slug', category_id);
            }
        } else if (category_slug) {
            query = query.eq('outlook_categories.categories.slug', category_slug);
        } else if (category) {
            query = categoryIsNumeric
                ? query.eq('outlook_categories.category_id', category)
                : query.eq('outlook_categories.categories.slug', category);
        } else if (category_ids) {
            const ids = category_ids.split(','); // Expecting "1,2,3"
            query = query.in('category_id', ids);
        }


        const { data, error } = await query;

        if (error) {
            console.error('Error fetching scriptural outlooks:', error);
            return res.status(500).json({ error: 'Failed to fetch scriptural outlooks.' });
        }

        // Map the results to a cleaner format for the frontend
        const cleanedData = data.map(outlook => {
            return {
                ...outlook,
                // Restructure categories array to just include category data
                categories: outlook.outlook_categories ? outlook.outlook_categories.map(oc => oc.categories) : [],
                // Restructure topics array to just include topic data
                topics: outlook.outlook_topics ? outlook.outlook_topics.map(ot => ot.topics) : [],
                // Remove the intermediary join table properties for cleanliness
                outlook_categories: undefined,
                outlook_topics: undefined,
            };
        });
        const duration = Date.now() - startTime;
        logEvent('info', 'backend', req.user.id, 'fetch_scriptural_outlooks', 'Fetched scriptural outlooks', { page, limit, topic_id, category_id }, duration);
        res.json(cleanedData);
    } catch (error) {
        console.error('Unhandled error in /scriptural-outlooks:', error);
        logEvent('error', 'backend', req.user.id, 'fetch_scriptural_outlooks', 'Error fetching scriptural outlooks', { error: error.message }, Date.now() - startTime);
        res.status(500).json({ error: 'An unexpected error occurred.' });
    }
});

// Fetch daily news synopses with optional limit and ordering, with optional query parameters for date range
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
            .gte(startDate ? 'created_at' : 'created_at', startDate || '1970-01-01')
            .lte(endDate ? 'created_at' : 'created_at', endDate || new Date().toISOString())
            .order('created_at', { ascending: order === 'asc' })
            .limit(limit);

        if (error) {
            console.error('Error fetching daily news synopses:', error);
            logEvent('error', 'backend', null, 'daily_news_synopses', 'Failed to fetch daily news synopses', { error: error.message }, Date.now() - startTime);
            return res.status(500).json({ error: 'Failed to fetch daily news synopses.' });
        }
        logEvent('info', 'backend', null, 'daily_news_synopses', 'Successfully fetched daily news synopses', {}, Date.now() - startTime);
        return res.json(data);
    } catch (err) {
        console.error('Unhandled error in /daily-news-synopses:', err);
        return res.status(500).json({ error: 'An unexpected error occurred.' });
    }
});

module.exports = router;
