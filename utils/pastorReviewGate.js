const supabase = require('../config/supabase');

async function getPastorReview({ ownerUserId, contentType, contentId }) {
  const { data, error } = await supabase.from('ai_generation_runs')
    .select('id, input_provenance, completed_at, created_at')
    .eq('owner_user_id', ownerUserId)
    .eq('content_type', contentType)
    .eq('content_id', String(contentId))
    .eq('status', 'completed')
    .order('completed_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const review = data.input_provenance?.theologicalReview || null;
  if (!review) return null;
  return {
    generationRunId: data.id,
    status: review.status || (review.requiresPastorReview ? 'pastor_review_required' : 'passed'),
    requiresPastorReview: Boolean(review.requiresPastorReview),
    blockingIssueCount: Number(review.blockingIssueCount || 0),
    reviewIssueCount: Number(review.reviewIssueCount || 0),
    acknowledgedAt: data.input_provenance?.pastorReviewAcknowledgement?.acknowledgedAt || null,
  };
}

async function acknowledgePastorReview({ generationRunId, ownerUserId }) {
  const { data, error } = await supabase.from('ai_generation_runs')
    .select('id, input_provenance')
    .eq('id', generationRunId)
    .eq('owner_user_id', ownerUserId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const acknowledgedAt = new Date().toISOString();
  const inputProvenance = {
    ...(data.input_provenance || {}),
    pastorReviewAcknowledgement: { acknowledgedAt, acknowledgedBy: ownerUserId },
  };
  const { error: updateError } = await supabase.from('ai_generation_runs').update({ input_provenance: inputProvenance }).eq('id', generationRunId);
  if (updateError) throw updateError;
  return acknowledgedAt;
}

module.exports = { acknowledgePastorReview, getPastorReview };
