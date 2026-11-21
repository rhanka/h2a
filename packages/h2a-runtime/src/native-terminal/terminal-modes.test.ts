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

  it("exposes keyboard/paste mode accessors (bracketed paste 2004, kitty keyboard, DECCKM)", () => {
    const tracker = new TerminalModeTracker();
    expect(tracker.isBracketedPasteEnabled()).toBe(false);
    expect(tracker.isKittyKeyboardEnabled()).toBe(false);
    expect(tracker.isApplicationCursorKeysEnabled()).toBe(false);

    tracker.feed(`${E}[?2004h${E}[?1h${E}[>1u`);
    expect(tracker.isBracketedPasteEnabled()).toBe(true);
    expect(tracker.isApplicationCursorKeysEnabled()).toBe(true);
    expect(tracker.isKittyKeyboardEnabled()).toBe(true);

    tracker.feed(`${E}[?2004l${E}[?1l${E}[<u`);
    expect(tracker.isBracketedPasteEnabled()).toBe(false);
    expect(tracker.isApplicationCursorKeysEnabled()).toBe(false);
    expect(tracker.isKittyKeyboardEnabled()).toBe(false);
  });

  it("L0.5b: registers all 8 mouse modes (9/1000/1002/1003/1005/1006/1015/1016) with subscription, encoding and focus accessors", () => {
    const tracker = new TerminalModeTracker();
    expect(tracker.isMouseTrackingEnabled()).toBe(false);
    expect(tracker.mouseTrackingMode()).toBeNull();
    expect(tracker.mouseEncoding()).toBe("x10");
    expect(tracker.isFocusReportingEnabled()).toBe(false);

    // X10 mode 9 + UTF-8 encoding 1005
    tracker.feed(`${E}[?9;1005h`);
    expect(tracker.isMouseTrackingEnabled()).toBe(true);
    expect(tracker.mouseTrackingMode()).toBe(9);
    expect(tracker.mouseEncoding()).toBe("utf8");

    // Upgrade to button-event 1002 + urxvt 1015 + focus 1004
    tracker.feed(`${E}[?1002;1015;1004h`);
    expect(tracker.mouseTrackingMode()).toBe(1002);
    expect(tracker.mouseEncoding()).toBe("urxvt");
    expect(tracker.isFocusReportingEnabled()).toBe(true);

    // SGR-pixel 1016 and any-event 1003
    tracker.feed(`${E}[?1003;1016h`);
    expect(tracker.mouseTrackingMode()).toBe(1003);
    expect(tracker.mouseEncoding()).toBe("sgr-pixel");

    // SGR 1006 after disabling 1016
    tracker.feed(`${E}[?1016l${E}[?1006h`);
    expect(tracker.mouseEncoding()).toBe("sgr");

    // All remaining mouse modes reset cleanly
    const reset = tracker.resetSequence();
    for (const mode of [9, 1002, 1003, 1004, 1005, 1006, 1015]) {
      expect(reset).toContain(`${E}[?${mode}l`);
    }
    expect(reset).not.toContain(`${E}[?1016l`);
    tracker.feed(reset);
    expect(tracker.resetSequence()).toBe("");
    expect(tracker.isMouseTrackingEnabled()).toBe(false);
    expect(tracker.mouseTrackingMode()).toBeNull();
    expect(tracker.mouseEncoding()).toBe("x10");
    expect(tracker.isFocusReportingEnabled()).toBe(false);
  });

  it("L0.5b: consumes child mouse DECSET/DECRST from relayed output while preserving non-mouse modes and syncing motion 1002/1003", () => {
    const stream =
      `pre${E}[?1004;1000;1006;2004hmid${E}[?1002hdrag${E}[?1002l${E}[?1000l${E}[?1006lpost`;
    for (let split = 0; split <= stream.length; split += 1) {
      const tracker = new TerminalModeTracker();
      const part1 = tracker.feedAndFilterOuterMouse(stream.slice(0, split));
      const part2 = tracker.feedAndFilterOuterMouse(stream.slice(split));
      const tail = tracker.flushMouseFilterPending();
      const relayed = part1 + part2 + tail;

      // Non-mouse modes 1004 and 2004 survive; child 1000/1006 toggles never cut h2a mouse.
      expect(relayed, `split ${split}`).toContain(`${E}[?1004;2004h`);
      expect(relayed, `split ${split}`).not.toContain(`${E}[?1000l`);
      expect(relayed, `split ${split}`).not.toContain(`${E}[?1006l`);
      // Motion 1002 is forwarded only while child asks for it, then disabled with ?1000h?1006h re-asserted.
      expect(relayed, `split ${split}`).toContain(`${E}[?1002h`);
      expect(relayed, `split ${split}`).toContain(`${E}[?1002l${E}[?1000h${E}[?1006h`);
      // Tracker itself accurately reflects the child's final mouse state (all disabled).
      expect(tracker.isMouseTrackingEnabled(), `split ${split}`).toBe(false);
      expect(tracker.isFocusReportingEnabled(), `split ${split}`).toBe(true);
    }
  });
});
