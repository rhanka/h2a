import type { ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { lstat, rm, stat } from "node:fs/promises";
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

// Keep the build toolchain selected by setup-node before installing the
// private runtime environment (whose PATH deliberately contains no host CLI).
const npmCli = process.env.npm_execpath;
const npmCommand = npmCli ? process.execPath : "npm";
const npmArgs = (args: string[]) => npmCli ? [npmCli, ...args] : args;
const buildToolPath = process.env.PATH ?? "/usr/bin:/bin";
setupNativeTestEnvironment(afterAll);

import { readNativeTerminalPgid } from "../registry.js";
import { NativeTerminalClient } from "./client.js";
// @ts-ignore Shared test-only boundary for published pre-owned-proc hosts.
import { assertPrivatePidNamespace } from "../../../h2a/test/helpers/private-pid-namespace.mjs";

// Scenario 9 (CONTRAT v5): the published 0.98.4 dist against the 0.98.5
// candidate. R5 requires BOTH dists to be qualified as installed dists: the
// PUBLISHED 0.98.4 from the registry, and the CANDIDATE built as a dist (npm
// pack of the workspace build — never tsx sources), each installed into its
// own throwaway prefix inside the qualification boundary. Never the global
// install, never the owner's real dist, never the installed `h2a` binary.
const DIST_VERSION = "0.98.4";
const workspacePackageDir = fileURLToPath(new URL("../../", import.meta.url));

const children = new Set<ChildProcess>();
const directories = new Set<string>();
const prefixes = new Set<string>();
let distPrefix: string | undefined;
let distRoot: string | undefined;
let candidatePrefix: string | undefined;
let candidateRoot: string | undefined;
let candidateEntry: string | undefined;

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
  // The installed dists outlive the per-test directories by design.
  for (const prefix of prefixes) await rm(prefix, { recursive: true, force: true });
  prefixes.clear();
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
  const child = spawn(process.execPath, [
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

async function npmInstall(args: string[], prefix: string, cache: string): Promise<void> {
  const install = spawn(npmCommand, npmArgs([
    "install",
    "--prefix",
    prefix,
    "--ignore-scripts",
    ...args,
    "--cache",
    cache,
    "--no-audit",
    "--no-fund",
  ]), { env: { ...process.env, PATH: buildToolPath }, stdio: ["ignore", "ignore", "pipe"] });
  children.add(install);
  const output = captureOutput(install);
  const [code] = await once(install, "exit");
  expect(code, `npm install ${args.join(" ")} failed: ${output.stderr}`).toBe(0);
  // The owner forbids Python. npm's node-pty install script normally invokes
  // node-gyp: build that unchanged N-API source directly in this private prefix.
  const require = createRequire(join(prefix, "package.json"));
  const ptyRoot = dirname(require.resolve("node-pty/package.json"));
  const addonRoot = dirname(require.resolve("node-addon-api/package.json", { paths: [ptyRoot] }));
  mkdirSync(join(ptyRoot, "build/Release"), { recursive: true });
  const compiled = spawnSync("/usr/bin/g++", ["-std=c++17", "-shared", "-fPIC", "-O2", "-pthread",
    "-DNAPI_CPP_EXCEPTIONS", `-I${process.env.XCLI_NODE_HEADERS ?? "/usr/include/node"}`, `-I${addonRoot}`,
    join(ptyRoot, "src/unix/pty.cc"), "-o", join(ptyRoot, "build/Release/pty.node"), "-lutil"],
  { env: process.env, encoding: "utf8" });
  expect(compiled.status, `private node-pty build failed: ${compiled.stderr}`).toBe(0);
}

type LeaseSnapshot = Readonly<{ token: string; heartbeatAt: string; expiresAt: string }>;

type OutgoingWitness = Readonly<{ hostPid: number; sessionId: string } & LeaseSnapshot>;

type RenewalWitness = Readonly<{ hostPid: number } & LeaseSnapshot>;

type SuccessorWitness = Readonly<{
  hostPid: number;
  own: Readonly<{ sessionId: string; acquiredHeartbeatAt: string } & LeaseSnapshot>;
  reactivated: Readonly<{ sessionId: string } & LeaseSnapshot>;
}>;

/**
 * A real CLIENT process of one dist, running the machine-scoped lease cycle
 * the way the application runs it: the PTY session is created and driven
 * through this dist's own client, the lease is ACQUIRED through the dist's
 * exported launch path (`acquireSessionLease` — the same function the h2a
 * launch flow calls) and renewed through the store the supervision pass opens
 * (`SessionLeaseStore` at `resolveSessionLeasePath()` — the supervision pass
 * is the only production heartbeat caller, and it opens exactly this store at
 * exactly this path; its CPU probe is tmux-pane-bound, which a native-terminal
 * PTY has none of). The store path is never handed in by the test: each dist
 * resolves it from the redirected config home exactly as production does, and
 * the lease is tied to the PTY session this client serves.
 */
async function runLeaseClient<TWitness>(options: {
  distRoot: string;
  socketPath: string;
  leaseConfigHome: string;
  root: string;
  body: string;
}): Promise<TWitness> {
  const child = spawn(process.execPath, ["--input-type=module", "--eval", [
    `const clientModule = await import(${JSON.stringify(pathToFileURL(join(options.distRoot, "native-terminal", "client.js")).href)});`,
    `const runtime = await import(${JSON.stringify(pathToFileURL(join(options.distRoot, "index.js")).href)});`,
    `const leaseModule = await import(${JSON.stringify(pathToFileURL(join(options.distRoot, "session-lease.js")).href)});`,
    `const client = await clientModule.NativeTerminalClient.connect(${JSON.stringify(options.socketPath)});`,
    `const ping = await client.ping();`,
    `const openLeaseStore = () => new leaseModule.SessionLeaseStore(leaseModule.resolveSessionLeasePath(), { now: () => new Date().toISOString() });`,
    options.body,
    "client.close();",
    `process.stdout.write(JSON.stringify({ hostPid: ping.hostPid, ...witness }) + "\\n");`,
  ].join("\n")], {
    cwd: options.root,
    env: { ...process.env, REMOTE_CLI_CONFIG_HOME: options.leaseConfigHome },
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.add(child);
  const output = captureOutput(child);
  const [code] = await once(child, "exit");
  expect(code, `lease client of ${options.distRoot} failed: ${output.stderr}`).toBe(0);
  const line = output.stdout.trim().split("\n").pop();
  return JSON.parse(line!) as TWitness;
}

type PersistedLease = Readonly<{
  sessionId: string;
  holder: string;
  token: string;
  heartbeatAt: string;
  expiresAt: string;
  sample?: Readonly<{ cpuMs: number; sampledAt: string }>;
}>;

/**
 * An INDEPENDENT process re-reads the persisted leases through the dist's real
 * store — the same `resolveSessionLeasePath()` resolution, a fresh process, a
 * fresh clock. What a client SAW returned proves nothing on its own: a
 * heartbeat that was returned but never written to the store must turn this
 * read red, not green.
 */
async function readPersistedLeases(options: {
  distRoot: string;
  leaseConfigHome: string;
  root: string;
}): Promise<PersistedLease[]> {
  const child = spawn(process.execPath, ["--input-type=module", "--eval", [
    `const leaseModule = await import(${JSON.stringify(pathToFileURL(join(options.distRoot, "session-lease.js")).href)});`,
    `const store = new leaseModule.SessionLeaseStore(leaseModule.resolveSessionLeasePath(), { now: () => new Date().toISOString() });`,
    `process.stdout.write(JSON.stringify(store.readAll()) + "\\n");`,
  ].join("\n")], {
    cwd: options.root,
    env: { ...process.env, REMOTE_CLI_CONFIG_HOME: options.leaseConfigHome },
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.add(child);
  const output = captureOutput(child);
  const [code] = await once(child, "exit");
  expect(code, `independent lease reader of ${options.distRoot} failed: ${output.stderr}`).toBe(0);
  const line = output.stdout.trim().split("\n").pop();
  return JSON.parse(line!) as PersistedLease[];
}

function clientDrivesSession(id: string, marker: string): string {
  return [
    `const controller = await client.acquireController(${JSON.stringify(id)}, ${JSON.stringify(`${id}-holder`)});`,
    `await client.write(controller, ${JSON.stringify(`${marker}\r`)});`,
    "let seen = \"\";",
    `for (let attempt = 0; attempt < 200 && !seen.includes(${JSON.stringify(marker)}); attempt += 1) {`,
    `  const replay = await client.readOutput(${JSON.stringify(id)}, 0);`,
    "  for (const chunk of replay.chunks) seen += chunk.data;",
    "  await new Promise((resolve) => setTimeout(resolve, 10));",
    "}",
    `if (!seen.includes(${JSON.stringify(marker)})) throw new Error("session produced no output");`,
  ].join("\n");
}

type SupervisionPassWitness = Readonly<{
  beaten: string[];
  observed: string[];
  released: string[];
  unreadable: string[];
  proposals: ReadonlyArray<Readonly<{ sessionId: string }>>;
}>;

type SupervisedLeaseWitness = Readonly<{
  sessionId: string;
  token: string;
  acquiredHeartbeatAt: string;
  acquiredSample: Readonly<{ cpuMs: number; sampledAt: string }>;
  heartbeatAt: string;
  sample: Readonly<{ cpuMs: number; sampledAt: string }>;
}>;

type SupervisionWitness = Readonly<{
  pass: SupervisionPassWitness;
  burn: SupervisedLeaseWitness;
  idle: SupervisedLeaseWitness;
}>;

/**
 * A real CLIENT process of the CANDIDATE dist running the lease SUPERVISION
 * pass the way the application runs it (`superviseSessionLeases(listJobs(),
 * now)` — the exact production heartbeat caller of the jobs probe). The tmux
 * server, its panes, the registry rows and the leases all belong to this
 * fixture; the pane processes are pinned into the private process view first
 * (the same pin the isolation guard applies to guarded spawns), so the
 * pass's fleet-wide /proc walk reads only processes this test started.
 */
async function runSupervisionClient<TWitness>(options: {
  distRoot: string;
  leaseConfigHome: string;
  root: string;
  body: string;
}): Promise<TWitness> {
  const child = spawn(process.execPath, ["--input-type=module", "--eval", [
    `const runtime = await import(${JSON.stringify(pathToFileURL(join(options.distRoot, "index.js")).href)});`,
    `const leaseModule = await import(${JSON.stringify(pathToFileURL(join(options.distRoot, "session-lease.js")).href)});`,
    `const registryModule = await import(${JSON.stringify(pathToFileURL(join(options.distRoot, "registry.js")).href)});`,
    // R4 (round-4 finding): the production fleet reader always reads the real
    // /proc and ignores H2A_TEST_PROC* env; this TEST client confines the
    // walk to the private process view through the test-only setter instead.
    `if (process.env.H2A_TEST_PROC_ROOT === undefined)`,
    `  throw new Error("the supervision client must run under the private process view");`,
    `const tmuxModule = await import(${JSON.stringify(pathToFileURL(join(options.distRoot, "tmux.js")).href)});`,
    `tmuxModule.setTestProcReaderRoot(process.env.H2A_TEST_PROC_ROOT);`,
    `const { spawnSync } = await import("node:child_process");`,
    `const fs = await import("node:fs");`,
    options.body,
    `process.stdout.write(JSON.stringify(witness) + "\\n");`,
  ].join("\n")], {
    cwd: options.root,
    env: { ...process.env, REMOTE_CLI_CONFIG_HOME: options.leaseConfigHome },
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.add(child);
  const output = captureOutput(child);
  const [code] = await once(child, "exit");
  expect(code, `supervision client of ${options.distRoot} failed: ${output.stderr}`).toBe(0);
  const line = output.stdout.trim().split("\n").pop();
  return JSON.parse(line!) as TWitness;
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
    assertPrivatePidNamespace();
    // The PUBLISHED 0.98.4 dist, installed into a throwaway prefix.
    const cache = createPrivateTestDirectory("upgrade-cache-");
    prefixes.add(cache);
    distPrefix = createPrivateTestDirectory("upgrade-dist-");
    prefixes.add(distPrefix);
    await npmInstall([`@sentropic/h2a-runtime@${DIST_VERSION}`], distPrefix, cache);
    distRoot = join(distPrefix, "node_modules", "@sentropic", "h2a-runtime", "dist");

    // The CANDIDATE, packed from the workspace BUILD (dist/) and installed
    // into its own throwaway prefix. The pack fails the qualification when the
    // gate did not build the candidate dist first — a missing dist is a
    // failed qualification, never a skip.
    const packDir = createPrivateTestDirectory("upgrade-pack-");
    prefixes.add(packDir);
    const pack = spawn(npmCommand, npmArgs(["pack", "--ignore-scripts", "--pack-destination", packDir]), {
      cwd: workspacePackageDir,
      env: { ...process.env, PATH: buildToolPath },
      stdio: ["ignore", "pipe", "pipe"],
    });
    children.add(pack);
    const packOutput = captureOutput(pack);
    const [packCode] = await once(pack, "exit");
    expect(packCode, `npm pack of the candidate failed: ${packOutput.stderr}`).toBe(0);
    const tarball = readdirSync(packDir).find((name) => name.endsWith(".tgz"));
    expect(tarball, "the candidate pack contains no tarball").toBeDefined();
    // The candidate runtime imports its core peer during lease/supervision.
    // Install the matching source-built core, never an owner's installed dist.
    const candidateTarballs = [join(packDir, tarball!)];
    for (const dependency of ["h2a", "track"]) {
      const before = new Set(readdirSync(packDir));
      const dependencyPack = spawn(npmCommand, npmArgs(["pack", "--ignore-scripts", "--pack-destination", packDir]), {
        cwd: join(workspacePackageDir, "..", dependency),
        env: { ...process.env, PATH: buildToolPath }, stdio: ["ignore", "pipe", "pipe"],
      });
      children.add(dependencyPack);
      const dependencyOutput = captureOutput(dependencyPack);
      const [dependencyCode] = await once(dependencyPack, "exit");
      expect(dependencyCode, `npm pack of candidate ${dependency} failed: ${dependencyOutput.stderr}`).toBe(0);
      const dependencyTarball = readdirSync(packDir).find((name) => name.endsWith(".tgz") && !before.has(name));
      expect(dependencyTarball, `the matching candidate ${dependency} pack is mandatory`).toBeDefined();
      candidateTarballs.push(join(packDir, dependencyTarball!));
    }
    candidatePrefix = createPrivateTestDirectory("upgrade-candidate-");
    prefixes.add(candidatePrefix);
    await npmInstall(candidateTarballs, candidatePrefix, cache);
    candidateRoot = join(candidatePrefix, "node_modules", "@sentropic", "h2a-runtime", "dist");
    candidateEntry = join(candidateRoot, "native-terminal", "process.js");

    // Version attestation: the installed candidate IS the workspace candidate.
    const candidateVersion = (JSON.parse(readFileSync(join(candidatePrefix, "node_modules", "@sentropic", "h2a-runtime", "package.json"), "utf8")) as { version: string }).version;
    const workspaceVersion = (JSON.parse(readFileSync(join(workspacePackageDir, "package.json"), "utf8")) as { version: string }).version;
    expect(candidateVersion).toBe(workspaceVersion);
    // And it is THIS train's build — the coded live-owner refusal exists only
    // in the candidate, not in the published 0.98.4 (the two dists differ).
    const candidateRefusal = readFileSync(join(candidateRoot, "native-terminal", "server.js"), "utf8");
    expect(candidateRefusal).toContain("H2A_ENDPOINT_LIVE_OWNER");
    const distServer = readFileSync(join(distRoot, "native-terminal", "server.js"), "utf8");
    expect(distServer, "the published dist must not carry this train's refusals").not.toContain("H2A_ENDPOINT_LIVE_OWNER");
    await stat(candidateEntry);
  }, 600_000);

  it("should refuse double publication over a live 0.98.4 host, then take over after its ordered stop", async () => {
    const root = createPrivateTestDirectory("u9i-");
    directories.add(root);
    const socketPath = join(root, "native-terminal.sock");
    const registryPath = join(root, "registry.json");
    // The machine-scoped lease store lives at the dist's OWN config-home
    // resolution: the test redirects the config home and every client process
    // (of either dist) resolves the lease path itself — the path is never
    // handed to a client.
    const leaseConfigHome = join(root, "lease-config-home");
    mkdirSync(leaseConfigHome, { recursive: true });

    // The live published 0.98.4 host owning the endpoint.
    const dist = await spawnHostProcess({
      entry: join(distRoot!, "native-terminal", "process.js"),
      socketPath,
      registryPath,
      generation: "dist-0984",
    });
    expect(dist.ready.pid).toBe(dist.child.pid);

    // 0.98.4 fleet state on the same endpoint, THROUGH the 0.98.4 client and
    // lease flow: the client that owns the PTY session acquires the
    // machine-scoped lease FOR THAT SESSION through the 0.98.4 launch path
    // (acquireSessionLease), does real work on the PTY, then renews the lease
    // it holds through the supervision store seam.
    const acquired = await runLeaseClient<OutgoingWitness>({
      distRoot: distRoot!,
      socketPath,
      leaseConfigHome,
      root,
      body: [
        "const session = await client.create({",
        "  id: \"scenario9-pty\",",
        "  command: \"/bin/cat\",",
        "  args: [],",
        `  cwd: ${JSON.stringify(root)},`,
        "  env: process.env,",
        "  cols: 80,",
        "  rows: 24,",
        "});",
        "if (session.status !== \"running\") throw new Error(\"session is not running\");",
        "const lease = await runtime.acquireSessionLease(\"scenario9-pty\", {",
        "  holder: \"scenario9-supervisor-0.98.4\",",
        `  workspace: ${JSON.stringify(root)},`,
        "});",
        clientDrivesSession("scenario9-pty", "lease-held"),
        "await new Promise((resolve) => setTimeout(resolve, 15));",
        "const beaten = await openLeaseStore().heartbeat({ sessionId: lease.sessionId, token: lease.token });",
        "const witness = { sessionId: lease.sessionId, token: lease.token, heartbeatAt: beaten.heartbeatAt, expiresAt: beaten.expiresAt };",
      ].join("\n"),
    });
    expect(acquired.hostPid).toBe(dist.child.pid);
    expect(acquired.sessionId).toBe("scenario9-pty");
    expect(acquired.token).toBeTruthy();

    // The arriving 0.98.5 publishing process — the installed candidate dist —
    // must refuse, coded, and exit 3 without destroying the live socket.
    const liveBefore = await lstat(socketPath);
    const candidate = spawn(process.execPath, [
      candidateEntry!,
      "--socket",
      socketPath,
      "--generation",
      "candidate-0985",
      "--replay-bytes",
      String(64 * 1024),
      "--registry-path",
      registryPath,
    ], { cwd: dirname(candidateEntry!), env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    children.add(candidate);
    const candidateOutput = captureOutput(candidate);
    const [refusalExit] = await once(candidate, "exit");
    expect(refusalExit).toBe(3);
    expect(candidateOutput.stderr).toContain("H2A_ENDPOINT_LIVE_OWNER");
    expect(candidateOutput.stderr).toContain("endpoint owned by a live older host");

    // Live socket untouched; the 0.98.4 session keeps serving.
    const liveSocket = await lstat(socketPath);
    expect(liveSocket.ino).toBe(liveBefore.ino);
    let client: NativeTerminalClient | undefined;
    try {
      client = await NativeTerminalClient.connect(socketPath);
      expect((await client.ping()).hostPid).toBe(dist.child.pid);
      const controller = await client.acquireController("scenario9-pty", "refusal-witness");
      await client.write(controller, "still-served\r");
      await eventually(() => client.readOutput("scenario9-pty", 0), (replay) =>
        replay.chunks.some((chunk) => chunk.data.includes("still-served")));

      // The 0.98.4 client RENEWS its lease while its host keeps serving —
      // the outgoing fleet operates normally through the refused candidate.
      const renewed = await runLeaseClient<RenewalWitness>({
        distRoot: distRoot!,
        socketPath,
        leaseConfigHome,
        root,
        body: [
          "const store = openLeaseStore();",
          "const lease = store.forSession(\"scenario9-pty\");",
          "if (lease === undefined) throw new Error(\"the PTY session lease is missing\");",
          "const beaten = await store.heartbeat({ sessionId: lease.sessionId, token: lease.token });",
          "const witness = { token: lease.token, heartbeatAt: beaten.heartbeatAt, expiresAt: beaten.expiresAt };",
        ].join("\n"),
      });
      expect(renewed.hostPid).toBe(dist.child.pid);
      expect(renewed.token).toBe(acquired.token);
      expect(Date.parse(renewed.heartbeatAt)).toBeGreaterThan(Date.parse(acquired.heartbeatAt));

      // INDEPENDENT re-read through the 0.98.4 store: what the client saw
      // RETURNED must be what the store PERSISTED — the returned value alone
      // proves nothing.
      const persistedOutgoing = await readPersistedLeases({ distRoot: distRoot!, leaseConfigHome, root });
      const outgoingRecord = persistedOutgoing.find((record) => record.sessionId === "scenario9-pty");
      expect(outgoingRecord, "the outgoing lease must be persisted").toBeDefined();
      expect(outgoingRecord!.token).toBe(acquired.token);
      expect(outgoingRecord!.holder).toBe("scenario9-supervisor-0.98.4");
      expect(outgoingRecord!.heartbeatAt, "the outgoing renewal was returned but not persisted").toBe(renewed.heartbeatAt);
      expect(outgoingRecord!.expiresAt, "the outgoing renewal expiry was returned but not persisted").toBe(renewed.expiresAt);
      const renewedAt = renewed.heartbeatAt;

      // Ordered stop of the outgoing 0.98.4 host: clean exit, publication
      // rolled back, its PTY positively reaped — ESRCH specifically, never
      // "any probe error" (EPERM would mean the group is still there).
      const pgidLookup = readNativeTerminalPgid("scenario9-pty", registryPath);
      expect(pgidLookup.status).toBe("resolved");
      const outgoingPgid = pgidLookup.status === "resolved" ? pgidLookup.pgid : -1;
      expect(() => process.kill(-outgoingPgid, 0), "the outgoing PTY group must be alive before the stop").not.toThrow();
      const distExit = once(dist.child, "exit");
      dist.child.kill("SIGTERM");
      expect((await distExit)[0]).toBe(0);
      await eventually(async () => {
        try { await lstat(socketPath); return false; } catch { return true; }
      }, (gone) => gone);
      await eventually(async () => {
        try { await lstat(`${socketPath}.owner`); return false; } catch { return true; }
      }, (gone) => gone);
      let reaped = false;
      try { process.kill(-outgoingPgid, 0); } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
        reaped = true;
      }
      expect(reaped, "the outgoing host's PTY group must be reaped (ESRCH), not orphaned").toBe(true);

      // 0.98.5 takes over the endpoint by R3 over the surviving rows.
      const successor = await spawnHostProcess({
        entry: candidateEntry!,
        socketPath,
        registryPath,
        generation: "successor-0985",
      });
      expect(successor.ready.socketPath).toBe(socketPath);
      // The 0.98.5 successor CLIENT — the candidate dist's own client and lease
      // code, over the successor host it now serves. It runs the real lease
      // cycle FOR THE SESSION IT SERVES (post-takeover): acquisition through
      // the candidate's launch path, real work on the PTY, renewal of that
      // same session's lease. And it REACTIVATES the lease WRITTEN by 0.98.4
      // with the same token, through the candidate's store code (CONTRAT v5).
      const reactivated = await runLeaseClient<SuccessorWitness>({
        distRoot: candidateRoot!,
        socketPath,
        leaseConfigHome,
        root,
        body: [
          "const session = await client.create({",
          "  id: \"post-takeover\",",
          "  command: \"/bin/cat\",",
          "  args: [],",
          `  cwd: ${JSON.stringify(root)},`,
          "  env: process.env,",
          "  cols: 80,",
          "  rows: 24,",
          "});",
          "if (session.status !== \"running\") throw new Error(\"successor session is not running\");",
          "const own = await runtime.acquireSessionLease(\"post-takeover\", {",
          "  holder: \"scenario9-supervisor-0.98.5\",",
          `  workspace: ${JSON.stringify(root)},`,
          "});",
          clientDrivesSession("post-takeover", "served-by-0985"),
          "await new Promise((resolve) => setTimeout(resolve, 15));",
          "const store = openLeaseStore();",
          "const ownBeaten = await store.heartbeat({ sessionId: own.sessionId, token: own.token });",
          "const inherited = store.forSession(\"scenario9-pty\");",
          "if (inherited === undefined) throw new Error(\"the 0.98.4 lease is missing after takeover\");",
          "const inheritedBeaten = await store.heartbeat({ sessionId: inherited.sessionId, token: inherited.token });",
          "const witness = {",
          "  own: { sessionId: own.sessionId, token: own.token, acquiredHeartbeatAt: own.heartbeatAt, heartbeatAt: ownBeaten.heartbeatAt, expiresAt: ownBeaten.expiresAt },",
          "  reactivated: { sessionId: inherited.sessionId, token: inherited.token, heartbeatAt: inheritedBeaten.heartbeatAt, expiresAt: inheritedBeaten.expiresAt },",
          "};",
        ].join("\n"),
      });
      expect(reactivated.hostPid).toBe(successor.child.pid);
      expect(reactivated.own.sessionId).toBe("post-takeover");
      expect(reactivated.own.token).toBeTruthy();
      expect(Date.parse(reactivated.own.heartbeatAt)).toBeGreaterThan(Date.parse(reactivated.own.acquiredHeartbeatAt));
      expect(reactivated.reactivated.sessionId).toBe("scenario9-pty");
      expect(reactivated.reactivated.token).toBe(acquired.token);
      expect(Date.parse(reactivated.reactivated.heartbeatAt)).toBeGreaterThan(Date.parse(renewedAt));

      // INDEPENDENT re-read through the candidate's own store: the renewal of
      // the session the successor SERVES and the reactivation of the 0.98.4
      // lease must both be PERSISTED — same token, persisted
      // heartbeatAt/expiresAt, each lease tied to its session.
      const persistedSuccessor = await readPersistedLeases({ distRoot: candidateRoot!, leaseConfigHome, root });
      const ownRecord = persistedSuccessor.find((record) => record.sessionId === "post-takeover");
      expect(ownRecord, "the successor's own session lease must be persisted").toBeDefined();
      expect(ownRecord!.token).toBe(reactivated.own.token);
      expect(ownRecord!.holder).toBe("scenario9-supervisor-0.98.5");
      expect(ownRecord!.heartbeatAt, "the successor's renewal was returned but not persisted").toBe(reactivated.own.heartbeatAt);
      expect(ownRecord!.expiresAt, "the successor's renewal expiry was returned but not persisted").toBe(reactivated.own.expiresAt);
      const inheritedRecord = persistedSuccessor.find((record) => record.sessionId === "scenario9-pty");
      expect(inheritedRecord, "the reactivated 0.98.4 lease must be persisted").toBeDefined();
      expect(inheritedRecord!.token).toBe(acquired.token);
      expect(inheritedRecord!.heartbeatAt, "the reactivation was returned but not persisted").toBe(reactivated.reactivated.heartbeatAt);
      expect(inheritedRecord!.expiresAt, "the reactivation expiry was returned but not persisted").toBe(reactivated.reactivated.expiresAt);
    } finally {
      client?.close();
    }
  }, 240_000);

  it("should let a live 0.98.5 host be adopted by a 0.98.4 supervisor, with the older publisher leaving the socket intact", async () => {
    const root = createPrivateTestDirectory("u9ii-");
    directories.add(root);
    const socketPath = join(root, "native-terminal.sock");
    const registryPath = join(root, "registry.json");

    // The live 0.98.5 candidate host, from the installed candidate dist.
    const candidate = await spawnHostProcess({
      entry: candidateEntry!,
      socketPath,
      registryPath,
      generation: "candidate-0985-ii",
    });
    const client = await NativeTerminalClient.connect(socketPath);
    try {
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
      const adopter = spawn(process.execPath, ["--input-type=module", "--eval", adopterScript], {
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
    } finally {
      client.close();
    }
  }, 240_000);

  // Round-3 P2 finding: the scenario exercised application acquisition and
  // the store heartbeat, but never the supervision pass's own CPU decision
  // (tmux pane rate vs threshold). This test drives the CANDIDATE dist's real
  // decision end to end: one pass over two live panes of the SAME fixture
  // tmux server, one burning CPU in its pane, one idle — the working pane's
  // lease must be RENEWED by the pass, the idle pane's must NOT.
  it("should let the candidate's supervision pass beat a working pane's lease and only observe an idle one", async () => {
    const root = createPrivateTestDirectory("u9iii-");
    directories.add(root);
    const leaseConfigHome = join(root, "lease-config-home");
    mkdirSync(leaseConfigHome, { recursive: true });
    const burnSession = "u9-supervision-burn";
    const idleSession = "u9-supervision-idle";

    const witness = await runSupervisionClient<SupervisionWitness>({
      distRoot: candidateRoot!,
      leaseConfigHome,
      root,
      body: [
        "let witness;",
        "const pinned = [];",
        "const tmux = (args) => {",
        "  const result = spawnSync(\"tmux\", args, { encoding: \"utf8\" });",
        "  if (result.status !== 0) throw new Error(`tmux failed: ${JSON.stringify(args)} ${String(result.stderr)}`);",
        "  return String(result.stdout).trim();",
        "};",
        "try {",
        "  // A private fixture tmux server (TMUX_TMPDIR is redirected): the",
        "  // panes are explicit /bin/sh processes of this fixture, driven by",
        "  // keys — never the owner's default shell.",
        "  tmux([\"-f\", \"/dev/null\", \"new-session\", \"-d\", \"-s\", \"u9-supervision-burn\", \"/bin/sh\"]);",
        "  tmux([\"new-session\", \"-d\", \"-s\", \"u9-supervision-idle\", \"/bin/sh\"]);",
        "  tmux([\"send-keys\", \"-t\", \"u9-supervision-burn\", \"while :; do :; done\", \"Enter\"]);",
        "  tmux([\"send-keys\", \"-t\", \"u9-supervision-idle\", \"while :; do sleep 1; done\", \"Enter\"]);",
        "  const pinAgentPane = (sessionId) => {",
        "    const paneId = tmux([\"list-panes\", \"-s\", \"-t\", sessionId, \"-F\", \"#{pane_id}\"]);",
        "    if (!/^%\\d+$/.test(paneId)) throw new Error(`no pane id for ${sessionId}`);",
        "    tmux([\"set-option\", \"-t\", sessionId, \"@remote_agent_pane\", paneId]);",
        "    const panePid = Number(tmux([\"display-message\", \"-p\", \"-t\", sessionId, \"#{pane_pid}\"]));",
        "    if (!Number.isInteger(panePid) || panePid <= 0) throw new Error(`no pane pid for ${sessionId}`);",
        "    const procRoot = process.env.H2A_TEST_PROC_ROOT;",
        "    if (!procRoot) throw new Error(\"the supervision client must run under the private process view\");",
        "    // Pin this fixture's pane process into the private proc view (the",
        "    // same pin the isolation guard applies to guarded spawns), so the",
        "    // supervision pass's fleet /proc walk observes only fixture pids.",
        "    const fd = fs.openSync(`/proc/${panePid}`, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY);",
        "    fs.symlinkSync(`/proc/${process.pid}/fd/${fd}`, `${procRoot}/${panePid}`);",
        "    pinned.push(`${procRoot}/${panePid}`);",
        "    return paneId;",
        "  };",
        "  const burnPane = pinAgentPane(\"u9-supervision-burn\");",
        "  const idlePane = pinAgentPane(\"u9-supervision-idle\");",
        "  const enrollLeased = (sessionId, pane) => {",
        "    registryModule.enroll({",
        "      id: sessionId,",
        "      tool: \"codex\",",
        "      kind: \"local-tmux\",",
        `      cwd: ${JSON.stringify(root)},`,
        "      source: \"run\",",
        "      sessionClass: \"background\",",
        "      role: \"job\",",
        "      jobState: \"running\",",
        "      tmuxSession: sessionId,",
        "    });",
        "    const lease = runtime.acquireSessionLease(sessionId, {",
        "      holder: \"u9-supervision-0985\",",
        `      workspace: ${JSON.stringify(root)},`,
        "      agentPane: pane,",
        "    });",
        "    if (lease === undefined) throw new Error(`acquisition refused for ${sessionId}`);",
        "    return lease;",
        "  };",
        "  const burnLease = enrollLeased(\"u9-supervision-burn\", burnPane);",
        "  const idleLease = enrollLeased(\"u9-supervision-idle\", idlePane);",
        "  // The burning pane accumulates real CPU between the acquisition's",
        "  // baseline sample and the pass: the rate it computes is real work.",
        "  await new Promise((resolve) => setTimeout(resolve, 2_000));",
        "  const pass = runtime.superviseSessionLeases(registryModule.listJobs(), new Date().toISOString());",
        "  const store = new leaseModule.SessionLeaseStore(leaseModule.resolveSessionLeasePath(), { now: () => new Date().toISOString() });",
        "  const describeLease = (lease) => {",
        "    const after = store.forSession(lease.sessionId);",
        "    if (after === undefined) throw new Error(`lease missing after the pass: ${lease.sessionId}`);",
        "    return {",
        "      sessionId: lease.sessionId,",
        "      token: lease.token,",
        "      acquiredHeartbeatAt: lease.heartbeatAt,",
        "      acquiredSample: lease.sample,",
        "      heartbeatAt: after.heartbeatAt,",
        "      sample: after.sample,",
        "    };",
        "  };",
        "  witness = {",
        "    pass: {",
        "      beaten: pass.beaten,",
        "      observed: pass.observed,",
        "      released: pass.released,",
        "      unreadable: pass.unreadable,",
        "      proposals: pass.proposals,",
        "    },",
        "    burn: describeLease(burnLease),",
        "    idle: describeLease(idleLease),",
        "  };",
        "} finally {",
        "  try { tmux([\"kill-server\"]); } catch {}",
        "  for (const pin of pinned) { try { fs.unlinkSync(pin); } catch {} }",
        "}",
      ].join("\n"),
    });

    // THE decision: the working pane is beaten, the idle one only observed —
    // and nothing is unreadable, released or proposed.
    expect(witness.pass.beaten).toEqual([burnSession]);
    expect(witness.pass.observed).toEqual([idleSession]);
    expect(witness.pass.unreadable).toEqual([]);
    expect(witness.pass.released).toEqual([]);
    expect(witness.pass.proposals).toEqual([]);
    // The working lease was RENEWED by the pass, on a real CPU rate: its
    // baseline sample moved to a strictly higher reading.
    expect(Date.parse(witness.burn.heartbeatAt))
      .toBeGreaterThan(Date.parse(witness.burn.acquiredHeartbeatAt));
    expect(witness.burn.sample.cpuMs).toBeGreaterThan(witness.burn.acquiredSample.cpuMs);
    // The idle lease was NOT renewed — the abandonment clock keeps running —
    // but its CPU reading was still recorded.
    expect(witness.idle.heartbeatAt).toBe(witness.idle.acquiredHeartbeatAt);
    expect(Date.parse(witness.idle.sample.sampledAt))
      .toBeGreaterThan(Date.parse(witness.idle.acquiredSample.sampledAt));

    // INDEPENDENT re-read through the candidate's own store: what the pass
    // did must be PERSISTED, not merely returned — the renewal on one side,
    // the non-renewal on the other.
    const persisted = await readPersistedLeases({ distRoot: candidateRoot!, leaseConfigHome, root });
    const burnRecord = persisted.find((record) => record.sessionId === burnSession);
    expect(burnRecord, "the beaten lease must be persisted").toBeDefined();
    expect(burnRecord!.holder).toBe("u9-supervision-0985");
    expect(burnRecord!.heartbeatAt, "the pass's renewal was returned but not persisted").toBe(witness.burn.heartbeatAt);
    expect(burnRecord!.sample?.cpuMs, "the beat's CPU reading was returned but not persisted").toBe(witness.burn.sample.cpuMs);
    const idleRecord = persisted.find((record) => record.sessionId === idleSession);
    expect(idleRecord, "the observed lease must be persisted").toBeDefined();
    expect(idleRecord!.holder).toBe("u9-supervision-0985");
    expect(idleRecord!.heartbeatAt, "an under-threshold pane must not have its lease renewed").toBe(witness.idle.acquiredHeartbeatAt);
    expect(idleRecord!.sample?.sampledAt, "the observe reading was returned but not persisted").toBe(witness.idle.sample.sampledAt);
  }, 120_000);
});
