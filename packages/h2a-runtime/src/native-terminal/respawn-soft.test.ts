import { createServer, type Server } from "node:net";
import { chmodSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";
// @ts-ignore Shared JS qualification helper; never shipped in the runtime.
import { createPrivateTestDirectory, setupNativeTestEnvironment } from "../../../h2a/test/helpers/native-isolation.js";
import type { PtyHandle, PtySpawner } from "../pty.js";
import { NativeTerminalClient } from "./client.js";
import { NativeTerminalHost } from "./host.js";
import { NATIVE_TERMINAL_PROTOCOL_VERSION, NativeTerminalRemoteError } from "./protocol.js";
import { startNativeTerminalHostServer } from "./server.js";

setupNativeTestEnvironment(afterAll);

const directories: string[] = [];
const cleanups: Array<() => Promise<void> | void> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    await cleanup();
  }
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

type FakePty = PtyHandle & {
  readonly options: Parameters<PtySpawner>[0];
  readonly signals: Array<string | undefined>;
  readonly writes: string[];
  readonly resizes: Array<{ cols: number; rows: number }>;
  emitData(chunk: string): void;
  emitExit(exitCode: number, signal?: number): void;
};

function createFakeSpawner(behavior: {
  autoExitOnSignal?: (pty: FakePty, signal?: string) => boolean;
} = {}) {
  let nextPid = 81_000;
  const spawned: FakePty[] = [];
  const spawner: PtySpawner = (options) => {
    const pid = nextPid++;
    const dataHandlers = new Set<(chunk: string) => void>();
    const exitHandlers = new Set<(event: { exitCode: number; signal?: number }) => void>();
    let exited = false;
    const pty: FakePty = {
      pid,
      pgid: pid,
      cols: options.cols,
      rows: options.rows,
      options,
      signals: [],
      writes: [],
      resizes: [],
      write(data) {
        pty.writes.push(data);
      },
      resize(cols, rows) {
        pty.resizes.push({ cols, rows });
      },
      kill(signal) {
        pty.signals.push(signal);
        const shouldExit = behavior.autoExitOnSignal
          ? behavior.autoExitOnSignal(pty, signal)
          : true;
        if (shouldExit) {
          queueMicrotask(() => pty.emitExit(0, signal === "SIGKILL" ? 9 : 15));
        }
      },
      onData(handler) {
        dataHandlers.add(handler);
        return { dispose: () => dataHandlers.delete(handler) };
      },
      onExit(handler) {
        exitHandlers.add(handler);
        return { dispose: () => exitHandlers.delete(handler) };
      },
      emitData(chunk) {
        for (const handler of [...dataHandlers]) handler(chunk);
      },
      emitExit(exitCode, signal) {
        if (exited) return;
        exited = true;
        const event = signal === undefined ? { exitCode } : { exitCode, signal };
        for (const handler of [...exitHandlers]) handler(event);
      },
    };
    spawned.push(pty);
    return pty;
  };
  return { spawner, spawned };
}

function makeRegistry(directory: string): string {
  const registryPath = join(directory, "registry.json");
  writeFileSync(registryPath, JSON.stringify({ version: 1, entries: [] }));
  return registryPath;
}

describe("native terminal soft respawn (respawnIfIncarnation)", () => {
  it("preserves PTY identity, scrollback, live dimensions, and attached controller while swapping child env", async () => {
    const directory = createPrivateTestDirectory("rs");
    directories.push(directory);
    const { spawner, spawned } = createFakeSpawner();
    const hostOptions = {
      generation: "gen-soft-1",
      replayBytesPerSession: 8192,
      spawner,
      registryPath: makeRegistry(directory),
      readLeaderStartTime: () => 4242,
      readApplicationForeground: (ptyPid: number) => ({
        foregroundProcessGroup: ptyPid,
        application: { pid: ptyPid + 100, birth: String(ptyPid), state: "S", processGroup: ptyPid },
      }),
    };
    const host = new NativeTerminalHost(hostOptions);

    const initial = host.create({
      id: "h2a-alpha",
      command: "/bin/bash",
      args: ["-lc", "claude --resume conv-alpha"],
      cwd: directory,
      env: { PATH: "/usr/bin", ANTHROPIC_API_KEY: "user-owned-key" },
      cols: 80,
      rows: 24,
    });
    const lease = host.acquireController("h2a-alpha", "attach-1", "human", { pid: 1234, tty: "/dev/pts/9" });
    host.resize(lease, 132, 40);
    spawned[0]!.emitData("before-soft-scrollback\n\x1b[?1049h");

    // Soft respawn with gateway ON env
    const afterOn = await host.respawnIfIncarnation({
      id: "h2a-alpha",
      generation: initial.generation,
      incarnation: initial.incarnation,
      command: "/bin/bash",
      args: ["-lc", "claude --resume conv-alpha"],
      cwd: directory,
      env: {
        PATH: "/usr/bin",
        ANTHROPIC_BASE_URL: "http://127.0.0.1:4321",
        ANTHROPIC_AUTH_TOKEN: "fresh-session-token-1",
      },
    });

    expect(spawned).toHaveLength(2);
    expect(spawned[0]!.signals).toEqual(["SIGTERM"]);
    // PTY identity & controller lease unchanged
    expect(afterOn.id).toBe("h2a-alpha");
    expect(afterOn.generation).toBe(initial.generation);
    expect(afterOn.incarnation).toBe(initial.incarnation);
    expect(afterOn.controlled).toBe(true);
    expect(afterOn.controllerEpoch).toBe(lease.epoch);
    expect(afterOn.status).toBe("running");
    expect(afterOn.pid).toBe(spawned[1]!.pid);
    expect(afterOn.pid).not.toBe(initial.pid);
    expect(initial).toMatchObject({ applicationFacet: "cli", applicationIncarnation: expect.any(String) });
    expect(afterOn).toMatchObject({ applicationFacet: "cli", applicationIncarnation: expect.any(String) });
    expect(Reflect.get(afterOn, "applicationIncarnation")).not.toBe(Reflect.get(initial, "applicationIncarnation"));
    expect(Reflect.get(afterOn, "foregroundRevision")).toBeGreaterThan(Reflect.get(initial, "foregroundRevision"));

    // New child inherited live terminal dimensions and gateway env
    expect(spawned[1]!.options.cols).toBe(132);
    expect(spawned[1]!.options.rows).toBe(40);
    expect(spawned[1]!.options.env["ANTHROPIC_BASE_URL"]).toBe("http://127.0.0.1:4321");
    expect(spawned[1]!.options.env["ANTHROPIC_AUTH_TOKEN"]).toBe("fresh-session-token-1");
    expect(spawned[1]!.options.env["ANTHROPIC_API_KEY"]).toBeUndefined();

    // Existing controller lease still works on the new child without re-acquiring
    host.write(lease, "hello-new-child\r");
    expect(spawned[1]!.writes).toEqual(["hello-new-child\r"]);
    spawned[1]!.emitData("after-gw-on\n");

    // Scrollback kept, alt-screen reset inserted cleanly before new child output
    const replay = host.readOutput("h2a-alpha", 0);
    const fullStream = replay.chunks.map((c) => c.data).join("");
    expect(fullStream).toContain("before-soft-scrollback\n");
    expect(fullStream).toContain("\x1b[?1049l");
    expect(fullStream).toContain("after-gw-on\n");

    // Soft respawn back to gateway OFF: removes gateway env, preserves PTY identity & scrollback
    const afterOff = await host.respawnIfIncarnation({
      id: "h2a-alpha",
      generation: initial.generation,
      incarnation: initial.incarnation,
      command: "/bin/bash",
      args: ["-lc", "claude --resume conv-alpha"],
      cwd: directory,
      env: { PATH: "/usr/bin" },
    });

    expect(spawned).toHaveLength(3);
    expect(afterOff.generation).toBe(initial.generation);
    expect(afterOff.incarnation).toBe(initial.incarnation);
    expect(afterOff.controllerEpoch).toBe(lease.epoch);
    expect(afterOff.pid).toBe(spawned[2]!.pid);
    expect(spawned[2]!.options.env["ANTHROPIC_BASE_URL"]).toBeUndefined();
    expect(spawned[2]!.options.env["ANTHROPIC_AUTH_TOKEN"]).toBeUndefined();
  });

  it("LH-04 defers resize during soft respawn until child adoption and keeps holder identity", async () => {
    const directory = createPrivateTestDirectory("r4");
    directories.push(directory);
    const { spawner, spawned } = createFakeSpawner({
      autoExitOnSignal: () => false,
    });
    const host = new NativeTerminalHost({
      generation: "gen-lh04-respawn",
      replayBytesPerSession: 4096,
      spawner,
      registryPath: makeRegistry(directory),
      readLeaderStartTime: () => 4242,
    });

    const created = host.create({
      id: "h2a-lh04",
      command: "/bin/bash",
      args: [],
      cwd: directory,
      env: { PATH: "/usr/bin" },
      cols: 80,
      rows: 24,
    });
    const lease = host.acquireController("h2a-lh04", "attach-lh04-secret", "human", {
      pid: 2222,
      tty: "/dev/pts/3",
    });
    host.resize(lease, 120, 41);
    const before = host.state("h2a-lh04");
    expect(before.cols).toBe(120);
    expect(before.rows).toBe(41);
    expect(before.lastLocalSize).toEqual({ cols: 120, rows: 41 });
    expect(before.holderKind).toBe("human");
    expect(typeof before.controller?.controllerId).toBe("string");
    expect(spawned[0]!.resizes).toEqual([{ cols: 120, rows: 41 }]);

    const respawnPromise = host.respawnIfIncarnation({
      id: "h2a-lh04",
      generation: created.generation,
      incarnation: created.incarnation,
      command: "/bin/bash",
      args: [],
      cwd: directory,
      env: { PATH: "/usr/bin", RESPAWNED: "1" },
      timeoutMs: 2_000,
    });

    // Resize requested while the old child has not yet exited.
    host.resize(lease, 132, 45);
    const during = host.state("h2a-lh04");
    expect(during.cols).toBe(120);
    expect(during.rows).toBe(41);
    expect(during.lastLocalSize).toEqual({ cols: 120, rows: 41 });
    expect(spawned[0]!.resizes).toEqual([{ cols: 120, rows: 41 }]);

    spawned[0]!.emitExit(0, 15);
    const after = await respawnPromise;

    expect(spawned).toHaveLength(2);
    expect(spawned[1]!.options.cols).toBe(132);
    expect(spawned[1]!.options.rows).toBe(45);
    expect(after.cols).toBe(132);
    expect(after.rows).toBe(45);
    expect(after.lastLocalSize).toEqual({ cols: 132, rows: 45 });
    expect(after.holderKind).toBe("human");
    expect(after.controller?.controllerId).toBe(before.controller?.controllerId);
    expect(after.controller?.since).toBe(before.controller?.since);
    const observed = host.state("h2a-lh04");
    expect(observed.cols).toBe(132);
    expect(observed.rows).toBe(45);
    expect(observed.lastLocalSize).toEqual({ cols: 132, rows: 45 });
    expect(observed.holderKind).toBe("human");
    expect(observed.controller?.controllerId).toBe(before.controller?.controllerId);
  });

  it("LH-04 applies pending resize once to surviving child on timeout and preserves confirmed sizes if survivor resize throws", async () => {
    const directory = createPrivateTestDirectory("r5");
    directories.push(directory);
    const { spawner, spawned } = createFakeSpawner({
      autoExitOnSignal: () => false,
    });
    const host = new NativeTerminalHost({
      generation: "gen-lh04-survivor",
      replayBytesPerSession: 4096,
      spawner,
      registryPath: makeRegistry(directory),
      readLeaderStartTime: () => 4242,
    });

    const created = host.create({
      id: "h2a-survivor",
      command: "/bin/bash",
      args: [],
      cwd: directory,
      env: {},
      cols: 80,
      rows: 24,
    });
    const lease = host.acquireController("h2a-survivor", "attach-survivor", "human");
    host.resize(lease, 120, 41);

    const firstAttempt = host.respawnIfIncarnation({
      id: "h2a-survivor",
      generation: created.generation,
      incarnation: created.incarnation,
      command: "/bin/bash",
      args: [],
      cwd: directory,
      env: {},
      timeoutMs: 30,
    });
    host.resize(lease, 132, 45);
    await expect(firstAttempt).rejects.toThrow(/did not exit during soft respawn/);

    expect(spawned).toHaveLength(1);
    expect(spawned[0]!.resizes).toEqual([
      { cols: 120, rows: 41 },
      { cols: 132, rows: 45 },
    ]);
    const afterSurvivorApply = host.state("h2a-survivor");
    expect(afterSurvivorApply.cols).toBe(132);
    expect(afterSurvivorApply.rows).toBe(45);
    expect(afterSurvivorApply.lastLocalSize).toEqual({ cols: 132, rows: 45 });

    // Second attempt: survivor's resize also throws -> confirmed sizes stay at 132x45 and error surfaces both failures.
    spawned[0]!.resize = () => {
      throw new Error("survivor ioctl failed");
    };
    const secondAttempt = host.respawnIfIncarnation({
      id: "h2a-survivor",
      generation: created.generation,
      incarnation: created.incarnation,
      command: "/bin/bash",
      args: [],
      cwd: directory,
      env: {},
      timeoutMs: 30,
    });
    host.resize(lease, 150, 55);
    await expect(secondAttempt).rejects.toThrow(/did not exit during soft respawn.*survivor ioctl failed/);

    const afterSurvivorThrow = host.state("h2a-survivor");
    expect(afterSurvivorThrow.cols).toBe(132);
    expect(afterSurvivorThrow.rows).toBe(45);
    expect(afterSurvivorThrow.lastLocalSize).toEqual({ cols: 132, rows: 45 });
    expect(afterSurvivorThrow.holderKind).toBe("human");
  });

  it("LH-04 abandons pending resize and preserves confirmed sizes in terminal state when replacement spawn fails", async () => {
    const directory = createPrivateTestDirectory("r6");
    directories.push(directory);
    const { spawner: baseSpawner, spawned } = createFakeSpawner({
      autoExitOnSignal: () => false,
    });
    let calls = 0;
    const spawner: PtySpawner = (options) => {
      calls += 1;
      if (calls === 2) throw new Error("spawn replacement failed");
      return baseSpawner(options);
    };
    const host = new NativeTerminalHost({
      generation: "gen-lh04-spawn-fail",
      replayBytesPerSession: 4096,
      spawner,
      registryPath: makeRegistry(directory),
      readLeaderStartTime: () => 4242,
    });

    const created = host.create({
      id: "h2a-spawn-fail",
      command: "/bin/bash",
      args: [],
      cwd: directory,
      env: {},
      cols: 80,
      rows: 24,
    });
    const lease = host.acquireController("h2a-spawn-fail", "attach-spawn-fail", "human");
    host.resize(lease, 120, 41);

    const respawnPromise = host.respawnIfIncarnation({
      id: "h2a-spawn-fail",
      generation: created.generation,
      incarnation: created.incarnation,
      command: "/bin/bash",
      args: [],
      cwd: directory,
      env: {},
      timeoutMs: 2_000,
    });
    host.resize(lease, 140, 50);
    spawned[0]!.emitExit(0, 15);
    await expect(respawnPromise).rejects.toThrow(/failed to spawn replacement child/);

    const terminal = host.state("h2a-spawn-fail");
    expect(terminal.status).toBe("exited");
    expect(terminal.controlled).toBe(false);
    expect(terminal.holderKind).toBe("none");
    expect(terminal.controller).toBeNull();
    expect(terminal.cols).toBe(120);
    expect(terminal.rows).toBe(41);
    expect(terminal.lastLocalSize).toEqual({ cols: 120, rows: 41 });
  });

  it("fences respawnIfIncarnation on generation and incarnation without touching the live child", async () => {
    const directory = createPrivateTestDirectory("rf");
    directories.push(directory);
    const { spawner, spawned } = createFakeSpawner();
    const host = new NativeTerminalHost({
      generation: "gen-fence",
      replayBytesPerSession: 4096,
      spawner,
      registryPath: makeRegistry(directory),
      readLeaderStartTime: () => 4242,
    });

    const created = host.create({
      id: "h2a-fenced",
      command: "/bin/bash",
      args: [],
      cwd: directory,
      env: {},
      cols: 80,
      rows: 24,
    });

    await expect(
      host.respawnIfIncarnation({
        id: "h2a-fenced",
        generation: "wrong-gen",
        incarnation: created.incarnation,
        command: "/bin/bash",
        args: [],
        cwd: directory,
        env: {},
      }),
    ).rejects.toThrow(/stale terminal host generation/);

    await expect(
      host.respawnIfIncarnation({
        id: "h2a-fenced",
        generation: created.generation,
        incarnation: "wrong-incarnation",
        command: "/bin/bash",
        args: [],
        cwd: directory,
        env: {},
      }),
    ).rejects.toThrow(/stale terminal session incarnation/);

    expect(spawned).toHaveLength(1);
    expect(spawned[0]!.signals).toEqual([]);
    expect(host.state("h2a-fenced").status).toBe("running");
  });

  it("escalates to SIGKILL when the old child ignores SIGTERM and still spawns the replacement", async () => {
    const directory = createPrivateTestDirectory("re");
    directories.push(directory);
    const { spawner, spawned } = createFakeSpawner({
      autoExitOnSignal: (_pty, signal) => signal === "SIGKILL",
    });
    const host = new NativeTerminalHost({
      generation: "gen-escalate",
      replayBytesPerSession: 4096,
      spawner,
      registryPath: makeRegistry(directory),
      readLeaderStartTime: () => 4242,
    });

    const created = host.create({
      id: "h2a-stubborn",
      command: "/bin/bash",
      args: [],
      cwd: directory,
      env: {},
      cols: 80,
      rows: 24,
    });

    const respawned = await host.respawnIfIncarnation({
      id: "h2a-stubborn",
      generation: created.generation,
      incarnation: created.incarnation,
      command: "/bin/bash",
      args: [],
      cwd: directory,
      env: { AFTER: "1" },
      timeoutMs: 60,
    });

    expect(spawned).toHaveLength(2);
    expect(spawned[0]!.signals).toEqual(["SIGTERM", "SIGKILL"]);
    expect(respawned.incarnation).toBe(created.incarnation);
    expect(respawned.pid).toBe(spawned[1]!.pid);
    expect(respawned.status).toBe("running");
  });

  it("exposes softRespawn capability in ping and executes respawn-if-incarnation over the Unix socket", async () => {
    const directory = createPrivateTestDirectory("ru");
    directories.push(directory);
    const socketPath = join(directory, "host.sock");
    const { spawner, spawned } = createFakeSpawner();
    const host = new NativeTerminalHost({
      generation: "gen-sock",
      replayBytesPerSession: 4096,
      spawner,
      socketPath,
      registryPath: makeRegistry(directory),
      readLeaderStartTime: () => 4242,
    });
    const server = await startNativeTerminalHostServer({ socketPath, host });
    cleanups.push(() => server.close());

    const attachClient = await NativeTerminalClient.connect(socketPath);
    cleanups.push(() => attachClient.close());
    const controlClient = await NativeTerminalClient.connect(socketPath);
    cleanups.push(() => controlClient.close());

    const ping = await controlClient.ping();
    expect(ping.softRespawn).toBe(true);

    const created = await controlClient.create({
      id: "h2a-sock",
      command: "/bin/bash",
      args: ["-lc", "claude"],
      cwd: directory,
      env: {},
      cols: 100,
      rows: 30,
    });
    const lease = await attachClient.acquireController("h2a-sock", "win-1", "human");
    spawned[0]!.emitData("initial-window-output\n");

    const after = await controlClient.respawnIfIncarnation({
      id: "h2a-sock",
      generation: created.generation,
      incarnation: created.incarnation,
      command: "/bin/bash",
      args: ["-lc", "claude --resume conv-1"],
      cwd: directory,
      env: { ANTHROPIC_BASE_URL: "http://127.0.0.1:9999", ANTHROPIC_AUTH_TOKEN: "tok-sock" },
    });

    expect(after.generation).toBe(created.generation);
    expect(after.incarnation).toBe(created.incarnation);
    expect(after.controllerEpoch).toBe(lease.epoch);
    expect(after.pid).not.toBe(created.pid);

    spawned[1]!.emitData("post-respawn-output\n");
    const replay = await attachClient.readOutput("h2a-sock", 0);
    const text = replay.chunks.map((c) => c.data).join("");
    expect(text).toContain("initial-window-output\n");
    expect(text).toContain("post-respawn-output\n");
    // Attached window keeps writing on the same socket and lease
    await attachClient.write(lease, "ping\r");
    expect(spawned[1]!.writes).toEqual(["ping\r"]);
  });

  it("detects an old host without softRespawn capability on ping and unknown operation", async () => {
    const directory = createPrivateTestDirectory("ro");
    directories.push(directory);
    const socketPath = join(directory, "old-host.sock");

    const oldServer: Server = createServer((socket) => {
      socket.setEncoding("utf8");
      let buf = "";
      socket.on("data", (chunk: string) => {
        buf += chunk;
        for (;;) {
          const idx = buf.indexOf("\n");
          if (idx < 0) break;
          const line = buf.slice(0, idx);
          buf = buf.slice(idx + 1);
          if (!line) continue;
          const req = JSON.parse(line) as { id: string; operation: string };
          if (req.operation === "ping") {
            socket.write(`${JSON.stringify({
              version: NATIVE_TERMINAL_PROTOCOL_VERSION,
              id: req.id,
              ok: true,
              result: { generation: "legacy-gen", hostPid: process.pid, protocolVersion: 1, launchFence: true },
            })}\n`);
          } else {
            socket.write(`${JSON.stringify({
              version: NATIVE_TERMINAL_PROTOCOL_VERSION,
              id: req.id,
              ok: false,
              error: { code: "invalid-request", message: "unknown terminal operation" },
            })}\n`);
          }
        }
      });
    });
    await new Promise<void>((resolve, reject) => {
      oldServer.once("error", reject);
      oldServer.listen(socketPath, () => resolve());
    });
    chmodSync(socketPath, 0o600);
    cleanups.push(() => new Promise<void>((resolve) => oldServer.close(() => resolve())));

    const client = await NativeTerminalClient.connect(socketPath);
    cleanups.push(() => client.close());

    const ping = await client.ping();
    expect(ping.softRespawn).not.toBe(true);
    await expect(
      client.respawnIfIncarnation({
        id: "h2a-old",
        generation: "legacy-gen",
        incarnation: "inc-1",
        command: "/bin/bash",
        args: [],
        cwd: directory,
        env: {},
      }),
    ).rejects.toThrow(NativeTerminalRemoteError);
  });

  it("LH-05 restores pending local size during soft respawn on remote release and takeover", async () => {
    const directory = createPrivateTestDirectory("rs-lh05");
    directories.push(directory);
    let resolveGate!: () => void;
    const gate = new Promise<void>((resolve) => { resolveGate = resolve; });
    const { spawner, spawned } = createFakeSpawner({
      autoExitOnSignal: () => false,
    });
    const host = new NativeTerminalHost({
      generation: "gen-soft-lh05",
      replayBytesPerSession: 8192,
      spawner,
      registryPath: makeRegistry(directory),
      readLeaderStartTime: () => 4242,
    });
    const initial = host.create({
      id: "h2a-alpha",
      command: "/bin/bash",
      args: [],
      cwd: directory,
      env: {},
      cols: 80,
      rows: 24,
    });
    const h = host.acquireController("h2a-alpha", "human-1", "human");
    host.resize(h, 120, 41);
    host.releaseController(h);

    const respawnPromise = host.respawnIfIncarnation({
      id: "h2a-alpha",
      generation: initial.generation,
      incarnation: initial.incarnation,
      command: "/bin/bash",
      args: [],
      cwd: directory,
      env: {},
    });
    const r1 = host.acquireRemoteControllerIfNoRecentHuman("h2a-alpha", "h2a-remote:1", 0);
    if (!r1.granted) throw new Error("expected grant");
    host.resize(r1.lease, 132, 45);
    host.releaseController(r1.lease);

    // Human resizes during respawn, then remote resizes, then human takeover
    const h2 = host.acquireController("h2a-alpha", "human-2", "human");
    host.resize(h2, 100, 30);
    const r2 = host.acquireRemoteControllerIfNoRecentHuman("h2a-alpha", "h2a-remote:2", 0);
    if (!r2.granted) throw new Error("expected grant");
    host.resize(r2.lease, 132, 45);
    host.acquireController("h2a-alpha", "human-3", "human", { takeover: true });

    await Promise.resolve();
    spawned[0]!.emitExit(0, 15);
    void gate;
    resolveGate();
    const afterRespawn = await respawnPromise;
    expect(spawned[1]!.options.cols).toBe(100);
    expect(spawned[1]!.options.rows).toBe(30);
    expect(afterRespawn.lastLocalSize).toEqual({ cols: 100, rows: 30 });
  });
});
