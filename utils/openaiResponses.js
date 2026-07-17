const openai = require('../config/openai');

const QUALITY_MODEL = process.env.OPENAI_QUALITY_MODEL || 'gpt-5.6-sol';
const QUALITY_REASONING_EFFORT = process.env.OPENAI_QUALITY_REASONING_EFFORT || 'medium';
const QUALITY_TIMEOUT_MS = Number(process.env.OPENAI_QUALITY_TIMEOUT_MS || 300000);
const QUALITY_MAX_RETRIES = Number(process.env.OPENAI_QUALITY_MAX_RETRIES || 1);
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

async function callStructuredResponse({
  instructions,
  input,
  schema,
  schemaName,
  maxOutputTokens = 6000,
  model = QUALITY_MODEL,
  reasoningEffort = QUALITY_REASONING_EFFORT,
}) {
  const startedAt = Date.now();
  const response = await openai.responses.create({
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
    timeout: QUALITY_TIMEOUT_MS,
    maxRetries: QUALITY_MAX_RETRIES,
  });

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
  };
}

module.exports = {
  QUALITY_MODEL,
  QUALITY_REASONING_EFFORT,
  QUALITY_TIMEOUT_MS,
  QUALITY_MAX_RETRIES,
  estimateQualityCostUsd,
  callStructuredResponse,
};
