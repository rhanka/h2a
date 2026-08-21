import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { createLocalStore, runCli } from "@sentropic/h2a";

import { enroll } from "../registry.js";
import { NativeTerminalClient } from "./client.js";
import { NativeTerminalHostSupervisor, type NativeTerminalHostSpawn } from "./supervisor.js";

const children = new Set<ChildProcess>();
const directories = new Set<string>();

afterEach(async () => {
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    if (child.exitCode === null && child.signalCode === null) await once(child, "exit");
  }
  children.clear();
  for (const directory of directories) await rm(directory, { recursive: true, force: true });
  directories.clear();
});

async function eventually<T>(read: () => Promise<T>, accept: (value: T) => boolean): Promise<T> {
  let last: T | undefined;
  for (let attempt = 0; attempt < 200; attempt += 1) {
    last = await read();
    if (accept(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`condition did not become true; last value: ${JSON.stringify(last)}`);
}

function captureStreams(cwd: string): {
  streams: Parameters<typeof runCli>[1];
  out(): string;
  err(): string;
} {
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

function registerDrivePair(root: string, publicKeyPem: string): void {
  const store = createLocalStore({ root });
  store.registerInstance({
    id: "claude:lead",
    instance: "claude:lead",
    roles: ["CONDUCTOR"],
    scopes: ["scope:drive-functional"],
    capabilities: ["drive"],
    endpoints: [],
    publicKeys: [publicKeyPem],
    acceptedPolicies: [],
    createdAt: "2026-08-21T00:00:00.000Z",
  });
  store.registerInstance({
    id: "codex:worker",
    instance: "codex:worker",
    roles: ["AGENTS"],
    scopes: ["scope:drive-functional"],
    conductor: "claude:lead",
    capabilities: ["execute"],
    endpoints: [],
    publicKeys: [],
    acceptedPolicies: [],
    createdAt: "2026-08-21T00:00:00.000Z",
  });
}

describe.skipIf(process.platform !== "linux")("h2a drive native PTY backchannel", () => {
  it("should submit a signed line to a real native PTY and defer after human activity", async () => {
    const directory = await mkdtemp(join(tmpdir(), "h2a-native-drive-functional-"));
    directories.add(directory);
    const socketPath = join(directory, "host.sock");
    const configHome = join(directory, "config");
    const storeRoot = join(directory, "store");
    const privateKeyPath = join(directory, "drive-private.pem");
    const sessionId = "native-drive-pty";
    const entry = fileURLToPath(new URL("./process.ts", import.meta.url));
    const previousSocket = process.env.H2A_NATIVE_SOCKET;
    const previousConfigHome = process.env.REMOTE_CLI_CONFIG_HOME;
    const previousActivityWindow = process.env.H2A_WAKE_DEFER_ACTIVITY_MS;
    process.env.H2A_NATIVE_SOCKET = socketPath;
    process.env.REMOTE_CLI_CONFIG_HOME = configHome;
    process.env.H2A_WAKE_DEFER_ACTIVITY_MS = "4000";

    const spawnHost: NativeTerminalHostSpawn = (options) => {
      const child = spawn(process.execPath, [
        "--import",
        "tsx",
        entry,
        "--socket",
        options.socketPath,
        "--generation",
        options.generation,
        "--replay-bytes",
        String(options.replayBytesPerSession),
        ...(options.registryPath !== undefined ? ["--registry-path", options.registryPath] : []),
      ], {
        cwd: dirname(entry),
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      children.add(child);
      return child;
    };
    const supervisor = new NativeTerminalHostSupervisor({
      socketPath,
      registryPath: join(directory, "host-registry.json"),
      replayBytesPerSession: 1_024 * 1_024,
      generationFactory: () => "native-drive-functional",
      spawnHost,
    });

    try {
      const client = await supervisor.client();
      await client.create({
        id: sessionId,
        command: "/bin/sh",
        args: [
          "-c",
          "printf 'native-drive-ready\\r\\n'; while IFS= read -r line; do printf 'native-drive-received:%s\\r\\n' \"$line\"; done",
        ],
        cwd: directory,
        env: { PATH: process.env.PATH ?? "/usr/bin:/bin", TERM: "xterm-256color" },
        cols: 80,
        rows: 24,
      });
      await eventually(
        () => client.readOutput(sessionId, 0),
        (replay) => replay.chunks.some((chunk) => chunk.data.includes("native-drive-ready")),
      );

      // The h2a instance resolves through its label (worker) to this exact
      // native host session, rather than the core CLI deriving a name itself.
      enroll({
        id: "worker",
        label: "worker",
        tool: "codex",
        kind: "local-native",
        cwd: directory,
        tmuxSession: sessionId,
        source: "run",
        sessionClass: "human",
      });
      const keys = generateKeyPairSync("ed25519");
      const privateKeyPem = keys.privateKey.export({ format: "pem", type: "pkcs8" }).toString();
      const publicKeyPem = keys.publicKey.export({ format: "pem", type: "spki" }).toString();
      await writeFile(privateKeyPath, privateKeyPem, { mode: 0o600 });
      registerDrivePair(storeRoot, publicKeyPem);

      const delivered = captureStreams(directory);
      assert.equal(
        runCli([
          "drive",
          "--root", storeRoot,
          "--from", "claude:lead",
          "--to", "codex:worker",
          "--instruction", "native-drive-delivered",
          "--private-key", privateKeyPath,
          "--driver", "auto",
        ], delivered.streams),
        0,
        delivered.err(),
      );
      const delivery = JSON.parse(delivered.out()) as { driven: boolean; instructionLine: string };
      assert.equal(delivery.driven, true);
      const replay = await eventually(
        () => client.readOutput(sessionId, 0),
        (value) => value.chunks.some((chunk) => chunk.data.includes(delivery.instructionLine)),
      );
      assert.match(
        replay.chunks.map((chunk) => chunk.data).join(""),
        /native-drive-received:.*native-drive-delivered/,
      );

      const humanLease = await client.acquireController(sessionId, "functional-human", "human");
      await client.write(humanLease, "recent-human-input\\r");
      await client.releaseController(humanLease);
      await eventually(
        () => client.readOutput(sessionId, 0),
        (value) => value.chunks.some((chunk) => chunk.data.includes("recent-human-input")),
      );

      const deferred = captureStreams(directory);
      assert.equal(
        runCli([
          "drive",
          "--root", storeRoot,
          "--from", "claude:lead",
          "--to", "codex:worker",
          "--instruction", "native-drive-must-not-arrive",
          "--private-key", privateKeyPath,
          "--driver", "native",
        ], deferred.streams),
        2,
      );
      assert.equal((JSON.parse(deferred.out()) as { driven: boolean }).driven, false);
      assert.doesNotMatch(
        (await client.readOutput(sessionId, 0)).chunks.map((chunk) => chunk.data).join(""),
        /native-drive-must-not-arrive/,
      );
    } finally {
      supervisor.disconnect();
      if (previousSocket === undefined) delete process.env.H2A_NATIVE_SOCKET;
      else process.env.H2A_NATIVE_SOCKET = previousSocket;
      if (previousConfigHome === undefined) delete process.env.REMOTE_CLI_CONFIG_HOME;
      else process.env.REMOTE_CLI_CONFIG_HOME = previousConfigHome;
      if (previousActivityWindow === undefined) delete process.env.H2A_WAKE_DEFER_ACTIVITY_MS;
      else process.env.H2A_WAKE_DEFER_ACTIVITY_MS = previousActivityWindow;
    }
  });
});
