import nodeTest from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { fixture, json } from './helpers/mh-l3-network.js';

const test = (name, fn) => { if (!process.env.MH_L5_CASE || process.env.MH_L5_CASE === name) nodeTest(name, fn); };
const flush = async () => { for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve)); };

async function controlledShim(t) {
  let tick, stream, posts = 0, ensures = 0;
  const interval = globalThis.setInterval;
  const timer = t.mock.method(globalThis, 'setInterval', (fn, ms, ...args) => {
    if (ms === 1000) { tick = fn; return interval(() => {}, 60_000); }
    return interval(fn, ms, ...args);
  });
  let f;
  try {
    f = await fixture(async request => {
      if (request.method === 'DELETE') return new Response(null, { status: 204 });
      if (new URL(request.url).pathname.startsWith('/_h2a-central/lease/')) return json({ state: 'identity_disabled' });
      if (request.method === 'GET') return new Response(new ReadableStream({ start(controller) { stream = controller; } }),
        { headers: { 'content-type': 'text/event-stream' } });
      posts++;
      const body = await request.json();
      if (body.method === 'initialize') return json({ jsonrpc: '2.0', id: body.id, result: { protocolVersion: '2025-06-18' } }, 'session');
      if (body.id !== undefined) return json({ jsonrpc: '2.0', id: body.id, result: {} });
      return new Response(null, { status: 202 });
    }, () => ({ ensure: async () => { ensures++; } }));
  } finally { timer.mock.restore(); }
  const path = join(f.dir, 'run/h2a-mcp-central/marker.json'), publication = fs.readFileSync(path);
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  t.mock.method(Math, 'random', () => 1);
  const call = async id => {
    f.send({ id, method: 'tools/call', params: { name: 'h2a_discover_instances', arguments: {} } });
    return f.wait(frame => frame.id === id);
  };
  const legacy = (sameGeneration = false) => {
    const marker = JSON.parse(publication);
    delete marker.schemaVersion; marker.protocol = 1;
    if (!sameGeneration) marker.generation = 'legacy-replacement';
    fs.writeFileSync(path + '.next', JSON.stringify(marker), { mode: 0o600 });
    fs.renameSync(path + '.next', path);
  };
  return { ...f, path, publication, call, legacy, tick: () => tick(), advance: ms => { now += ms; },
    disconnect: () => stream.error(new Error('fixture transport loss')),
    counts: () => ({ posts, ensures }),
    async initialize() {
      f.send({ id: 'init', method: 'initialize', params: { protocolVersion: '2025-06-18' } });
      assert.ok((await f.wait(frame => frame.id === 'init')).result);
      assert.ok((await call('healthy')).result);
      await flush(); assert.ok(stream);
    } };
}

const assertLegacy = response => {
  assert.equal(response.error?.data.code, 'legacy_requires_cold_upgrade');
  assert.equal(response.error.message, 'legacy_requires_cold_upgrade');
};

for (const sameGeneration of [false, true]) test(`T9 should classify a cold v1 replacement during the first supervision backoff (same generation: ${sameGeneration})`, async t => {
  const f = await controlledShim(t);
  try {
    await f.initialize();
    const before = f.counts();
    f.legacy(sameGeneration); f.tick(); await flush();
    assertLegacy(await f.call('first-backoff'));
    assert.deepEqual(f.counts(), before, 'neither the old owner nor v1 may receive a tool call or autostart');
  } finally { t.mock.restoreAll(); await f.close(); }
});

test('T9 should classify v1 immediately when transport loss starts recovery before supervision', async t => {
  const f = await controlledShim(t);
  try {
    await f.initialize();
    const before = f.counts();
    f.legacy(); f.disconnect(); await flush();
    assertLegacy(await f.call('loss-backoff'));
    assert.deepEqual(f.counts(), before);
  } finally { t.mock.restoreAll(); await f.close(); }
});

test('T9 should retain the legacy diagnosis through missing or malformed marker retries and clear it only after v2 reconnects', async t => {
  const f = await controlledShim(t);
  try {
    f.legacy();
    f.send({ id: 'init', method: 'initialize', params: { protocolVersion: '2025-06-18' } });
    await f.wait(frame => frame.id === 'init');
    assertLegacy(await f.call('legacy'));
    fs.unlinkSync(f.path); f.advance(1001);
    assertLegacy(await f.call('missing-marker'));
    assertLegacy(await f.call('missing-backoff'));
    fs.writeFileSync(f.path, '{partial', { mode: 0o600 }); f.advance(2001);
    assertLegacy(await f.call('malformed-marker'));
    assertLegacy(await f.call('malformed-backoff'));
    assert.equal(f.counts().posts, 0, 'no attach or business call is sent to v1');
    assert.equal(f.counts().ensures, 1, 'only ENOENT may consult the bounded ensure hook');
    fs.writeFileSync(f.path, f.publication, { mode: 0o600 }); f.advance(4001);
    assert.ok((await f.call('reconnected')).result);
    await flush();
    fs.unlinkSync(f.path); f.disconnect(); await flush();
    const after = await f.call('new-loss');
    assert.equal(after.error.data.code, 'central_unavailable');
    assert.equal(after.error.message, 'central_unavailable');
  } finally { t.mock.restoreAll(); await f.close(); }
});
