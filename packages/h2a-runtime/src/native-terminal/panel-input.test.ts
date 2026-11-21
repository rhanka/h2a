import { describe, expect, it } from "vitest";

import {
  DETACH_BYTE,
  PanelInputParser,
  type PanelInputContext,
  type PanelInputEvent,
} from "./panel-input.js";

function feedByteByByte(
  parser: PanelInputParser,
  bytes: Uint8Array,
  ctx: PanelInputContext | (() => PanelInputContext),
): PanelInputEvent[] {
  const events: PanelInputEvent[] = [];
  for (let i = 0; i < bytes.length; i += 1) {
    const resolved = typeof ctx === "function" ? ctx() : ctx;
    events.push(...parser.feed(bytes.subarray(i, i + 1), resolved));
  }
  return events;
}

describe("PanelInputParser — Étape 2 byte-stream proofs (PANEL:442, 02-L0.5a)", () => {
  it("parses /s, /d, /t, arrows (CSI + SS3), Enter, Tab, Shift+Tab, F12 fragmented 1 byte per chunk", () => {
    const parser = new PanelInputParser();
    const panelCtx: PanelInputContext = {
      panelFocus: true,
      bracketedPasteEnabled: false,
      kittyKeyboardEnabled: false,
    };

    const slashS = feedByteByByte(parser, Buffer.from("/s"), panelCtx);
    expect(slashS).toEqual([
      { type: "char", char: "/" },
      { type: "char", char: "s" },
    ]);

    const slashD = feedByteByByte(parser, Buffer.from("/d"), panelCtx);
    expect(slashD).toEqual([
      { type: "char", char: "/" },
      { type: "char", char: "d" },
    ]);

    const slashT = feedByteByByte(parser, Buffer.from("/t"), panelCtx);
    expect(slashT).toEqual([
      { type: "char", char: "/" },
      { type: "char", char: "t" },
    ]);

    // CSI arrows + SS3 arrows (DECCKM)
    expect(feedByteByByte(parser, Buffer.from("\x1b[A"), panelCtx)).toEqual([
      { type: "nav", direction: "up" },
    ]);
    expect(feedByteByByte(parser, Buffer.from("\x1b[B"), panelCtx)).toEqual([
      { type: "nav", direction: "down" },
    ]);
    expect(feedByteByByte(parser, Buffer.from("\x1bOA"), panelCtx)).toEqual([
      { type: "nav", direction: "up" },
    ]);
    expect(feedByteByByte(parser, Buffer.from("\x1bOB"), panelCtx)).toEqual([
      { type: "nav", direction: "down" },
    ]);

    // Enter, Tab, Shift+Tab
    expect(feedByteByByte(parser, Buffer.from("\r"), panelCtx)).toEqual([
      { type: "enter" },
    ]);
    expect(feedByteByByte(parser, Buffer.from("\t"), panelCtx)).toEqual([
      { type: "tab", shift: false },
    ]);
    expect(feedByteByByte(parser, Buffer.from("\x1b[Z"), panelCtx)).toEqual([
      { type: "tab", shift: true },
    ]);

    // F12 split 1 byte per chunk in CLI focus AND panel focus — never leaks a byte
    const cliCtx: PanelInputContext = {
      panelFocus: false,
      bracketedPasteEnabled: false,
    };
    const f12Cli = feedByteByByte(parser, Buffer.from("\x1b[24~"), cliCtx);
    expect(f12Cli).toEqual([{ type: "toggle" }]);
    const f12Panel = feedByteByByte(parser, Buffer.from("\x1b[24~"), panelCtx);
    expect(f12Panel).toEqual([{ type: "toggle" }]);
  });

  it("accepts kitty-encoded Esc, Tab, Shift+Tab, arrows, Enter, and F12 fragmented 1 byte per chunk", () => {
    const parser = new PanelInputParser();
    const panelKitty: PanelInputContext = {
      panelFocus: true,
      bracketedPasteEnabled: false,
      kittyKeyboardEnabled: true,
    };
    const cliKitty: PanelInputContext = {
      panelFocus: false,
      bracketedPasteEnabled: false,
      kittyKeyboardEnabled: true,
    };

    expect(feedByteByByte(parser, Buffer.from("\x1b[27u"), panelKitty)).toEqual([
      { type: "escape" },
    ]);
    expect(feedByteByByte(parser, Buffer.from("\x1b[9u"), panelKitty)).toEqual([
      { type: "tab", shift: false },
    ]);
    expect(feedByteByByte(parser, Buffer.from("\x1b[9;2u"), panelKitty)).toEqual([
      { type: "tab", shift: true },
    ]);
    expect(feedByteByByte(parser, Buffer.from("\x1b[1;1A"), panelKitty)).toEqual([
      { type: "nav", direction: "up" },
    ]);
    expect(feedByteByByte(parser, Buffer.from("\x1b[1;1B"), panelKitty)).toEqual([
      { type: "nav", direction: "down" },
    ]);
    expect(feedByteByByte(parser, Buffer.from("\x1b[13u"), panelKitty)).toEqual([
      { type: "enter" },
    ]);
    // Kitty F12 (functional form with modifier/event-type, and PUA form)
    expect(feedByteByByte(parser, Buffer.from("\x1b[24;1~"), cliKitty)).toEqual([
      { type: "toggle" },
    ]);
    expect(feedByteByByte(parser, Buffer.from("\x1b[24;1:1~"), cliKitty)).toEqual([
      { type: "toggle" },
    ]);
    // Key release (:3) must not double-toggle
    expect(feedByteByByte(parser, Buffer.from("\x1b[24;1:3~"), cliKitty)).toEqual([]);
    expect(feedByteByByte(parser, Buffer.from("\x1b[57375u"), cliKitty)).toEqual([
      { type: "toggle" },
    ]);
  });

  it("forwards fragmented 3-byte and 4-byte UTF-8 bytes unmodified in CLI focus (zero U+FFFD)", () => {
    const parser = new PanelInputParser();
    const cliCtx: PanelInputContext = {
      panelFocus: false,
      bracketedPasteEnabled: false,
    };
    // "€" (e2 82 ac) + "🚀" (f0 9f 9a 80) + "é" (c3 a9), split 1 byte per chunk
    const original = Buffer.from("€🚀é", "utf8");
    const events = feedByteByByte(parser, original, cliCtx);
    const forwarded = Buffer.concat(
      events
        .filter((e): e is Extract<PanelInputEvent, { type: "forward" }> => e.type === "forward")
        .map((e) => e.bytes),
    );
    expect(Buffer.compare(forwarded, original)).toBe(0);
    expect(forwarded.toString("utf8")).toBe("€🚀é");
    expect(forwarded.toString("utf8")).not.toContain("\uFFFD");
  });

  it("suspends F12 and SGR mouse detection inside bracketed paste when mode 2004 is enabled", () => {
    const parser = new PanelInputParser();
    const cliPasteOn: PanelInputContext = {
      panelFocus: false,
      bracketedPasteEnabled: true,
    };
    const payload = Buffer.from(
      "\x1b[200~hello \x1b[24~ and \x1b[<0;99;30M world\x1b[201~",
      "utf8",
    );
    const events = feedByteByByte(parser, payload, cliPasteOn);
    expect(events.some((e) => e.type === "toggle")).toBe(false);
    expect(events.some((e) => e.type === "sgr-mouse")).toBe(false);
    const forwarded = Buffer.concat(
      events
        .filter((e): e is Extract<PanelInputEvent, { type: "forward" }> => e.type === "forward")
        .map((e) => e.bytes),
    );
    expect(Buffer.compare(forwarded, payload)).toBe(0);
    expect(parser.isInBracketedPaste()).toBe(false);

    // After ESC[201~, F12 works normally again
    expect(feedByteByByte(parser, Buffer.from("\x1b[24~"), cliPasteOn)).toEqual([
      { type: "toggle" },
    ]);
  });

  it("prioritizes DETACH_BYTE (Ctrl-\\) over panel focus and bracketed paste", () => {
    const parser = new PanelInputParser();
    const panelCtx: PanelInputContext = {
      panelFocus: true,
      bracketedPasteEnabled: false,
    };
    const ev1 = parser.feed(Buffer.from([0x2f, DETACH_BYTE]), panelCtx);
    expect(ev1.some((e) => e.type === "detach")).toBe(true);

    const cliPasteOn: PanelInputContext = {
      panelFocus: false,
      bracketedPasteEnabled: true,
    };
    parser.feed(Buffer.from("\x1b[200~abc"), cliPasteOn);
    expect(parser.isInBracketedPaste()).toBe(true);
    const ev2 = parser.feed(Buffer.from([DETACH_BYTE]), cliPasteOn);
    expect(ev2.some((e) => e.type === "detach")).toBe(true);
  });

  it("flushes non-opener escape sequences whole to the CLI and supports bare Esc flush", () => {
    const parser = new PanelInputParser();
    const cliCtx: PanelInputContext = {
      panelFocus: false,
      bracketedPasteEnabled: false,
    };
    // Up arrow in CLI focus is NOT intercepted and arrives whole
    const cliUp = feedByteByByte(parser, Buffer.from("\x1b[A"), cliCtx);
    const forwarded = Buffer.concat(
      cliUp
        .filter((e): e is Extract<PanelInputEvent, { type: "forward" }> => e.type === "forward")
        .map((e) => e.bytes),
    );
    expect(forwarded.toString("utf8")).toBe("\x1b[A");

    // Bare Esc in panel focus resolves via flushPending
    const panelCtx: PanelInputContext = {
      panelFocus: true,
      bracketedPasteEnabled: false,
    };
    expect(parser.feed(Buffer.from([0x1b]), panelCtx)).toEqual([]);
    expect(parser.hasPendingEscape()).toBe(true);
    expect(parser.flushPending(panelCtx)).toEqual([{ type: "escape" }]);
    expect(parser.hasPendingEscape()).toBe(false);
  });

  it("adds <= 5 ms key-echo latency across 1,000 forwarded keystrokes", () => {
    const parser = new PanelInputParser();
    const cliCtx: PanelInputContext = {
      panelFocus: false,
      bracketedPasteEnabled: true,
    };
    const samples: number[] = [];
    for (let i = 0; i < 1_000; i += 1) {
      const t0 = performance.now();
      parser.feed(Buffer.from("a"), cliCtx);
      samples.push(performance.now() - t0);
    }
    samples.sort((a, b) => a - b);
    const p95 = samples[Math.floor(samples.length * 0.95)]!;
    expect(p95).toBeLessThanOrEqual(5);
  });
});
