const express = require('express');
const supabase = require('../config/supabase');
const authenticateUser = require('../middleware/auth');
const requireAdmin = require('../middleware/adminAuth');
const { logEvent } = require('../utils/helpers');
const { normalizeVerificationAssessment } = require('../utils/newsVerification');
const { refreshCluster } = require('../utils/newsClusters');

const router = express.Router();
router.use(authenticateUser, requireAdmin);

const EDITABLE_FIELDS = new Set(['newsSummary','sourceAndFramingAnalysis','biblicalReflection','citedPassages','faithfulResponse','congregationalImplications','ministryActions','sermonDiscussionPrompts','reflectionQuestions','closingPrayer','sources','additionalSourcesNeeded']);

function boundedLimit(value, fallback = 50) {
    return Math.min(100, Math.max(1, Number.parseInt(value, 10) || fallback));
}

router.get('/candidates', async (req, res, next) => {
    try {
        const limit = boundedLimit(req.query.limit);
        const status = String(req.query.status || 'awaiting_evidence');
        const allowedStatuses = new Set(['awaiting_evidence', 'eligible', 'generated', 'dismissed', 'all']);
        if (!allowedStatuses.has(status)) {
            return res.status(400).json({ error: { code: 'NEWS_CANDIDATE_STATUS_INVALID', message: 'Unknown candidate status.', requestId: req.requestId } });
        }
        let query = supabase
            .from('news_discovery_candidates')
            .select('id,canonical_url,title,publisher,published_at,thumbnail_url,discovery_provider,discovery_rank,discovery_match_score,evidence_status,evidence_reason,evidence_summary,source_package,first_discovered_at,last_discovered_at')
            .order('discovery_rank', { ascending: true, nullsFirst: false })
            .order('last_discovered_at', { ascending: false })
            .limit(limit);
        if (status !== 'all') query = query.eq('evidence_status', status);
        const { data, error } = await query;
        if (error) throw error;
        res.json(data || []);
    } catch (error) { next(error); }
});

router.get('/clusters', async (req, res, next) => {
    try {
        const limit = boundedLimit(req.query.limit);
        const { data, error } = await supabase.from('news_story_clusters').select('id,slug,title,canonical_outlook_id,status,first_reported_at,latest_reported_at,representative_image_url,source_comparison,timeline,content_version,clustering_metadata,updated_at').order('updated_at', { ascending: false }).limit(limit);
        if (error) throw error;
        res.json((data || []).map((cluster) => ({ ...cluster, sourceCount: Array.isArray(cluster.source_comparison) ? cluster.source_comparison.length : 0 })));
    } catch (error) { next(error); }
});

router.patch('/clusters/:id/image', async (req, res, next) => {
    try {
        const imageUrl = String(req.body.imageUrl || '').trim();
        if (!/^https:\/\//i.test(imageUrl)) return res.status(400).json({ error: { code: 'CLUSTER_IMAGE_INVALID', message: 'A secure image URL is required.', requestId: req.requestId } });
        const { data: cluster, error } = await supabase.from('news_story_clusters').update({ representative_image_url: imageUrl, updated_at: new Date().toISOString() }).eq('id', req.params.id).select('*').single();
        if (error) throw error;
        if (cluster.canonical_outlook_id) await supabase.from('scriptural_outlooks').update({ article_thumbnail_url: imageUrl }).eq('id', cluster.canonical_outlook_id);
        await logEvent('audit', 'news', req.user.id, 'news_cluster_image_changed', 'Story cluster representative image changed', { clusterId: cluster.id });
        res.json(cluster);
    } catch (error) { next(error); }
});

router.post('/clusters/:id/sources/:sourceId/move', async (req, res, next) => {
    try {
        const targetClusterId = String(req.body.targetClusterId || '');
        const { data: source, error } = await supabase.from('news_article_sources').update({ story_cluster_id: targetClusterId }).eq('id', req.params.sourceId).eq('story_cluster_id', req.params.id).select('*').single();
        if (error) throw error;
        const [fromCluster, toCluster] = await Promise.all([refreshCluster(req.params.id), refreshCluster(targetClusterId)]);
        await logEvent('audit', 'news', req.user.id, 'news_cluster_source_moved', 'Source moved between story clusters', { sourceId: source.id, fromClusterId: req.params.id, targetClusterId });
        res.json({ source, fromCluster, toCluster });
    } catch (error) { next(error); }
});

router.post('/clusters/:id/merge', async (req, res, next) => {
    try {
        const targetClusterId = String(req.body.targetClusterId || '');
        if (!targetClusterId || targetClusterId === req.params.id) return res.status(400).json({ error: { code: 'CLUSTER_MERGE_INVALID', message: 'Choose a different target cluster.', requestId: req.requestId } });
        const [sourceResult, targetResult] = await Promise.all([supabase.from('news_story_clusters').select('*').eq('id', req.params.id).single(), supabase.from('news_story_clusters').select('*').eq('id', targetClusterId).single()]);
        if (sourceResult.error || targetResult.error) throw sourceResult.error || targetResult.error;
        const targetCanonicalId = targetResult.data.canonical_outlook_id;
        await supabase.from('news_article_sources').update({ story_cluster_id: targetClusterId }).eq('story_cluster_id', req.params.id);
        await supabase.from('scriptural_outlooks').update({ story_cluster_id: targetClusterId, superseded_by_outlook_id: targetCanonicalId }).eq('story_cluster_id', req.params.id).neq('id', targetCanonicalId);
        await supabase.from('news_story_clusters').update({ status: 'archived', updated_at: new Date().toISOString() }).eq('id', req.params.id);
        const cluster = await refreshCluster(targetClusterId);
        await logEvent('audit', 'news', req.user.id, 'news_clusters_merged', 'Story clusters merged', { sourceClusterId: req.params.id, targetClusterId });
        res.json(cluster);
    } catch (error) { next(error); }
});

router.post('/clusters/:id/split', async (req, res, next) => {
    try {
        const sourceIds = [...new Set((Array.isArray(req.body.sourceIds) ? req.body.sourceIds : []).map(String))].slice(0, 100);
        const title = String(req.body.title || '').trim();
        if (!sourceIds.length || title.length < 8) return res.status(400).json({ error: { code: 'CLUSTER_SPLIT_INVALID', message: 'Select sources and provide the new story title.', requestId: req.requestId } });
        const { data: oldCluster, error: oldError } = await supabase.from('news_story_clusters').select('*').eq('id', req.params.id).single();
        if (oldError) throw oldError;
        const { data: sources, error: sourceError } = await supabase.from('news_article_sources').select('*').eq('story_cluster_id', req.params.id).in('id', sourceIds);
        if (sourceError) throw sourceError;
        const canonicalSource = (sources || []).find((source) => source.outlook_id !== oldCluster.canonical_outlook_id);
        if (!canonicalSource) return res.status(409).json({ error: { code: 'CLUSTER_SPLIT_CANONICAL_REQUIRED', message: 'The selected sources need an independent outlook before they can be split.', requestId: req.requestId } });
        const slug = `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 72)}-${Date.now().toString(36)}`;
        const { data: newCluster, error: createError } = await supabase.from('news_story_clusters').insert({ slug, title, canonical_outlook_id: canonicalSource.outlook_id, status: 'provisional', first_reported_at: canonicalSource.published_at, latest_reported_at: canonicalSource.published_at, representative_image_url: null, clustering_metadata: { manuallySplitFrom: req.params.id } }).select('*').single();
        if (createError) throw createError;
        await supabase.from('news_article_sources').update({ story_cluster_id: newCluster.id }).in('id', sourceIds);
        const outlookIds = [...new Set((sources || []).map((source) => source.outlook_id))];
        await supabase.from('scriptural_outlooks').update({ story_cluster_id: newCluster.id, superseded_by_outlook_id: canonicalSource.outlook_id }).in('id', outlookIds).neq('id', canonicalSource.outlook_id);
        await supabase.from('scriptural_outlooks').update({ story_cluster_id: newCluster.id, superseded_by_outlook_id: null }).eq('id', canonicalSource.outlook_id);
        const [fromCluster, splitCluster] = await Promise.all([refreshCluster(req.params.id), refreshCluster(newCluster.id)]);
        await logEvent('audit', 'news', req.user.id, 'news_cluster_split', 'Sources split into a new story cluster', { sourceClusterId: req.params.id, newClusterId: newCluster.id, sourceIds });
        res.status(201).json({ fromCluster, splitCluster });
    } catch (error) { next(error); }
});

router.post('/clusters/:id/regenerate', async (req, res, next) => {
    try {
        const requestedAt = new Date().toISOString();
        const { data: current, error: currentError } = await supabase.from('news_story_clusters').select('clustering_metadata').eq('id', req.params.id).single();
        if (currentError) throw currentError;
        const clusteringMetadata = { ...(current.clustering_metadata || {}), regenerationRequestedAt: requestedAt, regenerationRequestedBy: req.user.id };
        const { data, error } = await supabase.from('news_story_clusters').update({ clustering_metadata: clusteringMetadata, updated_at: requestedAt }).eq('id', req.params.id).select('*').single();
        if (error) throw error;
        await logEvent('audit', 'news', req.user.id, 'news_cluster_regeneration_requested', 'Story cluster regeneration requested', { clusterId: req.params.id });
        res.status(202).json(data);
    } catch (error) { next(error); }
});

router.get('/queue', async (req, res, next) => {
    try {
        const limit = boundedLimit(req.query.limit);
        const { data: articles, error } = await supabase.from('scriptural_outlooks').select('id,slug,article_title,article_url,publish_date,created_at,news_impact_score,ai_outlook').order('created_at', { ascending: false }).limit(limit * 2);
        if (error) throw error;
        const ids = (articles || []).map((article) => article.id);
        const [scores, reviews, corrections] = await Promise.all([
            supabase.from('news_score_versions').select('*').in('outlook_id', ids).order('version', { ascending: false }),
            supabase.from('news_review_decisions').select('outlook_id,decision,reviewer_display_name,created_at').in('outlook_id', ids).order('created_at', { ascending: false }),
            supabase.from('news_correction_reports').select('outlook_id,status').in('outlook_id', ids).in('status', ['open','investigating']),
        ]);
        for (const result of [scores, reviews, corrections]) if (result.error) throw result.error;
        const latestScore = new Map();
        for (const score of scores.data || []) if (!latestScore.has(score.outlook_id)) latestScore.set(score.outlook_id, score);
        const latestReview = new Map();
        for (const review of reviews.data || []) if (!latestReview.has(review.outlook_id)) latestReview.set(review.outlook_id, review);
        const openCorrections = (corrections.data || []).reduce((counts, row) => counts.set(row.outlook_id, (counts.get(row.outlook_id) || 0) + 1), new Map());
        const queue = (articles || []).map((article) => {
            const score = latestScore.get(article.id);
            const review = latestReview.get(article.id);
            const correctionCount = openCorrections.get(article.id) || 0;
            const confidenceScore = score?.confidence_score ?? 0;
            const truthfulnessScore = score?.truthfulness_score ?? 50;
            const moderationStatus = article.ai_outlook?.editorialReview?.status;
            const priority = Math.round((article.news_impact_score || 0) * 0.35 + (100 - confidenceScore) * 0.3 + (100 - truthfulnessScore) * 0.2 + Math.min(15, correctionCount * 5));
            return { ...article, ai_outlook: undefined, editorialStatus: moderationStatus === 'archived' ? 'archived' : (review?.decision || 'pending'), reviewerDisplayName: review?.reviewer_display_name || null, truthfulnessScore, truthfulnessBand: score?.truthfulness_band || null, confidenceScore, confidenceFactors: score?.confidence_factors || {}, unresolvedEvidenceGaps: score?.unresolved_evidence_gaps || [], assessmentVersion: score?.version || null, openCorrectionCount: correctionCount, reviewAlert: (!review || review.decision !== 'approved') && moderationStatus !== 'archived' ? confidenceScore < 60 : false, queuePriority: priority };
        }).filter((item) => !req.query.status || req.query.status === 'all' || item.editorialStatus === req.query.status).sort((a, b) => b.queuePriority - a.queuePriority).slice(0, limit);
        res.json(queue);
    } catch (error) { next(error); }
});

router.get('/articles/:id', async (req, res, next) => {
    try {
        const [article, sources, claims, scores, revisions, reviews, corrections] = await Promise.all([
            supabase.from('scriptural_outlooks').select('*').eq('id', req.params.id).single(),
            supabase.from('news_article_sources').select('*').eq('outlook_id', req.params.id).order('created_at'),
            supabase.from('news_claims').select('*').eq('outlook_id', req.params.id).order('materiality', { ascending: false }),
            supabase.from('news_score_versions').select('*').eq('outlook_id', req.params.id).order('version', { ascending: false }),
            supabase.from('news_editorial_revisions').select('*').eq('outlook_id', req.params.id).order('version', { ascending: false }),
            supabase.from('news_review_decisions').select('id,outlook_id,revision_id,decision,reviewer_display_name,note,created_at').eq('outlook_id', req.params.id).order('created_at', { ascending: false }),
            supabase.from('news_correction_reports').select('*').eq('outlook_id', req.params.id).order('created_at', { ascending: false }),
        ]);
        for (const result of [article, sources, claims, scores, revisions, reviews, corrections]) if (result.error) throw result.error;
        res.json({ article: article.data, sources: sources.data, claims: claims.data, scores: scores.data, revisions: revisions.data, reviews: reviews.data, corrections: corrections.data });
    } catch (error) { next(error); }
});

router.post('/articles/:id/revisions', async (req, res, next) => {
    try {
        const changeSummary = String(req.body.changeSummary || '').trim();
        if (changeSummary.length < 5 || changeSummary.length > 1000) return res.status(400).json({ error: { code: 'REVISION_SUMMARY_INVALID', message: 'Describe the editorial change.', requestId: req.requestId } });
        const { data: article, error: articleError } = await supabase.from('scriptural_outlooks').select('ai_outlook').eq('id', req.params.id).single();
        if (articleError) throw articleError;
        const edits = Object.fromEntries(Object.entries(req.body.content || {}).filter(([key]) => EDITABLE_FIELDS.has(key)));
        if (!Object.keys(edits).length) return res.status(400).json({ error: { code: 'REVISION_EMPTY', message: 'No editable fields were supplied.', requestId: req.requestId } });
        const content = { ...(article.ai_outlook || {}), ...edits };
        const { data: last } = await supabase.from('news_editorial_revisions').select('version').eq('outlook_id', req.params.id).order('version', { ascending: false }).limit(1).maybeSingle();
        const { data: revision, error } = await supabase.from('news_editorial_revisions').insert({ outlook_id: req.params.id, version: (last?.version || 0) + 1, content, change_summary: changeSummary, editor_user_id: req.user.id }).select('*').single();
        if (error) throw error;
        const { error: updateError } = await supabase.from('scriptural_outlooks').update({ ai_outlook: content }).eq('id', req.params.id);
        if (updateError) throw updateError;
        await logEvent('audit', 'news', req.user.id, 'revise_news_article', 'News article revised', { outlookId: req.params.id, revisionId: revision.id, version: revision.version });
        res.status(201).json(revision);
    } catch (error) { next(error); }
});

router.post('/articles/:id/decisions', async (req, res, next) => {
    try {
        const decision = req.body.decision;
        const reviewerDisplayName = String(req.body.reviewerDisplayName || '').trim();
        const note = String(req.body.note || '').trim() || null;
        if (!['approved','rejected'].includes(decision) || reviewerDisplayName.length < 2 || reviewerDisplayName.length > 120) return res.status(400).json({ error: { code: 'DECISION_INVALID', message: 'Decision and public reviewer name are required.', requestId: req.requestId } });
        const { data: revision } = await supabase.from('news_editorial_revisions').select('id').eq('outlook_id', req.params.id).order('version', { ascending: false }).limit(1).maybeSingle();
        const { data: review, error } = await supabase.from('news_review_decisions').insert({ outlook_id: req.params.id, revision_id: revision?.id || null, decision, reviewer_user_id: req.user.id, reviewer_display_name: reviewerDisplayName, note }).select('id,decision,reviewer_display_name,created_at').single();
        if (error) throw error;
        const { data: article } = await supabase.from('scriptural_outlooks').select('ai_outlook').eq('id', req.params.id).single();
        const aiOutlook = { ...(article?.ai_outlook || {}), editorialReview: decision === 'approved' ? { status: 'reviewed', reviewerName: reviewerDisplayName, reviewedAt: review.created_at } : { status: 'rejected', reviewerName: reviewerDisplayName, reviewedAt: review.created_at } };
        await supabase.from('scriptural_outlooks').update({ ai_outlook: aiOutlook }).eq('id', req.params.id);
        await logEvent('audit', 'news', req.user.id, 'review_news_article', `News article ${decision}`, { outlookId: req.params.id, reviewId: review.id });
        res.status(201).json(review);
    } catch (error) { next(error); }
});

router.post('/bulk', async (req, res, next) => {
    try {
        const ids = [...new Set((Array.isArray(req.body.ids) ? req.body.ids : []).map(Number).filter(Number.isInteger))].slice(0, 100);
        const action = String(req.body.action || '');
        const reviewerDisplayName = String(req.body.reviewerDisplayName || req.user.user_metadata?.full_name || req.user.email || '').trim().slice(0, 120);
        if (!ids.length || !['approved', 'rejected', 'archived'].includes(action)) return res.status(400).json({ error: { code: 'BULK_ACTION_INVALID', message: 'Select articles and a valid moderation action.', requestId: req.requestId } });
        if (action !== 'archived' && reviewerDisplayName.length < 2) return res.status(400).json({ error: { code: 'REVIEWER_NAME_REQUIRED', message: 'A public reviewer name is required.', requestId: req.requestId } });
        const { data: articles, error } = await supabase.from('scriptural_outlooks').select('id,ai_outlook').in('id', ids);
        if (error) throw error;
        const reviewedAt = new Date().toISOString();
        if (action !== 'archived') {
            const rows = (articles || []).map((article) => ({ outlook_id: article.id, decision: action, reviewer_user_id: req.user.id, reviewer_display_name: reviewerDisplayName, note: `Bulk ${action} through the Sanctuary News editorial desk.` }));
            const { error: decisionError } = await supabase.from('news_review_decisions').insert(rows);
            if (decisionError) throw decisionError;
        }
        for (const article of articles || []) {
            const aiOutlook = { ...(article.ai_outlook || {}), editorialReview: { status: action === 'approved' ? 'reviewed' : action, reviewerName: reviewerDisplayName || null, reviewedAt } };
            const { error: updateError } = await supabase.from('scriptural_outlooks').update({ ai_outlook: aiOutlook }).eq('id', article.id);
            if (updateError) throw updateError;
        }
        await logEvent('audit', 'news', req.user.id, 'bulk_moderate_news', `News articles bulk ${action}`, { ids, count: articles?.length || 0 });
        res.json({ action, count: articles?.length || 0 });
    } catch (error) { next(error); }
});

router.patch('/claims/:id', async (req, res, next) => {
    try {
        const status = req.body.status;
        const rationale = String(req.body.rationale || '').trim();
        if (!['supported','partially_supported','unverifiable','unsupported','contradicted'].includes(status) || rationale.length < 5) return res.status(400).json({ error: { code: 'CLAIM_INVALID', message: 'A valid status and rationale are required.', requestId: req.requestId } });
        const { data, error } = await supabase.from('news_claims').update({ status, rationale }).eq('id', req.params.id).select('*').single();
        if (error) throw error;
        await logEvent('audit', 'news', req.user.id, 'edit_news_claim', 'News claim evidence assessment changed', { claimId: req.params.id, outlookId: data.outlook_id });
        res.json(data);
    } catch (error) { next(error); }
});

router.post('/articles/:id/reassess', async (req, res, next) => {
    try {
        const [claimsResult, sourcesResult, scoreResult] = await Promise.all([
            supabase.from('news_claims').select('*').eq('outlook_id', req.params.id),
            supabase.from('news_article_sources').select('*').eq('outlook_id', req.params.id),
            supabase.from('news_score_versions').select('version').eq('outlook_id', req.params.id).order('version', { ascending: false }).limit(1).maybeSingle(),
        ]);
        for (const result of [claimsResult, sourcesResult, scoreResult]) if (result.error) throw result.error;
        const normalized = normalizeVerificationAssessment({ assessmentSummary: req.body.assessmentSummary, confidenceFactors: req.body.confidenceFactors, unresolvedEvidenceGaps: req.body.unresolvedEvidenceGaps, claims: (claimsResult.data || []).map((claim) => ({ claimText: claim.claim_text, materiality: claim.materiality, status: claim.status, rationale: claim.rationale })) }, (sourcesResult.data || []).map((source) => ({ publisher: source.publisher, isIndependent: source.is_independent })));
        const version = (scoreResult.data?.version || 0) + 1;
        const { data, error } = await supabase.from('news_score_versions').insert({ outlook_id: req.params.id, version, truthfulness_score: normalized.truthfulnessScore, truthfulness_band: normalized.truthfulnessBand, assessment_summary: normalized.assessmentSummary, confidence_score: normalized.confidenceScore, confidence_factors: normalized.confidenceFactors, unresolved_evidence_gaps: normalized.unresolvedEvidenceGaps, created_by: req.user.id }).select('*').single();
        if (error) throw error;
        await logEvent('audit', 'news', req.user.id, 'reassess_news_article', 'News verification score version created', { outlookId: req.params.id, scoreVersion: version });
        res.status(201).json(data);
    } catch (error) { next(error); }
});

router.patch('/corrections/:id', async (req, res, next) => {
    try {
        const status = req.body.status;
        const resolutionNote = String(req.body.resolutionNote || '').trim();
        if (!['investigating','resolved','rejected','spam'].includes(status) || resolutionNote.length < 5) return res.status(400).json({ error: { code: 'CORRECTION_RESOLUTION_INVALID', message: 'Status and resolution note are required.', requestId: req.requestId } });
        const { data: report, error } = await supabase.from('news_correction_reports').update({ status, resolution_note: resolutionNote, resolved_by: req.user.id, resolved_at: ['resolved','rejected','spam'].includes(status) ? new Date().toISOString() : null }).eq('id', req.params.id).select('*').single();
        if (error) throw error;
        let notice = null;
        if (status === 'resolved' && req.body.publishNotice === true) {
            const noticeText = String(req.body.notice || '').trim();
            if (!report.outlook_id || noticeText.length < 20 || noticeText.length > 2000) return res.status(400).json({ error: { code: 'CORRECTION_NOTICE_INVALID', message: 'A linked article and public notice are required.', requestId: req.requestId } });
            const result = await supabase.from('news_correction_notices').insert({ outlook_id: report.outlook_id, report_id: report.id, notice: noticeText, published_by: req.user.id }).select('id,notice,published_at').single();
            if (result.error) throw result.error;
            notice = result.data;
        }
        await logEvent('audit', 'news', req.user.id, 'resolve_news_correction', `Correction report marked ${status}`, { reportId: report.id, outlookId: report.outlook_id, noticeId: notice?.id || null });
        res.json({ report, notice });
    } catch (error) { next(error); }
});

module.exports = router;
