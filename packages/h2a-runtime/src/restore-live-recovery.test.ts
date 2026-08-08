/**
 * Restore live-session recovery invariants (Lot A §4.1/§4.3, folded into
 * #199).
 *
 * A LIVE managed row must never be lost to a broken conversation id: the
 * process exists and is re-enterable by its persisted kind + exact managed
 * name alone. Host-probe failures are UNKNOWN (fail closed, never a second
 * writer), controller presence drives native visibility, and a dual-host
 * identity refuses every choice.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const listLocalSessionsWithDiagnostics = vi.hoisted(() => vi.fn());
const killLocalSession = vi.hoisted(() => vi.fn());
const spawn = vi.hoisted(() => vi.fn());
const listNativeSessions = vi.hoisted(() => vi.fn());

vi.mock("./tmux.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./tmux.js")>();
  return { ...actual, killLocalSession, listLocalSessionsWithDiagnostics };
});

vi.mock("./native-host.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./native-host.js")>();
  return { ...actual, listNativeSessions };
});

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, spawn };
});

const {
  dropDualHostIdentities,
  groupSessions,
  launchLayout,
  reconcileRunConvIds,
  registrySessions,
  tabCommand,
} = await import("./restore.js");
type LegacySessionEvidence = import("./restore.js").LegacySessionEvidence;
type ManagedLiveLookup = import("./restore.js").ManagedLiveLookup;
type RegistryEntry = import("./registry.js").RegistryEntry;

const HOME = "/home/live-recovery-test";
const CONV_UUID = "3f2504e0-4f89-41d3-9a0c-0305e82c3303";
const iso = new Date().toISOString();

const evidence: LegacySessionEvidence = {
  home: "/nonexistent-evidence-home",
  liveTmuxSessions: [],
};

const layoutCfg = {
  maxAgeHours: 48,
  maxPerWindow: 12,
  sharedWindows: 1,
  multiSession: {},
  multiSessionDefault: 1,
  groups: [],
};

/** §6 fixture: a live native run row whose convId IS its label (broken). */
const brokenLiveNativeRow = (): RegistryEntry => ({
  id: "h-infra",
  label: "h-infra",
  convId: "h-infra",
  tool: "claude",
  kind: "local-native",
  cwd: `${HOME}/src/proj`,
  tmuxSession: "h2a-h-infra",
  sessionClass: "human",
  source: "run",
  enrolledAt: iso,
  lastSeenAt: iso,
});

const liveNativeLookup =
  (name: string): ManagedLiveLookup =>
  (kind, names) =>
    kind === "local-native" && names.includes(name)
      ? { state: "live", name }
      : { state: "dead" };

function runningNative(id: string, controlled: boolean | undefined) {
  return { id, pid: 4242, status: "running" as const, exit: null, controlled };
}

function mapFileContent(): string {
  expect(spawn).toHaveBeenCalledTimes(1);
  const args = spawn.mock.calls[0]![1] as string[];
  return readFileSync(args.at(-1)!, "utf8");
}

let previousRuntimeDir: string | undefined;
let runtimeDir: string;

beforeEach(() => {
  listLocalSessionsWithDiagnostics.mockReset();
  listLocalSessionsWithDiagnostics.mockReturnValue({ sessions: [], known: true });
  listNativeSessions.mockReset();
  listNativeSessions.mockReturnValue([]);
  killLocalSession.mockReset();
  spawn.mockReset();
  spawn.mockReturnValue({ stderr: { on: vi.fn() }, unref: vi.fn() });
  previousRuntimeDir = process.env.XDG_RUNTIME_DIR;
  runtimeDir = mkdtempSync(join(tmpdir(), "h2a-live-recovery-"));
  process.env.XDG_RUNTIME_DIR = runtimeDir;
});

afterEach(() => {
  if (previousRuntimeDir === undefined) delete process.env.XDG_RUNTIME_DIR;
  else process.env.XDG_RUNTIME_DIR = previousRuntimeDir;
  rmSync(runtimeDir, { recursive: true, force: true });
});

describe("attach-live before the broken-convId gate (§4.1)", () => {
  it("RESTORE_LIVE_UNRESOLVED_MANAGED_SESSION_REENTERS_BY_EXACT_NATIVE_NAME", () => {
    const row = brokenLiveNativeRow();
    const resolution = reconcileRunConvIds([row], () => undefined, evidence);
    // The conversation id is genuinely unresolved (convId === label).
    expect(resolution.unresolvedRunIds.has("h-infra")).toBe(true);

    // PLAN: the LIVE row survives the gate as an attach-live session.
    const sessions = registrySessions(
      HOME,
      [row],
      resolution,
      evidence,
      liveNativeLookup("h2a-h-infra"),
    );
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.attachLive).toBe(true);
    expect(sessions[0]!.managedName).toBe("h2a-h-infra");
    // No conversation id may survive into the plan for it.
    expect(sessions[0]!.sid).toBe("");

    const { windows } = groupSessions(sessions, layoutCfg);
    const tabs = windows.flatMap((w) => w.tabs);
    expect(tabs).toHaveLength(1);

    // RENDER: exactly one exact-name attach; never a run/resume/replace.
    expect(tabCommand(tabs[0]!)).toBe("h2a attach 'h2a-h-infra'");

    listNativeSessions.mockReturnValue([runningNative("h2a-h-infra", false)]);
    const result = launchLayout(
      [{ title: "work", tabs }],
      { write: vi.fn(() => true) } as unknown as NodeJS.WriteStream,
    );
    expect(result).toEqual({ opened: 1, skippedLive: [] });
    const command = mapFileContent();
    expect(command).toContain("h2a attach 'h2a-h-infra'");
    expect(command).not.toMatch(/h2a run|--resume|--replace/);
    // The live process is untouched: nothing was killed.
    expect(killLocalSession).not.toHaveBeenCalled();
  });

  it("RESTORE_PERSISTED_DUAL_HOST_IDENTITY_FAILS_CLOSED", () => {
    const native = brokenLiveNativeRow();
    const tmuxTwin: RegistryEntry = {
      ...brokenLiveNativeRow(),
      id: "h-infra-legacy",
      kind: "local-tmux",
      convId: CONV_UUID,
    };
    const sessions = registrySessions(
      HOME,
      [native, tmuxTwin],
      undefined,
      evidence,
    );
    expect(sessions).toHaveLength(2);
    const { kept, ambiguousNames } = dropDualHostIdentities(sessions);
    expect(kept).toEqual([]);
    expect(ambiguousNames).toEqual(["h2a-h-infra"]);
  });
});

describe("native controller visibility (§4.3)", () => {
  const controlledTab = () => {
    const sessions = registrySessions(
      HOME,
      [{ ...brokenLiveNativeRow(), convId: CONV_UUID }],
      undefined,
      evidence,
    );
    const { windows } = groupSessions(sessions, layoutCfg);
    return windows.flatMap((w) => w.tabs);
  };

  it("RESTORE_LIVE_CONTROLLED_NATIVE_SESSION_IS_ALREADY_VISIBLE_NOT_RELAUNCHED", () => {
    listNativeSessions.mockReturnValue([runningNative("h2a-h-infra", true)]);
    const write = vi.fn(() => true);

    const result = launchLayout(
      [{ title: "work", tabs: controlledTab() }],
      { write } as unknown as NodeJS.WriteStream,
    );
    expect(result).toEqual({ opened: 0, skippedLive: ["h-infra"] });
    expect(spawn).not.toHaveBeenCalled();

    // Even --reattach must not open a competing controller.
    const reattach = launchLayout(
      [{ title: "work", tabs: controlledTab() }],
      { write } as unknown as NodeJS.WriteStream,
      { reattach: true },
    );
    expect(reattach).toEqual({ opened: 0, skippedLive: ["h-infra"] });
    expect(spawn).not.toHaveBeenCalled();
    expect(write.mock.calls.map((c) => String(c[0])).join("")).toContain(
      "already controlled",
    );
  });

  it("RESTORE_HOST_PROBE_UNKNOWN_NEVER_CREATES_A_SECOND_WRITER", () => {
    // The native inventory read FAILS: the view is unknown — that is not a
    // death certificate, so nothing may be relaunched over it.
    listNativeSessions.mockImplementation(() => {
      throw new Error("native host probe down");
    });
    const write = vi.fn(() => true);

    const result = launchLayout(
      [
        {
          title: "work",
          tabs: [
            // Recorded native tab WITH a resolvable conversation: a naive
            // dead-default would relaunch it — a potential second writer.
            ...controlledTab(),
            // Scan tab (no recorded host): its launch would default to the
            // native host, equally unprovable.
            { cwd: "/repo/scan", label: "scan", tool: "claude", sid: CONV_UUID },
          ],
        },
      ],
      { write } as unknown as NodeJS.WriteStream,
    );
    expect(result.opened).toBe(0);
    expect(spawn).not.toHaveBeenCalled();
    const output = write.mock.calls.map((c) => String(c[0])).join("");
    expect(output).toContain("UNKNOWN");
    expect(output).not.toContain("h2a run");
  });
});

describe("exact managed identity, never slug-union host choice", () => {
  it("RESTORE_EXACT_MANAGED_IDENTITY_BEATS_SAME_SLUG_ON_OTHER_HOST", () => {
    // A legacy tmux session shares the SLUG "h-infra" under another exact
    // name; the recorded native tab must attach ITS exact name, not the
    // first slug match on the other host.
    listLocalSessionsWithDiagnostics.mockReturnValue({
      sessions: [
        {
          name: "remote-h-infra",
          slug: "h-infra",
          profile: "claude",
          path: "/repo/other",
          attached: false,
        },
      ],
      known: true,
    });
    listNativeSessions.mockReturnValue([runningNative("h2a-h-infra", false)]);

    const sessions = registrySessions(
      HOME,
      [{ ...brokenLiveNativeRow(), convId: CONV_UUID }],
      undefined,
      evidence,
    );
    const { windows } = groupSessions(sessions, layoutCfg);
    const result = launchLayout(
      windows,
      { write: vi.fn(() => true) } as unknown as NodeJS.WriteStream,
    );
    expect(result).toEqual({ opened: 1, skippedLive: [] });
    const command = mapFileContent();
    expect(command).toContain("h2a attach 'h2a-h-infra'");
    expect(command).not.toContain("remote-h-infra");
    expect(command).not.toMatch(/h2a run|--replace/);
  });
});

describe("legacy tmux drain view", () => {
  it("DRAIN_ATTACH_PRESERVES_LEGACY_TMUX_PID_AND_NEVER_CREATES_TMUX", () => {
    const lane = {
      name: "h2a-lane",
      slug: "lane",
      profile: "claude",
      path: "/repo/lane",
      tmuxServerPid: "4242",
      attached: false,
    };
    const tmuxState = { sessions: [lane] };
    listLocalSessionsWithDiagnostics.mockImplementation(() => ({
      sessions: tmuxState.sessions,
      known: true,
    }));
    killLocalSession.mockImplementation((name: string) => {
      tmuxState.sessions = tmuxState.sessions.filter((s) => s.name !== name);
      return true;
    });

    const result = launchLayout(
      [
        {
          title: "work",
          tabs: [
            {
              cwd: "/repo/lane",
              label: "lane",
              tool: "claude",
              sid: CONV_UUID,
              hostKind: "local-tmux",
              managedName: "h2a-lane",
            },
          ],
        },
      ],
      { write: vi.fn(() => true) } as unknown as NodeJS.WriteStream,
    );
    expect(result).toEqual({ opened: 1, skippedLive: [] });
    const command = mapFileContent();
    // The live legacy process is re-entered through the host-agnostic attach
    // (dispatching to its persisted host); no tmux session is created and
    // the existing one is never killed — its PID survives.
    expect(command).toContain("h2a attach 'h2a-lane'");
    expect(command).not.toMatch(/h2a run|h2a resume|--replace/);
    expect(killLocalSession).not.toHaveBeenCalled();
    expect(
      tmuxState.sessions.find((s) => s.name === "h2a-lane")?.tmuxServerPid,
    ).toBe("4242");
  });
});
