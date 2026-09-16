---
name: coding-legion
description: Parallel agent swarm for the AMAZENG repo — shard a Brain (ZenMux Legion) plan into dependency-ordered, file-disjoint lanes, execute them with parallel Claude subagents, gate completion on evidence, and muscle-review the merged diff before shipping. Use when the owner says "coding legion", "swarm this", "parallelize", "run lanes", or a Brain plan has 3+ independent increments. Composes Brain→Claude→Lanes→Muscle; never replaces the Brain.
---

# 🦌 Coding Legion — parallel lanes under the Brain & Muscle model (AMAZENG)

The swarm layer executes a **Brain plan** in parallel. It never invents
architecture (that stays the Brain's job — `docs/BRAIN_AND_MUSCLE.md`) and
never ships unreviewed (the merged diff still goes through `npm run muscle`).
Pipeline: **Brain plans → this session orchestrates → the plan file persists
→ subagent lanes execute → integration gate → Muscle reviews.**

Adapted from the public doctrine at `MShanteer/The-Moose-Autonomous-Legion`
(fourteen invariants, listed at the end). AMAZENG-specific wiring is marked
**[AMAZENG]**.

## Phase 0 — Preconditions
- **A running local dev instance** once the stack exists. Lane evidence and
  the integration gate verify against the LIVE app — without a server,
  verification degrades to typecheck-only and the run summary must say so
  explicitly. The orchestrator owns the server: start it before wave 1,
  health-check it between waves, restart it after dependency changes.
  **[AMAZENG]** Until the residency + stack decisions land there is no
  server; every run summary says "typecheck-only".
- A Brain plan exists (`npm run brain -- --files … "…"` output) OR the task is
  mechanical enough that sharding is bookkeeping, not design. When in doubt:
  Brain first.
- Working tree is clean enough to attribute lane diffs.
- The plan file `.swarm/<run-id>.md` is created and committed. It is the lane
  ledger, the claim record, and the post-mortem — no other state tooling is
  required to start a run. `.swarm/OPEN-ITEMS.md` is the standing index of
  in-flight work.

## Phase 1 — Shard (orchestrator, in this session)
Normalize the Brain plan into the plan file. Every task entry carries:

```md
### T<id>: <title>
- depends_on: [T2, T5]        # empty = wave 1
- files: [exact/paths.ts]      # CANONICAL — workers may not invent paths
- new_files: [exact/new.ts]    # names fixed here, not by the worker
- validation: <command or check the worker must run and paste>
- status: pending | running | done | failed | blocked
- log: (worker appends evidence here)
```

Sharding rules:
- **File-disjoint lanes.** Two tasks touching the same file → `depends_on`
  serialization, not parallelism. Reserve `isolation: worktree` for lanes
  that genuinely cannot be file-disjoint.
- Lane size: one subagent-sessionful.
- Shared foundations (schema, generated code, the adapter contracts, i18n
  message catalogs) belong to ONE lane, usually wave 1, that others depend on.
- **[AMAZENG]** The credential model, the consent model and the
  authorization scope helper are foundations. They are never split across
  lanes, and no lane that depends on them starts before they are `done` on
  evidence.

## Phase 2 — Claim
At launch, set `status: running` and record the subagent's task id beside it.
That is the claim. The double-claim guard is the file-disjoint `files:` list
in the lane prompt; the crash detector is the harness's completion
notification. Only the orchestrator retires a lane.

## Phase 3 — Execute in waves (native subagents)
- Compute unblocked tasks → launch that wave as **parallel background
  subagents in a single message** (Agent tool). Cap ~4-6 concurrent.
- Each subagent prompt is a **context pack**: its task block verbatim, the
  plan-file path, exact file list, adjacent-lane awareness ("T7 is editing
  X — do not touch it"), repo ground rules (`AGENTS.md` domain rules,
  `docs/AMAZENG_CONTEXT_BRIEF.md`), and the completion contract:
  - implement ONLY your listed files; new files use the canonical names
  - run your validation command and capture its output
  - typecheck if you touched typed code
  - update your plan-file block (status / log / files)
  - never push; never touch other lanes' files — if you believe you must,
    STOP and report back ("report before touching unlisted paths")
  - **verify the brief, don't trust it** — if a query does not return what
    the brief says, redesign around the truth and say so
- A lane is **done on evidence, not self-report**: the orchestrator checks
  the validation output and the diff before marking `done`.
- Failed lane → requeue once with the failure context; twice → stop the
  wave and consult the Brain.
- **A contract change is broadcast to every live lane the moment it lands**
  (a signature change in one lane bricks another's surface).
- **Cheap mechanical lanes may dispatch to a one-shot model** instead of a
  subagent when the spec is tight and self-contained; the orchestrator still
  verifies the output. **[AMAZENG]** The measured seat is `IMPL_ROSTER` in
  `scripts/legion-key.mjs` (`gpt-5-nano → gpt-5.4-nano → qwen3.8-flash`:
  19/19 hidden tests in 12–18 s, under a cent each). These models failed as
  planners or reviewers, so never let one shape the contract it implements.

## Phase 4 — Integration gate (orchestrator)
After the final wave: full typecheck + build + deploy-to-staging + targeted
live checks. Cross-lane breakage is the orchestrator's to reconcile.
**[AMAZENG]** Live checks always include: issue → unlock → expire → "cannot
unlock" for a credential; a property-scoped read from the wrong property
returns nothing; an RTL screenshot next to the LTR one.

## Phase 4.5 — The bill is part of the gate
After any data-touching lane, read the provider's usage breakdown by function
and find your new function by name. Reactive queries re-read their whole
result set per write per subscriber. Managed backends bill bytes READ, not
returned. Serve derivatives, not originals. Report truncation, never hide it.
Retention runs on a server-stamped time column, in a scheduled pass, never
inline with the write. Crons are multipliers — cheap no-op check first.
Metered vendors (wallet passes, SMS, lock/PMS calls) get a contract in code:
allowlist, idempotency key, monthly ceiling, cost booked at dispatch.

## Phase 5 — Review
`npm run muscle` over the COMBINED diff. Fix findings (small: inline; large:
one fix-lane per finding cluster). Verify each finding against the real code
first — cheap reviewers are sharp on mechanics and unreliable about intent.
Iterate until clean — then normal deploy discipline.

## Phase 6 — Writeback
Close each lane in the plan file with its evidence, append a run summary at
the top, update `.swarm/OPEN-ITEMS.md`, and end with **DONE + WHAT TO TEST**
for the owner. Keep the plan file; it is the post-mortem record.

## Hard rules
- **UI work is verified by PIXELS, not payloads.** Capture a headless-browser
  screenshot and LOOK at it before claiming done. **[AMAZENG]** Both text
  directions.
- The orchestrator NEVER does lane work while a wave runs.
- Secrets never enter the plan file or lane prompts — lanes read env
  themselves.
- One repo, one legion: don't blend plans, reviewers, or state across repos.
- **Never install/update packages while the dev server runs.**
- **Verify a lane's output, not its self-report.**
- **Exit code 0 is not evidence of work.** Check that the artifact exists
  and says something.
- **Fail closed, and count the call sites.** When "make it safe" means "be
  right in N places forever", choose the duplication instead.
- **Never copy reassuring copy across contexts.** Match words to what the
  code does; escalate the confirmation when nothing can undo it.
- **A time column is not a server-time column.** Range retention on a field
  the client cannot set.
- If native Agent Teams are enabled in this build, prefer them for the spawn
  layer — the doctrine is unchanged, only the launch mechanism differs.

## The eighteen invariants (public doctrine, verbatim)
1. Plan file as the shared state machine (`depends_on`, canonical file lists,
   writable status/log per lane)
2. The session that sharded the plan launches and verifies the waves
3. Context packs with canonical naming — workers may not invent paths
4. File-disjoint sharding; worktrees only when disjointness is impossible
5. Commit-per-lane, never push; stage only your own files
6. Evidence-gated completion — validation output, not self-report
7. A combined-diff review by the PLANNER before shipping
8. Leases + idle protocol instead of silent exits; stale lease = dead lane
9. A running local dev instance is a precondition; the orchestrator owns
   the server
10. UI work is verified by PIXELS
11. The bill is part of the gate
12. Truncation is reported, never silent
13. A contract change is broadcast to every live lane the moment it lands
14. Exit code 0 is not evidence of work
15. A review is a verdict-shaped artifact — explicit leading verdict line
    plus a body; a preamble, an empty answer or a bare verdict is not a
    review; nobody reviewing is the failure
16. Seat models by measured role, not by family or price — audition each
    seat on its own job, rubric first, false positives scored as misses,
    every output read; re-audition when the domain or diff size changes
17. Two lineages on anything sensitive, including the review tooling itself
    — agreement without shared context is the strongest signal; disagreement
    is the finding
18. Every rule a spec promises is graded gets a test, and the harness is
    validated against a reference implementation before it grades anyone
