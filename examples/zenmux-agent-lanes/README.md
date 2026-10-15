# Implementation lanes on free models (ZenMux)

The Legion's expensive part is not the plan or the review, it is the lanes: every
file-disjoint implementation lane is a full agent session. If the orchestrator runs on a
paid account, a big program burns that account (a real run hit a monthly spend limit
mid-program). This example runs the *fenced* lanes as headless Claude Code agents on
**free** models behind an Anthropic-compatible gateway, and accepts their work only
through a gate that costs nothing.

## Measured (2026-10-14)
ZenMux serves `https://zenmux.ai/api/anthropic/v1/messages`. Pointing a headless
`claude -p` at it (`ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`, `--model <slug>`) gives
the whole tool harness (read, edit, shell, tests) on a gateway model. First real lane:
three stale tests, 3 failing → 90/90 passing, typecheck clean, diff inside the fence.

| Model | Anthropic route |
|---|---|
| `z-ai/glm-5.3-flash` | works (default) |
| `tencent/hy3`, `qwen/qwen3.8-flash` | work |
| `openai/gpt-5-nano` | 404 `model_not_supported` (OpenAI wire only) |
| `deepseek/deepseek-v4.1-flash` | hangs, no reply — the script refuses it |

Re-measure before you rely on any row; model availability on a gateway changes.

## Files
- `zm-lane.sh -d <worktree> -b <brief.md> -k <env file> [-m model] [-t turns] [-o out]` —
  runs one lane. The agent may read, edit, run `node`, `npx tsc`, `npm run`, and
  `git status|diff|log`; it is denied commit, push, `rm`, `curl`, deploy. The key is read
  from the env file (`ZENMUX_API_KEY`) and redacted from output.
- `zm-accept.sh -d <worktree> -r <base ref> -f "<allowed prefixes>" -c "<test cmd>"` —
  ACCEPT only if every changed file is inside the fence, the typecheck is clean and the
  tests pass. No model tokens.

## The routing rule
| Lane | Runs on |
|---|---|
| Spec'd feature/fix with a file list and a nameable failing test; test repair; ports; docs; additive schema | free gateway model, then `zm-accept.sh`, then a review on a **different** lineage |
| Security, permissions, money, migrations, identity | your strongest model + two reviewer lineages |
| Plan, brief, merge/conflict resolution, final review, screenshot judgement | the orchestrator |

A lane that is REJECTed twice, or touches anything outside its fence, is re-run on the
orchestrator's model. Text models cannot see pixels: let them build UI and let a vision
model open the screenshots. A paid gateway model is still a per-run, owner-approved cost.

## Traps
- A git worktree has no `.env.local`; a review script that falls back to a stale OS-level
  key returns 403 from every model. "No model produced a review" is **not** CLEAN.
- The brief must name the files the agent may edit and the done condition; a free model
  with an open brief wanders.
- Verify the agent's report against the diff, like any other self-report.
