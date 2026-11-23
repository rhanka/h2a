import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

const { launchLayout, launchLayoutWithOutcomes, reconcileRunConvIds, registrySessions, restore, tabCommand } =
  await import("./restore.js");
const {
  buildRestorePlan,
  decideLayoutTab,
  groupSessionsWithClassification,
  managedLiveLookupFromSnapshot,
  planLayoutLaunch,
  resumeArgvVerified,
  tabRunInvocation,
} = await import("./restore-plan.js");
type RegistryEntry = import("./registry.js").RegistryEntry;
type HostViewSnapshot = import("./launch-layout.js").HostViewSnapshot;
type LayoutTab = import("./restore.js").LayoutTab;
type LayoutConfig = import("./config.js").LayoutConfig;

// Oracle captured on unmodified origin/main (dac65c6a3).
const EXPECTED_RESTORE_DRY_RUN_STDERR =
  '[h2a] restore skipped "broken-dead": no resolved conversation id (convId "broken-dead" is not a real conversation); attach it live with h2a attach broken-dead\n' +
  '[h2a] restore skipped "h2a-ambig": recorded on BOTH local hosts (local-tmux AND local-native); clean up the conflicting registry rows before restoring it\n' +
  "[h2a] 1 session(s) déjà sur le contrôle distant — pas de relance locale: cloud-app\n" +
  "  core (2):\n" +
  "    - alpha-1  claude (local) [registry]  <HOME>/src/alpha\n" +
  "    - alpha-2  claude (local) [registry]  <HOME>/src/alpha\n" +
  "  cloud (1):\n" +
  "    - cloud-app  SCW:scw-1  /pod/cloud-app\n" +
  "  fenêtre partagée 1 (2):\n" +
  "    - gamma-1  claude (local) [registry]  <HOME>/src/gamma\n" +
  "    - delta-1  claude (local) [registry]  <HOME>/src/delta\n" +
  "  (! 1 session(s) ignorée(s), plafond atteint)\n";

const EXPECTED_RESTORE_DRY_RUN_RESULT = {
  windows: [
    {
      title: "core",
      tabs: [
        {
          cwd: "<HOME>/src/alpha",
          label: "alpha-1",
          tool: "claude",
          sid: "11111111-1111-4111-8111-111111111101",
          origin: "registry",
          hostKind: "local-native",
          managedName: "h2a-alpha-1",
        },
        {
          cwd: "<HOME>/src/alpha",
          label: "alpha-2",
          tool: "claude",
          sid: "11111111-1111-4111-8111-111111111102",
          origin: "registry",
          hostKind: "local-native",
          managedName: "h2a-alpha-2",
        },
      ],
    },
    {
      title: "cloud",
      tabs: [
        {
          label: "cloud-app",
          cwd: "/pod/cloud-app",
          remoteId: "scw-1",
        },
      ],
    },
    {
      title: "fenêtre partagée 1",
      tabs: [
        {
          cwd: "<HOME>/src/gamma",
          label: "gamma-1",
          tool: "claude",
          sid: "11111111-1111-4111-8111-111111111104",
          origin: "registry",
          hostKind: "local-native",
          managedName: "h2a-gamma-1",
        },
        {
          cwd: "<HOME>/src/delta",
          label: "delta-1",
          tool: "claude",
          sid: "11111111-1111-4111-8111-111111111105",
          origin: "registry",
          hostKind: "local-native",
          managedName: "h2a-delta-1",
        },
      ],
    },
  ],
  total: 5,
  dropped: 1,
  ledger: [
    { key: "registry:alpha-1", label: "alpha-1", managedName: "h2a-alpha-1", outcome: "deferred:dry-run" },
    { key: "registry:alpha-2", label: "alpha-2", managedName: "h2a-alpha-2", outcome: "deferred:dry-run" },
    { key: "remote:scw-1", label: "cloud-app", outcome: "deferred:dry-run" },
    { key: "registry:gamma-1", label: "gamma-1", managedName: "h2a-gamma-1", outcome: "deferred:dry-run" },
    { key: "registry:delta-1", label: "delta-1", managedName: "h2a-delta-1", outcome: "deferred:dry-run" },
    { key: "registry:broken-dead", label: "broken-dead", outcome: "deferred:unresolved-conversation" },
    { key: "registry:ambig-native", label: "ambig", managedName: "h2a-ambig", outcome: "failed:dual-host-ambiguous" },
    { key: "registry:ambig-tmux", label: "ambig", managedName: "h2a-ambig", outcome: "failed:dual-host-ambiguous" },
    { key: "registry:cloud-local", label: "cloud-app", managedName: "h2a-cloud-app", outcome: "excluded:remote-backed" },
    { key: "registry:beta-overflow", label: "beta-overflow", managedName: "h2a-beta-overflow", outcome: "excluded:explicit-group-cap" },
    { key: "registry:epsilon-overflow", label: "epsilon-overflow", managedName: "h2a-epsilon-overflow", outcome: "excluded:shared-pool-cap" },
  ],
  observedTotals: {
    total: 11,
    alreadyActive: 0,
    attached: 0,
    resumedInPlace: 0,
    recreated: 0,
    resumed: 0,
    excluded: 3,
    deferred: 6,
    failed: 2,
  },
  exitCode: 0,
  registryConflicts: [],
};

describe("S0 Step 1 — restore --dry-run byte-for-byte characterization oracle", () => {
  let scratch = "";
  let home = "";
  let prevConfigHome: string | undefined;
  let prevRuntimeDir: string | undefined;

  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), "h2a-s0-restore-plan-"));
    home = join(scratch, "home");
    for (const proj of [
      "alpha",
      "beta",
      "gamma",
      "delta",
      "epsilon",
      "ambig",
      "cloud-app",
      "scan-only",
    ]) {
      mkdirSync(join(home, "src", proj), { recursive: true });
    }
    homedirMock.mockReset().mockReturnValue(home);
    prevConfigHome = process.env["REMOTE_CLI_CONFIG_HOME"];
    process.env["REMOTE_CLI_CONFIG_HOME"] = scratch;
    prevRuntimeDir = process.env["XDG_RUNTIME_DIR"];
    process.env["XDG_RUNTIME_DIR"] = join(scratch, "run");
    mkdirSync(join(scratch, "run"), { recursive: true });
    listLocalSessions.mockReset().mockReturnValue([]);
    listLocalSessionsWithDiagnostics
      .mockReset()
      .mockReturnValue({ sessions: [], known: true });
    listNativeSessions.mockReset().mockReturnValue([]);
    spawn
      .mockReset()
      .mockReturnValue({ stderr: { on: vi.fn() }, unref: vi.fn() });
  });

  afterEach(() => {
    if (prevConfigHome === undefined) delete process.env["REMOTE_CLI_CONFIG_HOME"];
    else process.env["REMOTE_CLI_CONFIG_HOME"] = prevConfigHome;
    if (prevRuntimeDir === undefined) delete process.env["XDG_RUNTIME_DIR"];
    else process.env["XDG_RUNTIME_DIR"] = prevRuntimeDir;
    rmSync(scratch, { recursive: true, force: true });
  });

  it("matches exact base oracle bytes for restore --dry-run without modifying any file", () => {
    const configDir = join(scratch, ".config", "sentropic", "h2a");
    mkdirSync(configDir, { recursive: true });
    const configPath = join(configDir, "config.json");
    writeFileSync(
      configPath,
      JSON.stringify(
        {
          layout: {
            maxAgeHours: 48,
            maxPerWindow: 2,
            sharedWindows: 1,
            multiSessionDefault: 1,
            groups: [
              { title: "core", projects: ["alpha", "beta"] },
              { title: "cloud", remote: true },
            ],
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    const row = (
      over: Partial<RegistryEntry> & { id: string; cwd: string },
    ): RegistryEntry =>
      ({
        tool: "claude",
        kind: "local-native",
        sessionClass: "human",
        source: "run",
        enrolledAt: "2026-11-20T10:00:00.000Z",
        lastSeenAt: "2026-11-20T10:00:00.000Z",
        ...over,
      }) as RegistryEntry;

    const entries: RegistryEntry[] = [
      row({
        id: "alpha-1",
        label: "alpha-1",
        cwd: join(home, "src", "alpha"),
        convId: "11111111-1111-4111-8111-111111111101",
        tmuxSession: "h2a-alpha-1",
        lastSeenAt: "2026-11-20T10:09:00.000Z",
      }),
      row({
        id: "alpha-2",
        label: "alpha-2",
        cwd: join(home, "src", "alpha"),
        convId: "11111111-1111-4111-8111-111111111102",
        tmuxSession: "h2a-alpha-2",
        lastSeenAt: "2026-11-20T10:08:00.000Z",
      }),
      row({
        id: "beta-overflow",
        label: "beta-overflow",
        cwd: join(home, "src", "beta"),
        convId: "11111111-1111-4111-8111-111111111103",
        tmuxSession: "h2a-beta-overflow",
        lastSeenAt: "2026-11-20T10:07:00.000Z",
      }),
      row({
        id: "gamma-1",
        label: "gamma-1",
        cwd: join(home, "src", "gamma"),
        convId: "11111111-1111-4111-8111-111111111104",
        tmuxSession: "h2a-gamma-1",
        lastSeenAt: "2026-11-20T10:06:00.000Z",
      }),
      row({
        id: "delta-1",
        label: "delta-1",
        cwd: join(home, "src", "delta"),
        convId: "11111111-1111-4111-8111-111111111105",
        tmuxSession: "h2a-delta-1",
        lastSeenAt: "2026-11-20T10:05:00.000Z",
      }),
      row({
        id: "epsilon-overflow",
        label: "epsilon-overflow",
        cwd: join(home, "src", "epsilon"),
        convId: "11111111-1111-4111-8111-111111111106",
        tmuxSession: "h2a-epsilon-overflow",
        lastSeenAt: "2026-11-20T10:04:00.000Z",
      }),
      row({
        id: "broken-dead",
        label: "broken-dead",
        cwd: join(home, "src", "gamma"),
        convId: "broken-dead",
        tmuxSession: "h2a-broken-dead",
        lastSeenAt: "2026-11-20T10:03:00.000Z",
      }),
      row({
        id: "ambig-native",
        label: "ambig",
        kind: "local-native",
        cwd: join(home, "src", "ambig"),
        convId: "11111111-1111-4111-8111-111111111107",
        tmuxSession: "h2a-ambig",
        lastSeenAt: "2026-11-20T10:02:00.000Z",
      }),
      row({
        id: "ambig-tmux",
        label: "ambig",
        kind: "local-tmux",
        cwd: join(home, "src", "ambig"),
        convId: "11111111-1111-4111-8111-111111111108",
        tmuxSession: "h2a-ambig",
        lastSeenAt: "2026-11-20T10:02:00.000Z",
      }),
      row({
        id: "cloud-local",
        label: "cloud-app",
        cwd: join(home, "src", "cloud-app"),
        convId: "11111111-1111-4111-8111-111111111109",
        tmuxSession: "h2a-cloud-app",
        lastSeenAt: "2026-11-20T10:01:00.000Z",
      }),
      row({
        id: "bg-job",
        label: "bg-job",
        cwd: join(home, "src", "alpha"),
        convId: "11111111-1111-4111-8111-111111111110",
        tmuxSession: "h2a-bg-job",
        sessionClass: "background",
        lastSeenAt: "2026-11-20T10:00:00.000Z",
      }),
    ];

    const registryPath = join(configDir, "registry.json");
    writeFileSync(
      registryPath,
      JSON.stringify({ version: 1, entries }, null, 2),
      "utf8",
    );

    const scanCwd = join(home, "src", "scan-only");
    const claudeDir = join(
      home,
      ".claude",
      "projects",
      scanCwd.replace(/[^a-zA-Z0-9]/g, "-"),
    );
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(join(claudeDir, "scan-sid-1.jsonl"), "{}\n", "utf8");

    const regBeforeStat = statSync(registryPath);
    const regBeforeContent = readFileSync(registryPath, "utf8");
    const cfgBeforeStat = statSync(configPath);
    const cfgBeforeContent = readFileSync(configPath, "utf8");

    const stderrChunks: string[] = [];
    const stderr = {
      write: (chunk: unknown) => {
        stderrChunks.push(String(chunk));
        return true;
      },
    } as unknown as NodeJS.WriteStream;

    const result = restore({
      dryRun: true,
      remoteTabs: [{ id: "scw-1", label: "cloud-app", cwd: "/pod/cloud-app" }],
      stderr,
    });

    const normalizedStderr = stderrChunks.join("").split(home).join("<HOME>");
    const normalizedResult = JSON.parse(
      JSON.stringify(result).split(home).join("<HOME>"),
    );

    expect(normalizedStderr).toBe(EXPECTED_RESTORE_DRY_RUN_STDERR);
    expect(normalizedResult).toEqual(EXPECTED_RESTORE_DRY_RUN_RESULT);
    expect(spawn).not.toHaveBeenCalled();
    expect(existsSync(join(configDir, "layout-last.json"))).toBe(false);
    expect(statSync(registryPath).mtimeMs).toBe(regBeforeStat.mtimeMs);
    expect(readFileSync(registryPath, "utf8")).toBe(regBeforeContent);
    expect(statSync(configPath).mtimeMs).toBe(cfgBeforeStat.mtimeMs);
    expect(readFileSync(configPath, "utf8")).toBe(cfgBeforeContent);
  });
});

describe("S0 Step 2 & 4 — pure restore plan, classification, and per-tab decision matrix", () => {
  let scratch = "";
  let prevRuntimeDir: string | undefined;

  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), "h2a-s0-pure-plan-"));
    prevRuntimeDir = process.env["XDG_RUNTIME_DIR"];
    process.env["XDG_RUNTIME_DIR"] = join(scratch, "run");
    mkdirSync(join(scratch, "run"), { recursive: true });
    spawn
      .mockReset()
      .mockReturnValue({ stderr: { on: vi.fn() }, unref: vi.fn() });
  });

  afterEach(() => {
    if (prevRuntimeDir === undefined) delete process.env["XDG_RUNTIME_DIR"];
    else process.env["XDG_RUNTIME_DIR"] = prevRuntimeDir;
    rmSync(scratch, { recursive: true, force: true });
  });

  it("invokes ZERO host readers, launchers, or writers even when every effect throws immediately", () => {
    listLocalSessions.mockReset().mockImplementation(() => {
      throw new Error("EFFECT MUST NOT RUN: listLocalSessions");
    });
    listLocalSessionsWithDiagnostics.mockReset().mockImplementation(() => {
      throw new Error("EFFECT MUST NOT RUN: listLocalSessionsWithDiagnostics");
    });
    listNativeSessions.mockReset().mockImplementation(() => {
      throw new Error("EFFECT MUST NOT RUN: listNativeSessions");
    });
    spawn.mockReset().mockImplementation(() => {
      throw new Error("EFFECT MUST NOT RUN: spawn");
    });
    homedirMock.mockReset().mockImplementation(() => {
      throw new Error("EFFECT MUST NOT RUN: homedir");
    });

    const home = "/isolated/home";
    const cfg: LayoutConfig = {
      maxAgeHours: 48,
      maxPerWindow: 2,
      sharedWindows: 1,
      multiSession: {},
      multiSessionDefault: 1,
      groups: [{ title: "core", projects: ["alpha"] }],
    };

    const entry: RegistryEntry = {
      id: "alpha-1",
      label: "alpha-1",
      tool: "claude",
      kind: "local-native",
      cwd: `${home}/src/alpha`,
      convId: "11111111-1111-4111-8111-111111111101",
      tmuxSession: "h2a-alpha-1",
      sessionClass: "human",
      source: "run",
      enrolledAt: "2026-11-20T10:00:00.000Z",
      lastSeenAt: "2026-11-20T10:05:00.000Z",
    };

    const hostView: HostViewSnapshot = {
      tmux: { known: true, sessions: [] },
      native: { known: true, complete: true, sessions: [] },
    };

    const plan = buildRestorePlan({
      home,
      config: cfg,
      registryRead: { state: "ok", entries: [entry], unreadable: [] },
      scanned: [],
      hostView,
      evidence: { home, liveTmuxSessions: [] },
      customTitleFor: () => undefined,
      remoteTabs: [],
    });

    expect(plan.ok).toBe(true);
    expect(plan.total).toBe(1);
    expect(plan.dropped).toBe(0);
    expect(plan.windows).toHaveLength(1);
    expect(listLocalSessions).not.toHaveBeenCalled();
    expect(listLocalSessionsWithDiagnostics).not.toHaveBeenCalled();
    expect(listNativeSessions).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
    expect(homedirMock).not.toHaveBeenCalled();
  });

  it("classifies every session exactly once across explicit cap, shared cap, and refusals", () => {
    const home = "/isolated/home";
    const cfg: LayoutConfig = {
      maxAgeHours: 48,
      maxPerWindow: 2,
      sharedWindows: 1,
      multiSession: {},
      multiSessionDefault: 1,
      groups: [
        { title: "core", projects: ["alpha", "beta"] },
        { title: "cloud", remote: true },
      ],
    };

    const row = (
      over: Partial<RegistryEntry> & { id: string; cwd: string },
    ): RegistryEntry =>
      ({
        tool: "claude",
        kind: "local-native",
        sessionClass: "human",
        source: "run",
        enrolledAt: "2026-11-20T10:00:00.000Z",
        lastSeenAt: "2026-11-20T10:00:00.000Z",
        ...over,
      }) as RegistryEntry;

    const entries: RegistryEntry[] = [
      row({
        id: "alpha-1",
        label: "alpha-1",
        cwd: `${home}/src/alpha`,
        convId: "22222222-2222-4222-8222-222222222201",
        tmuxSession: "h2a-alpha-1",
        lastSeenAt: "2026-11-20T10:09:00.000Z",
      }),
      row({
        id: "alpha-2",
        label: "alpha-2",
        cwd: `${home}/src/alpha`,
        convId: "22222222-2222-4222-8222-222222222202",
        tmuxSession: "h2a-alpha-2",
        lastSeenAt: "2026-11-20T10:08:00.000Z",
      }),
      row({
        id: "beta-overflow",
        label: "beta-overflow",
        cwd: `${home}/src/beta`,
        convId: "22222222-2222-4222-8222-222222222203",
        tmuxSession: "h2a-beta-overflow",
        lastSeenAt: "2026-11-20T10:07:00.000Z",
      }),
      row({
        id: "gamma-1",
        label: "gamma-1",
        cwd: `${home}/src/gamma`,
        convId: "22222222-2222-4222-8222-222222222204",
        tmuxSession: "h2a-gamma-1",
        lastSeenAt: "2026-11-20T10:06:00.000Z",
      }),
      row({
        id: "delta-1",
        label: "delta-1",
        cwd: `${home}/src/delta`,
        convId: "22222222-2222-4222-8222-222222222205",
        tmuxSession: "h2a-delta-1",
        lastSeenAt: "2026-11-20T10:05:00.000Z",
      }),
      row({
        id: "epsilon-overflow",
        label: "epsilon-overflow",
        cwd: `${home}/src/epsilon`,
        convId: "22222222-2222-4222-8222-222222222206",
        tmuxSession: "h2a-epsilon-overflow",
        lastSeenAt: "2026-11-20T10:04:00.000Z",
      }),
      row({
        id: "broken-dead",
        label: "broken-dead",
        cwd: `${home}/src/gamma`,
        convId: "broken-dead",
        tmuxSession: "h2a-broken-dead",
        lastSeenAt: "2026-11-20T10:03:00.000Z",
      }),
      row({
        id: "ambig-native",
        label: "ambig",
        kind: "local-native",
        cwd: `${home}/src/ambig`,
        convId: "22222222-2222-4222-8222-222222222207",
        tmuxSession: "h2a-ambig",
        lastSeenAt: "2026-11-20T10:02:00.000Z",
      }),
      row({
        id: "ambig-tmux",
        label: "ambig",
        kind: "local-tmux",
        cwd: `${home}/src/ambig`,
        convId: "22222222-2222-4222-8222-222222222208",
        tmuxSession: "h2a-ambig",
        lastSeenAt: "2026-11-20T10:02:00.000Z",
      }),
      row({
        id: "cloud-local",
        label: "cloud-app",
        cwd: `${home}/src/cloud-app`,
        convId: "22222222-2222-4222-8222-222222222209",
        tmuxSession: "h2a-cloud-app",
        lastSeenAt: "2026-11-20T10:01:00.000Z",
      }),
      row({
        id: "bg-job",
        label: "bg-job",
        cwd: `${home}/src/alpha`,
        convId: "22222222-2222-4222-8222-222222222210",
        tmuxSession: "h2a-bg-job",
        sessionClass: "background",
        lastSeenAt: "2026-11-20T10:00:00.000Z",
      }),
    ];

    const plan = buildRestorePlan({
      home,
      config: cfg,
      registryRead: { state: "ok", entries, unreadable: [] },
      scanned: [
        {
          project: "scan-only",
          mtimeMs: Date.parse("2026-11-20T10:00:00.000Z"),
          tool: "claude",
          sid: "scan-sid-1",
          cwd: `${home}/src/scan-only`,
          origin: "scan",
          restoreClass: "unclassified",
        },
      ],
      hostView: {
        tmux: { known: true, sessions: [] },
        native: { known: true, complete: true, sessions: [] },
      },
      evidence: { home, liveTmuxSessions: [] },
      customTitleFor: () => undefined,
      remoteTabs: [{ id: "scw-1", label: "cloud-app", cwd: "/pod/cloud-app" }],
    });

    expect(plan.ok).toBe(true);
    expect(plan.total).toBe(5);
    expect(plan.dropped).toBe(1);

    // Every candidate appears ONCE in classifications (11 registry + 1 scan + 1 remote = 13).
    const keys = plan.classifications.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(plan.classifications).toHaveLength(13);

    const byKey = new Map(plan.classifications.map((c) => [c.key, c]));
    expect(byKey.get("registry:alpha-1")?.outcome).toBe("selected");
    expect(byKey.get("registry:alpha-2")?.outcome).toBe("selected");
    expect(byKey.get("registry:beta-overflow")).toMatchObject({
      outcome: "explicit-overflow",
      groupTitle: "core",
      reason: "explicit-group-cap",
    });
    expect(byKey.get("registry:gamma-1")?.outcome).toBe("selected");
    expect(byKey.get("registry:delta-1")?.outcome).toBe("selected");
    expect(byKey.get("registry:epsilon-overflow")).toMatchObject({
      outcome: "shared-overflow",
      reason: "shared-pool-cap",
    });
    expect(byKey.get("registry:broken-dead")).toMatchObject({
      outcome: "refused",
      reason: "unresolved-conversation",
    });
    expect(byKey.get("registry:ambig-native")).toMatchObject({
      outcome: "refused",
      reason: "dual-host-ambiguous",
    });
    expect(byKey.get("registry:ambig-tmux")).toMatchObject({
      outcome: "refused",
      reason: "dual-host-ambiguous",
    });
    expect(byKey.get("registry:cloud-local")).toMatchObject({
      outcome: "refused",
      reason: "remote-backed",
    });
    expect(byKey.get("registry:bg-job")).toMatchObject({
      outcome: "refused",
      reason: "non-human",
    });
    expect(byKey.get("scan:scan-only:scan-sid-1")).toMatchObject({
      outcome: "refused",
      reason: "unclassified-scan",
    });
    expect(byKey.get("remote:scw-1")?.outcome).toBe("selected");

    // groupSessionsWithClassification also covers explicit + shared overflow cleanly.
    const grouped = groupSessionsWithClassification(
      [
        {
          project: "alpha",
          mtimeMs: 5,
          tool: "claude",
          sid: "s1",
          cwd: "/w/alpha",
          origin: "registry",
          label: "a1",
          restoreClass: "human",
        },
        {
          project: "alpha",
          mtimeMs: 4,
          tool: "claude",
          sid: "s2",
          cwd: "/w/alpha",
          origin: "registry",
          label: "a2",
          restoreClass: "human",
        },
        {
          project: "beta",
          mtimeMs: 3,
          tool: "claude",
          sid: "s3",
          cwd: "/w/beta",
          origin: "registry",
          label: "b1",
          restoreClass: "human",
        },
        {
          project: "gamma",
          mtimeMs: 2,
          tool: "claude",
          sid: "s4",
          cwd: "/w/gamma",
          origin: "registry",
          label: "g1",
          restoreClass: "human",
        },
        {
          project: "delta",
          mtimeMs: 1,
          tool: "claude",
          sid: "s5",
          cwd: "/w/delta",
          origin: "registry",
          label: "d1",
          restoreClass: "human",
        },
        {
          project: "eps",
          mtimeMs: 0,
          tool: "claude",
          sid: "s6",
          cwd: "/w/eps",
          origin: "registry",
          label: "e1",
          restoreClass: "human",
        },
      ],
      cfg,
    );
    expect(grouped.dropped).toBe(1);
    expect(grouped.classifications).toHaveLength(6);
    expect(grouped.classifications.filter((c) => c.outcome === "selected")).toHaveLength(4);
    expect(
      grouped.classifications.filter((c) => c.outcome === "explicit-overflow"),
    ).toHaveLength(1);
    expect(
      grouped.classifications.filter((c) => c.outcome === "shared-overflow"),
    ).toHaveLength(1);
  });

  it("matches launchLayout decision-for-decision across the entire tab decision matrix", () => {
    const CONV = "3f2504e0-4f89-41d3-9a0c-0305e82c3303";
    const knownEmpty: HostViewSnapshot = {
      tmux: { known: true, sessions: [] },
      native: { known: true, complete: true, sessions: [] },
    };

    const cases: Array<{
      name: string;
      tab: LayoutTab;
      hostView: HostViewSnapshot;
      opts?: { reattach?: boolean; forceGateway?: "gateway" | "direct" };
      expectedKind: "attach" | "launch" | "skip-live" | "refuse";
    }> = [
      {
        name: "remote tab",
        tab: { cwd: "/pod", label: "pod1", remoteId: "scw-42" },
        hostView: knownEmpty,
        expectedKind: "attach",
      },
      {
        name: "native ambiguous owner",
        tab: {
          cwd: "/repo/a",
          label: "a",
          tool: "claude",
          sid: CONV,
          hostKind: "local-native",
          managedName: "h2a-a",
        },
        hostView: {
          tmux: { known: true, sessions: [] },
          native: {
            known: true,
            complete: true,
            sessions: [
              { name: "h2a-a", controlled: false },
              { name: "h2a-a", controlled: false },
            ],
          },
        },
        expectedKind: "refuse",
      },
      {
        name: "native host unknown",
        tab: {
          cwd: "/repo/a",
          label: "a",
          tool: "claude",
          sid: CONV,
          hostKind: "local-native",
          managedName: "h2a-a",
        },
        hostView: {
          tmux: { known: true, sessions: [] },
          native: { known: false },
        },
        expectedKind: "refuse",
      },
      {
        name: "native incomplete inventory missing session",
        tab: {
          cwd: "/repo/a",
          label: "a",
          tool: "claude",
          sid: CONV,
          hostKind: "local-native",
          managedName: "h2a-a",
        },
        hostView: {
          tmux: { known: true, sessions: [] },
          native: { known: true, complete: false, sessions: [] },
        },
        expectedKind: "refuse",
      },
      {
        name: "native controlled (default)",
        tab: {
          cwd: "/repo/a",
          label: "a",
          tool: "claude",
          sid: CONV,
          hostKind: "local-native",
          managedName: "h2a-a",
        },
        hostView: {
          tmux: { known: true, sessions: [] },
          native: {
            known: true,
            complete: true,
            sessions: [{ name: "h2a-a", controlled: true }],
          },
        },
        expectedKind: "skip-live",
      },
      {
        name: "native controlled with --reattach",
        tab: {
          cwd: "/repo/a",
          label: "a",
          tool: "claude",
          sid: CONV,
          hostKind: "local-native",
          managedName: "h2a-a",
        },
        hostView: {
          tmux: { known: true, sessions: [] },
          native: {
            known: true,
            complete: true,
            sessions: [{ name: "h2a-a", controlled: true }],
          },
        },
        opts: { reattach: true },
        expectedKind: "skip-live",
      },
      {
        name: "native controller visibility unknown",
        tab: {
          cwd: "/repo/a",
          label: "a",
          tool: "claude",
          sid: CONV,
          hostKind: "local-native",
          managedName: "h2a-a",
        },
        hostView: {
          tmux: { known: true, sessions: [] },
          native: {
            known: true,
            complete: true,
            sessions: [{ name: "h2a-a", controlled: undefined }],
          },
        },
        expectedKind: "refuse",
      },
      {
        name: "native live uncontrolled",
        tab: {
          cwd: "/repo/a",
          label: "a",
          tool: "claude",
          sid: CONV,
          hostKind: "local-native",
          managedName: "h2a-a",
        },
        hostView: {
          tmux: { known: true, sessions: [] },
          native: {
            known: true,
            complete: true,
            sessions: [{ name: "h2a-a", controlled: false }],
          },
        },
        expectedKind: "attach",
      },
      {
        name: "native dead attachLive gone",
        tab: {
          cwd: "/repo/a",
          label: "a",
          tool: "claude",
          sid: "",
          hostKind: "local-native",
          managedName: "h2a-a",
          attachLive: true,
        },
        hostView: knownEmpty,
        expectedKind: "refuse",
      },
      {
        name: "native dead launch",
        tab: {
          cwd: "/repo/a",
          label: "a",
          tool: "claude",
          sid: CONV,
          hostKind: "local-native",
          managedName: "h2a-a",
        },
        hostView: knownEmpty,
        opts: { forceGateway: "direct" },
        expectedKind: "launch",
      },
      {
        name: "tmux unknown view -> conservative attach",
        tab: {
          cwd: "/repo/t",
          label: "t",
          tool: "claude",
          sid: CONV,
          hostKind: "local-tmux",
          managedName: "h2a-t",
        },
        hostView: {
          tmux: { known: false, reason: "tmux down" },
          native: { known: true, complete: true, sessions: [] },
        },
        expectedKind: "attach",
      },
      {
        name: "tmux live attached skipped",
        tab: {
          cwd: "/repo/t",
          label: "t",
          tool: "claude",
          sid: CONV,
          hostKind: "local-tmux",
          managedName: "h2a-t",
        },
        hostView: {
          tmux: {
            known: true,
            sessions: [
              {
                name: "h2a-t",
                slug: "t",
                profile: "claude",
                path: "/repo/t",
                attached: true,
              },
            ],
          },
          native: { known: true, complete: true, sessions: [] },
        },
        expectedKind: "skip-live",
      },
      {
        name: "tmux live attached with --reattach",
        tab: {
          cwd: "/repo/t",
          label: "t",
          tool: "claude",
          sid: CONV,
          hostKind: "local-tmux",
          managedName: "h2a-t",
        },
        hostView: {
          tmux: {
            known: true,
            sessions: [
              {
                name: "h2a-t",
                slug: "t",
                profile: "claude",
                path: "/repo/t",
                attached: true,
              },
            ],
          },
          native: { known: true, complete: true, sessions: [] },
        },
        opts: { reattach: true },
        expectedKind: "attach",
      },
      {
        name: "tmux dead attachLive gone",
        tab: {
          cwd: "/repo/t",
          label: "t",
          tool: "claude",
          sid: "",
          hostKind: "local-tmux",
          managedName: "h2a-t",
          attachLive: true,
        },
        hostView: knownEmpty,
        expectedKind: "refuse",
      },
      {
        name: "tmux dead launch",
        tab: {
          cwd: "/repo/t",
          label: "t",
          tool: "claude",
          sid: CONV,
          hostKind: "local-tmux",
          managedName: "h2a-t",
        },
        hostView: knownEmpty,
        expectedKind: "launch",
      },
      {
        name: "legacy tmux unknown -> attach",
        tab: { cwd: "/repo/l", label: "l", tool: "claude", sid: CONV },
        hostView: {
          tmux: { known: false, reason: "tmux down" },
          native: { known: true, complete: true, sessions: [] },
        },
        expectedKind: "attach",
      },
      {
        name: "legacy ambiguous slug",
        tab: { cwd: "/repo/l", label: "l", tool: "claude", sid: CONV },
        hostView: {
          tmux: {
            known: true,
            sessions: [
              { name: "h2a-l", slug: "l", profile: "claude", path: "/repo/l", attached: false },
              { name: "remote-l", slug: "l", profile: "claude", path: "/repo/l", attached: false },
            ],
          },
          native: { known: true, complete: true, sessions: [] },
        },
        expectedKind: "refuse",
      },
      {
        name: "legacy live attached skipped",
        tab: { cwd: "/repo/l", label: "l", tool: "claude", sid: CONV },
        hostView: {
          tmux: {
            known: true,
            sessions: [
              { name: "h2a-l", slug: "l", profile: "claude", path: "/repo/l", attached: true },
            ],
          },
          native: { known: true, complete: true, sessions: [] },
        },
        expectedKind: "skip-live",
      },
      {
        name: "legacy absent with unknown native -> fail closed refuse",
        tab: { cwd: "/repo/l", label: "l", tool: "claude", sid: CONV },
        hostView: {
          tmux: { known: true, sessions: [] },
          native: { known: false },
        },
        expectedKind: "refuse",
      },
      {
        name: "legacy dead launch",
        tab: { cwd: "/repo/l", label: "l", tool: "codex", sid: CONV },
        hostView: knownEmpty,
        expectedKind: "launch",
      },
    ];

    for (const tc of cases) {
      spawn.mockClear();
      const stderrLines: string[] = [];
      const stderr = {
        write: (chunk: unknown) => {
          stderrLines.push(String(chunk));
          return true;
        },
      } as unknown as NodeJS.WriteStream;

      const decision = decideLayoutTab(tc.tab, tc.hostView, tc.opts);
      const launchPlan = planLayoutLaunch(
        [{ title: "w", tabs: [tc.tab] }],
        tc.hostView,
        tc.opts,
      );
      const launched = launchLayout(
        [{ title: "w", tabs: [tc.tab] }],
        tc.hostView,
        stderr,
        tc.opts,
      );

      expect(decision.kind, tc.name).toBe(tc.expectedKind);
      expect(launchPlan.windows[0]!.decisions[0], tc.name).toEqual(decision);
      expect(launched.skippedLive, tc.name).toEqual(launchPlan.skippedLive);

      if (decision.kind === "attach" || decision.kind === "launch") {
        expect(launched.opened, tc.name).toBe(1);
        expect(spawn, tc.name).toHaveBeenCalledTimes(1);
        const args = spawn.mock.calls[0]![1] as string[];
        const mapContent = readFileSync(args.at(-1)!, "utf8");
        expect(mapContent, tc.name).toBe(`${tc.tab.cwd}\t${decision.command}\n`);
      } else {
        expect(launched.opened, tc.name).toBe(0);
        expect(spawn, tc.name).not.toHaveBeenCalled();
        if (decision.notice) {
          expect(stderrLines.join(""), tc.name).toContain(decision.notice);
        }
      }
    }
  });
});

describe("D4 — symmetric run/hook dedup by exact managed name", () => {
  it("should emit one attach action for duplicate unresolved rows of the same terminal", () => {
    const home = "/isolated/home";
    const cfg: LayoutConfig = {
      maxAgeHours: 48,
      maxPerWindow: 4,
      sharedWindows: 1,
      multiSession: {},
      multiSessionDefault: 1,
      groups: [],
    };
    const unclaimedUuid = "3f2504e0-4f89-41d3-9a0c-0305e82c3399";
    const runRow: RegistryEntry = {
      id: "dup-sess",
      label: "dup-sess",
      tool: "claude",
      kind: "local-native",
      cwd: `${home}/src/alpha`,
      convId: "dup-sess",
      tmuxSession: "h2a-dup-sess",
      sessionClass: "human",
      source: "run",
      enrolledAt: "2026-11-20T10:00:00.000Z",
      lastSeenAt: "2026-11-20T10:05:00.000Z",
    };
    const hookRow: RegistryEntry = {
      id: unclaimedUuid,
      tool: "claude",
      kind: "local",
      cwd: `${home}/src/alpha`,
      convId: unclaimedUuid,
      tmuxSession: "h2a-dup-sess",
      sessionClass: "human",
      source: "hook",
      enrolledAt: "2026-11-20T10:00:00.000Z",
      lastSeenAt: "2026-11-20T10:06:00.000Z",
    };
    const hostView: HostViewSnapshot = {
      tmux: { known: true, sessions: [] },
      native: {
        known: true,
        complete: true,
        sessions: [
          {
            name: "h2a-dup-sess",
            controlled: false,
            applicationFacet: "cli",
            applicationIncarnation: "inc-dup",
            foregroundProcessGroup: 101,
            foregroundRevision: 1,
          },
        ],
      },
    };
    const evidence = { home, liveTmuxSessions: [] };

    for (const [order, entries] of [
      ["run-then-hook", [runRow, hookRow]],
      ["hook-then-run", [hookRow, runRow]],
    ] as const) {
      const plan = buildRestorePlan({
        home,
        config: cfg,
        registryRead: { state: "ok", entries, unreadable: [] },
        scanned: [],
        hostView,
        evidence,
        customTitleFor: () => undefined,
        remoteTabs: [],
      });

      const tabs = plan.windows.flatMap((w) => w.tabs);
      expect(tabs, order).toHaveLength(1);
      expect(tabs[0], order).toMatchObject({
        managedName: "h2a-dup-sess",
        attachLive: true,
        sid: "",
      });
      expect(tabCommand(tabs[0]!)).toBe("h2a attach 'h2a-dup-sess'");
      expect(tabCommand(tabs[0]!)).not.toContain("h2a run");

      expect(
        plan.registryConflicts.some(
          (c) => c.managedName === "h2a-dup-sess" || c.label === "dup-sess",
        ),
        order,
      ).toBe(true);

      const resolution = reconcileRunConvIds(entries, () => undefined, evidence);
      const listed = registrySessions(
        home,
        entries,
        resolution,
        evidence,
        managedLiveLookupFromSnapshot(hostView),
      );
      expect(listed, order).toHaveLength(1);
      expect(listed[0]!.managedName).toBe("h2a-dup-sess");
    }
  });

  it("keeps distinct managed names and UUIDs separate even when labels collide", () => {
    const home = "/isolated/home";
    const cfg: LayoutConfig = {
      maxAgeHours: 48,
      maxPerWindow: 4,
      sharedWindows: 1,
      multiSession: {},
      multiSessionDefault: 1,
      groups: [],
    };
    const entries: RegistryEntry[] = [
      {
        id: "one",
        label: "same-label",
        tool: "claude",
        kind: "local-native",
        cwd: `${home}/src/alpha`,
        convId: "4f2504e0-4f89-41d3-9a0c-0305e82c3301",
        tmuxSession: "h2a-one",
        sessionClass: "human",
        source: "run",
        enrolledAt: "2026-11-20T10:00:00.000Z",
        lastSeenAt: "2026-11-20T10:05:00.000Z",
      },
      {
        id: "two",
        label: "same-label",
        tool: "claude",
        kind: "local-native",
        cwd: `${home}/src/alpha`,
        convId: "4f2504e0-4f89-41d3-9a0c-0305e82c3302",
        tmuxSession: "h2a-two",
        sessionClass: "human",
        source: "run",
        enrolledAt: "2026-11-20T10:00:00.000Z",
        lastSeenAt: "2026-11-20T10:04:00.000Z",
      },
    ];
    const plan = buildRestorePlan({
      home,
      config: cfg,
      registryRead: { state: "ok", entries, unreadable: [] },
      scanned: [],
      hostView: {
        tmux: { known: true, sessions: [] },
        native: { known: true, complete: true, sessions: [] },
      },
      evidence: { home, liveTmuxSessions: [] },
      customTitleFor: () => undefined,
      remoteTabs: [],
    });
    const tabs = plan.windows.flatMap((w) => w.tabs);
    expect(tabs).toHaveLength(2);
    expect(tabs.map((t) => t.managedName).sort()).toEqual(["h2a-one", "h2a-two"]);
  });
});

describe("D2 — foreground facet decisions in decideLayoutTab and planLayoutLaunch", () => {
  const CONV = "3f2504e0-4f89-41d3-9a0c-0305e82c3303";
  const tab: LayoutTab = {
    cwd: "/repo/a",
    label: "a",
    tool: "claude",
    sid: CONV,
    hostKind: "local-native",
    managedName: "h2a-a",
  };

  it("defers controlled shell candidates with deferred:needs-inject and keeps controlled CLI already-active", () => {
    const cliHost: HostViewSnapshot = {
      tmux: { known: true, sessions: [] },
      native: {
        known: true,
        complete: true,
        sessions: [
          {
            name: "h2a-a",
            controlled: true,
            applicationFacet: "cli",
            applicationIncarnation: "inc-cli-1",
            foregroundProcessGroup: 101,
            foregroundRevision: 1,
          },
        ],
      },
    };
    const shellHost: HostViewSnapshot = {
      tmux: { known: true, sessions: [] },
      native: {
        known: true,
        complete: true,
        sessions: [
          {
            name: "h2a-a",
            controlled: true,
            applicationFacet: "shell",
            applicationIncarnation: null,
            foregroundProcessGroup: 102,
            foregroundRevision: 2,
          },
        ],
      },
    };
    const otherHost: HostViewSnapshot = {
      tmux: { known: true, sessions: [] },
      native: {
        known: true,
        complete: true,
        sessions: [
          {
            name: "h2a-a",
            controlled: true,
            applicationFacet: "other",
            applicationIncarnation: "inc-other-1",
            foregroundProcessGroup: 103,
            foregroundRevision: 3,
          },
        ],
      },
    };

    const cliDecision = decideLayoutTab(tab, cliHost);
    expect(cliDecision.kind).toBe("skip-live");
    expect(cliDecision.ledgerOutcome).toBe("already-active");
    expect(planLayoutLaunch([{ title: "w", tabs: [tab] }], cliHost).windows[0]!.decisions[0]).toEqual(cliDecision);

    const shellDecision = decideLayoutTab(tab, shellHost);
    expect(shellDecision.kind).toBe("defer");
    if (shellDecision.kind === "defer") {
      expect(shellDecision.reason).toBe("needs-inject");
    }
    expect(shellDecision.ledgerOutcome).toBe("deferred:needs-inject");
    expect(planLayoutLaunch([{ title: "w", tabs: [tab] }], shellHost).windows[0]!.decisions[0]).toEqual(shellDecision);
    expect(
      launchLayoutWithOutcomes([{ title: "w", tabs: [tab] }], shellHost, { write: () => true } as never),
    ).toMatchObject({
      opened: 0,
      tabOutcomes: [{ outcome: "deferred:needs-inject" }],
    });

    const otherDecision = decideLayoutTab(tab, otherHost);
    expect(otherDecision.kind).toBe("defer");
    if (otherDecision.kind === "defer") {
      expect(otherDecision.reason).toBe("foreground-other");
    }
    expect(otherDecision.ledgerOutcome).toBe("deferred:foreground-other");
    expect(planLayoutLaunch([{ title: "w", tabs: [tab] }], otherHost).windows[0]!.decisions[0]).toEqual(otherDecision);
  });
});

describe("S2 step 1 — relaunch tokens mirror tabCommand, profile by profile and pin by pin (plan 09-S2)", () => {
  /** Split a `tabCommand` string on its own single-quote rule (`:1353`). */
  function splitShell(command: string): string[] {
    const out: string[] = [];
    const re = /'((?:[^']|'\\'')*)'|(\S+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(command)) !== null) {
      if (m[1] !== undefined) out.push(m[1].replace(/'\\''/g, "'"));
      else out.push(m[2]!);
    }
    return out;
  }

  const pins: Array<{ name: string; tab: Partial<LayoutTab>; opts?: { forceGateway?: "gateway" | "direct" } }> = [
    { name: "no pin", tab: {} },
    { name: "explicit gateway pin", tab: { gatewayMode: "gateway", gatewayProvenance: "explicit" } },
    { name: "explicit direct pin", tab: { gatewayMode: "direct", gatewayProvenance: "explicit" } },
    { name: "direct without provenance", tab: { gatewayMode: "direct" } },
    { name: "bare", tab: { bare: true } },
    { name: "no-bare", tab: { bare: false } },
    { name: "native host", tab: { hostKind: "local-native" } },
    { name: "tmux host", tab: { hostKind: "local-tmux" } },
    {
      name: "explicit gateway + native + bare",
      tab: { gatewayMode: "gateway", gatewayProvenance: "explicit", hostKind: "local-native", bare: true },
    },
    {
      name: "forced gateway over direct pin",
      tab: { gatewayMode: "direct", gatewayProvenance: "explicit" },
      opts: { forceGateway: "gateway" },
    },
    {
      name: "forced direct over gateway pin",
      tab: { gatewayMode: "gateway", gatewayProvenance: "explicit" },
      opts: { forceGateway: "direct" },
    },
  ];

  it("should emit the same tokens as tabCommand for every profile and pin", () => {
    for (const tool of ["claude", "codex", "agy", "muse", "vibe"]) {
      for (const pin of pins) {
        const tab: LayoutTab = {
          cwd: "/src/h2a",
          label: `${tool}-one`,
          tool,
          sid: "22222222-2222-4222-8222-222222222201",
          ...pin.tab,
        };
        const tokens = tabRunInvocation(tab, pin.opts ?? {});
        expect(tokens, `${tool}/${pin.name}`).toBeDefined();
        expect(tokens!.cwd).toBe(tab.cwd);
        expect([...tokens!.env, "h2a", ...tokens!.args]).toEqual(
          splitShell(tabCommand(tab, new Set(), pin.opts ?? {})),
        );
      }
    }
  });

  it("should survive spaces and single quotes in cwd and label", () => {
    const tab: LayoutTab = {
      cwd: "/tmp/a b",
      label: "o'clock shift",
      tool: "claude",
      sid: "22222222-2222-4222-8222-222222222201",
      hostKind: "local-native",
    };
    const tokens = tabRunInvocation(tab);
    expect(tokens).toBeDefined();
    expect([...tokens!.env, "h2a", ...tokens!.args]).toEqual(splitShell(tabCommand(tab, new Set(), {})));
    expect(tokens!.args).toContain("/tmp/a b");
    expect(tokens!.args).toContain("o'clock shift");
  });

  it("should emit nothing for a remote tab, an attach-live tab or a tab without sid", () => {
    expect(
      tabRunInvocation({ cwd: "/pod", label: "pod1", remoteId: "scw-42" }),
    ).toBeUndefined();
    expect(
      tabRunInvocation({
        cwd: "/src/h2a",
        label: "live",
        tool: "claude",
        sid: "",
        attachLive: true,
        hostKind: "local-native",
        managedName: "h2a-live",
      }),
    ).toBeUndefined();
    expect(
      tabRunInvocation({ cwd: "/src/h2a", label: "nosid", tool: "claude" }),
    ).toBeUndefined();
  });

  it("should report the agy resume argv as not verified", () => {
    expect(resumeArgvVerified("agy")).toBe(false);
    expect(resumeArgvVerified("antigravity")).toBe(false);
    for (const tool of ["claude", "codex", "muse", "vibe"]) {
      expect(resumeArgvVerified(tool)).toBe(true);
    }
  });
});
