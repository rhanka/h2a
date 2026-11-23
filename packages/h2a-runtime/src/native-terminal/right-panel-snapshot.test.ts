import { execFile as execFileCb } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

import type { RemoteCliConfig } from "../config.js";
import type { RegistryEntry } from "../registry.js";
import type { NativeInventory } from "./fleet.js";
import type { NativeTerminalClient } from "./client.js";
import type { NativeTerminalSessionState } from "./host.js";
import {
  RightPanelSnapshotRefresher,
  TrackJournalCache,
  TranscriptScanCache,
  buildLiveRightPanelSnapshot,
  resolveJournalOfRecord,
  type SiblingBinaryTarget,
  type SiblingExecFn,
} from "./right-panel-snapshot.js";

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
    generation: "gen-1",
    incarnation: "inc-1",
    pid: process.pid,
    status: "running",
    latestSeq: 1,
    exit: null,
    stopSignal: null,
    controlled: false,
    socketPath: "/fake/host-1.sock",
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

async function runTrackFixture(
  trackDir: string,
  args: string[],
  cwd: string,
): Promise<string> {
  const { stdout } = await execFile(
    process.execPath,
    [TRACK_BIN, ...args, "--track-dir", trackDir],
    { cwd, timeout: 10_000 },
  );
  return stdout;
}

async function initTrackJournalWithRealEvents(repoRoot: string): Promise<{
  trackDir: string;
  decisionWithArtifactId: string;
  decisionWithItemLinkId: string;
  deferredDecisionId: string;
  settledDecisionId: string;
}> {
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
  const item1Out = await execTrack([
    "item",
    "new",
    "--kind",
    "feature",
    "--title",
    "Target item with spec link",
    "--workspace",
    "core",
    "--accountable",
    "h2a-beta",
  ]);
  const item1Id = item1Out.match(/[0-9A-HJKMNP-TV-Z]{26}/)![0]!;
  await execTrack([
    "item",
    "link",
    item1Id,
    "--kind",
    "spec",
    "--locator",
    "docs/specs/item1-spec.md",
  ]);

  const optionsJson = JSON.stringify([
    { id: "opt-a", title: "Option A", summary: "Keep async sibling CLI" },
    { id: "opt-b", title: "Option B", summary: "Bundle directly" },
  ]);

  // Decision 1: pending, has rendered-view artifact (priority over item links) + claude.ai artifact
  const d1Out = await execTrack([
    "decision",
    "new",
    "--kind",
    "orientation",
    "--title",
    "Use async Track binary",
    "--workspace",
    "core",
    "--targets",
    item1Id,
    "--context",
    "Compare OQ-19 options",
    "--options-json",
    optionsJson,
    "--recommendation",
    "opt-a",
    "--rationale",
    "Preserves closed package payload",
  ]);
  const d1Id = d1Out.match(/[0-9A-HJKMNP-TV-Z]{26}/)![0]!;
  await execTrack([
    "decision",
    "add-artifact",
    d1Id,
    "--kind",
    "rendered-view",
    "--view-ref",
    "docs/dossiers/d1.md",
  ]);

  // Decision 2: pending, NO artifact on decision itself -> falls back to DECIDES target item links[] + RACI
  const d2Out = await execTrack([
    "decision",
    "new",
    "--kind",
    "commitment",
    "--title",
    "Follow item spec link",
    "--workspace",
    "core",
    "--targets",
    item1Id,
    "--context",
    "Uses target item link",
    "--options-json",
    optionsJson,
    "--recommendation",
    "opt-a",
    "--rationale",
    "Fallback to target item links",
  ]);
  const d2Id = d2Out.match(/[0-9A-HJKMNP-TV-Z]{26}/)![0]!;

  // Decision 3: deferred, chat: artifact (not openable)
  const d3Out = await execTrack([
    "decision",
    "new",
    "--kind",
    "orientation",
    "--title",
    "Deferred choice",
    "--workspace",
    "core",
    "--targets",
    item1Id,
    "--context",
    "Deferred context",
    "--options-json",
    optionsJson,
    "--recommendation",
    "opt-a",
    "--rationale",
    "Later",
  ]);
  const d3Id = d3Out.match(/[0-9A-HJKMNP-TV-Z]{26}/)![0]!;
  await execTrack([
    "decision",
    "add-artifact",
    d3Id,
    "--kind",
    "rendered-view",
    "--view-ref",
    "chat:thread-42",
  ]);
  await execTrack(["decision", "outcome", d3Id, "deferred"]);

  // Decision 4: settled (go) -> MUST be excluded
  const d4Out = await execTrack([
    "decision",
    "new",
    "--kind",
    "orientation",
    "--title",
    "Settled choice",
    "--workspace",
    "core",
    "--targets",
    item1Id,
    "--context",
    "Already decided",
    "--options-json",
    optionsJson,
    "--recommendation",
    "opt-a",
    "--rationale",
    "Done",
  ]);
  const d4Id = d4Out.match(/[0-9A-HJKMNP-TV-Z]{26}/)![0]!;
  await execTrack(["decision", "select", d4Id, "opt-a", "--outcome", "go"]);

  return {
    trackDir,
    decisionWithArtifactId: d1Id,
    decisionWithItemLinkId: d2Id,
    deferredDecisionId: d3Id,
    settledDecisionId: d4Id,
  };
}

describe("right-panel-snapshot — Étape 1/3/4/5 live projection & Track cache (02-L0.5a)", () => {
  it("projects 15 sessions in one explicit group (uncapped) + 3 ungrouped projects in stable 'other' tab, excluding delegated", async () => {
    const home = makeTempDir("h2a-panel-snap-");
    const registryPath = join(home, "registry.json");
    const h2aRoot = join(home, ".h2a");
    mkdirSync(join(h2aRoot, "presence"), { recursive: true });

    const entries: RegistryEntry[] = [];
    const nativeStates: Array<NativeTerminalSessionState & { socketPath: string }> = [];

    // 15 live human sessions in project "core" (exceeds restore's maxPerWindow=12!)
    for (let i = 1; i <= 15; i += 1) {
      const id = `h2a-core-${String(i).padStart(2, "0")}`;
      const cwd = join(home, "src", "core");
      mkdirSync(cwd, { recursive: true });
      entries.push({
        id,
        tool: "claude",
        kind: "local-native",
        cwd,
        label: `core-${String(i).padStart(2, "0")}`,
        tmuxSession: id,
        source: "run",
        sessionClass: "human",
        lastSeenAt: new Date(1_700_000_000_000 + i * 1_000).toISOString(),
      });
      nativeStates.push(makeNativeState(id, { controlled: i === 2 }));
    }

    // 1 delegated background job in "core" -> MUST NOT appear in top-level sessions
    entries.push({
      id: "h2a-core-job-1",
      tool: "claude",
      kind: "local-native",
      cwd: join(home, "src", "core"),
      label: "worker-delegated",
      tmuxSession: "h2a-core-job-1",
      source: "run",
      role: "job",
      delegationOrigin: "mcp:h2a_run",
      delegatorInstance: "inst-core-1",
      lastSeenAt: new Date(1_700_000_099_000).toISOString(),
    });
    nativeStates.push(makeNativeState("h2a-core-job-1"));

    // 3 ungrouped projects with varying recency (zeta newest, alpha oldest)
    const ungrouped = [
      { project: "zeta", mtime: 1_700_000_900_000 },
      { project: "alpha", mtime: 1_700_000_100_000 },
      { project: "mid", mtime: 1_700_000_500_000 },
    ];
    for (const u of ungrouped) {
      const id = `h2a-${u.project}`;
      const cwd = join(home, "src", u.project);
      mkdirSync(cwd, { recursive: true });
      entries.push({
        id,
        tool: "codex",
        kind: "local-native",
        cwd,
        label: u.project,
        tmuxSession: id,
        source: "run",
        sessionClass: "human",
        lastSeenAt: new Date(u.mtime).toISOString(),
      });
      nativeStates.push(makeNativeState(id));
    }

    writeRegistry(registryPath, entries);

    const config: RemoteCliConfig = {
      layout: {
        maxPerWindow: 12,
        sharedWindows: 2,
        groups: [{ title: "Core Group", projects: ["core"] }],
      },
    };

    const snap1 = await buildLiveRightPanelSnapshot({
      currentSessionId: "h2a-core-01",
      home,
      config,
      registryPath,
      h2aRoot,
      collectNative: async () => makeInventory(nativeStates),
      trackSources: [],
      draftDoubles: {
        compatGuardForSession: (id) => id === "h2a-core-03",
        draftCapabilityForSession: () => "refused-no-draft-adapter",
        draftRecoveryForSession: (id) =>
          id === "h2a-core-04" ? "saved-for-recovery" : "none",
      },
    });

    expect(snap1.degraded).toBe(false);
    expect(snap1.workspaces.map((w) => w.title)).toEqual(["Core Group", "other"]);
    // Uncapped: all 15 human sessions appear; delegated worker is excluded
    expect(snap1.workspaces[0]!.sessions).toHaveLength(15);
    expect(
      snap1.workspaces.flatMap((w) => w.sessions).some((s) => s.label === "worker-delegated"),
    ).toBe(false);
    // Stable 'other' tab ordered by project name (alpha, mid, zeta), not recency
    expect(snap1.workspaces[1]!.sessions.map((s) => s.label)).toEqual([
      "alpha",
      "mid",
      "zeta",
    ]);

    // Step 5 projection fields: displayedHere, controlledElsewhere, compatGuard, draftCapability, draftRecovery
    const s1 = snap1.workspaces[0]!.sessions.find((s) => s.id === "h2a-core-01")!;
    const s2 = snap1.workspaces[0]!.sessions.find((s) => s.id === "h2a-core-02")!;
    const s3 = snap1.workspaces[0]!.sessions.find((s) => s.id === "h2a-core-03")!;
    const s4 = snap1.workspaces[0]!.sessions.find((s) => s.id === "h2a-core-04")!;
    expect(s1.displayedHere).toBe(true);
    expect(s1.controlledElsewhere).toBe(false);
    expect(s2.displayedHere).toBe(false);
    expect(s2.controlledElsewhere).toBe(true);
    expect(s3.compatGuard).toBe(true);
    expect(s4.draftRecovery).toBe("saved-for-recovery");
    expect(s1.draftCapability).toBe("refused-no-draft-adapter");

    // Change recency so alpha becomes newest: 'other' tab order MUST stay alpha, mid, zeta
    entries.find((e) => e.id === "h2a-alpha")!.lastSeenAt = new Date(
      1_700_009_999_000,
    ).toISOString();
    writeRegistry(registryPath, entries);

    const snap2 = await buildLiveRightPanelSnapshot({
      currentSessionId: "h2a-core-01",
      home,
      config,
      registryPath,
      h2aRoot,
      collectNative: async () => makeInventory(nativeStates),
      trackSources: [],
    });
    expect(snap2.workspaces[1]!.sessions.map((s) => s.label)).toEqual([
      "alpha",
      "mid",
      "zeta",
    ]);
  });

  it("reads real Track CLI JSON on fixture journal, caches on (size, mtime), coalesces concurrent reads, and degrades only failed source", async () => {
    const root = makeTempDir("h2a-panel-track-");
    const repoA = join(root, "repo-a");
    const repoB = join(root, "repo-b");
    const repoMissing = join(root, "repo-missing");
    mkdirSync(repoA, { recursive: true });
    mkdirSync(repoB, { recursive: true });
    mkdirSync(repoMissing, { recursive: true });

    const [fixtureA, fixtureB] = await Promise.all([
      initTrackJournalWithRealEvents(repoA),
      initTrackJournalWithRealEvents(repoB),
    ]);
    const eventsBeforeA = statSync(join(fixtureA.trackDir, "events.jsonl"));

    let callsA = 0;
    let callsB = 0;
    const realTarget: SiblingBinaryTarget = {
      command: process.execPath,
      prefixArgs: [TRACK_BIN],
    };
    const countingExec: SiblingExecFn = async (cmd, args, opts) => {
      const dirIdx = args.indexOf("--track-dir");
      const dir = dirIdx >= 0 ? args[dirIdx + 1] : "";
      if (dir === fixtureA.trackDir) callsA += 1;
      if (dir === fixtureB.trackDir) callsB += 1;
      try {
        const { stdout, stderr } = await execFile(cmd, [...args], {
          timeout: opts.timeoutMs,
          cwd: opts.cwd,
          env: opts.env,
          maxBuffer: 8 * 1024 * 1024,
        });
        return { ok: true, stdout, stderr };
      } catch (err) {
        const e = err as NodeJS.ErrnoException & { code?: string | number };
        return { ok: false, reason: "error", message: String(e.message ?? err) };
      }
    };

    const cache = new TrackJournalCache({
      target: realTarget,
      exec: countingExec,
    });

    // Concurrent calls for the same journal coalesce into a single read pass
    const [r1, r2] = await Promise.all([
      cache.readDecisions({
        project: "repo-a",
        trackDir: fixtureA.trackDir,
        repoRoot: repoA,
        workspace: "core",
      }),
      cache.readDecisions({
        project: "repo-a",
        trackDir: fixtureA.trackDir,
        repoRoot: repoA,
        workspace: "core",
      }),
    ]);
    expect(r1.degraded).toBe(false);
    expect(r2.degraded).toBe(false);
    const callsAfterFirstA = callsA;
    expect(callsAfterFirstA).toBeGreaterThan(0);

    // 10 refreshes at constant revision launch ZERO second reads
    for (let i = 0; i < 10; i += 1) {
      const cached = await cache.readDecisions({
        project: "repo-a",
        trackDir: fixtureA.trackDir,
        repoRoot: repoA,
        workspace: "core",
      });
      expect(cached.degraded).toBe(false);
    }
    expect(callsA).toBe(callsAfterFirstA);

    // Verify real Track JSON derivation: pending + deferred kept, settled excluded,
    // artifact priority on d1, DECIDES -> item show link fallback on d2, chat: not-openable on d3
    const byId = new Map(r1.decisions.map((d) => [d.id, d]));
    expect(byId.has(fixtureA.settledDecisionId)).toBe(false);
    expect(byId.get(fixtureA.decisionWithArtifactId)?.dossierLink).toBe(
      join(repoA, "docs/dossiers/d1.md"),
    );
    expect(byId.get(fixtureA.decisionWithItemLinkId)?.dossierLink).toBe(
      join(repoA, "docs/specs/item1-spec.md"),
    );
    expect(byId.get(fixtureA.deferredDecisionId)?.outcome).toBe("deferred");
    expect(byId.get(fixtureA.deferredDecisionId)?.dossierLink).toBe("chat:thread-42");
    expect(byId.get(fixtureA.deferredDecisionId)?.dossierLinkClass).toBe("not-openable");

    // Read repoB and missing repoMissing: missing degrades ONLY repoMissing
    const resB = await cache.readDecisions({
      project: "repo-b",
      trackDir: fixtureB.trackDir,
      repoRoot: repoB,
      workspace: "core",
    });
    const resMissing = await cache.readDecisions({
      project: "repo-missing",
      trackDir: join(repoMissing, ".track"),
      repoRoot: repoMissing,
      workspace: "core",
    });
    expect(resB.degraded).toBe(false);
    expect(resMissing.degraded).toBe(true);
    const callsAfterFirstB = callsB;

    // Modify ONLY repoA journal -> ONLY repoA re-reads, repoB stays cached
    await runTrackFixture(
      fixtureA.trackDir,
      [
        "decision",
        "add-artifact",
        fixtureA.decisionWithArtifactId,
        "--kind",
        "mockup",
        "--view-ref",
        "https://claude.ai/artifacts/abc",
      ],
      repoA,
    );
    await cache.readDecisions({
      project: "repo-a",
      trackDir: fixtureA.trackDir,
      repoRoot: repoA,
      workspace: "core",
    });
    await cache.readDecisions({
      project: "repo-b",
      trackDir: fixtureB.trackDir,
      repoRoot: repoB,
      workspace: "core",
    });
    expect(callsA).toBeGreaterThan(callsAfterFirstA);
    expect(callsB).toBe(callsAfterFirstB);

    // Readers performed zero writes on repoB's events.jsonl
    const eventsAfterB = statSync(join(fixtureB.trackDir, "events.jsonl"));
    expect(eventsAfterB.size).toBe(eventsBeforeA.size);
  }, 20_000);

  it("degrades cleanly when the track binary is missing (ENOENT) without crashing", async () => {
    const root = makeTempDir("h2a-panel-notrack-");
    const trackDir = join(root, ".track");
    mkdirSync(trackDir, { recursive: true });
    writeFileSync(join(trackDir, "events.jsonl"), "", "utf8");

    const cache = new TrackJournalCache({
      target: { command: "/nonexistent/track-binary-missing", prefixArgs: [] },
    });
    const res = await cache.readDecisions({
      project: "p",
      trackDir,
      repoRoot: root,
    });
    expect(res.degraded).toBe(true);
    expect(res.decisions).toEqual([]);
  });

  it("resolves linked worktree .git file back to main checkout's journal of record", () => {
    const root = makeTempDir("h2a-panel-wt-");
    const mainRepo = join(root, "main-repo");
    const wtRepo = join(root, "wt-1");
    const wtGitDir = join(mainRepo, ".git", "worktrees", "wt-1");
    mkdirSync(wtGitDir, { recursive: true });
    mkdirSync(wtRepo, { recursive: true });
    writeFileSync(join(wtGitDir, "commondir"), "../..\n", "utf8");
    writeFileSync(join(wtRepo, ".git"), `gitdir: ${wtGitDir}\n`, "utf8");

    const resolved = resolveJournalOfRecord("wt-1", wtRepo);
    expect(resolved.repoRoot).toBe(mainRepo);
    expect(resolved.trackDir).toBe(join(mainRepo, ".track"));

    // Explicit rightPanel.trackDirs override wins over main checkout
    const customDir = join(root, "custom-track");
    const overridden = resolveJournalOfRecord("wt-1", wtRepo, { "wt-1": customDir });
    expect(overridden.trackDir).toBe(customDir);
  });

  it("refreshes marker on source change without child output within <= 2 s and satisfies < 50 ms p95 budget on 50 sessions / 3 journals", async () => {
    const home = makeTempDir("h2a-panel-budget-");
    const registryPath = join(home, "registry.json");
    const h2aRoot = join(home, ".h2a");
    mkdirSync(join(h2aRoot, "presence"), { recursive: true });

    const entries: RegistryEntry[] = [];
    const nativeStates: Array<NativeTerminalSessionState & { socketPath: string }> = [];
    for (let i = 1; i <= 50; i += 1) {
      const proj = `proj-${(i % 3) + 1}`;
      const id = `h2a-s-${String(i).padStart(2, "0")}`;
      const cwd = join(home, "src", proj);
      mkdirSync(cwd, { recursive: true });
      entries.push({
        id,
        tool: "claude",
        kind: "local-native",
        cwd,
        label: `sess-${i}`,
        tmuxSession: id,
        source: "run",
        sessionClass: "human",
        lastSeenAt: new Date(1_700_000_000_000 + i * 1000).toISOString(),
      });
      nativeStates.push(makeNativeState(id));
    }
    writeRegistry(registryPath, entries);

    const journals = [1, 2, 3].map((idx) => {
      const repoRoot = join(home, "src", `proj-${idx}`);
      const trackDir = join(repoRoot, ".track");
      mkdirSync(trackDir, { recursive: true });
      writeFileSync(join(trackDir, "events.jsonl"), `{"seq":${idx}}\n`, "utf8");
      return { project: `proj-${idx}`, trackDir, repoRoot };
    });

    const stubExec: SiblingExecFn = async () => ({
      ok: true,
      stdout: JSON.stringify([
        {
          id: "d-1",
          title: "Pending decision",
          workspace: "proj-1",
          outcome: "pending",
          openQuestionCount: 0,
          artifacts: [{ kind: "rendered-view", viewRef: "docs/d1.md" }],
        },
      ]),
      stderr: "",
    });
    const cache = new TrackJournalCache({
      target: { command: "track", prefixArgs: [] },
      exec: stubExec,
    });

    // Warm cache (first read populates cache)
    await buildLiveRightPanelSnapshot({
      currentSessionId: "h2a-s-01",
      home,
      registryPath,
      h2aRoot,
      collectNative: async () => makeInventory(nativeStates),
      trackCache: cache,
      trackSources: journals,
    });

    // Measure 30 snapshot builds at steady-state revision: p95 must be < 50 ms
    const durations: number[] = [];
    for (let i = 0; i < 30; i += 1) {
      const t0 = performance.now();
      await buildLiveRightPanelSnapshot({
        currentSessionId: "h2a-s-01",
        home,
        registryPath,
        h2aRoot,
        collectNative: async () => makeInventory(nativeStates),
        trackCache: cache,
        trackSources: journals,
      });
      durations.push(performance.now() - t0);
    }
    durations.sort((a, b) => a - b);
    const p95 = durations[Math.floor(durations.length * 0.95)]!;
    expect(p95).toBeLessThan(50);

    // Refresher updates marker when source changes (no child output needed) within <= 2s fake clock
    let now = 10_000;
    let blocked = false;
    const updates: boolean[] = [];
    const refresher = new RightPanelSnapshotRefresher({
      now: () => now,
      minIntervalMs: 1_000,
      initialSnapshot: {
        workspaces: [],
        decisions: [],
        attentionCount: 0,
        collapsedLit: false,
        degraded: false,
      },
      load: async (seen) =>
        buildLiveRightPanelSnapshot({
          currentSessionId: "h2a-s-01",
          home,
          registryPath,
          h2aRoot,
          nowMs: now,
          seenDecisionKeys: seen,
          collectNative: async () => makeInventory(nativeStates),
          trackSources: [],
        }),
      onUpdate: (snap) => updates.push(snap.collapsedLit),
    });

    await refresher.maybeRefresh(true);
    expect(refresher.getSnapshot().collapsedLit).toBe(false);

    // Another session turns blocked in presence store
    blocked = true;
    void blocked;
    writeFileSync(
      join(h2aRoot, "presence", "s-02.json"),
      JSON.stringify({
        sessionId: "p-2",
        instance: "inst-2",
        startedAt: new Date(now - 5_000).toISOString(),
        heartbeatAt: new Date(now).toISOString(),
        state: "live",
        workStatus: "blocked",
        launchContext: { nativePty: { session: "h2a-s-02" } },
      }),
      "utf8",
    );

    now += 1_000;
    await refresher.maybeRefresh();
    expect(refresher.getSnapshot().collapsedLit).toBe(true);
    expect(updates.at(-1)).toBe(true);
    refresher.dispose();
  });
});

describe("S2 canal des restaurables (plan 09-S2)", () => {
  let uuidSeq = 0;
  function nextUuid(): string {
    uuidSeq += 1;
    return `22222222-2222-4222-8222-2222222222${String(uuidSeq).padStart(2, "0")}`;
  }

  function deadEntry(
    home: string,
    over: Partial<RegistryEntry> & { id: string; project: string },
  ): RegistryEntry {
    const cwd = join(home, "src", over.project);
    mkdirSync(cwd, { recursive: true });
    return {
      tool: "claude",
      kind: "local-native",
      source: "run",
      sessionClass: "human",
      enrolledAt: "2026-11-20T10:00:00.000Z",
      lastSeenAt: "2026-11-20T10:00:00.000Z",
      label: over.id,
      tmuxSession: `h2a-${over.id}`,
      convId: nextUuid(),
      ...over,
      cwd,
    } as RegistryEntry;
  }

  it("should carry every dead session of the restore plan under `restorable`, with one reason each, from one host photo", async () => {
    const home = makeTempDir("h2a-panel-s2-");
    const registryPath = join(home, "registry.json");
    const h2aRoot = join(home, ".h2a");
    mkdirSync(join(h2aRoot, "presence"), { recursive: true });

    let collectCalls = 0;
    const nativeStates = [makeNativeState("h2a-live-one")];
    const collectNative = async () => {
      collectCalls += 1;
      return makeInventory(nativeStates);
    };

    const scanned: Array<{
      project: string;
      mtimeMs: number;
      tool: "claude";
      sid: string;
      cwd: string;
      origin: "scan";
      restoreClass: "unclassified";
    }> = [
      {
        project: "scanproj",
        mtimeMs: 1_700_000_000_000,
        tool: "claude",
        sid: "scan-sid-1",
        cwd: join(home, "src", "scanproj"),
        origin: "scan",
        restoreClass: "unclassified",
      },
      {
        project: "scanproj",
        mtimeMs: 1_700_000_001_000,
        tool: "claude",
        sid: "scan-sid-2",
        cwd: join(home, "src", "scanproj"),
        origin: "scan",
        restoreClass: "unclassified",
      },
    ];
    let scanCalls = 0;

    const entries: RegistryEntry[] = [
      // The one live session: a live line, never a restorable row.
      deadEntry(home, {
        id: "live-one",
        project: "h2a",
        tmuxSession: "h2a-live-one",
        lastSeenAt: "2026-11-20T10:09:00.000Z",
      }),
      // Selected dead claude session: launched, with tokens.
      deadEntry(home, {
        id: "dead-claude",
        project: "h2a",
        lastSeenAt: "2026-11-20T10:08:00.000Z",
      }),
      // Beyond the explicit cap: same motif, gesture offered.
      deadEntry(home, {
        id: "dead-claude-2",
        project: "h2a",
        lastSeenAt: "2026-11-20T10:07:00.000Z",
      }),
      // No resolved conversation: motif, never a gesture.
      deadEntry(home, {
        id: "dead-unresolved",
        project: "h2a",
        convId: undefined,
        lastSeenAt: "2026-11-20T10:06:00.000Z",
      }),
      // One identity on two hosts: motif, never a gesture.
      deadEntry(home, {
        id: "ambig-native",
        project: "ambig",
        kind: "local-native",
        label: "ambig",
        tmuxSession: "h2a-ambig",
        lastSeenAt: "2026-11-20T10:05:00.000Z",
      }),
      deadEntry(home, {
        id: "ambig-tmux",
        project: "ambig",
        kind: "local-tmux",
        label: "ambig",
        tmuxSession: "h2a-ambig",
        lastSeenAt: "2026-11-20T10:05:00.000Z",
      }),
      // tmux view unknown: no relaunch of the tmux session by the station.
      deadEntry(home, {
        id: "unknown-one",
        project: "site",
        kind: "local-tmux",
        tmuxSession: "h2a-unknown",
        lastSeenAt: "2026-11-20T10:04:00.000Z",
      }),
      // Selected agy session whose argv is not verified: motif, never a gesture.
      deadEntry(home, {
        id: "dead-agy",
        project: "shared-a",
        tool: "agy",
        lastSeenAt: "2026-11-20T10:03:00.000Z",
      }),
      // Beyond the shared pool: same motif, gesture offered.
      deadEntry(home, {
        id: "dead-shared-b",
        project: "shared-b",
        lastSeenAt: "2026-11-20T10:02:00.000Z",
      }),
      // Not human sessions of the layout: never listed.
      {
        ...deadEntry(home, { id: "delegated-one", project: "h2a" }),
        role: "job",
        delegationOrigin: "mcp:h2a_run",
        delegatorInstance: "inst-1",
      },
      {
        ...deadEntry(home, { id: "remote-one", project: "rem" }),
        kind: "remote",
      } as RegistryEntry,
    ];
    writeRegistry(registryPath, entries);

    const config: RemoteCliConfig = {
      layout: {
        maxAgeHours: 48,
        maxPerWindow: 2,
        sharedWindows: 1,
        multiSession: { scanproj: 1 },
        multiSessionDefault: 0,
        groups: [{ title: "core", projects: ["h2a"] }],
      },
    };

    const scanCache = new TranscriptScanCache();
    const baseOpts = {
      currentSessionId: "h2a-live-one",
      home,
      config,
      registryPath,
      h2aRoot,
      collectNative,
      listTmux: async () => ({ known: false as const, reason: "no tmux in station" }),
      trackSources: [],
      scanCache,
      scanReader: () => {
        scanCalls += 1;
        return [...scanned];
      },
    };
    const snap = await buildLiveRightPanelSnapshot({ ...baseOpts, nowMs: 1_000 });
    // One photo and one plan per snapshot: one inventory read per refresh,
    // while the transcript scan stays cached at the same clock.
    await buildLiveRightPanelSnapshot({ ...baseOpts, nowMs: 1_000 });
    await buildLiveRightPanelSnapshot({ ...baseOpts, nowMs: 1_000 });
    expect(collectCalls).toBe(3);
    expect(scanCalls).toBe(1);

    const byTitle = new Map(snap.workspaces.map((w) => [w.title, w]));
    // The live session stays a live line.
    expect(byTitle.get("core")!.sessions.map((s) => s.id)).toEqual(["h2a-live-one"]);
    const otherEarly = byTitle.get("other")!.restorable ?? [];

    const coreRestorable = byTitle.get("core")!.restorable ?? [];
    const row = (key: string) => coreRestorable.find((r) => r.key === key)!;
    expect(row("registry:dead-claude")).toMatchObject({
      label: "dead-claude",
      reason: "launch",
      state: "queued",
    });
    expect(row("registry:dead-claude").relaunch).toEqual({
      args: [
        "run",
        "claude",
        join(home, "src", "h2a"),
        "--resume",
        entries.find((e) => e.id === "dead-claude")!.convId!,
        "--name",
        "dead-claude",
        "--no-attach",
      ],
      env: ["H2A_SESSION_HOST=native"],
      cwd: join(home, "src", "h2a"),
      name: "h2a-dead-claude",
    });
    expect(row("registry:dead-claude-2")).toMatchObject({
      reason: "launch-cap",
      state: "queued",
    });
    expect(row("registry:dead-claude-2").relaunch).toBeDefined();
    expect(row("registry:dead-unresolved")).toMatchObject({
      reason: "unresolved-conversation",
    });
    expect(row("registry:dead-unresolved").relaunch).toBeUndefined();

    // Identity on two hosts: one row per classification, same motif, no
    // gesture. The project is ungrouped, so both rows sit under `other`.
    const ambigRows = otherEarly.filter((r) => r.reason === "dual-host");
    expect(ambigRows).toHaveLength(2);
    for (const ambig of ambigRows) expect(ambig.relaunch).toBeUndefined();

    const other = byTitle.get("other")!.restorable ?? [];
    const otherRow = (key: string) => other.find((r) => r.key === key)!;
    expect(otherRow("registry:dead-shared-b")).toMatchObject({ reason: "launch-cap" });
    expect(otherRow("registry:dead-shared-b").relaunch).toBeDefined();
    // Transcript scans are unclassified by construction: both rows carry the
    // raw plan code. (`per-project-scan-cap` is mapped the same way when the
    // plan emits it; the scan never reaches the grouping caps.)
    expect(otherRow("scan:scanproj:scan-sid-1").reason).toBe("unclassified-scan");
    expect(otherRow("scan:scanproj:scan-sid-2").reason).toBe("unclassified-scan");

    // The tmux session under an unknown view and the selected agy session
    // share the single shared window, each with its own motif.
    const sharedWin = byTitle.get("fenêtre partagée 1")!.restorable ?? [];
    expect(sharedWin).toHaveLength(2);
    expect(sharedWin[0]).toMatchObject({
      key: "registry:unknown-one",
      reason: "unknown-view",
    });
    expect(sharedWin[0]!.relaunch).toBeUndefined();
    expect(sharedWin[1]).toMatchObject({
      key: "registry:dead-agy",
      reason: "resume-argv-unverified",
    });
    expect(sharedWin[1]!.relaunch).toBeUndefined();

    // Neither the delegated row nor the remote row is ever listed.
    const allKeys = snap.workspaces.flatMap((w) => [
      ...w.sessions.map((s) => s.id),
      ...(w.restorable ?? []).map((r) => r.key),
    ]);
    expect(allKeys).not.toContain("registry:delegated-one");
    expect(allKeys).not.toContain("registry:remote-one");
  });

  it("should throttle the transcript scan to one read per 60 s of injected clock", async () => {
    const home = makeTempDir("h2a-panel-scan-");
    const registryPath = join(home, "registry.json");
    writeRegistry(registryPath, []);
    const config: RemoteCliConfig = {
      layout: { maxPerWindow: 1, sharedWindows: 1, groups: [] },
    };
    let scanCalls = 0;
    const scanCache = new TranscriptScanCache();
    const opts = {
      currentSessionId: "",
      home,
      config,
      registryPath,
      collectNative: async () => makeInventory([]),
      trackSources: [] as never[],
      scanCache,
      scanReader: () => {
        scanCalls += 1;
        return [];
      },
    };
    await buildLiveRightPanelSnapshot({ ...opts, nowMs: 1_000 });
    await buildLiveRightPanelSnapshot({ ...opts, nowMs: 60_999 });
    expect(scanCalls).toBe(1);
    await buildLiveRightPanelSnapshot({ ...opts, nowMs: 61_000 });
    expect(scanCalls).toBe(2);
  });
});
