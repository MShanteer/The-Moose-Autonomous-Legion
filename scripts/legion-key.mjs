// Shared rosters and key lookup helpers for the Legion gates. No secrets in this file.
//
// KEY RESOLUTION ORDER IS LOAD-BEARING: file before env. A stale key exported at
// OS level once answered 403 access_denied, a plausible-but-wrong error that sent
// every session debugging auth instead of the body. Resolve the file first.
import path from 'node:path';

// ROSTERS: set by MEASUREMENT, never by name. KIE is the only gateway
// (legion-kie.mjs); every entry is `kie:<model>`. KIE audition 2026-11-05, one small
// seeded test on one product: a first sort, so re-audition on your own domain.
//
//   seat        default                 measured
//   BRAIN       kie:gpt-6-luna          planner 4/5, the best
//               kie:gpt-6.1-sol         planner 2/5, reviewer 4/4; the fallback, not the lead
//   BRAIN 2nd   kie:claude-sonnet-5-5   planner 3/5, obeyed one trap; non-GPT lineage
//               kie:claude-haiku-5-5    planner not measured (capacity error)
//   MUSCLE      kie:gpt-6.1-sol         reviewer 4/4; owner's pick to review and enhance
//               kie:claude-sonnet-5-5   reviewer 4/4
//               kie:claude-haiku-5-5    reviewer 4/4
//   MUSCLE 2nd  kie:claude-sonnet-5-5   reviewer 4/4; non-GPT lineage
//               kie:claude-haiku-5-5    reviewer 4/4
//   IMPL lanes  kie:gpt-6.1-sol         owner's pick for enhancing code; a different family reviews what it writes
//               kie:gpt-6-luna          reviewer 3/4
// The same model family split by ROLE. Seat by role, not by family.
const list = (s) => s.split(',').map((x) => x.trim()).filter(Boolean);
if (process.env.LEGION_ROSTER && !(process.env.LEGION_BRAIN_ROSTER && process.env.LEGION_MUSCLE_ROSTER)) {
  console.error('[legion] LEGION_ROSTER is deprecated; it now seeds LEGION_BRAIN_ROSTER / LEGION_MUSCLE_ROSTER unless those are set.');
}
export const BRAIN_ROSTER = list(process.env.LEGION_BRAIN_ROSTER ?? process.env.LEGION_ROSTER ?? 'kie:gpt-6-luna,kie:gpt-6.1-sol');
export const BRAIN_SECOND_ROSTER = list(process.env.LEGION_BRAIN_SECOND_ROSTER ?? 'kie:claude-sonnet-5-5,kie:claude-haiku-5-5');
export const MUSCLE_ROSTER = list(process.env.LEGION_MUSCLE_ROSTER ?? process.env.LEGION_ROSTER ?? 'kie:gpt-6.1-sol,kie:claude-sonnet-5-5,kie:claude-haiku-5-5');
export const SECOND_ROSTER = list(process.env.LEGION_SECOND_ROSTER ?? 'kie:claude-sonnet-5-5,kie:claude-haiku-5-5');
export const IMPL_ROSTER = list(process.env.LEGION_IMPL_ROSTER ?? 'kie:gpt-6.1-sol,kie:gpt-6-luna');
export const ROSTER = MUSCLE_ROSTER; // back-compat alias

// `--roster a,b` on any gate overrides the default for that run.
export function rosterFromArgv(argv, fallback) {
  const i = argv.indexOf('--roster');
  if (i === -1) return { roster: fallback, rest: argv };
  const roster = list(argv[i + 1] ?? '');
  const rest = [...argv.slice(0, i), ...argv.slice(i + 2)];
  if (!roster.length) console.error(`[legion] --roster given with no value; using the default roster ${fallback.join(' → ')}`);
  return { roster: roster.length ? roster : fallback, rest };
}

// Where the key may live, in order: this repo's .env.local, its .env, then an
// optional sibling repo named by LEGION_REPO (one key shared across repos on
// one machine), then the environment as a LAST resort.
export const LEGION_REPO = process.env.LEGION_REPO ?? '';

export function keyCandidates() {
  const c = [path.resolve('.env.local'), path.resolve('.env')];
  if (LEGION_REPO) c.push(path.join(LEGION_REPO, '.env.local'), path.join(LEGION_REPO, '.env'));
  return c;
}

// Tolerates `export KIE_API_KEY=…`, surrounding whitespace, quotes, and
// CRLF. An empty value (`KIE_API_KEY=`) is skipped, not returned as "".
// HORIZONTAL whitespace only ([ \t], never \s): `\s*` crosses newlines, and
// an empty value would have captured the NEXT line — another provider's
// secret — as the key. Caught by the review gate on this very file.
// Global: EVERY assignment in the file is examined and the first non-empty
// value wins. A non-global match returned only the first line, so an empty
// `KIE_API_KEY=` above a real one skipped the whole FILE (review pass 6).
export function firstAssignment(text, name) {
  for (const m of text.matchAll(new RegExp(`^[ \\t]*(?:export[ \\t]+)?${name}[ \\t]*=[ \\t]*(.*)$`, 'gm'))) {
    const v = m[1].trim().replace(/^["']|["']$/g, '').trim();
    if (v) return v;
  }
  return '';
}
