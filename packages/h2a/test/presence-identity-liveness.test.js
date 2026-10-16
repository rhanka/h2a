import assert from 'node:assert/strict';
import { fork, spawnSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { existsSync, linkSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { once } from 'node:events';
import test from 'node:test';
import { createLocalStore, createMcpServer, listPresence, readPresence, runMcpStdio, writePresence } from '../dist/index.js';
import { createIdentityController } from '../dist/runtime/mcp/identity-state.js';
import { handleSend } from '../dist/runtime/mcp/handlers.js';
import { withIdentityFence, withIdentityFenceSync } from '../dist/runtime/local-files/identity-fence.js';

function rootFor(t) {
  const root = mkdtempSync(join(tmpdir(), 'h2a-presence-live-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function session(instance, sessionId = 'sess:test') {
  const now = new Date().toISOString();
  return { instance, sessionId, pid: process.pid, startedAt: now, heartbeatAt: now,
    state: 'live', interests: { scopes: [], negotiations: [] }, subscribedTopics: [] };
}

test('heartbeat survives a transient write failure in a real MCP session process', { timeout: 6000 }, async t => {
  const root = rootFor(t);
  const child = fork(new URL('./helpers/presence-heartbeat-child.mjs', import.meta.url), [root],
    { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  const exited = once(child, 'exit');
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM'); await exited; });
  const next = () => Promise.race([
    once(child, 'message').then(([message]) => message),
    exited.then(() => { throw new Error(`heartbeat process exited: ${stderr}`); })
  ]);
  const opened = await next();
  const initial = listPresence(root)[0].heartbeatAt;
  child.send('fail');
  const reply = await next();
  assert.equal(reply.recovered.sessionId, opened.sessionId);
  assert.match(reply.diagnostics, /presence heartbeat failed; retrying next tick/);
  assert.ok(reply.frames.split('\n').filter(Boolean).map(line => JSON.parse(line)).some(frame => frame.id === 42 && frame.result),
    'MCP still answers initialize after the failed heartbeat');
  assert.ok(Date.parse(listPresence(root)[0].heartbeatAt) > Date.parse(initial));
  assert.deepEqual(readdirSync(join(root, 'presence')).filter(name => name.includes('.tmp-')), []);
  child.send('stop');
  await exited;
  assert.equal(child.exitCode, 0);
});

test('MCP reconnect reannounces the same instance and shutdown removes its presence', async t => {
  const root = rootFor(t);
  const instance = 'claude:reconnect:111111111111';
  const ids = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const running = runMcpStdio({ root, stdin, stdout, stderr,
      autoOpen: { instance, host: 'claude' }, heartbeatIntervalMs: 20 });
    await delay(60);
    const live = listPresence(root);
    assert.equal(live.length, 1);
    assert.equal(live[0].instance, instance);
    ids.push(live[0].sessionId);
    stdin.end();
    await running;
    assert.deepEqual(listPresence(root), []);
  }
  assert.notEqual(ids[0], ids[1]);
});

test('failed serialization leaves no zero-byte temporary presence and preserves the last publication', t => {
  const root = rootFor(t);
  const valid = session('claude:serialization:111111111111');
  writePresence(root, valid);
  const circular = { ...valid };
  circular.extra = circular;
  assert.throws(() => writePresence(root, circular), /circular/i);
  assert.deepEqual(readPresence(root, valid.sessionId), valid);
  assert.deepEqual(readdirSync(join(root, 'presence')).filter(name => name.includes('.tmp-')), []);
});

for (const tool of ['h2a_identity_status', 'h2a_discover_sessions']) {
  test(`${tool} triggers one bounded identity retry after timeout, without restart`, async t => {
    const root = rootFor(t);
    let clock = 0n;
    let workers = 0;
    let resolve;
    const identity = { instance: 'gemini:retry:111111111111', host: 'gemini', action: 'override', privateKeyPath: '', publicKeyPath: '' };
    const controller = createIdentityController({ request: { root, cwd: root, host: 'gemini' },
      timeoutMs: 50, retryMinIntervalMs: 10, nowNs: () => clock,
      spawnWorker: () => { workers++; return { onResolved(cb) { resolve = cb; }, onError() {}, onExitWithoutResult() {}, cancel() {} }; },
      activate: () => ({ ok: true, sessionId: 'sess:retry' }) });
    t.after(() => controller.cancel('test complete'));
    const server = createMcpServer({ root, identity: controller, sessions: { autoHeartbeat: false } });
    controller.start();
    clock = 51_000_000n;
    resolve(identity);
    assert.equal(controller.status().cause, 'identity_timeout');
    assert.equal(controller.status().retryable, true);
    await server.callTool(tool, {});
    assert.equal(workers, 1, 'minimum retry interval is enforced');
    clock += 11_000_000n;
    await server.callTool(tool, {});
    assert.equal(workers, 2, 'read calls must actually trigger self-healing');
    await server.callTool(tool, {});
    assert.equal(workers, 2, 'pending retry cannot fork another worker');
    resolve(identity);
    assert.equal(controller.status().state, 'identity_ready');
  });
}

test('presence GC removes only old dead-writer temporary files and respects read-only discovery', t => {
  const root = rootFor(t);
  const live = session('claude:gc:111111111111');
  writePresence(root, live);
  const dir = join(root, 'presence');
  const dead = spawnSync(process.execPath, ['-e', ''], { stdio: 'ignore' });
  assert.equal(dead.status, 0);
  const old = Date.now() - 48 * 60 * 60 * 1000;
  const names = [`dead.json.tmp-${dead.pid}-${old}`, `live.json.tmp-${process.pid}-${old}`,
    `young.json.tmp-${dead.pid}-${Date.now()}`, 'unrelated.tmp-1', 'bad.json.tmp-unknown'];
  for (const name of names) { writeFileSync(join(dir, name), ''); utimesSync(join(dir, name), new Date(old), new Date(old)); }
  const linked = join(dir, `linked.json.tmp-${dead.pid}-${old}`);
  linkSync(join(dir, names[1]), linked);
  const symlink = join(dir, `symlink.json.tmp-${dead.pid}-${old}`);
  symlinkSync(join(dir, names[1]), symlink);
  listPresence(root, { sweep: false });
  assert.ok(existsSync(join(dir, names[0])));
  listPresence(root);
  assert.equal(existsSync(join(dir, names[0])), false, 'old orphan must be collected');
  for (const name of names.slice(1)) assert.ok(existsSync(join(dir, name)), name);
  assert.ok(existsSync(linked));
  assert.ok(existsSync(symlink));
  assert.equal(listPresence(root).length, 1);
});

for (const acquire of [withIdentityFenceSync, withIdentityFence]) {
  test(`${acquire.name} collects old dead-holder archives while preserving live and linked files`, async t => {
    const root = rootFor(t);
    const dir = join(root, 'identity');
    mkdirSync(dir);
    const dead = spawnSync(process.execPath, ['-e', ''], { stdio: 'ignore' });
    assert.equal(dead.status, 0);
    const old = new Date(Date.now() - 48 * 60 * 60 * 1000);
    const files = { '.lock.stale-dead': { pid: dead.pid }, '.lock.stale-2026-10-14T23:00:00.000Z': { pid: dead.pid },
      '.lock.stale-live': { pid: process.pid },
      '.lock.stale-young': { pid: dead.pid }, '.lock.stale-linked': { pid: dead.pid },
      '.lock.stale-unknown': {}, '.lock.succ-preserve': { pid: dead.pid } };
    for (const [name, record] of Object.entries(files)) {
      writeFileSync(join(dir, name), JSON.stringify(record));
      if (name !== '.lock.stale-young') utimesSync(join(dir, name), old, old);
    }
    linkSync(join(dir, '.lock.stale-linked'), join(dir, 'still-referenced'));
    await acquire(join(dir, '.lock'), lease => {
      assert.equal(lease.stillHeld(), true);
      assert.equal(existsSync(join(dir, '.lock.stale-dead')), false, 'old dead-holder archive must be collected');
      assert.equal(existsSync(join(dir, '.lock.stale-2026-10-14T23:00:00.000Z')), false,
        'historical archive suffixes may contain punctuation');
      for (const name of Object.keys(files).slice(2)) assert.ok(existsSync(join(dir, name)), name);
      assert.ok(existsSync(join(dir, '.lock')), 'active fence remains held');
    });
    assert.equal(existsSync(join(dir, '.lock')), false);
  });
}

function sendFixture(t) {
  const root = rootFor(t);
  const store = createLocalStore({ root });
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const signer = { instance: 'codex:sender:111111111111', privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() };
  const recipient = 'claude:recipient:222222222222';
  for (const instance of [signer.instance, recipient]) store.registerInstance({ id: instance, instance,
    roles: ['AGENTS'], scopes: [], capabilities: [], endpoints: [], acceptedPolicies: [],
    publicKeys: [publicKey.export({ type: 'spki', format: 'pem' }).toString()], createdAt: new Date().toISOString() });
  return { root, store, signer, recipient };
}

test('h2a_send reports typed recipient_not_live for a registered peer without fresh presence', async t => {
  const f = sendFixture(t);
  for (const backend of ['local', 'cluster-mesh']) {
    let called = false;
    const result = await handleSend(f.store, f.signer, { to: f.recipient, message: 'hello', backend },
      { clusterMesh: { instance: f.signer.instance, send: () => { called = true; return new Promise(() => {}); } } });
    assert.equal(result.code, 'recipient_not_live');
    assert.equal(result.retryable, true);
    assert.equal(called, false);
    assert.deepEqual(f.store.readInbox(f.recipient), []);
  }
});

test('h2a_send bounds an unresponsive mesh backend with typed send_timeout', { timeout: 2000 }, async t => {
  const f = sendFixture(t);
  writePresence(f.root, session(f.recipient));
  const result = await Promise.race([
    handleSend(f.store, f.signer, { to: f.recipient, message: 'hello', backend: 'cluster-mesh' },
      { timeoutMs: 30, clusterMesh: { instance: f.signer.instance, send: () => new Promise(() => {}) } }),
    delay(500).then(() => ({ code: 'test_deadline_exceeded' }))
  ]);
  assert.equal(result.code, 'send_timeout');
  assert.equal(result.retryable, true);
});

test('h2a_send deadline also covers a stalled deployment module import', { timeout: 2000 }, async t => {
  const f = sendFixture(t);
  writePresence(f.root, session(f.recipient));
  const module = join(f.root, 'slow-mesh.mjs');
  writeFileSync(module, 'await new Promise(resolve => setTimeout(resolve, 150)); throw new Error("late module");');
  const previous = process.env.H2A_CLUSTER_MESH_MODULE;
  process.env.H2A_CLUSTER_MESH_MODULE = module;
  try {
    const result = await handleSend(f.store, f.signer, { to: f.recipient, message: 'hello', backend: 'cluster-mesh' },
      { timeoutMs: 30 });
    assert.equal(result.code, 'send_timeout');
  } finally {
    if (previous === undefined) delete process.env.H2A_CLUSTER_MESH_MODULE;
    else process.env.H2A_CLUSTER_MESH_MODULE = previous;
    // Let the owned module finish; its late rejection must stay handled.
    await delay(180);
  }
});
