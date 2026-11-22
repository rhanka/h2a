// LH-07 outbound trunk client and link authentication.
// Every case runs under a disposable TMPDIR (never /tmp, never owner ~/.config).

import assert from "node:assert/strict";
import test from "node:test";
import { createHash, generateKeyPairSync, randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { join, resolve } from "node:path";

import { runCli, createMcpServer, createLocalStore } from "../dist/index.js";
import {
  generateNodeKey,
  loadNodeKey,
  isRemoteControlKilledByEnv,
  isTrunkRecord,
  runRemoteControlVerb,
  setRemoteControlKillFlag,
  readRemoteControlKillFlag,
  signTrunkAuthPayload,
  TrunkClient,
  TrunkCreditManager,
  readLinkStatusFile,
  writeLinkStatusFile,
  readRevokedInstancesRegistry,
  persistRevokedInstancesRegistry,
  extractRawEd25519PublicKeyBase64,
  formatWET2Fingerprint,
  isWireInstanceId,
  wireInstanceId
} from "../dist/runtime/remote-agent/index.js";
import * as trunkFakes from "./helpers/remote-trunk-fakes.js";
import {
  FakeBinaryTrunkPeer,
  FakeCatalogueDouble,
  FakeClock,
  PINNED_WET2_TEXT_HASH,
  createSimulatedTrunkContractProvider,
  verifyIndependentAuthSignature
} from "./helpers/remote-trunk-peer.js";

const MESH = "remote-test";
const TENANT = "tenant-a";
const ENDPOINT = "wss://remote.sent-tech.ca/trunk/v1";
const TEST_ENV = { H2A_REMOTE_CONTROL: "1", H2A_TEST_FAKES: "1" };

function makeIsolation() {
  assert.ok(process.env.TMPDIR && resolve(process.env.TMPDIR) !== "/tmp", "Supply a disposable TMPDIR");
  const base = mkdtempSync(join(process.env.TMPDIR, "lh07-"));
  const root = join(base, "root");
  const configDir = join(base, "config");
  mkdirSync(root, { recursive: true });
  mkdirSync(configDir, { recursive: true });
  return { base, root, configDir };
}

function cleanup(dirs) {
  rmSync(dirs.base, { recursive: true, force: true });
}

function captureStreams() {
  let stdout = "";
  let stderr = "";
  return {
    streams: {
      stdout: { write: (c) => void (stdout += c) },
      stderr: { write: (c) => void (stderr += c) },
      cwd: () => process.cwd()
    },
    out: () => stdout,
    err: () => stderr
  };
}

function createRegisteredInstance(root, instanceId, { idOverride, writeKeys = true } = {}) {
  const keysDir = join(root, "keys");
  const regDir = join(root, "registry");
  mkdirSync(keysDir, { recursive: true });
  mkdirSync(regDir, { recursive: true });
  const pair = generateKeyPairSync("ed25519", {
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" }
  });
  const keyName = instanceId.replace(/[:/]/g, "-");
  if (writeKeys) {
    writeFileSync(join(keysDir, `${keyName}.key.pem`), pair.privateKey, { mode: 0o600 });
    writeFileSync(join(keysDir, `${keyName}.pub.pem`), pair.publicKey, { mode: 0o600 });
  }
  const row = {
    id: idOverride ?? instanceId,
    instance: instanceId,
    roles: ["AGENTS"],
    scopes: [],
    capabilities: [],
    endpoints: [{ kind: "local-files", uri: `file://${root}` }],
    publicKeys: [pair.publicKey],
    acceptedPolicies: [],
    createdAt: "2026-11-21T10:00:00.000Z"
  };
  const instancesFile = join(regDir, "instances.jsonl");
  const existing = existsSync(instancesFile) ? readFileSync(instancesFile, "utf8") : "";
  writeFileSync(instancesFile, `${existing}${JSON.stringify(row)}\n`, "utf8");
  return { instanceId, privateKeyPem: pair.privateKey, publicKeyPem: pair.publicKey };
}

function sampleRow(sessionId, instanceId, instanceStatus = "live") {
  const wireId = isWireInstanceId(instanceId) ? instanceId : wireInstanceId(instanceId);
  return {
    sessionId,
    instance: instanceId,
    instanceId: wireId,
    instanceStatus,
    host: "claude",
    name: `sess-${sessionId}`,
    startedAt: "2026-11-21T10:00:00.000Z",
    heartbeatAt: "2026-11-21T10:00:10.000Z",
    state: "live",
    workStatus: "working",
    hostKind: "native",
    operable: true
  };
}

function makeClientFixture(overrides = {}) {
  const dirs = makeIsolation();
  const clock = overrides.clock ?? new FakeClock(1_700_000_000_000);
  const key = overrides.skipKeyGen ? null : generateNodeKey({ configDir: dirs.configDir });
  const nodeId = overrides.nodeId ?? (key?.state === "present" ? key.nodeId : "node:missing");
  const enrolmentRef = overrides.enrolmentRef ?? "enr-1";
  const env = overrides.env ?? { ...TEST_ENV };
  const contract = overrides.omitContract ? undefined : (overrides.contract ?? createSimulatedTrunkContractProvider());
  const peer = overrides.peer ?? new FakeBinaryTrunkPeer({
    meshId: overrides.meshId ?? MESH,
    tenantId: overrides.tenantId ?? TENANT,
    endpoint: overrides.endpoint ?? ENDPOINT,
    clock,
    env: overrides.peerEnv ?? TEST_ENV,
    contract: contract ?? createSimulatedTrunkContractProvider(),
    nonceGenerator: overrides.nonceGenerator
  });
  if (!overrides.skipRegister && key?.state === "present") {
    peer.registerEnrolment({
      nodeId: key.nodeId,
      enrolmentRef,
      publicKeyPem: key.publicKeyPem,
      fingerprint: key.fingerprint,
      ...(overrides.enrolmentMeta ?? {})
    });
  }
  const catalogue = overrides.catalogue ?? new FakeCatalogueDouble({
    clock,
    initialRows: overrides.initialRows ?? [
      sampleRow("n-a", "inst-A"),
      sampleRow("n-b", "inst-B")
    ]
  });
  const audits = [];
  const linkEvents = [];
  const revokedCallbacks = [];
  const enrolment = {
    meshId: overrides.meshId ?? MESH,
    endpoint: overrides.endpoint ?? ENDPOINT,
    tenantId: overrides.tenantId ?? TENANT,
    enrolmentRef,
    nodeId
  };
  const client = new TrunkClient({
    root: dirs.root,
    env,
    enrolment,
    nodeKeyOptions: { configDir: dirs.configDir },
    connector: overrides.connector ?? peer.createConnector(overrides.clientTag ?? "client-1"),
    ...(contract !== undefined ? { contract } : {}),
    clock,
    random: overrides.random ?? (() => 0.5),
    catalogue,
    ...(overrides.terminalConsumer ? { terminalConsumer: overrides.terminalConsumer } : {}),
    onEnrolmentRevoked: (enr) => revokedCallbacks.push(enr),
    onAudit: (ev) => audits.push(ev),
    onLinkEvent: (ev) => linkEvents.push(ev)
  });
  return { dirs, clock, key, peer, catalogue, client, enrolment, env, audits, linkEvents, revokedCallbacks };
}

// ============================================================================
// 0. Common WET-2 fixture hash & contract-unavailable / sealed fakes
// ============================================================================

test("common fixture exposes pinned wet2TextHash and refuses mismatched version or production-only flag", () => {
  assert.equal(trunkFakes.WET2_TEXT_HASH, PINNED_WET2_TEXT_HASH);
  assert.throws(
    () => createSimulatedTrunkContractProvider({ wet2TextHash: "0000000000000000000000000000000000000000000000000000000000000000" }),
    /wet2TextHash/
  );
  // Production flag alone (without H2A_TEST_FAKES=1) must refuse fake trunk & peer
  const fx = makeClientFixture({
    env: { H2A_REMOTE_CONTROL: "1" },
    peerEnv: { H2A_REMOTE_CONTROL: "1" }
  });
  try {
    assert.throws(() => fx.peer.createConnector("prod-only").open(ENDPOINT, { onMessage() {}, onClose() {}, onError() {} }), /fakes-sealed/);
  } finally {
    cleanup(fx.dirs);
  }
  // Missing contract provider after guards pass -> contract-unavailable before any connection
  const noContract = makeClientFixture({ omitContract: true });
  try {
    const res = noContract.client.start();
    assert.equal(res.ok, false);
    assert.equal(res.reason, "contract-unavailable");
    assert.equal(noContract.peer.attemptsFor("client-1"), 0);
  } finally {
    cleanup(noContract.dirs);
  }
});

// ============================================================================
// 1. Clé et défi
// ============================================================================

test("key and challenge: authenticates with LH-01 key, verifies bytes independently, refuses wrong/expired/replayed/tampered/cross-tenant/cross-endpoint/missing/invalid keys", () => {
  // 1a. Positive handshake with LH-01 key
  const fx = makeClientFixture();
  try {
    const started = fx.client.start();
    assert.equal(started.ok, true);
    assert.equal(fx.client.getState(), "ready");
    assert.equal(fx.client.getLinkGeneration(), 1);
    assert.equal(fx.peer.liveLinkCount(), 1);
    const conn = fx.peer.allConnections()[0];
    const hello = conn.decodedServerRecords.find((r) => r.t === "hello");
    const auth = conn.decodedClientRecords.find((r) => r.t === "auth");
    assert.ok(hello, "peer must send hello");
    assert.ok(auth, "client must emit auth after hello");
    assert.equal(auth.ch, 0);
    assert.equal(auth.s, 1);
    assert.equal(verifyIndependentAuthSignature(auth, hello, fx.key.publicKeyPem), true);
    // Wire payload carries no private key, token or cookie
    const authRaw = conn.observedClientFrames[0].toString("utf8");
    assert.equal(/(BEGIN PRIVATE KEY|cookie|bearer|token)/i.test(authRaw), false);
    // Nonce >= 128 bits
    assert.ok(Buffer.from(hello.nonce, "base64url").byteLength >= 16);
    fx.client.stop();
  } finally {
    cleanup(fx.dirs);
  }

  // 1b. Wrong key -> no ready link, stops retrying
  const wrongKeyDirs = makeIsolation();
  try {
    const otherKey = generateNodeKey({ configDir: wrongKeyDirs.configDir });
    const fxWrong = makeClientFixture({ skipRegister: true });
    try {
      fxWrong.peer.registerEnrolment({
        nodeId: fxWrong.key.nodeId,
        enrolmentRef: fxWrong.enrolment.enrolmentRef,
        publicKeyPem: otherKey.publicKeyPem
      });
      fxWrong.client.start();
      assert.notEqual(fxWrong.client.getState(), "ready");
      assert.equal(fxWrong.peer.liveLinkCount(), 0);
      fxWrong.clock.advance(120_000);
      assert.equal(fxWrong.peer.attemptsFor("client-1"), 1, "definitive auth refusal must not retry");
    } finally {
      cleanup(fxWrong.dirs);
    }
  } finally {
    cleanup(wrongKeyDirs);
  }

  // 1c. Expired challenge (> 60 s) & consumed/replayed challenge & tampered signed field
  {
    const clock = new FakeClock(1_700_000_000_000);
    const dirs = makeIsolation();
    try {
      const key = generateNodeKey({ configDir: dirs.configDir });
      const fixedNonce = randomBytes(16).toString("base64url");
      const peer = new FakeBinaryTrunkPeer({
        meshId: MESH,
        tenantId: TENANT,
        endpoint: ENDPOINT,
        clock,
        env: TEST_ENV,
        nonceGenerator: () => fixedNonce
      });
      peer.registerEnrolment({ nodeId: key.nodeId, enrolmentRef: "enr-exp", publicKeyPem: key.publicKeyPem });

      // Intercept connector to delay auth by 61 s -> challenge expired
      const baseConnector = peer.createConnector("exp-client");
      let capturedConn = null;
      const delayedConnector = {
        open(endpoint, handlers) {
          capturedConn = baseConnector.open(endpoint, {
            ...handlers,
            onMessage(frame) {
              clock.advance(61_000);
              handlers.onMessage(frame);
            }
          });
          return capturedConn;
        }
      };
      const expiredClient = new TrunkClient({
        root: dirs.root,
        env: TEST_ENV,
        enrolment: { meshId: MESH, endpoint: ENDPOINT, tenantId: TENANT, enrolmentRef: "enr-exp", nodeId: key.nodeId },
        nodeKeyOptions: { configDir: dirs.configDir },
        connector: delayedConnector,
        contract: peer.contract,
        clock,
        catalogue: new FakeCatalogueDouble({ clock })
      });
      expiredClient.start();
      assert.notEqual(expiredClient.getState(), "ready");
      assert.equal(peer.liveLinkCount(), 0);

      // Tampered signed field (mutate clientTime after signing)
      const peerTamper = new FakeBinaryTrunkPeer({ meshId: MESH, tenantId: TENANT, endpoint: ENDPOINT, clock, env: TEST_ENV });
      peerTamper.registerEnrolment({ nodeId: key.nodeId, enrolmentRef: "enr-tamp", publicKeyPem: key.publicKeyPem });
      const rawConnector = peerTamper.createConnector("tamper");
      const tamperConnector = {
        open(endpoint, handlers) {
          const inner = rawConnector.open(endpoint, handlers);
          return {
            send(frame) {
              const dec = peerTamper.contract.decodeFrame(frame);
              if (dec.ok && dec.record.t === "auth") {
                const mutated = peerTamper.contract.encodeFrame({ ...dec.record, clientTime: dec.record.clientTime + 1 });
                inner.send(mutated);
                return;
              }
              inner.send(frame);
            },
            close(r) { inner.close(r); }
          };
        }
      };
      const tamperClient = new TrunkClient({
        root: dirs.root,
        env: TEST_ENV,
        enrolment: { meshId: MESH, endpoint: ENDPOINT, tenantId: TENANT, enrolmentRef: "enr-tamp", nodeId: key.nodeId },
        nodeKeyOptions: { configDir: dirs.configDir },
        connector: tamperConnector,
        contract: peerTamper.contract,
        clock,
        catalogue: new FakeCatalogueDouble({ clock })
      });
      tamperClient.start();
      assert.notEqual(tamperClient.getState(), "ready");
      assert.equal(peerTamper.liveLinkCount(), 0);

      // Consumed challenge replay: first client succeeds with fixedNonce, second presenting same nonce fails
      const peerReplay = new FakeBinaryTrunkPeer({
        meshId: MESH,
        tenantId: TENANT,
        endpoint: ENDPOINT,
        clock,
        env: TEST_ENV,
        nonceGenerator: () => fixedNonce
      });
      peerReplay.registerEnrolment({ nodeId: key.nodeId, enrolmentRef: "enr-rep", publicKeyPem: key.publicKeyPem });
      const c1 = new TrunkClient({
        root: dirs.root,
        env: TEST_ENV,
        enrolment: { meshId: MESH, endpoint: ENDPOINT, tenantId: TENANT, enrolmentRef: "enr-rep", nodeId: key.nodeId },
        nodeKeyOptions: { configDir: dirs.configDir },
        connector: peerReplay.createConnector("r1"),
        contract: peerReplay.contract,
        clock,
        catalogue: new FakeCatalogueDouble({ clock })
      });
      c1.start();
      assert.equal(c1.getState(), "ready");
      const c2 = new TrunkClient({
        root: dirs.root,
        env: TEST_ENV,
        enrolment: { meshId: MESH, endpoint: ENDPOINT, tenantId: TENANT, enrolmentRef: "enr-rep", nodeId: key.nodeId },
        nodeKeyOptions: { configDir: dirs.configDir },
        connector: peerReplay.createConnector("r2"),
        contract: peerReplay.contract,
        clock,
        catalogue: new FakeCatalogueDouble({ clock })
      });
      c2.start();
      assert.notEqual(c2.getState(), "ready");
      c1.stop();
    } finally {
      cleanup(dirs);
    }
  }

  // 1d. Cross-tenant & cross-endpoint replay with SAME key, SAME nonce, SAME clock
  for (const kind of ["tenant", "endpoint"]) {
    const dirs = makeIsolation();
    try {
      const key = generateNodeKey({ configDir: dirs.configDir });
      const sharedNonce = randomBytes(16).toString("base64url");
      const clock = new FakeClock(1_700_000_000_000);
      const endpointB = kind === "endpoint" ? "wss://other.sent-tech.ca/trunk/v1" : ENDPOINT;
      const tenantB = kind === "tenant" ? "tenant-b" : TENANT;

      // Positive witness on Peer A
      const peerA = new FakeBinaryTrunkPeer({
        meshId: MESH, tenantId: TENANT, endpoint: ENDPOINT, clock, env: TEST_ENV, nonceGenerator: () => sharedNonce
      });
      peerA.registerEnrolment({ nodeId: key.nodeId, enrolmentRef: "enr-x", publicKeyPem: key.publicKeyPem });
      const clientA = new TrunkClient({
        root: dirs.root,
        env: TEST_ENV,
        enrolment: { meshId: MESH, endpoint: ENDPOINT, tenantId: TENANT, enrolmentRef: "enr-x", nodeId: key.nodeId },
        nodeKeyOptions: { configDir: dirs.configDir },
        connector: peerA.createConnector("a"),
        contract: peerA.contract,
        clock,
        catalogue: new FakeCatalogueDouble({ clock })
      });
      clientA.start();
      assert.equal(clientA.getState(), "ready", `${kind} witness A must succeed`);
      const signedAuthFrameFromA = peerA.allConnections()[0].observedClientFrames[0];
      clientA.stop();

      // Positive witness on Peer B
      const peerBWitness = new FakeBinaryTrunkPeer({
        meshId: MESH, tenantId: tenantB, endpoint: endpointB, clock, env: TEST_ENV, nonceGenerator: () => sharedNonce
      });
      peerBWitness.registerEnrolment({ nodeId: key.nodeId, enrolmentRef: "enr-x", publicKeyPem: key.publicKeyPem });
      const clientB = new TrunkClient({
        root: dirs.root,
        env: TEST_ENV,
        enrolment: { meshId: MESH, endpoint: endpointB, tenantId: tenantB, enrolmentRef: "enr-x", nodeId: key.nodeId },
        nodeKeyOptions: { configDir: dirs.configDir },
        connector: peerBWitness.createConnector("b-witness"),
        contract: peerBWitness.contract,
        clock,
        catalogue: new FakeCatalogueDouble({ clock })
      });
      clientB.start();
      assert.equal(clientB.getState(), "ready", `${kind} witness B must succeed`);
      clientB.stop();

      // Now replay A's signed auth bytes onto a fresh Peer B with identical key/nonce/clock -> MUST FAIL!
      const peerBCross = new FakeBinaryTrunkPeer({
        meshId: MESH, tenantId: tenantB, endpoint: endpointB, clock, env: TEST_ENV, nonceGenerator: () => sharedNonce
      });
      peerBCross.registerEnrolment({ nodeId: key.nodeId, enrolmentRef: "enr-x", publicKeyPem: key.publicKeyPem });
      let crossReady = false;
      const crossConn = peerBCross.createConnector("cross").open(endpointB, {
        onMessage(frame) {
          const dec = peerBCross.contract.decodeFrame(frame);
          if (dec.ok && dec.record.t === "ready") crossReady = true;
        },
        onClose() {},
        onError() {}
      });
      crossConn.send(signedAuthFrameFromA);
      assert.equal(crossReady, false, `replaying auth bytes across ${kind} must fail`);
      assert.equal(peerBCross.liveLinkCount(), 0);
    } finally {
      cleanup(dirs);
    }
  }

  // 1e. Missing or invalid key -> ZERO connector attempts, named state, no key file created
  {
    const fxMissing = makeClientFixture({ skipKeyGen: true, skipRegister: true });
    try {
      const res = fxMissing.client.start();
      assert.equal(res.ok, false);
      assert.equal(res.reason, "node-key-missing");
      assert.equal(res.requiresEnrolment, true);
      assert.equal(fxMissing.peer.attemptsFor("client-1"), 0);
      assert.deepEqual(readdirSync(fxMissing.dirs.configDir), []);
      const st = readLinkStatusFile(fxMissing.dirs.root);
      assert.equal(st?.state, "node-key-missing");
      assert.equal(st?.requiresEnrolment, true);
    } finally {
      cleanup(fxMissing.dirs);
    }

    const fxInvalid = makeClientFixture({ skipKeyGen: true, skipRegister: true });
    try {
      mkdirSync(join(fxInvalid.dirs.configDir, "remote"), { recursive: true });
      writeFileSync(join(fxInvalid.dirs.configDir, "remote", "node-key.json"), "corrupt-json", { mode: 0o600 });
      const res = fxInvalid.client.start();
      assert.equal(res.ok, false);
      assert.equal(res.reason, "node-key-invalid");
      assert.equal(res.requiresEnrolment, true);
      assert.equal(fxInvalid.peer.attemptsFor("client-1"), 0);
      assert.equal(loadNodeKey({ configDir: fxInvalid.dirs.configDir }).state, "invalid");
    } finally {
      cleanup(fxInvalid.dirs);
    }
  }
});

// ============================================================================
// 2. Deux liens et surveillance (superseded + zero retry + distinct enrolment active)
// ============================================================================

test("two links and superseded: second client replaces first, first stops with zero retries, status readable via CLI/MCP, distinct enrolment stays live", () => {
  const dirs1 = makeIsolation();
  const dirs2 = makeIsolation();
  const dirs3 = makeIsolation();
  const clock = new FakeClock(1_700_000_000_000);
  try {
    const key = generateNodeKey({ configDir: dirs1.configDir });
    const otherKey = generateNodeKey({ configDir: dirs3.configDir });
    const peer = new FakeBinaryTrunkPeer({ meshId: MESH, tenantId: TENANT, endpoint: ENDPOINT, clock, env: TEST_ENV });
    peer.registerEnrolment({ nodeId: key.nodeId, enrolmentRef: "enr-same", publicKeyPem: key.publicKeyPem });
    peer.registerEnrolment({ nodeId: otherKey.nodeId, enrolmentRef: "enr-other", publicKeyPem: otherKey.publicKeyPem });

    const c1 = new TrunkClient({
      root: dirs1.root,
      env: TEST_ENV,
      enrolment: { meshId: MESH, endpoint: ENDPOINT, tenantId: TENANT, enrolmentRef: "enr-same", nodeId: key.nodeId },
      nodeKeyOptions: { configDir: dirs1.configDir },
      connector: peer.createConnector("c1"),
      contract: peer.contract,
      clock,
      catalogue: new FakeCatalogueDouble({ clock })
    });
    const c2 = new TrunkClient({
      root: dirs2.root,
      env: TEST_ENV,
      enrolment: { meshId: MESH, endpoint: ENDPOINT, tenantId: TENANT, enrolmentRef: "enr-same", nodeId: key.nodeId },
      nodeKeyOptions: { configDir: dirs1.configDir }, // same LH-01 key, distinct private root!
      connector: peer.createConnector("c2"),
      contract: peer.contract,
      clock,
      catalogue: new FakeCatalogueDouble({ clock })
    });
    const c3 = new TrunkClient({
      root: dirs3.root,
      env: TEST_ENV,
      enrolment: { meshId: MESH, endpoint: ENDPOINT, tenantId: TENANT, enrolmentRef: "enr-other", nodeId: otherKey.nodeId },
      nodeKeyOptions: { configDir: dirs3.configDir },
      connector: peer.createConnector("c3"),
      contract: peer.contract,
      clock,
      catalogue: new FakeCatalogueDouble({ clock })
    });

    c1.start();
    assert.equal(c1.getState(), "ready");
    assert.equal(peer.liveLinkCount(), 1);
    assert.equal(peer.trunkFake.liveLinkCount(), 1);

    c2.start();
    assert.equal(c2.getState(), "ready");
    assert.equal(c1.getState(), "superseded");
    assert.equal(peer.liveLinkCount(), 1);
    assert.equal(peer.trunkFake.liveLinkCount(), 1);

    // Distinct enrolment stays active alongside c2
    c3.start();
    assert.equal(c3.getState(), "ready");
    assert.equal(peer.liveLinkCount(), 2);

    // Readable by CLI `remote status` and MCP `h2a_remote_status`
    const cli = captureStreams();
    const rc = runCli(["remote", "status", "--root", dirs1.root], cli.streams, { env: { H2A_REMOTE_CONTROL: "1" } });
    assert.equal(rc, 0);
    const cliJson = JSON.parse(cli.out());
    assert.equal(cliJson.link?.state, "superseded");

    const prevFlag = process.env.H2A_REMOTE_CONTROL;
    const prevOff = process.env.H2A_REMOTE_OFF;
    process.env.H2A_REMOTE_CONTROL = "1";
    delete process.env.H2A_REMOTE_OFF;
    try {
      const server = createMcpServer({ root: dirs1.root, store: createLocalStore({ root: dirs1.root }) });
      const mcpStatus = server.callTool("h2a_remote_status", {});
      assert.equal(mcpStatus.ok, true);
      assert.equal(mcpStatus.link?.state, "superseded");
    } finally {
      if (prevFlag !== undefined) process.env.H2A_REMOTE_CONTROL = prevFlag;
      else delete process.env.H2A_REMOTE_CONTROL;
      if (prevOff !== undefined) process.env.H2A_REMOTE_OFF = prevOff;
    }

    // Advance clock by 10 minutes -> c1 attempt counter stays 1 (0 new attempts)
    const beforeAdvance = peer.attemptsFor("c1");
    clock.advance(10 * 60_000);
    assert.equal(peer.attemptsFor("c1") - beforeAdvance, 0);
    assert.equal(c2.getState(), "ready");
    assert.equal(c3.getState(), "ready");

    c2.stop();
    c3.stop();
  } finally {
    cleanup(dirs1);
    cleanup(dirs2);
    cleanup(dirs3);
  }
});

// ============================================================================
// 3. Séquence et tramage
// ============================================================================

test("sequence and framing: rejects duplicate s, gap s, wrong ch, truncated frame, 2 records in 1 message, unknown mandatory type, text frame; allows x-* and bidirectional/multi-gen s", () => {
  // Check isTrunkRecord tightened validation
  assert.equal(isTrunkRecord({ v: 1, t: "hello", ch: 0, s: 1 }), false, "incomplete hello must be rejected");
  assert.equal(isTrunkRecord({ v: 1, t: "ping", ch: 0, s: 0, at: 1 }), false, "s=0 must be rejected");
  assert.equal(isTrunkRecord({ v: 1, t: "ping", ch: 0, s: 1, at: 100 }), true);
  assert.equal(isTrunkRecord({ v: 1, t: "x-probe", ch: 0, s: 2, note: "ok" }), true);

  const badCases = [
    {
      name: "duplicate s",
      inject: (peer, conn) => peer.sendRecord(conn, { t: "ping", ch: 0, s: 2, at: 100 })
    },
    {
      name: "gap in s",
      inject: (peer, conn) => peer.sendRecord(conn, { t: "ping", ch: 0, s: 5, at: 100 })
    },
    {
      name: "wrong channel for watch.start",
      inject: (peer, conn) => peer.sendRecord(conn, { t: "watch.start", ch: 0 })
    },
    {
      name: "unallocated channel >= 2",
      inject: (peer, conn) => peer.sendRecord(conn, { t: "term.close", ch: 7, sid: "n-x" })
    },
    {
      name: "truncated record",
      inject: (peer, conn) => {
        const frame = peer.contract.encodeFrame({ v: 1, t: "ping", ch: 0, s: 3, at: 100 });
        peer.sendRawBytes(conn, frame.subarray(0, frame.length - 3));
      }
    },
    {
      name: "two records in one message",
      inject: (peer, conn) => {
        const f1 = peer.contract.encodeFrame({ v: 1, t: "ping", ch: 0, s: 3, at: 100 });
        const f2 = peer.contract.encodeFrame({ v: 1, t: "ping", ch: 0, s: 4, at: 200 });
        peer.sendRawBytes(conn, Buffer.concat([f1, f2]));
      }
    },
    {
      name: "unknown mandatory type",
      inject: (peer, conn) => peer.sendRecord(conn, { t: "future.mandatory", ch: 0 })
    },
    {
      name: "text frame",
      inject: (peer, conn) => peer.sendTextFrame(conn, JSON.stringify({ v: 1, t: "ping", ch: 0, s: 3, at: 100 }))
    }
  ];

  for (const tc of badCases) {
    let dispatched = 0;
    const fx = makeClientFixture({
      terminalConsumer: {
        onOpen() { dispatched += 1; return { ok: true }; },
        onRecord() { dispatched += 1; }
      }
    });
    try {
      fx.client.start();
      assert.equal(fx.client.getState(), "ready", `${tc.name}: setup ready`);
      const conn = fx.peer.allConnections()[0];
      tc.inject(fx.peer, conn);
      assert.equal(conn.closed, true, `${tc.name}: connection must close`);
      assert.equal(dispatched, 0, `${tc.name}: must close before any dispatch`);
      fx.client.stop();
    } finally {
      cleanup(fx.dirs);
    }
  }

  // Positive: unknown x-* extension ignored after envelope/ch/s check, bidirectional same s, two generations, local term.open refusal emits err & frees ch
  const openedChannels = [];
  let refuseNextOpen = true;
  const fxOk = makeClientFixture({
    terminalConsumer: {
      onOpen(open) {
        if (refuseNextOpen) {
          refuseNextOpen = false;
          return { ok: false, code: "excluded", retryable: false };
        }
        openedChannels.push(open.ch);
        return {
          ok: true,
          opened: {
            sid: open.sid,
            generation: "g1",
            incarnation: "i1",
            status: "running",
            latestSeq: 0,
            holderKind: "none",
            size: { cols: 80, rows: 24 }
          }
        };
      }
    }
  });
  try {
    fxOk.client.start();
    assert.equal(fxOk.client.getState(), "ready");
    const conn1 = fxOk.peer.allConnections()[0];
    // Unknown x-* extension on ch 0 with valid s=3 -> ignored, link stays alive
    fxOk.peer.sendRecord(conn1, { t: "x-future-hint", ch: 0, payload: 42 });
    assert.equal(conn1.closed, false);
    assert.equal(fxOk.client.getState(), "ready");

    // Local refusal of term.open on ch 2 -> sends err on ch 2 and frees ch 2 without closing link
    fxOk.peer.sendTermOpen(conn1, { ch: 2, sid: "n-a" });
    assert.equal(conn1.closed, false);
    const errRec = conn1.decodedClientRecords.find((r) => r.t === "err" && r.ch === 2);
    assert.equal(errRec?.code, "excluded");

    // ch 2 was freed -> can now be opened cleanly!
    fxOk.peer.sendTermOpen(conn1, { ch: 2, sid: "n-a" });
    assert.equal(conn1.closed, false);
    assert.deepEqual(openedChannels, [2]);
    // Bidirectional simultaneous s numbers (peer s >= 2, client s >= 2 both work)
    fxOk.peer.sendPing(conn1);
    const pong = conn1.decodedClientRecords.find((r) => r.t === "pong");
    assert.ok(pong);

    // Reusing already active ch 2 -> protocol error closes link
    fxOk.peer.sendTermOpen(conn1, { ch: 2, sid: "n-b" });
    assert.equal(conn1.closed, true);

    // Advance to reconnect -> second generation resets s to 1 in both directions!
    fxOk.clock.advance(2_000);
    assert.equal(fxOk.client.getState(), "ready");
    assert.equal(fxOk.client.getLinkGeneration(), 2);
    const conn2 = fxOk.peer.allConnections()[1];
    assert.equal(conn2.decodedClientRecords[0].s, 1);
    assert.equal(conn2.decodedServerRecords[0].s, 1);
    fxOk.client.stop();
  } finally {
    cleanup(fxOk.dirs);
  }
});

// ============================================================================
// 4. Crédit indépendant
// ============================================================================

test("independent channel credit: record & byte caps on ch 2 do not stall ch 3, duplicate credit grants zero, off-frontier/regressive/unknown/stale rejected", () => {
  const creditEvents = [];
  const fx = makeClientFixture({
    terminalConsumer: {
      onOpen(open) {
        return {
          ok: true,
          opened: {
            sid: open.sid,
            generation: "g1",
            incarnation: "i1",
            status: "running",
            latestSeq: 0,
            holderKind: "none",
            size: { cols: 80, rows: 24 }
          }
        };
      },
      onCredit(ch, avail) {
        creditEvents.push({ ch, ...avail });
      }
    }
  });
  try {
    fx.client.start();
    const conn = fx.peer.allConnections()[0];

    // Allocate ch 2 and ch 3
    fx.peer.sendTermOpen(conn, { ch: 2, sid: "n-a" });
    fx.peer.sendTermOpen(conn, { ch: 3, sid: "n-b" });

    // Grant 2 records, 25 bytes on ch 2; 4 records, 4000 bytes on ch 3
    fx.peer.sendCredit(conn, 2, { receivedThroughSeq: 0, receivedThroughBytes: 0, sendLimitSeq: 2, sendLimitBytes: 25 });
    fx.peer.sendCredit(conn, 3, { receivedThroughSeq: 0, receivedThroughBytes: 0, sendLimitSeq: 4, sendLimitBytes: 4000 });

    const mkOut = (sid, seq, text) => ({
      t: "term.out",
      sid,
      incarnation: "i1",
      firstSeq: seq,
      lastSeq: seq,
      dataB64: Buffer.from(text, "utf8").toString("base64")
    });

    // Exhaust record count on ch 2 (2 records of 10 bytes each -> 20/25 bytes, 2/2 records)
    assert.equal(fx.client.trySendOutput(2, mkOut("n-a", 1, "0123456789"), 10), "sent");
    assert.equal(fx.client.trySendOutput(2, mkOut("n-a", 2, "0123456789"), 10), "sent");
    assert.equal(fx.client.trySendOutput(2, mkOut("n-a", 3, "0123456789"), 10), "no-credit");
    assert.equal((conn.receivedTermOut.get(2) ?? []).length, 2);

    // Meanwhile ch 3 advances!
    assert.equal(fx.client.trySendOutput(3, mkOut("n-b", 1, "hello-ch3"), 9), "sent");
    assert.equal((conn.receivedTermOut.get(3) ?? []).length, 1);

    // Repeat identical credit values on ch 2 with new valid s -> grants ZERO extra capacity
    fx.peer.sendCredit(conn, 2, { receivedThroughSeq: 0, receivedThroughBytes: 0, sendLimitSeq: 2, sendLimitBytes: 25 });
    assert.equal(fx.client.trySendOutput(2, mkOut("n-a", 3, "0123456789"), 10), "no-credit");
    assert.equal(conn.closed, false);

    // Grant new limit allowing byte exhaustion (ack 2 records / 20 bytes, limit 5 records / 35 bytes -> 15 bytes free)
    fx.peer.sendCredit(conn, 2, { receivedThroughSeq: 2, receivedThroughBytes: 20, sendLimitSeq: 5, sendLimitBytes: 35 });
    assert.equal(fx.client.trySendOutput(2, mkOut("n-a", 3, "1234567890"), 10), "sent"); // 30 bytes total, 5 left
    assert.equal(fx.client.trySendOutput(2, mkOut("n-a", 4, "123456"), 6), "no-credit"); // 6 > 5 bytes left!
    assert.equal((conn.receivedTermOut.get(2) ?? []).length, 3);
    // ch 3 still advances!
    assert.equal(fx.client.trySendOutput(3, mkOut("n-b", 2, "more-ch3"), 8), "sent");
    assert.equal((conn.receivedTermOut.get(3) ?? []).length, 2);

    // New limit allows EXACTLY the next output (sendLimitSeq stays 5, sendLimitBytes advances to 36 -> 6 bytes free)
    fx.peer.sendCredit(conn, 2, { receivedThroughSeq: 3, receivedThroughBytes: 30, sendLimitSeq: 5, sendLimitBytes: 36 });
    assert.equal(fx.client.trySendOutput(2, mkOut("n-a", 4, "123456"), 6), "sent");
    assert.equal(fx.client.trySendOutput(2, mkOut("n-a", 5, "x"), 1), "no-credit");

    // Control messages still pass with 0 data credit
    assert.equal(fx.client.sendControl(2, { t: "term.gap", sid: "n-a", fromSeq: 5, toSeq: 6 }), true);

    // Drop connection and reconnect -> verify stale connection message on reused ch 2 is ignored!
    const oldConn = conn;
    fx.peer.dropConnection(oldConn, "transient");
    fx.clock.advance(2_000);
    assert.equal(fx.client.getState(), "ready");
    const newConn = fx.peer.allConnections()[1];
    fx.peer.sendTermOpen(newConn, { ch: 2, sid: "n-a" });
    // Late credit delivered on OLD connection must be ignored and NOT grant credit on newConn!
    oldConn.handlers.onMessage(fx.peer.contract.encodeFrame({
      v: 1, t: "credit", ch: 2, s: 99,
      receivedThroughSeq: 0, receivedThroughBytes: 0, sendLimitSeq: 4, sendLimitBytes: 4000
    }));
    assert.deepEqual(fx.client.availableOutput(2), { records: 0, bytes: 0 });
    assert.equal(newConn.closed, false);
    fx.client.stop();
  } finally {
    cleanup(fx.dirs);
  }

  // Protocol errors: off-frontier ack, regressive limit, unknown channel, excessive window
  const creditErrors = [
    {
      name: "off-frontier ack bytes",
      trigger: (peer, conn, client) => {
        peer.sendTermOpen(conn, { ch: 2, sid: "n-a" });
        peer.sendCredit(conn, 2, { receivedThroughSeq: 0, receivedThroughBytes: 0, sendLimitSeq: 2, sendLimitBytes: 100 });
        client.trySendOutput(2, { t: "term.out", sid: "n-a", incarnation: "i1", firstSeq: 1, lastSeq: 1, dataB64: Buffer.from("abc").toString("base64") }, 3);
        // Sent 3 bytes at seq 1, ack claims 4 bytes -> off frontier!
        peer.sendCredit(conn, 2, { receivedThroughSeq: 1, receivedThroughBytes: 4, sendLimitSeq: 3, sendLimitBytes: 100 });
      }
    },
    {
      name: "regressive limit",
      trigger: (peer, conn) => {
        peer.sendTermOpen(conn, { ch: 2, sid: "n-a" });
        peer.sendCredit(conn, 2, { receivedThroughSeq: 0, receivedThroughBytes: 0, sendLimitSeq: 4, sendLimitBytes: 1000 });
        peer.sendCredit(conn, 2, { receivedThroughSeq: 0, receivedThroughBytes: 0, sendLimitSeq: 3, sendLimitBytes: 1000 });
      }
    },
    {
      name: "credit on unknown channel",
      trigger: (peer, conn) => {
        peer.sendCredit(conn, 9, { receivedThroughSeq: 0, receivedThroughBytes: 0, sendLimitSeq: 1, sendLimitBytes: 100 });
      }
    },
    {
      name: "window above 8 records",
      trigger: (peer, conn) => {
        peer.sendTermOpen(conn, { ch: 2, sid: "n-a" });
        peer.sendCredit(conn, 2, { receivedThroughSeq: 0, receivedThroughBytes: 0, sendLimitSeq: 9, sendLimitBytes: 1000 });
      }
    }
  ];

  for (const ce of creditErrors) {
    const fxErr = makeClientFixture({
      terminalConsumer: {
        onOpen(open) {
          return {
            ok: true,
            opened: { sid: open.sid, generation: "g1", incarnation: "i1", status: "running", latestSeq: 0, holderKind: "none", size: { cols: 80, rows: 24 } }
          };
        }
      }
    });
    try {
      fxErr.client.start();
      const conn = fxErr.peer.allConnections()[0];
      ce.trigger(fxErr.peer, conn, fxErr.client);
      assert.equal(conn.closed, true, `${ce.name}: must close connection`);
      fxErr.client.stop();
    } finally {
      cleanup(fxErr.dirs);
    }
  }
});

// ============================================================================
// 5. Veille, perte et arrêt (watch, ping/pong, backoff+jitter, revoked, kill, bye)
// ============================================================================

test("idle, watch, ping/pong, backoff with jitter, revoked, kill, bye and 512-row provider framing", () => {
  // 5a. Idle liveness, watch.start/stop, ping at 15s, single closure at 45s without pong
  {
    const fx = makeClientFixture();
    try {
      fx.client.start();
      const conn = fx.peer.allConnections()[0];
      fx.peer.sendCredit(conn, 1, { receivedThroughSeq: 0, receivedThroughBytes: 0, sendLimitSeq: 8, sendLimitBytes: 131072 });

      // Before watch.start: zero cat.*, x-liveness at 5s, ping at 15s
      fx.clock.advance(15_000);
      assert.equal(conn.receivedCatalogue.length, 0, "zero cat.* before watch.start");
      const liveness = conn.decodedClientRecords.filter((r) => r.t === "x-liveness" && r.ch === 0);
      assert.ok(liveness.length >= 2, "node liveness every 5s while idle");
      const pings = conn.decodedClientRecords.filter((r) => r.t === "ping" && r.ch === 0);
      assert.equal(pings.length, 1, "single ping at 15s");

      // Start watch -> paginated snapshot emitted
      fx.peer.sendWatchStart(conn);
      assert.equal(conn.receivedCatalogue.length, 2);
      assert.equal(conn.receivedCatalogue[0].record.t, "cat.snapshot.part");
      assert.equal(conn.receivedCatalogue[1].record.t, "cat.snapshot.end");
      assert.equal(conn.catalogueView?.rows.length, 2);

      // Stop watch -> zero cat.* afterwards
      fx.peer.sendWatchStop(conn);
      const countAfterStop = conn.receivedCatalogue.length;
      fx.catalogue.emitRow(sampleRow("n-c", "inst-B"));
      assert.equal(conn.receivedCatalogue.length, countAfterStop, "zero cat.* after watch.stop");

      // Disable peer autoPong -> advance 45s -> single closure!
      fx.peer.setAutoPong(false);
      const lossesBefore = fx.linkEvents.filter((e) => e.kind === "link-lost").length;
      fx.clock.advance(45_000);
      assert.equal(conn.closed, true, "must close after 45s without pong");
      const lossesAfter = fx.linkEvents.filter((e) => e.kind === "link-lost").length;
      assert.equal(lossesAfter - lossesBefore, 1, "single closure on pong timeout");
      fx.client.stop();
    } finally {
      cleanup(fx.dirs);
    }
  }

  // 5b. Backoff series 1, 2, 4, 8, 16, 30s with jitter bounds (0, 0.5, 1.0) & single timer on error+close
  for (const [label, rngVal, expected] of [
    ["min-jitter", 0, [1000, 1800, 3600, 7200, 14400, 27000, 27000]],
    ["mid-jitter", 0.5, [1000, 2000, 4000, 8000, 16000, 30000, 30000]],
    ["max-jitter", 1, [1100, 2200, 4400, 8800, 17600, 30000, 30000]]
  ]) {
    const dirs = makeIsolation();
    const clock = new FakeClock(1_700_000_000_000);
    try {
      const key = generateNodeKey({ configDir: dirs.configDir });
      const attemptTimes = [];
      let failAttempts = expected.length;
      const peer = new FakeBinaryTrunkPeer({ meshId: MESH, tenantId: TENANT, endpoint: ENDPOINT, clock, env: TEST_ENV });
      peer.registerEnrolment({ nodeId: key.nodeId, enrolmentRef: "enr-bo", publicKeyPem: key.publicKeyPem });
      const realConnector = peer.createConnector("bo");
      const flakyConnector = {
        open(endpoint, handlers) {
          attemptTimes.push(clock.now());
          if (failAttempts > 0) {
            failAttempts -= 1;
            const c = {
              send() {},
              close() {}
            };
            // Deliver BOTH error and close together -> must schedule only ONE timer!
            handlers.onError(new Error("connect-fail"));
            handlers.onClose("connect-fail");
            return c;
          }
          return realConnector.open(endpoint, handlers);
        }
      };
      const client = new TrunkClient({
        root: dirs.root,
        env: TEST_ENV,
        enrolment: { meshId: MESH, endpoint: ENDPOINT, tenantId: TENANT, enrolmentRef: "enr-bo", nodeId: key.nodeId },
        nodeKeyOptions: { configDir: dirs.configDir },
        connector: flakyConnector,
        contract: peer.contract,
        clock,
        random: () => rngVal,
        catalogue: new FakeCatalogueDouble({ clock })
      });
      client.start();
      for (const delay of expected) {
        assert.equal(clock.pendingTimerCount(), 1, `${label}: single reconnect timer`);
        clock.advance(delay);
      }
      const diffs = [];
      for (let i = 1; i < attemptTimes.length; i++) {
        diffs.push(attemptTimes[i] - attemptTimes[i - 1]);
      }
      assert.deepEqual(diffs, expected, `${label}: backoff series mismatch`);
      assert.equal(client.getState(), "ready");
      client.stop();
    } finally {
      cleanup(dirs);
    }
  }

  // 5c. Transient drop -> new challenge, new generation, new snapshot under watch
  {
    const fx = makeClientFixture();
    try {
      fx.client.start();
      const conn1 = fx.peer.allConnections()[0];
      const nonce1 = conn1.nonce;
      fx.peer.sendCredit(conn1, 1, { receivedThroughSeq: 0, receivedThroughBytes: 0, sendLimitSeq: 8, sendLimitBytes: 131072 });
      fx.peer.sendWatchStart(conn1);
      assert.equal(conn1.receivedCatalogue.length, 2);

      fx.peer.deliverErrorAndClose(conn1, "net-reset");
      fx.clock.advance(1_000);
      assert.equal(fx.client.getState(), "ready");
      assert.equal(fx.client.getLinkGeneration(), 2);
      const conn2 = fx.peer.allConnections()[1];
      assert.notEqual(conn2.nonce, nonce1, "reconnect must use a fresh challenge");
      fx.peer.sendCredit(conn2, 1, { receivedThroughSeq: 0, receivedThroughBytes: 0, sendLimitSeq: 8, sendLimitBytes: 131072 });
      fx.peer.sendWatchStart(conn2);
      assert.equal(conn2.receivedCatalogue.length, 2);
      assert.equal(conn2.receivedCatalogue[0].record.t, "cat.snapshot.part");
      assert.equal(conn2.receivedCatalogue[1].record.t, "cat.snapshot.end");
      fx.client.stop();
    } finally {
      cleanup(fx.dirs);
    }
  }

  // 5d. Revoked -> close <= 1s, enrolment forgotten via callback, LH-01 key preserved, future auth refused
  {
    const fx = makeClientFixture();
    try {
      fx.client.start();
      const conn = fx.peer.allConnections()[0];
      const t0 = fx.clock.now();
      fx.peer.sendRevoked(conn, "admin-revoked");
      assert.equal(conn.closed, true);
      assert.ok(fx.clock.now() - t0 <= 1000);
      assert.equal(fx.client.getState(), "revoked");
      assert.equal(fx.revokedCallbacks.length, 1);
      assert.equal(fx.revokedCallbacks[0].enrolmentRef, fx.enrolment.enrolmentRef);
      // LH-01 key remains intact for other enrolments
      assert.equal(loadNodeKey({ configDir: fx.dirs.configDir }).state, "present");
      const attemptsBefore = fx.peer.attemptsFor("client-1");
      fx.clock.advance(120_000);
      assert.equal(fx.peer.attemptsFor("client-1"), attemptsBefore, "no reconnect after revoked");
      // New client for same enrolment is refused by peer
      const c2 = new TrunkClient({
        root: fx.dirs.root,
        env: TEST_ENV,
        enrolment: fx.enrolment,
        nodeKeyOptions: { configDir: fx.dirs.configDir },
        connector: fx.peer.createConnector("after-revoke"),
        contract: fx.peer.contract,
        clock: fx.clock,
        catalogue: new FakeCatalogueDouble({ clock: fx.clock })
      });
      c2.start();
      assert.notEqual(c2.getState(), "ready");
    } finally {
      cleanup(fx.dirs);
    }
  }

  // 5e. Kill -> local kill lock written, close <= 1s, zero reconnect callbacks
  {
    const fx = makeClientFixture();
    try {
      fx.client.start();
      const conn = fx.peer.allConnections()[0];
      const t0 = fx.clock.now();
      fx.peer.sendKill(conn, "emergency");
      assert.equal(conn.closed, true);
      assert.ok(fx.clock.now() - t0 <= 1000);
      assert.equal(fx.client.getState(), "killed");
      assert.equal(readRemoteControlKillFlag(fx.dirs.root).kill, true);
      const before = fx.peer.attemptsFor("client-1");
      fx.clock.advance(120_000);
      assert.equal(fx.peer.attemptsFor("client-1"), before);
      assert.equal(fx.clock.pendingTimerCount(), 0);
    } finally {
      cleanup(fx.dirs);
    }
  }

  // 5f. Voluntary bye -> clean close, zero reconnect
  {
    const fx = makeClientFixture();
    try {
      fx.client.start();
      const conn = fx.peer.allConnections()[0];
      fx.peer.sendBye(conn);
      assert.equal(fx.client.getState(), "stopped");
      const before = fx.peer.attemptsFor("client-1");
      fx.clock.advance(120_000);
      assert.equal(fx.peer.attemptsFor("client-1"), before);
      assert.equal(fx.clock.pendingTimerCount(), 0);
    } finally {
      cleanup(fx.dirs);
    }
  }

  // 5g. 512-row catalogue framing at 8192 B and 256-row framing at 4096 B + mid-series cut restarts with snapshot
  {
    const rows512 = Array.from({ length: 512 }, (_, i) =>
      sampleRow(`n-${String(i).padStart(4, "0")}`, i % 2 === 0 ? "inst-A" : "inst-B")
    );
    for (const [cap, inputRows] of [[8192, rows512], [4096, rows512.slice(0, 256)]]) {
      const provider = createSimulatedTrunkContractProvider({ maxCatalogueRecordBytes: cap });
      const fx = makeClientFixture({ contract: provider, initialRows: inputRows });
      try {
        fx.client.start();
        const conn = fx.peer.allConnections()[0];
        // Pump credit incrementally in batches of 8 records
        let ackSeq = 0;
        let ackBytes = 0;
        fx.peer.sendCredit(conn, 1, { receivedThroughSeq: 0, receivedThroughBytes: 0, sendLimitSeq: 8, sendLimitBytes: 131072 });
        fx.peer.sendWatchStart(conn);
        let guard = 0;
        while (conn.receivedCatalogue.length > ackSeq && guard++ < 40) {
          for (let i = ackSeq; i < conn.receivedCatalogue.length; i++) {
            assert.ok(conn.receivedCatalogue[i].encodedBytes <= cap, `frame ${i} <= ${cap}`);
            ackBytes += conn.receivedCatalogue[i].encodedBytes;
          }
          ackSeq = conn.receivedCatalogue.length;
          fx.peer.sendCredit(conn, 1, {
            receivedThroughSeq: ackSeq,
            receivedThroughBytes: ackBytes,
            sendLimitSeq: ackSeq + 8,
            sendLimitBytes: ackBytes + 131072
          });
        }
        // Reconstruct catalogue from received parts + end via peer CatalogueSliceStager
        assert.equal(conn.receivedCatalogue[0].record.t, "cat.snapshot.part");
        assert.equal(conn.receivedCatalogue[conn.receivedCatalogue.length - 1].record.t, "cat.snapshot.end");
        assert.ok(conn.receivedCatalogue.length > 4, `${inputRows.length} rows must split across multiple <= ${cap} frames`);
        assert.equal(conn.catalogueView?.rows.length, inputRows.length);
        fx.client.stop();
      } finally {
        cleanup(fx.dirs);
      }
    }
  }
});

// ============================================================================
// 6. Coupe-circuit avant connexion (flag off, H2A_REMOTE_OFF, kill file, reconnect guard, CLI/MCP status)
// ============================================================================

test("kill-switch before connect and before reconnect: H2A_REMOTE_OFF, kill file, flag off, CLI/MCP visibility", () => {
  // Normalization predicate checks
  assert.equal(isRemoteControlKilledByEnv({}), false);
  assert.equal(isRemoteControlKilledByEnv({ H2A_REMOTE_OFF: "" }), false);
  assert.equal(isRemoteControlKilledByEnv({ H2A_REMOTE_OFF: "0" }), false);
  assert.equal(isRemoteControlKilledByEnv({ H2A_REMOTE_OFF: " FALSE " }), false);
  assert.equal(isRemoteControlKilledByEnv({ H2A_REMOTE_OFF: "1" }), true);
  assert.equal(isRemoteControlKilledByEnv({ H2A_REMOTE_OFF: " yes " }), true);

  // Flag off -> zero key access, zero connector, zero timers
  {
    const fx = makeClientFixture({ env: {}, skipKeyGen: true, skipRegister: true });
    try {
      const res = fx.client.start();
      assert.equal(res.ok, false);
      assert.equal(res.reason, "remote-control-disabled");
      assert.equal(fx.peer.attemptsFor("client-1"), 0);
      assert.equal(fx.clock.pendingTimerCount(), 0);
    } finally {
      cleanup(fx.dirs);
    }
  }

  // H2A_REMOTE_OFF="1" and " yes " with H2A_REMOTE_CONTROL=1 -> blocks before key read/connect/timer AND sets local kill file!
  for (const val of ["1", " yes "]) {
    const fx = makeClientFixture({
      env: { H2A_REMOTE_CONTROL: "1", H2A_TEST_FAKES: "1", H2A_REMOTE_OFF: val },
      skipKeyGen: true,
      skipRegister: true
    });
    try {
      const res = fx.client.start();
      assert.equal(res.ok, false);
      assert.equal(res.reason, "killed-by-env");
      assert.equal(fx.peer.attemptsFor("client-1"), 0);
      assert.equal(fx.clock.pendingTimerCount(), 0);
      assert.equal(readRemoteControlKillFlag(fx.dirs.root).kill, true, "env kill must also write local kill file");

      // Removing H2A_REMOTE_OFF afterwards still stays blocked because local kill file holds!
      delete fx.env.H2A_REMOTE_OFF;
      const res2 = fx.client.start();
      assert.equal(res2.ok, false);
      assert.equal(res2.reason, "killed");
      assert.equal(fx.peer.attemptsFor("client-1"), 0);
    } finally {
      cleanup(fx.dirs);
    }
  }

  // Allowed values of H2A_REMOTE_OFF when kill file absent
  for (const val of [undefined, "", "0", " FALSE "]) {
    const env = { H2A_REMOTE_CONTROL: "1", H2A_TEST_FAKES: "1", ...(val !== undefined ? { H2A_REMOTE_OFF: val } : {}) };
    const fx = makeClientFixture({ env });
    try {
      const res = fx.client.start();
      assert.equal(res.ok, true, `H2A_REMOTE_OFF=${JSON.stringify(val)} must allow connection`);
      assert.equal(fx.client.getState(), "ready");
      fx.client.stop();
    } finally {
      cleanup(fx.dirs);
    }
  }

  // Initial open with ONLY local kill file already present -> zero attempts, zero timers
  {
    const fx = makeClientFixture({ skipKeyGen: true, skipRegister: true });
    try {
      setRemoteControlKillFlag(fx.dirs.root);
      const res = fx.client.start();
      assert.equal(res.ok, false);
      assert.equal(res.reason, "killed");
      assert.equal(fx.peer.attemptsFor("client-1"), 0);
      assert.equal(fx.clock.pendingTimerCount(), 0);
    } finally {
      cleanup(fx.dirs);
    }
  }

  // Armed reconnect timer: activate H2A_REMOTE_OFF, then kill file, then unset H2A_REMOTE_CONTROL in 3 separate cases
  for (const mode of ["env-off", "kill-file", "flag-off"]) {
    const env = { H2A_REMOTE_CONTROL: "1", H2A_TEST_FAKES: "1" };
    const fx = makeClientFixture({ env });
    try {
      fx.client.start();
      assert.equal(fx.client.getState(), "ready");
      const conn = fx.peer.allConnections()[0];
      fx.peer.dropConnection(conn, "transient-cut");
      assert.equal(fx.clock.pendingTimerCount(), 1, `${mode}: reconnect timer armed`);
      const attemptsBefore = fx.peer.attemptsFor("client-1");

      if (mode === "env-off") env.H2A_REMOTE_OFF = "1";
      else if (mode === "kill-file") setRemoteControlKillFlag(fx.dirs.root);
      else delete env.H2A_REMOTE_CONTROL;

      fx.clock.advance(60_000);
      assert.equal(fx.peer.attemptsFor("client-1"), attemptsBefore, `${mode}: zero extra attempts at backoff expiry`);
      assert.equal(fx.clock.pendingTimerCount(), 0, `${mode}: zero remaining timers`);
    } finally {
      cleanup(fx.dirs);
    }
  }

  // CLI and MCP status expose kill = killByEnv || killByFile and both booleans even without opening a link
  {
    const dirs = makeIsolation();
    try {
      // Case 1: H2A_REMOTE_OFF only (no kill file, no link opened)
      const cliEnvOff = captureStreams();
      assert.equal(
        runCli(["remote", "status", "--root", dirs.root], cliEnvOff.streams, { env: { H2A_REMOTE_CONTROL: "1", H2A_REMOTE_OFF: " yes " } }),
        0
      );
      const j1 = JSON.parse(cliEnvOff.out());
      assert.equal(j1.kill, true);
      assert.equal(j1.killByEnv, true);
      assert.equal(j1.killByFile, false);

      // MCP reader for H2A_REMOTE_OFF
      const prevFlag = process.env.H2A_REMOTE_CONTROL;
      const prevOff = process.env.H2A_REMOTE_OFF;
      process.env.H2A_REMOTE_CONTROL = "1";
      process.env.H2A_REMOTE_OFF = "1";
      try {
        const mcp1 = createMcpServer({ root: dirs.root, store: createLocalStore({ root: dirs.root }) }).callTool("h2a_remote_status", {});
        assert.equal(mcp1.kill, true);
        assert.equal(mcp1.killByEnv, true);
        assert.equal(mcp1.killByFile, false);
      } finally {
        if (prevOff !== undefined) process.env.H2A_REMOTE_OFF = prevOff;
        else delete process.env.H2A_REMOTE_OFF;
        if (prevFlag !== undefined) process.env.H2A_REMOTE_CONTROL = prevFlag;
        else delete process.env.H2A_REMOTE_CONTROL;
      }

      // Case 2: kill file only (no H2A_REMOTE_OFF)
      setRemoteControlKillFlag(dirs.root);
      const cliFile = captureStreams();
      assert.equal(
        runCli(["remote", "status", "--root", dirs.root], cliFile.streams, { env: { H2A_REMOTE_CONTROL: "1" } }),
        0
      );
      const j2 = JSON.parse(cliFile.out());
      assert.equal(j2.kill, true);
      assert.equal(j2.killByEnv, false);
      assert.equal(j2.killByFile, true);

      const prevFlag2 = process.env.H2A_REMOTE_CONTROL;
      const prevOff2 = process.env.H2A_REMOTE_OFF;
      process.env.H2A_REMOTE_CONTROL = "1";
      delete process.env.H2A_REMOTE_OFF;
      try {
        const mcp2 = createMcpServer({ root: dirs.root, store: createLocalStore({ root: dirs.root }) }).callTool("h2a_remote_status", {});
        assert.equal(mcp2.kill, true);
        assert.equal(mcp2.killByEnv, false);
        assert.equal(mcp2.killByFile, true);
      } finally {
        if (prevOff2 !== undefined) process.env.H2A_REMOTE_OFF = prevOff2;
        if (prevFlag2 !== undefined) process.env.H2A_REMOTE_CONTROL = prevFlag2;
        else delete process.env.H2A_REMOTE_CONTROL;
      }
    } finally {
      cleanup(dirs);
    }
  }
});

// ============================================================================
// 7. Instance sur lien vivant (ready.revokedInstances, bind A/B, reg-1 negative, replay, live revoke A, B & terminal continue, concurrent lock)
// ============================================================================

test("instance lifecycle on live link: ready.revokedInstances before snapshot, instance.bind with instance key only, reg-1 negative, replays, live revoke A while B and terminal continue, persistence", () => {
  // 7a. ready.revokedInstances contains A -> applied BEFORE startWatch & first snapshot; empty ready next time still keeps A revoked
  {
    const fx = makeClientFixture({
      enrolmentMeta: { revokedInstances: ["inst-A"] }
    });
    try {
      fx.client.start();
      assert.equal(fx.client.getState(), "ready");
      const conn = fx.peer.allConnections()[0];
      fx.peer.sendCredit(conn, 1, { receivedThroughSeq: 0, receivedThroughBytes: 0, sendLimitSeq: 8, sendLimitBytes: 131072 });
      fx.peer.sendWatchStart(conn);

      const applyIdx = fx.catalogue.calls.findIndex((c) => c.op === "applyRevokedInstances");
      const watchIdx = fx.catalogue.calls.findIndex((c) => c.op === "startWatch");
      assert.ok(applyIdx >= 0, "applyRevokedInstances must be called");
      assert.ok(watchIdx > applyIdx, "applyRevokedInstances must happen before startWatch");
      const part = conn.receivedCatalogue[0].record;
      assert.equal(part.t, "cat.snapshot.part");
      const rowA = conn.catalogueView?.rows.find((r) => r.sid === "n-a");
      assert.equal(rowA.instanceStatus, "revoked", "first snapshot must already show A revoked");
      fx.client.stop();

      // Reconnect on new client with EMPTY ready.revokedInstances -> persisted store still keeps A revoked!
      const peer2 = new FakeBinaryTrunkPeer({ meshId: MESH, tenantId: TENANT, endpoint: ENDPOINT, clock: fx.clock, env: TEST_ENV });
      peer2.registerEnrolment({
        nodeId: fx.key.nodeId,
        enrolmentRef: fx.enrolment.enrolmentRef,
        publicKeyPem: fx.key.publicKeyPem,
        revokedInstances: []
      });
      const cat2 = new FakeCatalogueDouble({
        clock: fx.clock,
        initialRows: [sampleRow("n-a", "inst-A"), sampleRow("n-b", "inst-B")]
      });
      const c2 = new TrunkClient({
        root: fx.dirs.root,
        env: TEST_ENV,
        enrolment: fx.enrolment,
        nodeKeyOptions: { configDir: fx.dirs.configDir },
        connector: peer2.createConnector("c2"),
        contract: peer2.contract,
        clock: fx.clock,
        catalogue: cat2
      });
      c2.start();
      const conn2 = peer2.allConnections()[0];
      peer2.sendCredit(conn2, 1, { receivedThroughSeq: 0, receivedThroughBytes: 0, sendLimitSeq: 8, sendLimitBytes: 131072 });
      peer2.sendWatchStart(conn2);
      assert.equal(conn2.catalogueView?.rows.find((r) => r.sid === "n-a")?.instanceStatus, "revoked");
      c2.stop();
    } finally {
      cleanup(fx.dirs);
    }
  }

  // 7b. Bind A and B on live link, negative reg-1, node-key-only fails, replays fail, live revoke A, B & terminal continue
  {
    const fx = makeClientFixture({
      terminalConsumer: {
        onOpen(open) {
          return {
            ok: true,
            opened: { sid: open.sid, generation: "g1", incarnation: "i1", status: "running", latestSeq: 0, holderKind: "none", size: { cols: 80, rows: 24 } }
          };
        }
      }
    });
    try {
      const instA = createRegisteredInstance(fx.dirs.root, "inst-A");
      const instB = createRegisteredInstance(fx.dirs.root, "inst-B");
      // Negative registration: id === "reg-1" while instance === "inst-mismatch"
      createRegisteredInstance(fx.dirs.root, "inst-mismatch", { idOverride: "reg-1" });

      fx.client.start();
      assert.equal(fx.client.getState(), "ready");
      const conn = fx.peer.allConnections()[0];
      const initialGen = fx.client.getLinkGeneration();
      const initialBindNonce = conn.decodedServerRecords.find((r) => r.t === "ready").bindNonce;

      // Start watch & grant credit on ch 1
      fx.peer.sendCredit(conn, 1, { receivedThroughSeq: 0, receivedThroughBytes: 0, sendLimitSeq: 8, sendLimitBytes: 131072 });
      fx.peer.sendWatchStart(conn);
      assert.equal(conn.receivedCatalogue.length, 2);

      // Open terminal channel 2 attached to session n-a (origin inst-A) and grant credit
      fx.peer.sendTermOpen(conn, { ch: 2, sid: "n-a" });
      fx.peer.sendCredit(conn, 2, { receivedThroughSeq: 0, receivedThroughBytes: 0, sendLimitSeq: 8, sendLimitBytes: 131072 });

      // Negative reg-1 produces ZERO instance.bind
      const bindsBeforeNeg = conn.decodedClientRecords.filter((r) => r.t === "instance.bind").length;
      const negRes = fx.client.bindInstance("inst-mismatch");
      assert.equal(negRes.ok, false);
      assert.equal(conn.decodedClientRecords.filter((r) => r.t === "instance.bind").length, bindsBeforeNeg);

      // Bind A and B
      const wireA = wireInstanceId("inst-A");
      const wireB = wireInstanceId("inst-B");
      assert.equal(fx.client.bindInstance("inst-A").ok, true);
      assert.equal(fx.client.bindInstance("inst-B").ok, true);
      const bindRecs = conn.decodedClientRecords.filter((r) => r.t === "instance.bind");
      assert.equal(bindRecs.length, 2);
      assert.equal(bindRecs[0].instanceId, wireA);
      assert.equal(bindRecs[1].instanceId, wireB);
      assert.notEqual(bindRecs[0].bindNonce, bindRecs[1].bindNonce, "bindNonce must rotate");
      assert.equal(fx.client.admitInstanceAct("inst-A").ok, true);
      assert.equal(fx.client.admitInstanceAct("inst-B").ok, true);

      // Node key signing instance.bind (instead of instance key) must fail at peer
      const rawPubA = extractRawEd25519PublicKeyBase64(instA.publicKeyPem);
      const fpA = formatWET2Fingerprint(Buffer.from(rawPubA, "base64"));
      assert.match(fpA, /^[A-Z2-7]{4}-[A-Z2-7]{4}-[A-Z2-7]{4}-[A-Z2-7]{4}$/);
      {
        const peerBad = new FakeBinaryTrunkPeer({ meshId: MESH, tenantId: TENANT, endpoint: ENDPOINT, clock: fx.clock, env: TEST_ENV });
        peerBad.registerEnrolment({ nodeId: fx.key.nodeId, enrolmentRef: "enr-badbind", publicKeyPem: fx.key.publicKeyPem });
        const cBad = new TrunkClient({
          root: fx.dirs.root,
          env: TEST_ENV,
          enrolment: { meshId: MESH, endpoint: ENDPOINT, tenantId: TENANT, enrolmentRef: "enr-badbind", nodeId: fx.key.nodeId },
          nodeKeyOptions: { configDir: fx.dirs.configDir },
          connector: peerBad.createConnector("badbind"),
          contract: peerBad.contract,
          clock: fx.clock,
          catalogue: new FakeCatalogueDouble({ clock: fx.clock })
        });
        cBad.start();
        const badConn = peerBad.allConnections()[0];
        const curNonce = badConn.currentBindNonce;
        // Sign with NODE key instead of instance key
        const nodeSig = signTrunkAuthPayload({
          meshId: MESH, endpoint: ENDPOINT, tenantId: TENANT, enrolmentRef: "enr-badbind",
          nodeId: fx.key.nodeId, instanceId: wireA, instancePublicKey: rawPubA, bindNonce: curNonce
        }, fx.key.privateKeyPem);
        cBad.sendControl(0, {
          t: "instance.bind", instanceId: wireA, instancePublicKey: rawPubA,
          instanceFingerprint: fpA, bindNonce: curNonce, sig: nodeSig
        });
        const boundResp = badConn.decodedServerRecords.find((r) => r.t === "instance.bound");
        assert.equal(boundResp.status, "refused");
        assert.equal(boundResp.reason, "bad-signature");
        cBad.stop();

        // Replay A's valid bind record with old bindNonce on a fresh connection -> refused!
        const cOldNonce = new TrunkClient({
          root: fx.dirs.root,
          env: TEST_ENV,
          enrolment: { meshId: MESH, endpoint: ENDPOINT, tenantId: TENANT, enrolmentRef: "enr-badbind", nodeId: fx.key.nodeId },
          nodeKeyOptions: { configDir: fx.dirs.configDir },
          connector: peerBad.createConnector("oldnonce"),
          contract: peerBad.contract,
          clock: fx.clock,
          catalogue: new FakeCatalogueDouble({ clock: fx.clock })
        });
        cOldNonce.start();
        const oldNonceConn = peerBad.allConnections()[peerBad.allConnections().length - 1];
        cOldNonce.sendControl(0, {
          t: "instance.bind", instanceId: wireA, instancePublicKey: bindRecs[0].instancePublicKey,
          instanceFingerprint: bindRecs[0].instanceFingerprint, bindNonce: initialBindNonce, sig: bindRecs[0].sig
        });
        const replayResp = oldNonceConn.decodedServerRecords.find((r) => r.t === "instance.bound");
        assert.equal(replayResp.status, "refused");
        cOldNonce.stop();
      }

      // Replay A's valid bind onto another tenant / endpoint / enrolment -> all refused!
      for (const replayTarget of [
        { label: "other-tenant", tenantId: "tenant-other", endpoint: ENDPOINT, enrolmentRef: fx.enrolment.enrolmentRef },
        { label: "other-endpoint", tenantId: TENANT, endpoint: "wss://other.sent-tech.ca/trunk/v1", enrolmentRef: fx.enrolment.enrolmentRef },
        { label: "other-enrolment", tenantId: TENANT, endpoint: ENDPOINT, enrolmentRef: "enr-other-2" }
      ]) {
        const peerR = new FakeBinaryTrunkPeer({
          meshId: MESH, tenantId: replayTarget.tenantId, endpoint: replayTarget.endpoint, clock: fx.clock, env: TEST_ENV
        });
        peerR.registerEnrolment({ nodeId: fx.key.nodeId, enrolmentRef: replayTarget.enrolmentRef, publicKeyPem: fx.key.publicKeyPem });
        const cR = new TrunkClient({
          root: fx.dirs.root,
          env: TEST_ENV,
          enrolment: {
            meshId: MESH, endpoint: replayTarget.endpoint, tenantId: replayTarget.tenantId,
            enrolmentRef: replayTarget.enrolmentRef, nodeId: fx.key.nodeId
          },
          nodeKeyOptions: { configDir: fx.dirs.configDir },
          connector: peerR.createConnector(`r-${replayTarget.label}`),
          contract: peerR.contract,
          clock: fx.clock,
          catalogue: new FakeCatalogueDouble({ clock: fx.clock })
        });
        cR.start();
        const rConn = peerR.allConnections()[0];
        // Even if server happens to use the exact same bindNonce, cross-tenant/endpoint/enrolment signature MUST fail!
        rConn.currentBindNonce = bindRecs[0].bindNonce;
        cR.sendControl(0, {
          t: "instance.bind",
          instanceId: bindRecs[0].instanceId,
          instancePublicKey: bindRecs[0].instancePublicKey,
          instanceFingerprint: bindRecs[0].instanceFingerprint,
          bindNonce: bindRecs[0].bindNonce,
          sig: bindRecs[0].sig
        });
        const resp = rConn.decodedServerRecords.find((r) => r.t === "instance.bound");
        assert.equal(resp.status, "refused", `replay to ${replayTarget.label} must be refused`);
        cR.stop();
      }

      // Terminal output BEFORE live revocation of A
      assert.equal(
        fx.client.trySendOutput(2, { t: "term.out", sid: "n-a", incarnation: "i1", firstSeq: 1, lastSeq: 1, dataB64: Buffer.from("before").toString("base64") }, 6),
        "sent"
      );

      // Push instance.revoked for A on live link!
      const catCountBefore = conn.receivedCatalogue.length;
      fx.peer.sendInstanceRevoked(conn, wireA, "tenant-admin");

      // Next act of A returns instance-revoked & writes audit naming A
      const actA = fx.client.admitInstanceAct("inst-A");
      assert.equal(actA.ok, false);
      assert.equal(actA.reason, "instance-revoked");
      const auditA = fx.audits.find((e) => e.instanceId === wireA && e.reason === "instance-revoked");
      assert.ok(auditA, "audit must name revoked instance A");
      assert.equal(auditA.meshId, MESH);
      assert.equal(auditA.tenantId, TENANT);
      assert.equal(auditA.enrolmentRef, fx.enrolment.enrolmentRef);

      // Next delta carries complete wire row for A with revoked status
      assert.equal(conn.receivedCatalogue.length, catCountBefore + 1);
      const statusDelta = conn.receivedCatalogue[conn.receivedCatalogue.length - 1].record;
      assert.equal(statusDelta.t, "cat.delta");
      assert.deepEqual(statusDelta.removes, []);
      assert.equal(statusDelta.upserts.length, 1);
      assert.equal(statusDelta.upserts[0].sid, "n-a");
      assert.equal(statusDelta.upserts[0].instanceId, wireA);
      assert.equal(statusDelta.upserts[0].instanceStatus, "revoked");

      // Same generation: B's act AND second terminal output on ch 2 (attached to A) BOTH succeed!
      assert.equal(fx.client.getLinkGeneration(), initialGen);
      assert.equal(fx.client.admitInstanceAct("inst-B").ok, true);
      assert.equal(
        fx.client.trySendOutput(2, { t: "term.out", sid: "n-a", incarnation: "i1", firstSeq: 2, lastSeq: 2, dataB64: Buffer.from("after").toString("base64") }, 5),
        "sent"
      );
      assert.equal((conn.receivedTermOut.get(2) ?? []).length, 2);

      // Verify persisted files are 0600 and contain no secrets
      const revFile = join(fx.dirs.root, "remote-control", "revoked-instances.json");
      const statusFile = join(fx.dirs.root, "remote-control", "link-status.json");
      assert.equal(statSync(revFile).mode & 0o777, 0o600);
      assert.equal(statSync(statusFile).mode & 0o777, 0o600);
      assert.equal(/(BEGIN PRIVATE KEY|signature|nonce)/i.test(readFileSync(statusFile, "utf8")), false);

      // Suppress unused warning on instB
      assert.ok(instB.publicKeyPem);
      fx.client.stop();
    } finally {
      cleanup(fx.dirs);
    }
  }

  // 7c. Concurrent updates on same root preserve readability, union revocations, leave other root untouched
  {
    const dirsA = makeIsolation();
    const dirsB = makeIsolation();
    try {
      const scope = `${MESH}|${TENANT}|enr-c|node-c`;
      assert.equal(persistRevokedInstancesRegistry(dirsA.root, scope, ["inst-1"]).ok, true);
      assert.equal(persistRevokedInstancesRegistry(dirsA.root, scope, ["inst-2"]).ok, true);
      const reg = readRevokedInstancesRegistry(dirsA.root);
      assert.equal(reg.ok, true);
      assert.deepEqual(reg.entries[scope], {
        stateRevision: 0,
        revoked: [wireInstanceId("inst-1"), wireInstanceId("inst-2")].sort()
      });

      assert.equal(writeLinkStatusFile(dirsA.root, { state: "ready", linkGeneration: 3, updatedAt: 100 }).ok, true);
      assert.equal(writeLinkStatusFile(dirsA.root, { lastRefusal: { code: "bad-signature", instanceId: "inst-X", at: 200 }, updatedAt: 200 }).ok, true);
      const merged = readLinkStatusFile(dirsA.root);
      assert.equal(merged?.state, "ready");
      assert.equal(merged?.linkGeneration, 3);
      assert.equal(merged?.lastRefusal?.code, "bad-signature");
      assert.equal(merged?.lastRefusal?.instanceId, "inst-X");

      // Other root is completely untouched
      assert.equal(existsSync(join(dirsB.root, "remote-control")), false);
    } finally {
      cleanup(dirsA);
      cleanup(dirsB);
    }
  }
});

// ============================================================================
// 8. Additional LH-07 acceptance edges: handshake_busy, 20s/40s outages,
//    mid-series 512-row cut, corrupt revoked registry, active-link kill <= 1s,
//    nodeId mismatch, initial credit before term.opened
// ============================================================================

test("additional LH-07 acceptance edges: handshake_busy, 20s/40s outages, mid-series catalogue cut, corrupt revocation file, active-link kill <= 1s, nodeId mismatch, early credit", () => {
  // 8a. nodeId mismatch -> zero connector attempts
  {
    const fx = makeClientFixture({ nodeId: "node:different-from-key" });
    try {
      const res = fx.client.start();
      assert.equal(res.ok, false);
      assert.equal(res.reason, "node-id-mismatch");
      assert.equal(fx.peer.attemptsFor("client-1"), 0);
    } finally {
      cleanup(fx.dirs);
    }
  }

  // 8b. handshake_busy after 5 failed signatures per 10-min window -> respects retryAfterMs
  {
    const dirs = makeIsolation();
    const otherDirs = makeIsolation();
    const clock = new FakeClock(1_700_000_000_000);
    try {
      const realKey = generateNodeKey({ configDir: dirs.configDir });
      const wrongKey = generateNodeKey({ configDir: otherDirs.configDir });
      const peer = new FakeBinaryTrunkPeer({ meshId: MESH, tenantId: TENANT, endpoint: ENDPOINT, clock, env: TEST_ENV });
      peer.registerEnrolment({ nodeId: realKey.nodeId, enrolmentRef: "enr-busy", publicKeyPem: realKey.publicKeyPem });

      // Trigger 5 failed signatures using wrongKey's private key (matching nodeId to pass client check)
      for (let i = 0; i < 5; i++) {
        const badConn = peer.createConnector(`bad-${i}`).open(ENDPOINT, { onMessage() {}, onClose() {}, onError() {} });
        const hello = peer.allConnections()[peer.allConnections().length - 1].decodedServerRecords[0];
        const badSig = signTrunkAuthPayload({
          nonce: hello.nonce, meshId: MESH, endpoint: ENDPOINT, tenantId: TENANT, serverTime: hello.serverTime,
          nodeId: realKey.nodeId, enrolmentRef: "enr-busy", protocolVersions: [1], clientTime: clock.now()
        }, wrongKey.privateKeyPem);
        badConn.send(peer.contract.encodeFrame({
          v: 1, t: "auth", ch: 0, s: 1, nodeId: realKey.nodeId, enrolmentRef: "enr-busy",
          protocolVersions: [1], clientTime: clock.now(), signature: badSig
        }));
      }

      // 6th attempt with the real client gets handshake_busy and schedules retryAfterMs (~600s)
      const client = new TrunkClient({
        root: dirs.root,
        env: TEST_ENV,
        enrolment: { meshId: MESH, endpoint: ENDPOINT, tenantId: TENANT, enrolmentRef: "enr-busy", nodeId: realKey.nodeId },
        nodeKeyOptions: { configDir: dirs.configDir },
        connector: peer.createConnector("real-busy"),
        contract: peer.contract,
        clock,
        catalogue: new FakeCatalogueDouble({ clock })
      });
      client.start();
      assert.equal(client.getState(), "handshake-busy");
      assert.equal(peer.attemptsFor("real-busy"), 1);
      // Before 10-min window passes, zero retries
      clock.advance(599_000);
      assert.equal(peer.attemptsFor("real-busy"), 1);
      // Once 10-min window passes, client retries and succeeds!
      clock.advance(2_000);
      assert.equal(peer.attemptsFor("real-busy"), 2);
      assert.equal(client.getState(), "ready");
      client.stop();
    } finally {
      cleanup(dirs);
      cleanup(otherDirs);
    }
  }

  // 8c. Outage loss/return notifications for 20s and 40s breaks
  for (const outageTargetMs of [20_000, 40_000]) {
    const dirs = makeIsolation();
    const clock = new FakeClock(1_700_000_000_000);
    try {
      const key = generateNodeKey({ configDir: dirs.configDir });
      const peer = new FakeBinaryTrunkPeer({ meshId: MESH, tenantId: TENANT, endpoint: ENDPOINT, clock, env: TEST_ENV });
      peer.registerEnrolment({ nodeId: key.nodeId, enrolmentRef: "enr-out", publicKeyPem: key.publicKeyPem });
      const baseConnector = peer.createConnector("outage");
      let downUntil = 0;
      const gatedConnector = {
        open(endpoint, handlers) {
          if (clock.now() < downUntil) {
            throw new Error("network-unreachable");
          }
          return baseConnector.open(endpoint, handlers);
        }
      };
      const events = [];
      const client = new TrunkClient({
        root: dirs.root,
        env: TEST_ENV,
        enrolment: { meshId: MESH, endpoint: ENDPOINT, tenantId: TENANT, enrolmentRef: "enr-out", nodeId: key.nodeId },
        nodeKeyOptions: { configDir: dirs.configDir },
        connector: gatedConnector,
        contract: peer.contract,
        clock,
        random: () => 0.5,
        catalogue: new FakeCatalogueDouble({ clock }),
        onLinkEvent: (ev) => events.push(ev)
      });
      client.start();
      assert.equal(client.getState(), "ready");
      downUntil = clock.now() + outageTargetMs;
      peer.dropConnection(peer.allConnections()[0], "outage");
      clock.advance(outageTargetMs + 35_000);
      assert.equal(client.getState(), "ready");
      const lost = events.find((e) => e.kind === "link-lost");
      const returned = events.filter((e) => e.kind === "link-ready")[1];
      assert.ok(lost, `${outageTargetMs}ms: must emit link-lost`);
      assert.ok(returned && returned.outageMs >= outageTargetMs, `${outageTargetMs}ms: must report outageMs >= ${outageTargetMs}, got ${returned?.outageMs}`);
      client.stop();
    } finally {
      cleanup(dirs);
    }
  }

  // 8d. Mid-series 512-row cut: new generation restarts with cat.snapshot.part (catSeq=1) and abandons old staging
  {
    const rows512 = Array.from({ length: 512 }, (_, i) =>
      sampleRow(`n-${String(i).padStart(4, "0")}`, "inst-A")
    );
    const fx = makeClientFixture({ initialRows: rows512 });
    try {
      fx.client.start();
      const conn1 = fx.peer.allConnections()[0];
      // Grant only 2 records of credit so 512-row snapshot pauses mid-series
      fx.peer.sendCredit(conn1, 1, { receivedThroughSeq: 0, receivedThroughBytes: 0, sendLimitSeq: 2, sendLimitBytes: 131072 });
      fx.peer.sendWatchStart(conn1);
      assert.equal(conn1.receivedCatalogue.length, 2);
      assert.equal(conn1.receivedCatalogue[0].record.t, "cat.snapshot.part");
      assert.equal(conn1.receivedCatalogue[1].record.t, "cat.snapshot.part");

      // Cut link mid-series!
      fx.peer.dropConnection(conn1, "mid-series-cut");
      fx.clock.advance(2_000);
      assert.equal(fx.client.getState(), "ready");
      const conn2 = fx.peer.allConnections()[1];
      fx.peer.sendCredit(conn2, 1, { receivedThroughSeq: 0, receivedThroughBytes: 0, sendLimitSeq: 2, sendLimitBytes: 131072 });
      fx.peer.sendWatchStart(conn2);
      assert.equal(conn2.receivedCatalogue[0].record.t, "cat.snapshot.part", "new generation must restart with cat.snapshot.part");
      assert.equal(conn2.receivedCatalogue[0].record.catSeq, 1);
      fx.client.stop();
    } finally {
      cleanup(fx.dirs);
    }
  }

  // 8e. Corrupt revoked-instances.json suspends instance acts until restored
  {
    const fx = makeClientFixture();
    try {
      createRegisteredInstance(fx.dirs.root, "inst-A");
      fx.client.start();
      assert.equal(fx.client.bindInstance("inst-A").ok, true);
      assert.equal(fx.client.admitInstanceAct("inst-A").ok, true);

      // Corrupt local revocation file -> fail closed!
      mkdirSync(join(fx.dirs.root, "remote-control"), { recursive: true });
      writeFileSync(join(fx.dirs.root, "remote-control", "revoked-instances.json"), "{corrupt-json", { mode: 0o600 });
      const blocked = fx.client.admitInstanceAct("inst-A");
      assert.equal(blocked.ok, false);
      assert.equal(blocked.reason, "instance-registry-unavailable");

      // Restore valid file -> acts admitted again!
      writeFileSync(join(fx.dirs.root, "remote-control", "revoked-instances.json"), JSON.stringify({ version: 1, entries: {} }) + "\n", { mode: 0o600 });
      assert.equal(fx.client.admitInstanceAct("inst-A").ok, true);
      fx.client.stop();
    } finally {
      cleanup(fx.dirs);
    }
  }

  // 8f. Active-link kill switch via H2A_REMOTE_OFF closes link within <= 1s and writes local kill flag
  {
    const env = { H2A_REMOTE_CONTROL: "1", H2A_TEST_FAKES: "1" };
    const fx = makeClientFixture({ env });
    try {
      fx.client.start();
      assert.equal(fx.client.getState(), "ready");
      const conn = fx.peer.allConnections()[0];
      env.H2A_REMOTE_OFF = "1";
      fx.clock.advance(1_000);
      assert.equal(conn.closed, true, "active link must close within <= 1s of H2A_REMOTE_OFF");
      assert.equal(fx.client.getState(), "killed");
      assert.equal(readRemoteControlKillFlag(fx.dirs.root).kill, true);
      assert.equal(fx.clock.pendingTimerCount(), 0);
    } finally {
      cleanup(fx.dirs);
    }
  }

  // 8g. Initial credit arriving immediately on ch >= 2 before term.opened is accepted and usable
  {
    let capturedCtx = null;
    const fx = makeClientFixture({
      terminalConsumer: {
        onOpen(_open, ctx) {
          capturedCtx = ctx;
          // Intentionally omit `opened` so peer sends credit BEFORE consumer emits term.opened
          return { ok: true };
        }
      }
    });
    try {
      fx.client.start();
      const conn = fx.peer.allConnections()[0];
      fx.peer.sendTermOpen(conn, { ch: 2, sid: "n-a" });
      fx.peer.sendCredit(conn, 2, { receivedThroughSeq: 0, receivedThroughBytes: 0, sendLimitSeq: 2, sendLimitBytes: 512 });
      assert.deepEqual(capturedCtx.availableOutput(), { records: 2, bytes: 512 });
      assert.equal(
        capturedCtx.sendControl({
          t: "term.opened", sid: "n-a", generation: "g1", incarnation: "i1",
          status: "running", latestSeq: 0, holderKind: "none", size: { cols: 80, rows: 24 }
        }),
        true
      );
      assert.equal(
        capturedCtx.trySendOutput({
          t: "term.out", sid: "n-a", incarnation: "i1", firstSeq: 1, lastSeq: 1,
          dataB64: Buffer.from("early").toString("base64")
        }, 5),
        "sent"
      );
      fx.client.stop();
    } finally {
      cleanup(fx.dirs);
    }
  }
});

test("R11 inc-2: wireInstanceId <= 36B, queued multi-bind preserves localHandle, revocation & v1->v2 migration", () => {
  const expectedWireId = (handle) => `i-${createHash("sha256").update(handle, "utf8").digest("hex").slice(0, 32)}`;
  const longHandle = "claude:sentropic-harness:abcdef123456"; // 37 bytes
  const longHandle2 = "codex:sentropic-harness:fedcba654321";
  assert.equal(longHandle.length, 37);

  // 1. Instance bind for >36-byte local handle emits 34-byte wire id and verifies signature
  {
    const fx = makeClientFixture({
      initialRows: [sampleRow("n-long", expectedWireId(longHandle))]
    });
    try {
      const reg = createRegisteredInstance(fx.dirs.root, longHandle);
      assert.ok(reg.publicKeyPem);
      assert.equal(fx.client.start().ok, true);
      const conn = fx.peer.allConnections()[0];
      assert.equal(fx.client.bindInstance(longHandle).ok, true);
      const bindRec = conn.decodedClientRecords.find((r) => r.t === "instance.bind");
      assert.ok(bindRec);
      assert.match(bindRec.instanceId, /^i-[0-9a-f]{32}$/);
      assert.equal(bindRec.instanceId, expectedWireId(longHandle));
      for (const rawFrame of conn.observedClientFrames) {
        const len = Buffer.from(rawFrame).readUInt32BE(0);
        const obj = JSON.parse(Buffer.from(rawFrame).subarray(4, 4 + len).toString("utf8"));
        for (const field of ["nodeId", "instanceId", "sid"]) {
          if (typeof obj[field] === "string") {
            assert.ok(Buffer.byteLength(obj[field], "utf8") <= 36, `wire ${field} exceeds 36B: ${obj[field]}`);
            assert.match(obj[field], /^[a-z0-9-]+$/, `wire ${field} out of [a-z0-9-]: ${obj[field]}`);
          }
        }
      }
      const boundRec = conn.decodedServerRecords.find((r) => r.t === "instance.bound");
      assert.equal(boundRec?.status, "live");
      assert.equal(boundRec?.instanceId, expectedWireId(longHandle));
      assert.equal(fx.client.admitInstanceAct(longHandle).ok, true);
      fx.client.stop();
    } finally {
      cleanup(fx.dirs);
    }
  }

  // 2. Queued back-to-back binds while first is in-flight preserve localHandle -> second binds with its own wireId/key/fp
  {
    const dirs = makeIsolation();
    try {
      const clock = new FakeClock(1_700_000_000_000);
      const key = generateNodeKey({ configDir: dirs.configDir });
      const contract = createSimulatedTrunkContractProvider();
      const peer = new FakeBinaryTrunkPeer({ meshId: MESH, tenantId: TENANT, endpoint: ENDPOINT, clock, env: TEST_ENV, contract });
      peer.registerEnrolment({ nodeId: key.nodeId, enrolmentRef: "enr-q", publicKeyPem: key.publicKeyPem, fingerprint: key.fingerprint });
      const inst1 = createRegisteredInstance(dirs.root, longHandle);
      const inst2 = createRegisteredInstance(dirs.root, longHandle2);
      const baseConnector = peer.createConnector("queue-test");
      const deferredBoundFrames = [];
      let deferNextBound = true;
      const wrappedConnector = {
        open(endpoint, handlers) {
          const wrappedHandlers = {
            ...handlers,
            onMessage(frame) {
              const dec = contract.decodeFrame(frame);
              if (dec.ok && dec.record.t === "instance.bound" && deferNextBound) {
                deferNextBound = false;
                deferredBoundFrames.push(() => handlers.onMessage(frame));
                return;
              }
              handlers.onMessage(frame);
            }
          };
          return baseConnector.open(endpoint, wrappedHandlers);
        }
      };
      const audits = [];
      const client = new TrunkClient({
        root: dirs.root,
        env: TEST_ENV,
        enrolment: { meshId: MESH, endpoint: ENDPOINT, tenantId: TENANT, enrolmentRef: "enr-q", nodeId: key.nodeId },
        nodeKeyOptions: { configDir: dirs.configDir },
        connector: wrappedConnector,
        contract,
        clock,
        catalogue: new FakeCatalogueDouble({ clock }),
        onAudit: (ev) => audits.push(ev)
      });
      assert.equal(client.start().ok, true);
      const conn = peer.allConnections()[0];
      assert.equal(client.bindInstance(longHandle).ok, true);
      assert.equal(client.bindInstance(longHandle2).ok, true);
      assert.equal(deferredBoundFrames.length, 1);
      // Release first instance.bound -> drains queue for longHandle2
      deferredBoundFrames[0]();
      const bindRecs = conn.decodedClientRecords.filter((r) => r.t === "instance.bind");
      assert.equal(bindRecs.length, 2);
      assert.equal(bindRecs[0].instanceId, expectedWireId(longHandle));
      assert.equal(bindRecs[1].instanceId, expectedWireId(longHandle2));
      assert.equal(bindRecs[1].instancePublicKey, extractRawEd25519PublicKeyBase64(inst2.publicKeyPem));
      assert.equal(bindRecs[1].instanceFingerprint, formatWET2Fingerprint(Buffer.from(bindRecs[1].instancePublicKey, "base64")));
      assert.equal(audits.some((a) => a.reason === "unknown-instance"), false);
      assert.equal(client.admitInstanceAct(longHandle).ok, true);
      assert.equal(client.admitInstanceAct(longHandle2).ok, true);
      assert.ok(inst1.publicKeyPem);
      client.stop();
    } finally {
      cleanup(dirs);
    }
  }

  // 3. Revocation by wireId + v1 registry containing local handle -> enforced & rewritten in v2
  {
    const fx = makeClientFixture({
      initialRows: [sampleRow("n-long", expectedWireId(longHandle))]
    });
    try {
      createRegisteredInstance(fx.dirs.root, longHandle);
      const revDir = join(fx.dirs.root, "remote-control");
      mkdirSync(revDir, { recursive: true, mode: 0o700 });
      const scope = `${MESH}|${TENANT}|${fx.enrolment.enrolmentRef}|${fx.key.nodeId}`;
      writeFileSync(join(revDir, "revoked-instances.json"), JSON.stringify({
        version: 1,
        entries: { [scope]: [longHandle] }
      }, null, 2) + "\n", { mode: 0o600 });

      assert.equal(fx.client.start().ok, true);
      const actAfterV1 = fx.client.admitInstanceAct(longHandle);
      assert.equal(actAfterV1.ok, false);
      assert.equal(actAfterV1.reason, "instance-revoked");

      const revDisk = JSON.parse(readFileSync(join(revDir, "revoked-instances.json"), "utf8"));
      assert.equal(revDisk.version, 2);
      assert.deepEqual(revDisk.entries[scope], { stateRevision: 0, revoked: [expectedWireId(longHandle)] });

      // Live revoke of a second handle by wireId -> audit & catalogue carry wireId, admitInstanceAct refuses local handle
      createRegisteredInstance(fx.dirs.root, longHandle2);
      assert.equal(fx.client.bindInstance(longHandle2).ok, true);
      const conn = fx.peer.allConnections()[0];
      fx.peer.sendInstanceRevoked(conn, expectedWireId(longHandle2), "user");
      const act2 = fx.client.admitInstanceAct(longHandle2);
      assert.equal(act2.ok, false);
      assert.equal(act2.reason, "instance-revoked");
      const auditRev2 = fx.audits.find((e) => e.kind === "instance-revoked" && e.instanceId === expectedWireId(longHandle2));
      assert.ok(auditRev2);
      assert.equal(auditRev2.instanceHandle, longHandle2);
      const statusRes = runRemoteControlVerb("status", { root: fx.dirs.root, env: TEST_ENV });
      assert.equal(statusRes.ok, true);
      assert.equal(statusRes.lastRefusal?.instanceId, expectedWireId(longHandle2));
      assert.equal(statusRes.lastRefusal?.instanceHandle, longHandle2);
      fx.client.stop();
    } finally {
      cleanup(fx.dirs);
    }
  }
});
