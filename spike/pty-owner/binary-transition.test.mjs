import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { lab, rpc, until, read, identity } from './lab.mjs';

test('should alternate Node22 and Node24 images with the same PTY and CLI births', async t => {
  const l = lab(); t.after(() => l.cleanup()); l.launch('activate.mjs');
  const socket = path.join(l.root, 'owner.sock');
  await until(() => fs.existsSync(path.join(l.root, 'ready.json')));
  for (let id = 0; id < 4; id++) await rpc(socket, { op: 'create' });
  await until(() => fs.existsSync(path.join(l.root, 'identity-3.json')));
  await l.rememberGuardians();
  const before = await rpc(socket, { op: 'status' });
  const births = [0, 1, 2, 3].map(id => read(path.join(l.root, `identity-${id}.json`)));
  const targets = ['/home/antoinefa/.nvm/versions/node/v24.18.0/bin/node', '/usr/bin/node'];
  const states = [];
  for (let generation = 1; generation <= 6; generation++) {
    const targetNode = targets[(generation - 1) % 2];
    assert.equal((await rpc(socket, { op: 'exec', targetNode })).ok, true);
    const state = await until(async () => {
      try { const s = await rpc(socket, { op: 'status' });
        return s.generation === generation && s.build.startsWith(`N${generation % 2}:`) && s;
      } catch { return false; }
    });
    assert.equal(state.node, generation % 2 ? 'v24.18.0' : 'v22.22.1');
    assert.equal(state.owner.start, before.owner.start); assert.equal(state.owner.pid, before.owner.pid);
    for (const born of births) {
      assert.equal(identity(born.cli.pid).start, born.cli.start);
      assert.equal(identity(born.guardian.pid).start, born.guardian.start);
    }
    const lease = await rpc(socket, { op: 'acquire', id: 0, client: 'cross-node' });
    await rpc(socket, { op: 'write', id: 0, client: 'cross-node', epoch: lease.epoch,
      data: `ACK:cross-${generation}\n` });
    await until(async () => {
      const output = await rpc(socket, { op: 'read', id: 0 });
      return Buffer.concat(output.chunks.map(c => Buffer.from(c.data, 'base64'))).toString().includes(`ACK:cross-${generation}`);
    });
    states.push({ generation, node: state.node, owner: state.owner, pauseMs: state.transitions.at(-1).pauseMs });
  }
  t.diagnostic(JSON.stringify({ startedNode: process.version, states, births }));
});
