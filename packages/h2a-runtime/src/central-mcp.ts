/**
 * Runtime-side central MCP lifecycle. The core package remains the sole owner
 * of marker validation, reclaim, and server startup; this module only selects
 * a persisted endpoint, asks core for protected liveness facts, and starts the
 * existing foreground command as a detached child when necessary.
 */
import { spawn } from "node:child_process";
import {
  chmodSync,
  closeSync,
  mkdirSync,
  openSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { getH2aConfig, resolveConfigPath } from "./config.js";

const CENTRAL_PORT_BASE = 47_000;
const CENTRAL_PORT_SPAN = 10_000;
const CENTRAL_START_TIMEOUT_MS = 10_000;
const CENTRAL_START_POLL_MS = 100;

type CentralMarker = Readonly<{
  endpoint: string;
  generation: string;
  pid: number;
  startedAt: string;
}>;

type CentralPing =
  | Readonly<{ kind: "generation"; generation: string }>
  | Readonly<{ kind: "dead" }>
  | Readonly<{ kind: "ambiguous" }>;

type CoreCentralMcp = Readonly<{
  H2A_MCP_CENTRAL_ENV: string;
  H2A_MCP_CENTRAL_ENDPOINT_ENV: string;
  centralMcpPing(endpoint: string, timeoutMs?: number): Promise<CentralPing>;
  readCentralMcpMarker(): CentralMarker | undefined;
  runCli(
    argv: readonly string[],
    streams: {
      stdout: Pick<typeof process.stdout, "write">;
      stderr: Pick<typeof process.stderr, "write">;
      cwd?: () => string;
    },
    options?: unknown,
  ): number;
}>;

export type CentralMcpPreparation =
  | Readonly<{ status: "central"; endpoint: string; generation: string }>
  | Readonly<{ status: "degraded"; reason: string }>;

let coreCentralMcp: Promise<CoreCentralMcp> | undefined;

function loadCoreCentralMcp(): Promise<CoreCentralMcp> {
  // Keep the core/runtime boundary dynamic. Core already reaches runtime via a
  // string-specifier seam for central marker ownership checks, so a static
  // runtime dependency here would turn that boundary into a hard cycle.
  const corePackage: string = "@sentropic/h2a";
  coreCentralMcp ??= import(corePackage).then((core) => {
    const candidate = core as Partial<CoreCentralMcp>;
    if (
      typeof candidate.H2A_MCP_CENTRAL_ENV !== "string" ||
      typeof candidate.H2A_MCP_CENTRAL_ENDPOINT_ENV !== "string" ||
      typeof candidate.centralMcpPing !== "function" ||
      typeof candidate.readCentralMcpMarker !== "function" ||
      typeof candidate.runCli !== "function"
    ) {
      throw new Error("@sentropic/h2a does not expose the central MCP runtime surface");
    }
    return candidate as CoreCentralMcp;
  });
  return coreCentralMcp;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function defaultCentralEndpoint(): string {
  if (typeof process.getuid !== "function") {
    throw new Error("central MCP requires a current uid for deterministic endpoint selection");
  }
  const currentUid = process.getuid();
  const offset = ((currentUid % CENTRAL_PORT_SPAN) + CENTRAL_PORT_SPAN) % CENTRAL_PORT_SPAN;
  return `http://127.0.0.1:${CENTRAL_PORT_BASE + offset}/mcp`;
}

function configuredCentralEndpoint(): string | undefined {
  const h2a = getH2aConfig();
  if (!h2a.central?.enabled) return undefined;
  if (h2a.central.endpoint) return h2a.central.endpoint;
  return defaultCentralEndpoint();
}

function centralLogFile(): string {
  const path = join(dirname(resolveConfigPath()), "mcp-central.log");
  mkdirSync(dirname(path), { recursive: true });
  return path;
}

async function waitForCentralStart(
  core: CoreCentralMcp,
  endpoint: string,
  spawnFailure: () => Error | undefined,
): Promise<{ endpoint: string; generation: string }> {
  const deadline = Date.now() + CENTRAL_START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const failure = spawnFailure();
    if (failure) throw failure;
    const ping = await core.centralMcpPing(endpoint, CENTRAL_START_POLL_MS);
    if (ping.kind === "generation") {
      const marker = core.readCentralMcpMarker();
      if (marker?.endpoint === endpoint && marker.generation === ping.generation) {
        return { endpoint, generation: ping.generation };
      }
    }
    await delay(CENTRAL_START_POLL_MS);
  }
  throw new Error(`central MCP did not become ready at ${endpoint} within ${CENTRAL_START_TIMEOUT_MS}ms`);
}

/**
 * Ensure the persisted central endpoint is served. A live matching marker is
 * reused; dead registrations are reclaimed by the existing foreground serve
 * command, never by this runtime wrapper.
 */
export async function ensureCentralMcp(
  options: Readonly<{ root?: string }> = {},
): Promise<Readonly<{ endpoint: string; generation: string }> | undefined> {
  const endpoint = configuredCentralEndpoint();
  if (!endpoint) return undefined;
  const core = await loadCoreCentralMcp();
  const marker = core.readCentralMcpMarker();
  if (marker) {
    const ping = await core.centralMcpPing(marker.endpoint);
    if (ping.kind === "ambiguous") {
      throw new Error(`central MCP liveness at ${marker.endpoint} is ambiguous; refusing to start another server`);
    }
    if (ping.kind === "generation") {
      if (marker.endpoint === endpoint && ping.generation === marker.generation) {
        return { endpoint, generation: marker.generation };
      }
      throw new Error(
        `central MCP marker/listener mismatch (${marker.endpoint}, generation ${marker.generation}); refusing to replace a live server`,
      );
    }
  }

  const logFile = centralLogFile();
  const logFd = openSync(logFile, "a", 0o600);
  chmodSync(logFile, 0o600);
  let spawnError: Error | undefined;
  try {
    const child = spawn(
      "h2a",
      ["mcp-central-serve", "--root", options.root ?? process.env.H2A_ROOT ?? join(homedir(), "h2a-workspace", ".h2a")],
      {
        detached: true,
        cwd: homedir(),
        stdio: ["ignore", logFd, logFd],
        env: {
          ...centralSpawnEnvironment(),
          [core.H2A_MCP_CENTRAL_ENV]: "1",
          [core.H2A_MCP_CENTRAL_ENDPOINT_ENV]: endpoint,
        },
      },
    );
    child.once("error", (error) => {
      spawnError = error;
    });
    child.unref();
  } finally {
    closeSync(logFd);
  }
  return waitForCentralStart(core, endpoint, () => spawnError);
}

/** No conversation, terminal, provider credentials, or repo state enter the daemon. */
function centralSpawnEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ["PATH", "HOME", "XDG_RUNTIME_DIR", "XDG_CONFIG_HOME", "XDG_CACHE_HOME", "REMOTE_CLI_CONFIG_HOME", "TMPDIR", "LANG", "LC_ALL"]) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  return env;
}

function activateCentralMcpEnvironment(core: CoreCentralMcp, endpoint: string): void {
  process.env[core.H2A_MCP_CENTRAL_ENV] = "1";
  process.env[core.H2A_MCP_CENTRAL_ENDPOINT_ENV] = endpoint;
}

function deactivateCentralMcpEnvironment(): void {
  delete process.env.H2A_MCP_CENTRAL;
  delete process.env.H2A_MCP_CENTRAL_ENDPOINT;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Prepare transport only. Configuration writes require an explicit host setup --write. */
export async function prepareCentralMcpForLaunch(options: Readonly<{
  root?: string;
  profile: string;
  cwd: string;
}>): Promise<CentralMcpPreparation | undefined> {
  return prepareCentralMcpForRestore(options.root ? { root: options.root } : {});
}

/** Restore and run never write a host or project configuration. */
export async function prepareCentralMcpForRestore(
  options: Readonly<{ root?: string }> = {},
): Promise<CentralMcpPreparation | undefined> {
  try {
    const central = await ensureCentralMcp(options);
    if (!central) return undefined;
    activateCentralMcpEnvironment(await loadCoreCentralMcp(), central.endpoint);
    return { status: "central", ...central };
  } catch (error) {
    deactivateCentralMcpEnvironment();
    return { status: "degraded", reason: errorMessage(error) };
  }
}
