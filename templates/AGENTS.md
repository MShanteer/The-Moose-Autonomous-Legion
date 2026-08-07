# AGENTS.md — the contract for AI agents in this repository

> Drop-in template from **Moose Coding Legion**. Rename to `CLAUDE.md`,
> `AGENTS.md` or whatever your tool reads. Fill the `<>` placeholders and delete
> anything that does not apply. Keep the rules — they are the point.

---

## THE ONE RULE

**A green build proves your code was ACCEPTED. It does not prove it WORKS.**

Before you tell anyone something works:

- **Exercise the real path** — if a browser does it, reproduce what the browser does
- **As the real identity** — admin ≠ member ≠ anonymous
- **At real scale** — the largest real row count, not a two-row fixture
- **Read the actual error before theorising** — fetch the log, match the request
  id, read the exception. Do not guess. Guessing costs more than reading.

If it is not verified, say it is not verified. "Deployed" is not "working."

---

## The loop

1. **PLAN** — a model that will not write the code produces the plan
2. **BUILD** — implement the plan faithfully; if it is wrong, go back, do not freelance
3. **REVIEW** — the planning model attacks the diff. **Never skip this.**
4. **FIX** — everything the review confirms
5. **VERIFY** — the real path, real identity, real scale
6. **REPORT** — honestly, separating verified from merely deployed

Steps 3 and 5 are the ones dropped under time pressure. They are the only two
that prevent outages.

---

## Writing code here

- **One implementation, many callers.** If the UI, the API and the tests need
  the same rule, they call the same pure function.
- **Rules that matter are structural.** If reordering the code could break the
  rule, it is not safe yet. Return early on the absolute cases.
- **Fail closed, and say why.** Return a reason string, never a bare boolean.
- **Comment the WHY.** What was rejected, and what broke to cause this. Include
  the real values that proved it.
- **Patch, do not delete.** The reason something ended is part of the record.

## Before you ship

- [ ] Reviewed by a model that did not write it
- [ ] Real path exercised, as the real identity, at real scale
- [ ] Proof harness green (`node proof/run.mjs`)
- [ ] Closed sets updated deliberately, not loosened to pass
- [ ] Reported honestly: what is verified vs what is merely deployed

**Never loosen an assertion to make it pass.** If a proof breaks on a correct
change, restate the invariant more precisely. Relaxing a regex until it goes
green is how a safety check quietly stops checking anything.

---

## Project specifics

<!-- Fill these in. Agents read this first and act on it. -->

- **Stack:** <>
- **Run the app:** <>
- **Run the proofs:** `node proof/run.mjs`
- **Deploy:** <> (say explicitly what deploying does and does NOT verify)
- **Never do:** <>
- **Ask before:** <>

## Known ceilings

<!-- Every platform has limits that only appear at real scale. Write yours here
     the first time one bites, with the number. -->

- e.g. *database: 4,096 reads per query — any per-row work across a full list
  will hit this as tenants grow*
