/**
 * examples/calling-window.mjs — a worked DECISION MODULE.
 *
 * Adapted from a real one governing when a business may legally phone a
 * homeowner. Kept here because it is small enough to read in one sitting and
 * shows every property that matters:
 *
 *   PURE      no I/O, no clock of its own, no framework. The caller passes the
 *             time in. That is what makes it provable in plain node.
 *   TOTAL     every input produces a decision. There is no "undefined" branch.
 *   CLOSED    an input it cannot evaluate REFUSES. Never allows on doubt.
 *   EXPLAINED returns a reason string a person could be shown verbatim.
 *   DATA      jurisdiction rules are a table, not branches — auditable, and
 *             updatable without touching logic.
 *
 * The real cost of getting this wrong was $500 per violating call and $1,500 if
 * willful, which is exactly why it is a pure function with its own proofs
 * rather than an `if` somewhere inside a request handler.
 */

/** The federal floor: 8am–9pm in the CALLED PARTY's local time. */
export const FEDERAL_OPEN_HOUR = 8;
export const FEDERAL_CLOSE_HOUR = 21;

/**
 * Stricter local rules, AS DATA.
 *
 * `confidence` records whether a row is the statute itself or a conservative
 * reading of an ambiguous one — so a future reader can tell "the law says this"
 * from "we chose to be careful here". That distinction disappears the moment
 * rules become code.
 */
export const STATE_RULES = {
  TX: { open: 9, close: 21, sundayOpen: 12, confidence: "statutory" },
  FL: { open: 8, close: 20, confidence: "statutory" },
  OK: { open: 8, close: 20, confidence: "conservative", note: "Ambiguous close time; taking the earlier reading." },
};

/**
 * Clamp a local rule against the federal floor ON READ.
 *
 * Belt and braces: a bad edit to the table above can only ever make a window
 * NARROWER, never wider. A data table that can widen permissions is a config
 * file with legal consequences.
 */
export function effectiveRule(state) {
  const r = STATE_RULES[state] ?? {};
  return {
    open: Math.max(r.open ?? FEDERAL_OPEN_HOUR, FEDERAL_OPEN_HOUR),
    close: Math.min(r.close ?? FEDERAL_CLOSE_HOUR, FEDERAL_CLOSE_HOUR),
    sundayOpen: r.sundayOpen ?? null,
    confidence: r.confidence ?? "federal",
  };
}

/**
 * THE DECISION.
 *
 * `state` null/unknown → REFUSE. We cannot establish the called party's local
 * time, and "probably fine" is not a defence. It costs a phone room some
 * minutes; it cannot cost $1,500.
 */
export function decideCallingWindow({ state, localHour, localDay }) {
  if (typeof localHour !== "number" || !Number.isFinite(localHour)) {
    return { allowed: false, code: "unknown_time", reason: "We couldn't establish the local time for this number." };
  }
  if (!state) {
    return { allowed: false, code: "unknown_location", reason: "We couldn't establish where this number is, so we can't confirm it's a legal time to call." };
  }
  const rule = effectiveRule(state);
  const open = localDay === 0 && rule.sundayOpen !== null ? Math.max(rule.sundayOpen, rule.open) : rule.open;

  if (localHour < open) {
    return { allowed: false, code: "too_early", reason: `Calls to ${state} open at ${open}:00 local time.` };
  }
  if (localHour >= rule.close) {
    return { allowed: false, code: "too_late", reason: `Calls to ${state} close at ${rule.close}:00 local time.` };
  }
  return { allowed: true, code: "open", reason: `Within calling hours for ${state}.` };
}
