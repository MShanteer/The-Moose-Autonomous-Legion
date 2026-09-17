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
import { execSync, execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';

let argv = process.argv.slice(2);
const second = argv.includes('--second');
argv = argv.filter((a) => a !== '--second');
const { roster: ROSTER, rest } = rosterFromArgv(argv, second ? SECOND_ROSTER : MUSCLE_ROSTER);
const target = rest[0];

if (!target) { try { execSync('git add -A -N', { stdio: 'ignore' }); } catch { /* not fatal */ } }

// The ref is passed as an ARGUMENT via execFileSync — no shell is spawned, so
// shell metacharacters are inert. The one real injection is an option-shaped
// argument (`--ext-diff`, `--textconv` make git run a configured helper), and
// no valid git ref starts with `-`, so that is what is refused. Whitespace and
// control characters are refused because git forbids them in refs anyway.
// An allowlist was tried first and rejected legal refs like `feat/a+b`.
if (target && (target.startsWith('-') || /[\s\x00-\x1f\x7f]/.test(target))) {
  console.error(`[muscle] refusing ${JSON.stringify(target)} — a git ref cannot start with '-' or contain whitespace/control characters`);
  process.exit(2);
}
let diff;
try {
  diff = target
    ? execFileSync('git', ['show', '--stat', '--patch', target], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'inherit'] })
    : execFileSync('git', ['diff', 'HEAD'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'inherit'] });
} catch (e) {
  // An unknown ref or a non-repo is an operator error, not a review result.
  console.error(`[muscle] git failed: ${String(e.stderr ?? e.message).trim().split('\n')[0]}`);
  process.exit(2);
}
if (!diff.trim()) {
  console.log('Nothing to review — working tree is clean. Pass a ref to review a commit: npm run muscle -- HEAD');
  process.exit(0);
}
// Binary blobs carry no reviewable content and can make an upstream reject the body.
const cleaned = diff.replace(/^Binary files .*$/gm, '[binary file omitted]');
const CAP = 60000;
// A verdict on bytes nobody saw is not a verdict. If the diff overflows the
// cap, the run is PARTIAL: it still prints the review of what was sent, but
// the banner says so on STDOUT and the exit code is non-zero, so `muscle >
// review.txt` in CI cannot record an unqualified CLEAN for unreviewed code.
const truncated = cleaned.length > CAP;
// The ONLY bytes the model sees. When cut, the model is TOLD so and forbidden
// from saying CLEAN — otherwise the review text itself reads as an unqualified
// pass even though the wrapper exits 3 (a human pasting the text, or CI
// without pipefail, keys off the text).
const sent = truncated
  ? cleaned.slice(0, CAP) + `\n\n[DIFF TRUNCATED: ${cleaned.length - CAP} of ${cleaned.length} chars were NOT included above and were NOT reviewed. VERDICT: CLEAN is not permitted on truncated input — use VERDICT: FINDINGS and make the first finding "diff truncated; remainder unreviewed".]`
  : cleaned;

// Without the repo's review context the reviewer knows none of the product
// invariants. That is allowed for a generic repo, but never silently: warn on
// stderr and tag the banner so a CLEAN from an invariant-free run is visibly
// a weaker CLEAN.
const REVIEW_CONTEXT_PATH = process.env.LEGION_REVIEW_CONTEXT || 'docs/REVIEW_CONTEXT.md';
// Decide on CONTENT, not existence: a zero-byte file (botched checkout, LFS
// pointer) or a directory at that path must count as "no context", loudly.
let contextRaw = '', readError = '';
const contextExists = existsSync(REVIEW_CONTEXT_PATH);
try { contextRaw = contextExists ? readFileSync(REVIEW_CONTEXT_PATH, 'utf8') : ''; }
catch (e) { contextRaw = ''; readError = e.code ?? e.message; }
// A git-LFS pointer is ~130 bytes of text, not empty — reject it explicitly.
const looksLikeLfsPointer = /^version https:\/\/git-lfs\.github\.com\/spec\/v1\b/.test(contextRaw.trimStart());
const hasContext = contextRaw.trim().length > 0 && !looksLikeLfsPointer;
// The reason is derived from the actual state, in order, so the warning
// never says "missing" about a file that is present but empty.
const contextWhy = readError ? `unreadable (${readError})` : !contextExists ? 'missing' : looksLikeLfsPointer ? 'git-LFS pointer, not content' : 'empty';
if (!hasContext) console.error(`[muscle] WARNING: no usable ${REVIEW_CONTEXT_PATH} (${contextWhy}) — reviewing with a generic brief and NO product invariants.`);
const REVIEW_CONTEXT = hasContext ? contextRaw : [
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
        sent,
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
  // Everything that can reject — the fetch, a 200 with an HTML body, JSON
  // parsing — is caught per model so the roster fallback actually happens.
  // brain.mjs always did this; the first cut of this loop did not.
  let content, u;
  try {
    const res = await fetch(`${GATEWAY}/chat/completions`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ ...body, model }),
    });
    if (!res.ok) { console.error(`[skip] ${model} -> HTTP ${res.status} ${(await res.text()).slice(0, 160)}`); continue; }
    const json = await res.json();
    content = json.choices?.[0]?.message?.content?.trim();
    u = json.usage ?? {};
  } catch (err) {
    console.error(`[skip] ${model} -> ${String(err?.message ?? err).slice(0, 160)}`);
    continue;
  }
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

  // The instruction to the model is advisory; this is not. A CLEAN on
  // truncated input is downgraded HERE, so the stdout artifact never carries
  // an unqualified CLEAN for bytes nobody reviewed (both lineages, same pass).
  const downgraded = truncated && verdict === 'CLEAN';
  const shown = downgraded ? 'FINDINGS (downgraded from CLEAN: partial input)' : verdict;
  // …and the BODY's own first line, which is the machine-readable verdict a
  // `grep '^VERDICT: CLEAN'` would key off. Banner and body must agree.
  // Replace the whole first line (the gate already guarantees it IS the
  // verdict line), keeping any trailing prose the model put after the verdict.
  const shownContent = downgraded
    ? 'VERDICT: FINDINGS (downgraded from CLEAN: partial input — remainder unreviewed)' + (vm[2] ? ' ' + vm[2].replace(/[*_`]+$/, '') : '') + (nl === -1 ? '' : content.slice(nl))
    : content;
  console.log(`\n═══ MUSCLE REVIEW · ${model} · ${shown}${truncated ? ' · PARTIAL' : ''}${hasContext ? '' : ' · GENERIC BRIEF (no product invariants)'} ═══\n`);
  if (truncated) console.log(`⚠️  PARTIAL REVIEW: ${cleaned.length - CAP} of ${cleaned.length} chars were NOT sent (cap ${CAP}). Whatever the text below says, this is NOT a pass: split the change and review the rest.\n`);
  console.log(shownContent);
  console.log(`\n─── usage: ${u.prompt_tokens} in / ${u.completion_tokens} out ───`);
  console.log('VERIFY EVERY FINDING against the real code before acting on it.');
  console.log('The reviewer is a second opinion, not an authority.');
  process.exitCode = truncated ? 3 : 0; // partial is never a pass
  reviewed = true;
  break;
}

if (!reviewed) {
  console.error('No model on the roster produced a review. Do NOT treat that as CLEAN.');
  process.exitCode = 1;
}
