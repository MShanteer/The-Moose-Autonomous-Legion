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

In production at MTS this runs as **Codex → Claude → Legion**: the OpenAI
Codex CLI writes and reviews plans, the Claude Code session orchestrates,
and native subagents do the work in parallel waves. The lane ledger is the
plan file itself, committed to the repo.

### You probably do not need a state-layer CLI

Earlier versions of this doctrine named a leases tool (LoopX) as *the* state
layer, and made it sound like a prerequisite. A full product cycle run under
this skill — roughly thirty lanes across notifications, geofencing,
permissions, an assistant program and a terabyte-scale cost investigation —
used none of it, and nothing was lost. That is worth being honest about,
because a phantom dependency is the most expensive kind: it stops people
adopting a method that would otherwise work for them today.

What actually carried state, and what each thing replaced:

- **The plan file, committed** — the durable ledger. It survived context
  compaction, stayed reviewable by a human, and became the post-mortem
  record. This is invariant #1 already.
- **The harness's own task ids and completion notifications** — *this is
  the crash detector.* A stale lease infers death from a timestamp; a
  runtime that tells you the moment a lane exits does not need to infer.
- **File-disjoint assignment written into the lane prompt** — *this is the
  double-claim guard.* Two lanes never collided all cycle, because each
  prompt named the files that lane owned. A lease that refuses a second
  claim is a late check on a problem sharding should have prevented.
- **Git commits per lane**, for anything that must outlive the session.

Reach for a dedicated leases CLI when the **orchestrator itself** may die
mid-run and a different session has to adopt half-finished lanes, or when
two independent orchestrators share one repo. Both are real; neither is the
common case. Keep the *lease discipline* either way — one lane per file,
liveness you can observe without asking the lane, and only the orchestrator
retires a lane. That discipline is load-bearing. The tooling around it is
a preference.

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
| STATE LAYER | the committed plan file + the harness's task notifications | same — add a leases CLI only if orchestrators can die or overlap |
| WORKERS | native Claude subagents (+ a one-shot local agent for cheap lanes) | same |

See [`examples/`](examples/) for the two production adaptations
(a Convex/Next.js CRM and a large SaaS monorepo) showing repo-specific
wiring: deploy discipline, context briefs, goal ids, and a cheap-worker
dispatch lane.

### Choose the REVIEWER by measurement, not by name

The table above names an engine. **Which model you point it at matters more
than which CLI you use**, and it is the easiest thing in this whole system to
get wrong by assumption — a code-tuned model *sounds* right for a code repo.

Audition candidates on a diff whose answers you already know: seed it with real
bugs to find, and fix the rubric *before* you read any output. Then score two
things, not one.

**Score false positives as hard as misses.** In a run on 2026-08-18, two models
reviewed the same commits and both returned NO-GO. Only one had earned it — the
incumbent filed two P0s against code paths that did not exist. The tell was in
the prose:

> *"**IF** ring area is computed from raw lon/lat degrees without proper
> scaling…"*

It reasoned about what the code probably did. The challenger opened the test
fixture and computed the consequence: *"25×20 m building with a 5×5 m courtyard
should measure 475 m², but ships as 500 m² — a 323 sq ft overquote."*

One guessed, one read. **Only the second kind can block a ship**, and a reviewer
that cries wolf on imaginary code trains the team to ignore it.

Three things that run generalises:

- **Read the reasoning, not the verdict.** A verdict is a summary; the argument
  is the evidence. Identical verdicts came from wildly different work.
- **Do not retire the loser.** The demoted model had caught a real bug that no
  model of the winning lineage found. Move it to the swarm. A swarm whose
  members fail the same way is one reviewer running N times — the disagreement
  between lineages *is* the finding.
- **Enumerate what you actually have first.** That audition began as "why aren't
  we using the newer version?" Listing every available model answered it: the
  family in use had no newer version, the higher numbers were a different line
  entirely, and two never-tested candidates were sitting unused next to the one
  being argued about.

The most valuable finding of that run was not in the code at all. It was in the
proof harness meant to guarantee the code: the money guards scanned only the
three files they named, so moving a billing call into an *imported helper* would
walk straight past them. Those guards had been mutation-tested and every one
fired. **A green suite proves the assertions you wrote, not the property you
meant** — which is worth asking your reviewer to attack directly.

### The roster: cheap brain, free muscle, paid by exception

Auditioning tells you which model is *good*. This tells you which you can
afford to run all day. Both matter; the second one is the reason a legion
either runs continuously or gets switched off after one invoice.

A roster proven in production through a full product cycle, priced per
million tokens:

| Seat | Model | In / Out | Why this one |
|---|---|---|---|
| **BRAIN** (plans, adjudicates) | `openai/gpt-5.6-luna` | **$0.20 / $1.20** | Same family as the flagship, 1M context, **25x cheaper** than `gpt-5.6-sol` ($5/$30) for planning work that is mostly reading |
| **MUSCLE** (reviews the diff) | `inclusionai/ling-3.0-flash` | **$0.021 / $0.063** | A 500k-token review costs about **three cents**. The only genuinely free-tier model that completes agentic review lanes end to end |
| **SWARM one-shots** | `sapiens-ai/agnes-2.5-flash` | free tier | Brilliant on a single bounded question; dies silently inside multi-step lanes — one-shot use only |

Rejected after real testing, recorded so nobody re-learns it at token cost:
`z-ai/glm-5.3` and its free twin return **empty output** on real-size inputs
(17k tokens in, nothing out) while answering short prompts fine — the
silent-success failure this doctrine exists to prevent.
`inclusionai/ling-3.0-tiny` gets the right answer in 25k tokens and clogs
the lane. `deepseek-v4-flash-free` 404s on the wire API.

**The invoice that produced this table.** A repo-wide review was pointed at
`gpt-5.5-pro` ($30 in / **$180 out**) with an open-ended prompt — *"review
everything, read files in full where risky."* It read a 9,000-line file end
to end, burned **486,722 tokens in a single run**, took the account from a
fresh $35 top-up to **-$5**, and died mid-run on a 402 without ever
returning a verdict. Money gone, no review. Meanwhile the free lane running
beside it finished its focused audit and found a real defect.

Four rules follow from that, and they are not negotiable:

1. **Never start a paid-tier run without saying first what it will cost.**
   A standing "use the good model" is not authorization for an unbounded
   run. Say the model, the scope, and the rough spend; get a yes.
2. **Scope paid prompts.** One commit or one file cluster per run. State
   *"read diff hunks plus 50 lines of context; do not read files over N
   lines in full."* Open-ended plus pro-tier is a blank cheque.
3. **Free lanes are the default reviewer.** Escalate to paid for the single
   hardest verdict, never for the sweep.
4. **A negative balance blocks the free tier too.** Most gateways refuse
   *every* model, free ones included, once the account goes under. One
   runaway takes the whole legion offline — so put a per-key spend limit
   and a balance alert on the account, server-side, where a bug can't
   argue with it.

**Cheap changes the shape of the work, not just the bill.** At three cents a
review you stop rationing verification: every lane gets an adversarial pass,
disagreements get a third opinion, and the swarm can afford to be wrong out
loud. That is worth more than any single model upgrade.

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

## The thirteen invariants

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
11. The bill is part of the gate — after any data-touching lane, read the
    provider's usage breakdown by function and find your new function by
    name. A usage spike is a defect, and it is invisible in a diff
12. Truncation is reported, never silent — a cap that drops rows without
    saying so is a correctness bug wearing a performance costume
13. A contract change is broadcast to every live lane the moment it lands;
    lanes verify the brief rather than trusting it, and the orchestrator
    verifies their output rather than their self-report

## License

MIT © MTS Moose Tech Solutions L.L.C.
