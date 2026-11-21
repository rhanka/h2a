import assert from "node:assert/strict";
import test from "node:test";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

import {
  REMOTE_CONTROL_ENV,
  REMOTE_CONTROL_DISABLED_REASON,
  REMOTE_CONTROL_DISABLED_MESSAGE,
  isRemoteControlEnabled,
  assertRemoteControlEnabled,
  canonicalTrunkJson,
  signTrunkAuthPayload,
  verifyTrunkAuthPayload,
  projectCatalogueRow,
  buildCatalogueSnapshot,
  serializeCatalogueSnapshot,
  parseCatalogueSnapshot,
  containsForbiddenLocalField,
  resolveFleetValve,
  classifyLaunchHost,
  buildFleetInventory,
  buildFleetInventoryFromRoot
} from "../dist/runtime/remote-agent/index.js";

import { FakeTrunkEndpoint, FakeEnrolmentVerifier } from "./helpers/remote-trunk-fakes.js";

// LH-00 contract fakes and flag. Every case runs under a temporary store root
// and a temporary runtime directory derived from TMPDIR; no live state, no
// real account and no network are ever touched.

function makeFixtureDirs() {
  assert.ok(process.env.TMPDIR && resolve(process.env.TMPDIR) !== "/tmp", "Supply a disposable TMPDIR");
  const base = mkdtempSync(join(process.env.TMPDIR, "lh00-"));
  const storeRoot = join(base, "store");
  const runtimeDir = join(base, "runtime");
  mkdirSync(storeRoot, { recursive: true });
  mkdirSync(runtimeDir, { recursive: true });
  return { base, storeRoot, runtimeDir };
}

function cleanupDirs(dirs) {
  for (const dir of [dirs.base]) rmSync(dir, { recursive: true, force: true });
}

function fixtureKeys(label) {
  const pair = generateKeyPairSync("ed25519", {
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" }
  });
  void label;
  return { privateKeyPem: pair.privateKey, publicKeyPem: pair.publicKey };
}

function fixtureSession(sessionId, launchContext) {
  return {
    sessionId,
    instance: `claude:${sessionId}:abcdef123456`,
    host: "claude",
    name: `session-${sessionId}`,
    startedAt: "2026-11-16T10:00:00.000Z",
    heartbeatAt: "2026-11-16T10:00:30.000Z",
    state: "live",
    interests: { scopes: [], negotiations: [] },
    subscribedTopics: [],
    workStatus: "working",
    ...(launchContext === undefined ? {} : { launchContext })
  };
}

const MESH = "mesh-fixture";
const TENANT = "tenant-fixture";
const ENDPOINT = "https://remote.example/trunk/v1";
const NODE = "node-fixture-1";
const REF = "enr-fixture-1";
const VERSIONS = [1];
const SERVER_TIME = 1700000000000;
const TEST_ENV = { H2A_REMOTE_CONTROL: "1", H2A_TEST_FAKES: "1" };
const FIXTURE_NOW = Date.parse("2026-11-16T10:01:00.000Z");

function challengeFor(nonce) {
  return { nonce, meshId: MESH, tenantId: TENANT, endpoint: ENDPOINT, serverTime: SERVER_TIME, nodeId: NODE, enrolmentRef: REF };
}

function payloadFor(nonce) {
  return { nonce, meshId: MESH, tenantId: TENANT, endpoint: ENDPOINT, serverTime: SERVER_TIME, nodeId: NODE, enrolmentRef: REF, protocolVersions: VERSIONS, clientTime: 1700000000000 };
}

test("flag is off by default and only 1 enables it", () => {
  const dirs = makeFixtureDirs();
  try {
    assert.equal(REMOTE_CONTROL_ENV, "H2A_REMOTE_CONTROL");
    assert.equal(isRemoteControlEnabled({}), false);
    assert.equal(isRemoteControlEnabled({ H2A_REMOTE_CONTROL: "0" }), false);
    assert.equal(isRemoteControlEnabled({ H2A_REMOTE_CONTROL: "true" }), false);
    assert.equal(isRemoteControlEnabled({ H2A_REMOTE_CONTROL: "" }), false);
    assert.equal(isRemoteControlEnabled({ H2A_REMOTE_CONTROL: "1" }), true);
    assert.doesNotThrow(() => assertRemoteControlEnabled({ H2A_REMOTE_CONTROL: "1" }));
    assert.throws(
      () => assertRemoteControlEnabled({}),
      (err) => err instanceof Error && err.message.includes("site-side approval")
    );
    assert.equal(REMOTE_CONTROL_DISABLED_REASON, "remote-control-disabled");
    assert.ok(REMOTE_CONTROL_DISABLED_MESSAGE.includes("site-side approval"));
    for (const p of [dirs.storeRoot, dirs.runtimeDir]) {
      assert.ok(resolve(p).startsWith(resolve(process.env.TMPDIR)));
    }
  } finally {
    cleanupDirs(dirs);
  }
});

test("flag off refuses link without creating one", () => {
  const dirs = makeFixtureDirs();
  try {
    const keys = fixtureKeys("flagoff");
    const payload = payloadFor("nonce-flagoff");
    const challenge = challengeFor("nonce-flagoff");
    const signature = signTrunkAuthPayload(payload, keys.privateKeyPem);
    const trunk = new FakeTrunkEndpoint({ tenantId: TENANT, endpoint: ENDPOINT, meshId: MESH, env: {} });
    trunk.registerFixtureKey({ nodeId: NODE, publicKeyPem: keys.publicKeyPem, enrolmentRef: REF });
    const issued = trunk.issueChallenge(challenge);
    assert.equal(issued.ok, true);
    const refused = trunk.openLink({ challenge: issued.challenge, payload, signature });
    assert.deepEqual({ ok: refused.ok, reason: refused.reason }, { ok: false, reason: "remote-control-disabled" });
    assert.equal(trunk.liveLinkCount(), 0);
    assert.ok(!existsSync(join(dirs.storeRoot, "link.json")));
  } finally {
    cleanupDirs(dirs);
  }
});

test("production flag alone never opens the trunk fake", () => {
  const dirs = makeFixtureDirs();
  try {
    const keys = fixtureKeys("sealed");
    const payload = payloadFor("nonce-sealed");
    const signature = signTrunkAuthPayload(payload, keys.privateKeyPem);
    const trunk = new FakeTrunkEndpoint({ tenantId: TENANT, endpoint: ENDPOINT, meshId: MESH, env: { H2A_REMOTE_CONTROL: "1" } });
    trunk.registerFixtureKey({ nodeId: NODE, publicKeyPem: keys.publicKeyPem, enrolmentRef: REF });
    const issued = trunk.issueChallenge(challengeFor("nonce-sealed"));
    assert.equal(issued.ok, true);
    const refused = trunk.openLink({ challenge: issued.challenge, payload, signature });
    assert.equal(refused.ok, false);
    assert.equal(refused.reason, "fakes-sealed");
    assert.equal(trunk.liveLinkCount(), 0);
    // The enrolment fake is sealed the same way.
    const verifier = new FakeEnrolmentVerifier({ tenantId: TENANT, endpoint: ENDPOINT, env: { H2A_REMOTE_CONTROL: "1" } });
    verifier.registerNode({ nodeId: NODE, publicKeyPem: keys.publicKeyPem, fingerprint: "fp" });
    const enrolPayload = { nodeId: NODE, publicKeyPem: keys.publicKeyPem, deviceName: "dev", nonce: "n-sealed", meshId: MESH, tenantId: TENANT, endpoint: ENDPOINT };
    const enrolSig = signTrunkAuthPayload(enrolPayload, keys.privateKeyPem);
    assert.deepEqual(verifier.verifyRequest({ payload: enrolPayload, signature: enrolSig }), { ok: false, reason: "fakes-sealed" });
  } finally {
    cleanupDirs(dirs);
  }
});

test("fake handshake accepts fixture signature and refuses wrong key", () => {
  const dirs = makeFixtureDirs();
  try {
    const good = fixtureKeys("good");
    const bad = fixtureKeys("bad");
    const trunk = new FakeTrunkEndpoint({ tenantId: TENANT, endpoint: ENDPOINT, meshId: MESH, env: TEST_ENV });
    trunk.registerFixtureKey({ nodeId: NODE, publicKeyPem: good.publicKeyPem, enrolmentRef: REF });
    const payload = payloadFor("nonce-good");
    const signature = signTrunkAuthPayload(payload, good.privateKeyPem);
    assert.equal(verifyTrunkAuthPayload(payload, signature, good.publicKeyPem), true);
    assert.equal(verifyTrunkAuthPayload(payload, signature, bad.publicKeyPem), false);
    assert.equal(canonicalTrunkJson({ b: 2, a: 1 }), '{"a":1,"b":2}');
    const issued = trunk.issueChallenge(challengeFor("nonce-good"));
    assert.equal(issued.ok, true);
    const opened = trunk.openLink({ challenge: issued.challenge, payload, signature });
    assert.equal(opened.ok, true);
    assert.equal(trunk.liveLinkCount(), 1);
    const replay = trunk.openLink({ challenge: issued.challenge, payload, signature });
    assert.equal(replay.ok, false);
    assert.equal(replay.reason, "challenge-replayed");
    const wrongKeySig = signTrunkAuthPayload(payloadFor("nonce-wrong"), bad.privateKeyPem);
    const issuedWrong = trunk.issueChallenge(challengeFor("nonce-wrong"));
    assert.equal(issuedWrong.ok, true);
    const wrong = trunk.openLink({ challenge: issuedWrong.challenge, payload: payloadFor("nonce-wrong"), signature: wrongKeySig });
    assert.equal(wrong.ok, false);
    assert.equal(wrong.reason, "invalid-signature");
    const wrongTenant = trunk.issueChallenge({ ...challengeFor("nonce-tenant"), tenantId: "other-tenant" });
    assert.equal(wrongTenant.ok, false);
    assert.equal(wrongTenant.reason, "tenant-mismatch");
    const wrongMesh = trunk.issueChallenge({ ...challengeFor("nonce-mesh"), meshId: "other-mesh" });
    assert.equal(wrongMesh.ok, false);
    assert.equal(wrongMesh.reason, "mesh-mismatch");
  } finally {
    cleanupDirs(dirs);
  }
});

test("cross-tenant challenge replay is refused", () => {
  const dirs = makeFixtureDirs();
  try {
    const keys = fixtureKeys("cross-tenant");
    const trunk = new FakeTrunkEndpoint({ tenantId: TENANT, endpoint: ENDPOINT, meshId: MESH, env: TEST_ENV });
    trunk.registerFixtureKey({ nodeId: NODE, publicKeyPem: keys.publicKeyPem, enrolmentRef: REF });
    const issued = trunk.issueChallenge(challengeFor("nonce-cross"));
    assert.equal(issued.ok, true);
    const foreignPayload = { ...payloadFor("nonce-cross"), tenantId: "other-tenant" };
    const foreignSig = signTrunkAuthPayload(foreignPayload, keys.privateKeyPem);
    const foreign = trunk.openLink({ challenge: issued.challenge, payload: foreignPayload, signature: foreignSig });
    assert.equal(foreign.ok, false);
    assert.equal(foreign.reason, "tenant-mismatch");
    // A tampered challenge presented with a valid payload never opens.
    const tampered = { ...challengeFor("nonce-cross"), serverTime: SERVER_TIME + 1 };
    const payload = payloadFor("nonce-cross");
    const sig = signTrunkAuthPayload(payload, keys.privateKeyPem);
    const refused = trunk.openLink({ challenge: tampered, payload, signature: sig });
    assert.equal(refused.ok, false);
    assert.equal(refused.reason, "challenge-mismatch");
    assert.equal(trunk.liveLinkCount(), 0);
  } finally {
    cleanupDirs(dirs);
  }
});

test("canonicalTrunkJson omits undefined and rejects non-finite numbers", () => {
  assert.equal(canonicalTrunkJson({ b: undefined, a: 1 }), '{"a":1}');
  assert.throws(() => canonicalTrunkJson({ a: Number.NaN }), /canonicalize: non-finite/);
  assert.throws(() => canonicalTrunkJson({ a: Number.POSITIVE_INFINITY }), /canonicalize: non-finite/);
});

test("fake enrolment verifier checks possession and assurance", () => {
  const dirs = makeFixtureDirs();
  try {
    const good = fixtureKeys("enrol-good");
    const bad = fixtureKeys("enrol-bad");
    const verifier = new FakeEnrolmentVerifier({ tenantId: TENANT, endpoint: ENDPOINT, env: TEST_ENV });
    verifier.registerNode({ nodeId: NODE, publicKeyPem: good.publicKeyPem, fingerprint: "fixture-fingerprint-1" });
    const payload = { nodeId: NODE, publicKeyPem: good.publicKeyPem, deviceName: "fixture-device", nonce: "nonce-enrol-1", meshId: MESH, tenantId: TENANT, endpoint: ENDPOINT };
    const goodSig = signTrunkAuthPayload(payload, good.privateKeyPem);
    assert.deepEqual(verifier.verifyRequest({ payload, signature: goodSig }).ok, true);
    const badPayload = { ...payload, nonce: "nonce-enrol-2" };
    const badSig = signTrunkAuthPayload(badPayload, bad.privateKeyPem);
    const badResult = verifier.verifyRequest({ payload: badPayload, signature: badSig });
    assert.equal(badResult.ok, false);
    assert.equal(badResult.reason, "invalid-signature");
    const refused = verifier.approve({ nodeId: NODE, approval: { client: "remote", acr: "phr", amr: ["user"], authTime: SERVER_TIME }, usages: ["sessions.operate"], now: SERVER_TIME });
    assert.equal(refused.ok, false);
    assert.equal(refused.reason, "assurance-insufficient");
    const approved = verifier.approve({ nodeId: NODE, approval: { client: "remote", acr: "urn:sentropic:loa:passkey-fresh", amr: ["hwk", "user", "mfa"], authTime: SERVER_TIME }, usages: ["sessions.operate"], now: SERVER_TIME });
    assert.equal(approved.ok, true);
    assert.equal(verifier.isLive(NODE), true);
    verifier.revoke({ nodeId: NODE });
    assert.equal(verifier.isLive(NODE), false);
  } finally {
    cleanupDirs(dirs);
  }
});

test("enrolment fake refuses when the flag is off", () => {
  const dirs = makeFixtureDirs();
  try {
    const keys = fixtureKeys("enrol-flagoff");
    const verifier = new FakeEnrolmentVerifier({ tenantId: TENANT, endpoint: ENDPOINT, env: {} });
    verifier.registerNode({ nodeId: NODE, publicKeyPem: keys.publicKeyPem, fingerprint: "fp" });
    const payload = { nodeId: NODE, publicKeyPem: keys.publicKeyPem, deviceName: "dev", nonce: "n-flagoff", meshId: MESH, tenantId: TENANT, endpoint: ENDPOINT };
    const sig = signTrunkAuthPayload(payload, keys.privateKeyPem);
    assert.deepEqual(verifier.verifyRequest({ payload, signature: sig }), { ok: false, reason: "remote-control-disabled" });
    const approved = verifier.approve({ nodeId: NODE, approval: { client: "remote", acr: "urn:sentropic:loa:passkey-fresh", amr: ["hwk", "user", "mfa"], authTime: SERVER_TIME }, usages: ["sessions.operate"], now: SERVER_TIME });
    assert.deepEqual(approved, { ok: false, reason: "remote-control-disabled" });
  } finally {
    cleanupDirs(dirs);
  }
});

test("enrolment approve requires prior proof of possession", () => {
  const dirs = makeFixtureDirs();
  try {
    const keys = fixtureKeys("enrol-possession");
    const verifier = new FakeEnrolmentVerifier({ tenantId: TENANT, endpoint: ENDPOINT, env: TEST_ENV });
    verifier.registerNode({ nodeId: NODE, publicKeyPem: keys.publicKeyPem, fingerprint: "fp" });
    const approval = { client: "remote", acr: "urn:sentropic:loa:passkey-fresh", amr: ["hwk", "user", "mfa"], authTime: SERVER_TIME };
    const refused = verifier.approve({ nodeId: NODE, approval, usages: ["sessions.operate"], now: SERVER_TIME });
    assert.equal(refused.ok, false);
    assert.equal(refused.reason, "not-verified");
    assert.equal(verifier.isLive(NODE), false);
  } finally {
    cleanupDirs(dirs);
  }
});

test("enrolment nonce is consumed after one successful verify", () => {
  const dirs = makeFixtureDirs();
  try {
    const keys = fixtureKeys("enrol-nonce");
    const verifier = new FakeEnrolmentVerifier({ tenantId: TENANT, endpoint: ENDPOINT, env: TEST_ENV });
    verifier.registerNode({ nodeId: NODE, publicKeyPem: keys.publicKeyPem, fingerprint: "fp" });
    const payload = { nodeId: NODE, publicKeyPem: keys.publicKeyPem, deviceName: "dev", nonce: "n-once", meshId: MESH, tenantId: TENANT, endpoint: ENDPOINT };
    const sig = signTrunkAuthPayload(payload, keys.privateKeyPem);
    assert.deepEqual(verifier.verifyRequest({ payload, signature: sig }), { ok: true });
    assert.deepEqual(verifier.verifyRequest({ payload, signature: sig }), { ok: false, reason: "nonce-replayed" });
  } finally {
    cleanupDirs(dirs);
  }
});

test("enrolment binds tenant, endpoint and presented key", () => {
  const dirs = makeFixtureDirs();
  try {
    const keys = fixtureKeys("enrol-bind");
    const other = fixtureKeys("enrol-bind-other");
    const verifier = new FakeEnrolmentVerifier({ tenantId: TENANT, endpoint: ENDPOINT, env: TEST_ENV });
    verifier.registerNode({ nodeId: NODE, publicKeyPem: keys.publicKeyPem, fingerprint: "fp" });
    const base = { nodeId: NODE, publicKeyPem: keys.publicKeyPem, deviceName: "dev", nonce: "n-bind", meshId: MESH, tenantId: TENANT, endpoint: ENDPOINT };
    const keyMismatchSig = signTrunkAuthPayload({ ...base, publicKeyPem: other.publicKeyPem }, keys.privateKeyPem);
    assert.deepEqual(
      verifier.verifyRequest({ payload: { ...base, publicKeyPem: other.publicKeyPem }, signature: keyMismatchSig }),
      { ok: false, reason: "key-mismatch" }
    );
    const tenantPayload = { ...base, nonce: "n-bind-tenant", tenantId: "other-tenant" };
    assert.deepEqual(
      verifier.verifyRequest({ payload: tenantPayload, signature: signTrunkAuthPayload(tenantPayload, keys.privateKeyPem) }),
      { ok: false, reason: "tenant-mismatch" }
    );
    const endpointPayload = { ...base, nonce: "n-bind-endpoint", endpoint: "https://other.example/trunk/v1" };
    assert.deepEqual(
      verifier.verifyRequest({ payload: endpointPayload, signature: signTrunkAuthPayload(endpointPayload, keys.privateKeyPem) }),
      { ok: false, reason: "endpoint-mismatch" }
    );
  } finally {
    cleanupDirs(dirs);
  }
});

test("enrolment approve enforces fresh authTime and remote client", () => {
  const dirs = makeFixtureDirs();
  try {
    const keys = fixtureKeys("enrol-fresh");
    const verifier = new FakeEnrolmentVerifier({ tenantId: TENANT, endpoint: ENDPOINT, env: TEST_ENV });
    verifier.registerNode({ nodeId: NODE, publicKeyPem: keys.publicKeyPem, fingerprint: "fp" });
    const payload = { nodeId: NODE, publicKeyPem: keys.publicKeyPem, deviceName: "dev", nonce: "n-fresh", meshId: MESH, tenantId: TENANT, endpoint: ENDPOINT };
    assert.deepEqual(verifier.verifyRequest({ payload, signature: signTrunkAuthPayload(payload, keys.privateKeyPem) }), { ok: true });
    const stale = verifier.approve({
      nodeId: NODE,
      approval: { client: "remote", acr: "urn:sentropic:loa:passkey-fresh", amr: ["hwk", "user", "mfa"], authTime: SERVER_TIME },
      usages: ["sessions.operate"],
      now: SERVER_TIME + 11 * 60 * 1000
    });
    assert.deepEqual(stale, { ok: false, reason: "approval-stale" });
    const wrongClient = verifier.approve({
      nodeId: NODE,
      approval: { client: "other", acr: "urn:sentropic:loa:passkey-fresh", amr: ["hwk", "user", "mfa"], authTime: SERVER_TIME },
      usages: ["sessions.operate"],
      now: SERVER_TIME
    });
    assert.deepEqual(wrongClient, { ok: false, reason: "client-mismatch" });
  } finally {
    cleanupDirs(dirs);
  }
});

test("catalogue snapshot round-trips through projector types", () => {
  const dirs = makeFixtureDirs();
  try {
    const native = fixtureSession("sess-native", { cwd: "/hostile/home/secret", command: "hostile-command", nativePty: { session: "h2a-x" } });
    const tmuxed = fixtureSession("sess-tmux", { cwd: "/hostile/home", command: "hostile", tmux: { session: "h2a-y", pane: "%1" } });
    const unknown = fixtureSession("sess-unknown", { cwd: "/hostile", command: "hostile" });
    const snapshot = buildCatalogueSnapshot([native, tmuxed, unknown], { at: 1700000000000 });
    assert.equal(snapshot.t, "cat.snapshot");
    assert.equal(snapshot.rows.length, 3);
    const nativeRow = snapshot.rows.find((r) => r.sessionId === "sess-native");
    assert.equal(nativeRow.hostKind, "native");
    assert.equal(nativeRow.operable, true);
    const tmuxRow = snapshot.rows.find((r) => r.sessionId === "sess-tmux");
    assert.equal(tmuxRow.hostKind, "tmux");
    assert.equal(tmuxRow.operable, false);
    const serialized = serializeCatalogueSnapshot(snapshot);
    const parsed = parseCatalogueSnapshot(serialized);
    assert.deepEqual(parsed, snapshot);
    assert.equal(containsForbiddenLocalField(snapshot), false);
    assert.ok(!serialized.includes("/hostile"));
    assert.ok(!serialized.includes("hostile-command"));
    const manual = projectCatalogueRow(native);
    assert.equal(manual.hostKind, "native");
    assert.ok(!JSON.stringify(manual).includes("hostile"));
  } finally {
    cleanupDirs(dirs);
  }
});

test("catalogue parse rejects keys outside the whitelist", () => {
  const dirs = makeFixtureDirs();
  try {
    const native = fixtureSession("sess-wl", { cwd: "/x", command: "y", nativePty: { session: "h2a-w" } });
    const snapshot = buildCatalogueSnapshot([native], { at: 1700000000000 });
    for (const hostile of ["path", "env", "endpoints", "pid", "commandLine", "coordinates", "fileEndpoint", "extra"]) {
      const tampered = JSON.parse(serializeCatalogueSnapshot(snapshot));
      tampered.rows[0][hostile] = "hostile-value";
      assert.throws(() => parseCatalogueSnapshot(JSON.stringify(tampered)), TypeError, `row key ${hostile} must be rejected`);
    }
    const tamperedEnvelope = JSON.parse(serializeCatalogueSnapshot(snapshot));
    tamperedEnvelope.endpoints = ["https://evil.example"];
    assert.throws(() => parseCatalogueSnapshot(JSON.stringify(tamperedEnvelope)), TypeError);
    assert.deepEqual(parseCatalogueSnapshot(serializeCatalogueSnapshot(snapshot)), snapshot);
  } finally {
    cleanupDirs(dirs);
  }
});

test("inventory reports native, tmux and unknown shares from fixtures", () => {
  const dirs = makeFixtureDirs();
  try {
    const native1 = fixtureSession("inv-native-1", { cwd: "/tmp/f", command: "x", nativePty: { session: "h2a-a" } });
    const native2 = fixtureSession("inv-native-2", { cwd: "/tmp/f", command: "x", nativePty: { session: "h2a-b" } });
    const tmuxed = fixtureSession("inv-tmux-1", { cwd: "/tmp/f", command: "x", tmux: { session: "h2a-c", pane: "%2" } });
    const unknown = fixtureSession("inv-unknown-1", { cwd: "/tmp/f", command: "x" });
    const registryOnly = { id: "reg-1", instance: "claude:reg-only:abcdef123456", roles: [], scopes: [], capabilities: [], endpoints: [], publicKeys: [], acceptedPolicies: [], createdAt: "2026-11-16T10:00:00.000Z" };
    const inventory = buildFleetInventory({ sessions: [native1, native2, tmuxed, unknown], registrations: [registryOnly], env: {} });
    assert.equal(inventory.total, 5);
    assert.equal(inventory.native, 2);
    assert.equal(inventory.tmux, 1);
    assert.equal(inventory.unknown, 2);
    assert.equal(inventory.fleetValve, "native");
    assert.equal(inventory.defaultHostForNew, "native");
    assert.equal(inventory.presenceCoverage.withPresence, 4);
    assert.equal(inventory.presenceCoverage.withoutPresence, 1);
    assert.ok(Math.abs(inventory.shares.native - 0.4) < 1e-9);
    assert.ok(Math.abs(inventory.shares.tmux - 0.2) < 1e-9);
    assert.ok(Math.abs(inventory.shares.unknown - 0.4) < 1e-9);
    const tmuxValve = buildFleetInventory({ sessions: [native1], registrations: [], env: { H2A_SESSION_HOST: "TMUX" } });
    assert.equal(tmuxValve.fleetValve, "tmux");
    assert.equal(tmuxValve.defaultHostForNew, "tmux");
    assert.equal(resolveFleetValve({}), "native");
    assert.equal(resolveFleetValve({ H2A_SESSION_HOST: "tmux" }), "tmux");
    assert.equal(classifyLaunchHost({ cwd: "/x", command: "y", nativePty: { session: "s" } }), "native");
    assert.equal(classifyLaunchHost({ cwd: "/x", command: "y", tmux: { session: "s", pane: "%1" } }), "tmux");
    assert.equal(classifyLaunchHost({ cwd: "/x", command: "y" }), "unknown");
    assert.equal(classifyLaunchHost(undefined), "unknown");
  } finally {
    cleanupDirs(dirs);
  }
});

test("inventory dedupes registry journal history per instance", () => {
  const dirs = makeFixtureDirs();
  try {
    const native = fixtureSession("inv-dedupe", { cwd: "/tmp/f", command: "x", nativePty: { session: "h2a-d" } });
    const repeated = Array.from({ length: 30 }, (_, i) => ({
      id: `reg-dup-${i}`,
      instance: "claude:reg-dup:abcdef123456",
      roles: [], scopes: [], capabilities: [], endpoints: [], publicKeys: [], acceptedPolicies: [],
      createdAt: "2026-11-16T10:00:00.000Z"
    }));
    const covered = { id: "reg-covered", instance: native.instance, roles: [], scopes: [], capabilities: [], endpoints: [], publicKeys: [], acceptedPolicies: [], createdAt: "2026-11-16T10:00:00.000Z" };
    const inventory = buildFleetInventory({ sessions: [native], registrations: [...repeated, covered], env: {} });
    assert.equal(inventory.total, 2);
    assert.equal(inventory.native, 1);
    assert.equal(inventory.unknown, 1);
    assert.ok(Math.abs(inventory.shares.native - 0.5) < 1e-9);
    assert.equal(inventory.presenceCoverage.withPresence, 1);
    assert.equal(inventory.presenceCoverage.withoutPresence, 1);
  } finally {
    cleanupDirs(dirs);
  }
});

test("inventory from root reads fixture files only", () => {
  const dirs = makeFixtureDirs();
  try {
    const presenceDir = join(dirs.storeRoot, "presence");
    const registryDir = join(dirs.storeRoot, "registry");
    mkdirSync(presenceDir, { recursive: true });
    mkdirSync(registryDir, { recursive: true });
    const native = fixtureSession("root-native", { cwd: "/fixture", command: "fixture", nativePty: { session: "h2a-root" } });
    const unknown = fixtureSession("root-unknown", { cwd: "/fixture", command: "fixture" });
    writeFileSync(join(presenceDir, "root-native.json"), `${JSON.stringify(native)}\n`, "utf8");
    writeFileSync(join(presenceDir, "root-unknown.json"), `${JSON.stringify(unknown)}\n`, "utf8");
    const reg = { id: "reg-root", instance: "claude:root-reg:abcdef123456", roles: [], scopes: [], capabilities: [], endpoints: [], publicKeys: [], acceptedPolicies: [], createdAt: "2026-11-16T10:00:00.000Z" };
    writeFileSync(join(registryDir, "instances.jsonl"), `${JSON.stringify(reg)}\n`, "utf8");
    const inventory = buildFleetInventoryFromRoot(dirs.storeRoot, {}, { now: FIXTURE_NOW });
    assert.equal(inventory.total, 3);
    assert.equal(inventory.native, 1);
    assert.equal(inventory.unknown, 2);
    assert.equal(inventory.presenceCoverage.withPresence, 2);
    assert.equal(inventory.presenceCoverage.withoutPresence, 1);
    const left = readdirSync(dirs.runtimeDir);
    assert.deepEqual(left, []);
    for (const p of [dirs.storeRoot, dirs.runtimeDir]) {
      assert.ok(resolve(p).startsWith(resolve(process.env.TMPDIR)));
    }
  } finally {
    cleanupDirs(dirs);
  }
});

test("inventory from root excludes expired presences from shares and coverage", () => {
  const dirs = makeFixtureDirs();
  try {
    const presenceDir = join(dirs.storeRoot, "presence");
    const registryDir = join(dirs.storeRoot, "registry");
    mkdirSync(presenceDir, { recursive: true });
    mkdirSync(registryDir, { recursive: true });
    const fresh = fixtureSession("root-fresh", { cwd: "/fixture", command: "fixture", nativePty: { session: "h2a-fresh" } });
    const stale = { ...fixtureSession("root-stale", { cwd: "/fixture", command: "fixture", nativePty: { session: "h2a-stale" } }), heartbeatAt: "2026-11-16T09:00:00.000Z" };
    writeFileSync(join(presenceDir, "root-fresh.json"), `${JSON.stringify(fresh)}\n`, "utf8");
    writeFileSync(join(presenceDir, "root-stale.json"), `${JSON.stringify(stale)}\n`, "utf8");
    const inventory = buildFleetInventoryFromRoot(dirs.storeRoot, {}, { now: FIXTURE_NOW });
    assert.equal(inventory.total, 1);
    assert.equal(inventory.native, 1);
    assert.equal(inventory.tmux, 0);
    assert.equal(inventory.unknown, 0);
    assert.equal(inventory.presenceCoverage.withPresence, 1);
    assert.equal(inventory.presenceCoverage.withoutPresence, 0);
    assert.equal(inventory.presenceCoverage.ratio, 1);
  } finally {
    cleanupDirs(dirs);
  }
});
