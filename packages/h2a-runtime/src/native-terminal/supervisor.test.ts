import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter, once } from "node:events";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { persistNativeTerminalPgid, readNativeTerminalPgid } from "../registry.js";
import { readProcessStartTime, type NativeTerminalReapOutcome } from "./host.js";
import { NativeTerminalHostSupervisor, type NativeTerminalHostSpawn } from "./supervisor.js";
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

beforeEach(() => {
  mkdirSync(SCRATCH_ROOT, { recursive: true });
  scratch = mkdtempSync(join(SCRATCH_ROOT, "s-"));
  registryPath = join(scratch, "registry.json");
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

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
      expect(readNativeTerminalPgid("live-session", registryPath)).toEqual({
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
     * and whose row is attributed to `socketPath`, then drive one takeover
     * with an injected reap outcome. Returns the supervisor's rejection.
     */
    async function takeoverWithReapOutcome(
      sessionId: string,
      socketPath: string,
      outcome: (sessionId: string, pgid: number) => NativeTerminalReapOutcome,
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
        socketPath,
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
