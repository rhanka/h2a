/**
 * Destructive acts fail CLOSED on an UNPROVABLE local host state (sol-F3 /
 * sol-2, folded into #199) — the same invariant as resolveManagedHost's rule
 * 4 ("a probe failure makes the resolution UNKNOWN, never dead"), on the two
 * paths that used to swallow it:
 *
 *  - sol-F3: `run --tmux --resume <conv> --name <slug>` on a REGISTERED
 *    local-native whose native PROBE FAILS must refuse — a thrown probe was
 *    read as "no session", letting run start a tmux TWIN over a
 *    live-but-unprovable native writer (second writer on one conversation).
 *
 *  - sol-2: a registry row whose `kind` is ABSENT/UNREADABLE is not "no
 *    local session" — `stop <id>` used to fall through to a REMOTE homonym
 *    of the same id (stopRemoteSession kills the wrong thing), and any
 *    registry write cycle silently ERASED the unreadable row from the file.
 *
 * Every external process surface is mocked: no tmux session, native session
 * or terminal is ever created or killed by this file.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
const existingLocalSessionSlugs = vi.hoisted(() => vi.fn());
const currentTmuxSessionIs = vi.hoisted(() => vi.fn());

const nativeSessionAlive = vi.hoisted(() => vi.fn());
const nativeHostAvailable = vi.hoisted(() => vi.fn());
const startNativeSession = vi.hoisted(() => vi.fn());
const attachNativeSession = vi.hoisted(() => vi.fn());
const killNativeSessionTree = vi.hoisted(() => vi.fn());
const listNativeSessions = vi.hoisted(() => vi.fn());

const stopRemoteSession = vi.hoisted(() => vi.fn());
const listRemoteSessions = vi.hoisted(() => vi.fn());

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
    existingLocalSessionSlugs,
    currentTmuxSessionIs,
  };
});

vi.mock("./native-host.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./native-host.js")>();
  return {
    ...actual,
    nativeSessionAlive,
    nativeHostAvailable,
    startNativeSession,
    attachNativeSession,
    killNativeSessionTree,
    listNativeSessions,
  };
});

vi.mock("./attach.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./attach.js")>();
  return { ...actual, stopRemoteSession, listRemoteSessions };
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
const { enrollFromRun } = await import("./registry.js");

const SCRATCH_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  ".test-scratch",
  "destructive-act-unknown",
);

const CONV_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3304";
const iso = new Date().toISOString();

type Row = Record<string, unknown>;

const nativeRow = (slug: string, over: Row = {}): Row => ({
  id: slug,
  label: slug,
  tool: "claude",
  kind: "local-native",
  cwd: "/home/failclosed-test/src/proj",
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

function registryPath(): string {
  return join(scratch, ".config", "sentropic", "h2a", "registry.json");
}

function writeRegistry(rows: Row[]): void {
  mkdirSync(dirname(registryPath()), { recursive: true });
  writeFileSync(
    registryPath(),
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
  existingLocalSessionSlugs.mockReset().mockReturnValue([]);
  currentTmuxSessionIs.mockReset().mockReturnValue(false);

  nativeSessionAlive.mockReset().mockReturnValue(false);
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

  stopRemoteSession.mockReset().mockResolvedValue({ accepted: true });
  listRemoteSessions.mockReset().mockResolvedValue([]);

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

describe("sol-F3 — a native probe failure is never proof of absence", () => {
  it("RUN_TMUX_RESUME_WITH_FAILING_NATIVE_PROBE_REFUSES_AND_STARTS_NO_SECOND_WRITER", async () => {
    const slug = `f3-lane-${process.pid}`;
    // The conversation's session is REGISTERED local-native…
    writeRegistry([nativeRow(slug)]);
    // …and the native host probe FAILS (throws): its liveness is UNPROVABLE.
    nativeSessionAlive.mockImplementation(() => {
      throw new Error("native host probe down");
    });

    await main([
      "node",
      "h2a",
      "run",
      "claude",
      scratch,
      "--tmux",
      "--resume",
      CONV_ID,
      "--name",
      slug,
      "--no-attach",
    ]);

    // Fail closed: the launch is refused — neither a tmux twin (the second
    // writer) nor any native session is started, nothing is killed.
    expect(process.exitCode).toBe(1);
    expect(startLocalSession).not.toHaveBeenCalled();
    expect(startNativeSession).not.toHaveBeenCalled();
    expect(killLocalSession).not.toHaveBeenCalled();
    expect(killNativeSessionTree).not.toHaveBeenCalled();
    const output = stderrLines.join("");
    expect(output).toContain("native host state is unknown");
    expect(output).toContain("refusing to risk a second writer");
  });
});

describe("sol-2 — an unreadable registry row is UNKNOWN, never 'no local session'", () => {
  it("STOP_ON_UNREADABLE_KIND_ROW_REFUSES_AND_NEVER_FALLS_THROUGH_TO_REMOTE_HOMONYM", async () => {
    const id = `s2-lane-${process.pid}`;
    // The row EXISTS in the registry FILE but its `kind` is absent — the
    // validated view cannot read it. A remote session of the SAME id exists.
    const { kind: _dropped, ...unreadableRow } = nativeRow(id);
    writeRegistry([unreadableRow]);
    listRemoteSessions.mockResolvedValue([
      { id, profile: "claude", target: "pod://wrong-victim" },
    ]);

    await main(["node", "h2a", "stop", id]);

    // The stop REFUSES the unprovable local identity instead of falling
    // through to the remote homonym: nothing local is killed and the
    // control-plane stop is never issued.
    expect(process.exitCode).toBe(1);
    expect(stopRemoteSession).not.toHaveBeenCalled();
    expect(killLocalSession).not.toHaveBeenCalled();
    expect(killNativeSessionTree).not.toHaveBeenCalled();
    expect(stderrLines.join("")).toContain("unreadable");

    // And the unreadable row survives a registry WRITE cycle: mutating the
    // valid entries must never erase what it could not read.
    enrollFromRun({
      profile: "claude",
      slug: "healthy-neighbor",
      tmuxSession: "h2a-healthy-neighbor",
      hostKind: "local-tmux",
      cwd: "/home/failclosed-test/src/proj",
      sessionClass: "human",
    });
    const raw = JSON.parse(readFileSync(registryPath(), "utf8")) as {
      entries: Array<Record<string, unknown>>;
    };
    const survivor = raw.entries.find((e) => e.id === id);
    expect(survivor).toBeDefined();
    expect(survivor!.kind).toBeUndefined();
    expect(raw.entries.some((e) => e.id === "healthy-neighbor")).toBe(true);
  });
});
