import { describe, expect, it } from "vitest";
import xtermMod from "@xterm/headless";

import {
  REPLAY_FILTER_FAMILIES,
  ReplayFilter,
  filterReplay,
} from "./replay-filter.js";
import { NATIVE_TERMINAL_RESET_MARKER } from "./reset-relay.js";

const XtermTerminal = (
  (xtermMod as unknown as { default?: typeof xtermMod }).default ?? xtermMod
).Terminal;

const ESC = "\x1b";
const ST = `${ESC}\\`;
const BEL = "\x07";

/** Representative byte forms per family of the r2 annex D minimum table. */
const QUERY_FORMS: ReadonlyArray<readonly [string, string, string]> = [
  ["dsr-cpr", "CSI 6 n", `${ESC}[6n`],
  ["dsr-decxcpr", "CSI ? 6 n", `${ESC}[?6n`],
  ["dsr-status", "CSI 5 n", `${ESC}[5n`],
  ["da1", "CSI c", `${ESC}[c`],
  ["da1", "CSI 0 c", `${ESC}[0c`],
  ["da2", "CSI > c", `${ESC}[>c`],
  ["da2", "CSI > 0 c", `${ESC}[>0c`],
  ["da3", "CSI = c", `${ESC}[=c`],
  ["xtversion", "CSI > q", `${ESC}[>q`],
  ["xtversion", "CSI > 0 q", `${ESC}[>0q`],
  ["kitty-keyboard-query", "CSI ? u", `${ESC}[?u`],
  ["xtwinops-14", "CSI 14 t", `${ESC}[14t`],
  ["xtwinops-16", "CSI 16 t", `${ESC}[16t`],
  ["xtwinops-18", "CSI 18 t", `${ESC}[18t`],
  ["xtwinops-21", "CSI 21 t", `${ESC}[21t`],
  ["decrqm", "CSI ? 2026 $ p", `${ESC}[?2026$p`],
  ["decrqm", "CSI 4 $ p", `${ESC}[4$p`],
  ["decrqss", "DCS $ q m ST", `${ESC}P$qm${ST}`],
  ["xtgettcap", "DCS + q 544e ST", `${ESC}P+q544e${ST}`],
  ["osc-4-query", "OSC 4 ; 1 ; ? ST", `${ESC}]4;1;?${ST}`],
  ["osc-10-query", "OSC 10 ; ? BEL", `${ESC}]10;?${BEL}`],
  ["osc-11-query", "OSC 11 ; ? ST", `${ESC}]11;?${ST}`],
  ["osc-12-query", "OSC 12 ; ? BEL", `${ESC}]12;?${BEL}`],
  ["osc-52", "OSC 52 ; c ; ? BEL", `${ESC}]52;c;?${BEL}`],
  ["enq", "ENQ", "\x05"],
];

const SIDE_EFFECT_FORMS: ReadonlyArray<readonly [string, string]> = [
  ["bel", BEL],
  ["osc-52", `${ESC}]52;c;aGVsbG8=${BEL}`],
  ["osc-9", `${ESC}]9;build done${BEL}`],
  ["osc-99", `${ESC}]99;i=1:d=0;hello${ST}`],
  ["osc-777", `${ESC}]777;notify;title;body${BEL}`],
];

describe("S1 replay filter (r2 annex D, shared INJ D10 (b) table)", () => {
  it("should pin the family table: every annex D minimum family is declared once", () => {
    const ids = REPLAY_FILTER_FAMILIES.map((family) => family.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const [id] of [...QUERY_FORMS, ...SIDE_EFFECT_FORMS]) {
      expect(ids, `family ${id} must be declared`).toContain(id);
    }
    expect(REPLAY_FILTER_FAMILIES.filter((f) => f.kind === "query").map((f) => f.id)).toEqual([
      "dsr-cpr",
      "dsr-decxcpr",
      "dsr-status",
      "da1",
      "da2",
      "da3",
      "xtversion",
      "kitty-keyboard-query",
      "xtwinops-14",
      "xtwinops-16",
      "xtwinops-18",
      "xtwinops-21",
      "decrqm",
      "decrqss",
      "xtgettcap",
      "osc-4-query",
      "osc-10-query",
      "osc-11-query",
      "osc-12-query",
      "enq",
    ]);
    expect(REPLAY_FILTER_FAMILIES.filter((f) => f.kind === "side-effect").map((f) => f.id)).toEqual([
      "bel",
      "osc-52",
      "osc-9",
      "osc-99",
      "osc-777",
    ]);
  });

  it.each(QUERY_FORMS)(
    "should remove the terminal query %s (%s) from replayed bytes",
    (_id, _label, form) => {
      const result = filterReplay(`before${form}after`);
      expect(result.output).toBe("beforeafter");
      expect(result.stats.queries + result.stats.sideEffects).toBe(1);
    },
  );

  it.each(SIDE_EFFECT_FORMS)("should neutralise the side effect %s in replayed bytes", (_id, form) => {
    const result = filterReplay(`before${form}after`);
    expect(result.output).toBe("beforeafter");
    expect(result.stats.sideEffects).toBe(1);
  });

  it("should keep every non-query sequence byte for byte", () => {
    const kept = [
      `${ESC}[?1049h`,
      `${ESC}[?2004h`,
      `${ESC}[?1004h`,
      `${ESC}[>1u`,
      `${ESC}[<1u`,
      `${ESC}[=5u`,
      `${ESC}[!p`,
      `${ESC}[2 q`,
      `${ESC}[1;31m`,
      `${ESC}[10;20H`,
      `${ESC}[2J`,
      `${ESC}[3J`,
      `${ESC}[8;24;80t`,
      `${ESC}[22;0t`,
      `${ESC}[?25l`,
      `${ESC}[62;1"p`,
      `${ESC}(B`,
      `${ESC}7`,
      `${ESC}8`,
      `${ESC}]0;window title${BEL}`,
      `${ESC}]2;window title${ST}`,
      `${ESC}]4;1;rgb:ff/00/00${BEL}`,
      `${ESC}]10;#ffffff${BEL}`,
      `${ESC}]11;rgb:00/00/00${ST}`,
      `${ESC}]8;;https://example.invalid${ST}link${ESC}]8;;${ST}`,
      `${ESC}Pq#0;2;0;0;0#0~~${ST}`,
      `${ESC}_Gf=24;AAAA${ST}`,
      "plain text é 😀\r\n",
    ].join("");
    const result = filterReplay(kept);
    expect(result.output).toBe(kept);
    expect(result.stats).toEqual({ queries: 0, sideEffects: 0 });
  });

  it("should keep the h2a wrapper reset marker although it is an OSC 777 string", () => {
    const data = `a${NATIVE_TERMINAL_RESET_MARKER}b${ESC}]777;notify;x;y${BEL}c`;
    const result = filterReplay(data);
    expect(result.output).toBe(`a${NATIVE_TERMINAL_RESET_MARKER}bc`);
    expect(result.stats.sideEffects).toBe(1);
  });

  it("should treat BEL as an OSC terminator, never as a bell, inside a kept string", () => {
    const title = `${ESC}]0;title${BEL}`;
    expect(filterReplay(`${title}${BEL}x`).output).toBe(`${title}x`);
  });

  it("should accept C1 introducers and terminators", () => {
    expect(filterReplay("a\x9b6nb").output).toBe("ab");
    expect(filterReplay("a\x9d52;c;?\x9cb").output).toBe("ab");
    expect(filterReplay("a\x90$qm\x9cb").output).toBe("ab");
    expect(filterReplay("a\x9d0;t\x9cb").output).toBe("a\x9d0;t\x9cb");
  });

  it("should filter identically under every chunk split (streaming, 1 byte per chunk included)", () => {
    const corpus =
      `one${ESC}[6ntwo${ESC}]52;c;aGVsbG8=${BEL}three${ESC}P$qm${ST}four${BEL}` +
      `${ESC}[?1049h${ESC}]0;t${BEL}five${ESC}[>0qsix${ESC}]11;?${ST}seven\x05eight` +
      `${ESC}]4;1;rgb:ff/00/00${BEL}nine${ESC}[18tten${NATIVE_TERMINAL_RESET_MARKER}end`;
    const expected = filterReplay(corpus).output;
    expect(expected).toBe(
      `onetwothreefour${ESC}[?1049h${ESC}]0;t${BEL}fivesixseveneight` +
        `${ESC}]4;1;rgb:ff/00/00${BEL}nineten${NATIVE_TERMINAL_RESET_MARKER}end`,
    );
    for (let size = 1; size <= 7; size += 1) {
      const filter = new ReplayFilter();
      let out = "";
      for (let index = 0; index < corpus.length; index += size) {
        out += filter.filter(corpus.slice(index, index + size));
      }
      out += filter.flush();
      expect(out, `chunk size ${size}`).toBe(expected);
    }
  });

  it("should hand an unfinished sequence back at flush so the live stream can complete it", () => {
    const filter = new ReplayFilter();
    expect(filter.filter(`text${ESC}[`)).toBe("text");
    expect(filter.flush()).toBe(`${ESC}[`);
    // A fresh catch-up after flush starts from the ground state.
    expect(filter.filter("ok")).toBe("ok");
  });

  it("should emit zero queries to a terminal that answers everything (S1.5 oracle)", async () => {
    const k = 12;
    const history =
      `${ESC}[?1049h${ESC}[2J` +
      Array.from({ length: k }, (_, i) => `line ${i}${ESC}[6n\r\n`).join("") +
      QUERY_FORMS.map(([, , form]) => form).join("x") +
      SIDE_EFFECT_FORMS.map(([, form]) => form).join("y") +
      "tail";
    const responses: string[] = [];
    const bells: number[] = [];
    const oscWrites: string[] = [];
    const term = new XtermTerminal({ cols: 80, rows: 24, allowProposedApi: true });
    term.onData((data) => responses.push(data));
    term.onBell(() => bells.push(1));
    for (const code of [52, 9, 99, 777]) {
      term.parser.registerOscHandler(code, (payload) => {
        oscWrites.push(`${code};${payload}`);
        return true;
      });
    }
    // Control: the unfiltered history does make the answering terminal respond.
    const control = new XtermTerminal({ cols: 80, rows: 24, allowProposedApi: true });
    const controlResponses: string[] = [];
    control.onData((data) => controlResponses.push(data));
    await new Promise<void>((resolve) => control.write(history, resolve));
    expect(controlResponses.length).toBeGreaterThanOrEqual(k);

    const filtered = filterReplay(history);
    await new Promise<void>((resolve) => term.write(filtered.output, resolve));
    expect(responses).toEqual([]);
    expect(bells).toEqual([]);
    expect(oscWrites).toEqual([]);
    expect(filtered.stats.queries).toBe(k + QUERY_FORMS.length - 1);
    expect(filtered.stats.sideEffects).toBe(SIDE_EFFECT_FORMS.length + 1);
    term.dispose();
    control.dispose();
  });
});
