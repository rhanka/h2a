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
  constants,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";

import { getH2aConfig, resolveConfigPath, setH2aConfig } from "./config.js";
import { appendCrashLog, MAX_CRASH_LOG_BYTES } from "./crash-log.js";

const CENTRAL_START_TIMEOUT_MS = 10_000;
const CENTRAL_START_POLL_MS = 100;

type CentralMarker = Readonly<{
  endpoint: string;
  generation: string;
  pid: number;
  startedAt: string;
  root?: string;
  protocol?: number;
  endpointMode?: "fixed" | "discovered";
}>;

type CentralPing =
  | Readonly<{ kind: "generation"; generation: string }>
  | Readonly<{ kind: "dead" }>
  | Readonly<{ kind: "ambiguous" }>;

type CoreCentralMcp = Readonly<{
  ensureCentralForRoot(root: string): Promise<CentralMarker>;
  centralMcpMarkerPath(): string;
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

function configuredCentralEndpoint(): string | undefined {
  return getH2aConfig().central?.endpoint;
}

/** Raw (unstructured) central MCP server output. Read by `h2a logs`, rotated at spawn. */
export function resolveCentralMcpLogPath(): string {
  return join(dirname(resolveConfigPath()), "mcp-central.log");
}

/**
 * Cap a rotated raw log to its last bound bytes, line-aligned, mode
 * preserved. Reads the tail window positionally — the (possibly huge)
 * rotation is never loaded whole.
 */
function boundRawLogTail(path: string): void {
  let fd: number | undefined;
  try {
    const size = statSync(path).size;
    if (size <= MAX_CRASH_LOG_BYTES) return;
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const tail = Buffer.alloc(MAX_CRASH_LOG_BYTES);
    const start = size - MAX_CRASH_LOG_BYTES;
    for (let offset = 0; offset < tail.length; ) {
      const read = readSync(fd, tail, offset, tail.length - offset, start + offset);
      if (read <= 0) break;
      offset += read;
    }
    try {
      closeSync(fd);
    } catch {
      /* fall through to the truncation below */
    }
    fd = undefined;
    const cut = tail.indexOf(0x0a);
    writeFileSync(path, cut < 0 ? tail : tail.subarray(cut + 1));
    chmodSync(path, 0o600);
  } catch {
    /* best-effort: bounding never blocks the spawn below */
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        /* bounding never throws */
      }
    }
  }
}

function centralLogFile(): string {
  const path = resolveCentralMcpLogPath();
  mkdirSync(dirname(path), { recursive: true });
  // Bounded at spawn: rotate the raw server output instead of growing it
  // forever, and cap the rotation so a long-running server cannot leave an
  // unbounded `.1` behind either. Output written between spawns is still
  // unbounded (only the server could pace that); `h2a logs` shows its tail.
  try {
    if (existsSync(path) && statSync(path).size >= MAX_CRASH_LOG_BYTES) {
      try { unlinkSync(`${path}.1`); } catch { /* missing rotation is fine */ }
      renameSync(path, `${path}.1`);
      boundRawLogTail(`${path}.1`);
    }
  } catch { /* rotation is best-effort; the spawn below still proceeds */ }
  return path;
}

async function waitForCentralStart(
  core: CoreCentralMcp,
  endpoint: string | undefined,
  spawnFailure: () => Error | undefined,
): Promise<{ endpoint: string; generation: string }> {
  const deadline = Date.now() + CENTRAL_START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const failure = spawnFailure();
    if (failure) { appendCrashLog("mcp-server", { event: "startupError", reason: "spawn-failed", detail: failure.message }); throw failure; }
    const marker = core.readCentralMcpMarker();
    const candidate = endpoint ?? marker?.endpoint;
    if (candidate && marker) {
      const ping = await core.centralMcpPing(candidate, CENTRAL_START_POLL_MS);
      if (ping.kind === "generation" && marker.endpoint === candidate && marker.generation === ping.generation) {
        return { endpoint: candidate, generation: ping.generation };
      }
    }
    await delay(CENTRAL_START_POLL_MS);
  }
  // No child exited: the launcher gave up waiting, so `exit` (not
  // `childExit`) keeps the record honest.
  appendCrashLog("mcp-server", { event: "exit", reason: "readiness-timeout", detail: endpoint });
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
  if (!getH2aConfig().central?.enabled || process.env.H2A_MCP_CENTRAL === "0" || process.env.H2A_MCP_CENTRAL === "false") return undefined;
  const rawRoot = options.root ?? process.env.H2A_ROOT;
  if (rawRoot && !isAbsolute(rawRoot)) {
    // Relative roots derive from cwd; deterministically select stdio per invariant
    return undefined;
  }
  const root = rawRoot ? resolve(rawRoot) : join(homedir(), "h2a-workspace", ".h2a");
  const core = await loadCoreCentralMcp();
  if (typeof core.ensureCentralForRoot !== "function") throw new Error("central_starter_unqualified");
  return core.ensureCentralForRoot(root);
}

function activateCentralMcpEnvironment(core: CoreCentralMcp, endpoint: string): void {
  process.env[core.H2A_MCP_CENTRAL_ENV] = "1";
  process.env.H2A_MCP_AUTHORITY = core.centralMcpMarkerPath();
  const marker = core.readCentralMcpMarker();
  if (marker?.endpointMode === "fixed") process.env[core.H2A_MCP_CENTRAL_ENDPOINT_ENV] = endpoint;
  else delete process.env[core.H2A_MCP_CENTRAL_ENDPOINT_ENV];
}

function deactivateCentralMcpEnvironment(): void {
  delete process.env.H2A_MCP_AUTHORITY;
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
