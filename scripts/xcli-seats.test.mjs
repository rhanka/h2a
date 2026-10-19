// Lot L8 RED: seat manifest and campaign engine (SPEC v3 §6.1/§6.4/§6.5,
// §5.5). Dummy seat dirs in mkdtemp; no real login, no model. Red today:
// xcli-seats.mjs does not exist (import failure) and no manifest, ledger,
// caps, preflight or seat-qualified selection exists anywhere.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const seats = await import('./xcli-seats.mjs');

function dummyManifest(dir, entries) {
  for (const entry of entries) fs.mkdirSync(join(dir, entry.authSource), { recursive: true });
  const file = join(dir, 'seats.json');
  fs.writeFileSync(file, JSON.stringify({ version: 1, seatMode: 'interim-file-copy', seats: entries }, null, 2));
  return file;
}

test('L8: a seat-qualified pair selects distinct auth sources per role', () => {
  const dir = fs.mkdtempSync('/tmp/xcli-seats-');
  try {
    const file = dummyManifest(dir, [
      { seatId: 'claude-a', family: 'claude', authSource: 'seat-a' },
      { seatId: 'claude-b', family: 'claude', authSource: 'seat-b' },
    ]);
    const manifest = seats.loadSeatManifest(file);
    assert.equal(manifest.seatMode, 'interim-file-copy');
    const pair = seats.resolveSeatPair(manifest, 'claude-a:claude-b');
    assert.equal(pair.sender.seatId, 'claude-a');
    assert.equal(pair.receiver.seatId, 'claude-b');
    assert.notEqual(pair.sender.authSource, pair.receiver.authSource);
    assert.equal(pair.sharedSeat, false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('L8: a diagonal single-seat cell records sharedSeat', () => {
  const dir = fs.mkdtempSync('/tmp/xcli-seats-');
  try {
    const file = dummyManifest(dir, [{ seatId: 'codex', family: 'codex', authSource: 'seat-codex' }]);
    const manifest = seats.loadSeatManifest(file);
    const pair = seats.resolveSeatPair(manifest, 'codex:codex');
    assert.equal(pair.sharedSeat, true);
    assert.equal(pair.sender.authSource, pair.receiver.authSource);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('L8: an AGY entry pointing at Gemini files is refused as proof', () => {
  const dir = fs.mkdtempSync('/tmp/xcli-seats-');
  try {
    const file = dummyManifest(dir, [
      { seatId: 'agy', family: 'agy', authSource: 'seat-gemini' },
      { seatId: 'gemini', family: 'gemini', authSource: 'seat-gemini' },
    ]);
    fs.writeFileSync(join(dir, 'seat-gemini', 'oauth_creds.json'), '{}');
    assert.throws(() => seats.loadSeatManifest(file), /agy-gemini-reuse/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('L8: the launched-session cap is refused before spawn with a witness', () => {
  const dir = fs.mkdtempSync('/tmp/xcli-seats-');
  try {
    const ledger = seats.createCampaignLedger(dir, { launchedSessions: 1, mcpCallsPerSession: 10, wallClockMs: 60000 });
    assert.equal(seats.debitSession(ledger, 'codex').ok, true);
    const refused = seats.debitSession(ledger, 'codex');
    assert.equal(refused.ok, false);
    assert.equal(refused.code, 'campaign-cap-exhausted');
    assert.equal(refused.spawned, false, 'refused before any process starts');
    assert.equal(ledger.sessionsDebited, 1, 'the refused launch debits nothing');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('L8: preflights, retries and re-runs debit exactly like first attempts', () => {
  const dir = fs.mkdtempSync('/tmp/xcli-seats-');
  try {
    const ledger = seats.createCampaignLedger(dir, { launchedSessions: 3, mcpCallsPerSession: 10, wallClockMs: 60000 });
    assert.equal(seats.debitSession(ledger, 'codex', { kind: 'preflight' }).ok, true);
    assert.equal(seats.debitSession(ledger, 'codex', { kind: 'retry' }).ok, true);
    assert.equal(seats.debitSession(ledger, 'codex', { kind: 'rerun' }).ok, true);
    assert.equal(ledger.sessionsDebited, 3);
    assert.equal(seats.debitSession(ledger, 'codex').ok, false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('L8: killing and resuming continues from the persisted ledger', () => {
  const dir = fs.mkdtempSync('/tmp/xcli-seats-');
  try {
    const first = seats.createCampaignLedger(dir, { launchedSessions: 2, mcpCallsPerSession: 10, wallClockMs: 60000 });
    seats.debitSession(first, 'codex');
    seats.debitSession(first, 'claude');
    const resumed = seats.loadCampaignLedger(dir);
    assert.equal(resumed.sessionsDebited, 2, 'counters survive the restart');
    assert.equal(seats.debitSession(resumed, 'codex').ok, false, 'the resumed campaign honors prior debits');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('L8: a looping session trips the per-session MCP-call cap', () => {
  const counts = seats.createMcpCallCounts();
  for (let i = 0; i < 9; i++) assert.equal(seats.noteMcpCall(counts, 's1', 10).exceeded, false);
  const tenth = seats.noteMcpCall(counts, 's1', 10);
  assert.equal(tenth.exceeded, false, 'the cap-th call still belongs to the session');
  const over = seats.noteMcpCall(counts, 's1', 10);
  assert.equal(over.exceeded, true);
  assert.equal(over.code, 'mcp-call-cap-exceeded');
});

test('L8: the per-family usage-signal inventory names its gaps', () => {
  const inventory = seats.usageSignalInventory();
  for (const family of ['claude', 'codex', 'agy', 'gemini', 'muse', 'vibe']) {
    assert.ok(inventory[family], `${family} is inventoried`);
    if (!inventory[family].obtainable) assert.equal(inventory[family].status, 'source-gap');
  }
});

test('L8: a session fits check precedes the atomic pair debit', () => {
  const dir = fs.mkdtempSync('/tmp/xcli-seats-');
  try {
    const ledger = seats.createCampaignLedger(dir, { launchedSessions: 2, mcpCallsPerSession: 10, wallClockMs: 60000 });
    assert.equal(seats.fitsSessions(ledger, 2), true);
    assert.equal(seats.fitsSessions(ledger, 3), false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('L8: the seat ledger renders per-seat debit totals', () => {
  const dir = fs.mkdtempSync('/tmp/xcli-seats-');
  try {
    const ledger = seats.createCampaignLedger(dir, { launchedSessions: 10, mcpCallsPerSession: 10, wallClockMs: 60000 });
    seats.debitSession(ledger, 'claude-a');
    seats.debitSession(ledger, 'claude-a');
    seats.debitSession(ledger, 'codex', { kind: 'preflight' });
    const table = seats.renderSeatLedger(ledger);
    assert.ok(table.includes('claude-a') && table.includes('codex'), 'every debited seat is listed');
    assert.ok(table.includes('sessionsDebited: 3'), 'the campaign total is stated');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('L8: a seat preflight fails closed on missing logins without model calls', async () => {
  const dir = fs.mkdtempSync('/tmp/xcli-seats-');
  try {
    const authSource = join(dir, 'empty-seat');
    fs.mkdirSync(authSource, { recursive: true });
    const verdict = await seats.runSeatPreflight(
      { seatId: 'codex', family: 'codex', authSource },
      { executables: {}, build: null });
    assert.equal(verdict.ok, false);
    assert.ok(verdict.reason, 'a classified reason is reported');
    assert.equal(verdict.modelCalls, 0, 'no model turn is spent by the preflight');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('L8: manifest auth sources resolve against the manifest directory', () => {
  const dir = fs.mkdtempSync('/tmp/xcli-seats-');
  try {
    const sub = join(dir, 'conf');
    fs.mkdirSync(sub, { recursive: true });
    const file = join(sub, 'seats.json');
    fs.mkdirSync(join(sub, 'seat-a'), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ version: 1, seatMode: 'interim-file-copy',
      seats: [{ seatId: 'codex', family: 'codex', authSource: 'seat-a' }] }));
    const manifest = seats.loadSeatManifest(file);
    assert.equal(manifest.seats[0].authSource, join(sub, 'seat-a'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('L8: campaign pairs resolve seats with single-seat family fallback', () => {
  const dir = fs.mkdtempSync('/tmp/xcli-seats-');
  try {
    fs.mkdirSync(join(dir, 'seat-a'), { recursive: true });
    fs.mkdirSync(join(dir, 'seat-b'), { recursive: true });
    fs.mkdirSync(join(dir, 'seat-c'), { recursive: true });
    const file = join(dir, 'seats.json');
    fs.writeFileSync(file, JSON.stringify({ version: 1, seatMode: 'interim-file-copy', seats: [
      { seatId: 'claude-a', family: 'claude', authSource: 'seat-a' },
      { seatId: 'claude-b', family: 'claude', authSource: 'seat-b' },
      { seatId: 'codex', family: 'codex', authSource: 'seat-c' },
    ] }));
    const manifest = seats.loadSeatManifest(file);
    const pair = seats.resolveCampaignPair(manifest, 'claude-a:claude-b');
    assert.equal(pair.sender, 'claude');
    assert.equal(pair.senderSeat, 'claude-a');
    assert.equal(pair.receiverSeat, 'claude-b');
    assert.equal(pair.sharedSeat, false);
    assert.notEqual(pair.authHomes.sender, pair.authHomes.receiver);
    const familyPair = seats.resolveCampaignPair(manifest, 'codex:codex');
    assert.equal(familyPair.senderSeat, 'codex');
    assert.equal(familyPair.sharedSeat, true);
    assert.throws(() => seats.resolveCampaignPair(manifest, 'claude:codex'), /seat-ambiguous/);
    assert.throws(() => seats.resolveCampaignPair(manifest, 'nobody:codex'), /seat-unknown/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
