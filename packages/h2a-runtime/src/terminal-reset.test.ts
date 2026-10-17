import { describe, expect, it } from "vitest";
import { TerminalModeTracker } from "./native-terminal/terminal-modes.js";
import {
  CLIENT_TERMINAL_RESET_SEQUENCE,
  resetClientTerminal,
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

  it("should install signal handlers only while the child runs", () => {
    const before = process.listenerCount("SIGTERM");
    withClientTerminalReset(() => {
      expect(process.listenerCount("SIGTERM")).toBe(before + 1);
      expect(process.listenerCount("SIGINT")).toBeGreaterThan(0);
    });
    expect(process.listenerCount("SIGTERM")).toBe(before);
  });

  it("should not touch a non-TTY stdout", () => {
    expect(resetClientTerminal({ isTTY: false, fd: 1 })).toBe(false);
    expect(resetClientTerminal({ isTTY: undefined, fd: 1 })).toBe(false);
  });
});
