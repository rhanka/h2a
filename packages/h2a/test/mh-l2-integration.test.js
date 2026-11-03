import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';

test('central should publish v2 ready, refuse decoy, authenticate the bridge and persist an operator stop', async () => {
  const { startCentralMcpServer } = await import('../dist/runtime/mcp-central.js');
  const { readCentralClientMarker } = await import('../dist/runtime/mcp-central-discovery.js');
  const { authenticatedHttpRequest } = await import('../src/runtime/handover/authenticated-http.js');
  const { bridgeCentralMcpStdio } = await import('../dist/runtime/mcp-central-client.js');
  const dir = fs.mkdtempSync(join(tmpdir(), 'mh-l2-integration-'));
  let server;
  try {
    const root = join(dir, 'store'); fs.mkdirSync(root, { mode: 0o700 });
    server = await startCentralMcpServer({ root, runtimeBase: dir, physicalPrefix: dir, idleTimeoutMs: 60_000 });
    assert.equal(server.kind, 'started');
    const marker = readCentralClientMarker(server.markerPath);
    assert.equal(marker.schemaVersion, 2);
    assert.equal(marker.state, 'ready');
    const ping = await fetch(new URL('/_h2a-central/ping', marker.endpoint));
    assert.deepEqual(await ping.json(), { generation: marker.generation });
    const decoy = await fetch(marker.endpoint, { method: 'POST', headers: { authorization: `Bearer ${marker.token}` }, body: '{"jsonrpc":"2.0","id":1,"method":"initialize"}' });
    assert.equal(decoy.status, 401);
    const status = await authenticatedHttpRequest(server.markerPath, marker, new URL('/_h2a-central/status', marker.endpoint));
    assert.equal((await status.json()).generation, marker.generation);
    const input = new PassThrough(), output = new PassThrough(), controller = new AbortController();
    const messages = []; let buffered = '';
    output.on('data', chunk => { buffered += chunk; let newline; while ((newline = buffered.indexOf('\n')) >= 0) { messages.push(JSON.parse(buffered.slice(0, newline))); buffered = buffered.slice(newline + 1); } });
    const bridge = bridgeCentralMcpStdio({ endpoint: marker.endpoint, runtimeBase: dir, stdin: input, stdout: output, workspaceRoot: dir, signal: controller.signal });
    input.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'fixture', version: '1' } } })+'\n');
    const deadline = Date.now()+3000;
    while (!messages.length && Date.now()<deadline) await new Promise(r => setTimeout(r, 10));
    assert.ok(messages[0]?.result, JSON.stringify(messages));
    input.write('{"jsonrpc":"2.0","method":"notifications/initialized"}\n');
    input.write('{"jsonrpc":"2.0","id":2,"method":"tools/list"}\n');
    while (!messages.some(m => m.id===2) && Date.now()<deadline) await new Promise(r => setTimeout(r, 10));
    assert.ok(messages.find(m=>m.id===2)?.result?.tools.length > 10, JSON.stringify(messages));
    controller.abort(); await bridge;
    const stop = await authenticatedHttpRequest(server.markerPath, marker, new URL('/_h2a-central/stop', marker.endpoint), { method: 'POST' });
    assert.equal((await stop.json()).state, 'STOP_COMMITTED');
    await server.closed;
    assert.equal(fs.existsSync(server.markerPath), false);
  } finally { if (server?.kind==='started') await server.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('central stop should reject force and report a durable deferred pause when no owner is published', async () => {
  const { runCli } = await import('../dist/index.js');
  const dir = fs.mkdtempSync(join(tmpdir(), 'mh-l2-operator-'));
  try {
    let stdout = '', stderr = '';
    const streams = { stdout: { write: text => { stdout += text; } }, stderr: { write: text => { stderr += text; } }, cwd: () => dir };
    assert.equal(await runCli(['central', 'stop', '--runtime-base', dir, '--force'], streams), 1);
    assert.match(stderr, /no force mode/);
    assert.equal(stdout, '');
    assert.equal(await runCli(['central', 'stop', '--runtime-base', dir], streams), 0);
    const result = JSON.parse(stdout);
    assert.equal(result.state, 'pause_active_stop_deferred'); assert.equal(result.paused, true); assert.equal(result.stopped, false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('operator stop should wait for an attachment admitted before its asynchronous protocol connection', async t => {
  const { startCentralMcpServer } = await import('../dist/runtime/mcp-central.js');
  const { readCentralClientMarker } = await import('../dist/runtime/mcp-central-discovery.js');
  const { authenticatedHttpRequest } = await import('../src/runtime/handover/authenticated-http.js');
  const { Server } = await import('@modelcontextprotocol/sdk/server/index.js');
  const dir = fs.mkdtempSync(join(tmpdir(), 'mh-l2-admission-'));
  let server, release, entered;
  const gate = new Promise(resolve => { release = resolve; }), admission = new Promise(resolve => { entered = resolve; });
  const connect = Server.prototype.connect;
  t.mock.method(Server.prototype, 'connect', async function (...args) { entered(); await gate; return connect.apply(this, args); });
  let pending;
  try {
    const root = join(dir, 'store'); fs.mkdirSync(root, { mode: 0o700 });
    server = await startCentralMcpServer({ root, runtimeBase: dir, physicalPrefix: dir, idleTimeoutMs: 60000 });
    const m = readCentralClientMarker(server.markerPath);
    pending = authenticatedHttpRequest(server.markerPath, m, m.endpoint, { method: 'POST', headers: {
      'content-type': 'application/json', accept: 'application/json, text/event-stream', 'x-h2a-workspace': encodeURIComponent(dir) },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'fixture', version: '1' } } }) });
    // Attach a handler before the old implementation can close the socket.
    pending = pending.then(value => value, error => error);
    await admission;
    const stop = await authenticatedHttpRequest(server.markerPath, m, new URL('/_h2a-central/stop', m.endpoint), { method: 'POST' });
    assert.equal((await stop.json()).state, 'pause_active_stop_deferred');
    release(); await pending; await server.closed;
  } finally { release(); await pending; t.mock.restoreAll(); if (server?.kind==='started') await server.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
});
