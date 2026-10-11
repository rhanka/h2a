import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { lab, rpc, until, sleep, read } from './lab.mjs';

test('should read a blocked flood with no frontend and explicitly declare bounded replay gaps', async t => {
  const l = lab(); t.after(() => l.cleanup()); l.env.SPIKE_CAPACITY = '4096';
  l.launch('activate.mjs'); const socket = path.join(l.root, 'owner.sock');
  await until(() => fs.existsSync(path.join(l.root, 'ready.json')));
  await rpc(socket, { op: 'create', mode: 'flood' });
  await until(() => fs.existsSync(path.join(l.root, 'identity-0.json')));
  await l.rememberGuardians(); await sleep(150);
  const first = await rpc(socket, { op: 'read', id: 0 });
  await sleep(150);
  const second = await rpc(socket, { op: 'read', id: 0 });
  assert.ok(second.next > first.next); assert.equal(second.gap, true);
  const state = await rpc(socket, { op: 'status' });
  assert.ok(state.sessions[0].byteCount <= 4096 + 65536);
  assert.deepEqual(read(path.join(l.root, 'identity-0.json')).signals, []);
  t.diagnostic(JSON.stringify({ node: process.version, firstSeq: first.next, nextSeq: second.next,
    gap: second.gap, retainedBytes: state.sessions[0].byteCount, capacity: 4096, frontend: false }));
});
test('should demonstrate Node refuses a PTY master as a transferable net handle', async t => {
  const l = lab(); t.after(() => l.cleanup()); l.launch('activate.mjs');
  const socket = path.join(l.root, 'owner.sock');
  await until(() => fs.existsSync(path.join(l.root, 'ready.json')));
  const created = await rpc(socket, { op: 'create', mode: 'silent' });
  await until(() => fs.existsSync(path.join(l.root, 'identity-0.json')));
  await l.rememberGuardians();
  const result = await rpc(socket, { op: 'tty-transfer', id: created.id });
  assert.equal(result.code, 'ERR_INVALID_FD_TYPE');
  t.diagnostic(JSON.stringify({ node: process.version, result }));
});
