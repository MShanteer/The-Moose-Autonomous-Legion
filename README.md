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
curl -fsSL https://raw.githubusercontent.com/MShanteer/The-Moose-Autonomous-Legion/main/skills/coding-legion/SKILL.md \
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
