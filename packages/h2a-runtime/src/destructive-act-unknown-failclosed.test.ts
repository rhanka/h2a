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

const nativeSessionLiveness = vi.hoisted(() => vi.fn());
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
    nativeSessionLiveness,
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
    nativeSessionLiveness.mockImplementation(() => {
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

describe("F1 — the resume kill derives from the RESOLVED host, never the pre-resolution tmux view", () => {
  const envKeys = [
    "ANTHROPIC_BASE_URL",
    "ANTHROPIC_AUTH_TOKEN",
    "ANTHROPIC_API_KEY",
  ] as const;
  let savedEnv: Record<string, string | undefined>;
  beforeEach(() => {
    savedEnv = Object.fromEntries(envKeys.map((k) => [k, process.env[k]]));
  });
  afterEach(() => {
    for (const k of envKeys) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });

  it("RESUME_REPLACE_KILLS_ONLY_THE_RESOLVED_NATIVE_SESSION_NEVER_A_TMUX_TWIN", async () => {
    const slug = `f1-twin-${process.pid}`;
    // The identity is RECORDED native (live)…
    writeRegistry([nativeRow(slug)]);
    nativeSessionLiveness.mockReturnValue(true);
    // …while a homonymous LIVE TMUX TWIN (legacy prefix, same slug) sits in
    // the pre-resolution tmux view. The F1 defect killed THAT twin.
    resolveLocalSession.mockReturnValue({
      kind: "found",
      session: {
        name: `remote-${slug}`,
        slug,
        profile: "claude",
        path: "/home/failclosed-test/src/proj",
        attached: false,
      },
    });

    await main(["node", "h2a", "resume", slug, "--replace"]);

    // The kill goes to the RESOLVED host + exact name ONLY; the tmux twin
    // is untouched, and the resumed session starts on the resolved host.
    expect(process.exitCode ?? 0).toBe(0);
    expect(killNativeSessionTree).toHaveBeenCalledTimes(1);
    expect(killNativeSessionTree).toHaveBeenCalledWith(`h2a-${slug}`);
    expect(killLocalSession).not.toHaveBeenCalled();
    expect(startNativeSession).toHaveBeenCalledTimes(1);
    expect(startLocalSession).not.toHaveBeenCalled();
  });
});

describe("F2 — the stop conjunction refuses on ANY unprovable leg", () => {
  it("STOP_ON_CORRUPT_REGISTRY_REFUSES_AND_NEVER_FALLS_THROUGH_TO_REMOTE_HOMONYM", async () => {
    const id = `f2-corrupt-${process.pid}`;
    // The registry FILE exists but is CORRUPT: the read proves nothing.
    // (An ABSENT file is different — that is provable emptiness.)
    mkdirSync(dirname(registryPath()), { recursive: true });
    writeFileSync(registryPath(), "{not json", "utf8");
    listRemoteSessions.mockResolvedValue([
      { id, profile: "claude", target: "pod://wrong-victim" },
    ]);

    await main(["node", "h2a", "stop", id]);

    // Local absence is NOT positively known (registry leg unknown): the
    // conjunction is poisoned, so the stop refuses — no local kill, and
    // NEVER a control-plane stop of the same-named remote session.
    expect(process.exitCode).toBe(1);
    expect(stopRemoteSession).not.toHaveBeenCalled();
    expect(killLocalSession).not.toHaveBeenCalled();
    expect(killNativeSessionTree).not.toHaveBeenCalled();
    expect(stderrLines.join("")).toContain("unknown");
  });

  it("STOP_WITH_FAILING_NATIVE_PROBE_REFUSES_AND_NEVER_FALLS_THROUGH_TO_REMOTE_HOMONYM", async () => {
    const id = `f2-probe-${process.pid}`;
    // No registry row at all — but the native probe FAILS: a live native
    // session behind this name cannot be ruled out.
    writeRegistry([]);
    nativeSessionLiveness.mockReturnValue("unknown");
    listRemoteSessions.mockResolvedValue([
      { id, profile: "claude", target: "pod://wrong-victim" },
    ]);

    await main(["node", "h2a", "stop", id]);

    expect(process.exitCode).toBe(1);
    expect(stopRemoteSession).not.toHaveBeenCalled();
    expect(killLocalSession).not.toHaveBeenCalled();
    expect(killNativeSessionTree).not.toHaveBeenCalled();
    expect(stderrLines.join("")).toContain("unknown");
  });

  it("STOP_WITH_UNKNOWN_TMUX_INVENTORY_REFUSES_AND_NEVER_FALLS_THROUGH_TO_REMOTE_HOMONYM", async () => {
    const id = `f2-tmuxinv-${process.pid}`;
    // The tmux inventory read itself fails: the tmux leg of the conjunction
    // is unprovable, whatever the registry and native probes say.
    writeRegistry([]);
    listLocalSessionsWithDiagnostics.mockReturnValue({
      sessions: [],
      known: false,
      reason: "tmux server unreachable",
    });
    listRemoteSessions.mockResolvedValue([
      { id, profile: "claude", target: "pod://wrong-victim" },
    ]);

    await main(["node", "h2a", "stop", id]);

    expect(process.exitCode).toBe(1);
    expect(stopRemoteSession).not.toHaveBeenCalled();
    expect(killLocalSession).not.toHaveBeenCalled();
    expect(killNativeSessionTree).not.toHaveBeenCalled();
    expect(stderrLines.join("")).toContain("unknown");
  });
});

describe("PART A (sol-2, per-row) — a valid row + an UNREADABLE TWIN of the SAME identity poisons resolution for THAT identity only, never a global unknown", () => {
  // A row that fails `isRegistryEntry` (here: `kind` dropped) sitting next
  // to an otherwise-valid, LIVE-shaped twin of the exact same identity
  // (same id + tmuxSession). Before this fix `loadRegistry()` silently
  // DROPPED the unreadable row and returned `state:"ok"` with only the
  // valid row — the resolver then saw a clean "recorded" host and the
  // destructive act proceeded to kill/launch the WRONG (unprovable) thing.
  it("STOP_ON_VALID_ROW_PLUS_UNREADABLE_TWIN_SAME_NAME_REFUSES_NO_KILL_EFFECT", async () => {
    const slug = `twin-stop-${process.pid}`;
    const valid = nativeRow(slug, { kind: "local-tmux" });
    const { kind: _dropped, ...unreadableTwin } = valid;
    writeRegistry([valid, unreadableTwin]);

    await main(["node", "h2a", "stop", slug]);

    // Assert on the EFFECT MOCKS, never only the refusal MESSAGE — a
    // message-only assertion would let a correct-but-LATE guard (one placed
    // after the kill) look like it holds.
    expect(killLocalSession).not.toHaveBeenCalled();
    expect(killNativeSessionTree).not.toHaveBeenCalled();
    expect(stopRemoteSession).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it("RESUME_ON_VALID_ROW_PLUS_UNREADABLE_TWIN_SAME_NAME_REFUSES_NO_KILL_NO_LAUNCH", async () => {
    const slug = `twin-resume-${process.pid}`;
    // kind:"local-native" by default (nativeRow) — recorded + live-shaped.
    const valid = nativeRow(slug);
    const { kind: _dropped, ...unreadableTwin } = valid;
    writeRegistry([valid, unreadableTwin]);

    await main(["node", "h2a", "resume", slug]);

    // Without this fix, resolveManagedHost sees only the valid row, resolves
    // "recorded", finds it not-live (nativeSessionLiveness defaults false in
    // this suite) and falls through to START A NEW SESSION on the SAME
    // unprovable identity — asserted absent here.
    expect(killLocalSession).not.toHaveBeenCalled();
    expect(killNativeSessionTree).not.toHaveBeenCalled();
    expect(startLocalSession).not.toHaveBeenCalled();
    expect(startNativeSession).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });
});

describe("attach missing->remote fallthrough — NAMED DEBT, not covered", () => {
  // attach's `missing`->remote homonym fallthrough is the sol-2 asymmetry
  // left OPEN by design: when the local target resolves to nothing (including
  // an identity whose only registry row is unreadable), attach falls through
  // to a REMOTE session of the same name. attach is non-destructive (it does
  // not kill), so unlike stop it was not gated in #199 — but it is a known
  // asymmetry vs stop's fail-closed guard. Skipping it WITH ITS NAME leaves
  // an address for the debt (the dead-tmux convention); a silent absence
  // would not. When attach fail-closed symmetry lands, replace this skip
  // with the guard's assertions (refusal on an unreadable-row identity, no
  // remote attach issued).
  it.skip("ATTACH_MISSING_IDENTITY_MUST_NOT_FALL_THROUGH_TO_REMOTE_HOMONYM — pending attach fail-closed symmetry (tracked debt 2026-08-08)", () => {
    throw new Error(
      "unreachable while skipped: attach fail-closed symmetry is not implemented",
    );
  });
});
