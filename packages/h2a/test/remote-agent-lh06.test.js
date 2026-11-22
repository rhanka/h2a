import assert from "node:assert/strict";
import test from "node:test";
import { createHash, generateKeyPairSync } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  runCli,
  createMcpServer,
  createLocalStore
} from "../dist/index.js";

import {
  isRemoteControlEnabled,
  runRemoteControlVerb,
  signTrunkAuthPayload,
  projectCatalogueRow,
  buildCatalogueSnapshot,
  serializeCatalogueSnapshot,
  parseCatalogueSnapshot,
  serializeCatalogueDelta,
  parseCatalogueDelta,
  applyCatalogueDelta,
  containsForbiddenLocalField,
  isInternalCompanionNativeId,
  nativeCatalogueSid,
  presenceCatalogueSid,
  readExclusions,
  setSessionExcluded,
  clearSessionExcluded,
  resolveExclusionsFilePath,
  resolveCatalogueIdsFilePath,
  createCatalogueProjector
} from "../dist/runtime/remote-agent/index.js";

import {
  FakeTrunkEndpoint,
  FakeEnrolmentVerifier,
  WET2_TEXT_HASH,
  FIXTURE_CONTRACT_METADATA,
  assertFixtureContractVersion,
  createFakeCatalogueTrunkProvider
} from "./helpers/remote-trunk-fakes.js";

import {
  listNativeInventoryForRemote,
  NativeTerminalHost
} from "../../h2a-runtime/dist/index.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const H2A_BIN = join(REPO_ROOT, "packages", "h2a", "dist", "bin.js");

function sha256Hex(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function makeFixtureEnv() {
  assert.ok(process.env.TMPDIR && resolve(process.env.TMPDIR) !== "/tmp", "Supply a disposable TMPDIR");
  const base = mkdtempSync(join(process.env.TMPDIR, "lh06-"));
  const root = join(base, "store");
  const rootB = join(base, "store-b");
  const configHome = join(base, "config");
  const explicitConfigDir = join(base, "explicit-config");
  const runtimeDir = join(base, "run");
  const stateDir = join(base, "state");
  const home = join(base, "home");
  for (const dir of [root, rootB, configHome, explicitConfigDir, runtimeDir, stateDir, home]) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  const env = {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    HOME: home,
    TMPDIR: process.env.TMPDIR,
    TMP: process.env.TMPDIR,
    TEMP: process.env.TMPDIR,
    XDG_CONFIG_HOME: configHome,
    XDG_STATE_HOME: stateDir,
    XDG_RUNTIME_DIR: runtimeDir,
    H2A_ROOT: root,
    H2A_REMOTE_CONTROL: "1",
    H2A_TEST_FAKES: "1"
  };
  return { base, root, rootB, configHome, explicitConfigDir, runtimeDir, home, env };
}

function cleanupFixture(fx) {
  rmSync(fx.base, { recursive: true, force: true });
}

function withProcessEnv(overrides, fn) {
  const saved = new Map();
  for (const [k, v] of Object.entries(overrides)) {
    saved.set(k, process.env[k]);
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return fn();
  } finally {
    for (const [k, v] of saved.entries()) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
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

class FakeClock {
  #now;
  #nextId = 1;
  #timers = new Map();

  constructor(startMs) {
    this.#now = startMs;
  }

  now() {
    return this.#now;
  }

  setTimeout(fn, ms) {
    const id = this.#nextId++;
    const due = this.#now + Math.max(0, ms);
    const handle = { id, unref() {} };
    this.#timers.set(id, { id, due, fn });
    return handle;
  }

  clearTimeout(handle) {
    if (handle && typeof handle.id === "number") {
      this.#timers.delete(handle.id);
    }
  }

  pendingCount() {
    return this.#timers.size;
  }

  async flushMicrotasks(rounds = 6) {
    for (let i = 0; i < rounds; i++) {
      await Promise.resolve();
    }
  }

  async advance(ms) {
    const target = this.#now + ms;
    for (;;) {
      await this.flushMicrotasks();
      let next = null;
      for (const timer of this.#timers.values()) {
        if (timer.due <= target && (next === null || timer.due < next.due || (timer.due === next.due && timer.id < next.id))) {
          next = timer;
        }
      }
      if (next === null) break;
      this.#timers.delete(next.id);
      this.#now = next.due;
      next.fn();
      await this.flushMicrotasks();
    }
    this.#now = target;
    await this.flushMicrotasks();
  }
}

function writePresenceFile(root, session) {
  const dir = join(root, "presence");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(join(dir, `${session.sessionId}.json`), `${JSON.stringify(session)}\n`, "utf8");
}

function removePresenceFile(root, sessionId) {
  rmSync(join(root, "presence", `${sessionId}.json`), { force: true });
}

function makePresence(sessionId, overrides = {}) {
  return {
    sessionId,
    instance: overrides.instance ?? `claude:${sessionId}:abcdef123456`,
    host: overrides.host ?? "claude",
    name: overrides.name ?? `session-${sessionId}`,
    startedAt: overrides.startedAt ?? "2026-11-21T10:00:00.000Z",
    heartbeatAt: overrides.heartbeatAt ?? "2026-11-21T10:00:30.000Z",
    state: overrides.state ?? "live",
    interests: overrides.interests ?? { scopes: [], negotiations: [] },
    subscribedTopics: overrides.subscribedTopics ?? [],
    workStatus: overrides.workStatus ?? "working",
    ...(overrides.workspace === undefined ? {} : { workspace: overrides.workspace }),
    ...(overrides.launchContext === undefined ? {} : { launchContext: overrides.launchContext }),
    ...(overrides.pid === undefined ? {} : { pid: overrides.pid }),
    ...(overrides.mirroredAt === undefined ? {} : { mirroredAt: overrides.mirroredAt })
  };
}

function makeNativeSession(id, overrides = {}) {
  return {
    id,
    generation: overrides.generation ?? "gen-1",
    incarnation: overrides.incarnation ?? "inc-1",
    pid: overrides.pid ?? 12345,
    cols: overrides.cols ?? 120,
    rows: overrides.rows ?? 40,
    lastLocalSize: overrides.lastLocalSize ?? null,
    status: overrides.status ?? "running",
    latestSeq: overrides.latestSeq ?? 1,
    exit: overrides.exit ?? null,
    stopSignal: overrides.stopSignal ?? null,
    controlled: overrides.controlled ?? false,
    holderKind: overrides.holderKind ?? "none",
    socketPath: overrides.socketPath ?? "/private/sock-1"
  };
}

async function runInRealPty(args, env) {
  const ptyMod = await import("node-pty");
  const spawnPty = ptyMod.spawn ?? ptyMod.default?.spawn;
  assert.equal(typeof spawnPty, "function", "node-pty must be available for real PTY test");
  return new Promise((resolvePromise, rejectPromise) => {
    let output = "";
    const term = spawnPty(process.execPath, [H2A_BIN, ...args], {
      name: "xterm-256color",
      cols: 120,
      rows: 30,
      cwd: REPO_ROOT,
      env
    });
    const timer = setTimeout(() => {
      try { term.kill(); } catch { /* ignore */ }
      rejectPromise(new Error(`PTY command timed out: ${args.join(" ")}; output=${output}`));
    }, 10_000);
    term.onData((chunk) => {
      output += chunk;
    });
    term.onExit(({ exitCode }) => {
      clearTimeout(timer);
      resolvePromise({ exitCode, output });
    });
  });
}

function stripAnsi(text) {
  return text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").replace(/\r/g, "");
}

async function startFakeNativeSocketServer(socketPath, handler) {
  mkdirSync(dirname(socketPath), { recursive: true, mode: 0o700 });
  chmodSync(dirname(socketPath), 0o700);
  rmSync(socketPath, { force: true });
  let activeConnections = 0;
  let totalConnections = 0;
  const openSockets = new Set();
  const server = createServer((socket) => {
    activeConnections += 1;
    totalConnections += 1;
    openSockets.add(socket);
    socket.on("close", () => {
      openSockets.delete(socket);
      activeConnections -= 1;
    });
    let buf = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => {
      buf += chunk;
      for (;;) {
        const nl = buf.indexOf("\n");
        if (nl < 0) break;
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (!line) continue;
        const req = JSON.parse(line);
        Promise.resolve(handler(req, socket)).then((result) => {
          if (result === "__HOLD__") return;
          if (!socket.destroyed) {
            socket.write(`${JSON.stringify({ version: 1, id: req.id, ok: true, result })}\n`);
          }
        }).catch((err) => {
          if (!socket.destroyed) {
            socket.write(`${JSON.stringify({ version: 1, id: req.id, ok: false, error: { code: "E_TEST", message: String(err) } })}\n`);
          }
        });
      }
    });
  });
  await new Promise((res, rej) => {
    server.once("error", rej);
    server.listen(socketPath, () => {
      chmodSync(socketPath, 0o600);
      res();
    });
  });
  return {
    activeConnections: () => activeConnections,
    totalConnections: () => totalConnections,
    async close() {
      for (const s of openSockets) s.destroy();
      await new Promise((res) => server.close(() => res()));
      rmSync(socketPath, { force: true });
    }
  };
}

// ---------------------------------------------------------------------------
// 1. Common fixture contract version (wet2TextHash)
// ---------------------------------------------------------------------------

test("LH-06 step 1: common fake fixture pins wet2TextHash and rejects foreign version", () => {
  assert.equal(FIXTURE_CONTRACT_METADATA?.wet2TextHash, WET2_TEXT_HASH);
  assert.equal(assertFixtureContractVersion({ wet2TextHash: WET2_TEXT_HASH }).ok, true);
  const badMeta = assertFixtureContractVersion({ wet2TextHash: "0000000000000000000000000000000000000000000000000000000000000000" });
  assert.equal(badMeta.ok, false);
  assert.equal(badMeta.reason, "wet2-hash-mismatch");

  const pair = generateKeyPairSync("ed25519", {
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" }
  });
  const env = { H2A_REMOTE_CONTROL: "1", H2A_TEST_FAKES: "1" };
  const trunk = new FakeTrunkEndpoint({
    meshId: "m1",
    tenantId: "t1",
    endpoint: "https://remote.example/trunk/v1",
    env,
    wet2TextHash: WET2_TEXT_HASH
  });
  assert.equal(trunk.metadata().wet2TextHash, WET2_TEXT_HASH);

  const foreignTrunk = new FakeTrunkEndpoint({
    meshId: "m1",
    tenantId: "t1",
    endpoint: "https://remote.example/trunk/v1",
    env,
    wet2TextHash: "deadbeef".repeat(8)
  });
  foreignTrunk.registerFixtureKey({ nodeId: "n1", publicKeyPem: pair.publicKey, enrolmentRef: "e1" });
  const ch = { nonce: "n-1", meshId: "m1", tenantId: "t1", endpoint: "https://remote.example/trunk/v1", serverTime: 1000, nodeId: "n1", enrolmentRef: "e1" };
  foreignTrunk.issueChallenge(ch);
  const payload = { ...ch, protocolVersions: [1], clientTime: 1000 };
  const sig = signTrunkAuthPayload(payload, pair.privateKey);
  const refused = foreignTrunk.openLink({ challenge: ch, payload, signature: sig });
  assert.equal(refused.ok, false);
  assert.equal(refused.reason, "wet2-hash-mismatch");

  const foreignVerifier = new FakeEnrolmentVerifier({
    meshId: "m1",
    tenantId: "t1",
    endpoint: "https://remote.example/trunk/v1",
    env,
    wet2TextHash: "deadbeef".repeat(8)
  });
  foreignVerifier.registerNode({ nodeId: "n1", publicKeyPem: pair.publicKey, fingerprint: "fp" });
  const ep = { nodeId: "n1", publicKeyPem: pair.publicKey, deviceName: "d", nonce: "nn", meshId: "m1", tenantId: "t1", endpoint: "https://remote.example/trunk/v1" };
  const vRefused = foreignVerifier.verifyRequest({ payload: ep, signature: signTrunkAuthPayload(ep, pair.privateKey) });
  assert.equal(vRefused.ok, false);
  assert.equal(vRefused.reason, "wet2-hash-mismatch");
});

// ---------------------------------------------------------------------------
// 2. Join & identity (5 contract rows, transitions, ambiguity, incomplete)
// ---------------------------------------------------------------------------

test("LH-06 join & identity: 5 states, sid stability, freshness boundary 14999/15000ms, ambiguity & incomplete inventory", async () => {
  const fx = makeFixtureEnv();
  try {
    const T0 = Date.parse("2026-11-21T10:00:30.000Z");
    const clock = new FakeClock(T0);

    // Presence P names nativePty.session = "N", tmux T, unknown U, plus mirrored presence (ignored).
    const presN = makePresence("P", {
      instance: "inst-P",
      host: "claude",
      name: "alpha-agent",
      workspace: { id: "ws-1", host: "claude", label: "h2a-repo" },
      startedAt: "2026-11-21T10:00:00.000Z",
      heartbeatAt: new Date(T0).toISOString(),
      workStatus: "working",
      launchContext: { cwd: "/secret/cwd", command: "claude", nativePty: { session: "N" } }
    });
    const presTmux = makePresence("P-tmux", {
      instance: "inst-tmux",
      host: "codex",
      name: "tmux-agent",
      heartbeatAt: new Date(T0).toISOString(),
      launchContext: { cwd: "/secret/tmux", command: "codex", tmux: { session: "h2a-t", pane: "%1" } }
    });
    const presUnknown = makePresence("P-unk", {
      instance: "inst-unk",
      host: "gemini",
      name: "bare-agent",
      heartbeatAt: new Date(T0).toISOString(),
      launchContext: { cwd: "/secret/unk", command: "gemini" }
    });
    const presMirrored = makePresence("P-mirrored", {
      instance: "inst-mir",
      heartbeatAt: new Date(T0).toISOString(),
      mirroredAt: new Date(T0).toISOString()
    });
    const presFuture = makePresence("P-future", {
      instance: "inst-fut",
      heartbeatAt: new Date(T0 + 60_000).toISOString()
    });
    const presInvalid = makePresence("P-invalid", {
      instance: "inst-inv",
      heartbeatAt: "not-a-timestamp"
    });
    for (const p of [presN, presTmux, presUnknown, presMirrored, presFuture, presInvalid]) {
      writePresenceFile(fx.root, p);
    }

    // Native inventory: live PTY N + plain user shell S (no presence!)
    let currentInventory = {
      complete: true,
      sessions: [
        makeNativeSession("N", { generation: "g1", incarnation: "i1", socketPath: join(fx.runtimeDir, "s1.sock") }),
        makeNativeSession("S", { generation: "g1", incarnation: "i2", socketPath: join(fx.runtimeDir, "s1.sock") })
      ]
    };

    const messages = [];
    const unavailableEvents = [];
    const projector = createCatalogueProjector({
      root: fx.root,
      configDir: fx.explicitConfigDir,
      env: fx.env,
      clock,
      readNativeInventory: async () => currentInventory
    });
    projector.onUnavailable((ev) => unavailableEvents.push(ev));

    // Zero catalogue before watch.start
    assert.equal(messages.length, 0);

    projector.startWatch((msg) => messages.push(msg));
    await clock.flushMicrotasks();

    assert.equal(messages.length, 1, "first watch.start must emit initial snapshot immediately");
    const snap1 = messages[0];
    assert.equal(snap1.t, "cat.snapshot");
    assert.equal(snap1.truncatedRows, 0);

    const sidN = `n-${sha256Hex("N")}`;
    const sidS = `n-${sha256Hex("S")}`;
    const sidTmux = `p-${sha256Hex("P-tmux")}`;
    const sidUnk = `p-${sha256Hex("P-unk")}`;
    assert.equal(nativeCatalogueSid("N"), sidN);
    assert.equal(presenceCatalogueSid("P-tmux"), sidTmux);

    const byId = (rows) => new Map(rows.map((r) => [r.sessionId, r]));
    const rows1 = byId(snap1.rows);

    // State 1: plain user shell S without presence
    const rowS = rows1.get(sidS);
    assert.ok(rowS, "plain user PTY S without presence must be listed");
    assert.equal(rowS.hostKind, "native");
    assert.equal(rowS.operable, true);
    assert.equal(rowS.workStatus, "unknown");
    assert.equal(rowS.instance, undefined, "native-only row must not fabricate instance");
    assert.equal(rowS.instanceId, undefined, "native-only row must not fabricate instanceId");
    assert.equal(rowS.startedAt, undefined, "native-only row must not fabricate startedAt");
    assert.equal(rowS.heartbeatAt, undefined, "native-only row must not fabricate heartbeatAt");

    // State 2: presence-only rows (tmux + unknown), mirrored/future/invalid excluded
    const rowTmux = rows1.get(sidTmux);
    assert.ok(rowTmux, "fresh tmux presence must be visible");
    assert.equal(rowTmux.hostKind, "tmux");
    assert.equal(rowTmux.operable, false);
    assert.equal(rowTmux.operabilityReason, "not-operable-tmux");

    const rowUnk = rows1.get(sidUnk);
    assert.ok(rowUnk, "fresh unknown presence must be visible");
    assert.equal(rowUnk.hostKind, "unknown");
    assert.equal(rowUnk.operable, false);
    assert.equal(rowUnk.operabilityReason, "open-with-h2a-to-operate");

    assert.equal(rows1.has(`p-${sha256Hex("P-mirrored")}`), false, "mirrored presence must be ignored");
    assert.equal(rows1.has(`p-${sha256Hex("P-future")}`), false, "future heartbeat must not extend freshness");
    assert.equal(rows1.has(`p-${sha256Hex("P-invalid")}`), false, "invalid heartbeat must not be fresh");

    // State 3: live PTY N + fresh presence P -> ONE row
    const rowN = rows1.get(sidN);
    assert.ok(rowN, "joined PTY N + presence P must produce one row under n-<hash>");
    assert.equal(rows1.has(`p-${sha256Hex("P")}`), false, "presence naming nativePty must not produce duplicate p- row");
    assert.equal(rowN.hostKind, "native");
    assert.equal(rowN.operable, true);
    assert.equal(rowN.instanceId, "inst-P");
    assert.equal(rowN.instanceStatus, "live");
    assert.equal(rowN.host, "claude");
    assert.equal(rowN.name, "alpha-agent");
    assert.equal(rowN.workspaceLabel, "h2a-repo");
    assert.equal(rowN.workStatus, "working");
    assert.equal(rowN.startedAt, "2026-11-21T10:00:00.000Z");
    assert.equal(rowN.heartbeatAt, new Date(T0).toISOString());

    // Multiple presences for same PTY N: newer valid heartbeat wins, tie picks lexicographically smallest sessionId
    writePresenceFile(fx.root, makePresence("P-b", {
      instance: "inst-Pb",
      name: "tie-b",
      heartbeatAt: new Date(T0 + 500).toISOString(),
      launchContext: { cwd: "/secret", command: "claude", nativePty: { session: "N" } }
    }));
    writePresenceFile(fx.root, makePresence("P-a", {
      instance: "inst-Pa",
      name: "tie-a",
      heartbeatAt: new Date(T0 + 500).toISOString(),
      launchContext: { cwd: "/secret", command: "claude", nativePty: { session: "N" } }
    }));
    await clock.advance(2_250);
    let view = snap1.rows;
    for (const m of messages.slice(1)) {
      view = m.t === "cat.snapshot" ? m.rows : applyCatalogueDelta(view, m);
    }
    assert.equal(byId(view).get(sidN).name, "tie-a", "most recent valid heartbeat tie must pick lexicographically smallest sessionId");

    // Clean up tie presences so N uses original P with T0 heartbeat for boundary check
    removePresenceFile(fx.root, "P-a");
    removePresenceFile(fx.root, "P-b");
    await clock.advance(2_250); // now = T0 + 4500

    // Freshness boundary: at T0 + 14_999 ms, P-tmux & P-unk are STILL visible; N still has workStatus=working
    await clock.advance(T0 + 14_999 - clock.now());
    view = snap1.rows;
    for (const m of messages.slice(1)) {
      view = m.t === "cat.snapshot" ? m.rows : applyCatalogueDelta(view, m);
    }
    assert.ok(byId(view).has(sidTmux), "presence-only row must still be visible at 14999 ms");
    assert.ok(byId(view).has(sidUnk), "unknown presence-only row must still be visible at 14999 ms");
    assert.equal(byId(view).get(sidN).workStatus, "working", "joined presence must still be fresh at 14999 ms");

    // Advance 1 ms -> T0 + 15_000 ms (exact expiry!)
    const countBeforeExpiry = messages.length;
    await clock.advance(1); // T0 + 15_000
    await clock.advance(249); // T0 + 15_249 -> NO delta yet inside 250 ms window
    assert.equal(messages.length, countBeforeExpiry, "removal/degrade delta must NOT emit at 249 ms");

    await clock.advance(1); // T0 + 15_250 -> delta emits!
    assert.equal(messages.length, countBeforeExpiry + 1, "removal/degrade delta must emit at 250 ms");
    view = snap1.rows;
    for (const m of messages.slice(1)) {
      view = m.t === "cat.snapshot" ? m.rows : applyCatalogueDelta(view, m);
    }
    assert.equal(byId(view).has(sidTmux), false, "tmux presence-only row must expire at 15000 ms");
    assert.equal(byId(view).has(sidUnk), false, "unknown presence-only row must expire at 15000 ms");

    // State 4: stale presence + live PTY N -> same sid, operable=true, workStatus=unknown, heartbeatAt preserved
    const staleN = byId(view).get(sidN);
    assert.ok(staleN, "live PTY N must stay visible when its presence goes stale");
    assert.equal(staleN.sessionId, sidN);
    assert.equal(staleN.operable, true);
    assert.equal(staleN.workStatus, "unknown");
    assert.equal(staleN.heartbeatAt, new Date(T0).toISOString(), "stale joined row must keep observed heartbeatAt");

    // Presence disappears completely while PTY N lives -> sid stays identical
    removePresenceFile(fx.root, "P");
    await clock.advance(2_250);
    view = snap1.rows;
    for (const m of messages.slice(1)) {
      view = m.t === "cat.snapshot" ? m.rows : applyCatalogueDelta(view, m);
    }
    const bareN = byId(view).get(sidN);
    assert.ok(bareN, "live PTY N must stay under same sid after presence disappears");
    assert.equal(bareN.operable, true);
    assert.equal(bareN.workStatus, "unknown");
    assert.equal(bareN.heartbeatAt, undefined);

    // Presence re-arrives -> same sid!
    writePresenceFile(fx.root, makePresence("P-reborn", {
      instance: "inst-reborn",
      heartbeatAt: new Date(clock.now()).toISOString(),
      launchContext: { cwd: "/secret", command: "claude", nativePty: { session: "N" } }
    }));
    await clock.advance(2_250);
    view = snap1.rows;
    for (const m of messages.slice(1)) {
      view = m.t === "cat.snapshot" ? m.rows : applyCatalogueDelta(view, m);
    }
    assert.equal(byId(view).get(sidN).instanceId, "inst-reborn");

    // Ambiguous owner: two sockets claim N -> NOT operable, resolveOpen refuses not-operable
    currentInventory = {
      complete: true,
      sessions: [
        makeNativeSession("N", { generation: "g1", incarnation: "i1", socketPath: join(fx.runtimeDir, "s1.sock") }),
        makeNativeSession("N", { generation: "g2", incarnation: "i9", socketPath: join(fx.runtimeDir, "s2.sock") }),
        makeNativeSession("S", { generation: "g1", incarnation: "i2", socketPath: join(fx.runtimeDir, "s1.sock") })
      ]
    };
    await clock.advance(2_250);
    view = snap1.rows;
    for (const m of messages.slice(1)) {
      view = m.t === "cat.snapshot" ? m.rows : applyCatalogueDelta(view, m);
    }
    assert.equal(byId(view).get(sidN).operable, false, "ambiguous native owner must not be operable");
    const openAmbig = await projector.resolveOpen(sidN);
    assert.equal(openAmbig.ok, false);
    assert.equal(openAmbig.reason, "not-operable");

    // Restore single owner for N, then inject incomplete inventory where N is missing
    currentInventory = {
      complete: true,
      sessions: [
        makeNativeSession("N", { generation: "g1", incarnation: "i1", socketPath: join(fx.runtimeDir, "s1.sock") }),
        makeNativeSession("S", { generation: "g1", incarnation: "i2", socketPath: join(fx.runtimeDir, "s1.sock") })
      ]
    };
    await clock.advance(2_250);

    currentInventory = {
      complete: false,
      sessions: [
        makeNativeSession("S", { generation: "g1", incarnation: "i2", socketPath: join(fx.runtimeDir, "s1.sock") })
      ]
    };
    await clock.advance(2_250);
    assert.equal(unavailableEvents.length, 0, "incomplete inventory must NOT emit any false exit notification");
    const openIncomp = await projector.resolveOpen(sidN);
    assert.equal(openIncomp.ok, false);
    assert.equal(openIncomp.reason, "not-operable");

    // State 5: PTY N exits (even while residual fresh presence P-reborn remains on disk!)
    writePresenceFile(fx.root, makePresence("P-reborn", {
      instance: "inst-reborn",
      heartbeatAt: new Date(clock.now()).toISOString(),
      launchContext: { cwd: "/secret", command: "claude", nativePty: { session: "N" } }
    }));
    currentInventory = {
      complete: true,
      sessions: [
        makeNativeSession("N", { generation: "g1", incarnation: "i1", status: "exited", exit: { exitCode: 0 } }),
        makeNativeSession("S", { generation: "g1", incarnation: "i2", socketPath: join(fx.runtimeDir, "s1.sock") })
      ]
    };
    await clock.advance(2_250);
    view = snap1.rows;
    for (const m of messages.slice(1)) {
      view = m.t === "cat.snapshot" ? m.rows : applyCatalogueDelta(view, m);
    }
    assert.equal(byId(view).has(sidN), false, "exited PTY must be removed and residual presence must not resurrect it");
    assert.equal(unavailableEvents.length, 1, "must emit exactly one exit notification for (g1, i1)");
    assert.equal(unavailableEvents[0].sid, sidN);
    assert.equal(unavailableEvents[0].reason, "exit");
    assert.equal(unavailableEvents[0].generation, "g1");
    assert.equal(unavailableEvents[0].incarnation, "i1");

    // Next poll with N absent & residual presence still there -> still removed, NO duplicate exit event
    currentInventory = {
      complete: true,
      sessions: [
        makeNativeSession("S", { generation: "g1", incarnation: "i2", socketPath: join(fx.runtimeDir, "s1.sock") })
      ]
    };
    await clock.advance(2_250);
    assert.equal(unavailableEvents.length, 1, "exit notification must be emitted only once for old incarnation");

    // New live incarnation (g1, i3) of N replaces the old one cleanly
    currentInventory = {
      complete: true,
      sessions: [
        makeNativeSession("N", { generation: "g1", incarnation: "i3", status: "running", socketPath: join(fx.runtimeDir, "s1.sock") }),
        makeNativeSession("S", { generation: "g1", incarnation: "i2", socketPath: join(fx.runtimeDir, "s1.sock") })
      ]
    };
    await clock.advance(2_250);
    view = snap1.rows;
    for (const m of messages.slice(1)) {
      view = m.t === "cat.snapshot" ? m.rows : applyCatalogueDelta(view, m);
    }
    assert.ok(byId(view).has(sidN), "new live incarnation must reappear");
    const openReborn = await projector.resolveOpen(sidN);
    assert.equal(openReborn.ok, true);
    assert.equal(openReborn.incarnation, "i3");

    // Presence naming nativePty BEFORE host discovery keeps n-<hash> sid
    writePresenceFile(fx.root, makePresence("P-early", {
      instance: "inst-early",
      heartbeatAt: new Date(clock.now()).toISOString(),
      launchContext: { cwd: "/secret", command: "claude", nativePty: { session: "N-future" } }
    }));
    await clock.advance(2_250);
    view = snap1.rows;
    for (const m of messages.slice(1)) {
      view = m.t === "cat.snapshot" ? m.rows : applyCatalogueDelta(view, m);
    }
    const sidEarly = `n-${sha256Hex("N-future")}`;
    assert.ok(byId(view).has(sidEarly), "presence naming nativePty must already use n-<hash> before host discovery");
    assert.equal(byId(view).get(sidEarly).operable, false, "unconfirmed native target must be inoperable");

    projector.stopWatch();
  } finally {
    cleanupFixture(fx);
  }
});

// ---------------------------------------------------------------------------
// 3. MCP companion *.h2a exclusion
// ---------------------------------------------------------------------------

test("LH-06 MCP companion *.h2a is invisible in catalogue and refused with unknown-session everywhere", async () => {
  const fx = makeFixtureEnv();
  try {
    const T0 = Date.parse("2026-11-21T11:00:00.000Z");
    const clock = new FakeClock(T0);
    const parentSid = `n-${sha256Hex("h2a-x")}`;
    const companionSid = `n-${sha256Hex("h2a-x.h2a")}`;

    assert.equal(isInternalCompanionNativeId("h2a-x.h2a"), true);
    assert.equal(isInternalCompanionNativeId("h2a-x"), false);

    let inventory = {
      complete: true,
      sessions: [
        makeNativeSession("h2a-x", { generation: "g1", incarnation: "i1", socketPath: join(fx.runtimeDir, "s1.sock") }),
        makeNativeSession("h2a-x.h2a", { generation: "g1", incarnation: "i-sidecar", socketPath: join(fx.runtimeDir, "s1.sock") })
      ]
    };

    const messages = [];
    const projector = createCatalogueProjector({
      root: fx.root,
      configDir: fx.explicitConfigDir,
      env: fx.env,
      clock,
      readNativeInventory: async () => inventory
    });
    projector.startWatch((m) => messages.push(m));
    await clock.flushMicrotasks();

    assert.equal(messages.length, 1);
    assert.equal(messages[0].rows.length, 1);
    assert.equal(messages[0].rows[0].sessionId, parentSid);
    assert.equal(messages[0].truncatedRows, 0);

    // Arrival of a presence pointing at h2a-x.h2a (even when host is absent!)
    writePresenceFile(fx.root, makePresence("pres-sidecar", {
      instance: "inst-sidecar",
      heartbeatAt: new Date(clock.now()).toISOString(),
      launchContext: { cwd: "/x", command: "mcp-serve", nativePty: { session: "h2a-x.h2a" } }
    }));
    await clock.advance(2_250);
    assert.equal(messages.length, 1, "companion presence arrival must produce zero delta");

    // Host absent at next cycle, companion presence still present
    const savedInv = inventory;
    inventory = { complete: true, sessions: [savedInv.sessions[0]] };
    await clock.advance(2_250);
    assert.equal(messages.length, 1, "companion presence with host absent must still be excluded");

    // Removal of companion presence
    removePresenceFile(fx.root, "pres-sidecar");
    await clock.advance(2_250);
    assert.equal(messages.length, 1, "companion presence removal must produce zero delta");

    // Re-add companion presence to test off/on via alias, raw internal name, and computed sid
    writePresenceFile(fx.root, makePresence("pres-sidecar", {
      instance: "inst-sidecar",
      heartbeatAt: new Date(clock.now()).toISOString(),
      launchContext: { cwd: "/x", command: "mcp-serve", nativePty: { session: "h2a-x.h2a" } }
    }));

    const exclPath = resolveExclusionsFilePath({ configDir: fx.explicitConfigDir, env: fx.env });
    for (const target of ["h2a-x.h2a", "pres-sidecar", companionSid]) {
      const offRes = runRemoteControlVerb("off", {
        root: fx.root,
        configDir: fx.explicitConfigDir,
        env: fx.env,
        isInteractive: false,
        session: target
      });
      assert.equal(offRes.ok, false, `off(${target}) must refuse`);
      assert.equal(offRes.reason, "unknown-session", `off(${target}) must return unknown-session`);

      const onRes = runRemoteControlVerb("on", {
        root: fx.root,
        configDir: fx.explicitConfigDir,
        env: fx.env,
        isInteractive: true,
        confirm: "on",
        session: target
      });
      assert.equal(onRes.ok, false, `on(${target}) must refuse`);
      assert.equal(onRes.reason, "unknown-session", `on(${target}) must return unknown-session`);
    }
    assert.equal(existsSync(exclPath), false, "companion refusals must write zero exclusion state");

    // resolveOpen on companion sid -> unknown-session without touching socket
    let openProbeCalls = 0;
    const probeProjector = createCatalogueProjector({
      root: fx.root,
      configDir: fx.explicitConfigDir,
      env: fx.env,
      clock,
      readNativeInventory: async () => {
        openProbeCalls += 1;
        return savedInv;
      }
    });
    const compOpen = await probeProjector.resolveOpen(companionSid);
    assert.equal(compOpen.ok, false);
    assert.equal(compOpen.reason, "unknown-session");
    assert.equal(openProbeCalls, 0, "companion resolveOpen must not touch native sockets");

    // Parent h2a-x remains openable
    inventory = savedInv;
    const parentOpen = await projector.resolveOpen(parentSid);
    assert.equal(parentOpen.ok, true);
    assert.equal(parentOpen.nativeId, "h2a-x");

    projector.stopWatch();
  } finally {
    cleanupFixture(fx);
  }
});

// ---------------------------------------------------------------------------
// 4. Privacy & hostile sentinels
// ---------------------------------------------------------------------------

test("LH-06 privacy: strips sentinels, paths, file:// URIs, controls, coordinates and rejects foreign keys", async () => {
  const fx = makeFixtureEnv();
  try {
    const T0 = Date.parse("2026-11-21T12:00:00.000Z");
    const clock = new FakeClock(T0);

    const SENTINELS = [
      "SENTINEL_CWD_9182",
      "SENTINEL_CMD_8374",
      "SENTINEL_RESUME_7463",
      "9876543",
      "SENTINEL_TTY_pts99",
      "SENTINEL_TMUX_SESS",
      "SENTINEL_TMUX_PANE_99",
      "SENTINEL_FILE_URI_4412",
      "SENTINEL_ENV_SECRET_5512",
      "SENTINEL_WS_PATH_6612",
      "SENTINEL_WS_REPO_7712",
      "SENTINEL_WS_EXTRA_8812",
      "SENTINEL_NAME_PATH_1111",
      "SENTINEL_LABEL_URI_2222",
      "SENTINEL_WIN_PATH_3333",
      "SENTINEL_UNC_PATH_4444"
    ];

    writePresenceFile(fx.root, makePresence("P-clean", {
      instance: "inst-priv-1",
      host: "claude",
      name: "clean-display-name",
      workspace: {
        id: "ws-priv",
        host: "claude",
        label: "safe-ws-label",
        path: "/home/alice/SENTINEL_WS_PATH_6612",
        repo: "https://git.internal/SENTINEL_WS_REPO_7712",
        extraSubObject: { nested: "SENTINEL_WS_EXTRA_8812" }
      },
      pid: 9876543,
      heartbeatAt: new Date(T0).toISOString(),
      launchContext: {
        cwd: "/home/alice/SENTINEL_CWD_9182",
        command: "SENTINEL_CMD_8374 --flag",
        resumeCommand: "SENTINEL_RESUME_7463",
        tty: "/dev/SENTINEL_TTY_pts99",
        tmux: { session: "SENTINEL_TMUX_SESS", window: "w0", pane: "%SENTINEL_TMUX_PANE_99" },
        nativePty: { session: "h2a-priv-1" }
      }
    }));

    // Session whose name has Unix abs path and workspace.label has file:// URI
    writePresenceFile(fx.root, makePresence("P-hostile-display", {
      instance: "inst-priv-2",
      host: "codex",
      name: "/home/bob/SENTINEL_NAME_PATH_1111",
      workspace: { id: "ws-2", host: "codex", label: "file:///var/SENTINEL_LABEL_URI_2222" },
      heartbeatAt: new Date(T0).toISOString(),
      launchContext: { cwd: "/x", command: "codex", nativePty: { session: "h2a-priv-2" } }
    }));

    // Session whose name has Windows path and label has UNC path
    writePresenceFile(fx.root, makePresence("P-win-unc", {
      instance: "inst-priv-3",
      host: "gemini",
      name: "C:\\Users\\bob\\SENTINEL_WIN_PATH_3333",
      workspace: { id: "ws-3", host: "gemini", label: "\\\\srv\\share\\SENTINEL_UNC_PATH_4444" },
      heartbeatAt: new Date(T0).toISOString(),
      launchContext: { cwd: "/x", command: "gemini", nativePty: { session: "h2a-priv-3" } }
    }));

    // Session whose name copies command verbatim and label has control char
    writePresenceFile(fx.root, makePresence("P-ctrl-cmd", {
      instance: "inst-priv-4",
      host: "claude",
      name: "SENTINEL_CMD_8374",
      workspace: { id: "ws-4", host: "claude", label: "bad\x1blabel" },
      heartbeatAt: new Date(T0).toISOString(),
      launchContext: { cwd: "/x", command: "SENTINEL_CMD_8374", nativePty: { session: "h2a-priv-4" } }
    }));

    const envWithSecret = { ...fx.env, MY_SECRET_TOKEN: "SENTINEL_ENV_SECRET_5512", FILE_URL: "file:///SENTINEL_FILE_URI_4412" };
    const messages = [];
    const audits = [];
    const projector = createCatalogueProjector({
      root: fx.root,
      configDir: fx.explicitConfigDir,
      env: envWithSecret,
      clock,
      onAudit: (ev) => audits.push(ev),
      readNativeInventory: async () => ({
        complete: true,
        sessions: [
          makeNativeSession("h2a-priv-1", { pid: 9876543, socketPath: join(fx.runtimeDir, "s1.sock") }),
          makeNativeSession("h2a-priv-2", { pid: 9876543, socketPath: join(fx.runtimeDir, "s1.sock") }),
          makeNativeSession("h2a-priv-3", { pid: 9876543, socketPath: join(fx.runtimeDir, "s1.sock") }),
          makeNativeSession("h2a-priv-4", { pid: 9876543, socketPath: join(fx.runtimeDir, "s1.sock") })
        ]
      })
    });

    projector.startWatch((m) => messages.push(m));
    await clock.flushMicrotasks();

    assert.equal(messages.length, 1);
    const snap = messages[0];
    const wire = serializeCatalogueSnapshot(snap);
    const diagText = JSON.stringify(audits);

    for (const sentinel of SENTINELS) {
      assert.equal(wire.includes(sentinel), false, `wire bytes leaked sentinel: ${sentinel}`);
      assert.equal(diagText.includes(sentinel), false, `diagnostics leaked sentinel: ${sentinel}`);
    }
    assert.equal(containsForbiddenLocalField(snap), false);

    const row1 = snap.rows.find((r) => r.sessionId === `n-${sha256Hex("h2a-priv-1")}`);
    assert.equal(row1.workspaceLabel, "safe-ws-label");
    assert.equal(row1.name, "clean-display-name");
    assert.equal("workspace" in row1, false);

    const row2 = snap.rows.find((r) => r.sessionId === `n-${sha256Hex("h2a-priv-2")}`);
    assert.equal(row2.name, undefined, "Unix path in name must be omitted");
    assert.equal(row2.workspaceLabel, undefined, "file:// URI in workspaceLabel must be omitted");

    const row3 = snap.rows.find((r) => r.sessionId === `n-${sha256Hex("h2a-priv-3")}`);
    assert.equal(row3.name, undefined, "Windows path in name must be omitted");
    assert.equal(row3.workspaceLabel, undefined, "UNC path in workspaceLabel must be omitted");

    const row4 = snap.rows.find((r) => r.sessionId === `n-${sha256Hex("h2a-priv-4")}`);
    assert.equal(row4.name, undefined, "exact copy of launch command must be omitted");
    assert.equal(row4.workspaceLabel, undefined, "control char in workspaceLabel must be omitted");

    // Round-trip & foreign property rejection on row, snapshot, and delta (one at a time)
    assert.deepEqual(parseCatalogueSnapshot(wire), snap);

    const tamperedRow = JSON.parse(wire);
    tamperedRow.rows[0].foreignProp = "x";
    assert.throws(() => parseCatalogueSnapshot(JSON.stringify(tamperedRow)), TypeError);

    const tamperedSnap = JSON.parse(wire);
    tamperedSnap.foreignSnapProp = "x";
    assert.throws(() => parseCatalogueSnapshot(JSON.stringify(tamperedSnap)), TypeError);

    const validDelta = {
      v: 1,
      t: "cat.delta",
      ch: 1,
      s: 2,
      at: T0 + 250,
      adds: [],
      updates: [{ sessionId: row1.sessionId, instanceId: "inst-priv-1", instanceStatus: "revoked" }],
      removes: []
    };
    const deltaWire = serializeCatalogueDelta(validDelta);
    assert.deepEqual(parseCatalogueDelta(deltaWire), validDelta);

    const tamperedDeltaEnv = JSON.parse(deltaWire);
    tamperedDeltaEnv.foreignDeltaProp = "x";
    assert.throws(() => parseCatalogueDelta(JSON.stringify(tamperedDeltaEnv)), TypeError);

    const tamperedDeltaPartial = JSON.parse(deltaWire);
    tamperedDeltaPartial.updates[0].extra = "x";
    assert.throws(() => parseCatalogueDelta(JSON.stringify(tamperedDeltaPartial)), TypeError);

    projector.stopWatch();
  } finally {
    cleanupFixture(fx);
  }
});

// ---------------------------------------------------------------------------
// 5. Owner choice: CLI, MCP, real PTY `on`, syntax variants, concurrency, errors
// ---------------------------------------------------------------------------

test("LH-06 owner choice: CLI/MCP off, real PTY on, syntax guards, persistence, concurrency, alias & errors", async () => {
  const fx = makeFixtureEnv();
  try {
    const T0 = Date.parse("2026-11-21T13:00:00.000Z");
    const clock = new FakeClock(T0);

    writePresenceFile(fx.root, makePresence("sess-one", {
      instance: "inst-one",
      heartbeatAt: new Date(T0).toISOString(),
      launchContext: { cwd: "/x", command: "claude", nativePty: { session: "h2a-one" } }
    }));
    writePresenceFile(fx.root, makePresence("sess-two", {
      instance: "inst-two",
      heartbeatAt: new Date(T0).toISOString(),
      launchContext: { cwd: "/x", command: "claude", nativePty: { session: "h2a-two" } }
    }));

    const sidOne = `n-${sha256Hex("h2a-one")}`;
    const sidTwo = `n-${sha256Hex("h2a-two")}`;

    // 1. CLI `off <session>` on sess-one (positional, --root after)
    const cliOff = captureStreams();
    const rcOff = withProcessEnv(fx.env, () =>
      runCli(["remote", "off", "sess-one", "--root", fx.root], cliOff.streams, { env: fx.env })
    );
    assert.equal(rcOff, 0, `CLI off failed: ${cliOff.err()}`);
    const parsedOff = JSON.parse(cliOff.out());
    assert.equal(parsedOff.ok, true);
    assert.equal(parsedOff.state, "ok");
    assert.equal(parsedOff.sessionId, sidOne);
    assert.equal(parsedOff.excluded, true);

    // 2. MCP `h2a_remote_off` on sess-two
    const mcpOff = withProcessEnv(fx.env, () => {
      const store = createLocalStore({ root: fx.root });
      const server = createMcpServer({ root: fx.root, store });
      return server.callTool("h2a_remote_off", { session: "sess-two" });
    });
    assert.equal(mcpOff.ok, true, `MCP off failed: ${JSON.stringify(mcpOff)}`);
    assert.equal(mcpOff.state, "ok");
    assert.equal(mcpOff.sessionId, sidTwo);
    assert.equal(mcpOff.excluded, true);

    // Check file permissions (dir 0700, file 0600)
    const exclPath = join(fx.configHome, "sentropic", "h2a", "remote-control", "exclusions.json");
    assert.equal(existsSync(exclPath), true);
    assert.equal(statSync(dirname(exclPath)).mode & 0o777, 0o700);
    assert.equal(statSync(exclPath).mode & 0o777, 0o600);

    // 3. Re-read from a fresh projector instance AND from a second presence root sharing the same configHome AND from a separate Node process
    const inv = {
      complete: true,
      sessions: [
        makeNativeSession("h2a-one", { socketPath: join(fx.runtimeDir, "s1.sock") }),
        makeNativeSession("h2a-two", { socketPath: join(fx.runtimeDir, "s1.sock") })
      ]
    };
    const msgsRootA = [];
    const projA = createCatalogueProjector({ root: fx.root, env: fx.env, clock, readNativeInventory: async () => inv });
    projA.startWatch((m) => msgsRootA.push(m));
    await clock.flushMicrotasks();
    for (const sid of [sidOne, sidTwo]) {
      const r = msgsRootA[0].rows.find((row) => row.sessionId === sid);
      assert.equal(r.excluded, true);
      assert.equal(r.operable, false);
      assert.equal(r.operabilityReason, "not-shared");
    }
    projA.stopWatch();

    // Second presence root B with same account XDG_CONFIG_HOME sees the same exclusions
    const msgsRootB = [];
    const projB = createCatalogueProjector({ root: fx.rootB, env: fx.env, clock, readNativeInventory: async () => inv });
    projB.startWatch((m) => msgsRootB.push(m));
    await clock.flushMicrotasks();
    for (const sid of [sidOne, sidTwo]) {
      const r = msgsRootB[0].rows.find((row) => row.sessionId === sid);
      assert.equal(r.excluded, true, "second presence root sharing account configDir must see same exclusion");
      assert.equal(r.operable, false);
    }
    projB.stopWatch();

    // Separate Node process reading exclusions
    const childCheck = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import { readExclusions } from ${JSON.stringify(join(REPO_ROOT, "packages/h2a/dist/runtime/remote-agent/index.js"))};
         const res = readExclusions({ env: process.env });
         console.log(JSON.stringify(res));`
      ],
      { env: fx.env, encoding: "utf8" }
    );
    assert.equal(childCheck.status, 0, childCheck.stderr);
    const childParsed = JSON.parse(childCheck.stdout);
    assert.equal(childParsed.ok, true);
    assert.equal(childParsed.file.entries.length, 2);

    // 4. Pipe (non-TTY) `on` MUST be refused!
    const pipeOn = spawnSync(process.execPath, [H2A_BIN, "remote", "on", "sess-one", "--confirm", "on", "--root", fx.root], {
      env: fx.env,
      encoding: "utf8"
    });
    assert.equal(pipeOn.status, 1, "piped remote on must refuse");
    assert.match(pipeOn.stderr, /site-side approval/);

    // 5. Real private PTY: `on sess-one --confirm on` lifts EXACTLY ONE exclusion!
    const ptyGood = await runInRealPty(["remote", "on", "sess-one", "--confirm", "on", "--root", fx.root], fx.env);
    assert.equal(ptyGood.exitCode, 0, `real PTY on failed: ${ptyGood.output}`);
    const cleanPtyOut = stripAnsi(ptyGood.output);
    const jsonStart = cleanPtyOut.indexOf("{");
    assert.ok(jsonStart >= 0, `expected JSON output from real PTY on, got: ${cleanPtyOut}`);
    const ptyGoodJson = JSON.parse(cleanPtyOut.slice(jsonStart).trim());
    assert.equal(ptyGoodJson.ok, true);
    assert.equal(ptyGoodJson.state, "ok");
    assert.equal(ptyGoodJson.sessionId, sidOne);
    assert.equal(ptyGoodJson.excluded, false);

    const afterOneOn = readExclusions({ env: fx.env });
    assert.equal(afterOneOn.ok, true);
    assert.deepEqual(afterOneOn.file.entries.map((e) => e.sid), [sidTwo], "only sess-one must be lifted; sess-two stays excluded");

    // 6. Real PTY negative cases: wrong confirm word, missing target, two targets
    const ptyWrongWord = await runInRealPty(["remote", "on", "sess-two", "--confirm", "yes", "--root", fx.root], fx.env);
    assert.equal(ptyWrongWord.exitCode, 1);
    assert.match(ptyWrongWord.output, /site-side approval/);

    const ptyMissing = await runInRealPty(["remote", "on", "--confirm", "on", "--root", fx.root], fx.env);
    assert.equal(ptyMissing.exitCode, 1);
    assert.match(ptyMissing.output, /invalid-session/);

    const ptyTwoTargets = await runInRealPty(["remote", "on", "sess-one", "sess-two", "--confirm", "on", "--root", fx.root], fx.env);
    assert.equal(ptyTwoTargets.exitCode, 1);
    assert.match(ptyTwoTargets.output, /invalid-session/);

    // 7. Replay successes with --session alias, --root before/after target, --confirm on before/after target
    const offAliasBefore = captureStreams();
    assert.equal(
      withProcessEnv(fx.env, () =>
        runCli(["remote", "off", "--root", fx.root, "--session", "sess-one"], offAliasBefore.streams, { env: fx.env })
      ),
      0,
      offAliasBefore.err()
    );
    const ptyOnAlias = await runInRealPty(["remote", "on", "--confirm", "on", "--root", fx.root, "--session", "sess-one"], fx.env);
    assert.equal(ptyOnAlias.exitCode, 0, ptyOnAlias.output);

    const offAliasAfter = captureStreams();
    assert.equal(
      withProcessEnv(fx.env, () =>
        runCli(["remote", "off", "--session", "sess-one", "--root", fx.root], offAliasAfter.streams, { env: fx.env })
      ),
      0,
      offAliasAfter.err()
    );
    const ptyOnAliasAfter = await runInRealPty(["remote", "on", "--session", "sess-one", "--confirm", "on", "--root", fx.root], fx.env);
    assert.equal(ptyOnAliasAfter.exitCode, 0, ptyOnAliasAfter.output);

    // 8. CLI validation rejections: mixed positional+alias, repeated alias, alias without value, unknown options --foo and -x -> invalid-session & ZERO writes
    const snapshotBeforeBad = readFileSync(exclPath, "utf8");
    const badArgvs = [
      ["remote", "off", "sess-one", "--session", "sess-one", "--root", fx.root],
      ["remote", "off", "--session", "sess-one", "--session", "sess-two", "--root", fx.root],
      ["remote", "off", "--session", "--root", fx.root],
      ["remote", "off", "--session"],
      ["remote", "off", "sess-one", "--foo", "--root", fx.root],
      ["remote", "off", "sess-one", "-x", "--root", fx.root],
      ["remote", "off", "--foo", "sess-one", "--root", fx.root],
      ["remote", "off", "-x", "sess-one", "--root", fx.root],
      ["remote", "off", "--root", fx.root],
      ["remote", "off", "sess-one", "sess-two", "--root", fx.root],
      ["remote", "off", "", "--root", fx.root]
    ];
    for (const argv of badArgvs) {
      const cap = captureStreams();
      const rc = withProcessEnv(fx.env, () => runCli(argv, cap.streams, { env: fx.env }));
      assert.equal(rc, 1, `expected failure for ${JSON.stringify(argv)}`);
      assert.match(cap.err(), /invalid-session/, `expected invalid-session for ${JSON.stringify(argv)}, got ${cap.err()}`);
    }
    assert.equal(readFileSync(exclPath, "utf8"), snapshotBeforeBad, "rejected CLI calls must perform zero writes");

    // 9. Canonical sid via catalogue-ids.json in another process + unknown hash -> unknown-session (no fallback to raw name)
    const idsFile = resolveCatalogueIdsFilePath({ env: fx.env });
    assert.equal(existsSync(idsFile), true, "complete inventory watch must persist catalogue-ids.json");
    assert.equal(statSync(idsFile).mode & 0o777, 0o600);
    const offBySid = spawnSync(process.execPath, [H2A_BIN, "remote", "off", sidOne, "--root", fx.rootB], {
      env: fx.env,
      encoding: "utf8"
    });
    assert.equal(offBySid.status, 0, `off by canonical sid via catalogue-ids.json failed: ${offBySid.stderr}`);
    assert.equal(JSON.parse(offBySid.stdout).sessionId, sidOne);

    const unknownHash = `n-${sha256Hex("never-existed-anywhere")}`;
    const offUnknownHash = runRemoteControlVerb("off", { root: fx.root, env: fx.env, isInteractive: false, session: unknownHash });
    assert.equal(offUnknownHash.ok, false);
    assert.equal(offUnknownHash.reason, "unknown-session");

    // 10. Repeated `off` is idempotent
    const repeat1 = setSessionExcluded("h2a-one", { root: fx.root, env: fx.env });
    const repeat2 = setSessionExcluded("h2a-one", { root: fx.root, env: fx.env });
    assert.equal(repeat1.ok, true);
    assert.equal(repeat2.ok, true);
    const afterRepeat = readExclusions({ env: fx.env });
    assert.equal(afterRepeat.file.entries.filter((e) => e.sid === sidOne).length, 1);

    // 11. Two concurrent `off` writes from separate processes preserve both entries
    const p1 = new Promise((res) => {
      const c = spawn(process.execPath, [H2A_BIN, "remote", "off", "h2a-conc-a", "--root", fx.root], { env: fx.env });
      c.on("exit", (code) => res(code));
    });
    const p2 = new Promise((res) => {
      const c = spawn(process.execPath, [H2A_BIN, "remote", "off", "h2a-conc-b", "--root", fx.root], { env: fx.env });
      c.on("exit", (code) => res(code));
    });
    const [c1, c2] = await Promise.all([p1, p2]);
    assert.equal(c1, 0);
    assert.equal(c2, 0);
    const afterConc = readExclusions({ env: fx.env });
    assert.equal(afterConc.ok, true);
    const concSids = new Set(afterConc.file.entries.map((e) => e.sid));
    assert.ok(concSids.has(`n-${sha256Hex("h2a-conc-a")}`));
    assert.ok(concSids.has(`n-${sha256Hex("h2a-conc-b")}`));

    // 12. p- exclusion promoted with alias when presence acquires n- target, then `on` removes entry + alias
    writePresenceFile(fx.root, makePresence("P-promote", {
      instance: "inst-promote",
      heartbeatAt: new Date(clock.now()).toISOString(),
      launchContext: { cwd: "/x", command: "claude" }
    }));
    const offProm = setSessionExcluded("P-promote", { root: fx.root, configDir: fx.explicitConfigDir, env: fx.env });
    assert.equal(offProm.ok, true);
    assert.equal(offProm.sessionId, `p-${sha256Hex("P-promote")}`);

    // Now P-promote acquires native target h2a-promoted
    writePresenceFile(fx.root, makePresence("P-promote", {
      instance: "inst-promote",
      heartbeatAt: new Date(clock.now()).toISOString(),
      launchContext: { cwd: "/x", command: "claude", nativePty: { session: "h2a-promoted" } }
    }));
    const promMsgs = [];
    const promProj = createCatalogueProjector({
      root: fx.root,
      configDir: fx.explicitConfigDir,
      env: fx.env,
      clock,
      readNativeInventory: async () => ({
        complete: true,
        sessions: [makeNativeSession("h2a-promoted", { socketPath: join(fx.runtimeDir, "s1.sock") })]
      })
    });
    promProj.startWatch((m) => promMsgs.push(m));
    await clock.flushMicrotasks();
    const promSid = `n-${sha256Hex("h2a-promoted")}`;
    const promRow = promMsgs[0].rows.find((r) => r.sessionId === promSid);
    assert.equal(promRow.excluded, true, "p- exclusion must carry over when presence acquires n- target");
    assert.equal(promRow.operable, false);
    const clearedProm = clearSessionExcluded(promSid, { root: fx.root, configDir: fx.explicitConfigDir, env: fx.env });
    assert.equal(clearedProm.ok, true);
    const afterClear = readExclusions({ configDir: fx.explicitConfigDir, env: fx.env });
    assert.equal(afterClear.file.entries.length, 0, "on must remove entry and all its aliases");
    promProj.stopWatch();

    // 13. Unreadable / corrupt exclusions file -> exclusion-state-unavailable
    const corruptDir = join(fx.base, "corrupt-config");
    const corruptRcDir = join(corruptDir, "remote-control");
    mkdirSync(corruptRcDir, { recursive: true, mode: 0o700 });
    writeFileSync(join(corruptRcDir, "exclusions.json"), "{corrupt-json", { mode: 0o600 });
    const badRead = readExclusions({ configDir: corruptDir, env: fx.env });
    assert.equal(badRead.ok, false);
    assert.equal(badRead.reason, "exclusion-state-unavailable");
    const badOff = runRemoteControlVerb("off", { root: fx.root, configDir: corruptDir, env: fx.env, isInteractive: false, session: "h2a-one" });
    assert.equal(badOff.ok, false);
    assert.equal(badOff.reason, "exclusion-state-unavailable");

    // 14. Flag off: zero exclusion writes, zero catalogue reads, help shows new syntax when enabled
    const offEnv = { ...fx.env, H2A_REMOTE_CONTROL: "0" };
    const offConfigDir = join(fx.base, "flag-off-config");
    mkdirSync(offConfigDir, { recursive: true, mode: 0o700 });
    const flagOffRes = runRemoteControlVerb("off", { root: fx.root, configDir: offConfigDir, env: offEnv, session: "h2a-one" });
    assert.equal(flagOffRes.ok, false);
    assert.equal(flagOffRes.reason, "remote-control-disabled");
    assert.equal(existsSync(join(offConfigDir, "remote-control", "exclusions.json")), false);

    const helpOn = captureStreams();
    assert.equal(runCli(["--help"], helpOn.streams, { env: fx.env }), 0);
    assert.ok(helpOn.out().includes("h2a remote off <session>"));
    assert.ok(helpOn.out().includes("h2a remote on <session> --confirm on"));
  } finally {
    cleanupFixture(fx);
  }
});

// ---------------------------------------------------------------------------
// 6. Open decision, view close on off, withShareAllowed, instance status delta
// ---------------------------------------------------------------------------

test("LH-06 open decision: excluded refuses before socket, view closes on off, reopens after on, instance status delta", async () => {
  const fx = makeFixtureEnv();
  try {
    const T0 = Date.parse("2026-11-21T14:00:00.000Z");
    const clock = new FakeClock(T0);

    writePresenceFile(fx.root, makePresence("P-open", {
      instance: "inst-A",
      heartbeatAt: new Date(T0).toISOString(),
      launchContext: { cwd: "/x", command: "claude", nativePty: { session: "h2a-open" } }
    }));
    writePresenceFile(fx.root, makePresence("P-tmux-open", {
      instance: "inst-B",
      heartbeatAt: new Date(T0).toISOString(),
      launchContext: { cwd: "/x", command: "codex", tmux: { session: "t1", pane: "%1" } }
    }));

    const sidOpen = `n-${sha256Hex("h2a-open")}`;
    const sidTmux = `p-${sha256Hex("P-tmux-open")}`;

    let inventoryCalls = 0;
    let openSpyCalls = 0;
    const messages = [];
    const unavailable = [];

    const projector = createCatalogueProjector({
      root: fx.root,
      configDir: fx.explicitConfigDir,
      env: fx.env,
      clock,
      readNativeInventory: async () => {
        inventoryCalls += 1;
        return {
          complete: true,
          sessions: [makeNativeSession("h2a-open", { generation: "g1", incarnation: "i1", socketPath: join(fx.runtimeDir, "s1.sock") })]
        };
      }
    });
    projector.applyRevokedInstances(["inst-pre-revoked"]);
    projector.onUnavailable((ev) => unavailable.push(ev));
    projector.startWatch((m) => messages.push(m));
    await clock.flushMicrotasks();

    // Verify initially operable in snapshot
    assert.equal(messages[0].rows.find((r) => r.sessionId === sidOpen).operable, true);

    async function guardedOpen(sid) {
      const res = await projector.resolveOpen(sid);
      if (res.ok) openSpyCalls += 1;
      return res;
    }

    // Open works initially
    const firstOpen = await guardedOpen(sidOpen);
    assert.equal(firstOpen.ok, true);
    assert.equal(openSpyCalls, 1);

    // Exclude session while last snapshot STILL shows it operable!
    const offRes = setSessionExcluded(sidOpen, { root: fx.root, configDir: fx.explicitConfigDir, env: fx.env });
    assert.equal(offRes.ok, true);

    const invCallsBeforeExcludedOpen = inventoryCalls;
    const openWhileExcluded = await guardedOpen(sidOpen);
    assert.equal(openWhileExcluded.ok, false);
    assert.equal(openWhileExcluded.reason, "excluded");
    assert.equal(openSpyCalls, 1, "instrumented open callback must count zero new calls when excluded");
    assert.equal(inventoryCalls, invCallsBeforeExcludedOpen, "excluded resolveOpen must refuse BEFORE touching native sockets");

    // withShareAllowed blocks enqueue synchronously after off
    let enqueued = 0;
    const shareBlocked = projector.withShareAllowed(sidOpen, () => { enqueued += 1; });
    assert.equal(shareBlocked.allowed, false);
    assert.equal(shareBlocked.reason, "excluded");
    assert.equal(enqueued, 0);

    // Next poll observes exclusion -> spy view receives onUnavailable("excluded")
    await clock.advance(2_250);
    assert.ok(unavailable.some((ev) => ev.sid === sidOpen && ev.reason === "excluded"), "open view must be notified of local exclusion");

    // Unknown session & tmux session
    const unkOpen = await guardedOpen(`n-${sha256Hex("does-not-exist")}`);
    assert.equal(unkOpen.ok, false);
    assert.equal(unkOpen.reason, "unknown-session");

    const tmuxOpen = await guardedOpen(sidTmux);
    assert.equal(tmuxOpen.ok, false);
    assert.equal(tmuxOpen.reason, "not-operable");

    // Lift exclusion via `on` -> reopen and withShareAllowed succeed again
    const onRes = clearSessionExcluded(sidOpen, { root: fx.root, configDir: fx.explicitConfigDir, env: fx.env });
    assert.equal(onRes.ok, true);
    const shareOk = projector.withShareAllowed(sidOpen, () => { enqueued += 1; });
    assert.equal(shareOk.allowed, true);
    assert.equal(enqueued, 1);
    const reopened = await guardedOpen(sidOpen);
    assert.equal(reopened.ok, true);
    assert.equal(openSpyCalls, 2);

    // setInstanceStatus emits status-only partial delta { sessionId, instanceId, instanceStatus }
    await clock.advance(2_250);
    const msgBeforeRevoke = messages.length;
    projector.setInstanceStatus("inst-A", "revoked");
    await clock.advance(249);
    assert.equal(messages.length, msgBeforeRevoke);
    await clock.advance(1);
    assert.equal(messages.length, msgBeforeRevoke + 1);
    const delta = messages[messages.length - 1];
    assert.equal(delta.t, "cat.delta");
    assert.deepEqual(delta.updates, [{ sessionId: sidOpen, instanceId: "inst-A", instanceStatus: "revoked" }]);

    // applyCatalogueDelta only applies partial update to matching existing row of same instanceId
    const baseRows = [{ sessionId: sidOpen, instanceId: "inst-A", instanceStatus: "live", state: "live", hostKind: "native", operable: true }];
    const applied = applyCatalogueDelta(baseRows, delta);
    assert.equal(applied[0].instanceStatus, "revoked");
    const wrongOriginDelta = {
      ...delta,
      updates: [{ sessionId: sidOpen, instanceId: "inst-OTHER", instanceStatus: "live" }]
    };
    assert.equal(applyCatalogueDelta(applied, wrongOriginDelta)[0].instanceStatus, "revoked", "partial update with mismatched instanceId must be ignored");

    projector.stopWatch();
  } finally {
    cleanupFixture(fx);
  }
});

// ---------------------------------------------------------------------------
// 7. Watch lifecycle, coalescing, async cancel, 65 real reads, bounds & truncation
// ---------------------------------------------------------------------------

test("LH-06 watch lifecycle: 249/250ms coalesce, suspended list + stopWatch, 65 real reads with 0 leaked clients, bounds 512/512/256KiB", async () => {
  const fx = makeFixtureEnv();
  try {
    const T0 = Date.parse("2026-11-21T15:00:00.000Z");
    const clock = new FakeClock(T0);

    // --- Part A: 249/250ms coalescing + suspended list + stopWatch + late response ignored ---
    let pendingListResolve = null;
    let activeMockClients = 0;
    let readCount = 0;

    const messages = [];
    const projector = createCatalogueProjector({
      root: fx.root,
      configDir: fx.explicitConfigDir,
      env: fx.env,
      clock,
      readNativeInventory: async ({ signal }) => {
        readCount += 1;
        if (readCount === 1) {
          return {
            complete: true,
            sessions: [makeNativeSession("h2a-w1", { socketPath: join(fx.runtimeDir, "s1.sock") })]
          };
        }
        if (readCount === 2) {
          activeMockClients += 1;
          return new Promise((resolvePromise, rejectPromise) => {
            const onAbort = () => {
              activeMockClients -= 1;
              rejectPromise(Object.assign(new Error("aborted"), { name: "AbortError" }));
            };
            signal?.addEventListener("abort", onAbort, { once: true });
            pendingListResolve = () => {
              signal?.removeEventListener("abort", onAbort);
              resolvePromise({
                complete: true,
                sessions: [makeNativeSession("h2a-LATE-STALE", { socketPath: join(fx.runtimeDir, "s1.sock") })]
              });
            };
          });
        }
        return {
          complete: true,
          sessions: [makeNativeSession("h2a-w2", { socketPath: join(fx.runtimeDir, "s1.sock") })]
        };
      }
    });

    // Zero catalogue before watch.start
    assert.equal(messages.length, 0);
    projector.startWatch((m) => messages.push(m));
    // Idempotent second startWatch
    projector.startWatch((m) => messages.push(m));
    await clock.flushMicrotasks();
    assert.equal(messages.length, 1);

    // Repeated changes within 250ms fixed window
    writePresenceFile(fx.root, makePresence("P-w1", {
      instance: "inst-w1",
      name: "first-name",
      heartbeatAt: new Date(T0).toISOString(),
      launchContext: { cwd: "/x", command: "claude", nativePty: { session: "h2a-w1" } }
    }));
    projector.setInstanceStatus("inst-w1", "revoked");
    projector.setInstanceStatus("inst-w1", "live");

    // Advance to trigger poll #2 (which suspends!), verify link timer still advances freely
    await clock.advance(2_000);
    assert.equal(readCount, 2);
    assert.equal(activeMockClients, 1);

    let linkTimerFired = false;
    clock.setTimeout(() => { linkTimerFired = true; }, 100);
    await clock.advance(100);
    assert.equal(linkTimerFired, true, "suspended list must not block timers");

    // stopWatch during suspended list cancels emission and closes acquired clients
    projector.stopWatch();
    assert.equal(activeMockClients, 0, "stopWatch must immediately abort & close acquired clients");

    // Restart watch -> emits fresh snapshot for readCount=3
    const beforeRestart = messages.length;
    projector.startWatch((m) => messages.push(m));
    await clock.flushMicrotasks();
    assert.equal(messages.length, beforeRestart + 1);
    assert.equal(messages[messages.length - 1].t, "cat.snapshot");

    // Release late response from cancelled cycle -> MUST NOT publish anything!
    const countBeforeLate = messages.length;
    pendingListResolve?.();
    await clock.advance(500);
    assert.equal(messages.length, countBeforeLate, "late response from cancelled cycle must never publish into new watch");
    assert.equal(
      messages[messages.length - 1].rows.some((r) => r.sessionId === `n-${sha256Hex("h2a-LATE-STALE")}`),
      false
    );
    projector.stopWatch();

    // --- Part B: Real listNativeInventoryForRemote — 65 consecutive reads + partial failure + cancellation -> 0 leaked clients ---
    const sockDir = join(fx.base, "s");
    const sock1 = join(sockDir, "a.sock");
    const sock2 = join(sockDir, "b.sock");
    const srv1 = await startFakeNativeSocketServer(sock1, (req) => {
      if (req.operation === "list") return [makeNativeSession("h2a-real-1", { socketPath: sock1 })];
      return {};
    });
    let holdSecond = false;
    const srv2 = await startFakeNativeSocketServer(sock2, (req) => {
      if (req.operation === "list") {
        if (holdSecond) return "__HOLD__";
        return [makeNativeSession("h2a-real-2", { socketPath: sock2 })];
      }
      return {};
    });

    try {
      for (let i = 0; i < 65; i++) {
        const res = await listNativeInventoryForRemote({
          socketPaths: [sock1, sock2],
          connectTimeoutMs: 250,
          requestTimeoutMs: 250
        });
        assert.equal(res.complete, true, `read #${i + 1} must be complete`);
        assert.equal(res.sessions.length, 2);
      }
      // Wait one tick for socket close events on server side
      await new Promise((r) => setTimeout(r, 30));
      assert.equal(srv1.activeConnections(), 0, "srv1 must have 0 open clients after 65 consecutive inventories");
      assert.equal(srv2.activeConnections(), 0, "srv2 must have 0 open clients after 65 consecutive inventories");

      // Partial inventory (srv2 stalls and times out at 250 ms) -> srv1 client ALSO closed!
      holdSecond = true;
      const partial = await listNativeInventoryForRemote({
        socketPaths: [sock1, sock2],
        connectTimeoutMs: 250,
        requestTimeoutMs: 120
      });
      assert.equal(partial.complete, false, "timeout on second endpoint must yield incomplete inventory");
      await new Promise((r) => setTimeout(r, 30));
      assert.equal(srv1.activeConnections(), 0, "srv1 client must be closed after partial failure on srv2");
      assert.equal(srv2.activeConnections(), 0, "srv2 client must be closed after timeout");

      // Cancellation via AbortSignal during stalled list on srv2 -> returns immediately & 0 open clients
      const ac = new AbortController();
      const cancelPromise = listNativeInventoryForRemote({
        socketPaths: [sock1, sock2],
        connectTimeoutMs: 250,
        requestTimeoutMs: 250,
        signal: ac.signal
      });
      setTimeout(() => ac.abort(), 30);
      await assert.rejects(cancelPromise, (err) => err && (err.name === "AbortError" || err.code === "ABORT_ERR"));
      await new Promise((r) => setTimeout(r, 30));
      assert.equal(srv1.activeConnections(), 0, "srv1 client must be closed after abort");
      assert.equal(srv2.activeConnections(), 0, "srv2 client must be closed after abort");
    } finally {
      await srv1.close();
      await srv2.close();
    }

    // --- Part C: Bounds — 513 rows -> 512 rows, truncatedRows=1, audit event; multi-byte + quotes/backslashes ---
    const audits = [];
    const boundMsgs = [];
    const sessions513 = Array.from({ length: 513 }, (_, idx) =>
      makeNativeSession(`h2a-row-${String(idx).padStart(4, "0")}`, { socketPath: join(fx.runtimeDir, "s1.sock") })
    );
    let activeSessions = sessions513;
    const boundRoot = join(fx.base, "store-bounds");
    mkdirSync(boundRoot, { recursive: true, mode: 0o700 });
    const boundClock = new FakeClock(T0);
    const boundProj = createCatalogueProjector({
      root: boundRoot,
      configDir: fx.explicitConfigDir,
      env: fx.env,
      clock: boundClock,
      onAudit: (ev) => audits.push(ev),
      readNativeInventory: async () => ({ complete: true, sessions: activeSessions })
    });
    boundProj.startWatch((m) => boundMsgs.push(m));
    await boundClock.flushMicrotasks();

    assert.equal(boundMsgs.length, 1);
    const snap512 = boundMsgs[0];
    assert.equal(snap512.t, "cat.snapshot");
    assert.equal(snap512.rows.length, 512, "513 rows must cap to 512 rows");
    assert.equal(snap512.truncatedRows, 1, "513 rows must report truncatedRows=1");
    assert.equal(audits.length, 1);
    assert.equal(audits[0].kind, "catalogue-truncated");
    assert.equal(audits[0].truncatedRows, 1);

    // Trunk provider passage (8 192-byte record cap) reconstructs all 512 rows
    const provider = createFakeCatalogueTrunkProvider({ env: fx.env, maxCatalogueRecordBytes: 8192 });
    const encoded = provider.encodeLogicalSnapshot(snap512, { startS: 1 });
    assert.equal(encoded.ok, true);
    assert.ok(encoded.records.length > 1, "512-row snapshot must split across >1 8192-byte records");
    let reconstructed = [];
    for (const rec of encoded.records) {
      const bytes = Buffer.byteLength(rec.t === "cat.snapshot" ? serializeCatalogueSnapshot(rec) : serializeCatalogueDelta(rec), "utf8");
      assert.ok(bytes <= 8192, `trunk record exceeded 8192 bytes: ${bytes}`);
      reconstructed = rec.t === "cat.snapshot" ? [...rec.rows] : [...applyCatalogueDelta(reconstructed, rec)];
    }
    assert.deepEqual(reconstructed, snap512.rows, "reconstructed rows must match logical snapshot exactly");

    // Multi-byte UTF-8 labels with quotes and backslashes near 512-byte row cap & 256 KiB snapshot cap
    const heavySessions = [];
    for (let i = 0; i < 520; i++) {
      const id = `h2a-heavy-${String(i).padStart(4, "0")}`;
      heavySessions.push(makeNativeSession(id, { socketPath: join(fx.runtimeDir, "s1.sock") }));
      writePresenceFile(boundRoot, makePresence(`P-heavy-${i}`, {
        instance: `inst-heavy-${i}`,
        host: "claude",
        name: `é🚀\\"`.repeat(120),
        workspace: { id: `ws-${i}`, host: "claude", label: `日本語\\"label\\`.repeat(80) },
        heartbeatAt: new Date(boundClock.now()).toISOString(),
        launchContext: { cwd: "/x", command: "claude", nativePty: { session: id } }
      }));
    }
    activeSessions = heavySessions;
    await boundClock.advance(2_250);

    const lastMsg = boundMsgs[boundMsgs.length - 1];
    assert.equal(lastMsg.t, "cat.snapshot", "change in truncatedRows must emit a new snapshot");
    assert.ok(lastMsg.rows.length <= 512);
    assert.equal(lastMsg.rows.length + lastMsg.truncatedRows, 520);
    const totalSnapBytes = Buffer.byteLength(serializeCatalogueSnapshot(lastMsg), "utf8");
    assert.ok(totalSnapBytes <= 262_144, `snapshot exceeded 256 KiB: ${totalSnapBytes}`);
    for (const row of lastMsg.rows) {
      const rowJson = JSON.stringify(row);
      assert.ok(Buffer.byteLength(rowJson, "utf8") <= 512, `row exceeded 512 bytes: ${Buffer.byteLength(rowJson, "utf8")}`);
      // No broken surrogate pairs (every string is well-formed UTF-16)
      if (row.name !== undefined) assert.equal(row.name.isWellFormed(), true, "truncated name must respect code-point boundaries");
      if (row.workspaceLabel !== undefined) assert.equal(row.workspaceLabel.isWellFormed(), true, "truncated workspaceLabel must respect code-point boundaries");
    }
    assert.ok(audits.length >= 2 && audits[audits.length - 1].truncatedRows === lastMsg.truncatedRows);

    // parseCatalogueSnapshot rejects oversized snapshots (>512 rows, >512B row, >262144B snapshot)
    const legacyNoTrunc = JSON.stringify({
      v: 1,
      t: "cat.snapshot",
      ch: 1,
      s: 1,
      at: T0,
      rows: [
        {
          sessionId: "sess-legacy",
          instance: "claude:legacy:1",
          startedAt: "2026-11-21T10:00:00.000Z",
          heartbeatAt: "2026-11-21T10:00:30.000Z",
          state: "live",
          hostKind: "native",
          operable: true
        }
      ]
    });
    const parsedLegacy = parseCatalogueSnapshot(legacyNoTrunc);
    assert.equal(parsedLegacy.truncatedRows, 0, "legacy snapshot without truncatedRows must default to 0");

    const tooManyRows = {
      v: 1, t: "cat.snapshot", ch: 1, s: 1, at: T0, truncatedRows: 0,
      rows: Array.from({ length: 513 }, (_, i) => ({
        sessionId: `n-${String(i).padStart(64, "0")}`,
        state: "running",
        hostKind: "native",
        operable: true
      }))
    };
    assert.throws(() => parseCatalogueSnapshot(JSON.stringify(tooManyRows)), TypeError, "must reject > 512 rows");

    const hugeRow = {
      v: 1, t: "cat.snapshot", ch: 1, s: 1, at: T0, truncatedRows: 0,
      rows: [{
        sessionId: `n-${"a".repeat(64)}`,
        name: "x".repeat(600),
        state: "running",
        hostKind: "native",
        operable: true
      }]
    };
    assert.throws(() => parseCatalogueSnapshot(JSON.stringify(hugeRow)), TypeError, "must reject row > 512 bytes");

    boundProj.stopWatch();
  } finally {
    cleanupFixture(fx);
  }
});
