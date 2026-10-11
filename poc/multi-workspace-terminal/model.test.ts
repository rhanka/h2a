import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { aggregateStatus, classifyStatus, sessionId, inputActions, InputDecoder } from './model.ts';
import { isolatedEnv, readSandbox, stopChild } from './sandbox.ts';

test('should derive question, idle, running and exited with explicit priority', () => {
  assert.equal(classifyStatus('running', 'Proceed? [y/n]', 0, 100), 'waiting-for-input-question');
  assert.equal(classifyStatus('running', 'answer accepted', 0, 1600), 'idle');
  assert.equal(classifyStatus('running', 'counter 2', 100, 200), 'running');
  assert.equal(classifyStatus('exited', 'Proceed? [y/n]', 0, 200), 'exited');
  assert.equal(aggregateStatus(['idle', 'running', 'waiting-for-input-question']), 'waiting-for-input-question');
  assert.equal(aggregateStatus(['exited', 'idle']), 'idle');
});

test('should distinguish identical session names across workspaces', () => {
  assert.equal(sessionId('/tmp/a', 'counter'), sessionId('/tmp/a', 'counter'));
  assert.notEqual(sessionId('/tmp/a', 'counter'), sessionId('/tmp/b', 'counter'));
});

test('should consume only shortcuts and preserve pasted input around them', () => {
  assert.deepEqual(inputActions('abc\x17\x0en\r'), [
    { kind: 'input', data: 'abc' }, { kind: 'workspace', delta: 1 },
    { kind: 'session', delta: 1 }, { kind: 'input', data: 'n\r' },
  ]);
});

test('should forward UTF-8 characters split across input events without corruption', () => {
  const decoder = new InputDecoder();
  const bytes = Buffer.from('é中');
  const received = [bytes.subarray(0, 1), bytes.subarray(1, 3), bytes.subarray(3)].map(chunk => decoder.write(chunk)).join('');
  assert.equal(received, 'é中');
});

test('should refuse arbitrary endpoints and symlink escapes before connection', async () => {
  const root = await mkdtemp(join(tmpdir(), 'h2a-mwt-'));
  const outside = await mkdtemp(join(tmpdir(), 'h2a-other-'));
  try {
    await mkdir(join(root, 'runtime'));
    const descriptor = join(root, 'sandbox.json');
    await writeFile(descriptor, JSON.stringify({ root, socket: join(root, 'runtime', 'host.sock'),
      focusSocket: join(root, 'runtime', 'focus.sock'), hostPid: 123, generation: 'isolated', token: 'token' }));
    await symlink(join(outside, 'socket'), join(root, 'runtime', 'focus.sock'));
    await assert.rejects(readSandbox(descriptor), /sandbox.*(socket|endpoint)/);
    await assert.rejects(readSandbox(join(outside, 'sandbox.json')), /sandbox/);
    await symlink(outside, join(root, 'escape'));
    await assert.rejects(readSandbox(join(root, 'escape', 'sandbox.json')), /sandbox/);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test('should finish cleanup when a child failed to spawn and has no PID', async () => {
  const root = await mkdtemp(join(tmpdir(), 'h2a-mwt-'));
  try {
    const child = spawn(join(root, 'missing-executable'), [], { env: isolatedEnv(root) });
    child.on('error', () => {});
    await new Promise<void>(resolve => child.once('close', () => resolve()));
    const result = await Promise.race([stopChild(child).then(() => 'closed'), new Promise(resolve => setTimeout(() => resolve('hung'), 100))]);
    assert.equal(result, 'closed');
  } finally { await rm(root, { recursive: true, force: true }); }
});
