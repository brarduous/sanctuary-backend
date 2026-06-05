const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const authenticateUser = require('../middleware/auth');
const optionalAuth = require('../middleware/optionalAuth');
const { logEvent } = require('../utils/helpers');

const NEWS_LIST_COLUMNS = [
    'id',
    'article_title',
    'article_url',
    'article_thumbnail_url',
    'created_at',
    'publish_date',
    'slug',
    'ai_outlook',
    'news_impact_score',
    'news_impact_summary'
].join(', ');

function getWeightedNewsScore(outlook) {
    const impactScore = Number(outlook.news_impact_score) || 0;
    const articleTime = new Date(outlook.publish_date || outlook.created_at).getTime();
    const ageHours = Number.isFinite(articleTime) ? (Date.now() - articleTime) / (1000 * 60 * 60) : 24;
    const recencyScore = Math.max(0, 100 - ((Math.max(0, ageHours) / 24) * 100));
    return (impactScore * 0.7) + (recencyScore * 0.3);
}

async function resolveTaxonomyId(tableName, value) {
    if (!value) return null;
    if (/^\d+$/.test(String(value))) return value;

    const { data, error } = await supabase
        .from(tableName)
        .select('id')
        .eq('slug', value)
        .single();

    if (error || !data) return null;
    return data.id;
}

function buildTaxonomyImpactMap(rows, taxonomyIdField) {
    const map = {};
    (rows || []).forEach((row) => {
        const taxonomyId = row[taxonomyIdField];
        if (!taxonomyId) return;

        const outlook = row.scriptural_outlooks;
        const impactScore = Number(outlook?.news_impact_score) || 0;
        if (!map[taxonomyId]) {
            map[taxonomyId] = {
                recentArticleCount: 0,
                impactScore24h: 0
            };
        }

        map[taxonomyId].recentArticleCount += 1;
        map[taxonomyId].impactScore24h += impactScore;
    });

    return map;
}

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

// --- 2. GET ALL CATEGORIES (SORTED BY 24H IMPACT) ---
router.get('/categories', async (req, res) => {
    try {
        const startDate = new Date();
        startDate.setHours(startDate.getHours() - 24);
        const isoDate = startDate.toISOString();

        const { data: cats, error: catError } = await supabase.from('categories').select('*');
        if (catError) throw catError;

        const { data: impactRows, error: impactErr } = await supabase
            .from('outlook_categories')
            .select('category_id, scriptural_outlooks!inner(created_at, news_impact_score)')
            .gte('scriptural_outlooks.created_at', isoDate);

        if (impactErr) throw impactErr;

        const activityMap = buildTaxonomyImpactMap(impactRows, 'category_id');

        const result = cats.map(c => ({
            ...c,
            recent_article_count: activityMap[c.id]?.recentArticleCount || 0,
            impact_score_24h: activityMap[c.id]?.impactScore24h || 0
        })).sort((a, b) => {
            if (b.impact_score_24h !== a.impact_score_24h) return b.impact_score_24h - a.impact_score_24h;
            if (b.recent_article_count !== a.recent_article_count) return b.recent_article_count - a.recent_article_count;
            return String(a.name || '').localeCompare(String(b.name || ''));
        });

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

// --- 4. GET ALL TOPICS (SORTED BY 24H IMPACT) ---
router.get('/topics', async (req, res) => {
    try {
        const startDate = new Date();
        startDate.setHours(startDate.getHours() - 24);
        const isoDate = startDate.toISOString();

        const { data: topics, error: topError } = await supabase.from('topics').select('*');
        if (topError) throw topError;

        const { data: impactRows, error: impactErr } = await supabase
            .from('outlook_topics')
            .select('topic_id, scriptural_outlooks!inner(created_at, news_impact_score)')
            .gte('scriptural_outlooks.created_at', isoDate);

        if (impactErr) throw impactErr;

        const activityMap = buildTaxonomyImpactMap(impactRows, 'topic_id');

        const result = topics.map(t => ({
            ...t,
            recent_article_count: activityMap[t.id]?.recentArticleCount || 0,
            impact_score_24h: activityMap[t.id]?.impactScore24h || 0
        })).sort((a, b) => {
            if (b.impact_score_24h !== a.impact_score_24h) return b.impact_score_24h - a.impact_score_24h;
            if (b.recent_article_count !== a.recent_article_count) return b.recent_article_count - a.recent_article_count;
            return String(a.name || '').localeCompare(String(b.name || ''));
        });

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

    try {
        const startTime = Date.now();
        const resolvedTopicId = hasTopicFilter
            ? await resolveTaxonomyId('topics', topic_id || topic_slug || topic)
            : null;
        const resolvedCategoryId = hasCategoryFilter
            ? await resolveTaxonomyId('categories', category_id || category_slug || category)
            : null;

        if (hasTopicFilter && !resolvedTopicId) {
            return res.json([]);
        }
        if (hasCategoryFilter && !resolvedCategoryId) {
            return res.json([]);
        }
        
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
        const baseColumns = NEWS_LIST_COLUMNS;
        const selectQuery = `${baseColumns}, ${outlookCategoriesSelect}, ${outlookTopicsSelect}`;
        const sort = String(req.query.sort || req.query.orderBy || 'latest').toLowerCase();

        const useWeightedSort = sort === 'weighted' || sort === 'balanced';
        const weightedCandidateLimit = Math.min(Math.max(limit * Math.max(page, 1) * 6, 120), 500);

        let query = supabase
            .from('scriptural_outlooks')
            .select(selectQuery);

        if (useWeightedSort) {
            query = query
                .not('news_impact_score', 'is', null)
                .order('publish_date', { ascending: false, nullsFirst: false })
                .order('created_at', { ascending: false })
                .limit(weightedCandidateLimit);
        } else if (sort === 'impact' || sort === 'featured') {
            query = query
                .order('news_impact_score', { ascending: false, nullsFirst: false })
                .order('created_at', { ascending: false })
                .range(offset, offset + limit - 1);
        } else {
            query = query
                .order('created_at', { ascending: false })
                .range(offset, offset + limit - 1);
        }

        // Apply Date Filters
        if (startDate) query = query.gte('created_at', startDate);
        if (endDate) query = query.lte('created_at', endDate);

        // Apply Topic Filters
        if (resolvedTopicId) {
            query = query.eq('outlook_topics.topic_id', resolvedTopicId);
        }
        
        // Apply Category Filters
        if (resolvedCategoryId) {
            query = query.eq('outlook_categories.category_id', resolvedCategoryId);
        } else if (category_ids) {
            query = query.in('outlook_categories.category_id', category_ids.split(','));
        }

        const { data, error } = await query;

        if (error) throw error;

        // Clean up nested Supabase formatting
        let cleanedData = data.map(outlook => ({
            ...outlook,
            categories: outlook.outlook_categories ? outlook.outlook_categories.map(oc => oc.categories) : [],
            topics: outlook.outlook_topics ? outlook.outlook_topics.map(ot => ot.topics) : [],
            outlook_categories: undefined,
            outlook_topics: undefined,
        }));

        if (useWeightedSort) {
            cleanedData = cleanedData
                .map(outlook => ({ ...outlook, weighted_score: getWeightedNewsScore(outlook) }))
                .sort((a, b) => {
                    if (b.weighted_score !== a.weighted_score) return b.weighted_score - a.weighted_score;
                    return new Date(b.publish_date || b.created_at).getTime() - new Date(a.publish_date || a.created_at).getTime();
                })
                .slice(offset, offset + limit);
        }
        
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
