# The Moose Autonomous Legion

**A parallel agent swarm skill for Claude Code** — by [MTS Moose Tech
Solutions](https://mts-llc.tech).

Shard a plan from your reasoning engine into dependency-ordered lanes,
execute them with parallel Claude subagents, gate completion on evidence,
and review the merged diff before anything ships.

```
PLANNER plans → Claude orchestrates → state layer persists
      → parallel lanes execute → integration gate → PLANNER reviews
```

In production at MTS this runs as **Codex → Claude → LoopX → Legion**: the
OpenAI Codex CLI writes and reviews plans, the Claude Code session
orchestrates, LoopX persists lanes between turns, and native subagents do
the work in parallel waves.

## Install

Copy the skill into your repo's Claude Code skills directory:

```bash
mkdir -p .claude/skills/coding-legion
curl -fsSL https://raw.githubusercontent.com/MShanteer/The-Moose-Autonomous-Legion/master/skills/coding-legion/SKILL.md \
  -o .claude/skills/coding-legion/SKILL.md
```

(or clone and copy `skills/coding-legion/` — any tool that installs
`skills/<name>/SKILL.md` layouts works too.)

Then in a Claude Code session: `/coding-legion` — or just say
"swarm this" / "run lanes" when you have a plan with independent parts.

## Adapt it to your stack

The skill is deliberately role-parameterized:

| Role | Ours | Yours |
|---|---|---|
| PLANNER / REVIEWER | OpenAI Codex CLI (`npm run brain` / `npm run muscle`) | any engine that writes plans + reviews diffs |
| ORCHESTRATOR | the Claude Code session | same |
| STATE LAYER | LoopX (goals / todos / leases) | anything durable; plan-file statuses as fallback |
| WORKERS | native Claude subagents (+ a one-shot local agent for cheap lanes) | same |

See [`examples/`](examples/) for the two production adaptations
(a Convex/Next.js CRM and a large SaaS monorepo) showing repo-specific
wiring: deploy discipline, context briefs, goal ids, and a cheap-worker
dispatch lane.

## Wiring the PLANNER — read this before you trust it

**[`docs/PLANNER_SETUP.md`](docs/PLANNER_SETUP.md)** — the part nobody warns
you about. Legion is only as good as the engine that plans and reviews, and
that wiring fails *silently*:

> **An empty run that exits 0 is the default failure mode.** Four unrelated
> causes all produce a clean exit code, no findings, and a pipeline that
> believes it was reviewed.

Documented with the evidence from breaking each one in production:

1. **The model is fine, the transport is broken.** Your CLI speaks one wire
   protocol; the gateway advertises many models. Models that fail through the
   CLI return clean answers over `/chat/completions` with the same key.
   [`scripts/zen.mjs`](scripts/zen.mjs) is the escape hatch — and the only way
   to get a reviewer from a different vendor lineage than the author.
2. **MCP tool calls cancelled by a user who isn't there.** Headless runs can't
   answer an approval prompt, so tools "fail" and the agent silently falls back
   to guessing. Includes the four narrower fixes that do *not* work.
3. **Your own `AGENTS.md` can eat the whole run.** A rules file that says
   "acknowledge before any action" is obeyed literally: the agent acknowledges,
   ends its turn, does nothing, exits 0. This killed two production audits.
4. **Don't pipe a diff when the agent can read the repo.** There's a hard input
   cap (~1MB), and a diff with no surrounding code yields `UNVERIFIED` — a
   NO-GO that means "I couldn't see enough", not "I found a defect".
5. **One goal per call.** A headless agent executes one goal and *narrates*
   several. A seven-part audit produced a plan and a stopped turn; the same
   agent given one of those questions answered it with line numbers. This is
   prompt *shape*, not wording — decompose, don't cajole.
6. **The reviewer must not be the author** — with a worked example in which a
   same-lineage reviewer returned "FAIL-CLOSED, safe to ship" on a live
   permission change, and a different-lineage reviewer found four blockers on
   the same diff. One had been *introduced by an earlier fix written against a
   misdiagnosis*.
7. **Verify the guard, in both directions.** The regression test written for
   that bug was broken twice — once by regex escaping that made a negative
   check report a false PASS, once by a fixed-width window that matched a dead
   code branch. Both looked green against fixed code; neither would have caught
   the bug. Mutation-test against the buggy revision, or you have an assumption
   wearing a test's clothing.

Plus a checklist to run before trusting the pipeline.

## Design lineage

Synthesized from an evaluation of five public multi-agent systems:
[am-will/swarms](https://github.com/am-will/swarms) (plan-file state
machine, waves, context packs — the backbone),
[HKUDS/ClawTeam](https://github.com/HKUDS/ClawTeam) (worker/lease
protocol, dependency auto-unblock),
[affaan-m/claude-swarm](https://github.com/affaan-m/claude-swarm)
(combined-diff quality gate, file-disjoint sharding),
[mikekelly/claude-sneakpeek](https://github.com/mikekelly/claude-sneakpeek)
(native Agent Teams protocol shapes, for forward compatibility), and
[VRSEN/OpenSwarm](https://github.com/VRSEN/OpenSwarm) ("the orchestrator
never does lane work").

## The ten invariants

1. Plan file as the shared state machine (`depends_on`, canonical file
   lists, writable status/log per lane)
2. The session that sharded the plan launches and verifies the waves
3. Context packs with canonical naming — workers may not invent paths
4. File-disjoint sharding; worktrees only when disjointness is impossible
5. Commit-per-lane, never push; stage only your own files
6. Evidence-gated completion — validation output, not self-report
7. A combined-diff review by the PLANNER before shipping
8. Leases + idle protocol instead of silent exits; stale lease = dead lane
9. A running local dev instance is a precondition — lane evidence and the
   integration gate verify against the LIVE app, and the orchestrator owns
   the server (never install packages while it runs)
10. UI work is verified by PIXELS — a headless-browser screenshot you
    actually look at; SSR text, HTTP 200s, and a populated DOM all coexist
    with a blank screen

## License

MIT © MTS Moose Tech Solutions L.L.C.
