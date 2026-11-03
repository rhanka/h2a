// Independent cold controller fixture. It has no live-transfer orchestration.
import fs from 'node:fs';
import { createInterface } from 'node:readline';
import { currentIdentity } from '../../dist/runtime/handover/admission.js';
import { digest } from '../../dist/runtime/handover/wire.js';
import { authenticatedHttpRequest } from '../../dist/runtime/handover/authenticated-http.js';
const [markerPath] = process.argv.slice(2), marker = JSON.parse(fs.readFileSync(markerPath)), coordinator = currentIdentity();
process.stdout.write(JSON.stringify({ id: 'ready', coordinator }) + '\n');
const lines = createInterface({ input: process.stdin });
for await (const line of lines) {
  const { id, operation, payload } = JSON.parse(line);
  try {
    const step = { protocolVersion: 1, mode: 'cold-stop', upgradeId: 'u', handoverId: 'h', transactionEpoch: 1,
      expectedGeneration: marker.generation, expectedPublicationEpoch: marker.publicationEpoch, inventoryRevision: 1,
      stepId: operation, payloadDigest: digest(payload) };
    const response = await authenticatedHttpRequest(markerPath, marker, new URL('/_h2a-central/admin/' + operation, marker.endpoint),
      { method: 'POST', body: JSON.stringify({ step, payload, coordinator }) });
    process.stdout.write(JSON.stringify({ id, status: response.status, body: await response.json() }) + '\n');
  } catch (error) { process.stdout.write(JSON.stringify({ id, error: error.message }) + '\n'); }
}
