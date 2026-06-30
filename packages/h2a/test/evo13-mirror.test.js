import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";

import { createReplayGuard, signEnvelope } from "@sentropic/h2a";
import {
  acceptMirrorEnvelope,
  buildInstanceMirror,
  H2A_MIRROR_BODY_KIND
} from "../dist/index.js";

const NOW = Date.parse("2026-06-02T12:00:00.000Z");

function keypair() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    pub: publicKey.export({ format: "pem", type: "spki" }).toString(),
    priv: privateKey.export({ format: "pem", type: "pkcs8" }).toString()
  };
}

function registration(instance, pub) {
  return {
    id: instance,
    instance,
    roles: ["AGENTS"],
    scopes: ["scope:default"],
    capabilities: [],
    endpoints: [{ kind: "local-files", uri: "file:///tmp/.h2a" }],
    publicKeys: [pub],
    acceptedPolicies: [],
    createdAt: "2026-06-02T11:00:00.000Z"
  };
}

function fakeStore(reg) {
  // paths.root points at a nonexistent dir → buildInstanceMirror's listPresence
  // returns [] (ENOENT handled). P2 presence cases hand-craft the body instead.
  return {
    findInstance: (id) => (id === reg.instance ? reg : undefined),
    listSubagentsOf: () => [],
    paths: { root: "/tmp/h2a-evo13-build-nopresence" }
  };
}

function session(sessionId, instance, heartbeatAt) {
  return {
    sessionId,
    instance,
    startedAt: "2026-06-02T10:00:00.000Z",
    heartbeatAt,
    state: "live",
    interests: { scopes: ["scope:default"], negotiations: [] },
    subscribedTopics: []
  };
}

function signedMirror(store, instance, priv) {
  const env = buildInstanceMirror(store, instance, NOW);
  return signEnvelope(env, { by: instance, privateKeyPem: priv });
}

test("buildInstanceMirror wraps the local instance's own registration", () => {
  const k = keypair();
  const reg = registration("claude:proj:aaaaaaaaaaaa", k.pub);
  const env = buildInstanceMirror(fakeStore(reg), reg.instance, NOW);
  assert.equal(env.body.kind, H2A_MIRROR_BODY_KIND);
  assert.equal(env.body.registrations[0].instance, reg.instance);
  assert.equal(env.actor.instance, reg.instance);
});

test("operator-enrolled key mirrors its OWN registration → applied (bootstrap, no registry entry yet)", () => {
  const k = keypair();
  const reg = registration("claude:proj:aaaaaaaaaaaa", k.pub);
  const signed = signedMirror(fakeStore(reg), reg.instance, k.priv);
  const applied = [];
  const res = acceptMirrorEnvelope(signed, {
    resolvePublicKeys: () => [], // not registered yet on the remote
    enrolledKeys: [k.pub], // operator allow-listed this key out-of-band
    guard: createReplayGuard(),
    applyRegistration: (r) => applied.push(r.instance),
    now: NOW
  });
  assert.deepEqual(res, { ok: true, applied: [reg.instance], signer: reg.instance });
  assert.deepEqual(applied, [reg.instance]);
});

test("already-registered key mirrors (ongoing) without an enrolled-key entry", () => {
  const k = keypair();
  const reg = registration("claude:proj:aaaaaaaaaaaa", k.pub);
  const signed = signedMirror(fakeStore(reg), reg.instance, k.priv);
  const res = acceptMirrorEnvelope(signed, {
    resolvePublicKeys: (s) => (s === reg.instance ? [k.pub] : []),
    enrolledKeys: [],
    guard: createReplayGuard(),
    applyRegistration: () => {},
    now: NOW
  });
  assert.equal(res.ok, true);
});

test("unknown key (not enrolled, not registered) → unauthorized-key (no TOFU on the wire)", () => {
  const k = keypair();
  const reg = registration("claude:proj:aaaaaaaaaaaa", k.pub);
  const signed = signedMirror(fakeStore(reg), reg.instance, k.priv);
  const res = acceptMirrorEnvelope(signed, {
    resolvePublicKeys: () => [],
    enrolledKeys: [],
    guard: createReplayGuard(),
    applyRegistration: () => assert.fail("must not apply"),
    now: NOW
  });
  assert.deepEqual(res, { ok: false, reason: "unauthorized-key" });
});

test("tampered envelope → bad-signature", () => {
  const k = keypair();
  const reg = registration("claude:proj:aaaaaaaaaaaa", k.pub);
  const signed = signedMirror(fakeStore(reg), reg.instance, k.priv);
  signed.body.registrations[0].roles = ["PRINCIPAL"]; // tamper after signing
  const res = acceptMirrorEnvelope(signed, {
    resolvePublicKeys: () => [],
    enrolledKeys: [k.pub],
    guard: createReplayGuard(),
    applyRegistration: () => assert.fail("must not apply"),
    now: NOW
  });
  assert.deepEqual(res, { ok: false, reason: "bad-signature" });
});

test("spoof: enrolled key tries to register ANOTHER instance it doesn't own → instance-key-mismatch", () => {
  const attacker = keypair();
  const victim = keypair();
  const victimReg = registration("claude:victim:bbbbbbbbbbbb", victim.pub); // not attacker's key
  // hand-craft an envelope from the attacker carrying the victim's registration
  const env = {
    protocol: "sentropic.h2a",
    version: "0.1",
    id: "mirror:claude:attacker:cccccccccccc:1",
    type: "event",
    actor: { instance: "claude:attacker:cccccccccccc", role: "AGENTS", scope: "scope:default" },
    target: { instance: "claude:attacker:cccccccccccc" },
    body: { kind: H2A_MIRROR_BODY_KIND, registrations: [victimReg] },
    createdAt: new Date(NOW).toISOString()
  };
  const signed = signEnvelope(env, { by: env.actor.instance, privateKeyPem: attacker.priv });
  const res = acceptMirrorEnvelope(signed, {
    resolvePublicKeys: () => [],
    enrolledKeys: [attacker.pub], // attacker's key IS enrolled
    guard: createReplayGuard(),
    applyRegistration: () => assert.fail("must not apply a registration the signer does not own"),
    now: NOW
  });
  assert.deepEqual(res, { ok: false, reason: "instance-key-mismatch" });
});

test("replay: same mirror envelope twice → second is replayed", () => {
  const k = keypair();
  const reg = registration("claude:proj:aaaaaaaaaaaa", k.pub);
  const signed = signedMirror(fakeStore(reg), reg.instance, k.priv);
  const guard = createReplayGuard();
  const opts = {
    resolvePublicKeys: () => [],
    enrolledKeys: [k.pub],
    guard,
    applyRegistration: () => {},
    now: NOW
  };
  assert.equal(acceptMirrorEnvelope(signed, opts).ok, true);
  assert.deepEqual(acceptMirrorEnvelope(signed, opts), { ok: false, reason: "replayed" });
});

function signedWithBody(instance, priv, extra) {
  const env = {
    protocol: "sentropic.h2a",
    version: "0.1",
    id: `mirror:${instance}:${extra.seq ?? 1}`,
    type: "event",
    actor: { instance, role: "AGENTS", scope: "scope:default" },
    target: { instance },
    body: { kind: H2A_MIRROR_BODY_KIND, ...extra },
    createdAt: new Date(NOW).toISOString()
  };
  return signEnvelope(env, { by: instance, privateKeyPem: priv });
}

test("P2: dispatches the sender's presence and fences the sequence", () => {
  const k = keypair();
  const reg = registration("claude:proj:aaaaaaaaaaaa", k.pub);
  const signed = signedWithBody(reg.instance, k.priv, {
    registrations: [reg],
    presence: [session("sess:1", reg.instance, "2026-06-02T09:00:00.000Z")],
    seq: 1000
  });
  const appliedPresence = [];
  const fenced = [];
  const res = acceptMirrorEnvelope(signed, {
    resolvePublicKeys: () => [],
    enrolledKeys: [k.pub],
    guard: createReplayGuard(),
    applyRegistration: () => {},
    applyPresence: (s) => appliedPresence.push(s.sessionId),
    fenceSequence: (inst, seq) => (fenced.push([inst, seq]), true),
    now: NOW
  });
  assert.equal(res.ok, true);
  assert.deepEqual(appliedPresence, ["sess:1"]);
  assert.deepEqual(fenced, [[reg.instance, 1000]]);
});

test("P2: a stale sequence is rejected (no registration/presence applied)", () => {
  const k = keypair();
  const reg = registration("claude:proj:aaaaaaaaaaaa", k.pub);
  const signed = signedWithBody(reg.instance, k.priv, { registrations: [reg], seq: 5 });
  const res = acceptMirrorEnvelope(signed, {
    resolvePublicKeys: () => [],
    enrolledKeys: [k.pub],
    guard: createReplayGuard(),
    applyRegistration: () => assert.fail("must not apply on stale seq"),
    applyPresence: () => assert.fail("must not apply on stale seq"),
    fenceSequence: () => false,
    now: NOW
  });
  assert.deepEqual(res, { ok: false, reason: "stale-sequence" });
});

test("P3: dispatches subagents whose parent the key owns; ignores foreign parents", () => {
  const k = keypair();
  const reg = registration("claude:proj:aaaaaaaaaaaa", k.pub);
  const mine = { id: `${reg.instance}~researcher`, parentInstance: reg.instance, name: "researcher" };
  const foreign = {
    id: "claude:other:zzzzzzzzzzzz~x",
    parentInstance: "claude:other:zzzzzzzzzzzz",
    name: "x"
  };
  const signed = signedWithBody(reg.instance, k.priv, {
    registrations: [reg],
    subagents: [mine, foreign]
  });
  const applied = [];
  const res = acceptMirrorEnvelope(signed, {
    resolvePublicKeys: () => [],
    enrolledKeys: [k.pub],
    guard: createReplayGuard(),
    applyRegistration: () => {},
    applySubagent: (b) => applied.push(b.id),
    now: NOW
  });
  assert.equal(res.ok, true);
  assert.deepEqual(applied, [mine.id], "only the owned subagent is applied");
});

test("P2: presence for an instance the key does not own is ignored", () => {
  const k = keypair();
  const reg = registration("claude:proj:aaaaaaaaaaaa", k.pub);
  const signed = signedWithBody(reg.instance, k.priv, {
    registrations: [reg],
    presence: [session("sess:x", "claude:other:zzzzzzzzzzzz", "2026-06-02T09:00:00.000Z")]
  });
  const appliedPresence = [];
  const res = acceptMirrorEnvelope(signed, {
    resolvePublicKeys: () => [],
    enrolledKeys: [k.pub],
    guard: createReplayGuard(),
    applyRegistration: () => {},
    applyPresence: (s) => appliedPresence.push(s.sessionId),
    now: NOW
  });
  assert.equal(res.ok, true);
  assert.deepEqual(appliedPresence, [], "must not write another instance's presence");
});
