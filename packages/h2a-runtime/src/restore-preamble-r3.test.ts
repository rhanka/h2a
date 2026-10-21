/**
 * Round-3 P2 (reviews pr382-r3) — the restore preamble selects the relevant
 * native targets BEFORE any liveness probe and reuses one inventory: zero
 * probes for excluded rows. Delegated, background/job, classless and
 * terminal-rule rows cost no probe; only positively-classified primaries on
 * a native host are probed (intersected with the one batch inventory).
 */
import { describe, expect, it } from "vitest";

import {
  fetchSelectedNativeSubtrees,
  selectRestoreNativeTargets,
} from "./restore.js";
import type { RegistryEntry } from "./registry.js";

const NOW = "2026-10-20T00:00:00.000Z";

function entry(over: Partial<RegistryEntry> & { id: string }): RegistryEntry {
  return {
    tool: "claude",
    kind: "local-native",
    cwd: "/w/proj",
    tmuxSession: `h2a-${over.id}`,
    convId: `conv-${over.id}`,
    enrolledAt: NOW,
    lastSeenAt: NOW,
    source: "run",
    sessionClass: "human",
    launchInitiator: "human",
    ...over,
  } as RegistryEntry;
}

const PROBED: string[] = [];

function fakes(running: string[]) {
  PROBED.length = 0;
  return {
    listRunningNative: () => running.slice(),
    probeForeground: (name: string) => {
      PROBED.push(name);
      if (!running.includes(name)) return undefined;
      return [
        {
          pid: 1000,
          command: "claude",
          args: ["claude"],
          startedAtMs: 1,
          ppid: 999,
        },
      ];
    },
  };
}

describe("round-3 P2: select restore native targets before probing", () => {
  it("should select only positively-classified primaries on a native host", () => {
    const entries = [
      entry({ id: "prim", label: "prim" }),
      entry({ id: "facet-prim", label: "facet-prim", restoreFacet: "primary" }),
      // Excluded rows: delegation, background, job, classless, terminal-rule.
      entry({
        id: "deleg",
        label: "deleg",
        delegationOrigin: "mcp:h2a_run",
      }),
      entry({ id: "bg", label: "bg", sessionClass: "background" }),
      entry({ id: "job", label: "job", role: "job" }),
      { ...entry({ id: "classless", label: "classless" }), sessionClass: undefined },
      { ...entry({ id: "termrule", label: "termrule" }), launchInitiator: undefined },
      // A tmux primary needs no native probe.
      entry({ id: "tmux", label: "tmux", kind: "local-tmux" }),
    ];
    expect(selectRestoreNativeTargets(entries).sort()).toEqual([
      "h2a-facet-prim",
      "h2a-prim",
    ]);
    // Explicit opt-in re-admits secondary native targets: the delegated
    // row and the role:job row (secondary by construction, D12).
    expect(
      selectRestoreNativeTargets(entries, { includeSecondary: true }).sort(),
    ).toEqual(["h2a-deleg", "h2a-facet-prim", "h2a-job", "h2a-prim"]);
  });

  it("should probe only selected running targets, zero probes for excluded rows", () => {
    const entries = [
      entry({ id: "prim", label: "prim" }),
      entry({
        id: "deleg",
        label: "deleg",
        delegationOrigin: "cli:h2a-delegate",
      }),
      entry({ id: "bg", label: "bg", sessionClass: "background" }),
      entry({ id: "gone", label: "gone" }),
    ];
    // h2a-gone is selected (a classified primary) but absent from the one
    // batch inventory: skipped with zero probes.
    const subtrees = fetchSelectedNativeSubtrees(
      entries,
      fakes(["h2a-prim", "h2a-deleg", "h2a-bg"]),
    );
    expect(subtrees.map((s) => s.name)).toEqual(["h2a-prim"]);
    expect(PROBED).toEqual(["h2a-prim"]);
  });

  it("should probe nothing when no target is relevant or the inventory is unreadable", () => {
    const entries = [
      entry({
        id: "deleg",
        label: "deleg",
        delegationOrigin: "mcp:h2a_run",
      }),
    ];
    expect(
      fetchSelectedNativeSubtrees(entries, fakes(["h2a-deleg"])),
    ).toEqual([]);
    expect(PROBED).toEqual([]);
    expect(
      fetchSelectedNativeSubtrees([entry({ id: "prim", label: "prim" })], {
        listRunningNative: () => {
          throw new Error("no inventory");
        },
        probeForeground: (name: string) => {
          PROBED.push(name);
          return undefined;
        },
      }),
    ).toEqual([]);
    expect(PROBED).toEqual([]);
  });
});
