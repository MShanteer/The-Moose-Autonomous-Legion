# The Roster — Brain & Muscle

The core claim: **separate the model that decides from the model that types,
and always have something review a diff it did not write.**

Not because one model is smarter. Because an author — human or model — cannot
see its own blind spot. The same reasoning that produced the bug re-runs and
re-approves it.

---

## The three jobs

### BRAIN — plans and reviews, writes nothing

Owns architecture, sequencing, risk, and the adversarial review before ship.
Never commits code. Its job is to be **the thing that does not already believe
the code is right.**

Give it: the task, the constraints, the files to read. Ask for a plan, not code.
Then, after implementation, give it the diff and ask it to attack.

### MUSCLE — implements the plan, faithfully

Turns the plan into working code. If the plan is wrong, it goes *back* to the
brain rather than freelancing a different design.

Can be more than one. A long-context agent for work needing the whole picture; a
cheap one-shot agent for bounded, well-specified, independently verifiable
tasks.

### SCOUT — read-only investigation, in parallel

Sub-agents that map a codebase and report findings without touching anything.
Enormously effective and nearly risk-free, because they cannot write.

A real example: a scout asked to map every do-not-call enforcement point found
that two legally different flags — "on the national registry" and "known
litigator" — were stored separately but **collapsed into one bit at every
enforcement point**. That single finding was the difference between a feature
that was legal and one that was not. No amount of prompting the implementer
would have surfaced it; it required someone reading with fresh eyes and no stake.

---

## Who plays what

| Tool | Best role | Why |
|---|---|---|
| **Codex CLI** (GPT) | Brain | Strong at adversarial review; runs headless from a script; different lineage from Claude, so it fails differently |
| **Claude Code** | Muscle + Scout | Long context, strong tool use, sub-agents for parallel read-only work |
| **Moose Code Legion** | Second muscle | Local one-shot agent for bounded mechanical work; no memory between calls, so verify its output |
| **Qwen Code** | Optional third opinion | See the verdict below |

The specific vendors matter less than the **separation**. Any two capable models
in these roles beat one model doing both.

---

## Verdict: is Qwen Code worth adding?

**Short answer: optional, and only for two specific cases. It does not change
the core roster.**

What it is: Alibaba's terminal coding agent, **Apache 2.0**, adapted from the
Gemini CLI codebase and tuned for the Qwen3-Coder 480B MoE model. It ships a
`qwen` CLI that can point at OpenAI-compatible, Anthropic, Gemini, OpenRouter,
Fireworks — **and local endpoints**.

The thing people remember about it is out of date: **the free hosted tier ended
15 April 2026.** The 2,000-requests/day allowance is gone. The CLI is still free
and open source, but practical use now needs an API key, a Coding Plan, or
another provider — so on cost it is no longer meaningfully cheaper than the
alternatives.

**Where it genuinely earns a slot:**

1. **A second reviewer on the highest-stakes diffs** — money, compliance,
   auth. Review value comes from *independence*, and Qwen3-Coder is a genuinely
   different model lineage from GPT and Claude. Two independent reviewers on a
   billing change is cheap insurance.
2. **Fully local / air-gapped work.** It is the only one on this list that runs
   against a local endpoint with an open-weights model behind it. If code cannot
   leave the building, this is the answer.

**Where it does not:**

As a general-purpose brain or muscle it is not adding a capability you lack —
you already have a brain and two muscles. A third tool costs configuration, an
extra output to verify, and one more thing to keep current.

**The honest caveat that matters most:** adding a second reviewer will not fix
the failure mode that actually causes outages. In the project this repo comes
from, every incident traced to **skipping the review that already existed** —
not to lacking a second one. Fix the discipline first. Add Qwen when you have a
genuine independence or locality need.

Sources: [Qwen Code review](https://vibecodinghub.org/tools/qwen-code) ·
[free-tier shutdown](https://inventivehq.com/blog/qwen-code-still-free-2026-shutdown) ·
[terminal CLI comparison](https://inventivehq.com/blog/terminal-ai-coding-clis-compared-2026)

---

## The loop

```
1. PLAN      brain: "read X, Y, Z. Plan this. Files, risks, order. Plan, not code."
2. BUILD     muscle: implement the plan faithfully
3. REVIEW    brain: "here is the diff. Attack it."   ← the step people skip
4. FIX       muscle: fix everything the review confirms
5. VERIFY    exercise the real path, real identity, real scale  ← DISCIPLINE.md #1
6. SHIP      and report honestly what is verified vs merely deployed
```

Steps 3 and 5 are the ones that get dropped under time pressure, and they are
the only two that would have prevented every incident in this repo's history.

---

## Anti-patterns

- **Brain writes code.** It stops being an independent reviewer the moment it
  has authored something.
- **Muscle redesigns.** If the plan is wrong, go back to the brain. A muscle
  that freelances architecture is just a slower brain with less context.
- **Review after merge.** A review that cannot block is a comment.
- **One model, two hats.** Asking the author to review its own diff produces
  agreement, not review.
