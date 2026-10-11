import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { lab, rpc, until, read } from './lab.mjs';

test('should prevent every foreign PTY master and listener reaching a CLI', async t => {
  const l = lab(); t.after(() => l.cleanup()); l.launch('activate.mjs');
  const socket = path.join(l.root, 'owner.sock');
  await until(() => fs.existsSync(path.join(l.root, 'ready.json')));
  const safe = process.env.SPIKE_HYGIENE !== '0';
  await rpc(socket, { op: 'create', mode: 'silent', safe });
  await rpc(socket, { op: 'create', mode: 'silent', safe });
  await until(() => fs.existsSync(path.join(l.root, 'identity-1.json')));
  await l.rememberGuardians();
  const info = read(path.join(l.root, 'identity-1.json'));
  const leaked = info.fds.filter(f => /ptmx|socket:/.test(f.target));
  t.diagnostic(JSON.stringify({ safe, node: process.version, inheritedFDs: info.fds, leaked }));
  assert.deepEqual(leaked, []);
  const status = await rpc(socket, { op: 'status' });
  for (const session of status.sessions) {
    const fd = status.fd.find(f => f.fd === session.fd);
    assert.equal(fd.flags & 0o2000000, 0, 'master must survive exec');
  }
});
