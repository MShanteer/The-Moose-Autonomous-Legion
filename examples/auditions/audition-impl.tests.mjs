// Hidden test harness for the implementation audition. The candidate never
// sees this file; it sees only the spec in audition-impl.mjs. Prints
// "RESULT <passed>/<total>" and the names of failures. Plain script on
// purpose — no reporter to parse, no framework to mis-install.
// The candidate is imported DYNAMICALLY, after a per-run nonce has already
// been written to stdout. The final RESULT line carries the same nonce, and
// both lines are written through a raw fd-1 write captured BEFORE the import
// — not console.log or process.stdout.write, which a candidate module can
// monkeypatch at import time to read the nonce off the real RESULT line.
// This defeats import-time prints, exit-hook prints, and console/stdout
// interception. It is not a sandbox: a module hostile enough to patch fs
// internals runs in-process and could still lie. Audition models you would
// consider shipping; do not audition adversaries.
import { randomUUID } from 'node:crypto';
import { writeSync } from 'node:fs';
const rawWrite = writeSync;                 // captured value, immune to later export mutation
const emit = (s) => rawWrite(1, s + '\n');
const NONCE = randomUUID();
emit(`HARNESS START nonce=${NONCE}`);
const { createCredentialService } = await import('./credentials.mjs');

function makeDb() {
  const tables = {}; let n = 0;
  const t = (name) => (tables[name] ??= new Map());
  return {
    get: (table, id) => t(table).get(id),
    insert: (table, row) => { const id = `${table}_${++n}`; t(table).set(id, { ...row, _id: id }); return id; },
    patch: (table, id, partial) => { const r = t(table).get(id); if (!r) throw new Error('not found'); Object.assign(r, partial); },
    list: (table, pred = () => true) => [...t(table).values()].filter(pred),
    _tables: tables,
  };
}
const H = 3600 * 1000;
function fixture({ auditThrows = false } = {}) {
  const db = makeDb();
  let now = 1_000_000 * H;
  const clock = () => now;
  const events = [];
  const audit = { write: (e) => { if (auditThrows) throw new Error('audit down'); events.push(e); } };
  const svc = createCredentialService(db, clock, audit);
  const cred = (over = {}) => db.insert('credentials', { propertyId: 'P1', guestId: 'g1', kind: 'room', status: 'issued', validFrom: now - H, validUntil: now + H, issuedBy: 'op', ...over });
  return { db, svc, events, cred, setNow: (v) => { now = v; }, now: () => now };
}

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const eq = (a, b, msg) => { if (a !== b) throw new Error(`${msg ?? 'eq'}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const ok = (v, msg) => { if (!v) throw new Error(msg ?? 'expected truthy'); };

test('canUnlock: issued, in window, right property → true', async () => { const f = fixture(); const id = f.cred(); eq(await f.svc.canUnlock(id, 'P1'), true); });
test('canUnlock: expired → false', async () => { const f = fixture(); const id = f.cred({ validUntil: f.now() - 1 }); eq(await f.svc.canUnlock(id, 'P1'), false); });
test('canUnlock: not yet valid → false', async () => { const f = fixture(); const id = f.cred({ validFrom: f.now() + 1 }); eq(await f.svc.canUnlock(id, 'P1'), false); });
test('canUnlock: wrong property → false', async () => { const f = fixture(); const id = f.cred(); eq(await f.svc.canUnlock(id, 'P2'), false); });
test('canUnlock: revoked → false', async () => { const f = fixture(); const id = f.cred({ status: 'revoked' }); eq(await f.svc.canUnlock(id, 'P1'), false); });
test('canUnlock: missing id → false, no throw', async () => { const f = fixture(); eq(await f.svc.canUnlock('nope', 'P1'), false); });
test('canUnlock: window is INCLUSIVE at both edges, exclusive 1 ms outside (spec rule 1)', async () => {
  // Added after the Muscle noticed no test landed on a boundary — an
  // exclusive `< validUntil` would have scored full marks.
  const f = fixture(); const t = f.now();
  const atStart = f.cred({ validFrom: t, validUntil: t + H });
  const atEnd = f.cred({ validFrom: t - H, validUntil: t });
  eq(await f.svc.canUnlock(atStart, 'P1'), true, 'now === validFrom must unlock');
  eq(await f.svc.canUnlock(atEnd, 'P1'), true, 'now === validUntil must unlock');
  f.setNow(t - 1); eq(await f.svc.canUnlock(atStart, 'P1'), false, '1 ms before validFrom');
  f.setNow(t + 1); eq(await f.svc.canUnlock(atEnd, 'P1'), false, '1 ms after validUntil');
});
test('listCredentials: propertyId outside caller scope → throws forbidden', async () => {
  const f = fixture(); f.cred({ propertyId: 'P2' });
  let threw = false; try { await f.svc.listCredentials({ propertyIds: ['P1'] }, 'P2'); } catch (e) { threw = /forbidden/i.test(String(e.message)); }
  ok(threw, 'should throw forbidden');
});
test('listCredentials: propertyId in scope → only that property', async () => {
  const f = fixture(); f.cred({ propertyId: 'P1' }); f.cred({ propertyId: 'P1' }); f.cred({ propertyId: 'P2' });
  const rows = await f.svc.listCredentials({ propertyIds: ['P1', 'P2'] }, 'P1');
  eq(rows.length, 2); ok(rows.every((r) => r.propertyId === 'P1'));
});
test('listCredentials: no propertyId → only caller properties, never everything', async () => {
  const f = fixture(); f.cred({ propertyId: 'P1' }); f.cred({ propertyId: 'P2' }); f.cred({ propertyId: 'P3' });
  const rows = await f.svc.listCredentials({ propertyIds: ['P1', 'P2'] });
  eq(rows.length, 2); ok(rows.every((r) => r.propertyId !== 'P3'), 'P3 leaked');
});
test('listCredentials: caller with no properties → []', async () => {
  const f = fixture(); f.cred({ propertyId: 'P1' });
  const rows = await f.svc.listCredentials({ propertyIds: [] });
  eq(rows.length, 0);
});
test('listCredentials: caps at 200 rows in BOTH branches (spec rule 2)', async () => {
  // Added after the Muscle noticed the spec said "every rule is tested" and
  // nothing exercised the cap — an uncapped read of every credential passed 17/17.
  const f = fixture();
  for (let i = 0; i < 130; i++) f.cred({ propertyId: 'P1' });
  for (let i = 0; i < 130; i++) f.cred({ propertyId: 'P2' });
  for (let i = 0; i < 5; i++) f.cred({ propertyId: 'P9' });
  const both = await f.svc.listCredentials({ propertyIds: ['P1', 'P2'] });
  eq(both.length, 200, 'omitted propertyId must cap at 200'); ok(both.every((r) => r.propertyId !== 'P9'), 'P9 leaked');
  for (let i = 0; i < 80; i++) f.cred({ propertyId: 'P1' });
  const one = await f.svc.listCredentials({ propertyIds: ['P1', 'P2'] }, 'P1');
  eq(one.length, 200, 'explicit propertyId must cap at 200'); ok(one.every((r) => r.propertyId === 'P1'));
});
test('revoke: sets fields, writes audit, returns ok', async () => {
  const f = fixture(); const id = f.cred();
  const r = await f.svc.revoke(id, 'op1', 'lost phone');
  eq(r.ok, true); const row = f.db.get('credentials', id);
  eq(row.status, 'revoked'); eq(row.revokedBy, 'op1'); eq(row.revokeReason, 'lost phone'); eq(row.revokedAt, f.now());
  ok(f.events.some((e) => e.type === 'credential.revoked' && e.credentialId === id && e.actor === 'op1'), 'audit missing');
});
test('revoke: missing credential → ok:false with error, never ok:true', async () => {
  const f = fixture(); const r = await f.svc.revoke('nope', 'op1', 'x');
  eq(r.ok, false); ok(typeof r.error === 'string' && r.error.length > 0, 'error message');
});
test('revoke: audit write fails → ok:false', async () => {
  const f = fixture({ auditThrows: true }); const id = f.cred();
  const r = await f.svc.revoke(id, 'op1', 'x'); eq(r.ok, false);
});
test('issueEventPass: no consent → profile has NO marketingConsent field and no consents row', async () => {
  const f = fixture();
  const id = await f.svc.issueEventPass({ propertyId: 'P1', eventId: 'E1', attendee: { name: 'A', phone: '+9665' }, issuedBy: 'desk' });
  const c = f.db.get('credentials', id); ok(c && c.kind === 'event' && c.status === 'issued', 'credential');
  eq(c.validUntil - c.validFrom, 12 * H, '12h window'); eq(c.validFrom, f.now());
  const p = f.db.get('profiles', c.guestId); ok(p, 'profile'); ok(!('marketingConsent' in p), 'marketingConsent must not be on profile');
  eq(f.db.list('consents').length, 0, 'no consents row');
  ok(f.events.some((e) => e.type === 'credential.issued' && e.credentialId === id), 'audit');
});
test('issueEventPass: explicit consent → separate consents row, still nothing on profile', async () => {
  const f = fixture();
  const id = await f.svc.issueEventPass({ propertyId: 'P1', eventId: 'E1', attendee: { name: 'A', phone: '+9665' }, issuedBy: 'desk', marketingConsent: true });
  const c = f.db.get('credentials', id); const p = f.db.get('profiles', c.guestId);
  ok(!('marketingConsent' in p), 'still nothing on profile');
  const rows = f.db.list('consents'); eq(rows.length, 1);
  eq(rows[0].profileId, c.guestId); eq(rows[0].propertyId, 'P1'); eq(rows[0].channel, 'marketing'); eq(rows[0].optIn, true); eq(rows[0].source, 'event-pass'); eq(rows[0].at, f.now());
});
test('issueRoomKey: idempotent per stay — second call returns first id, no second audit', async () => {
  const f = fixture(); const args = { propertyId: 'P1', guestId: 'g1', stayId: 'S1', validFrom: f.now(), validUntil: f.now() + 2 * H, issuedBy: 'op' };
  const a = await f.svc.issueRoomKey(args); const b = await f.svc.issueRoomKey(args);
  eq(a, b); eq(f.db.list('credentials').length, 1); eq(f.events.filter((e) => e.type === 'credential.issued').length, 1);
  const row = f.db.get('credentials', a); eq(row.kind, 'room'); eq(row.stayId, 'S1'); eq(row.status, 'issued');
});
test('issueRoomKey: revoked key for the stay does not block a new one', async () => {
  const f = fixture(); const args = { propertyId: 'P1', guestId: 'g1', stayId: 'S1', validFrom: f.now(), validUntil: f.now() + 2 * H, issuedBy: 'op' };
  const a = await f.svc.issueRoomKey(args); await f.svc.revoke(a, 'op', 'lost');
  const b = await f.svc.issueRoomKey(args); ok(a !== b, 'new key expected'); eq(f.db.list('credentials').length, 2);
});

// FAIL lines are emitted AS THEY HAPPEN through the same captured raw write:
// a run that dies mid-way still leaves the evidence of what failed before it
// died, and a candidate that monkeypatches console.log cannot suppress them.
// The RESULT line is led by a newline so a candidate's dangling stdout
// (`process.stdout.write('loading…')` with no \n) cannot glue onto it and
// break the runner's line anchor.
let passed = 0;
for (const t of tests) {
  try { await Promise.race([t.fn(), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 3000))]); passed++; }
  catch (e) { emit(`\nFAIL ${t.name} :: ${String(e && e.message || e).slice(0, 140)}`); }
}
emit(`\nRESULT ${passed}/${tests.length} nonce=${NONCE}`);
// Exit explicitly: a correct candidate that leaves a timer or socket open
// would otherwise keep the process alive until the runner's cap kills it.
// Everything above went through synchronous fd writes, so nothing is lost.
process.exit(0);
