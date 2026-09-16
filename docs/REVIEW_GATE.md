# The gate that grades the gate

`scripts/muscle.mjs` refuses to call anything a review unless it is
**verdict-shaped**: the first line is `VERDICT: CLEAN` or `VERDICT: FINDINGS`
(markdown and list markers stripped, trailing prose allowed) and there is a
word-bearing body after it. Anything else falls through to the next model on
the roster, and if nobody produces a real review the gate exits non-zero.
This document is why, because the rule looks fussy until you see what it
replaced.

## The failure it closes

A model returned, on a 29,000-character diff:

> Let me examine the key files more closely to understand the full context of the changes.

Non-empty. Exit 0. Zero findings. 3,220 output tokens spent reasoning. The
gate printed it under a `MUSCLE REVIEW` banner and the operator would have
read "reviewed". This is the same failure as an agent that burns its turn on
a preamble and exits clean, and the same failure as a reviewer that consumed
its input, wrote nothing, and exited 0 because the diff contained one invalid
byte. **Exit code 0 is not evidence of work.** Neither is non-empty output.

## Seven passes to get one regex right

The fix went through the gate itself, seven times, across two model
lineages. Every pass found a real defect in the previous fix.

| Pass | What was tried | What the reviewers found |
|---|---|---|
| 1 | Accept any non-empty content | The preamble above passed. |
| 2 | Vocabulary heuristic: content must mention `CLEAN`, `defect`, `finding`, `file:`… and be ≥ 200 chars | Both lineages, independently: a restatement that says "file:" passes; a terse, correct `CLEAN` under 200 chars fails. Both proposed an explicit `VERDICT:` marker. |
| 3 | Prompt demands a first-line `VERDICT:`; regex with the `m` flag | The `m` flag matches any line start, so a preamble *ending* in `VERDICT: CLEAN` passes. Separately, a model returned exactly `VERDICT: FINDINGS` and nothing else — verdict-shaped, empty. |
| 4 | No `m`; body must be ≥ 80 chars | Both lineages again: the floor discards a terse correct `CLEAN` plus one-line risk — the exact false skip pass 2 was rejected for. Also: the prompt still said "say CLEAN" above "first line must be VERDICT: CLEAN". |
| 5 | Body must be non-empty; prompt wording aligned | My own bug: the review body variable shadowed the request body. Crash, exit 1 — the gate caught it. Then: the audition scorer's negation list contained the decoy's own code comment, so quoting the code cleared a false positive. |
| 6 | Normalize the first line before matching | `VERDICT: **FINDINGS**` (bold on the value only) was discarded. `VERDICT: FINDINGS.` with a trailing period produced a body of `"."`, which is non-empty. The reviewer's own second finding was cut mid-sentence at exactly 16,000 output tokens. |
| 7 | Strip markdown and list markers, allow trailing prose, body must contain a word character, raise the cap to 24k | CLEAN from both lineages. |

Thirteen confirmed defects in the review tooling. Zero in the product docs it
was reviewing. **The reviewer reviewing the reviewer is where the tooling
defects live.** Keep running both lineages on anything under `scripts/`.

## Rules that fell out of it

- **Explicit beats inferred.** A verdict you have to guess from vocabulary or
  length will be wrong in both directions. Demand a marker; key off the
  marker; nothing else.
- **First line means first line.** Not "a line somewhere".
- **A verdict needs a body.** Words, not punctuation.
- **Normalize, then match.** Models bold things, bullet things, add periods.
- **Give the reviewer headroom.** `max_tokens` caps reasoning *and* content.
  A cut-off finding is a lost finding.
- **Falling through is not failing.** Skip the model that did not review and
  try the next one. Nobody reviewing is the failure.
- **Two lineages, always, on tooling.** The same finding from two families
  with no shared context is the strongest signal this system produces.
