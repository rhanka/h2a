/**
 * The launch itself: `startJob` must TAKE the slot lease, not merely be able to.
 *
 * Without this, "a lease is taken at launch" is a claim about code someone read.
 * tmux and the gateway are mocked so nothing is spawned and no live service is
 * touched; everything else — the registry write, the lease write, the pane CPU
 * baseline — is the real path.
 */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const startLocalSession = vi.hoisted(() => vi.fn());
const startHeadlessSession = vi.hoisted(() => vi.fn());
const paneTreeCpuMs = vi.hoisted(() => vi.fn());

vi.mock("./tmux.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./tmux.js")>();
  return {
    ...actual,
    tmuxAvailable: () => true,
    startLocalSession,
    startHeadlessSession,
    startH2aWindow: () => true,
    localSessionPanePid: () => 4242,
    paneTreeCpuMs,
  };
});

// No gateway session is acquired for a test launch (and no live gateway is called).
vi.mock("./llm-mesh.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./llm-mesh.js")>();
  return {
    ...actual,
    meshRunning: () => false,
    acquireLlmMeshSessionEnv: async () => null,
  };
});

const { startJob } = await import("./index.js");
const { listJobs } = await import("./registry.js");
const { SessionLeaseStore, resolveSessionLeasePath } = await import("./session-lease.js");

const SCRATCH_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  ".test-scratch",
  "session-lease-launch",
);

let scratch: string;
let previousHome: string | undefined;

beforeEach(() => {
  mkdirSync(SCRATCH_ROOT, { recursive: true });
  scratch = mkdtempSync(join(SCRATCH_ROOT, "s-"));
  previousHome = process.env.REMOTE_CLI_CONFIG_HOME;
  process.env.REMOTE_CLI_CONFIG_HOME = scratch;
  startLocalSession.mockReturnValue({
    name: "h2a-job-x",
    slug: "job-x",
    agentPane: "%99",
  });
  startHeadlessSession.mockReturnValue({
    name: "h2a-job-x",
    slug: "job-x",
    agentPane: "%99",
  });
  paneTreeCpuMs.mockReturnValue(12_345);
});

afterEach(() => {
  vi.clearAllMocks();
  if (previousHome === undefined) delete process.env.REMOTE_CLI_CONFIG_HOME;
  else process.env.REMOTE_CLI_CONFIG_HOME = previousHome;
  rmSync(scratch, { recursive: true, force: true });
});

describe("startJob and the slot lease", () => {
  it("takes the lease as part of the launch, seeded with the pane's CPU baseline", async () => {
    const result = await startJob({
      id: "job-x",
      tool: "codex",
      kind: "local-tmux",
      cwd: scratch,
      enrolledAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
      source: "run",
      role: "job",
      jobState: "running",
      task: "do the thing",
      headless: true,
      originCwd: scratch,
      explicitCwd: scratch, // used as-is: no git worktree is created for the test
    });

    expect(result.started).toBe(true);
    expect(listJobs().map((j) => j.id)).toContain("job-x");

    const lease = new SessionLeaseStore(resolveSessionLeasePath(), {
      now: () => new Date().toISOString(),
    }).forSession("job-x");
    expect(lease).toBeDefined();
    expect(lease!.holder).toBe("h2a:startJob");
    expect(lease!.workspace).toBe(scratch);
    // The baseline is the pane's process TREE, read at launch — the first
    // supervising pass needs it to compute a rate rather than guess.
    expect(lease!.sample?.cpuMs).toBe(12_345);
  });

  it("records the delegating instance as the holder when the launch has one", async () => {
    await startJob({
      id: "job-y",
      tool: "codex",
      kind: "local-tmux",
      cwd: scratch,
      enrolledAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
      source: "run",
      role: "job",
      jobState: "running",
      headless: true,
      originCwd: scratch,
      explicitCwd: scratch,
      delegatorInstance: "host:cond",
    });

    const lease = new SessionLeaseStore(resolveSessionLeasePath(), {
      now: () => new Date().toISOString(),
    }).forSession("job-y");
    expect(lease?.holder).toBe("host:cond");
  });
});
