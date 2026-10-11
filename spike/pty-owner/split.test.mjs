import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { lab, rpc, until, read, identity, sleep } from './lab.mjs';

test('should preserve keeper PTYs and connect availability across 20 killed frontends', async t => {
  const l = lab(); t.after(() => l.cleanup());
  l.env.SPIKE_B = '1'; l.env.SPIKE_B_ACTIVATION = process.env.SPIKE_B_ACTIVATION ?? '1';
  l.launch('activate.mjs');
  const socket = path.join(l.root, 'owner.sock'), publicPath = path.join(l.root, 'front.sock');
  await until(() => fs.existsSync(path.join(l.root, 'ready.json')));
  for (let id = 0; id < 32; id++) await rpc(socket, { op: 'create' });
  await until(() => fs.existsSync(path.join(l.root, 'identity-31.json')));
  await l.rememberGuardians();
  let front = await rpc(socket, { op: 'front-start' });
  await until(() => fs.existsSync(path.join(l.root, `front-ready-${front.generation}.json`)));
  const start = await rpc(socket, { op: 'status' });
  const births = Array.from({ length: 32 }, (_, id) => read(path.join(l.root, `identity-${id}.json`)));
  const publicLease = await rpc(publicPath, { op: 'acquire', id: 0, client: 'old-front' });
  const errors = {}, pending = new Set(), replacements = [];
  let attempts = 0, connects = 0; const begin = performance.now();
  const hammer = setInterval(() => {
    const due = Math.max(1, Math.min(16, Math.floor(performance.now() - begin) - attempts));
    for (let n = 0; n < due; n++) {
      attempts++; const client = net.connect(publicPath); pending.add(client);
      client.on('connect', () => { connects++; client.destroy(); });
      client.on('error', e => { errors[e.code] = (errors[e.code] ?? 0) + 1; });
      client.on('close', () => pending.delete(client));
    }
  }, 1);
  t.after(() => { clearInterval(hammer); for (const client of pending) client.destroy(); });
  for (let cycle = 0; cycle < 20; cycle++) {
    const killed = await rpc(socket, { op: 'front-kill' });
    assert.equal(killed.killed.pid, front.birth.pid);
    const when = performance.now();
    front = await rpc(socket, { op: 'front-start' });
    const ready = await until(() => {
      const file = path.join(l.root, `front-ready-${front.generation}.json`);
      return fs.existsSync(file) && read(file);
    });
    const actual = await rpc(publicPath, { op: 'frontend-status' });
    assert.equal(actual.generation, front.generation);
    assert.equal(actual.fds.filter(f => /ptmx/.test(f.target)).length, 0);
    replacements.push({ generation: front.generation, birth: ready.birth,
      inode: ready.inode, pauseMs: performance.now() - when });
    const status = await rpc(publicPath, { op: 'status' });
    assert.equal(status.owner.start, start.owner.start); assert.equal(status.owner.pid, start.owner.pid);
    for (const birth of births) for (const before of [birth.cli, birth.guardian]) {
      const current = identity(before.pid); assert.equal(current.start, before.start); assert.notEqual(current.state, 'Z');
    }
  }
  clearInterval(hammer); const hammerMs = performance.now() - begin; await sleep(50);
  const outputs = [];
  for (let id = 0; id < 32; id++) {
    const lease = id === 0 ? publicLease : await rpc(publicPath, { op: 'acquire', id, client: 'old-front' });
    // In this minimal prototype lease is tied to client identity, not transport.
    await rpc(publicPath, { op: 'write', id, client: 'old-front', epoch: lease.epoch, data: `ACK:split-${id}\nFINAL\n` });
    const text = await until(async () => {
      const result = await rpc(publicPath, { op: 'read', id }); assert.equal(result.gap, false);
      const text = Buffer.concat(result.chunks.map(c => Buffer.from(c.data, 'base64'))).toString();
      return text.includes(`FINAL:${id}:`) && text;
    });
    const numbers = [...text.matchAll(new RegExp(`COUNT:${id}:(\\d+):é🙂\\x1b\\[0m`, 'g'))].map(m => +m[1]);
    const total = +text.match(new RegExp(`FINAL:${id}:(\\d+)`))[1];
    assert.deepEqual(numbers, Array.from({ length: total }, (_, n) => n));
    assert.equal((text.match(new RegExp(`ACK:split-${id}`, 'g')) ?? []).length, 1);
    assert.deepEqual(read(path.join(l.root, `identity-${id}.json`)).signals, []);
    outputs.push({ id, counters: total });
  }
  const end = await rpc(socket, { op: 'status' });
  const pauses = replacements.map(r => r.pauseMs).sort((a, b) => a - b);
  const metrics = { node: process.version, activated: l.env.SPIKE_B_ACTIVATION !== '0',
    count: 32, kills: 20, ownerBirth: start.owner, births, outputs, replacements,
    errors, attempts, connects, hammerHz: attempts * 1000 / hammerMs,
    fdDelta: end.fd.length - start.fd.length, rssRatio: end.rss / start.rss,
    p99Ms: pauses.at(-1) };
  t.diagnostic(JSON.stringify(metrics));
  assert.deepEqual(errors, {}); assert.equal(metrics.fdDelta, 0);
  assert.ok(metrics.rssRatio <= 1.25); assert.ok(metrics.p99Ms < 1000);
});
