/**
 * restore() WIRING invariants (#199 SHA4 — F3/F4).
 *
 * These are INTEGRATION tests on the full `restore()` pipeline (discovery →
 * reconcile → dual-host filter → grouping → launch), not on the pure
 * functions: the pure pieces were already correct while the wiring lied.
 * Assertions are on the STRUCTURED OUTPUT (returned windows, the launch map
 * handed to the terminal) — never on stderr prose, which survives the exact
 * wiring mutations these tests exist to catch.
 *
 *  - F4: no dual-host-ambiguous identity may reach groupSessions/launchLayout.
 *    Must redden on `const allLocal = preDualLocal;` (dropping
 *    `dropDualHostIdentities`' `kept` from the wiring while its report
 *    still prints).
 *  - F3: the layout render decides from the plan's ONE host snapshot —
 *    never a second inventory read. A `live at plan -> empty at launch`
 *    divergence must yield attach/refuse, NEVER an `h2a run` (a second
 *    writer on a live conversation). Must redden on re-reading a fresh
 *    snapshot for launchLayout.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const listLocalSessions = vi.hoisted(() => vi.fn());
const listLocalSessionsWithDiagnostics = vi.hoisted(() => vi.fn());
const listNativeSessions = vi.hoisted(() => vi.fn());
const spawn = vi.hoisted(() => vi.fn());
const homedirMock = vi.hoisted(() => vi.fn());

vi.mock("./tmux.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./tmux.js")>();
  return { ...actual, listLocalSessions, listLocalSessionsWithDiagnostics };
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

const SCRATCH_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  ".test-scratch",
  "restore-wiring",
);

const AMBIG_NAME = "h2a-h-infra";
const LEGIT_NAME = "h2a-legit";
const CONV_A = "3f2504e0-4f89-41d3-9a0c-0305e82c3310";
const CONV_B = "3f2504e0-4f89-41d3-9a0c-0305e82c3311";
const CONV_C = "3f2504e0-4f89-41d3-9a0c-0305e82c3312";

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

const iso = new Date().toISOString();

function row(over: Partial<RegistryEntry> & { id: string }): RegistryEntry {
  return {
    tool: "claude",
    kind: "local-native",
    cwd: join(home, "src", "proj"),
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
  writeFileSync(
    join(dir, "registry.json"),
    JSON.stringify({ version: 1, entries }, null, 2),
    "utf8",
  );
}

/** Every `cwd\tcommand` line of every map handed to the terminal spawn. */
function launchedMapLines(): string[] {
  return spawn.mock.calls.flatMap((call) => {
    const args = call[1] as string[];
    return readFileSync(args.at(-1)!, "utf8").split("\n").filter(Boolean);
  });
}

beforeEach(() => {
  mkdirSync(SCRATCH_ROOT, { recursive: true });
  scratch = mkdtempSync(join(SCRATCH_ROOT, "w-"));
  home = join(scratch, "home");
  mkdirSync(join(home, "src", "proj"), { recursive: true });
  homedirMock.mockReset().mockReturnValue(home);
  prevConfigHome = process.env.REMOTE_CLI_CONFIG_HOME;
  process.env.REMOTE_CLI_CONFIG_HOME = scratch;
  prevRuntimeDir = process.env.XDG_RUNTIME_DIR;
  process.env.XDG_RUNTIME_DIR = join(scratch, "run");
  mkdirSync(join(scratch, "run"), { recursive: true });
  listLocalSessions.mockReset().mockReturnValue([]);
  listLocalSessionsWithDiagnostics
    .mockReset()
    .mockReturnValue({ sessions: [], known: true });
  listNativeSessions.mockReset().mockReturnValue([]);
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

describe("F4 — dual-host ambiguity is dropped from the WIRED plan, not only reported", () => {
  it("RESTORE_NEVER_GROUPS_OR_LAUNCHES_A_DUAL_HOST_AMBIGUOUS_IDENTITY", () => {
    // One identity recorded on BOTH local hosts (the resolver's rule-3
    // ambiguity) + one healthy native row that must still restore.
    writeRegistry([
      row({ id: "h-infra", label: "h-infra", kind: "local-native", convId: CONV_A, tmuxSession: AMBIG_NAME }),
      row({ id: "h-infra-legacy", label: "h-infra", kind: "local-tmux", convId: CONV_B, tmuxSession: AMBIG_NAME }),
      row({ id: "legit", label: "legit", kind: "local-native", convId: CONV_C, tmuxSession: LEGIT_NAME }),
    ]);

    const result = restore({ stderr: stderrStream });

    // STRUCTURED assertions only (the skip NOTE keeps printing under the
    // exact wiring mutation `const allLocal = preDualLocal;` — prose proves
    // nothing here). The final windows carry EXACTLY the one healthy tab:
    const tabs = result.windows.flatMap((w) => w.tabs);
    expect(tabs).toHaveLength(1);
    expect(tabs[0]!.managedName).toBe(LEGIT_NAME);
    expect(result.total).toBe(1);
    // ...and the terminal launch effect carries exactly that one tab too —
    // nothing bearing the ambiguous identity reaches the launcher.
    const lines = launchedMapLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("'legit'");
    expect(lines.join("\n")).not.toContain(AMBIG_NAME);
    expect(lines.join("\n")).not.toContain("'h-infra'");
  });
});

describe("F3 — the launch decides from the plan's ONE snapshot", () => {
  it("RESTORE_LIVE_AT_PLAN_TIME_IS_ATTACHED_NEVER_RELAUNCHED_ON_A_DIVERGENT_SECOND_READ", () => {
    writeRegistry([
      row({ id: "legit", label: "legit", kind: "local-native", convId: CONV_C, tmuxSession: LEGIT_NAME }),
    ]);
    // The native inventory answers LIVE exactly once (the plan snapshot);
    // any SECOND read sees an empty host. With the single-snapshot wiring
    // the second answer is never consulted; with a re-read (the F3 defect)
    // the live session reads as dead and restore fabricates an `h2a run`
    // second writer over it.
    listNativeSessions
      .mockReturnValueOnce([
        { id: LEGIT_NAME, pid: 4242, status: "running", exit: null, controlled: false },
      ])
      .mockReturnValue([]);

    const result = restore({ stderr: stderrStream });

    // The ONE inventory read is itself the wiring invariant.
    expect(listNativeSessions).toHaveBeenCalledTimes(1);
    const tabs = result.windows.flatMap((w) => w.tabs);
    expect(tabs).toHaveLength(1);
    const lines = launchedMapLines();
    expect(lines).toHaveLength(1);
    // live -> attach by exact managed name; NEVER h2a run / --resume /
    // --replace on a session that was live at plan time.
    expect(lines[0]).toContain(`h2a attach '${LEGIT_NAME}'`);
    expect(lines.join("\n")).not.toMatch(/h2a run|--resume|--replace/);
  });
});

describe("PART A (sol-2, per-row) — a valid row + an UNREADABLE TWIN of the SAME identity poisons resolution for THAT identity only", () => {
  it("RESTORE_ON_VALID_ROW_PLUS_UNREADABLE_TWIN_SAME_NAME_EMITS_NO_TAB_AND_LAUNCHES_NOTHING", () => {
    const TWIN_NAME = "h2a-twin-restore";
    const CONV_D = "3f2504e0-4f89-41d3-9a0c-0305e82c3313";
    const valid = row({
      id: "twin-restore",
      label: "twin-restore",
      kind: "local-native",
      convId: CONV_D,
      tmuxSession: TWIN_NAME,
    });
    // A row that fails `isRegistryEntry` (here: `kind` dropped) with the
    // SAME identity (id + tmuxSession) as the otherwise-valid twin above.
    // Before this fix `loadRegistry()` silently dropped it and restore saw
    // only the clean valid row — emitting a tab and (had it been live)
    // launching/attaching a session whose local host state was, in truth,
    // unprovable.
    const { kind: _dropped, ...unreadableTwin } =
      valid as unknown as Record<string, unknown>;
    writeRegistry([valid, unreadableTwin as unknown as RegistryEntry]);

    const result = restore({ stderr: stderrStream });

    // STRUCTURED assertions on the EFFECTS, never only stderr prose: no tab
    // for this identity, and the terminal launch/attach effect (spawn) is
    // never invoked with it — the whole identity is fail-closed dropped.
    const tabs = result.windows.flatMap((w) => w.tabs);
    expect(tabs).toHaveLength(0);
    expect(result.total).toBe(0);
    expect(spawn).not.toHaveBeenCalled();
  });
});

describe("INJ L1a r5 (D2 & D4) — dedup, ledger, observed totals, and exit code through restore()", () => {
  it("should emit one attach action and zero h2a run for [run, hook] and [hook, run] sharing an exact managed name", () => {
    const DUP_NAME = "h2a-dup-sess";
    const runRow = row({
      id: "dup-sess",
      label: "dup-sess",
      kind: "local-native",
      convId: "dup-sess",
      tmuxSession: DUP_NAME,
    });
    const hookRow = row({
      id: CONV_C,
      kind: "local",
      source: "hook",
      convId: CONV_C,
      tmuxSession: DUP_NAME,
    });

    for (const entries of [
      [runRow, hookRow],
      [hookRow, runRow],
    ]) {
      spawn.mockClear();
      stderrLines = [];
      writeRegistry(entries);
      listNativeSessions.mockReturnValue([
        {
          id: DUP_NAME,
          pid: 4242,
          status: "running",
          exit: null,
          controlled: false,
          applicationFacet: "cli",
          applicationIncarnation: "inc-dup",
          foregroundProcessGroup: 100,
          foregroundRevision: 1,
        } as never,
      ]);

      const result = restore({ stderr: stderrStream });
      const tabs = result.windows.flatMap((w) => w.tabs);
      expect(tabs).toHaveLength(1);
      expect(tabs[0]!.managedName).toBe(DUP_NAME);
      const lines = launchedMapLines();
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain(`h2a attach '${DUP_NAME}'`);
      expect(lines.join("\n")).not.toMatch(/h2a run|--resume/);

      const ledger = Reflect.get(result, "ledger") as Array<{ outcome: string }> | undefined;
      expect(ledger).toHaveLength(1);
      expect(ledger![0]!.outcome).toBe("attached");
      expect(Reflect.get(result, "observedTotals")).toMatchObject({
        attached: 1,
        resumed: 0,
        resumedInPlace: 0,
        recreated: 0,
      });
      expect(Reflect.get(result, "exitCode")).toBe(0);
      expect(stderrLines.join("")).toContain("dup-sess");
    }
  });

  it("should report one observed already-active ledger outcome per active primary and recompute its totals", () => {
    writeRegistry([
      row({ id: "cli-prim", label: "cli-prim", kind: "local-native", convId: CONV_A, tmuxSession: "h2a-cli-prim" }),
      row({ id: "shell-prim", label: "shell-prim", kind: "local-native", convId: CONV_B, tmuxSession: "h2a-shell-prim" }),
    ]);
    listNativeSessions.mockReturnValue([
      {
        id: "h2a-cli-prim",
        pid: 4201,
        status: "running",
        exit: null,
        controlled: true,
        applicationFacet: "cli",
        applicationIncarnation: "inc-cli-1",
        foregroundProcessGroup: 201,
        foregroundRevision: 1,
      } as never,
      {
        id: "h2a-shell-prim",
        pid: 4202,
        status: "running",
        exit: null,
        controlled: true,
        applicationFacet: "shell",
        applicationIncarnation: null,
        foregroundProcessGroup: 202,
        foregroundRevision: 2,
      } as never,
    ]);

    const result = restore({ stderr: stderrStream });
    expect(spawn).not.toHaveBeenCalled();

    const ledger = Reflect.get(result, "ledger") as Array<{ label: string; outcome: string }> | undefined;
    expect(ledger).toHaveLength(2);
    expect(ledger!.map((entry) => entry.outcome).sort()).toEqual([
      "already-active",
      "deferred:needs-inject",
    ]);
    expect(Reflect.get(result, "observedTotals")).toMatchObject({
      alreadyActive: 1,
      deferred: 1,
      resumed: 0,
      resumedInPlace: 0,
      recreated: 0,
      attached: 0,
    });
    expect(Reflect.get(result, "exitCode")).toBe(1);
  });

  it("should not count an attached persistent shell as a resumed CLI", () => {
    writeRegistry([
      row({ id: "shell-attach", label: "shell-attach", kind: "local-native", convId: CONV_A, tmuxSession: "h2a-shell-attach" }),
    ]);
    listNativeSessions.mockReturnValue([
      {
        id: "h2a-shell-attach",
        pid: 4203,
        status: "running",
        exit: null,
        controlled: false,
        applicationFacet: "shell",
        applicationIncarnation: null,
        foregroundProcessGroup: 203,
        foregroundRevision: 1,
      } as never,
    ]);

    const result = restore({ stderr: stderrStream });
    const lines = launchedMapLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("h2a attach 'h2a-shell-attach'");
    expect(lines[0]).not.toContain("h2a run");

    const ledger = Reflect.get(result, "ledger") as Array<{ outcome: string }> | undefined;
    expect(ledger).toHaveLength(1);
    expect(ledger![0]!.outcome).toBe("attached");
    expect(Reflect.get(result, "observedTotals")).toMatchObject({
      attached: 1,
      resumed: 0,
      resumedInPlace: 0,
      recreated: 0,
    });
    expect(Reflect.get(result, "exitCode")).toBe(0);
  });

  it("should report one ledger line per session and exit non-zero when sessions needing resume are all blocked", () => {
    writeRegistry([
      row({ id: "old-a", label: "old-a", kind: "local-native", convId: CONV_A, tmuxSession: "h2a-old-a" }),
      row({ id: "old-b", label: "old-b", kind: "local-native", convId: CONV_B, tmuxSession: "h2a-old-b" }),
    ]);
    // Stub old host: omits both controlled and applicationFacet.
    listNativeSessions.mockReturnValue([
      { id: "h2a-old-a", pid: 4301, status: "running", exit: null } as never,
      { id: "h2a-old-b", pid: 4302, status: "running", exit: null } as never,
    ]);

    const result = restore({ stderr: stderrStream });
    expect(spawn).not.toHaveBeenCalled();

    const ledger = Reflect.get(result, "ledger") as Array<{ outcome: string }> | undefined;
    expect(ledger).toHaveLength(2);
    expect(ledger!.every((entry) => entry.outcome === "deferred:stale-host")).toBe(true);
    expect(Reflect.get(result, "exitCode")).toBe(1);
    const out = stderrLines.join("");
    expect(out).not.toContain("controller visibility UNKNOWN");
    expect(out.split("\n").filter((line) => /stale|ancien/i.test(line))).toHaveLength(1);
    expect(out).toContain("h2a doctor");
  });

  it("should exit zero with an empty ledger when there are no candidates", () => {
    writeRegistry([]);
    const result = restore({ stderr: stderrStream });
    expect(spawn).not.toHaveBeenCalled();
    expect(Reflect.get(result, "ledger")).toEqual([]);
    expect(Reflect.get(result, "exitCode")).toBe(0);
  });

  it("should exit zero for a valid dry-run while reporting its blockers as plan data", () => {
    writeRegistry([
      row({ id: "shell-dry", label: "shell-dry", kind: "local-native", convId: CONV_A, tmuxSession: "h2a-shell-dry" }),
    ]);
    listNativeSessions.mockReturnValue([
      {
        id: "h2a-shell-dry",
        pid: 4401,
        status: "running",
        exit: null,
        controlled: true,
        applicationFacet: "shell",
        applicationIncarnation: null,
        foregroundProcessGroup: 301,
        foregroundRevision: 1,
      } as never,
    ]);

    const result = restore({ dryRun: true, stderr: stderrStream });
    expect(spawn).not.toHaveBeenCalled();
    const ledger = Reflect.get(result, "ledger") as Array<{ outcome: string }> | undefined;
    expect(ledger).toHaveLength(1);
    expect(ledger![0]!.outcome).toBe("deferred:needs-inject");
    expect(Reflect.get(result, "observedTotals")).toMatchObject({
      deferred: 1,
      resumed: 0,
      resumedInPlace: 0,
      recreated: 0,
      attached: 0,
    });
    expect(Reflect.get(result, "exitCode")).toBe(0);
  });

  it("should exit zero when all primaries are already-active", () => {
    writeRegistry([
      row({ id: "cli-1", label: "cli-1", kind: "local-native", convId: CONV_A, tmuxSession: "h2a-cli-1" }),
      row({ id: "cli-2", label: "cli-2", kind: "local-native", convId: CONV_B, tmuxSession: "h2a-cli-2" }),
    ]);
    listNativeSessions.mockReturnValue([
      {
        id: "h2a-cli-1",
        pid: 4501,
        status: "running",
        exit: null,
        controlled: true,
        applicationFacet: "cli",
        applicationIncarnation: "inc-1",
        foregroundProcessGroup: 401,
        foregroundRevision: 1,
      } as never,
      {
        id: "h2a-cli-2",
        pid: 4502,
        status: "running",
        exit: null,
        controlled: true,
        applicationFacet: "cli",
        applicationIncarnation: "inc-2",
        foregroundProcessGroup: 402,
        foregroundRevision: 1,
      } as never,
    ]);

    const result = restore({ stderr: stderrStream });
    expect(spawn).not.toHaveBeenCalled();
    const ledger = Reflect.get(result, "ledger") as Array<{ outcome: string }> | undefined;
    expect(ledger).toHaveLength(2);
    expect(ledger!.every((entry) => entry.outcome === "already-active")).toBe(true);
    expect(Reflect.get(result, "observedTotals")).toMatchObject({
      alreadyActive: 2,
      resumed: 0,
    });
    expect(Reflect.get(result, "exitCode")).toBe(0);
  });
});
