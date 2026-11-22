// LH-05 real-host end-to-end bench (RM-0 spike (b), GATE-LH-05):
// real NativeTerminalHost on a private Unix socket + real node-pty child in
// raw mode + real `op.js attach` views inside real 120x40 `script` terminals +
// real `NativeTerminalClient` remote & raw-human callers.
// Runs directly outside the D16 sandbox when writing H2A_LH05_WITNESS_DIR, or
// inside the D16 sandbox falling back to the disposable fixture root.
// Never imports native-isolation.js, never uses /tmp, never touches owner state.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { StringDecoder } from "node:string_decoder";
import test from "node:test";
import { fileURLToPath } from "node:url";

const { NativeTerminalClient } = await import("../../h2a-runtime/dist/native-terminal/client.js");
const { NativeTerminalRemoteError } = await import("../../h2a-runtime/dist/native-terminal/protocol.js");
const { renderTerminalScreen } = await import("../../h2a-runtime/dist/native-terminal/screen.js");

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const RUNTIME_DIST = join(REPO_ROOT, "packages", "h2a-runtime", "dist");
const BANNER_TEXT = "remote control active — remote.sent-tech.ca — type to take back";

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const monoMs = () => Number(process.hrtime.bigint()) / 1e6;

async function eventually(read, accept, label, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const val = await read();
    if (accept(val)) return val;
    assert.ok(Date.now() < deadline, `${label}: ${JSON.stringify(val)}`);
    await delay(20);
  }
}

function readJsonLines(filePath) {
  if (!existsSync(filePath)) return [];
  const raw = readFileSync(filePath, "utf8");
  return raw
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));
}

function hashPrefix(secret) {
  return createHash("sha256").update(secret).digest("hex").slice(0, 12);
}

function writeChildScript(root, childInputFile, childSizeFile, childLinesFile) {
  const scriptPath = join(root, "pty-child.mjs");
  const cmdFile = join(root, "child-cmd.json");
  const statusFile = join(root, "child-status.json");
  writeFileSync(
    scriptPath,
    `import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
const cmdFile = ${JSON.stringify(cmdFile)};
const statusFile = ${JSON.stringify(statusFile)};
const childInputFile = ${JSON.stringify(childInputFile)};
const childSizeFile = ${JSON.stringify(childSizeFile)};
const childLinesFile = ${JSON.stringify(childLinesFile)};

const mono = () => Number(process.hrtime.bigint()) / 1e6;
let inputSeq = 0;
let sizeSeq = 0;
let lineSeq = 0;
let lastCmdId = 0;
let attachCsiC = false;

if (process.stdin.isTTY) {
  process.stdin.setRawMode(true);
}
process.stdin.resume();

function recordSize(event) {
  sizeSeq += 1;
  appendFileSync(
    childSizeFile,
    JSON.stringify({
      seq: sizeSeq,
      monoMs: mono(),
      wallMs: Date.now(),
      event,
      cols: process.stdout.columns ?? null,
      rows: process.stdout.rows ?? null,
    }) + "\\n",
    "utf8",
  );
}

recordSize("start");
process.stdout.on("resize", () => recordSize("SIGWINCH"));

process.stdin.on("data", (buf) => {
  inputSeq += 1;
  appendFileSync(
    childInputFile,
    JSON.stringify({
      seq: inputSeq,
      monoMs: mono(),
      wallMs: Date.now(),
      hex: buf.toString("hex"),
      length: buf.byteLength,
    }) + "\\n",
    "utf8",
  );
  publish();
});

function publish(extra = {}) {
  writeFileSync(
    statusFile,
    JSON.stringify({
      ready: true,
      inputSeq,
      sizeSeq,
      lineSeq,
      lastCmdId,
      cols: process.stdout.columns ?? null,
      rows: process.stdout.rows ?? null,
      at: Date.now(),
      ...extra,
    }),
  );
}

publish();

setInterval(() => {
  lineSeq += 1;
  const line = attachCsiC ? \`LINE-\${lineSeq}\\x1b[c\\n\` : \`LINE-\${lineSeq}\\n\`;
  process.stdout.write(line);
  appendFileSync(
    childLinesFile,
    JSON.stringify({
      seq: lineSeq,
      monoMs: mono(),
      wallMs: Date.now(),
      hasCsiC: attachCsiC,
    }) + "\\n",
    "utf8",
  );
}, 250);

setInterval(() => {
  if (!existsSync(cmdFile)) return;
  try {
    const cmd = JSON.parse(readFileSync(cmdFile, "utf8"));
    if (cmd.id <= lastCmdId) return;
    lastCmdId = cmd.id;
    if (cmd.action === "set-line-csi-c") {
      attachCsiC = cmd.enabled === true;
    } else if (cmd.action === "write-line-45") {
      process.stdout.write("\\x1b[45;1HLINE45-TEST");
    } else if (cmd.action === "esc-decaln") {
      process.stdout.write("\\x1b#8");
    } else if (cmd.action === "query-csi-c") {
      process.stdout.write("\\x1b[c");
    } else if (cmd.action === "query-csi-6n") {
      process.stdout.write("\\x1b[6n");
    } else if (cmd.action === "enable-focus-mouse") {
      process.stdout.write("\\x1b[?1004h\\x1b[?1000h\\x1b[?1006h");
    }
    publish();
  } catch {
    // ignore partial write
  }
}, 20);
`,
    "utf8",
  );
  return { scriptPath, cmdFile, statusFile };
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

test("LH-05 real-host arbitration bench (RM-0 spike b, manipulations 1..5)", { timeout: 120_000 }, async (t) => {
  assert.ok(process.env.TMPDIR && resolve(process.env.TMPDIR) !== "/tmp", "Supply a disposable TMPDIR (never /tmp)");
  const root = mkdtempSync(join(process.env.TMPDIR, "lh05-"));
  const witnessDir = process.env.H2A_LH05_WITNESS_DIR ? resolve(process.env.H2A_LH05_WITNESS_DIR) : join(root, "witnesses");
  try {
    mkdirSync(witnessDir, { recursive: true, mode: 0o755 });
    const probeFile = join(witnessDir, ".write-probe");
    writeFileSync(probeFile, "ok\n", "utf8");
    unlinkSync(probeFile);
  } catch (error) {
    assert.fail(`cannot prepare witness dir ${witnessDir} (${error?.code ?? "ERR"}): ${error?.message ?? error}`);
  }

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
  };

  const spawnedPids = [];
  const stoppedPids = [];
  const children = [];
  const clients = [];

  const rootResolved = resolve(root);
  const isolationVars = [
    "HOME",
    "XDG_RUNTIME_DIR",
    "XDG_CONFIG_HOME",
    "XDG_STATE_HOME",
    "REMOTE_CLI_CONFIG_HOME",
    "TMPDIR",
    "TMP",
    "TEMP",
    "TMUX_TMPDIR",
    "H2A_ROOT",
    "H2A_NATIVE_SOCKET",
    "H2A_NATIVE_HOST_LOG",
    "DBUS_SESSION_BUS_ADDRESS",
  ].map((name) => {
    const raw = env[name];
    const target = raw.startsWith("unix:path=") ? raw.slice("unix:path=".length) : raw;
    const resolvedTarget = resolve(target);
    const underRoot = resolvedTarget === rootResolved || resolvedTarget.startsWith(`${rootResolved}/`);
    assert.ok(underRoot, `isolation var ${name} must point under root`);
    return { name, underRoot };
  });

  const timelineFile = join(witnessDir, "timeline.jsonl");
  const hostStateFile = join(witnessDir, "host-state.jsonl");
  const remoteCallsFile = join(witnessDir, "remote-calls.jsonl");
  const childInputFile = join(witnessDir, "child-input.jsonl");
  const childSizeFile = join(witnessDir, "child-size.jsonl");
  const childLinesFile = join(witnessDir, "child-lines.jsonl");
  for (const f of [timelineFile, hostStateFile, remoteCallsFile, childInputFile, childSizeFile, childLinesFile]) {
    writeFileSync(f, "", "utf8");
  }

  let timelineSeq = 0;
  let stateSeq = 0;
  let remoteCallSeq = 0;
  let cmdSeq = 0;

  function logTimeline(manipulation, actor, act, outcome, extra = {}) {
    timelineSeq += 1;
    const rec = {
      seq: timelineSeq,
      monoMs: monoMs(),
      wallMs: Date.now(),
      wallIso: new Date().toISOString(),
      manipulation,
      actor,
      act,
      outcome,
      ...extra,
    };
    appendFileSync(timelineFile, `${JSON.stringify(rec)}\n`, "utf8");
    return rec;
  }

  async function readAndLogState(witness, id, manipulation, label) {
    const s = await witness.state(id);
    stateSeq += 1;
    appendFileSync(
      hostStateFile,
      `${JSON.stringify({
        seq: stateSeq,
        monoMs: monoMs(),
        wallMs: Date.now(),
        manipulation,
        label,
        status: s.status,
        controlled: s.controlled,
        holderKind: s.holderKind ?? null,
        controllerEpoch: s.controllerEpoch ?? null,
        cols: s.cols ?? null,
        rows: s.rows ?? null,
        lastLocalSize: s.lastLocalSize ?? null,
        lastHumanActivityAt: s.lastHumanActivityAt ?? null,
        controller: s.controller ?? null,
        stopSignal: s.stopSignal ?? null,
      })}\n`,
      "utf8",
    );
    return s;
  }

  t.after(async () => {
    for (const c of clients) {
      try { c.close(); } catch { /* ignore */ }
    }
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) {
        try {
          child.kill("SIGTERM");
          if (child.pid) stoppedPids.push(child.pid);
        } catch { /* ignore */ }
        await Promise.race([once(child, "exit"), delay(1_500)]);
        if (child.exitCode === null && child.signalCode === null) {
          try {
            child.kill("SIGKILL");
          } catch { /* ignore */ }
          await Promise.race([once(child, "exit"), delay(1_000)]);
        }
      }
    }
    if (existsSync(hostLogPath)) {
      copyFileSync(hostLogPath, join(witnessDir, "host.log"));
    }
    writeFileSync(
      join(witnessDir, "isolation.json"),
      JSON.stringify({ isolationVars, spawnedPids, stoppedPids }, null, 2),
      "utf8",
    );
    rmSync(root, { recursive: true, force: true });
  });

  // Start real native host
  const hostProc = spawn(
    process.execPath,
    [join(RUNTIME_DIST, "native-terminal/process.js"), "--socket", socketPath, "--registry-path", registryPath],
    { env, cwd: root, stdio: ["pipe", "pipe", "pipe"] },
  );
  children.push(hostProc);
  if (hostProc.pid) spawnedPids.push(hostProc.pid);
  let hostOut = "";
  hostProc.stdout.on("data", (b) => { hostOut += b; });
  hostProc.stderr.on("data", (b) => { hostOut += b; });
  await eventually(
    () => ({ hostOut, code: hostProc.exitCode, sig: hostProc.signalCode }),
    (v) => v.hostOut.includes("h2a.native-terminal.ready") || v.code !== null || v.sig !== null,
    "native host readiness",
    15_000,
  );
  assert.ok(hostOut.includes("h2a.native-terminal.ready"), `host failed to start: ${hostOut}`);

  const T = await NativeTerminalClient.connect(socketPath);
  clients.push(T);
  const ping = await T.ping();
  assert.equal(ping.hostPid, hostProc.pid, "ping hostPid must match spawned host process PID");
  const readyLine = hostOut.split("\n").find((l) => l.includes("h2a.native-terminal.ready")) ?? "";
  writeFileSync(
    join(witnessDir, "host-ready.json"),
    JSON.stringify({
      readyLine,
      spawnedHostPid: hostProc.pid,
      ping,
      hostPidVerified: ping.hostPid === hostProc.pid,
    }, null, 2),
    "utf8",
  );
  logTimeline("setup", "host", "start", "ready", { hostPid: hostProc.pid });

  const id = "h2a-lh05-bench";
  const childFiles = writeChildScript(root, childInputFile, childSizeFile, childLinesFile);
  await T.create({
    id,
    command: process.execPath,
    args: [childFiles.scriptPath],
    cwd: root,
    env,
    cols: 100,
    rows: 30,
  });
  await eventually(() => readChildStatus(childFiles.statusFile), (s) => s?.ready === true, "child ready");
  await eventually(() => readJsonLines(childSizeFile), (rows) => rows.length >= 1, "child start size");
  const initialSize = readJsonLines(childSizeFile)[0];
  assert.equal(initialSize.cols, 100);
  assert.equal(initialSize.rows, 30);

  function launchView(name, { takeover = false } = {}) {
    const quote = (v) => "'" + v.replace(/'/g, "'\\''") + "'";
    const attachCmd = [
      process.execPath,
      join(RUNTIME_DIST, "native-terminal/op.js"),
      "attach",
      "--id",
      id,
      ...(takeover ? ["--takeover"] : []),
    ]
      .map(quote)
      .join(" ");
    const fullCmd = `stty rows 40 cols 120 && exec ${attachCmd}`;
    const proc = spawn("script", ["-q", "-e", "-f", "-c", fullCmd, "/dev/null"], {
      env,
      cwd: root,
      stdio: ["pipe", "pipe", "pipe"],
    });
    children.push(proc);
    if (proc.pid) spawnedPids.push(proc.pid);

    const displayPath = join(witnessDir, `view-${name}.display.bin`);
    writeFileSync(displayPath, Buffer.alloc(0));
    const decoder = new StringDecoder("utf8");
    const chunks = [];
    let text = "";
    let bannerWatch = false;
    let bannerWatchFromTextLen = 0;
    let bannerArrival = null;

    const onChunk = (buf) => {
      chunks.push(buf);
      appendFileSync(displayPath, buf);
      text += decoder.write(buf);
      if (bannerWatch && bannerArrival === null) {
        const idx = text.indexOf(BANNER_TEXT, bannerWatchFromTextLen);
        if (idx >= 0) {
          bannerArrival = { monoMs: monoMs(), wallMs: Date.now() };
          bannerWatch = false;
        }
      }
    };
    proc.stdout.on("data", onChunk);
    proc.stderr.on("data", onChunk);
    const done = once(proc, "exit").then(([code, signal]) => {
      if (proc.pid && !stoppedPids.includes(proc.pid)) stoppedPids.push(proc.pid);
      return { code, signal };
    });

    return {
      name,
      proc,
      done,
      displayText: () => Buffer.concat(chunks).toString("utf8"),
      displayLen: () => text.length,
      armBannerWatch: (fromLen = text.length) => {
        bannerWatch = true;
        bannerWatchFromTextLen = fromLen;
        bannerArrival = null;
        if (text.indexOf(BANNER_TEXT, fromLen) >= 0) {
          bannerArrival = { monoMs: monoMs(), wallMs: Date.now() };
          bannerWatch = false;
        }
      },
      bannerArrival: () => bannerArrival,
      write: (data) => proc.stdin.write(data),
    };
  }

  async function saveScreen(view, moment) {
    const rendered = await renderTerminalScreen(view.displayText(), 120, 40);
    writeFileSync(join(witnessDir, `view-${view.name}.screen-${moment}.txt`), `${rendered}\n`, "utf8");
    return rendered;
  }

  async function remoteAcquire({ manipulation, caller, windowMs }) {
    const conn = await NativeTerminalClient.connect(socketPath);
    clients.push(conn);
    const controllerId = `h2a-remote:${randomUUID()}`;
    const startMono = monoMs();
    try {
      const res = await conn.acquireRemoteControllerIfNoRecentHuman(id, controllerId, windowMs);
      const endMono = monoMs();
      remoteCallSeq += 1;
      appendFileSync(
        remoteCallsFile,
        `${JSON.stringify({
          seq: remoteCallSeq,
          monoMs: endMono,
          wallMs: Date.now(),
          manipulation,
          caller,
          op: "acquire-remote-controller-if-no-recent-human",
          windowMs,
          granted: res.granted,
          reason: res.granted ? null : res.reason,
          controllerEpoch: res.granted ? res.lease.epoch : res.controllerEpoch,
          error: null,
          errorCode: null,
          durationMs: Math.round((endMono - startMono) * 1000) / 1000,
          controllerIdHashPrefix: hashPrefix(controllerId),
        })}\n`,
        "utf8",
      );
      logTimeline(
        manipulation,
        caller,
        "acquire-remote",
        res.granted ? `granted:epoch=${res.lease.epoch}` : `refused:${res.reason}:epoch=${res.controllerEpoch}`,
        { windowMs },
      );
      return { conn, controllerId, res, responseMonoMs: endMono, responseWallMs: Date.now() };
    } catch (error) {
      const endMono = monoMs();
      remoteCallSeq += 1;
      appendFileSync(
        remoteCallsFile,
        `${JSON.stringify({
          seq: remoteCallSeq,
          monoMs: endMono,
          wallMs: Date.now(),
          manipulation,
          caller,
          op: "acquire-remote-controller-if-no-recent-human",
          windowMs,
          granted: false,
          reason: null,
          controllerEpoch: null,
          error: error?.message ?? String(error),
          errorCode: error?.code ?? null,
          durationMs: Math.round((endMono - startMono) * 1000) / 1000,
          controllerIdHashPrefix: hashPrefix(controllerId),
        })}\n`,
        "utf8",
      );
      logTimeline(manipulation, caller, "acquire-remote", `error:${error?.code ?? "err"}:${error?.message ?? error}`);
      conn.close();
      throw error;
    }
  }

  async function expectStaleAct(manipulation, caller, opName, fn) {
    const startMono = monoMs();
    let caught = null;
    try {
      await fn();
    } catch (err) {
      caught = err;
    }
    const endMono = monoMs();
    assert.ok(caught instanceof NativeTerminalRemoteError, `${caller} ${opName} must reject with NativeTerminalRemoteError`);
    assert.equal(caught.code, "operation-failed");
    assert.equal(caught.message, "stale terminal controller lease");
    remoteCallSeq += 1;
    appendFileSync(
      remoteCallsFile,
      `${JSON.stringify({
        seq: remoteCallSeq,
        monoMs: endMono,
        wallMs: Date.now(),
        manipulation,
        caller,
        op: opName,
        windowMs: null,
        granted: null,
        reason: null,
        controllerEpoch: null,
        error: caught.message,
        errorCode: caught.code,
        durationMs: Math.round((endMono - startMono) * 1000) / 1000,
        controllerIdHashPrefix: null,
      })}\n`,
      "utf8",
    );
    logTimeline(manipulation, caller, opName, `rejected:${caught.code}:${caught.message}`);
  }

  // =========================================================================
  // Manipulation 1 · Humain actif (F2)
  // =========================================================================
  const A = launchView("A");
  const s1Init = await eventually(
    () => T.state(id),
    (s) => s.holderKind === "human" && s.cols === 120 && s.rows === 39,
    "M1: A must attach at 120x39",
  );
  await readAndLogState(T, id, "M1", "after-A-attach");
  await eventually(
    () => readJsonLines(childSizeFile),
    (rows) => rows.some((r) => r.cols === 120 && r.rows === 39),
    "M1: child must observe 120x39",
  );
  const e1 = s1Init.controllerEpoch;
  const t0 = s1Init.lastHumanActivityAt;
  assert.ok(typeof t0 === "number" && Number.isSafeInteger(t0), "t0 must be set on human acquire alone");
  const L = { cols: s1Init.cols, rows: s1Init.rows };
  assert.deepEqual(L, { cols: 120, rows: 39 });

  await delay(15);
  const beforeInputCount1 = readJsonLines(childInputFile).length;
  A.write("a");
  logTimeline("M1", "A", "type-a", "sent");
  await eventually(
    () => readJsonLines(childInputFile),
    (rows) => rows.length > beforeInputCount1 && rows.at(-1).hex === "61",
    "M1: child must receive 0x61",
  );
  const s1AfterKey = await readAndLogState(T, id, "M1", "after-A-key-a");
  const t1 = s1AfterKey.lastHumanActivityAt;
  assert.ok(typeof t1 === "number" && t1 > t0, `t1 (${t1}) must exceed t0 (${t0})`);

  const wait1a = t1 + 1_000 - Date.now();
  if (wait1a > 0) await delay(wait1a);
  const m1a = await remoteAcquire({ manipulation: "M1", caller: "D", windowMs: 30_000 });
  assert.deepEqual(m1a.res, { granted: false, reason: "recent-human", controllerEpoch: e1 });
  m1a.conn.close();
  const s1After1a = await readAndLogState(T, id, "M1", "after-D-1s");
  assert.equal(s1After1a.holderKind, "human");
  assert.equal(s1After1a.controllerEpoch, e1);
  assert.equal(s1After1a.cols, L.cols);
  assert.equal(s1After1a.rows, L.rows);

  const wait1b = t1 + 29_400 - Date.now();
  if (wait1b > 0) await delay(wait1b);
  const m1b = await remoteAcquire({ manipulation: "M1", caller: "D-29500", windowMs: 30_000 });
  assert.ok(m1b.responseWallMs < t1 + 30_000, `second M1 acquire must finish before t1+30000 (${m1b.responseWallMs} vs ${t1 + 30_000})`);
  assert.deepEqual(m1b.res, { granted: false, reason: "recent-human", controllerEpoch: e1 });
  m1b.conn.close();
  const s1After1b = await readAndLogState(T, id, "M1", "after-D-29500");
  assert.equal(s1After1b.holderKind, "human");
  assert.equal(s1After1b.controllerEpoch, e1);
  assert.equal(s1After1b.lastHumanActivityAt, t1);
  assert.equal(s1After1b.cols, L.cols);
  assert.equal(s1After1b.rows, L.rows);

  // =========================================================================
  // Manipulation 2 · Humain inactif (F1) + Observation 3b bis
  // =========================================================================
  const wait2 = t1 + 30_040 - Date.now();
  if (wait2 > 0) await delay(wait2);
  A.armBannerWatch(A.displayLen());
  const aDisplayLenAtGrant = A.displayLen();
  sendChildCommand(childFiles.cmdFile, ++cmdSeq, "set-line-csi-c", { enabled: true });

  const m2 = await remoteAcquire({ manipulation: "M2", caller: "D", windowMs: 30_000 });
  assert.equal(m2.res.granted, true);
  const leaseE2 = m2.res.lease;
  const e2 = leaseE2.epoch;
  assert.equal(e2, e1 + 1);
  const dConn = m2.conn;

  const s2AfterGrant = await readAndLogState(T, id, "M2", "after-D-grant");
  assert.equal(s2AfterGrant.holderKind, "remote");
  assert.equal(s2AfterGrant.controllerEpoch, e2);
  assert.equal(s2AfterGrant.controller?.tty, "remote");
  assert.equal(s2AfterGrant.controller?.pid, null);
  assert.equal(s2AfterGrant.lastHumanActivityAt, t1);
  assert.equal(s2AfterGrant.cols, L.cols);
  assert.equal(s2AfterGrant.rows, L.rows);
  assert.deepEqual(s2AfterGrant.lastLocalSize, L);

  const bannerOnA = await eventually(() => A.bannerArrival(), Boolean, "M2: banner must appear on A", 3_000);
  const bannerDelayMs = bannerOnA.monoMs - m2.responseMonoMs;
  logTimeline("M2", "A", "banner-arrived", `delayMs=${bannerDelayMs.toFixed(2)}`);
  assert.ok(bannerDelayMs <= 1_000, `banner latency ${bannerDelayMs}ms must be <= 1000ms`);

  // Wait for at least 2 numbered lines after grant to verify 3b bis & A stays open
  const linesAtGrant = readJsonLines(childLinesFile).filter((l) => l.wallMs >= m2.responseWallMs).length;
  await eventually(
    () => readJsonLines(childLinesFile).filter((l) => l.wallMs >= m2.responseWallMs),
    (rows) => rows.length >= linesAtGrant + 2,
    "M2: child emits lines after grant",
  );
  await delay(650);
  sendChildCommand(childFiles.cmdFile, ++cmdSeq, "set-line-csi-c", { enabled: false });
  assert.equal(A.proc.exitCode, null, "A must stay open in observer mode");
  const lastPostGrantLine = readJsonLines(childLinesFile).at(-1);
  await eventually(
    () => A.displayText().slice(aDisplayLenAtGrant),
    (txt) => txt.includes(`LINE-${lastPostGrantLine.seq}`),
    "M2: A displays numbered lines emitted after grant",
  );
  assert.equal(A.displayText().slice(aDisplayLenAtGrant).includes("\x1b[c"), false, "3b bis: CSI c must be filtered from A after grant");
  await saveScreen(A, "after-grant");

  // Launch B without --takeover
  const B = launchView("B");
  B.armBannerWatch(0);
  await eventually(() => B.bannerArrival(), Boolean, "M2: banner must appear on B", 5_000);
  await eventually(
    () => B.displayText(),
    (txt) => txt.includes(`LINE-${lastPostGrantLine.seq}`),
    "M2: B displays child output",
  );
  const s2AfterB = await readAndLogState(T, id, "M2", "after-B-attach");
  assert.equal(s2AfterB.holderKind, "remote");
  assert.equal(s2AfterB.controllerEpoch, e2);
  await saveScreen(B, "after-grant");

  // =========================================================================
  // Manipulation 3 · Bandeau et géométrie (F3) + Observations 3b, 3c
  // =========================================================================
  const beforeResizeCount3 = readJsonLines(childSizeFile).length;
  await dConn.resize(leaseE2, 132, 45);
  logTimeline("M3", "D", "resize", "132x45");
  const s3AfterResize = await readAndLogState(T, id, "M3", "after-D-resize-132x45");
  assert.equal(s3AfterResize.cols, 132);
  assert.equal(s3AfterResize.rows, 45);
  assert.deepEqual(s3AfterResize.lastLocalSize, L);
  await eventually(
    () => readJsonLines(childSizeFile).slice(beforeResizeCount3),
    (rows) => rows.some((r) => r.cols === 132 && r.rows === 45),
    "M3: child must log 132x45",
  );
  await saveScreen(A, "after-resize");
  await saveScreen(B, "after-resize");

  // Write on line 45
  sendChildCommand(childFiles.cmdFile, ++cmdSeq, "write-line-45");
  await eventually(
    () => ({ a: A.displayText(), b: B.displayText() }),
    (v) => v.a.includes("LINE45-TEST") && v.b.includes("LINE45-TEST"),
    "M3: LINE45-TEST arrives in A and B",
  );
  const aAt45 = A.displayText().slice(0, A.displayText().indexOf("LINE45-TEST") + "LINE45-TEST".length);
  const bAt45 = B.displayText().slice(0, B.displayText().indexOf("LINE45-TEST") + "LINE45-TEST".length);
  const screenAAt45 = await renderTerminalScreen(aAt45, 120, 40);
  const screenBAt45 = await renderTerminalScreen(bAt45, 120, 40);
  const screenA45 = await saveScreen(A, "after-line45");
  const screenB45 = await saveScreen(B, "after-line45");
  const linesA45 = screenA45.split("\n");
  const linesB45 = screenB45.split("\n");
  assert.equal(linesA45.length, 40);
  assert.equal(linesB45.length, 40);
  assert.equal(linesA45[39].trim(), BANNER_TEXT, "M3: A last line must carry only banner after line 45 write");
  assert.equal(linesB45[39].trim(), BANNER_TEXT, "M3: B last line must carry only banner after line 45 write");
  assert.ok(screenAAt45.split("\n")[38].includes("LINE45-TEST"), "3c: LINE45-TEST must appear clamped on line 39 (index 38) of A");
  assert.ok(screenBAt45.split("\n")[38].includes("LINE45-TEST"), "3c: LINE45-TEST must appear clamped on line 39 (index 38) of B");
  assert.equal(/\[h2a\].*remote control active/.test(A.displayText()), false, "M3: no [h2a] line may carry banner on A");
  assert.equal(/\[h2a\].*remote control active/.test(B.displayText()), false, "M3: no [h2a] line may carry banner on B");

  // 3c: ESC # 8 (DECALN)
  const aLenBeforeEsc8 = A.displayLen();
  const bLenBeforeEsc8 = B.displayLen();
  sendChildCommand(childFiles.cmdFile, ++cmdSeq, "esc-decaln");
  await eventually(
    () => ({ a: A.displayText().slice(aLenBeforeEsc8), b: B.displayText().slice(bLenBeforeEsc8) }),
    (v) => v.a.includes("\x1b#8") && v.b.includes("\x1b#8"),
    "3c: ESC # 8 arrives in A and B",
  );
  await delay(150);
  const screenAEsc8 = await saveScreen(A, "after-esc8");
  const screenBEsc8 = await saveScreen(B, "after-esc8");
  assert.ok(screenAEsc8.includes("EEEE"), "3c: A screen shows DECALN E fill");
  assert.ok(screenBEsc8.includes("EEEE"), "3c: B screen shows DECALN E fill");
  assert.equal(screenAEsc8.split("\n")[39].trim(), BANNER_TEXT, "3c: A last line keeps banner after ESC # 8");
  assert.equal(screenBEsc8.split("\n")[39].trim(), BANNER_TEXT, "3c: B last line keeps banner after ESC # 8");

  // 3b: Terminal queries + reports ignored
  const aLenBefore3b = A.displayLen();
  const inputCountBefore3b = readJsonLines(childInputFile).length;
  sendChildCommand(childFiles.cmdFile, ++cmdSeq, "query-csi-c");
  await delay(80);
  sendChildCommand(childFiles.cmdFile, ++cmdSeq, "query-csi-6n");
  await eventually(
    () => readJsonLines(childInputFile).slice(inputCountBefore3b),
    (rows) => rows.some((r) => r.hex === "1b5b313b3152"),
    "3b: host must reply CSI 1;1R to CSI 6n",
  );
  sendChildCommand(childFiles.cmdFile, ++cmdSeq, "enable-focus-mouse");
  await delay(200);
  assert.equal(A.displayText().slice(aLenBefore3b).includes("\x1b[c"), false, "3b: CSI c absent from A display");
  assert.equal(A.displayText().slice(aLenBefore3b).includes("\x1b[6n"), false, "3b: CSI 6n absent from A display");

  const inputCountBeforeReports = readJsonLines(childInputFile).length;
  A.write("\x1b[?1;2c\x1b[10;20R\x1b[I\x1b[O\x1b[<0;10;10M");
  logTimeline("M3", "A", "terminal-reports", "sent-5-reports");
  await delay(200);
  const s3AfterReports = await readAndLogState(T, id, "M3", "after-3b-reports");
  assert.equal(s3AfterReports.holderKind, "remote");
  assert.equal(s3AfterReports.controllerEpoch, e2);
  assert.equal(readJsonLines(childInputFile).length, inputCountBeforeReports, "3b: zero bytes from A reports may reach child");

  // =========================================================================
  // Manipulation 4 · Première frappe (F4, F5, F2)
  // =========================================================================
  // 4a. Detach B with 0x1c
  const inputCountBefore4a = readJsonLines(childInputFile).length;
  B.write(Buffer.from([0x1c]));
  const bExit = await B.done;
  logTimeline("M4a", "B", "detach-0x1c", `exit=${bExit.code}`);
  assert.equal(bExit.code, 0);
  assert.match(B.displayText(), /detached from native session/);
  const s4a = await readAndLogState(T, id, "M4a", "after-B-detach");
  assert.equal(s4a.holderKind, "remote");
  assert.equal(s4a.controllerEpoch, e2);
  assert.equal(readJsonLines(childInputFile).length, inputCountBefore4a, "M4a: zero bytes to child");

  // 4b. First keystroke x in A, wait for human, then y
  await delay(10);
  const inputCountBeforeX = readJsonLines(childInputFile).length;
  const sizeCountBeforeX = readJsonLines(childSizeFile).length;
  const xSentWallMs = Date.now();
  A.write("x");
  logTimeline("M4b", "A", "type-x-takeback", "sent");
  const s4b = await eventually(
    () => T.state(id),
    (s) => s.holderKind === "human" && s.cols === L.cols && s.rows === L.rows,
    "M4b: x must take back control and restore L",
  );
  await readAndLogState(T, id, "M4b", "after-x-takeback");
  const e3 = s4b.controllerEpoch;
  assert.equal(e3, e2 + 1);
  assert.ok(s4b.lastHumanActivityAt >= xSentWallMs, "M4b: lastHumanActivityAt must be >= xSentWallMs");
  await eventually(
    () => readJsonLines(childSizeFile).slice(sizeCountBeforeX),
    (rows) => rows.some((r) => r.cols === L.cols && r.rows === L.rows),
    "M4b: child must receive SIGWINCH restoring L",
  );

  A.write("y");
  logTimeline("M4b", "A", "type-y", "sent");
  await eventually(
    () => readJsonLines(childInputFile).slice(inputCountBeforeX),
    (rows) => rows.length >= 1,
    "M4b: child must receive y (79)",
  );
  await delay(150);
  const inputsAfterX = readJsonLines(childInputFile).slice(inputCountBeforeX);
  assert.equal(inputsAfterX.length, 1, `M4b: child must receive exactly 1 block after x, got ${JSON.stringify(inputsAfterX)}`);
  assert.equal(inputsAfterX[0].hex, "79", "M4b: only 0x79 may arrive; 0x78 must be discarded");
  assert.equal(readJsonLines(childInputFile).some((r) => r.hex.includes("78")), false, "M4b: child must never receive 0x78");

  const screenA4b = await saveScreen(A, "after-takeback");
  assert.equal(screenA4b.includes(BANNER_TEXT), false, "M4b: banner must leave A rendered screen after takeback");

  // 4c. D presents stale lease e2 to write, resize, releaseController
  const inputCountBefore4c = readJsonLines(childInputFile).length;
  await expectStaleAct("M4c", "D", "write", () => dConn.write(leaseE2, "stale"));
  await expectStaleAct("M4c", "D", "resize", () => dConn.resize(leaseE2, 132, 45));
  await expectStaleAct("M4c", "D", "releaseController", () => dConn.releaseController(leaseE2));
  assert.equal(readJsonLines(childInputFile).length, inputCountBefore4c, "M4c: zero bytes to child");
  const s4c = await readAndLogState(T, id, "M4c", "after-stale-acts");
  assert.equal(s4c.cols, L.cols);
  assert.equal(s4c.rows, L.rows);
  dConn.close();

  // 4d. D re-asks immediately with window 30000
  const m4d = await remoteAcquire({ manipulation: "M4d", caller: "D-4d", windowMs: 30_000 });
  assert.deepEqual(m4d.res, { granted: false, reason: "recent-human", controllerEpoch: e3 });
  m4d.conn.close();

  // =========================================================================
  // Manipulation 5 · Libération et arrêt (F5, F1, F3) + Observations 5a, 5b
  // =========================================================================
  // 5a. D2 acquires (window 2000), resizes 132x45, releases -> A passive return -> D3 acquires < 2000ms
  const sBefore5a = await readAndLogState(T, id, "M5a", "before-D2");
  const wait5a = sBefore5a.lastHumanActivityAt + 2_100 - Date.now();
  if (wait5a > 0) await delay(wait5a);
  A.armBannerWatch(A.displayLen());
  const m5aD2 = await remoteAcquire({ manipulation: "M5a", caller: "D2", windowMs: 2_000 });
  assert.equal(m5aD2.res.granted, true);
  await eventually(() => A.bannerArrival(), Boolean, "M5a: banner must appear on A", 3_000);
  await saveScreen(A, "5a-during-d2");

  const sizeCountBeforeD2 = readJsonLines(childSizeFile).length;
  await m5aD2.conn.resize(m5aD2.res.lease, 132, 45);
  await eventually(
    () => readJsonLines(childSizeFile).slice(sizeCountBeforeD2),
    (rows) => rows.some((r) => r.cols === 132 && r.rows === 45),
    "M5a: child resized to 132x45 by D2",
  );
  const sBeforeD2Release = await readAndLogState(T, id, "M5a", "before-D2-release");
  const sigBeforeRelease = sBeforeD2Release.lastHumanActivityAt;

  const sizeCountBeforeRelease = readJsonLines(childSizeFile).length;
  await m5aD2.conn.releaseController(m5aD2.res.lease);
  m5aD2.conn.close();
  logTimeline("M5a", "D2", "releaseController", "released");

  const sAfterPassive = await eventually(
    () => T.state(id),
    (s) => s.holderKind === "human",
    "M5a: A must passively reacquire human control",
  );
  await readAndLogState(T, id, "M5a", "after-A-passive-return");
  assert.equal(sAfterPassive.cols, L.cols);
  assert.equal(sAfterPassive.rows, L.rows);
  assert.equal(sAfterPassive.lastHumanActivityAt, sigBeforeRelease, "5a: passive return must not change lastHumanActivityAt");
  await eventually(
    () => readJsonLines(childSizeFile).slice(sizeCountBeforeRelease),
    (rows) => rows.some((r) => r.cols === L.cols && r.rows === L.rows),
    "M5a: child restored to L on D2 release",
  );
  await delay(150);
  const screenA5aRelease = await saveScreen(A, "after-release");
  assert.equal(screenA5aRelease.includes(BANNER_TEXT), false, "M5a: banner gone after D2 release");

  // D3 acquires within 2000ms of A's passive return
  const m5aD3 = await remoteAcquire({ manipulation: "M5a", caller: "D3", windowMs: 2_000 });
  assert.equal(m5aD3.res.granted, true, "5a: D3 granted within 2000ms of A passive return");

  // 5b. Detach A with 0x1c, launch C with --takeover
  A.write(Buffer.from([0x1c]));
  const aExit = await A.done;
  assert.equal(aExit.code, 0);
  const s5bAfterA = await readAndLogState(T, id, "M5b", "after-A-detach");
  assert.equal(s5bAfterA.holderKind, "remote");
  assert.equal(s5bAfterA.controllerEpoch, m5aD3.res.lease.epoch);

  const C = launchView("C", { takeover: true });
  const s5bAfterC = await eventually(
    () => T.state(id),
    (s) => s.holderKind === "human" && s.controllerEpoch > m5aD3.res.lease.epoch,
    "M5b: C --takeover must take human control",
  );
  await readAndLogState(T, id, "M5b", "after-C-takeover");
  assert.equal(s5bAfterC.cols, L.cols);
  assert.equal(s5bAfterC.rows, L.rows);
  assert.equal(C.displayText().includes(BANNER_TEXT), false, "M5b: C must never display banner");
  await expectStaleAct("M5b", "D3", "write", () => m5aD3.conn.write(m5aD3.res.lease, "stale-d3"));
  m5aD3.conn.close();

  // 5c. Detach C with 0x1c, wait for exit AND holderKind === "none" (NB-3), then raw H
  C.write(Buffer.from([0x1c]));
  const cExit = await C.done;
  assert.equal(cExit.code, 0);
  await eventually(
    () => T.state(id),
    (s) => s.holderKind === "none",
    "M5c: wait for C connection close to release lease",
  );
  await readAndLogState(T, id, "M5c", "after-C-detach-none");

  const H = await NativeTerminalClient.connect(socketPath);
  clients.push(H);
  const leaseH = await H.acquireController(id, "human-raw-H", "human", { pid: process.pid, tty: "raw-H" });
  const sizeCountBeforeH = readJsonLines(childSizeFile).length;
  await H.resize(leaseH, 90, 25);
  await eventually(
    () => readJsonLines(childSizeFile).slice(sizeCountBeforeH),
    (rows) => rows.some((r) => r.cols === 90 && r.rows === 25),
    "M5c: child resized to 90x25 by H",
  );
  const sH = await readAndLogState(T, id, "M5c", "after-H-90x25");
  const wait5cD4 = sH.lastHumanActivityAt + 2_100 - Date.now();
  if (wait5cD4 > 0) await delay(wait5cD4);

  const m5cD4 = await remoteAcquire({ manipulation: "M5c", caller: "D4", windowMs: 2_000 });
  assert.equal(m5cD4.res.granted, true);
  await m5cD4.conn.resize(m5cD4.res.lease, 132, 45);

  const inputCountBeforeHStale = readJsonLines(childInputFile).length;
  await expectStaleAct("M5c", "H", "write", () => H.write(leaseH, "stale-h"));
  await expectStaleAct("M5c", "H", "resize", () => H.resize(leaseH, 90, 25));
  await expectStaleAct("M5c", "H", "releaseController", () => H.releaseController(leaseH));
  assert.equal(readJsonLines(childInputFile).length, inputCountBeforeHStale, "M5c: zero bytes from stale H");
  const sAfterHStale = await readAndLogState(T, id, "M5c", "after-H-stale");
  assert.equal(sAfterHStale.holderKind, "remote");

  const sizeCountBeforeHTakeover = readJsonLines(childSizeFile).length;
  await H.acquireController(id, "human-raw-H", "human", { takeover: true, pid: process.pid, tty: "raw-H" });
  const sAfterHTakeover = await readAndLogState(T, id, "M5c", "after-H-takeover-no-resize");
  assert.equal(sAfterHTakeover.holderKind, "human");
  assert.equal(sAfterHTakeover.cols, 90);
  assert.equal(sAfterHTakeover.rows, 25);
  await eventually(
    () => readJsonLines(childSizeFile).slice(sizeCountBeforeHTakeover),
    (rows) => rows.some((r) => r.cols === 90 && r.rows === 25),
    "M5c: child restored to 90x25 on H takeover",
  );
  m5cD4.conn.close();
  H.close();
  await eventually(() => T.state(id), (s) => s.holderKind === "none", "M5c: H close -> none");
  const sAfterHClose = await readAndLogState(T, id, "M5c", "after-H-close");

  const wait5cD5 = sAfterHClose.lastHumanActivityAt + 2_100 - Date.now();
  if (wait5cD5 > 0) await delay(wait5cD5);
  const m5cD5 = await remoteAcquire({ manipulation: "M5c", caller: "D5", windowMs: 2_000 });
  assert.equal(m5cD5.res.granted, true);
  await m5cD5.conn.resize(m5cD5.res.lease, 132, 45);
  const sizeCountBeforeD5Release = readJsonLines(childSizeFile).length;
  await m5cD5.conn.releaseController(m5cD5.res.lease);
  m5cD5.conn.close();
  const sAfterD5Release = await readAndLogState(T, id, "M5c", "after-D5-release");
  assert.equal(sAfterD5Release.holderKind, "none");
  assert.equal(sAfterD5Release.cols, 90);
  assert.equal(sAfterD5Release.rows, 25);
  await eventually(
    () => readJsonLines(childSizeFile).slice(sizeCountBeforeD5Release),
    (rows) => rows.some((r) => r.cols === 90 && r.rows === 25),
    "M5c: child restored to 90x25 on D5 release",
  );

  // 5d. D6 acquires, A2 launches, T stops incarnation
  const wait5d = sAfterD5Release.lastHumanActivityAt + 2_100 - Date.now();
  if (wait5d > 0) await delay(wait5d);
  const m5dD6 = await remoteAcquire({ manipulation: "M5d", caller: "D6", windowMs: 2_000 });
  assert.equal(m5dD6.res.granted, true);

  const A2 = launchView("A2");
  A2.armBannerWatch(0);
  await eventually(() => A2.bannerArrival(), Boolean, "M5d: banner appears on A2", 5_000);
  const screenA2Grant = await saveScreen(A2, "after-grant");
  assert.equal(screenA2Grant.split("\n")[39].trim(), BANNER_TEXT, "M5d: A2 last line shows banner");

  const sBeforeStop = await readAndLogState(T, id, "M5d", "before-stopIfIncarnation");
  await T.stopIfIncarnation(id, sBeforeStop.generation, sBeforeStop.incarnation, "SIGTERM");
  logTimeline("M5d", "T", "stopIfIncarnation", "SIGTERM");
  let a2ExitedFlag = false;
  const observedAfterStop = [];
  const poller = (async () => {
    while (!a2ExitedFlag) {
      try {
        const st = await readAndLogState(T, id, "M5d", "between-stop-and-A2-exit");
        observedAfterStop.push(st);
      } catch {
        break;
      }
      await delay(40);
    }
  })();

  const a2Exit = await A2.done;
  a2ExitedFlag = true;
  await poller;

  assert.equal(a2Exit.code, 0, "M5d: A2 must exit with code 0");
  assert.match(A2.displayText(), /session stopped \(SIGTERM\)/);
  assert.equal(A2.displayText().includes("controller revoked"), false, "M5d: A2 must not display controller revoked");
  for (const st of observedAfterStop) {
    assert.equal(st.holderKind, "none", "M5d: no state between stop and A2 exit may show a holder");
  }
  const sFinal = await readAndLogState(T, id, "M5d", "after-A2-exit");
  assert.equal(sFinal.status, "exited");
  assert.equal(sFinal.holderKind, "none");

  const screenA2Stop = await saveScreen(A2, "after-stop");
  assert.equal(screenA2Stop.includes(BANNER_TEXT), false, "M5d: banner must be absent from A2 last screen");

  await expectStaleAct("M5d", "D6", "write", () => m5dD6.conn.write(m5dD6.res.lease, "after-stop"));
  m5dD6.conn.close();

  // Final replay witness check
  const fullReplay = await T.readOutput(id, 0);
  const replayRaw = fullReplay.chunks.map((c) => c.data).join("");
  writeFileSync(join(witnessDir, "host-replay.bin"), replayRaw, "utf8");
  assert.equal(replayRaw.includes(BANNER_TEXT), false, "F3: banner must have 0 occurrences in host replay");
  assert.equal(replayRaw.includes("\x1b[c"), true, "3b: CSI c must appear in host replay");
  assert.equal(replayRaw.includes("\x1b[6n"), true, "3b: CSI 6n must appear in host replay");
  assert.equal(readFileSync(childInputFile, "utf8").includes(BANNER_TEXT), false, "F3: banner must not appear in child input");
});
