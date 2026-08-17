# Wiring a PLANNER / REVIEWER that actually works

Legion assumes you have a reasoning engine that **writes a plan before sharding**
and **reviews the merged diff before shipping**. The skill doesn't care which
one. This document is about the part nobody warns you about: the wiring fails
*silently*, and a silent failure in a reviewer is worse than no reviewer.

Everything here was learned by breaking it in production on 2026-08-17, running
the OpenAI Codex CLI (`codex-cli 0.143`) against a multi-model gateway. The
symptoms generalise to any CLI-agent-plus-gateway setup.

---

## The one rule

> **An empty run that exits 0 is the default failure mode. Assume success is a
> lie until you have seen output.**

Four separate causes below all produce the same thing: a clean exit code, no
findings, and a pipeline that believes it was reviewed. If your orchestration
treats exit 0 as "reviewed", you will ship unreviewed diffs. Gate on
*non-empty, on-topic output*, never on the exit code.

---

## Trap 1 — the model is fine, the transport is broken

Multi-model gateways advertise dozens of models behind one key. Your agent CLI
speaks exactly one wire protocol. These are not the same set.

Codex speaks the OpenAI **Responses** API (`/responses`) and, as of 0.143,
*only* that — it rejects `wire_api = "chat"` with `unknown variant, expected
'responses'`. Meanwhile the gateway's `/responses` shim was broken for every
non-OpenAI model, returning `HTTP 400: messages must not be empty`.

Codex can't recover from that, so it reconnect-loops for minutes, gives up, and
**exits 0 with no output**.

The models were never the problem. Same key, same moment, `/chat/completions`:

| Model | `/responses` | `/chat/completions` |
|---|---|---|
| `claude-opus-5` | HTTP 400 | **200 → "OK"** |
| `claude-fable-5` | HTTP 400 | **200 → "OK"** |
| `grok-4.6` | HTTP 400 | **200 → "OK"** |

**Before you wire any model into a role, probe it.** A wrong model here does not
error — it hangs. The timeout is mandatory:

```bash
timeout 75 codex exec --ephemeral -m <model> "Reply with exactly: OK" < /dev/null
```

Then curl the same model on `/chat/completions`. If curl passes and the CLI
loops, it's the transport, not the model.

**Keep an escape hatch.** A ~100-line script that POSTs to `/chat/completions`
reaches every model your gateway offers. It has no file access, which makes it
useless for planning — and perfect for review, where the input is a diff and
the output is findings. See [`scripts/zen.mjs`](../scripts/zen.mjs).

This matters more than convenience. Most models one CLI can reach tend to come
from a single vendor family, so a review by "another model" is often the same
lineage checking its own class of mistake. The escape hatch is what buys you a
genuinely independent reader.

---

## Trap 2 — MCP tool calls are cancelled by a user who isn't there

Give your planner live access — database schema, GitHub, deploys — and it stops
guessing. Codex supports MCP servers, and configuring one is easy.

Then every tool call fails like this:

```
mcp: convex/status started
mcp: convex/status (failed)
user cancelled MCP tool call
```

There is no user. It's a headless run. The approval gate can't prompt anyone,
so it cancels — and the agent cheerfully reports it "couldn't reach the tool"
and answers from guesswork instead.

**Tested and did NOT fix it:** raising `tool_timeout_sec` to 180; passing
`USERPROFILE`/`HOME`/`APPDATA`/`PATH` explicitly to the server; disabling hooks
(`features.hooks=false`); enabling sandbox network access
(`sandbox_workspace_write.network_access=true`).

**The only lever codex exposes** is `--dangerously-bypass-approvals-and-sandbox`.

Understand what you're accepting: the same flag that enables MCP **also removes
the shell sandbox**, so the agent can run commands anywhere on the machine, not
just in the repo. That is a real expansion of blast radius. Make it a
deliberate, documented choice with an environment-variable escape hatch — not
something that quietly ends up in a script:

```bash
: "${FULL_ACCESS:=1}"
if [ "$FULL_ACCESS" = "1" ]; then
  ARGS+=(--dangerously-bypass-approvals-and-sandbox)
fi
```

**Lean on the data source's own guardrails rather than your prompt.** Ours
exposes production as read-only at the server level: schema is inspectable,
customer records are structurally unreachable. That is worth far more than an
instruction telling the model to be careful, because it holds even when the
model ignores you.

---

## Trap 3 — your own AGENTS.md can eat the entire run

A governance file that opens with

> "Before any tool call or action, output the following acknowledgement…"

is read literally by a one-turn agent. It prints the acknowledgement, considers
the instruction satisfied, ends its turn having done **no work**, and exits 0.

Two production audits died this way before anyone noticed the reviews were
empty rather than clean.

Keep the governance. Change the framing:

- The acknowledgement is a **prefix, not a turn** — emit it, then continue into
  the work *in the same response*.
- **Skip it entirely in non-interactive runs.** No human is reading a `codex
  exec` stream.
- State that adoption is implicit on read, so the contract binds on load rather
  than on recitation.

Anything phrased as "before any other action" is a trap in a headless agent.
Audit your `AGENTS.md`, `CLAUDE.md`, and rules files for that phrasing.

---

## Trap 4 — don't pipe a diff when the agent can read the repo

The obvious way to get a review is `git diff | agent "review this"`. It is worse
than it looks:

- **There is a hard input cap.** Ours rejected 1,075,901 bytes against a
  1,048,576 limit. A large feature branch exceeds it.
- **A diff has no surrounding code.** The reviewer sees changed lines with no
  callers, no schema, no types — so it answers `UNVERIFIED` and returns a
  *NO-GO that means "I couldn't see enough"*, not "I found a defect". Those
  verdicts are indistinguishable in a log and lead teams to block good releases
  while feeling rigorous.

Your agent already has a working directory. **Tell it which files to read and
let it read them**, including the base revision for comparison
(`git show <base>:<path>`). Reserve stdin for genuinely external input.

---

## Trap 5 — the reviewer must not be the author

If PLANNER and REVIEWER are the same model, the review is theatre — a model
re-reading its own reasoning agrees with itself. Equally, a reviewer *weaker*
than the author will miss what the author got wrong.

Same weight class, different model. Different vendor lineage if your transport
allows it (see Trap 1).

---

## A working shape

```bash
# planner-env.sh — sourced by plan.sh and review.sh
[ -f .gateway.env ] && { set -a; . .gateway.env; set +a; }   # GITIGNORED

ARGS=()
[ -n "${GATEWAY_KEY:-}" ] && ARGS=(-c model_provider=gateway)

# See Trap 2 before turning this on.
: "${FULL_ACCESS:=1}"
[ "$FULL_ACCESS" = "1" ] && ARGS+=(--dangerously-bypass-approvals-and-sandbox)

# Pull tokens from already-authenticated CLIs instead of storing them on disk.
[ -z "${GITHUB_PAT_TOKEN:-}" ] && command -v gh >/dev/null &&
  export GITHUB_PAT_TOKEN="$(gh auth token 2>/dev/null || true)"

# ONLY probe-verified models. See Trap 1.
: "${PLANNER_MODEL:=<probed-model>}"
: "${REVIEWER_MODEL:=<different-probed-model>}"
```

Checklist before you trust the pipeline:

- [ ] Every model in a role has been probed and returned real output
- [ ] A review with a deliberately planted bug actually finds it
- [ ] Tool/MCP calls show `(completed)`, not `(failed)`
- [ ] Your rules files don't tell a headless agent to stop and acknowledge
- [ ] The orchestrator treats empty output as failure, not success
- [ ] Secrets come from gitignored files or authenticated CLIs, never from
      config committed to the repo
