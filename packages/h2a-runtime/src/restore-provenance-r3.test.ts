/**
 * Round-3 P1 (reviews pr382-r3, owner verbatim) — launch-initiator
 * provenance: an attached terminal is NOT proof of a human initiator.
 *
 * - `deriveLaunchInitiator`: managed markers / background / headless /
 *   `--secondary` ⇒ agent; explicit `--primary` or a live TTY with no
 *   marker ⇒ human; anything else ⇒ unknown (never default human).
 * - `deriveLegacySessionClass`: a transcript alone stays background (it
 *   proves a conversation exists, never a human initiator); only an
 *   explicit confirmation promotes.
 * - 451-row synthetic registry (reviewer shape): only the declared human
 *   primaries are admitted; delegated rows are excluded as secondary;
 *   classless transcript rows and terminal-rule human rows are listed as
 *   unclassified — with same names/paths admitted once human provenance is
 *   explicitly recorded (no name/path filter anywhere).
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  deriveLaunchInitiator,
  type LaunchInitiator,
} from "./session-class.js";
import { hookLaunchInitiator } from "./enroll.js";
import {
  deriveLegacySessionClass,
  registrySessions,
  type LegacySessionEvidence,
  type RestoreExclusions,
} from "./restore.js";
import type { RegistryEntry } from "./registry.js";
import { encodeCwd } from "./convsync.js";

const scratchDirs: string[] = [];

afterEach(() => {
  for (const dir of scratchDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function newExclusions(): RestoreExclusions {
  return { secondary: [], unclassified: [] };
}

describe("round-3 P1: launch initiator derivation", () => {
  it("should never default an undetermined origin to human", () => {
    const unknown: LaunchInitiator | undefined = deriveLaunchInitiator({});
    expect(unknown).toBeUndefined();
    // Pipes with no marker (tool-harness invocation) stay unknown too.
    expect(
      deriveLaunchInitiator({
        stdinIsTTY: false,
        stdoutIsTTY: false,
      }),
    ).toBeUndefined();
  });

  it("should record human only on explicit declaration or a live TTY without markers", () => {
    expect(
      deriveLaunchInitiator({ primary: true }),
    ).toBe("human");
    expect(
      deriveLaunchInitiator({
        stdinIsTTY: true,
        stdoutIsTTY: true,
      }),
    ).toBe("human");
  });

  it("should record agent on managed markers, background/headless, or --secondary", () => {
    expect(
      deriveLaunchInitiator({ secondary: true }),
    ).toBe("agent");
    expect(
      deriveLaunchInitiator({ background: true }),
    ).toBe("agent");
    expect(
      deriveLaunchInitiator({ headless: true }),
    ).toBe("agent");
    // A delegating PTY stamps its agents: their launches are agent work
    // even from a live TTY.
    expect(
      deriveLaunchInitiator({
        stdinIsTTY: true,
        stdoutIsTTY: true,
        envSessionClass: "background",
      }),
    ).toBe("agent");
    expect(
      deriveLaunchInitiator({
        stdinIsTTY: true,
        stdoutIsTTY: true,
        envJobId: "job-1",
      }),
    ).toBe("agent");
  });
});

describe("round-3 P1: hook initiator inheritance", () => {
  const entries: RegistryEntry[] = [
    {
      id: "run-human",
      tool: "claude",
      kind: "local-tmux",
      cwd: "/w/human",
      source: "run",
      label: "human",
      convId: "conv-human",
      tmuxSession: "h2a-human",
      enrolledAt: "2026-01-01T00:00:00.000Z",
      lastSeenAt: "2026-01-01T00:00:00.000Z",
      sessionClass: "human",
      launchInitiator: "human",
    },
  ];
  it("should inherit the recorded initiator from the run row", () => {
    expect(hookLaunchInitiator({}, entries, "conv-human")).toBe("human");
  });
  it("should let managed markers in the hook env win", () => {
    expect(
      hookLaunchInitiator({ REMOTE_JOB_ID: "job-9" }, entries, "conv-human"),
    ).toBe("agent");
    expect(
      hookLaunchInitiator(
        { H2A_SESSION_CLASS: "background" },
        entries,
        "conv-human",
      ),
    ).toBe("agent");
  });
  it("should stay unknown with no marker and no recorded row", () => {
    expect(hookLaunchInitiator({}, entries, "conv-unknown")).toBeUndefined();
  });
});

describe("round-3 P1: legacy transcript never promotes", () => {
  it("should keep a classless transcript row background without confirmation", () => {
    const home = mkdtempSync(join(tmpdir(), "h2a-r3-home-"));
    scratchDirs.push(home);
    const cwd = join(home, "src", "legacy");
    const convId = "conv-legacy";
    mkdirSync(join(home, ".claude", "projects", encodeCwd(cwd)), {
      recursive: true,
    });
    writeFileSync(
      join(home, ".claude", "projects", encodeCwd(cwd), `${convId}.jsonl`),
      '{"type":"summary","summary":"old work"}\n',
    );
    const row: RegistryEntry = {
      id: "legacy-1",
      tool: "claude",
      kind: "local-tmux",
      cwd,
      source: "run",
      convId,
      tmuxSession: "h2a-legacy",
      enrolledAt: "2026-01-01T00:00:00.000Z",
      lastSeenAt: "2026-01-01T00:00:00.000Z",
    };
    const evidence: LegacySessionEvidence = { home, liveTmuxSessions: [] };
    expect(deriveLegacySessionClass(row, evidence)).toBe("background");
    // Explicit recovery path: a human confirmation promotes.
    expect(
      deriveLegacySessionClass(row, {
        ...evidence,
        humanConfirmedIds: new Set(["legacy-1"]),
      }),
    ).toBe("human");
  });
});

describe("round-3 P1: 451-row synthetic registry admits only declared human primaries", () => {
  it("should admit 5 declared primaries (+2 provenance controls), exclude 100 delegated, 200 background, 100 transcript-only, 46 terminal-rule", () => {
    const home = mkdtempSync(join(tmpdir(), "h2a-r3-451-"));
    scratchDirs.push(home);
    const src = join(home, "src");
    const now = "2026-10-20T00:00:00.000Z";
    let seq = 0;
    const base = (over: Partial<RegistryEntry>): RegistryEntry => {
      seq += 1;
      return {
        id: `row-${seq}`,
        tool: "claude",
        kind: "local-tmux",
        cwd: join(src, `proj-${seq}`),
        tmuxSession: `h2a-row-${seq}`,
        convId: `conv-${seq}`,
        enrolledAt: now,
        lastSeenAt: now,
        source: "run",
        ...over,
      };
    };
    const entries: RegistryEntry[] = [];

    // 5 declared human primaries: explicit facet + recorded human initiator.
    const declaredLabels: string[] = [];
    for (let i = 0; i < 5; i++) {
      const label = `declared-human-${i}`;
      declaredLabels.push(label);
      entries.push(
        base({
          label,
          cwd: join(src, `declared-${i}`),
          sessionClass: "human",
          launchInitiator: "human",
          restoreFacet: "primary",
        }),
      );
    }

    // 100 delegated with recorded provenance (visible terminal, transcript
    // on disk for half of them — provenance still wins).
    for (let i = 0; i < 100; i++) {
      entries.push(
        base({
          label: `delegated-${i}`,
          cwd: join(src, `delegated-${i}`),
          sessionClass: "human",
          delegationOrigin: i % 2 === 0 ? "mcp:h2a_run" : "cli:h2a-delegate",
          ...(i % 3 === 0 ? { parent: `job-parent-${i}` } : {}),
        }),
      );
    }

    // 200 explicit background (half role:job without class).
    for (let i = 0; i < 200; i++) {
      if (i % 2 === 0) {
        entries.push(
          base({ label: `bg-${i}`, sessionClass: "background" }),
        );
      } else {
        const row = base({ label: `job-${i}`, role: "job" });
        delete row.sessionClass;
        entries.push(row);
      }
    }

    // 100 classless legacy rows WITH a real transcript file each.
    for (let i = 0; i < 100; i++) {
      const cwd = join(src, `legacy-${i}`);
      const convId = `conv-legacy-${i}`;
      mkdirSync(join(home, ".claude", "projects", encodeCwd(cwd)), {
        recursive: true,
      });
      writeFileSync(
        join(home, ".claude", "projects", encodeCwd(cwd), `${convId}.jsonl`),
        '{"type":"summary","summary":"old work"}\n',
      );
      const row = base({ label: `legacy-${i}`, cwd, convId });
      delete row.sessionClass;
      entries.push(row);
    }

    // 46 historical automations stamped human by the old attached-terminal
    // rule: no delegation, no initiator, no facet. Same name/path shapes
    // the owner reported (worktree-style names and a nested worktree cwd) —
    // none of which may decide the outcome.
    const wtNames = [
      "bpmn-canvas-wt-x24-reseal",
      "graphify-wt-livegit",
    ];
    for (let i = 0; i < 46; i++) {
      entries.push(
        base({
          label: i < wtNames.length ? wtNames[i]! : `auto-${i}`,
          cwd:
            i === 1
              ? join(src, "bpmn-moddle-py", "tmp", "worktrees", "seal-l3")
              : join(src, `auto-wt-${i}`),
          sessionClass: "human",
        }),
      );
    }

    // Positive control: the SAME worktree names/paths, but with explicitly
    // recorded human provenance — admitted (no name/path filter decides).
    const controlLabels = ["bpmn-canvas-wt-x24-reseal", "graphify-wt-livegit"];
    for (const label of controlLabels) {
      entries.push(
        base({
          id: `control-${label}`,
          label,
          cwd: join(src, "bpmn-moddle-py", "tmp", "worktrees", "seal-l3"),
          sessionClass: "human",
          launchInitiator: "human",
          restoreFacet: "primary",
        }),
      );
    }

    expect(entries).toHaveLength(453);

    const excluded = newExclusions();
    const sessions = registrySessions(
      home,
      entries,
      undefined,
      { home, liveTmuxSessions: [] },
      undefined,
      [],
      { collectExcluded: excluded },
    );
    const admitted = sessions.map((s) => s.label).sort();
    expect(admitted).toEqual([...declaredLabels, ...controlLabels].sort());
    // 100 delegated + 100 role:job (secondary by construction, D12):
    // named, never restored by default.
    expect(excluded.secondary).toHaveLength(200);
    // 100 transcript-only + 46 terminal-rule humans: named, never restored.
    expect(excluded.unclassified).toHaveLength(146);
    // The 100 explicit-background rows stay silent (no evidence to name).
    expect(
      excluded.unclassified.filter((name) => name.startsWith("bg-")),
    ).toEqual([]);
  });
});
