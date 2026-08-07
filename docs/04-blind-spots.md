# Blind Spots

**Read this before trusting anything else in this repo.**

Every technique here operates on **source text and pure logic**. That is what
makes them fast, dependency-free and worth running on every change. It is also
exactly what they cannot see.

A methodology that only publishes its wins is marketing. Here is where this one
provably fails, with real incidents where every check was green and production
broke anyway.

---

## 1. Runtime module evaluation

**Not caught. Has shipped an outage.**

A change created an import cycle: module A → B → C → A. The reasoning was that
every edge is used at *call* time, never at module scope, so the cycle resolves
fine. That reasoning was checked against a successful build and a clean deploy.

It deployed perfectly. It then failed at runtime, in a query the change had
never touched, because module evaluation order left a binding undefined.

**Why nothing here caught it:** a static proof reads text. A typecheck reads
types. A bundler proves the graph can be *built*. None of them execute the
module graph in the order the runtime will.

**What does catch it:** calling the affected functions against a real deployment
after deploying. Not the deploy result — the functions.

---

## 2. Scale and resource ceilings

**Not caught. Has shipped an outage.**

A contact lookup was widened from one database read to four — correct, and
needed. That function also ran once per row inside a list join. On a 660-row
list it crossed the database's 4,096-reads-per-query ceiling and the page died
completely.

Every check passed. The pure proofs passed at fixture scale. Types were fine.

**Why nothing here caught it:** per-row cost is invisible at test scale. Two
rows times four reads is eight. The bug is a multiplication that only exists in
customer data.

**What does catch it:** running the real query against the largest real dataset,
and asking of any change "what does this cost *per row*, and how many rows does
the biggest tenant have?"

---

## 3. Identity and permission paths

**Not caught. Produced two wrong diagnoses.**

A broken query was "verified working" by calling it with an admin key. It
passed. Real users kept failing, because the admin path skips checks the member
path runs. That false green sent two hours of debugging in the wrong direction
and caused two unnecessary reverts.

**Why nothing here caught it:** a proof harness authenticates however you tell
it to, and the convenient way is usually the privileged way.

**What does catch it:** exercising each identity that matters — anonymous,
member, admin — and treating "it works for admin" as proving nothing about
anyone else.

---

## 4. Anything about the world outside the repo

DNS, webhooks pointed at the wrong URL, expired cards, release gates holding a
build back, a vendor's dashboard setting. In the project this comes from, three
finished builds sat undelivered for days behind a deploy gate while every check
in the repo was green.

**Static analysis of your source cannot see your infrastructure.** Verify
externally-facing behaviour by probing the live surface, and never infer
configuration from a vendor's API field — two such fields were wrong on the same
day, both confidently.

---

## 5. Whether the thing is worth building

Nothing here evaluates whether a feature should exist, whether the design is
right, or whether it solves the user's actual problem. That is the brain's job
(docs/01-the-roster.md), and a code review will happily approve a beautifully
implemented mistake.

---

## The honest summary

These techniques are very good at:

- rules drifting apart across call sites
- a new caller skipping a gate
- logic errors in pure decision code
- a UI claiming something the server does not do

They are blind to:

- runtime behaviour, evaluation order, and scale
- identity and permission differences
- everything outside the repository
- whether any of it was a good idea

**Which is why DISCIPLINE.md leads with verification and not with tooling.** The
techniques make you faster. Only exercising the real path makes you right.
