const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const supabase = require('../config/supabase');
const authenticateUser = require('../middleware/auth');
const optionalAuth = require('../middleware/optionalAuth');
const { logEvent } = require('../utils/helpers');
const rateLimit = require('express-rate-limit');
const { publicAssessment } = require('../utils/newsVerification');

const correctionLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 5, standardHeaders: true, legacyHeaders: false });

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
                impactScoreWeek: 0
            };
        }

        map[taxonomyId].recentArticleCount += 1;
        map[taxonomyId].impactScoreWeek += impactScore;
    });

    return map;
}

async function hydrateOutlookTaxonomies(outlooks) {
    if (!outlooks.length) return outlooks;
    const ids = outlooks.map((outlook) => outlook.id);
    const [categoryResult, topicResult] = await Promise.all([
        supabase
            .from('outlook_categories')
            .select('outlook_id, categories (id, slug, name, description)')
            .in('outlook_id', ids),
        supabase
            .from('outlook_topics')
            .select('outlook_id, topics (id, slug, name, description)')
            .in('outlook_id', ids),
    ]);
    if (categoryResult.error) throw categoryResult.error;
    if (topicResult.error) throw topicResult.error;

    const categoriesByOutlook = new Map();
    for (const relation of categoryResult.data || []) {
        if (!relation.categories) continue;
        const values = categoriesByOutlook.get(relation.outlook_id) || [];
        values.push(relation.categories);
        categoriesByOutlook.set(relation.outlook_id, values);
    }
    const topicsByOutlook = new Map();
    for (const relation of topicResult.data || []) {
        if (!relation.topics) continue;
        const values = topicsByOutlook.get(relation.outlook_id) || [];
        values.push(relation.topics);
        topicsByOutlook.set(relation.outlook_id, values);
    }

    return outlooks.map((outlook) => ({
        ...outlook,
        categories: categoriesByOutlook.get(outlook.id) || [],
        topics: topicsByOutlook.get(outlook.id) || [],
    }));
}

async function resolveFilteredOutlookIds({ resolvedTopicId, resolvedCategoryId, categoryIds }) {
    const lookups = [];
    if (resolvedTopicId) {
        lookups.push(
            supabase.from('outlook_topics').select('outlook_id').eq('topic_id', resolvedTopicId).limit(1000),
        );
    }
    const requestedCategoryIds = resolvedCategoryId ? [resolvedCategoryId] : categoryIds;
    if (requestedCategoryIds.length) {
        lookups.push(
            supabase.from('outlook_categories').select('outlook_id').in('category_id', requestedCategoryIds).limit(1000),
        );
    }
    if (!lookups.length) return null;

    const results = await Promise.all(lookups);
    for (const result of results) if (result.error) throw result.error;
    const idSets = results.map((result) => new Set((result.data || []).map((row) => row.outlook_id)));
    return [...idSets[0]].filter((id) => idSets.every((values) => values.has(id)));
}

async function hydratePublicVerification(outlook) {
    const [scores, claims, sources, notices, reviews] = await Promise.all([
        supabase.from('news_score_versions').select('version,truthfulness_score,truthfulness_band,assessment_summary,assessed_at,confidence_score').eq('outlook_id', outlook.id).order('version', { ascending: false }).limit(1),
        supabase.from('news_claims').select('id,claim_text,materiality,status,rationale').eq('outlook_id', outlook.id).order('materiality', { ascending: false }),
        supabase.from('news_article_sources').select('id,publisher,title,url,published_at,source_type,is_independent').eq('outlook_id', outlook.id).order('created_at'),
        supabase.from('news_correction_notices').select('id,notice,published_at').eq('outlook_id', outlook.id).order('published_at'),
        supabase.from('news_review_decisions').select('decision,reviewer_display_name,created_at').eq('outlook_id', outlook.id).eq('decision', 'approved').order('created_at', { ascending: false }).limit(1),
    ]);
    const results = [scores, claims, sources, notices, reviews];
    if (results.some((result) => result.error?.code === '42P01' || result.error?.code === 'PGRST205')) return outlook;
    for (const result of results) if (result.error) throw result.error;
    const review = reviews.data?.[0];
    const hasHighAutomatedConfidence = (scores.data?.[0]?.confidence_score ?? 0) >= 90;
    return {
        ...outlook,
        verification: publicAssessment(scores.data?.[0], claims.data, sources.data, notices.data),
        editorialStatus: review ? 'reviewed' : hasHighAutomatedConfidence ? 'automated_high_confidence' : 'pending_human_review',
        reviewedBy: review?.reviewer_display_name || null,
        reviewedAt: review?.created_at || null,
    };
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

// --- 2. GET ALL CATEGORIES (SORTED BY WEEKLY IMPACT) ---
router.get('/categories', async (req, res) => {
    try {
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - 7);
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
            impact_score_week: activityMap[c.id]?.impactScoreWeek || 0,
            impact_score_24h: activityMap[c.id]?.impactScoreWeek || 0
        })).sort((a, b) => {
            if (b.impact_score_week !== a.impact_score_week) return b.impact_score_week - a.impact_score_week;
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

router.post('/news/corrections', correctionLimiter, async (req, res) => {
    try {
        if (String(req.body.website || '').trim()) return res.status(202).json({ receiptId: crypto.randomUUID() });
        const articleUrl = String(req.body.articleUrl || '').trim();
        const disputedStatement = String(req.body.disputedStatement || '').trim();
        const explanation = String(req.body.explanation || '').trim();
        const evidenceUrl = String(req.body.evidenceUrl || '').trim() || null;
        const replyEmail = String(req.body.replyEmail || '').trim() || null;
        if (!/^https?:\/\//i.test(articleUrl) || disputedStatement.length < 10 || disputedStatement.length > 2000 || explanation.length < 20 || explanation.length > 5000) {
            return res.status(400).json({ error: { code: 'CORRECTION_INVALID', message: 'Provide a valid article URL, disputed statement, and explanation.', requestId: req.requestId } });
        }
        if (evidenceUrl && !/^https?:\/\//i.test(evidenceUrl)) return res.status(400).json({ error: { code: 'EVIDENCE_URL_INVALID', message: 'Evidence URL must use HTTP or HTTPS.', requestId: req.requestId } });
        if (replyEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(replyEmail)) return res.status(400).json({ error: { code: 'EMAIL_INVALID', message: 'Reply email is invalid.', requestId: req.requestId } });
        let { data: outlook } = await supabase.from('scriptural_outlooks').select('id').eq('article_url', articleUrl).maybeSingle();
        if (!outlook) {
            const slug = articleUrl.split('/').filter(Boolean).pop();
            if (slug) ({ data: outlook } = await supabase.from('scriptural_outlooks').select('id').eq('slug', slug).maybeSingle());
        }
        const { data, error } = await supabase.from('news_correction_reports').insert({ outlook_id: outlook?.id || null, article_url: articleUrl, disputed_statement: disputedStatement, explanation, evidence_url: evidenceUrl, reply_email: replyEmail }).select('id').single();
        if (error) throw error;
        await logEvent('info', 'news', null, 'submit_news_correction', 'Correction report submitted', { outlookId: outlook?.id || null });
        return res.status(201).json({ receiptId: data.id });
    } catch (error) {
        console.error('Correction submission failed:', error);
        return res.status(500).json({ error: { code: 'CORRECTION_FAILED', message: 'The correction report could not be submitted.', requestId: req.requestId } });
    }
});

// --- 4. GET ALL TOPICS (SORTED BY WEEKLY IMPACT) ---
router.get('/topics', async (req, res) => {
    try {
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - 7);
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
            impact_score_week: activityMap[t.id]?.impactScoreWeek || 0,
            impact_score_24h: activityMap[t.id]?.impactScoreWeek || 0
        })).sort((a, b) => {
            if (b.impact_score_week !== a.impact_score_week) return b.impact_score_week - a.impact_score_week;
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
        res.json(await hydratePublicVerification(data));
    } catch (error) {
        console.error('Server error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// --- 7. GET ALL SCRIPTURAL OUTLOOKS (LIST/FEED VIEW) ---
// HIGHLY OPTIMIZED: Uses targeted selects, explicit dates, and prevents full table scans on inner joins.
router.get('/scriptural-outlooks', optionalAuth, async (req, res) => {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 10));
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
    const categoryIds = String(category_ids || '')
        .split(',')
        .map((value) => value.trim())
        .filter((value) => /^\d+$/.test(value));

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
        
        // Resolve relationship IDs before the feed query and hydrate details
        // only for the final page. This avoids the nested PostgREST join that
        // repeatedly exceeded the production statement timeout.
        const filteredOutlookIds = await resolveFilteredOutlookIds({
            resolvedTopicId,
            resolvedCategoryId,
            categoryIds,
        });
        if (filteredOutlookIds && !filteredOutlookIds.length) return res.json([]);
        const baseColumns = NEWS_LIST_COLUMNS;
        const selectQuery = baseColumns;
        const sort = String(req.query.sort || req.query.orderBy || 'latest').toLowerCase();

        const useWeightedSort = sort === 'weighted' || sort === 'balanced';
        const weightedCandidateLimit = Math.min(Math.max(limit * Math.max(page, 1) * 6, 120), 500);

        let query = supabase
            .from('scriptural_outlooks')
            .select(selectQuery);

        if (filteredOutlookIds) query = query.in('id', filteredOutlookIds);

        if (useWeightedSort) {
            query = query
                .not('news_impact_score', 'is', null)
                .order('publish_date', { ascending: false, nullsFirst: false })
                .order('created_at', { ascending: false })
                .limit(weightedCandidateLimit);
        } else if (sort === 'impact' || sort === 'featured') {
            query = query
                .order('news_impact_score', { ascending: false, nullsFirst: false })
                .order('publish_date', { ascending: false, nullsFirst: false })
                .order('created_at', { ascending: false })
                .range(offset, offset + limit - 1);
        } else {
            query = query
                .order('publish_date', { ascending: false, nullsFirst: false })
                .order('created_at', { ascending: false })
                .range(offset, offset + limit - 1);
        }

        // Apply Date Filters
        if (startDate) query = query.gte('created_at', startDate);
        if (endDate) query = query.lte('created_at', endDate);

        const { data, error } = await query;

        if (error) throw error;

        let cleanedData = (data || []).map(({ outlook_categories, outlook_topics, ...outlook }) => outlook);

        if (useWeightedSort) {
            cleanedData = cleanedData
                .map(outlook => ({ ...outlook, weighted_score: getWeightedNewsScore(outlook) }))
                .sort((a, b) => {
                    if (b.weighted_score !== a.weighted_score) return b.weighted_score - a.weighted_score;
                    return new Date(b.publish_date || b.created_at).getTime() - new Date(a.publish_date || a.created_at).getTime();
                })
                .slice(offset, offset + limit);
        }

        cleanedData = await hydrateOutlookTaxonomies(cleanedData);
        
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
