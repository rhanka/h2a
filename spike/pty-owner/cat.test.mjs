import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { lab, rpc, until, identity } from './lab.mjs';

test('should preserve a real cat CLI birth and exchange across 10 execs', async t => {
  const l = lab(); t.after(() => l.cleanup()); l.launch('activate.mjs');
  const socket = path.join(l.root, 'owner.sock');
  await until(() => fs.existsSync(path.join(l.root, 'ready.json')));
  const session = await rpc(socket, { op: 'create', mode: 'cat' });
  // Only children of our just-spawned guardian, no per-UID or global scan.
  const childPid = await until(() => {
    const children = fs.readFileSync(`/proc/${session.pid}/task/${session.pid}/children`, 'utf8').trim();
    return children && +children.split(/\s+/)[0];
  });
  const cli = identity(childPid), guardian = identity(session.pid);
  assert.equal(cli.ppid, guardian.pid); assert.equal(cli.pgid, guardian.pid);
  for (let generation = 1; generation <= 10; generation++) {
    await rpc(socket, { op: 'exec' });
    await until(async () => {
      try { const s = await rpc(socket, { op: 'status' }); return s.generation === generation && s.build.startsWith(`N${generation % 2}:`); }
      catch { return false; }
    });
    assert.equal(identity(cli.pid).start, cli.start); assert.equal(identity(guardian.pid).start, guardian.start);
    const lease = await rpc(socket, { op: 'acquire', id: 0, client: 'cat-test' });
    await rpc(socket, { op: 'write', id: 0, client: 'cat-test', epoch: lease.epoch, data: `cat-round-${generation}\n` });
    await until(async () => {
      const output = await rpc(socket, { op: 'read', id: 0 });
      const text = Buffer.concat(output.chunks.map(c => Buffer.from(c.data, 'base64'))).toString();
      return (text.match(new RegExp(`cat-round-${generation}\\r?\\n`, 'g')) ?? []).length === 2;
    });
  }
  t.diagnostic(JSON.stringify({ node: process.version, transitions: 10, cli, guardian, echoesPerCommand: 2 }));
});
