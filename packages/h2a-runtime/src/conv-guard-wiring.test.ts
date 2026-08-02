/**
 * Wiring tests for the single-writer conversation guard in `remote run -r`
 * and `remote migrate forward -r` (same mock pattern as index.test.ts).
 * The registry is REAL, pointed at a scratch file via the config mock; live
 * local writers are simulated with kind "local" + pid = process.pid (alive).
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// Scratch dir inside the package (never /tmp), like the other test suites.
const SCRATCH = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  ".test-scratch",
  "conv-guard-wiring",
);
const CONFIG_PATH = join(SCRATCH, "config.json");
const REGISTRY_PATH = join(SCRATCH, "registry.json");
const ORIGINAL_ANTHROPIC_BASE_URL = process.env.ANTHROPIC_BASE_URL;
const ORIGINAL_ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ORIGINAL_ANTHROPIC_AUTH_TOKEN = process.env.ANTHROPIC_AUTH_TOKEN;

const listRemoteSessions = vi.fn();
const getDefaultRemote = vi.fn();
const startLocalSession = vi.fn();
const attachLocalSession = vi.fn();
const currentTmuxSessionIs = vi.fn();
const findLocalSession = vi.fn();
const killLocalSession = vi.fn();
const listLocalSessions = vi.fn();
const listLocalSessionsWithDiagnostics = vi.fn();
const localSessionIdle = vi.fn();
const sessionRelaunchSafety = vi.fn();
const localSessionGatewayEnvStatus = vi.fn();
const runLocalCliForeground = vi.fn();
const migrateForward = vi.fn();
const migrateBack = vi.fn();
const localConvStat = vi.fn();
const acquireLlmMeshSessionEnv = vi.fn();
const readLlmMeshSessionEnv = vi.fn();
const readLlmMeshConfig = vi.fn(
  (): {
    accounts: Array<{
      id: string;
      provider: "anthropic" | "openai";
      label: string;
      token: string;
    }>;
  } => ({ accounts: [] }),
);
const getLlmMeshRuntimeConfig = vi.fn(() => ({ enabled: false }));
const startGateway = vi.fn();
const readGatewayPid = vi.fn(() => null);

vi.mock("./attach.js", () => ({
  attach: vi.fn(),
  createRemoteSession: vi.fn(),
  getRemoteSession: vi.fn(),
  listRemoteSessions,
  stopRemoteSession: vi.fn(),
  refreshRemoteSession: vi.fn(),
  sessionTerminalHealth: vi.fn(),
}));

vi.mock("./config.js", () => ({
  clearDefaultRemote: vi.fn(),
  getDefaultRemote,
  setDefaultRemote: vi.fn(),
  setToken: vi.fn(),
  getTunnel: () => undefined,
  setTunnel: () => {},
  getDefaultTarget: () => "scaleway-kapsule",
  setDefaultTarget: () => {},
  getDefaultTools: () => [],
  setDefaultTools: () => {},
  getPlugins: () => [],
  setPlugins: () => {},
  getH2aConfig: () => ({ enabled: false }),
  setH2aConfig: () => {},
  getLlmMeshRuntimeConfig,
  setLlmMeshRuntimeConfig: vi.fn(),
  getTmuxProfileConfig: () => ({ profile: "remote" }),
  setTmuxProfileConfig: vi.fn(),
  DEFAULT_SESSION_TARGET: "scaleway-kapsule",
  authHeaders: () => ({}),
  resolveConfigPath: () => CONFIG_PATH,
}));

vi.mock("./tmux.js", () => ({
  tmuxAvailable: () => true,
  startLocalSession,
  attachLocalSession,
  attachPodTmux: vi.fn(),
  // tmux.ts gained this export; a mock factory that omits it makes the module
  // throw at call time rather than fail an assertion.
  persistLaunchContext: vi.fn(),
  currentTmuxSessionIs,
  existingLocalSessionSlugs: (
    labels: ReadonlyArray<string | undefined>,
    cwd: string,
  ) =>
    labels
      .map((label) => {
        const raw = label ?? cwd;
        const parts = raw.split("/").filter(Boolean);
        const slug = (parts[parts.length - 1] ?? "session")
          .replace(/[^a-zA-Z0-9_.-]/g, "-")
          .replace(/^-+|-+$/g, "");
        return findLocalSession(slug) ? slug : undefined;
      })
      .filter((slug): slug is string => slug !== undefined),
  findLocalSession,
  resolveLocalSession: (target: string) => {
    const session = findLocalSession(target);
    return session ? { kind: "found", session } : { kind: "missing" };
  },
  killLocalSession,
  listLocalSessions,
  listLocalSessionsWithDiagnostics,
  localSessionIdle,
  sessionRelaunchSafety,
  localSessionGatewayEnvStatus,
  localSessionName: (slug: string) => `h2a-${slug}`,
  managedSessionCandidates: (slug: string) => [
    `h2a-${slug}`,
    `remote-${slug}`,
  ],
  parseManagedSessionName: (name: string) => {
    if (name.startsWith("h2a-")) {
      return { prefix: "h2a-", slug: name.slice("h2a-".length) };
    }
    if (name.startsWith("remote-")) {
      return { prefix: "remote-", slug: name.slice("remote-".length) };
    }
    return undefined;
  },
  slugify: (p: string) => {
    const parts = p.split("/").filter(Boolean);
    const base = (parts[parts.length - 1] ?? "")
      .replace(/[^a-zA-Z0-9_.-]/g, "-")
      .replace(/^-+|-+$/g, "");
    return base || "session";
  },
  runLocalCliForeground,
  // The in-place resume path persists its launch context through tmux session
  // options. The mock lacked the export, so the test died ON THE MOCK rather than
  // on an assertion — and a missing stub reads exactly like a product failure.
  // Stubbed as a no-op deliberately: this file drives WIRING, and what the launch
  // context should contain is asserted where that is the subject.
  persistLaunchContext: () => {},
}));

vi.mock("./migrate.js", () => ({
  migrateForward,
  migrateBack,
}));

vi.mock("./llm-mesh.js", () => ({
  enrollCodexAccount: vi.fn(),
  readLlmMeshConfig,
  startGateway,
  stopGateway: vi.fn(),
  writeLlmMeshConfig: vi.fn(),
  readGatewayPid,
  llmMeshLogPath: vi.fn(() => "llm-mesh.log"),
  jwtExpiry: vi.fn(() => null),
  acquireLlmMeshSessionEnv,
  readLlmMeshSessionEnv,
}));

// Controls how a BARE `migrate forward -r` resolves "the most recent local
// conversation" for the guard — the real localConvStat reads the runner's
// ~/.claude/projects, which must never leak into the test.
vi.mock("./convsync.js", () => ({
  encodeCwd: (cwd: string) => cwd.replace(/\//g, "-"),
  localConvStat,
  remoteConvStat: vi.fn(() => undefined),
  alignment: vi.fn(() => ({ state: "missing", detail: "" })),
}));

const stderrWrite = vi
  .spyOn(process.stderr, "write")
  .mockImplementation(() => true);
const stdoutWrite = vi
  .spyOn(process.stdout, "write")
  .mockImplementation(() => true);

const { main } = await import("./index.js");

const NOW = new Date().toISOString();

/**
 * A hook-enrolled local writer on convId: kind "local", NO pid (the claude
 * SessionStart hook can't capture claude's pid). Such an entry is UNVERIFIABLE,
 * so the guard treats it as a SUSPECT (warn) — never a hard block — which is
 * what stops a crash-stale hook entry from refusing a relaunch forever.
 */
function unverifiableLocalWriter(convId: string) {
  return {
    id: "uuid-claude-1",
    tool: "claude",
    kind: "local",
    cwd: "/home/u/src/projA",
    convId,
    enrolledAt: NOW,
    lastSeenAt: NOW,
    source: "hook",
  };
}

/** A live REMOTE writer (verifiable via cliSessionId) — a HARD block. */
function liveRemoteWriter(convId: string) {
  return {
    id: "sess-b",
    profile: "claude",
    target: "scaleway-kapsule",
    createdAt: NOW,
    cliSessionId: convId,
  };
}

function writeRegistry(entries: unknown[]): void {
  writeFileSync(REGISTRY_PATH, JSON.stringify({ version: 1, entries }), "utf8");
}

function stderrText(): string {
  return stderrWrite.mock.calls.map((c) => String(c[0])).join("");
}

beforeEach(() => {
  mkdirSync(SCRATCH, { recursive: true });
  writeRegistry([]);
  listRemoteSessions.mockReset();
  listRemoteSessions.mockResolvedValue([]);
  getDefaultRemote.mockReset();
  getDefaultRemote.mockReturnValue(undefined);
  startLocalSession.mockReset();
  startLocalSession.mockReturnValue({ name: "remote-projA", slug: "projA" });
  attachLocalSession.mockReset();
  attachLocalSession.mockReturnValue(0);
  currentTmuxSessionIs.mockReset();
  currentTmuxSessionIs.mockReturnValue(false);
  findLocalSession.mockReset();
  findLocalSession.mockReturnValue(undefined);
  killLocalSession.mockReset();
  killLocalSession.mockReturnValue(true);
  listLocalSessions.mockReset();
  listLocalSessions.mockReturnValue([]);
  listLocalSessionsWithDiagnostics.mockReset();
  listLocalSessionsWithDiagnostics.mockReturnValue({ sessions: [], known: true });
  localSessionIdle.mockReset();
  localSessionIdle.mockReturnValue(false);
  sessionRelaunchSafety.mockReset();
  sessionRelaunchSafety.mockReturnValue({
    idle: true,
    activelyWorking: false,
    reason: "test parked/dead session",
  });
  localSessionGatewayEnvStatus.mockReset();
  localSessionGatewayEnvStatus.mockReturnValue("unknown");
  runLocalCliForeground.mockReset();
  runLocalCliForeground.mockReturnValue(0);
  migrateForward.mockReset();
  migrateBack.mockReset();
  localConvStat.mockReset();
  localConvStat.mockReturnValue(undefined);
  acquireLlmMeshSessionEnv.mockReset();
  acquireLlmMeshSessionEnv.mockResolvedValue(null);
  readLlmMeshSessionEnv.mockReset();
  readLlmMeshSessionEnv.mockReturnValue(null);
  readLlmMeshConfig.mockReset();
  readLlmMeshConfig.mockReturnValue({ accounts: [] });
  getLlmMeshRuntimeConfig.mockReset();
  getLlmMeshRuntimeConfig.mockReturnValue({ enabled: false });
  startGateway.mockReset();
  readGatewayPid.mockReset();
  readGatewayPid.mockReturnValue(null);
  stderrWrite.mockClear();
  stdoutWrite.mockClear();
  delete process.env.ANTHROPIC_BASE_URL;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_AUTH_TOKEN;
  process.exitCode = 0;
});

afterAll(() => {
  rmSync(SCRATCH, { recursive: true, force: true });
  if (ORIGINAL_ANTHROPIC_BASE_URL === undefined) {
    delete process.env.ANTHROPIC_BASE_URL;
  } else {
    process.env.ANTHROPIC_BASE_URL = ORIGINAL_ANTHROPIC_BASE_URL;
  }
  if (ORIGINAL_ANTHROPIC_API_KEY === undefined) {
    delete process.env.ANTHROPIC_API_KEY;
  } else {
    process.env.ANTHROPIC_API_KEY = ORIGINAL_ANTHROPIC_API_KEY;
  }
  if (ORIGINAL_ANTHROPIC_AUTH_TOKEN === undefined) {
    delete process.env.ANTHROPIC_AUTH_TOKEN;
  } else {
    process.env.ANTHROPIC_AUTH_TOKEN = ORIGINAL_ANTHROPIC_AUTH_TOKEN;
  }
  process.exitCode = 0;
});

function registrySession(overrides: Record<string, unknown> = {}) {
  return {
    id: "projA",
    tool: "claude",
    kind: "local-tmux",
    cwd: "/home/u/src/projA",
    label: "projA",
    convId: "conv-dup",
    tmuxSession: "remote-projA",
    enrolledAt: NOW,
    lastSeenAt: NOW,
    source: "run",
    ...overrides,
  };
}

describe("h2a relaunch", () => {
  const sessions = [
    {
      name: "h2a-codex-lane",
      slug: "codex-lane",
      profile: "codex",
      path: "/repo/shared",
      attached: false,
    },
    {
      name: "h2a-claude-lane",
      slug: "claude-lane",
      profile: "claude",
      path: "/repo/shared",
      attached: false,
    },
    {
      name: "h2a-unresumable",
      slug: "unresumable",
      profile: "agy",
      path: "/repo/agy",
      attached: false,
    },
  ];

  const resumableRegistry = [
    registrySession({
      id: "codex-lane",
      tool: "codex",
      cwd: "/repo/shared",
      convId: "conv-codex",
      label: "codex-lane",
      tmuxSession: "h2a-codex-lane",
      sessionClass: "human",
    }),
    registrySession({
      id: "claude-lane",
      cwd: "/repo/shared",
      convId: "conv-claude",
      label: "claude-lane",
      tmuxSession: "h2a-claude-lane",
      sessionClass: "human",
    }),
    registrySession({
      id: "unresumable",
      tool: "agy",
      cwd: "/repo/agy",
      convId: "unresumable",
      label: "unresumable",
      tmuxSession: "h2a-unresumable",
      sessionClass: "human",
    }),
  ];

  beforeEach(() => {
    listLocalSessions.mockReturnValue(sessions);
    listLocalSessionsWithDiagnostics.mockReturnValue({
      sessions,
      known: true,
    });
    writeRegistry(resumableRegistry);
  });

  it("shows the complete bulk dry-run plan without killing or starting sessions", async () => {
    const exitCode = await main([
      "node",
      "h2a",
      "relaunch",
      "--all",
      "--include-agents",
    ]);

    expect(exitCode).toBe(0);
    expect(killLocalSession).not.toHaveBeenCalled();
    expect(startLocalSession).not.toHaveBeenCalled();
    expect(stderrText()).toContain("WARNING");
    expect(stderrText()).toContain("codex-lane");
    expect(stderrText()).toContain("claude-lane");
    expect(stderrText()).toContain("codex resume conv-codex");
    expect(stderrText()).toContain("claude --resume conv-claude");
    expect(stderrText()).toContain("unresumable");
    expect(stderrText()).toContain("no resumable conversation");
  });

  it("blocks an applied bulk restart without typed confirmation or --yes", async () => {
    const exitCode = await main([
      "node",
      "h2a",
      "relaunch",
      "--all",
      "--include-agents",
      "--apply",
    ]);

    expect(exitCode).toBe(1);
    expect(killLocalSession).not.toHaveBeenCalled();
    expect(startLocalSession).not.toHaveBeenCalled();
    expect(stderrText()).toContain("WARNING");
    expect(stderrText()).toContain("RELAUNCH");
  });

  it("excludes interactive agent CLIs from an applied bulk restart by default", async () => {
    const exitCode = await main([
      "node",
      "h2a",
      "relaunch",
      "--all",
      "--apply",
      "--yes",
    ]);

    expect(exitCode).toBe(0);
    expect(killLocalSession).not.toHaveBeenCalled();
    expect(startLocalSession).not.toHaveBeenCalled();
    expect(stderrText()).toContain("interactive agent CLI");
  });

  it("force-restarts every included session with its own registry conversation", async () => {
    const exitCode = await main([
      "node",
      "h2a",
      "relaunch",
      "--all",
      "--include-agents",
      "--apply",
      "--yes",
    ]);

    expect(exitCode).toBe(0);
    expect(killLocalSession).toHaveBeenNthCalledWith(1, "h2a-codex-lane");
    expect(killLocalSession).toHaveBeenNthCalledWith(2, "h2a-claude-lane");
    expect(startLocalSession).toHaveBeenNthCalledWith(
      1,
      "codex",
      "codex",
      "/repo/shared",
      ["resume", "conv-codex"],
      "codex-lane",
      undefined,
      { sessionClass: "human" },
    );
    expect(startLocalSession).toHaveBeenNthCalledWith(
      2,
      "claude",
      "claude",
      "/repo/shared",
      ["--resume", "conv-claude"],
      "claude-lane",
      undefined,
      { sessionClass: "human" },
    );
    expect(stderrText()).toContain("unresumable");
    expect(stderrText()).toContain("no resumable conversation");
  });

  it("never force-relaunches a working agent even when the old child count says idle", async () => {
    // Reproduce the measured mass-kill shape: localSessionIdle's flaky count
    // says the bash wrapper is idle, while the worker/CPU safety floor says it
    // is working at 100 ms/s.
    localSessionIdle.mockReturnValue(true);
    sessionRelaunchSafety.mockImplementation((name: string) =>
      name === "h2a-codex-lane"
        ? {
            idle: false,
            activelyWorking: true,
            rateMsPerSecond: 100,
            reason: "live working CLI — never killed (even with --force)",
          }
        : {
            idle: true,
            activelyWorking: false,
            reason: "test parked/dead session",
          },
    );

    const exitCode = await main([
      "node",
      "h2a",
      "relaunch",
      "--all",
      "--include-agents",
      "--apply",
      "--yes",
    ]);

    expect(exitCode).toBe(0);
    expect(killLocalSession).not.toHaveBeenCalledWith("h2a-codex-lane");
    expect(startLocalSession).not.toHaveBeenCalledWith(
      "codex",
      "codex",
      "/repo/shared",
      ["resume", "conv-codex"],
      "codex-lane",
      undefined,
      { sessionClass: "human" },
    );
    expect(killLocalSession).toHaveBeenCalledWith("h2a-claude-lane");
    expect(stderrText()).toContain("never killed");
  });

  it("skips a forced relaunch when the worker CPU probe is indeterminate", async () => {
    sessionRelaunchSafety.mockImplementation((name: string) =>
      name === "h2a-codex-lane"
        ? {
            idle: false,
            activelyWorking: true,
            reason: "liveness indeterminate: CPU rate could not be computed",
          }
        : {
            idle: true,
            activelyWorking: false,
            reason: "test parked/dead session",
          },
    );

    const exitCode = await main([
      "node",
      "h2a",
      "relaunch",
      "codex-lane",
      "--apply",
    ]);

    expect(exitCode).toBe(0);
    expect(killLocalSession).not.toHaveBeenCalled();
    expect(startLocalSession).not.toHaveBeenCalled();
    expect(stderrText()).toContain("liveness indeterminate");
  });

  it("force-restarts one exact named session after --apply", async () => {
    const exitCode = await main([
      "node",
      "h2a",
      "relaunch",
      "codex-lane",
      "--apply",
    ]);

    expect(exitCode).toBe(0);
    expect(killLocalSession).toHaveBeenCalledWith("h2a-codex-lane");
    expect(startLocalSession).toHaveBeenCalledWith(
      "codex",
      "codex",
      "/repo/shared",
      ["resume", "conv-codex"],
      "codex-lane",
      undefined,
      { sessionClass: "human" },
    );
    expect(stderrText()).toContain("confirmed");
  });

  it("preserves a background session class on an explicit forced restart", async () => {
    const background = {
      name: "h2a-background-lane",
      slug: "background-lane",
      profile: "codex",
      path: "/repo/background",
      attached: false,
    };
    listLocalSessionsWithDiagnostics.mockReturnValue({
      sessions: [background],
      known: true,
    });
    writeRegistry([
      registrySession({
        id: "background-lane",
        tool: "codex",
        cwd: "/repo/background",
        convId: "conv-background",
        label: "background-lane",
        tmuxSession: "h2a-background-lane",
        sessionClass: "background",
      }),
    ]);

    const exitCode = await main([
      "node",
      "h2a",
      "relaunch",
      "background-lane",
      "--apply",
    ]);

    expect(exitCode).toBe(0);
    expect(startLocalSession).toHaveBeenCalledWith(
      "codex",
      "codex",
      "/repo/background",
      ["resume", "conv-background"],
      "background-lane",
      undefined,
      { sessionClass: "background" },
    );
  });

  it("keeps the single-writer guard ahead of the forced kill", async () => {
    getDefaultRemote.mockReturnValue("http://localhost:8080");
    listRemoteSessions.mockResolvedValue([liveRemoteWriter("conv-codex")]);

    const exitCode = await main([
      "node",
      "h2a",
      "relaunch",
      "codex-lane",
      "--apply",
    ]);

    expect(exitCode).toBe(1);
    expect(killLocalSession).not.toHaveBeenCalled();
    expect(startLocalSession).not.toHaveBeenCalled();
    expect(stderrText()).toContain("sess-b");
  });
});

describe("h2a resume <slug>", () => {
  it("opens Claude's native resume selector when --claude has no id", async () => {
    const cwd = process.cwd();
    const expectedSlug = cwd.split("/").filter(Boolean).pop() ?? "session";

    const exitCode = await main(["node", "remote", "resume", "--claude"]);

    expect(exitCode).toBe(0);
    expect(startLocalSession).toHaveBeenCalledWith(
      "claude",
      "claude",
      cwd,
      ["--resume"],
      expectedSlug,
      undefined,
      expect.any(Object), // options: sessionClass is DERIVED by the product; not pinned here
    );
  });

  it("opens Codex's native resume selector when --codex has no id", async () => {
    const cwd = process.cwd();
    const expectedSlug = cwd.split("/").filter(Boolean).pop() ?? "session";

    const exitCode = await main(["node", "remote", "resume", "--codex"]);

    expect(exitCode).toBe(0);
    expect(startLocalSession).toHaveBeenCalledWith(
      "codex",
      "codex",
      cwd,
      ["resume"],
      expectedSlug,
      undefined,
      expect.any(Object), // options: sessionClass is DERIVED by the product; not pinned here
    );
  });

  it("resumes the last local Claude conversation with --claude --last", async () => {
    const cwd = process.cwd();
    const expectedSlug = cwd.split("/").filter(Boolean).pop() ?? "session";
    localConvStat.mockReturnValue({
      convId: "claude-last",
      bytes: 12,
      lines: 2,
      sha: "abc123",
    });

    const exitCode = await main([
      "node",
      "remote",
      "resume",
      "--claude",
      "--last",
      "--gw",
    ]);

    expect(exitCode).toBe(0);
    expect(localConvStat).toHaveBeenCalledWith(cwd);
    expect(startLocalSession).toHaveBeenCalledWith(
      "claude",
      "claude",
      cwd,
      ["--resume", "claude-last"],
      expectedSlug,
      undefined,
      expect.any(Object), // options: sessionClass is DERIVED by the product; not pinned here
    );
  });

  it("attaches an already-active explicit Claude resume target instead of requiring a second command", async () => {
    localConvStat.mockReturnValue({
      convId: "claude-last",
      bytes: 12,
      lines: 2,
      sha: "abc123",
    });
    findLocalSession.mockReturnValue({
      name: "remote-remote-cli",
      slug: "remote-cli",
      profile: "claude",
      path: process.cwd(),
      attached: false,
    });
    localSessionIdle.mockReturnValue(false);

    const exitCode = await main([
      "node",
      "remote",
      "resume",
      "--claude",
      "--last",
      "--gw",
    ]);

    expect(exitCode).toBe(0);
    expect(startLocalSession).not.toHaveBeenCalled();
    expect(attachLocalSession).toHaveBeenCalledWith("remote-remote-cli");
    expect(stderrText()).toContain("no new claude was started");
    expect(stderrText()).toContain("switching to existing session remote-cli");
    expect(stderrText()).not.toContain("attach: h2a attach remote-cli");
  });

  it("runs the CLI in-place when explicit resume is invoked from inside the target tmux session", async () => {
    localConvStat.mockReturnValue({
      convId: "claude-last",
      bytes: 12,
      lines: 2,
      sha: "abc123",
    });
    findLocalSession.mockReturnValue({
      name: "remote-remote-cli",
      slug: "remote-cli",
      profile: "claude",
      path: process.cwd(),
      attached: true,
    });
    localSessionIdle.mockReturnValue(false);
    currentTmuxSessionIs.mockReturnValue(true);

    const exitCode = await main([
      "node",
      "remote",
      "resume",
      "--claude",
      "--last",
    ]);

    expect(exitCode).toBe(0);
    expect(startLocalSession).not.toHaveBeenCalled();
    expect(attachLocalSession).not.toHaveBeenCalled();
    expect(runLocalCliForeground).toHaveBeenCalledWith("claude", [
      "--resume",
      "claude-last",
    ]);
    expect(stderrText()).toContain("already inside remote-cli");
  });

  it("does not restart an active Claude session when it lacks the current llm-mesh env", async () => {
    localConvStat.mockReturnValue({
      convId: "claude-last",
      bytes: 12,
      lines: 2,
      sha: "abc123",
    });
    acquireLlmMeshSessionEnv.mockResolvedValue({
      ANTHROPIC_BASE_URL: "http://localhost:3002",
      ANTHROPIC_AUTH_TOKEN: "gw-current",
      ANTHROPIC_API_KEY: "gw-current",
    });
    findLocalSession.mockReturnValue({
      name: "remote-remote-cli",
      slug: "remote-cli",
      profile: "claude",
      path: process.cwd(),
      attached: true,
    });
    localSessionIdle.mockReturnValue(false);
    localSessionGatewayEnvStatus.mockReturnValue("missing");
    startLocalSession.mockReturnValue({
      name: "remote-remote-cli",
      slug: "remote-cli",
    });

    const exitCode = await main([
      "node",
      "remote",
      "resume",
      "--claude",
      "--last",
      "--gw",
    ]);

    expect(exitCode).toBe(0);
    expect(killLocalSession).not.toHaveBeenCalled();
    expect(startLocalSession).not.toHaveBeenCalled();
    expect(attachLocalSession).toHaveBeenCalledWith("remote-remote-cli");
    expect(stderrText()).toContain("without current llm-mesh env");
    expect(stderrText()).toContain(
      "not restarting an active session automatically",
    );
    expect(stderrText()).toContain("h2a resume remote-cli --replace");
  });

  it("resumes Codex's native last session with --codex --last", async () => {
    const cwd = process.cwd();
    const expectedSlug = cwd.split("/").filter(Boolean).pop() ?? "session";

    const exitCode = await main([
      "node",
      "remote",
      "resume",
      "--codex",
      "--last",
    ]);

    expect(exitCode).toBe(0);
    expect(startLocalSession).toHaveBeenCalledWith(
      "codex",
      "codex",
      cwd,
      ["resume", "--last"],
      expectedSlug,
      undefined,
      expect.any(Object), // options: sessionClass is DERIVED by the product; not pinned here
    );
  });

  it("fails clearly when --claude --last has no local conversation", async () => {
    const exitCode = await main([
      "node",
      "remote",
      "resume",
      "--claude",
      "--last",
    ]);

    expect(exitCode).toBe(1);
    expect(startLocalSession).not.toHaveBeenCalled();
    expect(stderrText()).toContain("no local Claude conversation found");
  });

  it("enrolls and resumes an existing Claude conversation from the current directory", async () => {
    const cwd = process.cwd();
    const expectedSlug = cwd.split("/").filter(Boolean).pop() ?? "session";

    const exitCode = await main([
      "node",
      "remote",
      "resume",
      "--claude",
      "claude-existing",
    ]);

    expect(exitCode).toBe(0);
    expect(startLocalSession).toHaveBeenCalledWith(
      "claude",
      "claude",
      cwd,
      ["--resume", "claude-existing"],
      expectedSlug,
      undefined,
      expect.any(Object), // options: sessionClass is DERIVED by the product; not pinned here
    );
    expect(stderrText()).toContain(`resumed local session ${expectedSlug}`);
    expect(stderrText()).toContain(`h2a attach ${expectedSlug}`);
  });

  it("uses the optional resume slug as the local name with --claude", async () => {
    const cwd = process.cwd();

    const exitCode = await main([
      "node",
      "remote",
      "resume",
      "geo",
      "--claude",
      "claude-existing",
    ]);

    expect(exitCode).toBe(0);
    expect(startLocalSession).toHaveBeenCalledWith(
      "claude",
      "claude",
      cwd,
      ["--resume", "claude-existing"],
      "geo",
      undefined,
      expect.any(Object), // options: sessionClass is DERIVED by the product; not pinned here
    );
  });

  it("starts a missing local tmux session from the registry", async () => {
    writeRegistry([registrySession()]);

    const exitCode = await main(["node", "remote", "resume", "projA"]);

    expect(exitCode).toBe(0);
    expect(startLocalSession).toHaveBeenCalledWith(
      "claude",
      "claude",
      "/home/u/src/projA",
      ["--resume", "conv-dup"],
      "projA",
      undefined,
      expect.any(Object), // options: sessionClass is DERIVED by the product; not pinned here
    );
    expect(stderrText()).toContain("resumed local session projA");
    expect(stderrText()).toContain("h2a attach projA");
  });

  it("uses Anthropic gateway auth token with claude --bare", async () => {
    acquireLlmMeshSessionEnv.mockResolvedValue({
      ANTHROPIC_BASE_URL: "http://localhost:3002",
      ANTHROPIC_AUTH_TOKEN: "gw-test",
      ANTHROPIC_API_KEY: "gw-test",
    });
    writeRegistry([registrySession()]);

    const exitCode = await main(["node", "remote", "resume", "projA", "--gw"]);

    expect(exitCode).toBe(0);
    expect(startLocalSession).toHaveBeenCalledWith(
      "claude",
      "claude",
      "/home/u/src/projA",
      ["--bare", "--resume", "conv-dup"],
      "projA",
      undefined,
      expect.any(Object), // options: sessionClass is DERIVED by the product; not pinned here
    );
    expect(process.env.ANTHROPIC_BASE_URL).toBe("http://localhost:3002");
    expect(process.env.ANTHROPIC_AUTH_TOKEN).toBe("gw-test");
    expect(process.env.ANTHROPIC_API_KEY).toBe("gw-test");
    expect(acquireLlmMeshSessionEnv).toHaveBeenCalledWith(
      undefined,
      "conv-dup",
    );
  });

  it("overwrites stale parent Anthropic env with current llm-mesh token", async () => {
    process.env.ANTHROPIC_BASE_URL = "http://localhost:3002";
    process.env.ANTHROPIC_AUTH_TOKEN = "gw-stale";
    delete process.env.ANTHROPIC_API_KEY;
    acquireLlmMeshSessionEnv.mockResolvedValue({
      ANTHROPIC_BASE_URL: "http://localhost:3002",
      ANTHROPIC_AUTH_TOKEN: "gw-current",
      ANTHROPIC_API_KEY: "gw-current",
    });
    writeRegistry([registrySession()]);

    const exitCode = await main(["node", "remote", "resume", "projA", "--gw"]);

    expect(exitCode).toBe(0);
    expect(startLocalSession).toHaveBeenCalledWith(
      "claude",
      "claude",
      "/home/u/src/projA",
      ["--bare", "--resume", "conv-dup"],
      "projA",
      undefined,
      expect.any(Object), // options: sessionClass is DERIVED by the product; not pinned here
    );
    expect(process.env.ANTHROPIC_BASE_URL).toBe("http://localhost:3002");
    expect(process.env.ANTHROPIC_AUTH_TOKEN).toBe("gw-current");
    expect(process.env.ANTHROPIC_API_KEY).toBe("gw-current");
    expect(stderrText()).toContain("injecting gateway env");
  });

  it("reports explicit --gw fallback when no gateway env or accounts exist", async () => {
    writeRegistry([registrySession()]);

    const exitCode = await main(["node", "remote", "resume", "projA", "--gw"]);

    expect(exitCode).toBe(0);
    expect(startGateway).not.toHaveBeenCalled();
    expect(startLocalSession).toHaveBeenCalledWith(
      "claude",
      "claude",
      "/home/u/src/projA",
      ["--resume", "conv-dup"],
      "projA",
      undefined,
      expect.any(Object), // options: sessionClass is DERIVED by the product; not pinned here
    );
    expect(process.env.ANTHROPIC_BASE_URL).toBeUndefined();
    expect(process.env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
    expect(process.env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(stderrText()).toContain(
      "--gw requested but no gateway env is available",
    );
  });

  it("rejects contradictory gateway flags", async () => {
    writeRegistry([registrySession()]);

    const exitCode = await main([
      "node",
      "remote",
      "resume",
      "projA",
      "--llm-gateway",
      "--no-gw",
    ]);

    expect(exitCode).toBe(1);
    expect(startLocalSession).not.toHaveBeenCalled();
    expect(stderrText()).toContain(
      "pass either --llm-gateway/--gw or --no-llm-gateway/--no-gw, not both",
    );
  });

  it("starts configured llm-mesh automatically before resuming Claude", async () => {
    readLlmMeshConfig.mockReturnValue({
      accounts: [
        {
          id: "codex-oauth",
          provider: "openai",
          label: "Codex",
          token: "tok",
        },
      ],
    });
    startGateway.mockResolvedValue({
      pid: 123,
      port: 3002,
      gatewayToken: "gw-started",
    });
    writeRegistry([registrySession()]);

    const exitCode = await main(["node", "remote", "resume", "projA", "--gw"]);

    expect(exitCode).toBe(0);
    expect(startGateway).toHaveBeenCalled();
    expect(startLocalSession).toHaveBeenCalledWith(
      "claude",
      "claude",
      "/home/u/src/projA",
      ["--bare", "--resume", "conv-dup"],
      "projA",
      undefined,
      expect.any(Object), // options: sessionClass is DERIVED by the product; not pinned here
    );
    expect(process.env.ANTHROPIC_AUTH_TOKEN).toBe("gw-started");
    expect(process.env.ANTHROPIC_API_KEY).toBe("gw-started");
    expect(stderrText()).toContain("gateway was stopped; started");
  });

  it("does not auto-start llm-mesh by default", async () => {
    getLlmMeshRuntimeConfig.mockReturnValue({ enabled: false });
    readLlmMeshConfig.mockReturnValue({
      accounts: [
        {
          id: "codex-oauth",
          provider: "openai",
          label: "Codex",
          token: "tok",
        },
      ],
    });
    startGateway.mockResolvedValue({
      pid: 123,
      port: 3002,
      gatewayToken: "gw-started",
    });
    writeRegistry([registrySession()]);

    const exitCode = await main(["node", "remote", "resume", "projA"]);

    expect(exitCode).toBe(0);
    expect(startGateway).not.toHaveBeenCalled();
    expect(startLocalSession).toHaveBeenCalledWith(
      "claude",
      "claude",
      "/home/u/src/projA",
      ["--resume", "conv-dup"],
      "projA",
      undefined,
      expect.any(Object), // options: sessionClass is DERIVED by the product; not pinned here
    );
    expect(process.env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
  });

  it("--no-gw forces direct auth even when llm-mesh config is enabled", async () => {
    getLlmMeshRuntimeConfig.mockReturnValue({ enabled: true });
    readLlmMeshConfig.mockReturnValue({
      accounts: [
        {
          id: "codex-oauth",
          provider: "openai",
          label: "Codex",
          token: "tok",
        },
      ],
    });
    startGateway.mockResolvedValue({
      pid: 123,
      port: 3002,
      gatewayToken: "gw-started",
    });
    writeRegistry([registrySession()]);

    const exitCode = await main([
      "node",
      "remote",
      "resume",
      "projA",
      "--no-gw",
    ]);

    expect(exitCode).toBe(0);
    expect(startGateway).not.toHaveBeenCalled();
    expect(startLocalSession).toHaveBeenCalledWith(
      "claude",
      "claude",
      "/home/u/src/projA",
      ["--resume", "conv-dup"],
      "projA",
      undefined,
      expect.any(Object), // options: sessionClass is DERIVED by the product; not pinned here
    );
    expect(process.env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
  });

  it("does not replace an existing non-idle session", async () => {
    writeRegistry([registrySession()]);
    findLocalSession.mockReturnValue({
      name: "remote-projA",
      slug: "projA",
      profile: "claude",
      path: "/home/u/src/projA",
      attached: false,
    });
    localSessionIdle.mockReturnValue(false);

    const exitCode = await main(["node", "remote", "resume", "projA"]);

    expect(exitCode).toBe(2);
    expect(killLocalSession).not.toHaveBeenCalled();
    expect(startLocalSession).not.toHaveBeenCalled();
    expect(stderrText()).toContain("does not look idle");
    expect(stderrText()).toContain("h2a attach projA");
  });

  it("accepts a full tmux session name and canonicalizes to its slug", async () => {
    writeRegistry([registrySession()]);
    findLocalSession.mockReturnValue({
      name: "remote-projA",
      slug: "projA",
      profile: "claude",
      path: "/home/u/src/projA",
      attached: false,
    });
    localSessionIdle.mockReturnValue(true);

    const exitCode = await main([
      "node",
      "remote",
      "resume",
      "remote-projA",
      "--replace",
    ]);

    expect(exitCode).toBe(0);
    expect(startLocalSession).toHaveBeenCalledWith(
      "claude",
      "claude",
      "/home/u/src/projA",
      ["--resume", "conv-dup"],
      "projA",
      undefined,
      expect.any(Object), // options: sessionClass is DERIVED by the product; not pinned here
    );
    expect(stderrText()).toContain("replaced local session projA");
  });

  it("can attach/no-op an active named local session even without registry", async () => {
    findLocalSession.mockReturnValue({
      name: "remote-projA",
      slug: "projA",
      profile: "claude",
      path: "/home/u/src/projA",
      attached: false,
    });
    localSessionIdle.mockReturnValue(false);

    const exitCode = await main(["node", "remote", "resume", "remote-projA"]);

    expect(exitCode).toBe(2);
    expect(startLocalSession).not.toHaveBeenCalled();
    expect(stderrText()).toContain("local session projA already exists");
    expect(stderrText()).toContain("h2a attach projA");
  });

  it("replaces an existing idle session with --replace after rechecking", async () => {
    writeRegistry([registrySession()]);
    findLocalSession.mockReturnValue({
      name: "remote-projA",
      slug: "projA",
      profile: "claude",
      path: "/home/u/src/projA",
      attached: false,
    });
    localSessionIdle.mockReturnValue(true);

    const exitCode = await main([
      "node",
      "remote",
      "resume",
      "projA",
      "--replace",
    ]);

    expect(exitCode).toBe(0);
    expect(killLocalSession).toHaveBeenCalledWith("remote-projA");
    expect(startLocalSession).toHaveBeenCalled();
    expect(stderrText()).toContain("replaced local session projA");
    expect(stderrText()).toContain("resumed local session projA");
  });

  it("honors --replace even when the existing session does not look idle", async () => {
    writeRegistry([registrySession()]);
    findLocalSession.mockReturnValue({
      name: "remote-projA",
      slug: "projA",
      profile: "claude",
      path: "/home/u/src/projA",
      attached: false,
    });
    localSessionIdle.mockReturnValue(false);

    const exitCode = await main([
      "node",
      "remote",
      "resume",
      "projA",
      "--replace",
    ]);

    expect(exitCode).toBe(0);
    expect(killLocalSession).toHaveBeenCalledWith("remote-projA");
    expect(startLocalSession).toHaveBeenCalledWith(
      "claude",
      "claude",
      "/home/u/src/projA",
      ["--resume", "conv-dup"],
      "projA",
      undefined,
      expect.any(Object), // options: sessionClass is DERIVED by the product; not pinned here
    );
    expect(stderrText()).toContain(
      "--replace will kill tmux session remote-projA",
    );
  });
});

describe("h2a run -r <conv> single-writer guard", () => {
  it("uses the canonical tmux name as the gateway session id for a new launch", async () => {
    acquireLlmMeshSessionEnv.mockResolvedValue({
      ANTHROPIC_BASE_URL: "http://localhost:3002",
      ANTHROPIC_AUTH_TOKEN: "gw-launch",
      ANTHROPIC_API_KEY: "gw-launch",
    });

    const exitCode = await main([
      "node",
      "remote",
      "run",
      "claude",
      "--name",
      "gateway-worker",
      "--gw",
      "--no-attach",
    ]);

    expect(exitCode).toBe(0);
    expect(acquireLlmMeshSessionEnv).toHaveBeenCalledWith(
      undefined,
      "h2a-gateway-worker",
    );
  });

  it("refuses an existing local target before guard, gateway, registry, or spawn", async () => {
    findLocalSession.mockReturnValue({
      name: "remote-projA",
      slug: "projA",
      profile: "claude",
      path: "/home/u/src/projA",
      attached: false,
    });
    getDefaultRemote.mockReturnValue("http://localhost:8080");
    listRemoteSessions.mockResolvedValue([liveRemoteWriter("conv-dup")]);

    const exitCode = await main([
      "node",
      "remote",
      "run",
      "claude",
      "/home/u/src/projA",
      "--name",
      "projA",
      "--resume",
      "conv-dup",
    ]);

    expect(exitCode).toBe(1);
    expect(startLocalSession).not.toHaveBeenCalled();
    expect(listRemoteSessions).not.toHaveBeenCalled();
    expect(stderrText()).toContain("local session projA already exists");
    expect(stderrText()).toContain("no new claude was started");
    expect(stderrText()).toContain("h2a attach projA");
    expect(stderrText()).toContain("h2a stop projA --reason restart");
    expect(stderrText()).not.toContain("llm-mesh");
  });

  it("refuses when a live REMOTE session holds the conversation (cliSessionId)", async () => {
    getDefaultRemote.mockReturnValue("http://localhost:8080");
    listRemoteSessions.mockResolvedValue([liveRemoteWriter("conv-dup")]);

    const exitCode = await main([
      "node",
      "remote",
      "run",
      "claude",
      "--resume",
      "conv-dup",
    ]);

    expect(exitCode).toBe(1);
    expect(startLocalSession).not.toHaveBeenCalled();
    expect(stderrText()).toContain("sess-b");
  });

  it("WARNS but PROCEEDS on an unverifiable no-pid local writer (crash-stale hook entry)", async () => {
    writeRegistry([unverifiableLocalWriter("conv-dup")]);

    const exitCode = await main([
      "node",
      "remote",
      "run",
      "claude",
      "--resume",
      "conv-dup",
    ]);

    // No hard block: a no-pid hook entry can't be verified, so it must not
    // refuse the relaunch (this is the crash-recovery fix).
    expect(exitCode).toBe(0);
    expect(startLocalSession).toHaveBeenCalled();
    expect(stderrText()).toContain("make sure it is not resuming");
  });

  it("--force overrides a hard (remote) block with a warning and starts the session", async () => {
    getDefaultRemote.mockReturnValue("http://localhost:8080");
    listRemoteSessions.mockResolvedValue([liveRemoteWriter("conv-dup")]);

    const exitCode = await main([
      "node",
      "remote",
      "run",
      "claude",
      "--resume",
      "conv-dup",
      "--force",
    ]);

    expect(exitCode).toBe(0);
    expect(startLocalSession).toHaveBeenCalled();
    expect(stderrText()).toContain("--force");
    expect(stderrText()).toContain("corrupt");
  });

  it("proceeds when the live writer is on a DIFFERENT conversation", async () => {
    writeRegistry([unverifiableLocalWriter("conv-other")]);

    const exitCode = await main([
      "node",
      "remote",
      "run",
      "claude",
      "--resume",
      "conv-dup",
    ]);

    expect(exitCode).toBe(0);
    expect(startLocalSession).toHaveBeenCalled();
  });
});

describe("h2a migrate forward -r <conv> single-writer guard", () => {
  it("WARNS but PROCEEDS on an unverifiable no-pid local writer", async () => {
    getDefaultRemote.mockReturnValue("http://localhost:8080");
    writeRegistry([unverifiableLocalWriter("conv-dup")]);

    const exitCode = await main([
      "node",
      "remote",
      "migrate",
      "forward",
      "claude",
      "-r",
      "conv-dup",
    ]);

    expect(exitCode).toBe(0);
    expect(migrateForward).toHaveBeenCalled();
    expect(stderrText()).toContain("make sure it is not resuming");
  });

  it("refuses when ANOTHER pod already holds the conversation", async () => {
    getDefaultRemote.mockReturnValue("http://localhost:8080");
    listRemoteSessions.mockResolvedValue([liveRemoteWriter("conv-dup")]);

    const exitCode = await main([
      "node",
      "remote",
      "migrate",
      "forward",
      "claude",
      "-r",
      "conv-dup",
    ]);

    expect(exitCode).toBe(1);
    expect(migrateForward).not.toHaveBeenCalled();
    expect(stderrText()).toContain("h2a stop sess-b");
  });

  it("--force overrides a hard (remote) block and proceeds with the migration", async () => {
    getDefaultRemote.mockReturnValue("http://localhost:8080");
    listRemoteSessions.mockResolvedValue([liveRemoteWriter("conv-dup")]);

    const exitCode = await main([
      "node",
      "remote",
      "migrate",
      "forward",
      "claude",
      "-r",
      "conv-dup",
      "--force",
    ]);

    expect(exitCode).toBe(0);
    expect(migrateForward).toHaveBeenCalledWith(
      expect.objectContaining({ profile: "claude", resume: "conv-dup" }),
    );
  });

  it("bare --resume resolves the most-recent local conversation and guards it (POD holds it → refuse)", async () => {
    // `-r` without a convId resolves "the most recent conversation" — that
    // resolution must happen BEFORE the guard. A POD holding it is a HARD block.
    getDefaultRemote.mockReturnValue("http://localhost:8080");
    localConvStat.mockReturnValue({
      convId: "conv-dup",
      bytes: 10,
      lines: 2,
      sha: "abc",
    });
    listRemoteSessions.mockResolvedValue([liveRemoteWriter("conv-dup")]);

    const exitCode = await main([
      "node",
      "remote",
      "migrate",
      "forward",
      "claude",
      "-r",
    ]);

    expect(exitCode).toBe(1);
    expect(migrateForward).not.toHaveBeenCalled();
    expect(localConvStat).toHaveBeenCalledWith(process.cwd());
    expect(stderrText()).toContain("h2a stop sess-b");
  });

  it("bare --resume --force overrides the resolved-conversation guard", async () => {
    getDefaultRemote.mockReturnValue("http://localhost:8080");
    localConvStat.mockReturnValue({
      convId: "conv-dup",
      bytes: 10,
      lines: 2,
      sha: "abc",
    });
    listRemoteSessions.mockResolvedValue([liveRemoteWriter("conv-dup")]);

    const exitCode = await main([
      "node",
      "remote",
      "migrate",
      "forward",
      "claude",
      "-r",
      "--force",
    ]);

    expect(exitCode).toBe(0);
    expect(migrateForward).toHaveBeenCalledWith(
      expect.objectContaining({ profile: "claude", resume: true }),
    );
    expect(stderrText()).toContain("--force");
  });

  it("does not guard bare --resume when there is NO local conversation (unchanged)", async () => {
    getDefaultRemote.mockReturnValue("http://localhost:8080");
    localConvStat.mockReturnValue(undefined);
    writeRegistry([unverifiableLocalWriter("conv-dup")]);

    const exitCode = await main([
      "node",
      "remote",
      "migrate",
      "forward",
      "claude",
      "-r",
    ]);

    expect(exitCode).toBe(0);
    expect(migrateForward).toHaveBeenCalled();
  });
});
