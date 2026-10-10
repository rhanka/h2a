/** Lightweight central discovery. No store, CLI, SDK or runtime imports. */
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Stats } from "node:fs";

export const H2A_MCP_CENTRAL_ENV = "H2A_MCP_CENTRAL";
export const H2A_MCP_CENTRAL_ENDPOINT_ENV = "H2A_MCP_CENTRAL_ENDPOINT";

const CENTRAL_RUNTIME_DIRECTORY = "h2a-mcp-central";
const CENTRAL_MARKER_FILE = "marker.json";
const CENTRAL_RECLAIM_LOCK_FILE = "reclaim.lock";
const CENTRAL_PING_PATH = "/_h2a-central/ping";
const CENTRAL_LIVENESS_TIMEOUT_MS = 1_500;
const CENTRAL_LIVENESS_ATTEMPTS = 3;
const CENTRAL_LIVENESS_BACKOFF_MS = 100;

export type CentralMcpMarker = Readonly<{
  endpoint: string;
  generation: string;
  pid: number;
  startedAt: string;
  token: string;
  root?: string;
  protocol?: number;
}>;

export function uid(): number {
  if (typeof process.getuid !== "function") {
    throw new Error(`${H2A_MCP_CENTRAL_ENDPOINT_ENV} requires a current uid`);
  }
  return process.getuid();
}

/** Only explicit values opt into central routing; all other values preserve stdio. */
export function centralMcpEnabled(
  env: Readonly<Record<string, string | undefined>> = process.env
): boolean {
  const value = env[H2A_MCP_CENTRAL_ENV];
  return value === "1" || value === "true";
}

export function isLoopbackHostname(hostname: string): boolean {
  return hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";
}

/**
 * Validate and canonicalize the one endpoint both launcher and clients use.
 * Central MCP is plain Streamable HTTP; TLS termination belongs outside this
 * local process, so https URLs are deliberately refused rather than half-served.
 */
export function parseCentralMcpEndpoint(
  value: string | undefined
): string {
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

export type CentralMcpClientEndpoint = Readonly<{
  command: string;
  args: string[];
}>;

/** Returns the central URL only when the explicit opt-in is enabled. */
export function centralMcpClientEndpoint(
  env: Readonly<Record<string, string | undefined>> = process.env,
  paths: CentralMcpPathsOptions = {}
): CentralMcpClientEndpoint | undefined {
  if (!centralMcpEnabled(env)) return undefined;
  const endpoint = parseCentralMcpEndpoint(env[H2A_MCP_CENTRAL_ENDPOINT_ENV]);
  const marker = readCentralClientMarker(centralMcpMarkerPath(paths));
  if (marker.endpoint !== endpoint) {
    throw new Error(
      `${H2A_MCP_CENTRAL_ENDPOINT_ENV} does not match the private central MCP marker endpoint`
    );
  }
  return {
    command: "h2a",
    args: [
      "mcp-central-connect",
      "--endpoint",
      endpoint,
      ...(paths.runtimeBase ? ["--runtime-base", paths.runtimeBase] : [])
    ]
  };
}

export interface CentralMcpPathsOptions {
  /** Explicit isolation seam; otherwise use the private XDG runtime or UID fallback. */
  runtimeBase?: string;
}

/**
 * One marker per UID runtime namespace, independent of endpoint and workspace.
 */
export function centralMcpMarkerPath(options: CentralMcpPathsOptions = {}): string {
  const base = runtimeBase(options);
  return join(base, CENTRAL_RUNTIME_DIRECTORY, CENTRAL_MARKER_FILE);
}

export function markerDirectory(options: CentralMcpPathsOptions): string {
  return join(runtimeBase(options), CENTRAL_RUNTIME_DIRECTORY);
}

export function runtimeBase(options: CentralMcpPathsOptions, env: NodeJS.ProcessEnv = process.env, standardExists: (path: string) => boolean = existsSync): string {
  if (options.runtimeBase) return options.runtimeBase;
  if (env.XDG_RUNTIME_DIR) return env.XDG_RUNTIME_DIR;
  const standard = join("/run/user", String(uid()));
  return standardExists(standard) ? standard : join("/tmp", `h2a-mcp-runtime-${uid()}`);
}

export function expectedMode(info: Stats, mode: number, label: string): void {
  if ((info.mode & 0o777) !== mode) {
    throw new Error(`${label} must have mode ${mode.toString(8).padStart(4, "0")}`);
  }
}

/** Read the token only from the same private marker clients rendezvous through. */
export function readCentralClientMarker(path: string): CentralMcpMarker {
  const base = lstatSync(dirname(dirname(path)));
  if (!base.isDirectory() || base.uid !== uid() || (base.mode & 0o022) !== 0) throw new Error("central MCP runtime base is not a private owned directory");
  const parent = lstatSync(dirname(path));
  if (!parent.isDirectory() || parent.uid !== uid()) throw new Error("central MCP marker parent is not owned by current user");
  expectedMode(parent, 0o700, "central MCP marker parent");
  const info = lstatSync(path);
  if (!info.isFile()) throw new Error(`central MCP marker is not a regular file: ${path}`);
  if (info.uid !== uid()) throw new Error(`central MCP marker is not owned by the current user: ${path}`);
  expectedMode(info, 0o600, "central MCP marker");
  let value: Partial<CentralMcpMarker>;
  try {
    value = JSON.parse(readFileSync(path, "utf8")) as Partial<CentralMcpMarker>;
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
      token: value.token,
      ...(typeof value.root === "string" ? { root: value.root } : {}),
      ...(typeof value.protocol === "number" ? { protocol: value.protocol } : {})
    };
  } catch {
    throw new Error(`central MCP marker is malformed: ${path}`);
  }
}

/**
 * Read the protected central marker without exposing its token to callers that
 * only need liveness/generation metadata. A missing marker is the sole
 * non-error absence case; malformed or insecure state remains a hard failure.
 */
export function readCentralMcpMarker(
  paths: CentralMcpPathsOptions = {}
): Omit<CentralMcpMarker, "token"> | undefined {
  try {
    const { token: _token, ...marker } = readCentralClientMarker(centralMcpMarkerPath(paths));
    return marker;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}
