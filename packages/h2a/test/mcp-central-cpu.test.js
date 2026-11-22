import assert from 'node:assert/strict';
import childProcess, { spawn } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

import { authenticatedHttpRequest } from '../dist/runtime/handover/authenticated-http.js';
import { currentIdentity } from '../dist/runtime/handover/admission.js';
import * as mutationModule from '../dist/runtime/handover/mutation.js';
import { resolveMutationFlock, establishWriterControl, writerDirectory } from '../dist/runtime/handover/mutation.js';
import { Participants } from '../dist/runtime/handover/participants.js';
import { publishState, readState, replaceState } from '../dist/runtime/handover/state.js';
import { digest } from '../dist/runtime/handover/wire.js';
import * as presenceModule from '../dist/runtime/local-files/presence.js';
import { localStorePaths } from '../dist/runtime/local-files/paths.js';
import { SessionRegistry } from '../dist/runtime/mcp/sessions.js';
import { runMcpStdio } from '../dist/runtime/mcp/stdio.js';
import { captureCentralAttachment } from '../dist/runtime/mcp-central-context.js';
import { startCentralMcpServer } from '../dist/runtime/mcp-central.js';

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
  const releaseTimer = setTimeout(() => { void holder.release(); }, 2_500);
  try {
    await delay(100);
    const pingLatencies = [];
    const listLatencies = [];
    for (let i = 0; i < 10; i++) {
      const p = await pingOnce(central.endpoint);
      assert.equal(p.status, 200);
      pingLatencies.push(p.elapsedMs);

      const t0 = performance.now();
      const lr = await authenticatedHttpRequest(central.markerPath, marker, central.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-session-id': sessionId },
        body: JSON.stringify({ jsonrpc: '2.0', id: 100 + i, method: 'tools/list', params: {} })
      });
      const listBody = await lr.json();
      const listMs = performance.now() - t0;
      assert.equal(lr.status, 200);
      assert.ok(Array.isArray(listBody.result?.tools));
      listLatencies.push(listMs);
      await delay(50);
    }
    const maxPing = Math.max(...pingLatencies);
    const maxList = Math.max(...listLatencies);
    t.diagnostic(`T2.2 maxPing=${maxPing.toFixed(1)}ms maxList=${maxList.toFixed(1)}ms`);
    assert.ok(maxPing < 100, `ping exceeded 100ms under .mutation.lock contention: ${maxPing.toFixed(1)}ms`);
    assert.ok(maxList < 100, `tools/list exceeded 100ms under .mutation.lock contention: ${maxList.toFixed(1)}ms`);

    const mutRes = await mutatingCall;
    assert.equal(mutRes.status, 200);
    const mutJson = await mutRes.json();
    assert.ok(mutJson.result, `mutating call should succeed after lock release: ${JSON.stringify(mutJson)}`);
  } finally {
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
  const lockPath = join(f.root, '.h2a-writer-control', '.mutation.lock');
  const holder = f.trackHolder(await holdFlockInChild(lockPath));

  try {
    // Send DELETE while .mutation.lock is saturated — must not crash or hang ping.
    const delPromise = authenticatedHttpRequest(central.markerPath, marker, central.endpoint, {
      method: 'DELETE',
      headers: { 'mcp-session-id': sessionId }
    });
    const ping = await pingOnce(central.endpoint);
    assert.equal(ping.status, 200);
    assert.ok(ping.elapsedMs < 100, `ping during DELETE contention took ${ping.elapsedMs.toFixed(1)}ms`);

    const delRes = await delPromise;
    assert.equal(delRes.status, 200);
    await f.tick();
    assert.equal(rejections.length, 0, `unhandled rejections during DELETE contention: ${rejections.map(String).join('; ')}`);
    assert.equal(exceptions.length, 0, `uncaught exceptions during DELETE contention: ${exceptions.map(String).join('; ')}`);
  } finally {
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

  const lockPath = join(writerDirectory(f.root), '.mutation.lock');
  const holder = f.trackHolder(await holdFlockInChild(lockPath));
  try {
    const t0 = performance.now();
    const updated = await sessions.touchAsync('sess:dup-check');
    const elapsed = performance.now() - t0;
    assert.ok(updated, 'touchAsync must succeed while .mutation.lock is held');
    assert.ok(elapsed < 50, `touchAsync took ${elapsed.toFixed(1)}ms (>= 50ms) while .mutation.lock was held`);
    t.diagnostic(`T2.5a touchAsync elapsed=${elapsed.toFixed(1)}ms`);
  } finally {
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
  const releaseTimer = setTimeout(() => {
    void presHolder.release().then(() => mutHolder.release());
  }, 1_500);

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

    // While locks are held, ping must stay < 100 ms.
    await delay(100);
    for (let i = 0; i < 5; i++) {
      const p = await pingOnce(central.endpoint);
      assert.equal(p.status, 200);
      assert.ok(p.elapsedMs < 100, `ping during T2.5c contention took ${p.elapsedMs.toFixed(1)}ms`);
      await delay(100);
    }

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
    // hold .presence.lock and confirm heartbeatAt does NOT advance while locked!
    const presenceBefore = presenceModule.readPresence(f.root, statusObj.sessionId);
    assert.ok(presenceBefore, 'auto-opened presence file must exist');
    const presVerifyHolder = f.trackHolder(await holdFlockInChild(join(wdir, '.presence.lock')));
    try {
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

  const releaseTimer = setTimeout(() => { void holder.release(); }, 2_500);
  try {
    const pings = [];
    let callDone = false;
    void callPromise.finally(() => { callDone = true; });
    while (!callDone && pings.length < 30) {
      const p = await pingOnce(central.endpoint);
      assert.equal(p.status, 200);
      pings.push(p.elapsedMs);
      await delay(100);
    }
    const maxPing = Math.max(...pings);
    t.diagnostic(`T2.7 maxPing=${maxPing.toFixed(1)}ms over ${pings.length} pings`);
    assert.ok(maxPing < 100, `ping froze for ${maxPing.toFixed(1)}ms while registry/.lock was held`);

    const res = await callPromise;
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.result && !body.result.isError, JSON.stringify(body));
  } finally {
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

  // Trigger oversize tool call (> 1 MiB) while concurrently measuring /_h2a-central/ping latency.
  const oversizeCall = authenticatedHttpRequest(central.markerPath, marker, central.endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-session-id': sessionId },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 30, method: 'tools/call',
      params: { name: 'h2a_blockage_list', arguments: {} }
    })
  });

  const pings = [];
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

  const maxPing = Math.max(...pings);
  t.diagnostic(`T2.8 maxPing=${maxPing.toFixed(1)}ms over ${pings.length} pings`);
  assert.ok(maxPing < 100, `ping exceeded 100ms during persistOutput with 4000 payloads: ${maxPing.toFixed(1)}ms`);

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
  const wdir = writerDirectory(f.root);
  const mutHolder = f.trackHolder(await holdFlockInChild(join(wdir, '.mutation.lock')));
  const presHolder = f.trackHolder(await holdFlockInChild(join(wdir, '.presence.lock')));
  const regHolder = f.trackHolder(await holdAdvisoryLockInChild(join(localStorePaths(f.root).registry, '.lock')));

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

  const pings = [];
  const started = performance.now();
  try {
    while (performance.now() - started < 6_000) {
      const p = await pingOnce(central.endpoint);
      assert.equal(p.status, 200);
      pings.push(p.elapsedMs);
      await f.tick();
      await delay(250);
    }
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
    await regHolder.release();
    await presHolder.release();
    await mutHolder.release();
  }

  const sorted = [...pings].sort((a, b) => a - b);
  const p99 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99))];
  t.diagnostic(`T2.9 6000ms contention: ${pings.length} pings, p99=${p99.toFixed(1)}ms, max=${sorted.at(-1).toFixed(1)}ms`);
  assert.ok(p99 < 100, `p99 ping exceeded 100ms under 6000ms contention: ${p99.toFixed(1)}ms`);
  assert.equal(rejections.length, 0, `unhandled rejections: ${rejections.map(String).join('; ')}`);
  assert.equal(exceptions.length, 0, `uncaught exceptions: ${exceptions.map(String).join('; ')}`);
});
