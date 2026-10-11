import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { lab, rpc, until, identity } from './lab.mjs';

async function setup(t) {
  const l = lab(); t.after(() => l.cleanup()); l.launch('activate.mjs');
  const socket = path.join(l.root, 'owner.sock');
  await until(() => fs.existsSync(path.join(l.root, 'ready.json')));
  await rpc(socket, { op: 'create', mode: 'exit' });
  await until(() => fs.existsSync(path.join(l.root, 'identity-0.json')));
  await l.rememberGuardians();
  const lease = await rpc(socket, { op: 'acquire', id: 0, client: 'exit-test' });
  const write = data => rpc(socket, { op: 'write', id: 0, client: 'exit-test', epoch: lease.epoch, data });
  return { l, socket, write };
}
for (const boundary of ['before', 'during', 'after']) for (const code of [0, 7, 143]) {
  test(`should report exact guardian exit ${code} ${boundary} exec`, async t => {
    const { l, socket, write } = await setup(t);
    if (boundary === 'before') {
      await write(code === 143 ? 'SIGNAL:SIGTERM\n' : `EXIT:${code}\n`);
      await until(async () => (await rpc(socket, { op: 'read', id: 0 })).exit);
    } else if (boundary === 'during') await write(`AFTER:160:${code}\n`);
    assert.equal((await rpc(socket, { op: 'exec' })).ok, true);
    await until(async () => {
      try { return (await rpc(socket, { op: 'status' })).build.startsWith('N1:'); } catch { return false; }
    });
    if (boundary === 'after') {
      const lease = await rpc(socket, { op: 'acquire', id: 0, client: 'new-exit' });
      await rpc(socket, { op: 'write', id: 0, client: 'new-exit', epoch: lease.epoch,
        data: code === 143 ? 'SIGNAL:SIGTERM\n' : `EXIT:${code}\n` });
    }
    const exit = await until(async () => (await rpc(socket, { op: 'read', id: 0 })).exit);
    const status = await rpc(socket, { op: 'status' });
    let guardian; try { guardian = identity(status.sessions[0].pid); } catch { guardian = 'reaped'; }
    t.diagnostic(JSON.stringify({ node: process.version, boundary, expected: code, exit, guardian, log: l.log() }));
    assert.equal(exit.exitCode, code); assert.equal(exit.signal, 0);
    assert.deepEqual((await rpc(socket, { op: 'read', id: 0 })).exit, exit);
  });
}
test('should expose the result lost between native waitpid and its JS callback', async t => {
  const { l, socket } = await setup(t);
  await rpc(socket, { op: 'exit-race', id: 0 }).catch(() => {});
  await until(async () => {
    try { return (await rpc(socket, { op: 'status' })).build.startsWith('N1:'); } catch { return false; }
  });
  const exit = await until(async () => (await rpc(socket, { op: 'read', id: 0 })).exit);
  t.diagnostic(JSON.stringify({ node: process.version, requiredCriterion: 'exact-exit-at-all-boundaries', exit, log: l.log() }));
  if (process.env.SPIKE_REQUIRE_EXITS === '1') assert.equal(exit.unknown, false, 'full C contract loses exit 7');
  else assert.equal(exit.unknown, true, 'negative control must reproduce lost callback');
});
test('should retain the exact SIGKILL guardian result after adoption', async t => {
  const { socket } = await setup(t);
  await rpc(socket, { op: 'exec' });
  await until(async () => { try { return (await rpc(socket, { op: 'status' })).build.startsWith('N1:'); } catch { return false; } });
  await rpc(socket, { op: 'signal-guardian', id: 0 });
  const exit = await until(async () => (await rpc(socket, { op: 'read', id: 0 })).exit);
  t.diagnostic(JSON.stringify({ node: process.version, exit }));
  assert.equal(exit.signal, 9); assert.equal(exit.exitCode, 0);
});
