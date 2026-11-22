// LH-09a remote terminal input, deduplication log, sync replay & terminal-reply filter suite.
// Covers all 24 acceptance cases from LH-09.md (Tranche LH-09a).
// Every case runs under a disposable TMPDIR with isolated HOME/XDG (never /tmp).

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync
} from "node:fs";
import { join, resolve } from "node:path";

import {
  CoalescedRangeIndex,
  createCatalogueProjector,
  createTerminalBridge,
  createTerminalInput,
  createTerminalReplyFilter,
  generateNodeKey,
  isAllowlistedTerminalReply,
  isTrunkRecord,
  nativeCatalogueSid,
  openTerminalInputLog,
  setSessionExcluded,
  TrunkClient
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

  constructor(startMs = Date.parse("2026-11-22T00:00:00.000Z")) {
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

  async flushMicrotasks(rounds = 12) {
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

class SimNativeTerminalRemoteError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "NativeTerminalRemoteError";
    this.code = code;
  }
}

function makeIsolation() {
  assert.ok(process.env.TMPDIR && resolve(process.env.TMPDIR) !== "/tmp", "Supply a disposable TMPDIR");
  const base = mkdtempSync(join(process.env.TMPDIR, "lh09-"));
  const root = join(base, "root");
  const xdgConfigHome = join(base, "config");
  const configDir = join(xdgConfigHome, "sentropic", "h2a");
  const home = join(base, "home");
  const runtimeDir = join(base, "run");
  for (const dir of [root, configDir, home, runtimeDir]) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  const env = {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    HOME: home,
    TMPDIR: process.env.TMPDIR,
    TMP: process.env.TMPDIR,
    TEMP: process.env.TMPDIR,
    XDG_CONFIG_HOME: xdgConfigHome,
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

function makeSimHost(options = {}) {
  const sessions = new Map();
  const calls = {
    acquire: [],
    write: [],
    resize: [],
    release: [],
    state: [],
    stopIfIncarnation: [],
    portCloseCount: 0,
    portConnectCount: 0
  };
  let nextAttachHold = null;
  let nextWriteBehavior = null; // () => Promise<void> | void
  let nextAcquireOverride = null;
  let nextStateOverride = null;

  function setSession(id, data = {}) {
    sessions.set(id, {
      id,
      generation: data.generation ?? "gen-1",
      incarnation: data.incarnation ?? "inc-1",
      pid: data.pid ?? 55000,
      cols: data.cols ?? 80,
      rows: data.rows ?? 24,
      status: data.status ?? "running",
      chunks: data.chunks ?? [],
      exit: data.exit ?? null,
      stopSignal: data.stopSignal ?? null,
      controlled: data.controlled ?? false,
      holderKind: data.holderKind ?? "none",
      controllerId: data.controllerId ?? null,
      controllerEpoch: data.controllerEpoch ?? 0,
      lastHumanActivityAt: data.lastHumanActivityAt ?? null
    });
  }

  function snapshotState(s) {
    const latestSeq = s.chunks.length > 0 ? s.chunks[s.chunks.length - 1].seq : 0;
    return {
      id: s.id,
      generation: s.generation,
      incarnation: s.incarnation,
      pid: s.pid,
      cols: s.cols,
      rows: s.rows,
      status: s.status,
      latestSeq,
      exit: s.exit,
      stopSignal: s.stopSignal,
      controlled: s.controlled,
      holderKind: s.holderKind,
      controllerEpoch: s.controllerEpoch,
      lastHumanActivityAt: s.lastHumanActivityAt
    };
  }

  function inventory() {
    return {
      complete: true,
      sessions: [...sessions.values()].map((s) => ({
        id: s.id,
        socketPath: options.socketPath ?? "/sim/native.sock",
        generation: s.generation,
        incarnation: s.incarnation,
        status: s.status,
        cols: s.cols,
        rows: s.rows,
        holderKind: s.holderKind,
        controllerEpoch: s.controllerEpoch
      }))
    };
  }

  function holdNextAttach() {
    let release;
    const p = new Promise((r) => {
      release = r;
    });
    nextAttachHold = p;
    return () => release();
  }

  function setNextWriteBehavior(fn) {
    nextWriteBehavior = fn;
  }

  function setNextAcquireOverride(fn) {
    nextAcquireOverride = fn;
  }

  function setNextStateOverride(fn) {
    nextStateOverride = fn;
  }

  async function connectObserverClient() {
    let closed = false;
    return {
      async attachObserver(id) {
        if (nextAttachHold) {
          const h = nextAttachHold;
          nextAttachHold = null;
          await h;
        }
        if (closed) throw new Error("closed");
        const s = sessions.get(id);
        if (!s) throw new SimNativeTerminalRemoteError("operation-failed", `unknown terminal session: ${id}`);
        return {
          role: "observer",
          id: s.id,
          generation: s.generation,
          incarnation: s.incarnation,
          controllerEpoch: s.controllerEpoch
        };
      },
      async state(id) {
        if (closed) throw new Error("closed");
        const s = sessions.get(id);
        if (!s) throw new SimNativeTerminalRemoteError("operation-failed", `unknown terminal session: ${id}`);
        return snapshotState(s);
      },
      async readOutput(id, afterSeq) {
        if (closed) throw new Error("closed");
        const s = sessions.get(id);
        if (!s) throw new SimNativeTerminalRemoteError("operation-failed", `unknown terminal session: ${id}`);
        const latestSeq = s.chunks.length > 0 ? s.chunks[s.chunks.length - 1].seq : 0;
        return {
          generation: s.generation,
          incarnation: s.incarnation,
          chunks: s.chunks.filter((c) => c.seq > afterSeq),
          gap: null,
          latestSeq,
          state: snapshotState(s)
        };
      },
      close() {
        closed = true;
      }
    };
  }

  async function connectControlPort() {
    calls.portConnectCount += 1;
    let closed = false;
    const ownedLeases = new Map();
    const port = {
      get closed() {
        return closed;
      },
      async acquire(id, controllerId, activityWindowMs) {
        if (closed) throw new Error("control port closed");
        calls.acquire.push({ id, controllerId, activityWindowMs });
        if (nextAcquireOverride) {
          const fn = nextAcquireOverride;
          nextAcquireOverride = null;
          return fn({ id, controllerId, activityWindowMs, sessions, ownedLeases });
        }
        const s = sessions.get(id);
        if (!s) throw new SimNativeTerminalRemoteError("operation-failed", `unknown terminal session: ${id}`);
        if (s.holderKind === "automation") {
          return { granted: false, reason: "held-by-automation", controllerEpoch: s.controllerEpoch };
        }
        if (s.holderKind === "remote" && s.controllerId !== controllerId) {
          return { granted: false, reason: "held-by-remote", controllerEpoch: s.controllerEpoch };
        }
        if (s.holderKind === "remote" && s.controllerId === controllerId) {
          return { granted: false, reason: "already-held", controllerEpoch: s.controllerEpoch };
        }
        if (s.holderKind === "human" && s.lastHumanActivityAt !== null) {
          return { granted: false, reason: "recent-human", controllerEpoch: s.controllerEpoch };
        }
        s.controllerEpoch += 1;
        s.controlled = true;
        s.holderKind = "remote";
        s.controllerId = controllerId;
        const lease = {
          role: "controller",
          id: s.id,
          generation: s.generation,
          incarnation: s.incarnation,
          controllerId,
          epoch: s.controllerEpoch
        };
        ownedLeases.set(s.id, lease);
        return { granted: true, lease };
      },
      async write(lease, data) {
        if (closed) throw new Error("control port closed");
        calls.write.push({ id: lease.id, epoch: lease.epoch, data });
        if (nextWriteBehavior) {
          const fn = nextWriteBehavior;
          nextWriteBehavior = null;
          await fn({ lease, data, sessions, port });
          return;
        }
        const s = sessions.get(lease.id);
        if (!s || s.holderKind !== "remote" || s.controllerEpoch !== lease.epoch) {
          throw new SimNativeTerminalRemoteError("operation-failed", "controller lease is stale");
        }
      },
      async resize(lease, cols, rows) {
        if (closed) throw new Error("control port closed");
        calls.resize.push({ lease, cols, rows });
      },
      async release(lease) {
        if (closed) throw new Error("control port closed");
        calls.release.push({ id: lease.id, epoch: lease.epoch });
        ownedLeases.delete(lease.id);
        const s = sessions.get(lease.id);
        if (s && s.holderKind === "remote" && s.controllerEpoch === lease.epoch) {
          s.controlled = false;
          s.holderKind = "none";
          s.controllerId = null;
        }
        return { controlled: false };
      },
      async state(id) {
        if (closed) throw new Error("control port closed");
        calls.state.push(id);
        if (nextStateOverride) {
          const fn = nextStateOverride;
          nextStateOverride = null;
          return fn(id, sessions);
        }
        const s = sessions.get(id);
        if (!s) throw new SimNativeTerminalRemoteError("operation-failed", `unknown terminal session: ${id}`);
        return snapshotState(s);
      },
      async stopIfIncarnation(id, generation, incarnation) {
        if (closed) throw new Error("control port closed");
        calls.stopIfIncarnation.push({ id, generation, incarnation });
        const s = sessions.get(id);
        if (!s) throw new SimNativeTerminalRemoteError("operation-failed", `unknown terminal session: ${id}`);
        return snapshotState(s);
      },
      close() {
        if (closed) return;
        closed = true;
        calls.portCloseCount += 1;
        for (const lease of ownedLeases.values()) {
          const s = sessions.get(lease.id);
          if (s && s.holderKind === "remote" && s.controllerEpoch === lease.epoch) {
            s.controlled = false;
            s.holderKind = "none";
            s.controllerId = null;
          }
        }
        ownedLeases.clear();
      }
    };
    return port;
  }

  return {
    sessions,
    calls,
    setSession,
    inventory,
    holdNextAttach,
    setNextWriteBehavior,
    setNextAcquireOverride,
    setNextStateOverride,
    connectObserverClient,
    connectControlPort
  };
}

function setupStack(iso, host, clock, opts = {}) {
  const key = opts.key ?? generateNodeKey({ configDir: iso.configDir, env: iso.env });
  const contract = createSimulatedTrunkContractProvider();
  const peer = new FakeBinaryTrunkPeer({
    meshId: MESH,
    tenantId: TENANT,
    endpoint: ENDPOINT,
    clock,
    env: iso.env,
    contract
  });
  const enrolmentRef = opts.enrolmentRef ?? "enr-lh09";
  peer.registerEnrolment({
    nodeId: key.nodeId,
    enrolmentRef,
    publicKeyPem: key.publicKeyPem,
    fingerprint: key.fingerprint
  });
  const projector = createCatalogueProjector({
    root: iso.root,
    configDir: iso.configDir,
    env: iso.env,
    clock,
    readNativeInventory: async () => host.inventory(),
    readPresences: () => []
  });
  const scope = `${MESH}|${TENANT}|${enrolmentRef}|${key.nodeId}`;
  const inputAudits = [];
  const input = opts.omitInput
    ? undefined
    : createTerminalInput({
        root: iso.root,
        scope,
        clock,
        ...(opts.omitPortFactory ? {} : { connectControlPort: host.connectControlPort }),
        ...(opts.isKilled ? { isKilled: opts.isKilled } : {}),
        env: iso.env,
        withShareAllowed: projector.withShareAllowed,
        onAudit: (ev) => inputAudits.push(ev)
      });
  const bridge = createTerminalBridge({
    catalogue: projector,
    clock,
    rangeIndex: new CoalescedRangeIndex(),
    connectNativeClient: host.connectObserverClient,
    ...(input ? { input } : {})
  });
  const client = new TrunkClient({
    root: iso.root,
    env: iso.env,
    enrolment: {
      meshId: MESH,
      endpoint: ENDPOINT,
      tenantId: TENANT,
      enrolmentRef,
      nodeId: key.nodeId
    },
    nodeKeyOptions: { configDir: iso.configDir, env: iso.env },
    connector: peer.createConnector("lh09-client"),
    contract,
    clock,
    catalogue: projector,
    terminalConsumer: bridge
  });
  const startRes = client.start();
  assert.equal(startRes.ok, true);
  const conn = peer.allConnections()[0];
  return { key, contract, peer, projector, scope, input, inputAudits, bridge, client, conn, enrolmentRef };
}

async function openAndAttachSession(stack, clock, nativeId, ch = 2) {
  stack.peer.sendWatchStart(stack.conn);
  await clock.advance(10);
  const sid = nativeCatalogueSid(nativeId);
  stack.peer.sendTermOpen(stack.conn, { ch, sid, mode: "observe", afterSeq: null, receivedSegBytes: 0 });
  stack.peer.sendCredit(stack.conn, ch, {
    receivedThroughSeq: 0,
    receivedThroughBytes: 0,
    sendLimitSeq: 8,
    sendLimitBytes: 131_072
  });
  await clock.advance(20);
  return sid;
}

function collectChannelRecords(conn, ch, startIdx = 0) {
  const out = [];
  for (let i = startIdx; i < conn.decodedClientRecords.length; i++) {
    const r = conn.decodedClientRecords[i];
    if (r.ch === ch) out.push(r);
  }
  return { records: out, nextIdx: conn.decodedClientRecords.length };
}

function b64(s) {
  return Buffer.from(s, "utf8").toString("base64");
}

function logFileFor(root, scope, sid, generation = "gen-1", incarnation = "inc-1") {
  const a = createHash("sha256").update(`${scope}\n${sid}`).digest("hex").slice(0, 32);
  const b = createHash("sha256").update(`${generation}\n${incarnation}`).digest("hex").slice(0, 32);
  return join(root, "remote-control", "input-log", `${a}.${b}.jsonl`);
}

async function acquireLease(stack, clock, sid, ch = 2, generation = "gen-1", incarnation = "inc-1") {
  const cursor = stack.conn.decodedClientRecords.length;
  stack.peer.sendRecord(stack.conn, { t: "term.ctl", ch, sid, generation, incarnation, action: "acquire" });
  await clock.advance(10);
  const { records } = collectChannelRecords(stack.conn, ch, cursor);
  const granted = records.find((r) => r.t === "term.ctl.state" && r.state === "granted");
  assert.ok(granted, `expected granted on ch=${ch}, got ${JSON.stringify(records)}`);
  return granted.epoch;
}

// ============================================================================
// 1. Types du fil (+ cas inverses de l'étape 11)
// ============================================================================

test("LH-09a #1: Types du fil — missing new fields close link on invalid-record; valid term.in.sync reaches bridge", async () => {
  const iso = makeIsolation();
  try {
    const clock = new AsyncFakeClock();
    const host = makeSimHost();
    host.setSession("h2a-t1");

    // 1a. term.in without ackThrough -> invalid-record closes link
    {
      const stack = setupStack(iso, host, clock);
      const sid = await openAndAttachSession(stack, clock, "h2a-t1", 2);
      stack.peer.sendRecord(stack.conn, {
        t: "term.in",
        ch: 2,
        sid,
        generation: "gen-1",
        incarnation: "inc-1",
        epoch: 1,
        inSeq: 1,
        origin: "user",
        dataB64: b64("a")
      });
      await clock.flushMicrotasks();
      assert.equal(stack.conn.closed, true, "term.in without ackThrough must close link");
      assert.equal(stack.conn.closeReason, "invalid-record");
      stack.bridge.dispose();
      stack.projector.stopWatch();
      stack.client.stop();
    }

    // 1b. term.ctl without generation/incarnation, term.ctl release without epoch, term.stop without generation -> invalid-record
    for (const badRec of [
      { t: "term.ctl", ch: 2, action: "acquire" },
      { t: "term.ctl", ch: 2, generation: "gen-1", incarnation: "inc-1", action: "release" },
      { t: "term.stop", ch: 2, incarnation: "inc-1" }
    ]) {
      const stack = setupStack(iso, host, clock);
      const sid = await openAndAttachSession(stack, clock, "h2a-t1", 2);
      stack.peer.sendRecord(stack.conn, { ...badRec, sid });
      await clock.flushMicrotasks();
      assert.equal(stack.conn.closed, true, `${badRec.t} missing required field must close link`);
      assert.equal(stack.conn.closeReason, "invalid-record");
      stack.bridge.dispose();
      stack.projector.stopWatch();
      stack.client.stop();
    }

    // 1c. Valid term.in.sync is accepted by types and forwarded to bridge (link stays open)
    {
      const stack = setupStack(iso, host, clock);
      const sid = await openAndAttachSession(stack, clock, "h2a-t1", 2);
      const cursor = stack.conn.decodedClientRecords.length;
      stack.peer.sendRecord(stack.conn, {
        t: "term.in.sync",
        ch: 2,
        sid,
        generation: "gen-1",
        incarnation: "inc-1",
        epoch: 1,
        lastAckedInSeq: 0
      });
      await clock.flushMicrotasks();
      assert.equal(stack.conn.closed, false, "valid term.in.sync must not close link");
      const { records } = collectChannelRecords(stack.conn, 2, cursor);
      assert.equal(records.some((r) => r.t === "err" && r.code === "stale-epoch"), true);
      stack.bridge.dispose();
      stack.projector.stopWatch();
      stack.client.stop();
    }
  } finally {
    cleanup(iso);
  }
});

// ============================================================================
// 2 & 3 & 4: Une seule écriture, Doublon, Redémarrage
// ============================================================================

test("LH-09a #2/#3/#4: Une seule écriture, Doublon, Redémarrage", async () => {
  const iso = makeIsolation();
  try {
    const clock = new AsyncFakeClock();
    const host = makeSimHost();
    host.setSession("h2a-w1");
    const key = generateNodeKey({ configDir: iso.configDir, env: iso.env });

    let epoch1;
    let sid;
    let scope;
    {
      const stack = setupStack(iso, host, clock, { key });
      scope = stack.scope;
      sid = await openAndAttachSession(stack, clock, "h2a-w1", 2);
      epoch1 = await acquireLease(stack, clock, sid, 2);

      // #2 Une seule écriture: inSeq 1..3
      const cursor = stack.conn.decodedClientRecords.length;
      for (let i = 1; i <= 3; i++) {
        stack.peer.sendRecord(stack.conn, {
          t: "term.in",
          ch: 2,
          sid,
          generation: "gen-1",
          incarnation: "inc-1",
          epoch: epoch1,
          inSeq: i,
          ackThrough: 0,
          origin: "user",
          dataB64: b64(`cmd-${i}\n`)
        });
      }
      await clock.advance(10);
      assert.deepEqual(
        host.calls.write.map((w) => w.data),
        ["cmd-1\n", "cmd-2\n", "cmd-3\n"]
      );
      const { records } = collectChannelRecords(stack.conn, 2, cursor);
      const acks = records.filter((r) => r.t === "term.in.ack");
      assert.deepEqual(
        acks.map((a) => ({ inSeq: a.inSeq, result: a.result, hasSid: "sid" in a })),
        [
          { inSeq: 1, result: "applied", hasSid: false },
          { inSeq: 2, result: "applied", hasSid: false },
          { inSeq: 3, result: "applied", hasSid: false }
        ]
      );

      // #3 Doublon: resend inSeq 2 -> 0 host writes, same ack
      const cursorDup = stack.conn.decodedClientRecords.length;
      stack.peer.sendRecord(stack.conn, {
        t: "term.in",
        ch: 2,
        sid,
        generation: "gen-1",
        incarnation: "inc-1",
        epoch: epoch1,
        inSeq: 2,
        ackThrough: 0,
        origin: "user",
        dataB64: b64("cmd-2\n")
      });
      await clock.advance(10);
      assert.equal(host.calls.write.length, 3, "duplicate inSeq 2 must not call host");
      const dupRecs = collectChannelRecords(stack.conn, 2, cursorDup).records;
      assert.deepEqual(dupRecs.filter((r) => r.t === "term.in.ack"), [
        { v: 1, t: "term.in.ack", ch: 2, s: dupRecs[0].s, inSeq: 2, result: "applied" }
      ]);

      // Simulate sudden agent crash (do NOT call client.stop() / bridge.dispose(),
      // so the open epoch is left unclosed in the log on disk).
      stack.projector.stopWatch();
    }

    // #4 Redémarrage: recreate module on same root with a fresh clock
    {
      const clock2 = new AsyncFakeClock(clock.now() + 100);
      const host2 = makeSimHost();
      host2.setSession("h2a-w1");
      const stack2 = setupStack(iso, host2, clock2, { key });
      await openAndAttachSession(stack2, clock2, "h2a-w1", 2);

      // Resend inSeq 2 via term.in -> stale-epoch, zero writes
      const curIn = stack2.conn.decodedClientRecords.length;
      stack2.peer.sendRecord(stack2.conn, {
        t: "term.in",
        ch: 2,
        sid,
        generation: "gen-1",
        incarnation: "inc-1",
        epoch: epoch1,
        inSeq: 2,
        ackThrough: 0,
        origin: "user",
        dataB64: b64("cmd-2\n")
      });
      await clock2.advance(10);
      assert.equal(host2.calls.write.length, 0);
      const inRecs = collectChannelRecords(stack2.conn, 2, curIn).records;
      assert.equal(inRecs[0]?.t, "term.in.ack");
      assert.equal(inRecs[0]?.result, "refused");
      assert.equal(inRecs[0]?.reason, "stale-epoch");

      // term.in.sync replays the 3 results, then term.in.synced(evicted: false), then term.ctl.state(lost-link)
      const curSync = stack2.conn.decodedClientRecords.length;
      stack2.peer.sendRecord(stack2.conn, {
        t: "term.in.sync",
        ch: 2,
        sid,
        generation: "gen-1",
        incarnation: "inc-1",
        epoch: epoch1,
        lastAckedInSeq: 0
      });
      await clock2.advance(10);
      assert.equal(host2.calls.write.length, 0);
      const syncRecs = collectChannelRecords(stack2.conn, 2, curSync).records;
      assert.deepEqual(
        syncRecs.map((r) => ({ t: r.t, inSeq: r.inSeq, result: r.result, state: r.state, evicted: r.evicted, syncedThroughInSeq: r.syncedThroughInSeq })),
        [
          { t: "term.in.ack", inSeq: 1, result: "applied", state: undefined, evicted: undefined, syncedThroughInSeq: undefined },
          { t: "term.in.ack", inSeq: 2, result: "applied", state: undefined, evicted: undefined, syncedThroughInSeq: undefined },
          { t: "term.in.ack", inSeq: 3, result: "applied", state: undefined, evicted: undefined, syncedThroughInSeq: undefined },
          { t: "term.in.synced", inSeq: undefined, result: undefined, state: undefined, evicted: false, syncedThroughInSeq: 3 },
          { t: "term.ctl.state", inSeq: undefined, result: undefined, state: "lost-link", evicted: undefined, syncedThroughInSeq: undefined }
        ]
      );
      assert.ok(existsSync(logFileFor(iso.root, scope, sid)));
      stack2.bridge.dispose();
      stack2.projector.stopWatch();
      stack2.client.stop();
    }
  } finally {
    cleanup(iso);
  }
});

// ============================================================================
// 5. Résultat incertain (+ crash entre écriture uncertain et réponse)
// ============================================================================

test("LH-09a #5: Résultat incertain — no-response closes epoch released, replays uncertain, crash preserves uncertain", async () => {
  const iso = makeIsolation();
  try {
    const clock = new AsyncFakeClock();
    const host = makeSimHost();
    host.setSession("h2a-unc");
    const key = generateNodeKey({ configDir: iso.configDir, env: iso.env });

    // 5a: write rejects with non-NativeTerminalRemoteError (timeout / broken socket)
    let epoch1;
    let sid;
    let scope;
    {
      const stack = setupStack(iso, host, clock, { key });
      scope = stack.scope;
      sid = await openAndAttachSession(stack, clock, "h2a-unc", 2);
      epoch1 = await acquireLease(stack, clock, sid, 2);

      // inSeq 1..3 applied
      for (let i = 1; i <= 3; i++) {
        stack.peer.sendRecord(stack.conn, {
          t: "term.in", ch: 2, sid, generation: "gen-1", incarnation: "inc-1",
          epoch: epoch1, inSeq: i, ackThrough: 0, origin: "user", dataB64: b64(`x${i}`)
        });
      }
      await clock.advance(10);

      // inSeq 4: host does not respond (connection broken)
      const portClosesBefore = host.calls.portCloseCount;
      host.setNextWriteBehavior(async () => {
        throw new Error("terminal host connection closed");
      });
      const cur4 = stack.conn.decodedClientRecords.length;
      stack.peer.sendRecord(stack.conn, {
        t: "term.in", ch: 2, sid, generation: "gen-1", incarnation: "inc-1",
        epoch: epoch1, inSeq: 4, ackThrough: 3, origin: "user", dataB64: b64("rm -rf\n")
      });
      await clock.advance(10);

      const recs4 = collectChannelRecords(stack.conn, 2, cur4).records;
      assert.equal(recs4.some((r) => r.t === "term.in.ack" && r.inSeq === 4 && r.result === "uncertain"), true);
      assert.equal(recs4.some((r) => r.t === "term.ctl.state" && r.state === "released" && r.epoch === epoch1), true);
      assert.equal(host.calls.portCloseCount, portClosesBefore + 1, "control port must be closed immediately");

      // Resend inSeq 4 via term.in -> stale-epoch, zero writes
      const writesBefore = host.calls.write.length;
      const curResend = stack.conn.decodedClientRecords.length;
      stack.peer.sendRecord(stack.conn, {
        t: "term.in", ch: 2, sid, generation: "gen-1", incarnation: "inc-1",
        epoch: epoch1, inSeq: 4, ackThrough: 3, origin: "user", dataB64: b64("rm -rf\n")
      });
      await clock.advance(10);
      assert.equal(host.calls.write.length, writesBefore);
      const resendRecs = collectChannelRecords(stack.conn, 2, curResend).records;
      assert.equal(resendRecs[0]?.result, "refused");
      assert.equal(resendRecs[0]?.reason, "stale-epoch");

      // term.in.sync replays uncertain
      const curSync = stack.conn.decodedClientRecords.length;
      stack.peer.sendRecord(stack.conn, {
        t: "term.in.sync", ch: 2, sid, generation: "gen-1", incarnation: "inc-1",
        epoch: epoch1, lastAckedInSeq: 3
      });
      await clock.advance(10);
      const syncRecs = collectChannelRecords(stack.conn, 2, curSync).records;
      assert.equal(syncRecs[0]?.t, "term.in.ack");
      assert.equal(syncRecs[0]?.inSeq, 4);
      assert.equal(syncRecs[0]?.result, "uncertain");
      assert.equal(syncRecs[1]?.t, "term.in.synced");

      stack.bridge.dispose();
      stack.projector.stopWatch();
      stack.client.stop();
    }

    // 5b: kill/abandon module between uncertain log write and host response
    {
      const clock5b = new AsyncFakeClock(clock.now() + 100);
      const stack = setupStack(iso, host, clock5b, { key });
      await openAndAttachSession(stack, clock5b, "h2a-unc", 2);
      const epoch2 = await acquireLease(stack, clock5b, sid, 2);

      let resolveHangingWrite;
      host.setNextWriteBehavior(() => new Promise((r) => { resolveHangingWrite = r; }));
      stack.peer.sendRecord(stack.conn, {
        t: "term.in", ch: 2, sid, generation: "gen-1", incarnation: "inc-1",
        epoch: epoch2, inSeq: 1, ackThrough: 0, origin: "user", dataB64: b64("crash-in-flight")
      });
      await clock5b.flushMicrotasks();
      assert.ok(resolveHangingWrite, "write must be in-flight after uncertain disk sync");

      // Abandon old module (simulate process kill before write resolves)
      stack.projector.stopWatch();

      // Reopen log directly & via fresh module
      const log = openTerminalInputLog(iso.root, scope, sid, "gen-1", "inc-1");
      assert.equal(log.epochStatus(epoch2).status, "ended");
      const replay = log.replayAfter(epoch2, 0);
      assert.deepEqual(replay.entries, [{ inSeq: 1, result: "uncertain" }]);
    }
  } finally {
    cleanup(iso);
  }
});

// ============================================================================
// 6. Refus puis nouvel essai
// ============================================================================

test("LH-09a #6: Refus puis nouvel essai — killed stores refusal on inSeq 5, lifts kill, inSeq 6 applies", async () => {
  const iso = makeIsolation();
  try {
    const clock = new AsyncFakeClock();
    const host = makeSimHost();
    host.setSession("h2a-k");
    let killed = false;
    const stack = setupStack(iso, host, clock, { isKilled: () => killed });
    const sid = await openAndAttachSession(stack, clock, "h2a-k", 2);
    const epoch = await acquireLease(stack, clock, sid, 2);

    killed = true;
    const cur5 = stack.conn.decodedClientRecords.length;
    stack.peer.sendRecord(stack.conn, {
      t: "term.in", ch: 2, sid, generation: "gen-1", incarnation: "inc-1",
      epoch, inSeq: 5, ackThrough: 0, origin: "user", dataB64: b64("nope")
    });
    // Wait — inSeq 5 before 1..4 would be out-of-order! Let's send 1..4 first so 5 is nextInSeq!
    await clock.advance(10);
    // Actually let's check: the plan says "Les numéros d'inSeq cités sont propres à l'épreuve."
    // Let's send 1..4 when killed=false, then killed=true for 5!
    assert.equal(collectChannelRecords(stack.conn, 2, cur5).records[0]?.reason, "out-of-order");

    killed = false;
    for (let i = 1; i <= 4; i++) {
      stack.peer.sendRecord(stack.conn, {
        t: "term.in", ch: 2, sid, generation: "gen-1", incarnation: "inc-1",
        epoch, inSeq: i, ackThrough: 0, origin: "user", dataB64: b64(`ok${i}`)
      });
    }
    await clock.advance(10);
    const writesAt4 = host.calls.write.length;
    assert.equal(writesAt4, 4);

    killed = true;
    const cur5k = stack.conn.decodedClientRecords.length;
    stack.peer.sendRecord(stack.conn, {
      t: "term.in", ch: 2, sid, generation: "gen-1", incarnation: "inc-1",
      epoch, inSeq: 5, ackThrough: 4, origin: "user", dataB64: b64("blocked")
    });
    await clock.advance(10);
    assert.equal(stack.conn.closed, false, "link stays open on killed input refusal");
    assert.equal(host.calls.write.length, writesAt4);
    assert.deepEqual(
      collectChannelRecords(stack.conn, 2, cur5k).records.map((r) => ({ inSeq: r.inSeq, result: r.result, reason: r.reason })),
      [{ inSeq: 5, result: "refused", reason: "killed" }]
    );

    // Lift kill, resend 5 -> still refused killed from log! Then send 6 -> applied once.
    killed = false;
    const cur5r = stack.conn.decodedClientRecords.length;
    stack.peer.sendRecord(stack.conn, {
      t: "term.in", ch: 2, sid, generation: "gen-1", incarnation: "inc-1",
      epoch, inSeq: 5, ackThrough: 4, origin: "user", dataB64: b64("blocked")
    });
    stack.peer.sendRecord(stack.conn, {
      t: "term.in", ch: 2, sid, generation: "gen-1", incarnation: "inc-1",
      epoch, inSeq: 6, ackThrough: 4, origin: "user", dataB64: b64("after-lift")
    });
    await clock.advance(10);
    assert.equal(host.calls.write.length, 5);
    assert.equal(host.calls.write[4].data, "after-lift");
    assert.deepEqual(
      collectChannelRecords(stack.conn, 2, cur5r).records.map((r) => ({ inSeq: r.inSeq, result: r.result, reason: r.reason })),
      [
        { inSeq: 5, result: "refused", reason: "killed" },
        { inSeq: 6, result: "applied", reason: undefined }
      ]
    );

    stack.bridge.dispose();
    stack.projector.stopWatch();
    stack.client.stop();
  } finally {
    cleanup(iso);
  }
});

// ============================================================================
// 7. Ordre
// ============================================================================

test("LH-09a #7: Ordre — ahead inSeq refused out-of-order without storing, then in-order applies", async () => {
  const iso = makeIsolation();
  try {
    const clock = new AsyncFakeClock();
    const host = makeSimHost();
    host.setSession("h2a-ord");
    const stack = setupStack(iso, host, clock);
    const sid = await openAndAttachSession(stack, clock, "h2a-ord", 2);
    const epoch = await acquireLease(stack, clock, sid, 2);

    for (let i = 1; i <= 6; i++) {
      stack.peer.sendRecord(stack.conn, {
        t: "term.in", ch: 2, sid, generation: "gen-1", incarnation: "inc-1",
        epoch, inSeq: i, ackThrough: 6, origin: "user", dataB64: b64(`p${i}`)
      });
    }
    await clock.advance(10);

    // 8 arrives before 7
    const cur8 = stack.conn.decodedClientRecords.length;
    stack.peer.sendRecord(stack.conn, {
      t: "term.in", ch: 2, sid, generation: "gen-1", incarnation: "inc-1",
      epoch, inSeq: 8, ackThrough: 6, origin: "user", dataB64: b64("eight")
    });
    await clock.advance(10);
    assert.equal(host.calls.write.length, 6);
    assert.deepEqual(
      collectChannelRecords(stack.conn, 2, cur8).records.map((r) => ({ inSeq: r.inSeq, result: r.result, reason: r.reason })),
      [{ inSeq: 8, result: "refused", reason: "out-of-order" }]
    );

    // Now 7 then 8
    const cur78 = stack.conn.decodedClientRecords.length;
    stack.peer.sendRecord(stack.conn, {
      t: "term.in", ch: 2, sid, generation: "gen-1", incarnation: "inc-1",
      epoch, inSeq: 7, ackThrough: 6, origin: "user", dataB64: b64("seven")
    });
    stack.peer.sendRecord(stack.conn, {
      t: "term.in", ch: 2, sid, generation: "gen-1", incarnation: "inc-1",
      epoch, inSeq: 8, ackThrough: 6, origin: "user", dataB64: b64("eight")
    });
    await clock.advance(10);
    assert.deepEqual(host.calls.write.slice(6).map((w) => w.data), ["seven", "eight"]);
    assert.deepEqual(
      collectChannelRecords(stack.conn, 2, cur78).records.map((r) => ({ inSeq: r.inSeq, result: r.result })),
      [
        { inSeq: 7, result: "applied" },
        { inSeq: 8, result: "applied" }
      ]
    );

    stack.bridge.dispose();
    stack.projector.stopWatch();
    stack.client.stop();
  } finally {
    cleanup(iso);
  }
});

// ============================================================================
// 8. Rejeu, époque active
// ============================================================================

test("LH-09a #8: Rejeu, époque active — sync replays 2..4, syncedThroughInSeq=4, evicted=false, acked leaves unacked zone", async () => {
  const iso = makeIsolation();
  try {
    const clock = new AsyncFakeClock();
    const host = makeSimHost();
    host.setSession("h2a-ra");
    const stack = setupStack(iso, host, clock);
    const sid = await openAndAttachSession(stack, clock, "h2a-ra", 2);
    const epoch = await acquireLease(stack, clock, sid, 2);

    for (let i = 1; i <= 4; i++) {
      stack.peer.sendRecord(stack.conn, {
        t: "term.in", ch: 2, sid, generation: "gen-1", incarnation: "inc-1",
        epoch, inSeq: i, ackThrough: 0, origin: "user", dataB64: b64(`a${i}`)
      });
    }
    await clock.advance(10);
    const writesBefore = host.calls.write.length;

    const cur = stack.conn.decodedClientRecords.length;
    stack.peer.sendRecord(stack.conn, {
      t: "term.in.sync", ch: 2, sid, generation: "gen-1", incarnation: "inc-1",
      epoch, lastAckedInSeq: 1
    });
    await clock.advance(10);
    assert.equal(host.calls.write.length, writesBefore, "zero host calls during term.in.sync");
    const recs = collectChannelRecords(stack.conn, 2, cur).records;
    assert.deepEqual(
      recs.map((r) => ({ t: r.t, inSeq: r.inSeq, result: r.result, syncedThroughInSeq: r.syncedThroughInSeq, evicted: r.evicted })),
      [
        { t: "term.in.ack", inSeq: 2, result: "applied", syncedThroughInSeq: undefined, evicted: undefined },
        { t: "term.in.ack", inSeq: 3, result: "applied", syncedThroughInSeq: undefined, evicted: undefined },
        { t: "term.in.ack", inSeq: 4, result: "applied", syncedThroughInSeq: undefined, evicted: undefined },
        { t: "term.in.synced", inSeq: undefined, result: undefined, syncedThroughInSeq: 4, evicted: false }
      ]
    );
    const log = stack.input.getLog(sid, "gen-1", "inc-1");
    assert.ok(log);
    assert.equal(log.epochStatus(epoch).maxAckedInSeq, 1);
    assert.equal(log.activeUnackedCount(), 3);

    stack.bridge.dispose();
    stack.projector.stopWatch();
    stack.client.stop();
  } finally {
    cleanup(iso);
  }
});

// ============================================================================
// 9. Rejeu, époque close
// ============================================================================

test("LH-09a #9: Rejeu, époque close — taken-back replay, second sync prunes all entries, third still returns evicted=false & taken-back", async () => {
  const iso = makeIsolation();
  try {
    const clock = new AsyncFakeClock();
    const host = makeSimHost();
    host.setSession("h2a-rc");
    const stack = setupStack(iso, host, clock);
    const sid = await openAndAttachSession(stack, clock, "h2a-rc", 2);
    const epoch = await acquireLease(stack, clock, sid, 2);

    stack.peer.sendRecord(stack.conn, {
      t: "term.in", ch: 2, sid, generation: "gen-1", incarnation: "inc-1",
      epoch, inSeq: 1, ackThrough: 0, origin: "user", dataB64: b64("ok")
    });
    await clock.advance(10);

    // Close epoch with taken-back via write error + human holder
    host.setNextWriteBehavior(async ({ sessions }) => {
      const s = sessions.get("h2a-rc");
      s.holderKind = "human";
      s.controllerEpoch += 1;
      throw new SimNativeTerminalRemoteError("operation-failed", "stale lease");
    });
    stack.peer.sendRecord(stack.conn, {
      t: "term.in", ch: 2, sid, generation: "gen-1", incarnation: "inc-1",
      epoch, inSeq: 2, ackThrough: 0, origin: "user", dataB64: b64("fail")
    });
    await clock.advance(10);

    // 1st sync (lastAckedInSeq = 0) -> replays 1, 2, synced(evicted: false), ctl.state(taken-back)
    const cur1 = stack.conn.decodedClientRecords.length;
    stack.peer.sendRecord(stack.conn, {
      t: "term.in.sync", ch: 2, sid, generation: "gen-1", incarnation: "inc-1",
      epoch, lastAckedInSeq: 0
    });
    await clock.advance(10);
    const recs1 = collectChannelRecords(stack.conn, 2, cur1).records;
    assert.deepEqual(
      recs1.map((r) => ({ t: r.t, inSeq: r.inSeq, result: r.result, evicted: r.evicted, state: r.state })),
      [
        { t: "term.in.ack", inSeq: 1, result: "applied", evicted: undefined, state: undefined },
        { t: "term.in.ack", inSeq: 2, result: "refused", evicted: undefined, state: undefined },
        { t: "term.in.synced", inSeq: undefined, result: undefined, evicted: false, state: undefined },
        { t: "term.ctl.state", inSeq: undefined, result: undefined, evicted: undefined, state: "taken-back" }
      ]
    );

    // 2nd sync covering all (lastAckedInSeq = 2) -> prunes all entries for this epoch
    const cur2 = stack.conn.decodedClientRecords.length;
    stack.peer.sendRecord(stack.conn, {
      t: "term.in.sync", ch: 2, sid, generation: "gen-1", incarnation: "inc-1",
      epoch, lastAckedInSeq: 2
    });
    await clock.advance(10);
    const recs2 = collectChannelRecords(stack.conn, 2, cur2).records;
    assert.deepEqual(
      recs2.map((r) => ({ t: r.t, syncedThroughInSeq: r.syncedThroughInSeq, evicted: r.evicted, state: r.state })),
      [
        { t: "term.in.synced", syncedThroughInSeq: 2, evicted: false, state: undefined },
        { t: "term.ctl.state", syncedThroughInSeq: undefined, evicted: undefined, state: "taken-back" }
      ]
    );
    const log = openTerminalInputLog(iso.root, stack.scope, sid, "gen-1", "inc-1");
    assert.equal(log.keptEntryCount(), 0, "zero entries kept for this epoch after full sync");

    // 3rd sync -> header remains: evicted=false and taken-back
    const cur3 = stack.conn.decodedClientRecords.length;
    stack.peer.sendRecord(stack.conn, {
      t: "term.in.sync", ch: 2, sid, generation: "gen-1", incarnation: "inc-1",
      epoch, lastAckedInSeq: 2
    });
    await clock.advance(10);
    const recs3 = collectChannelRecords(stack.conn, 2, cur3).records;
    assert.deepEqual(
      recs3.map((r) => ({ t: r.t, evicted: r.evicted, state: r.state })),
      [
        { t: "term.in.synced", evicted: false, state: undefined },
        { t: "term.ctl.state", evicted: undefined, state: "taken-back" }
      ]
    );

    stack.bridge.dispose();
    stack.projector.stopWatch();
    stack.client.stop();
  } finally {
    cleanup(iso);
  }
});

// ============================================================================
// 10. Cinq époques closes
// ============================================================================

test("LH-09a #10: Cinq époques closes — 1st evicted=true/released, 4 others replay with exact motif", async () => {
  const iso = makeIsolation();
  try {
    const clock = new AsyncFakeClock();
    const host = makeSimHost();
    host.setSession("h2a-5e");
    const key = generateNodeKey({ configDir: iso.configDir, env: iso.env });

    let sid;
    let scope;
    const epochs = [];

    // Helper to run 1 epoch on a stack and close with a given motif
    async function runOneEpoch(stack, closeKind) {
      const ep = await acquireLease(stack, clock, sid, 2);
      epochs.push({ epoch: ep, closeKind });
      stack.peer.sendRecord(stack.conn, {
        t: "term.in", ch: 2, sid, generation: "gen-1", incarnation: "inc-1",
        epoch: ep, inSeq: 1, ackThrough: 0, origin: "user", dataB64: b64(`e${ep}`)
      });
      await clock.advance(10);
      if (closeKind === "released") {
        stack.peer.sendRecord(stack.conn, {
          t: "term.ctl", ch: 2, sid, generation: "gen-1", incarnation: "inc-1",
          action: "release", epoch: ep
        });
        await clock.advance(10);
      } else if (closeKind === "taken-back") {
        host.setNextWriteBehavior(async ({ sessions }) => {
          const s = sessions.get("h2a-5e");
          s.holderKind = "human";
          s.controllerEpoch += 1;
          throw new SimNativeTerminalRemoteError("operation-failed", "taken-back");
        });
        stack.peer.sendRecord(stack.conn, {
          t: "term.in", ch: 2, sid, generation: "gen-1", incarnation: "inc-1",
          epoch: ep, inSeq: 2, ackThrough: 0, origin: "user", dataB64: b64("tb")
        });
        await clock.advance(10);
        // Reset session holder to none so next acquire succeeds
        host.sessions.get("h2a-5e").holderKind = "none";
      }
    }

    // Epochs 1 (released), 2 (taken-back) on stack 1, then restart -> Epoch 3 (lost-link on crash!)
    {
      const stack1 = setupStack(iso, host, clock, { key });
      scope = stack1.scope;
      sid = await openAndAttachSession(stack1, clock, "h2a-5e", 2);
      await runOneEpoch(stack1, "released");
      await runOneEpoch(stack1, "taken-back");
      const ep3 = await acquireLease(stack1, clock, sid, 2);
      epochs.push({ epoch: ep3, closeKind: "lost-link" });
      stack1.peer.sendRecord(stack1.conn, {
        t: "term.in", ch: 2, sid, generation: "gen-1", incarnation: "inc-1",
        epoch: ep3, inSeq: 1, ackThrough: 0, origin: "user", dataB64: b64("e3")
      });
      await clock.advance(10);
      // Crash/restart without closing ep3 -> ep3 closes as lost-link on reopen
      stack1.projector.stopWatch();
      host.sessions.get("h2a-5e").holderKind = "none";
    }

    // Epochs 4 (released), 5 (taken-back) on stack 2 with fresh clock
    const clock2 = new AsyncFakeClock(clock.now() + 100);
    const stack2 = setupStack(iso, host, clock2, { key });
    await openAndAttachSession(stack2, clock2, "h2a-5e", 2);
    async function runOneEpochOn(stack, clk, closeKind) {
      const ep = await acquireLease(stack, clk, sid, 2);
      epochs.push({ epoch: ep, closeKind });
      stack.peer.sendRecord(stack.conn, {
        t: "term.in", ch: 2, sid, generation: "gen-1", incarnation: "inc-1",
        epoch: ep, inSeq: 1, ackThrough: 0, origin: "user", dataB64: b64(`e${ep}`)
      });
      await clk.advance(10);
      if (closeKind === "released") {
        stack.peer.sendRecord(stack.conn, {
          t: "term.ctl", ch: 2, sid, generation: "gen-1", incarnation: "inc-1",
          action: "release", epoch: ep
        });
        await clk.advance(10);
      } else if (closeKind === "taken-back") {
        host.setNextWriteBehavior(async ({ sessions }) => {
          const s = sessions.get("h2a-5e");
          s.holderKind = "human";
          s.controllerEpoch += 1;
          throw new SimNativeTerminalRemoteError("operation-failed", "taken-back");
        });
        stack.peer.sendRecord(stack.conn, {
          t: "term.in", ch: 2, sid, generation: "gen-1", incarnation: "inc-1",
          epoch: ep, inSeq: 2, ackThrough: 0, origin: "user", dataB64: b64("tb")
        });
        await clk.advance(10);
        host.sessions.get("h2a-5e").holderKind = "none";
      }
    }
    await runOneEpochOn(stack2, clock2, "released");
    await runOneEpochOn(stack2, clock2, "taken-back");

    // Verify epoch 1 evicted=true + released, epochs 2..5 evicted=false + exact motif
    for (let idx = 0; idx < epochs.length; idx++) {
      const { epoch, closeKind } = epochs[idx];
      const cur = stack2.conn.decodedClientRecords.length;
      stack2.peer.sendRecord(stack2.conn, {
        t: "term.in.sync", ch: 2, sid, generation: "gen-1", incarnation: "inc-1",
        epoch, lastAckedInSeq: 0
      });
      await clock2.advance(10);
      const recs = collectChannelRecords(stack2.conn, 2, cur).records;
      const synced = recs.find((r) => r.t === "term.in.synced");
      const ctl = recs.find((r) => r.t === "term.ctl.state");
      if (idx === 0) {
        assert.equal(synced?.evicted, true);
        assert.equal(ctl?.state, "released");
      } else {
        assert.equal(synced?.evicted, false);
        assert.equal(ctl?.state, closeKind);
        assert.equal(recs.some((r) => r.t === "term.in.ack" && r.inSeq === 1), true);
      }
    }

    // Also verify log directly supports idle-released motif
    const directLog = openTerminalInputLog(iso.root, scope, `${sid}-idle`, "gen-1", "inc-1");
    directLog.beginEpoch(1);
    directLog.endEpoch(1, "idle-released");
    assert.deepEqual(directLog.epochStatus(1), { status: "ended", reason: "idle-released", maxInSeq: 0 });

    stack2.bridge.dispose();
    stack2.projector.stopWatch();
    stack2.client.stop();
  } finally {
    cleanup(iso);
  }
});

// ============================================================================
// 11. Contrôle soutenu (20 époques, 10 000 entrées)
// ============================================================================

test("LH-09a #11: Contrôle soutenu — 20 epochs, 10000 acked entries, <=2816 entries, <=4 ended headers, compacted size", async () => {
  const iso = makeIsolation();
  try {
    const clock = new AsyncFakeClock();
    const host = makeSimHost();
    host.setSession("h2a-sust");
    const stack = setupStack(iso, host, clock);
    const sid = await openAndAttachSession(stack, clock, "h2a-sust", 2);

    const perEpoch = 500; // 20 * 500 = 10 000 entries
    let maxKeptObserved = 0;
    let maxEndedObserved = 0;
    let totalSent = 0;

    for (let epIdx = 0; epIdx < 20; epIdx++) {
      const epoch = await acquireLease(stack, clock, sid, 2);
      for (let i = 1; i <= perEpoch; i++) {
        const ackThrough = i > 1 ? i - 1 : 0;
        const cur = stack.conn.decodedClientRecords.length;
        stack.peer.sendRecord(stack.conn, {
          t: "term.in", ch: 2, sid, generation: "gen-1", incarnation: "inc-1",
          epoch, inSeq: i, ackThrough, origin: "user", dataB64: b64("k")
        });
        await clock.flushMicrotasks();
        const ack = collectChannelRecords(stack.conn, 2, cur).records.find((r) => r.t === "term.in.ack");
        assert.equal(ack?.result, "applied", `unexpected ack at ep=${epoch} inSeq=${i}: ${JSON.stringify(ack)}`);
        totalSent += 1;
      }
      // Ack last entry before closing epoch
      stack.peer.sendRecord(stack.conn, {
        t: "term.in.sync", ch: 2, sid, generation: "gen-1", incarnation: "inc-1",
        epoch, lastAckedInSeq: perEpoch
      });
      await clock.flushMicrotasks();
      stack.peer.sendRecord(stack.conn, {
        t: "term.ctl", ch: 2, sid, generation: "gen-1", incarnation: "inc-1",
        action: "release", epoch
      });
      await clock.flushMicrotasks();

      const log = openTerminalInputLog(iso.root, stack.scope, sid, "gen-1", "inc-1");
      maxKeptObserved = Math.max(maxKeptObserved, log.keptEntryCount());
      maxEndedObserved = Math.max(maxEndedObserved, log.endedEpochCount());
      assert.ok(log.keptEntryCount() <= 2816, `kept=${log.keptEntryCount()} exceeded 2816`);
      assert.ok(log.endedEpochCount() <= 4, `ended=${log.endedEpochCount()} exceeded 4`);
    }

    assert.equal(totalSent, 10_000);
    assert.equal(host.calls.write.length, 10_000);
    const fPath = logFileFor(iso.root, stack.scope, sid);
    const bytes = statSync(fPath).size;
    assert.ok(bytes < 64 * 1024, `compacted log file size ${bytes}B should be tightly bounded`);

    stack.bridge.dispose();
    stack.projector.stopWatch();
    stack.client.stop();
  } finally {
    cleanup(iso);
  }
});

// ============================================================================
// 12 & 13: Débordement & Doublon ancien
// ============================================================================

test("LH-09a #12/#13: Débordement (512 unacked -> 513 log-full hole -> ack 100 -> 513 still log-full, 514 applies) & Doublon ancien", async () => {
  const iso = makeIsolation();
  try {
    const clock = new AsyncFakeClock();
    const host = makeSimHost();
    host.setSession("h2a-ovf");
    const stack = setupStack(iso, host, clock);
    const sid = await openAndAttachSession(stack, clock, "h2a-ovf", 2);
    const epoch = await acquireLease(stack, clock, sid, 2);

    // 512 entries with ackThrough=0
    for (let i = 1; i <= 512; i++) {
      stack.peer.sendRecord(stack.conn, {
        t: "term.in", ch: 2, sid, generation: "gen-1", incarnation: "inc-1",
        epoch, inSeq: i, ackThrough: 0, origin: "user", dataB64: b64("a")
      });
    }
    await clock.flushMicrotasks(2_500);
    assert.equal(host.calls.write.length, 512);

    // 513th -> log-full, zero write
    const cur513 = stack.conn.decodedClientRecords.length;
    stack.peer.sendRecord(stack.conn, {
      t: "term.in", ch: 2, sid, generation: "gen-1", incarnation: "inc-1",
      epoch, inSeq: 513, ackThrough: 0, origin: "user", dataB64: b64("b")
    });
    await clock.advance(10);
    assert.equal(host.calls.write.length, 512);
    assert.equal(collectChannelRecords(stack.conn, 2, cur513).records[0]?.reason, "log-full");

    // Resend 513th with ackThrough=100 -> STILL log-full (hole!), 514th applies once
    const cur513b = stack.conn.decodedClientRecords.length;
    stack.peer.sendRecord(stack.conn, {
      t: "term.in", ch: 2, sid, generation: "gen-1", incarnation: "inc-1",
      epoch, inSeq: 513, ackThrough: 100, origin: "user", dataB64: b64("b")
    });
    stack.peer.sendRecord(stack.conn, {
      t: "term.in", ch: 2, sid, generation: "gen-1", incarnation: "inc-1",
      epoch, inSeq: 514, ackThrough: 100, origin: "user", dataB64: b64("c")
    });
    await clock.advance(10);
    assert.equal(host.calls.write.length, 513);
    assert.equal(host.calls.write[512].data, "c");
    const recs513b = collectChannelRecords(stack.conn, 2, cur513b).records;
    assert.equal(recs513b[0]?.inSeq, 513);
    assert.equal(recs513b[0]?.reason, "log-full");
    assert.equal(recs513b[1]?.inSeq, 514);
    assert.equal(recs513b[1]?.result, "applied");

    // #13 Doublon ancien: advance ackThrough to 400 -> prunedThroughInSeq = 400 - 256 = 144.
    // Resend inSeq 144 -> already-acked, zero writes; inSeq 145 -> applied from recent-acked window!
    const curPruned = stack.conn.decodedClientRecords.length;
    stack.peer.sendRecord(stack.conn, {
      t: "term.in", ch: 2, sid, generation: "gen-1", incarnation: "inc-1",
      epoch, inSeq: 515, ackThrough: 400, origin: "user", dataB64: b64("d")
    });
    stack.peer.sendRecord(stack.conn, {
      t: "term.in", ch: 2, sid, generation: "gen-1", incarnation: "inc-1",
      epoch, inSeq: 144, ackThrough: 400, origin: "user", dataB64: b64("a")
    });
    stack.peer.sendRecord(stack.conn, {
      t: "term.in", ch: 2, sid, generation: "gen-1", incarnation: "inc-1",
      epoch, inSeq: 145, ackThrough: 400, origin: "user", dataB64: b64("a")
    });
    await clock.advance(10);
    assert.equal(host.calls.write.length, 514);
    const recsPruned = collectChannelRecords(stack.conn, 2, curPruned).records;
    assert.deepEqual(
      recsPruned.map((r) => ({ inSeq: r.inSeq, result: r.result, reason: r.reason })),
      [
        { inSeq: 515, result: "applied", reason: undefined },
        { inSeq: 144, result: "refused", reason: "already-acked" },
        { inSeq: 145, result: "applied", reason: undefined }
      ]
    );

    stack.bridge.dispose();
    stack.projector.stopWatch();
    stack.client.stop();
  } finally {
    cleanup(iso);
  }
});

// ============================================================================
// 14. Entrée hors bail
// ============================================================================

test("LH-09a #14: Entrée hors bail — closed epoch logged & fresh inSeq both stale-epoch, higher epoch not-controller", async () => {
  const iso = makeIsolation();
  try {
    const clock = new AsyncFakeClock();
    const host = makeSimHost();
    host.setSession("h2a-ob");
    const stack = setupStack(iso, host, clock);
    const sid = await openAndAttachSession(stack, clock, "h2a-ob", 2);
    const epoch1 = await acquireLease(stack, clock, sid, 2);

    stack.peer.sendRecord(stack.conn, {
      t: "term.in", ch: 2, sid, generation: "gen-1", incarnation: "inc-1",
      epoch: epoch1, inSeq: 1, ackThrough: 0, origin: "user", dataB64: b64("ok")
    });
    await clock.advance(10);

    // Close epoch1 with taken-back
    host.setNextWriteBehavior(async ({ sessions }) => {
      sessions.get("h2a-ob").holderKind = "human";
      throw new SimNativeTerminalRemoteError("operation-failed", "stale");
    });
    stack.peer.sendRecord(stack.conn, {
      t: "term.in", ch: 2, sid, generation: "gen-1", incarnation: "inc-1",
      epoch: epoch1, inSeq: 2, ackThrough: 0, origin: "user", dataB64: b64("fail")
    });
    await clock.advance(10);

    const writesBefore = host.calls.write.length;
    const cur = stack.conn.decodedClientRecords.length;
    // Logged inSeq 1 on closed epoch -> stale-epoch
    stack.peer.sendRecord(stack.conn, {
      t: "term.in", ch: 2, sid, generation: "gen-1", incarnation: "inc-1",
      epoch: epoch1, inSeq: 1, ackThrough: 0, origin: "user", dataB64: b64("ok")
    });
    // Fresh inSeq 99 on closed epoch -> stale-epoch
    stack.peer.sendRecord(stack.conn, {
      t: "term.in", ch: 2, sid, generation: "gen-1", incarnation: "inc-1",
      epoch: epoch1, inSeq: 99, ackThrough: 0, origin: "user", dataB64: b64("new")
    });
    // Higher epoch than highestOpenedEpoch -> not-controller
    stack.peer.sendRecord(stack.conn, {
      t: "term.in", ch: 2, sid, generation: "gen-1", incarnation: "inc-1",
      epoch: epoch1 + 5, inSeq: 1, ackThrough: 0, origin: "user", dataB64: b64("future")
    });
    await clock.advance(10);
    assert.equal(host.calls.write.length, writesBefore);
    assert.deepEqual(
      collectChannelRecords(stack.conn, 2, cur).records.map((r) => ({ inSeq: r.inSeq, result: r.result, reason: r.reason })),
      [
        { inSeq: 1, result: "refused", reason: "stale-epoch" },
        { inSeq: 99, result: "refused", reason: "stale-epoch" },
        { inSeq: 1, result: "refused", reason: "not-controller" }
      ]
    );

    stack.bridge.dispose();
    stack.projector.stopWatch();
    stack.client.stop();
  } finally {
    cleanup(iso);
  }
});

// ============================================================================
// 15. Acquittement plafonné
// ============================================================================

test("LH-09a #15: Acquittement plafonné — lastAckedInSeq=1_000_000 clamps to 3; inSeq 4 with ackThrough=1_000_000 applies", async () => {
  const iso = makeIsolation();
  try {
    const clock = new AsyncFakeClock();
    const host = makeSimHost();
    host.setSession("h2a-clamp");
    const stack = setupStack(iso, host, clock);
    const sid = await openAndAttachSession(stack, clock, "h2a-clamp", 2);
    const epoch = await acquireLease(stack, clock, sid, 2);

    for (let i = 1; i <= 3; i++) {
      stack.peer.sendRecord(stack.conn, {
        t: "term.in", ch: 2, sid, generation: "gen-1", incarnation: "inc-1",
        epoch, inSeq: i, ackThrough: 0, origin: "user", dataB64: b64(`c${i}`)
      });
    }
    await clock.advance(10);

    const curSync = stack.conn.decodedClientRecords.length;
    stack.peer.sendRecord(stack.conn, {
      t: "term.in.sync", ch: 2, sid, generation: "gen-1", incarnation: "inc-1",
      epoch, lastAckedInSeq: 1_000_000
    });
    await clock.advance(10);
    const synced = collectChannelRecords(stack.conn, 2, curSync).records.find((r) => r.t === "term.in.synced");
    assert.equal(synced?.syncedThroughInSeq, 3);
    const log = stack.input.getLog(sid, "gen-1", "inc-1");
    assert.ok(log);
    assert.equal(log.epochStatus(epoch).maxAckedInSeq, 3);

    const cur4 = stack.conn.decodedClientRecords.length;
    stack.peer.sendRecord(stack.conn, {
      t: "term.in", ch: 2, sid, generation: "gen-1", incarnation: "inc-1",
      epoch, inSeq: 4, ackThrough: 1_000_000, origin: "user", dataB64: b64("four")
    });
    stack.peer.sendRecord(stack.conn, {
      t: "term.in", ch: 2, sid, generation: "gen-1", incarnation: "inc-1",
      epoch, inSeq: 1, ackThrough: 1_000_000, origin: "user", dataB64: b64("c1")
    });
    await clock.advance(10);
    assert.deepEqual(
      collectChannelRecords(stack.conn, 2, cur4).records.map((r) => ({ inSeq: r.inSeq, result: r.result })),
      [
        { inSeq: 4, result: "applied" },
        { inSeq: 1, result: "applied" }
      ]
    );

    stack.bridge.dispose();
    stack.projector.stopWatch();
    stack.client.stop();
  } finally {
    cleanup(iso);
  }
});

// ============================================================================
// 16. Rejeu refusé
// ============================================================================

test("LH-09a #16: Rejeu refusé — stale-incarnation, stale-epoch (never granted), not-controller (other channel)", async () => {
  const iso = makeIsolation();
  try {
    const clock = new AsyncFakeClock();
    const host = makeSimHost();
    host.setSession("h2a-rr");
    const stack = setupStack(iso, host, clock);
    const sid = await openAndAttachSession(stack, clock, "h2a-rr", 2);
    await openAndAttachSession(stack, clock, "h2a-rr", 3);
    const epoch = await acquireLease(stack, clock, sid, 2);

    // Wrong sid / generation / incarnation on ch=2 -> err stale-incarnation
    for (const bad of [
      { sid: nativeCatalogueSid("other"), generation: "gen-1", incarnation: "inc-1" },
      { sid, generation: "gen-old", incarnation: "inc-1" },
      { sid, generation: "gen-1", incarnation: "inc-old" }
    ]) {
      const cur = stack.conn.decodedClientRecords.length;
      stack.peer.sendRecord(stack.conn, {
        t: "term.in.sync", ch: 2, ...bad, epoch, lastAckedInSeq: 0
      });
      await clock.advance(10);
      const recs = collectChannelRecords(stack.conn, 2, cur).records;
      assert.equal(recs[0]?.t, "err");
      assert.equal(recs[0]?.code, "stale-incarnation");
      assert.equal(recs.some((r) => r.t === "term.in.synced"), false);
    }

    // Epoch never granted -> err stale-epoch, no term.in.synced
    {
      const cur = stack.conn.decodedClientRecords.length;
      stack.peer.sendRecord(stack.conn, {
        t: "term.in.sync", ch: 2, sid, generation: "gen-1", incarnation: "inc-1",
        epoch: epoch + 10, lastAckedInSeq: 0
      });
      await clock.advance(10);
      const recs = collectChannelRecords(stack.conn, 2, cur).records;
      assert.equal(recs[0]?.t, "err");
      assert.equal(recs[0]?.code, "stale-epoch");
      assert.equal(recs.some((r) => r.t === "term.in.synced"), false);
    }

    // Epoch of lease bound to ch=2 presented on ch=3 -> err not-controller
    {
      const cur = stack.conn.decodedClientRecords.length;
      stack.peer.sendRecord(stack.conn, {
        t: "term.in.sync", ch: 3, sid, generation: "gen-1", incarnation: "inc-1",
        epoch, lastAckedInSeq: 0
      });
      await clock.advance(10);
      const recs = collectChannelRecords(stack.conn, 3, cur).records;
      assert.equal(recs[0]?.t, "err");
      assert.equal(recs[0]?.code, "not-controller");
    }

    stack.bridge.dispose();
    stack.projector.stopWatch();
    stack.client.stop();
  } finally {
    cleanup(iso);
  }
});

// ============================================================================
// 17. Époque jamais chassée & epoch: 0 invalide
// ============================================================================

test("LH-09a #17: Époque jamais chassée & epoch: 0 rejeté invalid-record", async () => {
  const iso = makeIsolation();
  try {
    const clock = new AsyncFakeClock();
    const host = makeSimHost();
    host.setSession("h2a-e0");
    const stack = setupStack(iso, host, clock);
    const sid = await openAndAttachSession(stack, clock, "h2a-e0", 2);

    // Fresh module: no lease, no eviction
    const curSync = stack.conn.decodedClientRecords.length;
    stack.peer.sendRecord(stack.conn, {
      t: "term.in.sync", ch: 2, sid, generation: "gen-1", incarnation: "inc-1",
      epoch: 1, lastAckedInSeq: 0
    });
    await clock.advance(10);
    const syncRecs = collectChannelRecords(stack.conn, 2, curSync).records;
    assert.equal(syncRecs[0]?.t, "err");
    assert.equal(syncRecs[0]?.code, "stale-epoch");
    assert.equal(syncRecs.some((r) => r.t === "term.in.synced"), false);

    const curIn = stack.conn.decodedClientRecords.length;
    stack.peer.sendRecord(stack.conn, {
      t: "term.in", ch: 2, sid, generation: "gen-1", incarnation: "inc-1",
      epoch: 1, inSeq: 1, ackThrough: 0, origin: "user", dataB64: b64("a")
    });
    await clock.advance(10);
    assert.equal(collectChannelRecords(stack.conn, 2, curIn).records[0]?.reason, "not-controller");

    // epochStatus(0) on fresh log and after 5 closed epochs
    const directLog = openTerminalInputLog(iso.root, stack.scope, `${sid}-d`, "gen-1", "inc-1");
    assert.deepEqual(directLog.epochStatus(0), { status: "unknown" });
    for (let e = 1; e <= 5; e++) {
      directLog.beginEpoch(e);
      directLog.endEpoch(e, "released");
    }
    assert.deepEqual(directLog.epochStatus(0), { status: "unknown" });
    assert.deepEqual(directLog.epochStatus(1), { status: "evicted" });

    stack.bridge.dispose();
    stack.projector.stopWatch();
    stack.client.stop();

    // epoch: 0 on term.in, term.in.sync, term.ctl release -> closes link on invalid-record
    for (const badRec of [
      { t: "term.in", ch: 2, generation: "gen-1", incarnation: "inc-1", epoch: 0, inSeq: 1, ackThrough: 0, origin: "user", dataB64: b64("a") },
      { t: "term.in.sync", ch: 2, generation: "gen-1", incarnation: "inc-1", epoch: 0, lastAckedInSeq: 0 },
      { t: "term.ctl", ch: 2, generation: "gen-1", incarnation: "inc-1", action: "release", epoch: 0 }
    ]) {
      const s2 = setupStack(iso, host, clock);
      const sid2 = await openAndAttachSession(s2, clock, "h2a-e0", 2);
      s2.peer.sendRecord(s2.conn, { ...badRec, sid: sid2 });
      await clock.flushMicrotasks();
      assert.equal(s2.conn.closed, true, `${badRec.t} with epoch=0 must close link`);
      assert.equal(s2.conn.closeReason, "invalid-record");
      s2.bridge.dispose();
      s2.projector.stopWatch();
      s2.client.stop();
    }
    // Also verify isTrunkRecord directly rejects epoch: 0 on term.in.synced and term.ctl.state
    assert.equal(isTrunkRecord({ v: 1, t: "term.in.synced", ch: 2, s: 1, sid, epoch: 0, syncedThroughInSeq: 0, evicted: false }), false);
    assert.equal(isTrunkRecord({ v: 1, t: "term.ctl.state", ch: 2, s: 1, sid, state: "released", epoch: 0 }), false);
  } finally {
    cleanup(iso);
  }
});

// ============================================================================
// 18. Écriture refusée par l'hôte
// ============================================================================

test("LH-09a #18: Écriture refusée par l'hôte — holderKind=human -> taken-back; holderKind=none -> released", async () => {
  const iso = makeIsolation();
  try {
    const clock = new AsyncFakeClock();
    const host = makeSimHost();
    host.setSession("h2a-wr");
    const stack = setupStack(iso, host, clock);
    const sid = await openAndAttachSession(stack, clock, "h2a-wr", 2);

    // 18a: holderKind = human -> taken-back
    {
      const epoch = await acquireLease(stack, clock, sid, 2);
      const closesBefore = host.calls.portCloseCount;
      host.setNextWriteBehavior(async ({ sessions }) => {
        sessions.get("h2a-wr").holderKind = "human";
        throw new SimNativeTerminalRemoteError("operation-failed", "fenced");
      });
      const cur = stack.conn.decodedClientRecords.length;
      stack.peer.sendRecord(stack.conn, {
        t: "term.in", ch: 2, sid, generation: "gen-1", incarnation: "inc-1",
        epoch, inSeq: 1, ackThrough: 0, origin: "user", dataB64: b64("a")
      });
      await clock.flushMicrotasks();
      const recs = collectChannelRecords(stack.conn, 2, cur).records;
      assert.equal(recs[0]?.t, "term.in.ack");
      assert.equal(recs[0]?.result, "refused");
      assert.equal(recs[0]?.reason, "stale-epoch");
      assert.equal(recs[1]?.t, "term.ctl.state");
      assert.equal(recs[1]?.state, "taken-back");
      assert.equal(recs[1]?.epoch, epoch);
      assert.equal(host.calls.portCloseCount, closesBefore + 1);
      const lines = readFileSync(logFileFor(iso.root, stack.scope, sid), "utf8").trim().split("\n").map(JSON.parse);
      assert.equal(lines.at(-1)?.k, "end");
      assert.equal(lines.at(-1)?.why, "taken-back");
    }

    // 18b: holderKind = none -> released
    {
      host.sessions.get("h2a-wr").holderKind = "none";
      const epoch = await acquireLease(stack, clock, sid, 2);
      const closesBefore = host.calls.portCloseCount;
      host.setNextWriteBehavior(async ({ sessions }) => {
        sessions.get("h2a-wr").holderKind = "none";
        throw new SimNativeTerminalRemoteError("operation-failed", "stale");
      });
      const cur = stack.conn.decodedClientRecords.length;
      stack.peer.sendRecord(stack.conn, {
        t: "term.in", ch: 2, sid, generation: "gen-1", incarnation: "inc-1",
        epoch, inSeq: 1, ackThrough: 0, origin: "user", dataB64: b64("b")
      });
      await clock.flushMicrotasks();
      const recs = collectChannelRecords(stack.conn, 2, cur).records;
      assert.equal(recs[0]?.reason, "stale-epoch");
      assert.equal(recs[1]?.t, "term.ctl.state");
      assert.equal(recs[1]?.state, "released");
      assert.equal(host.calls.portCloseCount, closesBefore + 1);
    }

    stack.bridge.dispose();
    stack.projector.stopWatch();
    stack.client.stop();
  } finally {
    cleanup(iso);
  }
});

// ============================================================================
// 19. Garde locale à la prise
// ============================================================================

test("LH-09a #19: Garde locale à la prise — killed / excluded -> err, zero port calls, no term.ctl.state", async () => {
  const iso = makeIsolation();
  try {
    const clock = new AsyncFakeClock();
    const host = makeSimHost();
    host.setSession("h2a-g1");
    host.setSession("h2a-g2");
    let killed = true;
    const stack = setupStack(iso, host, clock, { isKilled: () => killed });
    const sid1 = await openAndAttachSession(stack, clock, "h2a-g1", 2);
    const sid2 = await openAndAttachSession(stack, clock, "h2a-g2", 3);

    // Under kill switch
    {
      const cur = stack.conn.decodedClientRecords.length;
      stack.peer.sendRecord(stack.conn, {
        t: "term.ctl", ch: 2, sid: sid1, generation: "gen-1", incarnation: "inc-1", action: "acquire"
      });
      await clock.advance(10);
      const recs = collectChannelRecords(stack.conn, 2, cur).records;
      assert.deepEqual(recs.map((r) => ({ t: r.t, code: r.code, retryable: r.retryable })), [
        { t: "err", code: "killed", retryable: false }
      ]);
      assert.equal(host.calls.acquire.length, 0);
      assert.equal(host.calls.portConnectCount, 0);
    }

    // Lift kill, exclude h2a-g2
    killed = false;
    setSessionExcluded("h2a-g2", { root: iso.root, configDir: iso.configDir, env: iso.env });
    {
      const cur = stack.conn.decodedClientRecords.length;
      stack.peer.sendRecord(stack.conn, {
        t: "term.ctl", ch: 3, sid: sid2, generation: "gen-1", incarnation: "inc-1", action: "acquire"
      });
      await clock.advance(10);
      const recs = collectChannelRecords(stack.conn, 3, cur).records;
      assert.deepEqual(recs.map((r) => ({ t: r.t, code: r.code, retryable: r.retryable })), [
        { t: "err", code: "excluded", retryable: false }
      ]);
      assert.equal(host.calls.acquire.length, 0);
      assert.equal(host.calls.portConnectCount, 0);
    }

    stack.bridge.dispose();
    stack.projector.stopWatch();
    stack.client.stop();
  } finally {
    cleanup(iso);
  }
});

// ============================================================================
// 20. Sans port & Drapeau éteint
// ============================================================================

test("LH-09a #20: Sans port — control-unavailable on acquire, not-controller on term.in, zero files under input-log", async () => {
  const iso = makeIsolation();
  try {
    const clock = new AsyncFakeClock();
    const host = makeSimHost();
    host.setSession("h2a-np");
    const stack = setupStack(iso, host, clock, { omitPortFactory: true });
    const sid = await openAndAttachSession(stack, clock, "h2a-np", 2);

    const cur = stack.conn.decodedClientRecords.length;
    stack.peer.sendRecord(stack.conn, {
      t: "term.ctl", ch: 2, sid, generation: "gen-1", incarnation: "inc-1", action: "acquire"
    });
    stack.peer.sendRecord(stack.conn, {
      t: "term.in", ch: 2, sid, generation: "gen-1", incarnation: "inc-1",
      epoch: 1, inSeq: 1, ackThrough: 0, origin: "user", dataB64: b64("x")
    });
    await clock.advance(10);
    const recs = collectChannelRecords(stack.conn, 2, cur).records;
    assert.deepEqual(
      recs.map((r) => ({ t: r.t, code: r.code, retryable: r.retryable, result: r.result, reason: r.reason })),
      [
        { t: "err", code: "control-unavailable", retryable: false, result: undefined, reason: undefined },
        { t: "term.in.ack", code: undefined, retryable: undefined, result: "refused", reason: "not-controller" }
      ]
    );
    const logDir = join(iso.root, "remote-control", "input-log");
    assert.equal(existsSync(logDir) ? readdirSync(logDir).length : 0, 0);

    stack.bridge.dispose();
    stack.projector.stopWatch();
    stack.client.stop();
  } finally {
    cleanup(iso);
  }
});

// ============================================================================
// 21. Canal pas encore ouvert
// ============================================================================

test("LH-09a #21: Canal pas encore ouvert — channel-not-ready before term.opened, acquire succeeds after", async () => {
  const iso = makeIsolation();
  try {
    const clock = new AsyncFakeClock();
    const host = makeSimHost();
    host.setSession("h2a-nr");
    const releaseAttach = host.holdNextAttach();
    const stack = setupStack(iso, host, clock);
    stack.peer.sendWatchStart(stack.conn);
    await clock.advance(10);
    const sid = nativeCatalogueSid("h2a-nr");

    stack.peer.sendTermOpen(stack.conn, { ch: 2, sid, mode: "observe", afterSeq: null, receivedSegBytes: 0 });
    stack.peer.sendCredit(stack.conn, 2, {
      receivedThroughSeq: 0, receivedThroughBytes: 0, sendLimitSeq: 8, sendLimitBytes: 131_072
    });
    await clock.flushMicrotasks();

    const cur = stack.conn.decodedClientRecords.length;
    stack.peer.sendRecord(stack.conn, {
      t: "term.ctl", ch: 2, sid, generation: "gen-1", incarnation: "inc-1", action: "acquire"
    });
    stack.peer.sendRecord(stack.conn, {
      t: "term.in.sync", ch: 2, sid, generation: "gen-1", incarnation: "inc-1", epoch: 1, lastAckedInSeq: 0
    });
    stack.peer.sendRecord(stack.conn, {
      t: "term.resize", ch: 2, sid, cols: 100, rows: 40
    });
    stack.peer.sendRecord(stack.conn, {
      t: "term.stop", ch: 2, sid, generation: "gen-1", incarnation: "inc-1"
    });
    stack.peer.sendRecord(stack.conn, {
      t: "term.in", ch: 2, sid, generation: "gen-1", incarnation: "inc-1",
      epoch: 1, inSeq: 1, ackThrough: 0, origin: "user", dataB64: b64("early")
    });
    await clock.flushMicrotasks();

    const recs = collectChannelRecords(stack.conn, 2, cur).records;
    assert.deepEqual(
      recs.map((r) => ({ t: r.t, code: r.code, retryable: r.retryable, result: r.result, reason: r.reason })),
      [
        { t: "err", code: "channel-not-ready", retryable: true, result: undefined, reason: undefined },
        { t: "err", code: "channel-not-ready", retryable: true, result: undefined, reason: undefined },
        { t: "err", code: "channel-not-ready", retryable: true, result: undefined, reason: undefined },
        { t: "err", code: "channel-not-ready", retryable: true, result: undefined, reason: undefined },
        { t: "term.in.ack", code: undefined, retryable: undefined, result: "refused", reason: "not-controller" }
      ]
    );

    // Release attach -> term.opened sent -> acquire now succeeds
    releaseAttach();
    await clock.advance(20);
    const epoch = await acquireLease(stack, clock, sid, 2);
    assert.equal(epoch, 1);

    stack.bridge.dispose();
    stack.projector.stopWatch();
    stack.client.stop();
  } finally {
    cleanup(iso);
  }
});

// ============================================================================
// 22. Réponses du terminal
// ============================================================================

test("LH-09a #22: Réponses du terminal — 4 allowlisted shapes pass, OSC52/DCS/APC/near-miss refused, 20 burst + 10/s", async () => {
  const iso = makeIsolation();
  try {
    const clock = new AsyncFakeClock();
    const host = makeSimHost();
    host.setSession("h2a-rep");
    const stack = setupStack(iso, host, clock);
    const sid = await openAndAttachSession(stack, clock, "h2a-rep", 2);
    const epoch = await acquireLease(stack, clock, sid, 2);

    const allowed = [
      "\x1b[?62;1;2;6;7;8;9c", // DA1
      "\x1b[?1c", // DA1 single
      "\x1b[>1;10;0c", // DA2
      "\x1b[24;80R", // CPR
      "\x1b[?2004;1$y" // DECRPM
    ];
    const disallowed = [
      "\x1b]52;c;YWJj\x07", // OSC 52
      "\x1bP1$r0m\x1b\\", // DCS
      "\x1b_hello\x1b\\", // APC
      "\x1b[?2004;5$y", // near-miss DECRPM value 5
      "\x1b[>1;2c" // near-miss DA2 only 2 nums
    ];

    assert.equal(allowed.every((s) => isAllowlistedTerminalReply(s)), true);
    assert.equal(disallowed.every((s) => !isAllowlistedTerminalReply(s)), true);

    let seq = 1;
    for (const s of allowed) {
      const cur = stack.conn.decodedClientRecords.length;
      stack.peer.sendRecord(stack.conn, {
        t: "term.in", ch: 2, sid, generation: "gen-1", incarnation: "inc-1",
        epoch, inSeq: seq++, ackThrough: seq - 2, origin: "terminal-reply", dataB64: b64(s)
      });
      await clock.flushMicrotasks();
      assert.equal(collectChannelRecords(stack.conn, 2, cur).records[0]?.result, "applied");
    }

    for (const s of disallowed) {
      const cur = stack.conn.decodedClientRecords.length;
      stack.peer.sendRecord(stack.conn, {
        t: "term.in", ch: 2, sid, generation: "gen-1", incarnation: "inc-1",
        epoch, inSeq: seq++, ackThrough: seq - 2, origin: "terminal-reply", dataB64: b64(s)
      });
      await clock.flushMicrotasks();
      const ack = collectChannelRecords(stack.conn, 2, cur).records[0];
      assert.equal(ack?.result, "refused");
      assert.equal(ack?.reason, "reply-not-allowed");
    }

    // Rate limit test on a fresh channel (ch=3, fresh token bucket of 20)
    const sid3 = await openAndAttachSession(stack, clock, "h2a-rep", 3);
    // Close epoch on ch=2 first so ch=3 can acquire
    stack.peer.sendRecord(stack.conn, {
      t: "term.ctl", ch: 2, sid, generation: "gen-1", incarnation: "inc-1", action: "release", epoch
    });
    await clock.flushMicrotasks();
    const epoch3 = await acquireLease(stack, clock, sid3, 3);

    const curBurst = stack.conn.decodedClientRecords.length;
    for (let i = 1; i <= 25; i++) {
      stack.peer.sendRecord(stack.conn, {
        t: "term.in", ch: 3, sid: sid3, generation: "gen-1", incarnation: "inc-1",
        epoch: epoch3, inSeq: i, ackThrough: i - 1, origin: "terminal-reply", dataB64: b64("\x1b[1;1R")
      });
    }
    await clock.flushMicrotasks(200);
    const burstAcks = collectChannelRecords(stack.conn, 3, curBurst).records.filter((r) => r.t === "term.in.ack");
    assert.equal(burstAcks.filter((a) => a.result === "applied").length, 20);
    assert.equal(burstAcks.filter((a) => a.result === "refused" && a.reason === "reply-rate-limited").length, 5);
    assert.equal(stack.inputAudits.filter((e) => e.kind === "terminal-reply-rate-limited").length, 5);

    // Advance 1s -> 10 pass
    await clock.advance(1_000);
    const curRefill = stack.conn.decodedClientRecords.length;
    for (let i = 26; i <= 36; i++) {
      stack.peer.sendRecord(stack.conn, {
        t: "term.in", ch: 3, sid: sid3, generation: "gen-1", incarnation: "inc-1",
        epoch: epoch3, inSeq: i, ackThrough: i - 1, origin: "terminal-reply", dataB64: b64("\x1b[1;1R")
      });
    }
    await clock.flushMicrotasks(200);
    const refillAcks = collectChannelRecords(stack.conn, 3, curRefill).records.filter((r) => r.t === "term.in.ack");
    assert.equal(refillAcks.filter((a) => a.result === "applied").length, 10);
    assert.equal(refillAcks.filter((a) => a.result === "refused" && a.reason === "reply-rate-limited").length, 1);

    // Direct filter check too
    const filter = createTerminalReplyFilter(clock);
    assert.equal(filter.check("\x1b[?1;2c").allowed, true);

    stack.bridge.dispose();
    stack.projector.stopWatch();
    stack.client.stop();
  } finally {
    cleanup(iso);
  }
});

// ============================================================================
// 23. Charge utile
// ============================================================================

test("LH-09a #23: Charge utile — invalid base64, 0B, 4097B, truncated UTF-8 -> invalid-input; 4096B -> applied", async () => {
  const iso = makeIsolation();
  try {
    const clock = new AsyncFakeClock();
    const host = makeSimHost();
    host.setSession("h2a-pl");
    const stack = setupStack(iso, host, clock);
    const sid = await openAndAttachSession(stack, clock, "h2a-pl", 2);
    const epoch = await acquireLease(stack, clock, sid, 2);

    const badPayloads = [
      "not!base64",
      "YWJjZA", // unpadded
      "", // 0 bytes
      Buffer.alloc(4097, 0x61).toString("base64"), // 4097 bytes
      Buffer.from([0xe2, 0x82]).toString("base64") // truncated UTF-8 (2 bytes of 3-byte €)
    ];

    let seq = 1;
    for (const badB64 of badPayloads) {
      const cur = stack.conn.decodedClientRecords.length;
      stack.peer.sendRecord(stack.conn, {
        t: "term.in", ch: 2, sid, generation: "gen-1", incarnation: "inc-1",
        epoch, inSeq: seq++, ackThrough: 0, origin: "user", dataB64: badB64
      });
      await clock.flushMicrotasks();
      const ack = collectChannelRecords(stack.conn, 2, cur).records[0];
      assert.equal(ack?.result, "refused", `expected invalid-input for ${badB64.slice(0, 16)}`);
      assert.equal(ack?.reason, "invalid-input");
    }
    assert.equal(host.calls.write.length, 0);

    // 4096 bytes -> applied
    const maxB64 = Buffer.alloc(4096, 0x61).toString("base64");
    const curMax = stack.conn.decodedClientRecords.length;
    stack.peer.sendRecord(stack.conn, {
      t: "term.in", ch: 2, sid, generation: "gen-1", incarnation: "inc-1",
      epoch, inSeq: seq++, ackThrough: 0, origin: "user", dataB64: maxB64
    });
    await clock.flushMicrotasks();
    assert.equal(collectChannelRecords(stack.conn, 2, curMax).records[0]?.result, "applied");
    assert.equal(host.calls.write.length, 1);

    stack.bridge.dispose();
    stack.projector.stopWatch();
    stack.client.stop();
  } finally {
    cleanup(iso);
  }
});

// ============================================================================
// 24. Confidentialité
// ============================================================================

test("LH-09a #24: Confidentialité — sentinel plaintext and base64 absent from log, audits and wire responses", async () => {
  const iso = makeIsolation();
  try {
    const clock = new AsyncFakeClock();
    const host = makeSimHost();
    host.setSession("h2a-sec");
    const stack = setupStack(iso, host, clock);
    const sid = await openAndAttachSession(stack, clock, "h2a-sec", 2);
    const epoch = await acquireLease(stack, clock, sid, 2);

    const sentinel = "SENTINEL_SECRET_KEYSTROKE_98765";
    const sentinelB64 = b64(sentinel);

    const cur = stack.conn.decodedClientRecords.length;
    stack.peer.sendRecord(stack.conn, {
      t: "term.in", ch: 2, sid, generation: "gen-1", incarnation: "inc-1",
      epoch, inSeq: 1, ackThrough: 0, origin: "user", dataB64: sentinelB64
    });
    await clock.advance(10);

    const logContent = readFileSync(logFileFor(iso.root, stack.scope, sid), "utf8");
    const auditJson = JSON.stringify(stack.inputAudits);
    const wireOutJson = JSON.stringify(collectChannelRecords(stack.conn, 2, cur).records);

    for (const [label, haystack] of [
      ["input-log", logContent],
      ["audits", auditJson],
      ["wire-responses", wireOutJson]
    ]) {
      assert.equal(haystack.includes(sentinel), false, `sentinel plaintext leaked in ${label}`);
      assert.equal(haystack.includes(sentinelB64), false, `sentinel base64 leaked in ${label}`);
    }

    stack.bridge.dispose();
    stack.projector.stopWatch();
    stack.client.stop();
  } finally {
    cleanup(iso);
  }
});


// ============================================================================
// 25. onLinkTerminated & drapeau éteint
// ============================================================================

test("LH-09a #25: onLinkTerminated fires on all 6 causes after onClose, and flag-off creates zero input-log files", async () => {
  const iso = makeIsolation();
  try {
    const clock = new AsyncFakeClock();
    const host = makeSimHost();
    host.setSession("h2a-lt");

    // Flag off: zero input-log files
    {
      const key = generateNodeKey({ configDir: iso.configDir, env: iso.env });
      const envOff = { ...iso.env, H2A_REMOTE_CONTROL: "0" };
      const contract = createSimulatedTrunkContractProvider();
      const peer = new FakeBinaryTrunkPeer({ meshId: MESH, tenantId: TENANT, endpoint: ENDPOINT, clock, env: envOff, contract });
      const projector = createCatalogueProjector({
        root: iso.root, configDir: iso.configDir, env: envOff, clock,
        readNativeInventory: async () => host.inventory(), readPresences: () => []
      });
      const events = [];
      const client = new TrunkClient({
        root: iso.root, env: envOff,
        enrolment: { meshId: MESH, endpoint: ENDPOINT, tenantId: TENANT, enrolmentRef: "enr-off", nodeId: key.nodeId },
        nodeKeyOptions: { configDir: iso.configDir, env: envOff },
        connector: peer.createConnector("off-client"),
        contract, clock, catalogue: projector,
        terminalConsumer: {
          onOpen() {},
          onLinkTerminated(info) { events.push(info.cause); }
        }
      });
      assert.equal(client.start().ok, false);
      assert.deepEqual(events, ["disabled"]);
      assert.equal(existsSync(join(iso.root, "remote-control", "input-log")), false);
    }

    // onLinkTerminated causes: revoked, superseded, killed, stopped, disabled (in-flight), auth-refused
    const runCause = async (trigger) => {
      const key = generateNodeKey({ configDir: iso.configDir, env: iso.env });
      const contract = createSimulatedTrunkContractProvider();
      let envRef = { ...iso.env };
      const peer = new FakeBinaryTrunkPeer({ meshId: MESH, tenantId: TENANT, endpoint: ENDPOINT, clock, env: iso.env, contract });
      peer.registerEnrolment({ nodeId: key.nodeId, enrolmentRef: "enr-lt", publicKeyPem: key.publicKeyPem, fingerprint: key.fingerprint });
      const projector = createCatalogueProjector({
        root: iso.root, configDir: iso.configDir, env: () => envRef, clock,
        readNativeInventory: async () => host.inventory(), readPresences: () => []
      });
      const events = [];
      const bridge = createTerminalBridge({
        catalogue: projector, clock, rangeIndex: new CoalescedRangeIndex(),
        connectNativeClient: host.connectObserverClient,
        input: createTerminalInput({
          root: iso.root, scope: `${MESH}|${TENANT}|enr-lt|${key.nodeId}`, clock,
          connectControlPort: host.connectControlPort, env: () => envRef, withShareAllowed: projector.withShareAllowed
        })
      });
      const consumer = {
        onOpen: (o, c) => bridge.onOpen(o, c),
        onCredit: (ch, a) => bridge.onCredit(ch, a),
        onRecord: (ch, r) => bridge.onRecord(ch, r),
        onClose: (ch, r) => { events.push(`close:${ch}`); bridge.onClose(ch, r); },
        onLinkLost: (i) => { events.push("link-lost"); bridge.onLinkLost(i); },
        onLinkTerminated: (i) => { events.push(`term:${i.cause}`); bridge.onLinkTerminated(i); }
      };
      const client = new TrunkClient({
        root: iso.root, env: () => envRef,
        enrolment: { meshId: MESH, endpoint: ENDPOINT, tenantId: TENANT, enrolmentRef: "enr-lt", nodeId: key.nodeId },
        nodeKeyOptions: { configDir: iso.configDir, env: iso.env },
        connector: peer.createConnector("lt-client"),
        contract, clock, catalogue: projector, terminalConsumer: consumer
      });
      await trigger({ client, peer, clock, setEnv: (e) => { envRef = e; }, events });
      bridge.dispose();
      projector.stopWatch();
      return events;
    };

    // revoked
    {
      const ev = await runCause(async ({ client, peer, clock: clk }) => {
        client.start();
        const conn = peer.allConnections()[0];
        peer.sendWatchStart(conn);
        await clk.advance(10);
        peer.sendTermOpen(conn, { ch: 2, sid: nativeCatalogueSid("h2a-lt"), mode: "observe", afterSeq: null, receivedSegBytes: 0 });
        await clk.advance(20);
        peer.sendRevoked(conn, "owner-revoke");
        await clk.advance(10);
      });
      assert.deepEqual(ev, ["close:2", "term:revoked"]);
    }

    // superseded
    {
      const ev = await runCause(async ({ client, peer, clock: clk }) => {
        client.start();
        const conn = peer.allConnections()[0];
        peer.sendRecord(conn, { t: "superseded", ch: 0, reason: "newer" });
        await clk.advance(10);
      });
      assert.deepEqual(ev, ["term:superseded"]);
    }

    // killed (in-flight kill record)
    {
      const ev = await runCause(async ({ client, peer, clock: clk }) => {
        client.start();
        const conn = peer.allConnections()[0];
        peer.sendKill(conn, "panic");
        await clk.advance(10);
      });
      assert.deepEqual(ev, ["term:killed"]);
      rmSync(join(iso.root, "remote-control", "kill"), { force: true });
    }

    // stopped
    {
      const ev = await runCause(async ({ client }) => {
        client.start();
        client.stop();
      });
      assert.deepEqual(ev, ["term:stopped"]);
    }

    // disabled in flight
    {
      const ev = await runCause(async ({ client, clock: clk, setEnv }) => {
        client.start();
        setEnv({ ...iso.env, H2A_REMOTE_CONTROL: "0" });
        await clk.advance(600);
      });
      assert.deepEqual(ev, ["term:disabled"]);
    }

    // auth-refused
    {
      const key = generateNodeKey({ configDir: iso.configDir, env: iso.env });
      const contract = createSimulatedTrunkContractProvider();
      const peer = new FakeBinaryTrunkPeer({ meshId: MESH, tenantId: TENANT, endpoint: ENDPOINT, clock, env: iso.env, contract });
      const projector = createCatalogueProjector({
        root: iso.root, configDir: iso.configDir, env: iso.env, clock,
        readNativeInventory: async () => host.inventory(), readPresences: () => []
      });
      const terms = [];
      const client = new TrunkClient({
        root: iso.root, env: iso.env,
        enrolment: { meshId: MESH, endpoint: ENDPOINT, tenantId: TENANT, enrolmentRef: "unknown-enr", nodeId: key.nodeId },
        nodeKeyOptions: { configDir: iso.configDir, env: iso.env },
        connector: peer.createConnector("auth-ref"),
        contract, clock, catalogue: projector,
        terminalConsumer: { onOpen() {}, onLinkTerminated(i) { terms.push(i.cause); } }
      });
      client.start();
      await clock.flushMicrotasks();
      assert.deepEqual(terms, ["auth-refused"]);
      projector.stopWatch();
    }
  } finally {
    cleanup(iso);
  }
});
