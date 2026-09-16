#!/usr/bin/env node
// ══ LEGION CHECK — prove the gates can run before you need them ═════════
//
//   npm run legion:check
//
// One GET /models settles the key question in a single step: 200 means the
// key is good; if models lists but chat 403s later, you are sending a
// different key than you think. Warns when a ZENMUX_API_KEY is exported at OS
// level (the stale-key trap). Prints where the key came from, never the key.

import { resolveKey, keyCandidates, BRAIN_ROSTER, BRAIN_SECOND_ROSTER, MUSCLE_ROSTER, SECOND_ROSTER, IMPL_ROSTER, GATEWAY } from './legion-key.mjs';
import { existsSync } from 'node:fs';

const ROSTER = [...new Set([...BRAIN_ROSTER, ...BRAIN_SECOND_ROSTER, ...MUSCLE_ROSTER, ...SECOND_ROSTER, ...IMPL_ROSTER])];
const say = (s) => console.log(s);
say('🦌  Legion gate check');
say('------------------------------------------------------------');
say(`gateway    : ${GATEWAY}`);
say(`brain      : ${BRAIN_ROSTER.join('  →  ')}`);
say(`brain 2nd  : ${BRAIN_SECOND_ROSTER.join('  →  ')}   (npm run brain -- --second)`);
say(`muscle     : ${MUSCLE_ROSTER.join('  →  ')}`);
say(`muscle 2nd : ${SECOND_ROSTER.join('  →  ')}   (npm run muscle -- --second)`);
say(`impl lanes : ${IMPL_ROSTER.join('  →  ')}   (coding-legion one-shot lanes)`);
for (const p of keyCandidates()) say(`${existsSync(p) ? '✅' : '  '} candidate ${p}`);
if (process.env.ZENMUX_API_KEY) say('⚠️  ZENMUX_API_KEY is exported at OS level — scripts prefer the file; if no file has a key, THIS one is used and may be stale.');

let k;
try { k = resolveKey(); } catch (e) { say(`❌ ${e.message}`); process.exit(1); }
say(`key        : from ${k.source}`);

const res = await fetch(`${GATEWAY}/models`, { headers: { authorization: `Bearer ${k.key}` } });
if (!res.ok) {
  say(`❌ GET /models -> HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  say('   403 access_denied with a file-resolved key means THAT key is dead; with an env-resolved key it means a stale OS-level key.');
  process.exitCode = 1;
} else {
  const d = await res.json();
  const ids = new Set((d.data ?? d.models ?? []).map((m) => m.id ?? m.name).filter(Boolean));
  say(`✅ GET /models -> 200 (${ids.size} models)`);
  let missing = 0;
  for (const m of ROSTER) { const ok = ids.has(m); if (!ok) missing++; say(`${ok ? '✅' : '❌'} roster model ${m}${ok ? '' : ' NOT listed — fallback will skip it'}`); }
  say('------------------------------------------------------------');
  say(missing === ROSTER.length ? '❌ No roster model is available. Fix the LEGION_*_ROSTER vars before running a gate.' : 'Gates are runnable:  npm run brain "…"   |   npm run muscle');
  process.exitCode = missing === ROSTER.length ? 1 : 0;
}
