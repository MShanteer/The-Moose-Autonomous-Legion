// The KIE gate client: a half answer must throw, never come back as a review.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { askKie, hasKieCredits, isOutOfCredits } from '../legion-kie.mjs';

const REQ = { system: 's', user: 'u', maxTokens: 100, effort: 'low' };
const sse = (events) => events.map((e) => `data: ${JSON.stringify(e)}`).join('\n') + '\n';
const deps = (...replies) => {
  const urls = [];
  const waits = [];
  return { urls, waits, key: 'test', sleep: async (ms) => { waits.push(ms); }, fetchImpl: async (url) => { urls.push(url); return replies.shift(); } };
};
const delta = { type: 'content_block_delta', delta: { type: 'text_delta', text: 'VERDICT: CLEAN\nbody' } };
const claudeOk = () => new Response(sse([delta, { type: 'message_delta', delta: { stop_reason: 'end_turn' } }, { type: 'message_stop' }]));
const gptDelta = { type: 'response.output_text.delta', delta: 'VERDICT: CLEAN\nbody' };

test('GPT goes to the streaming Responses route and returns a finished answer', async () => {
  const d = deps(new Response(sse([gptDelta, { type: 'response.completed', response: { status: 'completed', usage: { input_tokens: 1, output_tokens: 2 } } }])));
  const out = await askKie('kie:gpt-6.1-sol', REQ, d);
  assert.match(d.urls[0], /\/openai\/v1\/responses$/);
  assert.equal(out.usage.completion_tokens, 2);
});
test('a Responses stream with no completed event throws', async () => {
  await assert.rejects(askKie('kie:gpt-6.1-sol', REQ, deps(new Response(sse([gptDelta])))), /no terminal event/);
});
test('a max-tokens cut throws even when the text says CLEAN', async () => {
  const cut = new Response(sse([delta, { type: 'message_delta', delta: { stop_reason: 'max_tokens' } }, { type: 'message_stop' }]));
  await assert.rejects(askKie('kie:claude-sonnet-5-5', REQ, deps(cut)), /max_tokens/);
});
test('empty content is a failure, never approval', async () => {
  const empty = new Response(sse([{ type: 'message_delta', delta: { stop_reason: 'end_turn' } }, { type: 'message_stop' }]));
  await assert.rejects(askKie('kie:claude-sonnet-5-5', REQ, deps(empty)), /EMPTY/);
});
test('Claude retries a 503 and then answers', async () => {
  const d = deps(new Response('busy', { status: 503 }), claudeOk());
  await askKie('kie:claude-sonnet-5-5', REQ, d);
  assert.equal(d.urls.length, 2);
  assert.deepEqual(d.waits, [8000]);
  assert.match(d.urls[0], /\/anthropic\/v1\/messages$/);
});
test('a non-KIE roster entry is refused before any call', async () => {
  const d = deps();
  await assert.rejects(askKie('vendor/model', REQ, d), /not a KIE roster entry/);
  assert.equal(d.urls.length, 0);
});
test('402 is the out-of-credits signal; a 503 is not', () => {
  assert.equal(isOutOfCredits('kie:gpt-6-luna → HTTP 402: no credits'), true);
  assert.equal(isOutOfCredits('kie:gpt-6-luna → HTTP 503: busy'), false);
});
test('only a positive number is a usable balance', () => {
  assert.equal(hasKieCredits(5), true);
  assert.equal(hasKieCredits(0), false);
  assert.equal(hasKieCredits('5'), false);
});
test('a terminal event with no status still finishes on its event type', async () => {
  const d = deps(new Response(sse([gptDelta, { type: 'response.completed', response: {} }])));
  assert.equal((await askKie('kie:gpt-6.1-sol', REQ, d)).content, 'VERDICT: CLEAN\nbody');
});
