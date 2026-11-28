import { describe, expect, it } from "vitest";

import {
  RIGHT_PANEL_DEFAULT_WIDTH,
  RIGHT_PANEL_TOGGLE_SEQUENCE,
  RIGHT_PANEL_WHEEL_STEP,
  buildRightPanelSnapshot,
  decisionsFromTrackDecisions,
  panelDisplayColumns,
  parseSgrMouse,
  resolveRightPanelEnabled,
  resolveRightPanelWidth,
  resolveStatusGlyph,
  rightPanelReservedCols,
  routePanelMouse,
  sessionStatusGlyph,
  RightPanelController,
  type RightPanelSnapshot,
} from "./right-panel.js";
import {
  formatRightPanelBarMarker,
  renderNativeStatusBarLine,
  rightPanelStatusBarHitSpan,
  type NativeStatusBarSnapshot,
} from "../status-projection.js";
import { TerminalModeTracker } from "./terminal-modes.js";

class FakeOut {
  columns = 100;
  rows = 30;
  readonly chunks: string[] = [];
  write(chunk: string): boolean {
    this.chunks.push(String(chunk));
    return true;
  }
  text(): string {
    return this.chunks.join("");
  }
}

function fixtureSnapshot(): RightPanelSnapshot {
  return buildRightPanelSnapshot({
    currentSessionId: "s-current",
    groups: [
      {
        title: "core",
        sessions: [
          { id: "s-current", label: "alpha", status: "running" },
          { id: "s-blocked", label: "beta", status: "blocked" },
          { id: "s-sub", label: "worker-1", status: "running", delegated: true },
        ],
      },
      {
        title: "docs",
        sessions: [{ id: "s-q", label: "gamma", status: "question" }],
      },
    ],
    decisions: [
      {
        id: "d1",
        title: "Choisir le fournisseur",
        kind: "decision",
        sessionId: "s-blocked",
        dossierLink: "docs/decisions/d1.md",
      },
    ],
  });
}

describe("right panel config (default OFF)", () => {
  it("is disabled without env or config opt-in", () => {
    expect(resolveRightPanelEnabled({}, {})).toBe(false);
    expect(resolveRightPanelEnabled({}, { rightPanel: { enabled: true } })).toBe(true);
    expect(resolveRightPanelEnabled({ H2A_RIGHT_PANEL: "1" }, {})).toBe(true);
    expect(
      resolveRightPanelEnabled({ H2A_RIGHT_PANEL: "0" }, { rightPanel: { enabled: true } }),
    ).toBe(false);
  });

  it("defaults to width 32 and clamps overrides", () => {
    expect(RIGHT_PANEL_DEFAULT_WIDTH).toBe(32);
    expect(resolveRightPanelWidth({}, {})).toBe(32);
    expect(resolveRightPanelWidth({}, { rightPanel: { width: 40 } })).toBe(40);
    expect(resolveRightPanelWidth({}, { rightPanel: { width: 500 } })).toBe(60);
    expect(resolveRightPanelWidth({ H2A_RIGHT_PANEL_WIDTH: "24" }, {})).toBe(24);
  });
});

describe("right panel geometry (columns reserved like the bottom bar rows)", () => {
  it("reserves the full width while open and one marker column while collapsed", () => {
    expect(
      rightPanelReservedCols({ totalCols: 100, width: 32, open: true }),
    ).toBe(32);
    expect(
      rightPanelReservedCols({ totalCols: 100, width: 32, open: false }),
    ).toBe(1);
  });

  it("refuses to open below the minimum child width and keeps the strip", () => {
    expect(
      rightPanelReservedCols({ totalCols: 50, width: 32, open: true }),
    ).toBe(1);
  });
});

describe("right panel snapshot projection", () => {
  it("hides delegated sub-sessions by default and marks attention with * (PANEL §4.5 dedup)", () => {
    const snap = fixtureSnapshot();
    const labels = snap.workspaces.flatMap((w) => w.sessions.map((s) => s.label));
    expect(labels).toEqual(["alpha", "beta", "gamma"]);
    // PANEL §4.5: deduplicated subjects — s-blocked (with d1 attributed to it) + s-q = 2
    expect(snap.attentionCount).toBe(2);
    expect(sessionStatusGlyph("blocked").symbol).toBe("✖");
    expect(sessionStatusGlyph("question").attention).toBe(true);
    expect(sessionStatusGlyph("running").symbol).toBe("●");
    // PANEL §10: unknown uses distinct glyph `·` (never `?`)
    expect(sessionStatusGlyph("unknown").symbol).toBe("·");
  });

  it("table-tests PANEL §4.5 / PANEL:441 attentionCount and collapsedLit rules", () => {
    // 18 old pending/deferred decisions already seen => unlit, attentionCount = 0
    const oldDecisions = Array.from({ length: 13 }, (_, i) => ({
      id: `d-old-${i}`,
      title: `Old pending ${i}`,
      kind: "decision" as const,
      outcome: "pending" as const,
    })).concat(
      Array.from({ length: 5 }, (_, i) => ({
        id: `d-def-${i}`,
        title: `Deferred ${i}`,
        kind: "decision" as const,
        outcome: "deferred" as const,
      })),
    );
    const seen = new Set(oldDecisions.map((d) => d.id));
    const allSeen = buildRightPanelSnapshot({
      currentSessionId: "s-1",
      groups: [{ title: "core", sessions: [{ id: "s-1", label: "a", status: "running" }] }],
      decisions: oldDecisions,
      seenDecisionKeys: seen,
    });
    expect(allSeen.collapsedLit).toBe(false);
    expect(allSeen.attentionCount).toBe(0);

    // 1 new unseen pending decision => lit, attentionCount = 1
    const withNew = buildRightPanelSnapshot({
      currentSessionId: "s-1",
      groups: [{ title: "core", sessions: [{ id: "s-1", label: "a", status: "running" }] }],
      decisions: [
        ...oldDecisions,
        { id: "d-new", title: "New pending", kind: "decision", outcome: "pending" },
      ],
      seenDecisionKeys: seen,
    });
    expect(withNew.collapsedLit).toBe(true);
    expect(withNew.attentionCount).toBe(1);

    // Deferred decision alone (even unseen) => NEVER lit, NEVER counted
    const deferredOnly = buildRightPanelSnapshot({
      currentSessionId: "s-1",
      groups: [{ title: "core", sessions: [{ id: "s-1", label: "a", status: "running" }] }],
      decisions: [{ id: "d-def-only", title: "Deferred", kind: "decision", outcome: "deferred" }],
    });
    expect(deferredOnly.collapsedLit).toBe(false);
    expect(deferredOnly.attentionCount).toBe(0);

    // Another session blocked => lit; only attached session blocked => unlit
    const otherBlocked = buildRightPanelSnapshot({
      currentSessionId: "s-1",
      groups: [
        {
          title: "core",
          sessions: [
            { id: "s-1", label: "a", status: "running" },
            { id: "s-2", label: "b", status: "blocked" },
          ],
        },
      ],
      decisions: [],
    });
    expect(otherBlocked.collapsedLit).toBe(true);
    expect(otherBlocked.attentionCount).toBe(1);

    const selfBlocked = buildRightPanelSnapshot({
      currentSessionId: "s-1",
      groups: [{ title: "core", sessions: [{ id: "s-1", label: "a", status: "blocked" }] }],
      decisions: [],
    });
    expect(selfBlocked.collapsedLit).toBe(false);
    expect(selfBlocked.attentionCount).toBe(0);

    // Unreadable source => degraded: true -> collapsed marker renders '?'
    const degradedOut = new FakeOut();
    const degradedPanel = new RightPanelController({
      stdout: degradedOut as unknown as NodeJS.WriteStream,
      snapshot: buildRightPanelSnapshot({
        currentSessionId: "s-1",
        groups: [],
        decisions: [],
        degraded: true,
      }),
    });
    degradedPanel.paint();
    expect(degradedOut.text()).toContain("?");
  });

  it("derives decisions/questions from Track rows, pending only, with dossier link", () => {
    const rows = decisionsFromTrackDecisions([
      { id: "a", title: "A", outcome: "pending", workspace: "core", dossier: { path: "docs/a.md" } },
      { id: "b", title: "B", outcome: "selected", workspace: "core" },
      {
        id: "c",
        title: "C",
        outcome: "deferred",
        workspace: "docs",
        qa: [{ question: "Quel périmètre ?", answer: undefined }],
      },
    ]);
    expect(rows.map((r) => r.id)).toEqual(["a", "c"]);
    expect(rows[0]!.dossierLink).toBe("docs/a.md");
    expect(rows[1]!.kind).toBe("question");
  });
});

describe("right panel rendering", () => {
  it("renders tabs on top, status symbol + colour + * and the dossier link", () => {
    const out = new FakeOut();
    const panel = new RightPanelController({
      stdout: out as unknown as NodeJS.WriteStream,
      snapshot: fixtureSnapshot(),
    });
    panel.toggle();
    const text = out.text();
    expect(text).toContain("core");
    expect(text).toContain("docs");
    expect(text).toContain("beta");
    expect(text).toContain("*");
    expect(text).toContain("\x1b[");
    expect(panel.isOpen()).toBe(true);
    expect(panel.childCols(100)).toBe(68);
  });

  it("collapsed marker lights when another session is blocked or questioned", () => {
    const snap = fixtureSnapshot();
    expect(snap.collapsedLit).toBe(true);
    const calm = buildRightPanelSnapshot({
      currentSessionId: "s-current",
      groups: [
        { title: "core", sessions: [{ id: "s-current", label: "alpha", status: "blocked" }] },
      ],
      decisions: [],
    });
    expect(calm.collapsedLit).toBe(false);
  });
});

describe("right panel keyboard", () => {
  it("F12 toggles and is consumed; Esc returns focus to the CLI without closing", () => {
    const out = new FakeOut();
    const panel = new RightPanelController({
      stdout: out as unknown as NodeJS.WriteStream,
      snapshot: fixtureSnapshot(),
    });
    const opened = panel.handleInput(RIGHT_PANEL_TOGGLE_SEQUENCE, { cliMouseEnabled: false });
    expect(opened.consumed).toBe(true);
    expect(panel.isOpen()).toBe(true);
    expect(panel.hasPanelFocus()).toBe(true);

    const esc = panel.handleInput("\x1b", { cliMouseEnabled: false });
    expect(esc.consumed).toBe(true);
    // Bare ESC disambiguates via flushPending (so split ESC[A / ESC[24~ never leak)
    panel.flushPending({ cliMouseEnabled: false });
    expect(panel.isOpen()).toBe(true);
    expect(panel.hasPanelFocus()).toBe(false);

    const plain = panel.handleInput("x", { cliMouseEnabled: false });
    expect(plain.consumed).toBe(false);
    expect(plain.forward).toBe("x");
  });

  it("supports key-by-key /s /d /t /a /c /gw, unknown /x, Shift+Tab, arrows, and distinct selection vs Enter activation (L0.5a)", () => {
    const out = new FakeOut();
    const panel = new RightPanelController({
      stdout: out as unknown as NodeJS.WriteStream,
      snapshot: fixtureSnapshot(),
    });
    panel.toggle();

    // Key-by-key /d switches to decisions; /t to track; /s back to sessions
    panel.handleInput("/", { cliMouseEnabled: false });
    expect(panel.slashPrompt()).toBe("/");
    panel.handleInput("d", { cliMouseEnabled: false });
    expect(panel.view).toBe("decisions");
    expect(panel.slashPrompt()).toBeUndefined();

    panel.handleInput("/", { cliMouseEnabled: false });
    panel.handleInput("z", { cliMouseEnabled: false });
    expect(panel.notice()).toBe("unknown: /z");

    panel.handleInput("/", { cliMouseEnabled: false });
    panel.handleInput("g", { cliMouseEnabled: false });
    panel.handleInput("w", { cliMouseEnabled: false });
    panel.handleInput("\r", { cliMouseEnabled: false });
    expect(panel.notice()).toContain("/gw");

    panel.handleInput("/", { cliMouseEnabled: false });
    panel.handleInput("s", { cliMouseEnabled: false });
    expect(panel.view).toBe("sessions");

    // Down arrow selects row 1 (does NOT activate); Enter activates row 1 (distinct actions)
    const sel = panel.handleInput("\x1b[B", { cliMouseEnabled: false });
    expect(sel.actions).toEqual([
      { type: "select-session", index: 1, sessionId: "s-blocked" },
    ]);
    expect(panel.selectedSessionIndex()).toBe(1);

    const act = panel.handleInput("\r", { cliMouseEnabled: false });
    expect(act.actions).toEqual([
      { type: "activate-session", index: 1, sessionId: "s-blocked" },
    ]);

    // Tab and Shift+Tab cycle meta-workspace tabs forward and backward
    panel.handleInput("\t", { cliMouseEnabled: false });
    expect(panel.activeTabIndex).toBe(1);
    panel.handleInput("\x1b[Z", { cliMouseEnabled: false });
    expect(panel.activeTabIndex).toBe(0);
  });

  it("renders visible bottom-bar toggle marker over its exact hit-test span (r2 :462, PANEL §4.4)", () => {
    const base: NativeStatusBarSnapshot = {
      cli: "claude",
      sessionName: "h2a-alpha",
      linkState: "attached",
      role: "dev",
      workload: {
        j: { open: 0, attention: 0, degraded: false },
        i: { waiting: 0, degraded: false },
        l: { active: 0, attention: 0, degraded: false },
      },
      delegatedSessions: 0,
      gateway: { state: "off", clientSessionId: "h2a-alpha" },
    };
    // Panel off: no marker glyph
    expect(renderNativeStatusBarLine(base, 100)).not.toContain("▸▸");

    // Panel on + lit: `▸▸*` rendered at exact rightPanelStatusBarHitSpan columns
    const marker = { enabled: true, lit: true, degraded: false };
    expect(formatRightPanelBarMarker(marker)).toBe("▸▸*");
    const line = renderNativeStatusBarLine({ ...base, rightPanelMarker: marker }, 100);
    expect(line.endsWith(" ▸▸* ")).toBe(true);
    const span = rightPanelStatusBarHitSpan(100, marker)!;
    expect(span).toEqual({ startCol: 96, endCol: 100 });
    expect(
      routePanelMouse(
        { button: 0, x: span.startCol, y: 30, release: false, wheel: false, shift: false },
        { totalCols: 100, totalRows: 30, childCols: 99, open: false, statusBarMarker: marker },
        { cliMouseEnabled: false },
      ).zone,
    ).toBe("status-marker");
    expect(
      routePanelMouse(
        { button: 0, x: span.startCol - 1, y: 30, release: false, wheel: false, shift: false },
        { totalCols: 100, totalRows: 30, childCols: 99, open: false, statusBarMarker: marker },
        { cliMouseEnabled: false },
      ).zone,
    ).toBe("status-bar");
  });

  it("/s /d /t switch views and Tab cycles meta-workspace tabs only in panel focus", () => {
    const out = new FakeOut();
    const panel = new RightPanelController({
      stdout: out as unknown as NodeJS.WriteStream,
      snapshot: fixtureSnapshot(),
    });
    panel.toggle();
    expect(panel.view).toBe("sessions");
    panel.handleInput("/d", { cliMouseEnabled: false });
    expect(panel.view).toBe("decisions");
    expect(out.text()).toContain("docs/decisions/d1.md");
    panel.handleInput("/t", { cliMouseEnabled: false });
    expect(panel.view).toBe("track");
    panel.handleInput("/s", { cliMouseEnabled: false });
    expect(panel.view).toBe("sessions");
    expect(panel.activeTabIndex).toBe(0);
    panel.handleInput("\t", { cliMouseEnabled: false });
    expect(panel.activeTabIndex).toBe(1);
  });
});

describe("right panel mouse (SGR)", () => {
  it("parses SGR press/release/wheel events and keeps the split tail", () => {
    const parsed = parseSgrMouse("a\x1b[<0;70;5M\x1b[<65;70;6M\x1b[<0;7");
    expect(parsed.events).toHaveLength(2);
    expect(parsed.events[0]).toMatchObject({ x: 70, y: 5, release: false });
    expect(parsed.events[1]!.wheel).toBe(true);
    expect(parsed.rest).toBe("a\x1b[<0;7");
  });

  it("routes panel clicks to tab/session/link and CLI clicks by CLI mouse state", () => {
    const geom = { totalCols: 100, totalRows: 30, childCols: 68, open: true };
    expect(
      routePanelMouse({ button: 0, x: 70, y: 1, release: false, wheel: false, shift: false }, geom, { cliMouseEnabled: false }).zone,
    ).toBe("panel");
    const cliOff = routePanelMouse(
      { button: 0, x: 10, y: 5, release: false, wheel: false, shift: false },
      geom,
      { cliMouseEnabled: false },
    );
    expect(cliOff.zone).toBe("cli");
    expect(cliOff.forwardToCli).toBe(false);
    const cliOn = routePanelMouse(
      { button: 0, x: 10, y: 5, release: false, wheel: false, shift: false },
      geom,
      { cliMouseEnabled: true },
    );
    expect(cliOn.forwardToCli).toBe(true);
    const shift = routePanelMouse(
      { button: 4, x: 10, y: 5, release: false, wheel: false, shift: true },
      geom,
      { cliMouseEnabled: true },
    );
    expect(shift.zone).toBe("native-selection");
  });

  it("a click on the bottom-bar marker toggles the panel", () => {
    const out = new FakeOut();
    const panel = new RightPanelController({
      stdout: out as unknown as NodeJS.WriteStream,
      snapshot: fixtureSnapshot(),
    });
    const click = panel.handleInput("\x1b[<0;99;30M", { cliMouseEnabled: false });
    expect(click.consumed).toBe(true);
    expect(panel.isOpen()).toBe(true);
  });

  it("clicking a decision row surfaces its dossier link target text", () => {
    const out = new FakeOut();
    const panel = new RightPanelController({
      stdout: out as unknown as NodeJS.WriteStream,
      snapshot: fixtureSnapshot(),
    });
    panel.toggle();
    panel.handleInput("/d", { cliMouseEnabled: false });
    out.chunks.length = 0;
    const result = panel.handleInput("\x1b[<0;80;3M", { cliMouseEnabled: false });
    expect(result.consumed).toBe(true);
    expect(result.actions).toContainEqual({ type: "open-link", target: "docs/decisions/d1.md" });
  });

  it("L0.5b: transcodes CLI-zone SGR clicks to SGR/urxvt/utf8/x10 and filters unsubscribed classes", () => {
    const out = new FakeOut();
    const panel = new RightPanelController({
      stdout: out as unknown as NodeJS.WriteStream,
      snapshot: fixtureSnapshot(),
    });
    // SGR (1006) verbatim
    const sgr = panel.handleInput("\x1b[<0;10;5M\x1b[<0;10;5m", {
      cliMouseEnabled: true,
      cliMouseMode: 1000,
      cliMouseEncoding: "sgr",
    });
    expect(sgr.consumed).toBe(false);
    expect(sgr.forward).toBe("\x1b[<0;10;5M\x1b[<0;10;5m");

    // urxvt (1015): press button 0 => 32; release => 35
    const urxvt = panel.handleInput("\x1b[<0;10;5M\x1b[<0;10;5m", {
      cliMouseEnabled: true,
      cliMouseMode: 1000,
      cliMouseEncoding: "urxvt",
    });
    expect(urxvt.consumed).toBe(false);
    expect(urxvt.forward).toBe("\x1b[32;10;5M\x1b[35;10;5M");

    // X10 (default): press encoded as ESC [ M cb cx cy; mode 9 drops release & wheel & motion
    const x10Mode9 = panel.handleInput("\x1b[<0;10;5M\x1b[<0;10;5m\x1b[<64;10;5M", {
      cliMouseEnabled: true,
      cliMouseMode: 9,
      cliMouseEncoding: "x10",
    });
    expect(x10Mode9.consumed).toBe(false);
    expect(x10Mode9.forward).toBe(`\x1b[M${String.fromCharCode(32, 42, 37)}`);

    // Mode 1000 drops motion (button bit 32)
    const motionUnder1000 = panel.handleInput("\x1b[<35;10;5M", {
      cliMouseEnabled: true,
      cliMouseMode: 1000,
      cliMouseEncoding: "sgr",
    });
    expect(motionUnder1000.consumed).toBe(true);

    // Mode 1002 forwards drag motion (button 32) and drops free motion (button 35)
    const dragUnder1002 = panel.handleInput("\x1b[<32;10;5M\x1b[<35;10;5M", {
      cliMouseEnabled: true,
      cliMouseMode: 1002,
      cliMouseEncoding: "sgr",
    });
    expect(dragUnder1002.consumed).toBe(false);
    expect(dragUnder1002.forward).toBe("\x1b[<32;10;5M");

    // Shift keeps native-selection: never acted on, never forwarded
    const shiftClick = panel.handleInput("\x1b[<4;10;5M", {
      cliMouseEnabled: true,
      cliMouseMode: 1003,
      cliMouseEncoding: "sgr",
    });
    expect(shiftClick.consumed).toBe(true);
    expect(shiftClick.actions).toEqual([]);
  });

  it("L0.5b: routes last row to CLI/panel when status bar is inactive and consumes non-marker bar clicks when active", () => {
    const geomInactive = {
      totalCols: 100,
      totalRows: 30,
      childCols: 99,
      open: false,
      statusBarActive: false,
    };
    // Last row, CLI columns => CLI zone (not status-marker!)
    const cliLastRow = routePanelMouse(
      { button: 0, x: 96, y: 30, release: false, wheel: false, shift: false },
      geomInactive,
      { cliMouseEnabled: true },
    );
    expect(cliLastRow.zone).toBe("cli");
    expect(cliLastRow.forwardToCli).toBe(true);
    // Last row, marker column => panel zone
    const markerLastRow = routePanelMouse(
      { button: 0, x: 100, y: 30, release: false, wheel: false, shift: false },
      geomInactive,
      { cliMouseEnabled: true },
    );
    expect(markerLastRow.zone).toBe("panel");
    expect(markerLastRow.forwardToCli).toBe(false);

    // When status bar IS active, non-marker bar click never reaches CLI
    const barMiddle = routePanelMouse(
      { button: 0, x: 20, y: 30, release: false, wheel: false, shift: false },
      { ...geomInactive, statusBarActive: true },
      { cliMouseEnabled: true },
    );
    expect(barMiddle.forwardToCli).toBe(false);
    expect(barMiddle.zone).toBe("status-bar");
  });

  it("L0.5b: buffers split SGR mouse sequences and never disables outer mouse on close", () => {
    const out = new FakeOut();
    const panel = new RightPanelController({
      stdout: out as unknown as NodeJS.WriteStream,
      snapshot: fixtureSnapshot(),
    });
    const part1 = panel.handleInput("\x1b[<0;100;", { cliMouseEnabled: true, cliMouseMode: 1000, cliMouseEncoding: "sgr" });
    expect(part1.consumed).toBe(true);
    const part2 = panel.handleInput("15M", { cliMouseEnabled: true, cliMouseMode: 1000, cliMouseEncoding: "sgr" });
    expect(part2.consumed).toBe(true);
    expect(panel.isOpen()).toBe(true);
    out.chunks.length = 0;
    panel.toggle();
    expect(panel.isOpen()).toBe(false);
    expect(out.text()).not.toContain("\x1b[?1000l");
    expect(out.text()).not.toContain("\x1b[?1006l");
    expect(out.text()).not.toContain("\x1b[?69l");
  });
});

describe("child mouse tracking detection", () => {
  it("reflects the CLI's own DECSET mouse modes", () => {
    const tracker = new TerminalModeTracker();
    expect(tracker.isMouseTrackingEnabled()).toBe(false);
    tracker.feed("\x1b[?1002h\x1b[?1006h");
    expect(tracker.isMouseTrackingEnabled()).toBe(true);
    tracker.feed("\x1b[?1002l");
    expect(tracker.isMouseTrackingEnabled()).toBe(false);
  });
});

describe("PANEL L1 unit helpers (hit spans, expander state, wheel step, width accounting)", () => {
  it("exposes exact tab hit spans matching rendered columns and falls back cleanly on glyph oracle disagreement", () => {
    expect(RIGHT_PANEL_WHEEL_STEP).toBe(3);
    expect(panelDisplayColumns("a\u0301中文")).toBe(5);
    expect(panelDisplayColumns("\x1b[33m⏸\x1b[0m")).toBe(1);
    expect(resolveStatusGlyph("paused").symbol).toBe("⏸");
    expect(resolveStatusGlyph("paused", () => 2).symbol).toBe("||");
    expect(resolveStatusGlyph("running", () => 2).symbol).toBe("o");

    const out = new FakeOut();
    const panel = new RightPanelController({
      stdout: out as unknown as NodeJS.WriteStream,
      snapshot: fixtureSnapshot(),
      width: 32,
    });
    panel.toggle();
    // [core] (6 cols: 69..74), space (75), docs (4 cols: 76..79)
    expect(panel.tabHitSpans()).toEqual([
      { index: 0, startCol: 69, endCol: 74 },
      { index: 1, startCol: 76, endCol: 79 },
    ]);
  });

  it("toggles delegated expander via right/left/Space keys and never leaks draft state into selectedDelegatedNamesForBar", () => {
    const out = new FakeOut();
    const snap = buildRightPanelSnapshot({
      currentSessionId: "s-1",
      groups: [
        {
          title: "core",
          sessions: [
            {
              id: "s-1",
              label: "alpha",
              status: "running",
              draftRecovery: "saved-for-recovery",
              draftCapability: "refused-no-draft-adapter",
              delegatedNames: ["w-1"],
              delegatedChildren: [
                { id: "j-1", label: "w-1", tool: "claude", state: "running", origin: "cli:h2a-delegate" },
              ],
            },
            {
              id: "s-2",
              label: "beta",
              status: "idle",
              delegatedDegraded: true,
            },
          ],
        },
      ],
      decisions: [],
    });
    const panel = new RightPanelController({
      stdout: out as unknown as NodeJS.WriteStream,
      snapshot: snap,
      width: 32,
    });
    // Closed: undefined (byte-identical count form)
    expect(panel.selectedDelegatedNamesForBar()).toBeUndefined();

    panel.toggle();
    expect(panel.selectedDelegatedNamesForBar()).toEqual(["w-1"]);
    const exp = panel.handleInput("\x1b[C", { cliMouseEnabled: false }); // Right arrow
    expect(exp.actions).toEqual([
      { type: "toggle-delegated-expander", sessionId: "s-1", expanded: true },
    ]);
    expect(out.text()).toContain("w-1 (claude · running)");
    const col = panel.handleInput("\x1b[D", { cliMouseEnabled: false }); // Left arrow
    expect(col.actions).toEqual([
      { type: "toggle-delegated-expander", sessionId: "s-1", expanded: false },
    ]);

    // Move to beta (delegatedDegraded) -> bar receives "unknown" (`deleg ?`)
    panel.handleInput("\x1b[B", { cliMouseEnabled: false });
    expect(panel.selectedDelegatedNamesForBar()).toBe("unknown");

    // Clear selection -> undefined (byte-identical count form)
    panel.clearSelection();
    expect(panel.selectedDelegatedNamesForBar()).toBeUndefined();
  });
});

describe("S2 restorable expander (plan 09-S2)", () => {
  function restorableSnapshot(): RightPanelSnapshot {
    return buildRightPanelSnapshot({
      currentSessionId: "s-live",
      groups: [
        {
          title: "core",
          sessions: [{ id: "s-live", label: "live", status: "running" }],
          restorable: [
            {
              key: "registry:dead-1",
              label: "dead-one",
              reason: "launch-cap",
              reasonText: "launch cap",
              state: "queued",
              relaunch: {
                args: ["run", "claude", "/src/a", "--resume", "sid-1", "--name", "dead-one", "--no-attach"],
                env: [],
                cwd: "/src/a",
              },
            },
            {
              key: "registry:dead-2",
              label: "dead-two",
              reason: "unresolved-conversation",
              reasonText: "conversation not resolved",
              state: "queued",
            },
            {
              key: "registry:dead-3",
              label: "dead-three",
              reason: "dual-host",
              reasonText: "identity on two hosts",
              state: "queued",
            },
            {
              key: "registry:dead-4",
              label: "dead-four",
              reason: "unknown-view",
              reasonText: "view unknown",
              state: "queued",
            },
            {
              key: "registry:dead-5",
              label: "dead-five",
              reason: "unclassified-scan",
              reasonText: "unclassified-scan",
              state: "queued",
            },
          ],
        },
      ],
      decisions: [],
    });
  }

  function plainish(text: string): string {
    return text.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "");
  }

  it("should list every restorable row under its tab, uncapped, with its reason", () => {
    const out = new FakeOut();
    const panel = new RightPanelController({
      stdout: out as unknown as NodeJS.WriteStream,
      snapshot: restorableSnapshot(),
      width: 60,
    });
    const mark = out.chunks.length;
    panel.toggle();
    const collapsed = plainish(out.chunks.slice(mark).join(""));
    expect(panel.isOpen()).toBe(true);
    expect(collapsed).toContain("5 restorable");
    for (const label of ["dead-one", "dead-two", "dead-three", "dead-four", "dead-five"]) {
      expect(collapsed).not.toContain(label);
    }

    // Walk down to the expander and open it: one uncapped section, one motif a row.
    panel.handleInput("j", { cliMouseEnabled: false });
    const toggled = panel.handleInput("\r", { cliMouseEnabled: false });
    expect(toggled.actions).toContainEqual({
      type: "toggle-restorable-expander",
      tab: "core",
      expanded: true,
    });
    const expanded = plainish(out.chunks.slice(mark).join(""));
    for (
      const [label, reason] of [
        ["dead-one", "launch cap"],
        ["dead-two", "conversation not resolved"],
        ["dead-three", "identity on two hosts"],
        ["dead-four", "view unknown"],
        ["dead-five", "unclassified-scan"],
      ]
    ) {
      expect(expanded).toContain(label);
      expect(expanded).toContain(reason);
    }

    // Enter on the relaunchable row offers its gesture; a row without
    // gesture offers nothing and guesses no identifier.
    panel.handleInput("j", { cliMouseEnabled: false });
    const gesture = panel.handleInput("\r", { cliMouseEnabled: false });
    expect(gesture.actions).toContainEqual({
      type: "activate-restorable-row",
      key: "registry:dead-1",
    });
    panel.handleInput("j", { cliMouseEnabled: false });
    const silent = panel.handleInput("\r", { cliMouseEnabled: false });
    expect(silent.actions).toEqual([]);
  });

  it("should not walk into a collapsed restorable section", () => {
    const out = new FakeOut();
    const panel = new RightPanelController({
      stdout: out as unknown as NodeJS.WriteStream,
      snapshot: restorableSnapshot(),
      width: 60,
    });
    panel.toggle();
    // Down from the live session lands on the collapsed expander.
    const down = panel.handleInput("j", { cliMouseEnabled: false });
    expect(down.actions).toEqual([]);
    // A further Down leaves the collapsed section instead of selecting a
    // hidden row: no gesture fires, and Enter returns to the live session.
    const hidden = panel.handleInput("j", { cliMouseEnabled: false });
    expect(hidden.actions).toEqual([]);
    const enter = panel.handleInput("\r", { cliMouseEnabled: false });
    expect(enter.actions).toContainEqual({
      type: "activate-session",
      index: 0,
      sessionId: "s-live",
    });
  });

  it("should paint an empty state text as motif alone, never deferred (NB-14)", () => {
    const out = new FakeOut();
    const snapshot = restorableSnapshot();
    const core = snapshot.workspaces[0]!;
    core.restorable = [
      {
        key: "registry:capped-1",
        label: "capped-one",
        reason: "launch-cap",
        reasonText: "launch cap",
        state: "deferred",
        stateText: "",
        relaunch: {
          args: ["run", "claude", "/src/a", "--resume", "sid-1", "--name", "capped-one", "--no-attach"],
          env: [],
          cwd: "/src/a",
        },
      },
    ];
    const panel = new RightPanelController({
      stdout: out as unknown as NodeJS.WriteStream,
      snapshot,
      width: 60,
    });
    panel.toggle();
    // Walk down to the expander and open it.
    panel.handleInput("j", { cliMouseEnabled: false });
    const mark = out.chunks.length;
    panel.handleInput("\r", { cliMouseEnabled: false });
    const expanded = plainish(out.chunks.slice(mark).join(""));
    expect(expanded).toContain("capped-one");
    // The motif stands alone in parentheses: no state, no separator.
    expect(expanded).toContain("(launch cap)");
    expect(expanded).not.toContain("deferred");
  });

  it("should select a restorable row on first click and fire its gesture on second click", () => {
    const out = new FakeOut();
    const panel = new RightPanelController({
      stdout: out as unknown as NodeJS.WriteStream,
      snapshot: restorableSnapshot(),
      width: 60,
    });
    panel.toggle();
    // Open the expander by keyboard, then click the first row twice. The
    // panel paints by cursor positioning, so read the row from its CUP.
    panel.handleInput("j", { cliMouseEnabled: false });
    const mark = out.chunks.length;
    panel.handleInput("\r", { cliMouseEnabled: false });
    const painted = out.chunks.slice(mark).join("");
    const cells = [...painted.matchAll(/\x1b\[(\d+);41H([^\x1b]*)/g)];
    const rowY = Number(cells.find((cell) => cell[2].includes("dead-one"))?.[1] ?? 0);
    expect(rowY).toBeGreaterThan(1);
    const click = (y: number) =>
      panel.handleInputBytes(Buffer.from(`\x1b[<0;90;${y}M`), { cliMouseEnabled: false });
    const first = click(rowY);
    expect(first.actions).toEqual([]);
    const second = click(rowY);
    expect(second.actions).toContainEqual({
      type: "activate-restorable-row",
      key: "registry:dead-1",
    });
  });
});

// ---------------------------------------------------------------------------
// Station panel ergonomics: width, one-click activation, help, restorable list
// ---------------------------------------------------------------------------

import {
  RIGHT_PANEL_ADJUST_MAX_WIDTH,
  RIGHT_PANEL_AUTO_MAX_WIDTH,
  RIGHT_PANEL_AUTO_MIN_WIDTH,
  RIGHT_PANEL_MIN_CHILD_COLS,
  RIGHT_PANEL_MIN_WIDTH,
  RIGHT_PANEL_WIDTH_STEP,
  autoRightPanelWidth,
  explicitRightPanelWidth,
  groupRestorableRows,
  isUsefulRestorableRow,
  type RightPanelRestorableRow,
} from "./right-panel.js";

const stripAnsi = (text: string): string => text.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "");

/** Rows of the panel as last painted, by 1-based screen row. */
function paintedRows(out: FakeOut, fromChunk = 0): Map<number, string> {
  const rows = new Map<number, string>();
  const text = out.chunks.slice(fromChunk).join("");
  const re = /\x1b\[(\d+);(\d+)H([\s\S]*?)(?=\x1b\[\d+;\d+H|$)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) rows.set(Number(match[1]), stripAnsi(match[3]!));
  return rows;
}

function rowOf(out: FakeOut, needle: string, fromChunk = 0): number {
  for (const [row, text] of paintedRows(out, fromChunk)) if (text.includes(needle)) return row;
  throw new Error(`no painted row contains ${JSON.stringify(needle)}`);
}

const INPUT = { cliMouseEnabled: false } as const;
const click = (x: number, y: number): string => `\x1b[<0;${x};${y}M`;

describe("station panel width: a bounded share of the terminal, adjustable by hand", () => {
  it("should take 30 % of the terminal between 32 and 64 columns", () => {
    expect(autoRightPanelWidth(250)).toBe(RIGHT_PANEL_AUTO_MAX_WIDTH);
    expect(autoRightPanelWidth(160)).toBe(48);
    expect(autoRightPanelWidth(120)).toBe(36);
    expect(autoRightPanelWidth(100)).toBe(RIGHT_PANEL_AUTO_MIN_WIDTH);
    expect(autoRightPanelWidth(0)).toBe(RIGHT_PANEL_DEFAULT_WIDTH);
  });

  it("should leave the session its minimum width on a narrow terminal", () => {
    // 66 columns: 32 for the panel would leave 34 to the session; it gets 26.
    expect(autoRightPanelWidth(66)).toBe(66 - RIGHT_PANEL_MIN_CHILD_COLS);
    expect(autoRightPanelWidth(60)).toBe(RIGHT_PANEL_MIN_WIDTH);
    for (let cols = 60; cols <= 400; cols += 1) {
      const width = autoRightPanelWidth(cols);
      expect(cols - width, `cols ${cols}`).toBeGreaterThanOrEqual(RIGHT_PANEL_MIN_CHILD_COLS);
      expect(width, `cols ${cols}`).toBeGreaterThanOrEqual(RIGHT_PANEL_MIN_WIDTH);
    }
  });

  it("should report an explicit width only when the environment or the configuration names one", () => {
    expect(explicitRightPanelWidth({}, {})).toBeUndefined();
    expect(explicitRightPanelWidth({ H2A_RIGHT_PANEL_WIDTH: "44" }, {})).toBe(44);
    expect(explicitRightPanelWidth({}, { rightPanel: { width: 50 } })).toBe(50);
    expect(explicitRightPanelWidth({ H2A_RIGHT_PANEL_WIDTH: "5" }, {})).toBe(RIGHT_PANEL_MIN_WIDTH);
    // The attach panel keeps its fixed default.
    expect(resolveRightPanelWidth({}, {})).toBe(RIGHT_PANEL_DEFAULT_WIDTH);
  });

  it("should follow the terminal in automatic mode and keep a fixed width otherwise", () => {
    const out = new FakeOut();
    out.columns = 200;
    const auto = new RightPanelController({ stdout: out, snapshot: fixtureSnapshot(), autoWidth: true });
    auto.setOpen(true);
    expect(auto.width()).toBe(60);
    expect(auto.childCols(200)).toBe(140);
    out.columns = 120;
    expect(auto.width()).toBe(36);
    const fixed = new RightPanelController({ stdout: out, snapshot: fixtureSnapshot(), width: 40, autoWidth: true });
    out.columns = 200;
    expect(fixed.width()).toBe(40);
  });

  it("should resize with + and - when the panel has the keyboard, inside the bounds", () => {
    const out = new FakeOut();
    out.columns = 200;
    const panel = new RightPanelController({ stdout: out, snapshot: fixtureSnapshot(), autoWidth: true, resizable: true });
    panel.setOpen(true, { focus: true });
    const wider = panel.handleInput("+", INPUT);
    expect(wider.actions).toEqual([{ type: "resize-panel", width: 60 + RIGHT_PANEL_WIDTH_STEP }]);
    expect(panel.width()).toBe(64);
    const narrower = panel.handleInput("--", INPUT);
    expect(narrower.actions.map((a) => a.type)).toEqual(["resize-panel", "resize-panel"]);
    expect(panel.width()).toBe(56);
    // Lower bound, then upper bound (the session keeps 40 columns).
    for (let i = 0; i < 40; i += 1) panel.handleInput("-", INPUT);
    expect(panel.width()).toBe(RIGHT_PANEL_MIN_WIDTH);
    expect(panel.handleInput("-", INPUT).actions).toEqual([]);
    for (let i = 0; i < 80; i += 1) panel.handleInput("+", INPUT);
    expect(panel.width()).toBe(RIGHT_PANEL_ADJUST_MAX_WIDTH);
    out.columns = 150;
    expect(panel.width()).toBe(150 - RIGHT_PANEL_MIN_CHILD_COLS);
  });

  it("should ignore + and - on a panel that is not resizable (attach)", () => {
    const out = new FakeOut();
    const panel = new RightPanelController({ stdout: out, snapshot: fixtureSnapshot() });
    panel.setOpen(true, { focus: true });
    expect(panel.handleInput("+", INPUT).actions).toEqual([]);
    expect(panel.width()).toBe(RIGHT_PANEL_DEFAULT_WIDTH);
  });

  it("should resize from the footer buttons with the mouse", () => {
    const out = new FakeOut();
    out.columns = 200;
    const panel = new RightPanelController({
      stdout: out, snapshot: fixtureSnapshot(), autoWidth: true, resizable: true, isStatusBarActive: () => false,
    });
    panel.setOpen(true);
    panel.paint();
    const footer = paintedRows(out).get(out.rows)!;
    expect(footer.trimEnd().endsWith("[-] [+]")).toBe(true);
    // `[+]` is the last three columns of the terminal, `[-]` the three before the gap.
    const plus = panel.handleInput(click(199, out.rows), INPUT);
    expect(plus.actions).toEqual([{ type: "resize-panel", width: 64 }]);
    const minus = panel.handleInput(click(200 - 6, out.rows), INPUT);
    expect(minus.actions).toEqual([{ type: "resize-panel", width: 60 }]);
    // The view tokens of the footer still answer.
    const mark = out.chunks.length;
    panel.paint();
    const footerNow = paintedRows(out, mark).get(out.rows)!;
    const dCol = 200 - 60 + 1 + footerNow.indexOf("/d");
    expect(panel.handleInput(click(dCol, out.rows), INPUT).actions).toEqual([
      { type: "select-view", view: "decisions" },
    ]);
  });
});

describe("station panel click: one click switches, the help says so", () => {
  it("should activate a session on its first click when the station asks for it", () => {
    const out = new FakeOut();
    const panel = new RightPanelController({
      stdout: out, snapshot: fixtureSnapshot(), clickActivates: true, isStatusBarActive: () => false,
    });
    panel.setOpen(true);
    panel.paint();
    const row = rowOf(out, "beta");
    const result = panel.handleInput(click(out.columns - 5, row), INPUT);
    expect(result.actions).toEqual([{ type: "activate-session", index: 1, sessionId: "s-blocked" }]);
    expect(panel.selectedSessionIndex()).toBe(1);
  });

  it("should keep the two-click rule without the option (attach panel unchanged)", () => {
    const out = new FakeOut();
    const panel = new RightPanelController({ stdout: out, snapshot: fixtureSnapshot(), isStatusBarActive: () => false });
    panel.setOpen(true);
    panel.paint();
    const row = rowOf(out, "beta");
    expect(panel.handleInput(click(out.columns - 5, row), INPUT).actions).toEqual([
      { type: "select-session", index: 1, sessionId: "s-blocked" },
    ]);
    expect(panel.handleInput(click(out.columns - 5, row), INPUT).actions).toEqual([
      { type: "activate-session", index: 1, sessionId: "s-blocked" },
    ]);
  });

  it("should paint the help above the footer, on at most two lines, and none on a short panel", () => {
    const out = new FakeOut();
    out.columns = 200;
    const hints = ["click: open the session", "▸: unfold", "[-] [+]: width", "F12: keyboard ↑↓ Enter", "Ctrl-\\: quit"];
    const panel = new RightPanelController({
      stdout: out, snapshot: fixtureSnapshot(), autoWidth: true, labels: { hints }, isStatusBarActive: () => false,
    });
    panel.setOpen(true);
    panel.paint();
    const rows = paintedRows(out);
    expect(rows.get(out.rows - 2)!.trimEnd()).toBe("click: open the session · ▸: unfold · [-] [+]: width");
    expect(rows.get(out.rows - 1)!.trimEnd()).toBe("F12: keyboard ↑↓ Enter · Ctrl-\\: quit");
    expect(rows.get(out.rows)!).toContain("[/s]");
    // Every painted line holds exactly the panel width.
    for (const [, text] of rows) expect(panelDisplayColumns(text)).toBe(60);

    // A narrow panel keeps the most useful hints, still on two lines at most.
    out.columns = 100;
    const mark = out.chunks.length;
    panel.paint();
    const narrow = paintedRows(out, mark);
    expect(narrow.get(out.rows - 2)!.trimEnd()).toBe("click: open the session");
    expect(narrow.get(out.rows - 1)!.trimEnd()).toBe("▸: unfold · [-] [+]: width");

    // Under 8 rows the list keeps every line.
    out.rows = 7;
    const shortMark = out.chunks.length;
    panel.paint();
    expect([...paintedRows(out, shortMark).values()].join("\n")).not.toContain("click:");
  });

  it("should keep a clicked row on its painted line when help lines are shown", () => {
    const out = new FakeOut();
    const panel = new RightPanelController({
      stdout: out, snapshot: fixtureSnapshot(), clickActivates: true,
      labels: { hints: ["click: open"] }, isStatusBarActive: () => false,
    });
    panel.setOpen(true);
    panel.paint();
    // The help line itself is inert.
    const helpRow = rowOf(out, "click: open");
    expect(panel.handleInput(click(out.columns - 5, helpRow), INPUT).actions).toEqual([]);
    expect(panel.handleInput(click(out.columns - 5, rowOf(out, "alpha")), INPUT).actions).toEqual([
      { type: "activate-session", index: 0, sessionId: "s-current" },
    ]);
  });
});

describe("station restorable list: useful rows first, scans folded and counted", () => {
  const relaunch = { args: ["run"], env: [], cwd: "/src/x" } as const;
  function noisyRows(): RightPanelRestorableRow[] {
    const rows: RightPanelRestorableRow[] = [
      { key: "registry:blocked", label: "blocked", reason: "unresolved-conversation", state: "ended" },
    ];
    for (let i = 0; i < 300; i += 1) {
      rows.push({ key: `scan:graphify:${i}`, label: "graphify", reason: "unclassified-scan", state: "ended" });
    }
    rows.push({ key: "registry:muse", label: "muse", reason: "launch", state: "queued", relaunch });
    for (let i = 0; i < 40; i += 1) {
      rows.push({ key: `scan:h2a:${i}`, label: "h2a/tmp/wt", reason: "unclassified-scan", state: "ended" });
    }
    rows.push({ key: "registry:capped", label: "capped", reason: "launch-cap", state: "deferred", relaunch });
    rows.push({ key: "scan:solo", label: "solo", reason: "per-project-scan-cap", state: "ended" });
    return rows;
  }
  function noisySnapshot(): RightPanelSnapshot {
    return buildRightPanelSnapshot({
      currentSessionId: "s-current",
      groups: [
        {
          title: "core",
          sessions: [{ id: "s-current", label: "alpha", status: "running" }],
          restorable: noisyRows(),
          restorableHeader: "3 restorable + 341 scans",
        },
      ],
      decisions: [],
    });
  }
  function noisyPanel(out: FakeOut): RightPanelController {
    out.columns = 200;
    out.rows = 40;
    const panel = new RightPanelController({
      stdout: out, snapshot: noisySnapshot(), autoWidth: true, clickActivates: true, groupRestorable: true,
      labels: { archivedHeader: (count, groups) => `${count} scans (${groups} labels) [a]` },
      isStatusBarActive: () => false,
    });
    panel.setOpen(true, { focus: true });
    panel.paint();
    return panel;
  }

  it("should tell a row worth a line from a scan without any gesture", () => {
    const rows = noisyRows();
    expect(isUsefulRestorableRow(rows.find((r) => r.key === "registry:muse")!)).toBe(true);
    expect(isUsefulRestorableRow(rows.find((r) => r.key === "registry:blocked")!)).toBe(true);
    expect(isUsefulRestorableRow(rows.find((r) => r.key === "scan:solo")!)).toBe(false);
    expect(isUsefulRestorableRow({ key: "scan:f", label: "f", reason: "unclassified-scan", state: "failed" })).toBe(true);
  });

  it("should put the relaunchable rows first and fold 341 scans into 3 counted groups", () => {
    const grouped = groupRestorableRows(noisyRows());
    expect(grouped.useful.map((row) => row.key)).toEqual(["registry:muse", "registry:capped", "registry:blocked"]);
    expect(grouped.archivedCount).toBe(341);
    expect(grouped.archivedGroups.map((row) => row.label)).toEqual(["graphify ×300", "h2a/tmp/wt ×40", "solo"]);
    expect(grouped.archivedGroups.every((row) => row.relaunch === undefined)).toBe(true);
    // The place of a row never depends on the state of its relaunch.
    const moved = noisyRows().map((row) =>
      row.key === "registry:capped" ? { ...row, state: "launching" as const } : row,
    );
    expect(groupRestorableRows(moved).useful.map((row) => row.key)).toEqual(grouped.useful.map((row) => row.key));
  });

  it("should stay collapsed by default, then show 3 rows and one folded line instead of 344", () => {
    const out = new FakeOut();
    const panel = noisyPanel(out);
    const collapsed = [...paintedRows(out).values()].join("\n");
    expect(collapsed).toContain("▸ 3 restorable + 341 scans");
    expect(collapsed).not.toContain("graphify");
    expect(collapsed).not.toContain("muse");

    const mark = out.chunks.length;
    panel.handleInput(click(150, rowOf(out, "3 restorable")), INPUT);
    const open = [...paintedRows(out, mark).values()].map((line) => line.trimEnd()).filter((line) => line !== "");
    expect(open).toEqual([
      "[core]",
      "●  alpha",
      "  ▾ 3 restorable + 341 scans",
      "    · muse (queued)",
      "    · capped (launch-cap · deferred)",
      "    · blocked (ended · unresolved-conversation)",
      "    ▸ 341 scans (3 labels) [a]",
      "[/s] /d /t",
    ]);
  });

  it("should unfold the scans with a click or the a key, one line per label with its count", () => {
    const out = new FakeOut();
    const panel = noisyPanel(out);
    panel.handleInput(click(150, rowOf(out, "3 restorable")), INPUT);
    let mark = out.chunks.length;
    const unfolded = panel.handleInput(click(150, rowOf(out, "341 scans (")), INPUT);
    expect(unfolded.actions).toEqual([{ type: "toggle-restorable-archive", tab: "core", expanded: true }]);
    const lines = [...paintedRows(out, mark).values()].map((line) => line.trimEnd());
    expect(lines).toContain("    ▾ 341 scans (3 labels) [a]");
    expect(lines).toContain("      · graphify ×300 (ended · unclassified-scan)");
    expect(lines).toContain("      · h2a/tmp/wt ×40 (ended · unclassified-scan)");
    expect(lines).toContain("      · solo (ended · per-project-scan-cap)");
    expect(lines.filter((line) => line.includes("graphify"))).toHaveLength(1);

    mark = out.chunks.length;
    expect(panel.handleInput("a", INPUT).actions).toEqual([
      { type: "toggle-restorable-archive", tab: "core", expanded: false },
    ]);
    expect([...paintedRows(out, mark).values()].join("\n")).not.toContain("graphify");
  });

  it("should offer the gesture of a relaunchable row on one click, and none on a folded scan", () => {
    const out = new FakeOut();
    const panel = noisyPanel(out);
    panel.handleInput(click(150, rowOf(out, "3 restorable")), INPUT);
    let mark = out.chunks.length;
    panel.paint();
    expect(panel.handleInput(click(150, rowOf(out, "capped", mark)), INPUT).actions).toEqual([
      { type: "activate-restorable-row", key: "registry:capped" },
    ]);
    panel.handleInput(click(150, rowOf(out, "341 scans (", mark)), INPUT);
    mark = out.chunks.length;
    panel.paint();
    expect(panel.handleInput(click(150, rowOf(out, "graphify ×300", mark)), INPUT).actions).toEqual([]);
  });

  it("should walk the useful rows with the keyboard and activate the one under the cursor", () => {
    const out = new FakeOut();
    const panel = noisyPanel(out);
    // alpha → expander → open it → muse → capped → Enter.
    panel.handleInput("j", INPUT);
    panel.handleInput("\r", INPUT);
    panel.handleInput("jj", INPUT);
    expect(panel.handleInput("\r", INPUT).actions).toEqual([
      { type: "activate-restorable-row", key: "registry:capped" },
    ]);
    // Past the last useful row the cursor stops while the scans are folded.
    panel.handleInput("jjjj", INPUT);
    expect(panel.handleInput("\r", INPUT).actions).toEqual([]);
  });

  it("should keep the plain uncapped list without the option (attach panel unchanged)", () => {
    const out = new FakeOut();
    out.columns = 200;
    out.rows = 400;
    const panel = new RightPanelController({ stdout: out, snapshot: noisySnapshot(), width: 60, isStatusBarActive: () => false });
    panel.setOpen(true, { focus: true });
    panel.paint();
    const mark = out.chunks.length;
    panel.handleInput(click(150, rowOf(out, "3 restorable")), INPUT);
    const lines = [...paintedRows(out, mark).values()];
    expect(lines.filter((line) => line.includes("graphify"))).toHaveLength(300);
  });
});
