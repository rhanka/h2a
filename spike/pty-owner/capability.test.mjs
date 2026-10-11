import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { lab, rpc, until } from './lab.mjs';

test('should explicitly refuse unsupported Node exec without attempting or replacing the owner', async t => {
  assert.equal(typeof process.execve, 'undefined', 'this witness file must run on an unsupported runtime');
  const l = lab(); t.after(() => l.cleanup()); l.launch('activate.mjs');
  const socket = path.join(l.root, 'owner.sock');
  await until(() => fs.existsSync(path.join(l.root, 'ready.json')));
  await rpc(socket, { op: 'create', mode: 'silent' });
  await until(() => fs.existsSync(path.join(l.root, 'identity-0.json')));
  await l.rememberGuardians();
  const before = await rpc(socket, { op: 'status' });
  const result = await rpc(socket, { op: 'exec' });
  assert.deepEqual(result, { ok: false, reason: 'execve-unavailable', attempted: false });
  const after = await rpc(socket, { op: 'status' });
  assert.equal(after.owner.start, before.owner.start); assert.equal(after.generation, 0);
  t.diagnostic(JSON.stringify({ node: process.version, result, owner: after.owner }));
});
