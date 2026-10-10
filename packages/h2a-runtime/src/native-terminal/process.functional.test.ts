import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { chmod, mkdtemp, readFile, readdir, readlink, rm, stat, unlink } from "node:fs/promises";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { persistNativeTerminalPgid, readNativeTerminalPgid } from "../registry.js";
import { NativeTerminalClient } from "./client.js";
import {
  NATIVE_TERMINAL_FORCE_KILL_TIMEOUT_MS,
  NativeTerminalHost,
  readProcessStartTime,
  reconcileDeadHostOrphans,
  type NativeTerminalReapOutcome,
} from "./host.js";
import {
  NativeTerminalContainmentError,
  NativeTerminalHostSupervisor,
  type NativeTerminalHostSpawn,
} from "./supervisor.js";
import {
  NATIVE_TERMINAL_HEALTH_TIMEOUT_MS,
  NATIVE_TERMINAL_MAX_FRAME_BYTES,
} from "./protocol.js";

const children = new Set<ChildProcess>();
const directories = new Set<string>();
// PTY process groups a test deliberately leaves unreaped (an injected reap
// that always refuses). The group survives its host by design there, so this
// suite — not the production reaper — owns its cleanup, including when an
// assertion aborts the test before its own teardown.
const processGroups = new Set<number>();

afterEach(async () => {
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    if (child.exitCode === null && child.signalCode === null) await once(child, "exit");
  }
  children.clear();
  for (const pgid of processGroups) {
    try {
      process.kill(-pgid, "SIGKILL");
    } catch {
      // Already empty; nothing of this test's making is left to collect.
    }
  }
  processGroups.clear();
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

/**
 * Wait for a host child to exit, with an explicit deadline. `once(child,
 * "exit")` alone is the one open-ended wait in a shutdown scenario: a host
 * that hangs mid-shutdown reports as an anonymous "Test timed out", which
 * names neither the step nor the process. Name it instead.
 */
async function exitWithin(
  child: ChildProcess,
  timeoutMs: number,
): Promise<[number | null, NodeJS.Signals | null]> {
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), timeoutMs);
  try {
    return await once(child, "exit", { signal: deadline.signal }) as [
      number | null,
      NodeJS.Signals | null,
    ];
  } catch (error) {
    if (!deadline.signal.aborted) throw error;
    throw new Error(
      `native terminal host pid=${child.pid} did not exit within ${timeoutMs}ms`,
    );
  } finally {
    clearTimeout(timer);
  }
}

function running(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

type ProcessObservation = Readonly<{
  pid: number;
  state?: string;
  parentPid?: number;
  processGroup?: number;
  session?: number;
  missing?: boolean;
  error?: string;
}>;

async function processObservation(pid: number): Promise<ProcessObservation> {
  try {
    const raw = await readFile(`/proc/${pid}/stat`, "utf8");
    const commandEnd = raw.lastIndexOf(")");
    const fields = raw.slice(commandEnd + 2).split(" ");
    return {
      pid,
      state: fields[0],
      parentPid: Number(fields[1]),
      processGroup: Number(fields[2]),
      session: Number(fields[3]),
    };
  } catch (error) {
    return {
      pid,
      missing: (error as NodeJS.ErrnoException).code === "ENOENT",
      error: String(error),
    };
  }
}

async function processGroupMemberPids(processGroup: number): Promise<number[]> {
  const observations = await Promise.all(
    (await readdir("/proc"))
      .filter((entry) => /^\d+$/.test(entry))
      .map((entry) => processObservation(Number(entry))),
  );
  return observations
    .filter((observation) => observation.processGroup === processGroup)
    .map((observation) => observation.pid)
    .sort((left, right) => left - right);
}

async function directChildren(pid: number): Promise<number[]> {
  const raw = await readFile(`/proc/${pid}/task/${pid}/children`, "utf8");
  return raw.trim().length === 0 ? [] : raw.trim().split(/\s+/).map(Number);
}

/** Ping whoever currently serves `socketPath`, and leave no connection open. */
async function pingSocket(socketPath: string): Promise<number> {
  const probe = await NativeTerminalClient.connect(socketPath, {
    connectTimeoutMs: 1_000,
    requestTimeoutMs: 1_000,
  });
  try {
    return (await probe.ping()).hostPid;
  } finally {
    probe.close();
  }
}

/**
 * Durably record one native-terminal row attributed to `socketPath` whose
 * owning host is PROVEN dead, without creating any PTY at all: a real process
 * is started, its real /proc start-time recorded, and then killed, so
 * `defaultOwnerHostProbe` proves it dead from real evidence. The pgid the row
 * carries is that same (already-gone) pid, so no signal could reach anything
 * even if something tried — every reap in the tests using this is injected.
 */
async function persistProvenDeadOwnerRow(
  sessionId: string,
  socketPath: string,
  registryPath: string,
): Promise<number> {
  const owner = spawn(process.execPath, ["-e", "setTimeout(() => {}, 200)"]);
  const ownerPid = owner.pid!;
  const startTime = await eventually(
    () => readProcessStartTime(ownerPid),
    (value) => typeof value === "number",
  );
  owner.kill("SIGKILL");
  await once(owner, "exit");
  persistNativeTerminalPgid(sessionId, ownerPid, registryPath, {
    pid: ownerPid,
    startTime,
    socketPath,
  });
  return ownerPid;
}

/**
 * An injected reap that always refuses (so the durable row is never pruned),
 * but whose refusal carries BLOCKING evidence — a cause taken over a group
 * observed alive — only on the reconcile passes `blocks` selects. Every other
 * pass returns a CAUSE-LESS refusal, the absence of information a supervisor
 * racing another one sees, which deliberately does not block.
 *
 * Which pass blocks is the whole point of the two regressions below: a
 * containment verdict must be surfaced by the pass that produced it, never
 * downgraded into "the host is not ready yet" and then re-decided by a later,
 * weaker pass.
 */
function injectedRefusals(blocks: (passNumber: number) => boolean): {
  reapOrphan: (sessionId: string) => Promise<NativeTerminalReapOutcome>;
  calls: string[];
} {
  const calls: string[] = [];
  return {
    calls,
    reapOrphan: async (sessionId: string) => {
      calls.push(sessionId);
      return blocks(calls.length)
        ? {
            sessionId,
            status: "refused" as const,
            reason: "injected refusal over a group observed alive",
            cause: "membership-unprovable" as const,
          }
        : {
            sessionId,
            status: "refused" as const,
            reason: `no pgid recorded for terminal session ${sessionId}`,
          };
    },
  };
}

async function createStubbornWorkload(
  client: NativeTerminalClient,
  id: string,
  directory: string,
): Promise<number[]> {
  const session = await client.create({
    id,
    command: "/bin/sh",
    args: [
      "-c",
      `trap '' HUP TERM INT; /bin/sh -c "trap '' HUP TERM INT; while :; do sleep 1; done" & h2a_descendant=$!; printf '${id}-ready:%s\\r\\n' "$h2a_descendant"; while :; do sleep 1; done`,
    ],
    cwd: directory,
    env: { PATH: process.env.PATH ?? "/usr/bin:/bin", TERM: "xterm-256color" },
    cols: 80,
    rows: 24,
  });
  const output = await eventually(
    () => client.readOutput(id, 0),
    (replay) => replay.chunks.some((chunk) =>
      chunk.data.includes(`${id}-ready:`)
    ),
  );
  const match = output.chunks.map((chunk) => chunk.data).join("")
    .match(new RegExp(`${id}-ready:(\\d+)`));
  if (!match) throw new Error("stubborn PTY did not report its descendant");
  const targetChildren = await eventually(
    () => directChildren(session.pid),
    (pids) => pids.length === 1,
  );
  return [session.pid, targetChildren[0]!, Number(match[1])];
}

/*
 * Bounded waits the real-host scenarios below are budgeted from. A scenario
 * that boots real hosts sets its own test timeout to the SUM of the bounded
 * waits it performs, so a slow but healthy run never ends in vitest's implicit
 * "Test timed out in 5000ms" — a verdict that names no step and preempts the
 * supervisor's own diagnostic for the very failure the scenario exists to show.
 */

/**
 * The `startupTimeoutMs` every scenario pins for a REAL host start
 * (`node --import tsx process.ts`: spawn, tsx transform, node-pty binding,
 * listen, first ping) — equal to the supervisor's production default, and
 * never shared with a phase that WANTS a short deadline (a hung child that must
 * miss readiness): one budget cannot be short for one phase and realistic for
 * the other.
 *
 * Measured spawn -> first successful ping, the probe pinned to ONE core shared
 * with N busy-loop hogs (N+1 runnable tasks), 15 sequential boots each:
 *
 *   runnable tasks/core   Node 22 mean (max)   Node 20 mean (max)
 *   1 (idle)              247 ms (323)         200 ms (359)
 *   4                     806 ms (846)         508 ms (524)
 *   6                     1225 ms (1271)       741 ms (785)
 *   8                     1613 ms (1725)       992 ms (1030)
 *
 * A start costs ~200 ms of CPU on Node 22 and its wall time grows linearly
 * with the runnable tasks on its core (the graceful-shutdown scenario measured
 * ~4.7 s at 24x oversubscription, the same slope). A 1 s budget is therefore
 * exceeded from ~5 runnable tasks per core on; 5 s holds up to ~24, and is
 * 2.9x the worst sample above.
 */
const HOST_STARTUP_BUDGET_MS = 5_000;
/**
 * `supervisor.client()` can overrun its startup deadline by the work of one
 * last readiness iteration: a connect + ping pair, each bounded by
 * NATIVE_TERMINAL_HEALTH_TIMEOUT_MS, plus the containment reconcile pass an
 * adoption runs. That pass is bounded by the force-kill timeout only when it
 * actually REAPS a group (see FORCED_REAP_BUDGET_MS); otherwise it is registry
 * reads.
 */
const CLIENT_OVERRUN_BUDGET_MS = 2 * NATIVE_TERMINAL_HEALTH_TIMEOUT_MS;
/**
 * A containment pass that reaps a real group waits for the OS to report it
 * empty for at most the reconcile host's force-kill timeout, then reports
 * `reap-timed-out`. Budgeted in full wherever a scenario reaps: a group that
 * survives its kill is exactly what those scenarios exist to catch, and its
 * survivor diagnostic only exists once that timeout has elapsed.
 */
const FORCED_REAP_BUDGET_MS = NATIVE_TERMINAL_FORCE_KILL_TIMEOUT_MS;
/** One `eventually()` wait: 200 attempts x 10 ms, plus the work per attempt. */
const EVENTUALLY_BUDGET_MS = 2_000;
/**
 * The `spawnTerminationGraceMs` pinned by the scenarios that reap an owned
 * child: SIGTERM, then SIGKILL, each waited for at most this long.
 */
const SPAWN_TERMINATION_GRACE_MS = 100;

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
      registryPath: join(directory, "registry.json"),
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

  // How long the reaper below waits for a host it SIGSTOPped: that host can
  // never answer, so this window only has to expire.
  const STOPPED_HOST_STARTUP_MS = 500;
  // This scenario chains three real host starts, two real group reaps and a
  // reaper phase against a stopped host. It ran on vitest's implicit 5 s
  // default, which a healthy run exceeds at 4 vitest instances per core
  // (measured, Node 22: 3.0 s idle; 5.9-6.8 s over 20 green runs there, where
  // all 20 runs on the 5 s default had failed): the only failure it then
  // reports is "Test timed out", never the supervisor's own diagnostic. Its budget is the sum of the
  // bounded waits it performs, in order, and nothing else:
  //  1. first host start — S + O;
  //  2. its stubborn workload — two eventually() waits;
  //  3. the takeover after the hard death: the containment pass REAPS the
  //     hard-crash group (F), then a replacement start (S), with one overrun
  //     for the iteration that observed the death and one for the
  //     replacement's own loop (2 O);
  //  4. the replacement's stubborn workload — two eventually() waits;
  //  5. the reaper against the SIGSTOPped host: a health probe (connect +
  //     ping, = O) before and one inside its startup window, then SIGTERM and
  //     SIGKILL, each waited for at most the termination grace;
  //  6. cleanup: the containment pass REAPS the forced-reap group (F), then a
  //     fresh host start (S + O).
  // (S = HOST_STARTUP_BUDGET_MS, O = CLIENT_OVERRUN_BUDGET_MS,
  // F = FORCED_REAP_BUDGET_MS.) F dominates and is kept in full: a group that
  // outlives its kill is the regression this scenario exists to catch, and
  // the survivor list naming it is only reported once F has elapsed.
  const HARD_DEATH_BUDGET_MS =
    3 * HOST_STARTUP_BUDGET_MS +
    6 * CLIENT_OVERRUN_BUDGET_MS +
    2 * FORCED_REAP_BUDGET_MS +
    4 * EVENTUALLY_BUDGET_MS +
    STOPPED_HOST_STARTUP_MS +
    2 * SPAWN_TERMINATION_GRACE_MS +
    1_000;

  it("should kill a signal-resistant PTY tree after hard host death and forced host reaping", async () => {
    const directory = await mkdtemp(join(tmpdir(), "h2a-native-terminal-parent-death-"));
    directories.add(directory);
    const socketPath = join(directory, "host.sock");
    const entry = fileURLToPath(new URL("./process.ts", import.meta.url));
    let spawnCount = 0;
    const spawnedHosts: ChildProcess[] = [];
    const generations = ["parent-death-hard", "parent-death-reap"];
    const reconcileLogs: string[] = [];
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
        ...(options.registryPath !== undefined ? ["--registry-path", options.registryPath] : []),
      ], {
        cwd: dirname(entry),
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      children.add(child);
      spawnedHosts.push(child);
      return child;
    };
    const supervisor = new NativeTerminalHostSupervisor({
      socketPath,
      registryPath: join(directory, "registry.json"),
      replayBytesPerSession: 1024,
      // Pinned, not inherited: the test budget is derived from these numbers.
      startupTimeoutMs: HOST_STARTUP_BUDGET_MS,
      spawnTerminationGraceMs: SPAWN_TERMINATION_GRACE_MS,
      log: (line) => reconcileLogs.push(line),
      generationFactory: () => generations[spawnCount] ?? `unexpected-${spawnCount}`,
      spawnHost,
    });

    const first = await supervisor.client();
    const firstPing = await first.ping();
    const hardCrashPids = await createStubbornWorkload(
      first,
      "hard-crash-tree",
      directory,
    );
    const hardCrashPgid = hardCrashPids[0]!;
    supervisor.disconnect();
    // The missing socket makes the takeover clear its existing connection
    // before the host death is observed. The queued hard death then lands in
    // the startup poll, the lifecycle edge this test must cover.
    await unlink(socketPath);
    setTimeout(() => process.kill(firstPing.hostPid, "SIGKILL"), 0);
    // A parent-death signal can kill the guardian before its shell trap has
    // broadcast to the group. The supervisor therefore treats the next
    // takeover of this health-checked, known-dead host as containment work:
    // client() returns only after the durable pgid has been reaped (or it
    // fails rather than starting a replacement over live descendants).
    const replacement = await supervisor.client();
    expect(await processGroupMemberPids(hardCrashPgid)).toEqual([]);
    const hardCrashStates = await Promise.all(hardCrashPids.map(processObservation));
    expect(hardCrashStates.every((state) => state.missing === true)).toBe(true);
    const replacementPing = await replacement.ping();
    expect(replacementPing.hostPid).not.toBe(firstPing.hostPid);
    expect(spawnCount).toBe(2);
    const forcedReapPids = await createStubbornWorkload(
      replacement,
      "forced-reap-tree",
      directory,
    );
    const forcedReapPgid = forcedReapPids[0]!;

    // Reproduce the leaderless-group shape without relying on the guardian's
    // parent-death trap: kill only the group leader. Its stubborn descendants
    // remain in the durable pgid, but Linux may reparent them to PID 1 OR to a
    // subreaper. That implementation detail is deliberately not a test
    // synchronization point: the forced-reap path below must reach them by
    // pgid and prove the group empty itself.
    process.kill(forcedReapPgid, "SIGKILL");
    supervisor.disconnect();
    process.kill(replacementPing.hostPid, "SIGSTOP");
    const reaper = new NativeTerminalHostSupervisor({
      socketPath,
      registryPath: join(directory, "registry.json"),
      replayBytesPerSession: 1024,
      startupTimeoutMs: STOPPED_HOST_STARTUP_MS,
      spawnTerminationGraceMs: SPAWN_TERMINATION_GRACE_MS,
      log: (line) => reconcileLogs.push(line),
      generationFactory: () => "parent-death-reap-timeout",
      spawnHost: () => spawnedHosts[1]!,
    });
    await expect(reaper.client()).rejects.toThrow(/did not become ready/i);
    const cleanupSupervisor = new NativeTerminalHostSupervisor({
      socketPath,
      registryPath: join(directory, "registry.json"),
      replayBytesPerSession: 1024,
      startupTimeoutMs: HOST_STARTUP_BUDGET_MS,
      spawnTerminationGraceMs: SPAWN_TERMINATION_GRACE_MS,
      log: (line) => reconcileLogs.push(line),
      generationFactory: () => "parent-death-cleanup",
      spawnHost,
    });
    await cleanupSupervisor.client();

    // This must already be empty when cleanup startup returns: the reaper
    // killed the stopped host, then cleanup reconciliation used the durable
    // pgid for kill(-pgid,
    // SIGKILL) and waited for kill(-pgid, 0) to return ESRCH. That reaches
    // descendants whether they reparented to init or to a subreaper.
    expect(running(replacementPing.hostPid)).toBe(false);
    expect(await processGroupMemberPids(forcedReapPgid)).toEqual([]);
    const forcedReapStates = await Promise.all(forcedReapPids.map(processObservation));
    expect(forcedReapStates.every((state) => state.missing === true)).toBe(true);
    expect(
      reconcileLogs.some(
        (line) =>
          line.includes(`pgid=${forcedReapPgid}`) &&
          line.includes("emitted group SIGKILL") &&
          line.includes("(orphan forced-reap-tree)"),
      ),
    ).toBe(true);
    // The leader is absent, so reaching the group kill above requires the
    // token membership proof. This proves the recycled-PGID fence remained
    // active without refusing and leaking this verified real orphan.
    expect(
      reconcileLogs.some(
        (line) =>
          line.includes("cause=token-verified") &&
          line.includes("sessionId=forced-reap-tree") &&
          line.includes(`pgid=${forcedReapPgid}`),
      ),
    ).toBe(true);
    expect(reaper.spawnedPid).toBeUndefined();
    expect(spawnCount).toBe(3);

    // INV-4 no-block assertion: the NEW group-leader-identity guard sits
    // directly in front of the reap this test's "hard-crash-tree" entry
    // goes through (see the takeover's reconcileDeadHostOrphans pass,
    // triggered above by `const replacement = await supervisor.client()`).
    // Prove the fix did not reinstate the leak it exists to prevent: the
    // guard must never have REFUSED a kill (neither "recycled" nor
    // "leader-absent") anywhere in this whole hard-death-then-takeover
    // flow — the real death confirmed above must not be surviving DESPITE
    // the guard, it must not have been blocked BY it either.
    expect(
      reconcileLogs.some((line) => /REFUSING to (kill|act on) process group/.test(line)),
    ).toBe(false);
  }, HARD_DEATH_BUDGET_MS);

  it("should refuse reconciliation when the fresh PGID lookup differs from its immutable snapshot", async () => {
    const directory = await mkdtemp(join(tmpdir(), "h2a-native-terminal-immutable-pgid-"));
    directories.add(directory);
    const socketPath = join(directory, "host.sock");
    const registryPath = join(directory, "registry.json");
    const entry = fileURLToPath(new URL("./process.ts", import.meta.url));
    const supervisor = new NativeTerminalHostSupervisor({
      socketPath,
      registryPath,
      replayBytesPerSession: 1024,
      generationFactory: () => "immutable-pgid-generation",
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
          ...(options.registryPath !== undefined ? ["--registry-path", options.registryPath] : []),
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
    const intended = await client.create({
      id: "immutable-pgid-session",
      command: "/bin/sh",
      args: ["-c", "trap '' HUP TERM INT; while :; do sleep 1; done"],
      cwd: directory,
      env: { PATH: process.env.PATH ?? "/usr/bin:/bin", TERM: "xterm-256color" },
      cols: 80,
      rows: 24,
    });
    const distractor = spawn(
      "/bin/sh",
      ["-c", "trap '' HUP TERM INT; while :; do sleep 1; done"],
      { detached: true, stdio: "ignore" },
    );
    children.add(distractor);
    if (distractor.pid === undefined) throw new Error("expected distractor pid");
    const distractorPgid = distractor.pid;
    await eventually(() => running(distractorPgid), (alive) => alive);

    // The owner probe runs after reconciliation has snapshotted the intended
    // row. Repointing the mutable row here makes the old default closure kill
    // the distractor, while the hardened closure must refuse before signalling.
    const summary = await reconcileDeadHostOrphans({
      registryPath,
      ownerProbe: (owner) => {
        persistNativeTerminalPgid(
          "immutable-pgid-session",
          distractorPgid,
          registryPath,
          owner,
        );
        return "dead";
      },
    });

    expect(summary).toEqual({
      status: "completed",
      outcomes: [
        expect.objectContaining({
          sessionId: "immutable-pgid-session",
          status: "reap-refused",
          pgid: intended.pid,
          reason: expect.stringMatching(/immutable snapshot pgid/i),
        }),
      ],
    });
    expect(running(intended.pid)).toBe(true);
    expect(running(distractorPgid)).toBe(true);

    const lease = await client.acquireController(
      "immutable-pgid-session",
      "immutable-pgid-cleanup",
    );
    await client.stop(lease, "SIGKILL");
    await eventually(() => running(intended.pid), (alive) => !alive);
    distractor.kill("SIGKILL");
    await once(distractor, "exit");
  });

  it("should re-read a row rewritten under a reconcile pass instead of blocking on the snapshot mismatch", async () => {
    // `pgid-mismatch` is the ONE refusal cause taken before any liveness probe:
    // `reapOrphan` compares the pass's immutable snapshot with the row it
    // re-resolves and refuses on any difference, having observed no group at
    // all. Treating that as "a PTY group outlived its host" would contain a
    // whole socket over a row that no longer exists — here the row belongs to a
    // LIVE host again, because a same-id session was recreated in between.
    //
    // The re-read decides only whether anything is still owed. It never becomes
    // the pgid to act on: see "should refuse reconciliation when the fresh PGID
    // lookup differs from its immutable snapshot" above, which holds that line.
    const directory = await mkdtemp(join(tmpdir(), "h2a-native-terminal-rewritten-row-"));
    directories.add(directory);
    const registryPath = join(directory, "registry.json");
    const deadOwnerPid = await persistProvenDeadOwnerRow(
      "rewritten-session",
      join(directory, "host.sock"),
      registryPath,
    );

    const liveOwnerStartTime = readProcessStartTime(process.pid);
    let probes = 0;
    const reapCalls: Array<{ sessionId: string; pgid: number }> = [];
    const summary = await reconcileDeadHostOrphans({
      registryPath,
      ownerProbe: (owner) => {
        probes += 1;
        if (probes === 1) {
          // Between this pass's snapshot and the reap's own lookup, a live host
          // recreates a session under the same id — the only way a row is ever
          // rewritten.
          persistNativeTerminalPgid("rewritten-session", 5_353, registryPath, {
            pid: process.pid,
            ...(liveOwnerStartTime === undefined ? {} : { startTime: liveOwnerStartTime }),
          });
          return "dead";
        }
        // The re-read row names this very test process: alive, and provably so.
        expect(owner.pid).toBe(process.pid);
        return "alive";
      },
      // Mirrors reapOrphan's own immutable-snapshot check, without signalling.
      reap: async (sessionId, pgid) => {
        reapCalls.push({ sessionId, pgid });
        const lookup = readNativeTerminalPgid(sessionId, registryPath);
        if (lookup.status === "resolved" && lookup.pgid !== pgid) {
          return {
            sessionId,
            status: "refused",
            reason: `immutable snapshot pgid=${pgid} differs from re-resolved pgid=${lookup.pgid}`,
            cause: "pgid-mismatch",
          };
        }
        return { sessionId, status: "reaped", pgid, elapsedMs: 0 };
      },
    });

    expect(summary).toEqual({
      status: "completed",
      outcomes: [
        { sessionId: "rewritten-session", status: "skipped-alive", ownerPid: process.pid },
      ],
    });
    // One reap attempt, against the SNAPSHOT pgid only: the rewritten pgid is
    // never handed to a reap by this pass.
    expect(reapCalls).toEqual([{ sessionId: "rewritten-session", pgid: deadOwnerPid }]);
    // And the row a live host now owns is left exactly as that host wrote it.
    expect(readNativeTerminalPgid("rewritten-session", registryPath)).toMatchObject({
      status: "resolved",
      pgid: 5_353,
    });
  });

  it("should let a FRESH host — one that never knew the session — reap it from its durably persisted pgid after brutal host death", async () => {
    const directory = await mkdtemp(join(tmpdir(), "h2a-native-terminal-fresh-reap-"));
    directories.add(directory);
    const socketPath = join(directory, "host.sock");
    const registryPath = join(directory, "registry.json");
    const entry = fileURLToPath(new URL("./process.ts", import.meta.url));
    const supervisor = new NativeTerminalHostSupervisor({
      socketPath,
      replayBytesPerSession: 1024,
      registryPath,
      generationFactory: () => "fresh-reap-owning-host",
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
          ...(options.registryPath !== undefined
            ? ["--registry-path", options.registryPath]
            : []),
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
    const ping = await client.ping();
    const orphanPids = await createStubbornWorkload(
      client,
      "brutal-orphan-tree",
      directory,
    );

    // Brutal, unclean host death: no graceful shutdown, no chance for the
    // owning host to ever run its own forceStopAll.
    process.kill(ping.hostPid, "SIGKILL");
    await eventually(
      () => processObservation(ping.hostPid),
      (state) => state.missing === true,
    );

    // A FRESH host: constructed directly, never spawned, never talked to the
    // dead host — it has NO in-memory record of "brutal-orphan-tree" at all.
    // Its ONLY way to reap the tree is the durably persisted pgid, read from
    // the SAME registry file the dead host wrote to at session creation.
    const freshHost = new NativeTerminalHost({
      generation: "fresh-reap-fresh-host",
      replayBytesPerSession: 1024,
      spawner: () => {
        throw new Error("the fresh host in this test must never spawn a pty");
      },
      registryPath,
    });

    const outcome = await freshHost.reapOrphan("brutal-orphan-tree", "SIGKILL");
    expect(outcome).toMatchObject({
      sessionId: "brutal-orphan-tree",
      status: "reaped",
    });

    const states = await Promise.all(orphanPids.map(processObservation));
    expect(states.every((state) => state.missing === true)).toBe(true);
  });

  it("should let reapOrphan collect a real orphan whose leader is gone but a live descendant survives it (group-token path)", async () => {
    // THE invariant this whole token-anchor design exists for (arch-stamped:
    // "the point"). The ORDINARY leak is not exotic: a shell that exits
    // NORMALLY leaving a backgrounded descendant (`cmd &` then the shell
    // ends) — leader gone, group alive, NO containment (pdeathsig) ever
    // triggered, because pdeathsig only fires when the HOST dies, not when
    // the leader itself is killed directly. reapOrphan is the net for
    // exactly this orphan; the leader-start-time-only guard refused it
    // (cause=leader-absent) and defeated the whole mechanism. This test
    // constructs that exact shape and requires the group-carried session
    // token to close it: PROCEED and KILL, not refuse.
    const directory = await mkdtemp(join(tmpdir(), "h2a-native-terminal-leader-dead-"));
    directories.add(directory);
    const socketPath = join(directory, "host.sock");
    const registryPath = join(directory, "registry.json");
    const entry = fileURLToPath(new URL("./process.ts", import.meta.url));
    const supervisor = new NativeTerminalHostSupervisor({
      socketPath,
      replayBytesPerSession: 1024,
      registryPath,
      generationFactory: () => "leader-dead-owning-host",
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
          ...(options.registryPath !== undefined
            ? ["--registry-path", options.registryPath]
            : []),
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
    const orphanPids = await createStubbornWorkload(
      client,
      "leader-dead-orphan",
      directory,
    );
    const [leaderPid, childPid, grandchildPid] = orphanPids;

    // Kill ONLY the group leader (pid === pgid, the pty guardian) DIRECTLY
    // — never `-leaderPid` (that would be the group kill this test exists
    // to prove works WITHOUT), and never the owning host (that would
    // trigger the pdeathsig containment this test must NOT rely on: it
    // fires on ANY host death and would collect this orphan by an entirely
    // different mechanism, hiding whether the token path itself works).
    process.kill(leaderPid, "SIGKILL");
    await eventually(
      () => processObservation(leaderPid),
      (state) => state.missing === true,
    );
    // The descendants must be CONFIRMED alive right now — proving this
    // really is a live orphan, not something already collected.
    const survivorsBefore = await Promise.all(
      [childPid, grandchildPid].map(processObservation),
    );
    expect(survivorsBefore.every((state) => state.missing !== true)).toBe(true);

    // A FRESH host — never spawned, never talked to the (still-alive)
    // owning host — reaps purely from the durably persisted registry row.
    // The owning host's own liveness is irrelevant to reapOrphan's
    // contract; this isolates the invariant under test.
    const freshHost = new NativeTerminalHost({
      generation: "leader-dead-fresh-host",
      replayBytesPerSession: 1024,
      spawner: () => {
        throw new Error("the fresh host in this test must never spawn a pty");
      },
      registryPath,
    });

    const outcome = await freshHost.reapOrphan("leader-dead-orphan", "SIGKILL");
    expect(outcome).toMatchObject({
      sessionId: "leader-dead-orphan",
      status: "reaped",
      verified: true,
    });
    // For the RIGHT reason: the leader was confirmed gone above, so this
    // can only have proceeded via the group-carried session token, never
    // the leader-start-time fast path.
    expect(freshHost.pgidGuardCounters).toMatchObject({ tokenVerified: 1 });

    const finalStates = await Promise.all(orphanPids.map(processObservation));
    expect(finalStates.every((state) => state.missing === true)).toBe(true);
  });

  // This scenario's wall clock is dominated by work none of its assertions
  // measure: TWO complete host startups — each a `node --import tsx` boot
  // plus node-pty's native binding, all of it spent before the host runs its
  // first line — around one bounded host shutdown. Measured on this suite:
  // ~0.11s per startup on an idle box, ~0.45s at 2.5x cpu oversubscription,
  // ~0.75s at 4x, ~4.7s at 24x. The shutdown itself is flat at ~0.58s at
  // every load (the PTY ignores SIGTERM by design, so process.ts always
  // spends its full graceful drain before escalating to the group SIGKILL).
  //
  // vitest's implicit 5s default was therefore SMALLER than the budget the
  // supervisor is allowed for ONE of the two startups it awaits. A host that
  // was merely booting slowly on a loaded runner — not failing — produced
  // "Test timed out in 5000ms": a verdict that names no step and preempts
  // the supervisor's own startup diagnostic. Bound each wait explicitly and
  // derive the test budget from those bounds (HOST_STARTUP_BUDGET_MS and
  // CLIENT_OVERRUN_BUDGET_MS above). Nothing below waits unbounded. This
  // scenario has no proven-dead owner at all (one live host, then its own
  // graceful stop), so its containment passes are registry reads: no
  // FORCED_REAP_BUDGET_MS term.
  //
  // process.ts drains for at most GRACEFUL_DRAIN_MS + FORCED_DRAIN_MS
  // (500 + 500) around the group SIGKILL, whose confirmation poll measured
  // ~55ms for this single-process group.
  const HOST_SHUTDOWN_BUDGET_MS = 3_000;
  // Worst case of every bounded wait of this scenario, and nothing else: no
  // term here stands for an unbounded wait. Its three `eventually()` waits are
  // the pty output, the session death and the socket removal.
  const GRACEFUL_SHUTDOWN_BUDGET_MS =
    2 * (HOST_STARTUP_BUDGET_MS + CLIENT_OVERRUN_BUDGET_MS) +
    HOST_SHUTDOWN_BUDGET_MS +
    3 * EVENTUALLY_BUDGET_MS +
    1_000;

  it("should stop its PTYs and remove its socket on graceful host shutdown", async () => {
    const directory = await mkdtemp(join(tmpdir(), "h2a-native-terminal-shutdown-"));
    directories.add(directory);
    const socketPath = join(directory, "host.sock");
    const registryPath = join(directory, "registry.json");
    const entry = fileURLToPath(new URL("./process.ts", import.meta.url));
    let child: ChildProcess | undefined;
    const supervisor = new NativeTerminalHostSupervisor({
      socketPath,
      registryPath,
      replayBytesPerSession: 1024,
      // Pinned, not inherited: the test budget above is derived from this
      // number, so it must not drift with the supervisor's default.
      startupTimeoutMs: HOST_STARTUP_BUDGET_MS,
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
          ...(options.registryPath !== undefined ? ["--registry-path", options.registryPath] : []),
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
    const [code, signal] = await exitWithin(child!, HOST_SHUTDOWN_BUDGET_MS);
    expect({ code, signal }).toEqual({ code: 0, signal: null });
    await eventually(() => running(session.pid), (alive) => !alive);
    await eventually(
      () => stat(socketPath).then(() => true, (error: NodeJS.ErrnoException) => error.code !== "ENOENT"),
      (exists) => !exists,
    );
    // A host that shut down cleanly proved this session's group dead on its way
    // out (the pty ignores SIGTERM, so the drain escalates to forceStopAll), so
    // it leaves NO durable row behind. Stale rows are what a later host death
    // re-examines against whatever holds their pgid NUMBER by then.
    expect(readNativeTerminalPgid("graceful", registryPath)).toEqual({
      status: "unresolved",
      reason: expect.stringMatching(/no pgid recorded/i),
    });
    const restarted = await supervisor.client();
    expect(supervisor.spawnedPid).not.toBe(stoppedHostPid);
    expect(await restarted.ping()).toMatchObject({ generation: "restart-generation" });
  }, GRACEFUL_SHUTDOWN_BUDGET_MS);

  it("should let the owning controller escalate a real stubborn PTY from TERM to KILL", async () => {
    const directory = await mkdtemp(join(tmpdir(), "h2a-native-terminal-escalate-"));
    directories.add(directory);
    const socketPath = join(directory, "host.sock");
    const entry = fileURLToPath(new URL("./process.ts", import.meta.url));
    const supervisor = new NativeTerminalHostSupervisor({
      socketPath,
      registryPath: join(directory, "registry.json"),
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
          ...(options.registryPath !== undefined ? ["--registry-path", options.registryPath] : []),
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
      registryPath: join(directory, "registry.json"),
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
          ...(options.registryPath !== undefined ? ["--registry-path", options.registryPath] : []),
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
      registryPath: join(directory, "registry.json"),
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
          ...(options.registryPath !== undefined ? ["--registry-path", options.registryPath] : []),
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

  it("should drop a slow pipelined client without affecting another real PTY", async () => {
    const directory = await mkdtemp(join(tmpdir(), "h2a-native-terminal-backpressure-"));
    directories.add(directory);
    const socketPath = join(directory, "host.sock");
    const entry = fileURLToPath(new URL("./process.ts", import.meta.url));
    const supervisor = new NativeTerminalHostSupervisor({
      socketPath,
      registryPath: join(directory, "registry.json"),
      replayBytesPerSession: 1024,
      generationFactory: () => "backpressure-generation",
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
          ...(options.registryPath !== undefined ? ["--registry-path", options.registryPath] : []),
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
    const lease = await client.acquireController("survivor", "healthy-owner");

    const slow = createConnection(socketPath);
    slow.on("error", () => {
      // Expected when the host enforces the slow-reader queue budget.
    });
    await new Promise<void>((resolve, reject) => {
      slow.once("connect", resolve);
      slow.once("error", reject);
    });
    slow.pause();
    const closed = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("slow pipelined client was not closed")),
        5_000,
      );
      slow.once("close", () => {
        clearTimeout(timeout);
        resolve();
      });
    });
    const frame = JSON.stringify({
      version: 1,
      id: "slow",
      operation: "ping",
    }) + "\n";
    slow.write(frame.repeat(100_000));
    await closed;

    expect((await client.ping()).hostPid).toBe(ping.hostPid);
    await client.write(lease, "still-alive\r");
    await eventually(
      () => client.readOutput("survivor", 0),
      (output) => output.chunks.some((chunk) => chunk.data.includes("survivor:still-alive")),
    );
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
      registryPath: join(directory, "registry.json"),
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
          ...(options.registryPath !== undefined ? ["--registry-path", options.registryPath] : []),
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

  // The first backoff step (NATIVE_TERMINAL_SPAWN_BACKOFF_BASE_MS = 250 ms)
  // plus a margin, waited for before the replacement may start.
  const FIRST_BACKOFF_WAIT_MS = 275;
  // ONE supervisor drives both phases (the backoff state is its own), so ONE
  // startupTimeoutMs bounds both: the hung child's window, which must expire,
  // and the replacement's REAL host start. It was 1 s — the hung phase's wish —
  // which a real start exceeds from ~5 runnable tasks per core on (see
  // HOST_STARTUP_BUDGET_MS): the replacement then failed with "did not become
  // ready", and the same failure reproduced on the pre-fix base. It is now the
  // real-start budget; the hung phase simply waits that long. Budget, in order:
  // the hung window plus one overrun and the SIGTERM/SIGKILL waits; one
  // eventually() wait; the backoff wait; the replacement start plus one
  // overrun. Neither phase reaps a group (the hung child is no host, the
  // replacement creates no session), so no FORCED_REAP_BUDGET_MS term.
  const BACKOFF_REPLACEMENT_BUDGET_MS =
    2 * (HOST_STARTUP_BUDGET_MS + CLIENT_OVERRUN_BUDGET_MS) +
    2 * SPAWN_TERMINATION_GRACE_MS +
    EVENTUALLY_BUDGET_MS +
    FIRST_BACKOFF_WAIT_MS +
    1_000;

  it("should reap an owned host that misses readiness before a backoff-governed replacement", async () => {
    const directory = await mkdtemp(join(tmpdir(), "h2a-native-terminal-hung-start-"));
    directories.add(directory);
    const socketPath = join(directory, "host.sock");
    const entry = fileURLToPath(new URL("./process.ts", import.meta.url));
    let spawnCount = 0;
    let hungChild: ChildProcess | undefined;
    const supervisor = new NativeTerminalHostSupervisor({
      socketPath,
      registryPath: join(directory, "registry.json"),
      replayBytesPerSession: 1024,
      startupTimeoutMs: HOST_STARTUP_BUDGET_MS,
      spawnTerminationGraceMs: SPAWN_TERMINATION_GRACE_MS,
      generationFactory: () => `hung-generation-${spawnCount + 1}`,
      spawnHost: (options) => {
        spawnCount += 1;
        const child = spawnCount === 1
          ? spawn(process.execPath, [
              "-e",
              "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)",
            ], {
              detached: true,
              stdio: ["ignore", "ignore", "pipe"],
            })
          : spawn(process.execPath, [
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
        if (spawnCount === 1) hungChild = child;
        children.add(child);
        return child;
      },
    });

    await expect(supervisor.client()).rejects.toThrow(/did not become ready/i);
    expect(hungChild?.pid).toBeGreaterThan(1);
    await eventually(() => running(hungChild!.pid!), (alive) => !alive);
    expect(supervisor.spawnedPid).toBeUndefined();
    expect(spawnCount).toBe(1);
    await expect(supervisor.client()).rejects.toThrow(/restart backoff active/i);
    expect(spawnCount).toBe(1);

    await new Promise((resolve) => setTimeout(resolve, FIRST_BACKOFF_WAIT_MS));
    const replacement = await supervisor.client();
    expect(spawnCount).toBe(2);
    expect(await replacement.ping()).toMatchObject({
      generation: "hung-generation-2",
    });
  }, BACKOFF_REPLACEMENT_BUDGET_MS);

  // Same single-budget shape as the backoff scenario above: the losing
  // supervisor's ONE startupTimeoutMs bounds its hung child's window — which
  // must last until the WINNER's real host is up, so it can be adopted — and,
  // later, its own replacement's real start. Both are real-start waits, so
  // both get HOST_STARTUP_BUDGET_MS (the winner pins it too). Budget, in order:
  // one eventually() wait; the winner's start plus one overrun (the losing
  // adoption resolves within it, plus the reap of its hung child and one
  // overrun); one eventually() wait; the replacement start plus one overrun.
  // No session is ever created, so no FORCED_REAP_BUDGET_MS term.
  const LOSING_CHILD_BUDGET_MS =
    2 * (HOST_STARTUP_BUDGET_MS + CLIENT_OVERRUN_BUDGET_MS) +
    CLIENT_OVERRUN_BUDGET_MS +
    2 * SPAWN_TERMINATION_GRACE_MS +
    2 * EVENTUALLY_BUDGET_MS +
    1_000;

  it("should reap its losing owned child before adopting and later replacing a winning host", async () => {
    const directory = await mkdtemp(join(tmpdir(), "h2a-native-terminal-adopt-reap-"));
    directories.add(directory);
    const socketPath = join(directory, "host.sock");
    const entry = fileURLToPath(new URL("./process.ts", import.meta.url));
    let losingSpawnCount = 0;
    let losingChild: ChildProcess | undefined;
    const losingGenerations = ["losing-hung", "losing-replacement"];
    const losing = new NativeTerminalHostSupervisor({
      socketPath,
      registryPath: join(directory, "registry.json"),
      replayBytesPerSession: 1024,
      startupTimeoutMs: HOST_STARTUP_BUDGET_MS,
      spawnTerminationGraceMs: SPAWN_TERMINATION_GRACE_MS,
      generationFactory: () =>
        losingGenerations[losingSpawnCount] ?? `losing-${losingSpawnCount}`,
      spawnHost: (options) => {
        losingSpawnCount += 1;
        const child = losingSpawnCount === 1
          ? spawn(process.execPath, [
              "-e",
              "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)",
            ], {
              detached: true,
              stdio: ["ignore", "ignore", "pipe"],
            })
          : spawn(process.execPath, [
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
        if (losingSpawnCount === 1) losingChild = child;
        children.add(child);
        return child;
      },
    });
    const losingConnection = losing.client();
    await eventually(
      () => losingChild?.pid,
      (pid) => typeof pid === "number" && running(pid),
    );

    let winningChild: ChildProcess | undefined;
    const winner = new NativeTerminalHostSupervisor({
      socketPath,
      registryPath: join(directory, "registry.json"),
      replayBytesPerSession: 1024,
      startupTimeoutMs: HOST_STARTUP_BUDGET_MS,
      generationFactory: () => "winning-generation",
      spawnHost: (options) => {
        winningChild = spawn(process.execPath, [
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
        children.add(winningChild);
        return winningChild;
      },
    });
    const winningConnection = await winner.client();
    const winningPing = await winningConnection.ping();
    const adopted = await losingConnection;
    expect((await adopted.ping()).hostPid).toBe(winningPing.hostPid);
    await eventually(() => running(losingChild!.pid!), (alive) => !alive);
    expect(losing.spawnedPid).toBeUndefined();

    process.kill(winningPing.hostPid, "SIGKILL");
    await once(winningChild!, "exit");
    losing.disconnect();
    const replacement = await losing.client();
    expect(losingSpawnCount).toBe(2);
    expect((await replacement.ping()).hostPid).not.toBe(winningPing.hostPid);
  }, LOSING_CHILD_BUDGET_MS);

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
        ...(options.registryPath !== undefined ? ["--registry-path", options.registryPath] : []),
      ], { cwd: dirname(entry), env: process.env, stdio: ["ignore", "pipe", "pipe"] });
      children.add(child);
      return child;
    };
    const firstSupervisor = new NativeTerminalHostSupervisor({
      socketPath,
      registryPath: join(directory, "registry.json"),
      replayBytesPerSession: 1024,
      spawnHost,
      generationFactory: () => "race-first",
    });
    const secondSupervisor = new NativeTerminalHostSupervisor({
      socketPath,
      registryPath: join(directory, "registry.json"),
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

  it("should reap its dead host's durable group before adopting a replacement a competing supervisor published", async () => {
    const directory = await mkdtemp(join(tmpdir(), "h2a-native-terminal-concurrent-adopt-"));
    directories.add(directory);
    const socketPath = join(directory, "host.sock");
    const registryPath = join(directory, "registry.json");
    const entry = fileURLToPath(new URL("./process.ts", import.meta.url));
    const spawnRealHost = (options: {
      socketPath: string;
      generation: string;
      replayBytesPerSession: number;
      registryPath?: string;
    }): ChildProcess => {
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
      ], { cwd: dirname(entry), env: process.env, stdio: ["ignore", "pipe", "pipe"] });
      children.add(child);
      return child;
    };

    const ownerLogs: string[] = [];
    let ownerSpawnCount = 0;
    let ownerChild: ChildProcess | undefined;
    const owner = new NativeTerminalHostSupervisor({
      socketPath,
      registryPath,
      replayBytesPerSession: 1024,
      startupTimeoutMs: 30_000,
      spawnTerminationGraceMs: 100,
      log: (line) => ownerLogs.push(line),
      generationFactory: () => `concurrent-adopt-owner-${ownerSpawnCount}`,
      spawnHost: (options) => {
        ownerSpawnCount += 1;
        ownerChild = spawnRealHost(options);
        return ownerChild;
      },
    });

    const first = await owner.client();
    const firstPing = await first.ping();
    const stubbornPids = await createStubbornWorkload(
      first,
      "concurrent-adopt-tree",
      directory,
    );
    const stubbornPgid = stubbornPids[0]!;
    processGroups.add(stubbornPgid);

    // A competing supervisor publishes after owner death but before the owner
    // supervisor observes it. Its separate registry intentionally cannot see
    // the durable group: adoption must still discharge the owner's proof.
    owner.disconnect();
    process.kill(firstPing.hostPid, "SIGKILL");
    await once(ownerChild!, "exit");
    const competitorLogs: string[] = [];
    let competitorSpawnCount = 0;
    const competitor = new NativeTerminalHostSupervisor({
      socketPath,
      registryPath: join(directory, "competitor-registry.json"),
      replayBytesPerSession: 1024,
      startupTimeoutMs: 30_000,
      spawnTerminationGraceMs: 100,
      log: (line) => competitorLogs.push(line),
      generationFactory: () => "concurrent-adopt-competitor",
      spawnHost: (options) => {
        competitorSpawnCount += 1;
        return spawnRealHost(options);
      },
    });
    const competitorPing = await (await competitor.client()).ping();
    expect(competitorSpawnCount).toBe(1);
    expect(competitorPing.hostPid).not.toBe(firstPing.hostPid);
    expect(
      competitorLogs.some((line) => /PROVEN DEAD/.test(line)),
    ).toBe(false);

    // The owner supervisor's next call succeeds on the FIRST
    // connect: it adopts the competitor's host instead of taking over, so the
    // takeover reconcile never runs. The adoption itself must therefore carry
    // the containment.
    const adopted = await owner.client();

    expect((await adopted.ping()).hostPid).toBe(competitorPing.hostPid);
    expect(ownerSpawnCount).toBe(1);
    expect(
      ownerLogs.some(
        (line) =>
          line.includes("concurrent-adopt-tree") && line.includes("PROVEN DEAD"),
      ),
    ).toBe(true);
    expect(readNativeTerminalPgid("concurrent-adopt-tree", registryPath)).toEqual({
      status: "unresolved",
      reason: expect.stringMatching(/no pgid recorded/i),
    });
    expect(await processGroupMemberPids(stubbornPgid)).toEqual([]);
    const stubbornStates = await Promise.all(stubbornPids.map(processObservation));
    expect(stubbornStates.every((state) => state.missing === true)).toBe(true);
  });

  it("should refuse to publish or adopt any host while a refused reap leaves this socket's proven-dead owner unconfirmed", async () => {
    const directory = await mkdtemp(join(tmpdir(), "h2a-native-terminal-refused-reap-"));
    directories.add(directory);
    const socketPath = join(directory, "host.sock");
    const registryPath = join(directory, "registry.json");
    const entry = fileURLToPath(new URL("./process.ts", import.meta.url));
    const hostArgs = (generation: string): string[] => [
      "--import",
      "tsx",
      entry,
      "--socket",
      socketPath,
      "--generation",
      generation,
      "--replay-bytes",
      "1024",
      "--registry-path",
      registryPath,
    ];
    const reapCalls: string[] = [];
    // Every reap this test triggers REFUSES, the outcome the fail-closed rule
    // exists for: the durable group is proven ownerless and still alive, and
    // nothing may resume terminal work on this socket over it.
    const refuseReap = async (
      sessionId: string,
      _pgid: number,
    ): Promise<NativeTerminalReapOutcome> => {
      reapCalls.push(sessionId);
      return {
        sessionId,
        status: "refused",
        reason: "injected refusal for the concurrent-containment regression",
        cause: "membership-unprovable",
      };
    };

    let ownerSpawnCount = 0;
    let ownerChild: ChildProcess | undefined;
    const owner = new NativeTerminalHostSupervisor({
      socketPath,
      registryPath,
      replayBytesPerSession: 1024,
      startupTimeoutMs: 30_000,
      spawnTerminationGraceMs: 100,
      reapOrphan: refuseReap,
      log: () => {},
      generationFactory: () => `refused-reap-owner-${ownerSpawnCount}`,
      spawnHost: () => {
        ownerSpawnCount += 1;
        ownerChild = spawn(process.execPath, hostArgs(`refused-reap-owner-${ownerSpawnCount}`), {
          cwd: dirname(entry),
          env: process.env,
          stdio: ["ignore", "pipe", "pipe"],
        });
        children.add(ownerChild);
        return ownerChild;
      },
    });

    const first = await owner.client();
    const firstPing = await first.ping();
    const stubbornPids = await createStubbornWorkload(
      first,
      "refused-reap-tree",
      directory,
    );
    processGroups.add(stubbornPids[0]!);
    process.kill(firstPing.hostPid, "SIGKILL");
    await once(ownerChild!, "exit");
    owner.disconnect();
    await unlink(socketPath);

    // 1. The owning supervisor fails closed on its own refused reap.
    await expect(owner.client()).rejects.toThrow(
      /did not confirm owner pid=\d+ session refused-reap-tree/,
    );
    expect(ownerSpawnCount).toBe(1);
    expect(reapCalls).toContain("refused-reap-tree");

    // 2. A competing supervisor must not turn that refusal into a published
    //    replacement. The dead host was never its child, so only the durable
    //    socket attribution on the row can tell it this is its containment
    //    problem.
    let competitorSpawnCount = 0;
    const competitor = new NativeTerminalHostSupervisor({
      socketPath,
      registryPath,
      replayBytesPerSession: 1024,
      startupTimeoutMs: 30_000,
      spawnTerminationGraceMs: 100,
      reapOrphan: refuseReap,
      log: () => {},
      generationFactory: () => "refused-reap-competitor",
      spawnHost: () => {
        competitorSpawnCount += 1;
        const child = spawn(process.execPath, hostArgs("refused-reap-competitor"), {
          cwd: dirname(entry),
          env: process.env,
          stdio: ["ignore", "pipe", "pipe"],
        });
        children.add(child);
        return child;
      },
    });
    await expect(competitor.client()).rejects.toThrow(
      /is contained: session refused-reap-tree/,
    );
    expect(competitorSpawnCount).toBe(0);

    // 3. A healthy host published by something outside both supervisors is
    //    still not a way back in: neither the owner (which owes a proof for
    //    its own dead child) nor the competitor (which owes one for this
    //    socket) may adopt it.
    const external = spawn(process.execPath, hostArgs("refused-reap-external"), {
      cwd: dirname(entry),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    children.add(external);
    const externalPid = await eventually(
      async () => {
        try {
          const probe = await NativeTerminalClient.connect(socketPath, {
            connectTimeoutMs: 500,
            requestTimeoutMs: 500,
          });
          try {
            return (await probe.ping()).hostPid;
          } finally {
            probe.close();
          }
        } catch {
          return undefined;
        }
      },
      (pid) => typeof pid === "number",
    );
    expect(externalPid).toBe(external.pid);
    await expect(owner.client()).rejects.toThrow(
      /did not confirm owner pid=\d+ session refused-reap-tree/,
    );
    await expect(competitor.client()).rejects.toThrow(
      /is contained: session refused-reap-tree/,
    );
    expect(ownerSpawnCount).toBe(1);
    expect(competitorSpawnCount).toBe(0);
    // The refused row is never pruned: the block lifts only when the group is
    // actually confirmed reaped, not when a caller retries.
    expect(readNativeTerminalPgid("refused-reap-tree", registryPath)).toMatchObject({
      status: "resolved",
    });
  });

  // The two containment-refusal regressions below boot a real host (bounded by
  // the startup budget they pin) and make one further hand-out attempt. The RED
  // they were written against retried the refused pass for the WHOLE startup
  // budget before reporting anything, so their test budget must exceed it:
  // otherwise a red run reports an anonymous "Test timed out" instead of the
  // reconcile storm it exists to show.
  const CONTAINED_HANDOUT_STARTUP_BUDGET_MS = 10_000;
  const CONTAINED_HANDOUT_TEST_BUDGET_MS = 3 * CONTAINED_HANDOUT_STARTUP_BUDGET_MS;

  it("should surface a containment refusal from the readiness loop instead of retrying it and killing its own healthy host", async () => {
    const directory = await mkdtemp(join(tmpdir(), "h2a-native-terminal-contained-readiness-"));
    directories.add(directory);
    const socketPath = join(directory, "host.sock");
    const registryPath = join(directory, "registry.json");
    const entry = fileURLToPath(new URL("./process.ts", import.meta.url));
    await persistProvenDeadOwnerRow("contained-readiness-tree", socketPath, registryPath);

    // Pass 1 — the takeover preflight — does NOT block, so this supervisor
    // spawns a real host; the block lands on the ADOPTION of that host, inside
    // the readiness loop. Containment is a VERDICT there, not a connection
    // failure: swallowing it and retrying runs one reconcile pass per loop
    // iteration (a pass that reaps a live group can take the whole force-kill
    // timeout), then reports the verdict as a startup failure and SIGTERMs a
    // host that is perfectly healthy.
    const { reapOrphan, calls } = injectedRefusals((pass) => pass > 1);
    let spawnCount = 0;
    let hostChild: ChildProcess | undefined;
    const supervisor = new NativeTerminalHostSupervisor({
      socketPath,
      registryPath,
      replayBytesPerSession: 1024,
      startupTimeoutMs: CONTAINED_HANDOUT_STARTUP_BUDGET_MS,
      spawnTerminationGraceMs: 100,
      reapOrphan,
      log: () => {},
      generationFactory: () => `contained-readiness-${spawnCount}`,
      spawnHost: (options) => {
        spawnCount += 1;
        hostChild = spawn(process.execPath, [
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
        ], { cwd: dirname(entry), env: process.env, stdio: ["ignore", "pipe", "pipe"] });
        children.add(hostChild);
        return hostChild;
      },
    });

    const rejection = await supervisor.client().then(
      () => {
        throw new Error("expected the adoption to be refused");
      },
      (error: unknown) => error,
    );

    expect(rejection).toBeInstanceOf(NativeTerminalContainmentError);
    expect((rejection as Error).message).toMatch(
      /is contained: session contained-readiness-tree/,
    );
    // The verdict reaches the caller as itself, not wrapped in a startup
    // diagnostic that names no cause.
    expect((rejection as Error).message).not.toMatch(/did not become ready/i);
    // Exactly one pass per hand-out attempt: the preflight and the adoption.
    expect(calls).toEqual([
      "contained-readiness-tree",
      "contained-readiness-tree",
    ]);
    // The host this supervisor spawned completed its health handshake and is
    // serving the socket. Containment objects to resuming terminal work over an
    // unreaped PTY group, not to that host: it must not be mistaken for a
    // failed startup and signalled.
    expect(spawnCount).toBe(1);
    expect({ exitCode: hostChild!.exitCode, signalCode: hostChild!.signalCode })
      .toEqual({ exitCode: null, signalCode: null });
    expect(await pingSocket(socketPath)).toBe(hostChild!.pid);

    // Nor is it a spawn failure: the next attempt re-derives the same verdict
    // from the durable store instead of answering "come back later".
    const second = await supervisor.client().then(
      () => {
        throw new Error("expected the second adoption to be refused too");
      },
      (error: unknown) => error,
    );
    expect(second).toBeInstanceOf(NativeTerminalContainmentError);
    expect((second as Error).message).toMatch(/is contained: session contained-readiness-tree/);
    expect((second as Error).message).not.toMatch(/backoff/i);
    expect(calls).toHaveLength(3);
    expect(spawnCount).toBe(1);
  }, CONTAINED_HANDOUT_TEST_BUDGET_MS);

  it("should refuse a healthy host published outside it rather than spawn a replacement beside it", async () => {
    const directory = await mkdtemp(join(tmpdir(), "h2a-native-terminal-contained-adopt-"));
    directories.add(directory);
    const socketPath = join(directory, "host.sock");
    const registryPath = join(directory, "registry.json");
    const entry = fileURLToPath(new URL("./process.ts", import.meta.url));
    await persistProvenDeadOwnerRow("contained-adopt-tree", socketPath, registryPath);

    // A healthy host published by something outside this supervisor.
    const external = spawn(process.execPath, [
      "--import",
      "tsx",
      entry,
      "--socket",
      socketPath,
      "--generation",
      "contained-adopt-external",
      "--replay-bytes",
      "1024",
      "--registry-path",
      registryPath,
    ], { cwd: dirname(entry), env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    children.add(external);
    const externalPid = await eventually(
      () => pingSocket(socketPath).catch(() => undefined),
      (pid) => typeof pid === "number",
    );
    expect(externalPid).toBe(external.pid);

    // Only the FIRST pass blocks — the one the adoption of that healthy host
    // runs. A later pass is cause-less, i.e. non-blocking: that is exactly what
    // turned this verdict into a takeover once it was caught as a connection
    // failure, and a replacement was then spawned beside a healthy host.
    const { reapOrphan, calls } = injectedRefusals((pass) => pass === 1);
    let spawnCount = 0;
    const supervisor = new NativeTerminalHostSupervisor({
      socketPath,
      registryPath,
      replayBytesPerSession: 1024,
      startupTimeoutMs: CONTAINED_HANDOUT_STARTUP_BUDGET_MS,
      spawnTerminationGraceMs: 100,
      reapOrphan,
      log: () => {},
      generationFactory: () => "contained-adopt-replacement",
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
          ...(options.registryPath !== undefined ? ["--registry-path", options.registryPath] : []),
        ], { cwd: dirname(entry), env: process.env, stdio: ["ignore", "pipe", "pipe"] });
        children.add(child);
        return child;
      },
    });

    const rejection = await supervisor.client().then(
      () => {
        throw new Error("expected the adoption to be refused");
      },
      (error: unknown) => error,
    );

    expect(rejection).toBeInstanceOf(NativeTerminalContainmentError);
    expect((rejection as Error).message).toMatch(/is contained: session contained-adopt-tree/);
    // No replacement: the refusal stopped at the pass that decided it.
    expect(spawnCount).toBe(0);
    expect(calls).toEqual(["contained-adopt-tree"]);
    // And the host it refused to adopt is untouched, still serving.
    expect({ exitCode: external.exitCode, signalCode: external.signalCode })
      .toEqual({ exitCode: null, signalCode: null });
    expect(await pingSocket(socketPath)).toBe(external.pid);
  }, CONTAINED_HANDOUT_TEST_BUDGET_MS);
});
