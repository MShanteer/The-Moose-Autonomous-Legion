/**
 * proof/lib/harness.mjs — the runner.
 *
 * Deliberately tiny and dependency-free. It runs in plain node, in seconds,
 * with no browser, no database, no network and no test framework. That is the
 * whole point: a check nobody waits for is a check people skip.
 *
 * Two kinds of assertion, and the difference matters:
 *
 *   PURE    — drive the REAL exported function with real inputs. Proves
 *             behaviour.
 *   STATIC  — assert over the real source text for facts decidable by reading
 *             it ("every sender calls the gate"). Proves structure.
 *
 * Read docs/04-blind-spots.md before trusting either. Neither sees runtime
 * module evaluation, scale limits, or the difference between an admin path and
 * a user path — all three of which have shipped outages past a fully green run.
 */

import fs from "node:fs";
import path from "node:path";

let failures = 0;
let checks = 0;

export const root = process.cwd();

/** Read a repo-relative file. Throws loudly if it moved — a proof that silently
 *  stops finding its subject is worse than no proof. */
export const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

/**
 * Source with comments stripped.
 *
 * Use this for "the code does X" assertions. A codebase that documents its
 * decisions well will mention the very thing you are asserting is absent, and a
 * comment must never satisfy — or break — a claim about behaviour.
 */
export const readCode = (rel) =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, "$1");

export function section(title) {
  console.log(`\n${title}`);
}

export function check(name, condition, detail = "") {
  checks += 1;
  if (condition) {
    console.log(`  ok   ${name}`);
  } else {
    failures += 1;
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

/** Recursively list source files under a repo-relative directory. */
export function walk(rel, out = [], exts = /\.(ts|tsx|js|jsx|mjs)$/) {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) return out;
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    if (e.name.startsWith(".") || e.name === "node_modules") continue;
    const next = `${rel}/${e.name}`;
    if (e.isDirectory()) walk(next, out, exts);
    else if (exts.test(e.name)) out.push(next);
  }
  return out;
}

/**
 * THE CLOSED SET — the highest-leverage assertion in this repo.
 *
 * Ordinary tests fail when someone BREAKS code. This fails when someone ADDS
 * code: it finds every file matching `pattern` and requires the set to equal
 * `expected` exactly. A new caller of your dial route, your payment path, your
 * mailer — anything — surfaces here as a failure until a human decides it
 * belongs.
 *
 * This is what catches the bug class nobody writes a test for, because nobody
 * knew the new call site existed. In the project this came from, it caught a
 * brand-new outbound texting route that had quietly skipped a legally required
 * time-of-day check.
 *
 * Keep `expected` sorted, and keep a one-line comment per entry explaining why
 * that file is allowed to be in the set. The comments are the review.
 */
export function closedSet({ name, dirs, pattern, expected, exclude = () => false }) {
  const found = dirs
    .flatMap((d) => walk(d))
    .filter((f) => !exclude(f))
    .filter((f) => pattern.test(read(f)))
    .sort();
  const want = [...expected].sort();
  const same = found.length === want.length && want.every((f, i) => found[i] === f);
  check(
    name,
    same,
    same ? "" : `found: [${found.join(", ")}] expected: [${want.join(", ")}]`,
  );
  return found;
}

/**
 * An expression-shape assertion, for guards that legitimately GROW.
 *
 * Pinning a literal string like `disabled={blocked || busy}` breaks on every
 * correct addition, and the tempting fix — loosening the regex until it passes —
 * is how a safety assertion quietly stops asserting anything.
 *
 * Assert the INVARIANT instead: required terms present, forbidden terms absent,
 * and the whole thing a pure `||` chain so extra terms can only ever disable
 * more. One `&&` fails, because that could let the blocked case through.
 */
export function guardHolds(src, { anchor, required = [], forbidden = [] }) {
  const m = src.match(new RegExp(`${anchor}([^}]*)\\}`));
  if (!m) return false;
  const expr = m[1];
  if (expr.includes("&&")) return false;
  if (!required.every((t) => expr.includes(t))) return false;
  return !forbidden.some((t) => expr.includes(t));
}

export function done() {
  const msg = failures
    ? `\n${failures} FAILURE(S) of ${checks} checks`
    : `\nALL ${checks} PROOFS PASS`;
  console.log(msg);
  process.exit(failures === 0 ? 0 : 1);
}
