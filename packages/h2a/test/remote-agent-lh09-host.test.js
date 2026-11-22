// LH-09b real-host end-to-end suite: real NativeTerminalHost on a private Unix
// socket + real node-pty child + real NativeTerminalClient witness + default
// control port (`defaultConnectNativeControlPort`) + FakeBinaryTrunkPeer.
// Covers all real-host acceptance cases of LH-09b (LH-09.md §1, §3, §4).
// Runs in a disposable TMPDIR with isolated HOME/XDG/socket (never /tmp).

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import test from "node:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  clearSessionExcluded,
  CoalescedRangeIndex,
  createCatalogueProjector,
  createTerminalBridge,
  createTerminalInput,
  defaultConnectNativeControlPort,
  generateNodeKey,
  nativeCatalogueSid,
  TrunkClient
} from "../dist/runtime/remote-agent/index.js";
import {
  FakeBinaryTrunkPeer,
  createSimulatedTrunkContractProvider
} from "./helpers/remote-trunk-peer.js";

const { NativeTerminalClient } = await import("../../h2a-runtime/dist/native-terminal/client.js");
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

function makeHostFixture(t, prefix = "lh09h-") {
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

  return { root, home, configDir, stateDir, storeDir, socketPath, registryPath, hostLogPath, env, children, startHost };
}

function writeChildScript(root, tag = "c") {
  const scriptPath = join(root, `pty-child-${tag}.mjs`);
  const cmdFile = join(root, `child-cmd-${tag}.json`);
  const statusFile = join(root, `child-status-${tag}.json`);
  const inputLogFile = join(root, `child-input-${tag}.txt`);
  writeFileSync(
    scriptPath,
    `import { existsSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
const cmdFile = ${JSON.stringify(cmdFile)};
const statusFile = ${JSON.stringify(statusFile)};
const inputLogFile = ${JSON.stringify(inputLogFile)};
let inputBytes = 0;
let seq = 0;
let lastCmdId = 0;
process.stdin.on("data", (buf) => {
  inputBytes += buf.byteLength;
  appendFileSync(inputLogFile, buf);
  // Echo visible text back to PTY stdout so peer & local witness observe the effect
  process.stdout.write("ECHO:" + buf.toString("utf8"));
});
let gotSigterm = false;
process.on("SIGTERM", () => {
  gotSigterm = true;
  publish({ exiting: true, gotSigterm: true });
  process.exit(0);
});
function publish(extra = {}) {
  writeFileSync(statusFile, JSON.stringify({ ready: true, seq, inputBytes, gotSigterm, at: Date.now(), ...extra }));
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
        } else if (cmd.action === "exit") {
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

function readChildStatus(statusFile) {
  if (!existsSync(statusFile)) return null;
  try {
    return JSON.parse(readFileSync(statusFile, "utf8"));
  } catch {
    return null;
  }
}

function sendChildCommand(cmdFile, id, action, extra = {}) {
  writeFileSync(cmdFile, JSON.stringify({ id, action, ...extra }), "utf8");
}

function b64(s) {
  return Buffer.from(s, "utf8").toString("base64");
}

function logFileFor(root, scope, sid, generation, incarnation) {
  const a = createHash("sha256").update(`${scope}\n${sid}`).digest("hex").slice(0, 32);
  const b = createHash("sha256").update(`${generation}\n${incarnation}`).digest("hex").slice(0, 32);
  return join(root, "remote-control", "input-log", `${a}.${b}.jsonl`);
}

class HostReceiver {
  text = "";
  openedRecords = [];
  ackRecords = [];
  ctlStateRecords = [];
  syncedRecords = [];
  errRecords = [];
  exitRecords = [];
  closeRecords = [];
  #cursor = 0;

  drain(conn, ch) {
    while (this.#cursor < conn.decodedClientRecords.length) {
      const rec = conn.decodedClientRecords[this.#cursor++];
      if (rec.ch !== ch) continue;
      if (rec.t === "term.opened") this.openedRecords.push(rec);
      else if (rec.t === "term.out") this.text += Buffer.from(rec.dataB64, "base64").toString("utf8");
      else if (rec.t === "term.in.ack") this.ackRecords.push(rec);
      else if (rec.t === "term.ctl.state") this.ctlStateRecords.push(rec);
      else if (rec.t === "term.in.synced") this.syncedRecords.push(rec);
      else if (rec.t === "err") this.errRecords.push(rec);
      else if (rec.t === "term.exit") this.exitRecords.push(rec);
      else if (rec.t === "term.close") this.closeRecords.push(rec);
    }
  }
}

function setupRealStack(fx, sockets, opts = {}) {
  const key = opts.key ?? generateNodeKey({ configDir: fx.configDir, env: fx.env });
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
  const enrolmentRef = opts.enrolmentRef ?? "enr-lh09-host";
  peer.registerEnrolment({
    nodeId: key.nodeId,
    enrolmentRef,
    publicKeyPem: key.publicKeyPem,
    fingerprint: key.fingerprint
  });
  const projector = createCatalogueProjector({
    root: fx.storeDir,
    configDir: fx.configDir,
    env: fx.env,
    pollIntervalMs: opts.pollIntervalMs ?? 200,
    readNativeInventory: () => listNativeInventoryForRemote({ socketPaths: sockets(), connectTimeoutMs: 250, requestTimeoutMs: 250 }),
    readPresences: () => []
  });
  const scope = `${MESH}|${TENANT}|${enrolmentRef}|${key.nodeId}`;
  const inputAudits = [];
  const bridgeAudits = [];
  // Intentionally omit connectControlPort so defaultConnectNativeControlPort is exercised.
  const input = createTerminalInput({
    root: fx.storeDir,
    scope,
    clock,
    ...(opts.connectControlPort !== undefined ? { connectControlPort: opts.connectControlPort } : {}),
    env: fx.env,
    withShareAllowed: projector.withShareAllowed,
    onAudit: (ev) => inputAudits.push(ev)
  });
  const bridge = createTerminalBridge({
    catalogue: projector,
    clock,
    rangeIndex: new CoalescedRangeIndex(),
    input,
    onAudit: (ev) => bridgeAudits.push(ev)
  });
  const client = new TrunkClient({
    root: fx.storeDir,
    env: fx.env,
    enrolment: { meshId: MESH, endpoint: ENDPOINT, tenantId: TENANT, enrolmentRef, nodeId: key.nodeId },
    nodeKeyOptions: { configDir: fx.configDir, env: fx.env },
    connector: peer.createConnector("lh09-host-client"),
    contract,
    clock,
    catalogue: projector,
    terminalConsumer: bridge
  });
  assert.equal(client.start().ok, true);
  const conn = peer.allConnections()[0];
  return { key, contract, peer, projector, scope, input, inputAudits, bridgeAudits, bridge, client, conn, enrolmentRef };
}

// ============================================================================
// 1. Prise, Frappe réelle, Taille, Libération, Reprise locale (+ 30s window)
// ============================================================================

test("LH-09b host #1/#3/#4/#5/#6/#7: real PTY acquire, echo 42, size & localSize restore, human takeover <500ms & 30s re-acquire", { timeout: 90_000 }, async (t) => {
  const fx = makeHostFixture(t, "l9h1-");
  const { client: witness, socketPath } = await fx.startHost();
  const child = writeChildScript(fx.root, "1");
  const id = "h2a-l9-main";
  await witness.create({ id, command: process.execPath, args: [child.scriptPath], cwd: fx.root, env: fx.env, cols: 100, rows: 30 });
  await eventually(() => readChildStatus(child.statusFile), (s) => s?.ready === true, "child ready");

  // Local witness sets initial local size 100x30 then releases (no recent human yet? releaseController sets lastHumanActivityAt! Wait: test with fresh session with no human lease first)
  const stack = setupRealStack(fx, () => [socketPath]);
  stack.peer.sendWatchStart(stack.conn);
  const sid = nativeCatalogueSid(id);
  await eventually(async () => (await stack.projector.resolveOpen(sid)).ok, Boolean, "projector discovers session");

  // Open ch=2 (controller candidate) and ch=3 (observer)
  const rx2 = new HostReceiver();
  const rx3 = new HostReceiver();
  stack.peer.sendTermOpen(stack.conn, { ch: 2, sid, mode: "observe", afterSeq: null, receivedSegBytes: 0 });
  stack.peer.sendCredit(stack.conn, 2, { receivedThroughSeq: 0, receivedThroughBytes: 0, sendLimitSeq: 8, sendLimitBytes: 131_072 });
  stack.peer.sendTermOpen(stack.conn, { ch: 3, sid, mode: "observe", afterSeq: null, receivedSegBytes: 0 });
  stack.peer.sendCredit(stack.conn, 3, { receivedThroughSeq: 0, receivedThroughBytes: 0, sendLimitSeq: 8, sendLimitBytes: 131_072 });
  await eventually(() => { rx2.drain(stack.conn, 2); rx3.drain(stack.conn, 3); return rx2.openedRecords.length === 1 && rx3.openedRecords.length === 1; }, Boolean, "both channels opened");
  const gen = rx2.openedRecords[0].generation;
  const inc = rx2.openedRecords[0].incarnation;

  // #1 Prise
  stack.peer.sendRecord(stack.conn, { t: "term.ctl", ch: 2, sid, generation: gen, incarnation: inc, action: "acquire" });
  await eventually(() => { rx2.drain(stack.conn, 2); return rx2.ctlStateRecords.some((r) => r.state === "granted"); }, Boolean, "acquire granted");
  const epoch1 = rx2.ctlStateRecords.find((r) => r.state === "granted").epoch;
  assert.equal((await witness.state(id)).holderKind, "remote");

  // #3 Frappe réelle: "echo 42\n" in 3 inputs
  const p1 = "ec";
  const p2 = "ho 42";
  const p3 = "\n";
  stack.peer.sendRecord(stack.conn, { t: "term.in", ch: 2, sid, generation: gen, incarnation: inc, epoch: epoch1, inSeq: 1, ackThrough: 0, origin: "user", dataB64: b64(p1) });
  stack.peer.sendRecord(stack.conn, { t: "term.in", ch: 2, sid, generation: gen, incarnation: inc, epoch: epoch1, inSeq: 2, ackThrough: 1, origin: "user", dataB64: b64(p2) });
  stack.peer.sendRecord(stack.conn, { t: "term.in", ch: 2, sid, generation: gen, incarnation: inc, epoch: epoch1, inSeq: 3, ackThrough: 2, origin: "user", dataB64: b64(p3) });
  await eventually(() => { rx2.drain(stack.conn, 2); return rx2.ackRecords.length >= 3; }, Boolean, "3 inputs acked");
  assert.deepEqual(rx2.ackRecords.map((a) => [a.inSeq, a.result]), [[1, "applied"], [2, "applied"], [3, "applied"]]);
  await eventually(() => readChildStatus(child.statusFile), (s) => s?.inputBytes === 8, "child received 8 bytes");
  assert.equal(readFileSync(child.inputLogFile, "utf8"), "echo 42\n");
  await eventually(() => { rx2.drain(stack.conn, 2); return rx2.text.includes("echo 42"); }, Boolean, "echo arrived on ch=2");
  const witnessReplay = await witness.readOutput(id, 0);
  assert.equal(witnessReplay.chunks.map((c) => c.data).join("").includes("echo 42"), true);

  // #4 Observer channel refused
  stack.peer.sendRecord(stack.conn, { t: "term.in", ch: 3, sid, generation: gen, incarnation: inc, epoch: epoch1, inSeq: 1, ackThrough: 0, origin: "user", dataB64: b64("bad") });
  stack.peer.sendRecord(stack.conn, { t: "term.resize", ch: 3, sid, cols: 99, rows: 22 });
  await eventually(() => { rx3.drain(stack.conn, 3); return rx3.ackRecords.length === 1 && rx3.errRecords.length === 1; }, Boolean, "observer refusals");
  assert.equal(rx3.ackRecords[0].reason, "not-controller");
  assert.equal(rx3.errRecords[0].code, "not-controller");
  assert.equal(readChildStatus(child.statusFile).inputBytes, 8);

  // #5 Taille (valid 132x45; 0, 65536, 12.5 -> invalid-size)
  stack.peer.sendRecord(stack.conn, { t: "term.resize", ch: 2, sid, cols: 132, rows: 45 });
  await eventually(async () => await witness.state(id), (st) => st.cols === 132 && st.rows === 45, "resized to 132x45");

  stack.peer.sendRecord(stack.conn, { t: "term.resize", ch: 2, sid, cols: 0, rows: 24 });
  stack.peer.sendRecord(stack.conn, { t: "term.resize", ch: 2, sid, cols: 65536, rows: 24 });
  stack.peer.sendRecord(stack.conn, { t: "term.resize", ch: 2, sid, cols: 12.5, rows: 24 });
  await eventually(() => { rx2.drain(stack.conn, 2); return rx2.errRecords.length >= 3; }, Boolean, "3 invalid-size errs");
  assert.deepEqual(rx2.errRecords.slice(-3).map((e) => e.code), ["invalid-size", "invalid-size", "invalid-size"]);

  // #6 Reprise locale via witness human takeover -> <500ms taken-back, human sets local size 100x30, next input stale-epoch, refused-recent-human, then >30s acquire succeeds
  const tTakeover = Date.now();
  const humanLease = await witness.acquireController(id, "human-witness", "human", { takeover: true, pid: process.pid, tty: "/dev/pts/1" });
  await eventually(() => { rx2.drain(stack.conn, 2); return rx2.ctlStateRecords.some((r) => r.state === "taken-back"); }, Boolean, "taken-back received", 2_000);
  const takenBackDelayMs = Date.now() - tTakeover;
  assert.ok(takenBackDelayMs < 500, `taken-back delay=${takenBackDelayMs}ms must be < 500ms`);
  await witness.resize(humanLease, 100, 30);
  assert.deepEqual((await witness.state(id)).lastLocalSize, { cols: 100, rows: 30 });

  // Next input on old epoch -> stale-epoch, 0 bytes to child
  const ackLenBefore = rx2.ackRecords.length;
  stack.peer.sendRecord(stack.conn, { t: "term.in", ch: 2, sid, generation: gen, incarnation: inc, epoch: epoch1, inSeq: 4, ackThrough: 3, origin: "user", dataB64: b64("NOPE") });
  await eventually(() => { rx2.drain(stack.conn, 2); return rx2.ackRecords.length > ackLenBefore; }, Boolean, "stale-epoch ack");
  assert.equal(rx2.ackRecords.at(-1).reason, "stale-epoch");
  assert.equal(readChildStatus(child.statusFile).inputBytes, 8);

  // Release human lease, try acquire inside 30s window -> refused-recent-human
  await witness.releaseController(humanLease);
  stack.peer.sendRecord(stack.conn, { t: "term.ctl", ch: 2, sid, generation: gen, incarnation: inc, action: "acquire" });
  await eventually(() => { rx2.drain(stack.conn, 2); return rx2.ctlStateRecords.some((r) => r.state === "refused-recent-human"); }, Boolean, "refused-recent-human");

  // Wait out 30s activity window in real monotonic time, then acquire succeeds
  await delay(30_200);
  stack.peer.sendRecord(stack.conn, { t: "term.ctl", ch: 2, sid, generation: gen, incarnation: inc, action: "acquire" });
  await eventually(() => { rx2.drain(stack.conn, 2); return rx2.ctlStateRecords.filter((r) => r.state === "granted").length === 2; }, Boolean, "acquire granted after 30s window");
  const epoch2 = rx2.ctlStateRecords.filter((r) => r.state === "granted")[1].epoch;
  assert.equal((await witness.state(id)).holderKind, "remote");

  // #5/#7 Remote resize to 132x45 preserves lastLocalSize (100x30), then release restores 100x30
  stack.peer.sendRecord(stack.conn, { t: "term.resize", ch: 2, sid, cols: 132, rows: 45 });
  await eventually(async () => await witness.state(id), (st) => st.cols === 132 && st.rows === 45, "resized to 132x45 after human");
  assert.deepEqual((await witness.state(id)).lastLocalSize, { cols: 100, rows: 30 });

  stack.peer.sendRecord(stack.conn, { t: "term.ctl", ch: 2, sid, generation: gen, incarnation: inc, action: "release", epoch: epoch2 });
  await eventually(() => { rx2.drain(stack.conn, 2); return rx2.ctlStateRecords.some((r) => r.state === "released"); }, Boolean, "released");
  const stAfterRel = await witness.state(id);
  assert.equal(stAfterRel.holderKind, "none");
  assert.deepEqual({ cols: stAfterRel.cols, rows: stAfterRel.rows }, { cols: 100, rows: 30 });

  // Also test human takeover restores local size 100x30 directly from remote 132x45
  stack.peer.sendRecord(stack.conn, { t: "term.ctl", ch: 2, sid, generation: gen, incarnation: inc, action: "acquire" });
  await eventually(() => { rx2.drain(stack.conn, 2); return rx2.ctlStateRecords.filter((r) => r.state === "granted").length === 3; }, Boolean, "third acquire granted");
  stack.peer.sendRecord(stack.conn, { t: "term.resize", ch: 2, sid, cols: 132, rows: 45 });
  await eventually(async () => await witness.state(id), (st) => st.cols === 132 && st.rows === 45, "resized to 132x45 before takeover");
  const humanLease2 = await witness.acquireController(id, "human-witness-2", "human", { takeover: true, pid: process.pid, tty: "/dev/pts/2" });
  await eventually(() => { rx2.drain(stack.conn, 2); return rx2.ctlStateRecords.filter((r) => r.state === "taken-back").length === 2; }, Boolean, "second taken-back");
  const stAfterTakeover2 = await witness.state(id);
  assert.deepEqual({ cols: stAfterTakeover2.cols, rows: stAfterTakeover2.rows }, { cols: 100, rows: 30 });
  await witness.releaseController(humanLease2);

  t.diagnostic(
    `metrics: inputBytes=${readChildStatus(child.statusFile).inputBytes}, takenBackDelayMs=${takenBackDelayMs}, sizeBefore=${stAfterTakeover2.cols}x${stAfterTakeover2.rows}, sizeDuringRemote=132x45, sizeAfterRelease=${stAfterRel.cols}x${stAfterRel.rows}, wet2TextHash=${stack.contract.wet2TextHash}`
  );
  stack.bridge.dispose();
  stack.projector.stopWatch();
  stack.client.stop();
});

// ============================================================================
// 2. Exclusion sous contrôle, Session inconnue (default port), Arrêt, Surveillance socket rompu
// ============================================================================

test("LH-09b host #9/#12/#19/#20/#21: off <1s, unknown state error, term.stop & stale-incarnation, broken write & idle control socket close", { timeout: 60_000 }, async (t) => {
  const fx = makeHostFixture(t, "l9h2-");
  const { client: witness, socketPath } = await fx.startHost();
  const childA = writeChildScript(fx.root, "a");
  const idA = "h2a-l9-off";
  await witness.create({ id: idA, command: process.execPath, args: [childA.scriptPath], cwd: fx.root, env: fx.env, cols: 80, rows: 24 });
  await eventually(() => readChildStatus(childA.statusFile), (s) => s?.ready === true, "childA ready");

  // #12 real host default port state() on unknown id rejects with NativeTerminalRemoteError & code operation-failed
  const directPort = await defaultConnectNativeControlPort(socketPath);
  try {
    await assert.rejects(
      () => directPort.state("nonexistent-session-id"),
      (err) => err instanceof Error && err.name === "NativeTerminalRemoteError" && err.code === "operation-failed"
    );
  } finally {
    directPort.close();
  }

  const stack = setupRealStack(fx, () => [socketPath], { pollIntervalMs: 100 });
  stack.peer.sendWatchStart(stack.conn);
  const sidA = nativeCatalogueSid(idA);
  await eventually(async () => (await stack.projector.resolveOpen(sidA)).ok, Boolean, "projector discovers idA");

  const rx = new HostReceiver();
  stack.peer.sendTermOpen(stack.conn, { ch: 2, sid: sidA, mode: "observe", afterSeq: null, receivedSegBytes: 0 });
  stack.peer.sendCredit(stack.conn, 2, { receivedThroughSeq: 0, receivedThroughBytes: 0, sendLimitSeq: 8, sendLimitBytes: 131_072 });
  await eventually(
    () => { rx.drain(stack.conn, 2); return { ok: rx.openedRecords.length === 1, recs: stack.conn.decodedClientRecords.map((r) => ({ t: r.t, ch: r.ch, code: r.code })), closed: stack.conn.closed, reason: stack.conn.closeReason, audits: stack.bridgeAudits }; },
    (v) => v.ok,
    "ch=2 opened"
  );
  const genA = rx.openedRecords[0].generation;
  const incA = rx.openedRecords[0].incarnation;

  stack.peer.sendRecord(stack.conn, { t: "term.ctl", ch: 2, sid: sidA, generation: genA, incarnation: incA, action: "acquire" });
  await eventually(() => { rx.drain(stack.conn, 2); return rx.ctlStateRecords.some((r) => r.state === "granted"); }, Boolean, "idA acquired");
  const epochA = rx.ctlStateRecords.at(-1).epoch;

  // #9 Exclusion sous contrôle: `h2a remote off <sid>`
  const tOff = Date.now();
  const offRes = spawnSync(process.execPath, [H2A_BIN, "remote", "off", sidA, "--root", fx.storeDir], { env: fx.env, encoding: "utf8" });
  assert.equal(offRes.status, 0, offRes.stderr);
  await eventually(async () => (await witness.state(idA)).holderKind, (hk) => hk === "none", "host releases on off", 2_000);
  const offDelayMs = Date.now() - tOff;
  assert.ok(offDelayMs < 1_000, `off release delay=${offDelayMs}ms must be < 1000ms`);
  await eventually(() => { rx.drain(stack.conn, 2); return rx.closeRecords.length >= 1; }, Boolean, "ch=2 closed after off");

  // Verify order: term.ctl.state(released) before err(excluded) before term.close
  const ch2Ordered = stack.conn.decodedClientRecords.filter((r) => r.ch === 2);
  const idxReleased = ch2Ordered.findIndex((r) => r.t === "term.ctl.state" && r.state === "released");
  const idxExcluded = ch2Ordered.findIndex((r) => r.t === "err" && r.code === "excluded");
  const idxClose = ch2Ordered.findIndex((r) => r.t === "term.close");
  assert.ok(idxReleased >= 0 && idxExcluded > idxReleased && idxClose > idxExcluded, `expected released < excluded < term.close, got ${JSON.stringify(ch2Ordered.map((r) => r.t))}`);
  assert.deepEqual(stack.input.getLog(sidA, genA, incA)?.epochStatus(epochA), { status: "ended", reason: "released", maxInSeq: 0 });

  // Re-enable exclusion -> acquire on new channel succeeds
  const onRes = clearSessionExcluded(sidA, { root: fx.storeDir, env: fx.env });
  assert.equal(onRes.ok, true);
  // Wait for projector poll to clear exclusion before opening ch=3
  await eventually(async () => (await stack.projector.resolveOpen(sidA)).ok, Boolean, "projector re-enables idA");
  const rxOn = new HostReceiver();
  stack.peer.sendTermOpen(stack.conn, { ch: 3, sid: sidA, mode: "observe", afterSeq: null, receivedSegBytes: 0 });
  stack.peer.sendCredit(stack.conn, 3, { receivedThroughSeq: 0, receivedThroughBytes: 0, sendLimitSeq: 8, sendLimitBytes: 131_072 });
  await eventually(() => { rxOn.drain(stack.conn, 3); return rxOn.openedRecords.length === 1; }, Boolean, "ch=3 opened after on");
  stack.peer.sendRecord(stack.conn, { t: "term.ctl", ch: 3, sid: sidA, generation: genA, incarnation: incA, action: "acquire" });
  await eventually(() => { rxOn.drain(stack.conn, 3); return rxOn.ctlStateRecords.some((r) => r.state === "granted"); }, Boolean, "re-acquired after on");

  // #21 Surveillance sans réponse (hôte réel): close control port socket while idle -> released in <1s & holderKind: none
  // Wrap defaultConnectNativeControlPort only to expose the underlying port so we can close its socket directly
  stack.bridge.dispose();
  stack.projector.stopWatch();
  stack.client.stop();

  const childB = writeChildScript(fx.root, "b");
  const idB = "h2a-l9-brk";
  await witness.create({ id: idB, command: process.execPath, args: [childB.scriptPath], cwd: fx.root, env: fx.env, cols: 80, rows: 24 });
  await eventually(() => readChildStatus(childB.statusFile), (s) => s?.ready === true, "childB ready");

  let lastPort = null;
  let holdNextWrite = false;
  const stackB = setupRealStack(fx, () => [socketPath], {
    pollIntervalMs: 100,
    connectControlPort: async (sock, opts) => {
      const realPort = await defaultConnectNativeControlPort(sock, opts);
      lastPort = {
        acquire: (id, cid, win) => realPort.acquire(id, cid, win),
        write: async (lease, data) => {
          if (holdNextWrite) {
            holdNextWrite = false;
            // Close socket mid-write to simulate broken control socket
            const p = realPort.write(lease, data);
            realPort.close();
            return p;
          }
          return realPort.write(lease, data);
        },
        resize: (lease, c, r) => realPort.resize(lease, c, r),
        release: (lease) => realPort.release(lease),
        state: (id) => realPort.state(id),
        stopIfIncarnation: (id, g, i) => realPort.stopIfIncarnation(id, g, i),
        close: () => realPort.close()
      };
      return lastPort;
    }
  });
  stackB.peer.sendWatchStart(stackB.conn);
  const sidB = nativeCatalogueSid(idB);
  await eventually(async () => (await stackB.projector.resolveOpen(sidB)).ok, Boolean, "projector discovers idB");

  const rxB = new HostReceiver();
  stackB.peer.sendTermOpen(stackB.conn, { ch: 2, sid: sidB, mode: "observe", afterSeq: null, receivedSegBytes: 0 });
  stackB.peer.sendCredit(stackB.conn, 2, { receivedThroughSeq: 0, receivedThroughBytes: 0, sendLimitSeq: 8, sendLimitBytes: 131_072 });
  await eventually(() => { rxB.drain(stackB.conn, 2); return rxB.openedRecords.length === 1; }, Boolean, "ch=2 opened for idB");
  const genB = rxB.openedRecords[0].generation;
  const incB = rxB.openedRecords[0].incarnation;

  stackB.peer.sendRecord(stackB.conn, { t: "term.ctl", ch: 2, sid: sidB, generation: genB, incarnation: incB, action: "acquire" });
  await eventually(() => { rxB.drain(stackB.conn, 2); return rxB.ctlStateRecords.some((r) => r.state === "granted"); }, Boolean, "idB acquired");

  // Break idle control socket -> surveillance detects & emits released < 1s
  const tBreak = Date.now();
  lastPort.close();
  await eventually(() => { rxB.drain(stackB.conn, 2); return rxB.ctlStateRecords.some((r) => r.state === "released"); }, Boolean, "released on broken idle socket", 2_000);
  const idleBreakDelayMs = Date.now() - tBreak;
  assert.ok(idleBreakDelayMs < 1_000, `idle break delay=${idleBreakDelayMs}ms must be < 1000ms`);
  assert.equal((await witness.state(idB)).holderKind, "none");

  // #20 Écriture rompue
  stackB.peer.sendRecord(stackB.conn, { t: "term.ctl", ch: 2, sid: sidB, generation: genB, incarnation: incB, action: "acquire" });
  await eventually(() => { rxB.drain(stackB.conn, 2); return rxB.ctlStateRecords.filter((r) => r.state === "granted").length === 2; }, Boolean, "idB reacquired");
  const epochB2 = rxB.ctlStateRecords.filter((r) => r.state === "granted")[1].epoch;
  holdNextWrite = true;
  stackB.peer.sendRecord(stackB.conn, {
    t: "term.in", ch: 2, sid: sidB, generation: genB, incarnation: incB,
    epoch: epochB2, inSeq: 1, ackThrough: 0, origin: "user", dataB64: b64("BROKEN\n")
  });
  await eventually(() => { rxB.drain(stackB.conn, 2); return rxB.ackRecords.length >= 1; }, Boolean, "uncertain ack");
  assert.equal(rxB.ackRecords[0].result, "uncertain");

  // #19 Arrêt from observer channel, then relaunch same id & present old couple -> stale-incarnation
  const rxBObs = new HostReceiver();
  stackB.peer.sendTermOpen(stackB.conn, { ch: 3, sid: sidB, mode: "observe", afterSeq: null, receivedSegBytes: 0 });
  stackB.peer.sendCredit(stackB.conn, 3, { receivedThroughSeq: 0, receivedThroughBytes: 0, sendLimitSeq: 8, sendLimitBytes: 131_072 });
  await eventually(() => { rxBObs.drain(stackB.conn, 3); return rxBObs.openedRecords.length === 1; }, Boolean, "ch=3 observer opened");
  stackB.peer.sendRecord(stackB.conn, { t: "term.stop", ch: 3, sid: sidB, generation: genB, incarnation: incB });
  await eventually(() => { rxBObs.drain(stackB.conn, 3); return rxBObs.exitRecords.length === 1; }, Boolean, "term.exit after term.stop");
  assert.equal(readChildStatus(childB.statusFile)?.gotSigterm, true);
  assert.equal((await witness.state(idB)).stopSignal, "SIGTERM");

  // Wait for host to prune exited idB or create a fresh session with same id
  await eventually(async () => (await witness.state(idB)).status === "exited", Boolean, "idB exited");
  const childB2 = writeChildScript(fx.root, "b2");
  await witness.create({ id: idB, command: process.execPath, args: [childB2.scriptPath], cwd: fx.root, env: fx.env, cols: 80, rows: 24 });
  await eventually(async () => (await witness.state(idB)).incarnation !== incB, Boolean, "new incarnation");
  await eventually(async () => {
    const r = await stackB.projector.resolveOpen(sidB);
    return r.ok && r.incarnation !== incB;
  }, Boolean, "projector sees new incarnation");

  const rxB2 = new HostReceiver();
  stackB.peer.sendTermOpen(stackB.conn, { ch: 4, sid: sidB, mode: "observe", afterSeq: null, receivedSegBytes: 0 });
  stackB.peer.sendCredit(stackB.conn, 4, { receivedThroughSeq: 0, receivedThroughBytes: 0, sendLimitSeq: 8, sendLimitBytes: 131_072 });
  await eventually(() => { rxB2.drain(stackB.conn, 4); return rxB2.openedRecords.length === 1; }, Boolean, "ch=4 opened on new incarnation");
  stackB.peer.sendRecord(stackB.conn, { t: "term.stop", ch: 4, sid: sidB, generation: genB, incarnation: incB });
  await eventually(() => { rxB2.drain(stackB.conn, 4); return rxB2.errRecords.length === 1; }, Boolean, "stale-incarnation err");
  assert.equal(rxB2.errRecords[0].code, "stale-incarnation");
  assert.equal((await witness.state(idB)).status, "running");

  t.diagnostic(`metrics: offDelayMs=${offDelayMs}, idleBreakDelayMs=${idleBreakDelayMs}`);
  stackB.bridge.dispose();
  stackB.projector.stopWatch();
  stackB.client.stop();
});

// ============================================================================
// 3. Sortie sous contrôle (4 cas, vérification suppression fichier journal)
// ============================================================================

test("LH-09b host #10: Sortie sous contrôle — log deleted on exit while controlled, after release, after term.stop, and during grace", { timeout: 90_000 }, async (t) => {
  // Helper to run one sub-case cleanly
  async function runExitCase(subT, mode) {
    const fx = makeHostFixture(subT, `l9ex-${mode}-`);
    const { client: witness, socketPath } = await fx.startHost();
    const child = writeChildScript(fx.root, mode);
    const id = `h2a-ex-${mode}`;
    await witness.create({ id, command: process.execPath, args: [child.scriptPath], cwd: fx.root, env: fx.env, cols: 80, rows: 24 });
    await eventually(() => readChildStatus(child.statusFile), (s) => s?.ready === true, `${mode} child ready`);

    const stack = setupRealStack(fx, () => [socketPath], { pollIntervalMs: 100 });
    stack.peer.sendWatchStart(stack.conn);
    const sid = nativeCatalogueSid(id);
    await eventually(async () => (await stack.projector.resolveOpen(sid)).ok, Boolean, `${mode} projector`);

    const rx = new HostReceiver();
    stack.peer.sendTermOpen(stack.conn, { ch: 2, sid, mode: "observe", afterSeq: null, receivedSegBytes: 0 });
    stack.peer.sendCredit(stack.conn, 2, { receivedThroughSeq: 0, receivedThroughBytes: 0, sendLimitSeq: 8, sendLimitBytes: 131_072 });
    await eventually(() => { rx.drain(stack.conn, 2); return rx.openedRecords.length === 1; }, Boolean, `${mode} opened`);
    const gen = rx.openedRecords[0].generation;
    const inc = rx.openedRecords[0].incarnation;

    stack.peer.sendRecord(stack.conn, { t: "term.ctl", ch: 2, sid, generation: gen, incarnation: inc, action: "acquire" });
    await eventually(() => { rx.drain(stack.conn, 2); return rx.ctlStateRecords.some((r) => r.state === "granted"); }, Boolean, `${mode} acquired`);
    const epoch = rx.ctlStateRecords.at(-1).epoch;
    const lf = logFileFor(fx.storeDir, stack.scope, sid, gen, inc);
    assert.equal(existsSync(lf), true, `${mode}: log file exists after acquire`);

    if (mode === "controlled") {
      sendChildCommand(child.cmdFile, 1, "exit", { code: 0 });
      await eventually(() => { rx.drain(stack.conn, 2); return rx.exitRecords.length === 1; }, Boolean, "controlled term.exit");
      assert.equal(rx.ctlStateRecords.filter((r) => r.state !== "granted").length, 0, "no term.ctl.state precedes term.exit");
    } else if (mode === "after-release") {
      stack.peer.sendRecord(stack.conn, { t: "term.ctl", ch: 2, sid, generation: gen, incarnation: inc, action: "release", epoch });
      await eventually(() => { rx.drain(stack.conn, 2); return rx.ctlStateRecords.some((r) => r.state === "released"); }, Boolean, "released");
      sendChildCommand(child.cmdFile, 1, "exit", { code: 0 });
      await eventually(() => { rx.drain(stack.conn, 2); return rx.exitRecords.length === 1; }, Boolean, "after-release term.exit");
    } else if (mode === "after-stop") {
      stack.peer.sendRecord(stack.conn, { t: "term.stop", ch: 2, sid, generation: gen, incarnation: inc });
      await eventually(() => { rx.drain(stack.conn, 2); return rx.exitRecords.length === 1; }, Boolean, "after-stop term.exit");
    } else if (mode === "during-grace") {
      stack.peer.dropConnection(stack.conn, "cut");
      await delay(100);
      assert.equal(stack.bridge.activeChannelCount(), 0);
      sendChildCommand(child.cmdFile, 1, "exit", { code: 0 });
      await eventually(async () => (await witness.state(id)).status === "exited", Boolean, "child exited during grace");
      // Surveillance runs every 250ms and detects exited -> endIncarnation deletes log file
      await eventually(() => !existsSync(lf), Boolean, "during-grace log deleted by surveillance", 3_000);
    }

    await eventually(() => !existsSync(lf), Boolean, `${mode}: log file must be deleted`, 2_000);
    const logDir = join(fx.storeDir, "remote-control", "input-log");
    assert.equal(existsSync(logDir) ? readdirSync(logDir).length : 0, 0, `${mode}: zero log files left`);

    stack.bridge.dispose();
    stack.projector.stopWatch();
    stack.client.stop();
  }

  await t.test("subcase: exit while controlled", (subT) => runExitCase(subT, "controlled"));
  await t.test("subcase: exit after release", (subT) => runExitCase(subT, "after-release"));
  await t.test("subcase: exit after term.stop", (subT) => runExitCase(subT, "after-stop"));
  await t.test("subcase: exit during grace", (subT) => runExitCase(subT, "during-grace"));
});

// ============================================================================
// 4. Coupures 20 s et 40 s en horloge monotone réelle (+ kill file pendant grâce)
// ============================================================================

test("LH-09b host #13/#14/#16: real monotonic clock 20s reconnect, 40s timeout, and kill file during grace <1s", { timeout: 110_000 }, async (t) => {
  const fx = makeHostFixture(t, "l9cut-");
  const { client: witness, socketPath } = await fx.startHost();
  const child = writeChildScript(fx.root, "cut");
  const id = "h2a-l9-cut";
  await witness.create({ id, command: process.execPath, args: [child.scriptPath], cwd: fx.root, env: fx.env, cols: 80, rows: 24 });
  await eventually(() => readChildStatus(child.statusFile), (s) => s?.ready === true, "child ready");

  const stack = setupRealStack(fx, () => [socketPath], { pollIntervalMs: 150 });
  stack.peer.sendWatchStart(stack.conn);
  const sid = nativeCatalogueSid(id);
  await eventually(async () => (await stack.projector.resolveOpen(sid)).ok, Boolean, "projector discovers");

  const rx1 = new HostReceiver();
  stack.peer.sendTermOpen(stack.conn, { ch: 2, sid, mode: "observe", afterSeq: null, receivedSegBytes: 0 });
  stack.peer.sendCredit(stack.conn, 2, { receivedThroughSeq: 0, receivedThroughBytes: 0, sendLimitSeq: 8, sendLimitBytes: 131_072 });
  await eventually(() => { rx1.drain(stack.conn, 2); return rx1.openedRecords.length === 1; }, Boolean, "ch=2 opened");
  const gen = rx1.openedRecords[0].generation;
  const inc = rx1.openedRecords[0].incarnation;

  stack.peer.sendRecord(stack.conn, { t: "term.ctl", ch: 2, sid, generation: gen, incarnation: inc, action: "acquire" });
  await eventually(() => { rx1.drain(stack.conn, 2); return rx1.ctlStateRecords.some((r) => r.state === "granted"); }, Boolean, "acquired");
  const epoch = rx1.ctlStateRecords.at(-1).epoch;

  stack.peer.sendRecord(stack.conn, { t: "term.in", ch: 2, sid, generation: gen, incarnation: inc, epoch, inSeq: 1, ackThrough: 0, origin: "user", dataB64: b64("A1\n") });
  await eventually(() => { rx1.drain(stack.conn, 2); return rx1.ackRecords.length === 1; }, Boolean, "A1 acked");

  // 20s real monotonic cut
  stack.peer.dropConnection(stack.conn, "cut-20s");
  await delay(20_000);
  assert.equal((await witness.state(id)).holderKind, "remote", "lease still held at 20s");
  const conn2 = await eventually(() => stack.peer.allConnections().find((c) => c !== stack.conn && !c.closed), Boolean, "reconnected", 15_000);
  const rx2 = new HostReceiver();
  stack.peer.sendWatchStart(conn2);
  stack.peer.sendTermOpen(conn2, { ch: 2, sid, mode: "observe", afterSeq: null, receivedSegBytes: 0 });
  stack.peer.sendCredit(conn2, 2, { receivedThroughSeq: 0, receivedThroughBytes: 0, sendLimitSeq: 8, sendLimitBytes: 131_072 });
  await eventually(() => { rx2.drain(conn2, 2); return rx2.openedRecords.length === 1; }, Boolean, "reopened after 20s");
  assert.equal(rx2.openedRecords[0].holderKind, "remote");
  assert.equal(rx2.openedRecords[0].controllerEpoch, epoch);

  stack.peer.sendRecord(conn2, { t: "term.in.sync", ch: 2, sid, generation: gen, incarnation: inc, epoch, lastAckedInSeq: 1 });
  await eventually(() => { rx2.drain(conn2, 2); return rx2.syncedRecords.length === 1; }, Boolean, "synced after 20s");
  stack.peer.sendRecord(conn2, { t: "term.in", ch: 2, sid, generation: gen, incarnation: inc, epoch, inSeq: 2, ackThrough: 1, origin: "user", dataB64: b64("A2\n") });
  await eventually(() => { rx2.drain(conn2, 2); return rx2.ackRecords.length >= 1; }, Boolean, "A2 applied");
  assert.equal(rx2.ackRecords.at(-1).result, "applied");
  assert.equal(readFileSync(child.inputLogFile, "utf8"), "A1\nA2\n");

  // 40s real monotonic cut -> released at 30s
  stack.peer.dropConnection(conn2, "cut-40s");
  await delay(40_000);
  assert.equal((await witness.state(id)).holderKind, "none", "lease released at 30s during 40s cut");
  const conn3 = await eventually(() => stack.peer.allConnections().filter((c) => !c.closed).at(-1), Boolean, "reconnected after 40s", 15_000);
  const rx3 = new HostReceiver();
  stack.peer.sendWatchStart(conn3);
  stack.peer.sendTermOpen(conn3, { ch: 2, sid, mode: "observe", afterSeq: null, receivedSegBytes: 0 });
  stack.peer.sendCredit(conn3, 2, { receivedThroughSeq: 0, receivedThroughBytes: 0, sendLimitSeq: 8, sendLimitBytes: 131_072 });
  await eventually(() => { rx3.drain(conn3, 2); return rx3.openedRecords.length === 1; }, Boolean, "reopened after 40s");
  assert.equal(rx3.openedRecords[0].holderKind, "none");

  stack.peer.sendRecord(conn3, { t: "term.in.sync", ch: 2, sid, generation: gen, incarnation: inc, epoch, lastAckedInSeq: 1 });
  await eventually(() => { rx3.drain(conn3, 2); return rx3.ctlStateRecords.some((r) => r.state === "lost-link"); }, Boolean, "lost-link replayed");

  // Kill file during grace -> released in <1s
  stack.peer.sendRecord(conn3, { t: "term.ctl", ch: 2, sid, generation: gen, incarnation: inc, action: "acquire" });
  await eventually(() => { rx3.drain(conn3, 2); return rx3.ctlStateRecords.some((r) => r.state === "granted"); }, Boolean, "re-acquired");
  stack.peer.dropConnection(conn3, "cut-for-kill");
  await delay(100);
  assert.equal((await witness.state(id)).holderKind, "remote");
  const tKill = Date.now();
  mkdirSync(join(fx.storeDir, "remote-control"), { recursive: true, mode: 0o700 });
  writeFileSync(join(fx.storeDir, "remote-control", "kill"), "1\n");
  await eventually(async () => (await witness.state(id)).holderKind, (hk) => hk === "none", "kill file during grace releases", 2_000);
  const killGraceDelayMs = Date.now() - tKill;
  assert.ok(killGraceDelayMs < 1_000, `kill during grace delay=${killGraceDelayMs}ms must be < 1000ms`);

  const cut20Trace = conn2.decodedClientRecords.filter((r) => r.ch === 2 && r.t !== "term.out").map((r) => r.state ? `${r.t}:${r.state}` : r.result ? `${r.t}:${r.result}` : r.t);
  const cut40Trace = conn3.decodedClientRecords.filter((r) => r.ch === 2 && r.t !== "term.out").map((r) => r.state ? `${r.t}:${r.state}` : r.result ? `${r.t}:${r.result}` : r.t);
  t.diagnostic(`metrics: killGraceDelayMs=${killGraceDelayMs}, cut20Trace=${JSON.stringify(cut20Trace)}, cut40Trace=${JSON.stringify(cut40Trace)}`);
  stack.bridge.dispose();
  stack.projector.stopWatch();
  stack.client.stop();
});

// ============================================================================
// 5. Agent tué (SIGKILL du processus agent entre écriture hôte et ack pair) & confidentialité
// ============================================================================

test("LH-09b host #22: Agent tué par SIGKILL entre écriture hôte et ack pair -> reprise sans doublon + confidentialité", { timeout: 45_000 }, async (t) => {
  const fx = makeHostFixture(t, "l9kill-");
  const { client: witness, socketPath } = await fx.startHost();
  const child = writeChildScript(fx.root, "kill");
  const id = "h2a-l9-kill";
  await witness.create({ id, command: process.execPath, args: [child.scriptPath], cwd: fx.root, env: fx.env, cols: 80, rows: 24 });
  await eventually(() => readChildStatus(child.statusFile), (s) => s?.ready === true, "child ready");

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
  const enrolmentRef = "enr-lh09-kill";
  peer.registerEnrolment({
    nodeId: key.nodeId,
    enrolmentRef,
    publicKeyPem: key.publicKeyPem,
    fingerprint: key.fingerprint
  });

  // Bridge FakeBinaryTrunkPeer connector to child agent process over a private Unix socket
  const ipcSock2 = join(fx.root, "trunk-ipc2.sock");
  let peerConn = null;
  let childSock = null;
  const server2 = createServer((sock) => {
    childSock = sock;
    const connector = peer.createConnector("kill-bridge");
    peerConn = connector.open(ENDPOINT, {
      onMessage(bytes) {
        if (!sock.destroyed) {
          const lenBuf = Buffer.allocUnsafe(4);
          lenBuf.writeUInt32BE(bytes.byteLength, 0);
          sock.write(Buffer.concat([lenBuf, bytes]));
        }
      },
      onClose() { try { sock.destroy(); } catch { /* ignore */ } },
      onError() {}
    });
    let buf = Buffer.alloc(0);
    sock.on("data", (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      while (buf.byteLength >= 4) {
        const len = buf.readUInt32BE(0);
        if (buf.byteLength < 4 + len) break;
        const frame = buf.subarray(4, 4 + len);
        buf = buf.subarray(4 + len);
        peerConn.send(frame);
      }
    });
    sock.on("close", () => {
      try { peerConn.close("child-killed"); } catch { /* ignore */ }
    });
  });
  await new Promise((res) => server2.listen(ipcSock2, res));
  t.after(() => { try { server2.close(); } catch { /* ignore */ } });

  const workerScript = join(fx.root, "agent-worker.mjs");
  const distIndex = join(REPO_ROOT, "packages", "h2a", "dist", "runtime", "remote-agent", "index.js");
  const runtimeInv = join(RUNTIME_DIST, "native-terminal", "remote-inventory.js");
  const peerHelperPath = join(REPO_ROOT, "packages", "h2a", "test", "helpers", "remote-trunk-peer.js");
  writeFileSync(
    workerScript,
    `import { createConnection } from "node:net";
import {
  CoalescedRangeIndex,
  createCatalogueProjector,
  createTerminalBridge,
  createTerminalInput,
  defaultConnectNativeControlPort,
  TrunkClient
} from ${JSON.stringify(distIndex)};
import { createSimulatedTrunkContractProvider } from ${JSON.stringify(peerHelperPath)};
import { listNativeInventoryForRemote } from ${JSON.stringify(runtimeInv)};

const [root, configDir, socketPath, ipcSock, enrolmentRef, nodeId] = process.argv.slice(2);
const clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => { const h = setTimeout(fn, ms); h.unref?.(); return h; },
  clearTimeout: (h) => clearTimeout(h)
};
const projector = createCatalogueProjector({
  root, configDir, env: process.env, clock, pollIntervalMs: 100,
  readNativeInventory: () => listNativeInventoryForRemote({ socketPaths: [socketPath], connectTimeoutMs: 250, requestTimeoutMs: 250 }),
  readPresences: () => []
});
const scope = ${JSON.stringify(MESH)} + "|" + ${JSON.stringify(TENANT)} + "|" + enrolmentRef + "|" + nodeId;
const input = createTerminalInput({
  root, scope, clock, env: process.env, withShareAllowed: projector.withShareAllowed,
  connectControlPort: async (sock, opts) => {
    const real = await defaultConnectNativeControlPort(sock, opts);
    return {
      acquire: (id, cid, win) => real.acquire(id, cid, win),
      write: async (lease, data) => {
        await real.write(lease, data);
        process.stdout.write("HOST_WRITE_ACKED\\n");
        await new Promise(() => {});
      },
      resize: (l, c, r) => real.resize(l, c, r),
      release: (l) => real.release(l),
      state: (id) => real.state(id),
      stopIfIncarnation: (id, g, i) => real.stopIfIncarnation(id, g, i),
      close: () => real.close()
    };
  }
});
const bridge = createTerminalBridge({ catalogue: projector, clock, rangeIndex: new CoalescedRangeIndex(), input });
const ipcConnector = {
  open(_ep, handlers) {
    const s = createConnection(ipcSock);
    let buf = Buffer.alloc(0);
    s.on("data", (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      while (buf.byteLength >= 4) {
        const len = buf.readUInt32BE(0);
        if (buf.byteLength < 4 + len) break;
        const frame = buf.subarray(4, 4 + len);
        buf = buf.subarray(4 + len);
        handlers.onMessage(frame);
      }
    });
    s.on("close", () => handlers.onClose("ipc-close"));
    s.on("error", (e) => handlers.onError(e));
    return {
      send(bytes) {
        if (s.destroyed) return;
        const lenBuf = Buffer.allocUnsafe(4);
        lenBuf.writeUInt32BE(bytes.byteLength, 0);
        s.write(Buffer.concat([lenBuf, bytes]));
      },
      close() { s.destroy(); }
    };
  }
};
const client = new TrunkClient({
  root, env: process.env,
  enrolment: { meshId: ${JSON.stringify(MESH)}, endpoint: ${JSON.stringify(ENDPOINT)}, tenantId: ${JSON.stringify(TENANT)}, enrolmentRef, nodeId },
  nodeKeyOptions: { configDir, env: process.env },
  connector: ipcConnector,
  contract: createSimulatedTrunkContractProvider(),
  clock,
  catalogue: projector,
  terminalConsumer: bridge
});
client.start();
`,
    "utf8"
  );

  const workerProc = spawn(
    process.execPath,
    [workerScript, fx.storeDir, fx.configDir, socketPath, ipcSock2, enrolmentRef, key.nodeId],
    { env: fx.env, cwd: fx.root, stdio: ["pipe", "pipe", "pipe"] }
  );
  fx.children.push(workerProc);
  let workerOut = "";
  workerProc.stdout.on("data", (b) => { workerOut += b; });
  workerProc.stderr.on("data", (b) => { workerOut += b; });

  const conn1 = await eventually(
    () => ({ conn: peer.allConnections()[0], out: workerOut, code: workerProc.exitCode }),
    (v) => Boolean(v.conn),
    "worker connected"
  ).then((v) => v.conn);
  await eventually(() => conn1.phase === "ready", Boolean, "worker ready");
  const sid = nativeCatalogueSid(id);
  peer.sendWatchStart(conn1);
  peer.sendCredit(conn1, 1, { receivedThroughSeq: 0, receivedThroughBytes: 0, sendLimitSeq: 8, sendLimitBytes: 131_072 });
  // Wait for catalogue snapshot to contain sid
  await eventually(() => conn1.decodedClientRecords.some((r) => r.t === "cat.snapshot.end"), Boolean, "catalogue snapshot");

  const rx1 = new HostReceiver();
  peer.sendTermOpen(conn1, { ch: 2, sid, mode: "observe", afterSeq: null, receivedSegBytes: 0 });
  peer.sendCredit(conn1, 2, { receivedThroughSeq: 0, receivedThroughBytes: 0, sendLimitSeq: 8, sendLimitBytes: 131_072 });
  await eventually(() => { rx1.drain(conn1, 2); return rx1.openedRecords.length === 1; }, Boolean, "worker ch=2 opened");
  const gen = rx1.openedRecords[0].generation;
  const inc = rx1.openedRecords[0].incarnation;

  peer.sendRecord(conn1, { t: "term.ctl", ch: 2, sid, generation: gen, incarnation: inc, action: "acquire" });
  await eventually(() => { rx1.drain(conn1, 2); return rx1.ctlStateRecords.some((r) => r.state === "granted"); }, Boolean, "worker acquired");
  const epoch = rx1.ctlStateRecords.at(-1).epoch;

  const secretCmd = "KILL_SENTINEL_42\n";
  peer.sendRecord(conn1, {
    t: "term.in", ch: 2, sid, generation: gen, incarnation: inc,
    epoch, inSeq: 1, ackThrough: 0, origin: "user", dataB64: b64(secretCmd)
  });
  await eventually(() => workerOut.includes("HOST_WRITE_ACKED"), Boolean, "host write acked before SIGKILL");
  workerProc.kill("SIGKILL");
  await once(workerProc, "exit");
  if (childSock) { try { childSock.destroy(); } catch { /* ignore */ } }

  // Relaunch agent on same root
  const stack2 = setupRealStack(fx, () => [socketPath], { key, enrolmentRef, pollIntervalMs: 100 });
  const conn2 = stack2.conn;
  stack2.peer.sendWatchStart(conn2);
  await eventually(async () => (await stack2.projector.resolveOpen(sid)).ok, Boolean, "relaunched projector discovers");
  const rx2 = new HostReceiver();
  stack2.peer.sendTermOpen(conn2, { ch: 2, sid, mode: "observe", afterSeq: null, receivedSegBytes: 0 });
  stack2.peer.sendCredit(conn2, 2, { receivedThroughSeq: 0, receivedThroughBytes: 0, sendLimitSeq: 8, sendLimitBytes: 131_072 });
  await eventually(() => { rx2.drain(conn2, 2); return rx2.openedRecords.length === 1; }, Boolean, "relaunched ch=2 opened");

  // Resend inSeq=1 on old epoch -> stale-epoch, zero duplicate writes
  stack2.peer.sendRecord(conn2, {
    t: "term.in", ch: 2, sid, generation: gen, incarnation: inc,
    epoch, inSeq: 1, ackThrough: 0, origin: "user", dataB64: b64(secretCmd)
  });
  await eventually(() => { rx2.drain(conn2, 2); return rx2.ackRecords.length >= 1; }, Boolean, "resend stale-epoch");
  assert.equal(rx2.ackRecords[0].result, "refused");
  assert.equal(rx2.ackRecords[0].reason, "stale-epoch");

  // Replay term.in.sync -> uncertain + term.in.synced + lost-link
  stack2.peer.sendRecord(conn2, {
    t: "term.in.sync", ch: 2, sid, generation: gen, incarnation: inc,
    epoch, lastAckedInSeq: 0
  });
  await eventually(() => { rx2.drain(conn2, 2); return rx2.ctlStateRecords.some((r) => r.state === "lost-link"); }, Boolean, "replay lost-link");
  assert.equal(rx2.ackRecords.some((a) => a.inSeq === 1 && a.result === "uncertain"), true);
  assert.equal(rx2.syncedRecords.some((s) => s.epoch === epoch && s.evicted === false), true);

  // Child received the command only once
  assert.equal(readChildStatus(child.statusFile).inputBytes, Buffer.byteLength(secretCmd));
  assert.equal(readFileSync(child.inputLogFile, "utf8"), secretCmd);

  // Privacy check: no keystroke, base64, fixture path, or env values in log/audits
  const lf = logFileFor(fx.storeDir, stack2.scope, sid, gen, inc);
  const logText = readFileSync(lf, "utf8");
  const auditText = JSON.stringify(stack2.inputAudits);
  const hostLogText = existsSync(fx.hostLogPath) ? readFileSync(fx.hostLogPath, "utf8") : "";
  const secretB64 = b64(secretCmd);
  for (const [label, txt] of [["log", logText], ["audits", auditText], ["hostLog", hostLogText]]) {
    assert.equal(txt.includes("KILL_SENTINEL_42"), false, `plaintext leaked in ${label}`);
    assert.equal(txt.includes(secretB64), false, `b64 leaked in ${label}`);
    assert.equal(txt.includes(fx.root), false, `root path leaked in ${label}`);
    assert.equal(txt.includes(fx.home), false, `home path leaked in ${label}`);
  }

  t.diagnostic(`metrics: killInputBytes=${readChildStatus(child.statusFile).inputBytes}, wet2TextHash=${stack2.contract.wet2TextHash}`);
  stack2.bridge.dispose();
  stack2.projector.stopWatch();
  stack2.client.stop();
});
