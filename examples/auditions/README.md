# Audition kit — worked example

Three scripts that pick a roster by measurement. The fixtures inside them are
from a hotel digital-key system (AMAZENG, 2026-09-15) **on purpose**: an
audition only works when the task carries bugs and traps you already know
about, so you must replace them with your own. The method is the product;
the fixture is the example. Method and results: [`../../docs/AUDITION_METHOD.md`](../../docs/AUDITION_METHOD.md).

| Script | Measures | Grade produced by |
|---|---|---|
| `audition-review.mjs` | reviewing a diff — 4 planted bugs + 1 decoy | regex triage, then **reading every output** |
| `audition-brain.mjs` | planning — a request with 5 wrong requirements | regex triage, then reading the full plans it writes to disk |
| `audition-impl.mjs` + `audition-impl.tests.mjs` | building — a precise spec, one module back | **executing** a hidden test harness |

```bash
npm run audition:review                      # default candidates
npm run audition:brain -- model/a,model/b     # your own list
npm run audition:impl
```

## Adapting to your codebase

1. **Review:** replace `DIFF` with a diff from your repo that carries bugs
   you have already fixed. Keep a decoy — something correct that looks wrong.
   Rewrite `RUBRIC` and `FALSE_POS` **before** running anything.
2. **Brain:** replace `SOURCE` with two or three of your real files and
   `TASK` with a request containing requirements that are wrong for your
   codebase. Put the facts needed to refuse them in the source. Rewrite `R`
   and `FP`. Drop a `docs/CONTEXT_BRIEF.md` in your repo and it is inlined.
3. **Impl:** rewrite `SPEC` and the harness together. Validate the harness
   against a reference implementation you write yourself **first** — a
   harness bug fails every candidate identically and looks like a model
   problem. Every rule the spec states gets a test.

Keep the outputs. Read them. The regex is triage.
