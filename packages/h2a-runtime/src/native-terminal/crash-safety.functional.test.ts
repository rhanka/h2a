import type { ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, unlink } from "node:fs/promises";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, describe, expect, it } from "vitest";
// @ts-ignore Shared JS qualification helper; tests are outside the production build.
import {
  isolatedNativeTestEnvironment,
  createPrivateTestDirectory,
  spawnIsolatedNative as spawn,
  setupNativeTestEnvironment,
} from "../../../h2a/test/helpers/native-isolation.js";

setupNativeTestEnvironment(afterAll);

import { readNativeTerminalPgid } from "../registry.js";
import { NativeTerminalClient } from "./client.js";
import { NATIVE_TERMINAL_MAX_FRAME_BYTES } from "./protocol.js";
import { NativeTerminalHost } from "./host.js";
import { startNativeTerminalHostServer } from "./server.js";

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

type ReadyMessage = {
  kind: "h2a.native-terminal.ready";
  generation: string;
  pid: number;
  socketPath: string;
};

async function spawnReadyHost(options: {
  socketPath: string;
  registryPath: string;
  generation: string;
  faultEntry?: boolean;
}): Promise<{ child: ChildProcess; ready: ReadyMessage; stderr: string }> {
  const entry = fileURLToPath(new URL(options.faultEntry
    ? "../../test/fixtures/listener-fault.ts" : "./process.ts", import.meta.url));
  const child = spawn(process.execPath, [
    "--import",
    "tsx",
    entry,
    "--socket",
    options.socketPath,
    "--generation",
    options.generation,
    "--replay-bytes",
    String(64 * 1024),
    "--registry-path",
    options.registryPath,
  ], {
    cwd: dirname(entry),
    env: process.env,
    stdio: options.faultEntry ? ["ignore", "pipe", "pipe", "ipc"] : ["ignore", "pipe", "pipe"],
  });
  children.add(child);
  let stdout = "";
  let stderr = "";
  child.stdout!.setEncoding("utf8");
  child.stdout!.on("data", (chunk: string) => { stdout += chunk; });
  child.stderr!.setEncoding("utf8");
  child.stderr!.on("data", (chunk: string) => { stderr += chunk; });
  const ready = await eventually(() => {
    const line = stdout.split("\n").find((candidate) => candidate.includes("h2a.native-terminal.ready"));
    if (line === undefined) return undefined;
    try {
      return JSON.parse(line) as ReadyMessage;
    } catch {
      return undefined;
    }
  }, (message) => message !== undefined);
  return { child, ready, stderr };
}

/**
 * The production supervisor spawns the host with `stdio: ["ignore", "ignore",
 * "pipe"]` and never reads stderr; when the supervisor dies, the pipe's read
 * end closes and the host's next log line hits EPIPE. This is the exact
 * reproduced mechanism, probably responsible for the 2026-10-10/11 crash-loop
 * (the incident's error code is redacted; native-host.log: uncaughtException
 * at host.js:590:36 via 1425:26 and 1454:62, exit 1, restart every few
 * seconds all night). The test destroys the read end while the host lives,
 * then lets a session exit so the deferred durable-row prune logs through the
 * dead stream: the host must keep its pid and generation and keep serving.
 */
describe.skipIf(process.platform !== "linux")("native terminal host crash containment", () => {
  it.each([
    { mode: "startup", counter: "process.fatal-write-failed" },
    { mode: "shutdown", counter: "process.shutdown-write-failed" },
  ])("should count an undelivered process $mode diagnostic and exit one", async ({ mode, counter }) => {
    const directory = await mkdtemp(join(tmpdir(), "n-"));
    directories.add(directory);
    const diagnosticsPath = join(directory, "diagnostics.json");
    const entry = fileURLToPath(new URL("../../test/fixtures/process-write-fault.ts", import.meta.url));
    const child = spawn(process.execPath, ["--import", "tsx", entry, mode, diagnosticsPath,
      "--socket", join(directory, "host.sock"), "--registry-path", join(directory, "registry.json")],
    { env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    children.add(child);
    const exited = once(child, "exit");
    if (mode === "shutdown") {
      let stdout = "";
      child.stdout!.setEncoding("utf8");
      child.stdout!.on("data", chunk => { stdout += chunk; });
      await eventually(() => stdout, value => value.includes("h2a.native-terminal.ready"));
      child.kill("SIGTERM");
    }
    expect((await exited)[0]).toBe(1);
    const diagnostics = JSON.parse(await readFile(diagnosticsPath, "utf8")) as {
      faultCounters: Record<string, number>; bufferedLines: string[];
    };
    expect(diagnostics.faultCounters[counter]).toBe(1);
    expect(diagnostics.faultCounters["host-log.stderr-stream-error"]).toBe(1);
    expect(diagnostics.bufferedLines.some(line => line.includes(mode === "startup" ? "fatal:" : "shutdown failed"))).toBe(true);
  });
  it.each(["legacy", "short"])("should attribute a live child through its %s staged socket after pathname and sidecar loss", async (grammar) => {
    const root = createPrivateTestDirectory("g");
    directories.add(root);
    const directory = grammar === "legacy" ? root
      : join(root, "d".repeat(107 - Buffer.byteLength(root) - ".nat.9999999.0123abcd".length - 2));
    if (directory !== root) await mkdir(directory, { mode: 0o700 });
    const socketPath = join(directory, "native-terminal.sock");
    const { child } = await spawnReadyHost({ socketPath, registryPath: join(root, "registry.json"), generation: "lost-path" });
    const client = await NativeTerminalClient.connect(socketPath);
    await client.create({ id: "surviving-child", command: "/bin/cat", args: [], cwd: root,
      env: isolatedNativeTestEnvironment({ PATH: process.env.PATH ?? "/usr/bin:/bin", TERM: "xterm-256color" }), cols: 80, rows: 24 });
    // Only /proc descriptor attribution remains: no pathname, no sidecar,
    // and the contender has no access to the child's separate registry.
    await unlink(socketPath);
    await unlink(`${socketPath}.owner`);
    const contender = new NativeTerminalHost({ generation: "contender", replayBytesPerSession: 1024,
      registryPath: join(root, "contender-registry.json"),
      spawner: () => { throw new Error("contender must never serve a PTY"); } });
    await expect(startNativeTerminalHostServer({ socketPath, host: contender })).rejects.toThrow(/owner death is unproven/);
    expect((await client.ping()).hostPid).toBe(child.pid);
    const lease = await client.acquireController("surviving-child", "healthy");
    await client.write(lease, "still-alive\r");
    await eventually(() => client.readOutput("surviving-child", 0), result => result.chunks.some(chunk => chunk.data.includes("still-alive")));
    const exited = once(child, "exit");
    child.kill("SIGTERM");
    expect((await exited)[0]).toBe(0);
    client.close();
  });
  it("should preserve Node's fatal behavior for an unguarded exception", async () => {
    const directory = await mkdtemp(join(tmpdir(), "n-"));
    directories.add(directory);
    const { child } = await spawnReadyHost({ socketPath: join(directory, "host.sock"),
      registryPath: join(directory, "registry.json"), generation: "unguarded", faultEntry: true });
    const exited = once(child, "exit");
    child.send!({ uncaught: true });
    expect((await exited)[0]).toBe(1);
  });
  it("survives its stderr reader disappearing before a deferred durable-row prune", async () => {
    const directory = await mkdtemp(join(tmpdir(), "n-"));
    directories.add(directory);
    const socketPath = join(directory, "host.sock");
    const registryPath = join(directory, "registry.json");
    const { child, ready } = await spawnReadyHost({ socketPath, registryPath, generation: "stderr-death-generation" });
    const client = await NativeTerminalClient.connect(socketPath);

    await client.create({
      id: "survivor",
      command: "/bin/sh",
      args: ["-c", "while :; do echo survivor-beat; sleep 0.2; done"],
      cwd: directory,
      env: isolatedNativeTestEnvironment({ PATH: process.env.PATH ?? "/usr/bin:/bin", TERM: "xterm-256color" }),
      cols: 80,
      rows: 24,
    });
    await client.create({
      id: "doomed",
      command: "/bin/sh",
      args: ["-c", "sleep 1; exit 0"],
      cwd: directory,
      env: isolatedNativeTestEnvironment({ PATH: process.env.PATH ?? "/usr/bin:/bin", TERM: "xterm-256color" }),
      cols: 80,
      rows: 24,
    });

    // The supervisor dies: the stderr reader disappears while the host lives.
    child.stderr!.destroy();
    await eventually(
      () => client.state("doomed"),
      (state) => state.status === "exited",
    );
    // The deferred prune (host.js:1454 -> 1425 -> 590 pre-fix) runs after the
    // exit: wait for the durable row to be gone, i.e. the prune happened.
    await eventually(
      () => readNativeTerminalPgid("doomed", registryPath),
      (row) => row.status === "unresolved",
    );
    // EPIPE from a closed pipe surfaces asynchronously; leave it time to land.
    await new Promise((resolve) => setTimeout(resolve, 600));

    expect(child.exitCode, "the host must survive its stderr reader disappearing").toBeNull();
    expect(child.signalCode).toBeNull();
    const ping = await client.ping();
    expect(ping.hostPid).toBe(child.pid);
    expect(ping.generation).toBe("stderr-death-generation");
    expect(ping.generation).toBe(ready.generation);
    const replay = await eventually(
      () => client.readOutput("survivor", 0),
      (candidate) => candidate.chunks.some((chunk) => chunk.data.includes("survivor-beat")),
    );
    expect(replay.chunks.length).toBeGreaterThan(0);

    // A clean shutdown still works after the dead-stream containment.
    child.kill("SIGTERM");
    const [exitCode] = await Promise.race([
      once(child, "exit"),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("host did not exit after SIGTERM")), 5_000)),
    ]);
    expect(exitCode).toBe(0);
    client.close();
  });

  it("isolates a faulty client connection: other clients and PTYs keep working", async () => {
    const directory = await mkdtemp(join(tmpdir(), "n-"));
    directories.add(directory);
    const socketPath = join(directory, "host.sock");
    const registryPath = join(directory, "registry.json");
    const { child } = await spawnReadyHost({ socketPath, registryPath, generation: "faulty-client-generation" });
    const client = await NativeTerminalClient.connect(socketPath);
    await client.create({
      id: "guarded",
      command: "/bin/cat",
      args: [],
      cwd: directory,
      env: isolatedNativeTestEnvironment({ PATH: process.env.PATH ?? "/usr/bin:/bin", TERM: "xterm-256color" }),
      cols: 80,
      rows: 24,
    });

    // Faulty client 1: garbage frames, then an oversized frame (the server
    // destroys this connection by design), then an abrupt close.
    const faulty = createConnection(socketPath);
    await once(faulty, "connect");
    faulty.on("error", () => { /* a reset peer is the fault under test */ });
    let responses = "";
    faulty.setEncoding("utf8");
    faulty.on("data", chunk => { responses += chunk; });
    faulty.write("this is not json\n");
    faulty.write("{ also not json\n");
    await eventually(() => responses.trim().split("\n").filter(Boolean), lines => lines.length === 2);
    for (const line of responses.trim().split("\n")) {
      expect(JSON.parse(line)).toMatchObject({ ok: false, error: { code: "invalid-request" } });
    }
    const faultyClosed = new Promise<void>(resolve => faulty.once("close", resolve));
    faulty.write(`${"x".repeat(NATIVE_TERMINAL_MAX_FRAME_BYTES + 16)}\n`);
    await faultyClosed;
    // Faulty client 2: connects and vanishes without a word.
    const rude = createConnection(socketPath);
    await once(rude, "connect");
    rude.destroy();

    const ping = await client.ping();
    expect(ping.hostPid).toBe(child.pid);
    expect(ping.generation).toBe("faulty-client-generation");
    const lease = await client.acquireController("guarded", "healthy-controller");
    await client.write(lease, "still-alive\r");
    const replay = await eventually(
      () => client.readOutput("guarded", 0),
      (candidate) => candidate.chunks.some((chunk) => chunk.data.includes("still-alive")),
    );
    expect(replay.chunks.length).toBeGreaterThan(0);
    await client.releaseController(lease);

    expect(child.exitCode).toBeNull();
    child.kill("SIGTERM");
    const [exitCode] = await Promise.race([
      once(child, "exit"),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("host did not exit after SIGTERM")), 5_000)),
    ]);
    expect(exitCode).toBe(0);
    client.close();
  });
});
