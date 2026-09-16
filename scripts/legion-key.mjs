// Shared key resolution + rosters for the Legion gates. No secrets in this file.
//
// KEY RESOLUTION ORDER IS LOAD-BEARING: file before env. On at least one
// production machine a stale ZENMUX_API_KEY was exported at OS level and
// answered 403 access_denied — a plausible-but-wrong error that sent every
// session debugging auth instead of the body. Resolve the file first.
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

// Any OpenAI-compatible gateway. ZenMux is the default because that is what
// the production runs used; swap with LEGION_UPSTREAM_URL.
export const GATEWAY = (process.env.LEGION_UPSTREAM_URL ?? 'https://zenmux.ai/api/v1').replace(/\/$/, '');

// ROSTERS — set by MEASUREMENT, never by name. The defaults below are what
// three auditions on one domain (a hotel digital-key system, 2026-09-15)
// found — see docs/AUDITION_METHOD.md. They are a starting point, not a
// recommendation: on YOUR domain, run examples/auditions/* and overwrite.
//
//   seat        default                    measured
//   BRAIN       deepseek-v4.1-flash        5/5 seeded planning traps; reasoned about the offline lock
//               z-ai/glm-5.3-flash         5/5; deepest domain reasoning; slow
//               inclusionai/ling-3.0-flash 5/5 in 17 s; cheapest
//   BRAIN 2nd   openai/gpt-5.6-luna        5/5, terse, a different lineage
//               openai/gpt-5-mini          4-5/5
//   MUSCLE      deepseek-v4.1-flash        4/4 planted bugs, no false positive
//               inclusionai/ling-3.0-flash 4/4, cheapest
//   MUSCLE 2nd  tencent/hy3                4/4; answered every real-size diff
//               z-ai/glm-5.3-flash         4/4 review, 5/5 plan, 19/19 build
//   IMPL lanes  openai/gpt-5-nano          19/19 hidden tests in 12 s — and 1/5 as a planner
//               openai/gpt-5.4-nano        19/19 in 15 s
//               qwen/qwen3.8-flash         19/19 in 18 s — and a preamble-only reviewer on big diffs
// The same model family split by ROLE. Seat by role, not by family.
const list = (s) => s.split(',').map((x) => x.trim()).filter(Boolean);
if (process.env.LEGION_ROSTER && !(process.env.LEGION_BRAIN_ROSTER && process.env.LEGION_MUSCLE_ROSTER)) {
  console.error('[legion] LEGION_ROSTER is deprecated; it now seeds LEGION_BRAIN_ROSTER / LEGION_MUSCLE_ROSTER unless those are set.');
}
export const BRAIN_ROSTER = list(process.env.LEGION_BRAIN_ROSTER ?? process.env.LEGION_ROSTER ?? 'deepseek/deepseek-v4.1-flash,z-ai/glm-5.3-flash,inclusionai/ling-3.0-flash');
export const BRAIN_SECOND_ROSTER = list(process.env.LEGION_BRAIN_SECOND_ROSTER ?? 'openai/gpt-5.6-luna,openai/gpt-5-mini');
export const MUSCLE_ROSTER = list(process.env.LEGION_MUSCLE_ROSTER ?? process.env.LEGION_ROSTER ?? 'deepseek/deepseek-v4.1-flash,inclusionai/ling-3.0-flash');
export const SECOND_ROSTER = list(process.env.LEGION_SECOND_ROSTER ?? 'tencent/hy3,z-ai/glm-5.3-flash');
export const IMPL_ROSTER = list(process.env.LEGION_IMPL_ROSTER ?? 'openai/gpt-5-nano,openai/gpt-5.4-nano,qwen/qwen3.8-flash');
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

// Tolerates `export ZENMUX_API_KEY=…`, surrounding whitespace, quotes, and
// CRLF. An empty value (`ZENMUX_API_KEY=`) is skipped, not returned as "".
// HORIZONTAL whitespace only ([ \t], never \s): `\s*` crosses newlines, and
// an empty value would have captured the NEXT line — another provider's
// secret — as the key. Caught by the review gate on this very file.
// Global: EVERY assignment in the file is examined and the first non-empty
// value wins. A non-global match returned only the first line, so an empty
// `ZENMUX_API_KEY=` above a real one skipped the whole FILE (review pass 6).
const KEY_LINE = /^[ \t]*(?:export[ \t]+)?ZENMUX_API_KEY[ \t]*=[ \t]*(.*)$/gm;

function firstKeyIn(text) {
  for (const m of text.matchAll(KEY_LINE)) {
    const v = m[1].trim().replace(/^["']|["']$/g, '').trim();
    if (v) return v;
  }
  return '';
}

export function resolveKey() {
  if (process.env.LEGION_UPSTREAM_KEY) return { key: process.env.LEGION_UPSTREAM_KEY, source: 'env LEGION_UPSTREAM_KEY (explicit override)' };
  for (const p of keyCandidates()) {
    if (!existsSync(p)) continue;
    const v = firstKeyIn(readFileSync(p, 'utf8'));
    if (v) return { key: v, source: `file ${p}` };
  }
  if (process.env.ZENMUX_API_KEY) return { key: process.env.ZENMUX_API_KEY, source: 'env ZENMUX_API_KEY (LAST RESORT — may be a stale one)' };
  throw new Error(`No ZENMUX_API_KEY found. Checked: ${keyCandidates().join(', ')}, then env. Copy .env.local.example to .env.local.`);
}
