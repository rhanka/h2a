// Test-only executable. No code, secret or fault switch is in the published package.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { sign, digest } from '../../src/runtime/handover/wire.js';
import { validate } from '../../src/runtime/handover/formats.js';

const fixture = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const root = Buffer.from(fixture.rootKey, 'hex');
const { mac: unused, ...payload } = validate('compatibilityEvidence', fixture.evidence);
const proof = { ...payload, mac: sign(root, 'compatibility', fixture.context, payload) };
const receipts = new Map(); let epoch = 0; let acquisitions = 0; let restorations = 0;
const server = createServer(async (req, res) => {
  const reply = (code, value) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)); };
  if (req.url === '/evidence' && req.method === 'GET') { reply(200, proof); return; }
  if (req.url === '/counters' && req.method === 'GET') { reply(200, { acquisitions, restorations }); return; }
  if (req.url !== '/cas' || req.method !== 'POST') { reply(404, {}); return; }
  try {
    const chunks = []; let size = 0;
    for await (const chunk of req) { size += chunk.length; if (size > 4096) throw new Error('too_large'); chunks.push(chunk); }
    const operation = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (typeof operation.stepId !== 'string' || !Number.isSafeInteger(operation.expectedEpoch) ||
        typeof operation.owner !== 'string' || typeof operation.checkpoint !== 'string') throw new Error('invalid');
    const receipt = receipts.get(operation.stepId);
    if (receipt) { reply(receipt.digest === digest(operation) ? 200 : 409, receipt.result); return; }
    if (operation.expectedEpoch !== epoch) { reply(409, { conflict: true }); return; }
    acquisitions++; restorations++;
    const result = { epoch: ++epoch, owner: operation.owner, restored: true };
    receipts.set(operation.stepId, { digest: digest(operation), result });
    if (fixture.dropAckOnce) { fixture.dropAckOnce = false; req.socket.destroy(); return; }
    reply(200, result);
  } catch { reply(400, { invalid: true }); }
});
server.listen(0, '127.0.0.1', () => {
  process.stdout.write(JSON.stringify({ endpoint: `http://127.0.0.1:${server.address().port}`, pid: process.pid }) + '\n');
});
process.stdin.resume();
process.stdin.on('end', () => { server.closeAllConnections(); server.close(); });
