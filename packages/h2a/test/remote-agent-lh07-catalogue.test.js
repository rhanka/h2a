// LH-07 section 3: end-to-end integration qualification with the real LH-06
// catalogue projector, real presences, native inventory, exclusions and the
// simulated binary trunk peer.
// Every case runs under a disposable TMPDIR and isolated HOME (never /tmp,
// never owner ~/.config or real native hosts).

import assert from "node:assert/strict";
import test from "node:test";
import { generateKeyPairSync } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { join, resolve } from "node:path";

import {
  canonicalTrunkJson,
  CATALOGUE_DELTA_MAX_ENTRIES,
  CATALOGUE_PART_MAX_ROWS,
  CATALOGUE_RECORD_MAX_BYTES,
  CATALOGUE_SNAPSHOT_MAX_BYTES,
  CATALOGUE_SNAPSHOT_MAX_PARTS,
  createCatalogueProjector,
  generateNodeKey,
  nativeCatalogueSid,
  setSessionExcluded,
  TrunkClient,
  wireInstanceId
} from "../dist/runtime/remote-agent/index.js";
import * as peerHelpers from "./helpers/remote-trunk-peer.js";
import {
  CatalogueSliceStager,
  FakeBinaryTrunkPeer,
  createSimulatedTrunkContractProvider,
  provisionalWireRow
} from "./helpers/remote-trunk-peer.js";

const MESH = "remote-test";
const TENANT = "tenant-a";
const ENDPOINT = "wss://remote.sent-tech.ca/trunk/v1";

class AsyncFakeClock {
  #now;
  #nextId = 1;
  #timers = new Map();

  constructor(startMs = Date.parse("2026-11-21T10:00:30.000Z")) {
    this.#now = startMs;
  }

  now() {
    return this.#now;
  }

  setTimeout(fn, ms) {
    const id = this.#nextId++;
    const delay = Number.isFinite(ms) ? Math.max(0, Math.floor(ms)) : 0;
    const handle = { id, unref() {} };
    this.#timers.set(id, { id, at: this.#now + delay, fn });
    return handle;
  }

  clearTimeout(handle) {
    if (handle && typeof handle.id === "number") {
      this.#timers.delete(handle.id);
    } else if (typeof handle === "number") {
      this.#timers.delete(handle);
    }
  }

  async flushMicrotasks(rounds = 8) {
    for (let i = 0; i < rounds; i++) {
      await Promise.resolve();
    }
  }

  async advance(ms) {
    const target = this.#now + ms;
    for (;;) {
      await this.flushMicrotasks();
      let earliest = null;
      for (const timer of this.#timers.values()) {
        if (
          timer.at <= target &&
          (!earliest || timer.at < earliest.at || (timer.at === earliest.at && timer.id < earliest.id))
        ) {
          earliest = timer;
        }
      }
      if (!earliest) break;
      this.#timers.delete(earliest.id);
      this.#now = earliest.at;
      earliest.fn();
      await this.flushMicrotasks();
    }
    this.#now = target;
    await this.flushMicrotasks();
  }
}

function makeIsolation() {
  assert.ok(process.env.TMPDIR && resolve(process.env.TMPDIR) !== "/tmp", "Supply a disposable TMPDIR");
  const base = mkdtempSync(join(process.env.TMPDIR, "lh07-cat-"));
  const root = join(base, "root");
  const configDir = join(base, "config");
  const home = join(base, "home");
  const runtimeDir = join(base, "run");
  for (const dir of [root, configDir, home, runtimeDir]) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  const env = {
    HOME: home,
    TMPDIR: process.env.TMPDIR,
    TMP: process.env.TMPDIR,
    TEMP: process.env.TMPDIR,
    XDG_CONFIG_HOME: configDir,
    XDG_RUNTIME_DIR: runtimeDir,
    H2A_ROOT: root,
    H2A_REMOTE_CONTROL: "1",
    H2A_TEST_FAKES: "1"
  };
  return { base, root, configDir, home, runtimeDir, env };
}

function cleanup(iso) {
  rmSync(iso.base, { recursive: true, force: true });
}

function createRegisteredInstance(root, instanceId) {
  const keysDir = join(root, "keys");
  const regDir = join(root, "registry");
  mkdirSync(keysDir, { recursive: true, mode: 0o700 });
  mkdirSync(regDir, { recursive: true, mode: 0o700 });
  const pair = generateKeyPairSync("ed25519", {
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" }
  });
  const keyName = instanceId.replace(/[:/]/g, "-");
  writeFileSync(join(keysDir, `${keyName}.key.pem`), pair.privateKey, { mode: 0o600 });
  writeFileSync(join(keysDir, `${keyName}.pub.pem`), pair.publicKey, { mode: 0o600 });
  const row = {
    id: instanceId,
    instance: instanceId,
    roles: ["AGENTS"],
    scopes: [],
    capabilities: [],
    endpoints: [{ kind: "local-files", uri: `file://${root}` }],
    publicKeys: [pair.publicKey],
    acceptedPolicies: [],
    createdAt: "2026-11-21T10:00:00.000Z"
  };
  writeFileSync(join(regDir, "instances.jsonl"), `${JSON.stringify(row)}\n`, { flag: "a" });
  return pair;
}

function writePresenceFile(root, session) {
  const dir = join(root, "presence");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(join(dir, `${session.sessionId}.json`), `${JSON.stringify(session)}\n`, "utf8");
}

function makePresence(sessionId, overrides = {}) {
  return {
    sessionId,
    instance: overrides.instance,
    host: overrides.host ?? "claude",
    name: overrides.name ?? `session-${sessionId}`,
    startedAt: overrides.startedAt ?? "2026-11-21T10:00:00.000Z",
    heartbeatAt: overrides.heartbeatAt ?? "2026-11-21T10:00:25.000Z",
    state: overrides.state ?? "live",
    interests: { scopes: [], negotiations: [] },
    subscribedTopics: [],
    workStatus: overrides.workStatus ?? "working",
    ...(overrides.workspace === undefined ? {} : { workspace: overrides.workspace }),
    ...(overrides.launchContext === undefined ? {} : { launchContext: overrides.launchContext }),
    ...(overrides.pid === undefined ? {} : { pid: overrides.pid })
  };
}

function makeNativeSession(id, overrides = {}) {
  return {
    id,
    generation: overrides.generation ?? "gen-1",
    incarnation: overrides.incarnation ?? "inc-1",
    pid: overrides.pid ?? 42000,
    cols: overrides.cols ?? 120,
    rows: overrides.rows ?? 40,
    status: overrides.status ?? "running",
    socketPath: overrides.socketPath ?? "/private/h2a-native.sock",
    exit: null,
    controlled: false,
    holderKind: "none"
  };
}

function reconstructCatalogueFromFrames(receivedCatalogue) {
  assert.ok(receivedCatalogue.length > 0, "expected at least one catalogue frame on channel 1");
  const expectedNodeId = receivedCatalogue[0].record.nodeId;
  const stager = new CatalogueSliceStager({ expectedNodeId });
  for (const frame of receivedCatalogue) {
    const res = stager.ingest(frame.record, frame.encodedBytes);
    assert.equal(res.ok, true, `stager rejected frame: ${res.code}`);
  }
  const slice = stager.getSlice();
  assert.ok(slice, "expected committed slice from channel-1 frames");
  return slice;
}

function grantChannel1Credit(peer, conn, { seq = 64, bytes = 512 * 1024 } = {}) {
  // Respect MAX_CREDIT_WINDOW_RECORDS (8) and MAX_CREDIT_WINDOW_BYTES (131072)
  // by issuing rolling credits as frames arrive.
  let ackSeq = 0;
  let ackBytes = 0;
  for (let round = 0; round < 32; round++) {
    const delivered = conn.receivedCatalogue;
    ackSeq = delivered.length;
    ackBytes = delivered.reduce((sum, item) => sum + item.encodedBytes, 0);
    const targetSeq = Math.min(seq, ackSeq + 8);
    const targetBytes = Math.min(bytes, ackBytes + 131_072);
    peer.sendCredit(conn, 1, {
      receivedThroughSeq: ackSeq,
      receivedThroughBytes: ackBytes,
      sendLimitSeq: targetSeq,
      sendLimitBytes: targetBytes
    });
    if (conn.receivedCatalogue.length === ackSeq) break;
  }
}

// ============================================================================
// 1. Offline revocation in ready.revokedInstances + real LH-06 exclusions & filter
// ============================================================================

test("LH-07 + LH-06 integration: offline ready.revokedInstances marks A revoked in first snapshot, never live; exclusions and companion filter hold", async () => {
  const iso = makeIsolation();
  try {
    const clock = new AsyncFakeClock(Date.parse("2026-11-21T10:00:30.000Z"));
    const nodeKey = generateNodeKey({ configDir: iso.configDir, env: iso.env });
    const instA = "claude:inst-A:aaa111";
    const instB = "claude:inst-B:bbb222";
    createRegisteredInstance(iso.root, instA);
    createRegisteredInstance(iso.root, instB);

    // Real local presence files for A, B, an excluded session, and an MCP companion
    writePresenceFile(
      iso.root,
      makePresence("pres-a", {
        instance: instA,
        name: "Alpha session",
        workspace: { id: "ws-alpha-id", host: "claude", label: "ws-alpha" },
        launchContext: { cwd: "/secret/home/alice/alpha", command: "claude", nativePty: { session: "nat-a" } }
      })
    );
    writePresenceFile(
      iso.root,
      makePresence("pres-b", {
        instance: instB,
        name: "Beta session",
        workspace: { id: "ws-beta-id", host: "claude", label: "ws-beta", uri: "file:///secret/beta" },
        launchContext: { cwd: "/secret/home/alice/beta", command: "claude", nativePty: { session: "nat-b" } }
      })
    );
    writePresenceFile(
      iso.root,
      makePresence("pres-excl", {
        instance: instB,
        name: "Private session",
        launchContext: { cwd: "/private/excl", command: "claude", nativePty: { session: "nat-excl" } }
      })
    );

    // Exclude nat-excl via real LH-06 exclusions store
    const exclRes = setSessionExcluded("nat-excl", {
      root: iso.root,
      configDir: iso.configDir,
      env: iso.env
    });
    assert.equal(exclRes.ok, true);

    const inventory = {
      complete: true,
      sessions: [
        makeNativeSession("nat-a"),
        makeNativeSession("nat-a.h2a"), // MCP internal companion -> must be filtered out
        makeNativeSession("nat-b"),
        makeNativeSession("nat-excl")
      ]
    };

    const projector = createCatalogueProjector({
      root: iso.root,
      configDir: iso.configDir,
      env: iso.env,
      clock,
      readNativeInventory: async () => inventory
    });

    const contract = createSimulatedTrunkContractProvider();
    const peer = new FakeBinaryTrunkPeer({
      meshId: MESH,
      tenantId: TENANT,
      endpoint: ENDPOINT,
      clock,
      env: iso.env,
      contract
    });
    peer.registerEnrolment({
      nodeId: nodeKey.nodeId,
      enrolmentRef: "enr-cat-1",
      publicKeyPem: nodeKey.publicKeyPem,
      fingerprint: nodeKey.fingerprint,
      revokedInstances: [instA]
    });

    const client = new TrunkClient({
      root: iso.root,
      env: iso.env,
      enrolment: {
        meshId: MESH,
        endpoint: ENDPOINT,
        tenantId: TENANT,
        enrolmentRef: "enr-cat-1",
        nodeId: nodeKey.nodeId
      },
      nodeKeyOptions: { configDir: iso.configDir, env: iso.env },
      connector: peer.createConnector("lh07-cat-1"),
      contract,
      clock,
      catalogue: projector
    });

    const started = client.start();
    assert.equal(started.ok, true);
    assert.equal(client.getState(), "ready");

    const conn = peer.allConnections()[0];
    // Before watch.start: zero catalogue frames emitted
    assert.equal(conn.receivedCatalogue.length, 0);

    peer.sendWatchStart(conn);
    peer.sendCredit(conn, 1, {
      receivedThroughSeq: 0,
      receivedThroughBytes: 0,
      sendLimitSeq: 8,
      sendLimitBytes: 65536
    });
    await clock.flushMicrotasks();

    assert.ok(conn.receivedCatalogue.length >= 2, "peer must decode paginated snapshot on channel 1");
    const firstRecord = conn.receivedCatalogue[0].record;
    assert.equal(firstRecord.t, "cat.snapshot.part");
    assert.equal(firstRecord.ch, 1);

    const wireA = wireInstanceId(instA);
    const wireB = wireInstanceId(instB);
    // No intermediate image may ever show A as live
    for (const frame of conn.receivedCatalogue) {
      const rows = frame.record.t === "cat.snapshot.part"
        ? frame.record.rows
        : frame.record.t === "cat.delta"
          ? frame.record.upserts
          : [];
      for (const r of rows) {
        if (r.instanceId === wireA) {
          assert.equal(r.instanceStatus, "revoked", "A must never appear as live in any frame");
        }
      }
    }

    const { rows } = reconstructCatalogueFromFrames(conn.receivedCatalogue);
    assert.equal(rows.length, 3, "companion nat-a.h2a must be excluded, leaving A, B and nat-excl");

    const sidA = nativeCatalogueSid("nat-a");
    const sidB = nativeCatalogueSid("nat-b");
    const sidExcl = nativeCatalogueSid("nat-excl");
    const rowA = rows.find((r) => r.sid === sidA);
    const rowB = rows.find((r) => r.sid === sidB);
    const rowExcl = rows.find((r) => r.sid === sidExcl);

    assert.ok(rowA, "row A must be present");
    assert.equal(rowA.instanceId, wireA);
    assert.equal(rowA.instanceStatus, "revoked");
    assert.equal(rowA.workspaceLabel, "ws-alpha");

    assert.ok(rowB, "row B must be present");
    assert.equal(rowB.instanceId, wireB);
    assert.equal(rowB.instanceStatus, "live");
    assert.equal(rowB.operable, true);

    assert.ok(rowExcl, "excluded row must remain visible as excluded & inoperable");
    assert.equal(rowExcl.excluded, true);
    assert.equal(rowExcl.operable, false);
    assert.equal(projector.getProjection()?.rows.find((r) => r.sessionId === sidExcl)?.operabilityReason, "not-shared");

    // Verify no forbidden local fields leaked onto channel 1 bytes
    const rawChannel1Text = conn.receivedCatalogue.map((c) => JSON.stringify(c.record)).join("\n");
    assert.equal(rawChannel1Text.includes("/secret/home"), false);
    assert.equal(rawChannel1Text.includes("file:///secret"), false);
    assert.equal(rawChannel1Text.includes("nat-a.h2a"), false);

    client.stop();
  } finally {
    cleanup(iso);
  }
});

// ============================================================================
// 2. Live instance.revoked push + terminal channel + persistence across restart
// ============================================================================

test("LH-07 + LH-06 integration: live instance.revoked push emits status-only delta <= 1s, refuses A, keeps B + terminal alive, persists across empty ready", async () => {
  const iso = makeIsolation();
  try {
    const clock = new AsyncFakeClock(Date.parse("2026-11-21T10:00:30.000Z"));
    const nodeKey = generateNodeKey({ configDir: iso.configDir, env: iso.env });
    const instA = "claude:inst-A:live111";
    const instB = "claude:inst-B:live222";
    createRegisteredInstance(iso.root, instA);
    createRegisteredInstance(iso.root, instB);

    writePresenceFile(
      iso.root,
      makePresence("pres-a", {
        instance: instA,
        name: "Live A",
        launchContext: { cwd: "/private/live-a", command: "claude", nativePty: { session: "nat-a" } }
      })
    );
    writePresenceFile(
      iso.root,
      makePresence("pres-b", {
        instance: instB,
        name: "Live B",
        launchContext: { cwd: "/private/live-b", command: "claude", nativePty: { session: "nat-b" } }
      })
    );

    const inventory = {
      complete: true,
      sessions: [makeNativeSession("nat-a"), makeNativeSession("nat-b")]
    };
    const sidA = nativeCatalogueSid("nat-a");
    const sidB = nativeCatalogueSid("nat-b");

    const projector = createCatalogueProjector({
      root: iso.root,
      configDir: iso.configDir,
      env: iso.env,
      clock,
      readNativeInventory: async () => inventory
    });

    const contract = createSimulatedTrunkContractProvider();
    const peer = new FakeBinaryTrunkPeer({
      meshId: MESH,
      tenantId: TENANT,
      endpoint: ENDPOINT,
      clock,
      env: iso.env,
      contract
    });
    peer.registerEnrolment({
      nodeId: nodeKey.nodeId,
      enrolmentRef: "enr-cat-2",
      publicKeyPem: nodeKey.publicKeyPem,
      fingerprint: nodeKey.fingerprint,
      revokedInstances: []
    });

    const audits = [];
    const openChannels = new Map();
    const client = new TrunkClient({
      root: iso.root,
      env: iso.env,
      enrolment: {
        meshId: MESH,
        endpoint: ENDPOINT,
        tenantId: TENANT,
        enrolmentRef: "enr-cat-2",
        nodeId: nodeKey.nodeId
      },
      nodeKeyOptions: { configDir: iso.configDir, env: iso.env },
      connector: peer.createConnector("lh07-cat-2"),
      contract,
      clock,
      catalogue: projector,
      onAudit: (ev) => audits.push(ev),
      terminalConsumer: {
        onOpen(open, ctx) {
          openChannels.set(open.ch, ctx);
          return {
            ok: true,
            opened: {
              sid: open.sid,
              generation: "gen-1",
              incarnation: "inc-1",
              status: "running",
              latestSeq: 1,
              holderKind: "none",
              size: { cols: 120, rows: 40 }
            }
          };
        }
      }
    });

    assert.equal(client.start().ok, true);
    const conn = peer.allConnections()[0];
    const initialGen = client.getLinkGeneration();
    assert.equal(initialGen, 1);

    // Bind both instances A and B -> both live
    assert.equal(client.bindInstance(instA).ok, true);
    assert.equal(client.bindInstance(instB).ok, true);
    assert.equal(client.admitInstanceAct(instA).ok, true);
    assert.equal(client.admitInstanceAct(instB).ok, true);

    // Start watch & verify initial snapshot has A and B live
    peer.sendWatchStart(conn);
    peer.sendCredit(conn, 1, {
      receivedThroughSeq: 0,
      receivedThroughBytes: 0,
      sendLimitSeq: 8,
      sendLimitBytes: 65536
    });
    await clock.flushMicrotasks();

    const snap0 = reconstructCatalogueFromFrames(conn.receivedCatalogue);
    assert.equal(snap0.rows.find((r) => r.sid === sidA)?.instanceStatus, "live");
    assert.equal(snap0.rows.find((r) => r.sid === sidB)?.instanceStatus, "live");

    // Open terminal channel 2 on A's session and send output before revocation
    peer.sendTermOpen(conn, { ch: 2, sid: sidA, mode: "observe" });
    peer.sendCredit(conn, 2, {
      receivedThroughSeq: 0,
      receivedThroughBytes: 0,
      sendLimitSeq: 8,
      sendLimitBytes: 65536
    });
    const termCtx = openChannels.get(2);
    assert.ok(termCtx, "terminal channel 2 must be opened");
    const preChunk = Buffer.from("output-before-revoke\n", "utf8");
    assert.equal(
      termCtx.trySendOutput(
        {
          t: "term.out",
          sid: sidA,
          incarnation: "inc-1",
          firstSeq: 1,
          lastSeq: 1,
          dataB64: preChunk.toString("base64")
        },
        preChunk.byteLength
      ),
      "sent"
    );
    assert.equal(conn.receivedTermOut.get(2)?.length, 1);

    // Push live instance.revoked for A and measure push-to-delta delay on peer clock
    const wireA = wireInstanceId(instA);
    const framesBeforePush = conn.receivedCatalogue.length;
    const pushAt = clock.now();
    peer.sendInstanceRevoked(conn, wireA, "user");

    // Immediate refusal for A + audit naming A; B still authorized
    const actA = client.admitInstanceAct(instA);
    assert.equal(actA.ok, false);
    assert.equal(actA.reason, "instance-revoked");
    assert.equal(client.admitInstanceAct(instB).ok, true);
    assert.ok(
      audits.some((e) => e.instanceId === wireA && (e.kind === "instance-revoked" || e.reason === "instance-revoked")),
      "audit log must name revoked instance A"
    );

    // Advance clock through LH-06 250ms coalesce window and check <= 1s delay
    await clock.advance(250);
    const deltaReceivedAt = clock.now();
    const delayMs = deltaReceivedAt - pushAt;
    assert.ok(delayMs <= 1000, `status delta delay ${delayMs}ms must be <= 1000ms`);

    const postPushFrames = conn.receivedCatalogue.slice(framesBeforePush);
    assert.equal(postPushFrames.length, 1, "expected exactly one cat.delta with full row upsert");
    const deltaRec = postPushFrames[0].record;
    assert.equal(deltaRec.t, "cat.delta");
    assert.deepEqual(deltaRec.removes, []);
    assert.equal(deltaRec.upserts.length, 1);
    assert.equal(deltaRec.upserts[0].sid, sidA);
    assert.equal(deltaRec.upserts[0].instanceId, wireA);
    assert.equal(deltaRec.upserts[0].instanceStatus, "revoked");
    assert.equal(deltaRec.upserts[0].name, "Live A");

    // Same link generation, B still acts, and terminal channel 2 still streams after push
    assert.equal(client.getLinkGeneration(), initialGen);
    assert.equal(client.admitInstanceAct(instB).ok, true);
    const postChunk = Buffer.from("output-after-revoke\n", "utf8");
    assert.equal(
      termCtx.trySendOutput(
        {
          t: "term.out",
          sid: sidA,
          incarnation: "inc-1",
          firstSeq: 2,
          lastSeq: 2,
          dataB64: postChunk.toString("base64")
        },
        postChunk.byteLength
      ),
      "sent"
    );
    assert.equal(conn.receivedTermOut.get(2)?.length, 2);

    client.stop();

    // Recreate client + projector with SAME root/config and EMPTY ready.revokedInstances
    const clock2 = new AsyncFakeClock(Date.parse("2026-11-21T10:00:30.000Z"));
    const peer2 = new FakeBinaryTrunkPeer({
      meshId: MESH,
      tenantId: TENANT,
      endpoint: ENDPOINT,
      clock: clock2,
      env: iso.env,
      contract
    });
    peer2.registerEnrolment({
      nodeId: nodeKey.nodeId,
      enrolmentRef: "enr-cat-2",
      publicKeyPem: nodeKey.publicKeyPem,
      fingerprint: nodeKey.fingerprint,
      revokedInstances: [], // explicitly empty image
      stateRevision: 1
    });

    const projector2 = createCatalogueProjector({
      root: iso.root,
      configDir: iso.configDir,
      env: iso.env,
      clock: clock2,
      readNativeInventory: async () => inventory
    });

    const client2 = new TrunkClient({
      root: iso.root,
      env: iso.env,
      enrolment: {
        meshId: MESH,
        endpoint: ENDPOINT,
        tenantId: TENANT,
        enrolmentRef: "enr-cat-2",
        nodeId: nodeKey.nodeId
      },
      nodeKeyOptions: { configDir: iso.configDir, env: iso.env },
      connector: peer2.createConnector("lh07-cat-2-restarted"),
      contract,
      clock: clock2,
      catalogue: projector2
    });

    assert.equal(client2.start().ok, true);
    const conn2 = peer2.allConnections()[0];
    const ready2 = conn2.decodedServerRecords.find((r) => r.t === "ready");
    assert.equal(ready2.stateSync, "full");
    assert.equal("revokedInstances" in ready2, false);
    const begin2 = conn2.decodedServerRecords.find((r) => r.t === "state.begin");
    assert.equal(begin2?.revocationCount, 0);

    peer2.sendWatchStart(conn2);
    peer2.sendCredit(conn2, 1, {
      receivedThroughSeq: 0,
      receivedThroughBytes: 0,
      sendLimitSeq: 8,
      sendLimitBytes: 65536
    });
    await clock2.flushMicrotasks();

    const restartedSnap = reconstructCatalogueFromFrames(conn2.receivedCatalogue);
    assert.equal(
      restartedSnap.rows.find((r) => r.sid === sidA)?.instanceStatus,
      "revoked",
      "persisted revocation of A must appear on first snapshot even when authority image is empty"
    );
    assert.equal(restartedSnap.rows.find((r) => r.sid === sidB)?.instanceStatus, "live");

    client2.stop();
  } finally {
    cleanup(iso);
  }
});

// ============================================================================
// 4. R11 Increment 5: paginated catalogue & slice stager gates (1..13)
// ============================================================================

function setupPaginatedHarness(iso, {
  clock = new AsyncFakeClock(Date.parse("2026-11-21T10:00:30.000Z")),
  enrolmentRef = "enr-r11-inc5",
  readNativeInventory,
  readPresences,
  contract,
  audits = []
} = {}) {
  const nodeKey = generateNodeKey({ configDir: iso.configDir, env: iso.env });
  const effectiveContract = contract ?? createSimulatedTrunkContractProvider();
  const projector = createCatalogueProjector({
    root: iso.root,
    configDir: iso.configDir,
    env: iso.env,
    clock,
    readNativeInventory,
    readPresences,
    onAudit: (ev) => audits.push(ev)
  });
  const peer = new FakeBinaryTrunkPeer({
    meshId: MESH,
    tenantId: TENANT,
    endpoint: ENDPOINT,
    clock,
    env: iso.env,
    contract: effectiveContract
  });
  peer.registerEnrolment({
    nodeId: nodeKey.nodeId,
    enrolmentRef,
    publicKeyPem: nodeKey.publicKeyPem,
    fingerprint: nodeKey.fingerprint
  });
  const client = new TrunkClient({
    root: iso.root,
    env: iso.env,
    enrolment: {
      meshId: MESH,
      endpoint: ENDPOINT,
      tenantId: TENANT,
      enrolmentRef,
      nodeId: nodeKey.nodeId
    },
    nodeKeyOptions: { configDir: iso.configDir, env: iso.env },
    connector: peer.createConnector(enrolmentRef),
    contract: effectiveContract,
    clock,
    random: () => 0.5,
    catalogue: projector,
    onAudit: (ev) => audits.push(ev)
  });
  return { clock, nodeKey, contract: effectiveContract, projector, peer, client, audits };
}

function makeBulkEntries(count, prefix = "r11") {
  const nativeSessions = [];
  const presences = [];
  for (let i = 0; i < count; i++) {
    const idx = String(i).padStart(4, "0");
    const nativeId = `${prefix}-${idx}`;
    nativeSessions.push(makeNativeSession(nativeId, { generation: `g-${idx}`, incarnation: `i-${idx}` }));
    presences.push(
      makePresence(`pres-${prefix}-${idx}`, {
        instance: `claude:${prefix}-${idx}:aaa000`,
        name: `Session ${prefix} ${idx}`,
        workspace: { id: `ws-${idx}`, host: "claude", label: `ws-${prefix}-${idx}` },
        launchContext: { cwd: `/private/${prefix}-${idx}`, command: "claude", nativePty: { session: nativeId } }
      })
    );
  }
  return { nativeSessions, presences };
}

test("R11 inc-5 gate 1: codec guard accepts 8192B catalogue record, rejects 8193B before schema, refuses legacy cat.snapshot", () => {
  const contract = createSimulatedTrunkContractProvider();
  const baseDelta = {
    v: 1,
    t: "cat.delta",
    ch: 1,
    s: 1,
    catSeq: 1,
    nodeId: "node-8192",
    upserts: [{ sid: "n-1", operable: false, name: "" }],
    removes: []
  };
  const emptyLen = Buffer.byteLength(canonicalTrunkJson(baseDelta), "utf8");
  const padExact = CATALOGUE_RECORD_MAX_BYTES - emptyLen;
  assert.ok(padExact > 0);
  const rec8192 = {
    ...baseDelta,
    upserts: [{ sid: "n-1", operable: false, name: "a".repeat(padExact) }]
  };
  assert.equal(Buffer.byteLength(canonicalTrunkJson(rec8192), "utf8"), CATALOGUE_RECORD_MAX_BYTES);
  const frame8192 = contract.encodeFrame(rec8192);
  const decoded8192 = contract.decodeFrame(frame8192);
  assert.equal(decoded8192.ok, true);
  assert.equal(decoded8192.encodedBodyBytes, CATALOGUE_RECORD_MAX_BYTES);

  // 8193 bytes with intentionally malformed schema must fail size guard BEFORE schema check
  const invalidSchemaBase = { v: 1, t: "cat.delta", bogus: "" };
  const bogusOverhead = Buffer.byteLength(canonicalTrunkJson(invalidSchemaBase), "utf8");
  const rec8193 = { v: 1, t: "cat.delta", bogus: "b".repeat(8193 - bogusOverhead) };
  const body8193 = Buffer.from(canonicalTrunkJson(rec8193), "utf8");
  assert.equal(body8193.byteLength, 8193);
  assert.throws(() => contract.encodeFrame(rec8193), /catalogue-record-too-large/);

  const rawFrame8193 = Buffer.allocUnsafe(4 + body8193.byteLength);
  rawFrame8193.writeUInt32BE(body8193.byteLength, 0);
  body8193.copy(rawFrame8193, 4);
  const decoded8193 = contract.decodeFrame(rawFrame8193);
  assert.equal(decoded8193.ok, false);
  assert.equal(decoded8193.code, "catalogue-record-too-large");

  // Legacy monolithic cat.snapshot must be refused on both encode and decode
  const legacySnap = { v: 1, t: "cat.snapshot", ch: 1, s: 1, at: 1, rows: [] };
  assert.throws(() => contract.encodeFrame(legacySnap), /legacy-monolithic-snapshot/);
  const legacyBody = Buffer.from(canonicalTrunkJson(legacySnap), "utf8");
  const legacyFrame = Buffer.allocUnsafe(4 + legacyBody.byteLength);
  legacyFrame.writeUInt32BE(legacyBody.byteLength, 0);
  legacyBody.copy(legacyFrame, 4);
  const decodedLegacy = contract.decodeFrame(legacyFrame);
  assert.equal(decodedLegacy.ok, false);
  assert.equal(decodedLegacy.code, "legacy-monolithic-snapshot");
});

test("R11 inc-5 gate 2: sizes 0, 1, 16, 17, 512, 513 yield 0, 1, 1, 2, 32, 32 parts + end; 513 audits 1; 512 max-shape <= 262144B", async () => {
  const iso = makeIsolation();
  try {
    const cases = [
      { n: 0, expectedParts: 0, totalRows: 0, truncatedRows: 0 },
      { n: 1, expectedParts: 1, totalRows: 1, truncatedRows: 0 },
      { n: 16, expectedParts: 1, totalRows: 16, truncatedRows: 0 },
      { n: 17, expectedParts: 2, totalRows: 17, truncatedRows: 0 },
      { n: 512, expectedParts: 32, totalRows: 512, truncatedRows: 0 },
      { n: 513, expectedParts: 32, totalRows: 512, truncatedRows: 1 }
    ];
    for (const c of cases) {
      const { nativeSessions, presences } = makeBulkEntries(c.n, `sz${c.n}`);
      const audits = [];
      const h = setupPaginatedHarness(iso, {
        enrolmentRef: `enr-sz-${c.n}`,
        readNativeInventory: async () => ({ complete: true, sessions: nativeSessions }),
        readPresences: () => presences,
        audits
      });
      assert.equal(h.client.start().ok, true);
      const conn = h.peer.allConnections()[0];
      h.peer.sendWatchStart(conn);
      await h.clock.flushMicrotasks();
      grantChannel1Credit(h.peer, conn, { seq: 128, bytes: 1024 * 1024 });

      const recs = conn.receivedCatalogue.map((f) => f.record);
      assert.equal(recs.length, c.expectedParts + 1, `size ${c.n} must emit ${c.expectedParts} parts + 1 end`);
      const parts = recs.slice(0, c.expectedParts);
      const end = recs[recs.length - 1];
      for (let i = 0; i < parts.length; i++) {
        assert.equal(parts[i].t, "cat.snapshot.part");
        assert.equal(parts[i].part, i);
        assert.equal(parts[i].catSeq, i + 1);
      }
      assert.equal(end.t, "cat.snapshot.end");
      assert.equal(end.partCount, c.expectedParts);
      assert.equal(end.totalRows, c.totalRows);
      assert.equal(end.truncatedRows, c.truncatedRows);
      assert.equal(end.catSeq, c.expectedParts + 1);

      const truncAudits = audits.filter((e) => e.kind === "catalogue-truncated");
      if (c.n === 513) {
        assert.equal(truncAudits.length, 1);
        assert.equal(truncAudits[0].truncatedRows, 1);
      } else {
        assert.equal(truncAudits.length, 0);
      }
      h.client.stop();
    }

    // 512 max-shape rows: measure exact encoded byte sum <= 262144
    const maxNative = [];
    const maxPres = [];
    for (let i = 0; i < 512; i++) {
      const idx = String(i).padStart(4, "0");
      const nativeId = `max-shape-session-${idx}-aaaaaaaaaaaa`;
      maxNative.push(makeNativeSession(nativeId, { generation: `g-${idx}`, incarnation: `i-${idx}` }));
      maxPres.push(
        makePresence(`pmax-${idx}`, {
          instance: `claude:maxinst-${idx}:deadbeefcafe`,
          host: "claude-maxhost-1",
          name: `N${idx}-` + "x".repeat(58),
          workspace: { id: `ws-${idx}`, host: "claude", label: `W${idx}-` + "y".repeat(58) },
          launchContext: { cwd: `/private/max-${idx}`, command: "claude", nativePty: { session: nativeId } }
        })
      );
    }
    const maxHarness = setupPaginatedHarness(iso, {
      enrolmentRef: "enr-max512",
      readNativeInventory: async () => ({ complete: true, sessions: maxNative }),
      readPresences: () => maxPres
    });
    assert.equal(maxHarness.client.start().ok, true);
    const maxConn = maxHarness.peer.allConnections()[0];
    maxHarness.peer.sendWatchStart(maxConn);
    await maxHarness.clock.flushMicrotasks();
    grantChannel1Credit(maxHarness.peer, maxConn, { seq: 128, bytes: 1024 * 1024 });
    assert.equal(maxConn.receivedCatalogue.length, 33);
    const totalMaxBytes = maxConn.receivedCatalogue.reduce((sum, f) => sum + f.encodedBytes, 0);
    assert.ok(totalMaxBytes > 200_000, `expected max-shape 512 snapshot > 200KB, got ${totalMaxBytes}`);
    assert.ok(totalMaxBytes <= CATALOGUE_SNAPSHOT_MAX_BYTES, `512 max-shape total ${totalMaxBytes} exceeded 262144`);
    maxHarness.client.stop();
  } finally {
    cleanup(iso);
  }
});

test("R11 inc-5 gate 3: logical limit 262145B or 33 parts emits err catalogue-too-large before any part; 262144B proceeds", async () => {
  const iso = makeIsolation();
  try {
    let overridePlan = null;
    const baseContract = createSimulatedTrunkContractProvider();
    assert.equal(typeof baseContract.planCatalogueSnapshot, "function", "contract must expose planCatalogueSnapshot");
    const wrappedContract = {
      ...baseContract,
      planCatalogueSnapshot(args) {
        if (overridePlan) return overridePlan(args);
        return baseContract.planCatalogueSnapshot(args);
      }
    };
    let bulk = makeBulkEntries(513, "lim");
    let sessions = bulk.nativeSessions;
    let presences = bulk.presences;
    const h = setupPaginatedHarness(iso, {
      enrolmentRef: "enr-logical-lim",
      readNativeInventory: async () => ({ complete: true, sessions }),
      readPresences: () => presences,
      contract: wrappedContract
    });

    assert.equal(h.client.start().ok, true);
    const conn = h.peer.allConnections()[0];
    h.peer.sendWatchStart(conn);
    await h.clock.flushMicrotasks();
    grantChannel1Credit(h.peer, conn, { seq: 128, bytes: 1024 * 1024 });
    assert.equal(conn.catalogueView?.rows.length, 512, "initial 512-row slice must be applied");
    assert.equal(conn.catalogueView?.truncatedRows, 1);

    const framesAfterInit = conn.receivedCatalogue.length;
    // Changing truncatedRows triggers replacement snapshot via planCatalogueSnapshot!
    // 1) Over 262144 bytes -> err before any part, slice retained
    overridePlan = () => ({ partCount: 1, totalEncodedBytes: 262_145 });
    bulk = makeBulkEntries(514, "lim");
    sessions = bulk.nativeSessions;
    presences = bulk.presences;
    await h.clock.advance(2_250);
    assert.equal(conn.receivedCatalogue.length, framesAfterInit, "no part may be sent when >262144B");
    assert.ok(
      conn.decodedClientRecords.some((r) => r.t === "err" && r.ch === 1 && r.code === "catalogue-too-large" && r.retryable === false),
      "expected err catalogue-too-large for 262145B"
    );
    assert.equal(conn.catalogueView?.rows.length, 512);

    // 2) 33 parts -> err before any part, slice retained
    const errsBefore33 = conn.decodedClientRecords.filter((r) => r.t === "err" && r.code === "catalogue-too-large").length;
    overridePlan = () => ({ partCount: 33, totalEncodedBytes: 1000 });
    bulk = makeBulkEntries(515, "lim");
    sessions = bulk.nativeSessions;
    presences = bulk.presences;
    await h.clock.advance(2_250);
    assert.equal(conn.receivedCatalogue.length, framesAfterInit, "no part may be sent when >32 parts");
    const errsAfter33 = conn.decodedClientRecords.filter((r) => r.t === "err" && r.code === "catalogue-too-large").length;
    assert.equal(errsAfter33, errsBefore33 + 1);
    assert.equal(conn.catalogueView?.rows.length, 512);

    // 3) Exactly 262144 bytes -> replacement snapshot proceeds!
    overridePlan = () => ({ partCount: 32, totalEncodedBytes: 262_144 });
    bulk = makeBulkEntries(516, "lim");
    sessions = bulk.nativeSessions;
    presences = bulk.presences;
    await h.clock.advance(2_250);
    grantChannel1Credit(h.peer, conn, { seq: 128, bytes: 2 * 1024 * 1024 });
    assert.ok(conn.receivedCatalogue.length > framesAfterInit, "262144B plan must proceed with snapshot parts");
    assert.equal(conn.catalogueView?.truncatedRows, 4);
    h.client.stop();
  } finally {
    cleanup(iso);
  }
});

test("R11 inc-5 gate 4: single-refusal guard sends 1 err across 3 extra credits, then admissible change sends snapshot", async () => {
  const iso = makeIsolation();
  try {
    const baseContract = createSimulatedTrunkContractProvider();
    assert.equal(typeof baseContract.planCatalogueSnapshot, "function");
    const wrappedContract = {
      ...baseContract,
      planCatalogueSnapshot(args) {
        if (args.rows.length === 2) return { partCount: 1, totalEncodedBytes: 262_145 };
        return baseContract.planCatalogueSnapshot(args);
      }
    };
    let { nativeSessions, presences } = makeBulkEntries(2, "ref");
    const h = setupPaginatedHarness(iso, {
      enrolmentRef: "enr-single-ref",
      readNativeInventory: async () => ({ complete: true, sessions: nativeSessions }),
      readPresences: () => presences,
      contract: wrappedContract
    });
    assert.equal(h.client.start().ok, true);
    const conn = h.peer.allConnections()[0];
    h.peer.sendWatchStart(conn);
    await h.clock.flushMicrotasks();
    h.peer.sendCredit(conn, 1, {
      receivedThroughSeq: 0,
      receivedThroughBytes: 0,
      sendLimitSeq: 2,
      sendLimitBytes: 32_768
    });
    await h.clock.flushMicrotasks();

    const countErrs = () => conn.decodedClientRecords.filter((r) => r.t === "err" && r.ch === 1 && r.code === "catalogue-too-large").length;
    assert.equal(countErrs(), 1);
    assert.equal(conn.receivedCatalogue.length, 0);

    // 3 more credits (valid within 8-record window) must NOT cause any additional err or loop
    for (let k = 0; k < 3; k++) {
      h.peer.sendCredit(conn, 1, {
        receivedThroughSeq: 0,
        receivedThroughBytes: 0,
        sendLimitSeq: 2 + (k + 1) * 2,
        sendLimitBytes: (k + 2) * 32_768
      });
      await h.clock.flushMicrotasks();
    }
    assert.equal(conn.closed, false, "peer connection must remain open after valid credits");
    assert.equal(countErrs(), 1, "extra credits on same refused projection must emit no more errors");

    // Different admissible projection sends snapshot (reset watch or trigger truncated change)
    const next = makeBulkEntries(513, "ref");
    nativeSessions = next.nativeSessions;
    presences = next.presences;
    await h.clock.advance(2_250);
    grantChannel1Credit(h.peer, conn, { seq: 128, bytes: 1024 * 1024 });
    assert.equal(countErrs(), 1);
    assert.ok(conn.receivedCatalogue.some((f) => f.record.t === "cat.snapshot.end"));
    assert.equal(conn.catalogueView?.rows.length, 512);
    h.client.stop();
  } finally {
    cleanup(iso);
  }
});

test("R11 inc-5 gate 5: audit after 250ms coalesce window suppresses 0->1->0 oscillation and emits once on settled change", async () => {
  const iso = makeIsolation();
  try {
    const base512 = makeBulkEntries(512, "osc");
    const extra513 = makeBulkEntries(513, "osc");
    let current = base512;
    const audits = [];
    const clock = new AsyncFakeClock(Date.parse("2026-11-21T10:00:30.000Z"));
    const nodeKey = generateNodeKey({ configDir: iso.configDir, env: iso.env });
    const contract = createSimulatedTrunkContractProvider();
    const projector = createCatalogueProjector({
      root: iso.root,
      configDir: iso.configDir,
      env: iso.env,
      clock,
      pollIntervalMs: 100,
      readNativeInventory: async () => ({ complete: true, sessions: current.nativeSessions }),
      readPresences: () => current.presences,
      onAudit: (ev) => audits.push(ev)
    });
    const peer = new FakeBinaryTrunkPeer({
      meshId: MESH,
      tenantId: TENANT,
      endpoint: ENDPOINT,
      clock,
      env: iso.env,
      contract
    });
    peer.registerEnrolment({
      nodeId: nodeKey.nodeId,
      enrolmentRef: "enr-osc",
      publicKeyPem: nodeKey.publicKeyPem,
      fingerprint: nodeKey.fingerprint
    });
    const client = new TrunkClient({
      root: iso.root,
      env: iso.env,
      enrolment: { meshId: MESH, endpoint: ENDPOINT, tenantId: TENANT, enrolmentRef: "enr-osc", nodeId: nodeKey.nodeId },
      nodeKeyOptions: { configDir: iso.configDir, env: iso.env },
      connector: peer.createConnector("enr-osc"),
      contract,
      clock,
      random: () => 0.5,
      catalogue: projector,
      onAudit: (ev) => audits.push(ev)
    });

    assert.equal(client.start().ok, true);
    const conn = peer.allConnections()[0];
    peer.sendWatchStart(conn);
    await clock.flushMicrotasks();
    grantChannel1Credit(peer, conn, { seq: 256, bytes: 2 * 1024 * 1024 });

    const initialFrames = conn.receivedCatalogue.length;
    assert.equal(audits.filter((e) => e.kind === "catalogue-truncated").length, 0);

    // Within 250ms coalesce window: poll 1 (+100ms) -> 513 (truncatedRows=1, arms 250ms window until +350ms),
    // poll 2 (+200ms) -> back to 512 (truncatedRows=0). At +350ms window expires: net change is 0 -> ZERO audits, ZERO replacement snapshot!
    current = extra513;
    await clock.advance(100);
    current = base512;
    await clock.advance(250);
    assert.equal(audits.filter((e) => e.kind === "catalogue-truncated").length, 0, "oscillation 0->1->0 must emit zero audits");
    assert.equal(conn.receivedCatalogue.length, initialFrames, "oscillation 0->1->0 must emit no replacement snapshot");

    // Settled change 0->1 past 250ms window (new session 0513 since 0512 exited into tombstone) -> emits 1 audit with truncatedRows === 1
    const settled513 = makeBulkEntries(514, "osc");
    current = {
      nativeSessions: settled513.nativeSessions.filter((s) => s.id !== "osc-0512"),
      presences: settled513.presences.filter((p) => p.sessionId !== "pres-osc-0512")
    };
    await clock.advance(500);
    const truncAudits = audits.filter((e) => e.kind === "catalogue-truncated");
    assert.equal(truncAudits.length, 1);
    assert.equal(truncAudits[0].truncatedRows, 1);
    assert.ok(conn.receivedCatalogue.length > initialFrames);
    client.stop();
  } finally {
    cleanup(iso);
  }
});

test("R11 inc-5 gate 6: 112 rows (8 records = 7 parts + end) exhausts 8-record credit; mutation queues until credit; next delta has catSeq=9", async () => {
  const iso = makeIsolation();
  try {
    const data = makeBulkEntries(112, "cred");
    const h = setupPaginatedHarness(iso, {
      enrolmentRef: "enr-cred112",
      readNativeInventory: async () => ({ complete: true, sessions: data.nativeSessions }),
      readPresences: () => data.presences
    });
    assert.equal(h.client.start().ok, true);
    const conn = h.peer.allConnections()[0];
    h.peer.sendWatchStart(conn);
    await h.clock.flushMicrotasks();

    // Grant exactly 8 records
    h.peer.sendCredit(conn, 1, {
      receivedThroughSeq: 0,
      receivedThroughBytes: 0,
      sendLimitSeq: 8,
      sendLimitBytes: 131_072
    });
    await h.clock.flushMicrotasks();

    assert.equal(conn.receivedCatalogue.length, 8);
    for (let i = 0; i < 7; i++) {
      assert.equal(conn.receivedCatalogue[i].record.t, "cat.snapshot.part");
      assert.equal(conn.receivedCatalogue[i].record.catSeq, i + 1);
    }
    assert.equal(conn.receivedCatalogue[7].record.t, "cat.snapshot.end");
    assert.equal(conn.receivedCatalogue[7].record.catSeq, 8);

    // Mutate one row -> ZERO records sent while credit === 0
    data.presences[0].name = "Updated name under zero credit";
    await h.clock.advance(2_250);
    assert.equal(conn.receivedCatalogue.length, 8, "zero credit must hold delta");

    // Advance credit -> delta goes out with catSeq = 9
    const ackBytes = conn.receivedCatalogue.reduce((sum, f) => sum + f.encodedBytes, 0);
    h.peer.sendCredit(conn, 1, {
      receivedThroughSeq: 8,
      receivedThroughBytes: ackBytes,
      sendLimitSeq: 16,
      sendLimitBytes: ackBytes + 131_072
    });
    await h.clock.flushMicrotasks();
    assert.equal(conn.receivedCatalogue.length, 9);
    assert.equal(conn.receivedCatalogue[8].record.t, "cat.delta");
    assert.equal(conn.receivedCatalogue[8].record.catSeq, 9);
    h.client.stop();
  } finally {
    cleanup(iso);
  }
});

test("R11 inc-5 gate 7: suspending 20-page snapshot after 8 records preserves previous slice until cat.snapshot.end", async () => {
  const iso = makeIsolation();
  try {
    const initial513 = makeBulkEntries(513, "swap");
    const smaller313 = makeBulkEntries(313, "swap"); // 313 rows = 19*16 + 9 = 20 parts, truncatedRows 1->0 triggers replacement snapshot
    let current = initial513;
    const h = setupPaginatedHarness(iso, {
      enrolmentRef: "enr-swap20",
      readNativeInventory: async () => ({ complete: true, sessions: current.nativeSessions }),
      readPresences: () => current.presences
    });
    assert.equal(h.client.start().ok, true);
    const conn = h.peer.allConnections()[0];
    h.peer.sendWatchStart(conn);
    await h.clock.flushMicrotasks();
    grantChannel1Credit(h.peer, conn, { seq: 128, bytes: 1024 * 1024 });

    assert.equal(conn.catalogueView?.rows.length, 512);
    assert.equal(conn.catalogueView?.truncatedRows, 1);

    // Replenish credit for ONLY 8 records (first 8 pages of upcoming 20-page snapshot)
    const sentBefore = conn.receivedCatalogue.length;
    const ackBytesBefore = conn.receivedCatalogue.reduce((s, f) => s + f.encodedBytes, 0);
    h.peer.sendCredit(conn, 1, {
      receivedThroughSeq: sentBefore,
      receivedThroughBytes: ackBytesBefore,
      sendLimitSeq: sentBefore + 8,
      sendLimitBytes: ackBytesBefore + 131_072
    });

    current = smaller313;
    await h.clock.advance(2_250);
    assert.equal(conn.receivedCatalogue.length, sentBefore + 8, "snapshot must suspend after 8 parts");
    // Peer slice MUST still be the previous 512-row slice!
    assert.equal(conn.catalogueView?.rows.length, 512, "visible slice must not change before cat.snapshot.end");
    assert.equal(conn.catalogueView?.truncatedRows, 1);

    // Grant remaining credit -> atomic swap at cat.snapshot.end!
    grantChannel1Credit(h.peer, conn, { seq: sentBefore + 32, bytes: ackBytesBefore + 1024 * 1024 });
    assert.equal(conn.catalogueView?.rows.length, 313, "visible slice must swap atomically at end");
    assert.equal(conn.catalogueView?.truncatedRows, 0);
    h.client.stop();
  } finally {
    cleanup(iso);
  }
});

test("R11 inc-5 gate 8: no cat.delta interleaved during multi-page snapshot; net delta follows cat.snapshot.end", async () => {
  const iso = makeIsolation();
  try {
    const data = makeBulkEntries(320, "noil"); // 20 parts + 1 end = 21 records
    const h = setupPaginatedHarness(iso, {
      enrolmentRef: "enr-noil",
      readNativeInventory: async () => ({ complete: true, sessions: data.nativeSessions }),
      readPresences: () => data.presences
    });
    assert.equal(h.client.start().ok, true);
    const conn = h.peer.allConnections()[0];
    h.peer.sendWatchStart(conn);
    await h.clock.flushMicrotasks();

    // Grant credit for 4 records (parts 0..3)
    h.peer.sendCredit(conn, 1, {
      receivedThroughSeq: 0,
      receivedThroughBytes: 0,
      sendLimitSeq: 4,
      sendLimitBytes: 131_072
    });
    await h.clock.flushMicrotasks();
    assert.equal(conn.receivedCatalogue.length, 4);

    // Mutate a row while snapshot is in flight
    data.presences[0].name = "Mutated during snapshot";
    await h.clock.advance(2_250);

    // Grant plenty of credit -> rest of snapshot MUST finish before cat.delta!
    grantChannel1Credit(h.peer, conn, { seq: 64, bytes: 1024 * 1024 });
    const types = conn.receivedCatalogue.map((f) => f.record.t);
    const endIdx = types.indexOf("cat.snapshot.end");
    assert.equal(endIdx, 20);
    for (let i = 0; i < 20; i++) {
      assert.equal(types[i], "cat.snapshot.part", `frame ${i} before end must be part, not delta`);
    }
    assert.equal(types[21], "cat.delta", "net delta must follow cat.snapshot.end");
    assert.equal(
      conn.catalogueView?.rows.find((r) => r.sid === nativeCatalogueSid("noil-0000"))?.name,
      "Mutated during snapshot"
    );
    h.client.stop();
  } finally {
    cleanup(iso);
  }
});

test("R11 inc-5 gate 9: disconnect mid-snapshot resets catSeq=1 on reconnect with fresh snapshot and discards partial staging", async () => {
  const iso = makeIsolation();
  try {
    const data = makeBulkEntries(40, "drop"); // 3 parts + 1 end
    const h = setupPaginatedHarness(iso, {
      enrolmentRef: "enr-drop",
      readNativeInventory: async () => ({ complete: true, sessions: data.nativeSessions }),
      readPresences: () => data.presences
    });
    assert.equal(h.client.start().ok, true);
    const conn1 = h.peer.allConnections()[0];
    h.peer.sendWatchStart(conn1);
    await h.clock.flushMicrotasks();
    h.peer.sendCredit(conn1, 1, {
      receivedThroughSeq: 0,
      receivedThroughBytes: 0,
      sendLimitSeq: 2,
      sendLimitBytes: 131_072
    });
    await h.clock.flushMicrotasks();
    assert.equal(conn1.receivedCatalogue.length, 2);
    assert.equal(conn1.catalogueView, null, "partial gen-1 snapshot must not apply");

    h.peer.dropConnection(conn1, "mid-snap-drop");
    await h.clock.advance(1_000);
    const conn2 = h.peer.allConnections()[1];
    assert.ok(conn2);
    h.peer.sendWatchStart(conn2);
    await h.clock.flushMicrotasks();
    grantChannel1Credit(h.peer, conn2, { seq: 32, bytes: 1024 * 1024 });

    assert.equal(conn2.receivedCatalogue[0].record.t, "cat.snapshot.part");
    assert.equal(conn2.receivedCatalogue[0].record.catSeq, 1, "new connection must reset catSeq to 1");
    assert.equal(conn2.receivedCatalogue[conn2.receivedCatalogue.length - 1].record.t, "cat.snapshot.end");
    assert.equal(conn2.catalogueView?.rows.length, 40);
    h.client.stop();
  } finally {
    cleanup(iso);
  }
});

test("R11 inc-5 gate 10: 513-row boundary insert-before, remove-at-frontier, add-beyond all replace via snapshot with zero leaked deltas", async () => {
  const iso = makeIsolation();
  try {
    const makeRowSpec = (tag) => ({
      native: makeNativeSession(tag),
      pres: makePresence(`p-${tag}`, {
        instance: `claude:b-${tag}:111`,
        launchContext: { cwd: `/private/${tag}`, command: "claude", nativePty: { session: tag } }
      })
    });
    // Use ids whose nativeCatalogueSid hashes or wait: sid is `n-<sha256>`, so we need exact sid ordering!
    // Construct 520 specs, sort them by nativeCatalogueSid so we know EXACT rank 0..519!
    const pool = [];
    for (let i = 0; i < 520; i++) {
      const tag = `front-${String(i).padStart(4, "0")}`;
      pool.push({ sid: nativeCatalogueSid(tag), tag, ...makeRowSpec(tag) });
    }
    pool.sort((a, b) => (a.sid < b.sid ? -1 : a.sid > b.sid ? 1 : 0));

    // Initial 513: indices 1..513 (keeping pool[0] reserved as smaller sid < pool[1], pool[514] reserved as > pool[513])
    let active = pool.slice(1, 514);
    const h = setupPaginatedHarness(iso, {
      enrolmentRef: "enr-frontier",
      readNativeInventory: async () => ({ complete: true, sessions: active.map((x) => x.native) }),
      readPresences: () => active.map((x) => x.pres)
    });
    assert.equal(h.client.start().ok, true);
    const conn = h.peer.allConnections()[0];
    h.peer.sendWatchStart(conn);
    await h.clock.flushMicrotasks();
    grantChannel1Credit(h.peer, conn, { seq: 512, bytes: 4 * 1024 * 1024 });
    assert.equal(conn.catalogueView?.rows.length, 512);
    assert.equal(conn.catalogueView?.truncatedRows, 1);

    // 1) Insert pool[0] before frontier -> active=514 (pool[0]..pool[513]), pool[512] pushed past boundary
    let cursorFrame = conn.receivedCatalogue.length;
    active = [pool[0], ...active];
    await h.clock.advance(2_250);
    grantChannel1Credit(h.peer, conn, { seq: 512, bytes: 4 * 1024 * 1024 });
    let sliceFrames = conn.receivedCatalogue.slice(cursorFrame);
    assert.ok(sliceFrames.some((f) => f.record.t === "cat.snapshot.end"), "insert before frontier must replace via snapshot");
    assert.equal(sliceFrames.some((f) => f.record.t === "cat.delta"), false, "no delta may emit on frontier insert");
    assert.equal(conn.catalogueView?.truncatedRows, 2);

    // 2) Remove pool[511] (last visible row inside 512 slice) -> pulls pool[512] into visible slice
    cursorFrame = conn.receivedCatalogue.length;
    active = active.filter((x) => x.sid !== pool[511].sid);
    await h.clock.advance(2_250);
    grantChannel1Credit(h.peer, conn, { seq: 512, bytes: 4 * 1024 * 1024 });
    sliceFrames = conn.receivedCatalogue.slice(cursorFrame);
    assert.ok(sliceFrames.some((f) => f.record.t === "cat.snapshot.end"), "remove at frontier must replace via snapshot");
    assert.equal(sliceFrames.some((f) => f.record.t === "cat.delta"), false, "previously omitted row must never travel in delta");
    assert.equal(conn.catalogueView?.truncatedRows, 1);

    // 3) Add pool[514] beyond slice -> truncatedRows becomes 2, visible slice unchanged, still replacement snapshot
    cursorFrame = conn.receivedCatalogue.length;
    active = [...active, pool[514]];
    await h.clock.advance(2_250);
    grantChannel1Credit(h.peer, conn, { seq: 512, bytes: 4 * 1024 * 1024 });
    sliceFrames = conn.receivedCatalogue.slice(cursorFrame);
    assert.ok(sliceFrames.some((f) => f.record.t === "cat.snapshot.end"), "add beyond slice must replace via snapshot");
    assert.equal(sliceFrames.some((f) => f.record.t === "cat.delta"), false);
    assert.equal(conn.catalogueView?.truncatedRows, 2);
    h.client.stop();
  } finally {
    cleanup(iso);
  }
});

test("R11 inc-5 gate 11: 17 steady-state changes split into two cat.delta records of 16 and 1 entries with consecutive catSeq", async () => {
  const iso = makeIsolation();
  try {
    let { nativeSessions, presences } = makeBulkEntries(20, "d17");
    const h = setupPaginatedHarness(iso, {
      enrolmentRef: "enr-d17",
      readNativeInventory: async () => ({ complete: true, sessions: nativeSessions }),
      readPresences: () => presences
    });
    assert.equal(h.client.start().ok, true);
    const conn = h.peer.allConnections()[0];
    h.peer.sendWatchStart(conn);
    await h.clock.flushMicrotasks();
    grantChannel1Credit(h.peer, conn, { seq: 64, bytes: 1024 * 1024 });
    const baseCount = conn.receivedCatalogue.length; // 2 parts + 1 end = 3

    // Add 17 more rows (20 -> 37)
    const expanded = makeBulkEntries(37, "d17");
    nativeSessions = expanded.nativeSessions;
    presences = expanded.presences;
    await h.clock.advance(2_250);
    grantChannel1Credit(h.peer, conn, { seq: 64, bytes: 1024 * 1024 });

    const deltaFrames = conn.receivedCatalogue.slice(baseCount);
    assert.equal(deltaFrames.length, 2, "17 entries must split into 16 + 1 cat.delta");
    assert.equal(deltaFrames[0].record.t, "cat.delta");
    assert.equal(deltaFrames[0].record.upserts.length, CATALOGUE_DELTA_MAX_ENTRIES);
    assert.equal(deltaFrames[1].record.t, "cat.delta");
    assert.equal(deltaFrames[1].record.upserts.length, 1);
    assert.equal(deltaFrames[1].record.catSeq, deltaFrames[0].record.catSeq + 1);
    assert.equal(conn.catalogueView?.rows.length, 37);
    h.client.stop();
  } finally {
    cleanup(iso);
  }
});

test("R11 inc-5 gate 12: instance.revoked emits complete wire-row cat.delta upserts within <= 1s peer clock", async () => {
  const iso = makeIsolation();
  try {
    const instA = "claude:rev-inst-A:111";
    const instB = "claude:rev-inst-B:222";
    const nativeSessions = [makeNativeSession("rev-nat-a"), makeNativeSession("rev-nat-b")];
    const presences = [
      makePresence("p-rev-a", {
        instance: instA,
        name: "Revoked Row A",
        launchContext: { cwd: "/private/ra", command: "claude", nativePty: { session: "rev-nat-a" } }
      }),
      makePresence("p-rev-b", {
        instance: instB,
        name: "Live Row B",
        launchContext: { cwd: "/private/rb", command: "claude", nativePty: { session: "rev-nat-b" } }
      })
    ];
    const h = setupPaginatedHarness(iso, {
      enrolmentRef: "enr-rev-upsert",
      readNativeInventory: async () => ({ complete: true, sessions: nativeSessions }),
      readPresences: () => presences
    });
    assert.equal(h.client.start().ok, true);
    const conn = h.peer.allConnections()[0];
    h.peer.sendWatchStart(conn);
    await h.clock.flushMicrotasks();
    grantChannel1Credit(h.peer, conn, { seq: 32, bytes: 256 * 1024 });

    const wireA = wireInstanceId(instA);
    const sidA = nativeCatalogueSid("rev-nat-a");
    const beforePush = conn.receivedCatalogue.length;
    const t0 = h.clock.now();
    h.peer.sendInstanceRevoked(conn, wireA, "user");
    await h.clock.advance(250);
    assert.ok(h.clock.now() - t0 <= 1000);

    const pushFrames = conn.receivedCatalogue.slice(beforePush);
    assert.equal(pushFrames.length, 1);
    const delta = pushFrames[0].record;
    assert.equal(delta.t, "cat.delta");
    assert.deepEqual(delta.removes, []);
    assert.equal(delta.upserts.length, 1);
    const fullRow = delta.upserts[0];
    assert.equal(fullRow.sid, sidA);
    assert.equal(fullRow.instanceId, wireA);
    assert.equal(fullRow.instanceStatus, "revoked");
    assert.equal(fullRow.name, "Revoked Row A");
    assert.equal(fullRow.cliHost, "claude");
    assert.equal(fullRow.terminalHost, "native");
    assert.equal(fullRow.operable, true);
    h.client.stop();
  } finally {
    cleanup(iso);
  }
});

test("R11 inc-5 gate 13: stager and peer reject out-of-order, repeated/skipped catSeq, bad nodeId, wrong partCount and retain prior slice", () => {
  const Stager = peerHelpers.CatalogueSliceStager;
  assert.equal(typeof Stager, "function", "CatalogueSliceStager must be exported by remote-trunk-peer");
  const nodeId = "node-stager-1";
  const seedRows = [{ sid: "s-0", operable: true }];

  function makeCommittedStager() {
    const stager = new Stager({ expectedNodeId: nodeId });
    assert.equal(stager.ingest({
      t: "cat.snapshot.part", ch: 1, s: 1, catSeq: 1, nodeId, snapId: "snap-init", part: 0, rows: seedRows
    }, 128).ok, true);
    assert.equal(stager.ingest({
      t: "cat.snapshot.end", ch: 1, s: 2, catSeq: 2, nodeId, snapId: "snap-init", partCount: 1, totalRows: 1, truncatedRows: 0
    }, 96).ok, true);
    assert.deepEqual(stager.getSlice()?.rows, seedRows);
    return stager;
  }

  // 1) Repeated catSeq
  const s1 = makeCommittedStager();
  const r1 = s1.ingest({ t: "cat.delta", ch: 1, s: 3, catSeq: 2, nodeId, upserts: [{ sid: "s-1", operable: true }], removes: [] }, 64);
  assert.equal(r1.ok, false);
  assert.deepEqual(s1.getSlice()?.rows, seedRows);

  // 2) Skipped catSeq
  const s2 = makeCommittedStager();
  const r2 = s2.ingest({ t: "cat.delta", ch: 1, s: 3, catSeq: 4, nodeId, upserts: [{ sid: "s-1", operable: true }], removes: [] }, 64);
  assert.equal(r2.ok, false);
  assert.deepEqual(s2.getSlice()?.rows, seedRows);

  // 3) Out-of-order part index (part 1 before part 0)
  const s3 = makeCommittedStager();
  const r3 = s3.ingest({ t: "cat.snapshot.part", ch: 1, s: 3, catSeq: 3, nodeId, snapId: "snap-2", part: 1, rows: [{ sid: "s-1", operable: true }] }, 64);
  assert.equal(r3.ok, false);
  assert.deepEqual(s3.getSlice()?.rows, seedRows);

  // 4) Foreign nodeId
  const s4 = makeCommittedStager();
  const r4 = s4.ingest({ t: "cat.snapshot.part", ch: 1, s: 3, catSeq: 3, nodeId: "foreign-node", snapId: "snap-2", part: 0, rows: [{ sid: "s-1", operable: true }] }, 64);
  assert.equal(r4.ok, false);
  assert.deepEqual(s4.getSlice()?.rows, seedRows);

  // 5) End with wrong partCount discards staged parts and keeps previous slice
  const s5 = makeCommittedStager();
  assert.equal(s5.ingest({
    t: "cat.snapshot.part", ch: 1, s: 3, catSeq: 3, nodeId, snapId: "snap-2", part: 0, rows: [{ sid: "s-1", operable: true }]
  }, 64).ok, true);
  const r5 = s5.ingest({
    t: "cat.snapshot.end", ch: 1, s: 4, catSeq: 4, nodeId, snapId: "snap-2", partCount: 2, totalRows: 1, truncatedRows: 0
  }, 64);
  assert.equal(r5.ok, false);
  assert.deepEqual(s5.getSlice()?.rows, seedRows);
});

// ============================================================================
// 3. 512-row (> 32 KiB) catalogue: 8192 B vs 4096 B framing, truncatedRows,
//    and mid-series disconnect recovery restarting from a fresh snapshot
// ============================================================================

test("LH-07 + LH-06 integration: 512-row (>32 KiB) catalogue splits cleanly at 8192 B and 4096 B with exact truncatedRows, and restarts from snapshot on mid-series disconnect", async () => {
  const iso = makeIsolation();
  try {
    const startMs = Date.parse("2026-11-21T10:00:30.000Z");
    const nodeKey = generateNodeKey({ configDir: iso.configDir, env: iso.env });

    // Build 515 native sessions + matching presences -> projector bounds to 512 rows, truncatedRows === 3
    const TOTAL_SESSIONS = 515;
    const EXPECTED_TRUNCATED = TOTAL_SESSIONS - 512;
    const nativeSessions = [];
    const presences = [];
    for (let i = 0; i < TOTAL_SESSIONS; i++) {
      const idx = String(i).padStart(4, "0");
      const nativeId = `bulk-session-${idx}`;
      nativeSessions.push(makeNativeSession(nativeId, { generation: `g-${idx}`, incarnation: `i-${idx}` }));
      presences.push(
        makePresence(`pres-${idx}`, {
          instance: `claude:bulk-${idx}:fff000`,
          name: `Workspace build session ${idx}`,
          workspace: { id: `ws-${idx}`, host: "claude", label: `project-alpha-${idx}` },
          launchContext: { cwd: `/private/bulk-${idx}`, command: "claude", nativePty: { session: nativeId } }
        })
      );
    }
    const inventory = { complete: true, sessions: nativeSessions };

    async function runWithProviderLimit(maxCatalogueRecordBytes, customInventory = inventory, customPresences = presences) {
      const clock = new AsyncFakeClock(startMs);
      const audits = [];
      const projector = createCatalogueProjector({
        root: iso.root,
        configDir: iso.configDir,
        env: iso.env,
        clock,
        readNativeInventory: async () => customInventory,
        readPresences: () => customPresences,
        onAudit: (ev) => audits.push(ev)
      });
      const contract = createSimulatedTrunkContractProvider({ maxCatalogueRecordBytes });
      const peer = new FakeBinaryTrunkPeer({
        meshId: MESH,
        tenantId: TENANT,
        endpoint: ENDPOINT,
        clock,
        env: iso.env,
        contract
      });
      peer.registerEnrolment({
        nodeId: nodeKey.nodeId,
        enrolmentRef: `enr-bulk-${maxCatalogueRecordBytes}`,
        publicKeyPem: nodeKey.publicKeyPem,
        fingerprint: nodeKey.fingerprint
      });
      const client = new TrunkClient({
        root: iso.root,
        env: iso.env,
        enrolment: {
          meshId: MESH,
          endpoint: ENDPOINT,
          tenantId: TENANT,
          enrolmentRef: `enr-bulk-${maxCatalogueRecordBytes}`,
          nodeId: nodeKey.nodeId
        },
        nodeKeyOptions: { configDir: iso.configDir, env: iso.env },
        connector: peer.createConnector(`bulk-${maxCatalogueRecordBytes}`),
        contract,
        clock,
        random: () => 0.5,
        catalogue: projector
      });

      assert.equal(client.start().ok, true);
      const conn = peer.allConnections()[0];
      peer.sendWatchStart(conn);
      await clock.flushMicrotasks();
      grantChannel1Credit(peer, conn, { seq: 128, bytes: 1024 * 1024 });

      const frames = conn.receivedCatalogue;
      const totalBodyBytes = frames.reduce((sum, f) => sum + f.encodedBytes, 0);
      for (const f of frames) {
        assert.ok(
          f.encodedBytes <= maxCatalogueRecordBytes,
          `frame size ${f.encodedBytes} exceeded maxCatalogueRecordBytes=${maxCatalogueRecordBytes}`
        );
      }
      const parts = frames.slice(0, -1);
      const end = frames[frames.length - 1].record;
      for (let i = 0; i < parts.length; i++) {
        assert.equal(parts[i].record.t, "cat.snapshot.part");
        assert.equal(parts[i].record.part, i);
      }
      assert.equal(end.t, "cat.snapshot.end");

      const reconstructed = reconstructCatalogueFromFrames(frames);
      const logical = projector.getProjection();
      assert.ok(logical, "projector must retain logical projection");
      const expectedTotal = Math.min(customInventory.sessions.length, 512);
      const expectedTruncated = customInventory.sessions.length - expectedTotal;
      assert.equal(reconstructed.rows.length, expectedTotal);
      assert.equal(reconstructed.truncatedRows, expectedTruncated);
      assert.deepEqual(reconstructed.rows, logical.rows.map((r) => provisionalWireRow(r)));
      if (expectedTruncated > 0) {
        assert.ok(
          audits.some((e) => e.kind === "catalogue-truncated" && e.truncatedRows === expectedTruncated),
          "projector must audit truncatedRows count"
        );
      }

      return {
        client,
        peer,
        clock,
        projector,
        frames,
        totalBodyBytes,
        reconstructed,
        logical,
        frameCounts: parts.map((f) => f.record.rows.length)
      };
    }

    // Part A: 8 192 B provider with full 515 -> 512 rows, 32 parts + end
    const run8k = await runWithProviderLimit(8192);
    assert.ok(run8k.totalBodyBytes > 32 * 1024, `expected > 32 KiB total catalogue bytes, got ${run8k.totalBodyBytes}`);
    assert.equal(run8k.frames.length, 33);
    run8k.client.stop();

    // Part B: 8 192 B vs 4 096 B provider on 256 rows (stays <= 32 parts at 4096 B) -> different frame boundaries, identical rows
    const inv256 = { complete: true, sessions: nativeSessions.slice(0, 256) };
    const pres256 = presences.slice(0, 256);
    const run256_8k = await runWithProviderLimit(8192, inv256, pres256);
    run256_8k.client.stop();
    const run4k = await runWithProviderLimit(4096, inv256, pres256);
    assert.ok(
      run4k.frames.length > run256_8k.frames.length,
      `4096 B provider (${run4k.frames.length} frames) must split into more frames than 8192 B (${run256_8k.frames.length} frames)`
    );
    assert.notDeepEqual(run4k.frameCounts, run256_8k.frameCounts, "frame boundaries must differ between 8192 B and 4096 B");
    assert.deepEqual(run4k.reconstructed.rows, run256_8k.reconstructed.rows, "reconstituted rows must match identically");
    run4k.client.stop();

    // Part C: Mid-series disconnect between prefix snapshot and final delta adds
    const clockC = new AsyncFakeClock(startMs);
    const projectorC = createCatalogueProjector({
      root: iso.root,
      configDir: iso.configDir,
      env: iso.env,
      clock: clockC,
      readNativeInventory: async () => inventory,
      readPresences: () => presences
    });
    const contractC = createSimulatedTrunkContractProvider({ maxCatalogueRecordBytes: 8192 });
    const peerC = new FakeBinaryTrunkPeer({
      meshId: MESH,
      tenantId: TENANT,
      endpoint: ENDPOINT,
      clock: clockC,
      env: iso.env,
      contract: contractC
    });
    peerC.registerEnrolment({
      nodeId: nodeKey.nodeId,
      enrolmentRef: "enr-bulk-disconnect",
      publicKeyPem: nodeKey.publicKeyPem,
      fingerprint: nodeKey.fingerprint
    });
    const clientC = new TrunkClient({
      root: iso.root,
      env: iso.env,
      enrolment: {
        meshId: MESH,
        endpoint: ENDPOINT,
        tenantId: TENANT,
        enrolmentRef: "enr-bulk-disconnect",
        nodeId: nodeKey.nodeId
      },
      nodeKeyOptions: { configDir: iso.configDir, env: iso.env },
      connector: peerC.createConnector("bulk-disconnect"),
      contract: contractC,
      clock: clockC,
      random: () => 0.5,
      catalogue: projectorC
    });

    assert.equal(clientC.start().ok, true);
    const conn1 = peerC.allConnections()[0];
    assert.equal(clientC.getLinkGeneration(), 1);
    peerC.sendWatchStart(conn1);
    await clockC.flushMicrotasks();

    // Grant credit for ONLY 2 frames (prefix cat.snapshot + 1 cat.delta) so series pauses mid-flight
    peerC.sendCredit(conn1, 1, {
      receivedThroughSeq: 0,
      receivedThroughBytes: 0,
      sendLimitSeq: 2,
      sendLimitBytes: 16384
    });
    assert.equal(conn1.receivedCatalogue.length, 2, "gen-1 must pause after 2 frames");
    assert.equal(conn1.catalogueView, null, "gen-1 must not commit incomplete slice before end");
    assert.equal(conn1.catalogueStager.hasPendingStage(), true);

    // Simulate network drop mid-series, then advance backoff to gen-2
    peerC.dropConnection(conn1, "mid-series-drop");
    await clockC.advance(1000);
    assert.equal(clientC.getState(), "ready");
    assert.equal(clientC.getLinkGeneration(), 2);

    const conn2 = peerC.allConnections()[1];
    assert.ok(conn2, "second generation connection must exist");
    peerC.sendWatchStart(conn2);
    await clockC.flushMicrotasks();
    grantChannel1Credit(peerC, conn2, { seq: 128, bytes: 1024 * 1024 });

    // Gen-2 MUST restart from catSeq=1 with a fresh paginated snapshot, abandoning all gen-1 staging
    assert.ok(conn2.receivedCatalogue.length >= 2);
    assert.equal(conn2.receivedCatalogue[0].record.t, "cat.snapshot.part", "gen-2 must restart with cat.snapshot.part");
    assert.equal(conn2.receivedCatalogue[0].record.catSeq, 1);
    const endRec = conn2.receivedCatalogue[conn2.receivedCatalogue.length - 1].record;
    assert.equal(endRec.t, "cat.snapshot.end");
    assert.equal(endRec.truncatedRows, EXPECTED_TRUNCATED);
    const gen2Reconstructed = reconstructCatalogueFromFrames(conn2.receivedCatalogue);
    assert.equal(gen2Reconstructed.rows.length, 512);
    assert.equal(gen2Reconstructed.truncatedRows, EXPECTED_TRUNCATED);
    assert.deepEqual(gen2Reconstructed.rows, run8k.reconstructed.rows);

    clientC.stop();
  } finally {
    cleanup(iso);
  }
});
