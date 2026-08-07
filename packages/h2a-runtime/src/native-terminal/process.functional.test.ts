import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, readlink, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

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

async function eventually<T>(read: () => Promise<T> | T, accept: (value: T) => boolean): Promise<T> {
  let last: T | undefined;
  for (let attempt = 0; attempt < 200; attempt += 1) {
    last = await read();
    if (accept(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`condition did not become true; last value: ${JSON.stringify(last)}`);
}

function running(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function directChildren(pid: number): Promise<number[]> {
  const raw = await readFile(`/proc/${pid}/task/${pid}/children`, "utf8");
  return raw.trim().length === 0 ? [] : raw.trim().split(/\s+/).map(Number);
}

describe.skipIf(process.platform !== "linux")("native terminal host process", () => {
  it("should keep two real PTYs alive through client reconnect without per-operation Node spawns", async () => {
    const directory = await mkdtemp(join(tmpdir(), "h2a-native-terminal-functional-"));
    directories.add(directory);
    const socketPath = join(directory, "host.sock");
    const entry = fileURLToPath(new URL("./process.ts", import.meta.url));
    let spawnCount = 0;
    const spawnHost: NativeTerminalHostSpawn = (options) => {
      spawnCount += 1;
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
      replayBytesPerSession: 1024 * 1024,
      spawnHost,
      generationFactory: () => "functional-generation",
    });

    const [first, concurrent] = await Promise.all([supervisor.client(), supervisor.client()]);
    expect(concurrent).toBe(first);
    const ping = await first.ping();
    expect(spawnCount).toBe(1);
    expect(ping).toMatchObject({ generation: "functional-generation", protocolVersion: 1 });

    const shell = (id: string) => ({
      id,
      command: "/bin/sh",
      args: ["-c", `printf '${id}-ready\\r\\n'; while IFS= read -r line; do printf '${id}:%s\\r\\n' \"$line\"; done`],
      cwd: directory,
      env: { PATH: process.env.PATH ?? "/usr/bin:/bin", TERM: "xterm-256color" },
      cols: 80,
      rows: 24,
    });
    const alpha = await first.create(shell("alpha"));
    const beta = await first.create(shell("beta"));
    expect(alpha.pid).not.toBe(beta.pid);
    expect(alpha.pid).toBeGreaterThan(1);
    expect(beta.pid).toBeGreaterThan(1);

    await eventually(() => first.readOutput("alpha", 0), (output) => output.chunks.some((chunk) => chunk.data.includes("alpha-ready")));
    await eventually(() => first.readOutput("beta", 0), (output) => output.chunks.some((chunk) => chunk.data.includes("beta-ready")));
    const alphaLease = await first.acquireController("alpha", "functional-client");
    await first.write(alphaLease, "hello-alpha\r");
    await eventually(() => first.readOutput("alpha", 0), (output) => output.chunks.some((chunk) => chunk.data.includes("alpha:hello-alpha")));

    const nodeChildrenBefore = await directChildren(ping.hostPid);
    expect(nodeChildrenBefore.sort((left, right) => left - right)).toEqual([alpha.pid, beta.pid].sort((left, right) => left - right));
    for (const pid of nodeChildrenBefore) {
      const executable = basename(await readlink(`/proc/${pid}/exe`));
      expect(executable.startsWith("node")).toBe(false);
    }

    supervisor.disconnect();
    const reconnected = await supervisor.client();
    expect(spawnCount).toBe(1);
    expect((await reconnected.ping()).hostPid).toBe(ping.hostPid);
    expect(await reconnected.list()).toEqual([
      expect.objectContaining({ id: "alpha", pid: alpha.pid, status: "running" }),
      expect.objectContaining({ id: "beta", pid: beta.pid, status: "running" }),
    ]);
    const replacementLease = await reconnected.acquireController("alpha", "reconnected-client");
    await reconnected.releaseController(replacementLease);

    expect(await reconnected.stop("alpha", "SIGTERM")).toMatchObject({ status: "stopping" });
    await eventually(() => reconnected.state("alpha"), (state) => state.status === "exited");
    expect((await reconnected.state("beta")).status).toBe("running");
    const betaLease = await reconnected.acquireController("beta", "beta-client");
    await reconnected.write(betaLease, "still-alive\r");
    await eventually(() => reconnected.readOutput("beta", 0), (output) => output.chunks.some((chunk) => chunk.data.includes("beta:still-alive")));
    expect(spawnCount).toBe(1);

    const hostProcess = [...children][0]!;
    hostProcess.kill("SIGKILL");
    await once(hostProcess, "exit");
    await expect(reconnected.list()).rejects.toThrow(/closed|client/i);
    await eventually(() => running(beta.pid), (alive) => !alive);
    expect(running(ping.hostPid)).toBe(false);
  });

  it("should stop its PTYs and remove its socket on graceful host shutdown", async () => {
    const directory = await mkdtemp(join(tmpdir(), "h2a-native-terminal-shutdown-"));
    directories.add(directory);
    const socketPath = join(directory, "host.sock");
    const entry = fileURLToPath(new URL("./process.ts", import.meta.url));
    let child: ChildProcess | undefined;
    const supervisor = new NativeTerminalHostSupervisor({
      socketPath,
      replayBytesPerSession: 1024,
      generationFactory: (() => {
        const generations = ["shutdown-generation", "restart-generation"];
        return () => generations.shift() ?? `unexpected-${generations.length}`;
      })(),
      spawnHost: (options) => {
        child = spawn(process.execPath, [
          "--import",
          "tsx",
          entry,
          "--socket",
          options.socketPath,
          "--generation",
          options.generation,
          "--replay-bytes",
          String(options.replayBytesPerSession),
        ], { cwd: dirname(entry), env: process.env, stdio: ["ignore", "pipe", "pipe"] });
        children.add(child);
        return child;
      },
    });
    const client = await supervisor.client();
    const session = await client.create({
      id: "graceful",
      command: "/bin/sh",
      args: ["-c", "trap '' HUP TERM INT; printf stubborn-ready; while :; do :; done"],
      cwd: directory,
      env: { PATH: process.env.PATH ?? "/usr/bin:/bin", TERM: "xterm-256color" },
      cols: 80,
      rows: 24,
    });
    expect(child?.pid).toBe((await client.ping()).hostPid);
    await eventually(
      () => client.readOutput("graceful", 0),
      (output) => output.chunks.some((chunk) => chunk.data.includes("stubborn-ready")),
    );

    const stoppedHostPid = child!.pid!;
    child!.kill("SIGTERM");
    const [code, signal] = await once(child!, "exit") as [number | null, NodeJS.Signals | null];
    expect({ code, signal }).toEqual({ code: 0, signal: null });
    await eventually(() => running(session.pid), (alive) => !alive);
    await eventually(
      () => stat(socketPath).then(() => true, (error: NodeJS.ErrnoException) => error.code !== "ENOENT"),
      (exists) => !exists,
    );
    const restarted = await supervisor.client();
    expect(supervisor.spawnedPid).not.toBe(stoppedHostPid);
    expect(await restarted.ping()).toMatchObject({ generation: "restart-generation" });
  });

  it("should converge competing supervisors on one socket without repeated host spawns", async () => {
    const directory = await mkdtemp(join(tmpdir(), "h2a-native-terminal-race-"));
    directories.add(directory);
    const socketPath = join(directory, "host.sock");
    const entry = fileURLToPath(new URL("./process.ts", import.meta.url));
    let spawnCount = 0;
    const spawnHost: NativeTerminalHostSpawn = (options) => {
      spawnCount += 1;
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
      ], { cwd: dirname(entry), env: process.env, stdio: ["ignore", "pipe", "pipe"] });
      children.add(child);
      return child;
    };
    const firstSupervisor = new NativeTerminalHostSupervisor({
      socketPath,
      replayBytesPerSession: 1024,
      spawnHost,
      generationFactory: () => "race-first",
    });
    const secondSupervisor = new NativeTerminalHostSupervisor({
      socketPath,
      replayBytesPerSession: 1024,
      spawnHost,
      generationFactory: () => "race-second",
    });

    const [first, second] = await Promise.all([
      firstSupervisor.client(),
      secondSupervisor.client(),
    ]);
    const [firstPing, secondPing] = await Promise.all([first.ping(), second.ping()]);
    expect(firstPing.hostPid).toBe(secondPing.hostPid);
    expect(spawnCount).toBe(2);
    await eventually(
      () => [...children].filter((child) => child.exitCode === null && child.signalCode === null).length,
      (alive) => alive === 1,
    );

    firstSupervisor.disconnect();
    secondSupervisor.disconnect();
    const [reconnectedFirst, reconnectedSecond] = await Promise.all([
      firstSupervisor.client(),
      secondSupervisor.client(),
    ]);
    expect((await reconnectedFirst.ping()).hostPid).toBe(firstPing.hostPid);
    expect((await reconnectedSecond.ping()).hostPid).toBe(firstPing.hostPid);
    expect(spawnCount).toBe(2);
  });
});
