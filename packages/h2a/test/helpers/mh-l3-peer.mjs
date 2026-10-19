// Test-only .8 conformance participant: real signed network and ownership CAS.
// It supplies fixture semantics, never a product compatibility verifier.
import fs from 'node:fs';
import { join } from 'node:path';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { marker as fixtureMarker } from './mh-l0-fixtures.js';
import { currentIdentity } from '../../src/runtime/handover/admission.js';
import { createAuthenticatedServer } from '../../src/runtime/handover/authenticated-http.js';
import { ConnectionAuthentication } from '../../src/runtime/handover/authentication.js';
import { OwnershipRegistry, OperationLedger } from '../../src/runtime/handover/ownership.js';
import { readState, replaceState } from '../../src/runtime/handover/state.js';
import { digest } from '../../src/runtime/handover/wire.js';
import { writerDirectory, updateWriterControl, withExecution, withWriterMutation } from '../../src/runtime/handover/mutation.js';

const processIdentity = currentIdentity(), marker = { ...fixtureMarker(), processIdentity, pid: process.pid,
  publicationEpoch: { bootId: processIdentity.bootId, counter: 2 } };
const auth = new ConnectionAuthentication(marker, Buffer.alloc(32));
let prepared, ledger, operation, token, registry, catalogueRevision = 2, catalogueProbes = 0;
const json = value => Response.json(value);
const server = createAuthenticatedServer(auth, async request => {
  if (!prepared) return json({ error: 'not_prepared' });
  const path = new URL(request.url).pathname;
  if (path === '/_h2a-central/attach-transfer') {
    const body = await request.json();
    if (body.proofDigest !== prepared.proofDigest || body.attachmentId !== prepared.attachmentId ||
        body.handoverId !== prepared.handoverId || body.expectedGeneration !== marker.generation ||
        digest(readState(prepared.markerPath, 'marker').value) !== digest(marker)) return new Response(null, { status: 409 });
    if (!token) {
      registry = new OwnershipRegistry({ directory: marker.stateDirectory, generation: marker.generation, processIdentity, lockDirectory: writerDirectory(prepared.root) });
      ledger = new OperationLedger(registry);
      registry.withLock(() => {
        const path = registry.ownerPath(body.attachmentId), old = readState(path, 'ownership');
        const controlPath = join(marker.stateDirectory, 'component-control.json'), control = readState(controlPath, 'componentControl');
        const tx = readState(join(marker.stateDirectory, control.value.activeTransaction), 'componentTransaction').value;
        if (tx.state !== 'PUBLISHED' || old.value.state !== 'TRANSFERRING' || old.value.ownerGeneration !== prepared.sourceGeneration ||
            old.value.checkpointHash !== prepared.checkpointHash || old.value.handoverId !== prepared.handoverId) throw new Error('peer_acquisition_mismatch');
        const owner = { ...old.value, state: 'ACTIVE', ownerGeneration: marker.generation, ownershipEpoch: old.value.ownershipEpoch + 1, ownerProcessIdentity: processIdentity };
        replaceState(path, owner, 'ownership', old);
        replaceState(controlPath, { ...control.value, revision: control.value.revision + 1, sourceGeneration: marker.generation,
          ownerIdentity: processIdentity, ownerState: 'ACTIVE' }, 'componentControl', control);
        updateWriterControl(prepared.root, { gate: 'OPEN', handoverId: null }); token = registry.token(owner);
      });
    }
    return json({ attachmentId: body.attachmentId, generation: marker.generation, transportEpoch: body.expectedTransportEpoch + 1,
      proofDigest: prepared.proofDigest, sessionId: 'peer-g1-session' });
  }
  if (path === '/_h2a-central/catalogue') {
    fs.writeFileSync(join(prepared.root, 'g1-catalogue-probes'), String(++catalogueProbes));
    return json({ ...prepared.descriptor, revision: catalogueRevision });
  }
  if (path.startsWith('/_h2a-central/lease/')) return json({ state: 'identity_ready', instance: prepared.instance });
  if (request.method === 'GET') return new Response(': ready\n\n', { headers: { 'content-type': 'text/event-stream' } });
  if (request.method === 'DELETE') return new Response(null, { status: 204 });
  const body = await request.json();
  if (body.method === 'notifications/cancelled') { fs.writeFileSync(join(prepared.root, 'g1-cancellation'), JSON.stringify(body)); return new Response(null, { status: 202 }); }
  if (!token) return new Response(null, { status: 409 });
  operation ??= ledger.begin(token, 'peer-g1-admitted-call', 'call');
  withExecution({ root: prepared.root, registry, ledger, token, operation }, () => withWriterMutation(prepared.root, 'registry',
    () => fs.writeFileSync(join(prepared.root, 'g1-admitted-work'), 'G1 admitted while G0 drains')));
  return json({ jsonrpc: '2.0', id: body.id, result: { content: [{ type: 'text', text: JSON.stringify({ generation: marker.generation, ok: true }) }] } });
}).listen(0, '127.0.0.1');
await once(server, 'listening');
process.stdout.write(JSON.stringify({ endpoint: `http://127.0.0.1:${server.address().port}/mcp`, processIdentity }) + '\n');
const lines = createInterface({ input: process.stdin });
lines.on('line', line => {
  try {
    const command = JSON.parse(line);
    if (command.operation === 'prepare') {
      Object.assign(marker, command.target); auth.key = Buffer.from(command.key, 'hex'); prepared = command;
      process.stdout.write(JSON.stringify({ prepared: true }) + '\n');
    } else if (command.operation === 'complete') {
      ledger.finish(operation, { completed: true }); process.stdout.write(JSON.stringify({ completed: true, operationId: operation.operationId }) + '\n');
    } else if (command.operation === 'catalogue-correct') {
      catalogueRevision = 1; process.stdout.write(JSON.stringify({ corrected: true }) + '\n');
    } else throw new Error('peer_command_unknown');
  } catch (e) { process.stdout.write(JSON.stringify({ error: e.message }) + '\n'); process.exitCode = 1; }
});
process.stdin.once('end', () => { lines.close(); server.closeAllConnections(); server.close(); });
