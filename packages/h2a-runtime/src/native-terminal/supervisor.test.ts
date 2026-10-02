import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { EventEmitter, once } from "node:events";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { persistNativeTerminalPgid, readNativeTerminalPgid } from "../registry.js";
import { readProcessStartTime, type NativeTerminalReapOutcome } from "./host.js";
import {
  NativeTerminalContainmentError,
  NativeTerminalHostSupervisor,
  type NativeTerminalHostSpawn,
} from "./supervisor.js";
import type { NativeTerminalStopSignal } from "./protocol.js";

// Scratch dir inside the package (never /tmp), like the other native-terminal
// test suites.
const SCRATCH_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  ".test-scratch",
  "native-terminal-supervisor",
);

let scratch: string;
let registryPath: string;
// Real process groups a test starts on purpose (an unrelated live group whose
// pgid number a stale durable row points at). They outlive the assertions, so
// this suite owns their cleanup even when an assertion aborts the test.
const strayProcessGroups = new Set<number>();

beforeEach(() => {
  mkdirSync(SCRATCH_ROOT, { recursive: true });
  scratch = mkdtempSync(join(SCRATCH_ROOT, "s-"));
  registryPath = join(scratch, "registry.json");
});

afterEach(() => {
  for (const pgid of strayProcessGroups) {
    try {
      process.kill(-pgid, "SIGKILL");
    } catch {
      // Already gone; nothing of this test's making is left to collect.
    }
  }
  strayProcessGroups.clear();
  rmSync(scratch, { recursive: true, force: true });
});

function running(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

/** Read a real /proc start-time, retrying while the process is still forking. */
async function realStartTime(pid: number): Promise<number> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const startTime = readProcessStartTime(pid);
    if (startTime !== undefined) return startTime;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`could not read a real start-time for pid=${pid}`);
}

/**
 * A fake spawned host process: an EventEmitter shaped enough to satisfy
 * everything NativeTerminalHostSupervisor touches on a ChildProcess
 * (`.stderr`, `.once("error", ...)`, `.exitCode`, `.signalCode`, `.kill()`,
 * and node:events' `once(child, "exit")`). Never spawns anything real — this
 * suite tests the SUPERVISOR's takeover/reconcile wiring in isolation, not a
 * real host binary. `kill("SIGKILL")` simulates a real OS's unconditional
 * termination (even of an otherwise-unresponsive process) by emitting exit
 * on a microtask; `kill("SIGTERM")` is recorded but deliberately does
 * nothing, mirroring a process that does not respond to a graceful signal —
 * exactly the shape `#terminateOwnedSpawn`'s SIGTERM-then-SIGKILL escalation
 * is written to handle.
 */
class FakeHostProcess extends EventEmitter {
  pid = 4_242_424;
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  stderr = null;
  readonly killSignals: string[] = [];

  kill(signal?: NodeJS.Signals | number): boolean {
    const sig = String(signal ?? "SIGTERM");
    this.killSignals.push(sig);
    if (sig === "SIGKILL") {
      queueMicrotask(() => {
        this.signalCode = "SIGKILL";
        this.emit("exit", null, "SIGKILL");
      });
    }
    return true;
  }
}

function fakeSpawnHost(): { spawnHost: NativeTerminalHostSpawn; host: FakeHostProcess } {
  const host = new FakeHostProcess();
  return {
    host,
    spawnHost: vi.fn(() => host as unknown as ChildProcess),
  };
}

/**
 * Edit one durable native-terminal row in place. Used to fabricate a FRAME
 * (pid namespace / boot id) no test can produce for real without root: a
 * second pid namespace, or a reboot.
 */
function patchDurableRow(
  sessionId: string,
  patch: (row: Record<string, unknown>) => void,
): void {
  const store = JSON.parse(readFileSync(registryPath, "utf8")) as {
    entries: Array<Record<string, unknown>>;
  };
  const row = store.entries.find(
    (entry) => entry.id === `native-terminal-pty:${sessionId}`,
  );
  if (row === undefined) throw new Error(`no durable row for ${sessionId}`);
  patch(row);
  writeFileSync(registryPath, JSON.stringify(store, null, 2), "utf8");
}

/** A socket path inside `scratch` that nothing ever listens on: connecting
 * to it fails immediately (ENOENT on lstat, before any real socket I/O),
 * which is exactly the "nothing answers" precondition for a takeover. */
function deadSocketPath(): string {
  return join(scratch, "nothing-listens-here.sock");
}

describe.skipIf(process.platform !== "linux")(
  "NativeTerminalHostSupervisor takeover reconcile",
  () => {
    it("SUPERVISOR_TAKEOVER_DOES_NOT_REAP_A_LIVE_HOSTS_SESSIONS", async () => {
      // The owning host recorded on this entry is THIS test process — alive,
      // with a REAL matching /proc start-time, for the entire test. A lost
      // connection to some OTHER socket must never be read as proof that
      // THIS entry's owner died.
      const ownStartTime = readProcessStartTime(process.pid);
      expect(ownStartTime).toBeTypeOf("number");
      persistNativeTerminalPgid("live-session", 5_555, registryPath, {
        pid: process.pid,
        startTime: ownStartTime,
      });

      const reapOrphan = vi.fn(
        async (
          sessionId: string,
          pgid: number,
          _signal: NativeTerminalStopSignal,
        ): Promise<NativeTerminalReapOutcome> => ({
          sessionId,
          status: "reaped",
          pgid,
          elapsedMs: 0,
        }),
      );
      const logs: string[] = [];
      const { spawnHost } = fakeSpawnHost();

      const supervisor = new NativeTerminalHostSupervisor({
        socketPath: deadSocketPath(),
        replayBytesPerSession: 1024,
        registryPath,
        spawnHost,
        startupTimeoutMs: 80,
        spawnTerminationGraceMs: 30,
        reapOrphan,
        log: (line) => logs.push(line),
      });

      // Nothing is listening: this drives the supervisor into the "spawn a
      // replacement host" branch — the exact takeover point the reconcile
      // step is wired into. It ultimately fails to ever connect (the fake
      // host never opens a real socket) and rejects; that rejection is
      // expected and irrelevant to this assertion.
      await expect(supervisor.client()).rejects.toThrow(/did not become ready/i);

      // The safety property under test: a live (even merely unreachable)
      // owner must never be reaped.
      expect(reapOrphan).not.toHaveBeenCalled();
      expect(
        logs.some(
          (line) => /live-session/.test(line) && /still alive/i.test(line),
        ),
      ).toBe(true);
      expect(readNativeTerminalPgid("live-session", registryPath)).toMatchObject({
        status: "resolved",
        pgid: 5_555,
      });
    });

    it("SUPERVISOR_TAKEOVER_REAPS_A_PROVEN_DEAD_HOSTS_ORPHAN_GROUP", async () => {
      // A REAL process that we durably record as the owner, then let it
      // genuinely exit — the owner pid is then PROVABLY gone (ESRCH), the
      // strongest form of "dead" the probe recognizes.
      const owner = spawn(process.execPath, ["-e", "setTimeout(() => {}, 300)"]);
      expect(owner.pid).toBeDefined();
      const ownerPid = owner.pid!;
      let ownerStartTime: number | undefined;
      for (let attempt = 0; attempt < 20 && ownerStartTime === undefined; attempt += 1) {
        ownerStartTime = readProcessStartTime(ownerPid);
        if (ownerStartTime === undefined) await new Promise((r) => setTimeout(r, 10));
      }
      expect(ownerStartTime).toBeTypeOf("number");
      persistNativeTerminalPgid("dead-owner-session", 6_789, registryPath, {
        pid: ownerPid,
        startTime: ownerStartTime,
      });

      owner.kill("SIGKILL");
      await once(owner, "exit");

      const reapOrphan = vi.fn(
        async (
          sessionId: string,
          pgid: number,
          _signal: NativeTerminalStopSignal,
        ): Promise<NativeTerminalReapOutcome> => ({
          sessionId,
          status: "reaped",
          pgid,
          elapsedMs: 0,
        }),
      );
      const logs: string[] = [];
      const { spawnHost } = fakeSpawnHost();

      const supervisor = new NativeTerminalHostSupervisor({
        socketPath: deadSocketPath(),
        replayBytesPerSession: 1024,
        registryPath,
        spawnHost,
        startupTimeoutMs: 80,
        spawnTerminationGraceMs: 30,
        reapOrphan,
        log: (line) => logs.push(line),
      });

      await expect(supervisor.client()).rejects.toThrow(/did not become ready/i);

      expect(reapOrphan).toHaveBeenCalledWith("dead-owner-session", 6_789, "SIGKILL");
      expect(
        logs.some(
          (line) => /dead-owner-session/.test(line) && /PROVEN DEAD/.test(line),
        ),
      ).toBe(true);
      // Reaped (per the injected outcome) -> the durable row is pruned, so a
      // LATER pass never re-attempts a reap for an entry already handled.
      expect(readNativeTerminalPgid("dead-owner-session", registryPath)).toEqual({
        status: "unresolved",
        reason: expect.stringMatching(/no pgid recorded/i),
      });
    });

    /**
     * Fabricate a durably-recorded session whose owning host is PROVABLY gone
     * and whose row is attributed to `rowSocketPath ?? socketPath`, then drive
     * one takeover of `socketPath` with an injected reap outcome. Returns the
     * supervisor's rejection. The two paths differ only where a test needs an
     * ALIAS SPELLING of the same socket on the row.
     */
    async function takeoverWithReapOutcome(
      sessionId: string,
      socketPath: string,
      outcome: (sessionId: string, pgid: number) => NativeTerminalReapOutcome,
      rowSocketPath: string = socketPath,
    ): Promise<{ error: Error; spawnHost: NativeTerminalHostSpawn }> {
      const owner = spawn(process.execPath, ["-e", "setTimeout(() => {}, 300)"]);
      const ownerPid = owner.pid!;
      let ownerStartTime: number | undefined;
      for (let attempt = 0; attempt < 20 && ownerStartTime === undefined; attempt += 1) {
        ownerStartTime = readProcessStartTime(ownerPid);
        if (ownerStartTime === undefined) await new Promise((r) => setTimeout(r, 10));
      }
      expect(ownerStartTime).toBeTypeOf("number");
      persistNativeTerminalPgid(sessionId, 7_777, registryPath, {
        pid: ownerPid,
        startTime: ownerStartTime,
        socketPath: rowSocketPath,
      });
      owner.kill("SIGKILL");
      await once(owner, "exit");

      const { spawnHost } = fakeSpawnHost();
      const supervisor = new NativeTerminalHostSupervisor({
        socketPath,
        replayBytesPerSession: 1024,
        registryPath,
        spawnHost,
        startupTimeoutMs: 80,
        spawnTerminationGraceMs: 30,
        reapOrphan: async (id, pgid) => outcome(id, pgid),
        log: () => {},
      });
      const error = await supervisor.client().then(
        () => {
          throw new Error("expected the takeover to reject");
        },
        (rejection: Error) => rejection,
      );
      return { error, spawnHost };
    }

    it("SUPERVISOR_REFUSES_A_NEW_HOST_WHILE_ITS_SOCKETS_PROVEN_DEAD_OWNER_IS_UNCONFIRMED", async () => {
      // A caused refusal is taken with the group observed ALIVE, so it is
      // positive evidence that a PTY tree outlived its host. No replacement
      // may be started for that socket, even though this supervisor never
      // owned the dead host.
      const socketPath = deadSocketPath();
      const { error, spawnHost } = await takeoverWithReapOutcome(
        "contained-session",
        socketPath,
        (sessionId) => ({
          sessionId,
          status: "refused",
          reason: "no surviving member carries the persisted session token",
          cause: "membership-unprovable",
        }),
      );

      expect(error.message).toMatch(/is contained: session contained-session/);
      expect(error.message).toMatch(/membership-unprovable/);
      // The group was judged in THIS process space, so a local inspection is
      // meaningful and the by-hand recovery is offered.
      expect(error.message).toMatch(/Inspect it first: ps/);
      expect(error.message).toMatch(/If inspection shows .* by hand/);
      expect(spawnHost).not.toHaveBeenCalled();
    });

    it("SUPERVISOR_NEVER_OFFERS_A_LOCAL_INSPECTION_FOR_A_ROW_FROM_A_FOREIGN_FRAME", async () => {
      // `foreign-frame` blocks like `membership-unprovable`, but its pids name
      // ANOTHER process space: "inspect pgid N here, and if it is not this
      // session's tree, delete the row" would lead an operator to delete the
      // only durable record of a group that may be alive where it was written.
      const socketPath = deadSocketPath();
      const { error, spawnHost } = await takeoverWithReapOutcome(
        "foreign-frame-session",
        socketPath,
        (sessionId) => ({
          sessionId,
          status: "refused",
          reason: "orphan process group could not be safely reaped (foreign-frame)",
          cause: "foreign-frame",
        }),
      );

      expect(error).toBeInstanceOf(NativeTerminalContainmentError);
      expect((error as NativeTerminalContainmentError).refusalCause).toBe("foreign-frame");
      expect(error.message).toMatch(/is contained: session foreign-frame-session/);
      expect(error.message).toMatch(/machine and pid namespace that wrote the row/);
      expect(error.message).not.toMatch(/Inspect it first: ps/);
      expect(error.message).not.toMatch(/If inspection shows/);
      expect(spawnHost).not.toHaveBeenCalled();
    });

    /** An alias spelling of the same socket: one doubled separator. */
    function aliasSpellingOf(socketPath: string): string {
      const alias = socketPath.replace(/\/([^/]+)$/, "//$1");
      expect(alias).not.toBe(socketPath);
      return alias;
    }

    const unprovableRefusal = (sessionId: string): NativeTerminalReapOutcome => ({
      sessionId,
      status: "refused",
      reason: "no surviving member carries the persisted session token",
      cause: "membership-unprovable",
    });

    it("SOCKET_ATTRIBUTION_ON_A_ROW_IS_COMPARED_AS_A_PATH_NOT_AS_A_RAW_STRING", async () => {
      // The socket attribution is an IDENTITY, not a label: a row carrying an
      // alias spelling of this very socket must not let the supervisor fail
      // OPEN over a durable group that survived its host on it.
      const socketPath = deadSocketPath();
      const { error, spawnHost } = await takeoverWithReapOutcome(
        "alias-row-session",
        socketPath,
        unprovableRefusal,
        aliasSpellingOf(socketPath),
      );

      expect(error.message).toMatch(/is contained: session alias-row-session/);
      expect(spawnHost).not.toHaveBeenCalled();
    });

    it("A_SUPERVISOR_BUILT_ON_AN_ALIAS_SPELLING_IS_CONTAINED_BY_ITS_OWN_SOCKETS_ROW", async () => {
      // The same identity, from the other side: the supervisor is constructed
      // with the alias spelling while the row carries the canonical one.
      const socketPath = deadSocketPath();
      const { error, spawnHost } = await takeoverWithReapOutcome(
        "alias-supervisor-session",
        aliasSpellingOf(socketPath),
        unprovableRefusal,
        socketPath,
      );

      expect(error.message).toMatch(/is contained: session alias-supervisor-session/);
      expect(spawnHost).not.toHaveBeenCalled();
    });

    it("SUPERVISOR_IS_CONTAINED_WHEN_A_REAP_THROWS_ON_A_ROW_ATTRIBUTED_TO_ITS_SOCKET", async () => {
      // A reap that THROWS (the registry turned unreadable, a write failed)
      // proves nothing about the group. Treating it as a cleanup hiccup hands
      // the socket to a new host over a PTY group whose fate is unknown, which
      // is exactly the containment failure the socket-scoped rule exists for.
      // The verdict must also be TYPED, so no retry path re-decides it.
      const socketPath = deadSocketPath();
      const { error, spawnHost } = await takeoverWithReapOutcome(
        "reap-failure-session",
        socketPath,
        () => {
          throw new Error("registry write failed mid-reap: EACCES");
        },
      );

      expect(error).toBeInstanceOf(NativeTerminalContainmentError);
      expect(error.message).toMatch(/is contained: session reap-failure-session/);
      expect(error.message).toMatch(/reap-failed/);
      expect(spawnHost).not.toHaveBeenCalled();
    });

    it("SUPERVISOR_STILL_TAKES_OVER_WHEN_A_RECYCLED_PGID_PROVES_THE_ORIGINAL_GROUP_IS_GONE", async () => {
      // A row attributed to THIS socket, owner PROVEN dead, whose pgid NUMBER
      // is now held by an unrelated LIVE group leader of a different
      // start-time. Nothing here is injected: the real default reaper reads
      // the real /proc and returns `refused/recycled`.
      //
      // That refusal is not "a PTY group outlived its host", it is the
      // OPPOSITE. A pid number stays allocated as long as any task still
      // references it as pid, tgid, PGID or sid, and a process group id is
      // not reused before the group's lifetime ends, so a live leader at
      // pid == pgid with a DIFFERENT start-time proves every member of the
      // original group is gone. The row is stale: prune it and take over.
      //
      // The unrelated group must also come out of this untouched — a refusal
      // that "contains" this socket by pointing an operator at someone
      // else's process group is the failure mode this case exists to close.
      const socketPath = deadSocketPath();
      const unrelated = spawn(
        process.execPath,
        ["-e", "setTimeout(() => {}, 60_000)"],
        { detached: true, stdio: "ignore" },
      );
      const unrelatedPgid = unrelated.pid!;
      strayProcessGroups.add(unrelatedPgid);
      unrelated.unref();
      const unrelatedStartTime = await realStartTime(unrelatedPgid);

      const owner = spawn(process.execPath, ["-e", "setTimeout(() => {}, 300)"]);
      const ownerPid = owner.pid!;
      const ownerStartTime = await realStartTime(ownerPid);
      persistNativeTerminalPgid(
        "recycled-session",
        unrelatedPgid,
        registryPath,
        { pid: ownerPid, startTime: ownerStartTime, socketPath },
        // The baseline this row was written with, i.e. the start-time of the
        // group leader THAT GROUP had — necessarily not the current holder's.
        unrelatedStartTime - 1,
        randomUUID(),
      );
      owner.kill("SIGKILL");
      await once(owner, "exit");

      const logs: string[] = [];
      const { spawnHost } = fakeSpawnHost();
      const supervisor = new NativeTerminalHostSupervisor({
        socketPath,
        replayBytesPerSession: 1024,
        registryPath,
        spawnHost,
        startupTimeoutMs: 80,
        spawnTerminationGraceMs: 30,
        log: (line) => logs.push(line),
      });

      const error = await supervisor.client().then(
        () => {
          throw new Error("expected the takeover to reject");
        },
        (rejection: Error) => rejection,
      );

      // The fake host never opens a real socket, so the takeover it DID start
      // ends in the ordinary readiness error — never in a containment block.
      expect(error.message).toMatch(/did not become ready/i);
      expect(error.message).not.toMatch(/is contained/);
      expect(spawnHost).toHaveBeenCalled();
      // The stale row is gone, so no later pass re-derives a block from it.
      expect(readNativeTerminalPgid("recycled-session", registryPath)).toEqual({
        status: "unresolved",
        reason: expect.stringMatching(/no pgid recorded/i),
      });
      // Nothing was signalled at the unrelated group.
      expect(running(unrelatedPgid)).toBe(true);
      expect(
        logs.some(
          (line) =>
            line.includes("recycled-session") &&
            /original process group/i.test(line) &&
            /prun/i.test(line),
        ),
      ).toBe(true);
    });

    it("SUPERVISOR_STILL_TAKES_OVER_WHEN_A_ROW_FROM_A_PREVIOUS_BOOT_PROVES_ITS_GROUP_GONE", async () => {
      // A row attributed to THIS socket, owner PROVEN dead, written before the
      // current boot — and whose pgid NUMBER is now held by a live, unrelated
      // group. A reboot ends every process of the previous boot, so the row's
      // own group is PROVEN gone: this is the strongest form of the `recycled`
      // proof, not an absence of one. Blocking here would hold the socket
      // hostage until an unrelated process happens to exit.
      //
      // Nothing is injected below the reap: the real default reaper reads the
      // real /proc and the real frame.
      const socketPath = deadSocketPath();
      const unrelated = spawn(
        process.execPath,
        ["-e", "setTimeout(() => {}, 60_000)"],
        { detached: true, stdio: "ignore" },
      );
      const unrelatedPgid = unrelated.pid!;
      strayProcessGroups.add(unrelatedPgid);
      unrelated.unref();
      // The leader start-time MATCHES what the row records, so nothing but the
      // boot id can decide this: a match would otherwise authorize a SIGKILL.
      const unrelatedStartTime = await realStartTime(unrelatedPgid);

      const owner = spawn(process.execPath, ["-e", "setTimeout(() => {}, 300)"]);
      const ownerPid = owner.pid!;
      const ownerStartTime = await realStartTime(ownerPid);
      persistNativeTerminalPgid(
        "stale-boot-session",
        unrelatedPgid,
        registryPath,
        { pid: ownerPid, startTime: ownerStartTime, socketPath },
        unrelatedStartTime,
        randomUUID(),
      );
      patchDurableRow("stale-boot-session", (row) => {
        expect(row.pgidPidNamespace).toBeTypeOf("string");
        expect(row.pgidBootId).toBeTypeOf("string");
        // Same machine: the proof needs the writer's machine id, and the
        // writer records it on its own.
        expect(row.pgidMachineId).toBeTypeOf("string");
        row.pgidBootId = "00000000-0000-4000-8000-000000000000";
      });
      owner.kill("SIGKILL");
      await once(owner, "exit");

      const logs: string[] = [];
      const { spawnHost } = fakeSpawnHost();
      const supervisor = new NativeTerminalHostSupervisor({
        socketPath,
        replayBytesPerSession: 1024,
        registryPath,
        spawnHost,
        startupTimeoutMs: 80,
        spawnTerminationGraceMs: 30,
        log: (line) => logs.push(line),
      });

      const error = await supervisor.client().then(
        () => {
          throw new Error("expected the takeover to reject");
        },
        (rejection: Error) => rejection,
      );

      expect(error.message).toMatch(/did not become ready/i);
      expect(error.message).not.toMatch(/is contained/);
      expect(spawnHost).toHaveBeenCalled();
      expect(readNativeTerminalPgid("stale-boot-session", registryPath)).toEqual({
        status: "unresolved",
        reason: expect.stringMatching(/no pgid recorded/i),
      });
      // The live group that merely inherited the number is untouched.
      expect(running(unrelatedPgid)).toBe(true);
      expect(
        logs.some(
          (line) =>
            line.includes("stale-boot-session") &&
            /previous boot/i.test(line) &&
            /prun/i.test(line),
        ),
      ).toBe(true);
    });

    it("SUPERVISOR_IS_CONTAINED_BY_A_ROW_ANOTHER_MACHINE_WROTE_INTO_A_SHARED_REGISTRY", async () => {
      // The same row as the previous-boot case, except that ANOTHER machine
      // wrote it: machine A shares this registry (a networked `$HOME`) and its
      // default socket path is the same string as ours. A's host pid is absent
      // here, so its owner reads "dead"; the init pid namespace inode is the
      // same on every kernel; the boot id differs. Only the machine id tells
      // this apart from a previous boot of THIS machine — and A's group may be
      // alive. Pruning here would delete the only durable record of it, so this
      // must block instead, signal nothing, and keep the row.
      const socketPath = deadSocketPath();
      const unrelated = spawn(
        process.execPath,
        ["-e", "setTimeout(() => {}, 60_000)"],
        { detached: true, stdio: "ignore" },
      );
      const unrelatedPgid = unrelated.pid!;
      strayProcessGroups.add(unrelatedPgid);
      unrelated.unref();
      const unrelatedStartTime = await realStartTime(unrelatedPgid);

      const owner = spawn(process.execPath, ["-e", "setTimeout(() => {}, 300)"]);
      const ownerPid = owner.pid!;
      const ownerStartTime = await realStartTime(ownerPid);
      persistNativeTerminalPgid(
        "other-machine-session",
        unrelatedPgid,
        registryPath,
        { pid: ownerPid, startTime: ownerStartTime, socketPath },
        unrelatedStartTime,
        randomUUID(),
      );
      patchDurableRow("other-machine-session", (row) => {
        expect(row.pgidPidNamespace).toBeTypeOf("string");
        row.pgidBootId = "00000000-0000-4000-8000-000000000000";
        row.pgidMachineId = "0123456789abcdef0123456789abcdef";
      });
      owner.kill("SIGKILL");
      await once(owner, "exit");

      const logs: string[] = [];
      const { spawnHost } = fakeSpawnHost();
      const supervisor = new NativeTerminalHostSupervisor({
        socketPath,
        replayBytesPerSession: 1024,
        registryPath,
        spawnHost,
        startupTimeoutMs: 80,
        spawnTerminationGraceMs: 30,
        log: (line) => logs.push(line),
      });

      const error = await supervisor.client().then(
        () => {
          throw new Error("expected the takeover to reject");
        },
        (rejection: Error) => rejection,
      );

      expect(error).toBeInstanceOf(NativeTerminalContainmentError);
      expect((error as NativeTerminalContainmentError).refusalCause).toBe("foreign-frame");
      expect(error.message).toMatch(/is contained: session other-machine-session/);
      expect(spawnHost).not.toHaveBeenCalled();
      // The row is KEPT: it is the only durable record of A's group.
      expect(readNativeTerminalPgid("other-machine-session", registryPath)).toMatchObject({
        status: "resolved",
        pgid: unrelatedPgid,
      });
      // The local group that merely holds the same number is untouched.
      expect(running(unrelatedPgid)).toBe(true);
      expect(
        logs.some(
          (line) =>
            line.includes("other-machine-session") &&
            /ANOTHER machine/.test(line) &&
            line.includes("cause=foreign-frame"),
        ),
      ).toBe(true);
    });

    it("SUPERVISOR_DOES_NOT_CLAIM_A_PROVEN_DEAD_OWNER_WHEN_THE_OWNER_PROBE_FAILED", async () => {
      // A `reap-failed` taken BEFORE the owner's liveness was established still
      // blocks — nothing was proven about the group either — but the operator
      // message must not assert a death nobody proved.
      const socketPath = deadSocketPath();
      persistNativeTerminalPgid("probe-failure-session", 7_778, registryPath, {
        pid: process.pid,
        startTime: readProcessStartTime(process.pid)!,
        socketPath,
      });
      const { spawnHost } = fakeSpawnHost();
      const supervisor = new NativeTerminalHostSupervisor({
        socketPath,
        replayBytesPerSession: 1024,
        registryPath,
        spawnHost,
        startupTimeoutMs: 80,
        spawnTerminationGraceMs: 30,
        ownerProbe: () => {
          throw new Error("owner probe failed: EIO");
        },
        log: () => {},
      });

      const error = await supervisor.client().then(
        () => {
          throw new Error("expected the takeover to reject");
        },
        (rejection: Error) => rejection,
      );

      expect(error).toBeInstanceOf(NativeTerminalContainmentError);
      expect(error.message).toMatch(/is contained: session probe-failure-session/);
      expect(error.message).toMatch(/reap-failed/);
      expect(error.message).not.toMatch(/proven-dead host/);
      expect(error.message).toMatch(/never proven/i);
      expect(spawnHost).not.toHaveBeenCalled();
    });

    it("SUPERVISOR_STILL_TAKES_OVER_WHEN_A_CONCURRENT_PASS_ALREADY_PRUNED_THE_ROW", async () => {
      // The loser of a race between two reconcile passes sees a CAUSE-LESS
      // refusal: the winner confirmed the reap and pruned the row, so the
      // pgid no longer resolves. That is an absence of information, not a
      // surviving group — takeover must proceed exactly as before.
      const socketPath = deadSocketPath();
      const { error, spawnHost } = await takeoverWithReapOutcome(
        "raced-session",
        socketPath,
        (sessionId) => ({
          sessionId,
          status: "refused",
          reason: `no pgid recorded for terminal session ${sessionId}`,
        }),
      );

      // The fake host never opens a real socket, so the takeover it DID start
      // ends in the ordinary readiness error — never in a containment block.
      expect(error.message).toMatch(/did not become ready/i);
      expect(error.message).not.toMatch(/is contained/);
      expect(spawnHost).toHaveBeenCalled();
    });

    // 2026-08-10: reaping resolves pgid via readNativeTerminalPgid (2-state global reader), NOT #199's 3-state per-identity loadRegistry.
    // De-skip when the reaping migrates to loadRegistry (per-identity unknown, never a global once).
    it.skip('reap treats unknown per identity, never as a global state', () => {});
  },
);
