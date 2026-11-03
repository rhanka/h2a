import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalBytes, digest, deriveKey, sign, verify } from '../src/runtime/handover/wire.js';
import { readFileSync } from 'node:fs';

test('RFC 8785 sorts numeric keys lexically and rejects non-I-JSON', () => {
  assert.equal(canonicalBytes({ '2': 2, '10': 10, z: -0, a: [1e30, '\n'] }).toString(),
    '{"10":10,"2":2,"a":[1e+30,"\\n"],"z":0}');
  for (const value of [NaN, Infinity, undefined, { x: undefined }, '\ud800', new Date(), [undefined]]) {
    assert.throws(() => canonicalBytes(value));
  }
  const cycle = {}; cycle.self = cycle;
  assert.throws(() => canonicalBytes(cycle));
  assert.equal(digest({ b: 2, a: 1 }), 'sha256:43258cff783fe7036d8a43033f830adfc60ec037382473548ac742b888292777');
});

test('frozen HKDF/HMAC vectors match independent fixed bytes in every domain', () => {
  const fixture = JSON.parse(readFileSync(new URL('./helpers/mh-l0-wire-vectors.json', import.meta.url), 'utf8'));
  const root = Buffer.from(fixture.fixtureRootHex, 'hex');
  assert.equal(canonicalBytes(fixture.payload).toString(), fixture.canonicalPayload);
  for (const vector of fixture.vectors) {
    assert.equal(deriveKey(root, vector.domain, fixture.context).toString('hex'), vector.keyHex);
    assert.equal(sign(root, vector.domain, fixture.context, fixture.payload), vector.mac);
    assert.equal(verify(root, vector.domain, fixture.context, fixture.payload, vector.mac), true);
  }
});

test('domain separation binds service, namespace, generation and all payload bytes', () => {
  const root = Buffer.alloc(32, 0x11);
  const context = { service: 'h2a-mcp-central', namespaceId: 'ns-a', generation: 'g-a' };
  const payload = { sequence: 1, bodyDigest: digest({ answer: 42 }) };
  const mac = sign(root, 'notifications', context, payload);
  assert.equal(verify(root, 'notifications', context, payload, mac), true);
  for (const domain of ['readiness', 'requests', 'responses', 'admission', 'compatibility']) {
    assert.equal(verify(root, domain, context, payload, mac), false);
  }
  assert.equal(verify(root, 'notifications', { ...context, generation: 'g-b' }, payload, mac), false);
  assert.equal(verify(root, 'notifications', context, { ...payload, sequence: 2 }, mac), false);
  for (const bad of ['', mac.toUpperCase(), '00', 'x'.repeat(64)]) {
    assert.equal(verify(root, 'notifications', context, payload, bad), false);
  }
  assert.throws(() => deriveKey(Buffer.alloc(31), 'requests', context));
  assert.throws(() => deriveKey(root, 'unknown', context));
});
