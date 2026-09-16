#!/usr/bin/env node
// ══ BRAIN — the Legion plans the work before you write it ═══════════════
//
//   npm run brain "Plan how to add X. Files + data impact + deploy order + risks. Plan, not code."
//   npm run brain -- --files lib/a.ts,lib/b.ts "Plan …"
//   npm run brain -- --second "…"        a different model lineage, for owner-decision questions
//   npm run brain -- --roster a,b "…"    explicit roster for this run
//
// Repo-specific context, both optional, both read from the repo you run in:
//   docs/CONTEXT_BRIEF.md      inlined into every plan (what the product IS)
//   docs/BRAIN_CONSTRAINTS.md  appended to the system prompt (what a plan must never violate)
//
// Why the Brain is a separate call and not the implementing agent: it is a
// different READER. The implementer knows what it meant; the Brain sees only
// what was written. The disagreement is the finding.
//
// A PLAN IS A SECOND OPINION, NOT AN AUTHORITY. It does not know what your
// codebase cannot do. Verify each claim against the real constraints before
// building on it — on one production repo a plan proposed running a
// browser-only renderer as an unattended server cron.
//
// Empty content is a FAILURE, never agreement: reasoning models spend the
// whole max_tokens budget thinking and return "" on big prompts. Always send
// reasoning_effort: low (or medium for planning) and give headroom.

import { resolveKey, BRAIN_ROSTER, BRAIN_SECOND_ROSTER, rosterFromArgv, GATEWAY } from './legion-key.mjs';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';

// docs/CONTEXT_BRIEF.md, or any docs/*CONTEXT_BRIEF*.md (repos tend to prefix
// it with the product name). LEGION_BRIEF overrides. Discovery never throws
// at import (a FILE named docs, an unreadable dir → fall back), the candidate
// list is sorted so the choice is deterministic, and the choice is logged so a
// stale archived brief cannot be fed to the model unnoticed.
function discoverBrief() {
  if (process.env.LEGION_BRIEF) return process.env.LEGION_BRIEF;
  if (existsSync('docs/CONTEXT_BRIEF.md')) return 'docs/CONTEXT_BRIEF.md';
  try {
    if (!statSync('docs').isDirectory()) return 'docs/CONTEXT_BRIEF.md';
    const found = readdirSync('docs').filter((f) => /CONTEXT_BRIEF.*\.md$/i.test(f)).sort((a, b) => a.length - b.length || a.localeCompare(b));
    if (found.length > 1) console.error(`[brain] ${found.length} brief candidates in docs/ (${found.join(', ')}); using ${found[0]} — set LEGION_BRIEF to choose`);
    return found[0] ? `docs/${found[0]}` : 'docs/CONTEXT_BRIEF.md';
  } catch { return 'docs/CONTEXT_BRIEF.md'; }
}
const BRIEF = discoverBrief();
const CONSTRAINTS = process.env.LEGION_BRAIN_CONSTRAINTS || 'docs/BRAIN_CONSTRAINTS.md';

let rawArgv = process.argv.slice(2);
const second = rawArgv.includes('--second');
rawArgv = rawArgv.filter((a) => a !== '--second');
const { roster: ROSTER, rest: argv } = rosterFromArgv(rawArgv, second ? BRAIN_SECOND_ROSTER : BRAIN_ROSTER);

let files = [];
const rest = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--files') { files = (argv[++i] ?? '').split(',').filter(Boolean); continue; }
  rest.push(argv[i]);
}
const task = rest.join(' ').trim();
if (!task) {
  console.log('Usage: npm run brain "<planning task>"');
  console.log('       npm run brain -- --files path/a.ts,path/b.ts "<planning task>"');
  process.exit(1);
}

// The Brain does not read the repo. Named files are inlined so the plan is
// grounded in real code instead of a guess about what the code says.
if (!files.includes(BRIEF) && existsSync(BRIEF)) files.unshift(BRIEF);
let context = '';
for (const f of files) {
  if (!existsSync(f)) { console.error(`! skipped missing file: ${f}`); continue; }
  const body = readFileSync(f, 'utf8');
  const cap = 60_000;
  if (body.length > cap) console.error(`! ${f} truncated ${body.length} → ${cap} chars`); // a bound that drops bytes says so
  context += `\n\n===== ${f} =====\n${body.slice(0, cap)}`;
}

const SYSTEM = [
  'You are a senior architect planning a change to an existing codebase.',
  'Produce a PLAN, never code. Answer with: the files to touch, the data-model',
  'impact, the integration contracts affected, the deploy order, and the',
  'concrete risks. Number every step. Be terse and specific.',
  '',
  'If a requirement is wrong for this codebase or this product, say so plainly',
  'and give the alternative — a plan that obeys a wrong requirement is wrong.',
  'Say plainly when something cannot be done with the pieces available. Do not',
  'invent infrastructure that is not named in the source you were given.',
  existsSync(CONSTRAINTS) ? `\nCONSTRAINTS OF THIS CODEBASE — a plan that violates these is wrong:\n${readFileSync(CONSTRAINTS, 'utf8')}` : '',
].join('\n');

async function ask(model, key) {
  const res = await fetch(`${GATEWAY}/chat/completions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model, reasoning_effort: process.env.LEGION_BRAIN_EFFORT ?? 'low', max_tokens: 16000, temperature: 0,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: context ? `${task}\n\nRELEVANT SOURCE:${context}` : task },
      ],
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${model} → HTTP ${res.status}: ${text.slice(0, 300)}`);
  const j = JSON.parse(text);
  const content = j?.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error(`${model} returned an EMPTY plan (reasoning ceiling)`);
  return { content, usage: j?.usage, model };
}

const { key, source } = resolveKey();
console.error(`[brain] key from ${source}; roster ${ROSTER.join(' → ')}; brief ${existsSync(BRIEF) ? BRIEF : '(none)'}; ${files.length} file(s) inlined`);

let out = null;
const failures = [];
for (const m of ROSTER) {
  try { out = await ask(m, key); break; }
  catch (err) { failures.push(String(err.message ?? err)); }
}

if (!out) {
  console.error('BRAIN FAILED on every model in the roster:');
  for (const f of failures) console.error('  - ' + f);
  process.exitCode = 1; // not process.exit(): Node 24 on Windows asserts if a fetch handle is still closing
} else {
  console.log(`\n═══ BRAIN PLAN · ${out.model} ═══\n`);
  console.log(out.content);
  if (out.usage) console.log(`\n─── usage: ${out.usage.prompt_tokens} in / ${out.usage.completion_tokens} out ───`);
  console.log('A PLAN IS A SECOND OPINION. Verify each claim against the real code before building on it.');
}
