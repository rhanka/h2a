// Test-only future participant. It owns only its temporary loopback listener;
// it neither touches an installation nor implements a .7 product conductor.
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import fs from 'node:fs';
import { join } from 'node:path';
import { currentIdentity } from '../../src/runtime/handover/admission.js';
import { OwnershipRegistry, OperationLedger } from '../../src/runtime/handover/ownership.js';
import { readState, replaceState } from '../../src/runtime/handover/state.js';
import { digest } from '../../src/runtime/handover/wire.js';
import { writerDirectory, updateWriterControl, withExecution, withWriterMutation } from '../../src/runtime/handover/mutation.js';
const server = createServer((_req, res) => { res.writeHead(503); res.end(); }).listen(0, '127.0.0.1');
await once(server, 'listening');
const processIdentity = currentIdentity();
process.stdout.write(JSON.stringify({ endpoint: `http://127.0.0.1:${server.address().port}/mcp`, processIdentity }) + '\n');
let ledger, operation;
const lines = createInterface({ input: process.stdin });
lines.on('line', line => {
  try {
    const command = JSON.parse(line);
    if (command.operation === 'acquire') {
      const { target, root, markerPath, attachmentId, checkpointHash, sourceGeneration, handoverId } = command;
      if (digest(readState(markerPath, 'marker')?.value) !== digest(target) || digest(target.processIdentity) !== digest(processIdentity)) throw new Error('peer_publication_mismatch');
      const registry = new OwnershipRegistry({ directory: target.stateDirectory, generation: target.generation, processIdentity, lockDirectory: writerDirectory(root) });
      ledger = new OperationLedger(registry);
      registry.withLock(() => {
        const path = registry.ownerPath(attachmentId), old = readState(path, 'ownership');
        const controlPath = join(target.stateDirectory, 'component-control.json'), control = readState(controlPath, 'componentControl');
        const tx = readState(join(target.stateDirectory, control.value.activeTransaction), 'componentTransaction').value;
        if (tx.state !== 'PUBLISHED' || tx.source.generation !== sourceGeneration || tx.handoverId !== handoverId ||
            old.value.state !== 'TRANSFERRING' || old.value.ownerGeneration !== sourceGeneration ||
            old.value.checkpointHash !== checkpointHash || old.value.handoverId !== handoverId) throw new Error('peer_acquisition_mismatch');
        const owner = { ...old.value, state: 'ACTIVE', ownerGeneration: target.generation, ownershipEpoch: old.value.ownershipEpoch + 1, ownerProcessIdentity: processIdentity };
        replaceState(path, owner, 'ownership', old);
        replaceState(controlPath, { ...control.value, revision: control.value.revision + 1,
          sourceGeneration: target.generation, ownerIdentity: processIdentity, ownerState: 'ACTIVE' }, 'componentControl', control);
        updateWriterControl(root, { gate: 'OPEN', handoverId: null });
        const token = registry.token(owner);
        operation = ledger.begin(token, 'peer-g1-admitted-call', 'call');
        withExecution({ root, registry, ledger, token, operation }, () => withWriterMutation(root, 'registry',
          () => fs.writeFileSync(join(root, 'g1-admitted-work'), 'G1 admitted while G0 drains')));
      });
      process.stdout.write(JSON.stringify({ acquired: true, operationId: operation.operationId }) + '\n');
    } else if (command.operation === 'complete') {
      ledger.finish(operation, { completed: true });
      process.stdout.write(JSON.stringify({ completed: true }) + '\n');
    } else throw new Error('peer_command_unknown');
  } catch (error) {
    process.stdout.write(JSON.stringify({ error: error.message }) + '\n');
    process.exitCode = 1; process.stdin.destroy(); server.closeAllConnections(); server.close();
  }
});
process.stdin.resume();
process.stdin.once('end', () => { lines.close(); server.closeAllConnections(); server.close(); });
