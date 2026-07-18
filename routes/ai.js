const express = require('express');
const router = express.Router();
const { logEvent } = require('../utils/helpers');
const supabase = require('../config/supabase');
const { getAiEditorSystemPrompt, getAiEditorUserPrompt } = require('../prompts');
const authenticateUser = require('../middleware/auth');
const { aiLimiter } = require('../middleware/limiters');
const { QUALITY_MODEL, callStructuredResponse, estimateQualityCostUsd } = require('../utils/openaiResponses');
const { createAttemptTelemetryRecorder } = require('../utils/generationAttemptTelemetry');
const { PROMPT_VERSION, buildVoiceInstructions, getActiveVoiceContext } = require('../utils/pastorVoice');
const { reviewPastoralContent } = require('../utils/theologicalReview');

const aiEditSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['result'],
  properties: { result: { type: 'string' } },
};

router.post('/edit', authenticateUser, aiLimiter, async (req, res) => {
  const userId = req.user.id;
  const { text, instruction } = req.body;
  let generationRunId = null;

  if (!text) return res.status(400).json({ error: 'No text provided' });
  if (!String(instruction || '').trim()) return res.status(400).json({ error: 'An editing instruction is required' });

  try {
    const systemPrompt = await getAiEditorSystemPrompt();
    const userPrompt = await getAiEditorUserPrompt({ instruction, text });
    const voiceContext = await getActiveVoiceContext(userId);
    const voiceInstructions = buildVoiceInstructions(voiceContext, 'sermon');
    const { data: generationRun, error: generationRunError } = await supabase.from('ai_generation_runs').insert({
      owner_user_id: userId,
      content_type: 'sermon_rewrite',
      status: 'running',
      model: QUALITY_MODEL,
      voice_profile_id: voiceContext.profileRecord?.id || null,
      voice_treatment: voiceContext.profileRecord ? 'structured_profile' : 'baseline',
      prompt_version: PROMPT_VERSION,
      input_provenance: { requestedTradition: voiceContext.declaredTradition || null },
    }).select('id').single();
    if (generationRunError) throw generationRunError;
    generationRunId = generationRun.id;

    const generation = await callStructuredResponse({
      instructions: `${systemPrompt}\n${voiceInstructions}`,
      input: userPrompt,
      schema: aiEditSchema,
      schemaName: 'pastoral_editor_rewrite',
      maxOutputTokens: 6000,
      onAttempts: createAttemptTelemetryRecorder(generationRunId),
    });
    const result = generation.data.result;

    const theologicalReview = await reviewPastoralContent({
      artifactType: 'sermon_rewrite',
      requestedScripture: null,
      content: { result },
      voiceContext,
    });

    await supabase.from('ai_generation_runs').update({
      status: 'completed',
      model: generation.model,
      input_token_count: generation.usage.inputTokens,
      output_token_count: generation.usage.outputTokens,
      duration_ms: generation.durationMs,
      estimated_cost_usd: Number((estimateQualityCostUsd(generation.usage) + estimateQualityCostUsd(theologicalReview.usage)).toFixed(6)),
      input_provenance: {
        requestedTradition: voiceContext.declaredTradition || null,
        theologicalReview: {
          ...theologicalReview.summary,
          model: theologicalReview.model,
          reasoningEffort: theologicalReview.reasoningEffort,
          inputTokens: theologicalReview.usage?.inputTokens || 0,
          outputTokens: theologicalReview.usage?.outputTokens || 0,
          durationMs: theologicalReview.durationMs,
        },
      },
      completed_at: new Date().toISOString(),
    }).eq('id', generationRunId);

    logEvent('ai', 'backend', userId, 'ai_edit_success', 'Pastoral editor rewrite completed', {
      model: generation.model,
      promptVersion: PROMPT_VERSION,
    }, generation.durationMs);
    res.json({ result });

  } catch (error) {
    if (generationRunId) {
      await supabase.from('ai_generation_runs').update({
        status: 'failed',
        failure_code: error.code || 'AI_EDIT_FAILED',
        completed_at: new Date().toISOString(),
      }).eq('id', generationRunId);
    }
    logEvent('error', 'backend', userId, 'ai_edit_failed', 'Pastoral editor rewrite failed', {
      code: error.code || 'AI_EDIT_FAILED',
    }, 0);
    const status = error.code === 'THEOLOGICAL_REVIEW_REJECTED' ? 422 : 500;
    res.status(status).json({ error: 'AI processing failed scriptural or doctrinal review' });
  }
});

module.exports = router;
