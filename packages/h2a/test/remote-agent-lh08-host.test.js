// LH-08 real-host end-to-end suite: real NativeTerminalHost on a private Unix
// socket + real node-pty child + real NativeTerminalClient witness + real
// screen rendering (`renderTerminalScreen` + `TerminalModeTracker`) +
// FakeBinaryTrunkPeer + LH-06 projector & exclusions.
// Runs in a disposable TMPDIR with isolated HOME/XDG/socket (never /tmp,
// never owner ~/.config or real native sockets).

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import test from "node:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  CoalescedRangeIndex,
  createCatalogueProjector,
  createTerminalBridge,
  defaultConnectNativeObserverClient,
  generateNodeKey,
  nativeCatalogueSid,
  TrunkClient
} from "../dist/runtime/remote-agent/index.js";
import {
  FakeBinaryTrunkPeer,
  createSimulatedTrunkContractProvider
} from "./helpers/remote-trunk-peer.js";

const { NativeTerminalClient } = await import("../../h2a-runtime/dist/native-terminal/client.js");
const { renderTerminalScreen } = await import("../../h2a-runtime/dist/native-terminal/screen.js");
const { listNativeInventoryForRemote } = await import("../../h2a-runtime/dist/native-terminal/remote-inventory.js");

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const RUNTIME_DIST = join(REPO_ROOT, "packages", "h2a-runtime", "dist");
const H2A_BIN = join(REPO_ROOT, "packages", "h2a", "dist", "bin.js");
const MESH = "remote-test";
const TENANT = "tenant-a";
const ENDPOINT = "wss://remote.sent-tech.ca/trunk/v1";

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function eventually(read, accept, label, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const val = await read();
    if (accept(val)) return val;
    assert.ok(Date.now() < deadline, `${label}: ${JSON.stringify(val)}`);
    await delay(20);
  }
}

class RealClock {
  now() {
    return Date.now();
  }
  setTimeout(fn, ms) {
    const t = setTimeout(fn, ms);
    t.unref?.();
    return t;
  }
  clearTimeout(handle) {
    clearTimeout(handle);
  }
}

function makeHostFixture(t, prefix = "lh08h-") {
  assert.ok(process.env.TMPDIR && resolve(process.env.TMPDIR) !== "/tmp", "Supply a disposable TMPDIR");
  const root = mkdtempSync(join(process.env.TMPDIR, prefix));
  const home = join(root, "h");
  const xdgConfigHome = join(root, "c");
  const configDir = join(xdgConfigHome, "sentropic", "h2a");
  const stateDir = join(root, "s");
  const storeDir = join(root, "r");
  const tmpDir = join(root, "t");
  for (const d of [home, configDir, stateDir, storeDir, tmpDir]) {
    mkdirSync(d, { recursive: true, mode: 0o700 });
  }
  const socketPath = join(root, "h.sock");
  const registryPath = join(root, "reg.json");
  const hostLogPath = join(stateDir, "host.log");
  const env = {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    TERM: "xterm-256color",
    HOME: home,
    XDG_RUNTIME_DIR: root,
    XDG_CONFIG_HOME: xdgConfigHome,
    XDG_STATE_HOME: stateDir,
    REMOTE_CLI_CONFIG_HOME: configDir,
    TMPDIR: tmpDir,
    TMP: tmpDir,
    TEMP: tmpDir,
    TMUX: "",
    TMUX_TMPDIR: root,
    H2A_ROOT: storeDir,
    H2A_NATIVE_SOCKET: socketPath,
    H2A_NATIVE_HOST_LOG: hostLogPath,
    DBUS_SESSION_BUS_ADDRESS: `unix:path=${join(root, "no-bus")}`,
    H2A_REMOTE_CONTROL: "1",
    H2A_TEST_FAKES: "1"
  };

  const children = [];
  const clients = [];

  async function startHost(sock = socketPath, reg = registryPath) {
    const hostProc = spawn(
      process.execPath,
      [join(RUNTIME_DIST, "native-terminal/process.js"), "--socket", sock, "--registry-path", reg],
      { env: { ...env, H2A_NATIVE_SOCKET: sock }, cwd: root, stdio: ["pipe", "pipe", "pipe"] }
    );
    children.push(hostProc);
    let output = "";
    hostProc.stdout.on("data", (b) => { output += b; });
    hostProc.stderr.on("data", (b) => { output += b; });
    await eventually(
      () => ({ output, code: hostProc.exitCode, sig: hostProc.signalCode }),
      (v) => v.output.includes("h2a.native-terminal.ready") || v.code !== null || v.sig !== null,
      "native host readiness",
      15_000
    );
    assert.ok(output.includes("h2a.native-terminal.ready"), `host failed to start: ${output}`);
    const client = await NativeTerminalClient.connect(sock);
    clients.push(client);
    return { hostProc, client, socketPath: sock, output: () => output };
  }

  t.after(async () => {
    for (const c of clients) {
      try { c.close(); } catch { /* ignore */ }
    }
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) {
        try { child.kill("SIGTERM"); } catch { /* ignore */ }
        await Promise.race([once(child, "exit"), delay(1_000)]);
        if (child.exitCode === null && child.signalCode === null) {
          try { child.kill("SIGKILL"); } catch { /* ignore */ }
          await Promise.race([once(child, "exit"), delay(1_000)]);
        }
      }
    }
    rmSync(root, { recursive: true, force: true });
  });

  return { root, home, configDir, stateDir, storeDir, socketPath, registryPath, hostLogPath, env, startHost };
}

class HostReceiver {
  appliedSeq = 0;
  receivedSegBytes = 0;
  paintCount = 0;
  text = "";
  screenText = "";
  openedRecords = [];
  gapRecords = [];
  exitRecords = [];
  errRecords = [];
  closeRecords = [];
  ackRecords = [];
  rawTermOut = [];
  #segBuffers = [];
  #segStreamOffset = 0;
  #decoder = new TextDecoder("utf-8", { fatal: true });
  #cutBeforeApply = null;
  #cursor = 0;

  setCutBeforeApply(fn) {
    this.#cutBeforeApply = fn;
  }

  discardPartialSegment() {
    this.#segBuffers = [];
    this.#segStreamOffset = 0;
    this.receivedSegBytes = 0;
  }

  drain(conn, ch) {
    let cut = false;
    while (this.#cursor < conn.decodedClientRecords.length) {
      const rec = conn.decodedClientRecords[this.#cursor++];
      if (rec.ch !== ch) continue;
      if (this.#cutBeforeApply && this.#cutBeforeApply(rec)) {
        cut = true;
        break;
      }
      this.apply(rec);
    }
    return cut;
  }

  apply(rec) {
    if (rec.t === "term.gap") this.gapRecords.push(rec);
    else if (rec.t === "term.opened") {
      this.openedRecords.push(rec);
      if (rec.gap) {
        this.text = rec.modePrefix ?? "";
        this.screenText = `[output skipped]\n${rec.modePrefix ?? ""}`;
        this.appliedSeq = rec.gap.toSeq;
        this.discardPartialSegment();
      }
    } else if (rec.t === "term.out") {
      this.rawTermOut.push(rec);
      const bytes = Buffer.from(rec.dataB64, "base64");
      if (rec.seg !== undefined) {
        if (rec.firstSeq !== rec.lastSeq || rec.firstSeq !== this.appliedSeq + 1) return;
        if (rec.seg === 0) this.#segStreamOffset = 0;
        const already = this.#segBuffers.reduce((s, b) => s + b.byteLength, 0);
        if (this.#segStreamOffset + bytes.byteLength > already) {
          const skip = Math.max(0, already - this.#segStreamOffset);
          this.#segBuffers.push(bytes.subarray(skip));
        }
        this.#segStreamOffset += bytes.byteLength;
        this.receivedSegBytes = this.#segBuffers.reduce((s, b) => s + b.byteLength, 0);
        if (rec.segLast === true) {
          const decoded = this.#decoder.decode(Buffer.concat(this.#segBuffers));
          this.text += decoded;
          this.screenText += decoded;
          this.paintCount += 1;
          this.appliedSeq = rec.lastSeq;
          this.discardPartialSegment();
        }
        return;
      }
      if (rec.lastSeq <= this.appliedSeq || rec.firstSeq !== this.appliedSeq + 1) return;
      const decoded = this.#decoder.decode(bytes);
      this.text += decoded;
      this.screenText += decoded;
      this.paintCount += 1;
      this.appliedSeq = rec.lastSeq;
      this.discardPartialSegment();
    } else if (rec.t === "term.exit") this.exitRecords.push(rec);
    else if (rec.t === "err") this.errRecords.push(rec);
    else if (rec.t === "term.close") this.closeRecords.push(rec);
    else if (rec.t === "term.in.ack") this.ackRecords.push(rec);
  }
}

function writeChildScript(root) {
  const scriptPath = join(root, "pty-child.mjs");
  const cmdFile = join(root, "child-cmd.json");
  const statusFile = join(root, "child-status.json");
  const inputLogFile = join(root, "child-input-bytes.txt");
  writeFileSync(
    scriptPath,
    `import { existsSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
const cmdFile = ${JSON.stringify(cmdFile)};
const statusFile = ${JSON.stringify(statusFile)};
const inputLogFile = ${JSON.stringify(inputLogFile)};
let inputBytes = 0;
let seq = 0;
let lastCmdId = 0;
let exitSentinel = null;
process.stdin.on("data", (buf) => {
  inputBytes += buf.byteLength;
  appendFileSync(inputLogFile, buf);
});
function publish(extra = {}) {
  writeFileSync(statusFile, JSON.stringify({ ready: true, seq, inputBytes, at: Date.now(), ...extra }));
}
publish();
setInterval(() => {
  if (existsSync(cmdFile)) {
    try {
      const cmd = JSON.parse(readFileSync(cmdFile, "utf8"));
      if (cmd.id > lastCmdId) {
        lastCmdId = cmd.id;
        if (cmd.action === "line") {
          seq += 1;
          process.stdout.write(cmd.text ?? ("LINE-" + seq + "\\n"));
        } else if (cmd.action === "burst") {
          const payload = "B".repeat(cmd.bytes ?? 65536) + "\\n";
          for (let i = 0; i < (cmd.count ?? 1); i++) {
            process.stdout.write(payload);
          }
        } else if (cmd.action === "dec-mode") {
          process.stdout.write("\\x1b[?2004h\\x1b[?1000hMODE-ON\\n");
        } else if (cmd.action === "exit") {
          exitSentinel = cmd.sentinel ?? null;
          if (exitSentinel) process.stdout.write(exitSentinel + "\\n");
          publish({ exiting: true });
          process.exit(cmd.code ?? 0);
        }
        publish({ lastCmdId });
      }
    } catch { /* ignore partial */ }
  } else {
    publish();
  }
}, 25);
`,
    "utf8"
  );
  return { scriptPath, cmdFile, statusFile, inputLogFile };
}

function setupRealBridge(fx, sockets) {
  const key = generateNodeKey({ configDir: fx.configDir, env: fx.env });
  const contract = createSimulatedTrunkContractProvider();
  const clock = new RealClock();
  const peer = new FakeBinaryTrunkPeer({
    meshId: MESH,
    tenantId: TENANT,
    endpoint: ENDPOINT,
    clock,
    env: fx.env,
    contract
  });
  peer.registerEnrolment({
    nodeId: key.nodeId,
    enrolmentRef: "enr-lh08-host",
    publicKeyPem: key.publicKeyPem,
    fingerprint: key.fingerprint
  });
  const projector = createCatalogueProjector({
    root: fx.storeDir,
    configDir: fx.configDir,
    env: fx.env,
    readNativeInventory: () => listNativeInventoryForRemote({ socketPaths: sockets(), connectTimeoutMs: 250, requestTimeoutMs: 250 }),
    readPresences: () => []
  });
  const rangeIndex = new CoalescedRangeIndex();
  const audits = [];
  const readOutputCountsByClient = [];
  const bridge = createTerminalBridge({
    catalogue: projector,
    rangeIndex,
    connectNativeClient: async (socketPath, opts) => {
      const client = await defaultConnectNativeObserverClient(socketPath, opts);
      const counter = { readOutputCalls: 0 };
      readOutputCountsByClient.push(counter);
      return {
        attachObserver: (id) => client.attachObserver(id),
        state: (id) => client.state(id),
        readOutput: (id, afterSeq, timeoutMs) => {
          counter.readOutputCalls += 1;
          return client.readOutput(id, afterSeq, timeoutMs);
        },
        close: () => client.close()
      };
    },
    onAudit: (ev) => audits.push(ev)
  });
  const client = new TrunkClient({
    root: fx.storeDir,
    env: fx.env,
    enrolment: {
      meshId: MESH,
      endpoint: ENDPOINT,
      tenantId: TENANT,
      enrolmentRef: "enr-lh08-host",
      nodeId: key.nodeId
    },
    nodeKeyOptions: { configDir: fx.configDir, env: fx.env },
    connector: peer.createConnector("lh08-host-client"),
    contract,
    clock,
    catalogue: projector,
    terminalConsumer: bridge
  });
  assert.equal(client.start().ok, true);
  const conn = peer.allConnections()[0];
  return { key, contract, peer, projector, rangeIndex, audits, readOutputCountsByClient, bridge, client, conn };
}

function sendChildCommand(cmdFile, id, action, extra = {}) {
  writeFileSync(cmdFile, JSON.stringify({ id, action, ...extra }), "utf8");
}

function readChildStatus(statusFile) {
  if (!existsSync(statusFile)) return null;
  try {
    return JSON.parse(readFileSync(statusFile, "utf8"));
  } catch {
    return null;
  }
}

// ============================================================================
// 1. Real PTY: authority, coalescing cut, agent restart, active-command safety
// ============================================================================

test("LH-08 host e2e: real PTY authority, coalescing cut, agent restart, zero input/acts on observe", { timeout: 60_000 }, async (t) => {
  const fx = makeHostFixture(t, "l8e2e-");
  const { client: witness, socketPath } = await fx.startHost();
  const child = writeChildScript(fx.root);
  const id = "h2a-real-1";
  const compId = "h2a-real-1.h2a";

  // Create real PTY at 103x39 with human holder, plus *.h2a companion
  await witness.create({ id, command: process.execPath, args: [child.scriptPath], cwd: fx.root, env: fx.env, cols: 103, rows: 39 });
  await witness.create({ id: compId, command: "/bin/cat", args: [], cwd: fx.root, env: fx.env, cols: 80, rows: 24 });
  const humanLease = await witness.acquireController(id, "human-test-1", "human", { pid: process.pid, tty: "/dev/pts/0" });
  await eventually(() => readChildStatus(child.statusFile), (s) => s?.ready === true, "child ready");

  const stack = setupRealBridge(fx, () => [socketPath]);
  stack.peer.sendWatchStart(stack.conn);
  await eventually(() => stack.projector.getSnapshot(), (s) => s !== null, "initial snapshot");

  const sid = nativeCatalogueSid(id);
  const compSid = nativeCatalogueSid(compId);

  // Companion *.h2a refused before connect
  const rxComp = new HostReceiver();
  stack.peer.sendTermOpen(stack.conn, { ch: 2, sid: compSid, mode: "observe", afterSeq: null, receivedSegBytes: 0 });
  await eventually(() => { rxComp.drain(stack.conn, 2); return rxComp.errRecords.length > 0; }, Boolean, "companion err");
  assert.equal(rxComp.errRecords[0].code, "unknown-session");

  // Open parent in observe with 200x80 while zero credit -> produce 3 lines with barrier
  const rx3 = new HostReceiver();
  rx3.setCutBeforeApply((rec) => rec.t === "term.out" && rec.firstSeq === 1 && rec.lastSeq >= 3);
  stack.peer.sendTermOpen(stack.conn, { ch: 3, sid, mode: "observe", afterSeq: null, receivedSegBytes: 0, cols: 200, rows: 80 });

  let prevLatest = (await witness.state(id)).latestSeq;
  for (let i = 1; i <= 3; i++) {
    sendChildCommand(child.cmdFile, i, "line", { text: `NUM-${i}\n` });
    await eventually(async () => (await witness.state(id)).latestSeq, (seq) => seq > prevLatest, `line ${i} seq`);
    prevLatest = (await witness.state(id)).latestSeq;
  }

  // Grant credit now that 3 chunks are in the ring -> coalesced [1..3], intercepted before apply
  stack.peer.sendCredit(stack.conn, 3, { receivedThroughSeq: 0, receivedThroughBytes: 0, sendLimitSeq: 8, sendLimitBytes: 131_072 });
  await eventually(() => rx3.drain(stack.conn, 3), Boolean, "cut coalesced [1..3]");
  assert.equal(rx3.appliedSeq, 0);
  assert.equal(rx3.paintCount, 0);
  assert.equal(rx3.openedRecords[0].holderKind, "human");
  assert.deepEqual(rx3.openedRecords[0].size, { cols: 103, rows: 39 });
  stack.peer.sendTermClose(stack.conn, 3, sid);

  // Reopen on ch=4 with appliedSeq=0 -> exact same coalesced range + bytes
  rx3.setCutBeforeApply(null);
  stack.peer.sendTermOpen(stack.conn, { ch: 4, sid, mode: "observe", afterSeq: null, receivedSegBytes: 0 });
  stack.peer.sendCredit(stack.conn, 4, { receivedThroughSeq: 0, receivedThroughBytes: 0, sendLimitSeq: 8, sendLimitBytes: 131_072 });
  await eventually(() => { rx3.drain(stack.conn, 4); return rx3.appliedSeq >= 3; }, Boolean, "reopen coalesced [1..3]");
  const firstOut = rx3.rawTermOut[0];
  assert.ok(firstOut.firstSeq === 1 && firstOut.lastSeq >= 3);

  // Active commands injected on observe view -> refused, zero bytes reach child
  stack.peer.sendRecord(stack.conn, { t: "term.in", ch: 4, sid, generation: rx3.openedRecords[0].generation, incarnation: rx3.openedRecords[0].incarnation, epoch: 1, inSeq: 1, origin: "user", dataB64: Buffer.from("SHOULD_NOT_ARRIVE\n").toString("base64") });
  stack.peer.sendRecord(stack.conn, { t: "term.resize", ch: 4, sid, cols: 200, rows: 80 });
  stack.peer.sendRecord(stack.conn, { t: "term.stop", ch: 4, sid, incarnation: rx3.openedRecords[0].incarnation });
  await delay(100);
  rx3.drain(stack.conn, 4);
  assert.equal(rx3.ackRecords.some((a) => a.result === "refused"), true);
  assert.equal(existsSync(child.inputLogFile), false, "zero bytes may reach PTY child stdin");
  const stAfter = await witness.state(id);
  assert.equal(stAfter.cols, 103);
  assert.equal(stAfter.rows, 39);
  assert.equal(stAfter.holderKind, "human");

  // Agent restart with empty range index -> reopen from appliedSeq, compare against witness readOutput
  const savedApplied = rx3.appliedSeq;
  const savedInc = rx3.openedRecords[0].incarnation;
  stack.bridge.dispose();
  stack.projector.stopWatch();
  stack.client.stop();

  sendChildCommand(child.cmdFile, 4, "line", { text: "AFTER-RESTART\n" });
  await eventually(async () => (await witness.state(id)).latestSeq, (seq) => seq > savedApplied, "post-restart line");

  const stack2 = setupRealBridge(fx, () => [socketPath]);
  stack2.peer.sendWatchStart(stack2.conn);
  await eventually(() => stack2.projector.getSnapshot(), (s) => s !== null, "restarted snapshot");

  const rxRestart = new HostReceiver();
  rxRestart.appliedSeq = savedApplied;
  stack2.peer.sendTermOpen(stack2.conn, { ch: 2, sid, mode: "observe", afterSeq: savedApplied, receivedSegBytes: 0 });
  stack2.peer.sendCredit(stack2.conn, 2, { receivedThroughSeq: 0, receivedThroughBytes: 0, sendLimitSeq: 8, sendLimitBytes: 131_072 });
  await eventually(() => { rxRestart.drain(stack2.conn, 2); return rxRestart.text.includes("AFTER-RESTART"); }, Boolean, "restarted suffix");
  assert.equal(rxRestart.openedRecords[0].incarnation, savedInc);
  const witnessReplay = await witness.readOutput(id, savedApplied);
  assert.equal(rxRestart.text, witnessReplay.chunks.map((c) => c.data).join(""));

  await witness.releaseController(humanLease);
  stack2.bridge.dispose();
  stack2.projector.stopWatch();
  stack2.client.stop();
});

// ============================================================================
// 2. Real 60s monotonic credit pause + >4 MiB eviction + screen oracle
// ============================================================================

test("LH-08 host e2e: >=60s real monotonic pause on ch=2 while ch=3 continues, then resume + >4 MiB eviction & screen match", { timeout: 95_000 }, async (t) => {
  const fx = makeHostFixture(t, "l8pause-");
  const { client: witness, socketPath } = await fx.startHost();
  const child = writeChildScript(fx.root);
  const id = "h2a-pause";

  await witness.create({ id, command: process.execPath, args: [child.scriptPath], cwd: fx.root, env: fx.env, cols: 80, rows: 24 });
  await eventually(() => readChildStatus(child.statusFile), (s) => s?.ready === true, "child ready");

  const stack = setupRealBridge(fx, () => [socketPath]);
  stack.peer.sendWatchStart(stack.conn);
  await eventually(() => stack.projector.getSnapshot(), (s) => s !== null, "snapshot");

  const sid = nativeCatalogueSid(id);
  sendChildCommand(child.cmdFile, 1, "line", { text: "INIT-LINE\n" });
  await eventually(async () => (await witness.state(id)).latestSeq, (seq) => seq >= 1, "init seq");

  // Open ch=2 with 1-record credit (exhausts immediately after INIT-LINE), ch=3 with rolling credit
  const rx2 = new HostReceiver();
  const rx3 = new HostReceiver();
  stack.peer.sendTermOpen(stack.conn, { ch: 2, sid, mode: "observe", afterSeq: null, receivedSegBytes: 0 });
  stack.peer.sendTermOpen(stack.conn, { ch: 3, sid, mode: "observe", afterSeq: null, receivedSegBytes: 0 });
  stack.peer.sendCredit(stack.conn, 2, { receivedThroughSeq: 0, receivedThroughBytes: 0, sendLimitSeq: 1, sendLimitBytes: 131_072 });
  stack.peer.sendCredit(stack.conn, 3, { receivedThroughSeq: 0, receivedThroughBytes: 0, sendLimitSeq: 8, sendLimitBytes: 131_072 });

  await eventually(() => {
    rx2.drain(stack.conn, 2);
    rx3.drain(stack.conn, 3);
    return rx2.text.includes("INIT-LINE") && rx3.text.includes("INIT-LINE");
  }, Boolean, "initial output on both channels");

  // Pause ch=2 for >= 60 s real monotonic clock while child emits start/mid/end lines
  await delay(60); // let any in-flight poll settle after 1-record credit exhaustion
  const ch2ClientCounter = stack.readOutputCountsByClient[0];
  const ch3ClientCounter = stack.readOutputCountsByClient[1];
  const ch2ReadsAtPauseStart = ch2ClientCounter.readOutputCalls;
  const ch3ReadsAtPauseStart = ch3ClientCounter.readOutputCalls;
  let prevChildSeq = readChildStatus(child.statusFile)?.seq ?? 0;
  let prevHostLatestSeq = (await witness.state(id)).latestSeq;

  const startMono = process.hrtime.bigint();
  let ch3DeliveredCount = stack.conn.receivedTermOut.get(3)?.length ?? 0;
  let ch3DeliveredBytes = (stack.conn.receivedTermOut.get(3) ?? []).reduce((s, i) => s + i.rawBytes, 0);

  for (let step = 0; step < 3; step++) {
    sendChildCommand(child.cmdFile, 10 + step, "line", { text: `DURING-PAUSE-${step}\n` });
    await eventually(() => {
      rx3.drain(stack.conn, 3);
      return rx3.text.includes(`DURING-PAUSE-${step}`);
    }, Boolean, `ch=3 sees DURING-PAUSE-${step}`);
    const curStatus = await eventually(
      () => readChildStatus(child.statusFile),
      (s) => s !== null && s.seq > prevChildSeq,
      `child status seq step ${step}`
    );
    prevChildSeq = curStatus.seq;
    const curHostLatestSeq = (await witness.state(id)).latestSeq;
    assert.ok(curHostLatestSeq > prevHostLatestSeq, `latestSeq must rise at step ${step}`);
    prevHostLatestSeq = curHostLatestSeq;
    assert.equal(ch2ClientCounter.readOutputCalls, ch2ReadsAtPauseStart, `ch=2 read-output counter must stay stationary at step ${step}`);
    const list3 = stack.conn.receivedTermOut.get(3) ?? [];
    ch3DeliveredCount = list3.length;
    ch3DeliveredBytes = list3.reduce((s, i) => s + i.rawBytes, 0);
    stack.peer.sendCredit(stack.conn, 3, {
      receivedThroughSeq: ch3DeliveredCount,
      receivedThroughBytes: ch3DeliveredBytes,
      sendLimitSeq: ch3DeliveredCount + 8,
      sendLimitBytes: ch3DeliveredBytes + 131_072
    });
    if (step < 2) await delay(30_200);
  }
  const elapsedNs = process.hrtime.bigint() - startMono;
  assert.ok(elapsedNs >= 60_000_000_000n, `real monotonic pause ${elapsedNs}ns must be >= 60s`);
  assert.equal(ch2ClientCounter.readOutputCalls, ch2ReadsAtPauseStart, "ch=2 must issue zero new read-output calls during 60s pause");
  assert.ok(ch3ClientCounter.readOutputCalls > ch3ReadsAtPauseStart, "ch=3 must continue issuing read-output calls");
  rx2.drain(stack.conn, 2);
  assert.equal(rx2.text.includes("DURING-PAUSE"), false, "ch=2 must receive zero lines while credit is exhausted");

  // Grant credit to ch=2 without eviction -> exact resume
  const ch2Bytes = (stack.conn.receivedTermOut.get(2) ?? []).reduce((s, i) => s + i.rawBytes, 0);
  stack.peer.sendCredit(stack.conn, 2, {
    receivedThroughSeq: 1,
    receivedThroughBytes: ch2Bytes,
    sendLimitSeq: 8,
    sendLimitBytes: ch2Bytes + 131_072
  });
  await eventually(() => { rx2.drain(stack.conn, 2); return rx2.text.includes("DURING-PAUSE-2"); }, Boolean, "ch=2 exact resume");
  assert.equal(rx2.gapRecords.length, 0);

  // Close ch=2, reopen ch=4 with exhausted credit, enable DEC mode and write > 4 MiB to cause ring eviction
  stack.peer.sendTermClose(stack.conn, 2, sid);
  const rx4 = new HostReceiver();
  stack.peer.sendTermOpen(stack.conn, { ch: 4, sid, mode: "observe", afterSeq: rx2.appliedSeq, receivedSegBytes: 0 });
  stack.peer.sendCredit(stack.conn, 4, { receivedThroughSeq: 0, receivedThroughBytes: 0, sendLimitSeq: 1, sendLimitBytes: 131_072 });
  await eventually(() => { rx4.drain(stack.conn, 4); return rx4.openedRecords.length === 1; }, Boolean, "ch=4 opened");

  // Emit one line to exhaust ch=4's 1-record credit
  sendChildCommand(child.cmdFile, 20, "dec-mode");
  await eventually(() => { rx4.drain(stack.conn, 4); return rx4.rawTermOut.length >= 1; }, Boolean, "ch=4 exhausted");
  const ch4PausedAtSeq = rx4.appliedSeq;
  const ch4Bytes = (stack.conn.receivedTermOut.get(4) ?? []).reduce((s, i) => s + i.rawBytes, 0);

  // Flood > 4 MiB while ch=4 has 0 credit
  sendChildCommand(child.cmdFile, 21, "burst", { bytes: 65_536, count: 80 });
  await eventually(async () => (await witness.readOutput(id, ch4PausedAtSeq)).gap !== null, Boolean, "ring eviction proven on witness", 15_000);
  sendChildCommand(child.cmdFile, 22, "line", { text: "FINAL-SCREEN-LINE\n" });
  await eventually(async () => (await witness.readOutput(id, ch4PausedAtSeq)).chunks.some((c) => c.data.includes("FINAL-SCREEN-LINE")), Boolean, "final screen line in ring");

  // Grant rolling credit on ch=4 -> must get term.gap -> term.opened(modePrefix) -> retained replay matching renderTerminalScreen
  let sentCredits = 1;
  stack.peer.sendCredit(stack.conn, 4, { receivedThroughSeq: 1, receivedThroughBytes: ch4Bytes, sendLimitSeq: 9, sendLimitBytes: ch4Bytes + 131_072 });
  await eventually(() => {
    rx4.drain(stack.conn, 4);
    const list4 = stack.conn.receivedTermOut.get(4) ?? [];
    if (list4.length > sentCredits) {
      sentCredits = list4.length;
      const b = list4.reduce((s, i) => s + i.rawBytes, 0);
      stack.peer.sendCredit(stack.conn, 4, { receivedThroughSeq: sentCredits, receivedThroughBytes: b, sendLimitSeq: sentCredits + 8, sendLimitBytes: b + 131_072 });
    }
    return rx4.text.includes("FINAL-SCREEN-LINE");
  }, Boolean, "ch=4 eviction recovery", 15_000);

  assert.equal(rx4.gapRecords.length, 1);
  assert.ok(rx4.openedRecords.length >= 2);
  const gapOpened = rx4.openedRecords[rx4.openedRecords.length - 1];
  assert.ok(gapOpened.modePrefix && gapOpened.modePrefix.includes("2004h"));
  assert.ok(rx4.screenText.includes("[output skipped]"));
  const witnessAtGap = await witness.readOutput(id, rx4.gapRecords[0].fromSeq - 1);
  const expectedScreen = await renderTerminalScreen(
    (witnessAtGap.terminalModePrefix ?? "") + witnessAtGap.chunks.map((c) => c.data).join(""),
    80,
    24
  );
  const rxScreen = await renderTerminalScreen(rx4.text, 80, 24);
  assert.equal(rxScreen, expectedScreen);

  stack.bridge.dispose();
  stack.projector.stopWatch();
  stack.client.stop();
});

// ============================================================================
// 3. Exit, same-name respawn, host replacement, off & zero sentinel/env leak
// ============================================================================

test("LH-08 host e2e: child exit, same-name respawn, host replacement, off, and zero log leaks", { timeout: 90_000 }, async (t) => {
  const fx = makeHostFixture(t, "l8exit-");
  const { hostProc: host1Proc, client: witness1, socketPath: sock1 } = await fx.startHost();
  const child = writeChildScript(fx.root);
  const id = "h2a-lifecycle";
  const secretSentinel = "SECRET-EXIT-SENTINEL-DO-NOT-LOG-9988";

  await witness1.create({ id, command: process.execPath, args: [child.scriptPath], cwd: fx.root, env: fx.env, cols: 80, rows: 24 });
  await eventually(() => readChildStatus(child.statusFile), (s) => s?.ready === true, "child ready");

  let activeSockets = [sock1];
  const stack = setupRealBridge(fx, () => activeSockets);
  stack.peer.sendWatchStart(stack.conn);
  await eventually(() => stack.projector.getSnapshot(), (s) => s !== null, "snapshot");

  const sid = nativeCatalogueSid(id);
  const rx = new HostReceiver();
  stack.peer.sendTermOpen(stack.conn, { ch: 2, sid, mode: "observe", afterSeq: null, receivedSegBytes: 0 });
  stack.peer.sendCredit(stack.conn, 2, { receivedThroughSeq: 0, receivedThroughBytes: 0, sendLimitSeq: 8, sendLimitBytes: 131_072 });
  await eventually(() => { rx.drain(stack.conn, 2); return rx.openedRecords.length === 1; }, Boolean, "ch=2 opened");
  const inc1 = rx.openedRecords[0].incarnation;

  // Exit child with sentinel -> term.exit once for inc1 (node-pty normal exit reports signal=0 or omits signal)
  sendChildCommand(child.cmdFile, 1, "exit", { code: 7, sentinel: secretSentinel });
  await eventually(() => { rx.drain(stack.conn, 2); return rx.exitRecords.length === 1; }, Boolean, "term.exit received");
  assert.equal(rx.exitRecords[0].incarnation, inc1);
  assert.equal(rx.exitRecords[0].exitCode, 7);
  assert.ok(rx.exitRecords[0].signal === undefined || rx.exitRecords[0].signal === 0);
  const ch2OutAfterExit = stack.conn.receivedTermOut.get(2)?.length ?? 0;

  // Recreate same name -> old channel gets 0 bytes from new incarnation; new open gets new incarnation
  rmSync(child.cmdFile, { force: true });
  await witness1.create({ id, command: process.execPath, args: [child.scriptPath], cwd: fx.root, env: fx.env, cols: 80, rows: 24 });
  await eventually(async () => {
    const r = await stack.projector.resolveOpen(sid);
    return r.ok && r.incarnation !== inc1;
  }, Boolean, "projector discovers respawned incarnation");
  const rxNew = new HostReceiver();
  stack.peer.sendTermOpen(stack.conn, { ch: 3, sid, mode: "observe", afterSeq: null, receivedSegBytes: 0 });
  stack.peer.sendCredit(stack.conn, 3, { receivedThroughSeq: 0, receivedThroughBytes: 0, sendLimitSeq: 8, sendLimitBytes: 131_072 });
  await eventually(() => { rxNew.drain(stack.conn, 3); return rxNew.openedRecords.length === 1; }, Boolean, "ch=3 opened");
  assert.notEqual(rxNew.openedRecords[0].incarnation, inc1);
  rx.drain(stack.conn, 2);
  assert.equal(rx.exitRecords.length, 1);
  assert.equal(stack.conn.receivedTermOut.get(2)?.length ?? 0, ch2OutAfterExit, "0 late bytes on closed ch=2");

  // Replace private host -> old ch=3 closes via term.exit on inventory exit notification (or err(host-unavailable))
  host1Proc.kill("SIGTERM");
  await Promise.race([once(host1Proc, "exit"), delay(2_000)]);
  const sock2 = join(fx.root, "h2.sock");
  activeSockets = [sock2];
  const { client: witness2 } = await fx.startHost(sock2, join(fx.root, "reg2.json"));
  await eventually(() => {
    rxNew.drain(stack.conn, 3);
    return rxNew.exitRecords.length > 0 || rxNew.errRecords.length > 0;
  }, Boolean, "old channel closed after host replacement", 10_000);

  // New host: real signal=9 on SIGKILL (and guardian exitCode=143 on SIGTERM)
  const idSig = "h2a-sigkill";
  const sidSig = nativeCatalogueSid(idSig);
  await witness2.create({ id: idSig, command: process.execPath, args: ["-e", "setInterval(() => {}, 1000)"], cwd: fx.root, env: fx.env, cols: 80, rows: 24 });
  await eventually(async () => (await stack.projector.resolveOpen(sidSig)).ok, Boolean, "projector discovers h2a-sigkill");
  const rxSig = new HostReceiver();
  stack.peer.sendTermOpen(stack.conn, { ch: 4, sid: sidSig, mode: "observe", afterSeq: null, receivedSegBytes: 0 });
  stack.peer.sendCredit(stack.conn, 4, { receivedThroughSeq: 0, receivedThroughBytes: 0, sendLimitSeq: 8, sendLimitBytes: 131_072 });
  await eventually(() => { rxSig.drain(stack.conn, 4); return rxSig.openedRecords.length === 1; }, Boolean, "ch=4 opened on host2");
  const stSig = await witness2.state(idSig);
  await witness2.stopIfIncarnation(idSig, stSig.generation, stSig.incarnation, "SIGKILL");
  await eventually(() => { rxSig.drain(stack.conn, 4); return rxSig.exitRecords.length === 1; }, Boolean, "ch=4 term.exit with signal=9");
  assert.equal(rxSig.exitRecords[0].signal, 9);

  // term.close + off + link drop on live session
  const idClose = "h2a-close-off";
  const sidClose = nativeCatalogueSid(idClose);
  await witness2.create({ id: idClose, command: process.execPath, args: [child.scriptPath], cwd: fx.root, env: fx.env, cols: 80, rows: 24 });
  await eventually(async () => (await stack.projector.resolveOpen(sidClose)).ok, Boolean, "projector discovers h2a-close-off");
  const rxClose = new HostReceiver();
  stack.peer.sendTermOpen(stack.conn, { ch: 5, sid: sidClose, mode: "observe", afterSeq: null, receivedSegBytes: 0 });
  stack.peer.sendCredit(stack.conn, 5, { receivedThroughSeq: 0, receivedThroughBytes: 0, sendLimitSeq: 8, sendLimitBytes: 131_072 });
  await eventually(() => { rxClose.drain(stack.conn, 5); return rxClose.openedRecords.length === 1; }, Boolean, "ch=5 opened");
  stack.peer.sendTermClose(stack.conn, 5, sidClose);
  await delay(50);
  rxClose.drain(stack.conn, 5);
  assert.equal(rxClose.exitRecords.length, 0, "peer term.close must not emit term.exit");

  // Reopen on ch=6, then exclude via CLI `off` -> err(excluded) + term.close while PTY stays alive
  const rxOff = new HostReceiver();
  stack.peer.sendTermOpen(stack.conn, { ch: 6, sid: sidClose, mode: "observe", afterSeq: null, receivedSegBytes: 0 });
  stack.peer.sendCredit(stack.conn, 6, { receivedThroughSeq: 0, receivedThroughBytes: 0, sendLimitSeq: 8, sendLimitBytes: 131_072 });
  await eventually(() => { rxOff.drain(stack.conn, 6); return rxOff.openedRecords.length === 1; }, Boolean, "ch=6 opened");
  const offRes = spawnSync(process.execPath, [H2A_BIN, "remote", "off", sidClose, "--root", fx.storeDir], { env: fx.env, encoding: "utf8" });
  assert.equal(offRes.status, 0, offRes.stderr);
  await eventually(() => { rxOff.drain(stack.conn, 6); return rxOff.errRecords.length > 0 && rxOff.closeRecords.length > 0; }, Boolean, "ch=6 err(excluded) + term.close");
  assert.equal(rxOff.errRecords[0].code, "excluded");
  assert.equal((await witness2.state(idClose)).status, "running", "host child must stay alive after off");

  // Link drop closes local bridge channel while preserving host PTY & child
  stack.peer.dropConnection(stack.conn, "network-drop");
  await delay(50);
  assert.equal(stack.bridge.activeChannelCount(), 0);
  assert.equal((await witness2.state(idClose)).status, "running");

  // Check logs do not leak secretSentinel, its base64, fixture path, or env values
  const sentinelB64 = Buffer.from(secretSentinel, "utf8").toString("base64");
  const auditText = JSON.stringify(stack.audits);
  assert.equal(auditText.includes(secretSentinel), false);
  assert.equal(auditText.includes(sentinelB64), false);
  assert.equal(auditText.includes(fx.root), false);
  assert.equal(auditText.includes(fx.home), false);
  assert.equal(auditText.includes(fx.storeDir), false);
  assert.equal(auditText.includes(fx.configDir), false);
  if (existsSync(fx.hostLogPath)) {
    const hostLog = readFileSync(fx.hostLogPath, "utf8");
    assert.equal(hostLog.includes(secretSentinel), false);
    assert.equal(hostLog.includes(sentinelB64), false);
    assert.equal(hostLog.includes(fx.root), false);
    assert.equal(hostLog.includes(fx.home), false);
  }

  stack.bridge.dispose();
  stack.projector.stopWatch();
  stack.client.stop();
});
