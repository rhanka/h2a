import nodeTest from 'node:test';
const test = (name, fn) => { if (!process.env.MH_L3_CASE || process.env.MH_L3_CASE === name) nodeTest(name, fn); };
import assert from 'node:assert/strict';
import { fixture, json } from './helpers/mh-l3-network.js';
import fs from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnShim } from './helpers/mh-l1-shim.js';

test('real shim should keep local initialization alive while an invalid marker still forbids connection and autostart', async () => {
  const f = await fixture(); let shim;
  try {
    const runtime = join(f.dir, 'run');
    fs.writeFileSync(join(runtime, 'h2a-mcp-central/marker.json'), '{invalid', { mode: 0o600 });
    shim = spawnShim(fileURLToPath(new URL('./helpers/mh-l3-shim.mjs', import.meta.url)),
      [fileURLToPath(new URL('../dist/runtime/mcp-central-shim.js', import.meta.url)), join(f.dir, 'store'), runtime],
      { ...process.env, H2A_ROOT: join(f.dir, 'store'), XDG_RUNTIME_DIR: runtime, CLAUDE_CODE_SESSION_ID: 'invalid-marker' }, f.dir);
    shim.send({ jsonrpc: '2.0', id: 'init', method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {} } });
    assert.equal((await shim.response('init')).result.capabilities.tools.listChanged, true);
    assert.equal(shim.child.exitCode, null);
    assert.equal(fs.readFileSync(join(runtime, 'h2a-mcp-central/marker.json'), 'utf8'), '{invalid');
    assert.deepEqual(fs.readdirSync(join(f.dir, 'store')), []);
  } finally { await shim?.close(); await f.close(); }
});

test('shim should initialize locally and retain its catalogue and stdio without any marker or identity', async () => {
  const f = await fixture();
  try {
    f.send({ id: 'init', method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: { sampling: {} } } });
    const init = await f.wait(m => m.id === 'init');
    assert.equal(init.result.capabilities.tools.listChanged, true);
    assert.equal(init.result.capabilities.sampling, undefined);
    f.send({ id: 'list', method: 'tools/list' });
    assert.ok((await f.wait(m => m.id === 'list')).result.tools.length > 0);
    assert.equal(f.frames.filter(m => m.id === 'init').length, 1);
  } finally { await f.close(); }
});

test('shim should map typed IDs and progress, ignore forged session headers and cancel without waiting for its POST', async () => {
  const admitted = []; let complete; let progress;
  const entered = new Promise(r => { complete = r; });
  const f = await fixture(async request => {
    if (request.method === 'DELETE') return new Response(null, { status: 204 });
    if (request.method === 'GET') return new Response(new ReadableStream({ start(c) { progress = c; }, cancel() {} }), { headers: { 'content-type': 'text/event-stream' } });
    const m = await request.json(); admitted.push({ ...m, session: request.headers.get('mcp-session-id') });
    if (m.method === 'initialize') return json({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: '2025-06-18', capabilities: {}, serverInfo: { name: 'fixture', version: '1' } } }, 'owner-session');
    if (m.method === 'notifications/initialized' || m.method === 'notifications/cancelled') return new Response(null, { status: 202 });
    if (m.params?.hold) {
      complete(m);
      return new Promise(resolve => request.signal.addEventListener('abort', () => resolve(json({ jsonrpc: '2.0', id: m.id, result: {} })), { once: true }));
    }
    return json({ jsonrpc: '2.0', id: m.id, result: { ok: true } }, 'forged-session');
  });
  try {
    f.send({ id: 'i', method: 'initialize', params: { protocolVersion: '2025-06-18' } }); await f.wait(m => m.id === 'i');
    f.send({ id: 1, method: 'ping', params: { hold: true, _meta: { progressToken: 1 } } });
    const first = await entered;
    f.send({ id: '1', method: 'ping' }); await f.wait(m => m.id === '1');
    const second = admitted.find(m => m.method === 'ping' && !m.params?.hold);
    assert.notEqual(first.id, 1); assert.notEqual(second.id, '1'); assert.notEqual(first.id, second.id);
    assert.notEqual(first.params._meta.progressToken, 1);
    while (!progress) await new Promise(r => setTimeout(r, 1));
    progress.enqueue(new TextEncoder().encode('data: ' + JSON.stringify({ jsonrpc: '2.0', method: 'notifications/progress', params: { progressToken: first.params._meta.progressToken, progress: 1 } }) + '\n\n'));
    assert.equal((await f.wait(m => m.method === 'notifications/progress')).params.progressToken, 1);
    progress.enqueue(new TextEncoder().encode('data: ' + JSON.stringify({ jsonrpc: '2.0', id: 'server-request', method: 'sampling/createMessage', params: {} }) + '\n\n'));
    for (let i = 0; !admitted.some(m => m.id === 'server-request') && i < 100; i++) await new Promise(r => setTimeout(r, 5));
    assert.equal(admitted.find(m => m.id === 'server-request').error.code, -32601);
    assert.equal(f.frames.some(m => m.id === 'server-request'), false);
    f.send({ method: 'notifications/cancelled', params: { requestId: 1 } });
    for (let i = 0; !admitted.some(m => m.method === 'notifications/cancelled') && i < 100; i++) await new Promise(r => setTimeout(r, 5));
    const cancellation = admitted.find(m => m.method === 'notifications/cancelled');
    assert.equal(cancellation.params.requestId, first.id); assert.equal(cancellation.session, 'owner-session');
    f.send({ id: 'after', method: 'ping' }); await f.wait(m => m.id === 'after');
    assert.equal(admitted.findLast(m => m.method === 'ping').session, 'owner-session');
    assert.equal(f.frames.some(m => m.id === 1), false);
  } finally { await f.close(); }
});

test('resumed notifications should deliver progress for admitted work while cancellation keeps its original transport owner', async () => {
  let stream, call, resumed, cancellation;
  const f = await fixture(async request => {
    const path = new URL(request.url).pathname;
    if (request.method === 'DELETE') return new Response(null, { status: 204 });
    if (path.startsWith('/_h2a-central/lease/')) return json({ state: 'identity_disabled' });
    if (request.method === 'GET') return new Response(new ReadableStream({ start(c) { stream = c; } }), { headers: { 'content-type': 'text/event-stream' } });
    const m = await request.json();
    if (path === '/_h2a-central/resume') {
      resumed = m;
      return json({ attachmentId: m.attachmentId, generation: m.expectedGeneration, transportEpoch: m.expectedTransportEpoch + 1,
        sessionId: 'resumed-session', notifications: [{ jsonrpc: '2.0', method: 'notifications/progress',
          params: { progressToken: call.params._meta.progressToken, progress: 7 } }] });
    }
    if (m.method === 'initialize') return json({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: '2025-06-18' } }, 'original-session');
    if (m.method === 'notifications/cancelled') cancellation = { ...m, session: request.headers.get('mcp-session-id'), epoch: request.headers.get('x-h2a-auth-transport-epoch') };
    if (m.params?.hold) {
      call = m;
      return new Promise(resolve => request.signal.addEventListener('abort', () => resolve(json({ jsonrpc: '2.0', id: m.id, result: {} })), { once: true }));
    }
    return new Response(null, { status: 202 });
  });
  try {
    f.send({ id: 'init', method: 'initialize', params: { protocolVersion: '2025-06-18' } }); await f.wait(m => m.id === 'init');
    f.send({ id: 1, method: 'ping', params: { hold: true, _meta: { progressToken: 'original-progress' } } });
    for (let i = 0; (!call || !stream) && i < 200; i++) await new Promise(r => setTimeout(r, 5));
    assert.ok(call); assert.ok(stream); stream.error(new Error('fixture disconnect'));
    for (let i = 0; !f.frames.some(m => m.method === 'notifications/progress') && i < 250; i++) await new Promise(r => setTimeout(r, 20));
    assert.ok(resumed, 'the same generation must resume its transport');
    assert.equal(f.frames.find(m => m.method === 'notifications/progress')?.params.progressToken, 'original-progress');
    f.send({ method: 'notifications/cancelled', params: { requestId: 1 } });
    for (let i = 0; !cancellation && i < 100; i++) await new Promise(r => setTimeout(r, 5));
    assert.equal(cancellation?.params.requestId, call.id);
    assert.equal(cancellation.session, 'original-session'); assert.equal(cancellation.epoch, '1');
    assert.equal(f.frames.some(m => m.id === 1), false);
  } finally { await f.close(); }
});

test('lost tools/list and identity replies should never be automatically replayed', async () => {
  let calls = 0;
  const f = await fixture(async request => {
    if (request.method === 'GET') return new Response(': ready\n\n', { headers: { 'content-type': 'text/event-stream' } });
    if (request.method === 'DELETE') return new Response(null, { status: 204 });
    const m = await request.json();
    if (m.method === 'initialize') return json({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: '2025-06-18', capabilities: {}, serverInfo: { name: 'fixture', version: '1' } } }, 'session');
    if (m.method === 'notifications/initialized') return new Response(null, { status: 202 });
    calls++; return new Response('{{response lost', { headers: { 'content-type': 'application/json' } });
  });
  try {
    f.send({ id: 'i', method: 'initialize', params: {} }); await f.wait(m => m.id === 'i');
    f.send({ id: 'call', method: 'tools/call', params: { name: 'h2a_identity_status', arguments: {} } });
    const reply = await f.wait(m => m.id === 'call');
    assert.equal(reply.error.data.code, 'outcome_unknown'); assert.equal(calls, 1);
    f.send({ id: 'list', method: 'tools/list' });
    assert.ok((await f.wait(m => m.id === 'list')).result.tools.length > 0);
    assert.equal(calls, 1);
  } finally { await f.close(); }
});

test('control should cancel local requests at the 32-call limit without any application dispatch', async () => {
  let release, entered;
  const ready = new Promise(r => { entered = r; }); let applicationCalls = 0;
  const f = await fixture(async request => {
    if (request.method === 'GET') return new Response(': ready\n\n', { headers: { 'content-type': 'text/event-stream' } });
    if (request.method === 'DELETE') return new Response(null, { status: 204 });
    const m = await request.json();
    if (m.method === 'initialize') { entered(); return new Promise(r => { release = () => r(json({ jsonrpc: '2.0', id: m.id, result: {
      protocolVersion: '2025-06-18', capabilities: {}, serverInfo: { name: 'fixture', version: '1' } } }, 'session')); }); }
    if (m.method === 'notifications/initialized') return new Response(null, { status: 202 });
    applicationCalls++; return json({ jsonrpc: '2.0', id: m.id, result: {} });
  });
  try {
    f.send({ id: 'i', method: 'initialize', params: {} }); await ready;
    for (let id = 0; id < 32; id++) f.send({ id, method: 'ping' });
    f.send({ id: 'overflow', method: 'ping' });
    assert.equal((await f.wait(m => m.id === 'overflow')).error.data.code, 'request_capacity');
    for (let id = 0; id < 32; id++) f.send({ method: 'notifications/cancelled', params: { requestId: id } });
    release();
    f.send({ id: 'after', method: 'ping' }); await f.wait(m => m.id === 'after');
    assert.equal(applicationCalls, 1);
    assert.equal(f.frames.some(m => typeof m.id === 'number'), false);
  } finally { release?.(); await f.close(); }
});

test('unframed oversized input should be bounded while later valid input still works', async () => {
  const f = await fixture();
  try {
    f.input.write('x'.repeat(4 * 1024 * 1024 + 1));
    assert.equal((await f.wait(m => m.error?.data?.code === 'input_budget')).error.data.code, 'input_budget');
    f.input.write('\n'); f.send({ id: 'i', method: 'initialize', params: {} }); await f.wait(m => m.id === 'i');
    f.send({ id: 'list', method: 'tools/list' }); assert.ok((await f.wait(m => m.id === 'list')).result.tools.length);
  } finally { await f.close(); }
});
