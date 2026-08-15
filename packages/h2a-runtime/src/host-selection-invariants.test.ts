/**
 * Host-selection invariants for acts on managed local sessions (Lot A,
 * folded into #199).
 *
 * The acceptance invariant: AN OPTION EXPRESSES AN INTENT FOR A NEW SESSION;
 * IT MUST NEVER WIN OVER THE RECORDED HOST OF AN EXISTING SESSION. The
 * symmetric resolver (resolveManagedHost) consults BOTH persisted kinds,
 * fails closed on dual rows and on probe failures, and probes only for
 * sessions with no registry row. `--tmux` remains a PERMANENT first-class
 * opt-in creation switch (owner-ratified): only the DEFAULT host is native.
 *
 * Every external process surface is mocked: no tmux session, native session
 * or terminal is ever created or killed by this file.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tmuxAvailable = vi.hoisted(() => vi.fn());
const startLocalSession = vi.hoisted(() => vi.fn());
const attachLocalSession = vi.hoisted(() => vi.fn());
const killLocalSession = vi.hoisted(() => vi.fn());
const listLocalSessions = vi.hoisted(() => vi.fn());
const listLocalSessionsWithDiagnostics = vi.hoisted(() => vi.fn());
const findLocalSession = vi.hoisted(() => vi.fn());
const resolveLocalSession = vi.hoisted(() => vi.fn());
const currentTmuxSessionIs = vi.hoisted(() => vi.fn());

const nativeSessionLiveness = vi.hoisted(() => vi.fn());
const nativeHostAvailable = vi.hoisted(() => vi.fn());
const startNativeSession = vi.hoisted(() => vi.fn());
const attachNativeSession = vi.hoisted(() => vi.fn());
const killNativeSessionTree = vi.hoisted(() => vi.fn());
const listNativeSessions = vi.hoisted(() => vi.fn());

vi.mock("./tmux.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./tmux.js")>();
  return {
    ...actual,
    tmuxAvailable,
    startLocalSession,
    attachLocalSession,
    killLocalSession,
    listLocalSessions,
    listLocalSessionsWithDiagnostics,
    findLocalSession,
    resolveLocalSession,
    currentTmuxSessionIs,
  };
});

vi.mock("./native-host.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./native-host.js")>();
  return {
    ...actual,
    nativeSessionLiveness,
    nativeHostAvailable,
    startNativeSession,
    attachNativeSession,
    killNativeSessionTree,
    listNativeSessions,
  };
});

// registry-internal probeTmuxSession shells out to `tmux has-session`; stub
// exactly that call so the probe is DETERMINISTIC (no session) on machines
// with or without tmux, while every other spawnSync stays real.
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    spawnSync: ((command: string, ...rest: unknown[]) =>
      command === "tmux"
        ? { status: 1, stdout: "", stderr: "", error: undefined }
        : (actual.spawnSync as (...a: unknown[]) => unknown)(
            command,
            ...rest,
          )) as typeof actual.spawnSync,
  };
});

const { main } = await import("./index.js");
const { enrollFromRun, loadRegistry, resolveManagedHost } = await import(
  "./registry.js"
);

/** Unwrap the 3-state registry read (must be "ok" in these fixtures). */
function loadEntries(): import("./registry.js").RegistryEntry[] {
  const read = loadRegistry();
  expect(read.state).toBe("ok");
  return read.state === "ok" ? read.entries : [];
}


const SCRATCH_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  ".test-scratch",
  "host-selection-invariants",
);

const CONV_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3302";
const iso = new Date().toISOString();

type Row = Record<string, unknown>;

const nativeRow = (slug: string, over: Row = {}): Row => ({
  id: slug,
  label: slug,
  tool: "claude",
  kind: "local-native",
  cwd: "/home/hostsel-test/src/proj",
  convId: CONV_ID,
  tmuxSession: `h2a-${slug}`,
  sessionClass: "human",
  source: "run",
  enrolledAt: iso,
  lastSeenAt: iso,
  ...over,
});

const tmuxRow = (slug: string, over: Row = {}): Row => ({
  id: slug,
  label: slug,
  tool: "claude",
  kind: "local-tmux",
  cwd: "/home/hostsel-test/src/proj",
  convId: CONV_ID,
  tmuxSession: `h2a-${slug}`,
  sessionClass: "human",
  source: "run",
  enrolledAt: iso,
  lastSeenAt: iso,
  ...over,
});

let scratch: string;
let prevConfigHome: string | undefined;
let stderrLines: string[];
let stderrSpy: ReturnType<typeof vi.spyOn>;

function writeRegistry(rows: Row[]): void {
  const configDir = join(scratch, ".config", "sentropic", "h2a");
  mkdirSync(configDir, { recursive: true });
  writeFileSync(
    join(configDir, "registry.json"),
    JSON.stringify({ version: 1, entries: rows }, null, 2),
    "utf8",
  );
}

beforeEach(() => {
  mkdirSync(SCRATCH_ROOT, { recursive: true });
  scratch = mkdtempSync(join(SCRATCH_ROOT, "cli-"));
  prevConfigHome = process.env.REMOTE_CLI_CONFIG_HOME;
  process.env.REMOTE_CLI_CONFIG_HOME = scratch;
  process.exitCode = undefined;

  tmuxAvailable.mockReset().mockReturnValue(true);
  startLocalSession
    .mockReset()
    .mockImplementation((_p: string, _c: string, _cwd: string, _a: string[], slug: string) => ({
      name: `h2a-${slug}`,
      slug,
      agentPane: "%0",
    }));
  attachLocalSession.mockReset().mockReturnValue(0);
  killLocalSession.mockReset().mockReturnValue(true);
  listLocalSessions.mockReset().mockReturnValue([]);
  listLocalSessionsWithDiagnostics
    .mockReset()
    .mockReturnValue({ sessions: [], known: true });
  findLocalSession.mockReset().mockReturnValue(undefined);
  resolveLocalSession.mockReset().mockReturnValue({ kind: "missing" });
  currentTmuxSessionIs.mockReset().mockReturnValue(false);

  nativeSessionLiveness.mockReset().mockReturnValue(false);
  nativeHostAvailable.mockReset().mockReturnValue({ ok: true });
  startNativeSession
    .mockReset()
    .mockImplementation((_p: string, _c: string, _cwd: string, _a: string[], label: string) => ({
      name: `h2a-${label}`,
      slug: label,
      pid: 4242,
    }));
  attachNativeSession.mockReset().mockReturnValue(0);
  killNativeSessionTree.mockReset().mockReturnValue(true);
  listNativeSessions.mockReset().mockReturnValue([]);

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

describe("F1 — resume host precedence", () => {
  it("RECORDED_NATIVE_LIVE_RESUME_CANNOT_BE_OVERRIDDEN_BY_TMUX_FLAG", async () => {
    const slug = `f1-native-${process.pid}`;
    writeRegistry([nativeRow(slug)]);
    // The homonymous native process is LIVE; the option must lose to the
    // recorded host — resume serves the native session, never a tmux twin.
    nativeSessionLiveness.mockReturnValue(true);

    const code = await main(["node", "h2a", "resume", slug, "--tmux"]);

    expect(code).toBe(0);
    expect(startNativeSession).toHaveBeenCalledTimes(1);
    expect(startLocalSession).not.toHaveBeenCalled();
    expect(killLocalSession).not.toHaveBeenCalled();
    expect(killNativeSessionTree).not.toHaveBeenCalled();
    expect(stderrLines.join("")).toContain(`--tmux ignored for ${slug}`);
    // The registry row keeps its recorded host after the act.
    const row = loadEntries().find((e) => e.id === slug);
    expect(row?.kind).toBe("local-native");
  });

  it("RECORDED_NATIVE_ATTACH_DISPATCHES_TO_THE_NATIVE_BRIDGE", async () => {
    const slug = `f1-native-attach-${process.pid}`;
    writeRegistry([nativeRow(slug)]);
    nativeSessionLiveness.mockReturnValue(true);

    const code = await main(["node", "h2a", "attach", slug]);

    expect(code).toBe(0);
    expect(attachNativeSession).toHaveBeenCalledWith(`h2a-${slug}`);
    expect(attachLocalSession).not.toHaveBeenCalled();
  });
});

describe("F2 — stop host attribution", () => {
  it("RECORDED_TMUX_STOP_CANNOT_KILL_HOMONYMOUS_NATIVE_PROCESS", async () => {
    const slug = `f2-lane-${process.pid}`;
    writeRegistry([tmuxRow(slug)]);
    // A LIVE homonymous native process exists; the persisted tmux row must
    // still win — the kill is dispatched to tmux, never to the native tree.
    nativeSessionLiveness.mockReturnValue(true);

    await main(["node", "h2a", "stop", slug]);

    expect(killNativeSessionTree).not.toHaveBeenCalled();
    expect(killLocalSession).toHaveBeenCalledWith(`h2a-${slug}`);
    expect(stderrLines.join("")).toContain(`local session ${slug}`);
  });
});

describe("dual-host identity fails closed", () => {
  const bothRows = (slug: string): Row[] => [
    tmuxRow(slug),
    nativeRow(`${slug}-n`, {
      label: slug,
      tmuxSession: `h2a-${slug}`,
    }),
  ];

  it("BOTH_HOSTS_LIVE_WITH_ONE_MANAGED_NAME_IS_AMBIGUOUS_FOR_ATTACH_STOP_RESUME_RESTORE", async () => {
    const slug = `dual-${process.pid}`;
    const exact = `h2a-${slug}`;
    writeRegistry(bothRows(slug));
    nativeSessionLiveness.mockReturnValue(true);

    // Resolver level: persisted rows of BOTH kinds for one exact identity
    // are ambiguous, regardless of any probe result; and with NO persisted
    // row, two positive probes are equally ambiguous — probe ORDER can never
    // pick a host.
    const registry = loadEntries();
    expect(resolveManagedHost(exact, registry)).toEqual({
      state: "ambiguous",
      candidates: ["local-native", "local-tmux"],
    });
    expect(
      resolveManagedHost("h2a-unrecorded", [], {
        native: () => "live",
        tmux: () => "live",
      }),
    ).toEqual({
      state: "ambiguous",
      candidates: ["local-native", "local-tmux"],
    });

    // CLI level: every act on the dual identity fails closed — exit 1, no
    // attach, no kill, no launch — whether addressed by exact name or slug
    // (the target-resolution layer reports the dual rows before any act).
    await main(["node", "h2a", "attach", exact]);
    expect(process.exitCode).toBe(1);
    expect(attachNativeSession).not.toHaveBeenCalled();
    expect(attachLocalSession).not.toHaveBeenCalled();
    process.exitCode = undefined;
    stderrLines.length = 0;

    await main(["node", "h2a", "stop", exact]);
    expect(process.exitCode).toBe(1);
    expect(killNativeSessionTree).not.toHaveBeenCalled();
    expect(killLocalSession).not.toHaveBeenCalled();
    process.exitCode = undefined;
    stderrLines.length = 0;

    await main(["node", "h2a", "resume", exact]);
    expect(process.exitCode).toBe(1);
    expect(startNativeSession).not.toHaveBeenCalled();
    expect(startLocalSession).not.toHaveBeenCalled();
    expect(killLocalSession).not.toHaveBeenCalled();
    process.exitCode = undefined;
    stderrLines.length = 0;

    await main(["node", "h2a", "attach", slug]);
    expect(process.exitCode).toBe(1);
    expect(attachNativeSession).not.toHaveBeenCalled();
    expect(attachLocalSession).not.toHaveBeenCalled();
    // The restore leg of this invariant is covered in
    // restore-live-recovery.test.ts (dropDualHostIdentities).
  });
});

describe("--tmux stays a permanent first-class creation switch", () => {
  it("EXPLICIT_TMUX_FLAG_STILL_CREATES_TMUX_SESSION_AFTER_DRAIN", async () => {
    // Zero live tmux sessions, zero registry rows: the drain has completed.
    // An explicit --tmux on a BRAND-NEW session still creates on tmux — the
    // switch survives the drain; only the DEFAULT host is native.
    writeRegistry([]);
    const slug = `fresh-tmux-${process.pid}`;

    const code = await main([
      "node",
      "h2a",
      "resume",
      slug,
      "--claude",
      CONV_ID,
      "--tmux",
    ]);

    expect(code).toBe(0);
    expect(startLocalSession).toHaveBeenCalledTimes(1);
    expect(startNativeSession).not.toHaveBeenCalled();
    // The row records the ACTUAL creation host.
    const row = loadEntries().find((e) => e.id === slug);
    expect(row?.kind).toBe("local-tmux");
  });
});

describe("dead legacy tmux row relaunch policy — NAMED DEBT, not covered", () => {
  // This invariant was DROPPED from Lot A, not proven and not disproven: its
  // premise (a registry row recorded `local-tmux` whose tmux session is DEAD
  // relaunches on the NATIVE host, migrating the row) is exactly the
  // dead-tmux-relaunch host policy the owner's tmux-permanent ratification
  // reopened. Skipping it WITH ITS NAME leaves an address for the debt; a
  // silent deletion would not. When the policy lands, replace this skip with
  // the ratified behavior (native migration, tmux resurrection, or fail
  // closed) and assert the registry row's post-relaunch `kind` explicitly.
  it.skip("DEAD_LEGACY_TMUX_ROW_RELAUNCHES_NATIVE_NOT_TMUX — pending dead-tmux-relaunch host policy decision (reopened by owner tmux-permanent ratification 2026-08-08)", () => {
    throw new Error(
      "unreachable while skipped: the dead-tmux-relaunch host policy is undecided",
    );
  });
});

describe("registry write boundary", () => {
  it("WRITE_BOUNDARY_WITHOUT_HOST_YIELDS_UNKNOWN_NOT_TMUX", () => {
    const slug = `boundary-${process.pid}`;
    // A caller that omits the host (the pre-fix untyped shape) gets NO row —
    // never a row silently labeled "local-tmux". A missing row is
    // recoverable by discovery; a wrongly-hosted row re-routes destructive
    // acts (F2 family).
    (enrollFromRun as (args: Record<string, unknown>) => void)({
      profile: "claude",
      slug,
      tmuxSession: `h2a-${slug}`,
      cwd: "/home/hostsel-test/src/proj",
      sessionClass: "human",
    });
    const rows = loadEntries().filter((e) => e.id === slug);
    expect(rows).toEqual([]);
    expect(stderrLines.join("")).toContain("registry enrolment refused");
  });
});
