import test from 'node:test';
import assert from 'node:assert/strict';
import { marker } from './helpers/mh-l0-fixtures.js';
import { digest } from '../src/runtime/handover/wire.js';
import fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';

test('M18c should never send an application body when a challenged TCP socket is replaced', async () => {
  const { ConnectionAuthentication } = await import('../src/runtime/handover/authentication.js');
  const { authenticatedHttpRequest } = await import('../src/runtime/handover/authenticated-http.js');
  const { prepareAuthority, currentIdentity } = await import('../src/runtime/handover/admission.js');
  const dir = fs.mkdtempSync(join(tmpdir(), 'mh-l2-challenge-'));
  let server;
  try {
    const frame = currentIdentity();
    const authority = await prepareAuthority({ directory: dir, root: dir, physicalPrefix: dir, frame });
    const m = { ...marker(), namespaceId: authority.domain.namespaceId, prefixId: authority.domain.prefixId,
      root: dir, stateDirectory: dir, uid: process.getuid(), authKeyReference: authority.authKeyReference };
    const auth = new ConnectionAuthentication(m, authority.rootKey);
    let applicationBodies = 0;
    server = createServer((incoming, outgoing) => {
      if (!incoming.url.startsWith('/_h2a-central/challenge/')) { applicationBodies++; outgoing.end('{}'); return; }
      const proof = auth.challenge(incoming.socket, incoming.url.split('/').at(-1));
      outgoing.writeHead(200, { 'content-type': 'application/json', connection: 'close' }); outgoing.end(JSON.stringify(proof));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    m.endpoint = `http://127.0.0.1:${server.address().port}/mcp`;
    await assert.rejects(authenticatedHttpRequest(join(dir, 'marker.json'), m, m.endpoint,
      { method: 'POST', body: '{"private":"must-not-leak"}' }), /challenge_connection_lost/);
    assert.equal(applicationBodies, 0);
  } finally { if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } fs.rmSync(dir, { recursive: true, force: true }); }
});

test('M03/M18b/c should bind challenges and every frame, reject decoy, replay, expiry and saturation', async () => {
  const { ConnectionAuthentication, FrameVerifier } = await import('../src/runtime/handover/authentication.js');
  let now = 100;
  const m = marker(), key = Buffer.alloc(32, 0x76);
  const auth = new ConnectionAuthentication(m, key, { now: () => now, capacity: 2, validityMs: 10 });
  const a = {}, b = {};
  const challenge = auth.challenge(a, 'client');
  assert.equal(auth.verifyChallenge(challenge, 'client'), true);
  assert.equal(auth.verifyChallenge({ ...challenge, buildId: 'foreign' }, 'client'), false);
  const body = { method: 'POST', headers: {}, body: '{"method":"tools/list"}' };
  const req = auth.request(challenge, '/mcp', body, { requestUid: 'u1', requestNonce: 'n1' });
  assert.throws(() => auth.admit(b, req, '/mcp', body), /challenge_required/);
  assert.throws(() => auth.admit(a, { ...req, mac: m.token }, '/mcp', body), /authentication_invalid/);
  assert.throws(() => auth.admit(a, { ...req, mac: '0'.repeat(64) }, '/mcp', body), /authentication_invalid/);
  assert.throws(() => auth.admit(a, req, '/other', body), /authentication_invalid/);
  assert.throws(() => auth.admit(a, req, '/mcp', { ...body, body: 'changed' }), /authentication_invalid/);
  assert.equal(auth.admit(a, req, '/mcp', body).requestUid, 'u1');
  assert.throws(() => auth.admit(a, req, '/mcp', body), /nonce_replayed/);
  const second = auth.request(challenge, '/mcp', body, { requestUid: 'u2', requestNonce: 'n2' });
  auth.admit(a, second, '/mcp', body);
  assert.throws(() => auth.admit(a, auth.request(challenge, '/mcp', body), '/mcp', body), /nonce_capacity/);
  now = 111;
  assert.throws(() => auth.admit(a, second, '/mcp', body), /challenge_expired/);
  const fresh = auth.challenge(b, 'fresh');
  assert.notEqual(fresh.connectionNonce, challenge.connectionNonce);
  const verifier = new FrameVerifier(m, key);
  for (const channel of ['responses', 'notifications']) {
    const payload = { jsonrpc: '2.0', ...(channel === 'responses' ? { id: 1, result: {} } : { method: 'notice' }) };
    const frame = auth.frame(payload, { attachmentId: 'a', transportEpoch: 1, channel, requestUid: channel === 'responses' ? 'u1' : null });
    assert.equal(frame.header.payloadDigest, digest(payload));
    assert.throws(() => verifier.accept({ ...frame, payload: {} }, { attachmentId: 'a', transportEpoch: 1, requestUid: frame.header.requestUid }), /frame_invalid/);
    assert.throws(() => verifier.accept({ ...frame, header: { ...frame.header, mac: '0'.repeat(64) } }, { attachmentId: 'a', transportEpoch: 1, requestUid: frame.header.requestUid }), /frame_invalid/);
    assert.deepEqual(verifier.accept(frame, { attachmentId: 'a', transportEpoch: 1, requestUid: frame.header.requestUid }), payload);
    assert.throws(() => verifier.accept(frame, { attachmentId: 'a', transportEpoch: 1, requestUid: frame.header.requestUid }), /sequence_replayed/);
    assert.throws(() => verifier.accept(auth.frame(payload, { attachmentId: 'a', transportEpoch: 1, channel, requestUid: 'other' }), { attachmentId: 'a', transportEpoch: 1, requestUid: 'u1' }), /frame_owner_mismatch/);
  }
});
