// @ts-ignore Shared JS test isolation helper.
import { isolatedNativeTestEnvironment, spawnIsolatedNative as spawn, spawnSyncIsolatedNative as spawnSync, setupNativeTestEnvironment } from "../../../h2a/test/helpers/native-isolation.js";
setupNativeTestEnvironment(afterAll);
import assert from "node:assert/strict";
import type { ChildProcess } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, describe, expect, it } from "vitest";

import { createLocalStore, runCli } from "@sentropic/h2a";

import { enroll } from "../registry.js";
import { nativeSidecarName, startNativeH2aSidecar } from "../native-host.js";
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
  // The complete real-PTY scenario measured 5.27–9.32s on Node 22 with four
  // CPU workers sharing two cores. Bound the whole scenario separately from
  // readiness polling and the human-activity window, which keep their bounds.
  it("should submit a signed line to a real native PTY and defer after human activity", async () => {
    const directory = await mkdtemp(join(tmpdir(), "d-"));
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
    let stopSidecar: (() => Promise<void>) | undefined;

    try {
      const client = await supervisor.client();
      stopSidecar = async () => {
        const sidecar = (await client.list()).find((session) => session.id === nativeSidecarName(sessionId));
        if (sidecar?.status === "running") {
          await client.stopIfIncarnation(sidecar.id, sidecar.generation, sidecar.incarnation, "SIGKILL");
        }
      };
      await client.create({
        id: sessionId,
        command: "/bin/sh",
        args: [
          "-c",
          "printf 'native-drive-ready\\r\\n'; while IFS= read -r line; do printf 'native-drive-received:%s\\r\\n' \"$line\"; done",
        ],
        cwd: directory,
        env: isolatedNativeTestEnvironment({ PATH: process.env.PATH ?? "/usr/bin:/bin", TERM: "xterm-256color" }),
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

      // The native sidecar is a different PTY from the agent. Its launcher
      // must publish the main session id so inbox-wake writes to this PTY's
      // master instead of trying the sidecar itself (or a tmux pane).
      const markerScript = join(directory, "capture-native-target.mjs");
      const markerPath = join(directory, "native-target.txt");
      await writeFile(
        markerScript,
        "import { writeFileSync } from 'node:fs';\n" +
          "writeFileSync(process.argv[2], process.env.H2A_NATIVE_TARGET_SESSION ?? '');\n" +
          // Model a long-lived MCP sidecar: publishing its target must not
          // terminate it before the launcher's running-state probe.
          "setInterval(() => {}, 1000);\n",
      );
      assert.equal(
        startNativeH2aSidecar(
          sessionId,
          directory,
          `${process.execPath} ${markerScript} ${markerPath}`,
        ),
        true,
      );
      assert.equal(
        await eventually(
          () => readFile(markerPath, "utf8").catch(() => ""),
          (value) => value === sessionId,
        ),
        sessionId,
      );
      assert.equal((await client.state(nativeSidecarName(sessionId))).status, "running");
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
      assert.equal(
        replay.chunks
          .map((chunk) => chunk.data)
          .join("")
          .match(/native-drive-received:[^\r\n]*native-drive-delivered/g)?.length,
        1,
      );

      // This models a human becoming active after the old pre-lease state
      // check. The atomic drive lease below must see it and refuse the write.
      assert.equal((await client.state(sessionId)).lastHumanActivityAt, null);
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

      // A legacy caller with omitted provenance is now treated as human by
      // the client default. Its input blocks drive and never reaches the PTY.
      const legacyLease = await client.acquireController(sessionId, "functional-legacy");
      await client.write(legacyLease, "legacy-provenance-input\r");
      await client.releaseController(legacyLease);
      const legacy = captureStreams(directory);
      assert.equal(
        runCli([
          "drive",
          "--root", storeRoot,
          "--from", "claude:lead",
          "--to", "codex:worker",
          "--instruction", "native-drive-legacy-must-not-arrive",
          "--private-key", privateKeyPath,
          "--driver", "native",
        ], legacy.streams),
        2,
      );
      assert.equal((JSON.parse(legacy.out()) as { driven: boolean }).driven, false);
      assert.doesNotMatch(
        (await client.readOutput(sessionId, 0)).chunks.map((chunk) => chunk.data).join(""),
        /native-drive-legacy-must-not-arrive/,
      );

      // Disable only the timing guard so this test reaches the instruction
      // validator; control bytes still fail before any native lease/write.
      process.env.H2A_WAKE_DEFER_ACTIVITY_MS = "0";
      const control = captureStreams(directory);
      assert.equal(
        runCli([
          "drive",
          "--root", storeRoot,
          "--from", "claude:lead",
          "--to", "codex:worker",
          "--instruction", "native-drive-control-first\nnative-drive-control-second\u001b[31m",
          "--private-key", privateKeyPath,
          "--driver", "native",
        ], control.streams),
        2,
      );
      assert.equal((JSON.parse(control.out()) as { driven: boolean }).driven, false);
      assert.doesNotMatch(
        (await client.readOutput(sessionId, 0)).chunks.map((chunk) => chunk.data).join(""),
        /native-drive-control-(?:first|second)/,
      );
    } finally {
      try {
        await stopSidecar?.();
      } finally {
        supervisor.disconnect();
        if (previousSocket === undefined) delete process.env.H2A_NATIVE_SOCKET;
        else process.env.H2A_NATIVE_SOCKET = previousSocket;
        if (previousConfigHome === undefined) delete process.env.REMOTE_CLI_CONFIG_HOME;
        else process.env.REMOTE_CLI_CONFIG_HOME = previousConfigHome;
        if (previousActivityWindow === undefined) delete process.env.H2A_WAKE_DEFER_ACTIVITY_MS;
        else process.env.H2A_WAKE_DEFER_ACTIVITY_MS = previousActivityWindow;
      }
    }
  }, 15_000);

  // Lot L2: the owner's nominal case — the supervision window stays attached
  // (controller lease held) while an authorized block is submitted. The old
  // lease path refused this outright; inject applies it with the lease held.
  it("should submit an authorized block while its delegated PTY view stays attached", async () => {
    const directory = await mkdtemp(join(tmpdir(), "d-attached-"));
    directories.add(directory);
    const socketPath = join(directory, "host.sock");
    const configHome = join(directory, "config");
    const sessionId = "native-drive-attached";
    const entry = fileURLToPath(new URL("./process.ts", import.meta.url));
    const opEntry = fileURLToPath(new URL("./op.ts", import.meta.url));
    const previousSocket = process.env.H2A_NATIVE_SOCKET;
    const previousConfigHome = process.env.REMOTE_CLI_CONFIG_HOME;
    const previousActivityWindow = process.env.H2A_WAKE_DEFER_ACTIVITY_MS;
    process.env.H2A_NATIVE_SOCKET = socketPath;
    process.env.REMOTE_CLI_CONFIG_HOME = configHome;
    process.env.H2A_WAKE_DEFER_ACTIVITY_MS = "300";

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
      generationFactory: () => "native-drive-attached",
      spawnHost,
    });

    const opDrive = (text: string, requestId: string): { status: number | null; payload: Record<string, unknown> } => {
      const result = spawnSync(
        process.execPath,
        [
          "--import",
          "tsx",
          opEntry,
          "drive",
          "--id",
          sessionId,
          "--b64",
          Buffer.from(text, "utf8").toString("base64"),
          "--request-id",
          requestId,
        ],
        { cwd: dirname(opEntry), env: process.env, encoding: "utf8" },
      );
      const line = result.stdout.trim().split("\n").at(-1) ?? "";
      let payload: Record<string, unknown> = {};
      try {
        payload = JSON.parse(line) as Record<string, unknown>;
      } catch {
        payload = { unparsable: line };
      }
      return { status: result.status, payload };
    };

    try {
      const client = await supervisor.client();
      await client.create({
        id: sessionId,
        command: "/bin/sh",
        args: [
          "-c",
          "printf 'attached-ready\\r\\n'; while IFS= read -r line; do printf 'attached-received:%s\\r\\n' \"$line\"; done",
        ],
        cwd: directory,
        env: isolatedNativeTestEnvironment({ PATH: process.env.PATH ?? "/usr/bin:/bin", TERM: "xterm-256color" }),
        cols: 80,
        rows: 24,
      });
      await eventually(
        () => client.readOutput(sessionId, 0),
        (replay) => replay.chunks.some((chunk) => chunk.data.includes("attached-ready")),
      );

      // The supervision window attaches and STAYS attached for the whole case.
      const humanLease = await client.acquireController(sessionId, "attached-window", "human");
      // Let the attach activity age out of the (short, fixture-only) window.
      await new Promise((resolve) => setTimeout(resolve, 500));

      const first = opDrive("[h2a-wake attached-1]", "attached-req-1");
      assert.equal(first.status, 0);
      assert.equal(first.payload.outcome, "driven");
      const seq = first.payload.automationSeq;
      assert.equal(typeof seq, "number");

      // Idempotent redelivery: same request id returns the original ACK and
      // the PTY receives the unit exactly once, even with the window held.
      const second = opDrive("[h2a-wake attached-1]", "attached-req-1");
      assert.equal(second.status, 0);
      assert.deepEqual(second.payload, first.payload);

      const replay = await eventually(
        () => client.readOutput(sessionId, 0),
        (value) => value.chunks.some((chunk) => chunk.data.includes("[h2a-wake attached-1]")),
      );
      assert.equal(
        replay.chunks.map((chunk) => chunk.data).join("").match(/attached-received:\[h2a-wake attached-1\]/g)?.length,
        1,
      );
      assert.equal((await client.state(sessionId)).controlled, true);

      // Real human typing is never typed over, with zero bytes — the lease
      // is still held throughout. Round-1 (D6/P1): inside the activity
      // window the drive defers with a typed, retryable reason
      // (`deferred-recent-human`); once the window expires the unconsumed
      // draft may still sit in readline, so the drive refuses
      // (`refused-unproven-composition`) — an expired timer alone never
      // proves an empty composer. The op round-trip (tsx startup) may cross
      // the 300 ms fixture window either way, so both typed non-driven
      // outcomes are accepted; a `driven` here would be the P1 defect.
      await client.write(humanLease, "human-typing-now\r");
      const deferred = opDrive("[h2a-wake must-wait]", "attached-req-2");
      assert.equal(deferred.status, 0);
      assert.equal(deferred.payload.outcome, "deferred");
      assert.ok(
        deferred.payload.reason === "deferred-recent-human" ||
          deferred.payload.reason === "refused-unproven-composition",
        `typed refusal, got ${JSON.stringify(deferred.payload.reason)}`,
      );
      if (deferred.payload.reason === "deferred-recent-human") {
        assert.ok(typeof deferred.payload.retryAfterMs === "number" && (deferred.payload.retryAfterMs as number) > 0);
      }
      assert.doesNotMatch(
        (await client.readOutput(sessionId, 0)).chunks.map((chunk) => chunk.data).join(""),
        /\[h2a-wake must-wait\]/,
      );

      await client.releaseController(humanLease);
      assert.equal((await client.state(sessionId)).controlled, false);
    } finally {
      supervisor.disconnect();
      if (previousSocket === undefined) delete process.env.H2A_NATIVE_SOCKET;
      else process.env.H2A_NATIVE_SOCKET = previousSocket;
      if (previousConfigHome === undefined) delete process.env.REMOTE_CLI_CONFIG_HOME;
      else process.env.REMOTE_CLI_CONFIG_HOME = previousConfigHome;
      if (previousActivityWindow === undefined) delete process.env.H2A_WAKE_DEFER_ACTIVITY_MS;
      else process.env.H2A_WAKE_DEFER_ACTIVITY_MS = previousActivityWindow;
    }
  }, 20_000);
});
