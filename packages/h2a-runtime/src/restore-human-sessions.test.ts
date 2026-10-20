import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  groupSessions,
  registrySessions,
  selectRemoteTabsForGroups,
  type DiscoveredSession,
  type LegacySessionEvidence,
  type RestoreExclusions,
} from "./restore.js";
import {
  classifyRestoreFacet,
  type RegistryEntry,
} from "./registry.js";
import { DEFAULT_LAYOUT } from "./config.js";
import { encodeCwd } from "./convsync.js";

const scratchDirs: string[] = [];

afterEach(() => {
  for (const dir of scratchDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** A fake HOME under the test run root holding a real transcript file. */
function homeWithTranscript(cwd: string, convId: string): string {
  const home = mkdtempSync(join(tmpdir(), "h2a-l5-home-"));
  scratchDirs.push(home);
  const dir = join(home, ".claude", "projects", encodeCwd(cwd));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${convId}.jsonl`), '{"type":"summary","summary":"review"}\n');
  return home;
}

function newExclusions(): RestoreExclusions {
  return { secondary: [], unclassified: [] };
}

const HOME = "/home/u";

function registryEntry(
  project: string,
  over: Partial<RegistryEntry> = {},
): RegistryEntry {
  const now = new Date().toISOString();
  return {
    id: `id-${project}`,
    tool: "claude",
    kind: "local-tmux",
    cwd: join(HOME, "src", project),
    tmuxSession: `remote-${project}`,
    enrolledAt: now,
    lastSeenAt: now,
    source: "run",
    sessionClass: "human",
    ...over,
  };
}

describe("h2a restore — human-facing session preservation (defect repro)", () => {
  it("DEFECT #1: keeps EVERY distinct live human session of one repo (default cap)", () => {
    // sentropic legitimately has THREE concurrent human sessions live at once.
    const entries: RegistryEntry[] = [
      registryEntry("sentropic", {
        id: "id-s1",
        tmuxSession: "remote-sentropic-1",
        label: "sentropic-1",
        convId: "conv-1",
      }),
      registryEntry("sentropic", {
        id: "id-s2",
        tmuxSession: "remote-sentropic-2",
        label: "sentropic-2",
        convId: "conv-2",
      }),
      registryEntry("sentropic", {
        id: "id-s3",
        tmuxSession: "remote-sentropic-3",
        label: "sentropic-3",
        convId: "conv-3",
      }),
    ];
    const sessions = registrySessions(HOME, entries);
    const { windows } = groupSessions(sessions, DEFAULT_LAYOUT);
    const labels = windows.flatMap((w) => w.tabs).map((t) => t.label).sort();
    // Each distinct live human session must survive restore (keyed by session
    // identity, not by repo). Current code collapses to the newest one.
    expect(labels).toEqual(["sentropic-1", "sentropic-2", "sentropic-3"]);
  });

  it("DEFECT #1b: the SCAN fallback stays capped (mtime guesses are noisy)", () => {
    // Filesystem-scan guesses (origin 'scan') can duplicate one conversation, so
    // the multiSessionDefault cap must still tame THEM.
    const scan = (sid: string, ageMs: number): DiscoveredSession => ({
      project: "guessy",
      mtimeMs: Date.now() - ageMs,
      tool: "claude",
      sid,
      cwd: join(HOME, "src", "guessy"),
      origin: "scan",
      label: sid,
    });
    const sessions = [scan("a", 0), scan("b", 1000), scan("c", 2000)];
    const tabs = groupSessions(sessions, DEFAULT_LAYOUT).windows.flatMap(
      (w) => w.tabs,
    );
    expect(tabs).toHaveLength(1);
    expect(tabs[0]!.label).toBe("a"); // newest guess only
  });

  it("DEFECT #2: excludes delegated role:'job' workers from human restore", () => {
    const worker = registryEntry("worker", { role: "job", jobState: "running" });
    delete worker.sessionClass;
    const entries: RegistryEntry[] = [
      registryEntry("human", { sessionClass: "human" }),
      // A delegated job: role 'job', NO sessionClass set (as delegate enrolls it).
      worker,
    ];
    const projects = registrySessions(HOME, entries).map((s) => s.project);
    expect(projects).toEqual(["human"]);
  });

  it("DEFECT #2b: still excludes explicit sessionClass:'background' launches", () => {
    const entries: RegistryEntry[] = [
      registryEntry("human", { sessionClass: "human" }),
      registryEntry("bg", { sessionClass: "background" }),
    ];
    const projects = registrySessions(HOME, entries).map((s) => s.project);
    expect(projects).toEqual(["human"]);
  });
});

describe("lot L5 RED: secondaries excluded by provenance (D12)", () => {
  it("should exclude a delegated review with a visible terminal and a valid transcript", () => {
    // A delegated review: explicitly human, live on its terminal, real
    // transcript on disk — but delegation provenance makes it secondary,
    // never a primary restore tab.
    const home = mkdtempSync(join(tmpdir(), "h2a-l5-home-"));
    scratchDirs.push(home);
    const cwd = join(home, "src", "review");
    const convId = "conv-delegated-review";
    mkdirSync(join(home, ".claude", "projects", encodeCwd(cwd)), {
      recursive: true,
    });
    writeFileSync(
      join(home, ".claude", "projects", encodeCwd(cwd), `${convId}.jsonl`),
      '{"type":"summary","summary":"delegated review"}\n',
    );
    const delegated = registryEntry("review", {
      id: "id-delegated-review",
      label: "review",
      cwd,
      convId,
      tmuxSession: "h2a-review",
      sessionClass: "human",
      delegationOrigin: "mcp:h2a_run",
      parent: "job-parent-1",
    });
    const evidence: LegacySessionEvidence = {
      home,
      liveTmuxSessions: [{ name: "h2a-review", path: cwd, profile: "claude" }],
    };
    const excluded = newExclusions();
    const sessions = registrySessions(home, [delegated], undefined, evidence, undefined, [], {
      collectExcluded: excluded,
    });
    expect(sessions).toHaveLength(0);
    expect(excluded.secondary).toEqual(["review"]);
    expect(excluded.unclassified).toEqual([]);
  });

  it("should exclude an attached delegated session with delegationOrigin or parent set", () => {
    const byOrigin = registryEntry("via-origin", {
      label: "via-origin",
      sessionClass: "human",
      delegationOrigin: "cli:h2a-delegate",
    });
    const byParent = registryEntry("via-parent", {
      label: "via-parent",
      sessionClass: "human",
      parent: "job-parent-9",
    });
    const excluded = newExclusions();
    const sessions = registrySessions(HOME, [byOrigin, byParent], undefined, undefined, undefined, [], {
      collectExcluded: excluded,
    });
    expect(sessions).toHaveLength(0);
    expect(excluded.secondary.sort()).toEqual(["via-origin", "via-parent"]);
  });

  it("should not promote a classless legacy transcript to a primary session", () => {
    // Transcript/legacy evidence may prove a conversation exists, never a
    // primary: a classless row classifies to no facet (unclassified).
    expect(
      classifyRestoreFacet({ sessionClass: undefined, role: undefined }),
    ).toBeUndefined();
    expect(
      classifyRestoreFacet({ sessionClass: "human", role: undefined }),
    ).toBe("primary");
    expect(
      classifyRestoreFacet({
        sessionClass: "human",
        role: undefined,
        delegationOrigin: "mcp:h2a_run",
      }),
    ).toBe("secondary");
    expect(
      classifyRestoreFacet({ sessionClass: "background", role: undefined }),
    ).toBeUndefined();
    // role:"job" IS delegation provenance (D12a) — secondary by construction.
    expect(
      classifyRestoreFacet({ sessionClass: undefined, role: "job" }),
    ).toBe("secondary");
  });

  it("should exclude a legacy classless delegated row even when a transcript exists", () => {
    const cwd = join(HOME, "src", "old-review");
    const convId = "conv-old-review";
    const home = homeWithTranscript(cwd, convId);
    const row = registryEntry("old-review", {
      label: "old-review",
      cwd,
      convId,
      tmuxSession: "h2a-old-review",
    });
    delete row.sessionClass;
    row.delegationOrigin = "mcp:h2a_run";
    const excluded = newExclusions();
    const sessions = registrySessions(
      HOME,
      [row],
      undefined,
      { home, liveTmuxSessions: [] },
      undefined,
      [],
      { collectExcluded: excluded },
    );
    expect(sessions).toHaveLength(0);
    expect(excluded.secondary).toEqual(["old-review"]);
  });

  it("should exclude remote delegated sessions from the default restore plan", () => {
    // Round-1 (D12c): only positively-classified primaries restore — the
    // unfaceted row is excluded and named, not admitted.
    const excludedUnclassified: string[] = [];
    const tabs = selectRemoteTabsForGroups(
      [
        { id: "r-prim", label: "Primary", cwd: "/w/prim", restoreFacet: "primary" },
        { id: "r-unclass", label: "Unknown", cwd: "/w/unknown" },
        {
          id: "r-sec",
          label: "Delegated",
          cwd: "/w/delegated",
          restoreFacet: "secondary",
        },
      ],
      {
        onExcludedUnclassified: (excluded) => {
          for (const t of excluded) excludedUnclassified.push(t.id);
        },
      },
    );
    expect(tabs.map((t) => t.id)).toEqual(["r-prim"]);
    expect(excludedUnclassified).toEqual(["r-unclass"]);
    const admitted = selectRemoteTabsForGroups(
      [
        {
          id: "r-sec",
          label: "Delegated",
          cwd: "/w/delegated",
          restoreFacet: "secondary",
        },
      ],
      { includeSecondary: true },
    );
    expect(admitted.map((t) => t.id)).toEqual(["r-sec"]);
  });

  it("should list excluded secondaries by name and restore them only with the opt-in", () => {
    const secondary = registryEntry("delegated", {
      label: "delegated",
      sessionClass: "human",
      delegationOrigin: "cli:h2a-delegate",
    });
    const primary = registryEntry("primary", {
      label: "primary",
      sessionClass: "human",
    });
    const excluded = newExclusions();
    const planned = registrySessions(HOME, [secondary, primary], undefined, undefined, undefined, [], {
      collectExcluded: excluded,
    });
    expect(planned.map((s) => s.label).sort()).toEqual(["primary"]);
    expect(excluded.secondary).toEqual(["delegated"]);
    // Explicit opt-in restores the secondary alongside the primary.
    const admitted = registrySessions(HOME, [secondary, primary], undefined, undefined, undefined, [], {
      collectExcluded: newExclusions(),
      includeSecondary: true,
    });
    expect(admitted.map((s) => s.label).sort()).toEqual([
      "delegated",
      "primary",
    ]);
  });
});
