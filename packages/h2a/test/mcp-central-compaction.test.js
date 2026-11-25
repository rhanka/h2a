import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PerformanceObserver } from 'node:perf_hooks';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { authenticatedHttpRequest } from '../dist/runtime/handover/authenticated-http.js';
import { currentIdentity } from '../dist/runtime/handover/admission.js';
import { endedOwner } from '../dist/runtime/handover/generation-end.js';
import { LaunchJournal } from '../dist/runtime/handover/launch-memo.js';
import { establishWriterControl, updateWriterControl, writerDirectory } from '../dist/runtime/handover/mutation.js';
import {
  MIGRATION_COMMIT_BATCH_SIZE,
  MIGRATION_MAX_SLICE_MS,
  MIGRATION_SCAN_BATCH_SIZE,
  MIGRATION_SLICE_MEASURE_NAME,
  OperationLedger,
  OwnershipRegistry
} from '../dist/runtime/handover/ownership.js';
import { Participants } from '../dist/runtime/handover/participants.js';
import { publishState, readState } from '../dist/runtime/handover/state.js';
import { canonicalBytes, digest, sign } from '../dist/runtime/handover/wire.js';
import { captureCentralAttachment } from '../dist/runtime/mcp-central-context.js';
import { startCentralMcpServer } from '../dist/runtime/mcp-central.js';

const BIN_PATH = fileURLToPath(new URL('../dist/bin.js', import.meta.url));
const OWNERSHIP_DIST = fileURLToPath(new URL('../dist/runtime/handover/ownership.js', import.meta.url));

function writeCanonicalFile(path, value) {
  fs.writeFileSync(path, Buffer.concat([canonicalBytes(value), Buffer.from('\n')]), { mode: 0o600 });
}

function makeDir(t, prefix) {
  const dir = fs.mkdtempSync(join(tmpdir(), prefix));
  t.after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

function makeFakeIdentity(overrides = {}) {
  const base = currentIdentity();
  return { ...base, pid: 999_999, startTime: 1, ...overrides };
}

function seedHistoricalState(stateDir, options) {
  fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  const oldGen = options.oldGeneration ?? randomUUID();
  const deadId = makeFakeIdentity();
  const key = options.key ?? Buffer.alloc(32, 7);
  const root = options.root;

  if (options.operations) {
    for (let i = 0; i < options.operations; i++) {
      const opId = `hist-op-${i}`;
      const attId = options.attachmentId ?? `hist-att-${i % 4}`;
      const opValue = {
        schemaVersion: 1,
        revision: 2,
        operationId: opId,
        attachmentId: attId,
        ownerGeneration: oldGen,
        executionOwner: deadId,
        kind: 'call',
        state: 'completed',
        result: { completed: true, idx: i }
      };
      writeCanonicalFile(join(stateDir, `operation-${digest(opId).slice(7)}.json`), opValue);
      if (options.effects && i < options.effects) {
        const effValue = {
          schemaVersion: 1,
          operationId: opId,
          attachmentId: attId,
          destination: 'current-owner',
          result: { completed: true, idx: i }
        };
        writeCanonicalFile(
          join(stateDir, `effect-${digest({ operationId: opId, result: effValue.result }).slice(7)}.json`),
          effValue
        );
      }
    }
  }

  if (options.pendingOperations) {
    for (let i = 0; i < options.pendingOperations; i++) {
      const opId = `pending-op-${i}`;
      const opValue = {
        schemaVersion: 1,
        revision: 1,
        operationId: opId,
        attachmentId: options.pendingAttachmentId ?? 'pending-att',
        ownerGeneration: oldGen,
        executionOwner: deadId,
        kind: 'call',
        state: 'pending',
        result: null
      };
      writeCanonicalFile(join(stateDir, `operation-${digest(opId).slice(7)}.json`), opValue);
    }
  }

  if (options.generationEnds) {
    for (let i = 0; i < options.generationEnds; i++) {
      const gen = randomUUID();
      const sourceMarker = {
        schemaVersion: 2,
        service: 'h2a-mcp-central',
        namespaceId: options.namespaceId ?? 'ns-seed',
        prefixId: `sha256:${'a'.repeat(64)}`,
        uid: process.getuid(),
        stateDirectory: stateDir,
        endpoint: 'http://127.0.0.1:43210/mcp',
        endpointMode: 'discovered',
        generation: gen,
        publicationEpoch: { bootId: deadId.bootId, counter: i + 1 },
        predecessorGeneration: null,
        root,
        pid: 999_999,
        startedAt: '2026-11-21T00:00:00.000Z',
        processIdentity: deadId,
        packageVersion: '0.98.11',
        buildId: 'seed',
        manifestDigest: `sha256:${'b'.repeat(64)}`,
        protocol: 2,
        handoverProtocol: 1,
        handoverCapabilities: {
          managedImage: false,
          endpointPinned: false,
          restrictions: [],
          primitives: [],
          attachTransfer: false,
          liveCoordinator: false
        },
        mcpProtocolVersions: ['2025-06-18'],
        descriptorDigest: `sha256:${'c'.repeat(64)}`,
        contractDigest: `sha256:${'d'.repeat(64)}`,
        state: 'ready',
        token: randomUUID(),
        authKeyReference: 'authentication-key.json'
      };
      const value = {
        schemaVersion: 1,
        purpose: 'generation-ended',
        generation: gen,
        source: sourceMarker,
        markerDigest: digest(sourceMarker),
        endedAt: 1_700_000_000_000 + i
      };
      const proof = {
        ...value,
        mac: sign(key, 'compatibility', { service: sourceMarker.service, namespaceId: sourceMarker.namespaceId, generation: gen }, value)
      };
      writeCanonicalFile(join(stateDir, `generation-end-${gen}.json`), proof);
    }
  }

  if (options.launches) {
    for (let i = 0; i < options.launches; i++) {
      const launchId = randomUUID();
      const attId = options.launchAttachmentId ?? `launch-att-${i % 3}`;
      const launchName = `hist-launch-${i}`;
      const memo = {
        schemaVersion: 1,
        attachmentId: attId,
        launchName,
        launchId,
        initialArgumentsDigest: digest({ name: launchName }),
        state: 'completed',
        executionOwner: deadId,
        childProcessIdentity: null,
        launchReceiptReference: `.h2a/runs/${launchName}/launch.json`,
        launchTokenBinding: digest(`secret-${i}`),
        briefReceipt: { delivered: true, launchId },
        terminalResult: { state: 'started', ok: true, prompt: { delivered: true } },
        retrySafe: false
      };
      writeCanonicalFile(
        join(stateDir, `launch-${digest({ attachmentId: attId, launchName }).slice(7)}.json`),
        memo
      );
      writeCanonicalFile(
        join(stateDir, `launch-location-${launchId}.json`),
        { schemaVersion: 1, launchId, attachmentId: attId, workspaceRoot: root, delegation: null }
      );
    }
  }

  return { oldGen, deadId };
}

async function waitForStatus(markerPath, marker, endpoint, predicate, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    const res = await authenticatedHttpRequest(markerPath, marker, new URL('/_h2a-central/status', endpoint));
    last = await res.json();
    assert.equal(typeof last.ledgerMigrationComplete, 'boolean', `status must expose boolean ledgerMigrationComplete; got=${JSON.stringify(last)}`);
    if (predicate(last)) return last;
    await new Promise(r => setTimeout(r, 25));
  }
  throw new Error(`Timed out waiting for central status condition; last=${JSON.stringify(last)}`);
}

// Benchmark & durability split (NB-3): T1.1, T1.2 and T1.7 mock fs.fsyncSync to measure
// event-loop scheduling lag and O(1) I/O counts without disk-flush jitter, while T1.3 and
// T1.8 exercise full fsyncSync durability on compaction, crash recovery and --restore.
test('T1.1: non-blocking migration on 2500 historical operations and >256 effects snapshot bound', { timeout: 60_000 }, async t => {
  const dir = fs.mkdtempSync(join(tmpdir(), 'mcp-l1-t11-'));
  const root = join(dir, 'store');
  const runtimeBase = join(dir, 'run');
  const stateDir = join(runtimeBase, 'h2a-mcp-central');
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  fs.mkdirSync(runtimeBase, { recursive: true, mode: 0o700 });

  seedHistoricalState(stateDir, {
    root,
    operations: 2_500,
    effects: 2_500,
    generationEnds: 200,
    pendingOperations: 2
  });

  // Mock fsyncSync to measure synchronous migration slice budgets without disk flush jitter.
  t.mock.method(fs, 'fsyncSync', () => {});
  syncBuiltinESMExports();
  let central;
  const rawSlices = [];
  const collectEntries = entries => {
    for (const entry of entries) {
      if (entry.name !== MIGRATION_SLICE_MEASURE_NAME) continue;
      rawSlices.push({
        wallMs: entry.duration,
        directory: entry.detail?.directory,
        phase: entry.detail?.phase,
        items: entry.detail?.items ?? 0,
        cpuMs: entry.detail?.cpuMs ?? 0,
        yieldedAfter: Boolean(entry.detail?.yieldedAfter)
      });
    }
  };
  const sliceObserver = new PerformanceObserver(list => collectEntries(list.getEntries()));
  sliceObserver.observe({ type: 'measure' });
  t.after(async () => {
    sliceObserver.disconnect();
    try { await central?.stop(); } finally {
      t.mock.restoreAll();
      syncBuiltinESMExports();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  const startMs = performance.now();
  central = await startCentralMcpServer({
    root,
    runtimeBase,
    physicalPrefix: dir,
    env: {},
    idleTimeoutMs: 60_000
  });
  assert.equal(central.kind, 'started');
  const marker = readState(central.markerPath, 'marker').value;

  // Ping and initialize must complete while background migration is still running (diagnostic wall times only).
  const pingStart = performance.now();
  const pingRes = await fetch(new URL('/_h2a-central/ping', central.endpoint));
  const pingMs = performance.now() - pingStart;
  assert.equal(pingRes.status, 200);

  const statusBefore = await authenticatedHttpRequest(central.markerPath, marker, new URL('/_h2a-central/status', central.endpoint));
  const statusBeforeJson = await statusBefore.json();
  assert.equal(typeof statusBeforeJson.ledgerMigrationComplete, 'boolean', 'status must expose ledgerMigrationComplete');

  const doInitialize = async (id) => {
    const t0 = performance.now();
    const res = await authenticatedHttpRequest(central.markerPath, marker, central.endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-h2a-workspace': encodeURIComponent(dir)
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id,
        method: 'initialize',
        params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't11', version: '1' } }
      })
    });
    return { status: res.status, ms: performance.now() - t0 };
  };
  // First initialize warms V8/MCP SDK transport paths; second proves causal interleaving
  // while background migration is actively running (ledgerMigrationComplete === false).
  const warmupInit = await doInitialize(1);
  assert.equal(warmupInit.status, 200);
  const statusMidRes = await authenticatedHttpRequest(central.markerPath, marker, new URL('/_h2a-central/status', central.endpoint));
  const statusMid = await statusMidRes.json();
  assert.equal(statusMid.ledgerMigrationComplete, false, 'migration should still be in progress during initialize check');
  collectEntries(sliceObserver.takeRecords());
  const slicesBeforeInit = rawSlices.filter(s => s.directory === marker.stateDirectory).length;
  assert.ok(slicesBeforeInit > 0, `expected background migration slices to advance before initialize (got ${slicesBeforeInit})`);

  const measuredInit = await doInitialize(2);
  const initMs = measuredInit.ms;
  assert.equal(measuredInit.status, 200);
  const totalWallMs = performance.now() - startMs;
  const statusAfterInitRes = await authenticatedHttpRequest(central.markerPath, marker, new URL('/_h2a-central/status', central.endpoint));
  const statusAfterInit = await statusAfterInitRes.json();
  assert.equal(statusAfterInit.ledgerMigrationComplete, false, 'initialize must complete while background migration is still running');

  // Wait for background migration to complete, then flush PerformanceObserver records for our migration slices.
  await waitForStatus(central.markerPath, marker, central.endpoint, s => s.ledgerMigrationComplete === true, 30_000);
  await new Promise(r => setImmediate(r));
  collectEntries(sliceObserver.takeRecords());
  sliceObserver.disconnect();

  const slices = rawSlices.filter(s => s.directory === marker.stateDirectory);
  assert.ok(slices.length > 0, 'expected PerformanceObserver to capture background migration slices');
  assert.ok(
    slices.length > slicesBeforeInit,
    `expected background migration slices to advance after initialize (before=${slicesBeforeInit}, after=${slices.length})`
  );
  const scanSlices = slices.filter(s => s.phase === 'scan');
  const selectSlices = slices.filter(s => s.phase === 'select');
  const commitSlices = slices.filter(s => s.phase === 'commit');
  const finalizeSlices = slices.filter(s => s.phase === 'finalize');
  const yields = slices.filter(s => s.yieldedAfter).length;

  const sortedWall = slices.map(s => s.wallMs).sort((a, b) => a - b);
  const sortedCpu = slices.map(s => s.cpuMs).sort((a, b) => a - b);
  const p95WallMs = sortedWall[Math.min(sortedWall.length - 1, Math.floor(sortedWall.length * 0.95))];
  const maxWallMs = sortedWall.at(-1);
  const maxCpuMs = sortedCpu.at(-1);
  const worstCpuSlice = slices.reduce((a, b) => (b.cpuMs > a.cpuMs ? b : a));
  const worstWallSlice = slices.reduce((a, b) => (b.wallMs > a.wallMs ? b : a));
  const totalCpuMs = slices.reduce((sum, s) => sum + s.cpuMs, 0);

  t.diagnostic(
    `T1.1 migration slices=${slices.length} (beforeInit=${slicesBeforeInit}, scan=${scanSlices.length}, select=${selectSlices.length}, commit=${commitSlices.length}, finalize=${finalizeSlices.length}) ` +
    `yields=${yields} maxSliceCpu=${maxCpuMs.toFixed(2)}ms (${worstCpuSlice.phase}) ` +
    `p95SliceWall=${p95WallMs.toFixed(2)}ms maxSliceWall=${maxWallMs.toFixed(2)}ms (${worstWallSlice.phase}) ` +
    `totalMigrationCpu=${totalCpuMs.toFixed(1)}ms ping=${pingMs.toFixed(1)}ms init=${initMs.toFixed(1)}ms totalWall=${totalWallMs.toFixed(1)}ms`
  );

  // Structural slicing & yield invariants tied to L1 §3.1/§3.2 constants.
  const minScanSlices = Math.ceil(5_202 / MIGRATION_SCAN_BATCH_SIZE);
  const minCommitSlices = Math.ceil(5_000 / MIGRATION_COMMIT_BATCH_SIZE);
  assert.ok(scanSlices.length >= minScanSlices, `expected >= ${minScanSlices} scan slices, got ${scanSlices.length}`);
  assert.ok(scanSlices.every(s => s.items <= MIGRATION_SCAN_BATCH_SIZE), `every scan slice must process <= ${MIGRATION_SCAN_BATCH_SIZE} files`);
  assert.equal(selectSlices.length, 1, `expected 1 select slice, got ${selectSlices.length}`);
  assert.ok(commitSlices.length >= minCommitSlices, `expected >= ${minCommitSlices} commit slices, got ${commitSlices.length}`);
  assert.ok(commitSlices.every(s => s.items <= MIGRATION_COMMIT_BATCH_SIZE), `every commit slice must process <= ${MIGRATION_COMMIT_BATCH_SIZE} files`);
  assert.equal(finalizeSlices.length, 1, `expected 1 finalize slice, got ${finalizeSlices.length}`);
  assert.equal(yields, slices.length - 1, 'every migration slice except finalize must yield to the event loop');

  // Slice synchronous budget tied to L1 §3.1/§7 guarantee (migration must not hold the event loop >= 50 ms):
  // Rule since 22/11: no wall-clock assertion against the runner. All wall
  // timings (p95WallMs, maxWallMs, pingMs, initMs, totalWallMs) stay in
  // t.diagnostic only; the proof is our own CPU per slice
  // (process.threadCpuUsage delta, immune to OS preemption on loaded CI
  // runners) plus the causal yield/batch and interleaving invariants above.
  // - maxCpuMs < 50 ms isolates main-thread CPU work per slice.
  // - totalCpuMs < 5000 ms bounds aggregate migration CPU without wall-clock sensitivity.
  assert.ok(
    maxCpuMs < 50,
    `migration slice CPU=${maxCpuMs.toFixed(2)} ms (${worstCpuSlice.phase}, items=${worstCpuSlice.items}) exceeded 50 ms slice budget (MIGRATION_MAX_SLICE_MS=${MIGRATION_MAX_SLICE_MS})`
  );
  assert.ok(
    totalCpuMs < 5_000,
    `total migration CPU=${totalCpuMs.toFixed(1)} ms exceeded 5000 ms budget`
  );

  const rootFiles = fs.readdirSync(stateDir);
  const rootOps = rootFiles.filter(f => f.startsWith('operation-'));
  const rootGenEnds = rootFiles.filter(f => f.startsWith('generation-end-'));
  assert.ok(rootOps.length <= 66, `expected <= 66 root operations, got ${rootOps.length}`);
  assert.ok(rootGenEnds.length <= 64, `expected <= 64 root generation-ends, got ${rootGenEnds.length}`);

  // Verify snapshot() with > 256 effects: 100% launch-delegation preserved, call/callback FIFO-bounded to 256, < 4 MiB.
  const snapDir = join(dir, 'snap-state');
  const snapRoot = join(dir, 'snap-root');
  fs.mkdirSync(snapDir, { recursive: true, mode: 0o700 });
  fs.mkdirSync(snapRoot, { recursive: true, mode: 0o700 });
  const snapMarker = {
    ...marker,
    generation: randomUUID(),
    root: snapRoot,
    stateDirectory: snapDir
  };
  const participants = new Participants({
    root: snapRoot,
    directory: snapDir,
    marker: snapMarker
  });
  const part = participants.attach('att-snap', { workspace: dir });
  part.bind({
    notifications: {
      checkpointState: () => ({
        snapshots: [],
        notifications: [],
        truncation: {},
        producedSequence: 0,
        deliveredSequence: 0
      })
    },
    sessions: { list: () => [] },
    listTools: () => [],
    callTool: () => ({ content: [{ type: 'text', text: JSON.stringify({ state: 'identity_disabled' }) }] })
  });

  // Create 10 launch-delegation effects and 290 call effects (300 total > 256).
  const expectedDelegations = [];
  for (let i = 0; i < 10; i++) {
    const op = part.begin('child');
    const delResult = { type: 'launch-delegation', launchId: `del-${i}`, delegation: { target: 't' }, terminalResult: { state: 'started' } };
    participants.ledger.publishEffect(op, delResult);
    part.finish(op, { completed: true, kind: 'child', i });
    expectedDelegations.push(`del-${i}`);
  }
  for (let i = 0; i < 290; i++) {
    const op = part.begin('call');
    part.finish(op, { completed: true, seq: i });
  }
  participants.ledger.compactBatch();
  const snap = part.snapshot();
  const effects = snap.notifications.ownerEffects;
  const delegations = effects.filter(e => e.result?.type === 'launch-delegation');
  const nonDelegations = effects.filter(e => e.result?.type !== 'launch-delegation');
  assert.equal(delegations.length, 10, '100% of launch-delegation effects must be preserved');
  assert.deepEqual(delegations.map(e => e.result.launchId).sort(), expectedDelegations.sort());
  assert.equal(nonDelegations.length, 256, 'non-delegation call/callback effects must be FIFO-bounded to 256');
  assert.ok(Buffer.byteLength(JSON.stringify(snap)) <= 4 * 1024 * 1024, 'snapshot must remain under 4 MiB');
});

test('T1.2: O(1) cost at 15,500 operations and 300 launches with 0 readdirSync and 0 operation openSync', { timeout: 90_000 }, async t => {
  const dir = fs.mkdtempSync(join(tmpdir(), 'mcp-l1-t12-'));
  const root = join(dir, 'store');
  const runtimeBase = join(dir, 'run');
  const stateDir = join(runtimeBase, 'h2a-mcp-central');
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  fs.mkdirSync(runtimeBase, { recursive: true, mode: 0o700 });

  t.mock.method(fs, 'fsyncSync', () => {});
  syncBuiltinESMExports();
  let central;
  t.after(async () => {
    try { await central?.stop(); } finally {
      t.mock.restoreAll();
      syncBuiltinESMExports();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  seedHistoricalState(stateDir, {
    root,
    operations: 15_500,
    launches: 300
  });

  let sweepFn;
  const clock = {
    now: () => 0,
    setInterval(fn) { sweepFn = fn; },
    clearInterval() { sweepFn = undefined; }
  };
  central = await startCentralMcpServer({
    root,
    runtimeBase,
    physicalPrefix: dir,
    env: {},
    clock,
    idleTimeoutMs: 60_000
  });
  assert.equal(central.kind, 'started');
  const marker = readState(central.markerPath, 'marker').value;

  await waitForStatus(central.markerPath, marker, central.endpoint, s => s.ledgerMigrationComplete === true, 60_000);

  // Open 5 sessions before instrumenting so DELETE tests measure only DELETE work.
  const openSessions = [];
  for (let i = 0; i < 5; i++) {
    const attachment = captureCentralAttachment(root, dir, { host: 'claude' }, {
      CLAUDE_CODE_SESSION_ID: `t12-del-${i}`
    });
    const init = await authenticatedHttpRequest(central.markerPath, marker, central.endpoint, {
      method: 'POST',
      attachmentId: attachment.id,
      transportEpoch: 1,
      headers: {
        'content-type': 'application/json',
        'x-h2a-attachment': Buffer.from(JSON.stringify(attachment)).toString('base64url')
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't12', version: '1' } }
      })
    });
    assert.equal(init.status, 200);
    openSessions.push({ attachment, sessionId: init.headers.get('mcp-session-id') });
  }

  // Also instantiate a Participants handle on the already-compacted stateDir to test inventory(), drain(), and LaunchJournal.operation() directly.
  const participants = new Participants({
    root,
    directory: stateDir,
    marker
  });
  assert.equal(participants.ledger.ledgerMigrationComplete, true);
  // Find an archived operation id (hist-op-0 is guaranteed archived among 15,500).
  const archivedOpId = 'hist-op-0';
  const probeLaunch = new LaunchJournal({
    registry: participants.registry,
    token: { attachmentId: 'hist-att-0' },
    ledger: participants.ledger,
    root
  });

  const realOpenSync = fs.openSync;
  const realReaddirSync = fs.readdirSync;
  let stateReaddirs = 0;
  let opOpens = 0;
  let archivedOpOpens = 0;

  t.mock.method(fs, 'readdirSync', (p, ...args) => {
    if (typeof p === 'string' && p.startsWith(stateDir)) stateReaddirs++;
    return realReaddirSync(p, ...args);
  });
  t.mock.method(fs, 'openSync', (p, ...args) => {
    if (typeof p === 'string' && p.startsWith(stateDir) && /\/operation-[a-f0-9]+\.json$/.test(p)) {
      if (p.includes('/archive/')) archivedOpOpens++;
      else opOpens++;
    }
    return realOpenSync(p, ...args);
  });
  syncBuiltinESMExports();

  // 10 sweeps + 5 DELETEs on the live central (0 readdirSync, 0 operation openSync)
  for (let i = 0; i < 10; i++) sweepFn();
  for (const { attachment, sessionId } of openSessions) {
    const del = await authenticatedHttpRequest(central.markerPath, marker, central.endpoint, {
      method: 'DELETE',
      attachmentId: attachment.id,
      transportEpoch: 1,
      headers: { 'mcp-session-id': sessionId }
    });
    assert.equal(del.status, 200);
  }
  assert.equal(stateReaddirs, 0, `expected 0 readdirSync during 10 sweeps + 5 DELETEs, got ${stateReaddirs}`);
  assert.equal(opOpens, 0, `expected 0 root operation openSync during sweeps + DELETEs, got ${opOpens}`);

  // Instantiate a synced Participants handle after the DELETEs to verify 5 inventory() + 5 drain() = 0 readdirSync & 0 op opens.
  t.mock.restoreAll();
  syncBuiltinESMExports();
  t.mock.method(fs, 'fsyncSync', () => {});
  const syncedParticipants = new Participants({ root, directory: stateDir, marker });
  assert.equal(syncedParticipants.ledger.ledgerMigrationComplete, true);
  stateReaddirs = 0;
  opOpens = 0;
  archivedOpOpens = 0;
  t.mock.method(fs, 'readdirSync', (p, ...args) => {
    if (typeof p === 'string' && p.startsWith(stateDir)) stateReaddirs++;
    return realReaddirSync(p, ...args);
  });
  t.mock.method(fs, 'openSync', (p, ...args) => {
    if (typeof p === 'string' && p.startsWith(stateDir) && /\/operation-[a-f0-9]+\.json$/.test(p)) {
      if (p.includes('/archive/')) archivedOpOpens++;
      else opOpens++;
    }
    return realOpenSync(p, ...args);
  });
  syncBuiltinESMExports();

  for (let i = 0; i < 5; i++) {
    syncedParticipants.inventory();
    syncedParticipants.drain();
  }
  assert.equal(stateReaddirs, 0, `expected 0 readdirSync during 5 inventory() + 5 drain(), got ${stateReaddirs}`);
  assert.equal(opOpens, 0, `expected 0 root operation openSync during inventory()/drain(), got ${opOpens}`);
  assert.equal(archivedOpOpens, 0, `expected 0 archive operation openSync before lookup, got ${archivedOpOpens}`);

  // LaunchJournal.operation() on an archived operation must do 0 readdirSync and exactly 1 direct archive read.
  const probeLaunch2 = new LaunchJournal({
    registry: syncedParticipants.registry,
    token: { attachmentId: 'hist-att-0' },
    ledger: syncedParticipants.ledger,
    root
  });
  const resolved = syncedParticipants.ledger.getOperation(archivedOpId);
  assert.ok(resolved, 'getOperation must resolve archived operation');
  assert.equal(resolved.operationId, archivedOpId);
  assert.equal(stateReaddirs, 0, 'archived lookup must perform 0 readdirSync');
  assert.equal(archivedOpOpens, 1, 'archived lookup must open exactly 1 archive file');

  // Second lookup hits LRU cache -> still 1 total open.
  const resolved2 = syncedParticipants.ledger.getOperation(archivedOpId);
  assert.equal(resolved2?.operationId, archivedOpId);
  assert.equal(archivedOpOpens, 1, 'second archived lookup must hit archivedOperationCache');

  // Also test LaunchJournal.operation() explicitly with a real archived launch child operation.
  const launchId = randomUUID();
  const childOpId = `${launchId}:child`;
  writeCanonicalFile(join(stateDir, `operation-${digest(childOpId).slice(7)}.json`), {
    schemaVersion: 1,
    revision: 2,
    operationId: childOpId,
    attachmentId: 'hist-att-0',
    ownerGeneration: randomUUID(),
    executionOwner: makeFakeIdentity(),
    kind: 'child',
    state: 'completed',
    result: { state: 'started' }
  });
  syncedParticipants.registry.withLock(() => syncedParticipants.registry.bump());
  syncedParticipants.ledger.compactBatch();
  stateReaddirs = 0;
  archivedOpOpens = 0;
  const viaLaunch = probeLaunch2.operation({ launchId }, 'child');
  assert.equal(viaLaunch?.operationId, childOpId);
  assert.equal(stateReaddirs, 0);
  assert.equal(archivedOpOpens, 1);
  void participants;
  void probeLaunch;
});

test('T1.3: central compact --dry-run / --restore, CLI contract, managed/unmanaged, crash recovery & conflict refusal', { timeout: 60_000 }, async t => {
  const dir = makeDir(t, 'mcp-l1-t13-');
  const root = join(dir, 'store');
  const runtimeBase = join(dir, 'run');
  const stateDir = join(runtimeBase, 'h2a-mcp-central');
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  fs.mkdirSync(runtimeBase, { recursive: true, mode: 0o700 });

  const runCompact = (args, extraEnv = {}) => spawnSync(process.execPath, [BIN_PATH, 'central', 'compact', ...args], {
    encoding: 'utf8',
    env: { ...process.env, HOME: dir, XDG_RUNTIME_DIR: runtimeBase, H2A_ROOT: root, ...extraEnv }
  });

  // 1. Strict CLI validation: unknown flag or extra positional -> exit 1
  assert.equal(runCompact(['--unknown-flag']).status, 1);
  assert.equal(runCompact(['extra-positional']).status, 1);

  // 2. Absent stateDirectory -> dry-run and default exit 0 with zero counts without creating stateDirectory
  const absentDry = runCompact(['--root', root, '--runtime-base', runtimeBase, '--dry-run']);
  assert.equal(absentDry.status, 0, absentDry.stderr);
  assert.equal(JSON.parse(absentDry.stdout).totalArchived, 0);
  assert.equal(fs.existsSync(stateDir), false, 'compact must not create absent stateDirectory');

  // 3. Populate stateDirectory with 150 completed operations + 100 generation-ends
  const key = Buffer.alloc(32, 9);
  seedHistoricalState(stateDir, {
    root,
    operations: 150,
    effects: 150,
    generationEnds: 100,
    key
  });
  establishWriterControl(root, stateDir);

  // 4. Dry-run reports eligible counts without moving anything
  const dryRes = runCompact(['--root', root, '--runtime-base', runtimeBase, '--dry-run']);
  assert.equal(dryRes.status, 0, dryRes.stderr);
  const dryJson = JSON.parse(dryRes.stdout);
  assert.equal(dryJson.dryRun, true);
  assert.ok(dryJson.archived.operations > 0);
  assert.equal(fs.existsSync(join(stateDir, 'archive')), false, '--dry-run must not write archive/');

  // 5. Foreign authority refusal -> exit 2
  const foreignRoot = join(dir, 'other-store');
  fs.mkdirSync(foreignRoot, { recursive: true, mode: 0o700 });
  const id = currentIdentity();
  publishState(join(stateDir, 'authority-domain.json'), {
    schemaVersion: 1,
    namespaceId: 'ns-t13',
    prefixId: `sha256:${'1'.repeat(64)}`,
    uid: process.getuid(),
    canonicalMarkerLocation: join(stateDir, 'marker.json'),
    canonicalRoot: root,
    processFrame: { machineId: id.machineId, bootId: id.bootId, pidNamespace: id.pidNamespace, nsNet: id.nsNet },
    lockSecretReference: 'lock-key.json',
    revision: 1
  }, 'authorityDomain');
  const foreignRes = runCompact(['--root', foreignRoot, '--runtime-base', runtimeBase]);
  assert.equal(foreignRes.status, 2, `expected exit 2 on foreign_installation_authority, got ${foreignRes.status}: ${foreignRes.stderr}`);

  // 6. Live central resynchronization after external compact AND --restore refusal when alive
  const liveDir = fs.mkdtempSync(join(tmpdir(), 'mcp-l1-t13-live-'));
  const liveRoot = join(liveDir, 'store');
  const liveRun = join(liveDir, 'run');
  fs.mkdirSync(liveRoot, { recursive: true, mode: 0o700 });
  fs.mkdirSync(liveRun, { recursive: true, mode: 0o700 });
  let centralStopped = false;
  const central = await startCentralMcpServer({
    root: liveRoot,
    runtimeBase: liveRun,
    physicalPrefix: liveDir,
    env: {},
    idleTimeoutMs: 60_000
  });
  t.after(async () => {
    try { if (!centralStopped) await central.stop(); }
    finally { fs.rmSync(liveDir, { recursive: true, force: true }); }
  });
  assert.equal(central.kind, 'started');
  const liveMarker = readState(central.markerPath, 'marker').value;
  // Seed 80 completed ops in live central state dir, then compact externally
  seedHistoricalState(liveMarker.stateDirectory, { root: liveRoot, operations: 80 });
  const extCompact = runCompact(['--root', liveRoot, '--runtime-base', liveRun]);
  assert.equal(extCompact.status, 0, extCompact.stderr);
  assert.ok(JSON.parse(extCompact.stdout).totalArchived >= 80);

  // --restore MUST refuse with exit 2 while central is alive
  const restoreAlive = runCompact(['--root', liveRoot, '--runtime-base', liveRun, '--restore']);
  assert.equal(restoreAlive.status, 2, `expected exit 2 when central alive, got ${restoreAlive.status}: ${restoreAlive.stderr}`);
  assert.match(restoreAlive.stderr, /central_running_or_liveness_unknown/);

  await central.stop();
  centralStopped = true;

  // --restore MUST ALSO refuse with exit 2 when liveness is 'unknown' (e.g., foreign machineId in component-control.json)
  const ctrlPath = join(liveMarker.stateDirectory, 'component-control.json');
  const ctrl = readState(ctrlPath, 'componentControl');
  fs.unlinkSync(ctrlPath);
  publishState(ctrlPath, {
    ...ctrl.value,
    ownerState: 'ACTIVE',
    ownerIdentity: { ...ctrl.value.ownerIdentity, machineId: 'f'.repeat(32) }
  }, 'componentControl');
  const restoreUnknown = runCompact(['--root', liveRoot, '--runtime-base', liveRun, '--restore']);
  assert.equal(restoreUnknown.status, 2, `expected exit 2 when liveness unknown, got ${restoreUnknown.status}: ${restoreUnknown.stderr}`);
  assert.match(restoreUnknown.stderr, /central_running_or_liveness_unknown/);

  // Restore component-control to CLOSED so restore can proceed
  fs.unlinkSync(ctrlPath);
  publishState(ctrlPath, { ...ctrl.value, ownerState: 'CLOSED' }, 'componentControl');

  // Verify --restore runs in sub-lots <= 32 files (80 archived files => >= 3 revision bumps)
  const revBefore = readState(join(liveMarker.stateDirectory, 'participant-revision.json'), 'participantRevision').value.revision;
  const restoreOk = runCompact(['--root', liveRoot, '--runtime-base', liveRun, '--restore']);
  assert.equal(restoreOk.status, 0, restoreOk.stderr);
  const restoreJson = JSON.parse(restoreOk.stdout);
  assert.ok(restoreJson.restored >= 80);
  assert.equal(restoreJson.conflictCount, 0);
  assert.deepEqual(restoreJson.conflicts, []);
  const revAfter = readState(join(liveMarker.stateDirectory, 'participant-revision.json'), 'participantRevision').value.revision;
  assert.ok(revAfter - revBefore >= Math.ceil(restoreJson.restored / 32), `expected batched bumps >= ${Math.ceil(restoreJson.restored / 32)}, got ${revAfter - revBefore}`);

  // 7. Simulated brutal crash: generation-end moved to archive/batch-* WITHOUT a manifest.jsonl entry
  const crashDir = makeDir(t, 'mcp-l1-t13-crash-');
  const crashRoot = join(crashDir, 'store');
  const crashState = join(crashDir, 'state');
  fs.mkdirSync(crashRoot, { recursive: true, mode: 0o700 });
  fs.mkdirSync(crashState, { recursive: true, mode: 0o700 });
  const deadId = makeFakeIdentity();
  const crashedGen = randomUUID();
  const crashedMarker = {
    schemaVersion: 2, service: 'h2a-mcp-central', namespaceId: 'ns-crash', prefixId: `sha256:${'a'.repeat(64)}`,
    uid: process.getuid(), stateDirectory: crashState, endpoint: 'http://127.0.0.1:43210/mcp', endpointMode: 'discovered',
    generation: crashedGen, publicationEpoch: { bootId: deadId.bootId, counter: 1 }, predecessorGeneration: null,
    root: crashRoot, pid: 999_999, startedAt: '2026-11-21T00:00:00.000Z', processIdentity: deadId,
    packageVersion: '0.98.11', buildId: 'crash', manifestDigest: `sha256:${'b'.repeat(64)}`,
    protocol: 2, handoverProtocol: 1, handoverCapabilities: { managedImage: false, endpointPinned: false, restrictions: [], primitives: [], attachTransfer: false, liveCoordinator: false },
    mcpProtocolVersions: ['2025-06-18'], descriptorDigest: `sha256:${'c'.repeat(64)}`, contractDigest: `sha256:${'d'.repeat(64)}`,
    state: 'ready', token: randomUUID(), authKeyReference: 'authentication-key.json'
  };
  const geVal = { schemaVersion: 1, purpose: 'generation-ended', generation: crashedGen, source: crashedMarker, markerDigest: digest(crashedMarker), endedAt: Date.now() };
  const geProof = { ...geVal, mac: sign(key, 'compatibility', { service: crashedMarker.service, namespaceId: crashedMarker.namespaceId, generation: crashedGen }, geVal) };
  const batchDir = join(crashState, 'archive', 'batch-20261121');
  fs.mkdirSync(batchDir, { recursive: true, mode: 0o700 });
  writeCanonicalFile(join(batchDir, `generation-end-${crashedGen}.json`), geProof);
  // Note: NO manifest.jsonl exists!
  const crashReg = new OwnershipRegistry({ directory: crashState, generation: randomUUID(), processIdentity: currentIdentity() });
  const crashLedger = new OperationLedger(crashReg);
  assert.equal(
    endedOwner({ ownerGeneration: crashedGen, ownerProcessIdentity: deadId }, { ...crashedMarker, generation: randomUUID() }, key, crashLedger),
    true,
    'endedOwner must resolve generation-end moved to archive/batch-* before manifest write'
  );

  // 8. --restore conflict detection: digest divergence -> skip without overwriting root, exit 2, report conflicts
  const conflictComp = runCompact(['--root', liveRoot, '--runtime-base', liveRun]);
  assert.equal(conflictComp.status, 0, conflictComp.stderr);
  const archiveBatches = fs.readdirSync(join(liveMarker.stateDirectory, 'archive')).filter(d => d.startsWith('batch-'));
  assert.ok(archiveBatches.length > 0);
  const sampleBatch = join(liveMarker.stateDirectory, 'archive', archiveBatches[0]);
  const sampleOpFile = fs.readdirSync(sampleBatch).find(f => f.startsWith('operation-'));
  assert.ok(sampleOpFile);
  const archivedContent = JSON.parse(fs.readFileSync(join(sampleBatch, sampleOpFile), 'utf8'));
  const divergingRoot = { ...archivedContent, revision: archivedContent.revision + 1, result: { diverged: true } };
  writeCanonicalFile(join(liveMarker.stateDirectory, sampleOpFile), divergingRoot);
  const rootBeforeBytes = fs.readFileSync(join(liveMarker.stateDirectory, sampleOpFile), 'utf8');

  const restoreConflict = runCompact(['--root', liveRoot, '--runtime-base', liveRun, '--restore']);
  assert.equal(restoreConflict.status, 2, `expected exit 2 on conflict, got ${restoreConflict.status}`);
  const conflictJson = JSON.parse(restoreConflict.stdout);
  assert.equal(conflictJson.conflictCount, 1);
  assert.deepEqual(conflictJson.conflicts, [sampleOpFile]);
  assert.equal(fs.readFileSync(join(liveMarker.stateDirectory, sampleOpFile), 'utf8'), rootBeforeBytes, 'conflict must NEVER overwrite root file');

  // 9. Managed namespace.json compaction case: verify centralCompact resolves namespace.stateDirectory
  const mgDir = makeDir(t, 'mcp-l1-t13-managed-');
  const mgRoot = join(mgDir, 'store');
  const mgRun = join(mgDir, 'run');
  const mgManaged = join(mgDir, 'h2a-managed', String(process.getuid()));
  const mgImages = join(mgManaged, 'images', 'a'.repeat(64));
  const mgState = join(mgManaged, 'state', 'mcp', 'ns-managed-t13');
  const mgNsDir = join(mgManaged, 'state', 'namespaces');
  for (const p of [mgRoot, mgRun, mgImages, mgState, mgNsDir]) fs.mkdirSync(p, { recursive: true, mode: 0o700 });
  const mgPrefixId = digest({ canonicalPrefix: fs.realpathSync(mgDir), uid: process.getuid() });
  publishState(join(mgManaged, 'installation.json'), {
    schemaVersion: 1,
    prefixId: mgPrefixId,
    canonicalPrefix: fs.realpathSync(mgDir),
    uid: process.getuid(),
    managedRoot: fs.realpathSync(mgManaged)
  }, 'installation');
  const mgMarkerLoc = join(fs.realpathSync(mgRun), 'h2a-mcp-central', 'marker.json');
  publishState(join(mgNsDir, 'namespace.json'), {
    schemaVersion: 1,
    namespaceId: 'ns-managed-t13',
    prefixId: mgPrefixId,
    uid: process.getuid(),
    canonicalRoot: fs.realpathSync(mgRoot),
    canonicalMarkerLocation: mgMarkerLoc,
    stateDirectory: fs.realpathSync(mgState),
    machineIdentity: currentIdentity().machineId,
    authorityDomainReference: 'authority-domain.json'
  }, 'namespace');
  seedHistoricalState(mgState, { root: fs.realpathSync(mgRoot), operations: 90 });
  const realDist = fileURLToPath(new URL('../dist', import.meta.url));
  const realPkgJson = fileURLToPath(new URL('../package.json', import.meta.url));
  fs.cpSync(realDist, join(mgImages, 'dist'), { recursive: true });
  fs.copyFileSync(realPkgJson, join(mgImages, 'package.json'));
  const { centralCompact: managedCompact } = await import(join(mgImages, 'dist', 'runtime', 'mcp-central-operator.js'));
  const mgJson = managedCompact({
    root: mgRoot,
    runtimeBase: mgRun,
    env: { ...process.env, HOME: mgDir, XDG_RUNTIME_DIR: mgRun, H2A_ROOT: mgRoot }
  });
  assert.equal(mgJson.stateDirectory, fs.realpathSync(mgState), 'managed compact must resolve namespace.stateDirectory');
  assert.ok(mgJson.totalArchived >= 90);
});

test('T1.6: external peer replaceState on same filename is detected via participant-revision.json', { timeout: 30_000 }, async t => {
  const dir = makeDir(t, 'mcp-l1-t16-');
  const root = join(dir, 'store');
  const stateDir = join(dir, 'state');
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  establishWriterControl(root, stateDir);

  const id = currentIdentity();
  const gen = randomUUID();
  const lockDir = writerDirectory(root);
  const regA = new OwnershipRegistry({ directory: stateDir, generation: gen, processIdentity: id, lockDirectory: lockDir });
  const ledgerA = new OperationLedger(regA);
  const token = regA.claim({ attachmentId: 'att-t16', presenceSessionId: 'pending:att-t16', expectedInstance: 'identity_disabled' });
  const op = ledgerA.begin(token, 'op-t16-same-name', 'call');
  assert.equal(ledgerA.hasPendingForAttachment('att-t16'), true);
  assert.equal(ledgerA.drain().complete, false);

  // External peer process finishes the existing operation via replaceState (same filename, no new directory entry).
  const peerCode = `
    import { OwnershipRegistry, OperationLedger } from ${JSON.stringify(OWNERSHIP_DIST)};
    const reg = new OwnershipRegistry({ directory: process.env.STATE_DIR, generation: process.env.GEN, processIdentity: JSON.parse(process.env.ID), lockDirectory: process.env.LOCK_DIR });
    const ledger = new OperationLedger(reg);
    ledger.finish(JSON.parse(process.env.OP), { completed: true });
  `;
  const peer = spawnSync(process.execPath, ['--input-type=module', '-e', peerCode], {
    encoding: 'utf8',
    env: { ...process.env, STATE_DIR: stateDir, GEN: gen, ID: JSON.stringify(id), LOCK_DIR: lockDir, OP: JSON.stringify(op) }
  });
  assert.equal(peer.status, 0, peer.stderr);

  // regA/ledgerA must detect the external replaceState on the next query without any new file having been created.
  assert.equal(ledgerA.hasPendingForAttachment('att-t16'), false, 'external finish() via replaceState must clear pending status');
  assert.equal(ledgerA.drain().complete, true, 'external finish() via replaceState must complete drain()');
});

test('T1.7: concurrent begin()/finish() on central and external peer during background migration on 3,000 files', { timeout: 60_000 }, async t => {
  const dir = makeDir(t, 'mcp-l1-t17-');
  const root = join(dir, 'store');
  const stateDir = join(dir, 'state');
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  establishWriterControl(root, stateDir);

  seedHistoricalState(stateDir, { root, operations: 1_500, effects: 1_500 });

  t.mock.method(fs, 'fsyncSync', () => {});
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });

  const id = currentIdentity();
  const gen = randomUUID();
  const lockDir = writerDirectory(root);
  const reg = new OwnershipRegistry({ directory: stateDir, generation: gen, processIdentity: id, lockDirectory: lockDir });
  const ledger = new OperationLedger(reg);
  assert.equal(ledger.ledgerMigrationComplete, false, '3,000 files must trigger async background migration');
  assert.equal(ledger.drain().complete, false, 'PR-02: drain().complete must be false while ledgerMigrationComplete === false');

  // Also verify Participants.freeze() refuses with ledger_migration_incomplete while migration is incomplete (PR-02).
  const fakeFreezeMarker = {
    schemaVersion: 2, service: 'h2a-mcp-central', namespaceId: 'ns-t17', prefixId: `sha256:${'a'.repeat(64)}`,
    uid: process.getuid(), stateDirectory: stateDir, endpoint: 'http://127.0.0.1:43210/mcp', endpointMode: 'discovered',
    generation: gen, publicationEpoch: { bootId: id.bootId, counter: 1 }, predecessorGeneration: null,
    root, pid: process.pid, startedAt: new Date().toISOString(), processIdentity: id,
    packageVersion: '0.98.11', buildId: 't17', manifestDigest: `sha256:${'b'.repeat(64)}`,
    protocol: 2, handoverProtocol: 1, handoverCapabilities: { managedImage: false, endpointPinned: false, restrictions: [], primitives: [], attachTransfer: false, liveCoordinator: false },
    mcpProtocolVersions: ['2025-06-18'], descriptorDigest: `sha256:${'c'.repeat(64)}`, contractDigest: `sha256:${'d'.repeat(64)}`,
    state: 'ready', token: randomUUID(), authKeyReference: 'authentication-key.json'
  };
  const freezeParticipants = new Participants({ root, directory: stateDir, marker: fakeFreezeMarker });
  t.after(() => freezeParticipants.ledger.stopMigration());
  assert.equal(freezeParticipants.ledger.ledgerMigrationComplete, false);
  assert.equal(freezeParticipants.drain().complete, false);
  assert.throws(() => freezeParticipants.freeze('handover-pr02'), /ledger_migration_incomplete/);
  freezeParticipants.ledger.stopMigration();

  const tokenCentral = reg.claim({ attachmentId: 'att-central', presenceSessionId: 'pending:att-central', expectedInstance: 'identity_disabled' });
  const tokenPeer = reg.claim({ attachmentId: 'att-peer', presenceSessionId: 'pending:att-peer', expectedInstance: 'identity_disabled' });

  // Spawn an external peer running 25 begin+finish cycles concurrently with migration.
  const peerScript = `
    import { OwnershipRegistry, OperationLedger } from ${JSON.stringify(OWNERSHIP_DIST)};
    const reg = new OwnershipRegistry({ directory: process.env.STATE_DIR, generation: process.env.GEN, processIdentity: JSON.parse(process.env.ID), lockDirectory: process.env.LOCK_DIR });
    const ledger = new OperationLedger(reg, { skipAutoMigration: true });
    const token = JSON.parse(process.env.TOKEN);
    for (let i = 0; i < 25; i++) {
      const op = ledger.begin(token, 'peer-op-' + i, 'call');
      ledger.finish(op, { completed: true, peer: i });
    }
  `;
  const peerProc = spawn(process.execPath, ['--input-type=module', '-e', peerScript], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, STATE_DIR: stateDir, GEN: gen, ID: JSON.stringify(id), LOCK_DIR: lockDir, TOKEN: JSON.stringify(tokenPeer) }
  });
  const peerExitPromise = new Promise(resolve => peerProc.once('exit', resolve));
  let peerStderr = '';
  peerProc.stderr.on('data', d => { peerStderr += d; });

  // Run 25 begin+finish cycles in-process interleaved across turns during migration.
  const centralOpIds = [];
  for (let i = 0; i < 25; i++) {
    const opId = `central-op-${i}`;
    const op = ledger.begin(tokenCentral, opId, 'call');
    await new Promise(r => setImmediate(r));
    ledger.finish(op, { completed: true, central: i });
    centralOpIds.push(opId);
  }

  const peerExit = await peerExitPromise;
  assert.equal(peerExit, 0, `peer failed: ${peerStderr}`);

  // Wait for background migration to finish.
  const deadline = Date.now() + 30_000;
  while (!ledger.ledgerMigrationComplete && Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 20));
  }
  assert.equal(ledger.ledgerMigrationComplete, true);
  assert.equal(ledger.drain().complete, true);

  // Verify every single one of the 50 transitions exists and is completed, and ZERO duplicates between root and archive/.
  for (let i = 0; i < 25; i++) {
    const c = ledger.getOperation(`central-op-${i}`);
    assert.equal(c?.state, 'completed', `missing central-op-${i}`);
    const p = ledger.getOperation(`peer-op-${i}`);
    assert.equal(p?.state, 'completed', `missing peer-op-${i}`);
  }
  const rootSet = new Set(fs.readdirSync(stateDir).filter(f => f.endsWith('.json')));
  const archiveDir = join(stateDir, 'archive');
  const duplicates = [];
  if (fs.existsSync(archiveDir)) {
    for (const batch of fs.readdirSync(archiveDir).filter(d => d.startsWith('batch-'))) {
      for (const f of fs.readdirSync(join(archiveDir, batch))) {
        if (rootSet.has(f)) duplicates.push(f);
      }
    }
  }
  assert.deepEqual(duplicates, [], `found duplicate files in both root and archive: ${duplicates.join(', ')}`);
});

test('T1.8: completed delegated launch with archived child/brief operations survives internal and external compaction across repeated drains (N-01)', { timeout: 60_000 }, async t => {
  const dir = makeDir(t, 'mcp-l1-t18-');
  const root = join(dir, 'store');
  const runtimeBase = join(dir, 'run');
  const stateDir = join(runtimeBase, 'h2a-mcp-central');
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });

  const id = currentIdentity();
  const gen = randomUUID();
  const fakeMarker = {
    schemaVersion: 2, service: 'h2a-mcp-central', namespaceId: 'ns-t18', prefixId: `sha256:${'a'.repeat(64)}`,
    uid: process.getuid(), stateDirectory: stateDir, endpoint: 'http://127.0.0.1:43210/mcp', endpointMode: 'discovered',
    generation: gen, publicationEpoch: { bootId: id.bootId, counter: 1 }, predecessorGeneration: null,
    root, pid: process.pid, startedAt: new Date().toISOString(), processIdentity: id,
    packageVersion: '0.98.11', buildId: 't18', manifestDigest: `sha256:${'b'.repeat(64)}`,
    protocol: 2, handoverProtocol: 1, handoverCapabilities: { managedImage: false, endpointPinned: false, restrictions: [], primitives: [], attachTransfer: false, liveCoordinator: false },
    mcpProtocolVersions: ['2025-06-18'], descriptorDigest: `sha256:${'c'.repeat(64)}`, contractDigest: `sha256:${'d'.repeat(64)}`,
    state: 'ready', token: randomUUID(), authKeyReference: 'authentication-key.json'
  };

  const participants = new Participants({ root, directory: stateDir, marker: fakeMarker });
  const attachment = participants.attach('att-t18', { workspace: dir });

  // Helper: execute a delegated launch until completed, then complete 70 ordinary operations.
  async function runDelegatedLaunchAndFill(name) {
    const req = {
      name,
      workspace: dir,
      delegation: { parent: 'lead', task: name }
    };
    const res = await attachment.executeLaunch(req, () => ({
      state: 'started',
      ok: true,
      prompt: { delivered: true }
    }));
    assert.equal(res.state, 'started');
    const memo = attachment.launches.memos().find(m => m.launchName === name);
    assert.equal(memo?.state, 'completed');
    for (let i = 0; i < 70; i++) {
      const op = attachment.begin('call');
      attachment.finish(op, { completed: true, batch: name, i });
    }
    return memo.launchId;
  }

  // (a) Internal compaction via compactBatch()
  const launchId1 = await runDelegatedLaunchAndFill('deleg-internal');
  const resInternal = participants.ledger.compactBatch();
  assert.ok(resInternal.archived.operations >= 2, 'completed child/brief ops should be archived');
  // Confirm child/brief operations actually left root while launch memo stayed at root
  assert.equal(fs.existsSync(join(stateDir, `operation-${digest(`${launchId1}:child`).slice(7)}.json`)), false);
  assert.equal(fs.existsSync(join(stateDir, `launch-location-${launchId1}.json`)), true);

  for (let i = 0; i < 5; i++) {
    const d = participants.drain();
    assert.equal(d.complete, true, `drain #${i + 1} after internal compaction must succeed and be complete`);
  }

  // (b) External compaction via `h2a central compact` in a separate process
  const launchId2 = await runDelegatedLaunchAndFill('deleg-external');
  const ext = spawnSync(process.execPath, [BIN_PATH, 'central', 'compact', '--root', root, '--runtime-base', runtimeBase], {
    encoding: 'utf8',
    env: { ...process.env, HOME: dir, XDG_RUNTIME_DIR: runtimeBase, H2A_ROOT: root }
  });
  assert.equal(ext.status, 0, ext.stderr);
  assert.equal(fs.existsSync(join(stateDir, `operation-${digest(`${launchId2}:child`).slice(7)}.json`)), false);
  assert.equal(fs.existsSync(join(stateDir, `launch-location-${launchId2}.json`)), true);

  for (let i = 0; i < 5; i++) {
    const d = participants.drain();
    assert.equal(d.complete, true, `drain #${i + 1} after external compaction must reload manifest tail and succeed`);
  }

  // (c) Verify exactly one 'launch-delegation' effect exists per launchId across root + archive (no duplicates)
  const allEffects = [];
  for (const f of fs.readdirSync(stateDir).filter(n => n.startsWith('effect-'))) {
    allEffects.push(JSON.parse(fs.readFileSync(join(stateDir, f), 'utf8')));
  }
  const archiveDir = join(stateDir, 'archive');
  if (fs.existsSync(archiveDir)) {
    for (const batch of fs.readdirSync(archiveDir).filter(d => d.startsWith('batch-'))) {
      for (const f of fs.readdirSync(join(archiveDir, batch)).filter(n => n.startsWith('effect-'))) {
        allEffects.push(JSON.parse(fs.readFileSync(join(archiveDir, batch, f), 'utf8')));
      }
    }
  }
  for (const lid of [launchId1, launchId2]) {
    const matches = allEffects.filter(e => e.result?.type === 'launch-delegation' && e.result?.launchId === lid);
    assert.equal(matches.length, 1, `expected exactly 1 launch-delegation effect for ${lid}, found ${matches.length}`);
  }
});

test('B-1: background migration retries transient mutation_lock_unavailable and never marks complete on error', { timeout: 30_000 }, async t => {
  t.mock.method(fs, 'fsyncSync', () => {});
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });

  // Subcase (a): transient mutation_lock_unavailable in Phase 2 retries without skipping any sub-lot
  {
    const dir = makeDir(t, 'mcp-l1-b1-retry-');
    const root = join(dir, 'store');
    const stateDir = join(dir, 'state');
    fs.mkdirSync(root, { recursive: true, mode: 0o700 });
    fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
    establishWriterControl(root, stateDir);

    seedHistoricalState(stateDir, { root, operations: 160, pendingOperations: 1 });

    const id = currentIdentity();
    const gen = randomUUID();
    const lockDir = writerDirectory(root);
    const reg = new OwnershipRegistry({ directory: stateDir, generation: gen, processIdentity: id, lockDirectory: lockDir });
    const origWithLock = reg.withLock.bind(reg);
    let lockFailuresRemaining = 2;
    let lockCallsDuringMigration = 0;
    let completeObservedAfterFailure = null;
    let ledger;
    reg.withLock = (fn) => {
      lockCallsDuringMigration++;
      if (lockFailuresRemaining > 0) {
        lockFailuresRemaining--;
        try {
          throw new Error('mutation_lock_unavailable');
        } finally {
          queueMicrotask(() => {
            if (completeObservedAfterFailure === null && ledger) {
              completeObservedAfterFailure = ledger.ledgerMigrationComplete;
            }
          });
        }
      }
      return origWithLock(fn);
    };

    ledger = new OperationLedger(reg);
    t.after(() => ledger.stopMigration());
    assert.equal(ledger.ledgerMigrationComplete, false);

    const deadline = Date.now() + 10_000;
    while (!ledger.ledgerMigrationComplete && Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 15));
    }
    assert.equal(completeObservedAfterFailure, false, 'ledgerMigrationComplete must stay false after transient mutation_lock_unavailable');
    assert.equal(ledger.ledgerMigrationComplete, true, 'migration must eventually complete after transient lock clears');
    assert.ok(lockCallsDuringMigration >= 7, `expected retries plus all sub-lots (>=7 lock calls), got ${lockCallsDuringMigration}`);
    const remainingOps = fs.readdirSync(stateDir).filter(f => f.startsWith('operation-'));
    assert.equal(remainingOps.length, 1, `no sub-lot may be skipped on retry: expected only 1 pending op at root, got ${remainingOps.length}`);
    assert.equal(ledger.hasPendingForAttachment('pending-att'), true);
  }

  // Subcase (b): Phase 1 non-transient error must leave ledgerMigrationComplete === false (PR-02 + no root readdirSync storm)
  {
    const dir = makeDir(t, 'mcp-l1-b1-phase1-');
    const root = join(dir, 'store');
    const stateDir = join(dir, 'state');
    fs.mkdirSync(root, { recursive: true, mode: 0o700 });
    fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
    establishWriterControl(root, stateDir);

    seedHistoricalState(stateDir, { root, operations: 160, pendingOperations: 1 });

    const id = currentIdentity();
    const gen = randomUUID();
    const lockDir = writerDirectory(root);
    const reg = new OwnershipRegistry({ directory: stateDir, generation: gen, processIdentity: id, lockDirectory: lockDir });

    const realLstatSync = fs.lstatSync;
    let failOnce = true;
    t.mock.method(fs, 'lstatSync', (p, ...args) => {
      if (failOnce && typeof p === 'string' && p.startsWith(stateDir) && p.includes('operation-')) {
        failOnce = false;
        throw Object.assign(new Error('EIO: disk read error'), { code: 'EIO' });
      }
      return realLstatSync(p, ...args);
    });
    syncBuiltinESMExports();

    const ledger = new OperationLedger(reg);
    t.after(() => ledger.stopMigration());
    await new Promise(r => setTimeout(r, 150));

    assert.equal(ledger.ledgerMigrationComplete, false, 'Phase 1 EIO must NEVER flip ledgerMigrationComplete to true');
    assert.equal(ledger.drain().complete, false, 'PR-02: drain().complete must stay false after failed migration');

    // syncIfExternalChange() must NOT scan the unmigrated root directory when ledgerMigrationComplete === false
    const realReaddirSync = fs.readdirSync;
    let readdirs = 0;
    t.mock.method(fs, 'readdirSync', (p, ...args) => {
      if (typeof p === 'string' && p === stateDir) readdirs++;
      return realReaddirSync(p, ...args);
    });
    syncBuiltinESMExports();
    reg.lastRevisionStamp = null;
    reg.syncIfExternalChange();
    assert.equal(readdirs, 0, 'syncIfExternalChange must not trigger full root readdirSync while migration is incomplete');
  }

  // Subcase (c): exhausted transient retry budget in Phase 2 must leave ledgerMigrationComplete === false
  {
    const dir = makeDir(t, 'mcp-l1-b1-exhausted-');
    const root = join(dir, 'store');
    const stateDir = join(dir, 'state');
    fs.mkdirSync(root, { recursive: true, mode: 0o700 });
    fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
    establishWriterControl(root, stateDir);

    seedHistoricalState(stateDir, { root, operations: 160 });

    const id = currentIdentity();
    const gen = randomUUID();
    const lockDir = writerDirectory(root);
    const reg = new OwnershipRegistry({ directory: stateDir, generation: gen, processIdentity: id, lockDirectory: lockDir });
    const origWithLock = reg.withLock.bind(reg);
    let failLocks = true;
    reg.withLock = (fn) => {
      if (failLocks) throw new Error('mutation_lock_unavailable');
      return origWithLock(fn);
    };

    const ledger = new OperationLedger(reg);
    t.after(() => ledger.stopMigration());
    const deadline = Date.now() + 5_000;
    while (ledger._migrationTimer !== null && Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 25));
    }
    await new Promise(r => setTimeout(r, 50));
    failLocks = false;

    assert.equal(ledger.ledgerMigrationComplete, false, 'exhausted retry budget must leave ledgerMigrationComplete === false');
    assert.equal(ledger.drain().complete, false, 'PR-02: drain().complete must stay false after exhausted retries');
  }
});

test('NB-1/NB-2/NB-3: lock revalidation of owner/barrier/tx state, bounded order maps, and centralCompact env propagation', { timeout: 30_000 }, async t => {
  t.mock.method(fs, 'fsyncSync', () => {});
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });

  // NB-1: _commitArchiveSubLot revalidates owner.state (FROZEN) and writerGate (BARRIER) under lock
  {
    const dir = makeDir(t, 'mcp-l1-nb1-');
    const root = join(dir, 'store');
    const stateDir = join(dir, 'state');
    fs.mkdirSync(root, { recursive: true, mode: 0o700 });
    fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
    establishWriterControl(root, stateDir);

    const id = currentIdentity();
    const gen = randomUUID();
    const lockDir = writerDirectory(root);
    const reg = new OwnershipRegistry({ directory: stateDir, generation: gen, processIdentity: id, lockDirectory: lockDir });
    const ledger = new OperationLedger(reg);
    const token = reg.claim({ attachmentId: 'att-nb1', presenceSessionId: 'pending:att-nb1', expectedInstance: 'identity_disabled' });

    // Create 70 completed ops so the oldest ones are selected for archival outside lock
    const ops = [];
    for (let i = 0; i < 70; i++) {
      const op = ledger.begin(token, `nb1-op-${i}`, 'call');
      ledger.finish(op, { completed: true, i });
      ops.push(op);
    }
    const inspected = fs.readdirSync(stateDir)
      .filter(n => n.endsWith('.json'))
      .map(n => ledger._inspectCandidateFile(n))
      .filter(Boolean);
    const selected = ledger._selectArchiveCandidates(inspected);
    assert.ok(selected.some(c => c.family === 'operations'), 'pre-freeze selection should include excess completed ops');

    // Freeze the attachment AFTER selection and BEFORE _commitArchiveSubLot acquires the lock
    reg.freeze(token, 'handover-nb1');
    const moved = ledger._commitArchiveSubLot(selected, 'test-nb1', 'batch-20261122');
    assert.equal(moved.operations.length, 0, 'FROZEN attachment completed ops must not be archived after lock revalidation');
    assert.equal(moved.effects.length, 0, 'FROZEN attachment effects must not be archived after lock revalidation');

    // Also verify writerGate === 'BARRIER' blocks active-attachment effect archival under lock
    reg.abort(token, 'handover-nb1');
    for (let i = 70; i < 270; i++) {
      const op = ledger.begin(token, `nb1-op-${i}`, 'call');
      ledger.finish(op, { completed: true, i });
    }
    const inspected2 = fs.readdirSync(stateDir)
      .filter(n => n.endsWith('.json'))
      .map(n => ledger._inspectCandidateFile(n))
      .filter(Boolean);
    const selected2 = ledger._selectArchiveCandidates(inspected2);
    assert.ok(selected2.some(c => c.family === 'effects'), 'pre-barrier selection should include excess active effects');
    updateWriterControl(root, { gate: 'BARRIER', handoverId: 'handover-nb1-barrier' });
    const movedBarrier = ledger._commitArchiveSubLot(selected2.filter(c => c.family === 'effects'), 'test-nb1-barrier', 'batch-20261122');
    assert.equal(movedBarrier.effects.length, 0, 'writerGate === BARRIER must block active attachment effect archival under lock');
  }

  // NB-2: _opOrder and _effectOrder evict archived filenames in _evictLedgerRootFile
  {
    const dir = makeDir(t, 'mcp-l1-nb2-');
    const root = join(dir, 'store');
    const stateDir = join(dir, 'state');
    fs.mkdirSync(root, { recursive: true, mode: 0o700 });
    fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
    establishWriterControl(root, stateDir);

    const id = currentIdentity();
    const gen = randomUUID();
    const lockDir = writerDirectory(root);
    const reg = new OwnershipRegistry({ directory: stateDir, generation: gen, processIdentity: id, lockDirectory: lockDir });
    const ledger = new OperationLedger(reg);
    const token = reg.claim({ attachmentId: 'att-nb2', presenceSessionId: 'pending:att-nb2', expectedInstance: 'identity_disabled' });
    for (let i = 0; i < 80; i++) {
      const op = ledger.begin(token, `nb2-op-${i}`, 'call');
      ledger.finish(op, { completed: true, i });
    }
    assert.equal(ledger._opOrder.size, 80);
    const res = ledger.compactBatch();
    assert.ok(res.archived.operations >= 16);
    assert.ok(ledger._opOrder.size <= 64, `_opOrder must evict archived files; got size=${ledger._opOrder.size}`);
  }

  // NB-3: centralCompact honors options.env (XDG_RUNTIME_DIR / H2A_ROOT) without options.runtimeBase
  {
    const dir = makeDir(t, 'mcp-l1-nb3-');
    const customRoot = join(dir, 'store');
    const customRun = join(dir, 'run');
    const stateDir = join(customRun, 'h2a-mcp-central');
    fs.mkdirSync(customRoot, { recursive: true, mode: 0o700 });
    fs.mkdirSync(customRun, { recursive: true, mode: 0o700 });
    seedHistoricalState(stateDir, { root: customRoot, operations: 80 });

    const { centralCompact } = await import('../dist/runtime/mcp-central-operator.js');
    const res = centralCompact({
      dryRun: true,
      env: { ...process.env, HOME: dir, XDG_RUNTIME_DIR: customRun, H2A_ROOT: customRoot, H2A_MCP_AUTHORITY: '' }
    });
    assert.equal(res.stateDirectory, stateDir, 'centralCompact must resolve stateDirectory from options.env.XDG_RUNTIME_DIR');
    assert.ok(res.archived.operations >= 80);
  }
});
