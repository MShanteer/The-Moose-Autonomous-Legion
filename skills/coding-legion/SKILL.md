---
name: coding-legion
description: Parallel agent swarm under a planner/reviewer operating model — shard a plan from your reasoning engine into dependency-ordered lanes, execute them with parallel Claude subagents, gate completion on evidence, and review the merged diff before shipping. Use when the owner says "coding legion", "swarm this", "parallelize", "run lanes", or a plan has 3+ independent increments.
---

# 🦌 Coding Legion — parallel agent lanes

A swarm layer for Claude Code sessions that composes with (never replaces)
a planner/reviewer discipline. Pipeline:

**PLANNER plans → this session orchestrates → state layer persists →
parallel subagent lanes execute → integration gate → PLANNER reviews.**

Adapt the three ROLES to your stack (see `examples/` for two production
adaptations):

- **PLANNER / REVIEWER** — your reasoning engine. In our shops this is the
  OpenAI Codex CLI (`npm run brain "<task>"` to plan, `npm run muscle` to
  review the diff). Any equivalent works — the invariants are: a written
  plan BEFORE sharding, and a review of the MERGED diff before shipping.
- **ORCHESTRATOR** — the Claude Code session reading this skill.
- **STATE LAYER** — durable lane tracking between turns. We use LoopX
  (goals/todos/leases CLI). Without one, the plan file's status fields are
  the fallback ledger — weaker across crashes, still workable.

## Phase 0 — Preconditions
- **A running local dev instance** (the app on localhost + its backend
  dev deployment). Lane evidence and the integration gate both verify
  against the LIVE app — without a server, verification degrades to
  typecheck-only and the run must say so explicitly in its summary.
  The orchestrator owns the server: start it before wave 1, health-check
  it between waves (a wedged dev server serves blank shells that look
  like code bugs), and restart it after dependency changes.
- A written plan exists from the PLANNER, or the task is mechanical enough
  that sharding is bookkeeping, not design. When in doubt: plan first.
- Working tree clean enough to attribute lane diffs.

## Phase 1 — Shard (orchestrator)
Normalize the plan into a **plan file** (e.g. `.swarm/<run-id>.md`) — the
shared state machine. Every task entry carries:

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
  serialization, not parallelism. Reserve git-worktree isolation for lanes
  that genuinely cannot be file-disjoint.
- Lane size: one subagent-sessionful.
- Shared foundations (schemas, generated code, config) belong to ONE lane,
  usually wave 1, that others depend on.

## Phase 2 — Lease (state layer)
Register each lane in your state layer (LoopX: `todo add` + `task-lease`,
claimed as `swarm-<run-id>-T<id>`). One lease per lane — the double-claim
guard and the crash detector (stale lease = dead lane; only the
orchestrator retires lanes).

## Phase 3 — Execute in waves (native subagents)
- Compute unblocked tasks → launch that wave as **parallel background
  subagents in a single message**. Cap ~4-6 concurrent.
- Each subagent prompt is a **context pack**: its task block verbatim, the
  plan-file path, exact file list, adjacent-lane awareness ("T7 is editing
  X — do not touch it"), repo ground rules, and the completion contract:
  - implement ONLY your listed files; new files use the canonical names
  - run your validation command and capture its output
  - typecheck if you touched typed code
  - update your plan-file block (status / log / files)
  - never push; never touch other lanes' files — if you believe you must,
    STOP and report back ("report before touching unlisted paths")
- A lane is **done on evidence, not self-report**: the orchestrator checks
  the validation output and the diff before marking `done` and scheduling
  dependents.
- Failed lane → requeue once with the failure context; twice → stop the
  wave and consult the PLANNER.
- Cheap mechanical lanes may dispatch to a one-shot local agent instead of
  a subagent if you have one — its context pack must be fully
  self-contained and its output always verified by the orchestrator.

## Phase 4 — Integration gate (orchestrator)
After the final wave: full typecheck + build/deploy-to-staging + targeted
live checks. Cross-lane breakage is the orchestrator's to reconcile, not a
lane's.

## Phase 5 — Review
A SECOND reviewer of a different model family strengthens this phase when
available (reviewer diversity catches what one family normalizes) — e.g. a
free NVIDIA NIM-hosted model piped the same diff. Audition new reviewers
with a SEEDED-BUG test first: hand them a diff whose ground-truth defect a
trusted reviewer already caught, and measure catch/miss/hallucination
before trusting their verdicts. Secondary reviewers never gate shipping
alone; the orchestrator adjudicates disagreements.
Hand the COMBINED diff to the REVIEWER. Fix findings (small: inline;
large: one fix-lane per finding cluster). Iterate until clean — then your
normal deploy discipline.

## Phase 6 — Writeback
Complete each lane in the state layer with evidence + a run summary.
Keep the plan file until the run ships; it is the post-mortem record.

## Hard rules
- **UI work is verified by PIXELS, not payloads.** SSR HTML containing the
  right text, HTTP 200s, and a populated DOM all coexist with a blank
  screen (opaque overlays, stacking contexts, hydration wipes). Any lane
  or gate that touches user-visible UI must capture a headless-browser
  screenshot (e.g. Playwright) and LOOK at it before claiming done.
- The orchestrator NEVER does lane work while a wave runs — it launches,
  monitors, verifies, reconciles. Solo work resumes between waves.
- Secrets never enter the plan file or lane prompts — lanes read env
  themselves.
- One repo, one legion: don't blend plans, reviewers, or state across
  repositories.
- **Never install/update packages while the dev server runs** — a live
  watcher holding files during an install corrupts the dependency tree
  in ways that surface as unrelated runtime failures. Stop the server,
  install, restart. Any lane needing a dependency change must hand that
  step back to the orchestrator between waves.
- If Claude Code's native Agent Teams are enabled in your build, prefer
  them for the spawn layer — this doctrine (plan file, leases, waves,
  evidence, review) is unchanged; only the launch mechanism differs.
