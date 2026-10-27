/**
 * Runtime-side central MCP lifecycle. This module owns its end of the
 * central contract: endpoint selection, marker read/validation, HTTP
 * liveness ping, and starting the existing foreground serve command as a
 * detached child when necessary. It deliberately never names the core
 * package: host-config rendering stays a core command invoked over the
 * `h2a` binary (the same spawn pattern used for `mcp-central-serve`
 * below), so isolated installs of this package keep working and degrade
 * cleanly where core is absent.
 *
 * Cross-package constants below (env names, marker directory/file, ping
 * path, file mode) mirror the core contract values. They are pinned by the
 * vitest suite in this directory, which exercises them against real
 * markers and a real HTTP peer.
 */
import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  closeSync,
  constants,
  existsSync,
  lstatSync,
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
import { dirname, join } from "node:path";

import { getH2aConfig, resolveConfigPath, setH2aConfig } from "./config.js";
import { appendCrashLog, MAX_CRASH_LOG_BYTES } from "./crash-log.js";

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

export type CentralMcpPreparation =
  | Readonly<{ status: "central"; endpoint: string; generation: string }>
  | Readonly<{ status: "degraded"; reason: string }>;

type HostConfigSnapshot =
  | Readonly<{ exists: true; contents: string }>
  | Readonly<{ exists: false }>;

/** Test seam mirroring the core marker-path options. Production always uses
 *  `/run/user/<uid>`; the path is never env-derived. */
export interface CentralMcpPaths {
  readonly runtimeBase?: string;
}

// Stable cross-package contract values (mirrored from core; pinned by the
// vitest suite in this directory against real markers and a real HTTP peer).
export const H2A_MCP_CENTRAL_ENV = "H2A_MCP_CENTRAL";
export const H2A_MCP_CENTRAL_ENDPOINT_ENV = "H2A_MCP_CENTRAL_ENDPOINT";
const CENTRAL_RUNTIME_DIRECTORY = "h2a-mcp-central";
const CENTRAL_MARKER_FILE = "marker.json";
const CENTRAL_PING_PATH = "/_h2a-central/ping";
const CENTRAL_LIVENESS_TIMEOUT_MS = 1_500;
const CENTRAL_HOST_SETUP_TIMEOUT_MS = 60_000;

function currentUid(): number {
  if (typeof process.getuid !== "function") {
    throw new Error(`${H2A_MCP_CENTRAL_ENDPOINT_ENV} requires a current uid`);
  }
  return process.getuid();
}

function centralMcpMarkerPath(paths: CentralMcpPaths = {}): string {
  const base = paths.runtimeBase ?? join("/run/user", String(currentUid()));
  return join(base, CENTRAL_RUNTIME_DIRECTORY, CENTRAL_MARKER_FILE);
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]" || hostname === "localhost";
}

function parseCentralMcpEndpoint(value: string | undefined): string {
  if (!value || value.trim().length === 0) {
    throw new Error(`${H2A_MCP_CENTRAL_ENDPOINT_ENV} must be a non-empty absolute http URL`);
  }
  let endpoint: URL;
  try {
    endpoint = new URL(value);
  } catch {
    throw new Error(`${H2A_MCP_CENTRAL_ENDPOINT_ENV} must be a non-empty absolute http URL`);
  }
  if (
    endpoint.protocol !== "http:" ||
    !isLoopbackHostname(endpoint.hostname) ||
    !endpoint.port ||
    Number(endpoint.port) < 1 ||
    Number(endpoint.port) > 65_535 ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash
  ) {
    throw new Error(`${H2A_MCP_CENTRAL_ENDPOINT_ENV} must be an absolute http URL with an explicit port`);
  }
  return endpoint.href;
}

function errorHasCode(error: unknown, expectedCode: string): boolean {
  let current = error;
  for (let depth = 0; depth < 4 && current && typeof current === "object"; depth += 1) {
    if ((current as NodeJS.ErrnoException).code === expectedCode) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

export async function centralMcpPing(endpoint: string, timeoutMs = CENTRAL_LIVENESS_TIMEOUT_MS): Promise<CentralPing> {
  const canonicalEndpoint = parseCentralMcpEndpoint(endpoint);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const pingUrl = new URL(CENTRAL_PING_PATH, canonicalEndpoint).href;
  return fetch(pingUrl, { signal: controller.signal }).then(
    async (response) => {
      clearTimeout(timeout);
      if (!response.ok) return { kind: "dead" } as const;
      try {
        const body = (await response.json()) as { generation?: unknown };
        return typeof body.generation === "string" && body.generation.length > 0
          ? { kind: "generation", generation: body.generation } as const
          : ({ kind: "dead" } as const);
      } catch {
        return { kind: "dead" } as const;
      }
    },
    (error: unknown) => {
      clearTimeout(timeout);
      // ECONNREFUSED is the only transport failure that positively proves no
      // listener owns this registration. Timeouts and all other errors are not.
      return (errorHasCode(error, "ECONNREFUSED") ? { kind: "dead" } : { kind: "ambiguous" }) as CentralPing;
    },
  );
}

/**
 * Read the protected central marker without exposing its token to callers
 * that only need liveness/generation metadata. A missing marker is the sole
 * non-error absence case; malformed or insecure state remains a hard failure.
 */
export function readCentralMcpMarker(paths: CentralMcpPaths = {}): CentralMarker | undefined {
  const path = centralMcpMarkerPath(paths);
  let info;
  try {
    info = lstatSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  if (!info.isFile()) throw new Error(`central MCP marker is not a regular file: ${path}`);
  if (info.uid !== currentUid()) throw new Error(`central MCP marker is not owned by the current user: ${path}`);
  if ((info.mode & 0o777) !== 0o600) throw new Error(`central MCP marker must have mode 0600: ${path}`);
  let value: Partial<CentralMarker & { token: string }>;
  try {
    value = JSON.parse(readFileSync(path, "utf8")) as Partial<CentralMarker & { token: string }>;
  } catch {
    throw new Error(`central MCP marker is malformed: ${path}`);
  }
  if (
    typeof value.endpoint !== "string" ||
    typeof value.generation !== "string" ||
    value.generation.length === 0 ||
    typeof value.pid !== "number" ||
    typeof value.startedAt !== "string" ||
    typeof value.token !== "string" ||
    value.token.length === 0
  ) {
    throw new Error(`central MCP marker is malformed: ${path}`);
  }
  try {
    return {
      endpoint: parseCentralMcpEndpoint(value.endpoint),
      generation: value.generation,
      pid: value.pid,
      startedAt: value.startedAt,
    };
  } catch {
    throw new Error(`central MCP marker is malformed: ${path}`);
  }
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
  const endpoint = defaultCentralEndpoint();
  setH2aConfig({
    enabled: h2a.enabled,
    command: h2a.command,
    central: { ...h2a.central, endpoint },
  });
  return endpoint;
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
  paths: CentralMcpPaths,
  endpoint: string,
  spawnFailure: () => Error | undefined,
): Promise<{ endpoint: string; generation: string }> {
  const deadline = Date.now() + CENTRAL_START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const failure = spawnFailure();
    if (failure) {
      // The server child never started: a startup failure, not a child exit.
      appendCrashLog("mcp-server", { event: "startupError", reason: "spawn-failed", detail: failure.message });
      throw failure;
    }
    const ping = await centralMcpPing(endpoint, CENTRAL_START_POLL_MS);
    if (ping.kind === "generation") {
      const marker = readCentralMcpMarker(paths);
      if (marker?.endpoint === endpoint && marker.generation === ping.generation) {
        return { endpoint, generation: ping.generation };
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
  options: Readonly<{ root?: string; paths?: CentralMcpPaths }> = {},
): Promise<Readonly<{ endpoint: string; generation: string }> | undefined> {
  const endpoint = configuredCentralEndpoint();
  if (!endpoint) return undefined;
  const paths = options.paths ?? {};
  const marker = readCentralMcpMarker(paths);
  if (marker) {
    const ping = await centralMcpPing(marker.endpoint);
    if (ping.kind === "ambiguous") {
      appendCrashLog("mcp-server", { event: "refusal", instanceId: marker.generation, reason: "ambiguous-liveness", detail: marker.endpoint });
      throw new Error(`central MCP liveness at ${marker.endpoint} is ambiguous; refusing to start another server`);
    }
    if (ping.kind === "generation") {
      if (marker.endpoint === endpoint && ping.generation === marker.generation) {
        return { endpoint, generation: marker.generation };
      }
      appendCrashLog("mcp-server", { event: "refusal", instanceId: marker.generation, reason: "marker-listener-mismatch", detail: marker.endpoint });
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
      ["mcp-central-serve", ...(options.root ? ["--root", options.root] : [])],
      {
        detached: true,
        stdio: ["ignore", logFd, logFd],
        env: {
          ...process.env,
          [H2A_MCP_CENTRAL_ENV]: "1",
          [H2A_MCP_CENTRAL_ENDPOINT_ENV]: endpoint,
        },
      },
    );
    child.once("error", (error) => {
      spawnError = error;
    });
    // A post-readiness crash leaves a structured record while this launcher
    // is still alive. (Once the launcher exits, only the raw server output
    // in mcp-central.log witnesses a later death — see `h2a logs`.)
    child.once("exit", (code, signal) => {
      if (code === 0 || (code === null && signal === null)) return;
      appendCrashLog("mcp-server", {
        event: "childExit",
        reason: "server-exit",
        ...(typeof code === "number" ? { exitCode: code } : {}),
        ...(typeof signal === "string" && signal.length > 0 ? { signal } : {}),
        detail: `central MCP server exited${typeof signal === "string" && signal.length > 0 ? ` on ${signal}` : ""}`,
      });
    });
    child.unref();
  } finally {
    closeSync(logFd);
  }
  return waitForCentralStart(paths, endpoint, () => spawnError);
}

function profileMcpConfig(profile: string, cwd: string): { host: string; path: string } | undefined {
  switch (profile) {
    case "claude":
    case "claude-code":
      return { host: "claude", path: join(cwd, ".mcp.json") };
    case "codex": {
      const legacy = process.env.CODEX_HOME
        ? join(process.env.CODEX_HOME, "config.json")
        : join(homedir(), ".codex", "config.json");
      const xdg = join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "codex", "mcp.json");
      return { host: "codex", path: existsSync(legacy) ? legacy : xdg };
    }
    case "gemini":
    case "gemini-cli":
      return { host: "gemini", path: join(cwd, ".gemini", "settings.json") };
    case "agy":
    case "antigravity":
      return { host: "agy", path: join(homedir(), ".gemini", "config", "mcp_config.json") };
    default:
      return undefined;
  }
}

function activateCentralMcpEnvironment(endpoint: string): void {
  process.env[H2A_MCP_CENTRAL_ENV] = "1";
  process.env[H2A_MCP_CENTRAL_ENDPOINT_ENV] = endpoint;
}

function deactivateCentralMcpEnvironment(): void {
  delete process.env.H2A_MCP_CENTRAL;
  delete process.env.H2A_MCP_CENTRAL_ENDPOINT;
}

function captureHostConfig(path: string): HostConfigSnapshot {
  return existsSync(path)
    ? { exists: true, contents: readFileSync(path, "utf8") }
    : { exists: false };
}

function restoreHostConfig(path: string, snapshot: HostConfigSnapshot): void {
  if (snapshot.exists) {
    writeFileSync(path, snapshot.contents, { mode: 0o600 });
    chmodSync(path, 0o600);
  } else if (existsSync(path)) {
    unlinkSync(path);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Render the host config through the core CLI over the `h2a` binary (never an
 * in-process core import). Output stays captured (quiet launch path); a
 * nonzero exit degrades to the per-session sidecar exactly like before. The
 * real installation doctor runs here instead of the former always-ok stub, so
 * a genuinely incoherent host setup now surfaces as degraded-with-reason
 * rather than a masked central — still fail-closed, never a crash.
 */
function writeHostConfig(target: { host: string; path: string }, cwd: string): void {
  let status: number | null = null;
  let spawnError: Error | undefined;
  try {
    const result = spawnSync(
      "h2a",
      ["host", "setup", "--host", target.host, "--write", target.path],
      { cwd, stdio: "pipe", encoding: "utf8", timeout: CENTRAL_HOST_SETUP_TIMEOUT_MS },
    );
    status = result.status;
    spawnError = result.error;
  } catch (error) {
    spawnError = error instanceof Error ? error : new Error(String(error));
  }
  if (status !== 0) {
    throw new Error(
      `central MCP could not write the ${target.host} host config at ${target.path}` +
      (spawnError ? ` (${spawnError.message})` : ""),
    );
  }
}

/** Ensure central MCP and rewrite the launched host's existing MCP config path. */
export async function prepareCentralMcpForLaunch(options: Readonly<{
  root?: string;
  profile: string;
  cwd: string;
  paths?: CentralMcpPaths;
}>): Promise<CentralMcpPreparation | undefined> {
  let hostConfig: { path: string; snapshot: HostConfigSnapshot } | undefined;
  try {
    const central = await ensureCentralMcp({
      ...(options.root ? { root: options.root } : {}),
      ...(options.paths ? { paths: options.paths } : {}),
    });
    if (!central) return undefined;
    const target = profileMcpConfig(options.profile, options.cwd);
    if (target) hostConfig = { path: target.path, snapshot: captureHostConfig(target.path) };
    activateCentralMcpEnvironment(central.endpoint);
    if (target) writeHostConfig(target, options.cwd);
    return { status: "central", ...central };
  } catch (error) {
    deactivateCentralMcpEnvironment();
    let reason = errorMessage(error);
    if (hostConfig) {
      try {
        restoreHostConfig(hostConfig.path, hostConfig.snapshot);
      } catch (rollbackError) {
        reason += `; could not restore the per-session MCP config: ${errorMessage(rollbackError)}`;
      }
    }
    return { status: "degraded", reason };
  }
}

/** Restore launches inherit these values; each re-entered run rewrites its host config. */
export async function prepareCentralMcpForRestore(
  options: Readonly<{ root?: string; paths?: CentralMcpPaths }> = {},
): Promise<CentralMcpPreparation | undefined> {
  try {
    const central = await ensureCentralMcp(options);
    if (!central) return undefined;
    activateCentralMcpEnvironment(central.endpoint);
    return { status: "central", ...central };
  } catch (error) {
    deactivateCentralMcpEnvironment();
    return { status: "degraded", reason: errorMessage(error) };
  }
}
