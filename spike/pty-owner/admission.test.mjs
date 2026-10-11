import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { lab, rpc, until } from './lab.mjs';

test('should refuse lease mutations after the checkpoint is frozen', async t => {
  const l = lab(); t.after(() => l.cleanup()); l.launch('activate.mjs');
  const socket = path.join(l.root, 'owner.sock');
  await until(() => fs.existsSync(path.join(l.root, 'ready.json')));
  await rpc(socket, { op: 'create', mode: 'silent' });
  await until(() => fs.existsSync(path.join(l.root, 'identity-0.json')));
  await l.rememberGuardians();
  await rpc(socket, { op: 'exec', delay: 100 });
  const result = await rpc(socket, { op: 'acquire', id: 0, client: 'late-controller' });
  t.diagnostic(JSON.stringify({ node: process.version, result }));
  assert.equal(result.error, 'upgrade-in-progress');
  assert.equal(result.retrySafe, true);
});
