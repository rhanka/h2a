import nodeTest from 'node:test';
const test = (name, fn) => { if (!process.env.MH_L3_CASE || process.env.MH_L3_CASE === name) nodeTest(name, fn); };
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { evidenceFixture } from './helpers/mh-l3-evidence.js';
import { EvidenceAcceptances } from '../src/runtime/handover/evidence.js';

test('resume should fence transports, preserve one activation and quarantine unknown liveness within capacity', async () => {
  const { AttachmentTransports } = await import('../src/runtime/handover/attachment-transports.js');
  const registry = new AttachmentTransports({ generation: 'g0', capacity: 1 });
  const context = { id: randomUUID(), shimProcessIdentity: { pid: 123 }, env: { conversation: 'one' } };
  let activations = 0;
  const a = registry.attach(context.id, context, () => ({ id: ++activations }));
  registry.detach(a.id, 'unknown');
  assert.equal(a.state, 'quarantined');
  assert.throws(() => registry.attach('other', {}, () => ++activations), /attachment_capacity/);
  const request = { schemaVersion: 1, attachmentId: a.id, expectedGeneration: 'g0', expectedTransportEpoch: 1,
    resumeAttemptId: 'attempt', expectedInstance: 'identity_disabled', lastAcceptedNotificationSequence: 0 };
  assert.throws(() => registry.resume(request, { ...context, env: { conversation: 'other' } }, 'alive'), /attachment_context/);
  assert.throws(() => registry.resume(request, context, 'unknown'), /liveness_unknown/);
  const resumed = registry.resume(request, context, 'alive');
  assert.equal(resumed.transportEpoch, 2);
  assert.equal(a.state, 'attached');
  assert.equal(a.activation.id, 1);
  assert.equal(activations, 1);
  assert.deepEqual(registry.resume(request, context, 'alive'), resumed);
  assert.throws(() => registry.resume({ ...request, expectedInstance: 'changed' }, context, 'alive'), /resume_conflict/);
  assert.throws(() => registry.admit(a.id, 1), /transport_fenced/);
  assert.equal(registry.admit(a.id, 2), a);
});

test('request mappings should distinguish typed IDs, remap progress, settle once and cancel the original owner', async () => {
  const { RequestMappings } = await import('../src/runtime/handover/request-mappings.js');
  const mappings = new RequestMappings();
  const owner = { generation: 'g0', sessionId: 's0', attachmentId: 'a', transportEpoch: 1 };
  const one = mappings.begin({ id: 1, method: 'tools/call', params: { _meta: { progressToken: 1 } } }, owner, 100);
  const text = mappings.begin({ id: '1', method: 'ping' }, owner, 100);
  assert.notEqual(one.upstreamId, text.upstreamId);
  assert.notEqual(one.upstreamId, 1);
  assert.notEqual(one.progressToken, 1);
  assert.deepEqual(mappings.progress(one.progressToken, owner), { progressToken: 1 });
  assert.equal(mappings.progress(one.progressToken, { ...owner, generation: 'g1' }), undefined);
  const resumed = { ...owner, sessionId: 's1', transportEpoch: 2 };
  assert.throws(() => mappings.resumeNotifications(owner, { ...resumed, generation: 'g1' }), /notification_resume_mismatch/);
  assert.throws(() => mappings.resumeNotifications(owner, { ...resumed, attachmentId: 'foreign' }), /notification_resume_mismatch/);
  assert.throws(() => mappings.resumeNotifications(owner, { ...resumed, transportEpoch: 3 }), /notification_resume_mismatch/);
  mappings.resumeNotifications(owner, resumed);
  assert.deepEqual(mappings.progress(one.progressToken, resumed), { progressToken: 1 });
  assert.deepEqual(mappings.progress(one.progressToken, owner), { progressToken: 1 }, 'the admitted POST also retains its exact progress owner');
  const resumedAgain = { ...resumed, transportEpoch: 3 };
  mappings.resumeNotifications(resumed, resumedAgain);
  assert.deepEqual(mappings.progress(one.progressToken, resumedAgain), { progressToken: 1 });
  assert.equal(mappings.progress(one.progressToken, resumed), undefined);
  const cancelled = mappings.cancel(1);
  assert.equal(cancelled.owner, owner);
  assert.equal(cancelled.upstreamId, one.upstreamId);
  assert.equal(one.controller.signal.aborted, true);
  assert.equal(mappings.settle(one), false);
  const reused = mappings.begin({ id: 1, method: 'ping' }, { ...owner, generation: 'g1' }, 200);
  assert.notEqual(reused.upstreamId, one.upstreamId);
  assert.equal(mappings.progress(one.progressToken, owner), undefined);
  assert.equal(mappings.settle(reused), true);
  assert.equal(mappings.settle(reused), false);
  assert.equal(mappings.settle(text), true);
  assert.equal(mappings.size, 0);
  assert.equal(mappings.tokens.size, 0);
});

test('non-admission should require every binding from the authenticated response', async () => {
  const { nonAdmissionMatches } = await import('../src/runtime/handover/request-mappings.js');
  const entry = { requestUid: 'request', requestNonce: 'nonce', requestDigest: 'digest', owner: { marker: { generation: 'g0', publicationEpoch: { counter: 1 } } } };
  const proof = { accepted: false, execution: 'not_started', reason: 'admission_closed', requestUid: 'request', requestNonce: 'nonce',
    requestDigest: 'digest', generation: 'g0', publicationEpoch: { counter: 1 }, method: 'tools/call' };
  assert.equal(nonAdmissionMatches(proof, entry, { method: 'tools/call' }), true);
  for (const [key, value] of Object.entries({ accepted: true, execution: 'possible', requestUid: 'other', requestNonce: 'other', requestDigest: 'other',
    generation: 'g1', publicationEpoch: { counter: 2 }, method: 'ping' })) assert.equal(nonAdmissionMatches({ ...proof, [key]: value }, entry, { method: 'tools/call' }), false, key);
});

test('catalogue should retain its served view and reject changed tools while accepting only provenance-checked additions', async () => {
  const { CatalogueView, describeCatalogue } = await import('../src/runtime/handover/catalogue.js');
  const tool = { name: 'read', description: 'words', behaviorVersion: 1,
    inputSchema: { type: 'object', properties: { description: { type: 'string', default: 'a' } } } };
  const descriptor = describeCatalogue([tool]);
  const editorial = describeCatalogue([{ ...tool, description: 'other words' }]);
  assert.equal(descriptor.contractDigest, editorial.contractDigest);
  assert.notEqual(descriptor.descriptorDigest, editorial.descriptorDigest);
  const changed = describeCatalogue([{ ...tool, inputSchema: { ...tool.inputSchema, properties: { description: { type: 'string', default: 'b' } } } }]);
  assert.notEqual(descriptor.contractDigest, changed.contractDigest);
  const view = new CatalogueView(descriptor);
  assert.equal(view.install(changed), false);
  assert.equal(view.state, 'DEGRADED_CATALOGUE');
  assert.equal(view.canCall('read'), false);
  assert.deepEqual(view.tools(), [tool]);
  const added = describeCatalogue([tool, { ...tool, name: 'new' }]);
  assert.equal(view.install(added), false);
  assert.equal(view.canCall('read'), true);
  assert.equal(view.canCall('new'), false);
  assert.equal(view.install(added, { sourceContractDigest: descriptor.contractDigest, targetDescriptorDigest: added.descriptorDigest }), false);
  const f = evidenceFixture(); f.proof.source.contractDigest = descriptor.contractDigest;
  const bound = evidenceFixture({ source: f.proof.source, target: { ...f.proof.target, descriptorDigest: added.descriptorDigest } });
  const receipt = new EvidenceAcceptances().accept(bound.proof, bound.options);
  assert.equal(view.install(added, receipt), true);
  assert.equal(view.tools().length, 2);
  assert.equal(view.install(describeCatalogue(added.tools, added.capabilities, ['2099-01-01'])), false);
  assert.equal(view.canCall('read', '2025-06-18'), false);
  assert.throws(() => view.install({ ...added, tools: [tool] }), /descriptor_digest/);
});


test('catalogue pages should stay under the frame bound and refuse a cursor from another revision', async () => {
  const { CatalogueView, describeCatalogue } = await import('../src/runtime/handover/catalogue.js');
  const tool = { name: 'one', description: 'x'.repeat(600 * 1024), inputSchema: { type: 'object' } };
  const view = new CatalogueView(describeCatalogue([tool, { ...tool, name: 'two' }]));
  const first = view.page(); assert.equal(first.tools.length, 1); assert.ok(first.nextCursor);
  assert.equal(view.page(first.nextCursor).tools[0].name, 'two');
  assert.equal(view.page(first.nextCursor).nextCursor, undefined);
  assert.ok(Buffer.byteLength(JSON.stringify(first)) < 1024 * 1024);
  view.install(describeCatalogue([tool, { ...tool, name: 'two', description: 'other words' }]));
  assert.throws(() => view.page(first.nextCursor), /cursor_invalid/);
});

test('schema instance values and properties named description or dollar-ref should remain normative', async () => {
  const { describeCatalogue } = await import('../src/runtime/handover/catalogue.js');
  const base = { name: 'literal', inputSchema: { type: 'object', default: { description: 'one' }, properties: { '$ref': { type: 'string' } } },
    outputSchema: { enum: [{ description: 'one' }] } };
  const input = { ...base, inputSchema: { ...base.inputSchema, default: { description: 'two' } } };
  assert.notEqual(describeCatalogue([base]).contractDigest, describeCatalogue([input]).contractDigest);
  const output = { ...base, outputSchema: { enum: [{ description: 'two' }] } };
  assert.notEqual(describeCatalogue([base]).contractDigest, describeCatalogue([output]).contractDigest);
});
