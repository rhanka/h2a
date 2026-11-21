import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import xtermMod from "@xterm/headless";

import type { NativeTerminalClient } from "./client.js";
import type {
  NativeTerminalControllerLease,
  NativeTerminalReplay,
  NativeTerminalSessionState,
} from "./host.js";
import { runAttach } from "./op.js";
import {
  RIGHT_PANEL_TOGGLE_SEQUENCE,
  buildRightPanelSnapshot,
  type RightPanelSnapshot,
} from "./right-panel.js";

const XtermTerminal = (
  (xtermMod as unknown as { default?: typeof xtermMod }).default ?? xtermMod
).Terminal;

type HeadlessTerm = InstanceType<typeof XtermTerminal>;

class FakeInput extends EventEmitter {
  readonly isTTY = false;
  readonly resume = vi.fn();
  readonly pause = vi.fn();
  readonly setRawMode = vi.fn();
}

class FakeTtyOutput {
  readonly isTTY = true;
  columns: number;
  rows: number;
  readonly chunks: string[] = [];

  constructor(cols: number, rows: number) {
    this.columns = cols;
    this.rows = rows;
  }

  write(chunk: string): boolean {
    this.chunks.push(String(chunk));
    return true;
  }
}

type AttachClient = Pick<
  NativeTerminalClient,
  | "readOutput"
  | "state"
  | "acquireController"
  | "releaseController"
  | "write"
  | "resize"
  | "close"
>;

function runningState(): NativeTerminalSessionState {
  return {
    id: "h2a-alpha",
    pid: 4242,
    status: "running",
    exit: null,
    generation: "gen-l05b",
    incarnation: 1,
    controllerEpoch: 1,
    controlled: true,
  };
}

function makeReplay(seq: number, data: string): NativeTerminalReplay {
  return {
    id: "h2a-alpha",
    earliestSeq: seq,
    latestSeq: seq,
    truncated: false,
    chunks: data.length > 0 ? [{ seq, data }] : [],
  };
}

function fixtureSnapshot(): RightPanelSnapshot {
  return buildRightPanelSnapshot({
    currentSessionId: "h2a-alpha",
    groups: [
      {
        title: "core",
        sessions: [
          { id: "h2a-alpha", label: "alpha", status: "running" },
          { id: "h2a-beta", label: "beta", status: "blocked" },
        ],
      },
      {
        title: "docs",
        sessions: [{ id: "h2a-gamma", label: "gamma", status: "idle" }],
      },
    ],
    decisions: [
      {
        id: "D1",
        title: "gateway posture",
        kind: "decision",
        sessionId: "h2a-beta",
      },
    ],
  });
}

async function writeTerm(term: HeadlessTerm, data: string): Promise<void> {
  if (data.length === 0) return;
  await new Promise<void>((resolve) => term.write(data, resolve));
}

function cellSignature(
  line: ReturnType<HeadlessTerm["buffer"]["active"]["getLine"]>,
  x: number,
): string {
  const cell = line?.getCell(x);
  if (!cell) return "<missing>";
  const ch = cell.getChars() || " ";
  const w = cell.getWidth();
  const fg = cell.isFgRGB()
    ? `rgb:${cell.getFgColor()}`
    : cell.isFgPalette()
      ? `pal:${cell.getFgColor()}`
      : "def";
  const bg = cell.isBgRGB()
    ? `rgb:${cell.getBgColor()}`
    : cell.isBgPalette()
      ? `pal:${cell.getBgColor()}`
      : "def";
  return `${JSON.stringify(ch)}/w${w}/fg:${fg}/bg:${bg}/b${cell.isBold()}/i${cell.isInverse()}`;
}

function rowText(term: HeadlessTerm, y: number, startX: number, endX: number): string {
  const line = term.buffer.active.getLine(y);
  let out = "";
  for (let x = startX; x < endX; x += 1) {
    const cell = line?.getCell(x);
    if (!cell || cell.getWidth() === 0) continue;
    out += cell.getChars() || " ";
  }
  return out;
}

function assertChildAreaMatches(
  outer: HeadlessTerm,
  ref: HeadlessTerm,
  childCols: number,
  childRows: number,
  totalCols: number,
  batchLabel: string,
): void {
  expect(outer.buffer.active.type, `${batchLabel}: buffer type`).toBe(
    ref.buffer.active.type,
  );
  for (let y = 0; y < childRows; y += 1) {
    const outerLine = outer.buffer.active.getLine(y);
    const refLine = ref.buffer.active.getLine(y);
    for (let x = 0; x < childCols; x += 1) {
      const actual = cellSignature(outerLine, x);
      const expected = cellSignature(refLine, x);
      if (actual !== expected) {
        expect(
          actual,
          `${batchLabel}: child cell mismatch at row=${y + 1}, col=${x + 1}\n` +
            `  outer row: ${JSON.stringify(rowText(outer, y, 0, childCols))}\n` +
            `  ref   row: ${JSON.stringify(rowText(ref, y, 0, childCols))}`,
        ).toBe(expected);
      }
    }
  }
  expect(outer.buffer.active.cursorY, `${batchLabel}: cursorY`).toBe(
    ref.buffer.active.cursorY,
  );
  if (childCols < totalCols) {
    expect(outer.buffer.active.cursorX, `${batchLabel}: cursorX in child area`).toBeLessThan(
      childCols,
    );
    expect(outer.buffer.active.cursorX, `${batchLabel}: cursorX`).toBe(
      Math.min(ref.buffer.active.cursorX, childCols - 1),
    );
  } else {
    expect(outer.buffer.active.cursorX, `${batchLabel}: cursorX`).toBe(
      ref.buffer.active.cursorX,
    );
  }
}

function assertReservedAreaMatches(
  outer: HeadlessTerm,
  baselinePanel: HeadlessTerm,
  childCols: number,
  totalCols: number,
  panelRows: number,
  batchLabel: string,
): void {
  for (let y = 0; y < panelRows; y += 1) {
    const outerLine = outer.buffer.active.getLine(y);
    const baseLine = baselinePanel.buffer.active.getLine(y);
    for (let x = childCols; x < totalCols; x += 1) {
      const actual = cellSignature(outerLine, x);
      const expected = cellSignature(baseLine, x);
      if (actual !== expected) {
        expect(
          actual,
          `${batchLabel}: reserved panel cell mismatch at row=${y + 1}, col=${x + 1}\n` +
            `  outer panel: ${JSON.stringify(rowText(outer, y, childCols, totalCols))}\n` +
            `  base  panel: ${JSON.stringify(rowText(baselinePanel, y, childCols, totalCols))}`,
        ).toBe(expected);
      }
    }
  }
}

/**
 * Full L0.5b containment corpus (PANEL:182, :444; 03-L0.5b Step 1):
 * overlong lines, wide glyphs straddling boundary, HT/CUP/CHA/HPA/CUF out of range,
 * EL 0/1/2, ECH, ICH, DCH, REP, IL, DL, SU, SD, ED 0/1/2, DECSTR, alternate screen,
 * and DECSC/DECRC across panel repaint.
 */
function buildContainmentCorpus(childCols: number, childRows: number): Array<{ label: string; data: string }> {
  const fullLine = "A".repeat(childCols) + "OVERFLOW_WRAP_LINE";
  const nearRight = childCols - 2;
  return [
    {
      label: "01-overlong-autowrap-and-bs",
      data: `\x1b[1;1H${fullLine}\r\n${"B".repeat(childCols)}\bZ`,
    },
    {
      label: "02-wide-glyph-straddling-boundary",
      data: `\x1b[4;1H${"X".repeat(childCols - 1)}中AFTER\x1b[?7l\x1b[6;1H${"Y".repeat(childCols + 5)}\x1b[?7h`,
    },
    {
      label: "03-ht-cup-cha-hpa-cuf-out-of-range",
      data: `\x1b[7;${nearRight}H\tT\x1b[8;${childCols + 20}HCUP\x1b[${childRows + 10};${childCols + 15}HCLAMP\x1b[9;1H\x1b[${childCols + 25}GCHA\x1b[10;1H\x1b[${childCols + 10}\`HPA\x1b[11;1H\x1b[${childCols + 30}CCUF`,
    },
    {
      label: "04-el-and-ech-with-sgr-bg",
      data: `\x1b[1;1H\x1b[44m\x1b[1;10H\x1b[K\x1b[2;15H\x1b[1K\x1b[3;5H\x1b[2K\x1b[4;${childCols - 4}H\x1b[30X\x1b[0m`,
    },
    {
      label: "05-ich-then-dch-no-panel-pull",
      data: `\x1b[5;1H${"0123456789".repeat(Math.ceil(childCols / 10)).slice(0, childCols)}\x1b[5;3H\x1b[5@\x1b[5;3H\x1b[5P`,
    },
    {
      label: "06-rep-crossing-boundary",
      data: `\x1b[6;${childCols - 3}HR\x1b[15b`,
    },
    {
      label: "07-il-dl-su-sd-scrolls",
      data: `\x1b[2;${Math.min(childRows, 12)}r\x1b[3;1HLINE_A\x1b[2L\x1b[1M\x1b[2S\x1b[1T\x1b[r`,
    },
    {
      label: "08-ed-0-1-2-and-decstr",
      data: `\x1b[4;10H\x1b[J\x1b[2;5H\x1b[1J\x1b[2J\x1b[!p\x1b[1;1HAFTER_DECSTR`,
    },
    {
      label: "09-alternate-screen-enter-and-exit",
      data: `\x1b[?1049h\x1b[1;1H${"M".repeat(childCols + 12)}\x1b[3;1H\x1b[2KALT_OK\x1b[?1049l\x1b[2;1HBACK_NORMAL`,
    },
    {
      label: "10-decsc-decrc-cursor-hygiene",
      data: `\x1b[3;7H\x1b7\x1b[1;1HMOVED`,
    },
    {
      label: "11-decrc-after-repaint",
      data: `\x1b8RESTORED`,
    },
  ];
}

async function runCorpusScenario(opts: {
  totalCols: number;
  totalRows: number;
  panelWidth: number;
  open: boolean;
  statusBar: boolean;
}): Promise<{
  rawBeforeDetach: string;
  resizes: Array<{ cols: number; rows: number }>;
}> {
  const stdin = new FakeInput();
  const stdout = new FakeTtyOutput(opts.totalCols, opts.totalRows);
  const effectivePanelCols =
    opts.totalRows < 10
      ? 0
      : opts.open && opts.totalCols - opts.panelWidth >= 40
        ? opts.panelWidth
        : 1;
  const childCols = opts.totalCols - effectivePanelCols;
  const statusBarActive = opts.statusBar && opts.totalRows >= 10;
  const childRows = statusBarActive ? opts.totalRows - 1 : opts.totalRows;
  const panelRows = opts.totalRows < 10 ? 0 : childRows;

  const corpus = buildContainmentCorpus(childCols, childRows);
  const outerTerm = new XtermTerminal({
    cols: opts.totalCols,
    rows: opts.totalRows,
    scrollback: 0,
    allowProposedApi: true,
  });
  const baselinePanelTerm = new XtermTerminal({
    cols: opts.totalCols,
    rows: opts.totalRows,
    scrollback: 0,
    allowProposedApi: true,
  });
  const refTerm = new XtermTerminal({
    cols: childCols,
    rows: childRows,
    scrollback: 0,
    allowProposedApi: true,
  });

  let now = 1_760_000_000_000;
  let readIndex = 0;
  let syncedStdoutLen = 0;
  let baselineCaptured = false;
  let rawBeforeDetach = "";
  let assertionError: unknown;
  const resizes: Array<{ cols: number; rows: number }> = [];

  const lease: NativeTerminalControllerLease = {
    role: "controller",
    id: "h2a-alpha",
    generation: "gen-l05b",
    incarnation: 1,
    controllerId: "ctrl-l05b",
    epoch: 1,
  };

  const syncOuterAndVerify = async (batchLabel: string, childData: string) => {
    const newOut = stdout.chunks.slice(syncedStdoutLen).join("");
    syncedStdoutLen = stdout.chunks.length;
    await writeTerm(outerTerm, newOut);
    await writeTerm(refTerm, childData);
    assertChildAreaMatches(
      outerTerm,
      refTerm,
      childCols,
      childRows,
      opts.totalCols,
      batchLabel,
    );
    if (panelRows > 0 && effectivePanelCols > 0) {
      assertReservedAreaMatches(
        outerTerm,
        baselinePanelTerm,
        childCols,
        opts.totalCols,
        panelRows,
        batchLabel,
      );
    }
  };

  const client: AttachClient = {
    async acquireController() {
      return lease;
    },
    async releaseController() {
      return { controlled: false, controllerEpoch: 1 };
    },
    async readOutput() {
      if (readIndex === 0) {
        readIndex += 1;
        if (opts.open) {
          stdin.emit("data", Buffer.from(RIGHT_PANEL_TOGGLE_SEQUENCE));
        }
        return makeReplay(1, "");
      }
      if (!baselineCaptured) {
        baselineCaptured = true;
        const initOut = stdout.chunks.slice(syncedStdoutLen).join("");
        syncedStdoutLen = stdout.chunks.length;
        await writeTerm(outerTerm, initOut);
        await writeTerm(baselinePanelTerm, initOut);
      } else {
        const prev = corpus[readIndex - 2]!;
        try {
          await syncOuterAndVerify(prev.label, prev.data);
        } catch (err) {
          assertionError = err;
          stdin.emit("data", Buffer.from([0x1c]));
          return makeReplay(readIndex, "");
        }
      }
      const nextBatch = corpus[readIndex - 1];
      if (nextBatch) {
        readIndex += 1;
        now += 1_000;
        return makeReplay(readIndex, nextBatch.data);
      }
      rawBeforeDetach = stdout.chunks.join("");
      stdin.emit("data", Buffer.from([0x1c]));
      return makeReplay(readIndex, "");
    },
    async state() {
      return runningState();
    },
    async write() {},
    async resize(_lease, cols, rows) {
      resizes.push({ cols, rows });
    },
    close() {},
  };

  try {
    await runAttach(
      "h2a-alpha",
      {
        connect: async () => client,
        stdin: stdin as unknown as NodeJS.ReadStream,
        stdout: stdout as unknown as NodeJS.WriteStream,
        now: () => now,
        delay: async (ms) => {
          now += ms;
        },
        onResize: () => {},
        offResize: () => {},
      },
      {
        statusBar: opts.statusBar
          ? {
              enabled: true,
              env: {},
            }
          : false,
        rightPanel: {
          enabled: true,
          width: opts.panelWidth,
          snapshot: fixtureSnapshot(),
        },
      },
    );
  } finally {
    outerTerm.dispose();
    baselinePanelTerm.dispose();
    refTerm.dispose();
  }
  if (assertionError) throw assertionError;

  return { rawBeforeDetach, resizes };
}

describe("L0.5b Step 1/2 — column containment & cursor hygiene without DECLRMM", () => {
  let root = "";
  let prevStateHome: string | undefined;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "h2a-l05b-containment-"));
    prevStateHome = process.env["XDG_STATE_HOME"];
    process.env["XDG_STATE_HOME"] = join(root, "state");
  });

  afterEach(() => {
    if (prevStateHome === undefined) delete process.env["XDG_STATE_HOME"];
    else process.env["XDG_STATE_HOME"] = prevStateHome;
    rmSync(root, { recursive: true, force: true });
  });

  it("holds containment after every batch with panel OPEN and status bar active, without ?69 or CSI s/u", async () => {
    const { rawBeforeDetach } = await runCorpusScenario({
      totalCols: 100,
      totalRows: 20,
      panelWidth: 32,
      open: true,
      statusBar: true,
    });
    expect(rawBeforeDetach).not.toContain("\x1b[?69h");
    expect(rawBeforeDetach).not.toContain("\x1b[?69l");
    expect(rawBeforeDetach).not.toContain("\x1b[s");
    expect(rawBeforeDetach).not.toContain("\x1b[u");
  });

  it("holds containment after every batch with panel COLLAPSED (1-col marker) and status bar active", async () => {
    const { rawBeforeDetach } = await runCorpusScenario({
      totalCols: 100,
      totalRows: 20,
      panelWidth: 32,
      open: false,
      statusBar: true,
    });
    expect(rawBeforeDetach).not.toContain("\x1b[?69h");
    expect(rawBeforeDetach).not.toContain("\x1b[s");
  });

  it("holds containment after every batch with panel OPEN and status bar INACTIVE (panel spans 1..rows)", async () => {
    const { rawBeforeDetach } = await runCorpusScenario({
      totalCols: 100,
      totalRows: 20,
      panelWidth: 32,
      open: true,
      statusBar: false,
    });
    expect(rawBeforeDetach).not.toContain("\x1b[?69h");
    expect(rawBeforeDetach).not.toContain("\x1b[s");
  });

  it("refuses open below 40 child columns and keeps 1-col marker intact under full corpus", async () => {
    const { resizes } = await runCorpusScenario({
      totalCols: 60,
      totalRows: 20,
      panelWidth: 32,
      open: true,
      statusBar: true,
    });
    // 60 - 32 = 28 < 40 => open refused, child keeps 59 cols (1-col marker).
    expect(resizes.every((r) => r.cols === 59)).toBe(true);
  });

  it("paints neither status bar nor right panel below 10 rows and keeps child full geometry", async () => {
    const { resizes, rawBeforeDetach } = await runCorpusScenario({
      totalCols: 100,
      totalRows: 8,
      panelWidth: 32,
      open: true,
      statusBar: true,
    });
    expect(resizes.every((r) => r.cols === 100 && r.rows === 8)).toBe(true);
    expect(rawBeforeDetach).not.toContain("[core]");
    expect(rawBeforeDetach).not.toContain("h2a-alpha · attached");
  });
});
