import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { lab, rpc, until, read, identity, sleep } from './lab.mjs';

test('should keep real guarded PTYs, distinct births and I/O in the private lab', async t => {
  const l = lab(); t.after(() => l.cleanup()); l.launch('activate.mjs');
  const socket = path.join(l.root, 'owner.sock');
  await until(() => fs.existsSync(path.join(l.root, 'ready.json')));
  for (const mode of ['silent', 'tui', 'flood', 'exit']) {
    const created = await rpc(socket, { op: 'create', mode, safe: false });
    assert.equal(created.id, ['silent', 'tui', 'flood', 'exit'].indexOf(mode));
  }
  await until(() => fs.existsSync(path.join(l.root, 'identity-3.json')));
  await l.rememberGuardians();
  const status = await rpc(socket, { op: 'status' });
  const identities = status.sessions.map(s => read(path.join(l.root, `identity-${s.id}.json`)));
  for (const info of identities) {
    assert.notEqual(info.guardian.pid, info.cli.pid);
    assert.equal(info.cli.ppid, info.guardian.pid);
    assert.equal(info.guardian.ppid, status.owner.pid);
    assert.equal(info.cli.pgid, info.guardian.pid);
    assert.equal(info.cli.sid, info.guardian.pid);
    assert.equal(info.cli.tty, info.guardian.tty);
    assert.equal(identity(info.cli.pid).start, info.cli.start);
  }
  const lease = await rpc(socket, { op: 'acquire', id: 3, client: 'reference' });
  await rpc(socket, { op: 'write', id: 3, client: 'reference', epoch: lease.epoch, data: 'ACK:baseline\n' });
  await sleep(30);
  const output = await rpc(socket, { op: 'read', id: 3 });
  assert.match(Buffer.concat(output.chunks.map(c => Buffer.from(c.data, 'base64'))).toString(), /ACK:baseline/);
  await rpc(socket, { op: 'write', id: 3, client: 'reference', epoch: lease.epoch, data: 'EXIT:7\n' });
  const ended = await until(async () => (await rpc(socket, { op: 'read', id: 3 })).exit);
  assert.equal(ended.exitCode, 7); assert.equal(ended.signal, 0);
  t.diagnostic(JSON.stringify({ command: 'node --test spike/pty-owner/reference.test.mjs',
    node: process.version, status, identities, ended, childLog: l.log() }));
});
