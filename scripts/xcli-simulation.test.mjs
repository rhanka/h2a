import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { environment } from './xcli-lab.mjs';
import { verifySimulation, verifyWakeBatch, verifyWakePhases } from './xcli-ci-check.mjs';

// Lot L3 helpers: run one simulated cell with wake-protocol flags and return
// the receipt's first cell. Every run uses temp dirs only, never real state.
function runWakeCell(args, spawnTimeoutMs = 300000) {
  const root = fs.mkdtempSync(join(tmpdir(), 'xcli-wake-'));
  const output = join(root, 'receipt.json');
  const env = { ...environment(join(root, 'env')), TMPDIR: tmpdir(),
    ...(process.env.XCLI_NODE_HEADERS ? { XCLI_NODE_HEADERS: process.env.XCLI_NODE_HEADERS } : {}) };
  const result = spawnSync(process.execPath, [join(import.meta.dirname, 'qualify-cross-cli.mjs'),
    '--simulated', ...args, '--output', output],
  { env, encoding: 'utf8', timeout: spawnTimeoutMs, maxBuffer: 4 * 1024 * 1024 });
  assert.ok(fs.existsSync(output), `qualification produced no receipt: ${result.stdout}\n${result.stderr}`);
  const receipt = JSON.parse(fs.readFileSync(output, 'utf8'));
  return { status: result.status, receipt, cells: receipt.cells };
}

function receiverInboxReads(cell) {
  return cell.evidence.filter(e => e.event === 'inbox' && e.role === 'receiver' && e.ok);
}

test('a delivered envelope without a model reaction fails the live CI gate', () => {
  const root = fs.mkdtempSync(join(tmpdir(), 'xcli-negative-'));
  const output = join(root, 'negative.json');
  const env = { ...environment(join(root, 'env')), TMPDIR: tmpdir(),
    ...(process.env.XCLI_NODE_HEADERS ? { XCLI_NODE_HEADERS: process.env.XCLI_NODE_HEADERS } : {}) };
  const result = spawnSync(process.execPath, [join(import.meta.dirname, 'qualify-cross-cli.mjs'),
    '--simulated', '--pair', 'codex:codex', '--drop-simulated-wake', '--timeout-ms', '30000', '--output', output],
  { env, encoding: 'utf8', timeout: 90000, maxBuffer: 1024 * 1024 });
  assert.equal(result.status, 2, 'negative control must fail the qualification command');
  const receipt = JSON.parse(fs.readFileSync(output, 'utf8'));
  assert.equal(verifySimulation(receipt, true).outcome, 'negative-control-detected');
  assert.throws(() => verifySimulation(receipt), 'delivery alone cannot pass the full matrix gate');
  console.log(`Negative control evidence: ${output}`);
});

// ---------------------------------------------------------------------------
// Lot L3 (SPEC v3 §3.3/§9): autonomous-wake false positive (finding F1).
// A receiver that ignores the wake and polls its inbox periodically must NOT
// earn stage-7 wake credit, even when it reads the probe and replies.
// ---------------------------------------------------------------------------

test('L3: a polling receiver that reads and replies earns no wake credit', () => {
  const { status, cells } = runWakeCell(['--pair', 'claude:codex',
    '--poll', 'periodic:3000:0', '--timeout-ms', '30000']);
  const cell = cells[0];
  assert.equal(status, 2, 'a polling receiver must fail the qualification command');
  assert.equal(cell.status, 'simulated-KO');
  assert.equal(cell.received, true, 'the poller did read the probe (the false positive shape)');
  assert.equal(cell.woke, false, 'polling must fail stage 7');
  assert.equal(cell.wakeFailure, 'wake-polling-detected');
});

test('L3: polling periods and phases across the control matrix fail stage 7', () => {
  const combos = [];
  for (const period of [1000, 5000, 15000, 45000, 90000])
    for (const div of [0, 1, 2]) combos.push([period, Math.round(period * div / 3)]);
  const rows = [];
  for (const [period, phase] of combos) {
    const { status, cells } = runWakeCell(['--pair', 'claude:codex',
      '--poll', `periodic:${period}:${phase}`, '--timeout-ms', '30000']);
    const cell = cells[0];
    rows.push({ period, phase, status: cell.status, woke: cell.woke, wakeFailure: cell.wakeFailure });
    assert.equal(status, 2, `period ${period} phase ${phase}: must fail the command`);
    assert.equal(cell.status, 'simulated-KO', `period ${period} phase ${phase}: must not pass`);
    assert.equal(cell.woke, false, `period ${period} phase ${phase}: no wake credit`);
    // A zero phase ticks at the barrier (baseline read); short periods always
    // land a tick in the baseline or withheld window; the 45 s period with a
    // 15 s phase is caught in the withheld window for any realistic delivery.
    // Only late single ticks can miss the post-release delay bound.
    if (phase === 0 || period <= 15000 || (period === 45000 && phase === 15000)) {
      assert.equal(cell.wakeFailure, 'wake-polling-detected', `period ${period} phase ${phase}: must read during baseline or withheld phase`);
    } else {
      assert.ok(['wake-no-qualifying-read', 'wake-delay-exceeded'].includes(cell.wakeFailure),
        `period ${period} phase ${phase}: must miss the post-release delay bound or never read`);
    }
  }
  console.log('L3 polling matrix (period ms, phase ms, status, woke, mechanism):');
  for (const row of rows) console.log(`  ${row.period} ${row.phase} ${row.status} woke=${row.woke} ${row.wakeFailure}`);
});

test('L3: a slow poller whose first read lands after the wake still fails stage 7', () => {
  const { status, cells } = runWakeCell(['--pair', 'claude:codex',
    '--poll', 'single:30000', '--timeout-ms', '45000']);
  const cell = cells[0];
  const barrier = cell.evidence.find(e => e.event === 'receiver-idle-barrier').at;
  const wake = cell.evidence.find(e => e.event === 'inbox-wake' && e.ok && e.role === 'receiver');
  const reads = receiverInboxReads(cell);
  // The v1 ordering hole, demonstrated on this cell's own evidence: the wake
  // precedes the first post-wake read and nothing reads between barrier and
  // wake — v1 criteria would credit the wake.
  assert.ok(wake && wake.at >= barrier, 'a product wake must precede the read');
  assert.equal(reads.filter(r => r.at >= barrier && r.at < wake.at).length, 0, 'zero reads between barrier and wake');
  assert.ok(reads.length > 0 && reads[0].at > wake.at, 'first read lands strictly after the wake event');
  // The withheld-wake protocol still denies credit: the read misses the delay bound.
  assert.equal(status, 2, 'the slow poller must fail the command');
  assert.equal(cell.woke, false, 'no wake credit for a delayed read');
  assert.ok(['wake-no-qualifying-read', 'wake-delay-exceeded'].includes(cell.wakeFailure));
});

test('L3 unit: overlapping acceptance windows earn no batch credit', () => {
  // Spec §3.3(b2) literal numbers: W0 = W1 = 10 s, D = 3 s, actual wake
  // injections at 21 / 21.414 / 21.732 s after the barrier, first polling
  // read at 23 s in every repetition, all wakes ignored, no earlier read.
  const rep = (wakeS, readS, deliveryS = wakeS - 10.3, releaseS = wakeS - 0.3) => ({ woke: true,
    startedAt: new Date(0).toISOString(), budgetMs: 90000, noPostSendHarnessInput: true,
    wakeWindows: { barrierAt: 0, deliveryAt: Math.round(deliveryS * 1000), releaseAt: Math.round(releaseS * 1000),
      wakeAt: Math.round(wakeS * 1000), firstReadAt: readS * 1000, dMs: 3000,
      w0Ms: 10000, w1Ms: 10000, withholdAt: 0, releaseOffsetMs: Math.round((releaseS - deliveryS - 10) * 1000),
      notifyIntervalMs: 100, timestampUncertaintyMs: 1, preBarrierReads: 0, baselineReads: 0, withheldReads: 0,
      inputJournal: { correlated: true, onlyWakeInput: true, writes: 2,
        lineAt: Math.round(wakeS * 1000) - 100, submitAt: Math.round(wakeS * 1000) } } });
  const overlapping = [rep(21, 23), rep(21.414, 23), rep(21.732, 23)];
  for (const cell of overlapping) assert.deepEqual(verifyWakePhases(cell), [],
    'each repetition passes the cell-level ordering, delay and withheld-window conditions');
  const refused = verifyWakeBatch(overlapping);
  assert.equal(refused.pass, false, 'overlapping windows must earn no stage-7 credit');
  assert.ok(refused.failures.some(f => f.includes('wake-phase-separation-unproven')));
  // A properly separated batch passes: the early acceptance window lies
  // strictly inside the later withheld window with margin.
  const separated = [
    rep(21, 22, 10, 20), rep(41, 42, 10, 40), rep(61, 62, 10, 60),
  ];
  assert.equal(verifyWakeBatch(separated).pass, true, 'a separated batch must pass');
  assert.equal(verifyWakeBatch(separated.slice(0, 2)).pass, false, 'fewer than 3 replications earns no credit');
});

test('L3: overlapping-window replications earn no batch credit, late release fails phase 2', () => {
  // Three close-offset replications (wake-delayed single read: deterministic
  // cell-level pass, structurally overlapping acceptance windows).
  const { status, cells } = runWakeCell(['--pair', 'claude:codex',
    '--poll', 'wakedelay:1000', '--wake-windows', '10000,10000,3000',
    '--wake-release-offsets-ms', '0,414,828', '--timeout-ms', '60000']);
  assert.equal(cells.length, 3, 'three replications must run');
  assert.equal(status, 2, 'the overlapping batch must fail the command');
  for (const cell of cells) {
    assert.equal(cell.woke, false, 'no rep earns stage-7 credit without separation');
    assert.equal(cell.wakeFailure, 'wake-phase-separation-unproven');
  }
  // Second run: same polling schedule, later withheld window containing the
  // whole earlier acceptance window — the read lands while wake is withheld.
  const late = runWakeCell(['--pair', 'claude:codex',
    '--poll', 'single:23000', '--wake-windows', '10000,10000,3000',
    '--wake-release-offsets-ms', '15000', '--timeout-ms', '90000']);
  assert.equal(late.cells[0].woke, false, 'a read during the withheld phase proves polling');
  assert.equal(late.cells[0].wakeFailure, 'wake-polling-detected');
});

test('L3: a withheld-forever twin shows no qualifying read', () => {
  const { status, cells } = runWakeCell(['--pair', 'claude:codex',
    '--withhold-forever', '--timeout-ms', '30000']);
  const cell = cells[0];
  assert.equal(status, 2, 'without a released wake the cell must fail');
  assert.ok(!cell.received, 'no qualifying read without a released wake');
  assert.equal(cell.woke, false);
  assert.equal(cell.wakeFailure, 'wake-withheld-forever');
});

test('L3: an unfunded replication offset blocks before the sender is launched', () => {
  const { status, cells } = runWakeCell(['--pair', 'claude:codex',
    '--wake-release-offsets-ms', '60000', '--timeout-ms', '30000']);
  assert.equal(status, 2);
  assert.equal(cells[0].blocker, 'wake-window-unfunded');
  assert.notEqual(cells[0].woke, true);
  assert.notEqual(cells[0].senderMcp, true);
});

test('L3: a replayed wake produces at most one qualifying read', () => {
  const { status, cells } = runWakeCell(['--pair', 'claude:codex',
    '--replay-wake', '--wake-release-offsets-ms', '0,6000,1000', '--timeout-ms', '45000']);
  const cell = cells[0];
  assert.equal(status, 0, 'the passing cell stays green; the replay is a post-pass control');
  assert.equal(cell.status, 'simulated-OK');
  assert.equal(cell.replayRejected, true, 'the duplicate wake must not produce a second read or reply');
});

test('L4: owner credential material never reaches qualification evidence', () => {
  // Planted owner-style instances plus an ambient-looking config path flow
  // through the login surface; the full evidence (receipt JSON, every event,
  // every path-shaped string) must contain neither canary text, canary file
  // names, canary-shaped instance names nor the owner config path. Real mode
  // with a short budget blocks on wake-window funding before any model turn,
  // so no seat is consumed; the receipt is still written and scanned.
  const CANARY = 'canary-owner-zz9';
  const root = fs.mkdtempSync(join(tmpdir(), 'xcli-canary-'));
  try {
    const authHome = join(root, `${CANARY}-seats`);
    fs.mkdirSync(join(authHome, '.codex'), { recursive: true });
    fs.mkdirSync(join(authHome, '.claude'), { recursive: true });
    writeFileSyncJoin(authHome, '.codex/auth.json', JSON.stringify({ token: `${CANARY}-token` }));
    writeFileSyncJoin(authHome, '.claude/.credentials.json', JSON.stringify({ token: `${CANARY}-token` }));
    writeFileSyncJoin(authHome, '.claude.json', JSON.stringify({ oauthAccount: { id: `${CANARY}-instance` } }));
    const output = join(root, 'receipt.json');
    const env = { ...environment(join(root, 'env')), TMPDIR: tmpdir(), [`${CANARY}_ENV`.toUpperCase()]: `${CANARY}-env-value`,
      ...(process.env.XCLI_NODE_HEADERS ? { XCLI_NODE_HEADERS: process.env.XCLI_NODE_HEADERS } : {}) };
    const result = spawnSync(process.execPath, [join(import.meta.dirname, 'qualify-cross-cli.mjs'),
      '--pair', 'codex:codex', '--auth-home', authHome, '--timeout-ms', '20000', '--output', output],
    { env, encoding: 'utf8', timeout: 240000, maxBuffer: 4 * 1024 * 1024 });
    assert.ok(fs.existsSync(output), `a receipt must be written (exit ${result.status})`);
    const text = fs.readFileSync(output, 'utf8');
    assert.ok(!text.includes(`${CANARY}-token`), 'no planted credential text in evidence');
    assert.ok(!text.includes(`${CANARY}-instance`), 'no planted instance name in evidence');
    assert.ok(!text.includes(`${CANARY}-env-value`), 'no ambient carrier in evidence');
    assert.ok(!text.includes(authHome), 'no owner config path in evidence');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

function writeFileSyncJoin(...parts) {
  fs.writeFileSync(join(...parts.slice(0, -1)), parts[parts.length - 1]);
}

// Lot L9d: a login-free real Gemini cell completes blocked on seat/auth
// grounds — notably blocked, never python-entrypoint-forbidden, wipe
// proven. Durable collateral for the QO4 vendor-runtime invariant.
test('L9d: a login-free real Gemini cell blocks on auth, never on Python', () => {
  const root = fs.mkdtempSync(join(tmpdir(), 'xcli-gemini-'));
  try {
    const output = join(root, 'receipt.json');
    const env = { ...environment(join(root, 'env')), TMPDIR: tmpdir(),
      ...(process.env.XCLI_NODE_HEADERS ? { XCLI_NODE_HEADERS: process.env.XCLI_NODE_HEADERS } : {}) };
    const result = spawnSync(process.execPath, [join(import.meta.dirname, 'qualify-cross-cli.mjs'),
      '--pair', 'gemini:gemini', '--timeout-ms', '30000', '--output', output],
    { env, encoding: 'utf8', timeout: 240000, maxBuffer: 4 * 1024 * 1024 });
    assert.ok(fs.existsSync(output), `a receipt must be written (exit ${result.status})`);
    const receipt = JSON.parse(fs.readFileSync(output, 'utf8'));
    assert.equal(receipt.cells.length, 1);
    assert.equal(receipt.cells[0].status, 'blocked');
    assert.notEqual(receipt.cells[0].blocker, 'python-entrypoint-forbidden');
    assert.notEqual(receipt.cells[0].cleanupFailed, true);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('L3: normal simulated cells keep full wake credit with bounded wording', () => {
  for (const pair of ['claude:codex', 'codex:claude']) {
    const { status, cells } = runWakeCell(['--pair', pair, '--wake-release-offsets-ms', '0,6000,1000', '--timeout-ms', '45000']);
    const cell = cells[0];
    assert.equal(status, 0, `${pair} must stay simulated-OK`);
    assert.equal(cell.woke, true, `${pair} keeps stage-7 credit under the protocol`);
    assert.match(cell.wakeClaim ?? '',
      /^withheld-protocol, periods ≤ \d+ms excluded, 3 separated replications; varying-phase polling not excluded$/,
      `${pair} carries the bounded claim, never an absolute consumption proof`);
  }
});
