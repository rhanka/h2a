import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  restoreStation,
  summarizeStationPlan,
  type RestoreStationPlan,
} from "./restore.js";
import type {
  DiscoveredSession,
  HostViewSnapshot,
  RestorePlanResult,
  RestoreSessionClassification,
} from "./restore-plan.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "h2a-restore-station-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function harness(overrides: {
  stdinIsTTY?: boolean;
  stdoutIsTTY?: boolean;
  plan?: RestoreStationPlan;
  group?: string;
  exitCode?: number;
} = {}) {
  const written: string[] = [];
  const plan = vi.fn(
    (): RestoreStationPlan => overrides.plan ?? { ok: true, live: 7, dead: 2 },
  );
  const launch = vi.fn((_args: readonly string[]) => overrides.exitCode ?? 0);
  const statePath = join(dir, "config", "station-state.json");
  const code = restoreStation({
    ...(overrides.group !== undefined ? { group: overrides.group } : {}),
    stdinIsTTY: overrides.stdinIsTTY ?? true,
    stdoutIsTTY: overrides.stdoutIsTTY ?? true,
    stderr: { write: (chunk: string) => written.push(String(chunk)) > 0 },
    plan,
    launch,
    statePath,
    locale: "en",
  });
  return { code, written: written.join(""), plan, launch, statePath };
}

describe("S1 step 2 — `h2a restore --station` entry (r2 Q4, plan 07-S1)", () => {
  it.each([
    ["stdin is not a TTY", { stdinIsTTY: false }],
    ["stdout is not a TTY", { stdoutIsTTY: false }],
    ["neither is a TTY", { stdinIsTTY: false, stdoutIsTTY: false }],
  ])("should refuse clearly and with no effect when %s", (_label, tty) => {
    const h = harness(tty);
    expect(h.code).toBe(1);
    expect(h.written).toBe(
      "[h2a] restore --station needs an interactive terminal (stdin and stdout must be a TTY); nothing was opened.\n",
    );
    // No effect: no inventory, no plan, no bridge, no state file.
    expect(h.plan).not.toHaveBeenCalled();
    expect(h.launch).not.toHaveBeenCalled();
    expect(existsSync(join(dir, "config"))).toBe(false);
    expect(readdirSync(dir)).toEqual([]);
  });

  it("should build the plan once and open the station bridge on a TTY", () => {
    const h = harness();
    expect(h.code).toBe(0);
    expect(h.plan).toHaveBeenCalledTimes(1);
    expect(h.launch).toHaveBeenCalledTimes(1);
    expect(h.launch.mock.calls[0]![0]).toEqual([
      "station",
      "--state-file",
      h.statePath,
      "--dead-count",
      "2",
    ]);
    expect(h.written).toBe("");
  });

  it("should return the exit code of the station bridge", () => {
    expect(harness({ exitCode: 1 }).code).toBe(1);
  });

  it("should say that a group argument is not used before S2, and still open", () => {
    const h = harness({ group: "docs" });
    expect(h.code).toBe(0);
    expect(h.written).toBe(
      '[h2a] group argument "docs" is not used by the station before lot S2.\n',
    );
    expect(h.launch).toHaveBeenCalledTimes(1);
  });

  it("should launch nothing when the plan is refused (unreadable registry)", () => {
    const h = harness({ plan: { ok: false, reason: "registry is absent" } });
    expect(h.code).toBe(1);
    expect(h.launch).not.toHaveBeenCalled();
    expect(h.written).toContain("restore refused: the local registry is unreadable (registry is absent)");
    expect(h.written).toContain("nothing was launched (fail closed)");
  });
});

function discovered(overrides: Partial<DiscoveredSession>): DiscoveredSession {
  return {
    project: "h2a",
    tool: "claude",
    sid: "conv-1",
    cwd: "/src/h2a",
    mtimeMs: 1,
    origin: "registry",
    restoreClass: "human",
    hostKind: "local-native",
    ...overrides,
  } as DiscoveredSession;
}

function selected(session: DiscoveredSession): RestoreSessionClassification {
  return {
    outcome: "selected",
    key: session.managedName ?? session.sid,
    label: session.managedName ?? session.sid,
    windowTitle: "core",
    tab: { cwd: session.cwd, label: session.sid },
    session,
  };
}

describe("S1 step 2 — live/dead count from the pure restore plan", () => {
  const hostView: HostViewSnapshot = {
    tmux: { known: true, sessions: [{ name: "h2a-legacy" }] as never },
    native: {
      known: true,
      complete: true,
      sessions: [
        { name: "h2a-conductor", controlled: false },
        { name: "h2a-api", controlled: true },
      ],
    },
  };

  it("should count each classified session once: live on a host, dead otherwise", () => {
    const classifications: RestoreSessionClassification[] = [
      selected(discovered({ managedName: "h2a-conductor" })),
      selected(discovered({ managedName: "h2a-api" })),
      selected(discovered({ managedName: "h2a-legacy", hostKind: "local-tmux" })),
      selected(discovered({ managedName: "h2a-dead-1" })),
      {
        outcome: "explicit-overflow",
        key: "h2a-dead-2",
        label: "dead-2",
        groupTitle: "core",
        reason: "explicit-group-cap",
        tab: { cwd: "/src/h2a", label: "dead-2" },
        session: discovered({ managedName: "h2a-dead-2" }),
      },
      {
        outcome: "refused",
        key: "h2a-dead-3",
        label: "dead-3",
        reason: "unresolved-conversation" as never,
        session: discovered({ managedName: "h2a-dead-3" }),
      },
      // A remote tab is neither a live native session nor a dead one.
      {
        outcome: "selected",
        key: "scw-1",
        label: "remote",
        windowTitle: "full remote",
        tab: { cwd: "/", label: "remote", remoteId: "scw-1" },
      },
    ];
    const plan = { ok: true, classifications } as unknown as RestorePlanResult;
    expect(summarizeStationPlan(plan, hostView)).toEqual({ ok: true, live: 3, dead: 3 });
  });

  it("should carry the refusal of an unreadable registry", () => {
    const plan = {
      ok: false,
      refusalReason: "registry-unreadable",
      refusalDetail: "registry is absent",
      classifications: [],
    } as unknown as RestorePlanResult;
    expect(summarizeStationPlan(plan, hostView)).toEqual({ ok: false, reason: "registry is absent" });
  });

  it("should never read an unknown host view as dead sessions", () => {
    const plan = {
      ok: true,
      classifications: [selected(discovered({ managedName: "h2a-conductor" }))],
    } as unknown as RestorePlanResult;
    const unknown: HostViewSnapshot = { tmux: { known: false }, native: { known: false } };
    expect(summarizeStationPlan(plan, unknown)).toEqual({ ok: true, live: 0, dead: 0 });
  });
});
