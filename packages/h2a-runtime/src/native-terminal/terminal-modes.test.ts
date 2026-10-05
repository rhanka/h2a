import { describe, expect, it } from "vitest";
import { TerminalModeTracker } from "./terminal-modes.js";

const E = "\x1b";

describe("terminal mode tracker", () => {
  it("should reset only modes still changed by the application across every split", () => {
    const stream = `${E}[?1004;2004;1049;1000;1006h${E}[?25l${E}[?1h${E}=${E}[?2004l`;
    const reset = `${E}[?1l${E}[?1000l${E}[?1004l${E}[?1006l${E}[?1049l${E}[?25h${E}>`;
    for (let split = 0; split <= stream.length; split++) {
      const tracker = new TerminalModeTracker();
      tracker.feed(stream.slice(0, split));
      tracker.feed(stream.slice(split));
      expect(tracker.resetSequence(), `split ${split}`).toBe(reset);
    }
  });

  it("should leave an untouched or balanced terminal alone", () => {
    const tracker = new TerminalModeTracker();
    tracker.feed(`${E}[?1004h${E}[?1004l${E}[?25l${E}[?25h${E}=${E}>${E}[>4;2m${E}[>4;0m`);
    expect(tracker.resetSequence()).toBe("");
    expect(tracker.restoreSequence()).toBe("");
  });

  it("should unwind kitty pushes including disabled flags and counted pops", () => {
    const tracker = new TerminalModeTracker();
    for (const c of `${E}[>1u${E}[>0u${E}[>5u${E}[<2u${E}[>4;2m`) tracker.feed(c);
    expect(tracker.resetSequence()).toBe(`${E}[<1u${E}[>4;0m`);
    expect(tracker.restoreSequence()).toBe(`${E}[>1u${E}[>4;2m`);
    tracker.feed(`${E}[<u${E}[>4;0m`);
    expect(tracker.resetSequence()).toBe("");
  });

  it("should restore kitty stacks and direct flag changes without losing pop semantics", () => {
    const tracker = new TerminalModeTracker();
    tracker.feed(`${E}[=1u${E}[>2u${E}[=4;2u${E}[>0u`);
    expect(tracker.restoreSequence()).toBe(`${E}[=1u${E}[>6u${E}[>0u`);
    expect(tracker.resetSequence()).toBe(`${E}[<2u${E}[=0u`);
    const restored = new TerminalModeTracker();
    restored.feed(tracker.restoreSequence());
    restored.feed(`${E}[<u`);
    expect(restored.restoreSequence()).toBe(`${E}[=1u${E}[>6u`);
  });

  it("should ignore escape-looking payloads inside OSC, DCS and other control strings", () => {
    const tracker = new TerminalModeTracker();
    for (const c of `${E}]title;${E}[?1004h\x07${E}P${E}[?2004h${E}\\${E}_${E}[?1049h${E}\\`) tracker.feed(c);
    expect(tracker.resetSequence()).toBe("");
    tracker.feed(`${E}[?1004\x18h${E}[?9999h`);
    expect(tracker.resetSequence()).toBe("");
  });

  it("should restore all supported DEC modes and clear synchronized output before other resets", () => {
    const tracker = new TerminalModeTracker();
    tracker.feed(`${E}[?1;47;1047;1049;1000;1002;1003;1004;1006;1015;2004;2026h${E}[?25l`);
    const restored = new TerminalModeTracker();
    restored.feed(tracker.restoreSequence());
    expect(restored.resetSequence()).toBe(tracker.resetSequence());
    expect(tracker.resetSequence().startsWith(`${E}[?2026l`)).toBe(true);
    tracker.feed(tracker.resetSequence());
    expect(tracker.resetSequence()).toBe("");
  });

  it("should pop each kitty stack on its own screen before restoring the main shell", () => {
    const tracker = new TerminalModeTracker();
    tracker.feed(`${E}[>1u${E}[?1049h${E}[>5u`);
    expect(tracker.restoreSequence()).toBe(`${E}[>1u${E}[?1049h${E}[>5u`);
    expect(tracker.resetSequence()).toBe(`${E}[<1u${E}[?1049l${E}[<1u`);
    tracker.feed(tracker.resetSequence());
    expect(tracker.resetSequence()).toBe("");
  });

  it("should cancel incomplete control sequences before cleaning active modes", () => {
    for (const partial of [E, `${E}[?200`, `${E}]unterminated`, `${E}Punterminated`]) {
      const tracker = new TerminalModeTracker();
      tracker.feed(`${E}[?1004h${partial}`);
      expect(tracker.resetSequence()).toBe(`\x18${E}[?1004l`);
      tracker.feed(tracker.resetSequence());
      expect(tracker.resetSequence()).toBe("");
    }
  });

  it("should observe an application RIS without redundantly resetting cleared modes", () => {
    const tracker = new TerminalModeTracker();
    tracker.feed(`${E}[?1004h${E}[?25l${E}[>1u${E}[>4;2m${E}c`);
    expect(tracker.resetSequence()).toBe("");
  });
});
