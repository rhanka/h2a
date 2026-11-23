import assert from 'node:assert/strict';
import childProcess, { spawn } from 'node:child_process';
import { createHash, generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import {
  assertResponsiveUnderContention,
  measureControlProbe,
  percentile,
  readThreadCpuUsage,
  startEventLoopWorkProbe
} from './helpers/event-loop-work.js';

import { authenticatedHttpRequest } from '../dist/runtime/handover/authenticated-http.js';
import { currentIdentity } from '../dist/runtime/handover/admission.js';
import { ColdAdministration } from '../dist/runtime/handover/administration.js';
import * as mutationModule from '../dist/runtime/handover/mutation.js';
import { resolveMutationFlock, establishWriterControl, updateWriterControl, writerDirectory } from '../dist/runtime/handover/mutation.js';
import { Participants } from '../dist/runtime/handover/participants.js';
import { publishState, readState, replaceState } from '../dist/runtime/handover/state.js';
import { digest } from '../dist/runtime/handover/wire.js';
import { consentPairId } from '../dist/runtime/drive/consent.js';
import { handleDriveConsent } from '../dist/runtime/drive/consent-tools.js';
import * as presenceModule from '../dist/runtime/local-files/presence.js';
import { inboxDir, localStorePaths, negotiationDir } from '../dist/runtime/local-files/paths.js';
import { createLocalStore } from '../dist/runtime/local-files/store.js';
import { recordMcpRunDelegationAsync } from '../dist/runtime/mcp/agent-launch.js';
import { handleRegisterInstance } from '../dist/runtime/mcp/handlers.js';
import { createMcpServer } from '../dist/runtime/mcp/server.js';
import { SessionRegistry } from '../dist/runtime/mcp/sessions.js';
import { runMcpStdio } from '../dist/runtime/mcp/stdio.js';
import { captureCentralAttachment } from '../dist/runtime/mcp-central-context.js';
import { startCentralMcpServer } from '../dist/runtime/mcp-central.js';
import { resolveExclusionsDir } from '../dist/runtime/remote-agent/exclusions.js';

function fixture(t, extraOpts = {}) {
  t.mock.method(fs, 'fsyncSync', () => {});
  syncBuiltinESMExports();
  const dir = fs.mkdtempSync(join(tmpdir(), 'central-cpu-'));
  const root = join(dir, 'store');
  const runtimeBase = join(dir, 'run');
  fs.mkdirSync(runtimeBase, { mode: 0o700 });
  let sweep;
  const clock = {
    now: () => 0,
    setInterval(fn) { sweep = fn; return 1; },
    clearInterval() { sweep = undefined; }
  };
  let central;
  const holders = [];
  t.after(async () => {
    for (const h of holders) {
      try { await h.release(); } catch { /* best effort */ }
    }
    try { await central?.stop(); }
    finally {
      t.mock.restoreAll();
      syncBuiltinESMExports();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
  return {
    dir,
    root,
    runtimeBase,
    trackHolder(h) { holders.push(h); return h; },
    async tick() {
      if (!sweep) return;
      const res = sweep();
      if (res && typeof res.then === 'function') await res;
    },
    async start(override = {}) {
      central = await startCentralMcpServer({
        root, runtimeBase, physicalPrefix: dir, env: {}, clock, idleTimeoutMs: 200,
        ...extraOpts,
        ...override
      });
      assert.equal(central.kind, 'started');
      return central;
    }
  };
}

/**
 * Spawn an external child process holding an exclusive OFD flock on `lockPath`
 * until `release()` is called (stdin closes).
 */
async function holdFlockInChild(lockPath) {
  fs.mkdirSync(join(lockPath, '..'), { recursive: true, mode: 0o700 });
  // Ensure the private 0600 lock file exists before flock opens it (otherwise flock creates 0644/0664).
  const fd = fs.openSync(lockPath, fs.constants.O_CREAT | fs.constants.O_RDWR | fs.constants.O_NOFOLLOW, 0o600);
  fs.closeSync(fd);
  const holder = spawn(resolveMutationFlock(), [
    '--exclusive', '--no-fork', lockPath, process.execPath, '-e',
    "process.stdout.write('locked'); process.stdin.resume();"
  ], { stdio: ['pipe', 'pipe', 'ignore'] });
  const exited = once(holder, 'exit');
  await Promise.race([
    once(holder.stdout, 'data'),
    exited.then(() => assert.fail(`flock holder exited before acquiring ${lockPath}`))
  ]);
  let released = false;
  return {
    child: holder,
    async release() {
      if (released) return;
      released = true;
      try { holder.stdin.end(); } catch { /* ignore */ }
      await Promise.race([exited, delay(3000).then(() => { try { holder.kill('SIGKILL'); } catch {} })]);
    }
  };
}

/**
 * Spawn an external child process that holds a `locks.ts` advisory lock file
 * (with its own live PID so stale-lock reclaim will never steal it) until
 * `release()` is called.
 */
async function holdAdvisoryLockInChild(lockPath) {
  fs.mkdirSync(join(lockPath, '..'), { recursive: true, mode: 0o700 });
  const script = `
    const fs = require('node:fs');
    const os = require('node:os');
    const p = process.argv[1];
    const owner = { pid: process.pid, hostname: os.hostname(), startedAt: new Date().toISOString() };
    fs.writeFileSync(p, JSON.stringify(owner), { mode: 0o600, flag: 'wx' });
    process.stdout.write('locked');
    process.stdin.resume();
    process.stdin.on('end', () => { try { fs.unlinkSync(p); } catch {} process.exit(0); });
  `;
  const holder = spawn(process.execPath, ['-e', script, lockPath], { stdio: ['pipe', 'pipe', 'pipe'] });
  const exited = once(holder, 'exit');
  let stderr = '';
  holder.stderr.on('data', d => { stderr += String(d); });
  await Promise.race([
    once(holder.stdout, 'data'),
    exited.then(([code]) => assert.fail(`advisory lock holder exited (${code}): ${stderr}`))
  ]);
  let released = false;
  return {
    child: holder,
    async release() {
      if (released) return;
      released = true;
      try { holder.stdin.end(); } catch { /* ignore */ }
      await Promise.race([exited, delay(3000).then(() => { try { holder.kill('SIGKILL'); } catch {} })]);
      try { fs.unlinkSync(lockPath); } catch { /* already gone */ }
    }
  };
}

async function pingOnce(endpoint) {
  const t0 = performance.now();
  const res = await fetch(new URL('/_h2a-central/ping', endpoint));
  const body = await res.json();
  return { elapsedMs: performance.now() - t0, status: res.status, body };
}

async function initDirectSession(central, workspace, extraHeaders = {}) {
  const marker = readState(central.markerPath, 'marker').value;
  const init = await authenticatedHttpRequest(central.markerPath, marker, central.endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'x-h2a-workspace': encodeURIComponent(workspace),
      ...extraHeaders
    },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'cpu-fixture', version: '1' } }
    })
  });
  assert.equal(init.status, 200);
  const sessionId = init.headers.get('mcp-session-id');
  assert.ok(sessionId);
  return { marker, sessionId };
}

// ============================================================================
// T2.1 — Reprise des tests de contention de #520 sur le balayage d'inactivité
// ============================================================================

test('T2.1a: central retries an idle sweep after a different process releases the writer lock', { timeout: 20_000 }, async t => {
  const f = fixture(t);
  const central = await f.start();
  const lockPath = join(f.root, '.h2a-writer-control', '.mutation.lock');
  const holder = f.trackHolder(await holdFlockInChild(lockPath));
  try {
    const started = performance.now();
    for (let i = 0; i < 6; i++) await f.tick();
    assert.ok(performance.now() - started < 2_000, 'contention must not block the event loop');
    const ping = await pingOnce(central.endpoint);
    assert.equal(ping.body.generation, central.generation);
  } finally {
    await holder.release();
  }
  for (let i = 0; i < 4; i++) await f.tick();
  const ping = await pingOnce(central.endpoint);
  assert.equal(ping.body.generation, central.generation);
  await f.tick();
  await central.closed;
});

test('T2.1b: an orphan central reads the durable operation history only when it can retire', { timeout: 20_000 }, async t => {
  const f = fixture(t);
  const central = await f.start();
  const marker = readState(central.markerPath, 'marker').value;
  const operationId = randomUUID();
  const operationPath = join(marker.stateDirectory, `operation-${digest(operationId).slice(7)}.json`);
  publishState(operationPath, {
    schemaVersion: 1, revision: 1, operationId, attachmentId: randomUUID(),
    ownerGeneration: marker.generation, executionOwner: marker.processIdentity,
    kind: 'call', state: 'completed', result: { completed: true }
  }, 'admittedOperation');
  // Simulate an external writer updating participant-revision.json so syncIfExternalChange observes it.
  const revPath = join(marker.stateDirectory, 'participant-revision.json');
  const prevRev = readState(revPath, 'participantRevision');
  replaceState(revPath, { schemaVersion: 1, revision: prevRev.value.revision + 1 }, 'participantRevision', prevRev);

  const open = fs.openSync;
  let reads = 0;
  t.mock.method(fs, 'openSync', (path, ...args) => {
    if (path === operationPath) reads++;
    return open(path, ...args);
  });
  syncBuiltinESMExports();
  for (let i = 0; i < 4; i++) await f.tick();
  assert.equal(reads, 0, 'early quiet ticks must not replay the operation history');
  await f.tick();
  assert.equal(reads, 1, 'retirement must still check the durable operation history');
  await central.closed;
});

test('T2.1c: quiet sweeps with 20 shim attachments do not read historical operations', { timeout: 30_000 }, async t => {
  const f = fixture(t);
  const open = fs.openSync;
  let operationReads = 0;
  t.mock.method(fs, 'openSync', (path, ...args) => {
    if (typeof path === 'string' && /\/operation-[a-f0-9]+\.json$/.test(path)) operationReads++;
    return open(path, ...args);
  });
  syncBuiltinESMExports();
  const central = await f.start();
  const marker = readState(central.markerPath, 'marker').value;
  for (let i = 0; i < 20; i++) {
    const attachment = captureCentralAttachment(f.root, f.root, { host: 'claude' }, {
      CLAUDE_CODE_SESSION_ID: `cpu-fixture-${i}`
    });
    const init = await authenticatedHttpRequest(central.markerPath, marker, central.endpoint, {
      method: 'POST',
      attachmentId: attachment.id,
      transportEpoch: 1,
      headers: {
        'content-type': 'application/json',
        'x-h2a-attachment': Buffer.from(JSON.stringify(attachment)).toString('base64url')
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {
        protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'fixture', version: '1' }
      } })
    });
    assert.equal(init.status, 200);
    const session = init.headers.get('mcp-session-id');
    assert.ok(session);
    const call = await authenticatedHttpRequest(central.markerPath, marker, central.endpoint, {
      method: 'POST',
      attachmentId: attachment.id,
      transportEpoch: 1,
      headers: { 'content-type': 'application/json', 'mcp-session-id': session },
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call',
        params: { name: 'h2a_identity_status', arguments: {} } })
    });
    assert.ok((await call.json()).result);
  }
  assert.ok(operationReads > 0, 'tool calls must produce durable operations');
  operationReads = 0;
  const started = process.cpuUsage();
  for (let i = 0; i < 10; i++) await f.tick();
  const { user, system } = process.cpuUsage(started);
  t.diagnostic(`ten sweeps: ${operationReads} operation reads, ${(user + system) / 1_000} ms CPU`);
  assert.equal(operationReads, 0, 'a quiet attached sweep must not read operation history');
  assert.ok(user + system < 250_000, `ten sweeps used ${(user + system) / 1_000} ms CPU`);
  const status = await authenticatedHttpRequest(central.markerPath, marker,
    new URL('/_h2a-central/status', central.endpoint));
  assert.equal((await status.json()).attachments, 20);
});

// ============================================================================
// T2.2 — Boucle libre sous contention .mutation.lock (2 500 ms)
// ============================================================================

test('T2.2: event loop stays free (< 100 ms ping and tools/list) while .mutation.lock is held 2500 ms', { timeout: 20_000 }, async t => {
  const f = fixture(t);
  const central = await f.start();
  const { marker, sessionId } = await initDirectSession(central, f.dir);
  const controlPing = await measureControlProbe(() => pingOnce(central.endpoint), 5);
  const listOnce = async (id) => {
    const t0 = performance.now();
    const lr = await authenticatedHttpRequest(central.markerPath, marker, central.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-session-id': sessionId },
      body: JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/list', params: {} })
    });
    const listBody = await lr.json();
    const elapsedMs = performance.now() - t0;
    assert.equal(lr.status, 200);
    assert.ok(Array.isArray(listBody.result?.tools));
    return elapsedMs;
  };
  let controlListId = 50;
  const controlList = await measureControlProbe(() => listOnce(controlListId++), 5);

  const lockPath = join(f.root, '.h2a-writer-control', '.mutation.lock');
  const holder = f.trackHolder(await holdFlockInChild(lockPath));

  // Fire a mutating tools/call while .mutation.lock is held by an external process.
  const mutatingCall = authenticatedHttpRequest(central.markerPath, marker, central.endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-session-id': sessionId },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 2, method: 'tools/call',
      params: { name: 'h2a_blockage_raise', arguments: { instance: 'claude:t22', scope: 'scope:default', reason: 'lock-test' } }
    })
  });

  // Schedule release after 2 500 ms.
  let lockReleased = false;
  const releaseTimer = setTimeout(() => {
    lockReleased = true;
    void holder.release();
  }, 2_500);
  const probe = startEventLoopWorkProbe({ intervalMs: 5 });
  try {
    await delay(100);
    const pingLatencies = [];
    const listLatencies = [];
    let pingsBeforeRelease = 0;
    let listsBeforeRelease = 0;
    let reqId = 100;
    let callDone = false;
    void mutatingCall.finally(() => { callDone = true; });
    while (!callDone && pingLatencies.length < 25) {
      const p = await pingOnce(central.endpoint);
      assert.equal(p.status, 200);
      pingLatencies.push(p.elapsedMs);
      if (!lockReleased) pingsBeforeRelease++;

      const listMs = await listOnce(reqId++);
      listLatencies.push(listMs);
      if (!lockReleased) listsBeforeRelease++;
      await delay(30);
    }
    const work = probe.stop();
    const pingStats = assertResponsiveUnderContention({
      label: 'T2.2 ping',
      pings: pingLatencies,
      pingsBeforeRelease,
      minPingsBeforeRelease: 5,
      control: controlPing,
      probeSummary: work,
      holdMs: 2_500
    });
    const listStats = assertResponsiveUnderContention({
      label: 'T2.2 tools/list',
      pings: listLatencies,
      pingsBeforeRelease: listsBeforeRelease,
      minPingsBeforeRelease: 5,
      control: controlList,
      probeSummary: work,
      holdMs: 2_500,
      p50FloorMs: 80,
      p95FloorMs: 150
    });
    t.diagnostic(
      `T2.2 ping(p50=${pingStats.p50.toFixed(1)}ms p95=${pingStats.p95.toFixed(1)}ms max=${pingStats.maxPing.toFixed(1)}ms beforeRel=${pingsBeforeRelease}) ` +
      `list(p50=${listStats.p50.toFixed(1)}ms p95=${listStats.p95.toFixed(1)}ms max=${listStats.maxPing.toFixed(1)}ms beforeRel=${listsBeforeRelease}) ` +
      `turnCpuMax=${work.maxCpuMs.toFixed(1)}ms lagMax=${work.maxWallLagMs.toFixed(1)}ms`
    );

    const mutRes = await mutatingCall;
    assert.equal(mutRes.status, 200);
    const mutJson = await mutRes.json();
    assert.ok(mutJson.result, `mutating call should succeed after lock release: ${JSON.stringify(mutJson)}`);
  } finally {
    probe.stop();
    clearTimeout(releaseTimer);
    await holder.release();
  }
});

// ============================================================================
// T2.3 — Crash stdio.ts:579 éliminé sous .mutation.lock saturé
// ============================================================================

test('T2.3: runMcpStdio notification under saturated .mutation.lock causes 0 UnhandledPromiseRejection', { timeout: 20_000 }, async t => {
  const f = fixture(t);
  const stateDir = join(f.dir, 'stdio-state');
  fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  fs.mkdirSync(f.root, { recursive: true, mode: 0o700 });
  const marker = { generation: randomUUID(), processIdentity: currentIdentity(), endpointMode: 'discovered', handoverCapabilities: { managedImage: false } };
  const participants = new Participants({ root: f.root, directory: stateDir, marker });
  const participant = participants.attach('att-t23', { workspace: f.dir });

  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const rejections = [];
  const onRejection = (reason) => { rejections.push(reason); };
  process.on('unhandledRejection', onRejection);
  t.after(() => process.off('unhandledRejection', onRejection));

  let mcpServer;
  const serving = runMcpStdio({
    root: f.root,
    workspaceRoot: f.dir,
    stdin, stdout, stderr,
    participant,
    notifyIntervalMs: 60_000,
    heartbeatIntervalMs: 60_000,
    onServer(s) { mcpServer = s; }
  });

  // Open a session while lock is free, then saturate .mutation.lock.
  participant.runOwner(() => {
    mcpServer.sessions.open({ instance: 'claude:t23', subscribedTopics: ['presence.peer_joined'] });
  });
  // Write a peer presence file so notifications.tick() emits a push notification.
  presenceModule.writePresence(f.root, {
    sessionId: 'sess:peer-t23',
    instance: 'codex:peer-t23',
    pid: process.pid,
    startedAt: new Date().toISOString(),
    heartbeatAt: new Date().toISOString(),
    lastMcpActivityAt: new Date().toISOString(),
    state: 'live',
    interests: { scopes: ['scope:default'], negotiations: [] },
    subscribedTopics: ['presence.peer_joined']
  });

  const lockPath = join(writerDirectory(f.root), '.mutation.lock');
  const holder = f.trackHolder(await holdFlockInChild(lockPath));
  try {
    const t0 = performance.now();
    assert.doesNotThrow(() => mcpServer.notifications.tick());
    const elapsed = performance.now() - t0;
    assert.ok(elapsed < 500, `stdio notification tick blocked for ${elapsed.toFixed(1)}ms under lock contention`);
    await delay(100);
    assert.equal(rejections.length, 0, `unexpected unhandled rejections: ${rejections.map(String).join('; ')}`);
  } finally {
    await holder.release();
    stdin.end();
    await serving;
  }
});

// ============================================================================
// T2.4 — closeAttachment et Writable sous contention de .mutation.lock
// ============================================================================

test('T2.4: DELETE and notification during .mutation.lock saturation cause 0 unhandled errors and close after release', { timeout: 20_000 }, async t => {
  const f = fixture(t);
  const rejections = [];
  const exceptions = [];
  const onRej = (e) => rejections.push(e);
  const onExc = (e) => exceptions.push(e);
  process.on('unhandledRejection', onRej);
  process.on('uncaughtException', onExc);
  t.after(() => {
    process.off('unhandledRejection', onRej);
    process.off('uncaughtException', onExc);
  });

  const central = await f.start();
  const { marker, sessionId } = await initDirectSession(central, f.dir);
  const controlPing = await measureControlProbe(() => pingOnce(central.endpoint), 5);
  const lockPath = join(f.root, '.h2a-writer-control', '.mutation.lock');
  const holder = f.trackHolder(await holdFlockInChild(lockPath));

  const origSpawnSync = childProcess.spawnSync;
  const syncCalls = [];
  t.mock.method(childProcess, 'spawnSync', (cmd, args, ...rest) => {
    syncCalls.push(`${cmd} ${Array.isArray(args) ? args.join(' ') : ''}`);
    return origSpawnSync(cmd, args, ...rest);
  });
  syncBuiltinESMExports();

  const probe = startEventLoopWorkProbe({ intervalMs: 5 });
  try {
    // Send DELETE while .mutation.lock is saturated — must return 200 and keep pings responsive
    // strictly BEFORE .mutation.lock is released.
    const delPromise = authenticatedHttpRequest(central.markerPath, marker, central.endpoint, {
      method: 'DELETE',
      headers: { 'mcp-session-id': sessionId }
    });
    const pings = [];
    for (let i = 0; i < 6; i++) {
      const p = await pingOnce(central.endpoint);
      assert.equal(p.status, 200);
      pings.push(p.elapsedMs);
    }

    const delRes = await delPromise;
    assert.equal(delRes.status, 200);
    assert.equal(holder.child.exitCode, null, 'DELETE and pings must complete while .mutation.lock is still held');
    assert.equal(holder.child.signalCode, null, 'lock holder must still be alive during DELETE check');
    const work = probe.stop();
    assertResponsiveUnderContention({
      label: 'T2.4 DELETE contention',
      pings,
      pingsBeforeRelease: pings.length,
      minPingsBeforeRelease: 5,
      control: controlPing,
      probeSummary: work,
      maxPingCeilingMs: 500
    });
    await f.tick();
    assert.deepEqual(syncCalls, [], `expected 0 spawnSync calls during DELETE contention, saw: ${syncCalls.join('; ')}`);
    assert.equal(rejections.length, 0, `unhandled rejections during DELETE contention: ${rejections.map(String).join('; ')}`);
    assert.equal(exceptions.length, 0, `uncaught exceptions during DELETE contention: ${exceptions.map(String).join('; ')}`);
  } finally {
    probe.stop();
    await holder.release();
  }

  // Once lock is released, sweeps drain pendingClosures and retire cleanly.
  for (let i = 0; i < 6; i++) await f.tick();
  await central.closed;
  assert.equal(rejections.length, 0);
  assert.equal(exceptions.length, 0);
});

// ============================================================================
// T2.5 — Graphe .presence.lock, rattachement sous contention et espion spawnSync
// ============================================================================

test('T2.5a: SessionRegistry.touchAsync succeeds in < 50 ms while .mutation.lock is held 3000 ms', { timeout: 20_000 }, async t => {
  const f = fixture(t);
  fs.mkdirSync(f.root, { recursive: true, mode: 0o700 });
  const stateDir = join(f.dir, 'state');
  fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  establishWriterControl(f.root, stateDir);
  const sessions = new SessionRegistry(f.root, { autoHeartbeat: false });
  assert.equal(typeof sessions.openAsync, 'function', 'SessionRegistry.openAsync must exist');
  assert.equal(typeof sessions.touchAsync, 'function', 'SessionRegistry.touchAsync must exist');

  // PR-05: synchronous reservation of sessionId before first await rejects concurrent duplicate.
  const open1 = sessions.openAsync({ instance: 'claude:t25a', sessionId: 'sess:dup-check' });
  await assert.rejects(() => sessions.openAsync({ instance: 'claude:t25a', sessionId: 'sess:dup-check' }), /already open/);
  await open1;

  // Measure an uncontended control touchAsync on the same runner before locking .mutation.lock.
  const controlTouch = await measureControlProbe(() => sessions.touchAsync('sess:dup-check'), 3);

  const lockPath = join(writerDirectory(f.root), '.mutation.lock');
  const presenceLockPath = join(writerDirectory(f.root), '.presence.lock');
  const holder = f.trackHolder(await holdFlockInChild(lockPath));

  // Direct causal proof: touchAsync must acquire .presence.lock only, never open .mutation.lock,
  // and never call child_process.spawnSync while .mutation.lock is held.
  const origOpenSync = fs.openSync;
  const origSpawnSync = childProcess.spawnSync;
  let mutationLockOpens = 0;
  let presenceLockOpens = 0;
  const syncCalls = [];
  t.mock.method(fs, 'openSync', (p, ...args) => {
    if (p === lockPath) mutationLockOpens++;
    if (p === presenceLockPath) presenceLockOpens++;
    return origOpenSync(p, ...args);
  });
  t.mock.method(childProcess, 'spawnSync', (cmd, args, ...rest) => {
    syncCalls.push(`${cmd} ${Array.isArray(args) ? args.join(' ') : ''}`);
    return origSpawnSync(cmd, args, ...rest);
  });
  syncBuiltinESMExports();

  const probe = startEventLoopWorkProbe({ intervalMs: 5 });
  try {
    const cpuBefore = readThreadCpuUsage().raw;
    const t0 = performance.now();
    const updated = await sessions.touchAsync('sess:dup-check');
    const elapsed = performance.now() - t0;
    const touchCpuMs = readThreadCpuUsage(cpuBefore).totalMs;
    const work = probe.stop();

    assert.ok(updated, 'touchAsync must succeed while .mutation.lock is held');
    assert.equal(holder.child.exitCode, null, 'touchAsync must complete while .mutation.lock holder is still alive');
    assert.equal(holder.child.signalCode, null, 'touchAsync must complete before .mutation.lock release');
    assert.equal(mutationLockOpens, 0, `touchAsync must never open .mutation.lock (saw ${mutationLockOpens} opens)`);
    assert.ok(presenceLockOpens >= 1, `touchAsync must acquire .presence.lock (saw ${presenceLockOpens} opens)`);
    assert.deepEqual(syncCalls, [], `touchAsync must perform 0 spawnSync calls, saw: ${syncCalls.join('; ')}`);
    assert.ok(touchCpuMs < 50, `touchAsync main-thread CPU=${touchCpuMs.toFixed(1)}ms exceeded 50ms budget`);
    assert.ok(work.maxWallLagMs < 180, `touchAsync synchronous stall=${work.maxWallLagMs.toFixed(1)}ms exceeded 180ms ceiling`);
    const wallLimit = Math.max(500, controlTouch.medianMs * 25);
    assert.ok(elapsed < wallLimit, `touchAsync took ${elapsed.toFixed(1)}ms (limit ${wallLimit.toFixed(1)}ms, control=${controlTouch.medianMs.toFixed(1)}ms)`);
    t.diagnostic(
      `T2.5a touchAsync elapsed=${elapsed.toFixed(1)}ms cpu=${touchCpuMs.toFixed(1)}ms ` +
      `control=${controlTouch.medianMs.toFixed(1)}ms presenceOpens=${presenceLockOpens} mutOpens=${mutationLockOpens}`
    );
  } finally {
    probe.stop();
    await holder.release();
    await sessions.closeAllAsync('closed');
  }
});

test('T2.5b: 20 concurrent deletePresenceAsync and touchAsync have 0 deadlock, 0 lock_order_violation, and respect freeze/fencing', { timeout: 25_000 }, async t => {
  const f = fixture(t);
  fs.mkdirSync(f.root, { recursive: true, mode: 0o700 });
  const stateDir = join(f.dir, 'state');
  fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  const wdir = writerDirectory(f.root);
  establishWriterControl(f.root, stateDir);

  // Unit assertion: acquiring .mutation.lock while holding .presence.lock alone MUST throw lock_order_violation.
  assert.equal(typeof mutationModule.mutationLockAsync, 'function', 'mutationLockAsync must be exported');
  await assert.rejects(
    () => mutationModule.mutationLockAsync(wdir, () => {
      mutationModule.mutationLock(wdir, () => 'bad');
    }, { lockFile: '.presence.lock' }),
    /lock_order_violation/
  );

  // 20 concurrent deletePresenceAsync (with releasePresence) + touchAsync under cross-contention.
  const marker = { generation: randomUUID(), processIdentity: currentIdentity(), endpointMode: 'discovered', handoverCapabilities: { managedImage: false } };
  const participants = new Participants({
    root: f.root, directory: stateDir, marker,
    writerProof: { evidenceDigest: `sha256:${'a'.repeat(64)}`, verify: () => 'qualified' }
  });
  const rejections = [];
  const onRej = (e) => rejections.push(e);
  process.on('unhandledRejection', onRej);
  t.after(() => process.off('unhandledRejection', onRej));

  const setup = [];
  for (let i = 0; i < 20; i++) {
    const att = await participants.attachAsync(`att-t25b-${i}`, { expectedInstance: `claude:t25b-${i}` });
    const reg = new SessionRegistry(f.root, { autoHeartbeat: false });
    const sess = await att.runOwner(() => reg.openAsync({ instance: `claude:t25b-${i}`, sessionId: `sess:t25b-${i}` }));
    setup.push({ att, reg, sess });
  }
  const tasks = [];
  for (const { att, reg, sess } of setup) {
    tasks.push(
      att.runOwner(() => reg.touchAsync(sess.sessionId)).catch(e => {
        if (String(e?.message).includes('lock_order_violation')) throw e;
      }),
      att.runOwner(() => presenceModule.deletePresenceAsync(f.root, sess.sessionId)).catch(e => {
        if (String(e?.message).includes('lock_order_violation')) throw e;
      })
    );
  }
  await Promise.all(tasks);
  assert.equal(rejections.length, 0, `unexpected unhandled rejections: ${rejections.map(String).join('; ')}`);

  // Close the 20 test attachments before verifying barrier/freeze on a fresh bound attachment.
  for (const { att, reg } of setup) {
    await att.closeAsync(() => reg.closeAllAsync('closed'));
  }

  // Verify ownership_fenced is respected after barrier + freeze.
  const attFrozen = participants.attach('att-t25b-frozen', { expectedInstance: 'claude:t25b-frozen' });
  attFrozen.initialized = true;
  attFrozen.mcp = {
    notifications: { stop() {}, start() {} },
    sessions: { suspend() {}, resume() {}, list() { return []; } },
    callTool() { return { content: [{ type: 'text', text: JSON.stringify({ state: 'identity_ready', instance: 'claude:t25b-frozen' }) }] }; }
  };
  const regFrozen = new SessionRegistry(f.root, { autoHeartbeat: false });
  await attFrozen.runOwner(() => regFrozen.openAsync({ instance: 'claude:t25b-frozen', sessionId: 'sess:t25b-frozen' }));
  participants.barrier('handover-t25b');
  participants.freeze('handover-t25b');
  await assert.rejects(
    () => attFrozen.runOwner(() => regFrozen.touchAsync('sess:t25b-frozen')),
    /ownership_fenced|store_admission_closed/
  );
});

test('T2.5c: full central attachment under lock contention does 0 child_process.spawnSync and no ALS leak into heartbeat', { timeout: 25_000 }, async t => {
  const f = fixture(t);
  const central = await f.start();
  const marker = readState(central.markerPath, 'marker').value;
  const controlPing = await measureControlProbe(() => pingOnce(central.endpoint), 5);

  // Spy on child_process.spawnSync AFTER central startup.
  const origSpawnSync = childProcess.spawnSync;
  const syncCalls = [];
  t.mock.method(childProcess, 'spawnSync', (cmd, args, ...rest) => {
    syncCalls.push(`${cmd} ${Array.isArray(args) ? args.join(' ') : ''}`);
    return origSpawnSync(cmd, args, ...rest);
  });
  syncBuiltinESMExports();

  // Hold BOTH .mutation.lock and .presence.lock for 1 500 ms in external processes.
  const wdir = writerDirectory(f.root);
  const mutHolder = f.trackHolder(await holdFlockInChild(join(wdir, '.mutation.lock')));
  const presHolder = f.trackHolder(await holdFlockInChild(join(wdir, '.presence.lock')));
  let locksReleased = false;
  const releaseTimer = setTimeout(() => {
    locksReleased = true;
    void presHolder.release().then(() => mutHolder.release());
  }, 1_500);

  const probe = startEventLoopWorkProbe({ intervalMs: 5 });
  try {
    // Attachment with deferred identityRequest + TMUX_PANE set + short heartbeat interval.
    const attachment = captureCentralAttachment(f.root, f.dir, { host: 'claude', 'auto-open': 'true' }, {
      CLAUDE_CODE_SESSION_ID: 't25c-session',
      TMUX_PANE: '%999',
      H2A_HEARTBEAT_INTERVAL_MS: '150'
    });
    const initPromise = authenticatedHttpRequest(central.markerPath, marker, central.endpoint, {
      method: 'POST',
      attachmentId: attachment.id,
      transportEpoch: 1,
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'x-h2a-attachment': Buffer.from(JSON.stringify(attachment)).toString('base64url')
      },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'initialize',
        params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't25c', version: '1' } }
      })
    });

    // While locks are held, pings must continue responding before lock release with bounded own work.
    await delay(80);
    const pings = [];
    let pingsBeforeRelease = 0;
    let initDone = false;
    void initPromise.finally(() => { initDone = true; });
    while (!initDone && pings.length < 30) {
      const p = await pingOnce(central.endpoint);
      assert.equal(p.status, 200);
      pings.push(p.elapsedMs);
      if (!locksReleased) pingsBeforeRelease++;
      await delay(30);
    }
    const work = probe.stop();
    assertResponsiveUnderContention({
      label: 'T2.5c contention',
      pings,
      pingsBeforeRelease,
      minPingsBeforeRelease: 5,
      control: controlPing,
      probeSummary: work,
      holdMs: 1_500
    });

    const initRes = await initPromise;
    assert.equal(initRes.status, 200);
    const session = initRes.headers.get('mcp-session-id');
    assert.ok(session);

    // Wait for deferred identity to activate (openAutoOpenSessionAsync -> openAsync + reapDeadInstancePresenceAsync).
    let statusObj = {};
    const deadline = Date.now() + 8_000;
    while (Date.now() < deadline) {
      const st = await authenticatedHttpRequest(central.markerPath, marker, central.endpoint, {
        method: 'POST',
        attachmentId: attachment.id,
        transportEpoch: 1,
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-session-id': session },
        body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'h2a_identity_status', arguments: {} } })
      });
      const json = await st.json();
      statusObj = JSON.parse(json.result.content[0].text);
      if (statusObj.state === 'identity_ready') break;
      await delay(100);
    }
    assert.equal(statusObj.state, 'identity_ready', `identity did not reach ready: ${JSON.stringify(statusObj)}`);

    // Also test explicit h2a_session_open on the central.
    const direct = await initDirectSession(central, f.dir);
    const openRes = await authenticatedHttpRequest(central.markerPath, marker, central.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-session-id': direct.sessionId },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 3, method: 'tools/call',
        params: { name: 'h2a_session_open', arguments: { instance: 'claude:t25c-explicit' } }
      })
    });
    assert.equal(openRes.status, 200);

    // Proof that subsequent touchAsync tick still goes through flock (no ALS lockOwnership leak):
    // acquire .presence.lock FIRST, then snapshot heartbeatAt so no tick racing with holder startup
    // can advance it; verify heartbeatAt stays frozen for > 2 intervals while locked.
    const presVerifyHolder = f.trackHolder(await holdFlockInChild(join(wdir, '.presence.lock')));
    let presenceBefore;
    try {
      presenceBefore = presenceModule.readPresence(f.root, statusObj.sessionId);
      assert.ok(presenceBefore, 'auto-opened presence file must exist');
      await delay(350); // > 2 heartbeat intervals
      const presenceDuringLock = presenceModule.readPresence(f.root, statusObj.sessionId);
      assert.equal(
        presenceDuringLock?.heartbeatAt,
        presenceBefore.heartbeatAt,
        'heartbeat tick must NOT bypass .presence.lock via leaked lockOwnership ALS'
      );
    } finally {
      await presVerifyHolder.release();
    }
    // After release, heartbeat advances again.
    await delay(300);
    const presenceAfter = presenceModule.readPresence(f.root, statusObj.sessionId);
    assert.notEqual(presenceAfter?.heartbeatAt, presenceBefore.heartbeatAt, 'heartbeat must resume after .presence.lock release');

    // DELETE triggers closeAllAsync.
    const del1 = await authenticatedHttpRequest(central.markerPath, marker, central.endpoint, {
      method: 'DELETE',
      attachmentId: attachment.id,
      transportEpoch: 1,
      headers: { 'mcp-session-id': session }
    });
    assert.equal(del1.status, 200);
    const del2 = await authenticatedHttpRequest(central.markerPath, marker, central.endpoint, {
      method: 'DELETE',
      headers: { 'mcp-session-id': direct.sessionId }
    });
    assert.equal(del2.status, 200);

    assert.deepEqual(syncCalls, [], `expected 0 spawnSync calls on central thread, saw: ${syncCalls.join('; ')}`);
  } finally {
    probe.stop();
    clearTimeout(releaseTimer);
    await presHolder.release();
    await mutHolder.release();
  }
});

// ============================================================================
// T2.6 — Isolation AsyncLocalStorage sous concurrence (B-05)
// ============================================================================

test('T2.6: AsyncLocalStorage lockOwnership isolates concurrent callers and enforces mutual exclusion', { timeout: 20_000 }, async t => {
  const f = fixture(t);
  const unitRoot = join(f.dir, 'unit-root');
  fs.mkdirSync(unitRoot, { recursive: true, mode: 0o700 });
  const stateDir = join(f.dir, 'state');
  fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  const wdir = writerDirectory(unitRoot);
  establishWriterControl(unitRoot, stateDir);

  assert.equal(typeof mutationModule.mutationLockAsync, 'function', 'mutationLockAsync must be exported');

  // 1. Direct unit test: two concurrent async callers interleaved by await never overlap in critical section
  //    and never bypass each other's lock, while rejecting any async fn().
  await assert.rejects(
    () => mutationModule.mutationLockAsync(wdir, async () => 'nope'),
    /async_store_critical_section/
  );

  let inCritical = 0;
  let maxConcurrent = 0;
  let completed = 0;
  await Promise.all(Array.from({ length: 12 }, (_, i) => (async () => {
    await delay((i % 3) * 5);
    await mutationModule.mutationLockAsync(wdir, () => {
      inCritical++;
      maxConcurrent = Math.max(maxConcurrent, inCritical);
      // Nested re-entrant call inside same ALS stack MUST succeed.
      mutationModule.mutationLock(wdir, () => {
        assert.equal(inCritical, 1);
      });
      completed++;
      inCritical--;
    });
  })()));
  assert.equal(maxConcurrent, 1, 'critical sections must never overlap');
  assert.equal(completed, 12);

  // 2. Central server test: two concurrent mutating tools/call interleaved via HTTP both succeed cleanly.
  const central = await f.start();
  const { marker, sessionId } = await initDirectSession(central, f.dir);
  const callTool = (id, inst) => authenticatedHttpRequest(central.markerPath, marker, central.endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-session-id': sessionId },
    body: JSON.stringify({
      jsonrpc: '2.0', id, method: 'tools/call',
      params: { name: 'h2a_blockage_raise', arguments: { instance: inst, scope: 'scope:default', reason: `r-${id}` } }
    })
  });
  const [r1, r2] = await Promise.all([callTool(10, 'claude:t26-a'), callTool(11, 'claude:t26-b')]);
  assert.equal(r1.status, 200);
  assert.equal(r2.status, 200);
  const j1 = await r1.json();
  const j2 = await r2.json();
  assert.ok(!j1.result?.isError, JSON.stringify(j1));
  assert.ok(!j2.result?.isError, JSON.stringify(j2));
});

// ============================================================================
// T2.7 — Verrou registry/.lock tenu par un tiers pendant 2 500 ms (B-07)
// ============================================================================

test('T2.7: ping stays < 100 ms while a third-party process holds registry/.lock for 2500 ms', { timeout: 20_000 }, async t => {
  const f = fixture(t);
  const central = await f.start();
  const { marker, sessionId } = await initDirectSession(central, f.dir);
  // Warm up lazy registry dispatch so the mutating call enters the lock immediately.
  const warm = await authenticatedHttpRequest(central.markerPath, marker, central.endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-session-id': sessionId },
    body: JSON.stringify({ jsonrpc: '2.0', id: 19, method: 'tools/call', params: { name: 'h2a_discover_instances', arguments: {} } })
  });
  assert.equal(warm.status, 200);

  const controlPing = await measureControlProbe(() => pingOnce(central.endpoint), 5);
  const regLockPath = join(localStorePaths(f.root).registry, '.lock');
  const holder = f.trackHolder(await holdAdvisoryLockInChild(regLockPath));

  const callPromise = authenticatedHttpRequest(central.markerPath, marker, central.endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-session-id': sessionId },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 20, method: 'tools/call',
      params: {
        name: 'h2a_register_instance',
        arguments: {
          registration: {
            id: 'claude:t27-reg',
            instance: 'claude:t27-reg',
            roles: ['AGENTS'],
            scopes: ['scope:default'],
            registeredAt: new Date().toISOString()
          }
        }
      }
    })
  });

  let lockReleased = false;
  const releaseTimer = setTimeout(() => {
    lockReleased = true;
    void holder.release();
  }, 2_500);
  const probe = startEventLoopWorkProbe({ intervalMs: 5 });
  try {
    const pings = [];
    let pingsBeforeRelease = 0;
    let callDone = false;
    void callPromise.finally(() => { callDone = true; });
    while (!callDone && pings.length < 40) {
      const p = await pingOnce(central.endpoint);
      assert.equal(p.status, 200);
      pings.push(p.elapsedMs);
      if (!lockReleased) pingsBeforeRelease++;
      await delay(40);
    }
    const work = probe.stop();
    const stats = assertResponsiveUnderContention({
      label: 'T2.7 registry/.lock contention',
      pings,
      pingsBeforeRelease,
      minPingsBeforeRelease: 5,
      control: controlPing,
      probeSummary: work,
      holdMs: 2_500
    });
    t.diagnostic(
      `T2.7 p50=${stats.p50.toFixed(1)}ms p95=${stats.p95.toFixed(1)}ms max=${stats.maxPing.toFixed(1)}ms ` +
      `over ${pings.length} pings (beforeRel=${pingsBeforeRelease}, turnCpuMax=${work.maxCpuMs.toFixed(1)}ms, lagMax=${work.maxWallLagMs.toFixed(1)}ms)`
    );

    const res = await callPromise;
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.result && !body.result.isError, JSON.stringify(body));
  } finally {
    probe.stop();
    clearTimeout(releaseTimer);
    await holder.release();
  }
});

// ============================================================================
// T2.8 — payload-store volumineux (4 000 fichiers) + préservation erreur call
// ============================================================================

test('T2.8: oversize output with 4000 pre-existing payloads keeps ping < 100 ms and participant.call preserves original error', { timeout: 30_000 }, async t => {
  const f = fixture(t);
  const wsDir = join(f.dir, 'ws');
  const childTmp = join(f.dir, 'scratch-tmp');
  fs.mkdirSync(wsDir, { recursive: true, mode: 0o700 });
  fs.mkdirSync(childTmp, { recursive: true, mode: 0o700 });
  const prevTmpdir = process.env.TMPDIR;
  process.env.TMPDIR = childTmp;
  t.after(() => { process.env.TMPDIR = prevTmpdir; });

  // Pre-populate <root>/mcp-payloads/ with 4 000 valid payload refs.
  const payloadDir = join(f.root, 'mcp-payloads');
  fs.mkdirSync(payloadDir, { recursive: true, mode: 0o700 });
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const createdAt = new Date().toISOString();
  const smallPayload = Buffer.from('{"ok":true}\n');
  const smallSha = `sha256:${createHash('sha256').update(smallPayload).digest('hex')}`;
  let totalWritten = 0n;
  for (let i = 0; i < 4_000; i++) {
    const ref = i.toString(16).padStart(64, '0');
    const metaText = `${JSON.stringify({ sha256: smallSha, totalBytes: smallPayload.length, createdAt, expiresAt, scope: f.root })}\n`;
    fs.writeFileSync(join(payloadDir, `${ref}.bin`), smallPayload, { mode: 0o600 });
    fs.writeFileSync(join(payloadDir, `${ref}.json`), metaText, { mode: 0o600 });
    totalWritten += BigInt(smallPayload.length + Buffer.byteLength(metaText));
  }
  fs.writeFileSync(join(payloadDir, '.quota-written'), `${totalWritten}\n`, { mode: 0o600 });

  // Seed blockages producing > 1 MiB output on h2a_blockage_list (triggers centralToolResult -> persistOutputAsync).
  const blockageDir = join(localStorePaths(f.root).blockage);
  fs.mkdirSync(blockageDir, { recursive: true, mode: 0o700 });
  const bigReason = 'b'.repeat(65_000);
  for (let i = 0; i < 20; i++) {
    fs.writeFileSync(
      join(blockageDir, `claude-big-${i}.json`),
      JSON.stringify({
        instance: `claude:big-${i}`,
        scope: 'scope:default',
        reason: bigReason,
        raisedAt: createdAt
      })
    );
  }

  const central = await f.start();
  const { marker, sessionId } = await initDirectSession(central, wsDir);
  // Warm up lazy registry dispatch so ping measures payloadStore.persistOutputAsync cleanly.
  await authenticatedHttpRequest(central.markerPath, marker, central.endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-session-id': sessionId },
    body: JSON.stringify({ jsonrpc: '2.0', id: 29, method: 'tools/call', params: { name: 'h2a_discover_instances', arguments: {} } })
  });

  const controlPing = await measureControlProbe(() => pingOnce(central.endpoint), 5);
  const probe = startEventLoopWorkProbe({ intervalMs: 5 });
  const pings = [];
  let work;
  try {
    // Trigger oversize tool call (> 1 MiB) while concurrently measuring /_h2a-central/ping latency.
    const oversizeCall = authenticatedHttpRequest(central.markerPath, marker, central.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-session-id': sessionId },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 30, method: 'tools/call',
        params: { name: 'h2a_blockage_list', arguments: {} }
      })
    });

    let done = false;
    void oversizeCall.finally(() => { done = true; });
    while (!done && pings.length < 20) {
      const p = await pingOnce(central.endpoint);
      assert.equal(p.status, 200);
      pings.push(p.elapsedMs);
      await delay(10);
    }
    const oversizeRes = await oversizeCall;
    assert.equal(oversizeRes.status, 200);
    const oversizeJson = await oversizeRes.json();
    const payloadText = JSON.parse(oversizeJson.result.content[0].text);
    assert.equal(payloadText.code, 'response_too_large');
    assert.ok(payloadText.recovery?.ref, 'oversize output must produce a recovery ref');

    // Also remove .quota-written to force a cold 4 000-payload dirBytesAsync scan on a second oversize call.
    fs.rmSync(join(payloadDir, '.quota-written'), { force: true });
    const oversizeCall2 = authenticatedHttpRequest(central.markerPath, marker, central.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-session-id': sessionId },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 31, method: 'tools/call',
        params: { name: 'h2a_blockage_list', arguments: {} }
      })
    });
    let done2 = false;
    void oversizeCall2.finally(() => { done2 = true; });
    while (!done2 && pings.length < 40) {
      const p = await pingOnce(central.endpoint);
      assert.equal(p.status, 200);
      pings.push(p.elapsedMs);
      await delay(10);
    }
    const oversizeRes2 = await oversizeCall2;
    assert.equal(oversizeRes2.status, 200);
    const oversizeJson2 = await oversizeRes2.json();
    const payloadText2 = JSON.parse(oversizeJson2.result.content[0].text);
    assert.equal(payloadText2.code, 'response_too_large');
    assert.ok(payloadText2.recovery?.ref, 'cold scan oversize output must also produce a recovery ref');
  } finally {
    work = probe.stop();
  }

  const stats = assertResponsiveUnderContention({
    label: 'T2.8 oversize 4000 payloads',
    pings,
    pingsBeforeRelease: pings.length,
    minPingsBeforeRelease: 2,
    control: controlPing,
    probeSummary: work,
    maxTurnCpuMs: 100,
    maxWallLagMs: 180,
    p50FloorMs: 60,
    p95FloorMs: 120,
    maxPingCeilingMs: 500
  });
  t.diagnostic(
    `T2.8 p50=${stats.p50.toFixed(1)}ms p95=${stats.p95.toFixed(1)}ms max=${stats.maxPing.toFixed(1)}ms ` +
    `over ${pings.length} pings (turnCpuMax=${work.maxCpuMs.toFixed(1)}ms, lagMax=${work.maxWallLagMs.toFixed(1)}ms)`
  );

  // Part 2: participant.call preserves original Error("boom") when .mutation.lock is unavailable during fail().
  const stateDir = join(f.dir, 'boom-state');
  fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  const boomRoot = join(f.dir, 'boom-root');
  fs.mkdirSync(boomRoot, { recursive: true, mode: 0o700 });
  const boomMarker = { generation: randomUUID(), processIdentity: currentIdentity(), endpointMode: 'discovered', handoverCapabilities: { managedImage: false } };
  const boomParticipants = new Participants({ root: boomRoot, directory: stateDir, marker: boomMarker });
  const boomParticipant = boomParticipants.attach('att-boom', { workspace: f.dir });

  let boomHolder;
  try {
    await assert.rejects(
      () => boomParticipant.call(async () => {
        boomHolder = f.trackHolder(await holdFlockInChild(join(writerDirectory(boomRoot), '.mutation.lock')));
        throw new Error('boom');
      }),
      (err) => {
        assert.equal(err?.message, 'boom', `expected original error 'boom', got '${err?.message}'`);
        return true;
      }
    );
  } finally {
    await boomHolder?.release();
  }
});

// ============================================================================
// T2.9 — Contention prolongée (6 000 ms) sur .mutation.lock, .presence.lock et registry/.lock
// ============================================================================

test('T2.9: 6000 ms prolonged contention across .mutation.lock, .presence.lock and registry/.lock produces 0 crashes/rejections/deadlocks and ping < 100 ms', { timeout: 25_000 }, async t => {
  const f = fixture(t);
  const rejections = [];
  const exceptions = [];
  const onRej = (e) => rejections.push(e);
  const onExc = (e) => exceptions.push(e);
  process.on('unhandledRejection', onRej);
  process.on('uncaughtException', onExc);
  t.after(() => {
    process.off('unhandledRejection', onRej);
    process.off('uncaughtException', onExc);
  });

  const central = await f.start();
  const { marker, sessionId } = await initDirectSession(central, f.dir);
  const controlPing = await measureControlProbe(() => pingOnce(central.endpoint), 5);
  const wdir = writerDirectory(f.root);
  const mutHolder = f.trackHolder(await holdFlockInChild(join(wdir, '.mutation.lock')));
  const presHolder = f.trackHolder(await holdFlockInChild(join(wdir, '.presence.lock')));
  const regHolder = f.trackHolder(await holdAdvisoryLockInChild(join(localStorePaths(f.root).registry, '.lock')));

  // Spy on child_process.spawnSync to prove 0 blocking flock calls during 6000 ms contention.
  const origSpawnSync = childProcess.spawnSync;
  const flockSyncCalls = [];
  t.mock.method(childProcess, 'spawnSync', (cmd, args, ...rest) => {
    if (String(cmd).includes('flock')) {
      flockSyncCalls.push(`${cmd} ${Array.isArray(args) ? args.join(' ') : ''}`);
    }
    return origSpawnSync(cmd, args, ...rest);
  });
  syncBuiltinESMExports();

  // Start the event-loop work probe BEFORE dispatching concurrent requests so any synchronous
  // stall during lock pre-acquisition or handler dispatch is captured.
  const pings = [];
  const started = performance.now();
  let lastTickAt = started;
  const probe = startEventLoopWorkProbe({ intervalMs: 5 });
  let work;

  // Launch concurrent operations that will time out past 5 000 ms during the 6 000 ms window.
  const pendingAttach = authenticatedHttpRequest(central.markerPath, marker, central.endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'x-h2a-workspace': encodeURIComponent(f.dir) },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't29', version: '1' } } })
  });
  const pendingMut = authenticatedHttpRequest(central.markerPath, marker, central.endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-session-id': sessionId },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 40, method: 'tools/call',
      params: { name: 'h2a_register_instance', arguments: { registration: { id: 'claude:t29', instance: 'claude:t29', roles: ['AGENTS'], scopes: ['scope:default'], registeredAt: new Date().toISOString() } } }
    })
  });

  try {
    while (performance.now() - started < 6_000) {
      const p = await pingOnce(central.endpoint);
      assert.equal(p.status, 200);
      pings.push(p.elapsedMs);
      if (performance.now() - lastTickAt >= 250) {
        await f.tick();
        lastTickAt = performance.now();
      }
      await delay(80);
    }
    work = probe.stop();
    const attachRes = await pendingAttach;
    assert.equal(attachRes.status, 503);
    const attachJson = await attachRes.json();
    assert.equal(attachJson.accepted, false);
    assert.equal(attachJson.execution, 'not_started');
    assert.equal(attachJson.retrySafe, true);

    const mutRes = await pendingMut;
    assert.equal(mutRes.status, 200);
    const mutJson = await mutRes.json();
    assert.equal(mutJson.result?.isError, true);
    const errPayload = JSON.parse(mutJson.result.content[0].text);
    assert.equal(errPayload.retryable, true);
  } finally {
    probe.stop();
    await regHolder.release();
    await presHolder.release();
    await mutHolder.release();
  }

  const stats = assertResponsiveUnderContention({
    label: 'T2.9 6000ms contention',
    pings,
    pingsBeforeRelease: pings.length,
    minPingsBeforeRelease: 20,
    control: controlPing,
    probeSummary: work,
    holdMs: 6_000,
    maxPingCeilingMs: 1_500
  });
  t.diagnostic(
    `T2.9 6000ms contention: ${pings.length} pings, p50=${stats.p50.toFixed(1)}ms, p95=${stats.p95.toFixed(1)}ms, ` +
    `max=${stats.maxPing.toFixed(1)}ms, turnCpuMax=${work.maxCpuMs.toFixed(1)}ms, lagMax=${work.maxWallLagMs.toFixed(1)}ms`
  );
  assert.deepEqual(flockSyncCalls, [], `expected 0 flock spawnSync calls during 6000ms contention, saw: ${flockSyncCalls.join('; ')}`);
  assert.equal(rejections.length, 0, `unhandled rejections: ${rejections.map(String).join('; ')}`);
  assert.equal(exceptions.length, 0, `uncaught exceptions: ${exceptions.map(String).join('; ')}`);
});

// ============================================================================
// T2.10 (B-1) — ColdAdministration bothLocks + admissionsOpenAsync (0 spawnSync)
// ============================================================================

function seedBarrierTransaction(stateDir, marker, root, handoverId, barrierDeadline) {
  const coordinator = currentIdentity();
  const ref = `transaction-${digest(handoverId).slice(7)}.json`;
  const sourceFields = ['generation', 'publicationEpoch', 'processIdentity', 'packageVersion', 'buildId', 'manifestDigest'];
  const tx = {
    schemaVersion: 1,
    revision: 1,
    component: 'mcp',
    upgradeId: `upg-${handoverId}`,
    handoverId,
    transactionEpoch: 1,
    mode: 'cold-stop',
    source: Object.fromEntries(sourceFields.map(k => [k, marker[k]])),
    target: {
      packageVersion: marker.packageVersion,
      buildId: marker.buildId,
      manifestDigest: marker.manifestDigest,
      entrypoint: join(stateDir, 'fake-bin.js')
    },
    coordinator,
    controllerEpoch: 1,
    inventoryRevision: 1,
    state: 'BARRIER',
    barrierDeadline,
    precheckEvidenceDigest: `sha256:${'b'.repeat(64)}`,
    checkpointReferences: [],
    stepResults: {},
    successorReservation: {
      attempts: 0,
      candidateIdentity: null,
      selectionEpoch: 1,
      targetManifestDigest: marker.manifestDigest
    }
  };
  publishState(join(stateDir, ref), tx, 'componentTransaction');
  const controlPath = join(stateDir, 'component-control.json');
  const oldControl = readState(controlPath, 'componentControl');
  replaceState(controlPath, {
    ...oldControl.value,
    revision: oldControl.value.revision + 1,
    activeTransaction: ref,
    transactionEpoch: 1
  }, 'componentControl', oldControl);
  updateWriterControl(root, { gate: 'BARRIER', handoverId });
  return { ref, coordinator, tx };
}

test('T2.10 (B-1): ColdAdministration stop/admin/sweep and admissionsOpenAsync do 0 spawnSync and keep ping < 100 ms under .presence.lock / .mutation.lock contention', { timeout: 25_000 }, async t => {
  const f = fixture(t);
  const central = await f.start({
    writerProof: { evidenceDigest: `sha256:${'a'.repeat(64)}`, verify: () => 'qualified' }
  });
  const marker = readState(central.markerPath, 'marker').value;
  const wdir = writerDirectory(f.root);

  // Seed an active BARRIER transaction so admin.expire() / admin.operatorStop() / admin.execute('abort')
  // all call reconcileParticipants -> participants.abort -> updateWriterControl ({ bothLocks: true }).
  const { coordinator } = seedBarrierTransaction(marker.stateDirectory, marker, f.root, 'h-b1-admin', Date.now() + 60_000);

  // Spy on child_process.spawnSync AFTER startup and seeding.
  const origSpawnSync = childProcess.spawnSync;
  const syncCalls = [];
  t.mock.method(childProcess, 'spawnSync', (cmd, args, ...rest) => {
    syncCalls.push(`${cmd} ${Array.isArray(args) ? args.join(' ') : ''}`);
    return origSpawnSync(cmd, args, ...rest);
  });
  syncBuiltinESMExports();

  const controlPing = await measureControlProbe(() => pingOnce(central.endpoint), 5);

  // Hold ONLY .presence.lock externally for 1 000 ms (leaving .mutation.lock FREE).
  // Without { bothLocks: true } on mcp-central.ts:365, :537, :554, mutationLockAsync enters
  // immediately and updateWriterControl falls back to spawnSync(flock, .presence.lock)!
  const presHolder = f.trackHolder(await holdFlockInChild(join(wdir, '.presence.lock')));
  let presReleased = false;
  const releaseTimer = setTimeout(() => {
    presReleased = true;
    void presHolder.release();
  }, 1_000);
  const abortProbe = startEventLoopWorkProbe({ intervalMs: 5 });
  try {
    const step = {
      protocolVersion: 1,
      mode: 'cold-stop',
      upgradeId: 'upg-h-b1-admin',
      handoverId: 'h-b1-admin',
      transactionEpoch: 1,
      expectedGeneration: marker.generation,
      expectedPublicationEpoch: marker.publicationEpoch,
      inventoryRevision: 1,
      stepId: 'abort-b1',
      payloadDigest: digest({})
    };
    const adminPromise = authenticatedHttpRequest(
      central.markerPath,
      marker,
      new URL('/_h2a-central/admin/abort', central.endpoint),
      { method: 'POST', body: JSON.stringify({ step, payload: {}, coordinator }) }
    );

    await delay(60);
    const pings = [];
    let pingsBeforeRelease = 0;
    let adminDone = false;
    void adminPromise.finally(() => { adminDone = true; });
    while (!adminDone && pings.length < 25) {
      const p = await pingOnce(central.endpoint);
      assert.equal(p.status, 200);
      pings.push(p.elapsedMs);
      if (!presReleased) pingsBeforeRelease++;
      await delay(30);
    }
    const abortWork = abortProbe.stop();
    assertResponsiveUnderContention({
      label: 'T2.10 /admin/abort',
      pings,
      pingsBeforeRelease,
      minPingsBeforeRelease: 5,
      control: controlPing,
      probeSummary: abortWork,
      holdMs: 1_000
    });

    const adminRes = await adminPromise;
    const adminBody = await adminRes.text();
    assert.equal(adminRes.status, 200, adminBody);
    assert.deepEqual(syncCalls, [], `expected 0 spawnSync calls during /admin/abort, saw: ${syncCalls.join('; ')}`);
  } finally {
    abortProbe.stop();
    clearTimeout(releaseTimer);
    await presHolder.release();
  }

  // Also test runSweep (admin.expire) and POST /_h2a-central/stop while .presence.lock is held.
  t.mock.restoreAll();
  syncBuiltinESMExports();
  seedBarrierTransaction(marker.stateDirectory, marker, f.root, 'h-b1-sweep', 0);
  syncCalls.length = 0;
  t.mock.method(fs, 'fsyncSync', () => {});
  t.mock.method(childProcess, 'spawnSync', (cmd, args, ...rest) => {
    syncCalls.push(`${cmd} ${Array.isArray(args) ? args.join(' ') : ''}`);
    return origSpawnSync(cmd, args, ...rest);
  });
  syncBuiltinESMExports();

  const presHolder2 = f.trackHolder(await holdFlockInChild(join(wdir, '.presence.lock')));
  try {
    // runSweep uses { nonBlocking: true, bothLocks: true }: must skip cleanly without spawnSync!
    const sweepProbe = startEventLoopWorkProbe({ intervalMs: 5 });
    let sweepWork;
    const sweepCpu0 = readThreadCpuUsage().raw;
    const t0 = performance.now();
    try {
      await f.tick();
    } finally {
      sweepWork = sweepProbe.stop();
    }
    const sweepMs = performance.now() - t0;
    const sweepCpuMs = readThreadCpuUsage(sweepCpu0).totalMs;
    assert.equal(presHolder2.child.exitCode, null, 'runSweep must finish while .presence.lock is still held');
    assert.ok(sweepCpuMs < 50, `runSweep main-thread CPU=${sweepCpuMs.toFixed(1)}ms exceeded 50ms budget`);
    assert.ok(sweepWork.maxWallLagMs < 180, `runSweep synchronous stall=${sweepWork.maxWallLagMs.toFixed(1)}ms exceeded 180ms ceiling`);
    assert.ok(sweepMs < 1_000, `runSweep elapsed=${sweepMs.toFixed(1)}ms exceeded 1000ms bounded ceiling while .presence.lock was held`);
    assert.deepEqual(syncCalls, [], `expected 0 spawnSync calls during runSweep, saw: ${syncCalls.join('; ')}`);

    // POST /_h2a-central/stop while .presence.lock is held for 800 ms.
    let stopPresReleased = false;
    const releaseStopTimer = setTimeout(() => {
      stopPresReleased = true;
      void presHolder2.release();
    }, 800);
    const stopProbe = startEventLoopWorkProbe({ intervalMs: 5 });
    try {
      const stopPromise = authenticatedHttpRequest(
        central.markerPath,
        marker,
        new URL('/_h2a-central/stop', central.endpoint),
        { method: 'POST', body: '{}' }
      );
      await delay(60);
      const stopPings = [];
      let stopPingsBeforeRelease = 0;
      let stopDone = false;
      void stopPromise.finally(() => { stopDone = true; });
      while (!stopDone && stopPings.length < 20) {
        const p = await pingOnce(central.endpoint);
        assert.equal(p.status, 200);
        stopPings.push(p.elapsedMs);
        if (!stopPresReleased) stopPingsBeforeRelease++;
        await delay(30);
      }
      const stopWork = stopProbe.stop();
      assertResponsiveUnderContention({
        label: 'T2.10 /stop',
        pings: stopPings,
        pingsBeforeRelease: stopPingsBeforeRelease,
        minPingsBeforeRelease: 3,
        control: controlPing,
        probeSummary: stopWork,
        holdMs: 800
      });
      const stopRes = await stopPromise;
      assert.equal(stopRes.status, 200);
      assert.deepEqual(syncCalls, [], `expected 0 spawnSync calls during /stop, saw: ${syncCalls.join('; ')}`);
    } finally {
      stopProbe.stop();
      clearTimeout(releaseStopTimer);
    }
  } finally {
    await presHolder2.release();
  }

  // Part 2: ColdAdministration.admissionsOpenAsync on live-transfer contradiction uses async lock (0 spawnSync).
  const liveDir = join(f.dir, 'b1-live-state');
  const liveRoot = join(f.dir, 'b1-live-root');
  fs.mkdirSync(liveDir, { recursive: true, mode: 0o700 });
  fs.mkdirSync(liveRoot, { recursive: true, mode: 0o700 });
  const liveMarker = { ...marker, generation: randomUUID(), stateDirectory: liveDir };
  const liveParticipants = await Participants.createAsync({ root: liveRoot, directory: liveDir, marker: liveMarker });
  const liveAdmin = new ColdAdministration({
    directory: liveDir,
    marker: liveMarker,
    inventory: () => ({ revision: 1 }),
    drain: () => ({ revision: 1, calls: 0, children: 0, briefs: 0, callbacks: 0, effects: 0 }),
    liveSource: { sourcePublished: () => false },
    withMutationLock: (fn) => liveParticipants.registry.withLock(fn, { bothLocks: true }),
    withMutationLockAsync: (fn, opts) => liveParticipants.registry.withLockAsync(fn, { ...opts, bothLocks: true }),
    close() {}
  });
  assert.equal(typeof liveAdmin.admissionsOpenAsync, 'function', 'ColdAdministration.admissionsOpenAsync must exist');

  // Seed a live-transfer RESERVED transaction whose sourcePublished() is false.
  const liveRef = `transaction-${digest('h-b1-live').slice(7)}.json`;
  const sourceFields = ['generation', 'publicationEpoch', 'processIdentity', 'packageVersion', 'buildId', 'manifestDigest'];
  publishState(join(liveDir, liveRef), {
    schemaVersion: 1, revision: 1, component: 'mcp', upgradeId: 'upg-live', handoverId: 'h-b1-live',
    transactionEpoch: 1, mode: 'live-transfer',
    source: Object.fromEntries(sourceFields.map(k => [k, liveMarker[k]])),
    target: { packageVersion: liveMarker.packageVersion, buildId: liveMarker.buildId, manifestDigest: liveMarker.manifestDigest, entrypoint: join(liveDir, 'fake-bin.js') },
    coordinator: currentIdentity(), controllerEpoch: 1, inventoryRevision: 1, state: 'RESERVED',
    barrierDeadline: null, precheckEvidenceDigest: `sha256:${'c'.repeat(64)}`, checkpointReferences: [],
    stepResults: {}, successorReservation: { attempts: 0, candidateIdentity: null, selectionEpoch: 1, targetManifestDigest: liveMarker.manifestDigest }
  }, 'componentTransaction');
  const liveCtrlPath = join(liveDir, 'component-control.json');
  const oldLiveCtrl = readState(liveCtrlPath, 'componentControl');
  replaceState(liveCtrlPath, { ...oldLiveCtrl.value, revision: oldLiveCtrl.value.revision + 1, activeTransaction: liveRef, transactionEpoch: 1 }, 'componentControl', oldLiveCtrl);

  syncCalls.length = 0;
  const liveMutHolder = f.trackHolder(await holdFlockInChild(join(writerDirectory(liveRoot), '.mutation.lock')));
  let liveTicksBeforeRelease = 0;
  const liveProbe = startEventLoopWorkProbe({ intervalMs: 5 });
  const releaseLiveTimer = setTimeout(() => {
    liveTicksBeforeRelease = liveProbe.ticks();
    void liveMutHolder.release();
  }, 500);
  try {
    const openPromise = liveAdmin.admissionsOpenAsync();
    const isOpen = await openPromise;
    const liveWork = liveProbe.stop();
    assert.ok(liveTicksBeforeRelease >= 5, `event loop must tick while admissionsOpenAsync awaits .mutation.lock (observed ${liveTicksBeforeRelease} ticks before release)`);
    assert.ok(liveWork.maxCpuMs < 50, `admissionsOpenAsync main-thread CPU=${liveWork.maxCpuMs.toFixed(1)}ms exceeded 50ms budget`);
    assert.ok(liveWork.maxWallLagMs < 180, `admissionsOpenAsync synchronous stall=${liveWork.maxWallLagMs.toFixed(1)}ms exceeded 180ms ceiling`);
    assert.equal(isOpen, false);
    assert.equal(liveAdmin.transaction().value.state, 'RECOVERY_BLOCKED');
    assert.deepEqual(syncCalls, [], `expected 0 spawnSync calls during admissionsOpenAsync, saw: ${syncCalls.join('; ')}`);
  } finally {
    liveProbe.stop();
    clearTimeout(releaseLiveTimer);
    await liveMutHolder.release();
  }
});

// ============================================================================
// T2.11 (B-2) — h2a_conductor_launch under sharedStore + async pre-acquisition
// ============================================================================

test('T2.11 (B-2): h2a_conductor_launch with confirm=true uses sharedStore and async lock pre-acquisition (0 flock spawnSync, ping < 100 ms)', { timeout: 25_000 }, async t => {
  const f = fixture(t);
  // Provide a minimal shell stub for `track workspace-activity` (zero Python) so recommendation === "launch".
  const fakeBin = join(f.dir, 'fake-bin');
  fs.mkdirSync(fakeBin, { recursive: true, mode: 0o700 });
  const fakeTrack = join(fakeBin, 'track');
  fs.writeFileSync(fakeTrack, '#!/bin/sh\nprintf \'{"pending":1,"stalled":[{"id":"s1","title":"stalled"}]}\'\n', { mode: 0o755 });
  const prevPath = process.env.PATH ?? '';
  process.env.PATH = `${fakeBin}:${prevPath}`;
  t.after(() => { process.env.PATH = prevPath; });

  const central = await f.start();
  const { marker, sessionId } = await initDirectSession(central, f.dir);
  // Warm up lazy registry dispatch before measuring lock contention.
  await authenticatedHttpRequest(central.markerPath, marker, central.endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-session-id': sessionId },
    body: JSON.stringify({ jsonrpc: '2.0', id: 100, method: 'tools/call', params: { name: 'h2a_discover_instances', arguments: {} } })
  });

  // Register a live remote agent in presence so h2a_conductor_launch resolves it from presence (no args.remote).
  const remoteInstance = 'remote:h2a:bbbbbbbbbbbb';
  presenceModule.writePresence(f.root, {
    sessionId: 'sess:b2-remote',
    instance: remoteInstance,
    host: 'remote',
    pid: process.pid,
    startedAt: new Date().toISOString(),
    heartbeatAt: new Date().toISOString(),
    lastMcpActivityAt: new Date().toISOString(),
    state: 'live',
    interests: { scopes: ['scope:default'], negotiations: [] },
    subscribedTopics: []
  });

  // Spy on child_process.spawnSync and child_process.execFileSync: neither flock nor track
  // may block the central event loop synchronously during h2a_conductor_launch.
  const origSpawnSync = childProcess.spawnSync;
  const origExecFileSync = childProcess.execFileSync;
  const flockSyncCalls = [];
  const execFileSyncCalls = [];
  t.mock.method(childProcess, 'spawnSync', (cmd, args, ...rest) => {
    if (String(cmd).includes('flock')) {
      flockSyncCalls.push(`${cmd} ${Array.isArray(args) ? args.join(' ') : ''}`);
    }
    return origSpawnSync(cmd, args, ...rest);
  });
  t.mock.method(childProcess, 'execFileSync', (cmd, args, ...rest) => {
    execFileSyncCalls.push(`${cmd} ${Array.isArray(args) ? args.join(' ') : ''}`);
    return origExecFileSync(cmd, args, ...rest);
  });
  syncBuiltinESMExports();

  const controlPing = await measureControlProbe(() => pingOnce(central.endpoint), 5);
  const remoteInboxLock = join(inboxDir(localStorePaths(f.root), remoteInstance), '.lock');
  const inboxHolder = f.trackHolder(await holdAdvisoryLockInChild(remoteInboxLock));
  let inboxReleased = false;
  const releaseTimer = setTimeout(() => {
    inboxReleased = true;
    void inboxHolder.release();
  }, 1_200);
  const probe = startEventLoopWorkProbe({ intervalMs: 5 });
  try {
    const launchPromise = authenticatedHttpRequest(central.markerPath, marker, central.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-session-id': sessionId },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 101,
        method: 'tools/call',
        params: {
          name: 'h2a_conductor_launch',
          arguments: {
            workspaceId: 'ws:00000000-0000-4000-8000-0000000000b2',
            confirm: true,
            instance: 'claude:self:aaaaaaaaaaaa'
          }
        }
      })
    });

    await delay(60);
    const pings = [];
    let pingsBeforeRelease = 0;
    let done = false;
    void launchPromise.finally(() => { done = true; });
    while (!done && pings.length < 35) {
      const p = await pingOnce(central.endpoint);
      assert.equal(p.status, 200);
      pings.push(p.elapsedMs);
      if (!inboxReleased) pingsBeforeRelease++;
      await delay(30);
    }
    const work = probe.stop();
    const stats = assertResponsiveUnderContention({
      label: 'T2.11 h2a_conductor_launch',
      pings,
      pingsBeforeRelease,
      minPingsBeforeRelease: 5,
      control: controlPing,
      probeSummary: work,
      holdMs: 1_200
    });
    t.diagnostic(
      `T2.11 p50=${stats.p50.toFixed(1)}ms p95=${stats.p95.toFixed(1)}ms max=${stats.maxPing.toFixed(1)}ms ` +
      `over ${pings.length} pings (beforeRel=${pingsBeforeRelease}, turnCpuMax=${work.maxCpuMs.toFixed(1)}ms, lagMax=${work.maxWallLagMs.toFixed(1)}ms)`
    );

    const res = await launchPromise;
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(!body.result?.isError, `h2a_conductor_launch failed: ${JSON.stringify(body)}`);
    const payload = JSON.parse(body.result.content[0].text);
    assert.equal(payload.action, 'emitted', JSON.stringify(payload));
    assert.equal(payload.to, remoteInstance);
    assert.deepEqual(flockSyncCalls, [], `expected 0 flock spawnSync calls in h2a_conductor_launch, saw: ${flockSyncCalls.join('; ')}`);
    assert.deepEqual(execFileSyncCalls, [], `expected 0 execFileSync calls in h2a_conductor_launch, saw: ${execFileSyncCalls.join('; ')}`);
  } finally {
    probe.stop();
    clearTimeout(releaseTimer);
    await inboxHolder.release();
  }
});

// ============================================================================
// T2.12 (B-3) — Pre-acquisition for drive_consent_request/respond and resolved h2a_send/h2a_inbox
// ============================================================================

test('T2.12 (B-3): h2a_drive_consent_request/respond and resolved h2a_send/h2a_inbox targets pre-acquire locks asynchronously past 25 ms contention', { timeout: 25_000 }, async t => {
  const f = fixture(t);
  fs.mkdirSync(f.root, { recursive: true, mode: 0o700 });
  const stateDir = join(f.dir, 'b3-state');
  fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  const marker = { generation: randomUUID(), processIdentity: currentIdentity(), endpointMode: 'discovered', handoverCapabilities: { managedImage: false } };
  const participants = await Participants.createAsync({ root: f.root, directory: stateDir, marker });

  // Build central-configured LocalStore with centralEventLoopMaxSyncWaitMs: 25.
  const store = createLocalStore({ root: f.root, alwaysEmitConsentBudget: true, centralEventLoopMaxSyncWaitMs: 25 });
  const aliceId = 'claude:b3-alice:111111111111';
  const bobId = 'codex:b3-bob:222222222222';
  const aliceKeys = generateKeyPairSync('ed25519');
  const bobKeys = generateKeyPairSync('ed25519');
  const alicePriv = aliceKeys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const alicePub = aliceKeys.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const bobPriv = bobKeys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const bobPub = bobKeys.publicKey.export({ type: 'spki', format: 'pem' }).toString();

  store.registerInstance({ id: aliceId, instance: aliceId, name: 'AliceDisplay', roles: ['AGENTS'], scopes: ['scope:default'], registeredAt: new Date().toISOString() });
  store.registerInstance({ id: bobId, instance: bobId, name: 'BobDisplay', roles: ['AGENTS'], scopes: ['scope:default'], registeredAt: new Date().toISOString() });
  store.addInstanceKey(aliceId, alicePub);
  store.addInstanceKey(bobId, bobPub);

  const attAlice = await participants.attachAsync('att-b3-alice', { workspace: f.dir, expectedInstance: aliceId });
  const attBob = await participants.attachAsync('att-b3-bob', { workspace: f.dir, expectedInstance: bobId });
  const srvAlice = createMcpServer({
    root: f.root, workspaceRoot: f.dir, store, participant: attAlice,
    getSendContext: () => ({ instance: aliceId, privateKeyPem: alicePriv })
  });
  const srvBob = createMcpServer({
    root: f.root, workspaceRoot: f.dir, store, participant: attBob,
    getSendContext: () => ({ instance: bobId, privateKeyPem: bobPriv })
  });

  // Write live presence for Bob with display name "BobDisplay".
  presenceModule.writePresence(f.root, {
    sessionId: 'sess:b3-bob',
    instance: bobId,
    name: 'BobDisplay',
    host: 'codex',
    pid: process.pid,
    startedAt: new Date().toISOString(),
    heartbeatAt: new Date().toISOString(),
    lastMcpActivityAt: new Date().toISOString(),
    state: 'live',
    interests: { scopes: ['scope:default'], negotiations: [] },
    subscribedTopics: []
  });

  // 1. h2a_drive_consent_request (from comes from signer, NOT args.from) under 300 ms negotiationLock hold (> 25 ms).
  const pairId = consentPairId(aliceId, bobId);
  const pairLockPath = join(negotiationDir(localStorePaths(f.root), pairId), '.lock');
  const now = Date.now();
  let requestId;
  {
    const holder = f.trackHolder(await holdAdvisoryLockInChild(pairLockPath));
    const releaseTimer = setTimeout(() => { void holder.release(); }, 300);
    try {
      const reqRes = await srvAlice.callTool('h2a_drive_consent_request', {
        to: bobId,
        answerBy: new Date(now + 60_000).toISOString(),
        requestedNotAfter: new Date(now + 120_000).toISOString(),
        purpose: 'b3-test'
      });
      assert.ok(!reqRes.isError, `h2a_drive_consent_request failed under 300ms pair lock contention: ${JSON.stringify(reqRes)}`);
      const parsed = JSON.parse(reqRes.content[0].text);
      requestId = parsed.payload.requestId;
      assert.ok(requestId);
    } finally {
      clearTimeout(releaseTimer);
      await holder.release();
    }
  }

  // 2. h2a_drive_consent_respond (to comes from signer, NOT args.to) under 300 ms negotiationLock hold (> 25 ms).
  {
    const holder = f.trackHolder(await holdAdvisoryLockInChild(pairLockPath));
    const releaseTimer = setTimeout(() => { void holder.release(); }, 300);
    try {
      const respRes = await srvBob.callTool('h2a_drive_consent_respond', {
        from: aliceId,
        requestId,
        decision: 'refuse',
        reason: 'b3-test'
      });
      assert.ok(!respRes.isError, `h2a_drive_consent_respond failed under 300ms pair lock contention: ${JSON.stringify(respRes)}`);
    } finally {
      clearTimeout(releaseTimer);
      await holder.release();
    }
  }

  // 3. h2a_inbox put & pop using display name "BobDisplay" (resolves to bobId) under 300 ms inboxLock(bobId) hold (> 25 ms).
  const bobInboxLock = join(inboxDir(localStorePaths(f.root), bobId), '.lock');
  const envId = 'env-b3-inbox-1';
  {
    const holder = f.trackHolder(await holdAdvisoryLockInChild(bobInboxLock));
    const releaseTimer = setTimeout(() => { void holder.release(); }, 300);
    try {
      const putRes = await srvAlice.callTool('h2a_inbox', {
        action: 'put',
        instance: 'BobDisplay',
        envelope: {
          protocol: 'sentropic.h2a',
          version: '1.0',
          id: envId,
          type: 'event',
          actor: { instance: aliceId, role: 'AGENTS', scope: 'scope:default' },
          target: { instance: bobId },
          body: { kind: 'message', topic: 'MESSAGE', text: 'hello' },
          createdAt: new Date().toISOString()
        }
      });
      assert.ok(!('error' in putRes), `h2a_inbox put (display name) failed under 300ms inbox lock contention: ${JSON.stringify(putRes)}`);
      assert.equal(putRes.ok, true);
    } finally {
      clearTimeout(releaseTimer);
      await holder.release();
    }
  }
  {
    const holder = f.trackHolder(await holdAdvisoryLockInChild(bobInboxLock));
    const releaseTimer = setTimeout(() => { void holder.release(); }, 300);
    try {
      const popRes = await srvAlice.callTool('h2a_inbox', {
        action: 'pop',
        instance: 'BobDisplay',
        envelopeId: envId
      });
      assert.ok(!('error' in popRes), `h2a_inbox pop (display name) failed under 300ms inbox lock contention: ${JSON.stringify(popRes)}`);
      assert.equal(popRes.envelope?.id, envId);
    } finally {
      clearTimeout(releaseTimer);
      await holder.release();
    }
  }

  // 4. h2a_send using live alias "codex:b3-bob" (resolves via deliver-hint to bobId) under 300 ms inboxLock(bobId) hold (> 25 ms).
  {
    const holder = f.trackHolder(await holdAdvisoryLockInChild(bobInboxLock));
    const releaseTimer = setTimeout(() => { void holder.release(); }, 300);
    try {
      const sendRes = await srvAlice.callTool('h2a_send', {
        to: 'codex:b3-bob',
        message: 'hello via alias'
      });
      assert.ok(!('error' in sendRes), `h2a_send (alias) failed under 300ms inbox lock contention: ${JSON.stringify(sendRes)}`);
      assert.equal(sendRes.ok, true);
      assert.equal(sendRes.recipient, bobId);
    } finally {
      clearTimeout(releaseTimer);
      await holder.release();
    }
  }
});

// ============================================================================
// T2.13 (NB-1..NB-4) — localQueues FIFO cleanup, retryable lock errors, remote_off async, delegation containment
// ============================================================================

test('T2.13 (NB-1..NB-4): localQueues timeout cleanup, safeError/consent retryable, h2a_remote_off async, and delegation lock containment', { timeout: 25_000 }, async t => {
  const f = fixture(t);

  // NB-1: Caller B timing out in localQueues while Caller A still waits must NOT delete the queue tail.
  const nb1Root = join(f.dir, 'nb1-root');
  const nb1State = join(f.dir, 'nb1-state');
  fs.mkdirSync(nb1Root, { recursive: true, mode: 0o700 });
  fs.mkdirSync(nb1State, { recursive: true, mode: 0o700 });
  establishWriterControl(nb1Root, nb1State);
  const nb1Wdir = writerDirectory(nb1Root);
  const nb1Holder = f.trackHolder(await holdFlockInChild(join(nb1Wdir, '.mutation.lock')));
  try {
    // Caller A enters queue and blocks in kernel spawn(flock).
    const callerA = mutationModule.mutationLockAsync(nb1Wdir, () => 'A', { timeoutMs: 2_000 });
    await delay(50);
    // Caller B queues behind A and times out quickly (80 ms).
    await assert.rejects(
      () => mutationModule.mutationLockAsync(nb1Wdir, () => 'B', { timeoutMs: 80 }),
      /mutation_lock_unavailable/
    );
    // Caller C with nonBlocking:true MUST short-circuit via `nonBlocking && prev` with 0 extra spawn(flock)!
    let flockSpawnsForC = 0;
    const origSpawn = childProcess.spawn;
    t.mock.method(childProcess, 'spawn', (cmd, ...rest) => {
      if (String(cmd).includes('flock')) flockSpawnsForC++;
      return origSpawn(cmd, ...rest);
    });
    syncBuiltinESMExports();
    await assert.rejects(
      () => mutationModule.mutationLockAsync(nb1Wdir, () => 'C', { nonBlocking: true }),
      /mutation_lock_unavailable/
    );
    assert.equal(flockSpawnsForC, 0, 'NB-1: nonBlocking caller C must short-circuit on active queue without spawning flock');
    t.mock.restoreAll();
    t.mock.method(fs, 'fsyncSync', () => {});
    syncBuiltinESMExports();
    await nb1Holder.release();
    assert.equal(await callerA, 'A');
  } finally {
    await nb1Holder.release();
  }

  // NB-2: safeError and handleDriveConsent preserve code + retryable:true on LockTimeoutError.
  const nb2Root = join(f.dir, 'nb2-root');
  const nb2Store = createLocalStore({ root: nb2Root, centralEventLoopMaxSyncWaitMs: 25 });
  const nb2RegLock = join(localStorePaths(nb2Root).registry, '.lock');
  const nb2Holder = f.trackHolder(await holdAdvisoryLockInChild(nb2RegLock));
  try {
    const regErr = handleRegisterInstance(nb2Store, {
      registration: { id: 'claude:nb2', instance: 'claude:nb2', roles: ['AGENTS'], scopes: ['scope:default'], registeredAt: new Date().toISOString() }
    });
    assert.equal(regErr.code, 'lock_timeout', `NB-2: expected code='lock_timeout', got ${JSON.stringify(regErr)}`);
    assert.equal(regErr.retryable, true, `NB-2: expected retryable=true, got ${JSON.stringify(regErr)}`);
  } finally {
    await nb2Holder.release();
  }
  const nb2Keys = generateKeyPairSync('ed25519');
  const nb2Priv = nb2Keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const nb2Pub = nb2Keys.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  nb2Store.registerInstance({ id: 'claude:nb2-a:111111111111', instance: 'claude:nb2-a:111111111111', roles: ['AGENTS'], scopes: ['scope:default'], registeredAt: new Date().toISOString() });
  nb2Store.registerInstance({ id: 'claude:nb2-b:222222222222', instance: 'claude:nb2-b:222222222222', roles: ['AGENTS'], scopes: ['scope:default'], registeredAt: new Date().toISOString() });
  nb2Store.addInstanceKey('claude:nb2-a:111111111111', nb2Pub);
  const nb2Holder2 = f.trackHolder(await holdAdvisoryLockInChild(nb2RegLock));
  try {
    const now = Date.now();
    const consentErr = handleDriveConsent(
      nb2Store,
      { instance: 'claude:nb2-a:111111111111', privateKeyPem: nb2Priv },
      'h2a_drive_consent_request',
      { to: 'claude:nb2-b:222222222222', answerBy: new Date(now + 60_000).toISOString(), requestedNotAfter: new Date(now + 120_000).toISOString() }
    );
    assert.equal(consentErr.isError, true);
    const parsedConsentErr = JSON.parse(consentErr.content[0].text);
    assert.equal(parsedConsentErr.code, 'lock_timeout');
    assert.equal(parsedConsentErr.retryable, true);
  } finally {
    await nb2Holder2.release();
  }

  // NB-3: h2a_remote_off on central stays non-blocking (ping < 100 ms) while .exclusions.lock is held 600 ms.
  const prevRemoteFlag = process.env.H2A_REMOTE_CONTROL;
  const prevConfigHome = process.env.XDG_CONFIG_HOME;
  const nb3Config = join(f.dir, 'nb3-config');
  fs.mkdirSync(nb3Config, { recursive: true, mode: 0o700 });
  process.env.H2A_REMOTE_CONTROL = '1';
  process.env.XDG_CONFIG_HOME = nb3Config;
  t.after(() => {
    if (prevRemoteFlag === undefined) delete process.env.H2A_REMOTE_CONTROL;
    else process.env.H2A_REMOTE_CONTROL = prevRemoteFlag;
    if (prevConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = prevConfigHome;
  });
  const central = await f.start();
  const { marker, sessionId } = await initDirectSession(central, f.dir);
  await authenticatedHttpRequest(central.markerPath, marker, central.endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-session-id': sessionId },
    body: JSON.stringify({ jsonrpc: '2.0', id: 200, method: 'tools/call', params: { name: 'h2a_discover_instances', arguments: {} } })
  });
  const nb3ControlPing = await measureControlProbe(() => pingOnce(central.endpoint), 5);
  const exclLock = join(resolveExclusionsDir({ env: process.env }), '.exclusions.lock');
  const exclHolder = f.trackHolder(await holdAdvisoryLockInChild(exclLock));
  let exclReleased = false;
  const releaseExcl = setTimeout(() => {
    exclReleased = true;
    void exclHolder.release();
  }, 800);
  const nb3Probe = startEventLoopWorkProbe({ intervalMs: 5 });
  try {
    const offPromise = authenticatedHttpRequest(central.markerPath, marker, central.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-session-id': sessionId },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 201, method: 'tools/call',
        params: { name: 'h2a_remote_off', arguments: { session: 'pty-nb3-test' } }
      })
    });
    await delay(60);
    const pings = [];
    let pingsBeforeRelease = 0;
    let done = false;
    void offPromise.finally(() => { done = true; });
    while (!done && pings.length < 25) {
      const p = await pingOnce(central.endpoint);
      assert.equal(p.status, 200);
      pings.push(p.elapsedMs);
      if (!exclReleased) pingsBeforeRelease++;
      await delay(30);
    }
    const nb3Work = nb3Probe.stop();
    assertResponsiveUnderContention({
      label: 'T2.13 NB-3 h2a_remote_off',
      pings,
      pingsBeforeRelease,
      minPingsBeforeRelease: 3,
      control: nb3ControlPing,
      probeSummary: nb3Work,
      holdMs: 800
    });
    const offRes = await offPromise;
    assert.equal(offRes.status, 200);
    const offJson = await offRes.json();
    assert.ok(!offJson.result?.isError, JSON.stringify(offJson));
  } finally {
    nb3Probe.stop();
    clearTimeout(releaseExcl);
    await exclHolder.release();
  }

  // NB-4: recordMcpRunDelegationAsync must NOT reject under lock contention after worker already started.
  const nb4Holder = f.trackHolder(await holdFlockInChild(join(nb1Wdir, '.mutation.lock')));
  try {
    await assert.doesNotReject(() => recordMcpRunDelegationAsync(
      nb1Root,
      { ok: true, state: 'started', session: { tmuxSession: 'nb4-worker', pid: process.pid } },
      { origin: 'mcp', delegatorInstance: 'claude:nb4', delegatorTmuxSession: 'nb4-parent' },
      'evt-nb4',
      120
    ));
  } finally {
    await nb4Holder.release();
  }
});
