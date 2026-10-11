import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { lab, rpc, until, read, identity } from './lab.mjs';

test('should reexec with the unmodified source guardian and still confine real owner death', async t => {
  const l = lab(); t.after(() => l.cleanup()); l.launch('activate.mjs');
  const socket = path.join(l.root, 'owner.sock');
  await until(() => fs.existsSync(path.join(l.root, 'ready.json')));
  await rpc(socket, { op: 'create', mode: 'resistant', safe: false });
  await until(() => fs.existsSync(path.join(l.root, 'identity-0.json')));
  await l.rememberGuardians();
  const birth = read(path.join(l.root, 'identity-0.json'));
  for (let generation = 1; generation <= 5; generation++) {
    await rpc(socket, { op: 'exec' });
    await until(async () => {
      try { const s = await rpc(socket, { op: 'status' }); return s.generation === generation && s.build.startsWith(`N${generation % 2}:`); }
      catch { return false; }
    });
    assert.equal(identity(birth.cli.pid).start, birth.cli.start);
    assert.equal(identity(birth.guardian.pid).start, birth.guardian.start);
    assert.deepEqual(read(path.join(l.root, 'identity-0.json')).signals, []);
  }
  await rpc(socket, { op: 'die' });
  await until(() => [birth.cli, birth.guardian].every(b => {
    try { return identity(b.pid).state === 'Z'; } catch { return true; }
  }));
  t.diagnostic(JSON.stringify({ node: process.version, exactGuardian: true, transitions: 5,
    birth, survivedExec: true, confinedAfterOwnerDeath: true }));
});
