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
  applyCatalogueDelta,
  createCatalogueProjector,
  generateNodeKey,
  nativeCatalogueSid,
  setSessionExcluded,
  TrunkClient,
  wireInstanceId
} from "../dist/runtime/remote-agent/index.js";
import {
  FakeBinaryTrunkPeer,
  createSimulatedTrunkContractProvider
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
  const first = receivedCatalogue[0].record;
  assert.equal(first.t, "cat.snapshot", "channel-1 series must start with cat.snapshot");
  let state = {
    rows: new Map(first.rows.map((r) => [r.sessionId, r])),
    truncatedRows: first.truncatedRows ?? 0
  };
  for (let i = 1; i < receivedCatalogue.length; i++) {
    const rec = receivedCatalogue[i].record;
    if (rec.t === "cat.snapshot") {
      state = {
        rows: new Map(rec.rows.map((r) => [r.sessionId, r])),
        truncatedRows: rec.truncatedRows ?? 0
      };
    } else if (rec.t === "cat.delta") {
      const nextRows = applyCatalogueDelta([...state.rows.values()], rec);
      state = {
        rows: new Map(nextRows.map((r) => [r.sessionId, r])),
        truncatedRows: state.truncatedRows
      };
    }
  }
  const sortedRows = [...state.rows.values()].sort((a, b) =>
    a.sessionId < b.sessionId ? -1 : a.sessionId > b.sessionId ? 1 : 0
  );
  return { rows: sortedRows, truncatedRows: state.truncatedRows };
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

    assert.ok(conn.receivedCatalogue.length >= 1, "peer must decode first cat.snapshot on channel 1");
    const firstRecord = conn.receivedCatalogue[0].record;
    assert.equal(firstRecord.t, "cat.snapshot");
    assert.equal(firstRecord.ch, 1);

    const wireA = wireInstanceId(instA);
    const wireB = wireInstanceId(instB);
    // No intermediate image may ever show A as live
    for (const frame of conn.receivedCatalogue) {
      const rows = frame.record.t === "cat.snapshot" ? frame.record.rows : frame.record.adds ?? [];
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
    const rowA = rows.find((r) => r.sessionId === sidA);
    const rowB = rows.find((r) => r.sessionId === sidB);
    const rowExcl = rows.find((r) => r.sessionId === sidExcl);

    assert.ok(rowA, "row A must be present");
    assert.equal(rowA.instanceId, wireA);
    assert.equal(rowA.instanceStatus, "revoked");
    assert.equal(rowA.workspaceLabel, "ws-alpha");

    assert.ok(rowB, "row B must be present");
    assert.equal(rowB.instanceId, wireB);
    assert.equal(rowB.instanceStatus, "live");
    assert.equal(rowB.operable, true);

    assert.ok(rowExcl, "excluded row must remain visible as not-shared");
    assert.equal(rowExcl.excluded, true);
    assert.equal(rowExcl.operable, false);
    assert.equal(rowExcl.operabilityReason, "not-shared");

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
    assert.equal(snap0.rows.find((r) => r.sessionId === sidA)?.instanceStatus, "live");
    assert.equal(snap0.rows.find((r) => r.sessionId === sidB)?.instanceStatus, "live");

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
    peer.sendInstanceRevoked(conn, wireA, "owner-ui");

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
    assert.equal(postPushFrames.length, 1, "expected exactly one status-only cat.delta");
    const deltaRec = postPushFrames[0].record;
    assert.equal(deltaRec.t, "cat.delta");
    assert.deepEqual(deltaRec.adds, []);
    assert.deepEqual(deltaRec.removes, []);
    assert.deepEqual(deltaRec.updates, [
      { sessionId: sidA, instanceId: wireA, instanceStatus: "revoked" }
    ]);

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
      revokedInstances: [] // explicitly empty in ready
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
    assert.deepEqual(ready2.revokedInstances, []);

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
      restartedSnap.rows.find((r) => r.sessionId === sidA)?.instanceStatus,
      "revoked",
      "persisted revocation of A must appear on first snapshot even when ready.revokedInstances is empty"
    );
    assert.equal(restartedSnap.rows.find((r) => r.sessionId === sidB)?.instanceStatus, "live");

    client2.stop();
  } finally {
    cleanup(iso);
  }
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

    async function runWithProviderLimit(maxCatalogueRecordBytes) {
      const clock = new AsyncFakeClock(startMs);
      const audits = [];
      const projector = createCatalogueProjector({
        root: iso.root,
        configDir: iso.configDir,
        env: iso.env,
        clock,
        readNativeInventory: async () => inventory,
        readPresences: () => presences,
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
      assert.ok(totalBodyBytes > 32 * 1024, `expected > 32 KiB total catalogue bytes, got ${totalBodyBytes}`);
      for (const f of frames) {
        assert.ok(
          f.encodedBytes <= maxCatalogueRecordBytes,
          `frame size ${f.encodedBytes} exceeded maxCatalogueRecordBytes=${maxCatalogueRecordBytes}`
        );
      }
      assert.equal(frames[0].record.t, "cat.snapshot");
      assert.equal(frames[0].record.truncatedRows, EXPECTED_TRUNCATED);
      for (let i = 1; i < frames.length; i++) {
        assert.equal(frames[i].record.t, "cat.delta");
        assert.ok(frames[i].record.adds.length > 0);
      }

      const reconstructed = reconstructCatalogueFromFrames(frames);
      const logical = projector.getSnapshot();
      assert.ok(logical, "projector must retain logical snapshot");
      assert.equal(reconstructed.rows.length, 512);
      assert.equal(reconstructed.truncatedRows, EXPECTED_TRUNCATED);
      assert.deepEqual(reconstructed.rows, logical.rows);
      assert.ok(
        audits.some((e) => e.kind === "catalogue-truncated" && e.truncatedRows === EXPECTED_TRUNCATED),
        "projector must audit truncatedRows count"
      );

      return {
        client,
        peer,
        clock,
        projector,
        frames,
        totalBodyBytes,
        reconstructed,
        logical,
        frameCounts: frames.map((f) => (f.record.t === "cat.snapshot" ? f.record.rows.length : f.record.adds.length))
      };
    }

    // Part A: 8 192 B provider
    const run8k = await runWithProviderLimit(8192);
    run8k.client.stop();

    // Part B: 4 096 B provider -> different frame boundaries, exact same 512 rows & truncatedRows
    const run4k = await runWithProviderLimit(4096);
    assert.ok(
      run4k.frames.length > run8k.frames.length,
      `4096 B provider (${run4k.frames.length} frames) must split into more frames than 8192 B (${run8k.frames.length} frames)`
    );
    assert.notDeepEqual(run4k.frameCounts, run8k.frameCounts, "frame boundaries must differ between 8192 B and 4096 B");
    assert.deepEqual(run4k.reconstructed.rows, run8k.reconstructed.rows, "reconstituted rows must match identically");
    assert.equal(run4k.reconstructed.truncatedRows, run8k.reconstructed.truncatedRows);
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
    const partial1 = reconstructCatalogueFromFrames(conn1.receivedCatalogue);
    assert.ok(partial1.rows.length < 512, "gen-1 must be incomplete before disconnect");

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

    // Gen-2 MUST restart from a fresh cat.snapshot, abandoning all gen-1 pending adds
    assert.ok(conn2.receivedCatalogue.length >= 2);
    assert.equal(conn2.receivedCatalogue[0].record.t, "cat.snapshot", "gen-2 must restart with cat.snapshot");
    assert.equal(conn2.receivedCatalogue[0].record.truncatedRows, EXPECTED_TRUNCATED);
    const gen2Reconstructed = reconstructCatalogueFromFrames(conn2.receivedCatalogue);
    assert.equal(gen2Reconstructed.rows.length, 512);
    assert.equal(gen2Reconstructed.truncatedRows, EXPECTED_TRUNCATED);
    assert.deepEqual(gen2Reconstructed.rows, run8k.reconstructed.rows);

    clientC.stop();
  } finally {
    cleanup(iso);
  }
});
