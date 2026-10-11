import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { lab, rpc, until, read, identity, sleep } from './lab.mjs';

async function setup(t) {
  const l = lab(); t.after(() => l.cleanup()); l.launch('activate.mjs');
  const socket = path.join(l.root, 'owner.sock');
  await until(() => fs.existsSync(path.join(l.root, 'ready.json')));
  for (const mode of ['tui', 'resistant', 'grandchild']) await rpc(socket, { op: 'create', mode });
  await until(() => fs.existsSync(path.join(l.root, 'identity-100002.json')));
  await l.rememberGuardians();
  const births = [0, 1, 2, 100002].map(id => read(path.join(l.root, `identity-${id}.json`)));
  return { l, socket, births };
}
for (const fault of ['die', 'close-master', 'adoption', 'abort']) {
  test(`should confine its own fixture tree when ${fault} destroys ownership`, async t => {
    const { l, socket, births } = await setup(t);
    if (fault === 'die') await rpc(socket, { op: 'die' });
    else if (fault === 'close-master') {
      for (let id = 0; id < 3; id++) await rpc(socket, { op: 'close-master', id });
    } else assert.equal((await rpc(socket, { op: 'exec', fault })).ok, true);
    const alive = before => {
      try { const current = identity(before.pid); return current.start === before.start && current.state !== 'Z'; }
      catch { return false; }
    };
    await until(() => births.every(b => !alive(b.cli) && !alive(b.guardian)));
    t.diagnostic(JSON.stringify({ node: process.version, fault, births, allDead: true, log: l.log() }));
  });
}
test('should return to the previous image after a controlled adoption fault without losing PTYs', async t => {
  const { l, socket, births } = await setup(t);
  assert.equal((await rpc(socket, { op: 'exec', fault: 'rollback' })).ok, true);
  const status = await until(async () => {
    try { const s = await rpc(socket, { op: 'status' }); return s.rollback && s.build.startsWith('N0:') && s; }
    catch { return false; }
  });
  for (const born of births) {
    assert.equal(identity(born.cli.pid).start, born.cli.start); assert.notEqual(identity(born.cli.pid).state, 'Z');
  }
  t.diagnostic(JSON.stringify({ node: process.version, rollback: true, status, log: l.log() }));
});
test('should reject invalid preflights and restore a partially written command once', async t => {
  const { l, socket } = await setup(t);
  for (const fault of ['candidate', 'checkpoint', 'fd']) {
    const refused = await rpc(socket, { op: 'exec', fault });
    assert.equal(refused.ok, false); assert.equal(refused.attempted, false);
    assert.equal((await rpc(socket, { op: 'status' })).build, 'N0:original-image');
    t.diagnostic(JSON.stringify({ node: process.version, fault, refused }));
  }
  const lease = await rpc(socket, { op: 'acquire', id: 0, client: 'partial' });
  await rpc(socket, { op: 'write', id: 0, client: 'partial', epoch: lease.epoch,
    data: 'ACK:partially-written\n', limit: 1, hold: true });
  assert.equal((await rpc(socket, { op: 'status' })).sessions[0].offset, 1);
  await rpc(socket, { op: 'exec' });
  await until(async () => { try { return (await rpc(socket, { op: 'status' })).build.startsWith('N1:'); } catch { return false; } });
  await sleep(30);
  const output = await rpc(socket, { op: 'read', id: 0 });
  const text = Buffer.concat(output.chunks.map(c => Buffer.from(c.data, 'base64'))).toString();
  assert.equal((text.match(/ACK:partially-written/g) ?? []).length, 1);
  const fresh = await rpc(socket, { op: 'acquire', id: 0, client: 'uncertain' });
  await assert.rejects(rpc(socket, { op: 'write', id: 0, client: 'uncertain', epoch: fresh.epoch,
    data: 'ACK:uncertain\n', dropResponse: true }));
  await sleep(30);
  const after = await rpc(socket, { op: 'read', id: 0 });
  const uncertain = Buffer.concat(after.chunks.map(c => Buffer.from(c.data, 'base64'))).toString();
  assert.equal((uncertain.match(/ACK:uncertain/g) ?? []).length, 1);
  t.diagnostic(JSON.stringify({ node: process.version, partialOffset: 1, partialAck: 1,
    uncertainAck: 1, uncertainReplayed: false, log: l.log() }));
});
