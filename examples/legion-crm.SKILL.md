---
name: coding-legion
description: Parallel agent swarm for the Legion repo — shard a Codex (Brain) plan into dependency-ordered lanes and execute them with parallel Claude subagents under LoopX leases, then muscle-review the merged diff. Use when the owner says "coding legion", "swarm this", "parallelize", "run lanes", or a Brain plan has 3+ independent increments. Composes Codex→Claude→LoopX→Swarm; never replaces the Brain.
---

# 🦌 Coding Legion — parallel lanes under the Brain & Muscle model (Legion)

The swarm layer executes a **Codex plan** in parallel. It never invents
architecture (that stays the Brain's job — `docs/BRAIN_AND_MUSCLE.md`) and
never ships unreviewed (the merged diff still goes through `npm run muscle`).
Pipeline: **Codex plans → this session orchestrates → LoopX persists → 
subagent lanes execute → integration gate → Codex reviews.**

Synthesized from ClawTeam (worker/lease protocol), am-will/swarms (plan-file
state machine, waves, context packs), affaan-m/claude-swarm (quality gate,
file-disjoint sharding), and Anthropic's native Agent Teams protocol shapes.

## Phase 0 — Preconditions
- A Brain plan exists (`npm run brain "…"` output) OR the task is mechanical
  enough that sharding is bookkeeping, not design. When in doubt: Brain first.
- Working tree is clean enough to attribute lane diffs (commit or stash noise).
- LoopX goal is bootstrapped (`.loopx/registry.json`; Legion goal:
  `legion-upgrade-2026-08` unless a new goal fits better).

## Phase 1 — Shard (orchestrator, in this session)
Normalize the Brain plan into a **plan file** at `.codex/swarm/<run-id>.md` —
the shared state machine. Every task entry carries:

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
  serialization, not parallel. Reserve `isolation: worktree` subagents for
  lanes that genuinely cannot be file-disjoint.
- Lane size: one subagent-sessionful (roughly one Brain increment or less).
- Shared-schema edits (convex/schema.ts, `_generated`) belong to ONE lane,
  usually wave 1, that others depend on.

## Phase 2 — Lease (LoopX)
For each task: `loopx todo add --goal-id <goal> --text "SWARM <run-id> T<id>: …"`
then claim at launch with `loopx task-lease` / `--claimed-by swarm-<run-id>-T<id>`.
One lease per lane — LoopX is the double-claim guard and the crash detector
(stale lease = dead lane; only the orchestrator retires lanes).

## Phase 3 — Execute in waves (native subagents)
- Compute unblocked tasks → launch that wave as **parallel background
  subagents in a single message** (Agent tool). Do not exceed ~4-6 concurrent.
- Each subagent prompt is a **context pack**: its task block verbatim, the
  plan-file path, exact file list, adjacent-lane awareness ("T7 is editing
  convex/tickets.ts — do not touch it"), repo ground rules (Convex guidelines,
  `docs/LEGION_CONTEXT_BRIEF.md`), and the completion contract below.
- **Completion contract** (every lane): implement ONLY your files; run your
  validation command and capture output; `npx tsc --noEmit` if you touched
  TS; update your plan-file block (status/log/files); DO NOT push, DO NOT
  touch other lanes' files — if you believe you must, STOP and report back
  instead ("report before touching unlisted paths").
- A lane is **done on evidence, not self-report**: the orchestrator checks
  the validation output in the log and the diff before marking `done`,
  completing the LoopX todo, and scheduling dependents.
- Failed lane → mark `failed`, requeue once with the failure context; twice →
  stop the wave and consult the Brain.

## Phase 4 — Integration gate (orchestrator)
After the final wave: full `npx tsc --noEmit` + `npx convex dev --once`
(dev deploy) + targeted live checks on localhost — cross-lane breakage is
the orchestrator's to reconcile, not a lane's.

## Phase 5 — Brain review
`npm run muscle` over the COMBINED diff (the affaan-m "quality gate", executed
by our senior reviewer). Fix findings (small: inline; large: one fix-lane per
finding cluster). Iterate until clean — then normal deploy discipline.

## Phase 6 — Writeback
`loopx todo complete` each lane with evidence + a run summary note on the
goal. Delete `.codex/swarm/<run-id>.md` only after the run ships; it is the
post-mortem record until then.

## Hard rules
- The orchestrator (this session) NEVER does lane work itself while a wave
  runs — it launches, monitors, verifies, reconciles (OpenSwarm's one good
  rule). Solo work resumes only between waves or for the integration gate.
- Secrets never enter the plan file or lane prompts — lanes read env
  themselves.
- Legion-only: do not blend with another repo's brain/muscle/LoopX. The
  WeatherOps repo has its own copy of this skill wired to its own stack.
- If Claude Code's native Agent Teams are enabled in your build
  (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`), prefer them for the spawn layer
  — this doctrine (plan file, leases, waves, evidence, review) is unchanged;
  only the launch mechanism differs.
