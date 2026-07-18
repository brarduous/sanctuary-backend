const openai = require('../config/openai');

const QUALITY_MODEL = process.env.OPENAI_QUALITY_MODEL || 'gpt-5.6-sol';
const QUALITY_REASONING_EFFORT = process.env.OPENAI_QUALITY_REASONING_EFFORT || 'medium';
const QUALITY_TIMEOUT_MS = Number(process.env.OPENAI_QUALITY_TIMEOUT_MS || 300000);
// Initial request + two retries before a model failure reaches the product UI.
const QUALITY_MAX_RETRIES = Number(process.env.OPENAI_QUALITY_MAX_RETRIES || 2);
const QUALITY_INPUT_USD_PER_MILLION = Number(process.env.OPENAI_QUALITY_INPUT_USD_PER_MILLION || 5);
const QUALITY_OUTPUT_USD_PER_MILLION = Number(process.env.OPENAI_QUALITY_OUTPUT_USD_PER_MILLION || 30);

const getUsage = (response) => ({
  inputTokens: response.usage?.input_tokens || 0,
  outputTokens: response.usage?.output_tokens || 0,
  totalTokens: response.usage?.total_tokens || 0,
});

const estimateQualityCostUsd = (usage = {}) => Number((
  ((usage.inputTokens || 0) * QUALITY_INPUT_USD_PER_MILLION
    + (usage.outputTokens || 0) * QUALITY_OUTPUT_USD_PER_MILLION) / 1_000_000
).toFixed(6));

const classifyAttemptError = (error) => {
  const status = Number(error?.status || 0);
  const code = String(error?.code || '').toLowerCase();
  const name = String(error?.name || '').toLowerCase();
  if (status === 429 || code.includes('rate_limit')) return 'rate_limit';
  if (status === 408 || code.includes('timeout') || name.includes('timeout')) return 'timeout';
  if (status === 409) return 'conflict';
  if (status >= 500) return 'provider_server';
  if (code.includes('connection') || name.includes('connection') || name.includes('api_connection')) return 'connection';
  if (status >= 400 && status < 500) return 'invalid_request';
  return 'unknown';
};

const isRetryableAttemptError = (errorClass) => ['rate_limit', 'timeout', 'conflict', 'provider_server', 'connection'].includes(errorClass);

async function callStructuredResponse({
  instructions,
  input,
  schema,
  schemaName,
  maxOutputTokens = 6000,
  model = QUALITY_MODEL,
  reasoningEffort = QUALITY_REASONING_EFFORT,
  timeoutMs = QUALITY_TIMEOUT_MS,
  maxRetries = QUALITY_MAX_RETRIES,
  onAttempts = null,
  responseClient = openai,
}) {
  const startedAt = Date.now();
  const attempts = [];
  let response;
  let finalError;
  for (let attempt = 1; attempt <= maxRetries + 1; attempt += 1) {
    const attemptRecord = { attempt, startedAt: new Date().toISOString(), completedAt: null, outcome: 'running', errorClass: null };
    attempts.push(attemptRecord);
    if (onAttempts) await onAttempts(attempts);
    try {
      response = await responseClient.responses.create({
        model,
        instructions,
        input,
        reasoning: { effort: reasoningEffort },
        store: false,
        max_output_tokens: maxOutputTokens,
        text: {
          format: {
            type: 'json_schema',
            name: schemaName,
            schema,
            strict: true,
          },
        },
      }, {
        timeout: timeoutMs,
        maxRetries: 0,
      });
      attemptRecord.completedAt = new Date().toISOString();
      attemptRecord.outcome = 'completed';
      if (onAttempts) await onAttempts(attempts);
      break;
    } catch (error) {
      const errorClass = classifyAttemptError(error);
      attemptRecord.completedAt = new Date().toISOString();
      attemptRecord.outcome = 'failed';
      attemptRecord.errorClass = errorClass;
      if (onAttempts) await onAttempts(attempts);
      finalError = error;
      if (attempt > maxRetries || !isRetryableAttemptError(errorClass)) throw error;
      await new Promise((resolve) => setTimeout(resolve, Math.min(2000, 500 * (2 ** (attempt - 1)))));
    }
  }
  if (!response) throw finalError || new Error(`The ${model} request did not complete.`);

  if (!response.output_text) {
    throw new Error(`The ${model} response did not contain structured output.`);
  }

  let data;
  try {
    data = JSON.parse(response.output_text);
  } catch {
    throw new Error(`The ${model} response did not match the requested JSON schema.`);
  }

  return {
    data,
    model: response.model || model,
    responseId: response.id,
    usage: getUsage(response),
    durationMs: Date.now() - startedAt,
    reasoningEffort,
    attempts,
  };
}

module.exports = {
  QUALITY_MODEL,
  QUALITY_REASONING_EFFORT,
  QUALITY_TIMEOUT_MS,
  QUALITY_MAX_RETRIES,
  classifyAttemptError,
  isRetryableAttemptError,
  estimateQualityCostUsd,
  callStructuredResponse,
};
