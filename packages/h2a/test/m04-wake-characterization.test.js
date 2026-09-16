import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { generateKeyPairSync, randomBytes } from "node:crypto";
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
  createReplayGuard,
  createInboxWakeHandler,
  createLocalStore,
  chainDriver,
  decideInboxWake,
  latestLaunchContext,
  localTmuxDriver,
  nativeBackchannelDriver,
  parseSignedDriveInstruction,
  runCli,
  sendLocalMessage,
  verifyEnvelopeSignature,
  verifySignedDriveInstruction,
  writePresence,
} from "../dist/index.js";
import { NativeTerminalClient } from "../../h2a-runtime/dist/native-terminal/client.js";
import { NATIVE_TERMINAL_MAX_FRAME_BYTES } from "../../h2a-runtime/dist/native-terminal/protocol.js";
import { enroll } from "../../h2a-runtime/dist/registry.js";

import {
  MESH_TARGET_B_PENDING_REASON,
  assertScenarioPhase,
  decodeObservedUtf8Chunks,
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
const NATIVE_TERMINAL_OP = join(
  HERE,
  "..",
  "..",
  "h2a-runtime",
  "dist",
  "native-terminal",
  "op.js",
);
const INSTANCE = "codex:m04-worker";
const NOW = Date.parse("2026-09-12T12:00:00.000Z");
const now = () => NOW;

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
process.stdout.write("m04-observer-ready\r\n");

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
  return mkdtempSync(join(tmpdir(), `h2a-m04-${label}-`));
}

function keyPair() {
  const keys = generateKeyPairSync("ed25519");
  return {
    privateKeyPem: keys.privateKey
      .export({ format: "pem", type: "pkcs8" })
      .toString(),
    publicKeyPem: keys.publicKey
      .export({ format: "pem", type: "spki" })
      .toString(),
  };
}

function envelope(id, { from = "claude:m04-lead", topic = "RELANCE" } = {}) {
  return {
    protocol: "sentropic.h2a",
    version: "0.1",
    id,
    type: "event",
    actor: { instance: from, role: "AGENTS", scope: "scope:m04-characterization" },
    target: { instance: INSTANCE },
    body: { kind: "message", topic, text: "wake the selected M04 target" },
    createdAt: "2026-09-12T11:59:00.000Z",
  };
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
        rows.push({
          path: rel,
          kind: "file",
          bytesBase64: readFileSync(entry).toString("base64"),
        });
      }
    }
  }
  visit(root);
  return rows;
}

function terminalInputs(buffer) {
  return buffer
    .toString("utf8")
    .split("\r")
    .filter((line) => line.length > 0)
    .map((line) => ({
      text: line,
      bytesBase64: Buffer.from(line, "utf8").toString("base64"),
    }));
}

function processStat(pid) {
  const raw = readFileSync(`/proc/${pid}/stat`, "utf8");
  const end = raw.lastIndexOf(") ");
  assert.notEqual(end, -1);
  const fields = raw.slice(end + 2).split(" ");
  return {
    session: Number(fields[3]),
    ttyNr: Number(fields[4]),
  };
}

function fdTargets(pid) {
  return readdirSync(`/proc/${pid}/fd`).map((fd) => {
    try {
      return readlinkSync(`/proc/${pid}/fd/${fd}`);
    } catch {
      return "<raced>";
    }
  });
}

async function startTmuxTarget() {
  const directory = freshDirectory("tmux");
  const observerPath = join(directory, "raw-observer.mjs");
  const capturePath = join(directory, "input.bin");
  const eventsPath = join(directory, "events.jsonl");
  const session = `h2a-m04-${process.pid}-${randomBytes(4).toString("hex")}`;
  writeFileSync(observerPath, RAW_OBSERVER_SOURCE);
  const started = spawnSync(
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
  assert.equal(started.status, 0, started.stderr || started.error?.message);
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
    "M04 tmux raw observer readiness",
  );
  return {
    kind: "local-tmux",
    directory,
    capturePath,
    eventsPath,
    session,
    pane,
    launchContext: {
      cwd: directory,
      command: "codex",
      tmux: { session, pane },
    },
    submitBytes: 2,
    resolution: {
      kind: "tmux-pane",
      instance: INSTANCE,
      session,
      pane,
    },
    status() {
      const result = spawnSync(
        "tmux",
        ["display-message", "-p", "-t", pane, "#{pane_dead}"],
        { encoding: "utf8" },
      );
      return result.status === 0 && result.stdout.trim() === "0" ? "alive" : "dead";
    },
    async close() {
      spawnSync("tmux", ["kill-session", "-t", session], { encoding: "utf8" });
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

async function startNativeTarget() {
  assert.equal(process.platform, "linux", "headless native characterization requires Linux");
  assert.ok(existsSync("/usr/bin/setsid") || existsSync("/bin/setsid"), "setsid is required");
  assert.ok(existsSync(NATIVE_HOST_PROCESS), "native terminal host must be built");
  assert.ok(existsSync(NATIVE_TERMINAL_OP), "native terminal operation must be built");

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
  const sessionId = `m04-native-${randomBytes(4).toString("hex")}`;
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
      "m04-characterization",
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
    "M04 headless native host",
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
    "M04 native raw observer readiness",
  );
  enroll(
    {
      id: "m04-worker",
      label: "m04-worker",
      tool: "codex",
      kind: "local-native",
      cwd: directory,
      tmuxSession: sessionId,
      source: "run",
      sessionClass: "human",
    },
    runtimeRegistryPath,
  );

  return {
    kind: "local-native",
    directory,
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
    submitBytes: 1,
    resolution: {
      kind: "native-terminal",
      instance: INSTANCE,
      registryLabel: "m04-worker",
      sessionId,
      hostGeneration: "m04-characterization",
    },
    async status() {
      try {
        return (await client.state(sessionId)).status;
      } catch {
        return "unreachable";
      }
    },
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

function nativeOperationDriver(target, log = () => undefined) {
  return nativeBackchannelDriver({
    log,
    send(request) {
      const result = spawnSync(
        process.execPath,
        [
          NATIVE_TERMINAL_OP,
          "drive",
          "--target",
          request.to,
          "--b64",
          Buffer.from(request.instructionLine, "utf8").toString("base64"),
        ],
        {
          cwd: target.directory,
          env: target.env,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      if (result.status !== 0 || typeof result.stdout !== "string") return false;
      let outcome;
      try {
        outcome = JSON.parse(result.stdout.trim().split("\n").at(-1)).outcome;
      } catch {
        return false;
      }
      if (outcome === "unresolved") return undefined;
      return outcome === "driven";
    },
  });
}

function recordingDriver(base, { loseReceipt = false } = {}) {
  const requests = [];
  return {
    requests,
    driver: {
      async drive(request) {
        requests.push(structuredClone(request));
        const acted = await base.drive(request);
        return loseReceipt && acted ? false : acted;
      },
    },
  };
}

function wakeHandler({ inbox, privateKeyPem, driver, launchContext, log }) {
  return createInboxWakeHandler({
    instance: INSTANCE,
    readInbox: () => inbox,
    privateKeyPem,
    driver,
    host: "codex",
    ...(launchContext !== undefined
      ? { resolveLaunchContext: () => launchContext() }
      : {}),
    now,
    log,
  });
}

function terminalAdapter(
  target,
  handler,
  requests,
  {
    effectExpected = false,
    registrationState = "wakeable",
    logs = [],
    reconciliation = null,
  } = {},
) {
  const baseline = readCapture(target.capturePath);
  return {
    resolveTarget: () => ({ ...target.resolution, registrationState }),
    observeTargetState: async () => ({
      status: await target.status(),
      inputBytesBase64: readCapture(target.capturePath).toString("base64"),
    }),
    observeDurableState: () => ({ receiptIds: [] }),
    observeTerminalInputs: () =>
      terminalInputs(readCapture(target.capturePath).subarray(baseline.length)),
    async invoke() {
      const woken = await handler();
      if (effectExpected && requests.length > 0) {
        const request = requests.at(-1);
        const expectedBytes =
          Buffer.byteLength(request.instructionLine, "utf8") + target.submitBytes;
        await eventually(
          () => readCapture(target.capturePath).length,
          (length) => length >= baseline.length + expectedBytes,
          `${target.kind} M04 terminal wake`,
        );
      }
      return {
        stdout: `${JSON.stringify({ woken })}\n`,
        stderr: logs.join("\n"),
        exitCode: woken ? 0 : 2,
        typedOutcome: {
          source: "native-inbox-wake-boolean",
          code: woken ? "WAKE_TRUE" : "WAKE_FALSE",
          contractGrade: false,
        },
        receipts: [],
        reconciliation,
      };
    },
  };
}

function registerState(root, publicKeyPem, state, launchContext) {
  const store = createLocalStore({ root });
  store.registerInstance({
    id: INSTANCE,
    instance: INSTANCE,
    roles: ["AGENTS"],
    scopes: ["scope:m04-characterization"],
    capabilities: ["wake"],
    endpoints: [],
    publicKeys: [publicKeyPem],
    acceptedPolicies: [],
    createdAt: "2026-09-12T00:00:00.000Z",
  });
  if (state === "alive") {
    const at = new Date().toISOString();
    writePresence(root, {
      sessionId: `m04-${state}`,
      instance: INSTANCE,
      host: "codex",
      startedAt: at,
      heartbeatAt: at,
      state: "live",
      interests: { scopes: ["scope:m04-characterization"], negotiations: [] },
      subscribedTopics: [],
    });
  }
  if (state === "wakeable" || state === "revoked") {
    const at = new Date().toISOString();
    writePresence(root, {
      sessionId: `m04-${state}`,
      instance: INSTANCE,
      host: "codex",
      startedAt: at,
      heartbeatAt: at,
      state: "live",
      interests: { scopes: ["scope:m04-characterization"], negotiations: [] },
      subscribedTopics: [],
      launchContext,
    });
  }
  if (state === "stale") {
    const at = "2020-01-01T00:00:00.000Z";
    writePresence(root, {
      sessionId: `m04-${state}`,
      instance: INSTANCE,
      host: "codex",
      startedAt: at,
      heartbeatAt: at,
      state: "live",
      interests: { scopes: ["scope:m04-characterization"], negotiations: [] },
      subscribedTopics: [],
      launchContext,
    });
  }
  if (state === "revoked") store.revokeInstanceKey(INSTANCE, publicKeyPem);
  return store;
}

test("should characterize M04 envelope selection and exact signed wake on local-tmux Target-A", async () => {
  const target = await startTmuxTarget();
  const previousActivity = process.env.H2A_WAKE_DEFER_ACTIVITY_MS;
  process.env.H2A_WAKE_DEFER_ACTIVITY_MS = "0";
  try {
    const { privateKeyPem, publicKeyPem } = keyPair();
    const boot = envelope("m04-boot");
    const inbox = [boot];
    const logs = [];
    const recorded = recordingDriver(localTmuxDriver({ log: (line) => logs.push(line) }));
    const handler = wakeHandler({
      inbox,
      privateKeyPem,
      driver: recorded.driver,
      launchContext: () => target.launchContext,
      log: (line) => logs.push(line),
    });

    const backlog = await runTwinTargetScenario({
      scenario: "M04 boot backlog selection",
      phase: "read-only",
      hostKind: "local-tmux",
      input: { envelopeIds: inbox.map((item) => item.id) },
      native: terminalAdapter(target, handler, recorded.requests, { logs }),
    });
    assertScenarioPhase(backlog);
    assert.equal(recorded.requests.length, 0, "boot backlog must not wake");

    const selected = envelope("m04-selected", {
      from: "claude:m04-selector",
      topic: "RELANCE 🧭",
    });
    inbox.push(selected);
    const expectedDecision = decideInboxWake({
      seen: [boot.id],
      inbox,
      nowIso: new Date(NOW).toISOString(),
    });
    assert.ok(expectedDecision);
    const accepted = await runTwinTargetScenario({
      scenario: "M04 selected request exact signed wake",
      phase: "accepted-success",
      hostKind: "local-tmux",
      input: { selectedEnvelopeId: selected.id, wake: expectedDecision.wake },
      native: terminalAdapter(target, handler, recorded.requests, {
        effectExpected: true,
        logs,
      }),
    });
    assertScenarioPhase(accepted);

    assert.equal(recorded.requests.length, 1);
    const line = recorded.requests[0].instructionLine;
    const parsed = parseSignedDriveInstruction(line);
    assert.ok(parsed);
    assert.equal(
      verifySignedDriveInstruction(line, {
        resolvePublicKeys: () => [publicKeyPem],
        guard: createReplayGuard(),
        now: NOW,
      }).ok,
      true,
      "the exact observed wake line must verify against its native signer key",
    );
    assert.deepEqual(
      Object.keys(parsed.payload).sort(),
      ["at", "from", "instruction", "nonce", "to"],
      "native wake identity has no registration, holder, or epoch binding",
    );
    assert.deepEqual(
      {
        from: parsed.payload.from,
        to: parsed.payload.to,
        instruction: parsed.payload.instruction,
        at: parsed.payload.at,
      },
      {
        from: INSTANCE,
        to: INSTANCE,
        instruction: expectedDecision.wake,
        at: new Date(NOW).toISOString(),
      },
    );
    assert.deepEqual(
      readCapture(target.capturePath),
      Buffer.from(`${line}\r\r`, "utf8"),
      "tmux must receive the exact signed instruction plus its native submit keys",
    );
    assert.deepEqual(accepted.targetB, {
      state: "pending",
      reason: MESH_TARGET_B_PENDING_REASON,
    });

    assert.equal(await handler(), false, "the selected envelope is deduplicated in-process");
    assert.equal(terminalInputs(readCapture(target.capturePath)).length, 1);
  } finally {
    if (previousActivity === undefined) delete process.env.H2A_WAKE_DEFER_ACTIVITY_MS;
    else process.env.H2A_WAKE_DEFER_ACTIVITY_MS = previousActivity;
    await target.close();
  }
});

test("signed send reaches inbox-wake through native-to-real-tmux chain fallback", async () => {
  const target = await startTmuxTarget();
  const previousActivity = process.env.H2A_WAKE_DEFER_ACTIVITY_MS;
  process.env.H2A_WAKE_DEFER_ACTIVITY_MS = "0";
  const root = freshDirectory("signed-send-chain");
  try {
    const store = createLocalStore({ root });
    const sender = "claude:m04-sender:111111111111";
    const senderKeys = keyPair();
    const receiverKeys = keyPair();
    for (const [instance, publicKeyPem] of [
      [sender, senderKeys.publicKeyPem],
      [INSTANCE, receiverKeys.publicKeyPem],
    ]) {
      store.registerInstance({
        id: instance,
        instance,
        roles: ["AGENTS"],
        scopes: ["scope:m04-characterization"],
        capabilities: [],
        endpoints: [],
        publicKeys: [publicKeyPem],
        acceptedPolicies: [],
        createdAt: new Date(NOW).toISOString(),
      });
    }

    let nativeAttempts = 0;
    const driver = chainDriver(
      nativeBackchannelDriver({
        send: () => {
          nativeAttempts += 1;
          return false;
        },
      }),
      localTmuxDriver(),
    );
    const handler = createInboxWakeHandler({
      instance: INSTANCE,
      readInbox: () => store.readInbox(INSTANCE),
      privateKeyPem: receiverKeys.privateKeyPem,
      driver,
      host: "codex",
      resolveLaunchContext: () => target.launchContext,
      now,
    });
    const baseline = readCapture(target.capturePath).length;
    const sent = sendLocalMessage({
      store,
      to: INSTANCE,
      message: "va check ton inbox",
      signer: { instance: sender, privateKeyPem: senderKeys.privateKeyPem },
      now,
      randomId: () => "44444444-4444-4444-8444-444444444444",
    });
    assert.equal(
      verifyEnvelopeSignature(sent.envelope, senderKeys.publicKeyPem, { by: sender }),
      true,
      "message envelope is signed by the sender before inbox-wake sees it",
    );
    assert.equal(await handler(), true);
    assert.equal(nativeAttempts, 1, "auto chain tries native before tmux");

    const captured = await eventually(
      () => readCapture(target.capturePath).subarray(baseline),
      (bytes) => bytes.length > 2,
      "real tmux fallback wake",
    );
    const line = captured.subarray(0, -2).toString("utf8");
    const verifiedWake = verifySignedDriveInstruction(line, {
      resolvePublicKeys: (instance) => store.listInstanceKeys(instance),
      guard: createReplayGuard(),
      now: NOW,
    });
    assert.equal(verifiedWake.ok, true, "wake line is separately signed by the receiver");
    assert.deepEqual(captured.subarray(-2), Buffer.from("\r\r"));
  } finally {
    if (previousActivity === undefined) delete process.env.H2A_WAKE_DEFER_ACTIVITY_MS;
    else process.env.H2A_WAKE_DEFER_ACTIVITY_MS = previousActivity;
    await target.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("should characterize M04 headless local-native openpty, raw input, resize, and chunk boundaries", async () => {
  const target = await startNativeTarget();
  try {
    assertHeadlessOpenPty(target);
    const ready = readEvents(target.eventsPath).find((event) => event.type === "ready");
    assert.deepEqual(
      { stdinIsTTY: ready.stdinIsTTY, stdoutIsTTY: ready.stdoutIsTTY, raw: ready.raw },
      { stdinIsTTY: true, stdoutIsTTY: true, raw: true },
    );

    const { privateKeyPem, publicKeyPem } = keyPair();
    const inbox = [];
    const logs = [];
    const recorded = recordingDriver(nativeOperationDriver(target, (line) => logs.push(line)));
    const handler = wakeHandler({
      inbox,
      privateKeyPem,
      driver: recorded.driver,
      log: (line) => logs.push(line),
    });
    const selected = envelope("m04-native-selected", {
      from: "claude:m04-native-selector",
      topic: "UTF-8-café-🧭",
    });
    inbox.push(selected);
    const expectedDecision = decideInboxWake({
      seen: [],
      inbox,
      nowIso: new Date(NOW).toISOString(),
    });
    assert.ok(expectedDecision);

    const accepted = await runTwinTargetScenario({
      scenario: "M04 selected native PTY wake",
      phase: "accepted-success",
      hostKind: "local-native",
      input: { selectedEnvelopeId: selected.id, wake: expectedDecision.wake },
      native: terminalAdapter(target, handler, recorded.requests, {
        effectExpected: true,
        logs,
      }),
    });
    assertScenarioPhase(accepted);
    const line = recorded.requests[0].instructionLine;
    assert.equal(parseSignedDriveInstruction(line)?.payload.instruction, expectedDecision.wake);
    assert.equal(
      verifySignedDriveInstruction(line, {
        resolvePublicKeys: () => [publicKeyPem],
        guard: createReplayGuard(),
        now: NOW,
      }).ok,
      true,
    );
    assert.deepEqual(readCapture(target.capturePath), Buffer.from(`${line}\r`, "utf8"));
    assert.deepEqual(accepted.targetB, {
      state: "pending",
      reason: MESH_TARGET_B_PENDING_REASON,
    });

    const resizeLease = await target.client.acquireController(
      target.sessionId,
      "m04-resize",
      "automation",
    );
    await target.client.resize(resizeLease, 103, 39);
    await target.client.releaseController(resizeLease);
    await eventually(
      () => readEvents(target.eventsPath),
      (events) => events.some(
        (event) => event.type === "resize" && event.columns === 103 && event.rows === 39,
      ),
      "M04 TIOCSWINSZ resize",
    );

    const chunkBaseline = readCapture(target.capturePath).length;
    const chunkLease = await target.client.acquireController(
      target.sessionId,
      "m04-chunking",
      "automation",
    );
    await target.client.write(chunkLease, "edge-\u001b[");
    await target.client.write(chunkLease, "31m-café-🧭");
    await target.client.write(chunkLease, "\u001b[0m\r");
    await target.client.releaseController(chunkLease);
    const expectedChunked = "edge-\u001b[31m-café-🧭\u001b[0m\r";
    await eventually(
      () => readCapture(target.capturePath).subarray(chunkBaseline).toString("utf8"),
      (text) => text === expectedChunked,
      "M04 partial PTY writes and escape chunks",
    );

    const encoded = Buffer.from(expectedChunked, "utf8");
    const escapeAt = encoded.indexOf(Buffer.from("\u001b[31m")) + 1;
    const compassAt = encoded.indexOf(Buffer.from("🧭")) + 2;
    assert.equal(
      decodeObservedUtf8Chunks([
        encoded.subarray(0, escapeAt),
        encoded.subarray(escapeAt, compassAt),
        encoded.subarray(compassAt),
      ]),
      expectedChunked,
      "the observation seam must reassemble a split escape and UTF-8 code point",
    );
  } finally {
    await target.close();
  }
});

test("should fail closed without native wake mutation for controls, oversized input, and pipe closure", async () => {
  const target = await startNativeTarget();
  try {
    const { privateKeyPem } = keyPair();
    for (const [scenario, topic] of [
      ["escape control", "RELANCE\u001b[31m"],
      ["buffer overflow", "x".repeat(256 * 1024)],
    ]) {
      const inbox = [];
      const recorded = recordingDriver(nativeOperationDriver(target));
      const handler = wakeHandler({ inbox, privateKeyPem, driver: recorded.driver });
      inbox.push(envelope(`m04-${scenario.replaceAll(" ", "-")}`, { topic }));
      const result = await runTwinTargetScenario({
        scenario: `M04 native ${scenario}`,
        phase: "pre-admission-refusal",
        hostKind: "local-native",
        input: { topicBytes: Buffer.byteLength(topic, "utf8") },
        native: terminalAdapter(target, handler, recorded.requests),
      });
      assertScenarioPhase(result);
      assert.equal(result.targetA.typedOutcome.code, "WAKE_FALSE");
      assert.equal(recorded.requests.length, 1, "the native transport must explicitly refuse");
    }

    const overflowBaseline = readCapture(target.capturePath);
    const overflowLease = await target.client.acquireController(
      target.sessionId,
      "m04-frame-overflow",
      "automation",
    );
    await assert.rejects(
      target.client.write(
        overflowLease,
        "x".repeat(NATIVE_TERMINAL_MAX_FRAME_BYTES),
      ),
      /terminal host request exceeds the frame limit/,
    );
    await target.client.releaseController(overflowLease);
    assert.deepEqual(
      readCapture(target.capturePath),
      overflowBaseline,
      "an overflowing native-terminal frame must not reach the PTY",
    );

    await target.stopHost();
    const beforeClosure = readCapture(target.capturePath);
    const closedInbox = [];
    const recorded = recordingDriver(nativeOperationDriver(target));
    const handler = wakeHandler({
      inbox: closedInbox,
      privateKeyPem,
      driver: recorded.driver,
    });
    closedInbox.push(envelope("m04-closed-pipe"));
    const closed = await runTwinTargetScenario({
      scenario: "M04 native pipe closure",
      phase: "pre-admission-refusal",
      hostKind: "local-native",
      input: { selectedEnvelopeId: "m04-closed-pipe" },
      native: terminalAdapter(target, handler, recorded.requests),
    });
    assertScenarioPhase(closed);
    assert.deepEqual(readCapture(target.capturePath), beforeClosure);
  } finally {
    await target.close();
  }
});

test("should characterize alive, wakeable, unavailable, stale, and key-revoked native registration states", async () => {
  const target = await startTmuxTarget();
  const previousActivity = process.env.H2A_WAKE_DEFER_ACTIVITY_MS;
  process.env.H2A_WAKE_DEFER_ACTIVITY_MS = "0";
  try {
    const { privateKeyPem, publicKeyPem } = keyPair();
    const observed = {};
    for (const state of ["alive", "wakeable", "unavailable", "stale", "revoked"]) {
      const root = join(target.directory, `store-${state}`);
      const store = registerState(root, publicKeyPem, state, target.launchContext);
      const inbox = [];
      const recorded = recordingDriver(localTmuxDriver());
      const launchContext = () => latestLaunchContext(root, INSTANCE);
      const handler = wakeHandler({
        inbox,
        privateKeyPem,
        driver: recorded.driver,
        launchContext,
      });
      inbox.push(envelope(`m04-state-${state}`));
      const nativeWillAct = state === "wakeable" || state === "revoked";
      const result = await runTwinTargetScenario({
        scenario: `M04 native registration state ${state}`,
        phase: nativeWillAct ? "accepted-success" : "pre-admission-refusal",
        hostKind: "local-tmux",
        input: {
          registrationState: state,
          activeKeys: store.listInstanceKeys(INSTANCE).length,
        },
        native: terminalAdapter(target, handler, recorded.requests, {
          effectExpected: nativeWillAct,
          registrationState: state,
        }),
      });
      assertScenarioPhase(result);
      if (state === "revoked") {
        assert.throws(
          () => assertScenarioPhase({ ...result, phase: "pre-admission-refusal" }),
          /zero-effect phase changed target state/,
          "the oracle must reject a zero-effect claim for the observed revoked-key wake",
        );
      }
      observed[state] = {
        woken: JSON.parse(result.targetA.stdout).woken,
        terminalInputs: result.targetA.terminalInputs.length,
        activeKeys: store.listInstanceKeys(INSTANCE).length,
      };
    }

    assert.deepEqual(observed, {
      alive: { woken: false, terminalInputs: 0, activeKeys: 1 },
      wakeable: { woken: true, terminalInputs: 1, activeKeys: 1 },
      unavailable: { woken: false, terminalInputs: 0, activeKeys: 1 },
      stale: { woken: false, terminalInputs: 0, activeKeys: 1 },
      revoked: { woken: true, terminalInputs: 1, activeKeys: 0 },
    });
  } finally {
    if (previousActivity === undefined) delete process.env.H2A_WAKE_DEFER_ACTIVITY_MS;
    else process.env.H2A_WAKE_DEFER_ACTIVITY_MS = previousActivity;
    await target.close();
  }
});

async function exerciseFault(phase, mode) {
  const { privateKeyPem } = keyPair();
  const inbox = [];
  const attempts = [];
  const effects = [];
  const simulatedReceipts = [];
  const driver = {
    async drive(request) {
      attempts.push(request.instructionLine);
      await Promise.resolve();
      if (phase === "F1") return false;
      effects.push(request.instructionLine);
      if (phase === "F2") return false;
      simulatedReceipts.push(`receipt-${simulatedReceipts.length + 1}`);
      return true;
    },
  };
  const createWorker = () => wakeHandler({ inbox, privateKeyPem, driver });
  const worker = createWorker();
  inbox.push(envelope(`m04-${phase}-${mode}`));

  if (mode === "restart") {
    await worker();
    const restarted = createWorker();
    await restarted();
  } else {
    await Promise.all([worker(), worker()]);
  }
  return { attempts, effects, simulatedReceipts };
}

for (const phase of ["F1", "F2", "F3"]) {
  test(`should characterize M04 ${phase} worker restart and concurrent retry`, async () => {
    const restarted = await exerciseFault(phase, "restart");
    assert.deepEqual(
      {
        attempts: restarted.attempts.length,
        effects: restarted.effects.length,
        simulatedReceipts: restarted.simulatedReceipts.length,
      },
      phase === "F1"
        ? { attempts: 1, effects: 0, simulatedReceipts: 0 }
        : phase === "F2"
          ? { attempts: 1, effects: 1, simulatedReceipts: 0 }
          : { attempts: 1, effects: 1, simulatedReceipts: 1 },
      "a restarted native handler treats the pending inbox as boot backlog",
    );

    const concurrent = await exerciseFault(phase, "concurrent");
    assert.equal(concurrent.attempts.length, 2);
    assert.notEqual(
      concurrent.attempts[0],
      concurrent.attempts[1],
      "the same source envelope is re-signed with a new nonce and has no stable native request identity",
    );
    assert.deepEqual(
      {
        effects: concurrent.effects.length,
        simulatedReceipts: concurrent.simulatedReceipts.length,
      },
      phase === "F1"
        ? { effects: 0, simulatedReceipts: 0 }
        : phase === "F2"
          ? { effects: 2, simulatedReceipts: 0 }
          : { effects: 2, simulatedReceipts: 2 },
    );
  });
}

for (const hostKind of ["local-tmux", "local-native"]) {
  test(`should independently observe ${hostKind} F2 effect and reject unreconciled lost-receipt replay`, async () => {
    const target = hostKind === "local-tmux"
      ? await startTmuxTarget()
      : await startNativeTarget();
    const previousActivity = process.env.H2A_WAKE_DEFER_ACTIVITY_MS;
    process.env.H2A_WAKE_DEFER_ACTIVITY_MS = "0";
    try {
      const { privateKeyPem } = keyPair();
      const inbox = [];
      const base = hostKind === "local-tmux"
        ? localTmuxDriver()
        : nativeOperationDriver(target);
      const recorded = recordingDriver(base, { loseReceipt: true });
      const handler = wakeHandler({
        inbox,
        privateKeyPem,
        driver: recorded.driver,
        ...(hostKind === "local-tmux"
          ? { launchContext: () => target.launchContext }
          : {}),
      });
      inbox.push(envelope(`m04-f2-${hostKind}`));

      const first = await runTwinTargetScenario({
        scenario: `M04 ${hostKind} F2 lost receipt`,
        phase: "post-effect-failure",
        hostKind,
        input: { selectedEnvelopeId: inbox[0].id },
        native: terminalAdapter(target, handler, recorded.requests, {
          effectExpected: true,
          reconciliation: {
            effectIndependentlyObserved: true,
            reconciled: false,
            blindReplay: true,
          },
        }),
      });
      assert.equal(first.targetA.terminalInputs.length, 1);
      assert.throws(
        () => assertScenarioPhase(first),
        /post-effect failure must be reconciled/,
        "the oracle must not turn a visible but unreconciled effect green",
      );
      assert.deepEqual(first.targetB, {
        state: "pending",
        reason: MESH_TARGET_B_PENDING_REASON,
      });

      const restarted = wakeHandler({
        inbox,
        privateKeyPem,
        driver: recorded.driver,
        ...(hostKind === "local-tmux"
          ? { launchContext: () => target.launchContext }
          : {}),
      });
      assert.equal(await restarted(), false, "restart seeds the envelope as boot backlog");
      assert.equal(
        terminalInputs(readCapture(target.capturePath)).length,
        1,
        "worker restart does not emit a second wake after the lost receipt",
      );

      const beforeConcurrent = readCapture(target.capturePath).length;
      await Promise.all([handler(), handler()]);
      await eventually(
        () => terminalInputs(readCapture(target.capturePath).subarray(beforeConcurrent)).length,
        (count) => count === 2,
        `${hostKind} concurrent lost-receipt replays`,
      );
      const retryLines = recorded.requests.slice(-2).map((request) => request.instructionLine);
      assert.notEqual(retryLines[0], retryLines[1]);
    } finally {
      if (previousActivity === undefined) delete process.env.H2A_WAKE_DEFER_ACTIVITY_MS;
      else process.env.H2A_WAKE_DEFER_ACTIVITY_MS = previousActivity;
      await target.close();
    }
  });
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

for (const hostKind of ["local-tmux", "local-native"]) {
  test(`should prove M04 wake-request dry-run zero mutation for ${hostKind}`, async () => {
    const directory = freshDirectory(`dry-run-${hostKind}`);
    const root = join(directory, "store");
    try {
      const args = [
        "wake-request",
        "--root",
        root,
        "--to",
        INSTANCE,
        "--remote",
        "remote:m04-launcher",
        "--dry-run",
      ];
      const adapter = {
        resolveTarget: () => ({ kind: hostKind, instance: INSTANCE }),
        observeTargetState: () => ({ terminalInputs: [] }),
        observeDurableState: () => snapshotFiles(root),
        observeTerminalInputs: () => [],
        invoke() {
          const captured = captureStreams(directory);
          const exitCode = runCli(args, captured.streams);
          return {
            stdout: captured.out(),
            stderr: captured.err(),
            exitCode,
            typedOutcome: {
              source: "native-wake-request-preview",
              code: JSON.parse(captured.out()).action,
              contractGrade: false,
            },
            receipts: [],
          };
        },
      };
      const result = await runTwinTargetScenario({
        scenario: `M04 ${hostKind} dry-run preview`,
        phase: "dry-run",
        hostKind,
        input: { argv: args },
        native: adapter,
      });
      assertScenarioPhase(result);
      assert.equal(result.targetA.typedOutcome.code, "would-emit");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
}

test.todo(
  "M04 Target-B differential parity — pending enlarged cluster-mesh 0.9.0 contract/capability bundle",
);
test.todo(
  "M04 revoked-registration zero effect — native self-wake does not consume registration revocation or custody evidence",
);
test.todo(
  "M04 F1 retry after restart — native boot-backlog seeding suppresses a known pre-effect retry",
);
test.todo(
  "M04 F2/F3 concurrent idempotency — native in-memory seen state permits duplicate wakes and has no durable request identity or receipt reconciliation",
);
test.todo(
  "M04 typed BUFFER_OVERFLOW, PIPE_CLOSED, and NO_CONTROLLING_TERMINAL outcomes — native handler exposes only boolean",
);
test.todo(
  "M04 direct read-only mode — native inbox-wake handler has no read-only invocation surface",
);
