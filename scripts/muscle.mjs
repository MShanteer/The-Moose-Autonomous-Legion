#!/usr/bin/env node
// ══ MUSCLE — the Legion reviews your diff before you push ═══════════════
//
//   npm run muscle                 review uncommitted changes (new files included)
//   npm run muscle -- HEAD         review the last commit
//   npm run muscle -- --second     same diff, a different model lineage
//   npm run muscle -- --roster a,b explicit roster for this run
//
// Repo-specific review context, optional: docs/REVIEW_CONTEXT.md — the
// false-positive classes your backend makes likely and what to actually look
// for. Without it the reviewer gets a generic brief.
//
// This exists because the rule needs to be RUNNABLE. A doctrine you cannot
// execute in one command is a doctrine that gets skipped, and every defect
// the production repos shipped came from skipping it.
//
// Every non-obvious line below is a bug that already cost a session:
//   - key resolution is file-before-env (a stale OS-level key 403s);
//   - reasoning_effort=low, or reasoning eats the budget and content is "";
//   - `git add -N` so brand-new files appear in the diff (the first run of
//     this script's ancestor reported ITSELF missing);
//   - a roster with fallback, because free tiers 500 on their own schedule;
//   - the VERDICT gate below — see docs/REVIEW_GATE.md for the seven review
//     passes it took to get it right;
//   - no model answering is a FAILURE, never CLEAN.

import { resolveKey, MUSCLE_ROSTER, SECOND_ROSTER, rosterFromArgv, GATEWAY } from './legion-key.mjs';
import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';

let argv = process.argv.slice(2);
const second = argv.includes('--second');
argv = argv.filter((a) => a !== '--second');
const { roster: ROSTER, rest } = rosterFromArgv(argv, second ? SECOND_ROSTER : MUSCLE_ROSTER);
const target = rest[0];

if (!target) { try { execSync('git add -A -N', { stdio: 'ignore' }); } catch { /* not fatal */ } }

const diff = execSync(target ? `git show --stat --patch ${target}` : 'git diff HEAD', { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
if (!diff.trim()) {
  console.log('Nothing to review — working tree is clean. Pass a ref to review a commit: npm run muscle -- HEAD');
  process.exit(0);
}
// Binary blobs carry no reviewable content and can make an upstream reject the body.
const cleaned = diff.replace(/^Binary files .*$/gm, '[binary file omitted]');
const CAP = 60000;

const REVIEW_CONTEXT = existsSync('docs/REVIEW_CONTEXT.md') ? readFileSync('docs/REVIEW_CONTEXT.md', 'utf8') : [
  'WHAT TO ACTUALLY LOOK FOR: authorization that fails open; unbounded reads',
  'and silent truncation; swallowed catches and unawaited promises; exit 0 with',
  'no artifact; copy that promises what the code does not do; wrong hook usage,',
  'missing skip-conditions, null/undefined handling.',
].join('\n');

const body = {
  messages: [
    {
      role: 'system',
      content:
        'You are a rigorous code reviewer. Report ONLY defects you can point at ' +
        'in the diff, most severe first. For each: file, the concrete failure ' +
        'scenario (inputs -> wrong output), and the fix. If the code is sound, ' +
        'your first line is VERDICT: CLEAN and the body names the strongest ' +
        'remaining risk. Never invent issues to seem useful, and never restate ' +
        'what the code does.\n\n' +
        'YOUR FIRST LINE MUST BE EXACTLY ONE OF:\n' +
        'VERDICT: CLEAN\n' +
        'VERDICT: FINDINGS\n' +
        'No preamble before it. Output without that first line is discarded unread.',
    },
    {
      role: 'user',
      content:
        'Review this UNIFIED DIFF.\n\n' +
        'READ THE DIFF MARKERS. Lines starting with "-" are REMOVED and no longer ' +
        'exist in the file. Lines starting with "+" are the new state. Never report ' +
        'deleted code as leftover, dead, or still present.\n\n' +
        REVIEW_CONTEXT + '\n\n' +
        cleaned.slice(0, CAP),
    },
  ],
  temperature: 0,
  // 24k, not 16k: max_tokens caps reasoning + content together, and a 44k-char
  // diff once cut a finding mid-sentence at exactly 16,000 output tokens.
  max_tokens: 24000,
  reasoning_effort: 'low',
};

let reviewed = false;
const { key, source } = resolveKey();
console.error(`[muscle] key from ${source}; roster ${ROSTER.join(' → ')}; diff ${cleaned.length} chars${cleaned.length > CAP ? ` (TRUNCATED to ${CAP} — review in smaller commits)` : ''}`);

for (const model of ROSTER) {
  const res = await fetch(`${GATEWAY}/chat/completions`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({ ...body, model }),
  });
  if (!res.ok) { console.error(`[skip] ${model} -> HTTP ${res.status} ${(await res.text()).slice(0, 160)}`); continue; }
  const json = await res.json();
  const content = json.choices?.[0]?.message?.content?.trim();
  const u = json.usage ?? {};
  if (!content) { console.error(`[skip] ${model} -> empty content (reasoning_tokens=${u.completion_tokens_details?.reasoning_tokens ?? '?'})`); continue; }

  // THE VERDICT GATE. A review is a verdict-shaped artifact: the FIRST line
  // is the verdict (markdown and list markers stripped, trailing prose
  // allowed), and there is a word-bearing body after it. Everything else —
  // "Let me examine the files…", a bare "VERDICT: FINDINGS.", a verdict
  // buried at the end of a preamble — is NOT a review and falls through to
  // the next model. Inferring review-ness from vocabulary was tried first and
  // rejected by two independent reviewers; keying off length discarded terse
  // correct answers. Explicit beats inferred.
  const nl = content.indexOf('\n');
  const firstLine = (nl === -1 ? content : content.slice(0, nl)).replace(/^[\s\-\>*_`#]+/, '').replace(/[*_`#]/g, '').trim();
  const vm = firstLine.match(/^VERDICT:\s*(CLEAN|FINDINGS)\b[.!:—–-]*\s*(.*)$/i);
  const verdict = vm?.[1]?.toUpperCase();
  if (!verdict) { console.error(`[skip] ${model} -> first line is not a VERDICT line (preamble or off-format): ${JSON.stringify(content.slice(0, 120))}`); continue; }
  const reviewBody = ((vm[2] ?? '') + '\n' + (nl === -1 ? '' : content.slice(nl + 1))).trim();
  if (!/\w/.test(reviewBody)) { console.error(`[skip] ${model} -> VERDICT: ${verdict} with no body (reasoning ceiling?)`); continue; }

  console.log(`\n═══ MUSCLE REVIEW · ${model} · ${verdict} ═══\n`);
  console.log(content);
  console.log(`\n─── usage: ${u.prompt_tokens} in / ${u.completion_tokens} out ───`);
  console.log('VERIFY EVERY FINDING against the real code before acting on it.');
  console.log('The reviewer is a second opinion, not an authority.');
  process.exitCode = 0;
  reviewed = true;
  break;
}

if (!reviewed) {
  console.error('No model on the roster produced a review. Do NOT treat that as CLEAN.');
  process.exitCode = 1;
}
