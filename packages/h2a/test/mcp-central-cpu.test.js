import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { authenticatedHttpRequest } from '../dist/runtime/handover/authenticated-http.js';
import { resolveMutationFlock } from '../dist/runtime/handover/mutation.js';
import { publishState, readState } from '../dist/runtime/handover/state.js';
import { digest } from '../dist/runtime/handover/wire.js';
import { captureCentralAttachment } from '../dist/runtime/mcp-central-context.js';
import { startCentralMcpServer } from '../dist/runtime/mcp-central.js';

function fixture(t) {
  // Keep the real file publication and cross-process flock, while excluding
  // disk flush latency from a regression about event-loop work.
  t.mock.method(fs, 'fsyncSync', () => {});
  syncBuiltinESMExports();
  const dir = fs.mkdtempSync(join(tmpdir(), 'central-cpu-'));
  const root = join(dir, 'store');
  const runtimeBase = join(dir, 'run');
  fs.mkdirSync(runtimeBase, { mode: 0o700 });
  let sweep;
  const clock = {
    now: () => 0,
    setInterval(fn) { sweep = fn; },
    clearInterval() { sweep = undefined; }
  };
  let central;
  t.after(async () => {
    try { await central?.stop(); }
    finally {
      t.mock.restoreAll();
      syncBuiltinESMExports();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
  return {
    root,
    tick() { sweep(); },
    async start() {
      central = await startCentralMcpServer({
        root, runtimeBase, physicalPrefix: dir, env: {}, clock, idleTimeoutMs: 200
      });
      assert.equal(central.kind, 'started');
      return central;
    }
  };
}

test('central retries an idle sweep after a different process releases the writer lock', { timeout: 20_000 }, async t => {
  const f = fixture(t);
  const central = await f.start();
  const lockPath = join(f.root, '.h2a-writer-control', '.mutation.lock');
  // Keep the inherited flock held until stdin closes. The stdout byte is sent
  // only after acquisition, so the sweep always sees real contention.
  const holder = spawn(resolveMutationFlock(), [
    '--exclusive', '--no-fork', lockPath, process.execPath, '-e',
    "process.stdout.write('locked'); process.stdin.resume();"
  ], { stdio: ['pipe', 'pipe', 'ignore'] });
  const exited = once(holder, 'exit');
  try {
    await Promise.race([
      once(holder.stdout, 'data'),
      exited.then(() => assert.fail('writer lock holder exited before acquiring the lock'))
    ]);
    const started = performance.now();
    for (let i = 0; i < 6; i++) assert.doesNotThrow(() => f.tick());
    assert.ok(performance.now() - started < 2_000, 'contention must not block the event loop');
    const ping = await fetch(new URL('/_h2a-central/ping', central.endpoint));
    assert.equal((await ping.json()).generation, central.generation);
  } finally {
    holder.stdin.end();
    await exited;
  }
  // Busy sweeps do not count as quiet. Once the lock is available, idle
  // retirement still needs a complete quiet window.
  for (let i = 0; i < 4; i++) f.tick();
  const ping = await fetch(new URL('/_h2a-central/ping', central.endpoint));
  assert.equal((await ping.json()).generation, central.generation);
  f.tick();
  await central.closed;
});

test('central reaches readiness without loading historical consent journals', async t => {
  const f = fixture(t);
  t.mock.timers.enable({ apis: ['setInterval'] });
  const pair = join(f.root, 'negotiations', 'drive-consent__sha256__fixture');
  fs.mkdirSync(pair, { recursive: true, mode: 0o700 });
  const journal = join(pair, 'journal.jsonl');
  fs.writeFileSync(journal, 'corrupt fixture\n');
  const read = fs.readFileSync;
  let consentReads = 0;
  t.mock.method(fs, 'readFileSync', (path, ...args) => {
    if (path === journal) consentReads++;
    return read(path, ...args);
  });
  syncBuiltinESMExports();
  await f.start();
  assert.equal(consentReads, 0, 'readiness must not depend on the consent history');
  t.mock.timers.tick(60_000);
  assert.equal(consentReads, 1, 'the periodic pass still verifies the whole journal');
});

test('an orphan central reads the durable operation history only when it can retire', async t => {
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
  const open = fs.openSync;
  let reads = 0;
  t.mock.method(fs, 'openSync', (path, ...args) => {
    if (path === operationPath) reads++;
    return open(path, ...args);
  });
  syncBuiltinESMExports();
  for (let i = 0; i < 4; i++) f.tick();
  assert.equal(reads, 0, 'early quiet ticks must not replay the operation history');
  f.tick();
  assert.equal(reads, 1, 'retirement must still check the durable operation history');
  await central.closed;
});

test('quiet sweeps with 20 shim attachments do not read historical operations', async t => {
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
  for (let i = 0; i < 10; i++) f.tick();
  const { user, system } = process.cpuUsage(started);
  t.diagnostic(`ten sweeps: ${operationReads} operation reads, ${(user + system) / 1_000} ms CPU`);
  assert.equal(operationReads, 0, 'a quiet attached sweep must not read operation history');
  assert.ok(user + system < 250_000, `ten sweeps used ${(user + system) / 1_000} ms CPU`);
  const status = await authenticatedHttpRequest(central.markerPath, marker,
    new URL('/_h2a-central/status', central.endpoint));
  assert.equal((await status.json()).attachments, 20);
});
