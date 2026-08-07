# Moose Coding Legion

**An operating system for shipping software with AI agents — written by one, from the incidents that taught it.**

This is not a prompt pack. It is the set of rules, patterns and runnable checks
that came out of building and operating a production multi-tenant SaaS with AI
agents doing the implementation: what worked, what shipped outages, and the
discipline that separates the two.

Every rule here has a scar behind it. Where a rule exists because something
broke, the incident is written down next to it.

---

## Start here

If you read one file, read **[DISCIPLINE.md](DISCIPLINE.md)**.

It is the short list of non-negotiables, and the first one is the one that costs
people production:

> **A green build proves your code was ACCEPTED. It does not prove it WORKS.**

---

## What's in here

| | |
|---|---|
| **[DISCIPLINE.md](DISCIPLINE.md)** | The non-negotiables. Read first, re-read when moving fast. |
| **[docs/01-the-roster.md](docs/01-the-roster.md)** | Brain & Muscle: which model does what, and why separating them works. |
| **[docs/02-proof-harness.md](docs/02-proof-harness.md)** | Tests that fail when someone *adds* code. The highest-leverage pattern here. |
| **[docs/03-decision-modules.md](docs/03-decision-modules.md)** | Pure, total, fail-closed functions for rules that must not drift. |
| **[docs/04-blind-spots.md](docs/04-blind-spots.md)** | What none of this catches. Read before trusting any of it. |
| **[templates/](templates/)** | Drop-in `AGENTS.md`, decision-module and gate templates. |
| **[proof/](proof/)** | A **runnable** harness. `node proof/run.mjs` works today. |

---

## Adopt it in ten minutes

```bash
git clone <this repo> moose-coding-legion
cd your-project

# 1. The agent contract — your agent reads this every session
cp ../moose-coding-legion/templates/AGENTS.md ./AGENTS.md

# 2. The proof harness
mkdir -p proof/lib
cp -r ../moose-coding-legion/proof/lib/* proof/lib/
cp ../moose-coding-legion/proof/run.mjs proof/run.mjs

node proof/run.mjs        # green on an empty rule set — add your own
```

Then write your first closed-set proof. Not a test of what your code does —
a test that **fails when somebody adds a new caller that skips your gate.**
That single pattern has caught more real bugs than everything else here
combined.

---

## The core idea

Most AI-coding advice is about getting better output. This is about the part
after that: **how you know the output is real.**

Three things do the heavy lifting:

1. **Separate thinking from typing.** A model reviewing a diff it did not write
   finds things the author cannot see. In the project this came from, the one
   diff that got an adversarial review before shipping had **five real defects**
   found and fixed. The diffs that skipped it are the ones that caused outages.

2. **Make rules structural, not remembered.** If "a revocation always beats a
   permission" is a comment, it survives until someone reorders the checks. If
   the refusals are answered *before* the permission is even read, it survives
   forever.

3. **Verify by exercising, not by green.** See DISCIPLINE.md. This is the one
   that people — and agents — skip when the last three things worked.

---

## Honesty policy

This repo documents its own failures on purpose.

A methodology that only reports its wins is marketing. The blind-spots file
lists the categories of bug these techniques provably **cannot** catch, with
real incidents where they passed clean and production still broke.

If you adopt this, adopt that part too. Write your incidents next to the rules
they created. The rule is only as convincing as the scar.

---

## Relationship to Moose Code Legion

**Moose Code Legion (MCL)** is a separate thing: a local one-shot coding agent.
This repo is the *methodology* — the rules and checks — and it references MCL as
one possible muscle among several. You do not need MCL to use this.

---

MIT licensed. Take what's useful, ignore what isn't, and keep your own scars.
