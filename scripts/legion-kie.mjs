// KIE gateway for the gates. A roster entry `kie:<model>` is served here.
//   kie:gpt-*     streaming Responses   https://api.kie.ai/openai/v1/responses
//   kie:claude-*  streaming Messages    https://api.kie.ai/anthropic/v1/messages
// KIE has no chat-completions route for GPT models, and a long unstreamed call dies as a Cloudflare 502, so both always stream.
//
// COMPLETION IS THE CONTRACT. askKie returns only an answer whose stream reached its provider's normal
// terminal state. A max-tokens cut, a dropped connection or an error event throws, even when the text so
// far begins "VERDICT: CLEAN": a half answer must fail over to the next model, never read as a finished one.
import { existsSync, readFileSync } from 'node:fs';
import { firstAssignment, keyCandidates } from './legion-key.mjs';

const KIE = process.env.LEGION_KIE_URL?.replace(/\/$/, '') ?? 'https://api.kie.ai';
// One attempt, including its whole stream. Long enough for a 60k-char diff, short enough to fall through.
const TIMEOUT_MS = Number(process.env.LEGION_KIE_TIMEOUT_MS ?? 420_000);
// legion:check must report a stalled gateway, not hang on it.
const PREFLIGHT_TIMEOUT_MS = 30_000;
// KIE's Claude models answer 503 under parallel load (measured 2026-11-05: 1 of 8 concurrent calls got through).
const CLAUDE_503_DELAYS_MS = [8_000, 16_000, 24_000];
const MAX_RETRY_AFTER_MS = 30_000;

export const isKie = (model) => model.startsWith('kie:');
export const kieId = (model) => model.slice('kie:'.length);
export const isKieClaude = (model) => kieId(model).startsWith('claude-');

// HTTP 402 means the KIE balance is out. It is shared by every model and every session on the key, so the
// roster stops at once: walking it would only collect more 402s.
export const isOutOfCredits = (message) => /HTTP 402/.test(message);
export const CREDITS_ADVICE = 'KIE credits are out. The balance is shared by every model and every session on this key.';
// The gate check: only a real positive number is a usable balance.
export const hasKieCredits = (value) => typeof value === 'number' && value > 0;

export function resolveKieKeySource() {
  for (const p of keyCandidates()) {
    if (!existsSync(p)) continue;
    const key = firstAssignment(readFileSync(p, 'utf8'), 'KIE_API_KEY');
    if (key) return { key, source: `file ${p}` };
  }
  if (process.env.KIE_API_KEY) return { key: process.env.KIE_API_KEY, source: 'env KIE_API_KEY (last resort)' };
  throw new Error(`No KIE_API_KEY found. Checked: ${keyCandidates().join(', ')}, then env. In a worktree set LEGION_REPO to the main checkout.`);
}
export const resolveKieKey = () => resolveKieKeySource().key;

// Yields each parsed SSE data event. Survives chunk boundaries and a last line with no newline; an
// unreadable event throws, because skipping one could hide the terminal event that says the answer was cut.
async function* sseEvents(res, rosterModel) {
  if (!res.body) throw new Error(`${rosterModel} sent no stream body`);
  const decoder = new TextDecoder();
  let buf = '';
  const parse = (raw) => {
    const line = raw.trim();
    if (!line.startsWith('data:')) return undefined;
    const data = line.slice(5).trim();
    if (!data || data === '[DONE]') return undefined;
    try { return JSON.parse(data); } catch { throw new Error(`${rosterModel} sent an unreadable stream event`); }
  };
  for await (const chunk of res.body) {
    buf += decoder.decode(chunk, { stream: true });
    let n;
    while ((n = buf.indexOf('\n')) >= 0) {
      const e = parse(buf.slice(0, n));
      buf = buf.slice(n + 1);
      if (e) yield e;
    }
  }
  const e = parse(buf + decoder.decode());
  if (e) yield e;
}

async function readResponses(res, rosterModel) {
  let content = '';
  let usage;
  let status = '';
  for await (const e of sseEvents(res, rosterModel)) {
    if (e.type === 'response.output_text.delta' && typeof e.delta === 'string') content += e.delta;
    if (e.type === 'error') throw new Error(`${rosterModel} stream error: ${JSON.stringify(e).slice(0, 200)}`);
    if (['response.completed', 'response.incomplete', 'response.failed'].includes(e.type)) {
      usage = e.response?.usage;
      status = e.response?.status ?? e.type.replace('response.', '');
    }
  }
  if (status !== 'completed') throw new Error(`${rosterModel} ended with status "${status || 'no terminal event'}"`);
  return { content, usage: { prompt_tokens: usage?.input_tokens, completion_tokens: usage?.output_tokens } };
}

async function readMessages(res, rosterModel) {
  let content = '';
  let stopReason = '';
  let stopped = false;
  const usage = {};
  for await (const e of sseEvents(res, rosterModel)) {
    if (e.type === 'error') throw new Error(`${rosterModel} stream error: ${JSON.stringify(e).slice(0, 200)}`);
    if (e.type === 'message_start') Object.assign(usage, e.message?.usage);
    if (e.type === 'content_block_delta' && e.delta?.type === 'text_delta') content += e.delta.text;
    if (e.type === 'message_delta') {
      Object.assign(usage, e.usage);
      stopReason = e.delta?.stop_reason ?? stopReason;
    }
    if (e.type === 'message_stop') stopped = true;
  }
  if (!stopped || stopReason !== 'end_turn') throw new Error(`${rosterModel} ended with stop reason "${stopReason || 'none'}"${stopped ? '' : ' and no message_stop'}`);
  return { content, usage: { prompt_tokens: usage.input_tokens, completion_tokens: usage.output_tokens } };
}

const httpError = async (rosterModel, res) => new Error(`${rosterModel} → HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);

function retryDelay(res, fallback) {
  const seconds = Number(res.headers.get('retry-after'));
  return seconds > 0 ? Math.min(seconds * 1000, MAX_RETRY_AFTER_MS) : fallback;
}

async function callClaude(rosterModel, { system, user, maxTokens }, { fetchImpl, sleep, key }) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetchImpl(`${KIE}/anthropic/v1/messages`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: kieId(rosterModel), system, messages: [{ role: 'user', content: user }], stream: true, max_tokens: maxTokens }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 503 && attempt < CLAUDE_503_DELAYS_MS.length) {
      await res.text();
      const wait = retryDelay(res, CLAUDE_503_DELAYS_MS[attempt]);
      console.error(`[kie] ${rosterModel} → 503, retry ${attempt + 1} of ${CLAUDE_503_DELAYS_MS.length} in ${Math.round(wait / 1000)} s`);
      await sleep(wait);
      continue;
    }
    if (!res.ok) throw await httpError(rosterModel, res);
    return readMessages(res, rosterModel);
  }
}

async function callGpt(rosterModel, { system, user, maxTokens, effort }, { fetchImpl, key }) {
  const res = await fetchImpl(`${KIE}/openai/v1/responses`, {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: kieId(rosterModel), instructions: system, input: user, stream: true, max_output_tokens: maxTokens, reasoning: { effort } }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw await httpError(rosterModel, res);
  return readResponses(res, rosterModel);
}

export async function askKie(rosterModel, request, deps = {}) {
  if (!isKie(rosterModel)) throw new Error(`${rosterModel} is not a KIE roster entry: use kie:<model>`);
  const ctx = { fetchImpl: deps.fetchImpl ?? fetch, sleep: deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))), key: deps.key ?? resolveKieKey() };
  const { content, usage } = await (isKieClaude(rosterModel) ? callClaude : callGpt)(rosterModel, request, ctx);
  if (!content.trim()) throw new Error(`${rosterModel} returned EMPTY content`);
  return { content: content.trim(), usage, model: rosterModel };
}

// Listing proves a model exists on KIE, not that it will answer: `legion:check --live` proves that.
export async function listKieModels(deps = {}) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const key = deps.key ?? resolveKieKey();
  const list = async (path) => {
    const res = await fetchImpl(`${KIE}${path}`, { headers: { authorization: `Bearer ${key}`, 'anthropic-version': '2023-06-01' }, signal: AbortSignal.timeout(PREFLIGHT_TIMEOUT_MS) });
    if (!res.ok) throw await httpError(path, res);
    const j = await res.json();
    if (!Array.isArray(j.data)) throw new Error(`${path} returned no model list`);
    return j.data.map((m) => m.id);
  };
  return new Set([...(await list('/openai/v1/models')), ...(await list('/anthropic/v1/models'))]);
}

export async function kieCredits(deps = {}) {
  const res = await (deps.fetchImpl ?? fetch)(`${KIE}/api/v1/chat/credit`, { headers: { authorization: `Bearer ${deps.key ?? resolveKieKey()}` }, signal: AbortSignal.timeout(PREFLIGHT_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`GET /api/v1/chat/credit → HTTP ${res.status}`);
  return (await res.json()).data;
}
