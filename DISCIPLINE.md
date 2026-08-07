# DISCIPLINE

The non-negotiables. Everything else in this repo is a technique; this is the
part that decides whether the techniques help you or make you overconfident.

Each rule names the incident that created it.

---

## 1. A green build proves ACCEPTED, not WORKING

> A successful build, deploy, typecheck or test run proves your code was
> **accepted**. It does not prove it **works**.

Each of those verifies something narrower than it feels like:

| what you ran | what it actually proved |
|---|---|
| deploy succeeded | the bundle **built** — not that modules **evaluate** |
| typecheck passed | types line up — not that a query stays under a runtime limit |
| static proof passed | the string is present — not that the code path **runs** |
| a test passed | it works **at test-fixture scale** |

**Three production incidents in one day, all this same mistake:**

1. **Import cycle.** Judged safe (every edge call-time), confirmed by a clean
   deploy, shipped. It deployed perfectly and took a core page down at runtime —
   in a query the change never touched.
2. **Wrong-identity probe.** "Verified" a broken query by calling it with an
   admin key. It passed. Real users still failed. Admin path ≠ user path. This
   produced two wrong diagnoses and two pointless reverts.
3. **Scale ceiling.** A one-read → four-read widening ran once per row in a list
   join and crossed the database's per-query read cap on a 660-row list. Every
   check was green. Only real customer data was big enough to fail.

### The rule

Before saying anything works:

- **Exercise the real path.** If a browser does it, reproduce what the browser does.
- **As the real identity.** Admin ≠ member ≠ anonymous. Privileged callers skip
  the checks that break for everyone else.
- **At real scale.** The largest real row count, not a two-row fixture.
  Per-row cost is invisible until it isn't.
- **Read the actual error first.** Do not theorise. In incident 3 above, two
  wrong theories were formed and acted on *before* anyone fetched the log. The
  log named the file and line in one shot.

### The meta-lesson

All three happened while **moving fast, low on context, on a path where the
previous step had succeeded.**

**Momentum is the risk factor.** The moment three things in a row work is
exactly the moment to exercise the path instead of inferring from green.

---

## 2. Review every diff with a model that did not write it

Not "important" diffs. Every diff.

**The evidence, from one project, one day:** the single diff that got an
adversarial review before shipping had **five real defects found** — including a
button that re-armed mid-call so a second press started a second call, and an
authorized-but-never-connected action leaving phantom records in a manager
dashboard. All five were real. All five were fixed. That drop shipped clean.

**The drops that skipped the review are the ones that caused the outages.**

An author cannot review their own work, and this is more true of models than of
people: the same reasoning that produced the bug re-runs and re-approves it. The
value is not "a smarter model." It is **a model that does not already believe
the code is correct.**

---

## 3. Structure beats memory

If a rule lives in a comment, it survives until someone reorders the code. If it
lives in the shape of the function, it survives forever.

**Example.** In a consent system, three refusals must always beat any
permission. Written as a comment — "check these first!" — that lasts until the
next refactor. Written so those three refusals `return` *before* the permission
value is ever read, it cannot be broken by reordering, because there is nothing
to reorder.

Ask of every important rule: **could someone break this by moving code around?**
If yes, it is not structural yet.

---

## 4. One implementation, many callers

Every "the button said one thing and the server did another" bug comes from two
implementations of one rule.

If the UI, the API and the tests all need to know whether an action is allowed,
they call **the same pure function**. Not three copies that agree today.

---

## 5. Fail closed, and say why

A check that cannot complete must **refuse**, not allow.

Return an explicit reason string, not a bare boolean. `{ allowed: false, code:
"unknown", reason: "We couldn't check this just now — try again in a moment." }`
is debuggable, showable to a user, and assertable in a test. `false` is none of
those.

---

## 6. Write the why, not the what

The code says what it does. Comments should say **why it is this way, what was
rejected, and what broke to cause it** — with the real values that proved it.

This is what makes a large codebase navigable by someone (or something) that has
never seen it. It is the single highest-leverage thing you can do for future
agents working in your repo.

---

## 7. Report outcomes honestly

If it is not verified, say it is not verified. "Deployed" is not "working."
"The tests pass" is not "it is correct."

An agent that reports optimistically is worse than one that reports nothing,
because you will act on it.

---

## 8. Never let a fix delete evidence

When retracting permission, expiring access, or removing a record: **patch, do
not delete.** The reason a thing ended is part of the audit trail, and the first
question after an incident is always "what did it look like before?"
