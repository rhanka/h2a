// LH-08 unit & protocol boundary suite: exact frame boundaries, coalescing,
// UTF-8 byte-level segmentation, gap re-sync, agent restart with empty range
// index, concurrent `off`, companion `*.h2a` guard, credit independence,
// numeric exit signal omission, and observe-only refusal of active commands.
// Every case runs under a disposable TMPDIR (never /tmp, never owner ~/.config).

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  mkdirSync,
  mkdtempSync,
  rmSync
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  CoalescedRangeIndex,
  TerminalOutputAssembler,
  TRUNK_RECORD_MAX_BYTES,
  canonicalTrunkJson,
  createCatalogueProjector,
  createTerminalBridge,
  generateNodeKey,
  nativeCatalogueSid,
  setSessionExcluded,
  TrunkClient
} from "../dist/runtime/remote-agent/index.js";
import {
  FakeBinaryTrunkPeer,
  createSimulatedTrunkContractProvider
} from "./helpers/remote-trunk-peer.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const H2A_BIN = join(REPO_ROOT, "packages", "h2a", "dist", "bin.js");
const MESH = "remote-test";
const TENANT = "tenant-a";
const ENDPOINT = "wss://remote.sent-tech.ca/trunk/v1";

class AsyncFakeClock {
  #now;
  #nextId = 1;
  #timers = new Map();

  constructor(startMs = Date.parse("2026-11-21T12:00:00.000Z")) {
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

  pendingCount() {
    return this.#timers.size;
  }

  async flushMicrotasks(rounds = 10) {
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
  const base = mkdtempSync(join(process.env.TMPDIR, "lh08-"));
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

class TestTerminalReceiver {
  appliedSeq = 0;
  receivedSegBytes = 0;
  paintCount = 0;
  text = "";
  screen = "";
  modePrefix = "";
  generation = null;
  incarnation = null;
  openedRecords = [];
  gapRecords = [];
  exitRecords = [];
  errRecords = [];
  closeRecords = [];
  ackRecords = [];
  ctlStateRecords = [];
  rawTermOut = [];
  #segBuffers = [];
  #segStreamOffset = 0;
  #decoder = new TextDecoder("utf-8", { fatal: true });
  #cutBeforeApply = null;

  setCutBeforeApply(fn) {
    this.#cutBeforeApply = fn;
  }

  openPayload(overrides = {}) {
    return {
      mode: "observe",
      afterSeq: this.appliedSeq === 0 && this.receivedSegBytes === 0 ? null : this.appliedSeq,
      receivedSegBytes: this.receivedSegBytes,
      ...overrides
    };
  }

  discardPartialSegment() {
    this.#segBuffers = [];
    this.#segStreamOffset = 0;
    this.receivedSegBytes = 0;
  }

  /**
   * Feed decoded records emitted on `ch`. Returns `true` if the test hook cut
   * the channel before applying a frame.
   */
  feedRecord(rec) {
    if (this.#cutBeforeApply && this.#cutBeforeApply(rec)) {
      return true;
    }
    this.applyRecord(rec);
    return false;
  }

  applyRecord(rec) {
    switch (rec.t) {
      case "term.gap":
        this.gapRecords.push(rec);
        break;
      case "term.opened": {
        this.openedRecords.push(rec);
        if (
          this.generation !== null &&
          (this.generation !== rec.generation || this.incarnation !== rec.incarnation)
        ) {
          this.appliedSeq = 0;
          this.discardPartialSegment();
          this.text = "";
          this.screen = "";
        }
        this.generation = rec.generation;
        this.incarnation = rec.incarnation;
        if (rec.gap) {
          this.text = "";
          this.screen = "[output skipped]\n";
          this.modePrefix = rec.modePrefix ?? "";
          this.appliedSeq = rec.gap.toSeq;
          this.discardPartialSegment();
        }
        break;
      }
      case "term.out": {
        this.rawTermOut.push(rec);
        const bytes = Buffer.from(rec.dataB64, "base64");
        if (rec.seg !== undefined) {
          if (rec.firstSeq !== rec.lastSeq) return;
          if (rec.firstSeq <= this.appliedSeq) return;
          if (rec.firstSeq !== this.appliedSeq + 1) return;
          if (rec.seg === 0) {
            this.#segStreamOffset = 0;
          }
          const already = this.#segBuffers.reduce((s, b) => s + b.byteLength, 0);
          if (this.#segStreamOffset + bytes.byteLength > already) {
            const skip = Math.max(0, already - this.#segStreamOffset);
            this.#segBuffers.push(bytes.subarray(skip));
          }
          this.#segStreamOffset += bytes.byteLength;
          this.receivedSegBytes = this.#segBuffers.reduce((s, b) => s + b.byteLength, 0);
          if (rec.segLast === true) {
            const whole = Buffer.concat(this.#segBuffers);
            const decoded = this.#decoder.decode(whole);
            this.text += decoded;
            this.screen += decoded;
            this.paintCount += 1;
            this.appliedSeq = rec.lastSeq;
            this.discardPartialSegment();
          }
          return;
        }
        if (rec.lastSeq <= this.appliedSeq) {
          // Already applied: ignore without re-painting.
          return;
        }
        if (rec.firstSeq !== this.appliedSeq + 1) {
          // Inconsistent overlap or forward hole: never paint suffix.
          return;
        }
        const decoded = this.#decoder.decode(bytes);
        this.text += decoded;
        this.screen += decoded;
        this.paintCount += 1;
        this.appliedSeq = rec.lastSeq;
        this.discardPartialSegment();
        break;
      }
      case "term.exit":
        this.exitRecords.push(rec);
        break;
      case "err":
        this.errRecords.push(rec);
        break;
      case "term.close":
        this.closeRecords.push(rec);
        break;
      case "term.in.ack":
        this.ackRecords.push(rec);
        break;
      case "term.ctl.state":
        this.ctlStateRecords.push(rec);
        break;
      default:
        break;
    }
  }
}

function makeFakeNativeHost(options = {}) {
  const sessions = new Map();
  const calls = {
    connects: [],
    attachObserver: [],
    state: [],
    readOutput: [],
    readOutputByClient: [],
    activeOps: []
  };
  let nextReadHold = null;
  let nextAttachHold = null;

  function setSession(id, data) {
    sessions.set(id, {
      id,
      generation: data.generation ?? "gen-1",
      incarnation: data.incarnation ?? "inc-1",
      pid: data.pid ?? 55000,
      cols: data.cols,
      rows: data.rows,
      status: data.status ?? "running",
      chunks: [...(data.chunks ?? [])],
      evictedThroughSeq: data.evictedThroughSeq ?? 0,
      terminalModePrefix: data.terminalModePrefix ?? "",
      exit: data.exit ?? null,
      stopSignal: data.stopSignal ?? null,
      controlled: data.controlled ?? false,
      holderKind: data.holderKind,
      controllerEpoch: data.controllerEpoch ?? 1,
      lastHumanActivityAt: data.lastHumanActivityAt ?? 1_700_000_000_000
    });
  }

  function snapshotState(s) {
    return {
      id: s.id,
      generation: s.generation,
      incarnation: s.incarnation,
      pid: s.pid,
      ...(s.cols !== undefined ? { cols: s.cols } : {}),
      ...(s.rows !== undefined ? { rows: s.rows } : {}),
      status: s.status,
      latestSeq: s.chunks.length > 0 ? s.chunks[s.chunks.length - 1].seq : s.evictedThroughSeq,
      exit: s.exit,
      stopSignal: s.stopSignal,
      controlled: s.controlled,
      ...(s.holderKind !== undefined ? { holderKind: s.holderKind } : {}),
      controllerEpoch: s.controllerEpoch,
      lastHumanActivityAt: s.lastHumanActivityAt
    };
  }

  function inventory() {
    return {
      complete: true,
      sessions: [...sessions.values()].map((s) => ({
        ...snapshotState(s),
        socketPath: options.socketPath ?? "/private/lh08.sock"
      }))
    };
  }

  function holdNextRead() {
    let release;
    const promise = new Promise((res) => {
      release = res;
    });
    nextReadHold = promise;
    return () => release();
  }

  function holdNextAttach() {
    let release;
    const promise = new Promise((res) => {
      release = res;
    });
    nextAttachHold = promise;
    return () => release();
  }

  async function connectNativeClient(socketPath) {
    calls.connects.push(socketPath);
    const clientReadCounter = { count: 0 };
    calls.readOutputByClient.push(clientReadCounter);
    let closed = false;
    return {
      async attachObserver(id) {
        if (closed) throw new Error("closed");
        calls.attachObserver.push(id);
        if (nextAttachHold) {
          const h = nextAttachHold;
          nextAttachHold = null;
          await h;
        }
        if (closed) throw new Error("closed");
        const s = sessions.get(id);
        if (!s) throw new Error(`unknown terminal session: ${id}`);
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
        calls.state.push(id);
        const s = sessions.get(id);
        if (!s) throw new Error(`unknown terminal session: ${id}`);
        return snapshotState(s);
      },
      async readOutput(id, afterSeq) {
        if (closed) throw new Error("closed");
        calls.readOutput.push({ id, afterSeq });
        clientReadCounter.count += 1;
        if (nextReadHold) {
          const h = nextReadHold;
          nextReadHold = null;
          await h;
        }
        if (closed) throw new Error("closed");
        const s = sessions.get(id);
        if (!s) throw new Error(`unknown terminal session: ${id}`);
        const latestSeq = s.chunks.length > 0 ? s.chunks[s.chunks.length - 1].seq : s.evictedThroughSeq;
        if (afterSeq > latestSeq) {
          throw new RangeError("afterSeq must identify this buffer's history");
        }
        const oldest = s.chunks.length > 0 ? s.chunks[0].seq : latestSeq + 1;
        const gap = afterSeq < oldest - 1 ? { fromSeq: afterSeq + 1, toSeq: oldest - 1 } : null;
        return {
          generation: s.generation,
          incarnation: s.incarnation,
          chunks: s.chunks.filter((c) => c.seq > afterSeq),
          gap,
          latestSeq,
          ...(gap && s.terminalModePrefix ? { terminalModePrefix: s.terminalModePrefix } : {}),
          ...(options.omitEmbeddedState ? {} : { state: snapshotState(s) })
        };
      },
      close() {
        closed = true;
      }
    };
  }

  return { sessions, calls, setSession, snapshotState, inventory, holdNextRead, holdNextAttach, connectNativeClient };
}

function connectClientWithBridge(iso, host, clock, overrides = {}) {
  const key = generateNodeKey({ configDir: iso.configDir, env: iso.env });
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
    nodeId: key.nodeId,
    enrolmentRef: "enr-lh08",
    publicKeyPem: key.publicKeyPem,
    fingerprint: key.fingerprint
  });
  const projector = overrides.projector ?? createCatalogueProjector({
    root: iso.root,
    configDir: iso.configDir,
    env: iso.env,
    clock,
    readNativeInventory: async () => host.inventory(),
    readPresences: () => []
  });
  const rangeIndex = overrides.rangeIndex ?? new CoalescedRangeIndex();
  const bridge = createTerminalBridge({
    catalogue: projector,
    clock,
    rangeIndex,
    connectNativeClient: overrides.connectNativeClient ?? host.connectNativeClient
  });
  const client = new TrunkClient({
    root: iso.root,
    env: iso.env,
    enrolment: {
      meshId: MESH,
      endpoint: ENDPOINT,
      tenantId: TENANT,
      enrolmentRef: "enr-lh08",
      nodeId: key.nodeId
    },
    nodeKeyOptions: { configDir: iso.configDir, env: iso.env },
    connector: peer.createConnector("lh08-client"),
    contract,
    clock,
    catalogue: projector,
    terminalConsumer: bridge
  });
  assert.equal(client.start().ok, true);
  const conn = peer.allConnections()[0];
  return { key, contract, peer, projector, rangeIndex, bridge, client, conn };
}

function drainClientRecords(conn, ch, receiver, startIdx = 0) {
  let cut = false;
  let i = startIdx;
  for (; i < conn.decodedClientRecords.length; i++) {
    const rec = conn.decodedClientRecords[i];
    if (rec.ch !== ch) continue;
    if (receiver.feedRecord(rec)) {
      cut = true;
      i += 1;
      break;
    }
  }
  return { nextIdx: i, cut };
}

function grantChannelCredit(peer, conn, ch, deliveredCount, deliveredBytes, addRecords = 8, addBytes = 131_072) {
  peer.sendCredit(conn, ch, {
    receivedThroughSeq: deliveredCount,
    receivedThroughBytes: deliveredBytes,
    sendLimitSeq: deliveredCount + addRecords,
    sendLimitBytes: deliveredBytes + addBytes
  });
}

// ============================================================================
// 1. Ouverture et autorité
// ============================================================================

test("LH-08 open & authority: size 103x39, holderKind human/none, v1 host-upgrade-required, companion *.h2a, concurrent off", async () => {
  const iso = makeIsolation();
  try {
    const clock = new AsyncFakeClock();
    const host = makeFakeNativeHost({ socketPath: join(iso.runtimeDir, "h.sock") });
    host.setSession("h2a-x", {
      cols: 103,
      rows: 39,
      holderKind: "human",
      controlled: true,
      controllerEpoch: 7,
      lastHumanActivityAt: 1_700_000_000_123,
      chunks: [{ seq: 1, data: "hello\n" }]
    });
    host.setSession("h2a-x.h2a", {
      cols: 80,
      rows: 24,
      holderKind: "none",
      chunks: [{ seq: 1, data: "companion-secret\n" }]
    });
    host.setSession("h2a-noholder", {
      cols: 90,
      rows: 30,
      holderKind: "none",
      controlled: false,
      controllerEpoch: 2,
      chunks: []
    });
    host.setSession("h2a-legacy-v1", {
      // Missing cols, rows and holderKind
      controlled: false,
      controllerEpoch: 1,
      chunks: []
    });

    const { peer, projector, bridge, client, conn } = connectClientWithBridge(iso, host, clock);
    peer.sendWatchStart(conn);
    await clock.flushMicrotasks();

    const sidX = nativeCatalogueSid("h2a-x");
    const sidCompanion = nativeCatalogueSid("h2a-x.h2a");
    const sidNoHolder = nativeCatalogueSid("h2a-noholder");
    const sidLegacy = nativeCatalogueSid("h2a-legacy-v1");

    // 1a. Open with suggested 200x80 -> must return host 103x39, human holder, epoch 7
    const rx2 = new TestTerminalReceiver();
    peer.sendTermOpen(conn, { ch: 2, sid: sidX, mode: "observe", afterSeq: null, receivedSegBytes: 0, cols: 200, rows: 80 });
    grantChannelCredit(peer, conn, 2, 0, 0);
    await clock.advance(20);
    drainClientRecords(conn, 2, rx2);

    assert.equal(rx2.openedRecords.length, 1, "expected term.opened on ch=2");
    const opened2 = rx2.openedRecords[0];
    assert.equal(opened2.ch, 2);
    assert.equal(opened2.sid, sidX);
    assert.equal(opened2.generation, "gen-1");
    assert.equal(opened2.incarnation, "inc-1");
    assert.equal(opened2.controllerEpoch, 7);
    assert.equal(opened2.holderKind, "human");
    assert.deepEqual(opened2.size, { cols: 103, rows: 39 });
    // Host size, epoch, human activity, and holder must be untouched
    const postState = host.snapshotState(host.sessions.get("h2a-x"));
    assert.equal(postState.cols, 103);
    assert.equal(postState.rows, 39);
    assert.equal(postState.controllerEpoch, 7);
    assert.equal(postState.lastHumanActivityAt, 1_700_000_000_123);
    assert.equal(postState.holderKind, "human");
    assert.equal(rx2.text, "hello\n");
    peer.sendTermClose(conn, 2, sidX);

    // 1b. Open without holder -> holderKind="none"
    const rx3 = new TestTerminalReceiver();
    peer.sendTermOpen(conn, { ch: 3, sid: sidNoHolder, mode: "observe", afterSeq: null, receivedSegBytes: 0 });
    await clock.flushMicrotasks();
    drainClientRecords(conn, 3, rx3);
    assert.equal(rx3.openedRecords.length, 1);
    assert.equal(rx3.openedRecords[0].holderKind, "none");
    assert.deepEqual(rx3.openedRecords[0].size, { cols: 90, rows: 30 });
    peer.sendTermClose(conn, 3, sidNoHolder);

    // 1c. Legacy v1 host state lacking size or provenance -> err(host-upgrade-required)
    const rx4 = new TestTerminalReceiver();
    peer.sendTermOpen(conn, { ch: 4, sid: sidLegacy, mode: "observe", afterSeq: null, receivedSegBytes: 0 });
    await clock.flushMicrotasks();
    drainClientRecords(conn, 4, rx4);
    assert.equal(rx4.openedRecords.length, 0);
    assert.equal(rx4.errRecords.length, 1);
    assert.equal(rx4.errRecords[0].code, "host-upgrade-required");

    // 1d. Companion *.h2a computed sid -> err(unknown-session), 0 connects/attachObserver
    const connectsBeforeComp = host.calls.connects.length;
    const attachBeforeComp = host.calls.attachObserver.length;
    const rx5 = new TestTerminalReceiver();
    peer.sendTermOpen(conn, { ch: 5, sid: sidCompanion, mode: "observe", afterSeq: null, receivedSegBytes: 0 });
    await clock.flushMicrotasks();
    drainClientRecords(conn, 5, rx5);
    assert.equal(rx5.errRecords.length, 1);
    assert.equal(rx5.errRecords[0].code, "unknown-session");
    assert.equal(host.calls.connects.length, connectsBeforeComp);
    assert.equal(host.calls.attachObserver.length, attachBeforeComp);

    // 1e-bis. Concurrent `off` between resolveOpen and attachObserver -> 0 term.opened, 0 term.out
    const rxBetween = new TestTerminalReceiver();
    const releaseAttach = host.holdNextAttach();
    peer.sendTermOpen(conn, { ch: 8, sid: sidNoHolder, mode: "observe", afterSeq: null, receivedSegBytes: 0 });
    grantChannelCredit(peer, conn, 8, 0, 0);
    await clock.flushMicrotasks();
    const offBetween = spawnSync(
      process.execPath,
      [H2A_BIN, "remote", "off", sidNoHolder, "--root", iso.root],
      { env: iso.env, encoding: "utf8" }
    );
    assert.equal(offBetween.status, 0, offBetween.stderr);
    releaseAttach();
    await clock.advance(20);
    drainClientRecords(conn, 8, rxBetween);
    assert.equal(rxBetween.openedRecords.length, 0, "no term.opened after off between resolve and attach");
    assert.equal(conn.receivedTermOut.get(8)?.length ?? 0, 0, "no term.out after off between resolve and attach");
    assert.ok(rxBetween.errRecords.some((e) => e.code === "excluded"));

    // 1e. Suspended read-output + cross-process `off` -> 0 new outbound term.out after off
    const rx6 = new TestTerminalReceiver();
    const releaseRead = host.holdNextRead();
    peer.sendTermOpen(conn, { ch: 6, sid: sidX, mode: "observe", afterSeq: null, receivedSegBytes: 0 });
    grantChannelCredit(peer, conn, 6, 0, 0);
    await clock.flushMicrotasks();
    const outCountBeforeOff = conn.receivedTermOut.get(6)?.length ?? 0;
    const offSpawn = spawnSync(
      process.execPath,
      [H2A_BIN, "remote", "off", sidX, "--root", iso.root],
      { env: iso.env, encoding: "utf8" }
    );
    assert.equal(offSpawn.status, 0, offSpawn.stderr);
    releaseRead();
    await clock.advance(50);
    drainClientRecords(conn, 6, rx6);
    assert.equal(conn.receivedTermOut.get(6)?.length ?? 0, outCountBeforeOff, "no output may be emitted after off");
    assert.ok(rx6.errRecords.some((e) => e.code === "excluded"));

    // 1f. Already excluded session -> 0 socket connects on open
    const connectsBeforeExcl = host.calls.connects.length;
    const rx7 = new TestTerminalReceiver();
    peer.sendTermOpen(conn, { ch: 7, sid: sidX, mode: "observe", afterSeq: null, receivedSegBytes: 0 });
    await clock.flushMicrotasks();
    drainClientRecords(conn, 7, rx7);
    assert.equal(host.calls.connects.length, connectsBeforeExcl);
    assert.ok(rx7.errRecords.some((e) => e.code === "excluded"));

    bridge.dispose();
    projector.stopWatch();
    client.stop();
  } finally {
    cleanup(iso);
  }
});

// ============================================================================
// 2. Bornes du record (16 383 / 16 384 / 16 385, 15ms/16ms, ESC-dense, silent tail)
// ============================================================================

test("LH-08 record bounds: coalescer splits at 16384B and 16ms, segments 16385B, handles ESC-dense, flushes silent tail", async () => {
  const rangeIndex = new CoalescedRangeIndex();
  const assembler = new TerminalOutputAssembler({
    sid: nativeCatalogueSid("h2a-bounds"),
    generation: "g1",
    incarnation: "i1",
    afterSeq: 0,
    receivedSegBytes: 0,
    rangeIndex
  });

  // Push small chunks totaling 16 383 B then a 2-byte chunk (would hit 16 385 B > 16 384 B)
  assembler.pushChunks([
    { seq: 1, data: "a".repeat(16_380) },
    { seq: 2, data: "bbb" },
    { seq: 3, data: "cc" }
  ], 1_000);

  // At t=1000 (0 ms elapsed), [1..2] (16 383 B) MUST flush immediately because chunk 3 would exceed 16 384 B
  const p1 = assembler.peekNextProposal({ nowMs: 1_000 });
  assert.ok(p1, "must propose coalesced [1..2] before overflowing chunk 3");
  assert.equal(p1.firstSeq, 1);
  assert.equal(p1.lastSeq, 2);
  assert.equal(p1.rawBytes, 16_383);
  assert.equal(p1.isSegmented, false);
  assembler.consumeNextProposal(p1);

  // Next chunk: seq 3 (2 B) alone waits 15 ms -> NOT flushed; at 16 ms -> flushed even if silent
  assert.equal(assembler.peekNextProposal({ nowMs: 1_015 }), null, "must wait before 16ms threshold");
  const p2 = assembler.peekNextProposal({ nowMs: 1_016 });
  assert.ok(p2, "must flush final small group at 16ms even when PTY is silent");
  assert.equal(p2.firstSeq, 3);
  assert.equal(p2.lastSeq, 3);
  assert.equal(p2.rawBytes, 2);
  assembler.consumeNextProposal(p2);

  // Exact 16 384 B ESC-dense chunk -> single unsegmented record <= 32 768 JCS bytes
  const escDense = "\x1b[31m".repeat(3276) + "abcd"; // 3276 * 5 + 4 = 16384
  assert.equal(Buffer.byteLength(escDense, "utf8"), 16_384);
  assembler.pushChunks([{ seq: 4, data: escDense }], 2_000);
  const p3 = assembler.peekNextProposal({ nowMs: 2_016 });
  assert.ok(p3);
  assert.equal(p3.isSegmented, false);
  assert.equal(p3.rawBytes, 16_384);
  const jcsLen3 = Buffer.byteLength(canonicalTrunkJson({ v: 1, ch: 2, s: 1, ...p3.record }), "utf8");
  assert.ok(jcsLen3 <= TRUNK_RECORD_MAX_BYTES, `JCS length ${jcsLen3} must be <= ${TRUNK_RECORD_MAX_BYTES}`);
  assembler.consumeNextProposal(p3);

  // 16 385 B chunk -> segmented into 16 384 + 1 bytes
  assembler.pushChunks([{ seq: 5, data: "z".repeat(16_385) }], 3_000);
  const p4 = assembler.peekNextProposal({ nowMs: 3_000 });
  assert.ok(p4);
  assert.equal(p4.isSegmented, true);
  assert.equal(p4.firstSeq, 5);
  assert.equal(p4.lastSeq, 5);
  assert.equal(p4.seg, 0);
  assert.equal(p4.isFinalSegment, false);
  assert.equal(p4.rawBytes, 16_384);
  const jcsLen4 = Buffer.byteLength(canonicalTrunkJson({ v: 1, ch: 2, s: 2, ...p4.record }), "utf8");
  assert.ok(jcsLen4 <= TRUNK_RECORD_MAX_BYTES);
  assembler.consumeNextProposal(p4);

  const p5 = assembler.peekNextProposal({ nowMs: 3_000 });
  assert.ok(p5);
  assert.equal(p5.isSegmented, true);
  assert.equal(p5.seg, 1);
  assert.equal(p5.isFinalSegment, true);
  assert.equal(p5.rawBytes, 1);
  assembler.consumeNextProposal(p5);
});

// ============================================================================
// 3. Ordre, reprise atomique, redémarrage agent, UTF-8 et éviction
// ============================================================================

test("LH-08 atomic coalesced cut, duplicate stability, agent restart empty index, UTF-8 straddle & gap repaint", async () => {
  const iso = makeIsolation();
  try {
    const clock = new AsyncFakeClock();
    const host = makeFakeNativeHost({ socketPath: join(iso.runtimeDir, "h.sock") });
    const sid = nativeCatalogueSid("h2a-flow");

    // Seed 3 consecutive small chunks -> coalesced [1..3]
    host.setSession("h2a-flow", {
      cols: 120,
      rows: 40,
      holderKind: "none",
      chunks: [
        { seq: 1, data: "line-1\n" },
        { seq: 2, data: "line-2\n" },
        { seq: 3, data: "line-3\n" }
      ]
    });

    const envBundle = connectClientWithBridge(iso, host, clock);
    envBundle.peer.sendWatchStart(envBundle.conn);
    await clock.flushMicrotasks();

    const rx = new TestTerminalReceiver();
    // Cut AFTER receiving coalesced [1..3] and BEFORE applying it
    rx.setCutBeforeApply((rec) => rec.t === "term.out" && rec.firstSeq === 1 && rec.lastSeq === 3);

    envBundle.peer.sendTermOpen(envBundle.conn, { ch: 2, sid, ...rx.openPayload() });
    grantChannelCredit(envBundle.peer, envBundle.conn, 2, 0, 0);
    await clock.advance(32);
    const res1 = drainClientRecords(envBundle.conn, 2, rx);
    assert.equal(res1.cut, true, "receiver must have intercepted coalesced [1..3] before apply");
    assert.equal(rx.appliedSeq, 0);
    assert.equal(rx.paintCount, 0);
    envBundle.peer.sendTermClose(envBundle.conn, 2, sid);
    await clock.flushMicrotasks();

    // Add chunk 4 and reopen on ch=3 -> must receive exact [1..3] range first, then 4
    host.sessions.get("h2a-flow").chunks.push({ seq: 4, data: "line-4\n" });
    rx.setCutBeforeApply(null);
    envBundle.peer.sendTermOpen(envBundle.conn, { ch: 3, sid, ...rx.openPayload() });
    grantChannelCredit(envBundle.peer, envBundle.conn, 3, 0, 0);
    await clock.advance(32);
    drainClientRecords(envBundle.conn, 3, rx);

    const coalescedFirst = rx.rawTermOut.find((r) => r.firstSeq === 1 && r.lastSeq === 3);
    assert.ok(coalescedFirst, "reopen must replay exact frozen coalesced range [1..3]");
    assert.equal(rx.appliedSeq, 4);
    assert.equal(rx.text, "line-1\nline-2\nline-3\nline-4\n");
    const paintsAfter4 = rx.paintCount;

    // Re-deliver already applied [1..3] -> paintCount & screen unchanged
    rx.applyRecord(coalescedFirst);
    assert.equal(rx.paintCount, paintsAfter4);
    assert.equal(rx.text, "line-1\nline-2\nline-3\nline-4\n");
    envBundle.peer.sendTermClose(envBundle.conn, 3, sid);

    // --- Agent restart with empty range index ---
    envBundle.bridge.dispose();
    envBundle.projector.stopWatch();
    envBundle.client.stop();

    host.sessions.get("h2a-flow").chunks.push({ seq: 5, data: "line-5\n" });
    const restarted = connectClientWithBridge(iso, host, clock, { rangeIndex: new CoalescedRangeIndex() });
    restarted.peer.sendWatchStart(restarted.conn);
    await clock.flushMicrotasks();

    // Reopen at appliedSeq=4, receivedSegBytes=0 -> receives ONLY seq 5
    restarted.peer.sendTermOpen(restarted.conn, { ch: 2, sid, mode: "observe", afterSeq: 4, receivedSegBytes: 0 });
    grantChannelCredit(restarted.peer, restarted.conn, 2, 0, 0);
    await clock.advance(32);
    drainClientRecords(restarted.conn, 2, rx);
    assert.equal(rx.appliedSeq, 5);
    assert.equal(rx.text, "line-1\nline-2\nline-3\nline-4\nline-5\n");
    restarted.peer.sendTermClose(restarted.conn, 2, sid);

    // Reopen at state.latestSeq (5) with receivedSegBytes=0 -> immediate term.opened, 0 output, 0 readOutput
    const readsBeforeLatest = host.calls.readOutput.length;
    const rxLatest = new TestTerminalReceiver();
    restarted.peer.sendTermOpen(restarted.conn, { ch: 3, sid, mode: "observe", afterSeq: 5, receivedSegBytes: 0 });
    await clock.flushMicrotasks();
    drainClientRecords(restarted.conn, 3, rxLatest);
    assert.equal(rxLatest.openedRecords.length, 1);
    assert.equal(rxLatest.rawTermOut.length, 0);
    assert.equal(host.calls.readOutput.length, readsBeforeLatest);
    restarted.peer.sendTermClose(restarted.conn, 3, sid);

    // Ahead cursor (afterSeq=99) & invalid positive offset -> err(resume-unavailable)
    const rxAhead = new TestTerminalReceiver();
    restarted.peer.sendTermOpen(restarted.conn, { ch: 4, sid, mode: "observe", afterSeq: 99, receivedSegBytes: 0 });
    await clock.flushMicrotasks();
    drainClientRecords(restarted.conn, 4, rxAhead);
    assert.equal(rxAhead.errRecords[0]?.code, "resume-unavailable");

    const rxBadOff = new TestTerminalReceiver();
    restarted.peer.sendTermOpen(restarted.conn, { ch: 5, sid, mode: "observe", afterSeq: 5, receivedSegBytes: 10 });
    await clock.flushMicrotasks();
    drainClientRecords(restarted.conn, 5, rxBadOff);
    assert.equal(rxBadOff.errRecords[0]?.code, "resume-unavailable");

    // --- UTF-8 straddling segment boundary: 16 383 ASCII + 😀 (4B) + "-TAIL" ---
    const emojiStr = "A".repeat(16_383) + "😀" + "-TAIL";
    host.sessions.get("h2a-flow").chunks.push({ seq: 6, data: emojiStr });
    rx.setCutBeforeApply((rec) => {
      if (rec.t === "term.out" && rec.firstSeq === 6 && rec.seg === 1) {
        return true; // cut right after seg=0 was applied to receiver buffer
      }
      return false;
    });
    restarted.peer.sendTermOpen(restarted.conn, { ch: 6, sid, mode: "observe", afterSeq: 5, receivedSegBytes: 0 });
    grantChannelCredit(restarted.peer, restarted.conn, 6, 0, 0);
    await clock.advance(32);
    const resSeg = drainClientRecords(restarted.conn, 6, rx);
    assert.equal(resSeg.cut, true);
    assert.equal(rx.receivedSegBytes, 16_384);
    assert.equal(rx.appliedSeq, 5);
    restarted.peer.sendTermClose(restarted.conn, 6, sid);

    // Reopen with afterSeq=5, receivedSegBytes=16384 -> restarts from seg=0, receiver strips prefix, zero \uFFFD
    rx.setCutBeforeApply(null);
    const paintsBeforeEmoji = rx.paintCount;
    restarted.peer.sendTermOpen(restarted.conn, { ch: 7, sid, ...rx.openPayload() });
    grantChannelCredit(restarted.peer, restarted.conn, 7, 0, 0);
    await clock.advance(32);
    drainClientRecords(restarted.conn, 7, rx);
    assert.equal(rx.appliedSeq, 6);
    assert.equal(rx.paintCount, paintsBeforeEmoji + 1);
    assert.equal(rx.text.includes("\uFFFD"), false);
    assert.ok(rx.text.endsWith(emojiStr));
    restarted.peer.sendTermClose(restarted.conn, 7, sid);

    // Replay same segmented chunk with receivedSegBytes=0 (receiver lost prefix)
    const rxFreshSeg = new TestTerminalReceiver();
    rxFreshSeg.appliedSeq = 5;
    restarted.peer.sendTermOpen(restarted.conn, { ch: 8, sid, mode: "observe", afterSeq: 5, receivedSegBytes: 0 });
    grantChannelCredit(restarted.peer, restarted.conn, 8, 0, 0);
    await clock.advance(32);
    drainClientRecords(restarted.conn, 8, rxFreshSeg);
    assert.equal(rxFreshSeg.text, emojiStr);
    restarted.peer.sendTermClose(restarted.conn, 8, sid);

    // --- Eviction -> term.gap -> term.opened (modePrefix) -> repaint ---
    const sFlow = host.sessions.get("h2a-flow");
    sFlow.evictedThroughSeq = 9;
    sFlow.terminalModePrefix = "\x1b[?2004h";
    sFlow.chunks = [{ seq: 10, data: "post-gap-screen\n" }];
    const rxGap = new TestTerminalReceiver();
    rxGap.appliedSeq = 2;
    rxGap.text = "stale-fragment";
    rxGap.screen = "stale-fragment";
    restarted.peer.sendTermOpen(restarted.conn, { ch: 9, sid, mode: "observe", afterSeq: 2, receivedSegBytes: 0 });
    grantChannelCredit(restarted.peer, restarted.conn, 9, 0, 0);
    await clock.advance(32);
    drainClientRecords(restarted.conn, 9, rxGap);
    assert.equal(rxGap.gapRecords.length, 1);
    assert.deepEqual({ fromSeq: rxGap.gapRecords[0].fromSeq, toSeq: rxGap.gapRecords[0].toSeq }, { fromSeq: 3, toSeq: 9 });
    assert.equal(rxGap.openedRecords.length, 1);
    assert.equal(rxGap.openedRecords[0].modePrefix, "\x1b[?2004h");
    assert.ok(rxGap.screen.includes("[output skipped]"));
    assert.equal(rxGap.screen.includes("stale-fragment"), false);
    assert.ok(rxGap.screen.endsWith("post-gap-screen\n"));

    restarted.bridge.dispose();
    restarted.projector.stopWatch();
    restarted.client.stop();
  } finally {
    cleanup(iso);
  }
});

// ============================================================================
// 4. Crédit indépendant, exit numeric signal vs omitted, et innocuité active
// ============================================================================

test("LH-08 credit independence, term.exit signal number vs omitted on stopSignal, and active commands refused", async () => {
  const iso = makeIsolation();
  try {
    const clock = new AsyncFakeClock();
    const host = makeFakeNativeHost({ socketPath: join(iso.runtimeDir, "h.sock") });
    const sid = nativeCatalogueSid("h2a-exit");
    host.setSession("h2a-exit", {
      cols: 80,
      rows: 24,
      holderKind: "none",
      chunks: [{ seq: 1, data: "c1\n" }]
    });

    const { peer, projector, bridge, client, conn } = connectClientWithBridge(iso, host, clock);
    peer.sendWatchStart(conn);
    await clock.flushMicrotasks();

    // Two observers on ch=2 (zero credit after 1 record) and ch=3 (ample credit)
    const rx2 = new TestTerminalReceiver();
    const rx3 = new TestTerminalReceiver();
    peer.sendTermOpen(conn, { ch: 2, sid, mode: "observe", afterSeq: null, receivedSegBytes: 0 });
    peer.sendTermOpen(conn, { ch: 3, sid, mode: "observe", afterSeq: null, receivedSegBytes: 0 });
    grantChannelCredit(peer, conn, 2, 0, 0, 1, 100);
    grantChannelCredit(peer, conn, 3, 0, 0, 8, 131_072);
    await clock.advance(32);
    drainClientRecords(conn, 2, rx2);
    drainClientRecords(conn, 3, rx3);
    assert.equal(rx2.text, "c1\n");
    assert.equal(rx3.text, "c1\n");

    // Exhausted credit on ch=2: advance 60s, ch=2 issues 0 new readOutput calls while ch=3 continues
    const ch2ReadCounter = host.calls.readOutputByClient[0];
    const ch3ReadCounter = host.calls.readOutputByClient[1];
    const ch2ReadsBeforePause = ch2ReadCounter.count;
    const ch3ReadsBeforePause = ch3ReadCounter.count;
    host.sessions.get("h2a-exit").chunks.push({ seq: 2, data: "c2\n" });
    await clock.advance(60_000);
    drainClientRecords(conn, 2, rx2);
    drainClientRecords(conn, 3, rx3);
    assert.equal(rx2.text, "c1\n");
    assert.equal(rx3.text, "c1\nc2\n");
    assert.equal(ch2ReadCounter.count, ch2ReadsBeforePause, "blocked ch=2 must issue zero read-output calls during pause");
    assert.ok(ch3ReadCounter.count > ch3ReadsBeforePause, "unblocked ch=3 continues reading");

    // Active commands on observe view -> refused, view stays alive
    peer.sendTermOpen(conn, { ch: 4, sid, mode: "control", afterSeq: null, receivedSegBytes: 0 });
    peer.sendRecord(conn, { t: "term.in", ch: 3, sid, generation: "gen-1", incarnation: "inc-1", epoch: 1, inSeq: 1, origin: "user", dataB64: Buffer.from("ls\n").toString("base64") });
    peer.sendRecord(conn, { t: "term.ctl", ch: 3, sid, action: "acquire" });
    peer.sendRecord(conn, { t: "term.resize", ch: 3, sid, cols: 100, rows: 50 });
    peer.sendRecord(conn, { t: "term.stop", ch: 3, sid, incarnation: "inc-1" });
    await clock.flushMicrotasks();
    const rx4 = new TestTerminalReceiver();
    drainClientRecords(conn, 4, rx4);
    assert.equal(rx4.errRecords[0]?.code, "control-unavailable");
    drainClientRecords(conn, 3, rx3);
    assert.equal(rx3.ackRecords.some((a) => a.inSeq === 1 && a.result === "refused"), true);
    assert.ok(rx3.errRecords.length > 0 || rx3.ctlStateRecords.length > 0);
    assert.equal(host.calls.activeOps.length, 0);

    // View ch=3 still alive after refusals -> receives exit with signal=15
    host.sessions.get("h2a-exit").status = "exited";
    host.sessions.get("h2a-exit").exit = { exitCode: 143, signal: 15 };
    host.sessions.get("h2a-exit").stopSignal = "SIGTERM";
    await clock.advance(32);
    drainClientRecords(conn, 3, rx3);
    assert.equal(rx3.exitRecords.length, 1);
    assert.equal(rx3.exitRecords[0].signal, 15);
    assert.equal(rx3.exitRecords[0].exitCode, 143);

    // Second session exiting WITHOUT numeric signal even though stopSignal="SIGTERM"
    const sidNoSig = nativeCatalogueSid("h2a-nosig");
    host.setSession("h2a-nosig", {
      cols: 80,
      rows: 24,
      holderKind: "none",
      chunks: [{ seq: 1, data: "bye\n" }]
    });
    await clock.advance(2_050);
    const rxNoSig = new TestTerminalReceiver();
    peer.sendTermOpen(conn, { ch: 5, sid: sidNoSig, mode: "observe", afterSeq: null, receivedSegBytes: 0 });
    grantChannelCredit(peer, conn, 5, 0, 0);
    await clock.advance(32);
    host.sessions.get("h2a-nosig").status = "exited";
    host.sessions.get("h2a-nosig").exit = { exitCode: 0 };
    host.sessions.get("h2a-nosig").stopSignal = "SIGTERM";
    await clock.advance(32);
    drainClientRecords(conn, 5, rxNoSig);
    assert.equal(rxNoSig.exitRecords.length, 1);
    assert.equal("signal" in rxNoSig.exitRecords[0], false, "signal property must be omitted when non-numeric");
    assert.equal(rxNoSig.exitRecords[0].exitCode, 0);

    bridge.dispose();
    projector.stopWatch();
    client.stop();
  } finally {
    cleanup(iso);
  }
});

test("LH-08 R11 inc-0: term.open requires receivedSegBytes and rejects legacy field", async () => {
  const iso = makeIsolation();
  try {
    const clock = new AsyncFakeClock();
    const host = makeFakeNativeHost({ socketPath: join(iso.runtimeDir, "h.sock") });
    host.setSession("h2a-r11", {
      cols: 80,
      rows: 24,
      holderKind: "none",
      chunks: [{ seq: 1, data: "ok\n" }]
    });

    const { peer, projector, bridge, client, conn } = connectClientWithBridge(iso, host, clock);
    peer.sendWatchStart(conn);
    await clock.flushMicrotasks();
    const sid = nativeCatalogueSid("h2a-r11");

    // 1. term.open with receivedSegBytes: 0 and without the legacy field -> must open
    const rx = new TestTerminalReceiver();
    peer.sendRecord(conn, {
      t: "term.open",
      ch: 2,
      sid,
      mode: "observe",
      afterSeq: null,
      receivedSegBytes: 0
    });
    grantChannelCredit(peer, conn, 2, 0, 0);
    await clock.advance(32);
    drainClientRecords(conn, 2, rx);
    assert.equal(rx.openedRecords.length, 1, "term.open with receivedSegBytes must emit term.opened");
    assert.equal(conn.closed, false);

    // 2. term.open carrying only the legacy field -> must close link on invalid-record
    const client2Bundle = (() => {
      bridge.dispose();
      projector.stopWatch();
      client.stop();
      return connectClientWithBridge(iso, host, clock);
    })();
    client2Bundle.peer.sendWatchStart(client2Bundle.conn);
    await clock.flushMicrotasks();
    const legacyKey = ["after", "Seq", "Bytes"].join("");
    client2Bundle.peer.sendRecord(client2Bundle.conn, {
      t: "term.open",
      ch: 2,
      sid,
      mode: "observe",
      afterSeq: null,
      [legacyKey]: 0
    });
    await clock.flushMicrotasks();
    assert.equal(client2Bundle.conn.closed, true, "term.open with legacy field only must close link");
    assert.equal(client2Bundle.client.readLinkStatus()?.reason, "invalid-record");

    client2Bundle.bridge.dispose();
    client2Bundle.projector.stopWatch();
    client2Bundle.client.stop();
  } finally {
    cleanup(iso);
  }
});
