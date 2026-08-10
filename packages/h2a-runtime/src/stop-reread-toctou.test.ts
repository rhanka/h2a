/**
 * B3 (#199 DEFINITIVE head) — a registry read REDONE on a destructive path
 * (TOCTOU) inherits the SAME 3-state contract as the first read: "unknown"
 * must refuse, never flatten to "no rows"/"no unreadable row for this
 * identity".
 *
 * `stop <id>` reads the registry TWICE: once inside
 * `resolveManagedLocalTarget` (the tmux/registry/native conjunction) and
 * again inside `unreadableRegistryRowsForTarget` (the per-identity poison
 * check, sol-2/A3). Before this fix, the SECOND read's whole-file "unknown"
 * state was silently flattened to `[]` ("no unreadable row for this
 * identity") — so a corruption that happens strictly BETWEEN the two reads
 * (a real TOCTOU window: another writer, a partial write, disk pressure)
 * let `stop` fall through past the guard and kill/stop a REMOTE homonym of
 * the exact identity whose local state just became unprovable.
 *
 * Simulated here by making the registry.json `readFileSync` succeed on its
 * FIRST call (a clean, empty registry — so `resolveManagedLocalTarget`
 * resolves "missing", not "unknown", and reaches the second read) and throw
 * on every call after that (the registry became unreadable in the window
 * between the two reads). Every OTHER `readFileSync` call in the process
 * (config.json, /proc/pid/cmdline, transcripts, …) passes through untouched.
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

// Mutable TOCTOU control, referenced from inside the node:fs mock factory
// below (must be created via vi.hoisted — the factory is hoisted above
// normal module-scope declarations).
const toctou = vi.hoisted(() => ({
  registryPath: "",
  reads: 0,
  // The read count AT WHICH the registry becomes unreadable (inclusive).
  // Default very high = "never" (most tests don't want the TOCTOU active).
  failFromRead: Number.POSITIVE_INFINITY,
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    readFileSync: ((path: unknown, ...rest: unknown[]) => {
      if (typeof path === "string" && path === toctou.registryPath) {
        toctou.reads += 1;
        if (toctou.reads >= toctou.failFromRead) {
          throw Object.assign(new Error("EIO: corrupted mid-read (simulated TOCTOU)"), {
            code: "EIO",
          });
        }
      }
      return (actual.readFileSync as (...a: unknown[]) => unknown)(path, ...rest);
    }) as typeof actual.readFileSync,
  };
});

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
const { setDefaultRemote } = await import("./config.js");

const SCRATCH_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  ".test-scratch",
  "stop-reread-toctou",
);

let scratch: string;
let prevConfigHome: string | undefined;
let stderrLines: string[];
let stderrSpy: ReturnType<typeof vi.spyOn>;

function registryPath(): string {
  return join(scratch, ".config", "sentropic", "h2a", "registry.json");
}

function writeRegistry(entries: unknown[]): void {
  mkdirSync(dirname(registryPath()), { recursive: true });
  writeFileSync(
    registryPath(),
    JSON.stringify({ version: 1, entries }, null, 2),
    "utf8",
  );
}

beforeEach(() => {
  mkdirSync(SCRATCH_ROOT, { recursive: true });
  scratch = mkdtempSync(join(SCRATCH_ROOT, "cli-"));
  prevConfigHome = process.env.REMOTE_CLI_CONFIG_HOME;
  process.env.REMOTE_CLI_CONFIG_HOME = scratch;
  process.exitCode = undefined;

  toctou.registryPath = registryPath();
  toctou.reads = 0;
  toctou.failFromRead = Number.POSITIVE_INFINITY;

  tmuxAvailable.mockReset().mockReturnValue(true);
  startLocalSession.mockReset();
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
  startNativeSession.mockReset();
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

describe("B3 — the STOP path's 2nd (TOCTOU re-)read inherits the 3-state contract", () => {
  it("STOP_REFUSES_WHEN_THE_REGISTRY_BECOMES_UNREADABLE_BETWEEN_ITS_TWO_READS", async () => {
    const id = `b3-toctou-${process.pid}`;
    // A clean, empty, READABLE registry — the FIRST read (inside
    // resolveManagedLocalTarget) succeeds and resolves "missing" (no local
    // session), reaching the second read (unreadableRegistryRowsForTarget).
    writeRegistry([]);
    // The SAME identity exists as a REMOTE session — the fall-through target
    // this guard exists to prevent.
    listRemoteSessions.mockResolvedValue([
      { id, profile: "claude", target: "pod://wrong-victim" },
    ]);
    // The registry becomes unreadable starting on its 2nd read (the TOCTOU
    // window: corruption strictly BETWEEN the two reads).
    toctou.failFromRead = 2;

    await main(["node", "h2a", "stop", id]);

    // Fail closed: the local state cannot be re-proven, so stop refuses —
    // it must NEVER fall through to the remote homonym.
    expect(process.exitCode).toBe(1);
    expect(stopRemoteSession).not.toHaveBeenCalled();
    expect(killLocalSession).not.toHaveBeenCalled();
    expect(killNativeSessionTree).not.toHaveBeenCalled();
    expect(stderrLines.join("")).toContain("unknown");
    // Proves the TOCTOU was actually exercised (2+ real reads happened),
    // not merely that the first read already refused.
    expect(toctou.reads).toBeGreaterThanOrEqual(2);
  });

  it("control: WITHOUT the TOCTOU window (registry stays readable), stop proceeds to the remote homonym", async () => {
    const id = `b3-control-${process.pid}`;
    writeRegistry([]);
    const remoteUrl = setDefaultRemote("http://localhost:9999");
    // toctou.failFromRead stays Infinity — every read succeeds.

    await main(["node", "h2a", "stop", id]);

    expect(process.exitCode ?? 0).toBe(0);
    expect(stopRemoteSession).toHaveBeenCalledWith(remoteUrl, id, undefined);
  });
});
