// Eight independent actors use the compiled mutation APIs and the common lock.
import fs from 'node:fs';
import { join } from 'node:path';
import { createLocalStore } from '../../dist/runtime/local-files/store.js';
import { writePresence, readPresence, listPresence } from '../../dist/runtime/local-files/presence.js';
import { raiseBlockage, readBlockage } from '../../dist/runtime/blockage/registry.js';
import { createPayloadStore } from '../../dist/runtime/mcp/payload-store.js';
import { writerDirectory, withExecution } from '../../dist/runtime/handover/mutation.js';
import { OwnershipRegistry, OperationLedger } from '../../dist/runtime/handover/ownership.js';
import { LaunchJournal } from '../../dist/runtime/handover/launch-memo.js';
import { currentIdentity } from '../../dist/runtime/handover/admission.js';
import { lockAcquisitions } from './mh-l5-lock-observer.js';
const [root, directory, actor, countText] = process.argv.slice(2), count = Number(countText);
const store = createLocalStore({ root }), payloads = createPayloadStore(root);
const registry = new OwnershipRegistry({ directory, generation: '22222222-2222-4222-8222-222222222222',
  processIdentity: currentIdentity(), lockDirectory: writerDirectory(root) });
const token = registry.claim({ attachmentId: actor, presenceSessionId: actor, expectedInstance: actor });
const ledger = new OperationLedger(registry), journal = new LaunchJournal({ root, registry, token, ledger });
const timings = {};
function measure(object, names) {
  for (const name of names) {
    const original = object[name];
    object[name] = function (...args) {
      const started = performance.now();
      try { return Reflect.apply(original, this, args); }
      finally {
        const row = timings[name] ??= { calls: 0, milliseconds: 0 };
        row.calls++; row.milliseconds += performance.now() - started;
      }
    };
  }
}
measure(store, ['registerInstance', 'putInboxMessage', 'appendNegotiationEvent']);
measure(payloads, ['persistOutput', 'readPayload', 'sweepExpired']);
measure(journal, ['launch']);
const ack = join(root, '..', `ack-${actor}.jsonl`), timestamp = new Date().toISOString();
process.stdout.write('ready\n');
await new Promise(resolve => process.stdin.once('data', resolve));
for (let n = 0; n < count; n++) {
  const acquiredBefore = lockAcquisitions();
  const id = `${actor}:${n}`, negotiation = 'stripe-' + (n % 16), payload = Buffer.from(id);
  // No encompassing mutationLock: each business API must acquire and release
  // its own exclusion, allowing other processes to run between primitives.
  const row = (() => {
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
    // Sweep at real time. A future sweep would invalidate other actors' live
    // refs between persist and read. Seed an already expired output through the
    // real API with a local synchronous clock, then let any actor collect it.
    const ref = payloads.persistOutput(payload);
    const read = payloads.readPayload(ref.ref, 0, 1024);
    if (Buffer.from(read.data, 'base64').toString() !== id) throw new Error('payload_ack_lost');
    const clock = Date.now, expiredAt = clock() - 48 * 60 * 60 * 1000;
    let expired;
    try { Date.now = () => expiredAt; expired = payloads.persistOutput(payload); }
    finally { Date.now = clock; }
    const collected = payloads.sweepExpired();
    if (payloads.readPayload(expired.ref, 0, 1024).error !== 'payload_not_found') throw new Error('payload_expiry_lost');
    const retained = payloads.readPayload(ref.ref, 0, 1024);
    if (Buffer.from(retained.data, 'base64').toString() !== id) throw new Error('payload_live_ref_lost');
    if (n % 100 === 0) listPresence(root, { sweep: false });
    return { id, negotiation, journalHash: entry.contentHash, payloadSha256: ref.sha256,
      payloadRef: ref.ref, expiredRef: expired.ref, payloadMutations: 2 + collected,
      launchPath: journal.path(request.name), presenceSequence: n, blockageSequence: n };
  })();
  fs.appendFileSync(ack, JSON.stringify({ ...row, lockAcquisitions: lockAcquisitions() - acquiredBefore }) + '\n');
  if (n % 100 === 0) process.stdout.write(JSON.stringify({ actor, completed: n + 1, timings }) + '\n');
}
process.stdout.write(JSON.stringify({ actor, completed: count, timings }) + '\n');
process.stdin.destroy();
