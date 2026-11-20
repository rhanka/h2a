import { describe, expect, it } from "vitest";

import {
  RIGHT_PANEL_DEFAULT_WIDTH,
  RIGHT_PANEL_TOGGLE_SEQUENCE,
  buildRightPanelSnapshot,
  decisionsFromTrackDecisions,
  parseSgrMouse,
  resolveRightPanelEnabled,
  resolveRightPanelWidth,
  rightPanelReservedCols,
  routePanelMouse,
  sessionStatusGlyph,
  RightPanelController,
  type RightPanelSnapshot,
} from "./right-panel.js";
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
  it("hides delegated sub-sessions by default and marks attention with *", () => {
    const snap = fixtureSnapshot();
    const labels = snap.workspaces.flatMap((w) => w.sessions.map((s) => s.label));
    expect(labels).toEqual(["alpha", "beta", "gamma"]);
    expect(snap.attentionCount).toBe(3);
    expect(sessionStatusGlyph("blocked").symbol).toBe("✖");
    expect(sessionStatusGlyph("question").attention).toBe(true);
    expect(sessionStatusGlyph("running").symbol).toBe("●");
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
    expect(panel.isOpen()).toBe(true);
    expect(panel.hasPanelFocus()).toBe(false);

    const plain = panel.handleInput("x", { cliMouseEnabled: false });
    expect(plain.consumed).toBe(false);
    expect(plain.forward).toBe("x");
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
