import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { Hono } from 'hono';
import { getRequestListener } from '@hono/node-server';

export async function exerciseTypedIdReuse(StreamableHTTPTransport) {
  const transport = new StreamableHTTPTransport({ enableJsonResponse: true });
  const app = new Hono(); app.all('/mcp', c => transport.handleRequest(c));
  const server = createServer(getRequestListener(app.fetch)).listen(0, '127.0.0.1');
  await once(server, 'listening'); await transport.start();
  const endpoint = `http://127.0.0.1:${server.address().port}/mcp`;
  const post = async body => {
    const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(body) });
    assert.equal(response.status, 200); return response.json();
  };
  const request = (id, value) => ({ jsonrpc: '2.0', id, method: 'ping', params: { value } });
  let delayed; let seen;
  try {
    transport.onmessage = message => { void transport.send({ jsonrpc: '2.0', id: message.id, result: { value: message.params.value } }); };
    assert.deepEqual(await post(request(1, 'old')), { jsonrpc: '2.0', id: 1, result: { value: 'old' } });
    const barrier = new Promise(resolve => { seen = resolve; });
    transport.onmessage = message => {
      if (message.id === 1) delayed = () => transport.send({ jsonrpc: '2.0', id: 1, result: { value: 'new' } });
      else { void transport.send({ jsonrpc: '2.0', id: message.id, result: { value: message.params.value } }).then(seen); }
    };
    const batch = post([request(1, 'new'), request('1', 'string')]);
    await barrier; await delayed();
    assert.deepEqual(await batch, [
      { jsonrpc: '2.0', id: 1, result: { value: 'new' } }, { jsonrpc: '2.0', id: '1', result: { value: 'string' } }
    ]);
  } finally {
    await transport.close(); server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}
