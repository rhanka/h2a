import nodeTest from 'node:test';
const test = (name, fn) => { if (!process.env.MH_L3_CASE || process.env.MH_L3_CASE === name) nodeTest(name, fn); };
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { StreamableHTTPTransport } from '../dist/runtime/mcp/transport/streamable-http.js';

test('cancelled JSON POST should release its response immediately and discard late results before ID reuse', async () => {
  const transport = new StreamableHTTPTransport({ enableJsonResponse: true }), app = new Hono();
  app.post('/mcp', c => transport.handleRequest(c)); await transport.start();
  const post = (id, signal) => app.fetch(new Request('http://127.0.0.1/mcp', { method: 'POST', signal,
    headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id, method: 'ping' }) }));
  let release, timer;
  try {
    const entered = new Promise(r => { release = r; }); transport.onmessage = () => release();
    const controller = new AbortController(), response = post(1, controller.signal);
    await entered; controller.abort();
    const status = await Promise.race([response.then(r => r.status), new Promise(r => { timer = setTimeout(() => r('retained'), 250); })]);
    assert.equal(status, 202);
    clearTimeout(timer);
    await assert.doesNotReject(transport.send({ jsonrpc: '2.0', id: 1, result: { obsolete: true } }));
    transport.onmessage = message => { void transport.send({ jsonrpc: '2.0', id: message.id, result: { fresh: true } }); };
    assert.deepEqual(await (await post(1)).json(), { jsonrpc: '2.0', id: 1, result: { fresh: true } });
  } finally { clearTimeout(timer); await transport.close(); }
});
