/**
 * Lot LG RED — dedicated configurable restore groups (D13).
 *
 * Pure suite (no repo scratch): groupSessions, the matcher helpers, and
 * config validation run against invented fixtures and tmp-dir homes only.
 */
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DEFAULT_LAYOUT, getLayoutConfig, type LayoutConfig } from "./config.js";
import {
  assignRemoteTabsToGroups,
  discoverSessions,
  groupSessions,
  registrySessions,
  selectRemoteTabsForGroups,
  validateLayoutGroups,
  type DiscoveredSession,
} from "./restore.js";
import { encodeCwd } from "./convsync.js";

const scratchDirs: string[] = [];
let prevConfigHome: string | undefined;
let prevLang: string | undefined;

beforeEach(() => {
  prevConfigHome = process.env.REMOTE_CLI_CONFIG_HOME;
  prevLang = process.env.H2A_LANG;
});

afterEach(() => {
  for (const dir of scratchDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  if (prevConfigHome === undefined) delete process.env.REMOTE_CLI_CONFIG_HOME;
  else process.env.REMOTE_CLI_CONFIG_HOME = prevConfigHome;
  if (prevLang === undefined) delete process.env.H2A_LANG;
  else process.env.H2A_LANG = prevLang;
});

function useLang(lang: string): void {
  process.env.H2A_LANG = lang;
}

function fakeHome(): string {
  const home = mkdtempSync(join(tmpdir(), "h2a-lg-home-"));
  scratchDirs.push(home);
  return home;
}

function session(project: string, over: Partial<DiscoveredSession> = {}): DiscoveredSession {
  return {
    project,
    mtimeMs: 1_000_000,
    tool: "claude",
    sid: `sid-${project}`,
    cwd: join("/home/u/src", project),
    origin: "registry",
    restoreClass: "human",
    ...over,
  };
}

function cfg(over: Partial<LayoutConfig>): LayoutConfig {
  return { ...DEFAULT_LAYOUT, ...over };
}

describe("lot LG RED: dedicated configurable restore groups (D13)", () => {
  it("should keep a projects-only layout config byte-identical in windows", () => {
    useLang("en");
    const sessions = [session("alpha"), session("beta")];
    const config = cfg({
      groups: [{ title: "team", projects: ["alpha"] }],
    });
    const before = groupSessions(sessions, config);
    expect(before.windows).toEqual([
      {
        title: "team",
        tabs: [
          {
            cwd: "/home/u/src/alpha",
            label: "alpha",
            tool: "claude",
            sid: "sid-alpha",
            origin: "registry",
          },
        ],
      },
      {
        title: "shared window 1",
        tabs: [
          {
            cwd: "/home/u/src/beta",
            label: "beta",
            tool: "claude",
            sid: "sid-beta",
            origin: "registry",
          },
        ],
      },
    ]);
    expect(before.dropped).toBe(0);
  });

  it("should place nested worktree sessions in their cwd-prefix group and nowhere else", () => {
    useLang("en");
    const wt = session("fleet-proj", {
      cwd: "/data/family-alpha/fleet-proj/wt-1",
    });
    const other = session("other");
    const config = cfg({
      groups: [{ title: "alpha", cwdPrefixes: ["/data/family-alpha"] }],
    });
    const { windows } = groupSessions([wt, other], config);
    const alpha = windows.find((w) => w.title === "alpha");
    expect(alpha?.tabs.map((t) => t.cwd)).toEqual(["/data/family-alpha/fleet-proj/wt-1"]);
    const shared = windows.filter((w) => w.title.startsWith("shared window"));
    expect(shared.flatMap((w) => w.tabs.map((t) => t.cwd))).toEqual(["/home/u/src/other"]);
  });

  it("should place a session in at most one window when two groups match it", () => {
    const s = session("alpha");
    const config = cfg({
      groups: [
        { title: "first", projects: ["alpha"] },
        { title: "second", tools: ["claude"] },
      ],
    });
    const { windows } = groupSessions([s], config);
    expect(windows.map((w) => w.title)).toEqual(["first"]);
  });

  it("should never duplicate a project listed in two groups", () => {
    const s = session("alpha");
    const config = cfg({
      groups: [{ title: "one", projects: ["alpha"] }, { title: "two", projects: ["alpha"] }],
    });
    const { windows } = groupSessions([s], config);
    const all = windows.flatMap((w) => w.tabs.map((t) => t.label));
    expect(all).toEqual(["alpha"]);
  });

  it("should account explicit-group cap overflow instead of dropping it silently", () => {
    const sessions = [session("a"), session("b"), session("c")];
    const config = cfg({
      groups: [{ title: "tight", projects: ["a", "b", "c"], maxTabs: 2 }],
    });
    const result = groupSessions(sessions, config);
    const tight = result.windows.find((w) => w.title === "tight");
    expect(tight?.tabs).toHaveLength(2);
    expect(result.groupCapDrops).toEqual([{ group: "tight", dropped: 1, cap: 2, names: ["c"] }]);
  });

  it("should report an empty configured group and unmatched sessions in the plan", () => {
    const s = session("alpha");
    const config = cfg({ groups: [{ title: "ghost", projects: ["nobody"] }] });
    const result = groupSessions([s], config);
    expect(result.emptyGroups).toEqual(["ghost"]);
    expect(result.unmatched).toEqual(["alpha"]);
  });

  it("should discover registry sessions under a configured root outside the default scan root", () => {
    const home = fakeHome();
    const root = join(home, "fleet");
    mkdirSync(join(root, "proj"), { recursive: true });
    const entry = {
      id: "id-fleet",
      label: "fleet-proj",
      tool: "claude",
      kind: "local-tmux",
      cwd: join(root, "proj"),
      enrolledAt: "2026-10-20T00:00:00.000Z",
      lastSeenAt: "2026-10-20T00:00:00.000Z",
      source: "run",
      sessionClass: "human",
    } as const;
    const admitted = registrySessions(home, [{ ...entry }], undefined, undefined, undefined, [], {
      admissionRoots: [root],
    });
    expect(admitted.map((s) => s.project)).toEqual(["proj"]);
    const dropped = registrySessions(home, [{ ...entry }]);
    expect(dropped).toHaveLength(0);
  });

  it("should select remote tabs per group without duplicating a remote session", () => {
    const groups = [
      { title: "fleet", remote: true, projects: ["pod-1"] },
      { title: "overflow", remote: true },
    ];
    const tabs = [
      { id: "r1", label: "pod-1", cwd: "/w/1" },
      { id: "r2", label: "pod-9", cwd: "/w/9" },
    ];
    const assigned = assignRemoteTabsToGroups(tabs, groups);
    expect(assigned.get("fleet")?.map((t) => t.id)).toEqual(["r1"]);
    expect(assigned.get("overflow")?.map((t) => t.id)).toEqual(["r2"]);
    const all = [...assigned.values()].flat().map((t) => t.id);
    expect(all.sort()).toEqual(["r1", "r2"]);
  });

  it("should refuse an invalid layout config before launching anything", () => {
    useLang("en");
    expect(validateLayoutGroups([{ title: 42 } as never])).toHaveLength(1);
    expect(
      validateLayoutGroups([{ title: "a" }, { title: "A " }]),
    ).toEqual([expect.stringMatching(/duplicate/i)]);
    expect(
      validateLayoutGroups([{ title: "a", tools: ["nope"] }]),
    ).toHaveLength(1);
    expect(() => {
      const dir = fakeHome();
      process.env.REMOTE_CLI_CONFIG_HOME = dir;
      mkdirSync(join(dir, ".config", "sentropic", "h2a"), { recursive: true });
      writeFileSync(
        join(dir, ".config", "sentropic", "h2a", "config.json"),
        JSON.stringify({ layout: { groups: [{ title: 42 }] } }),
      );
      getLayoutConfig();
    }).toThrow(/invalid layout/i);
  });

  it("should scan a group root outside ~/src exempt from the age cutoff", () => {
    const home = fakeHome();
    const root = join(home, "fleet");
    const projDir = join(root, "proj");
    mkdirSync(projDir, { recursive: true });
    const dir = join(home, ".claude", "projects", `${encodeCwd(root)}-proj`);
    mkdirSync(dir, { recursive: true });
    const file = join(dir, "old.jsonl");
    writeFileSync(file, `${JSON.stringify({ cwd: projDir })}\n`);
    const ancient = new Date("2020-01-01T00:00:00.000Z");
    utimesSync(file, ancient, ancient);
    const hourMs = 3600 * 1000;
    // Without the group root the stale transcript stays out of the scan…
    expect(discoverSessions(hourMs, home)).toHaveLength(0);
    // …and with it the row is admitted despite its age, under its real cwd.
    const found = discoverSessions(hourMs, home, [root]);
    expect(found.map((s) => s.project)).toEqual(["proj"]);
    expect(found[0]?.cwd).toBe(projDir);
  });

  it("should title shared windows from the locale catalog, never a hardcoded language", () => {
    useLang("fr");
    const fr = groupSessions([session("alpha")], cfg({ groups: [] }));
    expect(fr.windows.map((w) => w.title)).toEqual(["fenêtre partagée 1"]);
    useLang("en");
    const en = groupSessions([session("alpha")], cfg({ groups: [] }));
    expect(en.windows.map((w) => w.title)).toEqual(["shared window 1"]);
  });
});

describe("round-1 P2 (code-review astra-6/7): contract matchers, strict validation, remote gate", () => {
  it("should match sessions by configured labels and nothing else", () => {
    useLang("en");
    const worker = session("alpha", { label: "worker" });
    const other = session("beta", { label: "other" });
    const config = cfg({ groups: [{ title: "crew", labels: ["worker"] }] });
    const grouped = groupSessions([worker, other], config);
    const crew = grouped.windows.find((w) => w.title === "crew");
    expect(crew?.tabs.map((t) => t.label)).toEqual(["worker"]);
    expect(grouped.unmatched).toEqual(["other"]);
  });

  it("should match sessions by project-prefix segments, never by string prefix", () => {
    useLang("en");
    const nested = session("h2a/tmp/worktrees/ptycode");
    const lookalike = session("h2a2/tmp/worktrees/ptycode");
    const config = cfg({ groups: [{ title: "fleet", projectPrefixes: ["h2a"] }] });
    const grouped = groupSessions([nested, lookalike], config);
    const fleet = grouped.windows.find((w) => w.title === "fleet");
    expect(fleet?.tabs.map((t) => t.label)).toContain("h2a/tmp/worktrees/ptycode");
    expect(grouped.unmatched).toContain("h2a2/tmp/worktrees/ptycode");
  });

  it("should refuse unknown matcher keys and non-array groups before launching anything", () => {
    useLang("en");
    // An unknown matcher key is a config error, never a silent no-match.
    expect(validateLayoutGroups([{ title: "crew", labels: ["worker"], bogus: [] }] as never)).toHaveLength(1);
    expect(validateLayoutGroups([{ title: "crew", projectPrefixes: "h2a" }] as never)).toHaveLength(1);
    // A non-array groups value refuses instead of silently becoming [].
    expect(() => {
      const dir = fakeHome();
      process.env.REMOTE_CLI_CONFIG_HOME = dir;
      mkdirSync(join(dir, ".config", "sentropic", "h2a"), { recursive: true });
      writeFileSync(
        join(dir, ".config", "sentropic", "h2a", "config.json"),
        JSON.stringify({ layout: { groups: "invalide" } }),
      );
      getLayoutConfig();
    }).toThrow(/invalid layout/i);
  });

  it("should exclude unclassified remote rows from the default plan and name them", () => {
    const tabs = [{ id: "r1", label: "delegated-unknown", cwd: "/fixture" }];
    expect(selectRemoteTabsForGroups(tabs)).toEqual([]);
    expect(selectRemoteTabsForGroups(tabs, { includeSecondary: true })).toEqual([]);
  });
});
