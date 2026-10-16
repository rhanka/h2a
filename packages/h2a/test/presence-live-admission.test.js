import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { BoundedLocalMessagingStore } from '@sentropic/cluster-mesh';
import { createClusterMeshMessaging, createLocalStore, writePresence } from '../dist/index.js';
import { handleSend } from '../dist/runtime/mcp/handlers.js';

async function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'h2a-live-admission-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const store = createLocalStore({ root });
  const identities = ['codex:sender:111111111111', 'claude:recipient:222222222222'].map(instance => {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
    store.registerInstance({ id: instance, instance, roles: ['AGENTS'], scopes: ['scope:test'], capabilities: [],
      endpoints: [], acceptedPolicies: [], publicKeys: [publicKeyPem], createdAt: new Date().toISOString() });
    return { instance, privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() };
  });
  const [signer, recipient] = identities;
  const transport = new BoundedLocalMessagingStore({
    options: { maxMessages: 10, maxBytes: 1024 * 1024, maxMessageBytes: 128 * 1024,
      maxSubscriptions: 10, defaultVisibilityTimeoutMs: 30000, maxVisibilityTimeoutMs: 60000,
      ackTombstoneTtlMs: 60000, maxAckTombstones: 10, maxDrainLeaseMs: 60000 },
    authorization: { async authorize() { return { ok: true, decisionRef: 'isolated-test', policyRevision: 'test-v1' }; } },
    routes: { async resolve() { return []; } }
  });
  let puts = 0;
  const wire = { put: input => { puts++; return transport.put(input); },
    pop: input => transport.pop(input), ack: input => transport.ack(input), subscribe: input => transport.subscribe(input) };
  const connect = identity => createClusterMeshMessaging(store, identity, { store: wire,
    context: { principalId: identity.instance, scopes: ['scope:test'], policyRevision: 'test-v1', authenticationEvidenceRef: 'isolated-key' } });
  const mesh = await connect(signer), receiver = await connect(recipient);
  const publish = (extra = {}) => {
    const now = new Date().toISOString();
    writePresence(root, { instance: recipient.instance, sessionId: 'sess:recipient', pid: process.pid,
      startedAt: now, heartbeatAt: now, state: 'live', interests: { scopes: [], negotiations: [] }, subscribedTopics: [], ...extra });
  };
  const send = (backend, to = recipient.instance) => handleSend(store, signer, { to, message: 'hello', backend }, { clusterMesh: mesh });
  return { root, store, signer, recipient, mesh, receiver, publish, send, puts: () => puts };
}

for (const backend of ['local', 'cluster-mesh']) {
  for (const to of ['peer-display', 'h2a:peer-display']) {
    test(backend + ' preserves typed refusal for known display name ' + to + ' after owner death', async t => {
      const f = await fixture(t);
      const owner = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
      const exited = once(owner, 'exit');
      t.after(async () => {
        if (owner.exitCode === null && owner.signalCode === null) owner.kill();
        await exited;
      });
      await once(owner, 'spawn');
      f.publish({ name: 'peer-display', pid: owner.pid });
      const sent = await f.send(backend, to);
      assert.equal(sent.ok, true, 'the same display name works while its owner lives');
      assert.equal(sent.recipient, f.recipient.instance);
      if (backend === 'cluster-mesh') assert.deepEqual((await f.receiver.drain()).accepted, [sent.messageId]);
      const inbox = f.store.readInbox(f.recipient.instance);
      const puts = f.puts();

      owner.kill();
      await exited;
      assert.throws(() => process.kill(owner.pid, 0), { code: 'ESRCH' });
      const refused = await f.send(backend, to);
      assert.equal(refused.code, 'recipient_not_live', JSON.stringify(refused));
      assert.equal(refused.retryable, true);
      assert.ok(refused.error.includes(f.recipient.instance));
      assert.deepEqual(f.store.readInbox(f.recipient.instance), inbox);
      assert.equal(f.puts(), puts, 'no mesh dispatch after owner death');
      assert.deepEqual(await f.receiver.drain(), { accepted: [], rejected: [] });

      f.publish({ name: 'peer-display' });
      assert.equal((await f.send(backend, to)).ok, true, 'a live attachment restores the name');
    });
  }

  test(backend + ' preserves typed refusal for an unregistered dead owner addressed by alias', async t => {
    const f = await fixture(t);
    const dead = spawnSync(process.execPath, ['-e', ''], { stdio: 'ignore' });
    assert.equal(dead.status, 0);
    const now = new Date().toISOString();
    const instance = 'claude:unregistered:333333333333';
    writePresence(f.root, { instance, sessionId: 'sess:unregistered', pid: dead.pid,
      startedAt: now, heartbeatAt: now, state: 'live',
      interests: { scopes: [], negotiations: [] }, subscribedTopics: [] });
    const refused = await f.send(backend, 'claude:unregistered');
    assert.equal(refused.code, 'recipient_not_live', JSON.stringify(refused));
    assert.equal(refused.retryable, true);
    assert.ok(refused.error.includes(instance));
    assert.deepEqual(f.store.readInbox(instance), []);
    assert.equal(f.puts(), 0);
    assert.deepEqual(await f.receiver.drain(), { accepted: [], rejected: [] });
  });

  test(backend + ' refuses fresh presence belonging to a process that actually exited', async t => {
    const f = await fixture(t);
    const dead = spawnSync(process.execPath, ['-e', ''], { stdio: 'ignore' });
    assert.equal(dead.status, 0);
    assert.throws(() => process.kill(dead.pid, 0), { code: 'ESRCH' });
    f.publish({ pid: dead.pid });
    const result = await f.send(backend);
    assert.equal(result.code, 'recipient_not_live');
    assert.equal(result.retryable, true);
    assert.deepEqual(f.store.readInbox(f.recipient.instance), []);
    assert.equal(f.puts(), 0, 'admission precedes the real mesh transport');
    assert.deepEqual(await f.receiver.drain(), { accepted: [], rejected: [] });
  });

  test(backend + ' requires a valid local PID and succeeds after a live attachment is published', async t => {
    const f = await fixture(t);
    for (const pid of [undefined, 0, -1]) {
      f.publish({ pid });
      assert.equal((await f.send(backend)).code, 'recipient_not_live');
    }
    assert.equal(f.puts(), 0);
    assert.deepEqual(f.store.readInbox(f.recipient.instance), []);
    f.publish();
    const sent = await f.send(backend);
    assert.equal(sent.ok, true);
    assert.equal(sent.recipientLive, true);
    if (backend === 'cluster-mesh') {
      assert.equal(f.puts(), 1);
      assert.deepEqual((await f.receiver.drain()).accepted, [sent.messageId]);
    }
    assert.equal(f.store.readInbox(f.recipient.instance).length, 1);
  });

  test(backend + ' preserves live name precedence, ambiguity and unknown-target errors with dead records', async t => {
    const f = await fixture(t);
    const dead = spawnSync(process.execPath, ['-e', ''], { stdio: 'ignore' });
    assert.equal(dead.status, 0);
    f.publish({ name: 'peer-display' });
    const now = new Date().toISOString();
    const ghost = { instance: 'claude:ghost:333333333333', sessionId: 'sess:ghost', pid: dead.pid,
      name: 'peer-display', startedAt: now, heartbeatAt: now, state: 'live',
      interests: { scopes: [], negotiations: [] }, subscribedTopics: [] };
    writePresence(f.root, ghost);
    for (const to of ['peer-display', 'h2a:peer-display']) {
      const sent = await f.send(backend, to);
      assert.equal(sent.ok, true);
      assert.equal(sent.recipient, f.recipient.instance, 'the live name wins over dead names');
      if (backend === 'cluster-mesh') await f.receiver.drain();
    }
    writePresence(f.root, { ...ghost, pid: process.pid });
    // A dead alias must not replace an ambiguity between two living display names.
    writePresence(f.root, { ...ghost, instance: 'h2a:peer-display:444444444444', sessionId: 'sess:dead-alias', name: 'other' });
    const inbox = f.store.readInbox(f.recipient.instance);
    const puts = f.puts();
    for (const to of ['peer-display', 'h2a:peer-display']) {
      const ambiguous = await f.send(backend, to);
      assert.match(ambiguous.error, /ambiguous/);
      assert.equal(ambiguous.code, undefined);
      assert.equal(ambiguous.retryable, undefined);
    }
    for (const to of ['unknown', 'h2a:unknown', 'claude:ghost:not-a-uuid']) {
      const unknown = await f.send(backend, to);
      assert.equal(typeof unknown.error, 'string');
      assert.equal(unknown.code, undefined, 'unknown/malformed targets keep their addressing error');
      assert.equal(unknown.retryable, undefined);
    }
    assert.deepEqual(f.store.readInbox(f.recipient.instance), inbox);
    assert.equal(f.puts(), puts);
    assert.deepEqual(await f.receiver.drain(), { accepted: [], rejected: [] });
  });
}

test('live admission excludes dead sessions before alias ambiguity resolution', async t => {
  const f = await fixture(t);
  const dead = spawnSync(process.execPath, ['-e', ''], { stdio: 'ignore' });
  assert.equal(dead.status, 0);
  f.publish({ name: 'recipient-name' });
  const now = new Date().toISOString();
  writePresence(f.root, { instance: 'claude:ghost:333333333333', sessionId: 'sess:ghost', pid: dead.pid,
    name: 'recipient-name', startedAt: now, heartbeatAt: now, state: 'live',
    interests: { scopes: [], negotiations: [] }, subscribedTopics: [] });
  const result = await handleSend(f.store, f.signer, { to: 'recipient-name', message: 'hello' });
  assert.equal(result.ok, true);
  assert.equal(result.recipient, f.recipient.instance);
});

test('mirrored presence never probes a remote PID on the local machine', async t => {
  const f = await fixture(t);
  f.publish({ pid: 123456789, mirroredAt: new Date().toISOString() });
  const kill = process.kill;
  let probes = 0;
  process.kill = () => { probes++; throw new Error('remote PID probed locally'); };
  try {
    assert.equal((await f.send('cluster-mesh')).ok, true);
    assert.equal(probes, 0);
  } finally { process.kill = kill; }
});

test('local PID errors are conservative except EPERM, which proves existence', async t => {
  const f = await fixture(t);
  f.publish();
  const kill = process.kill;
  let probes = 0;
  let code = 'EIO';
  process.kill = (pid, signal) => {
    assert.equal(pid, process.pid); assert.equal(signal, 0); probes++;
    throw Object.assign(new Error('injected PID probe error'), { code });
  };
  try {
    assert.equal((await f.send('local')).code, 'recipient_not_live');
    code = 'EPERM';
    assert.equal((await f.send('local')).ok, true);
    assert.equal(probes, 2);
  } finally { process.kill = kill; }
});
