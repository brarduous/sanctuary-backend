const supabase = require('../config/supabase');

const createAttemptTelemetryRecorder = (generationRunId) => async (attempts) => {
  if (!generationRunId || !Array.isArray(attempts) || attempts.length === 0) return;
  const snapshot = attempts.map(({ attempt, startedAt, completedAt, outcome, errorClass }) => ({
    attempt,
    startedAt,
    completedAt,
    outcome,
    errorClass,
  }));
  const latest = snapshot.at(-1);
  const { error } = await supabase.from('ai_generation_runs').update({
    attempt_count: latest.attempt,
    last_attempt_at: latest.startedAt,
    attempt_telemetry: snapshot,
  }).eq('id', generationRunId);
  if (error) console.warn('Failed to persist non-sensitive generation attempt telemetry.', { code: error.code || 'ATTEMPT_TELEMETRY_WRITE_FAILED' });
};

module.exports = { createAttemptTelemetryRecorder };
