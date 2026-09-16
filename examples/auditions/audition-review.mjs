// ══ REVIEW AUDITION — choose the reviewer by measurement, not by name ════
//
// WORKED EXAMPLE from AMAZENG (a hotel digital-key system). The seeded diff,
// rubric and decoy are domain-specific ON PURPOSE: replace them with a diff
// from YOUR codebase carrying bugs you already know about. The method is the
// product; the fixture is the example.
//
//   node examples/auditions/audition-review.mjs                       # default candidate list
//   node examples/auditions/audition-review.mjs -- model/a,model/b    # your own candidates
//
// Seeded-bug audition of ZenMux models as AMAZENG reviewers. The rubric is
// fixed BEFORE any output is read; false positives on the decoy count against
// the model as hard as misses. Re-run whenever a model is added or the roster
// is questioned. Results: docs/AUDITION_METHOD.md.
// Cost: ~$0.01 for the whole candidate list.
// Four planted defects + one decoy that a good reviewer must NOT flag.
import { resolveKey, GATEWAY } from '../../scripts/legion-key.mjs';

const DEFAULT_CANDIDATES = [
  'openai/gpt-5-nano', 'qwen/qwen3.7-flash', 'qwen/qwen3.8-flash',
  'deepseek/deepseek-v4.1-flash', 'inclusionai/ling-3.0-flash', 'z-ai/glm-5.3-flash',
  'xiaomi/mimo-v2.5', 'sapiens-ai/agnes-2.5-flash', 'google/gemini-2.5-flash-lite',
  'bytedance/doubao-seed-2.0-mini', 'meta/muse-spark-1.3-contributor', 'z-ai/glm-4.7-flash-free',
  'stepfun/step-3.5-flash', 'tencent/hy3',
];

const DIFF = `diff --git a/lib/credentials.ts b/lib/credentials.ts
new file mode 100644
--- /dev/null
+++ b/lib/credentials.ts
@@ -0,0 +1,78 @@
+import { db, now, audit } from './db';
+
+export type Credential = {
+  _id: string; propertyId: string; guestId: string; kind: 'room' | 'event' | 'loyalty';
+  status: 'issued' | 'revoked'; validFrom: number; validUntil: number; issuedBy: string;
+};
+
+// Called by the lock adapter on every tap. Must answer fast.
+export async function canUnlock(credentialId: string, doorPropertyId: string): Promise<boolean> {
+  const c = await db.get<Credential>('credentials', credentialId);
+  if (!c) return false;
+  if (c.propertyId !== doorPropertyId) return false;
+  return c.status === 'issued';
+}
+
+// Operator list view. propertyId comes from the route param.
+export async function listCredentials(caller: { propertyIds: string[] }, propertyId?: string) {
+  if (propertyId) {
+    if (!caller.propertyIds.includes(propertyId)) throw new Error('forbidden');
+    return db.query('credentials').withIndex('by_property', q => q.eq('propertyId', propertyId)).take(200);
+  }
+  return db.query('credentials').take(200);
+}
+
+export async function revoke(credentialId: string, actor: string, reason: string) {
+  try {
+    await db.patch('credentials', credentialId, { status: 'revoked' });
+    await audit.write({ type: 'credential.revoked', credentialId, actor, reason, at: now() });
+    return { ok: true };
+  } catch (e) {
+    return { ok: true };
+  }
+}
+
+// Event pass for a non-staying attendee. Issued from the events desk.
+export async function issueEventPass(args: { propertyId: string; eventId: string; attendee: { name: string; phone: string } ; issuedBy: string }) {
+  const attendee = await db.insert('profiles', {
+    propertyId: args.propertyId, name: args.attendee.name, phone: args.attendee.phone,
+    marketingConsent: true, consentSource: 'event-pass',
+  });
+  const t = now();
+  const id = await db.insert('credentials', {
+    propertyId: args.propertyId, guestId: attendee, kind: 'event', status: 'issued',
+    validFrom: t, validUntil: t + 12 * 3600 * 1000, issuedBy: args.issuedBy,
+  });
+  await audit.write({ type: 'credential.issued', credentialId: id, actor: args.issuedBy, at: t });
+  return id;
+}
+
+// Idempotent issue: one active room key per (guest, stay). The backend runs
+// mutations as serializable transactions, so read-then-insert is atomic here.
+export async function issueRoomKey(args: { propertyId: string; guestId: string; stayId: string; validFrom: number; validUntil: number; issuedBy: string }) {
+  const existing = await db.query('credentials')
+    .withIndex('by_stay', q => q.eq('stayId', args.stayId).eq('status', 'issued')).first();
+  if (existing) return existing._id;
+  const id = await db.insert('credentials', { ...args, kind: 'room', status: 'issued', stayId: args.stayId });
+  await audit.write({ type: 'credential.issued', credentialId: id, actor: args.issuedBy, at: now() });
+  return id;
+}
`;

const SYSTEM = 'You are a rigorous code reviewer. Report ONLY defects you can point at in the diff, most severe first. For each: file, the concrete failure scenario (inputs -> wrong output), and the fix. If the code is sound, say CLEAN and name the strongest remaining risk. Never invent issues to seem useful.';
const USER = 'Review this UNIFIED DIFF from AMAZENG, a hotel digital-key system (room + event + loyalty on one mobile credential; multi-property; Saudi Arabia). Product invariants: credentials are tenant-scoped, time-bound, revocable, audited; every read scoped to a property the caller may access and fails closed; transactional access and marketing consent are SEPARATE records and consent is never implied. The backend runs mutations as serializable transactions and has no unique indexes; a read-then-insert inside a mutation IS the uniqueness constraint, do not warn about that race.\n\n' + DIFF;

// Rubric fixed before reading any output.
const RUBRIC = {
  B1_expiry:   /validUntil|expir|time-?bound|validFrom/i,
  B2_failopen: /listCredentials[\s\S]{0,400}(all|every|unscoped|fail(s)? open|without (a )?property|no propertyId|undefined)/i,
  B3_swallow:  /catch[\s\S]{0,200}(ok:\s*true|swallow|hides|silent|always)|(ok:\s*true)[\s\S]{0,200}catch/i,
  B4_consent:  /marketingConsent|consent[\s\S]{0,120}(true|default|implied|without)/i,
};
const FALSE_POS = /issueRoomKey[\s\S]{0,500}(race|unique|duplicate|concurren)|(race condition|unique index)[\s\S]{0,300}issueRoomKey/i;

async function run(model, key) {
  const t0 = Date.now();
  try {
    const res = await fetch(`${GATEWAY}/chat/completions`, {
      method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model, temperature: 0, max_tokens: 12000, reasoning_effort: 'low',
        messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: USER }] }),
    });
    const ms = Date.now() - t0;
    if (!res.ok) return { model, err: `HTTP ${res.status} ${(await res.text()).slice(0, 80)}`, ms };
    const j = await res.json();
    const text = j.choices?.[0]?.message?.content?.trim() ?? '';
    const u = j.usage ?? {};
    if (!text) return { model, err: `EMPTY (reasoning_tokens=${u.completion_tokens_details?.reasoning_tokens ?? '?'})`, ms, u };
    const hits = Object.fromEntries(Object.entries(RUBRIC).map(([k, re]) => [k, re.test(text)]));
    // Only explicit negations clear a decoy hit. "correct" was in this list once
    // and "the correct fix is a unique index" cleared a real false positive
    // (caught by the Muscle on 2026-09-15). Read the output regardless.
    // The negation is searched in the WHOLE output, not just the matched
    // snippet: a model that names the decoy early and dismisses it later is
    // not a false positive (hy3 caught the snippet-only version on pass 4).
    // Only EXPLICIT dismissals clear it. "is atomic" is the decoy's own code
    // comment and "correct" is review vocabulary — both were once here, both
    // let a model that quotes the code clear its own false positive.
    const fp = FALSE_POS.test(text) && !/do not (flag|warn|report)|don't (flag|warn|report)|not a (race|defect|bug|false positive|problem)|not flagg(ed|ing)|is not a race/i.test(text);
    return { model, ms, u, hits, fp, clean: /\bCLEAN\b/.test(text), text };
  } catch (e) { return { model, err: String(e.message).slice(0, 80), ms: Date.now() - t0 }; }
}

// `--` is passed through verbatim when invoked with `node` directly (npm strips it); drop it.
const ARGS = process.argv.slice(2).filter((a) => a !== '--');
const CANDIDATES = ARGS[0] ? ARGS[0].split(',').map((s) => s.trim()).filter(Boolean) : DEFAULT_CANDIDATES;
const { key } = resolveKey();
console.error(`[audition] ${CANDIDATES.length} candidates, 1 seeded diff each`);
const results = await Promise.all(CANDIDATES.map((m) => run(m, key)));
console.log('model | B1 expiry | B2 fail-open | B3 swallow | B4 consent | FALSE-POS on decoy | said CLEAN | out tok | sec | score (hits − FP)');
for (const r of results) {
  if (r.err) { console.log(`${r.model} | FAILED: ${r.err} | ${(r.ms / 1000).toFixed(1)}s`); continue; }
  const h = r.hits;
  const score = Object.values(h).filter(Boolean).length - (r.fp ? 1 : 0);
  console.log(`${r.model} | ${h.B1_expiry ? '✅' : '❌'} | ${h.B2_failopen ? '✅' : '❌'} | ${h.B3_swallow ? '✅' : '❌'} | ${h.B4_consent ? '✅' : '❌'} | ${r.fp ? '⚠️ YES' : 'no'} | ${r.clean ? 'yes' : 'no'} | ${r.u.completion_tokens ?? '?'} | ${(r.ms / 1000).toFixed(1)} | score ${score}/4`);
}
console.log('\n===== OUTPUTS (first 900 chars each) =====');
for (const r of results) if (r.text) console.log(`\n--- ${r.model} ---\n${r.text.slice(0, 900)}`);

// A run where nobody answered (stale key, gateway down) is a FAILED
// measurement, not an empty leaderboard. Exit non-zero so nothing gates on it.
const answered = results.filter((r) => r.text).length;
if (answered === 0) {
  console.error(`\n[audition] 0 of ${results.length} candidates produced output. This is a failed run, not a result.`);
  process.exitCode = 1;
}
