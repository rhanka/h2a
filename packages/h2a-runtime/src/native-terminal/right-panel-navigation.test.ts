import { execFile as execFileCb } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import xtermMod from "@xterm/headless";

import type { RemoteCliConfig } from "../config.js";
import type { RegistryEntry } from "../registry.js";
import {
  renderNativeStatusBarLine,
  terminalDisplayColumns,
  type NativeStatusBarSnapshot,
} from "../status-projection.js";
import type { NativeTerminalClient } from "./client.js";
import type { NativeInventory } from "./fleet.js";
import type {
  NativeTerminalControllerLease,
  NativeTerminalReplay,
  NativeTerminalSessionState,
} from "./host.js";
import { runAttach } from "./op.js";
import {
  RIGHT_PANEL_TOGGLE_SEQUENCE,
  RightPanelController,
  buildRightPanelSnapshot,
  type RightPanelAction,
  type RightPanelSnapshot,
} from "./right-panel.js";
import {
  TrackJournalCache,
  buildLiveRightPanelSnapshot,
  type SiblingBinaryTarget,
} from "./right-panel-snapshot.js";

const XtermTerminal = (
  (xtermMod as unknown as { default?: typeof xtermMod }).default ?? xtermMod
).Terminal;

const execFile = promisify(execFileCb);
const HERE = dirname(fileURLToPath(import.meta.url));
const TRACK_BIN = resolve(HERE, "../../../track/dist/cli/bin.js");

const tempDirs: string[] = [];
function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    rmSync(dir, { recursive: true, force: true });
  }
});

class FakeOut {
  columns: number;
  rows: number;
  readonly chunks: string[] = [];
  constructor(cols = 100, rows = 24) {
    this.columns = cols;
    this.rows = rows;
  }
  write(chunk: string): boolean {
    this.chunks.push(String(chunk));
    return true;
  }
  text(): string {
    return this.chunks.join("");
  }
  clear(): void {
    this.chunks.length = 0;
  }
}

class FakeInput extends EventEmitter {
  readonly isTTY = false;
  readonly resume = vi.fn();
  readonly pause = vi.fn();
  readonly setRawMode = vi.fn();
}

class FakeTtyOut extends FakeOut {
  readonly isTTY = true;
}

function writeRegistry(path: string, entries: RegistryEntry[]): void {
  mkdirSync(dirname(path), { recursive: true });
  const normalized = entries.map((e) => ({
    enrolledAt: e.enrolledAt ?? e.lastSeenAt,
    ...e,
  }));
  writeFileSync(path, JSON.stringify({ version: 1, entries: normalized }, null, 2), "utf8");
}

function makeNativeState(
  id: string,
  overrides: Partial<NativeTerminalSessionState> = {},
): NativeTerminalSessionState & { socketPath: string } {
  return {
    id,
    generation: "gen-l1",
    incarnation: 1,
    pid: process.pid,
    status: "running",
    controllerEpoch: 0,
    exit: null,
    controlled: false,
    socketPath: "/fake/host-l1.sock",
    ...overrides,
  };
}

function makeInventory(
  sessions: Array<NativeTerminalSessionState & { socketPath: string }>,
  complete = true,
): NativeInventory {
  const fakeClient = { close() {} } as unknown as NativeTerminalClient;
  const sockets = [...new Set(sessions.map((s) => s.socketPath))];
  return {
    complete,
    sessions,
    hosts: sockets.map((socketPath) => ({ socketPath, client: fakeClient })),
  };
}

async function initTrackJournal(
  repoRoot: string,
  workspace: string,
  title: string,
): Promise<{ trackDir: string; decisionId: string }> {
  const trackDir = join(repoRoot, ".track");
  mkdirSync(trackDir, { recursive: true });
  const env = { ...process.env, TRACK_ACTOR: "human:owner" };
  const execTrack = async (args: string[]) => {
    const { stdout } = await execFile(
      process.execPath,
      [TRACK_BIN, ...args, "--track-dir", trackDir],
      { cwd: repoRoot, env, timeout: 10_000 },
    );
    return stdout.trim();
  };
  await execTrack(["init"]);
  const itemOut = await execTrack([
    "item",
    "new",
    "--kind",
    "feature",
    "--title",
    `Work for ${workspace}`,
    "--workspace",
    workspace,
  ]);
  const itemId = itemOut.match(/[0-9A-HJKMNP-TV-Z]{26}/)![0]!;
  const decOut = await execTrack([
    "decision",
    "new",
    "--kind",
    "orientation",
    "--title",
    title,
    "--workspace",
    workspace,
    "--targets",
    itemId,
    "--context",
    `Context for ${workspace}`,
    "--options-json",
    JSON.stringify([
      { id: "opt-a", title: "Option A", summary: "Keep" },
      { id: "opt-b", title: "Option B", summary: "Change" },
    ]),
    "--recommendation",
    "opt-a",
    "--rationale",
    "Fixture",
  ]);
  const decisionId = decOut.match(/[0-9A-HJKMNP-TV-Z]{26}/)![0]!;
  return { trackDir, decisionId };
}

function threeTabFixture(): RightPanelSnapshot {
  return buildRightPanelSnapshot({
    currentSessionId: "s-alpha",
    groups: [
      {
        title: "core",
        sessions: [
          {
            id: "s-alpha",
            label: "alpha",
            status: "running",
            delegatedNames: ["lane-3", "lane-4"],
            delegatedChildren: [
              {
                id: "job-1",
                label: "lane-3",
                tool: "claude",
                state: "running",
                origin: "cli:h2a-delegate",
              },
              {
                id: "job-2",
                label: "lane-4",
                tool: "codex",
                state: "pending",
                origin: "mcp:h2a_run",
              },
            ],
          } as never,
          { id: "s-beta", label: "beta", status: "blocked" },
        ],
      },
      {
        title: "docs",
        sessions: [{ id: "s-gamma", label: "gamma", status: "idle" }],
      },
      {
        title: "other",
        sessions: [{ id: "s-delta", label: "delta", status: "paused" }],
      },
    ],
    decisions: [
      {
        id: "d-1",
        title: "Gateway posture",
        kind: "decision",
        outcome: "pending",
        sessionId: "s-beta",
        dossierLink: "docs/d1.md",
      },
      {
        id: "q-1",
        title: "Which base image?",
        kind: "question",
        outcome: "pending",
        sessionId: "s-gamma",
      },
    ],
  });
}

describe("PANEL L1 Étape 1 — direct tab spans, Tab/Shift+Tab parity, keyboard/mouse equivalence", () => {
  it("clicking each tab label span selects that exact tab directly (not cycling) and blank space does not switch tabs", () => {
    const out = new FakeOut(100, 24);
    const panel = new RightPanelController({
      stdout: out as unknown as NodeJS.WriteStream,
      snapshot: threeTabFixture(),
      width: 32,
    });
    panel.toggle();
    // Panel starts at column childCols + 1 = 69.
    // Row 1 renders: `[core] docs other`
    // Cols: 69..74 = `[core]`, 75 = ` `, 76..79 = `docs`, 80 = ` `, 81..85 = `other`, 86..100 = padding
    expect(panel.activeTabIndex).toBe(0);

    // Click directly on "other" (tab index 2) while on tab 0 — MUST select tab 2 directly, NOT tab 1!
    const clickOther = panel.handleInput("\x1b[<0;82;1M", { cliMouseEnabled: false });
    expect(clickOther.actions).toEqual([{ type: "select-tab", index: 2 }]);
    expect(panel.activeTabIndex).toBe(2);

    // Now row 1 renders: `core docs [other]`
    // Cols: 69..72 = `core`, 73 = ` `, 74..77 = `docs`, 78 = ` `, 79..85 = `[other]`
    // Click directly on "core" (tab index 0)
    const clickCore = panel.handleInput("\x1b[<0;70;1M", { cliMouseEnabled: false });
    expect(clickCore.actions).toEqual([{ type: "select-tab", index: 0 }]);
    expect(panel.activeTabIndex).toBe(0);

    // Click on "core" again while already on tab 0 — MUST stay on tab 0 (not cycle to 1!)
    const clickCoreAgain = panel.handleInput("\x1b[<0;71;1M", { cliMouseEnabled: false });
    expect(clickCoreAgain.actions).toEqual([{ type: "select-tab", index: 0 }]);
    expect(panel.activeTabIndex).toBe(0);

    // Click on "docs" (tab index 1)
    const clickDocs = panel.handleInput("\x1b[<0;77;1M", { cliMouseEnabled: false });
    expect(clickDocs.actions).toEqual([{ type: "select-tab", index: 1 }]);
    expect(panel.activeTabIndex).toBe(1);

    // Click trailing blank space on row 1 (col 98) — must NOT switch tabs
    const clickBlank = panel.handleInput("\x1b[<0;98;1M", { cliMouseEnabled: false });
    expect(clickBlank.actions).toEqual([]);
    expect(panel.activeTabIndex).toBe(1);
  });

  it("Tab and Shift+Tab traverse the exact same tab set as clickable tab spans", () => {
    const out = new FakeOut(100, 24);
    const panel = new RightPanelController({
      stdout: out as unknown as NodeJS.WriteStream,
      snapshot: threeTabFixture(),
      width: 32,
    });
    panel.toggle();
    const forward: number[] = [panel.activeTabIndex];
    for (let i = 0; i < 3; i += 1) {
      panel.handleInput("\t", { cliMouseEnabled: false });
      forward.push(panel.activeTabIndex);
    }
    expect(forward).toEqual([0, 1, 2, 0]);

    const backward: number[] = [panel.activeTabIndex];
    for (let i = 0; i < 3; i += 1) {
      panel.handleInput("\x1b[Z", { cliMouseEnabled: false });
      backward.push(panel.activeTabIndex);
    }
    expect(backward).toEqual([0, 2, 1, 0]);
  });

  it("keyboard-only and mouse-only walkthroughs produce the exact same L0+L1 actions", () => {
    // Keyboard-only walkthrough
    const kbOut = new FakeOut(100, 24);
    const kbPanel = new RightPanelController({
      stdout: kbOut as unknown as NodeJS.WriteStream,
      snapshot: threeTabFixture(),
      width: 32,
    });
    const kbActions: RightPanelAction[] = [];
    const kbStep = (seq: string) => {
      kbActions.push(...kbPanel.handleInput(seq, { cliMouseEnabled: false }).actions);
    };
    kbStep(RIGHT_PANEL_TOGGLE_SEQUENCE); // open
    kbStep("\t"); // tab 1 (docs)
    kbStep("\x1b[Z"); // tab 0 (core)
    kbStep(" "); // expand delegated under alpha
    kbStep(" "); // collapse delegated under alpha
    kbStep("\x1b[B"); // select beta
    kbStep("\r"); // activate beta
    kbStep("/");
    kbStep("d"); // view decisions
    kbStep("\r"); // activate decision 0 (open-link)
    kbStep("/");
    kbStep("s"); // back to sessions
    kbStep(RIGHT_PANEL_TOGGLE_SEQUENCE); // close

    // Mouse-only walkthrough of the exact same actions
    const msOut = new FakeOut(100, 24);
    const msPanel = new RightPanelController({
      stdout: msOut as unknown as NodeJS.WriteStream,
      snapshot: threeTabFixture(),
      width: 32,
    });
    const msActions: RightPanelAction[] = [];
    const msClick = (x: number, y: number) => {
      msActions.push(
        ...msPanel.handleInput(`\x1b[<0;${x};${y}M`, { cliMouseEnabled: false }).actions,
      );
    };
    msClick(100, 10); // click collapsed marker -> open
    msClick(77, 1); // click `docs` tab span -> tab 1
    msClick(70, 1); // click `core` tab span -> tab 0
    msClick(72, 3); // click `  ▸ 2 delegated` row under alpha -> expand
    msClick(72, 3); // click `  ▾ 2 delegated` row under alpha -> collapse
    msClick(72, 4); // click beta row (row 4: row 2=alpha, row 3=expander, row 4=beta) -> select beta
    msClick(72, 4); // second click on beta -> activate beta
    msClick(75, 23); // click `/d` pill on footer row (row 23 = panelRows) -> decisions view
    msClick(75, 2); // click already-selected decision 0 -> activate (open-link)
    msClick(70, 23); // click `/s` pill on footer row -> sessions view
    msClick(98, 24); // click bottom-bar toggle marker -> close

    expect(msActions).toEqual(kbActions);
  });
});

describe("PANEL L1 Étape 2 — delegated names in bottom bar & F9-provenanced expander", () => {
  it("projects F9-provenanced delegated children only under proven parent, marks unattributed as deleg ?, and never promotes sub-sessions to human rows", async () => {
    const home = makeTempDir("h2a-l1-deleg-");
    const registryPath = join(home, "registry.json");
    const h2aRoot = join(home, ".h2a");
    mkdirSync(join(h2aRoot, "presence"), { recursive: true });
    mkdirSync(join(h2aRoot, "registry"), { recursive: true });

    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const projCwd = join(home, "src", "core");
    mkdirSync(projCwd, { recursive: true });

    const entries: RegistryEntry[] = [
      {
        id: "h2a-alpha",
        tool: "claude",
        kind: "local-native",
        cwd: projCwd,
        label: "alpha",
        tmuxSession: "h2a-alpha",
        source: "run",
        sessionClass: "human",
        lastSeenAt: nowIso,
      },
      {
        id: "h2a-beta",
        tool: "codex",
        kind: "local-native",
        cwd: projCwd,
        label: "beta",
        tmuxSession: "h2a-beta",
        source: "run",
        sessionClass: "human",
        lastSeenAt: nowIso,
      },
      // Provenanced via cli:h2a-delegate (parent = h2a-alpha / inst-alpha)
      {
        id: "job-cli-1",
        tool: "claude",
        kind: "local-native",
        cwd: projCwd,
        label: "lane-3",
        tmuxSession: "h2a-lane-3",
        pid: process.pid,
        source: "run",
        role: "job",
        sessionClass: "background",
        jobState: "running",
        delegationOrigin: "cli:h2a-delegate",
        delegatorInstance: "inst-alpha",
        delegatorTmuxSession: "h2a-alpha",
        lastSeenAt: nowIso,
      },
      // Provenanced via sidecar MCP attestation (parent = h2a-alpha / inst-alpha)
      {
        id: "job-mcp-1",
        tool: "codex",
        kind: "local-native",
        cwd: projCwd,
        label: "lane-4",
        tmuxSession: "h2a-lane-4",
        pid: process.pid,
        source: "run",
        role: "job",
        sessionClass: "background",
        jobState: "running",
        lastSeenAt: nowIso,
      },
      // Unattributed background worker (NO sidecar attestation, NO cli provenance) -> MUST NOT attach or promote!
      {
        id: "job-orphan",
        tool: "claude",
        kind: "local-native",
        cwd: projCwd,
        label: "orphan-worker",
        tmuxSession: "h2a-orphan",
        pid: process.pid,
        source: "run",
        role: "job",
        sessionClass: "background",
        jobState: "running",
        delegationOrigin: "mcp:h2a_run",
        lastSeenAt: nowIso,
      },
    ];
    writeRegistry(registryPath, entries);

    // Presence records binding h2a-alpha -> inst-alpha and h2a-beta -> inst-beta
    writeFileSync(
      join(h2aRoot, "presence", "alpha.json"),
      JSON.stringify({
        sessionId: "p-alpha",
        instance: "inst-alpha",
        pid: process.pid,
        startedAt: nowIso,
        heartbeatAt: nowIso,
        state: "live",
        workStatus: "working",
        launchContext: { nativePty: { session: "h2a-alpha" } },
      }),
      "utf8",
    );
    writeFileSync(
      join(h2aRoot, "presence", "beta.json"),
      JSON.stringify({
        sessionId: "p-beta",
        instance: "inst-beta",
        pid: process.pid,
        startedAt: nowIso,
        heartbeatAt: nowIso,
        state: "live",
        launchContext: { nativePty: { session: "h2a-beta" } },
      }),
      "utf8",
    );

    // Sidecar attestation for h2a-lane-4 only (NOT for h2a-orphan)
    writeFileSync(
      join(h2aRoot, "registry", "mcp-delegations.jsonl"),
      JSON.stringify({
        version: 1,
        origin: "mcp:h2a_run",
        workerTmuxSession: "h2a-lane-4",
        workerPid: process.pid,
        delegatorInstance: "inst-alpha",
        delegatorTmuxSession: "h2a-alpha",
        recordedAt: nowIso,
      }) + "\n",
      "utf8",
    );

    const snap = await buildLiveRightPanelSnapshot({
      currentSessionId: "h2a-alpha",
      home,
      config: { layout: { groups: [{ title: "core", projects: ["core"] }] } },
      registryPath,
      h2aRoot,
      nowMs,
      collectNative: async () =>
        makeInventory([
          makeNativeState("h2a-alpha"),
          makeNativeState("h2a-beta"),
          makeNativeState("h2a-lane-3"),
          makeNativeState("h2a-lane-4"),
          makeNativeState("h2a-orphan"),
        ]),
      trackSources: [],
    });

    const coreSessions = snap.workspaces[0]!.sessions;
    // Never promote any sub-session (proven or orphan) to a top-level human row!
    expect(coreSessions.map((s) => s.id)).toEqual(["h2a-alpha", "h2a-beta"]);

    const alpha = coreSessions.find((s) => s.id === "h2a-alpha")! as unknown as {
      delegatedNames?: readonly string[];
      delegatedChildren?: readonly { label: string }[];
      delegatedDegraded?: boolean;
    };
    const beta = coreSessions.find((s) => s.id === "h2a-beta")! as unknown as {
      delegatedNames?: readonly string[];
      delegatedChildren?: readonly { label: string }[];
      delegatedDegraded?: boolean;
    };

    // Provenanced workers appear ONLY under alpha, never beta; orphan is NOT in either!
    expect(alpha.delegatedNames).toEqual(["lane-3", "lane-4"]);
    expect(alpha.delegatedChildren?.map((c) => c.label)).toEqual(["lane-3", "lane-4"]);
    expect(beta.delegatedNames ?? []).toEqual([]);
    // Unattributed orphan degrades delegation provenance (`deleg ?`)
    expect(alpha.delegatedDegraded).toBe(true);
    expect(beta.delegatedDegraded).toBe(true);

    // Panel renders expander under alpha and `deleg ?` indicator
    const out = new FakeOut(100, 24);
    const panel = new RightPanelController({
      stdout: out as unknown as NodeJS.WriteStream,
      snapshot: snap,
      width: 32,
    });
    panel.toggle();
    expect(out.text()).toContain("▸ 2 delegated");
    expect(out.text()).toContain("deleg ?");
  });

  it("renders bottom-bar delegated names with §4.4 truncation order across widths and restores byte-identical count form on deselect/close", () => {
    const base: NativeStatusBarSnapshot = {
      cli: "claude",
      sessionName: "h2a-alpha",
      linkState: "attached",
      role: "dev",
      workload: {
        j: { open: 3, attention: 0, degraded: false },
        i: { waiting: 0, degraded: false },
        l: { active: 0, attention: 0, degraded: false },
      },
      delegatedSessions: 3,
      gateway: {
        state: "active",
        clientSessionId: "h2a-alpha",
        requestedModel: "sonnet",
        upstreamModel: "gemini-4-argon",
      },
      rightPanelMarker: { enabled: true, lit: false, degraded: false },
    };

    const countBaseline140 = renderNativeStatusBarLine(base, 140);
    const countBaseline100 = renderNativeStatusBarLine(base, 100);

    const withSelected = {
      ...base,
      selectedDelegatedNames: ["worker-alpha", "worker-beta", "worker-gamma"],
    } as NativeStatusBarSnapshot;

    // 1) Wide: route token AND full delegated names both fit
    const wide = renderNativeStatusBarLine(withSelected, 150);
    expect(wide).toContain("sonnet→gemini-4-argon");
    expect(wide).toContain("deleg worker-alpha,worker-beta,worker-gamma");
    expect(terminalDisplayColumns(wide)).toBe(150);

    // 2) Medium-wide: route token drops BEFORE delegated names
    const medWide = renderNativeStatusBarLine(withSelected, 118);
    expect(medWide).not.toContain("sonnet→gemini-4-argon");
    expect(medWide).toContain("deleg worker-alpha,worker-beta,worker-gamma");
    expect(terminalDisplayColumns(medWide)).toBe(118);

    // 3) Medium: names truncate with `…` before falling back to count
    const medium = renderNativeStatusBarLine(withSelected, 94);
    expect(medium).not.toContain("sonnet→gemini-4-argon");
    expect(medium).toContain("deleg worker-alpha");
    expect(medium).toContain("…");
    expect(terminalDisplayColumns(medium)).toBe(94);

    // 4) Narrow: falls back to count `deleg 3`
    const narrow = renderNativeStatusBarLine(withSelected, 70);
    expect(narrow).toContain("deleg 3");
    expect(terminalDisplayColumns(narrow)).toBe(70);

    // 5) Provenance absent (`"unknown"`) renders `deleg ?`
    const unknownDeleg = renderNativeStatusBarLine(
      { ...base, selectedDelegatedNames: "unknown" } as NativeStatusBarSnapshot,
      120,
    );
    expect(unknownDeleg).toContain("deleg ?");

    // 6) Deselected (`selectedDelegatedNames: undefined`) is BYTE-IDENTICAL to base count rendering
    expect(
      renderNativeStatusBarLine(
        { ...base, selectedDelegatedNames: undefined } as NativeStatusBarSnapshot,
        140,
      ),
    ).toBe(countBaseline140);
    expect(
      renderNativeStatusBarLine(
        { ...base, selectedDelegatedNames: undefined } as NativeStatusBarSnapshot,
        100,
      ),
    ).toBe(countBaseline100);
  });

  it("runAttach updates bottom bar with selected session delegated names and restores byte-identical count form on Esc/close; never confuses D draft state with list/bar text", async () => {
    const dir = makeTempDir("h2a-l1-attach-bar-");
    const prevStateHome = process.env["XDG_STATE_HOME"];
    process.env["XDG_STATE_HOME"] = join(dir, "state");
    try {
      const registryPath = join(dir, "registry.json");
      const h2aRoot = join(dir, ".h2a");
      mkdirSync(join(h2aRoot, "presence"), { recursive: true });
      writeRegistry(registryPath, [
        {
          id: "h2a-alpha",
          tool: "claude",
          kind: "local-native",
          cwd: dir,
          label: "alpha",
          tmuxSession: "h2a-alpha",
          source: "run",
          sessionClass: "human",
          gatewayMode: "direct",
          gatewayProvenance: "explicit",
          lastSeenAt: "2026-11-20T10:00:00.000Z",
        },
      ]);

      const stdin = new FakeInput();
      const stdout = new FakeTtyOut(120, 24);
      let now = 1_760_000_000_000;
      let readCount = 0;
      const barLines: string[] = [];

      const snapshot = buildRightPanelSnapshot({
        currentSessionId: "h2a-alpha",
        groups: [
          {
            title: "core",
            sessions: [
              {
                id: "h2a-alpha",
                label: "alpha",
                status: "running",
                draftRecovery: "saved-for-recovery",
                draftCapability: "refused-no-draft-adapter",
                delegatedNames: ["sub-one", "sub-two"],
                delegatedChildren: [
                  {
                    id: "sub-1",
                    label: "sub-one",
                    tool: "claude",
                    state: "running",
                    origin: "cli:h2a-delegate",
                  },
                  {
                    id: "sub-2",
                    label: "sub-two",
                    tool: "codex",
                    state: "running",
                    origin: "cli:h2a-delegate",
                  },
                ],
              } as never,
            ],
          },
        ],
        decisions: [],
      });

      const captureBottomRow = async (): Promise<string> => {
        const term = new XtermTerminal({ cols: 120, rows: 24, scrollback: 0, allowProposedApi: true });
        try {
          await new Promise<void>((r) => term.write(stdout.text(), r));
          return term.buffer.active.getLine(23)?.translateToString(false) ?? "";
        } finally {
          term.dispose();
        }
      };

      const lease: NativeTerminalControllerLease = {
        role: "controller",
        id: "h2a-alpha",
        generation: "g-l1",
        incarnation: 1,
        controllerId: "ctrl-l1",
        epoch: 1,
      };
      const client: Pick<
        NativeTerminalClient,
        "readOutput" | "state" | "acquireController" | "releaseController" | "write" | "resize" | "close"
      > = {
        async acquireController() { return lease; },
        async releaseController() { return { controlled: false, controllerEpoch: 1 }; },
        async readOutput(): Promise<NativeTerminalReplay> {
          readCount += 1;
          if (readCount === 1) {
            return { id: "h2a-alpha", earliestSeq: 1, latestSeq: 1, truncated: false, chunks: [{ seq: 1, data: "ready\r\n" }] };
          }
          if (readCount === 2) {
            barLines.push(await captureBottomRow()); // [0] initial collapsed
            stdin.emit("data", Buffer.from(RIGHT_PANEL_TOGGLE_SEQUENCE)); // open (selects alpha)
            return { id: "h2a-alpha", earliestSeq: 1, latestSeq: 1, truncated: false, chunks: [] };
          }
          if (readCount === 3) {
            barLines.push(await captureBottomRow()); // [1] open & selected -> delegated names shown
            stdin.emit("data", Buffer.from("\x1b")); // Esc -> deselect / return focus to CLI
            now += 50;
            return { id: "h2a-alpha", earliestSeq: 1, latestSeq: 1, truncated: false, chunks: [] };
          }
          if (readCount === 4) {
            barLines.push(await captureBottomRow()); // [2] after Esc deselect -> restored to count
            stdin.emit("data", Buffer.from(RIGHT_PANEL_TOGGLE_SEQUENCE)); // close panel
            return { id: "h2a-alpha", earliestSeq: 1, latestSeq: 1, truncated: false, chunks: [] };
          }
          if (readCount === 5) {
            barLines.push(await captureBottomRow()); // [3] after close -> restored to count
            stdin.emit("data", Buffer.from([0x1c]));
          }
          return { id: "h2a-alpha", earliestSeq: 1, latestSeq: 1, truncated: false, chunks: [] };
        },
        async state() {
          return {
            id: "h2a-alpha",
            pid: 4242,
            status: "running",
            exit: null,
            generation: "g-l1",
            incarnation: 1,
            controllerEpoch: 1,
            controlled: true,
          };
        },
        async write() {},
        async resize() {},
        close() {},
      };

      const code = await runAttach(
        "h2a-alpha",
        {
          connect: async () => client,
          stdin: stdin as unknown as NodeJS.ReadStream,
          stdout: stdout as unknown as NodeJS.WriteStream,
          now: () => now,
          delay: async (ms) => { now += ms; },
          onResize: () => {},
          offResize: () => {},
        },
        {
          statusBar: { enabled: true, env: {}, registryPath, h2aRoot },
          rightPanel: { enabled: true, width: 32, snapshot },
        },
      );
      expect(code).toBe(0);
      expect(barLines).toHaveLength(4);
      // Selected bar shows delegated names and NEVER leaks D draft state into bar text
      expect(barLines[1]).toContain("deleg sub-one,sub-two");
      expect(barLines[1]).not.toContain("saved-for-recovery");
      expect(barLines[1]).not.toContain("refused-no-draft-adapter");
      // Deselected (Esc) and closed bars are BYTE-IDENTICAL to initial collapsed count bar!
      expect(barLines[2]).toBe(barLines[0]);
      expect(barLines[3]).toBe(barLines[0]);
    } finally {
      if (prevStateHome === undefined) delete process.env["XDG_STATE_HOME"];
      else process.env["XDG_STATE_HOME"] = prevStateHome;
    }
  });
});

describe("PANEL L1 Étape 3 — multi-store Track citations, isolated degradation, h2a-message questions, zero writes", () => {
  it("aggregates multi-project Track journals with per-project citation, keeps others intact when one store is unreadable, includes h2a inbox questions, and performs zero writes", async () => {
    const home = makeTempDir("h2a-l1-multistore-");
    const registryPath = join(home, "registry.json");
    const h2aRoot = join(home, ".h2a");
    mkdirSync(join(h2aRoot, "presence"), { recursive: true });
    mkdirSync(join(h2aRoot, "inbox", "owner"), { recursive: true });
    mkdirSync(join(h2aRoot, "inbox", "inst-alpha"), { recursive: true });

    const repoA = join(home, "src", "repo-a");
    const repoB = join(home, "src", "repo-b");
    const repoBroken = join(home, "src", "repo-broken");
    const wtA = join(repoA, "tmp", "worktrees", "wt-a");
    mkdirSync(repoA, { recursive: true });
    mkdirSync(repoB, { recursive: true });
    mkdirSync(repoBroken, { recursive: true });
    mkdirSync(wtA, { recursive: true });

    // Real git-like main checkout + linked worktree for repoA
    const wtGitDir = join(repoA, ".git", "worktrees", "wt-a");
    mkdirSync(wtGitDir, { recursive: true });
    writeFileSync(join(wtGitDir, "commondir"), "../..\n", "utf8");
    writeFileSync(join(wtA, ".git"), `gitdir: ${wtGitDir}\n`, "utf8");
    mkdirSync(join(repoB, ".git"), { recursive: true });
    mkdirSync(join(repoBroken, ".git"), { recursive: true });

    const [jA, jB] = await Promise.all([
      initTrackJournal(repoA, "repo-a", "Decision from repo A"),
      initTrackJournal(repoB, "repo-b", "Decision from repo B"),
    ]);
    const statABefore = statSync(join(jA.trackDir, "events.jsonl"));
    const statBBefore = statSync(join(jB.trackDir, "events.jsonl"));

    // Write a stale fake worktree .track inside wtA to prove the reader NEVER uses it!
    mkdirSync(join(wtA, ".track"), { recursive: true });
    writeFileSync(join(wtA, ".track", "events.jsonl"), "STALE_WORKTREE\n", "utf8");

    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();

    writeRegistry(registryPath, [
      {
        id: "h2a-a",
        tool: "claude",
        kind: "local-native",
        cwd: wtA,
        label: "wt-alpha",
        tmuxSession: "h2a-a",
        source: "run",
        sessionClass: "human",
        lastSeenAt: nowIso,
      },
      {
        id: "h2a-b",
        tool: "codex",
        kind: "local-native",
        cwd: repoB,
        label: "beta",
        tmuxSession: "h2a-b",
        source: "run",
        sessionClass: "human",
        lastSeenAt: nowIso,
      },
      {
        id: "h2a-broken",
        tool: "claude",
        kind: "local-native",
        cwd: repoBroken,
        label: "broken",
        tmuxSession: "h2a-broken",
        source: "run",
        sessionClass: "human",
        lastSeenAt: nowIso,
      },
    ]);

    writeFileSync(
      join(h2aRoot, "presence", "a.json"),
      JSON.stringify({
        sessionId: "p-a",
        instance: "inst-alpha",
        pid: process.pid,
        startedAt: nowIso,
        heartbeatAt: nowIso,
        state: "live",
        launchContext: { nativePty: { session: "h2a-a" } },
      }),
      "utf8",
    );

    // h2a-message question sources: escalate envelope + owner-addressed question envelope
    writeFileSync(
      join(h2aRoot, "inbox", "inst-alpha", "esc-1.json"),
      JSON.stringify({
        protocol: "sentropic.h2a",
        version: "0.1",
        id: "env-esc-1",
        type: "escalate",
        actor: { instance: "inst-alpha", role: "AGENTS", scope: "repo-a" },
        body: { channel: "decide", payload: { question: "Approve migration cutoff?" } },
        createdAt: "2026-11-20T09:00:00.000Z",
      }),
      "utf8",
    );
    writeFileSync(
      join(h2aRoot, "inbox", "owner", "q-1.json"),
      JSON.stringify({
        protocol: "sentropic.h2a",
        version: "0.1",
        id: "env-q-1",
        type: "event",
        actor: { instance: "inst-alpha", role: "CONDUCTOR", scope: "repo-a" },
        target: { instance: "owner", role: "PRINCIPAL" },
        body: { kind: "question", question: "Confirm release channel?" },
        createdAt: "2026-11-20T08:00:00.000Z",
      }),
      "utf8",
    );

    const realTarget: SiblingBinaryTarget = {
      command: process.execPath,
      prefixArgs: [TRACK_BIN],
    };
    const cache = new TrackJournalCache({ target: realTarget });

    const snap = await buildLiveRightPanelSnapshot({
      currentSessionId: "h2a-a",
      home,
      config: {
        layout: {
          groups: [{ title: "fleet", projects: ["repo-a", "repo-b", "repo-broken"] }],
        },
      },
      registryPath,
      h2aRoot,
      nowMs,
      collectNative: async () =>
        makeInventory([
          makeNativeState("h2a-a"),
          makeNativeState("h2a-b"),
          makeNativeState("h2a-broken"),
        ]),
      trackCache: cache,
    });

    // 1) Both readable Track projects survive with journal-of-record citations (linked worktree cites repoA/.track!)
    const decA = snap.decisions.find((d) => d.id === jA.decisionId) as unknown as {
      title: string;
      journalOfRecord?: string;
      project?: string;
    };
    const decB = snap.decisions.find((d) => d.id === jB.decisionId) as unknown as {
      title: string;
      journalOfRecord?: string;
      project?: string;
    };
    expect(decA).toBeDefined();
    expect(decA.journalOfRecord).toBe(jA.trackDir);
    expect(decB).toBeDefined();
    expect(decB.journalOfRecord).toBe(jB.trackDir);

    // 2) Unreadable project recorded in per-project decisionsDegraded (NOT silently erased!)
    const degradedList = (
      snap as unknown as {
        decisionsDegraded?: readonly { project: string; trackDir: string; reason: string }[];
      }
    ).decisionsDegraded;
    expect(degradedList?.some((d) => d.project === "repo-broken")).toBe(true);
    expect(snap.degraded).toBe(true);

    // 3) h2a-message questions appear as kind="question", source="h2a-message", ordered after decisions, oldest first
    const msgQuestions = snap.decisions.filter(
      (d) => (d as unknown as { source?: string }).source === "h2a-message",
    );
    expect(msgQuestions.map((q) => q.id)).toEqual(["env-q-1", "env-esc-1"]);
    expect(msgQuestions.every((q) => q.kind === "question")).toBe(true);
    expect(msgQuestions[0]!.sessionId).toBe("h2a-a");

    // 4) Decisions render before questions, plus per-project `decisions unknown (?)` line
    const out = new FakeOut(100, 24);
    const panel = new RightPanelController({
      stdout: out as unknown as NodeJS.WriteStream,
      snapshot: snap,
      width: 40,
    });
    panel.toggle();
    panel.handleInput("/d", { cliMouseEnabled: false });
    const rendered = out.text();
    expect(rendered).toContain("Decision from repo A");
    expect(rendered).toContain("Decision from repo B");
    expect(rendered).toContain("Confirm release channel?");
    expect(rendered).toContain("repo-broken");
    expect(rendered).toContain("unknown (?)");

    // 5) Zero writes on Track journals
    expect(statSync(join(jA.trackDir, "events.jsonl")).size).toBe(statABefore.size);
    expect(statSync(join(jA.trackDir, "events.jsonl")).mtimeMs).toBe(statABefore.mtimeMs);
    expect(statSync(join(jB.trackDir, "events.jsonl")).size).toBe(statBBefore.size);
    expect(statSync(join(jB.trackDir, "events.jsonl")).mtimeMs).toBe(statBBefore.mtimeMs);
  }, 20_000);
});

describe("PANEL L1 Étape 4 — bounded wheel scrolling (3/notch, 0 leak) & wide/ambiguous glyph accounting", () => {
  it("wheel scrolls panel list 3 rows/notch, clamps at bounds, shifts hit-testing, and leaks zero bytes to non-subscribed CLI", () => {
    const sessions = Array.from({ length: 20 }, (_, i) => ({
      id: `s-${i}`,
      label: `sess-${String(i).padStart(2, "0")}`,
      status: "running" as const,
    }));
    const snap = buildRightPanelSnapshot({
      currentSessionId: "s-0",
      groups: [{ title: "fleet", sessions }],
      decisions: [],
    });

    // rows=12, bar active -> panelRows=11, row 1=tabs, row 11=footer -> viewport=9 rows; maxScroll = 20 - 9 = 11
    const out = new FakeOut(100, 12);
    const panel = new RightPanelController({
      stdout: out as unknown as NodeJS.WriteStream,
      snapshot: snap,
      width: 32,
    });
    panel.toggle();
    out.clear();

    // Wheel down notch 1: offset 0 -> 3
    const down1 = panel.handleInput("\x1b[<65;80;5M", { cliMouseEnabled: false });
    expect(down1.consumed).toBe(true);
    expect(down1.forwardBytes).toBeUndefined();
    expect((panel as unknown as { scrollOffset(): number }).scrollOffset()).toBe(3);

    // Click row 2 (first visible list row) -> must select sess-03 (index 3), NOT sess-00!
    const clickScrolled = panel.handleInput("\x1b[<0;80;2M", { cliMouseEnabled: false });
    expect(clickScrolled.actions).toEqual([
      { type: "select-session", index: 3, sessionId: "s-3" },
    ]);

    // Scroll past bottom -> clamps at maxScroll = 11
    for (let i = 0; i < 10; i += 1) {
      panel.handleInput("\x1b[<65;80;5M", { cliMouseEnabled: false });
    }
    expect((panel as unknown as { scrollOffset(): number }).scrollOffset()).toBe(11);

    // Wheel up -> steps by 3 (11 -> 8), then clamps at 0
    panel.handleInput("\x1b[<64;80;5M", { cliMouseEnabled: false });
    expect((panel as unknown as { scrollOffset(): number }).scrollOffset()).toBe(8);
    for (let i = 0; i < 10; i += 1) {
      panel.handleInput("\x1b[<64;80;5M", { cliMouseEnabled: false });
    }
    expect((panel as unknown as { scrollOffset(): number }).scrollOffset()).toBe(0);

    // Wheel over CLI zone when CLI did NOT subscribe -> ZERO bytes forwarded
    const cliWheelUnsub = panel.handleInput("\x1b[<65;10;5M", {
      cliMouseEnabled: false,
      cliMouseMode: null,
    });
    expect(cliWheelUnsub.consumed).toBe(true);
    expect(cliWheelUnsub.forwardBytes).toBeUndefined();

    // Wheel over bottom bar -> ignored, ZERO bytes forwarded
    const barWheel = panel.handleInput("\x1b[<65;20;12M", {
      cliMouseEnabled: true,
      cliMouseMode: 1000,
      cliMouseEncoding: "sgr",
    });
    expect(barWheel.consumed).toBe(true);
    expect(barWheel.forwardBytes).toBeUndefined();
  });

  it("accounts wide/combining glyphs identically to F6 terminalDisplayColumns and falls back to stable text (`||` for paused) when width oracle disagrees", async () => {
    const snap = buildRightPanelSnapshot({
      currentSessionId: "s-1",
      groups: [
        {
          title: "café",
          sessions: [
            { id: "s-1", label: "a\u0301-中文-session", status: "paused" },
            { id: "s-2", label: "beta-wide-中", status: "running" },
          ],
        },
      ],
      decisions: [],
    });

    // 1) Normal terminal oracle (agrees with F6): rendered rows fit exact panel width in @xterm/headless
    const out1 = new FakeOut(100, 14);
    const panel1 = new RightPanelController({
      stdout: out1 as unknown as NodeJS.WriteStream,
      snapshot: snap,
      width: 24,
    });
    panel1.toggle();
    // Ensure no alternate-screen mode switch (OQ-18(b) is evaluation-only in L1!)
    expect(out1.text()).not.toContain("\x1b[?1049h");

    const term = new XtermTerminal({ cols: 100, rows: 14, scrollback: 0, allowProposedApi: true });
    try {
      await new Promise<void>((r) => term.write(out1.text(), r));
      // Row 2 (index 1) has paused glyph + combining accent + CJK; cursor must never wrap past col 100
      const line1 = term.buffer.active.getLine(1)?.translateToString(false, 76, 100) ?? "";
      expect(line1).toContain("⏸");
      expect(terminalDisplayColumns(line1)).toBe(24);
    } finally {
      term.dispose();
    }

    // 2) Disagreement oracle: fixture terminal reports `⏸` as width 2 (disagreeing with F6 = 1)
    //    -> MUST fall back to stable text `||` (PANEL §10) and keep exact 24-column width!
    const out2 = new FakeOut(100, 14);
    const panel2 = new RightPanelController({
      stdout: out2 as unknown as NodeJS.WriteStream,
      snapshot: snap,
      width: 24,
      glyphWidthOracle: (g: string) => (g === "⏸" ? 2 : terminalDisplayColumns(g)),
    } as never);
    panel2.toggle();
    const raw2 = out2.text();
    expect(raw2).toContain("||");
    expect(raw2).not.toContain("⏸");

    const term2 = new XtermTerminal({ cols: 100, rows: 14, scrollback: 0, allowProposedApi: true });
    try {
      await new Promise<void>((r) => term2.write(raw2, r));
      const line1Fallback = term2.buffer.active.getLine(1)?.translateToString(false, 76, 100) ?? "";
      expect(line1Fallback).toContain("||");
      expect(terminalDisplayColumns(line1Fallback)).toBe(24);
    } finally {
      term2.dispose();
    }
  });
});
