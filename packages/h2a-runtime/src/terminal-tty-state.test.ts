import { describe, expect, it } from "vitest";

import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import {
  enterRawOutputTty,
  installTtySuspendHandlers,
  restoreTtyState,
  saveTtyState,
  TtyBaselineRegistry,
  withClientTerminalReset,
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
      { args: ["-g"], stdinFd: 10, capture: true },
      { args: ["-g"], stdinFd: 11, capture: true },
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
    expect(nonTtyCalls).toEqual([["-g"], ["-g"]]);
    nonTtyCalls.length = 0;
    enterRawOutputTty(stubStdin(10, false), { isTTY: true, fd: 10 }, { stty: stty2, registry: null, platform: "win32" });
    expect(nonTtyCalls).toEqual([]);
  });

  it("preserves baseline S0 in TtyBaselineRegistry across concurrent holders, dead PIDs, stale locks, and read-only FS fallback (NB-1)", () => {
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

      // NB-1: Unwritable runtimeDir (file blocking directory / read-only dir) falls back to in-memory without throwing
      const fileBlocker = join(dir, "not-a-dir");
      writeFileSync(fileBlocker, "blocker");
      const roFileReg = new TtyBaselineRegistry({
        runtimeDir: fileBlocker,
        pid: 1001,
        isPidAlive: () => true,
        readStartTime: () => 10,
        resolveDevice: () => devId,
      });
      const roFileAcq = roFileReg.acquire(10, { role: "active", wasRaw: false, captureBaseline: () => "S0-mem" })!;
      expect(roFileAcq.baseline).toBe("S0-mem");
      expect(roFileReg.release(devId, roFileAcq.token)?.restoreBaseline).toBe(true);

      const roSubdir = join(dir, "ro-parent");
      const roReg = new TtyBaselineRegistry({
        runtimeDir: roSubdir,
        pid: 1001,
        isPidAlive: () => true,
        readStartTime: () => 10,
        resolveDevice: () => devId,
      });
      // First create h2a-tty-baseline directory, then make it read-only so writeFileSync fails with EACCES
      const seed = roReg.acquire(10, { role: "guard", wasRaw: false, captureBaseline: () => "S0-seed" })!;
      roReg.release(devId, seed.token);
      chmodSync(join(roSubdir, "h2a-tty-baseline"), 0o500);
      try {
        const acqRo = roReg.acquire(10, { role: "active", wasRaw: false, captureBaseline: () => "S0-ro" })!;
        expect(acqRo.baseline).toBe("S0-ro");
        const suspRo = roReg.setSuspended(devId, acqRo.token, true);
        expect(suspRo?.shouldRestoreNow).toBe(true);
        const relRo = roReg.release(devId, acqRo.token)!;
        expect(relRo.restoreBaseline).toBe(true);
        expect(relRo.baseline).toBe("S0-ro");
      } finally {
        chmodSync(join(roSubdir, "h2a-tty-baseline"), 0o700);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("installTtySuspendHandlers restores S0 on SIGTSTP and re-applies S1 on two SIGCONT cycles without breaking on libuv mode cache", () => {
    const proc = Object.assign(new EventEmitter(), {
      pid: 4242,
      killedSignals: [] as string[],
      kill(_pid: number, sig: string) {
        this.killedSignals.push(sig);
        return true;
      },
    });
    // Model real kernel termios + libuv's tty->mode cache:
    // setRawMode(raw) is a NO-OP when raw === libuvCachedRaw!
    // stty mutates kernel termios directly WITHOUT updating libuvCachedRaw.
    const kernel = { opost: true, onlcr: true, icanon: true, echo: true };
    let libuvCachedRaw = false;
    const rawCalls: boolean[] = [];
    const stdin = {
      isTTY: true,
      get isRaw() {
        return libuvCachedRaw;
      },
      fd: 10,
      setRawMode(raw: boolean) {
        rawCalls.push(raw);
        if (raw === libuvCachedRaw) return stdin as unknown as NodeJS.ReadStream;
        libuvCachedRaw = raw;
        kernel.icanon = !raw;
        kernel.echo = !raw;
        return stdin as unknown as NodeJS.ReadStream;
      },
    } as unknown as NodeJS.ReadStream;
    const stdout = { isTTY: true, fd: 10 };
    const sttyCalls: string[][] = [];
    const stty = (args: ReadonlyArray<string>): SttySaveResult => {
      sttyCalls.push([...args]);
      if (args[0] === "-g") {
        return { status: 0, stdout: `${JSON.stringify(kernel)}\n` };
      }
      if (args[0] === "-opost") {
        kernel.opost = false;
        return { status: 0 };
      }
      const parsed = JSON.parse(args[0]!) as typeof kernel;
      Object.assign(kernel, parsed);
      return { status: 0 };
    };

    const state = enterRawOutputTty(stdin, stdout, { stty, registry: null, platform: "linux" });
    expect(kernel).toEqual({ opost: false, onlcr: true, icanon: false, echo: false });
    expect(libuvCachedRaw).toBe(true);

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
    rawCalls.length = 0;

    // Cycle 1: SIGTSTP restores S0 in kernel while libuv cache stays RAW (true)
    proc.emit("SIGTSTP");
    expect(suspends).toBe(1);
    expect(rawCalls).toEqual([]);
    expect(libuvCachedRaw).toBe(true);
    expect(kernel).toEqual({ opost: true, onlcr: true, icanon: true, echo: true });
    expect(proc.killedSignals).toEqual(["SIGTSTP"]);

    // SIGCONT must restore full raw + -opost (-icanon -echo -opost) even though libuv cache is still true!
    proc.emit("SIGCONT");
    expect(resumes).toBe(1);
    expect(kernel).toEqual({ opost: false, onlcr: true, icanon: false, echo: false });

    // Cycle 2
    proc.emit("SIGTSTP");
    expect(suspends).toBe(2);
    expect(kernel).toEqual({ opost: true, onlcr: true, icanon: true, echo: true });
    proc.emit("SIGCONT");
    expect(resumes).toBe(2);
    expect(kernel).toEqual({ opost: false, onlcr: true, icanon: false, echo: false });

    uninstall();
    restoreTtyState(state, stdin, () => {}, stty);
    expect(kernel).toEqual({ opost: true, onlcr: true, icanon: true, echo: true });
    expect(libuvCachedRaw).toBe(false);
    expect(proc.listenerCount("SIGTSTP")).toBe(0);
    expect(proc.listenerCount("SIGCONT")).toBe(0);
    expect(typeof readFileSync).toBe("function");
  });

  it("installTtySuspendHandlers bounces setRawMode(false)->setRawMode(true) when S1 capture was unavailable under libuv mode cache", () => {
    const proc = Object.assign(new EventEmitter(), {
      pid: 4343,
      kill() { return true; },
    });
    const kernel = { opost: true, onlcr: true, icanon: true, echo: true };
    let libuvCachedRaw = false;
    const rawCalls: boolean[] = [];
    const stdin = {
      isTTY: true,
      get isRaw() { return libuvCachedRaw; },
      fd: 10,
      setRawMode(raw: boolean) {
        rawCalls.push(raw);
        if (raw === libuvCachedRaw) return stdin as unknown as NodeJS.ReadStream;
        libuvCachedRaw = raw;
        kernel.icanon = !raw;
        kernel.echo = !raw;
        return stdin as unknown as NodeJS.ReadStream;
      },
    } as unknown as NodeJS.ReadStream;
    const stdout = { isTTY: true, fd: 10 };
    let gCount = 0;
    const stty = (args: ReadonlyArray<string>): SttySaveResult => {
      if (args[0] === "-g") {
        gCount += 1;
        // Succeed on initial S0 capture, fail on S1 capture so Option B fallback is exercised
        return gCount === 1 ? { status: 0, stdout: `${JSON.stringify(kernel)}\n` } : { status: 1, stdout: "" };
      }
      if (args[0] === "-opost") {
        kernel.opost = false;
        return { status: 0 };
      }
      Object.assign(kernel, JSON.parse(args[0]!) as typeof kernel);
      return { status: 0 };
    };

    const state = enterRawOutputTty(stdin, stdout, { stty, registry: null, platform: "linux" });
    const uninstall = installTtySuspendHandlers({
      state,
      stdin,
      stdout,
      stty,
      platform: "linux",
      processObj: proc as unknown as Pick<NodeJS.Process, "on" | "removeListener" | "kill" | "pid">,
    });

    rawCalls.length = 0;
    proc.emit("SIGTSTP");
    expect(kernel).toEqual({ opost: true, onlcr: true, icanon: true, echo: true });
    expect(libuvCachedRaw).toBe(true);

    proc.emit("SIGCONT");
    expect(rawCalls).toEqual([false, true]);
    expect(kernel).toEqual({ opost: false, onlcr: true, icanon: false, echo: false });
    expect(libuvCachedRaw).toBe(true);

    uninstall();
    restoreTtyState(state, stdin, () => {}, stty);
    expect(kernel).toEqual({ opost: true, onlcr: true, icanon: true, echo: true });
  });

  it("withClientTerminalReset registers as role guard so it does not block a concurrent active restore (NB-10)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tty-guard-role-"));
    const prevXdg = process.env["XDG_RUNTIME_DIR"];
    process.env["XDG_RUNTIME_DIR"] = dir;
    const { openSync, closeSync } = await import("node:fs");
    const devNullFd = openSync("/dev/null", "r");
    try {
      const fakeIn = {
        isTTY: true,
        isRaw: false,
        fd: devNullFd,
        setRawMode: () => fakeIn,
      } as unknown as NodeJS.ReadStream;
      const fakeOut = { isTTY: false, fd: undefined };
      const { defaultTtyBaselineRegistry } = await import("./terminal-reset.js");
      let inspectedRole: string | undefined;
      withClientTerminalReset(
        () => {
          inspectedRole = defaultTtyBaselineRegistry.inspect(devNullFd)?.holders[0]?.role;
        },
        () => {},
        fakeIn,
        fakeOut,
      );
      expect(inspectedRole).toBe("guard");
    } finally {
      closeSync(devNullFd);
      if (prevXdg === undefined) delete process.env["XDG_RUNTIME_DIR"];
      else process.env["XDG_RUNTIME_DIR"] = prevXdg;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
