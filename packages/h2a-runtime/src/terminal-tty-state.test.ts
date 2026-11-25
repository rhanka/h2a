import { describe, expect, it } from "vitest";

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import {
  enterRawOutputTty,
  installTtySuspendHandlers,
  restoreTtyState,
  saveTtyState,
  TtyBaselineRegistry,
  type SttySaveResult,
} from "./terminal-reset.js";

type StubStdin = NodeJS.ReadStream & { rawCalls: boolean[] };

function stubStdin(
  fd: number | undefined,
  isRaw = false,
  isTTY = true,
): StubStdin {
  const rawCalls: boolean[] = [];
  const stdin = {
    isTTY,
    isRaw,
    fd,
    setRawMode(raw: boolean) {
      rawCalls.push(raw);
      (stdin as { isRaw: boolean }).isRaw = raw;
      return stdin;
    },
    rawCalls,
  } as unknown as StubStdin;
  return stdin;
}

describe("tty save/restore (rev351r2-2, shared stty helper)", () => {
  it("should not touch stty when stdin is not a TTY", () => {
    let calls = 0;
    const stdin = stubStdin(undefined, false, false);
    const state = saveTtyState(stdin, () => {
      calls += 1;
      return { status: 0, stdout: "g0a31" };
    });
    expect(state.saved).toBeUndefined();
    expect(calls).toBe(0);
    let resets = 0;
    restoreTtyState(
      state,
      stdin,
      () => {
        resets += 1;
      },
      () => {
        calls += 1;
        return {};
      },
    );
    expect(resets).toBe(1);
    expect(calls).toBe(0);
    expect(stdin.rawCalls).toEqual([]);
  });

  it("should save via stty -g and restore raw mode plus the saved state", () => {
    const seen: string[][] = [];
    const stdin = stubStdin(99);
    const state = saveTtyState(stdin, (args) => {
      seen.push([...args]);
      return { status: 0, stdout: "g0a31" };
    });
    expect(seen).toEqual([["-g"]]);
    expect(state.stdinFd).toBe(99);
    expect(state.wasRaw).toBe(false);
    // The child leaves raw on; restore must switch it back off.
    (stdin as unknown as { isRaw: boolean }).isRaw = true;
    const restored: string[][] = [];
    let resets = 0;
    restoreTtyState(
      state,
      stdin,
      () => {
        resets += 1;
      },
      (args) => {
        restored.push([...args]);
        return { status: 0 };
      },
    );
    expect(resets).toBe(1);
    expect(stdin.rawCalls).toEqual([false]);
    expect(restored).toEqual([["g0a31"]]);
  });

  it("should skip the stty restore when the save failed, but still restore raw", () => {
    const stdin = stubStdin(99);
    const state = saveTtyState(stdin, () => {
      throw new Error("no tty");
    });
    expect(state.saved).toBeUndefined();
    let spawns = 0;
    restoreTtyState(
      state,
      stdin,
      () => {},
      () => {
        spawns += 1;
        return {};
      },
    );
    expect(spawns).toBe(0);
    expect(stdin.rawCalls).toEqual([false]);
  });

  it("should restore a raw stdin back to raw", () => {
    const stdin = stubStdin(99, true);
    const state = saveTtyState(stdin, () => ({ status: 0, stdout: "abc" }));
    restoreTtyState(state, stdin, () => {}, () => ({ status: 0 }));
    expect(stdin.rawCalls).toEqual([true]);
  });
});

describe("Rule 1 — -opost, distinct stdout.fd, TtyBaselineRegistry, and SIGTSTP/SIGCONT", () => {
  it("runs stty -opost only on POSIX when stdout.isTTY is true and restores distinct stdout.fd", () => {
    const calls: Array<{ args: string[]; stdinFd: number; capture: boolean }> = [];
    const stty = (args: ReadonlyArray<string>, opts: { readonly stdinFd: number; readonly capture: boolean }): SttySaveResult => {
      calls.push({ args: [...args], stdinFd: opts.stdinFd, capture: opts.capture });
      if (args[0] === "-g") {
        return { status: 0, stdout: opts.stdinFd === 11 ? "out-s0\n" : "in-s0\n" };
      }
      return { status: 0 };
    };
    const stdin = stubStdin(10, false);
    const stdout = { isTTY: true, fd: 11 };

    const state = enterRawOutputTty(stdin, stdout, { stty, registry: null, platform: "linux" });
    expect(stdin.rawCalls).toEqual([true]);
    expect(calls).toEqual([
      { args: ["-g"], stdinFd: 10, capture: true },
      { args: ["-g"], stdinFd: 11, capture: true },
      { args: ["-opost"], stdinFd: 11, capture: false },
    ]);

    calls.length = 0;
    restoreTtyState(state, stdin, () => {}, stty);
    expect(stdin.rawCalls).toEqual([true, false]);
    expect(calls).toEqual([
      { args: ["in-s0"], stdinFd: 10, capture: false },
      { args: ["out-s0"], stdinFd: 11, capture: false },
    ]);

    // Non-TTY stdout must never run stty -opost; win32 must never run stty -opost
    const nonTtyCalls: string[][] = [];
    const stty2 = (args: ReadonlyArray<string>): SttySaveResult => {
      nonTtyCalls.push([...args]);
      return { status: 0, stdout: "s0\n" };
    };
    enterRawOutputTty(stubStdin(10, false), { isTTY: false, fd: 10 }, { stty: stty2, registry: null, platform: "linux" });
    expect(nonTtyCalls).toEqual([["-g"]]);
    nonTtyCalls.length = 0;
    enterRawOutputTty(stubStdin(10, false), { isTTY: true, fd: 10 }, { stty: stty2, registry: null, platform: "win32" });
    expect(nonTtyCalls).toEqual([]);
  });

  it("preserves baseline S0 in TtyBaselineRegistry across concurrent holders, dead PIDs, and stale locks", () => {
    const dir = mkdtempSync(join(tmpdir(), "tty-reg-test-"));
    try {
      const alive = new Set<number>([1001, 1002]);
      const startTimes = new Map<number, number>([[1001, 10], [1002, 20]]);
      const devId = { uid: 1000, dev: 1, rdev: 7, key: "1000-1-7" };
      const mkReg = (pid: number) =>
        new TtyBaselineRegistry({
          runtimeDir: dir,
          pid,
          isPidAlive: (p) => alive.has(p),
          readStartTime: (p) => startTimes.get(p),
          resolveDevice: () => devId,
        });

      const r1 = mkReg(1001);
      const a1 = r1.acquire(10, { role: "guard", wasRaw: false, captureBaseline: () => "S0-orig" })!;
      expect(a1.baseline).toBe("S0-orig");

      // Second holder must reuse S0-orig even if TTY now reads S1-raw
      const r2 = mkReg(1002);
      const a2 = r2.acquire(10, { role: "active", wasRaw: true, captureBaseline: () => "S1-dirty" })!;
      expect(a2.baseline).toBe("S0-orig");
      expect(a2.baselineWasRaw).toBe(false);

      // Releasing r1 (guard) while r2 (active) is alive must NOT tell r1 to restore baseline
      const rel1 = r1.release(devId, a1.token)!;
      expect(rel1.restoreBaseline).toBe(false);
      expect(rel1.isLastHolder).toBe(false);

      // Simulate r2 killed + replaced by stale lock from dead pid 9999
      alive.delete(1002);
      writeFileSync(join(dir, "h2a-tty-baseline", `${devId.key}.json.lock`), "9999:1", { mode: 0o600 });
      const r3 = mkReg(1001);
      const a3 = r3.acquire(10, { role: "active", wasRaw: false, captureBaseline: () => "S0-rebuilt" })!;
      expect(a3.baseline).toBe("S0-rebuilt");
      const rel3 = r3.release(devId, a3.token)!;
      expect(rel3.restoreBaseline).toBe(true);
      expect(rel3.isLastHolder).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("installTtySuspendHandlers restores baseline on SIGTSTP and re-applies raw/-opost on two SIGCONT cycles", () => {
    const proc = Object.assign(new EventEmitter(), {
      pid: 4242,
      killedSignals: [] as string[],
      kill(_pid: number, sig: string) {
        this.killedSignals.push(sig);
        return true;
      },
    });
    const sttyCalls: string[][] = [];
    const stty = (args: ReadonlyArray<string>): SttySaveResult => {
      sttyCalls.push([...args]);
      return { status: 0, stdout: "S0-mode\n" };
    };
    const stdin = stubStdin(10, false);
    const stdout = { isTTY: true, fd: 10 };
    const state = enterRawOutputTty(stdin, stdout, { stty, registry: null, platform: "linux" });
    let suspends = 0;
    let resumes = 0;
    const uninstall = installTtySuspendHandlers({
      state,
      stdin,
      stdout,
      stty,
      platform: "linux",
      processObj: proc as unknown as Pick<NodeJS.Process, "on" | "removeListener" | "kill" | "pid">,
      beforeSuspend: () => { suspends += 1; },
      afterResume: () => { resumes += 1; },
    });

    sttyCalls.length = 0;
    stdin.rawCalls.length = 0;
    proc.emit("SIGTSTP");
    expect(suspends).toBe(1);
    expect(stdin.rawCalls).toEqual([false]);
    expect(sttyCalls).toEqual([["S0-mode"]]);
    expect(proc.killedSignals).toEqual(["SIGTSTP"]);

    proc.emit("SIGCONT");
    expect(resumes).toBe(1);
    expect(stdin.rawCalls).toEqual([false, true]);
    expect(sttyCalls).toEqual([["S0-mode"], ["-opost"]]);

    // Second Ctrl+Z / fg cycle must still work cleanly
    proc.emit("SIGTSTP");
    expect(suspends).toBe(2);
    proc.emit("SIGCONT");
    expect(resumes).toBe(2);

    uninstall();
    expect(proc.listenerCount("SIGTSTP")).toBe(0);
    expect(proc.listenerCount("SIGCONT")).toBe(0);
    // Avoid unused import warning
    expect(typeof readFileSync).toBe("function");
  });
});
