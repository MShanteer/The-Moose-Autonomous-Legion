#!/usr/bin/env node
// ══ LEGION CHECK — prove the gates can run before you need them ═════════
//
//   npm run legion:check          free: key source, KIE balance, every roster model against KIE's listings
//   npm run legion:check -- --live  also one tiny real call per rostered model (spends KIE credits)
//
// Listing a model does not prove it will answer; --live does.
// Prints where the key came from, never the key.

import { keyCandidates, BRAIN_ROSTER, BRAIN_SECOND_ROSTER, MUSCLE_ROSTER, SECOND_ROSTER, IMPL_ROSTER } from './legion-key.mjs';
import { askKie, hasKieCredits, isKie, kieCredits, kieId, listKieModels, resolveKieKeySource } from './legion-kie.mjs';
import { existsSync } from 'node:fs';

const live = process.argv.includes('--live');
const SEATS = [['brain', BRAIN_ROSTER], ['brain 2nd', BRAIN_SECOND_ROSTER], ['muscle', MUSCLE_ROSTER], ['muscle 2nd', SECOND_ROSTER], ['impl lanes', IMPL_ROSTER]];
const ROSTER = [...new Set(SEATS.flatMap(([, r]) => r))];
const say = (s) => console.log(s);
say('🦌  Legion gate check');
say('------------------------------------------------------------');
for (const [seat, r] of SEATS) say(`${seat.padEnd(11)}: ${r.join('  →  ')}`);
for (const p of keyCandidates()) say(`${existsSync(p) ? '✅' : '  '} candidate ${p}`);

const available = new Set();
let failed = false;
const fail = (s) => { failed = true; say(`❌ ${s}`); };

for (const m of ROSTER.filter((x) => !isKie(x))) fail(`roster entry ${m} is not on KIE: use kie:<model>`);

if (ROSTER.some(isKie)) {
  try {
    const { key, source } = resolveKieKeySource();
    say(`KIE key    : from ${source}`);
    const credits = await kieCredits({ key });
    if (hasKieCredits(credits)) say(`✅ KIE credits: ${credits} (shared by every model and every session on this key)`);
    else fail(`KIE credits: ${JSON.stringify(credits)}. The gates need a positive balance, shared by every model and every session on this key.`);
    const ids = await listKieModels({ key });
    say(`✅ KIE listings -> ${ids.size} models (/openai/v1/models + /anthropic/v1/models)`);
    for (const m of ROSTER.filter(isKie)) {
      if (ids.has(kieId(m))) available.add(m);
      say(`${ids.has(kieId(m)) ? '✅' : '❌'} roster model ${m}${ids.has(kieId(m)) ? '' : ' NOT listed — fallback will skip it'}`);
    }
  } catch (e) { fail(`KIE: ${String(e.message).slice(0, 240)}`); }
}

const ping = (m) => askKie(m, { system: 'Answer briefly.', user: 'Reply with the single word: pong', maxTokens: 2000, effort: 'low' });

if (live) {
  say('--- live ping (1 tiny real call per rostered model, one at a time) ---');
  for (const m of [...available]) {
    const t0 = Date.now();
    try { await ping(m); say(`✅ ${m} ${((Date.now() - t0) / 1000).toFixed(1)}s`); }
    catch (e) { available.delete(m); say(`❌ ${m} ${String(e.message).slice(0, 160)}`); }
  }
}

say('------------------------------------------------------------');
// Each seat must keep a model: one dead seat is a gate that cannot run.
for (const [seat, r] of SEATS) if (!r.some((m) => available.has(m))) fail(`No ${seat} model is available. Fix the key or the LEGION_*_ROSTER vars before running that gate.`);
if (!failed) say('Gates are runnable:  npm run brain "…"   |   npm run muscle   |   npm run muscle -- --second');
process.exitCode = failed ? 1 : 0;
