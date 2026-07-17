const openai = require('../config/openai');

const QUALITY_MODEL = process.env.OPENAI_QUALITY_MODEL || 'gpt-5.6-sol';
const QUALITY_REASONING_EFFORT = process.env.OPENAI_QUALITY_REASONING_EFFORT || 'medium';

const getUsage = (response) => ({
  inputTokens: response.usage?.input_tokens || 0,
  outputTokens: response.usage?.output_tokens || 0,
  totalTokens: response.usage?.total_tokens || 0,
});

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
  callStructuredResponse,
};
