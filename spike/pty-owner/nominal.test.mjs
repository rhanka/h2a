import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { lab, rpc, until, read, identity, sleep } from './lab.mjs';

for (const [count, cycles] of process.env.SPIKE_PROBE ? [[4, 2]] : [[32, 20], [4, 100]]) {
  test(`should preserve ${count} PTYs across ${cycles} in-place image replacements`, async t => {
    const l = lab(); t.after(() => l.cleanup()); l.launch('activate.mjs');
    const socket = path.join(l.root, 'owner.sock');
    await until(() => fs.existsSync(path.join(l.root, 'ready.json')));
    for (let id = 0; id < count; id++) await rpc(socket, { op: 'create' });
    await until(() => fs.existsSync(path.join(l.root, `identity-${count - 1}.json`)));
    await l.rememberGuardians(); await sleep(100);
    const births = Array.from({ length: count }, (_, id) => read(path.join(l.root, `identity-${id}.json`)));
    const start = await rpc(socket, { op: 'status' });
    const lease = await rpc(socket, { op: 'acquire', id: 0, client: 'old' });
    let attempts = 0, connects = 0; const errors = {}, pending = new Set();
    const started = performance.now();
    const hammer = setInterval(() => {
      const due = Math.max(1, Math.min(16, Math.floor(performance.now() - started) - attempts));
      for (let i = 0; i < due; i++) {
        attempts++; const client = net.connect(socket); pending.add(client);
        client.on('connect', () => { connects++; client.destroy(); });
        client.on('error', e => { errors[e.code] = (errors[e.code] ?? 0) + 1; });
        client.on('close', () => pending.delete(client));
      }
    }, 1);
    t.after(() => { clearInterval(hammer); for (const client of pending) client.destroy(); });
    const snapshots = [], typedRefusals = [], ensureErrors = [];
    for (let cycle = 1; cycle <= cycles; cycle++) {
      const result = await rpc(socket, { op: 'exec', delay: 30 });
      assert.equal(result.ok, true, JSON.stringify(result));
      const ensure = await rpc(socket, { op: 'ensure' }); typedRefusals.push(ensure);
      assert.equal(ensure.creationAttempted, false); assert.equal(ensure.retrySafe, true);
      const after = await until(async () => {
        try {
          const s = await rpc(socket, { op: 'status' });
          return s.generation === cycle && s.build.startsWith(`N${cycle % 2}:`) ? s : false;
        } catch (e) { ensureErrors.push(e.code ?? e.message); return false; }
      });
      assert.equal(after.owner.pid, start.owner.pid); assert.equal(after.owner.start, start.owner.start);
      for (const born of births) {
        for (const before of [born.cli, born.guardian]) {
          const current = identity(before.pid);
          assert.equal(current.start, before.start); assert.notEqual(current.state, 'Z');
          assert.equal(current.pgid, before.pgid); assert.equal(current.sid, before.sid); assert.equal(current.tty, before.tty);
        }
      }
      snapshots.push({ generation: cycle, fd: after.fd.length, rss: after.rss,
        pauseMs: after.transitions.at(-1).pauseMs, build: after.build,
        flags: after.sessions.map(s => after.fd.find(f => f.fd === s.fd)?.flags) });
      if (cycle === 1) assert.equal((await rpc(socket, { op: 'write', id: 0,
        client: 'old', epoch: lease.epoch, data: 'ACK:forbidden\n' })).error, 'stale-lease');
    }
    clearInterval(hammer); const hammerMs = performance.now() - started; await sleep(40);
    const final = await rpc(socket, { op: 'status' });
    const outputs = [];
    for (let id = 0; id < count; id++) {
      const lease = await rpc(socket, { op: 'acquire', id, client: 'new' });
      assert.equal((await rpc(socket, { op: 'acquire', id, client: 'intruder' })).error, 'controller-busy');
      await rpc(socket, { op: 'resize', id, client: 'new', epoch: lease.epoch, cols: 101, rows: 31 });
      await rpc(socket, { op: 'write', id, client: 'new', epoch: lease.epoch, data: `ACK:accepted-${id}\nSIZE\nFINAL\n` });
      const text = await until(async () => {
        const output = await rpc(socket, { op: 'read', id }); assert.equal(output.gap, false);
        const text = Buffer.concat(output.chunks.map(c => Buffer.from(c.data, 'base64'))).toString();
        return text.includes(`FINAL:${id}:`) ? text : false;
      });
      const counters = [...text.matchAll(new RegExp(`COUNT:${id}:(\\d+):é🙂\\x1b\\[0m`, 'g'))].map(m => +m[1]);
      const total = +text.match(new RegExp(`FINAL:${id}:(\\d+)`))[1];
      assert.deepEqual(counters, Array.from({ length: total }, (_, i) => i));
      assert.equal((text.match(new RegExp(`ACK:accepted-${id}`, 'g')) ?? []).length, 1);
      assert.match(text, /SIZE:101:31/); assert.doesNotMatch(text, /forbidden|�/);
      const signals = read(path.join(l.root, `identity-${id}.json`)).signals;
      assert.deepEqual(signals.filter(s => s !== 'SIGWINCH'), []);
      outputs.push({ id, counters: total, bytes: Buffer.byteLength(text), signals });
    }
    const pauses = snapshots.map(s => s.pauseMs).sort((a, b) => a - b);
    const metrics = { node: process.version, count, cycles, ownerBirth: start.owner,
      births, snapshots, outputs, attempts, connects, errors, ensureErrors,
      hammerHz: attempts * 1000 / hammerMs, typedRefusals: typedRefusals.length,
      p99Ms: pauses[Math.ceil(pauses.length * .99) - 1],
      fdDelta: final.fd.length - start.fd.length, rssRatio: final.rss / start.rss };
    t.diagnostic(JSON.stringify(metrics));
    assert.equal(metrics.fdDelta, 0); assert.ok(metrics.rssRatio <= 1.25, `RSS ratio ${metrics.rssRatio}`);
    assert.ok(metrics.p99Ms < 1000); assert.deepEqual(errors, {});
    assert.ok(connects > 0); assert.equal(ensureErrors.filter(e => ['ECONNREFUSED', 'ENOENT'].includes(e)).length, 0);
  });
}
