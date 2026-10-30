import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { environment } from './xcli-lab.mjs';
import { verifySimulation, verifyWakeBatch, verifyWakePhases } from './xcli-ci-check.mjs';

import { runWakeCell, receiverInboxReads } from './xcli-simulation-fixture.mjs';
import { removeReportedCampaignRoot } from './xcli-lab.mjs';

test('L8 R4: an MCP cap during initial readiness remains a measured failure', () => {
  const { status, receipt, cells: [cell] } = runWakeCell(['--pair', 'claude:codex',
    '--mcp-call-cap', '1', '--timeout-ms', '5000']);
  assert.equal(status, 2);
  assert.deepEqual(receipt.counts, { 'simulated-OK': 0, 'simulated-KO': 1, blocked: 0 });
  assert.equal(cell.failure, 'mcp-call-cap-exceeded');
  assert.equal(cell.blocker, undefined);
  assert.ok(cell.evidence.some(e => e.event === 'mcp-call-cap-exceeded' && e.count === 2 && e.cap === 1));
  assert.equal(cell.processRecovery, true);
  assert.equal(cell.parentProcessRecovery, true);
  assert.equal(cell.secretWipe, true);
  assert.equal(cell.parentSecretWipe, true);
});

test('L8 R4: an MCP cap breach stops later campaign cells after the measured failure', () => {
  const { status, receipt, cells } = runWakeCell(['--pair', 'claude:codex',
    '--wake-release-offsets-ms', '0,100', '--mcp-call-cap', '1', '--timeout-ms', '5000']);
  assert.equal(status, 2);
  assert.equal(cells.length, 2);
  assert.equal(cells[0].failure, 'mcp-call-cap-exceeded');
  assert.equal(cells[0].blocker, undefined);
  assert.ok(cells[0].evidence.some(e => e.event === 'mcp-call-cap-exceeded' && e.count === 2 && e.cap === 1));
  assert.equal(cells[1].status, 'blocked');
  assert.equal(cells[1].blocker, 'campaign-cap-exhausted');
  assert.deepEqual(cells[1].evidence, [{ event: 'cap-refused', cap: 'mcp-call-cap' }]);
  assert.deepEqual(receipt.counts, { 'simulated-OK': 0, 'simulated-KO': 1, blocked: 1 });
  assert.ok(receipt.ledgerRefusals.some(r => r.code === 'campaign-cap-exhausted' && r.cap === 'mcp-call-cap'),
    'the campaign-wide refusal is witnessed in the ledger');
});

test('a delivered envelope without a model reaction fails the live CI gate', () => {
  const root = fs.mkdtempSync(join(tmpdir(), 'xcli-negative-'));
  const output = join(root, 'negative.json');
  const env = { ...environment(join(root, 'env')), TMPDIR: tmpdir(),
    ...(process.env.XCLI_NODE_HEADERS ? { XCLI_NODE_HEADERS: process.env.XCLI_NODE_HEADERS } : {}) };
  const result = spawnSync(process.execPath, [join(import.meta.dirname, 'qualify-cross-cli.mjs'),
    '--simulated', '--pair', 'codex:codex', '--drop-simulated-wake', '--timeout-ms', '60000', '--output', output],
  { env, encoding: 'utf8', timeout: 90000, maxBuffer: 1024 * 1024 });
  removeReportedCampaignRoot(result.stdout);
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
    '--poll', 'periodic:3000:0', '--timeout-ms', '60000']);
  const cell = cells[0];
  assert.equal(status, 2, 'a polling receiver must fail the qualification command');
  assert.equal(cell.status, 'simulated-KO');
  assert.equal(cell.received, true, 'the poller did read the probe (the false positive shape)');
  assert.equal(cell.woke, false, 'polling must fail stage 7');
  assert.equal(cell.wakeFailure, 'wake-polling-detected');
});

test('L3: a slow poller whose first read lands after the wake still fails stage 7', () => {
  const { status, cells } = runWakeCell(['--pair', 'claude:codex',
    '--poll', 'single:60000', '--timeout-ms', '90000']);
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

test('L3: fixed polling never earns batch credit under close offsets or late release', () => {
  // Keep the same barrier-relative polling schedule across all repetitions.
  // Startup jitter may move the read into W0/W1 or beyond D; all of those
  // observations must fail. The literal overlapping v2 case is pinned above.
  const { status, cells } = runWakeCell(['--pair', 'claude:codex',
    '--poll', 'single:23000', '--wake-windows', '10000,10000,3000',
    '--wake-release-offsets-ms', '0,414,828', '--timeout-ms', '60000']);
  assert.equal(cells.length, 3, 'three replications must run');
  assert.equal(status, 2, 'the overlapping batch must fail the command');
  for (const cell of cells) {
    assert.equal(cell.woke, false, 'no rep earns stage-7 credit without separation');
    if (cell.wakeWindows.preBarrierReads + cell.wakeWindows.baselineReads + cell.wakeWindows.withheldReads > 0) {
      assert.equal(cell.wakeFailure, 'wake-polling-detected');
    } else {
      assert.ok(['wake-phase-separation-unproven', 'wake-delay-exceeded', 'wake-no-qualifying-read'].includes(cell.wakeFailure));
    }
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
    '--withhold-forever', '--timeout-ms', '60000']);
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
    '--replay-wake', '--wake-release-offsets-ms', '0,6000,1000', '--timeout-ms', '60000']);
  const cell = cells[0];
  assert.equal(status, 0, 'the passing cell stays green; the replay is a post-pass control');
  assert.equal(cell.status, 'simulated-OK');
  assert.equal(cell.replayRejected, true, 'the duplicate wake must not produce a second read or reply');
});

test('L3: a receiver that pops the probe after reading keeps its wake proof', () => {
  // V3 §3.2 authorizes consumption: `read` then `pop` is a live receive.
  // Replay the reviewer's three separated replications: consuming the probe
  // must preserve the delivery witness and all eight qualification stages.
  const root = fs.mkdtempSync(join(tmpdir(), 'xcli-pop-'));
  try {
    const output = join(root, 'receipt.json');
    const env = { ...environment(join(root, 'env')), TMPDIR: tmpdir(), XCLI_SIM_POP: '1',
      ...(process.env.XCLI_NODE_HEADERS ? { XCLI_NODE_HEADERS: process.env.XCLI_NODE_HEADERS } : {}) };
    const result = spawnSync(process.execPath, [join(import.meta.dirname, 'qualify-cross-cli.mjs'),
      '--simulated', '--pair', 'claude:codex', '--wake-release-offsets-ms', '0,6000,1000',
      '--timeout-ms', '60000', '--output', output],
    { env, encoding: 'utf8', timeout: 300000, maxBuffer: 4 * 1024 * 1024 });
    removeReportedCampaignRoot(result.stdout);
    const cells = JSON.parse(fs.readFileSync(output, 'utf8')).cells;
    assert.equal(result.status, 0, JSON.stringify(cells.map(c => ({ status: c.status, wakeFailure: c.wakeFailure, blocker: c.blocker }))));
    assert.equal(cells.length, 3, 'all separated replications execute');
    for (const cell of cells) {
      assert.equal(cell.received, true, 'read-then-pop is a live receive');
      assert.equal(cell.replyDelivered, true, 'the reply still lands');
      assert.equal(cell.woke, true, 'wake proof survives probe consumption');
      assert.equal(cell.status, 'simulated-OK');
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
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
    removeReportedCampaignRoot(result.stdout);
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
    removeReportedCampaignRoot(result.stdout);
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
    const { status, cells } = runWakeCell(['--pair', pair, '--wake-release-offsets-ms', '0,6000,1000', '--timeout-ms', '60000']);
    const cell = cells[0];
    assert.equal(status, 0, `${pair} must stay simulated-OK`);
    assert.equal(cell.woke, true, `${pair} keeps stage-7 credit under the protocol`);
    assert.match(cell.wakeClaim ?? '',
      /^withheld-protocol, periods ≤ \d+ms excluded, 3 separated replications; varying-phase polling not excluded$/,
      `${pair} carries the bounded claim, never an absolute consumption proof`);
  }
});
