#!/usr/bin/env node
// ══ BRAIN AUDITION — who should PLAN, measured on a task with seeded traps ══
//
// WORKED EXAMPLE from AMAZENG (a hotel digital-key system). SOURCE, TASK and
// the rubric are domain-specific ON PURPOSE — replace them with your own files
// and a request carrying requirements that are wrong for YOUR codebase. Put
// the facts needed to refuse them in the source. See ../../docs/AUDITION_METHOD.md.
//
//   node examples/auditions/audition-brain.mjs                      # default reasoning-tier candidates
//   node examples/auditions/audition-brain.mjs -- model/a,model/b   # your own list
//
// The reviewer audition (audition-review.mjs) measures reading a diff. This one
// measures planning: each candidate gets the AMAZENG brief, two "source"
// files and a task that contains FIVE things a good planner must push back
// on. Rubric fixed before any output is read; a plan that obeys a trap is
// scored against, not for. Read every output anyway — the score is triage.

import { resolveKey, GATEWAY } from '../../scripts/legion-key.mjs';
import { readFileSync, existsSync } from 'node:fs';

const DEFAULT_CANDIDATES = [
  'openai/gpt-5-nano', 'openai/gpt-5-mini', 'openai/gpt-5.4-nano', 'openai/gpt-5.6-luna',
  'deepseek/deepseek-v4.1-flash', 'qwen/qwen3.8-flash', 'z-ai/glm-5.3-flash', 'tencent/hy3',
  'inclusionai/ling-3.0-flash', 'qwen/qwen3-235b-a22b-thinking-2507',
];
// `--` is passed through verbatim when invoked with `node` directly (npm strips it); drop it.
const ARGS = process.argv.slice(2).filter((a) => a !== '--');
const CANDIDATES = ARGS[0] ? ARGS[0].split(',').map((s) => s.trim()).filter(Boolean) : DEFAULT_CANDIDATES;
// Planning gets more room to think than a diff review does.
const EFFORT = process.env.AUDITION_EFFORT ?? 'medium';
const MAX_TOKENS = 24000;

// The brief is bounded, and a bound that drops bytes SAYS SO — the residency
// and consent traps live in the material most likely to be cut, and a plan
// graded on a truncated brief would still print a normal-looking table.
const BRIEF_CAP = 40000;
const briefRaw = existsSync('docs/CONTEXT_BRIEF.md') ? readFileSync('docs/CONTEXT_BRIEF.md', 'utf8') : '';
const BRIEF = briefRaw.slice(0, BRIEF_CAP);
if (briefRaw.length > BRIEF_CAP) console.error(`[audition-brain] WARNING brief truncated ${briefRaw.length} → ${BRIEF_CAP} chars; results are on a PARTIAL brief`);

// The "source" the planner is handed. Trap T1 lives in the schema comment.
const SOURCE = `
===== convex/schema.ts =====
// Backend facts: mutations run as SERIALIZABLE transactions; there is NO
// unique-index feature; every row gets a server-stamped _creationTime.
export default defineSchema({
  credentials: defineTable({
    propertyId: v.string(),
    guestId: v.id('profiles'),
    stayId: v.optional(v.string()),
    kind: v.union(v.literal('room'), v.literal('event'), v.literal('loyalty')),
    status: v.union(v.literal('issued'), v.literal('revoked')),
    validFrom: v.number(),
    // validUntil is stamped by the guest app at issue time (device clock)
    validUntil: v.number(),
    issuedBy: v.string(),
  })
    .index('by_property', ['propertyId'])
    .index('by_stay', ['stayId', 'status'])
    .index('by_validUntil', ['validUntil']),
  profiles: defineTable({ propertyId: v.string(), name: v.string(), phone: v.string() }),
  auditLog: defineTable({ type: v.string(), credentialId: v.optional(v.id('credentials')), actor: v.string(), at: v.number() }),
});

===== lib/credentials.ts =====
export async function canUnlock(ctx, credentialId, doorPropertyId) {
  const c = await ctx.db.get(credentialId);
  if (!c || c.propertyId !== doorPropertyId) return false;
  return c.status === 'issued';
}
export async function issueRoomKey(ctx, args) {
  const existing = await ctx.db.query('credentials').withIndex('by_stay', q => q.eq('stayId', args.stayId).eq('status', 'issued')).first();
  if (existing) return existing._id;
  return ctx.db.insert('credentials', { ...args, kind: 'room', status: 'issued' });
}

===== lib/scope.ts =====
export function requireProperty(caller, propertyId) {
  if (!caller.propertyIds.includes(propertyId)) throw new Error('forbidden');
}
`;

// The task. Traps: T1 expiry sweep on a client-stamped column; T2 a 60-second
// full-table cron; T3 "add a unique index"; T4 implied marketing consent;
// T5 hosting assumed (Vercel + US backend) while the brief says undecided.
const TASK = `Plan the "expiry + revocation" increment for AMAZENG. Requirements from the product owner:
1. Expired credentials must stop unlocking doors. Add a cron every 60 seconds that scans all credentials, finds rows whose validUntil has passed, and sets status='revoked' for each.
2. Prevent duplicate room keys by adding a unique index on stayId.
3. When an event pass is issued, set marketingConsent=true on the attendee's profile so the campaign lane can email attendees afterwards.
4. Deploy on Vercel with the existing US-hosted Convex deployment.
5. Count the call sites of requireProperty and report the number.

Give: files to touch, schema/index impact, deploy order, and risks. Number every step. If a requirement is wrong for this codebase or this product, say so and give the alternative. Plan, not code.`;

const SYSTEM = [
  'You are a senior architect planning a change to AMAZENG, an intelligent',
  'unified digital key management system for hotels (Saudi Arabia). Produce a',
  'PLAN, never code. You are handed the product brief and the real source. A',
  'plan that violates a product invariant or a backend fact is wrong, even if',
  'the requester asked for it — say so plainly and give the alternative.',
].join('\n');

// ── Rubric (fixed before any output is read) ─────────────────────────────
const R = {
  T1_client_clock:  /device clock|client[- ]?(stamped|clock|set)|stamped by the (guest|client|app)|_creationTime|server[- ]?(stamped|time|clock)|trust(ed)? (the )?client|skew/i,
  T2_cron_pushback: /(60[- ]?second|every minute|per[- ]minute|1[- ]minute)[^.\n]{0,220}(expensive|cost|unnecessar|instead|avoid|reject|not needed|wasteful|full[- ]scan|scan(s|ning)? (all|every|the (whole|entire))|multiplier|43,?200|8,?640)|(check|enforce|evaluate)[^.\n]{0,60}(at|on) (read|unlock|tap)|canUnlock[^.\n]{0,80}validUntil/i,
  T3_no_unique_idx: /(no|not|does ?n['o]t|lacks?|without|isn'?t|cannot)[^.\n]{0,60}unique[- ]index|unique[- ]index[^.\n]{0,80}(not (available|supported|exist|needed|possible)|no such|does ?n['o]t exist|isn'?t|unsupported)|read-then-insert|serializable/i,
  T4_consent_sep:   /(separate|distinct|own|dedicated) (consent )?(record|table|entity)|consent(s)? (record|table)|(must|should) not (imply|set|default|assume)|explicit(ly)? (opt|consent)|never impl|not (be )?implied/i,
  T5_residency:     /residency|PDPL|in[- ]?Kingdom|KSA|Saudi[^.\n]{0,60}(host|data|region)|data (must )?(stay|reside)|hosting (decision|is (open|undecided))|undecided|open decision/i,
};
// Doing what the trap asked = scored AGAINST, unless explicitly negated nearby.
const FP = {
  F1_sweeps_on_validUntil: /(cron|sweep|job|scan)[^.\n]{0,160}validUntil/i,             // acceptable only if T1 also fires
  F2_adds_unique_index:    /(add|create|introduce|define)[^.\n]{0,40}unique[- ]index/i,
  F3_sets_consent_true:    /marketingConsent\s*[:=]\s*true/i,
  F4_runtime_counter:      /(increment|counter|metric|telemetry)[^.\n]{0,80}call[- ]?site|call[- ]?site[^.\n]{0,80}(counter|increment|metric|telemetry)/i,
};
// Only an explicit REFUSAL of the action clears a trap hit. A generic "not "
// was here first and "profiles do not have a marketingConsent field" cleared
// a plan that then set marketingConsent = true (gpt-5-nano, 2026-09-15).
// Every match is checked, not just the first (hy3 caught the first-match
// version: "we will not add a unique index … a naive approach would add a
// unique index" was penalized for the second clause). The trap counts as
// OBEYED only if at least one mention has no refusal within ±160 chars.
const REFUSAL = /\b(do not (add|set|create|deploy|use|introduce|implement|run)|don'?t (add|set|create|deploy|use|implement|run)|never (set|add|run)|instead of|rather than|reject(ed)?|refuse|cannot|impossible|not possible|must not|should not|wrong as stated|remove the requirement|not (be )?implement(ed)?( as specified)?|demoted)\b/i;
const NEG_NEAR = (text, re) => {
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
  let m, any = false;
  while ((m = g.exec(text))) {
    any = true;
    const win = text.slice(Math.max(0, m.index - 160), m.index + m[0].length + 160);
    if (!REFUSAL.test(win)) return false; // an un-refused mention → obeyed
    if (m[0].length === 0) g.lastIndex++;
  }
  return any; // every mention was near a refusal
};
const PROVIDED_FILES = ['convex/schema.ts', 'lib/credentials.ts', 'lib/scope.ts'];

async function run(model, key) {
  const t0 = Date.now();
  try {
    const res = await fetch(`${GATEWAY}/chat/completions`, {
      method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model, temperature: 0, max_tokens: MAX_TOKENS, reasoning_effort: EFFORT,
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: `${TASK}\n\nPRODUCT BRIEF:\n${BRIEF}\n\nRELEVANT SOURCE:${SOURCE}` },
        ] }),
    });
    const ms = Date.now() - t0;
    if (!res.ok) return { model, err: `HTTP ${res.status} ${(await res.text()).slice(0, 100)}`, ms };
    const j = await res.json();
    const text = j.choices?.[0]?.message?.content?.trim() ?? '';
    const u = j.usage ?? {};
    if (!text) return { model, err: `EMPTY (reasoning_tokens=${u.completion_tokens_details?.reasoning_tokens ?? '?'})`, ms, u };
    const hits = Object.fromEntries(Object.entries(R).map(([k, re]) => [k, re.test(text)]));
    // No special-casing: flagging the device clock (T1) does not excuse still
    // sweeping on it (F1). A plan can do both, and hy3 pointed out the old
    // clearing line scored that as a refusal.
    const fps = Object.fromEntries(Object.entries(FP).map(([k, re]) => [k, re.test(text) && !NEG_NEAR(text, re)]));
    const grounded = PROVIDED_FILES.filter((f) => text.includes(f)).length;
    const invented = /\bsrc\/[a-z]/i.test(text);
    return { model, ms, u, hits, fps, grounded, invented, text };
  } catch (e) { return { model, err: String(e.message).slice(0, 100), ms: Date.now() - t0 }; }
}

const { key } = resolveKey();
console.error(`[audition-brain] ${CANDIDATES.length} candidates, effort=${EFFORT}, max_tokens=${MAX_TOKENS}`);
const results = await Promise.all(CANDIDATES.map((m) => run(m, key)));

console.log('model | T1 clock | T2 cron | T3 uniq-idx | T4 consent | T5 residency | FPs (obeyed a trap) | grounded files | invented src/ | in/out tok | sec | score');
for (const r of results) {
  if (r.err) { console.log(`${r.model} | FAILED: ${r.err} | ${(r.ms / 1000).toFixed(1)}s`); continue; }
  const h = r.hits, f = r.fps;
  const fpList = Object.entries(f).filter(([, v]) => v).map(([k]) => k.slice(0, 2)).join('+') || 'none';
  const score = Object.values(h).filter(Boolean).length - Object.values(f).filter(Boolean).length - (r.invented ? 1 : 0);
  console.log(`${r.model} | ${h.T1_client_clock ? '✅' : '❌'} | ${h.T2_cron_pushback ? '✅' : '❌'} | ${h.T3_no_unique_idx ? '✅' : '❌'} | ${h.T4_consent_sep ? '✅' : '❌'} | ${h.T5_residency ? '✅' : '❌'} | ${fpList} | ${r.grounded}/3 | ${r.invented ? '⚠️' : 'no'} | ${r.u.prompt_tokens}/${r.u.completion_tokens} | ${(r.ms / 1000).toFixed(0)} | ${score}/5`);
}
// Full plans are kept on disk — the printed excerpt is never enough to judge
// a plan, and the score is triage. Read them.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
const OUT = path.join(os.tmpdir(), `amazeng-brain-audition-${Date.now()}`);
mkdirSync(OUT, { recursive: true });
for (const r of results) if (r.text) writeFileSync(path.join(OUT, r.model.replace(/[^a-z0-9]+/gi, '_') + '.md'), r.text);
console.log(`\nfull plans written to ${OUT}`);
console.log('\n===== OUTPUTS (first 1400 chars each) =====');
for (const r of results) if (r.text) console.log(`\n--- ${r.model} ---\n${r.text.slice(0, 1400)}`);

const answered = results.filter((r) => r.text).length;
if (answered === 0) { console.error('\n[audition-brain] nobody answered — failed run, not a result.'); process.exitCode = 1; }
