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
import { mkdirSync, writeFileSync, copyFileSync, writeSync } from 'node:fs';
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
    // The cap must exceed the harness's own worst case (TOTAL tests × 3 s
    // each) or a slow-but-partially-working module is killed before its
    // RESULT line and loses the passes it earned.
    const CAP_MS = TOTAL * 3000 + 5000;
    let out = '', timedOut = false, crashed = false;
    try { out = execSync(`node tests.mjs`, { cwd: dir, encoding: 'utf8', timeout: CAP_MS, stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch (e) {
      crashed = true; // non-zero exit, signal, or timeout: annotated on a nonce-valid grade, never a veto
      // Runtime signals only — never the message text, which embeds the
      // candidate's own stdout/stderr ("throw new Error('timed out')" would lie).
      timedOut = (e.signal === 'SIGTERM' && e.status === null) || e.code === 'ETIMEDOUT';
      out = (e.stdout || '') + '\nCRASH ' + String(e.stderr || e.message).split('\n').slice(0, 3).join(' | ');
    }
    // A grade is accepted ONLY if the RESULT line carries the nonce the
    // harness wrote as its FIRST line, through a raw fd write captured before
    // the candidate was dynamically imported. A candidate cannot know that
    // nonce, so import-time prints, exit-hook prints and console/stdout
    // interception cannot be graded. Exit status does NOT veto a nonce-valid
    // grade; it is annotated on it (see parseGrade).
    const r = parseGrade(out);
    // The harness already passed the reference (self-check above), so no
    // RESULT here means the CANDIDATE's module failed to load or crashed —
    // scored 0/TOTAL with the reason and ranked last; never blamed on the harness.
    if (!r) {
      // A hang is not a load failure; say which. Keep any FAIL lines the
      // harness printed before dying — they are evidence of what did run.
      const why = out.trim().split('\n').filter((l) => /error|crash/i.test(l)).slice(0, 2).join(' | ').slice(0, 200) || 'no RESULT line';
      const ran = out.split('\n').filter((l) => l.startsWith('FAIL ')).map((l) => l.slice(0, 160));
      const label = timedOut ? `TIMEOUT (candidate module hung or looped; ${Math.round(CAP_MS / 1000)} s cap)` : 'LOAD FAILURE (candidate module did not run to completion)';
      return { model, ms, u, passed: 0, total: TOTAL, notGraded: true, fails: [`${label}: ${why}`, ...ran], dir, codeLen: code.length };
    }
    const passed = Number(r[1]), total = Number(r[2]);
    const fails = out.split('\n').filter((l) => l.startsWith('FAIL ') || l.startsWith('CRASH')).map((l) => l.slice(0, 160));
    if (crashed) fails.unshift(`NOTE: graded ${passed}/${total} from the nonce-bound RESULT, but the process did not exit cleanly afterwards (${timedOut ? `killed at the ${Math.round(CAP_MS / 1000)} s cap — an open handle?` : 'non-zero exit or signal'})`);
    return { model, ms, u, passed, total, fails, dir, codeLen: code.length };
  } catch (e) { return { model, err: String(e.message).slice(0, 100), ms: Date.now() - t0 }; }
}

// ── Harness self-check (invariant 18 in code) ────────────────────────────
// Before a single API call, the hidden harness grades a KNOWN-GOOD reference
// module. If that does not print RESULT N/N, the harness or the environment
// is broken and the run stops here — so a no-RESULT from a candidate later
// can only mean the CANDIDATE's module failed to load. A first cut of this
// script classified every no-RESULT as a harness bug; with fifteen syntax-
// broken candidates that would have told the operator to debug a working
// harness.
// ONE parser for both the self-check and every candidate: a grade exists only
// if a RESULT line carries the nonce the harness wrote as its first line.
// Exit status is NOT a veto — the nonce already proves the suite ran to its
// last statement; a non-zero exit or a kill after that is annotated on the
// grade, never used to discard it (a passing module that left a timer open
// used to be scored 0 and labelled a hang). CRLF-tolerant. Match or null.
function parseGrade(out) {
  const startNonce = out.match(/^HARNESS START nonce=([0-9a-f-]{36})\r?$/m)?.[1];
  if (!startNonce) return null;
  return [...out.matchAll(/^RESULT (\d+)\/(\d+) nonce=([0-9a-f-]{36})\r?$/gm)].find((m) => m[3] === startNonce) ?? null;
}
const REFERENCE_MODULE ="export function createCredentialService(db, clock, audit) {\n  const H12 = 12 * 3600 * 1000;\n  return {\n    async canUnlock(id, door) {\n      try { const c = db.get('credentials', id); if (!c || c.propertyId !== door || c.status !== 'issued') return false; const t = clock(); return t >= c.validFrom && t <= c.validUntil; } catch { return false; }\n    },\n    async listCredentials(caller, propertyId) {\n      const ids = caller?.propertyIds ?? [];\n      if (propertyId !== undefined) { if (!ids.includes(propertyId)) throw new Error('forbidden'); return db.list('credentials', (r) => r.propertyId === propertyId).slice(0, 200); }\n      if (!ids.length) return [];\n      return db.list('credentials', (r) => ids.includes(r.propertyId)).slice(0, 200);\n    },\n    async revoke(id, actor, reason) {\n      try { if (!db.get('credentials', id)) throw new Error('not found'); db.patch('credentials', id, { status: 'revoked', revokedAt: clock(), revokedBy: actor, revokeReason: reason }); audit.write({ type: 'credential.revoked', credentialId: id, actor, reason, at: clock() }); return { ok: true }; }\n      catch (e) { return { ok: false, error: String(e?.message ?? e) }; }\n    },\n    async issueEventPass({ propertyId, eventId, attendee, issuedBy, marketingConsent }) {\n      const profileId = db.insert('profiles', { propertyId, name: attendee.name, phone: attendee.phone });\n      if (marketingConsent === true) db.insert('consents', { profileId, propertyId, channel: 'marketing', optIn: true, source: 'event-pass', at: clock() });\n      const validFrom = clock();\n      const id = db.insert('credentials', { propertyId, guestId: profileId, kind: 'event', status: 'issued', validFrom, validUntil: validFrom + H12, issuedBy, eventId });\n      audit.write({ type: 'credential.issued', credentialId: id, actor: issuedBy, at: clock() });\n      return id;\n    },\n    async issueRoomKey({ propertyId, guestId, stayId, validFrom, validUntil, issuedBy }) {\n      const existing = db.list('credentials', (r) => r.stayId === stayId && r.status === 'issued')[0];\n      if (existing) return existing._id;\n      const id = db.insert('credentials', { propertyId, guestId, stayId, kind: 'room', status: 'issued', validFrom, validUntil, issuedBy });\n      audit.write({ type: 'credential.issued', credentialId: id, actor: issuedBy, at: clock() });\n      return id;\n    },\n  };\n}\n";
function selfCheck() {
  const dir = path.join(ROOT, '_reference'); mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'credentials.mjs'), REFERENCE_MODULE);
  copyFileSync(new URL('./audition-impl.tests.mjs', import.meta.url), path.join(dir, 'tests.mjs'));
  let out = '', crashed = false;
  // TOTAL is what this call discovers, so the cap cannot be derived from it;
  // give the reference a budget no candidate cap will exceed (a slow CI box
  // must never turn a working harness into "SELF-CHECK FAILED").
  const SELF_CHECK_MS = 180000;
  try { out = execSync('node tests.mjs', { cwd: dir, encoding: 'utf8', timeout: SELF_CHECK_MS, stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (e) { crashed = true; out = (e.stdout || '') + '\n' + String(e.stderr || e.message); }
  const r = parseGrade(out); // same nonce-bound acceptance as every candidate
  // A harness that ran ZERO tests (empty/truncated tests file) prints
  // RESULT 0/0 — equal, but graded nothing. That is a broken harness.
  if (!r || Number(r[2]) === 0 || Number(r[1]) !== Number(r[2])) {
    // Synchronous fd-2 writes, then exit: console.error before process.exit
    // can lose the very diagnostics this branch exists to deliver when
    // stderr is a pipe (CI, `2>&1 | tee`).
    writeSync(2, '[audition-impl] HARNESS SELF-CHECK FAILED: the reference module did not pass the harness. Either the harness/environment is broken OR the embedded REFERENCE_MODULE no longer matches the tests — check both. No candidate was graded.\n');
    writeSync(2, out.trim().split('\n').slice(-6).join('\n') + (crashed ? '\n(harness process did not exit cleanly)' : '') + '\n');
    process.exit(1);
  }
  console.error('[audition-impl] harness self-check: reference module ' + r[0]);
  return Number(r[2]);
}
const TOTAL = selfCheck();

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

const answered = results.filter((r) => !r.err).length;
const notGraded = results.filter((r) => r.notGraded).length;
const graded = answered - notGraded;
if (notGraded) console.error('\n[audition-impl] ' + notGraded + ' candidate(s) produced a module that did not run to completion (load failure or timeout) — scored 0/' + TOTAL + ', reasons in FAILURES.');
if (graded === 0) {
  console.error('\n[audition-impl] nobody produced gradeable code (every candidate: no output, no code block, transport failure, or a module that did not run) — failed run, not a result.');
  process.exitCode = 1;
}
