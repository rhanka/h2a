import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  createLocalStore,
  createReplayGuard,
  parseSignedDriveInstruction,
  runMcpServe,
  verifyEnvelopeSignature,
  verifySignedDriveInstruction,
} from "../dist/index.js";
import { NativeTerminalClient } from "../../h2a-runtime/dist/native-terminal/client.js";
import { enroll } from "../../h2a-runtime/dist/registry.js";

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
const RAW_RECEIVER_SOURCE = String.raw`
import { appendFileSync, writeFileSync } from "node:fs";

const capturePath = process.argv[2];
const readyPath = process.argv[3];
writeFileSync(capturePath, Buffer.alloc(0));
if (process.stdin.isTTY !== true || process.stdout.isTTY !== true ||
    typeof process.stdin.setRawMode !== "function") {
  process.exit(72);
}
process.stdin.setRawMode(true);
process.stdin.resume();
writeFileSync(readyPath, "ready\n");
process.stdin.on("data", (chunk) => appendFileSync(capturePath, chunk));
setInterval(() => {}, 1000);
`;

async function eventually(read, accept, label) {
  let last;
  for (let attempt = 0; attempt < 300; attempt += 1) {
    last = await read();
    if (accept(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`${label} did not become observable; last=${JSON.stringify(last)}`);
}

async function startNativePair(profiles) {
  assert.equal(process.platform, "linux", "native PTY messaging proof requires Linux");
  assert.ok(existsSync(NATIVE_HOST_PROCESS), "native terminal host must be built");

  const directory = mkdtempSync(join(tmpdir(), "h2a-pty-messaging-"));
  const socketPath = join(directory, "native.sock");
  const configHome = join(directory, "config-home");
  const runtimeRegistryPath = join(
    configHome,
    ".config",
    "sentropic",
    "remote-cli",
    "registry.json",
  );
  const storeRoot = join(directory, "store");
  const receiverPath = join(directory, "raw-receiver.mjs");
  writeFileSync(receiverPath, RAW_RECEIVER_SOURCE);
  const env = {
    ...process.env,
    H2A_NATIVE_SOCKET: socketPath,
    REMOTE_CLI_CONFIG_HOME: configHome,
    H2A_WAKE_DEFER_ACTIVITY_MS: "0",
  };
  const setsid = existsSync("/usr/bin/setsid") ? "/usr/bin/setsid" : "/bin/setsid";
  const host = spawn(
    setsid,
    [
      process.execPath,
      NATIVE_HOST_PROCESS,
      "--socket",
      socketPath,
      "--generation",
      "pty-messaging-proof",
      "--replay-bytes",
      String(1024 * 1024),
      "--registry-path",
      join(directory, "host-registry.json"),
    ],
    { cwd: directory, env, stdio: ["ignore", "pipe", "pipe"] },
  );
  let hostStderr = "";
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
    "native PTY host",
  );
  const targets = [];
  for (const [index, profile] of profiles.entries()) {
    const label = `terminal-${index + 1}`;
    const sessionId = `h2a-${label}-${randomBytes(4).toString("hex")}`;
    const cwd = join(directory, label);
    const capturePath = join(directory, `${label}.input.bin`);
    const readyPath = join(directory, `${label}.ready`);
    mkdirSync(cwd);
    const created = await client.create({
      id: sessionId,
      command: process.execPath,
      args: [receiverPath, capturePath, readyPath],
      cwd,
      env: { PATH: process.env.PATH ?? "/usr/bin:/bin", TERM: "xterm-256color" },
      cols: 80,
      rows: 24,
    });
    await eventually(
      async () => existsSync(readyPath),
      Boolean,
      `${profile} receiver PTY`,
    );
    const terminalFds = [0, 1, 2].map((fd) =>
      readlinkSync(`/proc/${created.pid}/fd/${fd}`),
    );
    assert.ok(
      terminalFds.every((path) => /^\/dev\/pts\/\d+$/.test(path)),
      `${profile} receiver must run on a real openpty slave; got ${terminalFds.join(", ")}`,
    );
    enroll(
      {
        id: label,
        label,
        tool: profile,
        kind: "local-native",
        cwd,
        tmuxSession: sessionId,
        source: "run",
        sessionClass: "human",
      },
      runtimeRegistryPath,
    );
    targets.push({ profile, sessionId, cwd, capturePath, created });
  }

  return {
    directory,
    env,
    storeRoot,
    store: createLocalStore({ root: storeRoot }),
    targets,
    async close() {
      client.close();
      if (host.exitCode === null && host.signalCode === null) host.kill("SIGTERM");
      if (host.exitCode === null && host.signalCode === null) await once(host, "exit");
      rmSync(directory, { recursive: true, force: true });
    },
    diagnostic() {
      return hostStderr;
    },
  };
}

async function startReceiver(fixture, target) {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let diagnostics = "";
  let protocolOutput = "";
  let nextRequestId = 1;
  const responses = new Map();
  stdout.on("data", (chunk) => {
    protocolOutput += chunk.toString("utf8");
    for (;;) {
      const newline = protocolOutput.indexOf("\n");
      if (newline < 0) break;
      const line = protocolOutput.slice(0, newline);
      protocolOutput = protocolOutput.slice(newline + 1);
      if (!line.trim()) continue;
      const parsed = JSON.parse(line);
      if (parsed.id !== undefined) responses.set(parsed.id, parsed);
    }
  });
  stderr.on("data", (chunk) => void (diagnostics += chunk));
  const serving = runMcpServe(
    {
      root: fixture.storeRoot,
      "auto-open": "true",
      host: target.profile,
      wake: "auto",
    },
    {
      stdin,
      stdout,
      stderr,
      cwd: () => target.cwd,
      env: {
        ...process.env,
        H2A_NATIVE_TARGET_SESSION: target.sessionId,
      },
    },
  );
  const instance = await eventually(
    async () => fixture.store.listInstances().find(
      (registration) =>
        registration.instance.startsWith(`${target.profile}:`) &&
        registration.workspace?.path === target.cwd,
    )?.instance,
    (value) => typeof value === "string",
    `${target.profile} native sidecar identity`,
  );
  await eventually(
    async () => diagnostics,
    (value) => value.includes(`inbox-wake armed for ${instance}`),
    `${target.profile} inbox wake arming`,
  );
  return {
    instance,
    diagnostics: () => diagnostics,
    async send(to, message) {
      const id = nextRequestId++;
      stdin.write(`${JSON.stringify({
        jsonrpc: "2.0",
        id,
        method: "tools/call",
        params: { name: "h2a_send", arguments: { to, message } }
      })}\n`);
      const response = await eventually(
        async () => responses.get(id),
        Boolean,
        `${target.profile} h2a_send MCP response`
      );
      assert.equal(response.error, undefined, JSON.stringify(response.error));
      assert.equal(response.result.isError, false, response.result.content?.[0]?.text);
      return JSON.parse(response.result.content[0].text);
    },
    async close() {
      stdin.end();
      assert.equal(await serving, 0, diagnostics);
    },
  };
}

async function assertDelivered(fixture, target, receiver, expectedEnvelope) {
  assert.deepEqual(
    fixture.store.readInbox(expectedEnvelope.target.instance).at(-1),
    expectedEnvelope,
    "native and tmux delivery must share the unchanged durable message envelope",
  );
  assert.equal(
    fixture.store.listInstanceKeys(expectedEnvelope.actor.instance).some((publicKey) =>
      verifyEnvelopeSignature(expectedEnvelope, publicKey, {
        by: expectedEnvelope.actor.instance,
      })
    ),
    true,
    "durable message envelope must verify against the sender's active key",
  );
  const input = await eventually(
    async () => existsSync(target.capturePath) ? readFileSync(target.capturePath) : Buffer.alloc(0),
    (value) => value.length > 0,
    `${target.profile} native PTY inbox wake (${receiver.diagnostics()})`,
  );
  assert.equal(input.at(-1), "\r".charCodeAt(0));
  const instructionLine = input.subarray(0, -1).toString("utf8");
  const parsed = parseSignedDriveInstruction(instructionLine);
  assert.ok(parsed);
  assert.deepEqual(
    {
      envelopeKeys: Object.keys(expectedEnvelope).sort(),
      driveKeys: Object.keys(parsed.payload).sort(),
      from: parsed.payload.from,
      to: parsed.payload.to,
      at: parsed.payload.at,
    },
    {
      envelopeKeys: ["actor", "body", "createdAt", "id", "protocol", "signatures", "target", "type", "version"],
      driveKeys: ["at", "from", "instruction", "nonce", "to"],
      from: expectedEnvelope.target.instance,
      to: expectedEnvelope.target.instance,
      at: parsed.payload.at,
    },
    "native PTY must carry the same signed inbox-wake line shape as local-tmux",
  );
  const wakeMatch = /^\[h2a-wake reason=inbox from=(\S+) topic=(\S+) at=(\S+)\] automatic message from h2a — 1 new inbox envelope; run \/h2a receive to process\.$/.exec(
    parsed.payload.instruction,
  );
  assert.ok(wakeMatch, "native PTY must receive the local-tmux inbox-wake instruction shape");
  assert.equal(wakeMatch[1], expectedEnvelope.actor.instance);
  assert.equal(wakeMatch[2], expectedEnvelope.body.topic);
  assert.ok(
    Math.abs(Date.parse(wakeMatch[3]) - Date.parse(parsed.payload.at)) < 1_000,
    "wake tag and signed envelope must come from the same handler invocation",
  );
  assert.equal(
    verifySignedDriveInstruction(instructionLine, {
      resolvePublicKeys: (instance) => fixture.store.listInstanceKeys(instance),
      guard: createReplayGuard(),
      now: Date.parse(parsed.payload.at),
    }).ok,
    true,
  );
  assert.deepEqual(input, Buffer.from(`${instructionLine}\r`, "utf8"));
}

async function proveRoundTrip(leftProfile, rightProfile) {
  const fixture = await startNativePair([leftProfile, rightProfile]);
  const previousSocket = process.env.H2A_NATIVE_SOCKET;
  const previousConfigHome = process.env.REMOTE_CLI_CONFIG_HOME;
  const previousNotify = process.env.H2A_NOTIFY_INTERVAL_MS;
  process.env.H2A_NATIVE_SOCKET = fixture.env.H2A_NATIVE_SOCKET;
  process.env.REMOTE_CLI_CONFIG_HOME = fixture.env.REMOTE_CLI_CONFIG_HOME;
  process.env.H2A_NOTIFY_INTERVAL_MS = "20";
  const receivers = [];
  try {
    const left = await startReceiver(fixture, fixture.targets[0]);
    receivers.push(left);
    const right = await startReceiver(fixture, fixture.targets[1]);
    receivers.push(right);

    const outward = (await left.send(right.instance, "outward")).envelope;
    await assertDelivered(fixture, fixture.targets[1], right, outward);

    const reply = (await right.send(left.instance, "reply")).envelope;
    await assertDelivered(fixture, fixture.targets[0], left, reply);
  } finally {
    for (const receiver of receivers.reverse()) await receiver.close();
    if (previousSocket === undefined) delete process.env.H2A_NATIVE_SOCKET;
    else process.env.H2A_NATIVE_SOCKET = previousSocket;
    if (previousConfigHome === undefined) delete process.env.REMOTE_CLI_CONFIG_HOME;
    else process.env.REMOTE_CLI_CONFIG_HOME = previousConfigHome;
    if (previousNotify === undefined) delete process.env.H2A_NOTIFY_INTERVAL_MS;
    else process.env.H2A_NOTIFY_INTERVAL_MS = previousNotify;
    await fixture.close();
  }
}

test("should round-trip codex to codex through real native openpty sessions at tmux envelope parity", async () => {
  await proveRoundTrip("codex", "codex");
});

test("should round-trip claude to codex through real native openpty sessions at tmux envelope parity", async () => {
  await proveRoundTrip("claude", "codex");
});
