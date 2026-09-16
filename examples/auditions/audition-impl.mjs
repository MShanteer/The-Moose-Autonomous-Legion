#!/usr/bin/env node
// ══ IMPLEMENTATION AUDITION — who should BUILD, measured by running tests ══
//
// WORKED EXAMPLE from AMAZENG (a hotel digital-key system). SPEC and the
// harness are domain-specific ON PURPOSE — rewrite them together for your
// codebase, and validate the harness against a reference implementation you
// wrote yourself BEFORE grading any model. See ../../docs/AUDITION_METHOD.md.
//
//   node examples/auditions/audition-impl.mjs                      # default build-tier candidates
//   node examples/auditions/audition-impl.mjs -- model/a,model/b   # your own list
//
// Each candidate gets the same precise spec and must return one ES module.
// The module is written to a scratch dir and run against a HIDDEN test
// harness (audition-impl.tests.mjs, 19 cases). Score = tests passed. This is
// the only audition where the grade is produced by execution, not by regex.

import { resolveKey, GATEWAY } from '../../scripts/legion-key.mjs';
import { mkdirSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';

const DEFAULT_CANDIDATES = [
  'deepseek/deepseek-v4.1-flash', 'qwen/qwen3.8-flash', 'qwen/qwen3.7-flash', 'inclusionai/ling-3.0-flash',
  'z-ai/glm-5.3-flash', 'z-ai/glm-4.7-flash-free', 'xiaomi/mimo-v2.5', 'bytedance/doubao-seed-2.0-mini',
  'meta/muse-spark-1.3-contributor', 'tencent/hy3', 'google/gemini-2.5-flash-lite', 'stepfun/step-3.5-flash',
  'sapiens-ai/agnes-2.5-flash', 'openai/gpt-5-nano', 'openai/gpt-5.4-nano',
];
// `--` is passed through verbatim when invoked with `node` directly (npm strips it); drop it.
const ARGS = process.argv.slice(2).filter((a) => a !== '--');
const CANDIDATES = ARGS[0] ? ARGS[0].split(',').map((s) => s.trim()).filter(Boolean) : DEFAULT_CANDIDATES;

const SPEC = `Implement ONE ES module (JavaScript, no TypeScript, no imports) that exports:

export function createCredentialService(db, clock, audit)

and returns an object { canUnlock, listCredentials, revoke, issueEventPass, issueRoomKey }. All five may be async.

Injected dependencies (do not implement them; call them exactly like this):
  db.get(table, id)            -> row | undefined
  db.insert(table, row)        -> id (string); the stored row also gets _id
  db.patch(table, id, partial) -> void; THROWS Error('not found') if the id is missing
  db.list(table, predicate)    -> row[] matching predicate(row) (predicate optional)
  clock()                      -> current time in ms (number)
  audit.write(event)           -> void; MAY THROW

Tables: 'credentials', 'profiles', 'consents'.
Credential row shape: { propertyId, guestId, kind: 'room'|'event'|'loyalty', status: 'issued'|'revoked', validFrom, validUntil, issuedBy, stayId?, eventId?, revokedAt?, revokedBy?, revokeReason? }

Rules (every one is tested):
1. canUnlock(credentialId, doorPropertyId): returns true ONLY if the row exists, row.propertyId === doorPropertyId, row.status === 'issued', and clock() is within [validFrom, validUntil] inclusive. Never throws; anything else returns false.
2. listCredentials(caller, propertyId?): caller is { propertyIds: string[] }.
   - If propertyId is given and is NOT in caller.propertyIds: throw new Error('forbidden').
   - If propertyId is given and allowed: return that property's credentials (at most 200).
   - If propertyId is NOT given: return credentials for caller.propertyIds ONLY (at most 200). Never return other properties. If caller.propertyIds is empty, return [].
3. revoke(credentialId, actor, reason): patch the credential with { status: 'revoked', revokedAt: clock(), revokedBy: actor, revokeReason: reason }, then audit.write({ type: 'credential.revoked', credentialId, actor, reason, at: clock() }), then return { ok: true }. On ANY failure (missing row, patch throws, audit throws) return { ok: false, error: <message string> }. Never return { ok: true } when something failed.
4. issueEventPass({ propertyId, eventId, attendee: { name, phone }, issuedBy, marketingConsent? }):
   - Insert a profile row { propertyId, name, phone } with NO marketingConsent field on it, ever.
   - If marketingConsent === true, insert a SEPARATE row into 'consents': { profileId, propertyId, channel: 'marketing', optIn: true, source: 'event-pass', at: clock() }. Otherwise insert nothing into 'consents'.
   - Insert the credential { propertyId, guestId: <profile id>, kind: 'event', status: 'issued', validFrom: clock(), validUntil: validFrom + 12 hours, issuedBy, eventId }.
   - audit.write({ type: 'credential.issued', credentialId, actor: issuedBy, at: clock() }).
   - Return the credential id.
5. issueRoomKey({ propertyId, guestId, stayId, validFrom, validUntil, issuedBy }): if a credential with the same stayId and status 'issued' already exists, return its _id and do nothing else (no insert, no audit). Otherwise insert { propertyId, guestId, stayId, kind: 'room', status: 'issued', validFrom, validUntil, issuedBy }, audit.write({ type: 'credential.issued', credentialId, actor: issuedBy, at: clock() }), and return the new id.

Output format: exactly one fenced code block, \`\`\`js … \`\`\`, containing the complete module. No prose outside the block is needed.`;

function extractModule(text) {
  const m = text.match(/```(?:js|javascript|mjs)?\s*\n([\s\S]*?)```/i);
  if (m) return m[1];
  if (/export\s+function\s+createCredentialService/.test(text)) return text; // bare code, no fence
  return null;
}

const slug = (m) => m.replace(/[^a-z0-9]+/gi, '_');
const ROOT = path.join(os.tmpdir(), `amazeng-impl-audition-${Date.now()}`);
mkdirSync(ROOT, { recursive: true });

async function run(model, key) {
  const t0 = Date.now();
  try {
    const res = await fetch(`${GATEWAY}/chat/completions`, {
      method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model, temperature: 0, max_tokens: 16000, reasoning_effort: 'low',
        messages: [
          { role: 'system', content: 'You are a senior JavaScript engineer. Implement exactly the spec. Return one fenced js code block and nothing else.' },
          { role: 'user', content: SPEC },
        ] }),
    });
    const ms = Date.now() - t0;
    if (!res.ok) return { model, err: `HTTP ${res.status} ${(await res.text()).slice(0, 100)}`, ms };
    const j = await res.json();
    const text = j.choices?.[0]?.message?.content?.trim() ?? '';
    const u = j.usage ?? {};
    if (!text) return { model, err: `EMPTY (reasoning_tokens=${u.completion_tokens_details?.reasoning_tokens ?? '?'})`, ms, u };
    const code = extractModule(text);
    if (!code) {
      // Keep the evidence: the raw output is the only record of what the model produced.
      writeFileSync(path.join(ROOT, slug(model) + '.raw.txt'), text);
      return { model, err: `no code block in output (raw kept: ${slug(model)}.raw.txt) — starts: ${JSON.stringify(text.slice(0, 120))}`, ms, u, text };
    }
    const dir = path.join(ROOT, slug(model)); mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'credentials.mjs'), code);
    copyFileSync(new URL('./audition-impl.tests.mjs', import.meta.url), path.join(dir, 'tests.mjs'));
    let out = '';
    try { out = execSync(`node tests.mjs`, { cwd: dir, encoding: 'utf8', timeout: 20000, stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch (e) { out = (e.stdout || '') + '\nCRASH ' + String(e.stderr || e.message).split('\n').slice(0, 3).join(' | '); }
    const r = out.match(/RESULT (\d+)\/(\d+)/);
    // No RESULT line means the HARNESS did not run to completion (import
    // crash, syntax error, missing node) — that is not a 0/19, it is no grade.
    // Reported as a harness failure so a broken harness cannot masquerade as
    // fifteen models that cannot build.
    if (!r) return { model, err: `harness produced no RESULT line — ${out.trim().split('\n').slice(-2).join(' | ').slice(0, 200)}`, ms, u, harness: true };
    const passed = Number(r[1]), total = Number(r[2]);
    const fails = out.split('\n').filter((l) => l.startsWith('FAIL ') || l.startsWith('CRASH')).map((l) => l.slice(0, 160));
    return { model, ms, u, passed, total, fails, dir, codeLen: code.length };
  } catch (e) { return { model, err: String(e.message).slice(0, 100), ms: Date.now() - t0 }; }
}

const { key } = resolveKey();
console.error(`[audition-impl] ${CANDIDATES.length} candidates → ${ROOT}`);
const results = await Promise.all(CANDIDATES.map((m) => run(m, key)));
results.sort((a, b) => (b.passed ?? -1) - (a.passed ?? -1) || (a.ms - b.ms));

console.log('model | tests passed | code chars | in/out tok | sec');
for (const r of results) {
  if (r.err) { console.log(`${r.model} | FAILED: ${r.err} | ${(r.ms / 1000).toFixed(1)}s`); continue; }
  console.log(`${r.model} | ${r.passed}/${r.total} | ${r.codeLen} | ${r.u.prompt_tokens}/${r.u.completion_tokens} | ${(r.ms / 1000).toFixed(0)}`);
}
console.log('\n===== FAILURES =====');
for (const r of results) if (!r.err && r.fails.length) console.log(`\n--- ${r.model} (${r.passed}/${r.total}) ---\n${r.fails.join('\n')}`);
console.log(`\nmodules kept at ${ROOT}`);

const graded = results.filter((r) => !r.err).length;
const harnessFails = results.filter((r) => r.harness).length;
if (graded === 0 && harnessFails > 0) {
  console.error(`\n[audition-impl] the harness printed no RESULT for ANY of ${harnessFails} candidate(s). This is a harness/environment bug, not a model result. Run the harness against a reference implementation first.`);
  process.exitCode = 1;
} else if (graded === 0) {
  console.error('\n[audition-impl] nobody produced runnable code — failed run, not a result.');
  process.exitCode = 1;
}
