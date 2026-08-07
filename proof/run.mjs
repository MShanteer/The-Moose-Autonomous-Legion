/**
 * proof/run.mjs — a WORKING harness. Run it: `node proof/run.mjs`
 *
 * This proves the bundled example. In your own repo, delete these sections and
 * write your own — the value is in the SHAPE, not in these particular rules.
 *
 * Note what the sections do and do not claim. Section 1 drives real code and so
 * proves behaviour. Section 2 reads source text and so proves structure. Neither
 * proves the thing runs correctly in production at scale — see
 * docs/04-blind-spots.md, and DISCIPLINE.md #1.
 */

import { check, section, closedSet, done, read } from "./lib/harness.mjs";
import { decideCallingWindow, effectiveRule, STATE_RULES } from "../examples/calling-window.mjs";

// ═══════════════════════════════════════════════════════════════════════════
// 1) PURE — drive the real exported function
// ═══════════════════════════════════════════════════════════════════════════
section("1) THE DECISION IS TOTAL AND FAILS CLOSED:");

check(
  "an unknown location REFUSES — 'probably fine' is not a defence",
  decideCallingWindow({ state: null, localHour: 14, localDay: 2 }).allowed === false,
);
check(
  "an unknown time REFUSES too",
  decideCallingWindow({ state: "TX", localHour: NaN, localDay: 2 }).allowed === false,
);
check(
  "every refusal carries a reason a person could be shown",
  ["unknown_location", "too_early", "too_late"].every((code) => {
    const d =
      code === "unknown_location"
        ? decideCallingWindow({ state: null, localHour: 14, localDay: 2 })
        : code === "too_early"
          ? decideCallingWindow({ state: "TX", localHour: 7, localDay: 2 })
          : decideCallingWindow({ state: "FL", localHour: 20, localDay: 2 });
    return typeof d.reason === "string" && d.reason.length > 20;
  }),
);

section("2) LOCAL RULES CAN ONLY EVER TIGHTEN:");

check(
  "a stricter state close time is honoured (FL closes at 20:00)",
  decideCallingWindow({ state: "FL", localHour: 20, localDay: 2 }).allowed === false &&
    decideCallingWindow({ state: "FL", localHour: 19, localDay: 2 }).allowed === true,
);
check(
  "Sunday can open later, never earlier (TX noon)",
  decideCallingWindow({ state: "TX", localHour: 11, localDay: 0 }).allowed === false &&
    decideCallingWindow({ state: "TX", localHour: 12, localDay: 0 }).allowed === true,
);
check(
  "A HOSTILE TABLE EDIT CANNOT WIDEN THE WINDOW — clamped on read",
  (() => {
    const before = { ...STATE_RULES.TX };
    STATE_RULES.TX = { open: 3, close: 23, confidence: "statutory" }; // someone edits the data badly
    const r = effectiveRule("TX");
    STATE_RULES.TX = before;
    return r.open === 8 && r.close === 21; // federal floor still wins
  })(),
  "this is the whole reason the clamp happens on READ and not on write",
);
check(
  "an unlisted state gets the federal floor, not a free pass",
  effectiveRule("ZZ").open === 8 && effectiveRule("ZZ").close === 21,
);

// ═══════════════════════════════════════════════════════════════════════════
// 3) STATIC + CLOSED SET — fails when someone ADDS code
// ═══════════════════════════════════════════════════════════════════════════
section("3) THE CLOSED SET — a new caller shows up here as a failure:");

closedSet({
  name: "exactly the known modules import the calling-window decision",
  dirs: ["proof", "examples"],
  pattern: /calling-window\.mjs/,
  // EXCLUDE THE CALLEE. The module names itself in its own header, so without
  // this it reports itself as one of its own callers. Real closed sets need the
  // same exclusion for the thing being called — the route's own directory, the
  // module's own file. This surfaced on the very first run of this harness,
  // which is a fair advertisement for the technique: it noticed something.
  exclude: (f) => f === "examples/calling-window.mjs",
  expected: [
    // the harness itself — drives the real function
    "proof/run.mjs",
  ],
});

check(
  "the decision module stays PURE — no I/O, no framework, no clock of its own",
  (() => {
    const src = read("examples/calling-window.mjs");
    return (
      !/\bimport\s/.test(src) &&
      !/\bfetch\(/.test(src) &&
      !/Date\.now\(\)/.test(src) &&
      !/new Date\(/.test(src)
    );
  })(),
  "the caller passes the time in; that is what makes this provable in plain node",
);

done();
