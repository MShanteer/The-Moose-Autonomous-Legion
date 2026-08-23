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
- **STATE LAYER** — durable lane tracking between turns. **The plan file
  is the default**, committed to the repo: it survives context compaction,
  a human can review it, and it becomes the post-mortem record. Your
  harness's task ids and completion notifications are the crash detector.
  A dedicated leases CLI earns its place only when the ORCHESTRATOR itself
  may die mid-run, or two independent orchestrators share one repo —
  otherwise it is ceremony that raises adoption cost for no measured
  return. Do not let tooling you have not installed block a run.

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

## Phase 2 — Claim (state layer)
Give every lane an owner and a way to tell whether it is still alive. The
mechanism is negotiable; these three properties are not:

- **One lane per file.** File-disjoint assignment, written into the lane
  prompt, IS the double-claim guard. Two lanes told they own the same file
  will collide no matter what a lease says — so spend the effort in Phase 1
  sharding, not on a runtime refusal.
- **Liveness must be observable.** You have to answer "is T4 still running?"
  without asking T4. Background task ids plus completion notifications do
  this natively. If your harness can't, a lease timestamp is the fallback:
  stale lease = dead lane.
- **Only the ORCHESTRATOR retires a lane.** A lane never marks itself done —
  see Phase 3.

Record the claim wherever it is durable; the plan file's `status` field is
enough, and it is the option a reader can adopt today. Add a leases CLI only
if your orchestrator can crash and be replaced mid-run, so its successor can
tell a dead lane from a slow one.

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

## Phase 4.5 — The bill is part of the gate

A lane is not done because it compiles. Usage spikes are **defects**, and they
are invisible in a diff — they show up on an invoice weeks later. One product
cycle produced a single billing period **1.04 TB over** its egress allowance,
**371 GB over** on storage and **61 GB over** on database I/O, from three
features no code review would have flagged.

**After any data-touching lane, read the provider's usage breakdown by
function and find your new function by name.** If it is near the top of any
tab, the lane is not finished.

Four burn patterns, each of which shipped through review:

1. **A reactive query re-reads its ENTIRE result set on every write to the
   tables it touches — once per subscribed client.** The cost is
   `rows x bytes/row x writes x viewers`, not "one query". One such query over
   1,500 denormalized rows, subscribed by every open map, reached **39 GB in
   a month**. Before adding a write to a hot table, ask which subscription
   you just invalidated.
2. **Managed backends bill BYTES READ, not bytes returned.** Trimming fields
   from a return value saves nothing. To spend less you must read *fewer*
   documents or *smaller* ones — narrow the index range, scope to a viewport,
   or move the fat denormalized fields off the row the hot query reads.
3. **Serving originals where a derivative belongs.** An import path stored
   40,000 photos and generated **zero** thumbnails — the encoder lived in the
   browser and the importer ran on the server — so every gallery tile pulled
   a 700 KB original where 30 KB was designed to go. A 23x multiplier on
   every grid load, and the origin of that terabyte. **Anything a grid
   renders needs a derivative generated at write time.**
4. **Unbounded reads and silent caps.** A `.collect()` on a per-tenant table
   is a time bomb. A `.take(N)` that truncates without saying so is a
   correctness bug wearing a performance costume — **report the truncation**,
   name what is missing, and prefer a bound that can be described ("complete
   back to Aug 14") over a bare "some rows are missing".

Related rules that cost real money to learn:

- **Crons are multipliers.** A five-minute cron is 288 runs a day, forever.
  Put the cheap no-op check FIRST — two abandoned test records left a sweep
  polling an external API ~25,000 times for nothing.
- **Metered vendors need a contract in code**, not a comment: an allowlist of
  the products you may buy, the price on the button before the click, a
  deterministic idempotency key so a retry or double-click cannot bill twice,
  a monthly ceiling, and **cost booked at dispatch, not on success** — a call
  that bills and then times out still counts.
- **Write backfills so they can be run again.** Cursor-paged, idempotent,
  dry-run by default, typed confirm to apply. One repair crashed on a DNS
  blip at 38,200 of 40,000 rows and resumed with zero duplicated work. A
  backfill you cannot re-run is a backfill you will run wrong once.

## Phase 5 — Review
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
- **A contract change must be BROADCAST to every live lane.** When one lane
  changes a mutation signature, other lanes are still coding against the old
  one and will ship a bricked surface. In one run a geofence lane made
  coordinates mandatory; the map lane had already finished without them, and
  every field note would have been refused on deploy. The orchestrator owns
  this: the moment a lane reports a signature change, message the others.
- **Lanes must verify the brief, not trust it.** A brief written by the
  orchestrator is a hypothesis. One lane was told a query returned two fields
  it did not return, checked, and redesigned around the truth instead of
  building on sand. Reward that; a lane that silently "fixes" a wrong brief
  by inventing data is the failure mode.
- **Verify a lane's output, not its self-report.** Lanes exit early, report on
  their own build watchers, and occasionally return a verdict with no work
  behind it. Check the diff and run the gate yourself.
- **A reviewer's confident verdict can be fiction.** A free-lane review once
  returned two P0s claiming a security fix broke a portal flow; the flow it
  named was called by nothing. Adjudicate findings against *intent*, not just
  mechanics — cheap reviewers are sharp on mechanical audits and unreliable
  about why a change was made.
- **Never copy reassuring copy across contexts.** One surface's "archive"
  promises the data survives; another's "remove" is a hard delete. Reusing
  the friendly sentence makes the product lie. Match the words to what the
  code actually does, and escalate the confirmation when nothing can undo it.
- **Fail closed, and count the call sites.** A discriminator shared across
  15 queries where none filtered on it would have granted telephony
  authority from an unrelated assignment — two of those paths failed *open*.
  When "make it safe" means "be right in fifteen places forever", choose the
  duplication instead.
- If Claude Code's native Agent Teams are enabled in your build, prefer
  them for the spawn layer — this doctrine (plan file, leases, waves,
  evidence, review) is unchanged; only the launch mechanism differs.
