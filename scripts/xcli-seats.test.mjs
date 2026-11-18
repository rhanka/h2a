// Lot L8 RED: seat manifest and campaign engine (SPEC v3 §6.1/§6.4/§6.5,
// §5.5). Dummy seat dirs in mkdtemp; no real login, no model. Red today:
// xcli-seats.mjs does not exist (import failure) and no manifest, ledger,
// caps, preflight or seat-qualified selection exists anywhere.
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';

const seats = await import('./xcli-seats.mjs');

test('L8 review: a forbidden entrypoint is refused before any executable probe', async t => {
  const dir = fs.mkdtempSync(join(tmpdir(), 'xcli-preflight-order-'));
  const calls = [];
  t.mock.method(childProcess, 'spawnSync', (...args) => {
    calls.push(args);
    return { status: 0, stdout: 'codex 9.9.9\n' };
  });
  syncBuiltinESMExports();
  try {
    const executable = join(dir, 'codex');
    // Inert launcher text. Every spawn is intercepted: no interpreter runs.
    fs.writeFileSync(executable, '#!/usr/bin/env python3.14\n', { mode: 0o700 });
    const result = await seats.runSeatPreflight({ seatId: 'dummy', family: 'codex', authSource: dir },
      { executables: { codex: executable } });
    assert.equal(result.reason, 'python-entrypoint-forbidden:codex');
    assert.equal(calls.length, 0, 'even --version must wait for the entrypoint guard');
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function dummyManifest(dir, entries) {
  for (const entry of entries) fs.mkdirSync(join(dir, entry.authSource), { recursive: true });
  const file = join(dir, 'seats.json');
  fs.writeFileSync(file, JSON.stringify({ version: 1, seatMode: 'interim-file-copy', seats: entries }, null, 2));
  return file;
}

test('L8 R3: simulated manifests retain seat routing without inspecting auth sources', t => {
  const dir = fs.mkdtempSync(join(tmpdir(), 'xcli-seat-simulation-'));
  try {
    const file = dummyManifest(dir, [{ seatId: 'dummy', family: 'agy', authSource: 'auth' }]);
    const source = join(dir, 'auth'), inspected = [];
    t.mock.method(fs, 'readdirSync', path => { inspected.push(path); return []; });
    const manifest = seats.loadSeatManifest(file, { simulated: true });
    assert.deepEqual(inspected, [], 'even an AGY auth directory must not be inspected');
    assert.ok(!Object.hasOwn(manifest.seats[0], 'authSource'), 'simulation discards credential paths');
    const pair = seats.resolveCampaignPair(manifest, 'dummy:dummy');
    assert.equal(pair.senderSeat, 'dummy');
    assert.equal(pair.sharedSeat, true);
    assert.equal(pair.authHomes.sender, undefined);
    assert.equal(pair.authHomes.receiver, undefined);
    assert.ok(!JSON.stringify(manifest).includes(source));
  } finally { t.mock.restoreAll(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('L8: a seat-qualified pair selects distinct auth sources per role', () => {
  const dir = fs.mkdtempSync(join(tmpdir(), 'xcli-seats-'));
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
  const dir = fs.mkdtempSync(join(tmpdir(), 'xcli-seats-'));
  try {
    const file = dummyManifest(dir, [{ seatId: 'codex', family: 'codex', authSource: 'seat-codex' }]);
    const manifest = seats.loadSeatManifest(file);
    const pair = seats.resolveSeatPair(manifest, 'codex:codex');
    assert.equal(pair.sharedSeat, true);
    assert.equal(pair.sender.authSource, pair.receiver.authSource);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('L8: an AGY entry pointing at Gemini files is refused as proof', () => {
  const dir = fs.mkdtempSync(join(tmpdir(), 'xcli-seats-'));
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
  const dir = fs.mkdtempSync(join(tmpdir(), 'xcli-seats-'));
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
  const dir = fs.mkdtempSync(join(tmpdir(), 'xcli-seats-'));
  try {
    const ledger = seats.createCampaignLedger(dir, { launchedSessions: 3, mcpCallsPerSession: 10, wallClockMs: 60000 });
    assert.equal(seats.debitSession(ledger, 'codex', { kind: 'preflight' }).ok, true);
    assert.equal(seats.debitSession(ledger, 'codex', { kind: 'retry' }).ok, true);
    assert.equal(seats.debitSession(ledger, 'codex', { kind: 'rerun' }).ok, true);
    assert.equal(ledger.sessionsDebited, 3);
    assert.equal(seats.debitSession(ledger, 'codex').ok, false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// R15 (P2-3, SPEC v3 §6.4): a preflight that reaches a model debits one
// preflight unit exactly like a first attempt; a model-free preflight debits
// nothing. Red on current code: applyPreflightDebit does not exist, so the
// campaign caller cannot debit a model-reaching preflight.
test('L8 R15: a model-reaching preflight verdict debits one preflight unit', () => {
  const dir = fs.mkdtempSync(join(tmpdir(), 'xcli-seats-'));
  try {
    const ledger = seats.createCampaignLedger(dir, { launchedSessions: 2, mcpCallsPerSession: 10, wallClockMs: 60000 });
    const clean = seats.applyPreflightDebit(ledger, 'muse-a', { ok: true, modelCalls: 0 });
    assert.equal(clean.ok, true);
    assert.equal(clean.debited, false, 'a model-free preflight debits nothing');
    assert.equal(ledger.sessionsDebited, 0);
    const spent = seats.applyPreflightDebit(ledger, 'muse-a', { ok: true, modelCalls: 1 });
    assert.equal(spent.ok, true);
    assert.equal(spent.debited, true);
    assert.equal(spent.kind, 'preflight');
    assert.equal(ledger.sessionsDebited, 1);
    assert.equal(ledger.perSeatDebited['muse-a'], 1);
    const second = seats.applyPreflightDebit(ledger, 'muse-b', { ok: false, reason: 'preflight-auth-unproven', modelCalls: 2 });
    assert.equal(second.ok, true, 'a failed verdict still reached the model: it debits');
    assert.equal(ledger.sessionsDebited, 2);
    const refused = seats.applyPreflightDebit(ledger, 'muse-c', { ok: true, modelCalls: 1 });
    assert.equal(refused.ok, false);
    assert.equal(refused.code, 'campaign-cap-exhausted');
    assert.equal(ledger.sessionsDebited, 2, 'the refused preflight debits nothing');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('L8: killing and resuming continues from the persisted ledger', () => {
  const dir = fs.mkdtempSync(join(tmpdir(), 'xcli-seats-'));
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
  const dir = fs.mkdtempSync(join(tmpdir(), 'xcli-seats-'));
  try {
    const ledger = seats.createCampaignLedger(dir, { launchedSessions: 2, mcpCallsPerSession: 10, wallClockMs: 60000 });
    assert.equal(seats.fitsSessions(ledger, 2), true);
    assert.equal(seats.fitsSessions(ledger, 3), false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('L8: the seat ledger renders per-seat debit totals', () => {
  const dir = fs.mkdtempSync(join(tmpdir(), 'xcli-seats-'));
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

// R15 (class-c RED): a seat preflight refuses launch flags the installed
// binary no longer accepts, checked via --help without login. Red on
// pre-fix code: checkPinnedArgs does not exist.
test('L8 R15: a seat preflight refuses launch flags the binary dropped', async t => {
  const dir = fs.mkdtempSync(join(tmpdir(), 'xcli-preflight-args-'));
  const seat = { seatId: 'codex', family: 'codex', authSource: join(dir, 'seat') };
  fs.mkdirSync(seat.authSource, { recursive: true });
  const executable = join(dir, 'codex');
  fs.writeFileSync(executable, '#!/bin/sh\necho codex\n', { mode: 0o700 });
  let help = '';
  t.mock.method(childProcess, 'spawnSync', (exe, args) => {
    if ((args ?? []).includes('--help')) return { status: 0, stdout: help };
    return { status: 0, stdout: 'codex 9.9.9\n' };
  });
  syncBuiltinESMExports();
  try {
    help = 'Usage: codex [--no-daemon] [--no-alt-screen] <prompt>\n';
    const kept = await seats.runSeatPreflight(seat, { executables: { codex: executable } });
    assert.equal(kept.reason, 'preflight-auth-unproven', 'flags accepted: the preflight reaches the login step');
    assert.equal(kept.modelCalls, 0);
    help = 'Usage: codex <prompt>\n';
    const dropped = await seats.runSeatPreflight(seat, { executables: { codex: executable } });
    assert.equal(dropped.reason, 'preflight-args-unproven');
    assert.equal(dropped.modelCalls, 0, 'no model turn is spent by the refused preflight');
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('L8: a seat preflight fails closed on missing logins without model calls', async () => {
  const dir = fs.mkdtempSync(join(tmpdir(), 'xcli-seats-'));
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
  const dir = fs.mkdtempSync(join(tmpdir(), 'xcli-seats-'));
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

// R21 (bench round 21, agy diagonal): agy prints its help to stderr, never
// stdout. The pinned-args preflight must read usage text from both streams:
// with a stderr-only help the --prompt-interactive launcher flag is present
// and the gate passes instead of refusing preflight-args-unproven.
test('R21: pinned launch flags are read from help text on either stream', () => {
  const dir = fs.mkdtempSync(join(tmpdir(), 'xcli-preflight-streams-'));
  try {
    const executable = join(dir, 'agy');
    fs.writeFileSync(executable, '#!/bin/sh\ncat >&2 <<\'EOF\'\nUsage of agy:\n  --prompt-interactive\n    \tRun an initial prompt interactively and continue the session\nEOF\n', { mode: 0o700 });
    const verdict = seats.checkPinnedArgs('agy', executable, { cwd: dir });
    assert.equal(verdict.ok, true, `stderr-only help must satisfy the gate: ${JSON.stringify(verdict)}`);
    assert.deepEqual(verdict.args, ['--prompt-interactive']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('L8: campaign pairs resolve seats with single-seat family fallback', () => {
  const dir = fs.mkdtempSync(join(tmpdir(), 'xcli-seats-'));
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
