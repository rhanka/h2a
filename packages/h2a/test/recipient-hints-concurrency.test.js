import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fork } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { listRecipientHints, rememberRecipient } from '../dist/runtime/local-files/recipient-hints.js';
import { SessionRegistry } from '../dist/runtime/mcp/sessions.js';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function setup(t, count) {
  const root = fs.mkdtempSync(join(tmpdir(), 'h2a-hint-concurrency-'));
  const dir = join(root, 'recipient-hints');
  fs.mkdirSync(dir);
  for (let i = 0; i < count; i++) {
    fs.writeFileSync(join(dir, i.toString(16).padStart(64, '0') + '.json'),
      JSON.stringify({ instance: `claude:legacy:${i}`, name: `legacy-${i}` }) + '\n');
  }
  const workers = [];
  t.after(async () => {
    for (const worker of workers) {
      if (worker.proc.exitCode === null && worker.proc.signalCode === null) worker.proc.kill('SIGTERM');
    }
    await Promise.all(workers.map(worker => worker.exited));
    fs.rmSync(root, { recursive: true, force: true });
  });
  function start(id, mode = 'snapshot') {
    const proc = fork(new URL('./helpers/recipient-hints-writer.mjs', import.meta.url), [root, id, mode],
      { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    const worker = { proc, diagnostics: '', exited: new Promise((resolve, reject) => {
      proc.once('error', reject);
      proc.once('exit', (code, signal) => resolve({ code, signal }));
    }) };
    proc.stdout.on('data', chunk => { worker.diagnostics += chunk; });
    proc.stderr.on('data', chunk => { worker.diagnostics += chunk; });
    workers.push(worker);
    return worker;
  }
  async function ready(ids) {
    const deadline = Date.now() + 5000;
    while (!ids.every(id => fs.existsSync(join(root, `ready-${id}`)))) {
      assert.ok(workers.every(worker => worker.proc.exitCode === null && worker.proc.signalCode === null),
        workers.map(worker => worker.diagnostics).join('\n'));
      assert.ok(Date.now() < deadline, 'all real writers must reach their gate');
      await delay(5);
    }
  }
  return { root, dir, start, ready, release: () => fs.writeFileSync(join(root, 'release'), 'go') };
}

test('three real writers sharing a 1023-entry snapshot cannot exceed the storage cap', { timeout: 8000 }, async t => {
  const { root, dir, start, ready, release } = setup(t, 1023);
  const ids = ['a', 'b', 'c'];
  const workers = ids.map(id => start(id));
  await ready(ids);
  assert.equal(fs.readdirSync(dir).length, 1023, 'all writers are paused before admission');
  release();
  for (const worker of workers) {
    assert.deepEqual(await worker.exited, { code: 0, signal: null }, worker.diagnostics);
  }
  assert.equal(fs.readdirSync(dir).length, 1024, 'exactly one last place is reserved atomically');
  const hints = listRecipientHints(root);
  assert.equal(hints.length, 1024);
  assert.equal(hints.filter(hint => hint.name.startsWith('parallel-')).length, 1);
  assert.equal(hints.filter(hint => hint.name.startsWith('legacy-')).length, 1023);
  const sessions = new SessionRegistry(root, { autoHeartbeat: false });
  try {
    const session = sessions.open({ instance: 'claude:at-capacity:111111111111', name: 'at-capacity' });
    sessions.touch(session.sessionId);
    sessions.close(session.sessionId);
    assert.equal(fs.readdirSync(dir).length, 1024, 'session lifecycle cannot exceed the same quota');
    assert.deepEqual(sessions.list(), []);
  } finally { sessions.closeAll(); }
});

test('an interrupted writer consumes at most one place and does not lock out later writers', { timeout: 8000 }, async t => {
  const { root, dir, start, ready } = setup(t, 0);
  const worker = start('interrupted', 'publication');
  await ready(['interrupted']);
  assert.deepEqual(listRecipientHints(root), [], 'unpublished bytes are never diagnostic evidence');
  worker.proc.kill('SIGKILL');
  assert.deepEqual(await worker.exited, { code: null, signal: 'SIGKILL' });
  rememberRecipient(root, { instance: 'claude:after-crash:111111111111', name: 'after-crash' });
  assert.deepEqual(listRecipientHints(root), [{ instance: 'claude:after-crash:111111111111', name: 'after-crash' }]);
  assert.ok(fs.readdirSync(dir).length <= 2, 'abandonment and a later publication use at most two places');
});

test('a reserved publication is invisible until complete and is not overwritten by another writer', { timeout: 8000 }, async t => {
  const { root, dir, start, ready, release } = setup(t, 1022);
  const worker = start('paused', 'publication');
  await ready(['paused']);
  assert.equal(fs.readdirSync(dir).length, 1023, 'an in-flight write already occupies its place');
  assert.equal(listRecipientHints(root).length, 1022);
  rememberRecipient(root, { instance: 'claude:other:111111111111', name: 'other' });
  assert.equal(fs.readdirSync(dir).length, 1024);
  assert.equal(listRecipientHints(root).length, 1023);
  release();
  assert.deepEqual(await worker.exited, { code: 0, signal: null }, worker.diagnostics);
  assert.equal(listRecipientHints(root).length, 1024);
  assert.equal(fs.readdirSync(dir).length, 1024);
  const before = fs.readdirSync(dir).sort();
  rememberRecipient(root, { instance: 'claude:parallel:paused', name: 'parallel-paused' });
  assert.deepEqual(fs.readdirSync(dir).sort(), before, 'unchanged hints do not consume a new place');
});

test('overlapping publications of the same recipient remain one diagnostic candidate', { timeout: 8000 }, async t => {
  const { root, start, ready, release } = setup(t, 0);
  const worker = start('same', 'publication');
  await ready(['same']);
  const hint = { instance: 'claude:parallel:same', name: 'parallel-same' };
  rememberRecipient(root, hint);
  release();
  assert.deepEqual(await worker.exited, { code: 0, signal: null }, worker.diagnostics);
  assert.deepEqual(listRecipientHints(root), [hint]);
});
