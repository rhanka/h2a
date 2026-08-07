import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { chmod, mkdtemp, readFile, readlink, rm, stat } from "node:fs/promises";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { NativeTerminalClient } from "./client.js";
import { NativeTerminalHostSupervisor, type NativeTerminalHostSpawn } from "./supervisor.js";
import { NATIVE_TERMINAL_MAX_FRAME_BYTES } from "./protocol.js";

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

    const stopLease = await reconnected.acquireController(
      "alpha",
      "alpha-stopper",
    );
    expect(await reconnected.stop(stopLease, "SIGTERM")).toMatchObject({
      status: "stopping",
    });
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

  it("should let the owning controller escalate a real stubborn PTY from TERM to KILL", async () => {
    const directory = await mkdtemp(join(tmpdir(), "h2a-native-terminal-escalate-"));
    directories.add(directory);
    const socketPath = join(directory, "host.sock");
    const entry = fileURLToPath(new URL("./process.ts", import.meta.url));
    const supervisor = new NativeTerminalHostSupervisor({
      socketPath,
      replayBytesPerSession: 1024,
      generationFactory: () => "escalation-generation",
      spawnHost: (options) => {
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
      },
    });
    const client = await supervisor.client();
    const session = await client.create({
      id: "stubborn",
      command: "/bin/sh",
      args: ["-c", "trap '' HUP TERM INT; printf stubborn-ready; while :; do :; done"],
      cwd: directory,
      env: { PATH: process.env.PATH ?? "/usr/bin:/bin", TERM: "xterm-256color" },
      cols: 80,
      rows: 24,
    });
    await eventually(
      () => client.readOutput("stubborn", 0),
      (output) => output.chunks.some((chunk) => chunk.data.includes("stubborn-ready")),
    );
    const lease = await client.acquireController("stubborn", "stop-owner");
    expect(await client.stop(lease, "SIGTERM")).toMatchObject({
      status: "stopping",
      stopSignal: "SIGTERM",
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(running(session.pid)).toBe(true);
    expect(await client.stop(lease, "SIGKILL")).toMatchObject({
      status: "stopping",
      stopSignal: "SIGKILL",
    });
    await eventually(() => running(session.pid), (alive) => !alive);
    const exited = await eventually(
      () => client.state("stubborn"),
      (state) => state.status === "exited",
    );
    expect(exited).toMatchObject({
      status: "exited",
    });
  });

  it("should keep the shared host and an existing real PTY alive after an exact-limit invalid request", async () => {
    const directory = await mkdtemp(join(tmpdir(), "h2a-native-terminal-frame-limit-"));
    directories.add(directory);
    const socketPath = join(directory, "host.sock");
    const entry = fileURLToPath(new URL("./process.ts", import.meta.url));
    let hostProcess: ChildProcess | undefined;
    const supervisor = new NativeTerminalHostSupervisor({
      socketPath,
      replayBytesPerSession: 1024,
      generationFactory: () => "frame-limit-generation",
      spawnHost: (options) => {
        hostProcess = spawn(process.execPath, [
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
        children.add(hostProcess);
        return hostProcess;
      },
    });
    const client = await supervisor.client();
    const ping = await client.ping();
    await client.create({
      id: "survivor",
      command: "/bin/sh",
      args: ["-c", "printf survivor-ready\\r\\n; while IFS= read -r line; do printf 'survivor:%s\\r\\n' \"$line\"; done"],
      cwd: directory,
      env: { PATH: process.env.PATH ?? "/usr/bin:/bin", TERM: "xterm-256color" },
      cols: 80,
      rows: 24,
    });
    await eventually(
      () => client.readOutput("survivor", 0),
      (output) => output.chunks.some((chunk) => chunk.data.includes("survivor-ready")),
    );
    const lease = await client.acquireController("survivor", "frame-limit-owner");

    const rawSocket = createConnection(socketPath);
    await new Promise<void>((resolve, reject) => {
      rawSocket.once("connect", resolve);
      rawSocket.once("error", reject);
    });
    rawSocket.setEncoding("utf8");
    let responseBuffer = "";
    const responseLine = new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("exact-limit request response timed out")),
        30_000,
      );
      rawSocket.on("data", (chunk: string) => {
        responseBuffer += chunk;
        const newline = responseBuffer.indexOf("\n");
        if (newline < 0) return;
        clearTimeout(timeout);
        resolve(responseBuffer.slice(0, newline));
      });
      rawSocket.once("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });
    const emptyIdFrame = JSON.stringify({ version: 1, id: "", operation: "ping" });
    const invalidFrame = JSON.stringify({
      version: 1,
      id: "A".repeat(
        NATIVE_TERMINAL_MAX_FRAME_BYTES - Buffer.byteLength(emptyIdFrame),
      ),
      operation: "ping",
    });
    expect(Buffer.byteLength(invalidFrame)).toBe(NATIVE_TERMINAL_MAX_FRAME_BYTES);
    await new Promise<void>((resolve, reject) => {
      rawSocket.write(`${invalidFrame}\n`, (error) => error ? reject(error) : resolve());
    });
    const invalidResponse = JSON.parse(await responseLine) as {
      id: string;
      ok: boolean;
      error: { code: string };
    };
    expect(invalidResponse).toMatchObject({
      id: "invalid",
      ok: false,
      error: { code: "invalid-request" },
    });
    rawSocket.destroy();

    expect(hostProcess?.exitCode).toBeNull();
    expect(hostProcess?.signalCode).toBeNull();
    expect((await client.ping()).hostPid).toBe(ping.hostPid);
    await client.write(lease, "still-alive\r");
    await eventually(
      () => client.readOutput("survivor", 0),
      (output) => output.chunks.some((chunk) => chunk.data.includes("survivor:still-alive")),
    );
  }, 45_000);

  it("should fence an old connection when a real PTY session id is reincarnated", async () => {
    const directory = await mkdtemp(join(tmpdir(), "h2a-native-terminal-reincarnation-"));
    directories.add(directory);
    const socketPath = join(directory, "host.sock");
    const entry = fileURLToPath(new URL("./process.ts", import.meta.url));
    const supervisor = new NativeTerminalHostSupervisor({
      socketPath,
      replayBytesPerSession: 1024,
      generationFactory: () => "reincarnation-generation",
      spawnHost: (options) => {
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
      },
    });
    const staleClient = await supervisor.client();
    const currentClient = await NativeTerminalClient.connect(socketPath);
    const shell = (marker: string) => ({
      id: "recycled",
      command: "/bin/sh",
      args: [
        "-c",
        `printf '${marker}-ready\\r\\n'; while IFS= read -r line; do printf '${marker}:%s\\r\\n' "$line"; done`,
      ],
      cwd: directory,
      env: { PATH: process.env.PATH ?? "/usr/bin:/bin", TERM: "xterm-256color" },
      cols: 80,
      rows: 24,
    });

    const original = await staleClient.create(shell("original"));
    const staleLease = await staleClient.acquireController(
      "recycled",
      "same-controller",
    );
    await staleClient.stop(staleLease, "SIGTERM");
    await eventually(
      () => staleClient.state("recycled"),
      (state) => state.status === "exited",
    );

    const replacement = await currentClient.create(shell("replacement"));
    const currentLease = await currentClient.acquireController(
      "recycled",
      "same-controller",
    );
    expect(replacement.pid).not.toBe(original.pid);
    expect(currentLease).toMatchObject({
      id: staleLease.id,
      generation: staleLease.generation,
      controllerId: staleLease.controllerId,
      epoch: staleLease.epoch,
    });
    expect(currentLease.incarnation).not.toBe(staleLease.incarnation);
    await eventually(
      () => currentClient.readOutput("recycled", 0),
      (output) => output.chunks.some((chunk) => chunk.data.includes("replacement-ready")),
    );

    await expect(staleClient.write(staleLease, "stale-write\r")).rejects.toThrow(
      /stale terminal controller lease/i,
    );
    await expect(staleClient.resize(staleLease, 100, 30)).rejects.toThrow(
      /stale terminal controller lease/i,
    );
    await expect(staleClient.releaseController(staleLease)).rejects.toThrow(
      /stale terminal controller lease/i,
    );
    await expect(staleClient.stop(staleLease, "SIGKILL")).rejects.toThrow(
      /stale terminal controller lease/i,
    );

    expect(running(replacement.pid)).toBe(true);
    await currentClient.write(currentLease, "current-write\r");
    await eventually(
      () => currentClient.readOutput("recycled", 0),
      (output) => output.chunks.some((chunk) => chunk.data.includes("replacement:current-write")),
    );
    await currentClient.stop(currentLease, "SIGTERM");
    await eventually(() => running(replacement.pid), (alive) => !alive);
    currentClient.close();
  });

  it("should back off repeated host startup failures and preserve the diagnostic", async () => {
    const directory = await mkdtemp(join(tmpdir(), "h2a-native-terminal-backoff-"));
    directories.add(directory);
    await chmod(directory, 0o755);
    const socketPath = join(directory, "host.sock");
    const entry = fileURLToPath(new URL("./process.ts", import.meta.url));
    let spawnCount = 0;
    const supervisor = new NativeTerminalHostSupervisor({
      socketPath,
      replayBytesPerSession: 1024,
      generationFactory: () => `failure-generation-${spawnCount + 1}`,
      spawnHost: (options) => {
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
          stdio: ["ignore", "ignore", "pipe"],
        });
        children.add(child);
        return child;
      },
    });

    await expect(supervisor.client()).rejects.toThrow(/mode 0700/i);
    expect(spawnCount).toBe(1);
    await expect(supervisor.client()).rejects.toThrow(/restart backoff active/i);
    expect(spawnCount).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 275));
    await expect(supervisor.client()).rejects.toThrow(/mode 0700/i);
    expect(spawnCount).toBe(2);
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
