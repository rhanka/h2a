import { chmod, mkdtemp, rm, stat, unlink } from "node:fs/promises";
import { createServer, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { PtyHandle, PtySpawner } from "../pty.js";
import { NativeTerminalClient } from "./client.js";
import { NativeTerminalHost } from "./host.js";
import type { NativeTerminalStopSignal } from "./protocol.js";
import { startNativeTerminalHostServer, type NativeTerminalHostServer } from "./server.js";

class StubPty implements PtyHandle {
  static #nextPid = 51000;
  readonly pid = StubPty.#nextPid++;
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

async function service(): Promise<{
  socketPath: string;
  server: NativeTerminalHostServer;
  client: NativeTerminalClient;
  ptys: Map<string, StubPty>;
}> {
  const directory = await mkdtemp(join(tmpdir(), "h2a-native-terminal-unit-"));
  const socketPath = join(directory, "host.sock");
  const ptys = new Map<string, StubPty>();
  const spawner: PtySpawner = (options) => {
    const pty = new StubPty();
    ptys.set(options.command, pty);
    return pty;
  };
  const host = new NativeTerminalHost({
    generation: "unit-generation",
    replayBytesPerSession: 1024,
    spawner,
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
  const directory = await mkdtemp(join(tmpdir(), "h2a-native-terminal-malformed-"));
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

describe("native terminal local transport", () => {
  it("should reject a shared socket directory without changing its permissions", async () => {
    const directory = await mkdtemp(join(tmpdir(), "h2a-native-terminal-shared-"));
    cleanup.push(() => rm(directory, { recursive: true, force: true }));
    await chmod(directory, 0o755);
    const host = new NativeTerminalHost({
      generation: "permission-generation",
      replayBytesPerSession: 1024,
      spawner: () => new StubPty(),
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
    const directory = await mkdtemp(join(tmpdir(), "h2a-native-terminal-timeout-"));
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
    const directory = await mkdtemp(join(tmpdir(), "h2a-native-terminal-replace-"));
    cleanup.push(() => rm(directory, { recursive: true, force: true }));
    const socketPath = join(directory, "host.sock");
    const spawner: PtySpawner = () => new StubPty();
    const first = await startNativeTerminalHostServer({
      socketPath,
      host: new NativeTerminalHost({
        generation: "first-generation",
        replayBytesPerSession: 1024,
        spawner,
      }),
    });
    await unlink(socketPath);
    const second = await startNativeTerminalHostServer({
      socketPath,
      host: new NativeTerminalHost({
        generation: "second-generation",
        replayBytesPerSession: 1024,
        spawner,
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
});
