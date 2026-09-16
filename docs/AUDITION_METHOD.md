# Seat by measurement: the three-audition method

The README's roster section was written after one product cycle and named the
models that worked there. The next domain — a hotel digital-key system,
2026-09-15 — overturned it in an afternoon. The proven reviewer scored 1 of 4
with a false positive. The proven planner family split down the middle: one
member planned superbly, its smaller sibling built superbly and planned
disastrously. **Nothing about a model's name, price, or reputation predicted
its seat.** Only measurement did.

This document is the method, with that afternoon's results as the worked
example. The runnable kit is in `examples/auditions/`. Replace the fixtures
with your own domain; keep the discipline.

## The discipline (applies to all three)

1. **Fix the rubric before you read any output.** Decide what a correct
   answer must contain, and what a wrong answer looks like, in writing, first.
2. **Seed the task with things you already know.** Planted bugs in a diff.
   Wrong requirements in a planning request. Rules a spec promises that a
   sloppy build would skip. You are testing whether the model reads, not
   whether it sounds right.
3. **Include a decoy.** Something correct that a naive reader would flag. A
   model that flags it is guessing. **Score false positives as hard as
   misses** — a reviewer that cries wolf trains the team to ignore it.
4. **Read every output.** The regex score is triage. In the worked example the
   regex mis-read two of fourteen reviewers, missed one planner's correct
   pushback, and scored quotations of the wrong requirement as obedience.
   Every seat decision stood on the read-through.
5. **Grade builders by execution, never by regex.** A hidden test harness,
   validated against a reference implementation first. Every rule the spec
   states gets a test — twice in the worked example a reviewer found a rule
   the spec promised was graded and nothing exercised.
6. **Run the candidates in parallel, at temperature 0, and expect variance
   anyway.** One planner scored 3/5 then −2/5 by regex on identical input; on
   reading, both runs made the same core mistake. Two runs for contested seats.
7. **Keep every output on disk.** A 900-character excerpt is never enough to
   judge a plan.
8. **A run where nobody answered is a failed run, not an empty leaderboard.**
   Exit non-zero.
9. **Re-audition when the work changes shape.** Seats chosen on a 3k-token
   fixture do not transfer to 30k-token real diffs — one model aced the
   fixture and then returned a preamble, and later a bare verdict line, on the
   real thing.

## Audition 1 — reviewers (`audition-review.mjs`)

**Fixture:** one 78-line diff with four planted defects and one decoy.

| Planted | What a reviewer must catch |
|---|---|
| expiry | `canUnlock` checks status but never the validity window |
| fail-open | `listCredentials` with no scope returns every tenant's rows |
| swallow | `revoke` catches everything and returns `{ ok: true }` |
| consent | issuing a pass sets marketing consent to true — consent implied |
| **decoy** | read-then-insert inside a serializable transaction, with a comment saying so and the prompt saying so; flagging it as a race or asking for a unique index is a false positive |

**Result (14 candidates, all cheap tier):** six caught all four with no false
positive. The incumbent from the previous domain opened with CLEAN, then
listed a finding, missed two bugs, and flagged the decoy. One model found all
four and invented a fifth that the regex did not catch — reading did.

## Audition 2 — planners (`audition-brain.mjs`)

**Fixture:** a planning request with five wrong requirements embedded in it,
plus source files that contain the facts needed to refuse them.

| Trap | The request said | A correct plan does |
|---|---|---|
| clock | sweep expiry on a timestamp | notices the schema comment says the client stamps it; moves it server-side |
| cron | a 60-second full-table cron | enforces at read time; indexed range, not a scan; low-frequency sweeper for reporting |
| index | add a unique index | the source says the backend has none; the serializable read-then-insert already is the constraint |
| consent | set marketing consent on issue | refuses; separate record, separate lifecycle |
| hosting | deploy to a region the brief left undecided | gates on the decision |

**Result (10 candidates):** four cheap models and one mid-price OpenAI model
refused all five with product reasons. The cheapest OpenAI model obeyed the
consent trap in both runs *while quoting the invariant it was breaking*, kept
the cron, and never mentioned the clock. Its mid-size sibling and the
"luna" tier planned well. **Same family, opposite seats.**

## Audition 3 — builders (`audition-impl.mjs` + `audition-impl.tests.mjs`)

**Fixture:** a precise five-function spec with injected dependencies; the
model returns one module; a hidden 19-test harness grades it.

**Result (15 candidates):** thirteen passed everything. The task ranks cost
and speed, not correctness — a precise spec is easy. The model that failed
planning was the fastest, cheapest correct builder (12 s, under a tenth of a
cent). One model dropped the `export` keyword the spec required and could not
be imported. One free model returned nothing at its reasoning ceiling. One
correct model spent 36,000 output tokens where the fastest spent 1,500.

**Two gaps the harness had, found by the review gate reviewing the audition
kit itself:** the spec promised a 200-row cap and inclusive window edges, and
nothing tested either. An uncapped read and an off-by-one both scored full
marks until the tests were added and every saved module re-graded (offline —
keep the modules).

## What it decided (on that domain; yours will differ)

| Seat | Roster | Why |
|---|---|---|
| Brain | deepseek-v4.1-flash → glm-5.3-flash → ling-3.0-flash | 5/5 traps each; deepseek alone reasoned from the offline lock |
| Brain, 2nd lineage | gpt-5.6-luna → gpt-5-mini | 5/5, different lineage, ~$0.004 a plan; for owner-decision questions |
| Muscle | deepseek-v4.1-flash → ling-3.0-flash | 4/4, no false positive |
| Muscle, 2nd lineage | tencent/hy3 → glm-5.3-flash | 4/4; answered every real-size diff |
| Implementation lanes | gpt-5-nano → gpt-5.4-nano → qwen3.8-flash | 19/19 in 12–18 s; failed as planners or reviewers, so they build to a contract they did not write |

Off every seat: the free model that went empty at the ceiling twice; the model
that invented a review finding and dropped a required keyword; a "contributor"
tier whose terms likely license prompts for training (unread — do not send it
customer data until read).

## Cost of knowing

The whole afternoon — three auditions, roughly forty model calls, two
re-runs — cost under fifteen cents. The wrong roster would have cost a
security invariant.
