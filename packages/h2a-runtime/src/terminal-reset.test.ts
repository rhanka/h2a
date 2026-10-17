import { describe, expect, it } from "vitest";
import { TerminalModeTracker } from "./native-terminal/terminal-modes.js";
import {
  CLIENT_TERMINAL_RESET_SEQUENCE,
  resetClientTerminal,
  statusFromSpawnResult,
  withClientTerminalReset,
} from "./terminal-reset.js";

const E = "\x1b";

describe("client terminal reset", () => {
  it("should cover every mode the tracked native path can leave outstanding", () => {
    // The untracked inherit-stdio paths must restore at least what the
    // tracked native path restores. Kitty differs by design: without a byte
    // stream there is no stack to pop, so flags are zeroed instead.
    const tracker = new TerminalModeTracker();
    tracker.feed(
      `${E}[?1;47;1047;1049;1000;1002;1003;1004;1006;1015;2004;2026h${E}[?25l${E}=${E}[>4;2m${E}[>1u`,
    );
    const tracked = tracker.resetSequence().replace(`${E}[<1u`, `${E}[=0u`);
    for (const chunk of [`${E}[?2026l`, `${E}[?25h`, `${E}>`, `${E}[>4;0m`]) {
      expect(CLIENT_TERMINAL_RESET_SEQUENCE).toContain(chunk);
    }
    expect(tracked.length).toBeGreaterThan(0);
    // Every DEC reset the tracker emits must appear in the fixed sequence.
    for (const match of tracked.matchAll(/\x1b\[\?\d+l/g)) {
      expect(CLIENT_TERMINAL_RESET_SEQUENCE).toContain(match[0]);
    }
    expect(CLIENT_TERMINAL_RESET_SEQUENCE).toContain(`${E}[=0u`);
    // rev351-3.1: abort a truncated CSI/OSC so the reset itself is not
    // swallowed when the child died mid-write.
    expect(CLIENT_TERMINAL_RESET_SEQUENCE).toContain("\x18");
    expect(CLIENT_TERMINAL_RESET_SEQUENCE).toContain(`${E}\\`);
    // rev351-3.1: pop both Kitty keyboard stacks (alternate before leaving
    // it, main after): the two screens own independent stacks.
    expect(CLIENT_TERMINAL_RESET_SEQUENCE).toContain(`${E}[<16u`);
    // Explicit mouse + focus + paste + screen + cursor coverage (the DEC
    // loop above already covers them via the tracker, but pin them so a
    // narrowed sequence cannot slip through).
    for (const chunk of [
      `${E}[?1000l`,
      `${E}[?1002l`,
      `${E}[?1006l`,
      `${E}[?1004l`,
      `${E}[?2004l`,
      `${E}[?1049l`,
      `${E}[?25h`,
    ]) {
      expect(CLIENT_TERMINAL_RESET_SEQUENCE).toContain(chunk);
    }
    // The fixed reset must fully clean a tracker fed with every mode.
    const full = new TerminalModeTracker();
    full.feed(
      `${E}[?1;47;1047;1049;1000;1002;1003;1004;1006;1015;2004;2026h${E}[?25l${E}=${E}[>4;2m${E}[>1u`,
    );
    full.feed(CLIENT_TERMINAL_RESET_SEQUENCE);
    expect(full.resetSequence()).toBe("");
  });

  it("should leave a balanced stream alone when fed back through the tracker", () => {
    const tracker = new TerminalModeTracker();
    tracker.feed(`${E}[?1004h${E}[?2004h${E}[?1000h${E}[?1049h${E}[?25l`);
    tracker.feed(CLIENT_TERMINAL_RESET_SEQUENCE);
    expect(tracker.resetSequence()).toBe("");
  });

  it("should pass the child result through and reset exactly once", () => {
    let resets = 0;
    const result = withClientTerminalReset(() => 42, () => {
      resets += 1;
    });
    expect(result).toBe(42);
    expect(resets).toBe(1);
  });

  it("should reset on a synchronous exception without swallowing it", () => {
    let resets = 0;
    expect(() =>
      withClientTerminalReset(
        (): void => {
          throw new Error("boom");
        },
        () => {
          resets += 1;
        },
      ),
    ).toThrow("boom");
    expect(resets).toBe(1);
  });

  it("should not trap signals around the child (no swallowing, no blocking)", () => {
    // rev351-1: trapping SIGINT/SIGTERM around a blocking spawnSync defers
    // delivery until the event loop runs, swallows the signal and blocks the
    // wrapper (plus breaks Ctrl-C in the reconnect loop). The sync wrapper
    // must leave dispositions alone; child signal death is mapped to 128+n.
    const signals = ["SIGINT", "SIGTERM", "SIGHUP", "SIGQUIT"] as const;
    const before = new Map(signals.map((s) => [s, process.listenerCount(s)]));
    withClientTerminalReset(() => 1, () => {});
    for (const s of signals) {
      expect(process.listenerCount(s)).toBe(before.get(s));
    }
    let inside = "";
    withClientTerminalReset(
      () => {
        for (const s of signals) inside += `${s}=${process.listenerCount(s)};`;
        return 1;
      },
      () => {},
    );
    for (const s of signals) {
      expect(inside).toContain(`${s}=${before.get(s)};`);
    }
  });

  it("should map child signal death to 128+n, never 0", () => {
    // rev351-1.1: r.status is null when the child dies by signal; `?? 0`
    // reported a signal death as success.
    expect(statusFromSpawnResult({ status: 0, signal: null })).toBe(0);
    expect(statusFromSpawnResult({ status: 3, signal: null })).toBe(3);
    expect(statusFromSpawnResult({ status: null, signal: "SIGTERM" })).toBe(143);
    expect(statusFromSpawnResult({ status: null, signal: "SIGINT" })).toBe(130);
    expect(statusFromSpawnResult({ status: null, signal: "SIGHUP" })).toBe(129);
    expect(statusFromSpawnResult({ status: null, signal: "SIGKILL" })).toBe(137);
    expect(statusFromSpawnResult({ status: null, signal: null })).not.toBe(0);
  });

  it("should restore stdin raw mode even when the child leaves it raw", () => {
    // rev351-3.2: a foreground CLI killed after setting raw leaves the TTY
    // without echo/canonical; the wrapper must restore wasRaw in finally.
    const calls: boolean[] = [];
    const stdin = {
      isTTY: true,
      isRaw: false,
      fd: undefined as unknown as number | undefined,
      setRawMode(raw: boolean) {
        calls.push(raw);
        (stdin as { isRaw: boolean }).isRaw = raw;
        return stdin;
      },
    };
    withClientTerminalReset(
      () => {
        stdin.setRawMode(true);
        return "ok";
      },
      () => {},
      stdin as unknown as NodeJS.ReadStream,
    );
    expect(calls).toContain(false);
    expect((stdin as { isRaw: boolean }).isRaw).toBe(false);
  });

  it("should write the reset via .write when a TTY has no fd number", () => {
    // Makes run()/attach() unit tests observable with stub stdouts.
    const written: string[] = [];
    const ok = resetClientTerminal({
      isTTY: true,
      write: (chunk: string) => {
        written.push(chunk);
        return true;
      },
    } as unknown as NodeJS.WriteStream);
    expect(ok).toBe(true);
    expect(written.join("")).toContain("\x1b[?1004l");
  });

  it("should not touch a non-TTY stdout", () => {
    expect(resetClientTerminal({ isTTY: false, fd: 1 })).toBe(false);
    expect(resetClientTerminal({ isTTY: undefined, fd: 1 })).toBe(false);
  });
});
