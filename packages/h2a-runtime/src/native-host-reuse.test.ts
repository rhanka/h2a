/**
 * Re-use paths honor the PERSISTED native host.
 *
 * Invariant under test: an existing session is never re-routed — resume,
 * restore, attach and stop choose the terminal host from the session's
 * persisted registry `kind`, and use liveness only as the precondition of
 * the act itself. The dedicated native resolver exists because the shared
 * local-tmux target filter is tmux-scoped by construction (its second caller
 * iterates live tmux sessions inside the destructive relaunch planner) and
 * must not be broadened.
 *
 * Dated measure: the fleet registry held 0 kind:"local-native" entries as of
 * 2026-08-08 — these paths prepare the re-use side for the native sessions
 * #178 will produce.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  registryEntriesForNativeTarget,
  resolveManagedHost,
  type RegistryEntry,
} from "./registry.js";
import { planRelaunch } from "./relaunch.js";
import {
  groupSessions,
  registrySessions,
  tabCommand,
  type LegacySessionEvidence,
} from "./restore.js";
import { main, registryEntryForResumeTarget } from "./index.js";

const SCRATCH_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  ".test-scratch",
  "native-host-reuse",
);

// Unique per-process names so the real tmux server (consulted first by the
// live-session resolution) can never hold a colliding session.
const SLUG = `reuse-p0-${process.pid}`;
const NATIVE_NAME = `h2a-${SLUG}`;
const CONV_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

const iso = new Date().toISOString();

const nativeEntry = (over: Partial<RegistryEntry> = {}): RegistryEntry => ({
  id: SLUG,
  label: SLUG,
  tool: "claude",
  kind: "local-native",
  cwd: "/home/reuse-test/src/proj",
  convId: CONV_ID,
  tmuxSession: NATIVE_NAME,
  sessionClass: "human",
  source: "run",
  enrolledAt: iso,
  lastSeenAt: iso,
  ...over,
});

const tmuxEntry = (over: Partial<RegistryEntry> = {}): RegistryEntry => ({
  id: "tmux-lane",
  label: "tmux-lane",
  tool: "claude",
  kind: "local-tmux",
  cwd: "/home/reuse-test/src/proj",
  convId: CONV_ID,
  tmuxSession: "h2a-tmux-lane",
  sessionClass: "human",
  source: "run",
  enrolledAt: iso,
  lastSeenAt: iso,
  ...over,
});

// Evidence stub: sessionClass:"human" entries classify without touching the
// filesystem or a live tmux server.
const evidence: LegacySessionEvidence = {
  home: "/nonexistent-evidence-home",
  liveTmuxSessions: [],
};

describe("persisted native host on re-use paths", () => {
  it("a persisted native session resumes on its native host, never re-routed to tmux", () => {
    const entry = nativeEntry();
    // By slug/label and by exact persisted native session name: both resolve
    // to the native entry, whose kind:"local-native" is what the resume verb
    // maps to the native host — resume no longer falls through to the
    // default-host path for a recorded native session.
    for (const target of [SLUG, NATIVE_NAME]) {
      const hit = registryEntryForResumeTarget(target, undefined, [entry], evidence);
      expect(hit, `target ${target}`).toBeDefined();
      expect(hit!.id).toBe(SLUG);
      expect(hit!.kind).toBe("local-native");
    }
  });

  it("restore preserves the persisted native host for a non-live native session", () => {
    const home = "/home/reuse-test";
    const sessions = registrySessions(home, [nativeEntry()], undefined, evidence);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.hostKind).toBe("local-native");

    const { windows } = groupSessions(sessions, {
      maxAgeHours: 48,
      maxPerWindow: 12,
      sharedWindows: 1,
      multiSession: {},
      multiSessionDefault: 1,
      groups: [],
    });
    const tabs = windows.flatMap((w) => w.tabs);
    expect(tabs).toHaveLength(1);
    expect(tabs[0]!.hostKind).toBe("local-native");

    // Non-live launch command (empty live set): the recorded host is pinned —
    // it survives even a fleet-wide H2A_SESSION_HOST=tmux valve instead of
    // being silently re-routed.
    const cmd = tabCommand(tabs[0]!);
    expect(cmd.startsWith("H2A_SESSION_HOST=native h2a run 'claude'")).toBe(true);
    expect(cmd).toContain(`--resume '${CONV_ID}'`);
    expect(cmd).not.toContain("--tmux");

    // Symmetric preservation: a recorded tmux session is pinned to tmux so
    // the native creation default cannot re-route it either. (Which host a
    // DEAD tmux session should be relaunched on is a reopened policy
    // question; this pins the #199 as-is behavior.)
    const tmuxSessions = registrySessions(home, [tmuxEntry()], undefined, evidence);
    expect(tmuxSessions[0]!.hostKind).toBe("local-tmux");
    const tmuxCmd = tabCommand({
      cwd: "/home/reuse-test/src/proj",
      label: "tmux-lane",
      tool: "claude",
      sid: CONV_ID,
      hostKind: "local-tmux",
    });
    expect(tmuxCmd.startsWith("h2a run 'claude'")).toBe(true);
    expect(tmuxCmd.endsWith(" --tmux")).toBe(true);
  });

  it("attach/stop select the host by persisted kind, not by liveness", () => {
    const entry = nativeEntry();
    // A momentarily-dead native session STAYS native: the recorded kind wins
    // without any probe at all, and a probe result cannot flip the host.
    const probesNever = {
      native: () => {
        throw new Error("a recorded row must resolve without probing");
      },
      tmux: () => {
        throw new Error("a recorded row must resolve without probing");
      },
    };
    expect(resolveManagedHost(NATIVE_NAME, [entry], probesNever)).toEqual({
      state: "recorded",
      kind: "local-native",
      name: NATIVE_NAME,
    });
    // A recorded tmux session is served by tmux — REGARDLESS of a live
    // homonymous native process (the F2 defect made this flip to native).
    expect(
      resolveManagedHost("h2a-tmux-lane", [tmuxEntry()], {
        native: () => "live",
        tmux: () => "dead",
      }),
    ).toEqual({ state: "recorded", kind: "local-tmux", name: "h2a-tmux-lane" });
    // Without any recorded entry the probe is pure DISCOVERY (a live session
    // whose registry row was lost) — exactly one positive probe wins, an
    // all-dead probe set is MISSING (never a silent tmux default), and a
    // probe failure is UNKNOWN, never death.
    expect(
      resolveManagedHost("h2a-ghost", [], {
        native: () => "live",
        tmux: () => "dead",
      }),
    ).toEqual({ state: "discovered", kind: "local-native", name: "h2a-ghost" });
    expect(
      resolveManagedHost("h2a-ghost", [], {
        native: () => "dead",
        tmux: () => "live",
      }),
    ).toEqual({ state: "discovered", kind: "local-tmux", name: "h2a-ghost" });
    expect(
      resolveManagedHost("h2a-ghost", [], {
        native: () => "dead",
        tmux: () => "dead",
      }),
    ).toEqual({ state: "missing" });
    expect(
      resolveManagedHost("h2a-ghost", [], {
        native: () => "unknown",
        tmux: () => "dead",
      }),
    ).toMatchObject({ state: "unknown" });
  });

  it("the tmux resolver and planRelaunch are unchanged for tmux targets", () => {
    const entry = tmuxEntry();
    // Resume resolution for a tmux target: exactly the pre-native behavior.
    const hit = registryEntryForResumeTarget("tmux-lane", undefined, [entry], evidence);
    expect(hit).toBeDefined();
    expect(hit!.kind).toBe("local-tmux");
    // The DEDICATED native resolver never claims a tmux entry — the guard
    // against accidental broadening in either direction.
    expect(registryEntriesForNativeTarget("tmux-lane", [entry])).toEqual([]);
    expect(registryEntriesForNativeTarget("h2a-tmux-lane", [entry])).toEqual([]);
    // planRelaunch still plans a dead tmux session from its own conversation.
    const plan = planRelaunch([
      {
        slug: "tmux-lane",
        name: "h2a-tmux-lane",
        profile: "claude",
        convId: "c-a",
        dead: true,
        activatable: false,
        indeterminate: false,
        activelyWorking: false,
      },
    ]);
    expect(plan.actions.map((a) => a.cmd)).toEqual(["claude --resume c-a"]);
    expect(plan.skipped).toEqual([]);
    // A tab without a recorded host keeps the exact legacy command — restore
    // pins nothing it does not know.
    expect(
      tabCommand({ cwd: "/x", label: "lbl", tool: "claude", sid: "c-a" }),
    ).toBe("h2a run 'claude' '/x' --resume 'c-a' --name 'lbl'");
  });
});

describe("attach/stop act gating on a dead recorded-native session (CLI level)", () => {
  let scratch: string;
  let prevConfigHome: string | undefined;
  let stderrLines: string[];
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mkdirSync(SCRATCH_ROOT, { recursive: true });
    scratch = mkdtempSync(join(SCRATCH_ROOT, "cli-"));
    const configDir = join(scratch, ".config", "sentropic", "h2a");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, "registry.json"),
      JSON.stringify({ version: 1, entries: [nativeEntry()] }, null, 2),
      "utf8",
    );
    prevConfigHome = process.env.REMOTE_CLI_CONFIG_HOME;
    process.env.REMOTE_CLI_CONFIG_HOME = scratch;
    process.exitCode = undefined;
    stderrLines = [];
    stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(((chunk: unknown) => {
        stderrLines.push(String(chunk));
        return true;
      }) as never);
  });

  afterEach(() => {
    stderrSpy.mockRestore();
    if (prevConfigHome === undefined) delete process.env.REMOTE_CLI_CONFIG_HOME;
    else process.env.REMOTE_CLI_CONFIG_HOME = prevConfigHome;
    process.exitCode = undefined;
    rmSync(scratch, { recursive: true, force: true });
  });

  it("attach refuses the act on a dead native session instead of re-routing to tmux", async () => {
    // The native host is not running in this environment, so the recorded
    // native session is momentarily dead: the host stays native and the ACT
    // is refused — no tmux attach of the same name is ever attempted.
    const code = await main(["node", "h2a", "attach", SLUG]);
    expect(code).toBe(1);
    const all = stderrLines.join("");
    expect(all).toContain(`native session ${SLUG} is not running; attach refused`);
  });

  it("stop acts on the native host for a dead recorded-native session", async () => {
    const code = await main(["node", "h2a", "stop", SLUG]);
    expect(code).toBe(1);
    const all = stderrLines.join("");
    // The failure is reported on the NATIVE host — the act failed on the
    // session's own host; it was not re-routed to a tmux kill.
    expect(all).toContain(`native session ${SLUG} could not be killed`);
  });
});
