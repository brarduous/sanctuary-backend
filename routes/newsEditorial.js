const express = require('express');
const supabase = require('../config/supabase');
const authenticateUser = require('../middleware/auth');
const requireAdmin = require('../middleware/adminAuth');
const { logEvent } = require('../utils/helpers');
const { normalizeVerificationAssessment } = require('../utils/newsVerification');

const router = express.Router();
router.use(authenticateUser, requireAdmin);

const EDITABLE_FIELDS = new Set(['newsSummary','sourceAndFramingAnalysis','biblicalReflection','citedPassages','faithfulResponse','congregationalImplications','ministryActions','sermonDiscussionPrompts','reflectionQuestions','closingPrayer','sources','additionalSourcesNeeded']);

function boundedLimit(value, fallback = 50) {
    return Math.min(100, Math.max(1, Number.parseInt(value, 10) || fallback));
}

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
            const priority = Math.round((article.news_impact_score || 0) * 0.35 + (100 - confidenceScore) * 0.3 + (100 - truthfulnessScore) * 0.2 + Math.min(15, correctionCount * 5));
            return { ...article, ai_outlook: undefined, editorialStatus: review?.decision || 'pending', reviewerDisplayName: review?.reviewer_display_name || null, truthfulnessScore, truthfulnessBand: score?.truthfulness_band || null, confidenceScore, confidenceFactors: score?.confidence_factors || {}, unresolvedEvidenceGaps: score?.unresolved_evidence_gaps || [], assessmentVersion: score?.version || null, openCorrectionCount: correctionCount, reviewAlert: !review || review.decision !== 'approved' ? confidenceScore < 90 : false, queuePriority: priority };
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
