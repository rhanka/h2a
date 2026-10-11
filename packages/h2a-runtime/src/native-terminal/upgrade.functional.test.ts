import type { ChildProcess } from "node:child_process";
import { once } from "node:events";
import { lstat, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { createConnection } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
// @ts-ignore Shared JS qualification helper; tests are outside the production build.
import {
  createPrivateTestDirectory,
  isolatedNativeTestEnvironment,
  spawnIsolatedNative as spawn,
  setupNativeTestEnvironment,
} from "../../../h2a/test/helpers/native-isolation.js";

setupNativeTestEnvironment(afterAll);

import { SessionLeaseStore } from "../session-lease.js";
import { readNativeTerminalPgid } from "../registry.js";
import { NativeTerminalClient } from "./client.js";

// Scenario 9 (CONTRAT v5): the published 0.98.4 dist against the 0.98.5
// candidate. Every host process runs inside the qualification boundary with
// its own XDG_RUNTIME_DIR view; the dist is installed per test run, never the
// global install, and never the installed `h2a` binary.
const DIST_VERSION = "0.98.4";
const candidateEntry = fileURLToPath(new URL("./process.ts", import.meta.url));

const children = new Set<ChildProcess>();
const directories = new Set<string>();
let distPrefix: string | undefined;
let distRoot: string | undefined;

afterEach(async () => {
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    if (child.exitCode === null && child.signalCode === null) await once(child, "exit");
  }
  children.clear();
  for (const directory of directories) await rm(directory, { recursive: true, force: true });
  directories.clear();
});

afterAll(async () => {
  // The installed dist outlives the per-test directories by design.
  if (distPrefix !== undefined) await rm(distPrefix, { recursive: true, force: true });
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

function captureOutput(child: ChildProcess): { stdout: string; stderr: string } {
  const output = { stdout: "", stderr: "" };
  child.stdout?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => { output.stdout += chunk; });
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk: string) => { output.stderr += chunk; });
  return output;
}

async function spawnHostProcess(options: {
  entry: string;
  socketPath: string;
  registryPath: string;
  generation: string;
}): Promise<{ child: ChildProcess; ready: ReadyMessage; output: { stdout: string; stderr: string } }> {
  const isSourceCandidate = options.entry.endsWith(".ts");
  const child = spawn(process.execPath, [
    ...(isSourceCandidate ? ["--import", "tsx"] : []),
    options.entry,
    "--socket",
    options.socketPath,
    "--generation",
    options.generation,
    "--replay-bytes",
    String(64 * 1024),
    "--registry-path",
    options.registryPath,
  ], {
    cwd: dirname(options.entry),
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.add(child);
  const output = captureOutput(child);
  const ready = await eventually(() => {
    const line = output.stdout.split("\n").find((candidate) => candidate.includes("h2a.native-terminal.ready"));
    if (line === undefined) return undefined;
    try {
      return JSON.parse(line) as ReadyMessage;
    } catch {
      return undefined;
    }
  }, (message) => message !== undefined);
  return { child, ready, output };
}

type LeaseRow = Readonly<{ sessionId: string; holder: string; heartbeatAt: string; expiresAt: string; token: string }>;
type LeaseStoreLike = {
  forSession(sessionId: string): LeaseRow | undefined;
  acquire(input: { sessionId: string; holder: string; ttlMs?: number }): Promise<LeaseRow>;
  heartbeat(input: { sessionId: string; token: string }): Promise<LeaseRow>;
};

function distLeaseStore(leasesPath: string): LeaseStoreLike {
  const requireDist = createRequire(import.meta.url);
  const module = requireDist(join(distRoot!, "session-lease.js")) as {
    SessionLeaseStore: new (path: string, deps: { now: () => string }) => LeaseStoreLike;
  };
  return new module.SessionLeaseStore(leasesPath, { now: () => new Date().toISOString() });
}

function socketAcceptsConnections(socketPath: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const probe = createConnection(socketPath);
    probe.once("connect", () => { probe.destroy(); resolve(); });
    probe.once("error", (error) => { probe.destroy(); reject(error); });
  });
}

function sessionEnv(): Record<string, string> {
  return isolatedNativeTestEnvironment({
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    TERM: "xterm-256color",
  }) as Record<string, string>;
}

describe.skipIf(process.platform !== "linux")("native terminal upgrade (scenario 9)", () => {
  beforeAll(async () => {
    // The PUBLISHED dist, installed into a throwaway prefix — never the global
    // install and never the owner's real dist.
    distPrefix = createPrivateTestDirectory("upgrade-dist-");
    const npm = spawn("/usr/bin/npm", [
      "install",
      "--prefix",
      distPrefix,
      `@sentropic/h2a-runtime@${DIST_VERSION}`,
      "--cache",
      join(distPrefix, "npm-cache"),
      "--no-audit",
      "--no-fund",
    ], { env: process.env, stdio: ["ignore", "ignore", "pipe"] });
    children.add(npm);
    const output = captureOutput(npm);
    const [code] = await once(npm, "exit");
    expect(code, `npm install of the published ${DIST_VERSION} dist failed: ${output.stderr}`).toBe(0);
    distRoot = join(distPrefix, "node_modules", "@sentropic", "h2a-runtime", "dist");
  }, 300_000);

  it("should refuse double publication over a live 0.98.4 host, then take over after its ordered stop", async () => {
    const root = createPrivateTestDirectory("u9i-");
    directories.add(root);
    const socketPath = join(root, "native-terminal.sock");
    const registryPath = join(root, "registry.json");
    const leasesPath = join(root, "leases.json");

    // The live published 0.98.4 host owning the endpoint.
    const dist = await spawnHostProcess({
      entry: join(distRoot!, "native-terminal", "process.js"),
      socketPath,
      registryPath,
      generation: "dist-0984",
    });
    expect(dist.ready.pid).toBe(dist.child.pid);

    // 0.98.4 fleet state on the same endpoint: a served session and a lease.
    const client = await NativeTerminalClient.connect(socketPath);
    const session = await client.create({
      id: "scenario9-pty",
      command: "/bin/cat",
      args: [],
      cwd: root,
      env: sessionEnv(),
      cols: 80,
      rows: 24,
    });
    expect(session.status).toBe("running");
    const oldStore = distLeaseStore(leasesPath);
    const oldLease = await oldStore.acquire({ sessionId: "scenario9-lease", holder: "supervisor-0.98.4", ttlMs: 60_000 });

    // The arriving 0.98.5 publishing process must refuse, coded, and exit 3.
    const candidate = spawn(process.execPath, [
      "--import",
      "tsx",
      candidateEntry,
      "--socket",
      socketPath,
      "--generation",
      "candidate-0985",
      "--replay-bytes",
      String(64 * 1024),
      "--registry-path",
      registryPath,
    ], { cwd: dirname(candidateEntry), env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    children.add(candidate);
    const candidateOutput = captureOutput(candidate);
    const [refusalExit] = await once(candidate, "exit");
    expect(refusalExit).toBe(3);
    expect(candidateOutput.stderr).toContain("H2A_ENDPOINT_LIVE_OWNER");
    expect(candidateOutput.stderr).toContain("endpoint owned by a live older host");

    // Live socket untouched; 0.98.4 sessions and leases keep working.
    const liveSocket = await lstat(socketPath);
    expect(liveSocket.isSocket()).toBe(true);
    expect((await client.ping()).hostPid).toBe(dist.child.pid);
    const controller = await client.acquireController("scenario9-pty", "refusal-witness");
    await client.write(controller, "still-served\r");
    await eventually(() => client.readOutput("scenario9-pty", 0), (replay) =>
      replay.chunks.some((chunk) => chunk.data.includes("still-served")));
    await new Promise((resolve) => setTimeout(resolve, 25));
    const renewed = await oldStore.heartbeat({ sessionId: "scenario9-lease", token: oldLease.token });
    expect(Date.parse(renewed.heartbeatAt)).toBeGreaterThan(Date.parse(oldLease.heartbeatAt));

    // Ordered stop of the outgoing 0.98.4 host: clean exit, publication rolled
    // back, its PTY positively reaped (the process group is gone).
    const pgidLookup = readNativeTerminalPgid("scenario9-pty", registryPath);
    expect(pgidLookup.status).toBe("resolved");
    const outgoingPgid = pgidLookup.status === "resolved" ? pgidLookup.pgid : -1;
    const distExit = once(dist.child, "exit");
    dist.child.kill("SIGTERM");
    expect((await distExit)[0]).toBe(0);
    await eventually(async () => {
      try { await lstat(socketPath); return false; } catch { return true; }
    }, (gone) => gone);
    await eventually(async () => {
      try { await lstat(`${socketPath}.owner`); return false; } catch { return true; }
    }, (gone) => gone);
    let groupAlive = true;
    try { process.kill(-outgoingPgid, 0); } catch { groupAlive = false; }
    expect(groupAlive, "the outgoing host's PTY group must be reaped, not orphaned").toBe(false);

    // 0.98.5 takes over the endpoint by R3 over the surviving registry rows.
    const successor = await spawnHostProcess({
      entry: candidateEntry,
      socketPath,
      registryPath,
      generation: "successor-0985",
    });
    expect(successor.ready.socketPath).toBe(socketPath);
    const successorClient = await NativeTerminalClient.connect(socketPath);
    expect((await successorClient.ping()).hostPid).toBe(successor.child.pid);
    const fresh = await successorClient.create({
      id: "post-takeover",
      command: "/bin/cat",
      args: [],
      cwd: root,
      env: sessionEnv(),
      cols: 80,
      rows: 24,
    });
    expect(fresh.status).toBe("running");

    // The 0.98.4 lease is reactivable by a 0.98.5 client: same store format,
    // same token, renewed by the candidate's own store code.
    const successorStore = new SessionLeaseStore(leasesPath, { now: () => new Date().toISOString() });
    const observed = successorStore.forSession("scenario9-lease");
    expect(observed?.token).toBe(oldLease.token);
    const reactivated = await successorStore.heartbeat({ sessionId: "scenario9-lease", token: oldLease.token });
    expect(Date.parse(reactivated.heartbeatAt)).toBeGreaterThan(Date.parse(renewed.heartbeatAt));

    successorClient.close();
    client.close();
  }, 240_000);

  it("should let a live 0.98.5 host be adopted by a 0.98.4 supervisor, with the older publisher leaving the socket intact", async () => {
    const root = createPrivateTestDirectory("u9ii-");
    directories.add(root);
    const socketPath = join(root, "native-terminal.sock");
    const registryPath = join(root, "registry.json");

    // The live 0.98.5 candidate host from source.
    const candidate = await spawnHostProcess({
      entry: candidateEntry,
      socketPath,
      registryPath,
      generation: "candidate-0985-ii",
    });
    const client = await NativeTerminalClient.connect(socketPath);
    const session = await client.create({
      id: "adopt-me",
      command: "/bin/cat",
      args: [],
      cwd: root,
      env: sessionEnv(),
      cols: 80,
      rows: 24,
    });
    expect(session.status).toBe("running");

    // A 0.98.4 supervisor ADOPTS the live 0.98.5 host: connect, ping, serve a
    // session. Its spawnHost throws: an adoption must never spawn a host.
    const adopterScript = [
      `const module = await import(${JSON.stringify(pathToFileURL(join(distRoot!, "native-terminal", "supervisor.js")).href)});`,
      "const supervisor = new module.NativeTerminalHostSupervisor({",
      `  socketPath: ${JSON.stringify(socketPath)},`,
      "  replayBytesPerSession: 65536,",
      "  spawnHost: () => { throw new Error(\"adoption must never spawn a host\"); },",
      "});",
      "const adopted = await supervisor.client();",
      "const ping = await adopted.ping();",
      "const created = await adopted.create({",
      "  id: \"adopted-0984-session\",",
      "  command: \"/bin/cat\",",
      "  args: [],",
      `  cwd: ${JSON.stringify(root)},`,
      "  env: process.env,",
      "  cols: 80,",
      "  rows: 24,",
      "});",
      "const lease = await adopted.acquireController(\"adopted-0984-session\", \"supervisor-0.98.4\");",
      "await adopted.write(lease, \"adopted-by-0984\\r\");",
      "let seen = \"\";",
      "for (let attempt = 0; attempt < 200 && !seen.includes(\"adopted-by-0984\"); attempt += 1) {",
      "  const replay = await adopted.readOutput(\"adopted-0984-session\", 0);",
      "  for (const chunk of replay.chunks) seen += chunk.data;",
      "  await new Promise((resolve) => setTimeout(resolve, 10));",
      "}",
      "if (!seen.includes(\"adopted-by-0984\")) throw new Error(\"adopted session produced no output\");",
      "supervisor.disconnect();",
      "process.stdout.write(JSON.stringify({ adopted: true, hostPid: ping.hostPid, generation: ping.generation }) + \"\\n\");",
    ].join("\n");
    const adopter = spawn(process.execPath, ["--input-type", "module", "--eval", adopterScript], {
      cwd: root,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    children.add(adopter);
    const adopterOutput = captureOutput(adopter);
    const [adopterExit] = await once(adopter, "exit");
    expect(adopterExit, `0.98.4 supervisor adoption failed: ${adopterOutput.stderr}`).toBe(0);
    const adoption = JSON.parse(adopterOutput.stdout.trim().split("\n").pop()!) as {
      adopted: boolean; hostPid: number; generation: string;
    };
    expect(adoption.adopted).toBe(true);
    expect(adoption.hostPid).toBe(candidate.child.pid);
    expect(adoption.generation).toBe("candidate-0985-ii");

    // An older 0.98.4 PUBLISHING process against the live 0.98.5 host: its
    // behavior is observed as-is, but the endpoint must survive it.
    const oldPublisher = spawn(process.execPath, [
      join(distRoot!, "native-terminal", "process.js"),
      "--socket",
      socketPath,
      "--generation",
      "old-publisher-0984",
      "--replay-bytes",
      String(64 * 1024),
      "--registry-path",
      registryPath,
    ], {
      cwd: join(distRoot!, "native-terminal"),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    children.add(oldPublisher);
    const oldPublisherOutput = captureOutput(oldPublisher);
    const [oldPublisherExit] = await once(oldPublisher, "exit");
    expect(oldPublisherExit, `unexpected old publisher outcome: ${oldPublisherOutput.stderr}`).toBe(1);
    expect(oldPublisherOutput.stderr).toContain("already active");

    // VERIFIED property: the 0.98.5 host's socket was not destroyed.
    await socketAcceptsConnections(socketPath);
    expect((await client.ping()).hostPid).toBe(candidate.child.pid);
    const lease = await client.acquireController("adopt-me", "post-publisher");
    await client.write(lease, "still-alive-ii\r");
    await eventually(() => client.readOutput("adopt-me", 0), (replay) =>
      replay.chunks.some((chunk) => chunk.data.includes("still-alive-ii")));

    client.close();
  }, 240_000);
});
