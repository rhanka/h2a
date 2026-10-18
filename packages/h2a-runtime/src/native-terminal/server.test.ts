
// @ts-ignore Shared JS qualification helper; tests are outside the production build.
import { createPrivateTestDirectory, spawnIsolatedNative as spawn, spawnSyncIsolatedNative as spawnSync, setupNativeTestEnvironment } from "../../../h2a/test/helpers/native-isolation.js";

setupNativeTestEnvironment(afterAll);
import { once } from "node:events";
import { mkdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { chmod, mkdir, mkdtemp, rm, stat, unlink } from "node:fs/promises";
import { createConnection, createServer, Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import type { PtyHandle, PtySpawner } from "../pty.js";
import type { DurableProcFrame } from "../proc-identity.js";
import { resolveRegistryPath } from "../registry.js";
import { NativeTerminalClient } from "./client.js";
import {
  NativeTerminalHost,
  readProcessStartTime,
  type NativeTerminalOwnerHostProbe,
  type NativeTerminalOwnerHostStatus,
} from "./host.js";
import { HOST_FAULT_COUNTERS, hostFaultCounters } from "./fault-counters.js";
import { hostLogSinkDiagnostics } from "./crash-safe-log.js";
import type { NativeTerminalStopSignal } from "./protocol.js";
import { NATIVE_TERMINAL_MAX_REPLAY_CHUNKS_PER_SESSION } from "./replay-buffer.js";
import { darwinSocketPublicationLockPath, isStagedSocketName, proveNativeTerminalEndpointAbsent, startNativeTerminalHostServer, type NativeTerminalHostServer } from "./server.js";
import { defaultNativeTerminalSocketPath } from "./socket-path.js";
import { NATIVE_TERMINAL_MAX_FRAME_BYTES } from "./protocol.js";
import { assertListenerFaultExit } from "../../test/helpers/listener-fault.js";

class StubPty implements PtyHandle {
  static #nextPid = 51000;
  readonly pid = StubPty.#nextPid++;
  readonly pgid = this.pid;
  readonly cols = 80;
  readonly rows = 24;
  readonly write = vi.fn();
  readonly resize = vi.fn();
  readonly kill = vi.fn();
  readonly #dataHandlers = new Set<(chunk: string) => void>();
  readonly #exitHandlers = new Set<(event: { exitCode: number; signal?: number }) => void>();

  onData(handler: (chunk: string) => void): { dispose(): void } {
    this.#dataHandlers.add(handler);
    return { dispose: () => this.#dataHandlers.delete(handler) };
  }

  onExit(handler: (event: { exitCode: number; signal?: number }) => void): { dispose(): void } {
    this.#exitHandlers.add(handler);
    return { dispose: () => this.#exitHandlers.delete(handler) };
  }

  emitData(data: string): void {
    for (const handler of this.#dataHandlers) handler(data);
  }
}

const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanup.length > 0) await cleanup.pop()?.();
});

async function service(options: { replayBytesPerSession?: number } = {}): Promise<{
  socketPath: string;
  server: NativeTerminalHostServer;
  client: NativeTerminalClient;
  ptys: Map<string, StubPty>;
}> {
  const directory = await mkdtemp(join(tmpdir(), "n-"));
  const socketPath = join(directory, "host.sock");
  const ptys = new Map<string, StubPty>();
  const spawner: PtySpawner = (options) => {
    const pty = new StubPty();
    ptys.set(options.command, pty);
    return pty;
  };
  const host = new NativeTerminalHost({
    generation: "unit-generation",
    replayBytesPerSession: options.replayBytesPerSession ?? 1024,
    spawner,
    registryPath: join(directory, "registry.json"),
  });
  const server = await startNativeTerminalHostServer({ socketPath, host });
  const client = await NativeTerminalClient.connect(socketPath);
  cleanup.push(async () => {
    client.close();
    await server.close({ stopSessions: true });
    await rm(directory, { recursive: true, force: true });
  });
  return { socketPath, server, client, ptys };
}

function createOptions(id: string) {
  return {
    id,
    command: id,
    args: [],
    cwd: "/tmp",
    env: {},
    cols: 80,
    rows: 24,
  } as const;
}

async function eventually<T>(read: () => Promise<T>, accept: (value: T) => boolean): Promise<T> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const value = await read();
    if (accept(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("condition did not become true");
}

async function expectMalformedPeerResponseRejected(
  response: (id: string) => Readonly<Record<string, unknown>>,
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "n-"));
  const socketPath = join(directory, "host.sock");
  const peerSockets = new Set<Socket>();
  const peer = createServer((socket) => {
    peerSockets.add(socket);
    socket.once("close", () => peerSockets.delete(socket));
    socket.setEncoding("utf8");
    let buffer = "";
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      const request = JSON.parse(buffer.slice(0, newline)) as { id: string };
      socket.write(`${JSON.stringify(response(request.id))}\n`);
    });
  });
  await new Promise<void>((resolve, reject) => {
    peer.once("error", reject);
    peer.listen(socketPath, () => resolve());
  });
  await chmod(socketPath, 0o600);
  cleanup.push(async () => {
    for (const socket of peerSockets) socket.destroy();
    await new Promise<void>((resolve) => peer.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  });

  const client = await NativeTerminalClient.connect(socketPath);
  cleanup.push(async () => client.close());
  await expect(client.ping()).rejects.toThrow(/invalid response/i);
  await expect(client.ping()).rejects.toThrow(/client is closed/i);
}

async function acquireControllerWithoutProvenance(
  socketPath: string,
  id: string,
  controllerId: string,
): Promise<void> {
  const socket = createConnection(socketPath);
  socket.setEncoding("utf8");
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("error", reject);
  });
  const response = await new Promise<unknown>((resolve, reject) => {
    let buffer = "";
    socket.once("error", reject);
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      resolve(JSON.parse(buffer.slice(0, newline)));
    });
    socket.write(`${JSON.stringify({
      version: 1,
      id: "legacy-controller",
      operation: "acquire-controller",
      params: { id, controllerId },
    })}\n`);
  });
  socket.end();
  await new Promise<void>((resolve) => socket.once("close", resolve));
  expect(response).toMatchObject({ ok: true });
}

describe("native terminal local transport", () => {
  it("should reject a shared socket directory without changing its permissions", async () => {
    const directory = await mkdtemp(join(tmpdir(), "n-"));
    cleanup.push(() => rm(directory, { recursive: true, force: true }));
    await chmod(directory, 0o755);
    const host = new NativeTerminalHost({
      generation: "permission-generation",
      replayBytesPerSession: 1024,
      spawner: () => new StubPty(),
      registryPath: join(directory, "registry.json"),
    });

    await expect(startNativeTerminalHostServer({
      socketPath: join(directory, "host.sock"),
      host,
    })).rejects.toThrow(/mode 0700/i);
    expect((await stat(directory)).mode & 0o777).toBe(0o755);
  });

  it("should serve multiple sessions over one private persistent socket", async () => {
    const { socketPath, client, ptys } = await service();

    expect((await stat(socketPath)).mode & 0o777).toBe(0o600);
    expect(await client.ping()).toMatchObject({
      generation: "unit-generation",
      protocolVersion: 1,
    });
    await client.create(createOptions("alpha"));
    await client.create(createOptions("beta"));
    ptys.get("alpha")!.emitData("alpha-output");
    ptys.get("beta")!.emitData("beta-output");

    expect(await client.list()).toEqual([
      expect.objectContaining({ id: "alpha", pid: expect.any(Number), status: "running" }),
      expect.objectContaining({ id: "beta", pid: expect.any(Number), status: "running" }),
    ]);
    expect(await client.readOutput("alpha", 0)).toMatchObject({
      chunks: [{ seq: 1, data: "alpha-output" }],
    });
    expect(await client.readOutput("beta", 0)).toMatchObject({
      chunks: [{ seq: 1, data: "beta-output" }],
    });
  });

  it("should record omitted controller provenance on the human-safe side", async () => {
    const { socketPath, client, ptys } = await service();
    await client.create(createOptions("legacy-provenance"));

    await acquireControllerWithoutProvenance(
      socketPath,
      "legacy-provenance",
      "legacy-client",
    );

    const state = await client.state("legacy-provenance");
    expect(state.controlled).toBe(false);
    expect(state.lastHumanActivityAt).toEqual(expect.any(Number));
    await expect(
      client.acquireAutomationControllerIfNoRecentHuman(
        "legacy-provenance",
        "drive",
        4_000,
      ),
    ).rejects.toThrow(/recent human activity/i);
    expect(ptys.get("legacy-provenance")!.write).not.toHaveBeenCalled();
  });

  it("should bound fragmented replay and keep the client connected", async () => {
    const { client, ptys } = await service({
      replayBytesPerSession: 4 * 1024 * 1024,
    });
    await client.create(createOptions("fragmented"));
    const emitted = NATIVE_TERMINAL_MAX_REPLAY_CHUNKS_PER_SESSION + 100;
    for (let index = 0; index < emitted; index += 1) {
      ptys.get("fragmented")!.emitData("x");
    }

    const replay = await client.readOutput("fragmented", 0);
    expect(replay.chunks).toHaveLength(
      NATIVE_TERMINAL_MAX_REPLAY_CHUNKS_PER_SESSION,
    );
    expect(replay.gap).toEqual({ fromSeq: 1, toSeq: 100 });
    expect(replay.latestSeq).toBe(emitted);
    expect(await client.ping()).toMatchObject({
      generation: "unit-generation",
    });
  });

  it("should close a paused replay reader before its response queue exceeds the bound", async () => {
    const { socketPath, client, ptys } = await service({
      replayBytesPerSession: 4 * 1024 * 1024,
    });
    await client.create(createOptions("slow-reader"));
    ptys.get("slow-reader")!.emitData("x".repeat(4 * 1024 * 1024));

    const slow = createConnection(socketPath);
    slow.on("error", () => {
      // The server intentionally drops this backpressured connection.
    });
    await new Promise<void>((resolve, reject) => {
      slow.once("connect", resolve);
      slow.once("error", reject);
    });
    slow.pause();
    const closed = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("slow replay reader was not closed")),
        5_000,
      );
      slow.once("close", () => {
        clearTimeout(timeout);
        resolve();
      });
    });
    const frames = Array.from({ length: 16 }, (_, index) => JSON.stringify({
      version: 1,
      id: `slow-${index}`,
      operation: "read-output",
      params: { id: "slow-reader", afterSeq: 0 },
    })).join("\n") + "\n";
    slow.write(frames);

    await new Promise((resolve) => setTimeout(resolve, 100));
    slow.resume();
    await closed;
    expect(await client.ping()).toMatchObject({ generation: "unit-generation" });
    const lease = await client.acquireController("slow-reader", "healthy");
    await client.write(lease, "still-healthy");
    expect(ptys.get("slow-reader")!.write).toHaveBeenCalledWith(
      "still-healthy",
    );
  });

  it("should contain a net.Server error surfacing after listen", async () => {
    const before = hostFaultCounters();
    const { socketPath, server, client } = await service();
    // The listener that guards listen() is removed once listening succeeds;
    // recoverable accept/connection-side transport errors (R7) must be
    // absorbed by the durable handler: the service stays up.
    for (const code of ["ECONNRESET", "EPIPE", "ECONNABORTED"]) {
      const error = new Error(`late ${code} on the accept path`);
      (error as NodeJS.ErrnoException).code = code;
      expect(() => server.server.emit("error", error)).not.toThrow();
    }
    expect((await client.ping()).generation).toBe("unit-generation");
    const second = await NativeTerminalClient.connect(socketPath);
    expect((await second.ping()).generation).toBe("unit-generation");
    second.close();
    expect(hostFaultCounters()[HOST_FAULT_COUNTERS.serverListenerErrorRecoverable]).toBe((before[HOST_FAULT_COUNTERS.serverListenerErrorRecoverable] ?? 0) + 3);
    // The recoverable class never escalates.
    expect(hostFaultCounters()[HOST_FAULT_COUNTERS.serverListenerErrorUnknown]).toBe(before[HOST_FAULT_COUNTERS.serverListenerErrorUnknown]);
    expect(hostFaultCounters()[HOST_FAULT_COUNTERS.serverListenerErrorUnusable]).toBe(before[HOST_FAULT_COUNTERS.serverListenerErrorUnusable]);
  });

  it.each([null, "EUNCLASSIFIED"])("should exit non-zero on an unknown net.Server error (%s)", async code => {
    await assertListenerFaultExit([code], 3, "server.listener-error-unknown");
  });

  it.each([
    ["ERR_SERVER_CLOSED", ["ERR_SERVER_CLOSED"]],
    ["EADDRINUSE", ["EADDRINUSE"]],
    ["EMFILE,EMFILE,EMFILE", ["EMFILE", "EMFILE", "EMFILE"]],
    ["ENFILE,ENFILE,ENFILE", ["ENFILE", "ENFILE", "ENFILE"]],
    ["EMFILE,ENFILE,EMFILE", ["EMFILE", "ENFILE", "EMFILE"]],
  ] as const)("should exit when the listener becomes unusable (%s)", async (_label, codes) => {
    await assertListenerFaultExit(codes, 0, "server.listener-error-unusable");
  });

  it("should refuse initialization on an unknown listener error during publication", async () => {
    const directory = createPrivateTestDirectory("e");
    cleanup.push(() => rm(directory, { recursive: true, force: true }));
    const socketPath = join(directory, "host.sock");
    const host = new NativeTerminalHost({ generation: "publication-fault", replayBytesPerSession: 1024,
      spawner: () => new StubPty(), registryPath: join(directory, "registry.json") });
    const before = hostFaultCounters()[HOST_FAULT_COUNTERS.serverListenerErrorUnknown] ?? 0;
    const on = Server.prototype.on;
    const spy = vi.spyOn(Server.prototype, "on").mockImplementation(function (event, listener) {
      const result = on.call(this, event, listener);
      const address = this.address();
      if (event === "error" && this.listening && typeof address === "string"
        && isStagedSocketName(basename(address), socketPath, process.pid)) {
        queueMicrotask(() => this.emit("error", new Error("injected publication fault")));
      }
      return result;
    });
    try {
      const started = startNativeTerminalHostServer({ socketPath, host }).then(server => {
        cleanup.push(() => server.close());
        return server;
      });
      await expect(started).rejects.toThrow("unknown listener error");
      expect(hostFaultCounters()[HOST_FAULT_COUNTERS.serverListenerErrorUnknown]).toBe(before + 1);
      await expect(NativeTerminalClient.connect(socketPath)).rejects.toThrow();
    } finally { spy.mockRestore(); }
  });

  it("should expose the named counters of the exempted silent-catch sites", async () => {
    const { socketPath, server, client, ptys } = await service();
    await client.create(createOptions("healthy-faults"));
    const before = hostFaultCounters();
    async function peer(): Promise<{ wire: Socket; accepted: Socket }> {
      const connection = once(server.server, "connection");
      const wire = createConnection(socketPath);
      wire.on("error", () => {}); // This test deliberately destroys its own peer.
      await once(wire, "connect");
      const [accepted] = await connection;
      cleanup.push(async () => { wire.destroy(); });
      return { wire, accepted: accepted as Socket };
    }
    const failed = await peer();
    const closed = new Promise<void>(resolve => failed.wire.once("close", resolve));
    failed.accepted.destroy(Object.assign(new Error("injected transport failure"), { code: "EPIPE" }));
    await closed;
    expect(hostLogSinkDiagnostics().faultCounters.h2a_host_socket_conn_errors).toBe((before[HOST_FAULT_COUNTERS.hostSocketConnectionErrors] ?? 0) + 1);
    // Exercise both frame-size destroy branches and the outer dispatch catch.
    // Request execution is async (Phase B forwarding), so a malformed chunk
    // destroys its connection on a microtask, not synchronously: flush
    // microtasks (no timers) before asserting the deterministic outcome.
    for (const chunk of ["x".repeat(NATIVE_TERMINAL_MAX_FRAME_BYTES + 1) + "\n",
      "x".repeat(NATIVE_TERMINAL_MAX_FRAME_BYTES + 1),
      { [Symbol.toPrimitive]() { throw new Error("bad chunk"); } }]) {
      const faulty = await peer();
      expect(() => faulty.accepted.emit("data", chunk)).not.toThrow();
      await new Promise((resolve) => setImmediate(resolve));
      expect(faulty.accepted.destroyed).toBe(true);
    }
    expect(hostLogSinkDiagnostics().faultCounters.h2a_host_client_frame_destroys).toBe((before[HOST_FAULT_COUNTERS.hostClientFrameDestroys] ?? 0) + 3);
    expect((await client.ping()).generation).toBe("unit-generation");
    const lease = await client.acquireController("healthy-faults", "healthy");
    await client.write(lease, "still-serving");
    expect(ptys.get("healthy-faults")!.write).toHaveBeenCalledWith("still-serving");
  });

  it.each(["EMFILE", "ENFILE"])("should keep serving through transient %s accept exhaustion", async (code) => {
    const { server, client } = await service();
    const before = hostFaultCounters()[HOST_FAULT_COUNTERS.serverListenerErrorExhausted] ?? 0;
    for (let n = 0; n < 2; n++) server.server.emit("error", Object.assign(new Error(code), { code }));
    expect((await client.ping()).generation).toBe("unit-generation");
    expect(hostFaultCounters()[HOST_FAULT_COUNTERS.serverListenerErrorExhausted]).toBe(before + 2);
  });

  it("should count only consecutive accept exhaustion within sixty seconds", async () => {
    const { socketPath, server, client } = await service();
    const before = hostFaultCounters()[HOST_FAULT_COUNTERS.serverListenerErrorUnusable];
    const fault = () => server.server.emit("error", Object.assign(new Error("EMFILE"), { code: "EMFILE" }));
    fault(); fault();
    const accepted = await NativeTerminalClient.connect(socketPath);
    expect((await accepted.ping()).generation).toBe("unit-generation");
    accepted.close();
    fault(); fault();
    expect((await client.ping()).generation).toBe("unit-generation");
    // A gap beyond the window also resets the consecutive exhaustion series.
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 60_001);
    try { fault(); fault(); } finally { clock.mockRestore(); }
    expect((await client.ping()).generation).toBe("unit-generation");
    expect(hostFaultCounters()[HOST_FAULT_COUNTERS.serverListenerErrorUnusable]).toBe(before);
  });

  it("should stop serving when a listener error cannot be classified", async () => {
    const before = hostFaultCounters()[HOST_FAULT_COUNTERS.serverListenerErrorUnknown] ?? 0;
    const { socketPath, server, client } = await service();
    // R7: an error with no recognized errno is UNKNOWN — the server must NOT
    // keep pretending to serve on a listener whose failure it cannot name.
    expect(() => server.server.emit("error", new Error("late mystery listener failure"))).not.toThrow();
    await expect(client.ping()).rejects.toThrow();
    const refused = await eventually(
      () => NativeTerminalClient.connect(socketPath).then(() => false, () => true),
      (failed) => failed,
    );
    expect(refused).toBe(true);
    expect(hostFaultCounters()[HOST_FAULT_COUNTERS.serverListenerErrorUnknown]).toBe(before + 1);
  });

  it("should bind controller authority to its connection and release it on disconnect", async () => {
    const { socketPath, client, ptys } = await service();
    const observer = await NativeTerminalClient.connect(socketPath);
    cleanup.push(async () => observer.close());
    await client.create(createOptions("alpha"));
    const lease = await client.acquireController("alpha", "primary");

    await expect(observer.write(lease, "stolen")).rejects.toThrow(/not owned by this connection/i);
    await expect(observer.stop(lease, "SIGKILL")).rejects.toThrow(
      /not owned by this connection/i,
    );
    await expect(
      client.stop(lease, "SIGUSR1" as NativeTerminalStopSignal),
    ).rejects.toThrow(/SIGHUP, SIGINT, SIGTERM or SIGKILL/i);
    expect(ptys.get("alpha")!.write).not.toHaveBeenCalled();
    await client.stop(lease, "SIGTERM");
    client.close();

    const replacement = await eventually(
      () => observer.acquireController("alpha", "replacement").then(
        (value) => ({ ok: true as const, value }),
        () => ({ ok: false as const }),
      ),
      (result) => result.ok,
    );
    if (!replacement.ok) throw new Error("replacement lease was not acquired");
    await expect(observer.write(replacement.value, "denied-while-stopping"))
      .rejects.toThrow(/stale terminal controller lease/i);
    await observer.stop(replacement.value, "SIGKILL");
    expect(ptys.get("alpha")!.kill).toHaveBeenNthCalledWith(1, "SIGTERM");
    expect(ptys.get("alpha")!.kill).toHaveBeenNthCalledWith(2, "SIGKILL");
  });

  it("should time out a request when a connected peer stops responding", async () => {
    const directory = await mkdtemp(join(tmpdir(), "n-"));
    cleanup.push(() => rm(directory, { recursive: true, force: true }));
    const socketPath = join(directory, "host.sock");
    const stalledSockets = new Set<Socket>();
    const stalled = createServer((socket) => {
      stalledSockets.add(socket);
      socket.once("close", () => stalledSockets.delete(socket));
    });
    await new Promise<void>((resolve, reject) => {
      stalled.once("error", reject);
      stalled.listen(socketPath, () => resolve());
    });
    await chmod(socketPath, 0o600);
    cleanup.push(
      () =>
        new Promise<void>((resolve) => {
          for (const socket of stalledSockets) socket.destroy();
          stalled.close(() => resolve());
        }),
    );

    const client = await NativeTerminalClient.connect(socketPath, {
      requestTimeoutMs: 50,
    });
    cleanup.push(async () => client.close());
    await expect(client.ping()).rejects.toThrow(/request timed out after 50ms/i);
  });

  it("should fail closed on incompatible or malformed response variants", async () => {
    const validResult = {
      generation: "rogue-generation",
      hostPid: process.pid,
      protocolVersion: 1,
    };
    await expectMalformedPeerResponseRejected((id) => ({
      version: 999,
      id,
      ok: true,
      result: validResult,
    }));
    await expectMalformedPeerResponseRejected((id) => ({
      version: 1,
      id,
      ok: false,
    }));
    await expectMalformedPeerResponseRejected((id) => ({
      version: 1,
      id,
      ok: false,
      error: { code: "wrong-code", message: "wrong code" },
    }));
    await expectMalformedPeerResponseRejected((id) => ({
      version: 1,
      id,
      ok: false,
      error: { code: "operation-failed", message: 42 },
    }));
    await expectMalformedPeerResponseRejected((id) => ({
      version: 1,
      id,
      ok: true,
    }));
  });

  it("should refuse a socket whose filesystem mode is not private", async () => {
    const { socketPath } = await service();
    await chmod(socketPath, 0o666);
    await expect(NativeTerminalClient.connect(socketPath)).rejects.toThrow(
      /mode 0600/i,
    );
    await chmod(socketPath, 0o600);
  });

  it("should not unlink a replacement host socket when the old server closes", async () => {
    const directory = await mkdtemp(join(tmpdir(), "n-"));
    cleanup.push(() => rm(directory, { recursive: true, force: true }));
    const socketPath = join(directory, "host.sock");
    const spawner: PtySpawner = () => new StubPty();
    const first = await startNativeTerminalHostServer({
      socketPath,
      host: new NativeTerminalHost({
        generation: "first-generation",
        replayBytesPerSession: 1024,
        spawner,
        registryPath: join(directory, "registry.json"),
      }),
    });
    cleanup.push(() => first.close());
    await unlink(socketPath);
    // Force a transport-only replacement in this fixture, including its
    // attribution. Production never discards a live owner's identity.
    await unlink(`${socketPath}.owner`);
    const second = await startNativeTerminalHostServer({
      socketPath,
      host: new NativeTerminalHost({
        generation: "second-generation",
        replayBytesPerSession: 1024,
        spawner,
        registryPath: join(directory, "registry.json"),
      }),
    });
    cleanup.push(() => second.close());

    await first.close();
    expect((await stat(socketPath)).isSocket()).toBe(true);
    const client = await NativeTerminalClient.connect(socketPath);
    cleanup.push(async () => client.close());
    expect(await client.ping()).toMatchObject({
      generation: "second-generation",
    });
  });

  it("should serialize competing publishers across a stale canonical socket", async () => {
    const directory = await mkdtemp(join(tmpdir(), "n-"));
    const socketPath = join(directory, "host.sock");
    await chmod(directory, 0o700);
    const staleHost = spawn(process.execPath, ["--import", "tsx", fileURLToPath(new URL("./process.ts", import.meta.url)),
      "--socket", socketPath, "--registry-path", join(directory, "registry.json")], { stdio: ["ignore", "pipe", "pipe"] });
    try {
      await Promise.race([once(staleHost.stdout!, "data"), once(staleHost, "exit").then(() => { throw new Error("stale fixture host exited before readiness"); })]);
    } finally {
      if (staleHost.exitCode === null && staleHost.signalCode === null) {
        const exited = once(staleHost, "exit"); staleHost.kill("SIGKILL"); await exited;
      }
    }

    const servers = new Set<NativeTerminalHostServer>();
    const clients = new Set<NativeTerminalClient>();
    const host = (generation: string) => new NativeTerminalHost({
      generation,
      replayBytesPerSession: 1024,
      spawner: () => new StubPty(),
      registryPath: join(directory, "registry.json"),
    });
    try {
      const contenders = await Promise.allSettled([
        startNativeTerminalHostServer({
          socketPath,
          host: host("publisher-alpha"),
        }),
        startNativeTerminalHostServer({
          socketPath,
          host: host("publisher-beta"),
        }),
      ]);
      const fulfilled = contenders.filter(
        (result): result is PromiseFulfilledResult<NativeTerminalHostServer> =>
          result.status === "fulfilled",
      );
      const rejected = contenders.filter(
        (result): result is PromiseRejectedResult => result.status === "rejected",
      );
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0]!.reason).toMatchObject({
        code: "H2A_STALE_SOCKET_UNPROVEN", exitCode: 3,
        message: "terminal host owner death is unproven; refusing stale socket reclamation",
      });
      servers.add(fulfilled[0]!.value);

      const winner = await NativeTerminalClient.connect(socketPath);
      clients.add(winner);
      expect(["publisher-alpha", "publisher-beta"]).toContain(
        (await winner.ping()).generation,
      );
      winner.close();
      clients.delete(winner);
      await fulfilled[0]!.value.close();
      servers.delete(fulfilled[0]!.value);

      const replacement = await startNativeTerminalHostServer({
        socketPath,
        host: host("publisher-replacement"),
      });
      servers.add(replacement);
      const replacementClient = await NativeTerminalClient.connect(socketPath);
      clients.add(replacementClient);
      expect(await replacementClient.ping()).toMatchObject({
        generation: "publisher-replacement",
      });
    } finally {
      for (const client of clients) client.close();
      await Promise.allSettled(
        [...servers].map((server) => server.close({ stopSessions: true })),
      );
      await rm(directory, { recursive: true, force: true });
    }
  });

  // The boot-boundary death proof (incident 2026-10-11) and its fail-closed
  // complement, exercised through the typed `ReadProcessFrame` seam: the
  // current frame is INJECTED here (deterministic, no /proc dependence),
  // never faked through a public environment variable. The integration
  // matrix in packages/h2a/test/native-inventory-absence.test.js proves the
  // same classification against the real system readers end to end.
  describe("endpoint absence frame classification", () => {
    // The current frame is INJECTED through the typed `ReadProcessFrame` seam
    // (deterministic, no /proc dependence) — never a public environment
    // variable — and now carries the full seam surface: identity anchors
    // plus the provenance fields nsNet/startTime/bootTimeMs, which take no
    // part in any classification. The liveness probe is injected the same way
    // and its calls are RECORDED: the absence of a probe is an observed fact,
    // never inferred from a verdict (a probe of a recycled-looking pid could
    // have concluded "dead" without failing the test). The integration matrix
    // in packages/h2a/test/native-inventory-absence.test.js proves the same
    // classification against the real system readers end to end.
    const currentFrame = {
      pidNamespace: "4026531836",
      bootId: "11111111-1111-4111-8111-111111111111",
      machineId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      nsNet: "4026531840",
      startTime: 12345,
      bootTimeMs: 1760000000000,
    };
    const previousBootId = "00000000-0000-4000-8000-000000000000";
    const previousBootRowFrame = {
      pgidPidNamespace: currentFrame.pidNamespace,
      pgidMachineId: currentFrame.machineId,
      pgidBootId: previousBootId,
    };
    const currentBootRowFrame = {
      pgidPidNamespace: currentFrame.pidNamespace,
      pgidMachineId: currentFrame.machineId,
      pgidBootId: currentFrame.bootId,
    };

    function writeAttributedRow(
      socketPath: string,
      owner: { pid: number; startTime?: number },
      frame: Record<string, string | undefined>,
    ): string {
      const registryPath = resolveRegistryPath();
      mkdirSync(dirname(registryPath), { recursive: true, mode: 0o700 });
      writeFileSync(registryPath, JSON.stringify({ version: 1, entries: [{
        id: "native-terminal-pty:unit-frame-row",
        tool: "claude",
        kind: "local",
        cwd: "",
        source: "scan",
        enrolledAt: "2026-10-11T00:00:00.000Z",
        lastSeenAt: "2026-10-11T00:00:00.000Z",
        pgid: 424242,
        ownerHostPid: owner.pid,
        ...(owner.startTime !== undefined ? { ownerHostStartTime: owner.startTime } : {}),
        ownerHostSocketPath: socketPath,
        ...frame,
      }] }));
      return registryPath;
    }

    function recordingProbe(
      verdict: NativeTerminalOwnerHostStatus,
      calls: Array<{ pid: number; startTime?: number }>,
    ): NativeTerminalOwnerHostProbe {
      return (owner) => {
        calls.push({ pid: owner.pid, ...(owner.startTime !== undefined ? { startTime: owner.startTime } : {}) });
        return verdict;
      };
    }

    async function proveAbsent(
      socketPath: string,
      ownerProbe: NativeTerminalOwnerHostProbe,
      code: "ENOENT" | "ECONNREFUSED" = "ENOENT",
      readFrame: () => DurableProcFrame = () => currentFrame,
    ): Promise<boolean> {
      return proveNativeTerminalEndpointAbsent(
        socketPath,
        Object.assign(new Error(`connect ${code}`), { code }),
        readFrame,
        ownerProbe,
      );
    }

    /** Bind a listener in a child, SIGKILL it: the socket FILE stays behind
     * with no one answering it — the exact stale shape publication reclaims
     * (a graceful close would UNLINK the pathname; only a kill leaves it). */
    async function abandonedSocket(socketPath: string): Promise<void> {
      const holder = spawn(process.execPath, ["--input-type=module", "-e",
        `import { createServer } from "node:net";
         createServer().listen(${JSON.stringify(socketPath)}, () => console.log("bound"));`],
      { stdio: ["ignore", "pipe", "pipe"] });
      const gone = new Promise<void>(resolve => holder.once("exit", () => resolve()));
      await Promise.race([once(holder.stdout!, "data"), gone]);
      holder.kill("SIGKILL");
      await gone;
      await chmod(socketPath, 0o600);
    }

    function writeEndpointSidecar(
      socketPath: string,
      frame: { bootId: string; pidNamespace: string; machineId?: string },
    ): void {
      const identity = statSync(socketPath);
      writeFileSync(`${socketPath}.owner`, JSON.stringify({
        dev: identity.dev,
        ino: identity.ino,
        pid: 424242,
        startTime: 1,
        bootId: frame.bootId,
        pidNamespace: frame.pidNamespace,
        ...(frame.machineId !== undefined ? { machineId: frame.machineId } : {}),
      }), { mode: 0o600 });
    }

    async function frameDirectory(): Promise<string> {
      const directory = await mkdtemp(join(tmpdir(), "frame-"));
      cleanup.push(() => rm(directory, { recursive: true, force: true }));
      return directory;
    }

    function cleanRegistry(registryPath?: string): void {
      cleanup.push(() => { try { unlinkSync(registryPath ?? resolveRegistryPath()); } catch { /* already gone */ } });
    }

    it.skipIf(process.platform !== "linux")(
      "ENDPOINT_ABSENCE_GRANTS_THE_PREVIOUS_BOOT_OF_THIS_MACHINE_WITHOUT_PROBING_ITS_PIDS",
      async () => {
        const directory = await frameDirectory();
        const socketPath = join(directory, "host.sock");
        // The row names THIS live test process as its previous-boot owner
        // with a foreign-looking start-time. The probe would answer "alive",
        // so only the boot-boundary proof can grant — and the recorder
        // OBSERVES that no probe call was made at all.
        const calls: Array<{ pid: number; startTime?: number }> = [];
        const registryPath = writeAttributedRow(socketPath,
          { pid: process.pid, startTime: 1 }, previousBootRowFrame);
        cleanRegistry(registryPath);
        expect(await proveAbsent(socketPath, recordingProbe("alive", calls))).toBe(true);
        expect(calls).toEqual([]);
      },
    );

    it.skipIf(process.platform !== "linux")(
      "ENDPOINT_ABSENCE_REFUSES_A_LIVE_OWNER_OF_THE_CURRENT_BOOT",
      async () => {
        const directory = await frameDirectory();
        const socketPath = join(directory, "host.sock");
        const calls: Array<{ pid: number; startTime?: number }> = [];
        const startTime = readProcessStartTime(process.pid);
        expect(startTime).toBeDefined();
        const registryPath = writeAttributedRow(socketPath,
          { pid: process.pid, startTime }, currentBootRowFrame);
        cleanRegistry(registryPath);
        expect(await proveAbsent(socketPath, recordingProbe("alive", calls))).toBe(false);
        expect(calls).toEqual([{ pid: process.pid, startTime }]);
      },
    );

    it.skipIf(process.platform !== "linux")(
      "ENDPOINT_ABSENCE_PROVES_A_RECYCLED_OWNER_OF_THE_CURRENT_BOOT_DEAD",
      async () => {
        const directory = await frameDirectory();
        const socketPath = join(directory, "host.sock");
        // Same live pid, but a start-time from another life: the pid was
        // recycled, which PROVES the recorded owner dead — a positive death
        // proof reached BY the probe, with the call on record.
        const calls: Array<{ pid: number; startTime?: number }> = [];
        const registryPath = writeAttributedRow(socketPath,
          { pid: process.pid, startTime: 1 }, currentBootRowFrame);
        cleanRegistry(registryPath);
        expect(await proveAbsent(socketPath, recordingProbe("dead", calls))).toBe(true);
        expect(calls).toEqual([{ pid: process.pid, startTime: 1 }]);
      },
    );

    it.skipIf(process.platform !== "linux")(
      "ENDPOINT_ABSENCE_REFUSES_ANY_FRAME_IT_CANNOT_PIN_TO_THIS_MACHINE",
      async () => {
        const directory = await frameDirectory();
        const socketPath = join(directory, "host.sock");
        const calls: Array<{ pid: number; startTime?: number }> = [];
        const probe = recordingProbe("dead", calls);
        // Every case below must refuse BEFORE any probe: the recorder stays
        // empty, so no refusal can be attributed to a probe verdict.
        // A KNOWN machine id that differs, same boot and namespace: the
        // record contradicts itself — corrupted or fabricated, never evidence.
        const registryPath = writeAttributedRow(socketPath,
          { pid: 424242, startTime: 1 },
          { ...currentBootRowFrame, pgidMachineId: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" });
        cleanRegistry(registryPath);
        expect(await proveAbsent(socketPath, probe)).toBe(false);
        // A malformed recorded boot id: "different from the current boot"
        // on garbage must never grant the stale-boot death proof.
        writeAttributedRow(socketPath, { pid: 424242, startTime: 1 },
          { ...previousBootRowFrame, pgidBootId: "garbage" });
        expect(await proveAbsent(socketPath, probe)).toBe(false);
        // A different boot with no machine anchor on a REGISTRY row: could be
        // another machine sharing the store — never proof of a local reboot.
        writeAttributedRow(socketPath, { pid: 424242, startTime: 1 },
          { ...previousBootRowFrame, pgidMachineId: undefined });
        expect(await proveAbsent(socketPath, probe)).toBe(false);
        // A namespace change alone, same boot: the pid number names a
        // different process; nothing can be concluded either way.
        writeAttributedRow(socketPath, { pid: 424242, startTime: 1 },
          { ...currentBootRowFrame, pgidPidNamespace: "4026599999" });
        expect(await proveAbsent(socketPath, probe)).toBe(false);
        // A row with no anchors at all (legacy): no verdict may be derived.
        writeAttributedRow(socketPath, { pid: 424242, startTime: 1 }, {});
        expect(await proveAbsent(socketPath, probe)).toBe(false);
        expect(calls).toEqual([]);
      },
    );

    it.skipIf(process.platform !== "linux")(
      "ENDPOINT_ABSENCE_REFUSES_WHEN_A_STALE_BOOT_SIDECAR_MEETS_A_LIVE_CURRENT_BOOT_ROW",
      async () => {
        const directory = await frameDirectory();
        const socketPath = join(directory, "host.sock");
        // Spec v3 gap c: the sidecar proves ITS publisher dead across the
        // boot boundary, but the registry still carries a row of THIS boot
        // whose owner is alive. The sidecar never decides alone: the row is
        // probed (and observed), the reclamation is refused.
        const calls: Array<{ pid: number; startTime?: number }> = [];
        const startTime = readProcessStartTime(process.pid);
        expect(startTime).toBeDefined();
        await abandonedSocket(socketPath);
        writeEndpointSidecar(socketPath, {
          bootId: previousBootId,
          pidNamespace: currentFrame.pidNamespace,
          machineId: currentFrame.machineId,
        });
        const registryPath = writeAttributedRow(socketPath,
          { pid: process.pid, startTime }, currentBootRowFrame);
        cleanRegistry(registryPath);
        expect(await proveAbsent(socketPath, recordingProbe("alive", calls), "ECONNREFUSED")).toBe(false);
        // The row's owner was probed; the sidecar's recorded pid never was.
        expect(calls).toEqual([{ pid: process.pid, startTime }]);
        expect(calls.every(call => call.pid !== 424242)).toBe(true);
      },
    );

    it.skipIf(process.platform !== "linux")(
      "ENDPOINT_ABSENCE_MIGRATES_AN_UNATTRIBUTED_SIDECAR_THROUGH_THE_ALTERNATIVE_PROOF",
      async () => {
        const directory = await frameDirectory();
        const socketPath = join(directory, "host.sock");
        // Spec v3 migration (option A): a pre-0.98.5 sidecar carries no
        // machine anchor. Across a boot boundary it is unattributed — no
        // death proof, and no longer a refusal either. With previous-boot
        // rows of THIS machine as the alternative proof, reclamation is
        // granted and nothing is probed. The park shape: the persistent
        // socket's inode PREDATES the current boot (the file survived the
        // reboot), so the injected boot instant sits after the fixture's
        // creation — a socket created DURING the current boot is the refused
        // case (publication-proof: "never unlink a current-boot bound
        // socket over stale rows and an unattributed sidecar").
        const calls: Array<{ pid: number; startTime?: number }> = [];
        await abandonedSocket(socketPath);
        writeEndpointSidecar(socketPath, {
          bootId: previousBootId,
          pidNamespace: currentFrame.pidNamespace,
        });
        const registryPath = writeAttributedRow(socketPath,
          { pid: process.pid, startTime: 1 }, previousBootRowFrame);
        cleanRegistry(registryPath);
        expect(await proveAbsent(socketPath, recordingProbe("alive", calls), "ECONNREFUSED",
          () => ({ ...currentFrame, bootTimeMs: Date.now() + 60_000 }))).toBe(true);
        expect(calls).toEqual([]);
      },
    );

    it.skipIf(process.platform !== "linux")(
      "ENDPOINT_ABSENCE_REFUSES_AN_UNATTRIBUTED_SIDECAR_WITH_NO_ALTERNATIVE_PROOF",
      async () => {
        const directory = await frameDirectory();
        const socketPath = join(directory, "host.sock");
        const calls: Array<{ pid: number; startTime?: number }> = [];
        // The same unattributed sidecar with NO durable rows: no proof of
        // any kind is available, so the reclamation stays refused.
        await abandonedSocket(socketPath);
        writeEndpointSidecar(socketPath, {
          bootId: previousBootId,
          pidNamespace: currentFrame.pidNamespace,
        });
        try { unlinkSync(resolveRegistryPath()); } catch { /* already absent */ }
        cleanRegistry();
        expect(await proveAbsent(socketPath, recordingProbe("alive", calls), "ECONNREFUSED")).toBe(false);
        expect(calls).toEqual([]);
      },
    );
  });
});

describe("native terminal socket path limits", () => {
  // AF_UNIX sun_path is 108 bytes on Linux (104 Darwin) including the NUL.
  // Past it, libuv silently truncates the path at bind/connect: the socket
  // appears under a *different* name and the host used to die at startup
  // with an unexplained chmod ENOENT. These paths must be rejected loudly.
  const limit = process.platform === "darwin" ? 103 : 107;

  it("should recognize the exact legacy and short staged-socket grammars", () => {
    const published = "/temporary/native-terminal.sock";
    expect(isStagedSocketName(".native-t.42.0123abcd.sock", published, 42)).toBe(true);
    expect(isStagedSocketName(".nat.42.0123abcd", published, 42)).toBe(true);
    for (const name of [".native-t.42.0123abcd", ".nat.42.0123abcd.sock", ".nat.42.0123abc",
      ".nat.42.0123abcdx", ".nat.42.0123ABCd", ".nat.43.0123abcd", ".other.42.0123abcd.sock"]) {
      expect(isStagedSocketName(name, published, 42), name).toBe(false);
    }
  });

  it.each([0, 1])("should prefer legacy staging at the sun_path boundary and fall back only on overflow (+%s byte)", async (overflow) => {
    const root = createPrivateTestDirectory("g");
    cleanup.push(() => rm(root, { recursive: true, force: true }));
    const legacyNameLength = Buffer.byteLength(`.native-t.${process.pid}.0123abcd.sock`);
    const directory = join(root, "d".repeat(limit - legacyNameLength - Buffer.byteLength(root) - 2 + overflow));
    await mkdir(directory, { mode: 0o700 });
    const socketPath = join(directory, "native-terminal.sock");
    const host = new NativeTerminalHost({ generation: "grammar", replayBytesPerSession: 1024,
      spawner: () => new StubPty(), registryPath: join(root, "registry.json") });
    const server = await startNativeTerminalHostServer({ socketPath, host });
    cleanup.push(() => server.close());
    const address = server.server.address();
    expect(typeof address).toBe("string");
    const staged = address as string;
    expect(Buffer.byteLength(staged)).toBeLessThanOrEqual(limit);
    expect(basename(staged)).toMatch(overflow === 0
      ? new RegExp(`^\\.native-t\\.${process.pid}\\.[0-9a-f]{8}\\.sock$`)
      : new RegExp(`^\\.nat\\.${process.pid}\\.[0-9a-f]{8}$`));
    expect(isStagedSocketName(basename(staged), socketPath, process.pid)).toBe(true);
    const client = await NativeTerminalClient.connect(socketPath);
    cleanup.push(async () => client.close());
    expect((await client.ping()).generation).toBe("grammar");
    await unlink(socketPath);
    await expect(startNativeTerminalHostServer({ socketPath, host })).rejects.toThrow(/owner death is unproven/);
    expect((await client.ping()).generation).toBe("grammar");
  });

  function hostStub(): NativeTerminalHost {
    return new NativeTerminalHost({
      generation: "limit-generation",
      replayBytesPerSession: 1024,
      spawner: () => new StubPty(),
    });
  }

  it("should reject a socket path over the kernel sun_path budget with a clear error", async () => {
    const directory = await mkdtemp(join(tmpdir(), "n-"));
    cleanup.push(() => rm(directory, { recursive: true, force: true }));
    const socketPath = join(directory, "d".repeat(limit), "host.sock");
    expect(Buffer.byteLength(socketPath)).toBeGreaterThan(limit);

    await expect(startNativeTerminalHostServer({
      socketPath,
      host: hostStub(),
    })).rejects.toThrow(/unix socket path limit \(\d+ > \d+ bytes\)/);
  });

  it("should reject a publishable path whose longer staged sibling would overflow at bind", async () => {
    const directory = await mkdtemp(join(tmpdir(), "n-"));
    cleanup.push(() => rm(directory, { recursive: true, force: true }));
    // Final path lands just under the budget; the staged name appends
    // ".<pid>.<8 hex>.sock" and crosses it.
    const pad = limit - Buffer.byteLength(directory) - "/h.sock".length - 1;
    expect(pad).toBeGreaterThan(0);
    const socketPath = join(directory, "e".repeat(pad), "h.sock");
    expect(Buffer.byteLength(socketPath)).toBeLessThanOrEqual(limit);

    await expect(startNativeTerminalHostServer({
      socketPath,
      host: hostStub(),
    })).rejects.toThrow(/staging socket path exceeds the unix socket path limit/);
  });

  it("should reject a client connect to an over-limit socket path before dialing", async () => {
    const socketPath = `/${"c".repeat(limit + 8)}/host.sock`;
    await expect(NativeTerminalClient.connect(socketPath)).rejects.toThrow(
      /unix socket path limit/,
    );
  });

  it("should compute a short private default socket path", () => {
    expect(defaultNativeTerminalSocketPath({ XDG_RUNTIME_DIR: "/run/user/1000" }))
      .toBe("/run/user/1000/h2a-nt/native-terminal.sock");
    const fallback = defaultNativeTerminalSocketPath({});
    expect(fallback.startsWith(join(tmpdir(), "h2a-nt-"))).toBe(true);
    expect(fallback.endsWith("/native-terminal.sock")).toBe(true);
    expect(Buffer.byteLength(fallback)).toBeLessThanOrEqual(limit);
  });

  // Lot BM: the darwin filesystem lock path. Pure derivation — deterministic
  // on every platform, so it runs in the Linux set too.
  it("should derive a filesystem lock path per socket without abstract addresses", () => {
    const first = darwinSocketPublicationLockPath("/run/user/1000/h2a-nt/native-terminal.sock", "secret");
    expect(first.startsWith("/run/user/1000/h2a-nt/")).toBe(true);
    expect(first.endsWith(".sock")).toBe(true);
    expect(first.includes("\0")).toBe(false);
    expect(darwinSocketPublicationLockPath("/run/user/1000/h2a-nt/native-terminal.sock", "secret")).toBe(first);
    expect(darwinSocketPublicationLockPath("/run/user/1000/h2a-nt/native-terminal.lf1.sock", "secret")).not.toBe(first);
    expect(darwinSocketPublicationLockPath("/run/user/1000/h2a-nt/native-terminal.sock", "other")).not.toBe(first);
    expect(Buffer.byteLength(first)).toBeLessThanOrEqual(103);
  });

  it("should refuse coded when the darwin lock path exceeds the socket budget", () => {
    const deep = `/${"d".repeat(200)}/native-terminal.sock`;
    expect(() => darwinSocketPublicationLockPath(deep, "secret")).toThrowError(
      expect.objectContaining({ code: "H2A_PUBLICATION_LOCK_PATH_UNUSABLE", exitCode: 3 }),
    );
  });
});
