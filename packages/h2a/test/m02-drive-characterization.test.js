import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash, generateKeyPairSync, randomBytes } from "node:crypto";
import { once } from "node:events";
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  createLocalStore,
  parseSignedDriveInstruction,
  runCli,
  writePresence,
} from "../dist/index.js";
import { NativeTerminalClient } from "../../h2a-runtime/dist/native-terminal/client.js";
import { enroll } from "../../h2a-runtime/dist/registry.js";

import {
  MESH_TARGET_B_PENDING_REASON,
  assertScenarioPhase,
  runTwinTargetScenario,
} from "./twin-target-characterization.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const NATIVE_HOST_PROCESS = join(
  HERE,
  "..",
  "..",
  "h2a-runtime",
  "dist",
  "native-terminal",
  "process.js",
);
const FROM = "claude:m02-lead";
const TO = "codex:m02-worker";

const RAW_OBSERVER_SOURCE = String.raw`
import { appendFileSync, writeFileSync } from "node:fs";

const capturePath = process.argv[2];
const eventsPath = process.argv[3];
writeFileSync(capturePath, Buffer.alloc(0));
writeFileSync(eventsPath, "");

function record(event) {
  appendFileSync(eventsPath, JSON.stringify(event) + "\n");
}

if (process.stdin.isTTY !== true || process.stdout.isTTY !== true ||
    typeof process.stdin.setRawMode !== "function") {
  record({ type: "no-controlling-terminal", code: "NO_CONTROLLING_TERMINAL" });
  process.exit(72);
}

process.stdin.setRawMode(true);
process.stdin.resume();
record({
  type: "ready",
  stdinIsTTY: process.stdin.isTTY,
  stdoutIsTTY: process.stdout.isTTY,
  raw: process.stdin.isRaw,
  columns: process.stdout.columns,
  rows: process.stdout.rows,
});
process.stdout.write("m02-observer-ready\r\n");

process.on("SIGWINCH", () => {
  record({
    type: "resize",
    columns: process.stdout.columns,
    rows: process.stdout.rows,
  });
});

process.stdin.on("data", (chunk) => {
  appendFileSync(capturePath, chunk);
  record({ type: "input-chunk", bytesBase64: chunk.toString("base64") });
});

setInterval(() => {}, 1000);
`;

function freshDirectory(label) {
  return mkdtempSync(join(tmpdir(), `h2a-m02-${label}-`));
}

function captureStreams(cwd) {
  let stdout = "";
  let stderr = "";
  return {
    streams: {
      stdout: { write: (chunk) => void (stdout += chunk) },
      stderr: { write: (chunk) => void (stderr += chunk) },
      cwd: () => cwd,
    },
    out: () => stdout,
    err: () => stderr,
  };
}

function registerDrivePair(root, publicKeyPem) {
  const store = createLocalStore({ root });
  store.registerInstance({
    id: FROM,
    instance: FROM,
    roles: ["CONDUCTOR"],
    scopes: ["scope:m02-characterization"],
    capabilities: ["drive"],
    endpoints: [],
    publicKeys: [publicKeyPem],
    acceptedPolicies: [],
    createdAt: "2026-09-12T00:00:00.000Z",
  });
  store.registerInstance({
    id: TO,
    instance: TO,
    roles: ["AGENTS"],
    scopes: ["scope:m02-characterization"],
    conductor: FROM,
    capabilities: ["execute"],
    endpoints: [],
    publicKeys: [],
    acceptedPolicies: [],
    createdAt: "2026-09-12T00:00:00.000Z",
  });
  return store;
}

function writeDriveKey(directory) {
  const keys = generateKeyPairSync("ed25519");
  const privateKeyPem = keys.privateKey
    .export({ format: "pem", type: "pkcs8" })
    .toString();
  const publicKeyPem = keys.publicKey
    .export({ format: "pem", type: "spki" })
    .toString();
  const privateKeyPath = join(directory, "drive-private.pem");
  writeFileSync(privateKeyPath, privateKeyPem, { mode: 0o600 });
  return { privateKeyPath, publicKeyPem };
}

function readEvents(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function readCapture(path) {
  return existsSync(path) ? readFileSync(path) : Buffer.alloc(0);
}

async function eventually(read, accept, label) {
  let last;
  for (let attempt = 0; attempt < 300; attempt += 1) {
    last = await read();
    if (accept(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`${label} did not become observable; last=${JSON.stringify(last)}`);
}

function snapshotFiles(root) {
  if (!existsSync(root)) return [];
  const rows = [];
  function visit(path) {
    for (const name of readdirSync(path).sort()) {
      const entry = join(path, name);
      const rel = relative(root, entry);
      const stat = lstatSync(entry);
      if (stat.isDirectory()) {
        rows.push({ path: `${rel}/`, kind: "directory" });
        visit(entry);
      } else if (stat.isSymbolicLink()) {
        rows.push({ path: rel, kind: "symlink", target: readlinkSync(entry) });
      } else {
        const content = readFileSync(entry);
        rows.push({
          path: rel,
          kind: "file",
          bytes: content.length,
          sha256: createHash("sha256").update(content).digest("hex"),
        });
      }
    }
  }
  visit(root);
  return rows;
}

function nonEmptyTerminalInputs(buffer) {
  return buffer
    .toString("utf8")
    .split("\r")
    .filter((line) => line.length > 0)
    .map((line) => ({
      text: line,
      bytesBase64: Buffer.from(line, "utf8").toString("base64"),
    }));
}

function nativeCliOutcome(stdout, exitCode) {
  let driven = false;
  try {
    driven = JSON.parse(stdout).driven === true;
  } catch {
    driven = false;
  }
  return {
    source: "native-cli-boolean",
    code: driven ? "DRIVEN_TRUE" : "DRIVEN_FALSE",
    contractGrade: false,
    exitCode,
  };
}

function driveArgs({ root, privateKeyPath, instruction, driver, from = FROM }) {
  return [
    "drive",
    "--root",
    root,
    "--from",
    from,
    "--to",
    TO,
    "--instruction",
    instruction,
    "--private-key",
    privateKeyPath,
    "--driver",
    driver,
    "--nonce",
    `m02-${randomBytes(8).toString("hex")}`,
    "--at",
    new Date().toISOString(),
  ];
}

async function startTmuxTarget() {
  const directory = freshDirectory("tmux");
  const observerPath = join(directory, "raw-observer.mjs");
  const capturePath = join(directory, "input.bin");
  const eventsPath = join(directory, "events.jsonl");
  const storeRoot = join(directory, "store");
  const session = `h2a-m02-${process.pid}-${randomBytes(4).toString("hex")}`;
  writeFileSync(observerPath, RAW_OBSERVER_SOURCE);
  let started;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    started = spawnSync(
      "tmux",
      [
        "new-session",
        "-d",
        "-x",
        "80",
        "-y",
        "24",
        "-s",
        session,
        process.execPath,
        observerPath,
        capturePath,
        eventsPath,
      ],
      { encoding: "utf8" },
    );
    if (started.status === 0) break;
    // tmux new-session can lose a server-startup race under concurrent session
    // creation on CI runners (status 1, "server exited unexpectedly"); back off
    // and retry the FIXTURE SETUP rather than failing on a transient infra hiccup.
    // A genuine failure still surfaces below, legibly, after the bounded retries.
    await new Promise((resolve) => setTimeout(resolve, 150 * attempt));
  }
  assert.equal(
    started.status,
    0,
    `tmux new-session did not start after 5 attempts: ${started.stderr || started.error?.message}`,
  );
  const paneResult = spawnSync(
    "tmux",
    ["display-message", "-p", "-t", session, "#{pane_id}"],
    { encoding: "utf8" },
  );
  assert.equal(paneResult.status, 0, paneResult.stderr);
  const pane = paneResult.stdout.trim();
  await eventually(
    () => readEvents(eventsPath),
    (events) => events.some((event) => event.type === "ready"),
    "tmux raw observer readiness",
  );

  const { privateKeyPath, publicKeyPem } = writeDriveKey(directory);
  registerDrivePair(storeRoot, publicKeyPem);
  const now = new Date().toISOString();
  writePresence(storeRoot, {
    sessionId: `presence-${session}`,
    instance: TO,
    host: "codex",
    startedAt: now,
    heartbeatAt: now,
    state: "live",
    interests: { scopes: ["scope:m02-characterization"], negotiations: [] },
    subscribedTopics: [],
    launchContext: {
      cwd: directory,
      command: "codex",
      tmux: { session, pane },
    },
  });

  return {
    kind: "local-tmux",
    directory,
    storeRoot,
    privateKeyPath,
    capturePath,
    eventsPath,
    session,
    pane,
    async close() {
      spawnSync("tmux", ["kill-session", "-t", session], { encoding: "utf8" });
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

function tmuxAdapter(target, args) {
  const baseline = readCapture(target.capturePath);
  let expectedBytes;
  return {
    resolveTarget: () => ({
      kind: "tmux-pane",
      instance: TO,
      session: target.session,
      pane: target.pane,
    }),
    observeTargetState: async () => {
      if (expectedBytes !== undefined) {
        await eventually(
          () => readCapture(target.capturePath).length,
          (length) => length >= baseline.length + expectedBytes,
          "tmux terminal input",
        );
      }
      const bytes = readCapture(target.capturePath);
      const live = spawnSync(
        "tmux",
        ["display-message", "-p", "-t", target.pane, "#{pane_dead}"],
        { encoding: "utf8" },
      );
      return {
        status: live.status === 0 && live.stdout.trim() === "0" ? "alive" : "dead",
        inputBytesBase64: bytes.toString("base64"),
        chunks: readEvents(target.eventsPath)
          .filter((event) => event.type === "input-chunk")
          .map((event) => event.bytesBase64),
      };
    },
    observeDurableState: () => snapshotFiles(target.storeRoot),
    observeTerminalInputs: () =>
      nonEmptyTerminalInputs(readCapture(target.capturePath).subarray(baseline.length)),
    invoke() {
      const cap = captureStreams(target.directory);
      const exitCode = runCli(args, cap.streams);
      if (cap.out()) {
        const output = JSON.parse(cap.out());
        expectedBytes = Buffer.byteLength(output.instructionLine, "utf8") + 2;
      } else {
        expectedBytes = 0;
      }
      if (exitCode !== 0) expectedBytes = 0;
      return {
        stdout: cap.out(),
        stderr: cap.err(),
        exitCode,
        typedOutcome: nativeCliOutcome(cap.out(), exitCode),
        receipts: [],
      };
    },
  };
}

function processStat(pid) {
  const raw = readFileSync(`/proc/${pid}/stat`, "utf8");
  const end = raw.lastIndexOf(") ");
  assert.notEqual(end, -1);
  const fields = raw.slice(end + 2).split(" ");
  return {
    pgrp: Number(fields[2]),
    session: Number(fields[3]),
    ttyNr: Number(fields[4]),
  };
}

function fdTargets(pid) {
  return readdirSync(`/proc/${pid}/fd`)
    .map((fd) => {
      try {
        return readlinkSync(`/proc/${pid}/fd/${fd}`);
      } catch {
        return "<raced>";
      }
    });
}

async function startNativeTarget() {
  assert.equal(process.platform, "linux", "headless native characterization requires Linux");
  assert.ok(existsSync("/usr/bin/setsid") || existsSync("/bin/setsid"), "setsid is required");
  assert.ok(existsSync(NATIVE_HOST_PROCESS), "native terminal host must be built");

  const directory = freshDirectory("native");
  const observerPath = join(directory, "raw-observer.mjs");
  const capturePath = join(directory, "input.bin");
  const eventsPath = join(directory, "events.jsonl");
  const socketPath = join(directory, "native.sock");
  const hostRegistryPath = join(directory, "host-registry.json");
  const configHome = join(directory, "config-home");
  const runtimeRegistryPath = join(
    configHome,
    ".config",
    "sentropic",
    "remote-cli",
    "registry.json",
  );
  const storeRoot = join(directory, "store");
  const sessionId = `m02-native-${randomBytes(4).toString("hex")}`;
  writeFileSync(observerPath, RAW_OBSERVER_SOURCE);

  const setsid = existsSync("/usr/bin/setsid") ? "/usr/bin/setsid" : "/bin/setsid";
  const env = {
    ...process.env,
    H2A_NATIVE_SOCKET: socketPath,
    REMOTE_CLI_CONFIG_HOME: configHome,
    H2A_WAKE_DEFER_ACTIVITY_MS: "0",
  };
  const host = spawn(
    setsid,
    [
      process.execPath,
      NATIVE_HOST_PROCESS,
      "--socket",
      socketPath,
      "--generation",
      "m02-characterization",
      "--replay-bytes",
      String(1024 * 1024),
      "--registry-path",
      hostRegistryPath,
    ],
    {
      cwd: directory,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let hostStdout = "";
  let hostStderr = "";
  host.stdout.on("data", (chunk) => void (hostStdout += chunk));
  host.stderr.on("data", (chunk) => void (hostStderr += chunk));

  const client = await eventually(
    async () => {
      if (!existsSync(socketPath)) return undefined;
      try {
        return await NativeTerminalClient.connect(socketPath);
      } catch {
        return undefined;
      }
    },
    (value) => value !== undefined,
    "headless native host",
  );

  const created = await client.create({
    id: sessionId,
    command: process.execPath,
    args: [observerPath, capturePath, eventsPath],
    cwd: directory,
    env: { PATH: process.env.PATH ?? "/usr/bin:/bin", TERM: "xterm-256color" },
    cols: 80,
    rows: 24,
  });
  await eventually(
    () => readEvents(eventsPath),
    (events) => events.some((event) => event.type === "ready"),
    "native raw observer readiness",
  );

  enroll(
    {
      id: "m02-worker",
      label: "m02-worker",
      tool: "codex",
      kind: "local-native",
      cwd: directory,
      tmuxSession: sessionId,
      source: "run",
      sessionClass: "human",
    },
    runtimeRegistryPath,
  );
  const { privateKeyPath, publicKeyPem } = writeDriveKey(directory);
  registerDrivePair(storeRoot, publicKeyPem);

  return {
    kind: "local-native",
    directory,
    storeRoot,
    privateKeyPath,
    capturePath,
    eventsPath,
    socketPath,
    configHome,
    runtimeRegistryPath,
    sessionId,
    host,
    hostStdout: () => hostStdout,
    hostStderr: () => hostStderr,
    client,
    created,
    env,
    async stopHost() {
      client.close();
      if (host.exitCode === null && host.signalCode === null) host.kill("SIGTERM");
      if (host.exitCode === null && host.signalCode === null) await once(host, "exit");
    },
    async close() {
      await this.stopHost();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

function nativeAdapter(target, args, { expectedEffect = true } = {}) {
  const baseline = readCapture(target.capturePath);
  let expectedBytes;
  return {
    resolveTarget: () => ({
      kind: "native-terminal",
      instance: TO,
      registryLabel: "m02-worker",
      sessionId: target.sessionId,
      hostGeneration: "m02-characterization",
    }),
    observeTargetState: async () => {
      if (expectedBytes !== undefined && expectedEffect) {
        await eventually(
          () => readCapture(target.capturePath).length,
          (length) => length >= baseline.length + expectedBytes,
          "native terminal input",
        );
      }
      let status = "unreachable";
      let pid = target.created.pid;
      try {
        const state = await target.client.state(target.sessionId);
        status = state.status;
        pid = state.pid;
      } catch {
        status = "unreachable";
      }
      const bytes = readCapture(target.capturePath);
      return {
        status,
        pid,
        inputBytesBase64: bytes.toString("base64"),
        chunks: readEvents(target.eventsPath)
          .filter((event) => event.type === "input-chunk")
          .map((event) => event.bytesBase64),
      };
    },
    observeDurableState: () => ({
      h2a: snapshotFiles(target.storeRoot),
      registry: snapshotFiles(dirname(target.runtimeRegistryPath)),
    }),
    observeTerminalInputs: () =>
      nonEmptyTerminalInputs(readCapture(target.capturePath).subarray(baseline.length)),
    invoke() {
      const cap = captureStreams(target.directory);
      const previous = {
        socket: process.env.H2A_NATIVE_SOCKET,
        configHome: process.env.REMOTE_CLI_CONFIG_HOME,
        activity: process.env.H2A_WAKE_DEFER_ACTIVITY_MS,
      };
      Object.assign(process.env, target.env);
      let exitCode;
      try {
        exitCode = runCli(args, cap.streams);
      } finally {
        if (previous.socket === undefined) delete process.env.H2A_NATIVE_SOCKET;
        else process.env.H2A_NATIVE_SOCKET = previous.socket;
        if (previous.configHome === undefined) delete process.env.REMOTE_CLI_CONFIG_HOME;
        else process.env.REMOTE_CLI_CONFIG_HOME = previous.configHome;
        if (previous.activity === undefined) delete process.env.H2A_WAKE_DEFER_ACTIVITY_MS;
        else process.env.H2A_WAKE_DEFER_ACTIVITY_MS = previous.activity;
      }
      if (cap.out()) {
        const output = JSON.parse(cap.out());
        expectedBytes = exitCode === 0
          ? Buffer.byteLength(output.instructionLine, "utf8") + 1
          : 0;
      } else {
        expectedBytes = 0;
      }
      return {
        stdout: cap.out(),
        stderr: cap.err(),
        exitCode,
        typedOutcome: nativeCliOutcome(cap.out(), exitCode),
        receipts: [],
      };
    },
  };
}

function assertHeadlessOpenPty(target) {
  const hostStat = processStat(target.host.pid);
  assert.equal(hostStat.session, target.host.pid, "setsid host must lead its own session");
  assert.equal(hostStat.ttyNr, 0, "setsid host must have no controlling terminal");
  assert.equal(readlinkSync(`/proc/${target.host.pid}/fd/0`), "/dev/null");

  const slaveFds = [0, 1, 2].map((fd) => readlinkSync(`/proc/${target.created.pid}/fd/${fd}`));
  assert.ok(slaveFds.every((entry) => /^\/dev\/pts\/\d+$/.test(entry)), slaveFds.join(", "));
  assert.equal(new Set(slaveFds).size, 1, "child stdio must share one explicit PTY slave");
  assert.ok(
    fdTargets(target.host.pid).some((entry) => entry === "/dev/ptmx" || entry === "/dev/pts/ptmx"),
    "native host must retain the explicit PTY master",
  );
}

test("should characterize exact M02 delivery and zero-effect refusal on local-tmux Target-A", async () => {
  const target = await startTmuxTarget();
  const previousActivity = process.env.H2A_WAKE_DEFER_ACTIVITY_MS;
  process.env.H2A_WAKE_DEFER_ACTIVITY_MS = "0";
  try {
    const refusedArgs = driveArgs({
      root: target.storeRoot,
      privateKeyPath: target.privateKeyPath,
      instruction: "must not arrive",
      driver: "local-tmux",
      from: "codex:unregistered",
    });
    const refused = await runTwinTargetScenario({
      scenario: "M02/F1 missing registration",
      phase: "pre-admission-refusal",
      hostKind: "local-tmux",
      input: { argv: refusedArgs },
      native: tmuxAdapter(target, refusedArgs),
    });
    assertScenarioPhase(refused);
    assert.equal(refused.targetA.exitCode, 2);
    assert.match(refused.targetA.stderr, /missing-registration/);

    const instruction = "M02 literal escape: \u001b[31m; UTF-8: café 🧭";
    const acceptedArgs = driveArgs({
      root: target.storeRoot,
      privateKeyPath: target.privateKeyPath,
      instruction,
      driver: "local-tmux",
    });
    const accepted = await runTwinTargetScenario({
      scenario: "M02 accepted exact literal delivery",
      phase: "accepted-success",
      hostKind: "local-tmux",
      input: { argv: acceptedArgs, instruction },
      native: tmuxAdapter(target, acceptedArgs),
    });
    assertScenarioPhase(accepted);
    const output = JSON.parse(accepted.targetA.stdout);
    assert.equal(parseSignedDriveInstruction(output.instructionLine)?.payload.instruction, instruction);
    const delta = Buffer.from(accepted.targetA.terminalInputs[0].bytesBase64, "base64");
    assert.deepEqual(delta, Buffer.from(output.instructionLine, "utf8"));
    const raw = Buffer.from(accepted.targetA.finalTargetState.inputBytesBase64, "base64");
    assert.deepEqual(raw, Buffer.from(`${output.instructionLine}\r\r`, "utf8"));
    assert.deepEqual(accepted.targetA.receipts, []);
    assert.equal(accepted.targetA.typedOutcome.code, "DRIVEN_TRUE");
    assert.deepEqual(accepted.targetB, {
      state: "pending",
      reason: MESH_TARGET_B_PENDING_REASON,
    });
  } finally {
    if (previousActivity === undefined) delete process.env.H2A_WAKE_DEFER_ACTIVITY_MS;
    else process.env.H2A_WAKE_DEFER_ACTIVITY_MS = previousActivity;
    await target.close();
  }
});

test("should characterize headless local-native openpty, raw input, resize, and partial writes", async () => {
  const target = await startNativeTarget();
  try {
    assertHeadlessOpenPty(target);
    const ready = readEvents(target.eventsPath).find((event) => event.type === "ready");
    assert.deepEqual(
      { stdinIsTTY: ready.stdinIsTTY, stdoutIsTTY: ready.stdoutIsTTY, raw: ready.raw },
      { stdinIsTTY: true, stdoutIsTTY: true, raw: true },
    );

    const instruction = "M02 native UTF-8 café 🧭";
    const args = driveArgs({
      root: target.storeRoot,
      privateKeyPath: target.privateKeyPath,
      instruction,
      driver: "native",
    });
    const accepted = await runTwinTargetScenario({
      scenario: "M02 accepted native PTY delivery",
      phase: "accepted-success",
      hostKind: "local-native",
      input: { argv: args, instruction },
      native: nativeAdapter(target, args),
    });
    assertScenarioPhase(accepted);
    const output = JSON.parse(accepted.targetA.stdout);
    assert.equal(parseSignedDriveInstruction(output.instructionLine)?.payload.instruction, instruction);
    assert.deepEqual(
      readCapture(target.capturePath),
      Buffer.from(`${output.instructionLine}\r`, "utf8"),
    );
    assert.equal(accepted.targetA.targetResolution.sessionId, target.sessionId);
    assert.equal(accepted.targetA.finalTargetState.status, "running");
    assert.deepEqual(accepted.targetA.receipts, []);
    assert.equal(accepted.targetA.typedOutcome.contractGrade, false);

    const resizeLease = await target.client.acquireController(
      target.sessionId,
      "m02-resize",
      "automation",
    );
    await target.client.resize(resizeLease, 101, 37);
    await target.client.releaseController(resizeLease);
    await eventually(
      () => readEvents(target.eventsPath),
      (events) => events.some(
        (event) => event.type === "resize" && event.columns === 101 && event.rows === 37,
      ),
      "TIOCSWINSZ resize",
    );

    const partialBaseline = readCapture(target.capturePath).length;
    const partialLease = await target.client.acquireController(
      target.sessionId,
      "m02-partial-write",
      "automation",
    );
    await target.client.write(partialLease, "partial-");
    await target.client.write(partialLease, "write\r");
    await target.client.releaseController(partialLease);
    await eventually(
      () => readCapture(target.capturePath).subarray(partialBaseline).toString("utf8"),
      (text) => text === "partial-write\r",
      "partial PTY writes",
    );
  } finally {
    await target.close();
  }
});

test("should fail closed without terminal mutation for native escape controls and oversized input", async () => {
  const target = await startNativeTarget();
  try {
    for (const [scenario, instruction] of [
      ["escape control", "first\u001b[31msecond"],
      ["oversized input", "x".repeat(256 * 1024)],
    ]) {
      const args = driveArgs({
        root: target.storeRoot,
        privateKeyPath: target.privateKeyPath,
        instruction,
        driver: "native",
      });
      const result = await runTwinTargetScenario({
        scenario: `M02 native ${scenario}`,
        phase: "pre-admission-refusal",
        hostKind: "local-native",
        input: { instructionBytes: Buffer.byteLength(instruction, "utf8") },
        native: nativeAdapter(target, args, { expectedEffect: false }),
      });
      assertScenarioPhase(result);
      assert.equal(result.targetA.exitCode, 2);
      assert.equal(JSON.parse(result.targetA.stdout).driven, false);
      assert.equal(result.targetA.typedOutcome.code, "DRIVEN_FALSE");
    }
  } finally {
    await target.close();
  }
});

test("should characterize native pipe closure as fail-closed with zero new terminal input", async () => {
  const target = await startNativeTarget();
  try {
    await target.stopHost();
    const baseline = readCapture(target.capturePath);
    const args = driveArgs({
      root: target.storeRoot,
      privateKeyPath: target.privateKeyPath,
      instruction: "must not cross a closed native pipe",
      driver: "native",
    });
    const result = await runTwinTargetScenario({
      scenario: "M02 native pipe closure",
      phase: "pre-admission-refusal",
      hostKind: "local-native",
      input: { argv: args },
      native: nativeAdapter(target, args, { expectedEffect: false }),
    });
    assertScenarioPhase(result);
    assert.equal(result.targetA.exitCode, 2);
    assert.equal(JSON.parse(result.targetA.stdout).driven, false);
    assert.deepEqual(readCapture(target.capturePath), baseline);
  } finally {
    await target.close();
  }
});

test.todo(
  "M02 Target-B differential parity — pending enlarged cluster-mesh 0.9.0 contract/capability bundle",
);
test.todo(
  "M02 contract outcomes and durable receipts — native CLI exposes only driven:boolean and no receipt",
);
test.todo(
  "M02 typed BUFFER_OVERFLOW and NO_CONTROLLING_TERMINAL outcomes — pending contract-owned outcome codes",
);
test.todo(
  "M02 read-only and dry-run zero-mutation scenarios — direct native drive has no such CLI modes",
);
test.todo(
  "M02 stale/revoked custody and wrong action/path/target matrix — pending OQ1/OQ5 registration gate",
);
test.todo(
  "M02 F2/F3 post-effect persistence failure with restart and concurrent retry — pending durable request identity and receipt reconciliation contract",
);
