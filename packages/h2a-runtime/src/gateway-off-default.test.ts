// @ts-ignore Shared JS test isolation helper.
import { setupNativeTestEnvironment } from "../../h2a/test/helpers/native-isolation.js";
setupNativeTestEnvironment(afterAll);
/**
 * Gateway off by default (owner: 33 requests since 23/06, primo-install
 * must not set up the gateway). Every launch is DIRECT unless the gateway
 * is explicitly asked for (--gw / MCP required / explicit proven choice).
 *
 * - restore global preparation: only --gw prewarms (matrix ported from #273)
 * - injectLlmMeshGatewayEnv: auto resolves to direct BEFORE any acquire/start;
 *   legacy enabled/service/accounts/parent env never select gateway routing
 * - llm-mesh start/restart never persist enabled=true; stop clears it
 * - run --resume with a legacy pin (no provenance) stays direct; --no-gw
 *   wins; explicit proven choices are kept
 * - direct child env: h2a routing vars stripped even with native API key
 */
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Scratch inside the package (never /tmp, never owner state).
const SCRATCH = mkdtempSync(join(tmpdir(), "h2a-gw-off-"));
const CONFIG_HOME = join(SCRATCH, "config-home");
const JOB_CWD = join(SCRATCH, "job-cwd");
const RUN_CWD = join(SCRATCH, "run-cwd");
const ORIGINAL_ENV = {
  ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL,
  ANTHROPIC_AUTH_TOKEN: process.env.ANTHROPIC_AUTH_TOKEN,
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
};
const ORIGINAL_EXIT_CODE = process.exitCode;

const acquireLlmMeshSessionEnv = vi.fn();
const readLlmMeshConfig = vi.fn((): { port?: number } => ({}));
const startGateway = vi.fn();
const stopGateway = vi.fn();
const readGatewayPid = vi.fn((): number | null => null);

const startLocalSession = vi.fn();
const startHeadlessSession = vi.fn();
const startH2aWindow = vi.fn();
const attachLocalSession = vi.fn((): number => 0);
const currentTmuxSessionIs = vi.fn((): boolean => false);
const findLocalSession = vi.fn((): undefined => undefined);
const killLocalSession = vi.fn((): boolean => true);
const listLocalSessions = vi.fn((): never[] => []);
const listLocalSessionsWithDiagnostics = vi.fn(() => ({
  sessions: [] as never[],
  known: true as const,
}));
const localSessionIdle = vi.fn((): boolean => false);
const sessionRelaunchSafety = vi.fn();
const localSessionGatewayEnvStatus = vi.fn((): string => "unknown");
const listRemoteSessions = vi.fn();
const getDefaultRemote = vi.fn();
const relaunchInSession = vi.fn((): boolean => true);
const wakeRelaunchedSession = vi.fn(() => ({
  state: "working" as const,
  confirmation: "not-present" as const,
  delivery: { cpuDeltaMs: 0, evidence: "test" },
}));
const createRemoteSession = vi.fn(async () => ({ id: "sess-remote" }));
const attachRemote = vi.fn(async () => ({ finished: Promise.resolve() }));
const localPtySpawner = vi.fn<import("./pty.js").PtySpawner>(() => { throw new Error("fixture PTY boundary"); });

vi.mock("./pty.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("./pty.js")>(),
  nodePtySpawner: localPtySpawner,
}));

vi.mock("./gateway-host/config-file.js", () => ({
  readLlmMeshConfig,
  writeLlmMeshConfig: vi.fn(),
}));

vi.mock("./gateway-host/daemon.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./gateway-host/daemon.js")>();
  return {
    ...actual,
    acquireLlmMeshSessionEnv,
    readGatewayPid,
    startGateway,
    stopGateway,
  };
});

vi.mock("./attach.js", () => ({
  attach: attachRemote,
  createRemoteSession,
  getRemoteSession: vi.fn(),
  listRemoteSessions,
  stopRemoteSession: vi.fn(),
  refreshRemoteSession: vi.fn(),
  sessionTerminalHealth: vi.fn(),
}));

vi.mock("./tmux.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./tmux.js")>();
  return {
    ...actual,
    tmuxAvailable: () => true,
    startLocalSession,
    startHeadlessSession,
    startH2aWindow,
    attachLocalSession,
    attachPodTmux: vi.fn(),
    currentTmuxSessionIs,
    existingLocalSessionSlugs: () => [],
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
    relaunchInSession,
    localSessionName: actual.localSessionName,
    managedSessionCandidates: actual.managedSessionCandidates,
    parseManagedSessionName: actual.parseManagedSessionName,
    slugify: actual.slugify,
    persistLaunchContext: () => {},
  };
});

vi.mock("./relaunch.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./relaunch.js")>();
  return {
    ...actual,
    wakeRelaunchedSession,
  };
});

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    spawnSync: ((
      command: string,
      args?: readonly string[],
      ...rest: unknown[]
    ) => {
      if (command === "tmux" && Array.isArray(args) && args[0] === "has-session") {
        return { status: 1, stdout: "", stderr: "", error: undefined };
      }
      if (
        command === process.execPath &&
        Array.isArray(args) &&
        String(args[0] ?? "").includes("native-terminal") &&
        args[1] === "probe"
      ) {
        return {
          status: 0,
          stdout: '{"verdict":"dead","reason":"test-stub: no native host"}\n',
          stderr: "",
          error: undefined,
        };
      }
      return (actual.spawnSync as (...a: unknown[]) => unknown)(command, args, ...rest);
    }) as typeof actual.spawnSync,
  };
});

vi.mock("./convsync.js", () => ({
  encodeCwd: (cwd: string) => cwd.replace(/[^a-zA-Z0-9]/g, "-"),
  localConvStat: vi.fn(() => undefined),
  remoteConvStat: vi.fn(() => undefined),
  alignment: vi.fn(() => ({ state: "missing", detail: "" })),
}));

const stderrWrite = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
vi.spyOn(process.stdout, "write").mockImplementation(() => true);

const { main, injectLlmMeshGatewayEnv, startJob } = await import("./index.js");
const { resolveResumedGatewayMode } = await import("./protocol-local.js");
const { loadRegistry } = await import("./registry.js");

function stderrText(): string {
  return stderrWrite.mock.calls.map((c) => String(c[0])).join("");
}

function readScratchConfig(): Record<string, unknown> {
  const candidates = [
    join(CONFIG_HOME, ".config", "sentropic", "h2a", "config.json"),
    join(CONFIG_HOME, ".config", "sentropic", "remote-cli", "config.json"),
  ];
  for (const path of candidates) {
    try {
      return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    } catch {
      continue;
    }
  }
  return {};
}

function llmMeshEnabled(): unknown {
  const raw = readScratchConfig().llmMesh;
  return raw !== null && typeof raw === "object"
    ? (raw as Record<string, unknown>).enabled
    : undefined;
}

/** Seed the legacy persistent flag the bug relied on: enabled=true. */
function seedLegacyEnabled(): void {
  const dir = join(CONFIG_HOME, ".config", "sentropic", "remote-cli");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "config.json"), JSON.stringify({ llmMesh: { enabled: true } }), "utf8");
}

function seedRegistryEntries(entries: unknown[]): void {
  const dir = join(CONFIG_HOME, ".config", "sentropic", "remote-cli");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "registry.json"), JSON.stringify({ version: 1, entries }), "utf8");
}

function resetAnthropicEnv(): void {
  delete process.env.ANTHROPIC_BASE_URL;
  delete process.env.ANTHROPIC_AUTH_TOKEN;
  delete process.env.ANTHROPIC_API_KEY;
}

beforeAll(() => {
  vi.stubEnv("REMOTE_CLI_CONFIG_HOME", CONFIG_HOME);
  vi.stubEnv("H2A_SESSION_HOST", "tmux");
  mkdirSync(JOB_CWD, { recursive: true });
  mkdirSync(RUN_CWD, { recursive: true });
});

afterAll(() => {
  vi.unstubAllEnvs();
  rmSync(SCRATCH, { recursive: true, force: true });
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  process.exitCode = ORIGINAL_EXIT_CODE;
});

beforeEach(() => {
  mkdirSync(CONFIG_HOME, { recursive: true });
  acquireLlmMeshSessionEnv.mockReset();
  acquireLlmMeshSessionEnv.mockResolvedValue(null);
  readLlmMeshConfig.mockReset();
  readLlmMeshConfig.mockReturnValue({});
  startGateway.mockReset();
  startGateway.mockResolvedValue({ pid: 4242, port: 3002, gatewayToken: "test-token" });
  stopGateway.mockReset();
  stopGateway.mockResolvedValue({ stopped: true, pid: 4242 });
  readGatewayPid.mockReset();
  readGatewayPid.mockReturnValue(null);
  startLocalSession.mockReset();
  startLocalSession.mockReturnValue({ name: "h2a-proj", slug: "proj" });
  startHeadlessSession.mockReset();
  startHeadlessSession.mockReturnValue({ name: "h2a-job1", slug: "job1" });
  startH2aWindow.mockReset();
  listLocalSessionsWithDiagnostics.mockReset();
  listLocalSessionsWithDiagnostics.mockReturnValue({ sessions: [], known: true });
  listLocalSessions.mockReset();
  listLocalSessions.mockReturnValue([]);
  findLocalSession.mockReset();
  findLocalSession.mockReturnValue(undefined);
  listRemoteSessions.mockReset();
  listRemoteSessions.mockResolvedValue([]);
  getDefaultRemote.mockReset();
  getDefaultRemote.mockReturnValue(undefined);
  sessionRelaunchSafety.mockReset();
  sessionRelaunchSafety.mockReturnValue({
    dead: true,
    activatable: false,
    indeterminate: false,
    activelyWorking: false,
    reason: "test dead session",
    identity: { pane: "%test-dead", panePid: 100 },
  });
  stderrWrite.mockClear();
  resetAnthropicEnv();
  relaunchInSession.mockReset();
  relaunchInSession.mockReturnValue(true);
  wakeRelaunchedSession.mockClear();
  createRemoteSession.mockClear();
  attachRemote.mockClear();
  localPtySpawner.mockClear();
  process.exitCode = 0;
  // Fresh scratch config per test: wiping the home forces config defaults.
  rmSync(join(CONFIG_HOME, ".config"), { recursive: true, force: true });
});

afterEach(() => {
  resetAnthropicEnv();
  process.exitCode = 0;
});

describe("injectLlmMeshGatewayEnv (gateway off unless explicitly asked)", () => {
  it("auto never acquires or starts a gateway even when legacy enabled=true", async () => {
    seedLegacyEnabled();
    process.env.ANTHROPIC_BASE_URL = "http://localhost:3002";
    process.env.ANTHROPIC_AUTH_TOKEN = "stale-parent-token";
    acquireLlmMeshSessionEnv.mockResolvedValue({
      ANTHROPIC_BASE_URL: "http://localhost:3002",
      ANTHROPIC_AUTH_TOKEN: "acquired-token",
    });

    const result = await injectLlmMeshGatewayEnv("auto");

    expect(result).toBeUndefined();
    expect(acquireLlmMeshSessionEnv).not.toHaveBeenCalled();
    expect(startGateway).not.toHaveBeenCalled();
    expect(process.env.ANTHROPIC_BASE_URL).toBeUndefined();
    expect(process.env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
  });

  it("auto stays direct when a gateway service is available", async () => {
    seedLegacyEnabled();
    readGatewayPid.mockReturnValue(4242);
    acquireLlmMeshSessionEnv.mockResolvedValue({
      ANTHROPIC_BASE_URL: "http://localhost:3002",
      ANTHROPIC_AUTH_TOKEN: "live-token",
    });

    const result = await injectLlmMeshGatewayEnv("auto", true, "h2a-proj");

    expect(result).toBeUndefined();
    expect(acquireLlmMeshSessionEnv).not.toHaveBeenCalled();
    expect(startGateway).not.toHaveBeenCalled();
    expect(process.env.ANTHROPIC_BASE_URL).toBeUndefined();
  });

  it("direct strips h2a routing vars and preserves native auth", async () => {
    process.env.ANTHROPIC_BASE_URL = "http://localhost:3002";
    process.env.ANTHROPIC_AUTH_TOKEN = "stale-token";
    process.env.ANTHROPIC_API_KEY = "user-native-key";

    const result = await injectLlmMeshGatewayEnv("direct");

    expect(result).toBeUndefined();
    expect(acquireLlmMeshSessionEnv).not.toHaveBeenCalled();
    expect(startGateway).not.toHaveBeenCalled();
    expect(process.env.ANTHROPIC_BASE_URL).toBeUndefined();
    expect(process.env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
    expect(process.env.ANTHROPIC_API_KEY).toBe("user-native-key");
  });

  it("explicit gateway still injects when available (positive)", async () => {
    acquireLlmMeshSessionEnv.mockResolvedValue({
      ANTHROPIC_BASE_URL: "http://localhost:3002",
      ANTHROPIC_AUTH_TOKEN: "gw-token",
    });

    const result = await injectLlmMeshGatewayEnv("gateway", false, "h2a-proj");

    expect(result).toBe("http://localhost:3002");
    expect(acquireLlmMeshSessionEnv).toHaveBeenCalled();
    expect(process.env.ANTHROPIC_BASE_URL).toBe("http://localhost:3002");
  });

  it("explicit gateway fails closed before any child starts (positive)", async () => {
    acquireLlmMeshSessionEnv.mockResolvedValue(null);
    startGateway.mockRejectedValue(new Error("gateway boot failed"));

    await expect(injectLlmMeshGatewayEnv("gateway", false)).rejects.toThrow(
      /gateway is required but unavailable.*no agent was started/i,
    );
    expect(process.env.ANTHROPIC_BASE_URL).toBeUndefined();
    expect(process.env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
  });
});

describe("resolveResumedGatewayMode (provenance of the pin)", () => {
  it("legacy pin without provenance never selects the gateway", () => {
    expect(resolveResumedGatewayMode("claude", "auto", "gateway", undefined)).toBe("direct");
    expect(resolveResumedGatewayMode("claude", "auto", "gateway")).toBe("direct");
    expect(resolveResumedGatewayMode("claude", "auto", undefined, undefined)).toBe("direct");
  });

  it("explicit --no-gw wins over a proven gateway pin", () => {
    expect(resolveResumedGatewayMode("claude", "direct", "gateway", "explicit")).toBe("direct");
  });

  it("keeps a proven explicit gateway choice", () => {
    expect(resolveResumedGatewayMode("claude", "gateway", "direct", "explicit")).toBe("gateway");
    expect(resolveResumedGatewayMode("claude", "auto", "gateway", "explicit")).toBe("gateway");
  });

  it("non-gateway profiles stay direct whatever the pin", () => {
    expect(resolveResumedGatewayMode("codex", "gateway", "gateway", "explicit")).toBe("direct");
    expect(resolveResumedGatewayMode("agy", "auto", "gateway", "explicit")).toBe("direct");
  });
});

describe("startJob (immediate and deferred jobs stay direct)", () => {
  it("never acquires the gateway even when legacy enabled=true and accounts exist", async () => {
    seedLegacyEnabled();
    process.env.ANTHROPIC_BASE_URL = "http://localhost:3002";
    process.env.ANTHROPIC_AUTH_TOKEN = "stale-parent-token";
    acquireLlmMeshSessionEnv.mockResolvedValue({
      ANTHROPIC_BASE_URL: "http://localhost:3002",
      ANTHROPIC_AUTH_TOKEN: "acquired-token",
    });
    let childBaseUrl: string | undefined = "unset-sentinel";
    let childAuthToken: string | undefined = "unset-sentinel";
    startHeadlessSession.mockImplementation(() => {
      childBaseUrl = process.env.ANTHROPIC_BASE_URL;
      childAuthToken = process.env.ANTHROPIC_AUTH_TOKEN;
      return { name: "h2a-job1", slug: "job1" };
    });

    const result = await startJob({
      id: "job1",
      tool: "claude",
      kind: "local-tmux",
      cwd: JOB_CWD,
      source: "run",
      sessionClass: "background",
      headless: true,
      label: "job1",
      task: "do the thing",
      originCwd: JOB_CWD,
      role: "job",
      jobState: "pending",
      enrolledAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    });

    expect(result.started).toBe(true);
    expect(acquireLlmMeshSessionEnv).not.toHaveBeenCalled();
    expect(startGateway).not.toHaveBeenCalled();
    expect(childBaseUrl).toBeUndefined();
    expect(childAuthToken).toBeUndefined();
  });
});

describe("llm-mesh lifecycle (service operations are not routing consent)", () => {
  it("start does not persist enabled=true", async () => {
    const code = await main(["node", "h2a", "llm-mesh", "start"]);
    expect(code).toBe(0);
    expect(startGateway).toHaveBeenCalled();
    expect(llmMeshEnabled()).not.toBe(true);
  });

  it("start on an already-running gateway does not persist enabled=true", async () => {
    readGatewayPid.mockReturnValue(4242);
    const code = await main(["node", "h2a", "llm-mesh", "start"]);
    expect(code).toBe(0);
    expect(llmMeshEnabled()).not.toBe(true);
  });

  it("restart does not persist enabled=true", async () => {
    const code = await main(["node", "h2a", "llm-mesh", "restart"]);
    expect(code).toBe(0);
    expect(llmMeshEnabled()).not.toBe(true);
  });

  it("stop clears a leftover enabled=true", async () => {
    seedLegacyEnabled();
    const code = await main(["node", "h2a", "llm-mesh", "stop"]);
    expect(code).toBe(0);
    expect(llmMeshEnabled()).toBe(false);
  });

  it("stop then restore never reactivates the gateway", async () => {
    seedLegacyEnabled();
    await main(["node", "h2a", "llm-mesh", "stop"]);
    acquireLlmMeshSessionEnv.mockResolvedValue({
      ANTHROPIC_BASE_URL: "http://localhost:3002",
      ANTHROPIC_AUTH_TOKEN: "live-token",
    });
    const code = await main(["node", "h2a", "restore", "--dry-run"]);
    expect(code).toBe(0);
    expect(acquireLlmMeshSessionEnv).not.toHaveBeenCalled();
    expect(startGateway).not.toHaveBeenCalled();
    expect(stderrText()).not.toMatch(/gateway would be started|restore context active/i);
  });
});

describe("restore CLI route (legacy enabled=true is not consent)", () => {
  it("restore and dry-run never bootstrap the gateway without --gw", async () => {
    seedLegacyEnabled();
    acquireLlmMeshSessionEnv.mockResolvedValue({
      ANTHROPIC_BASE_URL: "http://localhost:3002",
      ANTHROPIC_AUTH_TOKEN: "live-token",
    });
    for (const argv of [
      ["node", "h2a", "restore"],
      ["node", "h2a", "restore", "--dry-run"],
    ]) {
      acquireLlmMeshSessionEnv.mockClear();
      startGateway.mockClear();
      stderrWrite.mockClear();
      const code = await main(argv);
      expect(code).toBe(0);
      expect(acquireLlmMeshSessionEnv).not.toHaveBeenCalled();
      expect(startGateway).not.toHaveBeenCalled();
      expect(stderrText()).not.toMatch(/gateway would be started|restore context active/i);
    }
  });

  it("restore --gw still prewarms the gateway (positive)", async () => {
    acquireLlmMeshSessionEnv.mockResolvedValue({
      ANTHROPIC_BASE_URL: "http://localhost:3002",
      ANTHROPIC_AUTH_TOKEN: "live-token",
    });
    const code = await main(["node", "h2a", "restore", "--gw"]);
    expect(code).toBe(0);
    expect(acquireLlmMeshSessionEnv).toHaveBeenCalled();
  });
});

describe("run --resume (legacy pin without provenance stays direct)", () => {
  const CONV = "123e4567-e89b-12d3-a456-426614174000";
  const NOW = new Date().toISOString();

  function seedRegistry(entries: unknown[]): void {
    const dir = join(CONFIG_HOME, ".config", "sentropic", "remote-cli");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "registry.json"), JSON.stringify({ version: 1, entries }), "utf8");
  }

  function legacyGatewayPin(): Record<string, unknown> {
    return {
      id: "proj",
      tool: "claude",
      kind: "local-tmux",
      cwd: RUN_CWD,
      source: "run",
      sessionClass: "human",
      label: "proj",
      convId: CONV,
      tmuxSession: "h2a-proj",
      gatewayMode: "gateway",
      enrolledAt: NOW,
      lastSeenAt: NOW,
    };
  }

  function runResume(extra: string[] = []): Promise<number> {
    return main([
      "node", "h2a", "run", "claude", RUN_CWD,
      "--resume", CONV, "--no-attach", "--name", "proj", ...extra,
    ]);
  }

  it("legacy gateway pin does not auto-start the gateway", async () => {
    seedRegistry([legacyGatewayPin()]);
    acquireLlmMeshSessionEnv.mockResolvedValue({
      ANTHROPIC_BASE_URL: "http://localhost:3002",
      ANTHROPIC_AUTH_TOKEN: "live-token",
    });

    const code = await runResume();

    expect(acquireLlmMeshSessionEnv).not.toHaveBeenCalled();
    expect(startGateway).not.toHaveBeenCalled();
    expect(startLocalSession).toHaveBeenCalled();
    expect(code).toBe(0);
  });

  it("--no-gw wins over a proven gateway pin", async () => {
    seedRegistry([{ ...legacyGatewayPin(), gatewayProvenance: "explicit" }]);
    acquireLlmMeshSessionEnv.mockResolvedValue({
      ANTHROPIC_BASE_URL: "http://localhost:3002",
      ANTHROPIC_AUTH_TOKEN: "live-token",
    });

    const code = await runResume(["--no-gw"]);

    expect(acquireLlmMeshSessionEnv).not.toHaveBeenCalled();
    expect(startGateway).not.toHaveBeenCalled();
    expect(startLocalSession).toHaveBeenCalled();
    expect(code).toBe(0);
  });

  it("proven explicit gateway choice is kept (positive)", async () => {
    seedRegistry([{ ...legacyGatewayPin(), gatewayProvenance: "explicit" }]);
    acquireLlmMeshSessionEnv.mockResolvedValue({
      ANTHROPIC_BASE_URL: "http://localhost:3002",
      ANTHROPIC_AUTH_TOKEN: "live-token",
    });

    const code = await runResume();

    expect(acquireLlmMeshSessionEnv).toHaveBeenCalled();
    expect(startLocalSession).toHaveBeenCalled();
    expect(code).toBe(0);
  });

  it.each([
    { mode: "gateway", bare: false }, { mode: "gateway", bare: true }, { mode: "gateway", bare: undefined },
    { mode: "direct", bare: false }, { mode: "direct", bare: undefined },
  ] as const)("keeps proven $mode consent with bare=$bare across two resumes under a new name", async ({ mode, bare }) => {
    seedRegistry([{ ...legacyGatewayPin(), gatewayMode: mode, gatewayProvenance: "explicit", bare }]);
    startLocalSession.mockImplementation((...args: unknown[]) => ({ name: `h2a-${args[4]}`, slug: args[4] }));
    acquireLlmMeshSessionEnv.mockResolvedValue({
      ANTHROPIC_BASE_URL: "http://localhost:3002",
      ANTHROPIC_AUTH_TOKEN: "live-token",
    });
    for (let pass = 0; pass < 2; pass++) {
      acquireLlmMeshSessionEnv.mockClear();
      expect(await runResume(["--name", "renamed"])).toBe(0);
      expect(acquireLlmMeshSessionEnv.mock.calls.length > 0).toBe(mode === "gateway");
      const saved = loadRegistry();
      if (saved.state !== "ok") throw new Error("registry unreadable after renamed resume");
      expect(saved.entries.find(e => e.id === "renamed")).toMatchObject({
        convId: CONV, cwd: RUN_CWD, tool: "claude", gatewayMode: mode, gatewayProvenance: "explicit",
      });
    }
  });

  it("explicit --gw on a fresh conversation injects the gateway (positive)", async () => {
    seedRegistry([]);
    acquireLlmMeshSessionEnv.mockResolvedValue({
      ANTHROPIC_BASE_URL: "http://localhost:3002",
      ANTHROPIC_AUTH_TOKEN: "live-token",
    });

    const code = await runResume(["--gw"]);

    expect(acquireLlmMeshSessionEnv).toHaveBeenCalled();
    expect(startLocalSession).toHaveBeenCalled();
    expect(code).toBe(0);
  });

  it("keeps a new explicit opt-in on the next resume beside a legacy row (round-4 P2)", async () => {
    seedRegistry([{ ...legacyGatewayPin(), bare: false }]);
    acquireLlmMeshSessionEnv.mockResolvedValue({
      ANTHROPIC_BASE_URL: "http://localhost:3002", ANTHROPIC_AUTH_TOKEN: "fixture-fresh",
    });
    startLocalSession.mockImplementation((...args: unknown[]) => ({ name: `h2a-${args[4]}`, slug: args[4] }));
    expect(await runResume(["--name", "chosen", "--gw"])).toBe(0);
    const saved = loadRegistry();
    if (saved.state !== "ok") throw new Error("registry unreadable");
    expect(saved.entries.find(e => e.id === "chosen")).toMatchObject({ gatewayMode: "gateway", gatewayProvenance: "explicit" });
    acquireLlmMeshSessionEnv.mockClear();
    expect(await runResume(["--name", "chosen"])).toBe(0);
    expect(acquireLlmMeshSessionEnv).toHaveBeenCalled();
  });

  it.each([
    { reverse: false, noGw: false }, { reverse: true, noGw: false },
    { reverse: false, noGw: true }, { reverse: true, noGw: true },
  ])("proven consent beside legacy rows ignores order=$reverse, no-gw=$noGw (round-4 P2)", async ({ reverse, noGw }) => {
    const rows = [
      { ...legacyGatewayPin(), bare: false },
      { ...legacyGatewayPin(), id: "chosen", tmuxSession: "h2a-chosen", bare: false, gatewayProvenance: "explicit" },
    ];
    seedRegistry(reverse ? rows.reverse() : rows);
    acquireLlmMeshSessionEnv.mockResolvedValue({
      ANTHROPIC_BASE_URL: "http://localhost:3002", ANTHROPIC_AUTH_TOKEN: "fixture-fresh",
    });
    expect(await runResume(["--name", "chosen", ...(noGw ? ["--no-gw"] : [])])).toBe(0);
    expect(acquireLlmMeshSessionEnv.mock.calls.length > 0).toBe(!noGw);
  });

  it("explicit --gw fails before the child starts when unavailable (positive)", async () => {
    seedRegistry([]);
    acquireLlmMeshSessionEnv.mockResolvedValue(null);
    startGateway.mockRejectedValue(new Error("gateway boot failed"));

    const code = await runResume(["--gw"]);

    expect(code).toBe(1);
    expect(startLocalSession).not.toHaveBeenCalled();
  });
});

describe("consent is bound to the restored conversation identity (round-2 P1)", () => {
  const OLD_CONV = "123e4567-e89b-12d3-a456-426614174000";
  const NEW_CONV = "123e4567-e89b-12d3-a456-426614174999";
  const NOW = new Date().toISOString();

  function seedExplicitPinForOldConv(): void {
    seedRegistryEntries([
      {
        id: "proj",
        tool: "claude",
        kind: "local-tmux",
        cwd: RUN_CWD,
        source: "run",
        sessionClass: "human",
        label: "proj",
        convId: OLD_CONV,
        tmuxSession: "h2a-proj",
        gatewayMode: "gateway",
        gatewayProvenance: "explicit",
        enrolledAt: NOW,
        lastSeenAt: NOW,
      },
    ]);
  }

  function runResumeNew(): Promise<number> {
    return main([
      "node", "h2a", "run", "claude", RUN_CWD,
      "--resume", NEW_CONV, "--no-attach", "--name", "proj",
    ]);
  }

  it("an auto launch for another conversation does not inherit the old gateway pin", async () => {
    seedExplicitPinForOldConv();
    acquireLlmMeshSessionEnv.mockResolvedValue({
      ANTHROPIC_BASE_URL: "http://localhost:3002",
      ANTHROPIC_AUTH_TOKEN: "live-token",
    });

    expect(await runResumeNew()).toBe(0);
    expect(acquireLlmMeshSessionEnv).not.toHaveBeenCalled();

    const saved = loadRegistry();
    if (saved.state !== "ok") throw new Error("registry unreadable after resume");
    const row = saved.entries.find((e) => e.id === "proj");
    expect(row?.convId).toBe(NEW_CONV);
    expect(row?.gatewayMode).toBeUndefined();
  });

  it("repeating that direct resume stays direct (no acquire on the second pass)", async () => {
    seedExplicitPinForOldConv();
    acquireLlmMeshSessionEnv.mockResolvedValue({
      ANTHROPIC_BASE_URL: "http://localhost:3002",
      ANTHROPIC_AUTH_TOKEN: "live-token",
    });

    expect(await runResumeNew()).toBe(0);
    expect(await runResumeNew()).toBe(0);
    expect(acquireLlmMeshSessionEnv).not.toHaveBeenCalled();
    expect(startGateway).not.toHaveBeenCalled();
  });

  it("a fresh auto launch reusing a name clears the old conversation and consent", async () => {
    seedExplicitPinForOldConv();
    expect(await main([
      "node", "h2a", "run", "claude", RUN_CWD, "--name", "proj", "--no-attach",
    ])).toBe(0);
    expect(acquireLlmMeshSessionEnv).not.toHaveBeenCalled();
    const saved = loadRegistry();
    if (saved.state !== "ok") throw new Error("registry unreadable after launch");
    const row = saved.entries.find(e => e.id === "proj");
    expect(row?.gatewayMode).toBeUndefined();
    expect(row?.gatewayProvenance).toBeUndefined();
    expect(row?.convId).toBeUndefined();
  });
});

describe("relaunch --apply retype resolves consent and scrubs direct (round-2 P1)", () => {
  const CONV = "123e4567-e89b-12d3-a456-426614174000";
  const NOW = new Date().toISOString();

  function seedRow(gatewayProvenance?: "explicit"): void {
    seedRegistryEntries([
      {
        id: "proj",
        tool: "claude",
        kind: "local-tmux",
        cwd: RUN_CWD,
        source: "run",
        sessionClass: "human",
        label: "proj",
        convId: CONV,
        tmuxSession: "h2a-proj",
        gatewayMode: "gateway",
        ...(gatewayProvenance ? { gatewayProvenance } : {}),
        enrolledAt: NOW,
        lastSeenAt: NOW,
      },
    ]);
    listLocalSessionsWithDiagnostics.mockReturnValue({
      sessions: [{ name: "h2a-proj", slug: "proj", profile: "claude" }],
      known: true,
    } as never);
  }

  it("a legacy pin without provenance retypes with routing vars scrubbed", async () => {
    seedRow();
    acquireLlmMeshSessionEnv.mockResolvedValue({
      ANTHROPIC_BASE_URL: "http://localhost:3002",
      ANTHROPIC_AUTH_TOKEN: "live-token",
    });

    const code = await main(["node", "h2a", "relaunch", "--apply"]);

    expect(code).toBe(0);
    expect(acquireLlmMeshSessionEnv).not.toHaveBeenCalled();
    expect(relaunchInSession).toHaveBeenCalledTimes(1);
    expect(relaunchInSession.mock.calls[0]?.[1]).toBe(
      `env -u ANTHROPIC_BASE_URL -u ANTHROPIC_AUTH_TOKEN claude --resume ${CONV}`,
    );
    // Execute the command retyped into the existing polluted shell, with a
    // stand-in provider. Assert the environment the real child receives.
    const { spawnSync } = await vi.importActual<typeof import("node:child_process")>("node:child_process");
    const bin = join(SCRATCH, "fake-bin");
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, "claude"), "#!/bin/bash\nexec printenv\n", { mode: 0o700 });
    const cmd = String(relaunchInSession.mock.calls[0]?.[1]);
    const child = spawnSync("/bin/bash", ["-c", cmd], {
      encoding: "utf8",
      env: { PATH: `${bin}:/usr/bin:/bin`, ANTHROPIC_BASE_URL: "http://localhost:3002", ANTHROPIC_AUTH_TOKEN: "stale-token", ANTHROPIC_API_KEY: "native-key-fixture" },
    });
    expect(child.status).toBe(0);
    expect(child.stdout).not.toMatch(/^ANTHROPIC_BASE_URL=/m);
    expect(child.stdout).not.toMatch(/^ANTHROPIC_AUTH_TOKEN=/m);
    expect(child.stdout).toMatch(/^ANTHROPIC_API_KEY=native-key-fixture$/m);
  });

  it.each([false, true])("a proven gateway retype passes the newly started route into a polluted shell=%s", async (polluted) => {
    seedRow("explicit");
    acquireLlmMeshSessionEnv.mockResolvedValue(null);
    // Include shell metacharacters: the token must arrive verbatim, never execute.
    const token = "fresh-fixture-'$HOME-$(exit 72)-`exit 73`";
    startGateway.mockResolvedValue({ pid: 4242, port: 3003, gatewayToken: token });
    process.env.ANTHROPIC_API_KEY = "parent-native-key";

    const code = await main(["node", "h2a", "relaunch", "--apply"]);

    expect(code).toBe(0);
    expect(startGateway).toHaveBeenCalled();
    expect(relaunchInSession).toHaveBeenCalledTimes(1);
    const { spawnSync } = await vi.importActual<typeof import("node:child_process")>("node:child_process");
    const bin = join(SCRATCH, "fake-gateway-bin");
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, "claude"), "#!/bin/bash\nexec printenv\n", { mode: 0o700 });
    const child = spawnSync("/bin/bash", ["-c", String(relaunchInSession.mock.calls[0]?.[1])], {
      encoding: "utf8",
      env: {
        PATH: `${bin}:/usr/bin:/bin`, ANTHROPIC_API_KEY: "shell-native-key",
        ...(polluted ? { ANTHROPIC_BASE_URL: "http://old-fixture.invalid:3002", ANTHROPIC_AUTH_TOKEN: "expired-fixture-token" } : {}),
      },
    });
    expect(child.status).toBe(0);
    expect(child.stdout).toContain("ANTHROPIC_BASE_URL=http://localhost:3003\n");
    expect(child.stdout).toContain(`ANTHROPIC_AUTH_TOKEN=${token}\n`);
    expect(child.stdout).not.toMatch(/^ANTHROPIC_API_KEY=/m);
    expect(process.env.ANTHROPIC_API_KEY).toBe("parent-native-key");
    expect(process.env.ANTHROPIC_BASE_URL).toBeUndefined();
  });

  it("an unavailable proven gateway never retypes into the idle shell", async () => {
    seedRow("explicit");
    startGateway.mockRejectedValue(new Error("fixture unavailable"));
    expect(await main(["node", "h2a", "relaunch", "--apply"])).toBe(1);
    expect(relaunchInSession).not.toHaveBeenCalled();
  });

  it("keeps the bearer out of the retyped line, terminal and Bash history (round-4 P2)", async () => {
    seedRow("explicit");
    const token = "gw-fictional-history-secret-42";
    acquireLlmMeshSessionEnv.mockResolvedValue({ ANTHROPIC_BASE_URL: "http://gateway.invalid", ANTHROPIC_AUTH_TOKEN: token });
    const { spawnSync } = await vi.importActual<typeof import("node:child_process")>("node:child_process");
    const home = mkdtempSync(join(SCRATCH, "history-"));
    const hist = join(home, "history"), output = join(home, "child-env"), bin = join(home, "bin");
    mkdirSync(bin);
    writeFileSync(join(bin, "claude"), `#!${process.execPath}\nconst fs = require("node:fs");\nif (JSON.parse(process.env.H2A_TEST_HANDOFF_PATHS).some(path => fs.existsSync(path))) process.exit(78);\nfs.writeFileSync(process.env.H2A_TEST_ENV_OUTPUT, Object.entries(process.env).map(([key, value]) => key + "=" + value).join("\\n") + "\\n");\n`, { mode: 0o700 });
    const before = new Set(readdirSync(tmpdir()));
    let terminal = "", history = "", childEnv = "", cmd = "";
    let privatePaths: string[] = [];
    let permissions: number[] = [];
    relaunchInSession.mockImplementation((_name: string, command: string) => {
      cmd = command;
      privatePaths = readdirSync(tmpdir()).filter(name => !before.has(name)).map(name => join(tmpdir(), name));
      permissions = privatePaths.flatMap(path => [statSync(path).mode & 0o777, ...readdirSync(path).map(name => statSync(join(path, name)).mode & 0o777)]);
      const child = spawnSync("/usr/bin/script", ["-qefc", "/bin/bash --noprofile --norc -i", join(home, "terminal")], {
        encoding: "utf8", input: cmd + "\nexit\n", timeout: 5000,
        env: {
          PATH: `${bin}:/usr/bin:/bin`, HOME: home, TMPDIR: tmpdir(), TERM: "dumb",
          HISTFILE: hist, HISTSIZE: "100", HISTFILESIZE: "100", HISTCONTROL: "ignoreboth",
          H2A_TEST_ENV_OUTPUT: output, ANTHROPIC_API_KEY: "native-shell-fixture",
          H2A_TEST_HANDOFF_PATHS: JSON.stringify(privatePaths),
          ANTHROPIC_BASE_URL: "http://stale.invalid", ANTHROPIC_AUTH_TOKEN: "expired-fixture",
        },
      });
      expect(child.status).toBe(0);
      terminal = child.stdout + child.stderr;
      history = readFileSync(hist, "utf8");
      childEnv = readFileSync(output, "utf8");
      return true;
    });
    expect(await main(["node", "h2a", "relaunch", "--apply"])).toBe(0);
    expect(childEnv).toContain(`ANTHROPIC_AUTH_TOKEN=${token}\n`);
    expect(childEnv).toContain("ANTHROPIC_BASE_URL=http://gateway.invalid\n");
    expect(childEnv).not.toMatch(/^ANTHROPIC_API_KEY=/m);
    expect({ line: cmd.includes(token), terminal: terminal.includes(token), history: history.includes(token), log: stderrText().includes(token) })
      .toEqual({ line: false, terminal: false, history: false, log: false });
    expect(privatePaths.length).toBeGreaterThan(0);
    expect(permissions).toEqual([0o700, 0o600]);
    expect(privatePaths.every(path => !existsSync(path))).toBe(true);
  });

  it("removes the private handoff when the pane refuses the retype (round-4 P2)", async () => {
    seedRow("explicit");
    acquireLlmMeshSessionEnv.mockResolvedValue({ ANTHROPIC_BASE_URL: "http://gateway.invalid", ANTHROPIC_AUTH_TOKEN: "gw-fictional-refused" });
    const before = new Set(readdirSync(tmpdir()));
    let privatePaths: string[] = [];
    relaunchInSession.mockImplementation(() => {
      privatePaths = readdirSync(tmpdir()).filter(name => !before.has(name)).map(name => join(tmpdir(), name));
      return false;
    });
    expect(await main(["node", "h2a", "relaunch", "--apply"])).toBe(1);
    expect(privatePaths.length).toBeGreaterThan(0);
    expect(privatePaths.every(path => !existsSync(path))).toBe(true);
  });
});

describe("local in-process CLI applies the gateway choice at the PTY boundary (round-3 P1)", () => {
  it.each([{ flags: [] }, { flags: ["--no-gw"] }, { flags: ["--no-llm-gateway"] }])("direct $flags strips inherited routing and preserves native auth", async ({ flags }) => {
    seedLegacyEnabled();
    process.env.ANTHROPIC_BASE_URL = "http://localhost:3002";
    process.env.ANTHROPIC_AUTH_TOKEN = "stale-parent-token";
    process.env.ANTHROPIC_API_KEY = "native-fixture";
    expect(await main(["node", "h2a", "claude", "--local", ...flags])).toBe(1);
    expect(stderrText()).toContain("fixture PTY boundary");
    expect(localPtySpawner).toHaveBeenCalledTimes(1);
    const env = localPtySpawner.mock.calls[0]![0].env;
    expect(env.ANTHROPIC_BASE_URL).toBeUndefined();
    expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
    expect(env.ANTHROPIC_API_KEY).toBe("native-fixture");
    expect(acquireLlmMeshSessionEnv).not.toHaveBeenCalled();
    expect(startGateway).not.toHaveBeenCalled();
  });

  it.each(["--gw", "--llm-gateway"])("%s passes the freshly acquired route to the local PTY", async (flag) => {
    acquireLlmMeshSessionEnv.mockResolvedValue({ ANTHROPIC_BASE_URL: "http://localhost:3003", ANTHROPIC_AUTH_TOKEN: "fresh-token" });
    process.env.ANTHROPIC_API_KEY = "native-fixture";
    expect(await main(["node", "h2a", "claude", "--local", flag])).toBe(1);
    expect(stderrText()).toContain("fixture PTY boundary");
    const env = localPtySpawner.mock.calls[0]![0].env;
    expect(env.ANTHROPIC_BASE_URL).toBe("http://localhost:3003");
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe("fresh-token");
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(process.env.ANTHROPIC_API_KEY).toBe("native-fixture");
  });

  it.each(["--gw", "--llm-gateway"])("unavailable %s fails before any local PTY is spawned", async (flag) => {
    startGateway.mockRejectedValue(new Error("fixture unavailable"));
    expect(await main(["node", "h2a", "claude", "--local", flag])).toBe(1);
    expect(localPtySpawner.mock.calls.length).toBe(0);
    expect(stderrText()).toMatch(/gateway is required but unavailable/);
  });
});

describe("explicit-profile resume only copies consent for the same conversation identity (round-3 P1)", () => {
  const CONV = "123e4567-e89b-12d3-a456-426614174000";
  const NOW = new Date().toISOString();

  it.each([
    { case: "same workspace", cwd: RUN_CWD, tool: "claude", flags: [], gateway: true },
    { case: "other workspace", cwd: JOB_CWD, tool: "claude", flags: [], gateway: false },
    { case: "other profile", cwd: RUN_CWD, tool: "codex", flags: [], gateway: false },
    { case: "same workspace with no-gw", cwd: RUN_CWD, tool: "claude", flags: ["--no-gw"], gateway: false },
    { case: "other workspace with no-gw", cwd: JOB_CWD, tool: "claude", flags: ["--no-gw"], gateway: false },
  ])("resume in $case selects gateway=$gateway", async ({ cwd, tool, flags, gateway }) => {
    seedRegistryEntries([{
      id: "proj", tool, kind: "local-tmux", cwd, source: "run", sessionClass: "human",
      convId: CONV, tmuxSession: "h2a-proj", gatewayMode: "gateway", gatewayProvenance: "explicit",
      bare: false, enrolledAt: NOW, lastSeenAt: NOW,
    }]);
    acquireLlmMeshSessionEnv.mockResolvedValue({ ANTHROPIC_BASE_URL: "http://localhost:3002", ANTHROPIC_AUTH_TOKEN: "fresh-token" });
    const originalCwd = process.cwd();
    try {
      process.chdir(RUN_CWD);
      expect(await main(["node", "h2a", "resume", "proj", "--claude", CONV, ...flags])).toBe(0);
    } finally {
      process.chdir(originalCwd);
    }
    expect(startLocalSession).toHaveBeenCalledTimes(1);
    expect(startLocalSession.mock.calls[0]?.[2]).toBe(RUN_CWD);
    expect(acquireLlmMeshSessionEnv.mock.calls.length > 0).toBe(gateway);
    if (!gateway) expect(startGateway).not.toHaveBeenCalled();
  });
});

describe("mixed relaunch fleet keeps native auth per session (round-2 P2)", () => {
  const CONV_A = "123e4567-e89b-12d3-a456-426614174001";
  const CONV_B = "123e4567-e89b-12d3-a456-426614174002";
  const NOW = new Date().toISOString();

  it("a gateway session followed by a direct one does not lose ANTHROPIC_API_KEY", async () => {
    seedRegistryEntries([
      {
        id: "gwA",
        tool: "claude",
        kind: "local-tmux",
        cwd: RUN_CWD,
        source: "run",
        sessionClass: "human",
        label: "gwA",
        convId: CONV_A,
        tmuxSession: "h2a-gwA",
        gatewayMode: "gateway",
        gatewayProvenance: "explicit",
        enrolledAt: NOW,
        lastSeenAt: NOW,
      },
      {
        id: "drB",
        tool: "claude",
        kind: "local-tmux",
        cwd: RUN_CWD,
        source: "run",
        sessionClass: "human",
        label: "drB",
        convId: CONV_B,
        tmuxSession: "h2a-drB",
        gatewayMode: "gateway",
        enrolledAt: NOW,
        lastSeenAt: NOW,
      },
    ]);
    listLocalSessionsWithDiagnostics.mockReturnValue({
      sessions: [
        { name: "h2a-gwA", slug: "gwA", profile: "claude" },
        { name: "h2a-drB", slug: "drB", profile: "claude" },
      ],
      known: true,
    } as never);
    acquireLlmMeshSessionEnv.mockResolvedValue({
      ANTHROPIC_BASE_URL: "http://localhost:3002",
      ANTHROPIC_AUTH_TOKEN: "live-token",
    });
    process.env.ANTHROPIC_API_KEY = "native-key-fixture";
    const seenBySlug = new Map<string, Record<string, string | undefined>>();
    startLocalSession.mockImplementation((...args: unknown[]) => {
      const slug = String((args[4] as string | undefined) ?? "unknown");
      seenBySlug.set(slug, {
        ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL,
        ANTHROPIC_AUTH_TOKEN: process.env.ANTHROPIC_AUTH_TOKEN,
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
      });
      return { name: `h2a-${slug}`, slug };
    });

    const code = await main([
      "node", "h2a", "relaunch", "--all", "--apply", "--yes", "--include-agents",
    ]);

    expect(code).toBe(0);
    expect(seenBySlug.get("gwA")?.ANTHROPIC_BASE_URL).toBe("http://localhost:3002");
    expect(seenBySlug.get("drB")?.ANTHROPIC_BASE_URL).toBeUndefined();
    expect(seenBySlug.get("drB")?.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
    expect(seenBySlug.get("drB")?.ANTHROPIC_API_KEY).toBe("native-key-fixture");
    expect(process.env.ANTHROPIC_API_KEY).toBe("native-key-fixture");
    expect(process.env.ANTHROPIC_BASE_URL).toBeUndefined();
    expect(process.env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
  });
});

describe("remote run transmits the explicit gateway choice only (round-2 P2)", () => {
  const REMOTE = "http://127.0.0.1:18080";

  it("remote run with --gw transmits the explicit choice", async () => {
    const code = await main([
      "node", "h2a", "claude", "--remote", REMOTE, "--gw", "--no-auth",
    ]);

    expect(code).toBe(0);
    expect(createRemoteSession).toHaveBeenCalledTimes(1);
    expect(createRemoteSession.mock.calls[0]?.[0]).toBe(REMOTE);
    const body = createRemoteSession.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(body.profile).toBe("claude");
    expect(body.llmGateway).toBe(true);
  });

  it("remote run without --gw transmits no gateway choice", async () => {
    const code = await main([
      "node", "h2a", "claude", "--remote", REMOTE, "--no-auth",
    ]);

    expect(code).toBe(0);
    expect(createRemoteSession).toHaveBeenCalledTimes(1);
    const body = createRemoteSession.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(body.profile).toBe("claude");
    expect("llmGateway" in body).toBe(false);
  });
});
