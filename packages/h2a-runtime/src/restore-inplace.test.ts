/**
 * Lot L1b — attach-live primaries observed through host subtrees.
 *
 * A live managed row whose conversation id is unresolved restores as an
 * attach-only tab (never a `--resume` second writer). When the caller hands
 * restore() the host-observed subtree for that terminal, the row is
 * OBSERVED, not just attached:
 * - foreground CLI holding the session with no attached view → one `attached`
 *   ledger outcome when the view is (re)opened (round-2 astra-6: a live CLI
 *   without a view is owed exactly one attach view, never zero tabs);
 * - foreground CLI with its view → one `already-active` ledger outcome;
 * - foreground shell → one `deferred` (`needs-adapter`) outcome — seen, typed
 *   into never;
 * - an attached persistent shell is never counted as a resumed CLI.
 *
 * L0-compliant: every root comes from mkdtemp under os.tmpdir() (the
 * session TMPDIR under the sandbox); the native inventory and the terminal
 * spawn are mocked; only spawned, birth-checked PIDs could be stopped (none
 * are spawned here).
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const listLocalSessionsWithDiagnostics = vi.hoisted(() => vi.fn());
const listNativeSessions = vi.hoisted(() => vi.fn());
const spawn = vi.hoisted(() => vi.fn());
const homedirMock = vi.hoisted(() => vi.fn());

vi.mock("./tmux.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./tmux.js")>();
  return { ...actual, listLocalSessionsWithDiagnostics };
});

vi.mock("./native-host.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./native-host.js")>();
  return { ...actual, listNativeSessions };
});

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, spawn };
});

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, homedir: homedirMock };
});

const { restore } = await import("./restore.js");
type RegistryEntry = import("./registry.js").RegistryEntry;
type RestoreLedgerEntry = import("./restore.js").RestoreLedgerEntry;

const PRIM_NAME = "h2a-prim";
const iso = new Date().toISOString();

let scratch: string;
let home: string;
let prevConfigHome: string | undefined;
let prevRuntimeDir: string | undefined;
let stderrLines: string[];
const stderrStream = {
  write: (chunk: unknown) => {
    stderrLines.push(String(chunk));
    return true;
  },
} as unknown as NodeJS.WriteStream;

function row(over: Partial<RegistryEntry> & { id: string }): RegistryEntry {
  return {
    tool: "claude",
    kind: "local-native",
    cwd: join(home, "src", "projA"),
    sessionClass: "human",
    source: "run",
    enrolledAt: iso,
    lastSeenAt: iso,
    ...over,
  } as RegistryEntry;
}

function writeRegistry(entries: RegistryEntry[]): void {
  const dir = join(scratch, ".config", "sentropic", "h2a");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "registry.json"), JSON.stringify({ version: 1, entries }, null, 2), "utf8");
}

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), "h2a-restore-inplace-"));
  home = join(scratch, "home");
  mkdirSync(join(home, "src", "projA"), { recursive: true });
  mkdirSync(join(scratch, "run"), { recursive: true });
  homedirMock.mockReset().mockReturnValue(home);
  prevConfigHome = process.env.REMOTE_CLI_CONFIG_HOME;
  process.env.REMOTE_CLI_CONFIG_HOME = scratch;
  prevRuntimeDir = process.env.XDG_RUNTIME_DIR;
  process.env.XDG_RUNTIME_DIR = join(scratch, "run");
  listLocalSessionsWithDiagnostics
    .mockReset()
    .mockReturnValue({ sessions: [], known: true });
  listNativeSessions.mockReset().mockReturnValue([
    { id: PRIM_NAME, pid: 4242, status: "running", exit: null, controlled: false },
  ]);
  spawn.mockReset().mockReturnValue({ stderr: { on: vi.fn() }, unref: vi.fn() });
  stderrLines = [];
});

afterEach(() => {
  if (prevConfigHome === undefined) delete process.env.REMOTE_CLI_CONFIG_HOME;
  else process.env.REMOTE_CLI_CONFIG_HOME = prevConfigHome;
  if (prevRuntimeDir === undefined) delete process.env.XDG_RUNTIME_DIR;
  else process.env.XDG_RUNTIME_DIR = prevRuntimeDir;
  rmSync(scratch, { recursive: true, force: true });
});

/** A live run row whose convId is its own label: broken, hence unresolved. */
function primRow(): RegistryEntry {
  return row({
    id: "prim",
    label: "prim",
    convId: "prim",
    tmuxSession: PRIM_NAME,
  });
}

describe("lot L1b RED: attach-live primaries observed through host subtrees", () => {
  it("should report one attached ledger outcome for a foreground CLI session with no view", () => {
    writeRegistry([primRow()]);
    const ledger: RestoreLedgerEntry[] = [];
    const result = restore({
      stderr: stderrStream,
      onLedgerEntry: (e) => {
        ledger.push(e);
      },
      nativeSubtrees: [
        {
          name: PRIM_NAME,
          processes: [
            { pid: 4242, command: "claude", args: ["--resume", "conv-x"], startedAtMs: 111, ppid: 100 },
          ],
        },
      ],
    });
    // Round-2 (astra-6): the verified CLI has no attached view
    // (controlled:false in the mocked inventory), so the launch pass reopens
    // exactly one attach view — observed as `attached`, never relaunched
    // over, never zero tabs with a bare `already-active`.
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ session: "prim", outcome: "attached" });
    const tabs = result.windows.flatMap((w) => w.tabs);
    expect(tabs).toHaveLength(1);
    expect(tabs[0]).toMatchObject({ managedName: PRIM_NAME, attachLive: true });
    expect(result.total).toBe(1);
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it("should not count an attached persistent shell as a resumed CLI", () => {
    writeRegistry([primRow()]);
    const ledger: RestoreLedgerEntry[] = [];
    const result = restore({
      stderr: stderrStream,
      dryRun: true,
      onLedgerEntry: (e) => {
        ledger.push(e);
      },
      nativeSubtrees: [
        {
          name: PRIM_NAME,
          processes: [
            { pid: 7, command: "bash", args: ["-l"], startedAtMs: 1, ppid: 1 },
          ],
        },
      ],
    });
    // Seen and deferred (the D6(iii) adapter does not exist in this RC), so
    // the shortfall is visible per session — never typed into, never killed,
    // never counted as a resumed CLI.
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ session: "prim", outcome: "deferred", reason: "needs-adapter" });
    expect(ledger.some((e) => e.outcome === "launched")).toBe(false);
    const tabs = result.windows.flatMap((w) => w.tabs);
    expect(tabs).toHaveLength(1);
    expect(tabs[0]).toMatchObject({ managedName: PRIM_NAME, attachLive: true });
  });
});
