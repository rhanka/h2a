// Eight independent actors use the compiled mutation APIs and the common lock.
import fs from 'node:fs';
import { join } from 'node:path';
import { createLocalStore } from '../../dist/runtime/local-files/store.js';
import { writePresence, readPresence, listPresence } from '../../dist/runtime/local-files/presence.js';
import { raiseBlockage, readBlockage } from '../../dist/runtime/blockage/registry.js';
import { createPayloadStore } from '../../dist/runtime/mcp/payload-store.js';
import { mutationLock, writerDirectory, withExecution } from '../../dist/runtime/handover/mutation.js';
import { OwnershipRegistry, OperationLedger } from '../../dist/runtime/handover/ownership.js';
import { LaunchJournal } from '../../dist/runtime/handover/launch-memo.js';
import { currentIdentity } from '../../dist/runtime/handover/admission.js';
const [root, directory, actor, countText] = process.argv.slice(2), count = Number(countText);
const store = createLocalStore({ root }), payloads = createPayloadStore(root);
const registry = new OwnershipRegistry({ directory, generation: '22222222-2222-4222-8222-222222222222',
  processIdentity: currentIdentity(), lockDirectory: writerDirectory(root) });
const token = registry.claim({ attachmentId: actor, presenceSessionId: actor, expectedInstance: actor });
const ledger = new OperationLedger(registry), journal = new LaunchJournal({ root, registry, token, ledger });
const ack = join(root, '..', `ack-${actor}.jsonl`), timestamp = new Date().toISOString();
process.stdout.write('ready\n');
await new Promise(resolve => process.stdin.once('data', resolve));
for (let n = 0; n < count; n++) {
  const id = `${actor}:${n}`, negotiation = 'stripe-' + (n % 16), payload = Buffer.from(id);
  const row = mutationLock(writerDirectory(root), () => {
    store.registerInstance({ id, publicKeys: [], roles: [], scopes: [], createdAt: timestamp });
    store.putInboxMessage('shared-recipient', { protocol: 'sentropic.h2a', version: '0.1', id, type: 'event',
      actor: { instance: actor, role: 'AGENTS', scope: 'scope:default' }, body: { kind: 'message', topic: 'MESSAGE', text: id }, createdAt: timestamp });
    const entry = store.appendNegotiationEvent(negotiation, { id, type: 'event', actor: { instance: actor, role: 'AGENTS', scope: 'scope:default' }, body: { id }, createdAt: timestamp });
    withExecution({ root, registry, token }, () => writePresence(root, { sessionId: actor, instance: actor, host: 'claude', pid: process.pid,
      startedAt: timestamp, heartbeatAt: timestamp, state: 'live', interests: { scopes: [id], negotiations: [] }, subscribedTopics: [] }));
    if (readPresence(root, actor).interests.scopes[0] !== id) throw new Error('presence_ack_lost');
    raiseBlockage(root, { instance: actor, scope: 'scope:default', reason: id });
    if (readBlockage(root, actor).reason !== id) throw new Error('blockage_ack_lost');
    const request = { name: `launch_${n}`, workspace: root, prompt: id };
    let effects = 0;
    const result = journal.launch(request, () => { effects++; return { state: 'stopped', id }; });
    if (result.id !== id || effects !== 1) throw new Error('launch_ack_lost');
    // Alternate writes and real expiry collection: 10,000 of each in the full
    // campaign. The explicit sweep time expires only this just-created ref;
    // no ref is held live by another actor outside this common critical section.
    const ref = payloads.persistOutput(payload);
    const read = payloads.readPayload(ref.ref, 0, 1024);
    if (Buffer.from(read.data, 'base64').toString() !== id) throw new Error('payload_ack_lost');
    const collected = payloads.sweepExpired(Date.parse(ref.expiresAt));
    if (collected !== 1 || !('error' in payloads.readPayload(ref.ref, 0, 1024))) throw new Error('payload_expiry_lost');
    if (n % 100 === 0) listPresence(root, { sweep: false });
    return { id, negotiation, journalHash: entry.contentHash, payloadSha256: ref.sha256, payloadMutations: 2,
      launchPath: journal.path(request.name), presenceSequence: n, blockageSequence: n };
  });
  fs.appendFileSync(ack, JSON.stringify(row) + '\n');
  if (n % 100 === 0) process.stdout.write(JSON.stringify({ actor, completed: n + 1 }) + '\n');
}
process.stdin.destroy();
