// Test-only future participant. It owns only its temporary loopback listener;
// it neither touches an installation nor implements a .7 product conductor.
import { createServer } from 'node:http';
import { once } from 'node:events';
import { currentIdentity } from '../../src/runtime/handover/admission.js';
const server = createServer((_req, res) => { res.writeHead(503); res.end(); }).listen(0, '127.0.0.1');
await once(server, 'listening');
process.stdout.write(JSON.stringify({ endpoint: `http://127.0.0.1:${server.address().port}/mcp`, processIdentity: currentIdentity() }) + '\n');
process.stdin.resume();
process.stdin.once('end', () => { server.closeAllConnections(); server.close(); });
