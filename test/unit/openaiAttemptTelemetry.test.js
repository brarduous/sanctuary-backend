const test = require('node:test');
const assert = require('node:assert/strict');
const { callStructuredResponse, classifyAttemptError, isRetryableAttemptError } = require('../../utils/openaiResponses');

test('attempt error classification is whitelisted and retry policy is bounded', () => {
  assert.equal(classifyAttemptError({ status: 429, message: 'private provider detail' }), 'rate_limit');
  assert.equal(classifyAttemptError({ status: 503 }), 'provider_server');
  assert.equal(classifyAttemptError({ status: 400 }), 'invalid_request');
  assert.equal(classifyAttemptError(new Error('private unknown detail')), 'unknown');
  assert.equal(isRetryableAttemptError('rate_limit'), true);
  assert.equal(isRetryableAttemptError('invalid_request'), false);
});

test('structured responses expose attempt numbers and timestamps without input content', async () => {
  let calls = 0;
  const persistedSnapshots = [];
  const responseClient = { responses: { create: async () => {
    calls += 1;
    if (calls < 3) throw Object.assign(new Error('provider detail must not persist'), { status: 503 });
    return { id: 'response-id', model: 'test-model', output_text: '{"ok":true}', usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } };
  } } };
  const result = await callStructuredResponse({
    instructions: 'private instructions', input: 'private manuscript', schema: { type: 'object' }, schemaName: 'test',
    maxRetries: 2, responseClient, onAttempts: async (attempts) => persistedSnapshots.push(JSON.parse(JSON.stringify(attempts))),
  });
  assert.equal(calls, 3);
  assert.deepEqual(result.attempts.map(({ attempt, outcome, errorClass }) => ({ attempt, outcome, errorClass })), [
    { attempt: 1, outcome: 'failed', errorClass: 'provider_server' },
    { attempt: 2, outcome: 'failed', errorClass: 'provider_server' },
    { attempt: 3, outcome: 'completed', errorClass: null },
  ]);
  const serialized = JSON.stringify(result.attempts);
  assert.doesNotMatch(serialized, /private|manuscript|provider detail/);
  assert.ok(result.attempts.every((attempt) => attempt.startedAt && attempt.completedAt));
  assert.equal(persistedSnapshots.at(-1).length, 3);
  assert.equal(persistedSnapshots[0][0].outcome, 'running');
});
