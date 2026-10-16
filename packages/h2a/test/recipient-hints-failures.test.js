import assert from 'node:assert/strict';
import fs from 'node:fs';
import childProcess from 'node:child_process';
import { createHash } from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { listPresence, runMcpStdio, writePresence, deletePresence } from '../dist/index.js';
import { listRecipientHints, rememberRecipient } from '../dist/runtime/local-files/recipient-hints.js';
import { SessionRegistry } from '../dist/runtime/mcp/sessions.js';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function rootFor(t) {
  const root = fs.mkdtempSync(join(tmpdir(), 'h2a-hint-failure-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
function hintFile(root, hint) {
  return join(root, 'recipient-hints', createHash('sha256').update(JSON.stringify(hint) + '\n').digest('hex') + '.json');
}
function fault(t, root, operation, code, once = false) {
  if (operation === 'readHistory') {
    const countFile = fault(t, root, 'readFileSync', code, once);
    const countFd = fault(t, root, 'readSync', code, once);
    return () => countFile() + countFd();
  }
  const original = fs[operation];
  const open = fs.openSync;
  const fds = new Set();
  let hits = 0;
  if (['writeFileSync', 'closeSync', 'readSync'].includes(operation)) {
    t.mock.method(fs, 'openSync', (path, ...args) => {
      const fd = open(path, ...args);
      if (String(path).startsWith(join(root, 'recipient-hints') + '/')) fds.add(fd);
      return fd;
    });
    if (operation !== 'closeSync') {
      const close = fs.closeSync;
      t.mock.method(fs, 'closeSync', (fd, ...args) => {
        fds.delete(fd);
        return close(fd, ...args);
      });
    }
  }
  t.mock.method(fs, operation, (path, ...args) => {
    if ((String(path) === join(root, 'recipient-hints') || String(path).startsWith(join(root, 'recipient-hints') + '/') || fds.has(path)) && (!once || hits === 0)) {
      hits++;
      // Model close errors after releasing the owned descriptor.
      if (operation === 'closeSync') { fds.delete(path); original(path, ...args); }
      throw Object.assign(new Error(`injected history ${operation} ${code}`), { code });
    }
    if (operation === 'closeSync') fds.delete(path);
    return original(path, ...args);
  });
  syncBuiltinESMExports();
  return () => hits;
}
function restore(t) { t.mock.restoreAll(); syncBuiltinESMExports(); }

for (const [operation, code, once] of [['readHistory', 'EIO', true], ['renameSync', 'EIO', true], ['writeFileSync', 'ENOSPC', false]]) {
  test(`real identity worker opens MCP and heartbeats despite history ${operation} ${code}`, { timeout: 8000 }, async t => {
    const root = rootFor(t);
    const stdin = new PassThrough(), stdout = new PassThrough(), stderr = new PassThrough();
    let frames = '', diagnostics = '';
    stdout.on('data', chunk => { frames += chunk; });
    stderr.on('data', chunk => { diagnostics += chunk; });
    const workers = [], exits = [];
    const fork = childProcess.fork;
    t.mock.method(childProcess, 'fork', (...args) => {
      const worker = fork(...args);
      workers.push(worker);
      exits.push(new Promise(resolve => worker.once('exit', resolve)));
      return worker;
    });
    syncBuiltinESMExports();
    const instance = 'claude:hint-failure:111111111111';
    if (operation === 'readHistory') {
      const hint = { instance, name: 'hint-peer' };
      fs.mkdirSync(join(root, 'recipient-hints'));
      fs.writeFileSync(hintFile(root, hint), JSON.stringify(hint) + '\n');
    }
    const hits = fault(t, root, operation, code, once);
    const running = runMcpStdio({ root, workspaceRoot: root, stdin, stdout, stderr, heartbeatIntervalMs: 20,
      identityRequest: { root, cwd: root, host: 'claude', explicitInstance: instance },
      identityActivation: { buildAutoOpen: identity => ({ instance: identity.instance, host: identity.host, name: 'hint-peer' }) } });
    let id = 0;
    async function rpc(method, params) {
      const requestId = ++id;
      stdin.write(JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params }) + '\n');
      for (let i = 0; i < 200; i++) {
        const frame = frames.split('\n').filter(Boolean).map(line => JSON.parse(line)).find(frame => frame.id === requestId);
        if (frame) return frame;
        await delay(5);
      }
      assert.fail(`MCP did not answer ${method}: ${diagnostics}`);
    }
    async function status() {
      return JSON.parse((await rpc('tools/call', { name: 'h2a_identity_status', arguments: {} })).result.content[0].text);
    }
    try {
      let state;
      for (let i = 0; i < 200; i++) {
        state = await status();
        if (state.state !== 'identity_pending') break;
        await delay(5);
      }
      assert.ok(hits() > 0, 'the history fault must really fire');
      assert.equal(state.state, 'identity_ready', JSON.stringify(state));
      const initial = listPresence(root);
      assert.equal(initial.length, 1);
      await delay(90);
      assert.equal((await status()).state, 'identity_ready');
      assert.ok(Date.parse(listPresence(root)[0].heartbeatAt) > Date.parse(initial[0].heartbeatAt), 'heartbeat advances while the fault is armed');
      assert.ok((await rpc('initialize', {})).result);
      restore(t);
      await delay(60);
      assert.deepEqual(listRecipientHints(root), [{ instance, name: 'hint-peer' }], 'later heartbeat recovers diagnostic history');
      // EOF cleanup must work under the same history fault as well.
      fault(t, root, operation, code);
      stdin.end();
      await running;
      assert.deepEqual(listPresence(root), [], 'no ghost presence after EOF');
      restore(t);
      assert.deepEqual(fs.readdirSync(join(root, 'recipient-hints')).filter(name => name.includes('.tmp-')), []);
    } finally {
      restore(t);
      stdin.end();
      await running;
      for (const worker of workers) {
        if (worker.exitCode === null && worker.signalCode === null) worker.kill('SIGTERM');
      }
      await Promise.all(exits);
    }
  });
}

for (const [operation, code] of [['openSync', 'EIO'], ['mkdirSync', 'ENOSPC'], ['writeFileSync', 'ENOSPC'], ['closeSync', 'EIO'], ['renameSync', 'EIO']]) {
  test(`session open, touch and close are independent of persistent history ${operation} ${code}`, t => {
    const root = rootFor(t);
    const sessions = new SessionRegistry(root, { autoHeartbeat: false });
    const hits = fault(t, root, operation, code);
    try {
      const session = sessions.open({ instance: 'claude:manual:111111111111', name: 'manual-peer' });
      assert.equal(sessions.list().length, 1);
      assert.equal(sessions.touch(session.sessionId).sessionId, session.sessionId);
      sessions.close(session.sessionId);
      assert.deepEqual(sessions.list(), []);
      assert.deepEqual(listPresence(root), []);
      assert.ok(hits() >= 3, 'persistent fault exercised at open, heartbeat and close');
    } finally { restore(t); sessions.closeAll(); }
    const dir = join(root, 'recipient-hints');
    if (fs.existsSync(dir)) assert.deepEqual(fs.readdirSync(dir).filter(name => name.includes('.tmp-')), []);
  });
}

test('corrupt history file cannot block publication, heartbeat or explicit deletion', t => {
  const root = rootFor(t);
  const hint = { instance: 'claude:corrupt:111111111111', name: 'corrupt-peer' };
  fs.mkdirSync(join(root, 'recipient-hints'));
  const file = hintFile(root, hint);
  fs.writeFileSync(file, '{broken json');
  assert.deepEqual(listRecipientHints(root), []);
  const sessions = new SessionRegistry(root, { autoHeartbeat: false });
  try {
    const session = sessions.open(hint);
    assert.deepEqual(listRecipientHints(root), [hint], 'malformed JSON is repaired');
    fs.rmSync(file);
    fs.mkdirSync(file); // corrupt entry with a non-file type: EISDIR on read
    assert.equal(sessions.touch(session.sessionId).sessionId, session.sessionId);
    sessions.close(session.sessionId);
    assert.deepEqual(listPresence(root), []);
    const now = new Date().toISOString();
    const legacy = { ...hint, sessionId: 'sess:legacy', pid: process.pid, startedAt: now, heartbeatAt: now,
      state: 'live', interests: { scopes: [], negotiations: [] }, subscribedTopics: [] };
    writePresence(root, legacy);
    deletePresence(root, legacy.sessionId);
    assert.deepEqual(listPresence(root), []);
  } finally { sessions.closeAll(); }
});

for (const operation of ['readdirSync/opendirSync']) {
  test(`unreadable history directory (${operation} EIO) only loses diagnostic evidence`, t => {
    const root = rootFor(t);
    rememberRecipient(root, { instance: 'claude:read:111111111111', name: 'read-peer' });
    const oldHits = fault(t, root, 'readdirSync', 'EIO');
    const newHits = fault(t, root, 'opendirSync', 'EIO');
    try {
      assert.doesNotThrow(() => listRecipientHints(root));
      assert.deepEqual(listRecipientHints(root), []);
      assert.ok(oldHits() + newHits() > 0, 'directory read fault really fired');
    } finally { restore(t); }
  });
}

test('oversized corrupt history is ignored and repaired without changing presence', t => {
  const root = rootFor(t);
  const hint = { instance: 'claude:large:111111111111', name: 'large-peer' };
  fs.mkdirSync(join(root, 'recipient-hints'));
  fs.writeFileSync(hintFile(root, hint), JSON.stringify({ ...hint, padding: 'x'.repeat(1024 * 1024) }));
  assert.deepEqual(listRecipientHints(root), [], 'history entries larger than 16 KiB are not read as evidence');
  rememberRecipient(root, hint);
  assert.deepEqual(listRecipientHints(root), [hint]);
});

test('history traversal and new hints are bounded at capacity without blocking sessions', t => {
  const root = rootFor(t);
  const dir = join(root, 'recipient-hints');
  fs.mkdirSync(dir);
  for (let i = 0; i < 1025; i++) fs.writeFileSync(join(dir, i.toString(16).padStart(64, '0') + '.json'), JSON.stringify({ instance: `claude:history:${i}` }));
  assert.ok(listRecipientHints(root).length <= 1024, 'one traversal has a finite entry budget');
  const sessions = new SessionRegistry(root, { autoHeartbeat: false });
  try {
    const opened = sessions.open({ instance: 'claude:capacity:111111111111', name: 'capacity-peer' });
    sessions.touch(opened.sessionId);
    assert.equal(fs.readdirSync(dir).length, 1025, 'no new history file at capacity');
    sessions.closeAll();
    assert.deepEqual(listPresence(root), []);
  } finally { sessions.closeAll(); }
});
