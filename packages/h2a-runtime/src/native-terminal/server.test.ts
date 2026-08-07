import { chmod, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { PtyHandle, PtySpawner } from "../pty.js";
import { NativeTerminalClient } from "./client.js";
import { NativeTerminalHost } from "./host.js";
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
    })).rejects.toThrow(/must not be accessible by group or others/i);
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
    expect(ptys.get("alpha")!.write).not.toHaveBeenCalled();
    client.close();

    const replacement = await eventually(
      () => observer.acquireController("alpha", "replacement").then(
        (value) => ({ ok: true as const, value }),
        () => ({ ok: false as const }),
      ),
      (result) => result.ok,
    );
    if (!replacement.ok) throw new Error("replacement lease was not acquired");
    await observer.write(replacement.value, "accepted");
    expect(ptys.get("alpha")!.write).toHaveBeenCalledWith("accepted");
  });
});
