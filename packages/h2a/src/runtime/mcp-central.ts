/**
 * Opt-in, machine-local central MCP server.
 *
 * The marker deliberately lives beneath a UID-only runtime address. In
 * particular, neither the requested HTTP endpoint nor XDG_RUNTIME_DIR can
 * influence it: a varying rendezvous address cannot provide mutual exclusion.
 */
import { randomUUID } from "node:crypto";
import {
  lstatSync,
  linkSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
  type Stats
} from "node:fs";
import { once } from "node:events";
import { dirname, join } from "node:path";

import { StreamableHTTPTransport } from "@hono/mcp";
import { serve } from "@hono/node-server";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  type CallToolResult,
  type JSONRPCMessage,
  ListToolsRequestSchema
} from "@modelcontextprotocol/sdk/types.js";
import { Hono } from "hono";
import type { Readable, Writable } from "node:stream";

import { currentCliVersion } from "./upgrade/index.js";
import {
  createMcpServer,
  isMcpTransportResult,
  type McpServer
} from "./mcp/server.js";

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
}>;

type RuntimeOwnership = Readonly<{
  assertOwnedByCurrentUser(info: Stats, label: string): void;
  sameNativeTerminalSocket(
    left: Readonly<{ dev: number; ino: number }>,
    right: Readonly<{ dev: number; ino: number }>
  ): boolean;
}>;

let runtimeOwnership: Promise<RuntimeOwnership> | undefined;

function loadRuntimeOwnership(): Promise<RuntimeOwnership> {
  const runtimePkg: string = "@sentropic/h2a-runtime";
  runtimeOwnership ??= import(runtimePkg).then((runtime) => {
    if (
      typeof runtime.assertOwnedByCurrentUser !== "function" ||
      typeof runtime.sameNativeTerminalSocket !== "function"
    ) {
      throw new Error("@sentropic/h2a-runtime does not expose central MCP ownership helpers");
    }
    return runtime as RuntimeOwnership;
  });
  return runtimeOwnership;
}

function uid(): number {
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

function isLoopbackHostname(hostname: string): boolean {
  return hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]" || hostname === "localhost";
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
  /** Test seam. Production always uses /run/user/<uid>; it is never env-derived. */
  runtimeBase?: string;
}

/**
 * Fixed UID-only marker path. `runtimeBase` is a test seam, never an env input.
 */
export function centralMcpMarkerPath(options: CentralMcpPathsOptions = {}): string {
  const base = options.runtimeBase ?? join("/run/user", String(uid()));
  return join(base, CENTRAL_RUNTIME_DIRECTORY, CENTRAL_MARKER_FILE);
}

function markerDirectory(options: CentralMcpPathsOptions): string {
  return join(options.runtimeBase ?? join("/run/user", String(uid())), CENTRAL_RUNTIME_DIRECTORY);
}

function runtimeBase(options: CentralMcpPathsOptions): string {
  return options.runtimeBase ?? join("/run/user", String(uid()));
}

function expectedMode(info: Stats, mode: number, label: string): void {
  if ((info.mode & 0o777) !== mode) {
    throw new Error(`${label} must have mode ${mode.toString(8).padStart(4, "0")}`);
  }
}

/** Read the token only from the same private marker clients rendezvous through. */
function readCentralClientMarker(path: string): CentralMcpMarker {
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
      token: value.token
    };
  } catch {
    throw new Error(`central MCP marker is malformed: ${path}`);
  }
}

function parseCentralMcpBridgeMessages(body: string, contentType: string | null): JSONRPCMessage[] {
  if (body.trim().length === 0) return [];
  const values: unknown[] = [];
  if (contentType?.includes("text/event-stream")) {
    for (const event of body.split(/\r?\n\r?\n/)) {
      const data = event
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice("data:".length).trimStart())
        .join("\n");
      if (data) values.push(JSON.parse(data));
    }
  } else {
    values.push(JSON.parse(body));
  }
  return values.flatMap((value) => Array.isArray(value) ? value : [value]) as JSONRPCMessage[];
}

export interface CentralMcpStdioBridgeOptions extends CentralMcpPathsOptions {
  /** The endpoint persisted in the rendered command; it must match the marker. */
  endpoint: string;
  stdin: Readable;
  stdout: Writable;
  signal?: AbortSignal;
}

/**
 * Proxy one stdio MCP client to the current central Streamable-HTTP server.
 * The bridge reads the private marker once at connect time, so a config never
 * contains the bearer token and a newly launched bridge observes a restarted
 * owner's current credential.
 */
export async function bridgeCentralMcpStdio(options: CentralMcpStdioBridgeOptions): Promise<void> {
  const endpoint = parseCentralMcpEndpoint(options.endpoint);
  const marker = readCentralClientMarker(centralMcpMarkerPath(options));
  if (marker.endpoint !== endpoint) {
    throw new Error(
      `central MCP marker endpoint ${marker.endpoint} does not match requested endpoint ${endpoint}`
    );
  }

  const stdio = new StdioServerTransport(options.stdin, options.stdout);
  let sessionId: string | undefined;
  let stopped = false;
  let failure: Error | undefined;
  let finish!: () => void;
  const finished = new Promise<void>((resolve) => {
    finish = resolve;
  });

  const close = async (error?: unknown): Promise<void> => {
    if (error !== undefined && failure === undefined) {
      failure = error instanceof Error ? error : new Error(String(error));
    }
    if (stopped) return;
    stopped = true;
    try {
      await stdio.close();
    } finally {
      finish();
    }
  };

  const forward = async (message: JSONRPCMessage): Promise<void> => {
    if (stopped) return;
    const headers: Record<string, string> = {
      authorization: `Bearer ${marker.token}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream"
    };
    if (sessionId) headers["mcp-session-id"] = sessionId;
    let response: Response;
    try {
      response = await fetch(marker.endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(message)
      });
    } catch (error) {
      await close(new Error(`central MCP bridge cannot reach ${marker.endpoint}: ${(error as Error).message}`));
      return;
    }
    if (!response.ok) {
      await close(new Error(`central MCP bridge request failed with HTTP ${response.status}`));
      return;
    }
    const returnedSessionId = response.headers.get("mcp-session-id");
    if (returnedSessionId) sessionId = returnedSessionId;
    let messages: JSONRPCMessage[];
    try {
      messages = parseCentralMcpBridgeMessages(
        await response.text(),
        response.headers.get("content-type")
      );
    } catch (error) {
      await close(new Error(`central MCP bridge received an invalid response: ${(error as Error).message}`));
      return;
    }
    for (const next of messages) {
      try {
        await stdio.send(next);
      } catch (error) {
        await close(error);
        return;
      }
    }
  };

  stdio.onmessage = (message) => {
    void forward(message).catch((error) => void close(error));
  };
  stdio.onerror = (error) => {
    void close(error);
  };
  stdio.onclose = () => {
    void close();
  };
  if (options.signal) {
    if (options.signal.aborted) void close();
    else options.signal.addEventListener("abort", () => void close(), { once: true });
  }
  await stdio.start();
  await finished;
  if (failure) throw failure;
}

function lstatRequired(path: string, label: string): Stats {
  try {
    return lstatSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`${H2A_MCP_CENTRAL_ENDPOINT_ENV} requires private runtime base ${path}`);
    }
    throw error;
  }
}

async function ensureMarkerDirectory(options: CentralMcpPathsOptions): Promise<void> {
  const ownership = await loadRuntimeOwnership();
  const base = runtimeBase(options);
  const baseInfo = lstatRequired(base, "central MCP runtime base");
  if (!baseInfo.isDirectory()) {
    throw new Error(`${H2A_MCP_CENTRAL_ENDPOINT_ENV} requires private runtime base ${base}`);
  }
  ownership.assertOwnedByCurrentUser(baseInfo, "central MCP runtime base");
  if ((baseInfo.mode & 0o022) !== 0) {
    throw new Error(`central MCP runtime base must not be group- or world-writable: ${base}`);
  }

  const directory = markerDirectory(options);
  try {
    mkdirSync(directory, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  const directoryInfo = lstatSync(directory);
  if (!directoryInfo.isDirectory()) {
    throw new Error(`central MCP marker parent is not a directory: ${directory}`);
  }
  ownership.assertOwnedByCurrentUser(directoryInfo, "central MCP marker parent");
  expectedMode(directoryInfo, 0o700, "central MCP marker parent");
}

async function assertMarkerOwnership(path: string): Promise<Stats> {
  const ownership = await loadRuntimeOwnership();
  const info = lstatSync(path);
  if (!info.isFile()) throw new Error(`central MCP marker is not a regular file: ${path}`);
  ownership.assertOwnedByCurrentUser(info, "central MCP marker");
  expectedMode(info, 0o600, "central MCP marker");
  return info;
}

type MarkerObservation = Readonly<{
  marker: CentralMcpMarker | undefined;
  identity: Readonly<{ dev: number; ino: number }>;
}>;

/**
 * A protected malformed marker is stale state, not an absent marker. Preserve
 * its filesystem identity so reclaim can verify it has not changed underneath
 * us, just as the native socket publisher verifies dev/inode before removal.
 */
async function readMarker(path: string): Promise<MarkerObservation | undefined> {
  try {
    const info = await assertMarkerOwnership(path);
    const identity = { dev: info.dev, ino: info.ino };
    let value: Partial<CentralMcpMarker>;
    try {
      value = JSON.parse(readFileSync(path, "utf8")) as Partial<CentralMcpMarker>;
    } catch {
      return { marker: undefined, identity };
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
      return { marker: undefined, identity };
    }
    try {
      return {
        marker: {
          endpoint: parseCentralMcpEndpoint(value.endpoint),
          generation: value.generation,
          pid: value.pid,
          // Informative only. It is intentionally never read by liveness or reclaim.
          startedAt: value.startedAt,
          token: value.token
        },
        identity
      };
    } catch {
      return { marker: undefined, identity };
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

function markerBytes(marker: CentralMcpMarker): string {
  return `${JSON.stringify(marker)}\n`;
}

/**
 * Publish a complete private marker without ever exposing an empty or partial
 * target. `link(2)` provides the O_EXCL-equivalent compare-and-publish step:
 * it either installs the already-written inode or fails with EEXIST.
 */
async function writeExclusiveMarker(
  path: string,
  marker: CentralMcpMarker,
  beforePublish?: () => Promise<void>
): Promise<boolean> {
  const temporary = join(dirname(path), `.${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, markerBytes(marker), { encoding: "utf8", mode: 0o600, flag: "wx" });
    if (beforePublish) await beforePublish();
    try {
      linkSync(temporary, path);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
      throw error;
    }
  } finally {
    try {
      unlinkSync(temporary);
    } catch {
      // A successful link leaves a second name for the same inode; cleanup is best effort.
    }
  }
}

/**
 * Atomic replacement happens only after identity-based proof that the marker is
 * dead and the protected file still has the dev/inode we inspected. This is the
 * same check-before-remove pattern as `sameNativeTerminalSocket`.
 */
async function reclaimMarker(
  path: string,
  expected: Readonly<{ dev: number; ino: number }>,
  registered: CentralMcpMarker | undefined,
  marker: CentralMcpMarker,
  beforeReplace?: (candidate: CentralMcpMarker) => Promise<void>,
  beforeExclusivePublish?: () => Promise<void>
): Promise<boolean> {
  const ownership = await loadRuntimeOwnership();
  const lockPath = join(dirname(path), CENTRAL_RECLAIM_LOCK_FILE);
  if (!await acquireReclaimLock(lockPath, marker, beforeExclusivePublish)) return false;
  try {
    let current: Stats;
    try {
      current = await assertMarkerOwnership(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
    if (!ownership.sameNativeTerminalSocket(expected, { dev: current.dev, ino: current.ino })) {
      return false;
    }
    if (registered) {
      const liveness = await markerLiveness(registered);
      if (liveness === "alive") return false;
      if (liveness === "ambiguous") {
        throw new Error(
          `central MCP liveness for ${registered.endpoint} is ambiguous; refusing to reclaim a possibly-live server`
        );
      }
    }
    await beforeReplace?.(marker);
    const temporary = join(dirname(path), `.${CENTRAL_MARKER_FILE}.${randomUUID()}.tmp`);
    // Do not use the endpoint or its host in the temporary name: this directory is
    // fixed per uid and the marker is the sole rendezvous record.
    try {
      writeFileSync(temporary, markerBytes(marker), { encoding: "utf8", mode: 0o600, flag: "wx" });
      renameSync(temporary, path);
      // Keep a post-rename verification as a second line of defense if a
      // non-cooperating writer replaces the marker after our locked swap.
      return (await readMarker(path))?.marker?.generation === marker.generation;
    } finally {
      try {
        unlinkSync(temporary);
      } catch {
        // A successful rename already consumed the temp file; cleanup is best effort.
      }
    }
  } finally {
    await releaseReclaimLock(lockPath, marker.generation);
  }
}

/**
 * Coordinate reclaimers across the check-and-replace window. A live lock
 * owner is itself a live pre-claim listener; an abandoned lock can be removed
 * only when the same generation liveness check positively proves it dead.
 */
async function acquireReclaimLock(
  path: string,
  marker: CentralMcpMarker,
  beforeExclusivePublish?: () => Promise<void>
): Promise<boolean> {
  const ownership = await loadRuntimeOwnership();
  for (;;) {
    if (await writeExclusiveMarker(path, marker, beforeExclusivePublish)) return true;
    const lock = await readMarker(path);
    if (!lock) continue;
    if (!lock.marker) {
      // A protected but malformed lock carries no endpoint/generation which
      // could prove a live owner. Treat it like a malformed marker: remove it
      // only if its dev/inode is still the one we inspected, then compete for
      // a fresh O_EXCL lock on the next iteration.
      let current: Stats;
      try {
        current = await assertMarkerOwnership(path);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw error;
      }
      if (ownership.sameNativeTerminalSocket(lock.identity, { dev: current.dev, ino: current.ino })) {
        unlinkSync(path);
      }
      continue;
    }
    const liveness = await markerLiveness(lock.marker);
    if (liveness === "alive") {
      // The owner is about to publish its marker. Re-evaluate it rather than
      // allowing a second contender to pass through the old stale marker.
      await delay(10);
      return false;
    }
    if (liveness === "ambiguous") {
      throw new Error(
        `central MCP reclaim lock for ${lock.marker.endpoint} is ambiguous; refusing to remove it`
      );
    }
    let current: Stats;
    try {
      current = await assertMarkerOwnership(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    if (ownership.sameNativeTerminalSocket(lock.identity, { dev: current.dev, ino: current.ino })) {
      unlinkSync(path);
    }
  }
}

async function releaseReclaimLock(path: string, generation: string): Promise<void> {
  const lock = await readMarker(path);
  if (lock?.marker?.generation === generation) unlinkSync(path);
}

function pingUrl(endpoint: string): string {
  return new URL(CENTRAL_PING_PATH, endpoint).href;
}

type CentralPingResult =
  | Readonly<{ kind: "generation"; generation: string }>
  | Readonly<{ kind: "dead" }>
  | Readonly<{ kind: "ambiguous" }>;

function errorHasCode(error: unknown, expectedCode: string): boolean {
  let current = error;
  for (let depth = 0; depth < 4 && current && typeof current === "object"; depth += 1) {
    if ((current as NodeJS.ErrnoException).code === expectedCode) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

async function centralPing(endpoint: string, timeoutMs: number): Promise<CentralPingResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(pingUrl(endpoint), { signal: controller.signal });
    if (!response.ok) return { kind: "dead" };
    try {
      const body = await response.json() as { generation?: unknown };
      return typeof body.generation === "string" && body.generation.length > 0
        ? { kind: "generation", generation: body.generation }
        : { kind: "dead" };
    } catch {
      // An HTTP peer answered but did not provide a registration generation.
      return { kind: "dead" };
    }
  } catch (error) {
    // ECONNREFUSED is the only transport failure that positively proves no
    // listener owns this registration. Timeouts and all other errors are not.
    return errorHasCode(error, "ECONNREFUSED") ? { kind: "dead" } : { kind: "ambiguous" };
  } finally {
    clearTimeout(timeout);
  }
}

type MarkerLiveness = "alive" | "dead" | "ambiguous";

/** Identity, not PID, is the only liveness proof for a registered server. */
async function markerLiveness(marker: CentralMcpMarker): Promise<MarkerLiveness> {
  for (let attempt = 0; attempt < CENTRAL_LIVENESS_ATTEMPTS; attempt += 1) {
    const result = await centralPing(
      marker.endpoint,
      CENTRAL_LIVENESS_TIMEOUT_MS + attempt * CENTRAL_LIVENESS_BACKOFF_MS
    );
    if (result.kind === "generation") {
      return result.generation === marker.generation ? "alive" : "dead";
    }
    if (result.kind === "dead") return "dead";
    if (attempt + 1 < CENTRAL_LIVENESS_ATTEMPTS) {
      await delay(CENTRAL_LIVENESS_BACKOFF_MS * (attempt + 1));
    }
  }
  return "ambiguous";
}

function newMarker(endpoint: string, generation = randomUUID()): CentralMcpMarker {
  return {
    endpoint,
    generation,
    pid: process.pid,
    startedAt: new Date().toISOString(),
    token: randomUUID()
  };
}

type MarkerClaim =
  | Readonly<{ kind: "claimed"; marker: CentralMcpMarker }>
  | Readonly<{ kind: "reused"; marker: CentralMcpMarker }>;

/**
 * Load-bearing order: ownership → read → identity liveness → claim/reclaim.
 * A stale PID or an old startedAt cannot block a restart because neither enters
 * the decision.
 */
async function claimCentralMarker(
  endpoint: string,
  paths: CentralMcpPathsOptions,
  candidate: CentralMcpMarker,
  beforeReplace?: (candidate: CentralMcpMarker) => Promise<void>,
  beforeExclusivePublish?: () => Promise<void>
): Promise<MarkerClaim> {
  await ensureMarkerDirectory(paths);
  const path = centralMcpMarkerPath(paths);
  for (;;) {
    const observation = await readMarker(path);
    if (!observation) {
      if (await writeExclusiveMarker(path, candidate, beforeExclusivePublish)) {
        return { kind: "claimed", marker: candidate };
      }
      continue;
    }

    if (observation.marker) {
      const liveness = await markerLiveness(observation.marker);
      if (liveness === "alive") {
        if (observation.marker.endpoint === endpoint) return { kind: "reused", marker: observation.marker };
        throw new Error(
          `a LIVE central MCP server is registered on ${observation.marker.endpoint}; this launcher requests ${endpoint}`
        );
      }
      if (liveness === "ambiguous") {
        throw new Error(
          `central MCP liveness for ${observation.marker.endpoint} is ambiguous; refusing to reclaim a possibly-live server`
        );
      }
    }

    // A connection refusal, a responding non-generation peer, or a different
    // generation is positive proof that THIS registration is dead. Reclaim
    // even when endpoints are equal; never reclaim on ambiguous liveness.
    if (await reclaimMarker(
      path,
      observation.identity,
      observation.marker,
      candidate,
      beforeReplace,
      beforeExclusivePublish
    )) {
      return { kind: "claimed", marker: candidate };
    }
  }
}

function centralToolResult(server: McpServer, name: string, args: Record<string, unknown>): CallToolResult {
  const result = server.callTool(name, args);
  if (isMcpTransportResult(result)) return result;
  const isError = Boolean(result && typeof result === "object" && "error" in result);
  return {
    content: [{ type: "text", text: JSON.stringify(result) }],
    isError
  };
}

function createCentralProtocolServer(mcp: McpServer): Server {
  const server = new Server(
    { name: "@sentropic/h2a", version: currentCliVersion() },
    { capabilities: { tools: {} } }
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: mcp.listTools() }));
  server.setRequestHandler(
    CallToolRequestSchema,
    async (request): Promise<CallToolResult> =>
      centralToolResult(mcp, request.params.name, request.params.arguments ?? {})
  );
  return server;
}

function loopbackHostHeader(host: string | undefined): boolean {
  if (!host) return false;
  try {
    return isLoopbackHostname(new URL(`http://${host}`).hostname);
  } catch {
    return false;
  }
}

function sameHttpOrigin(origin: string | undefined, host: string): boolean {
  if (!origin) return true;
  try {
    const requestOrigin = new URL(`http://${host}`).origin;
    return new URL(origin).origin === requestOrigin;
  } catch {
    return false;
  }
}

function createCentralApp(
  mcp: () => McpServer | undefined,
  endpoint: string,
  generation: string,
  token: string
): Hono {
  const app = new Hono();
  const sessions = new Map<string, StreamableHTTPTransport>();
  app.get(CENTRAL_PING_PATH, (context) => context.json({ generation }));
  app.all(new URL(endpoint).pathname, async (context) => {
    const host = context.req.header("host");
    if (!host || !loopbackHostHeader(host)) {
      return context.json({ error: "central MCP request origin is not allowed" }, 403);
    }
    if (!sameHttpOrigin(context.req.header("origin"), host)) {
      return context.json({ error: "central MCP request origin is not allowed" }, 403);
    }
    if (context.req.header("authorization") !== `Bearer ${token}`) {
      context.header("www-authenticate", "Bearer");
      return context.json({ error: "central MCP authorization is required" }, 401);
    }
    const centralMcp = mcp();
    if (!centralMcp) return context.json({ error: "central MCP is starting" }, 503);
    const requestedSessionId = context.req.header("mcp-session-id");
    let transport = requestedSessionId ? sessions.get(requestedSessionId) : undefined;
    if (!transport) {
      let created: StreamableHTTPTransport | undefined;
      transport = new StreamableHTTPTransport({
        enableJsonResponse: true,
        sessionIdGenerator: randomUUID,
        onsessioninitialized: (sessionId) => {
          if (created) sessions.set(sessionId, created);
        },
        onsessionclosed: (sessionId) => {
          sessions.delete(sessionId);
        }
      });
      created = transport;
      await createCentralProtocolServer(centralMcp).connect(transport);
    }
    const response = await transport.handleRequest(context);
    return response ?? context.body(null, 202);
  });
  return app;
}

function addressIsInUse(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as NodeJS.ErrnoException).code === "EADDRINUSE");
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * A same-endpoint contender cannot bind a second listener. If it found a
 * central ping responder, wait briefly for the listener's owner to publish its
 * matching marker, then reuse that owner without writing any marker itself.
 */
async function markedCentralListener(
  endpoint: string,
  markerPath: string
): Promise<CentralMcpMarker | undefined> {
  const deadline = Date.now() + CENTRAL_LIVENESS_TIMEOUT_MS * CENTRAL_LIVENESS_ATTEMPTS;
  for (;;) {
    const ping = await centralPing(endpoint, CENTRAL_LIVENESS_TIMEOUT_MS);
    if (ping.kind !== "generation") return undefined;
    const observation = await readMarker(markerPath);
    if (
      observation?.marker?.endpoint === endpoint &&
      observation.marker.generation === ping.generation
    ) {
      return observation.marker;
    }
    if (Date.now() >= deadline) return undefined;
    await delay(10);
  }
}

async function closeHttpServer(httpServer: ReturnType<typeof serve>, mcp: McpServer | undefined): Promise<void> {
  try {
    await new Promise<void>((resolve, reject) => {
      httpServer.close((error?: Error) => error ? reject(error) : resolve());
    });
  } finally {
    mcp?.sessions.closeAll("closed");
  }
}

export interface StartCentralMcpServerOptions extends CentralMcpPathsOptions {
  root: string;
  env?: Readonly<Record<string, string | undefined>>;
  /** Test seam for forcing scheduling around a successful marker claim. */
  afterMarkerClaim?: () => Promise<void>;
  /** Test seam for scheduling contenders after identity-CAS and before rename. */
  beforeMarkerReclaimReplace?: (candidate: CentralMcpMarker) => Promise<void>;
  /** Test seam for scheduling exclusive publication after staging complete content. */
  beforeExclusiveMarkerPublish?: () => Promise<void>;
}

export type StartedCentralMcpServer =
  | Readonly<{
      kind: "reused";
      endpoint: string;
      generation: string;
      markerPath: string;
    }>
  | Readonly<{
      kind: "started";
      endpoint: string;
      generation: string;
      markerPath: string;
      stop(): Promise<void>;
    }>;

/**
 * Start exactly one full-surface MCP server at the explicit endpoint.
 * The endpoint begins answering its generation ping before that generation is
 * recorded in the marker, so a contender never mistakes a starting owner for
 * a dead registration.
 */
export async function startCentralMcpServer(
  options: StartCentralMcpServerOptions
): Promise<StartedCentralMcpServer> {
  const env = options.env ?? process.env;
  const endpoint = parseCentralMcpEndpoint(env[H2A_MCP_CENTRAL_ENDPOINT_ENV]);
  const paths: CentralMcpPathsOptions = options.runtimeBase ? { runtimeBase: options.runtimeBase } : {};
  const markerPath = centralMcpMarkerPath(paths);
  const marker = newMarker(endpoint, randomUUID());
  const endpointUrl = new URL(endpoint);
  const hostname = endpointUrl.hostname.startsWith("[")
    ? endpointUrl.hostname.slice(1, -1)
    : endpointUrl.hostname;
  let mcp: McpServer | undefined;
  let httpServer: ReturnType<typeof serve> | undefined;
  try {
    httpServer = serve({
      fetch: createCentralApp(() => mcp, endpoint, marker.generation, marker.token).fetch,
      hostname,
      port: Number(endpointUrl.port)
    });
    if (!httpServer.listening) await once(httpServer, "listening");
  } catch (error) {
    try {
      if (addressIsInUse(error)) {
        const existing = await markedCentralListener(endpoint, markerPath);
        if (existing) {
          return {
            kind: "reused",
            endpoint: existing.endpoint,
            generation: existing.generation,
            markerPath
          };
        }
      }
    } finally {
      mcp?.sessions.closeAll("closed");
    }
    throw error;
  }

  let claim: MarkerClaim | undefined;
  try {
    claim = await claimCentralMarker(
      endpoint,
      paths,
      marker,
      options.beforeMarkerReclaimReplace,
      options.beforeExclusiveMarkerPublish
    );
    if (claim.kind === "reused") {
      await closeHttpServer(httpServer, mcp);
      return {
        kind: "reused",
        endpoint: claim.marker.endpoint,
        generation: claim.marker.generation,
        markerPath
      };
    }
    mcp = createMcpServer({ root: options.root, workspaceRoot: process.cwd() });
    await options.afterMarkerClaim?.();
  } catch (error) {
    try {
      await closeHttpServer(httpServer, mcp);
    } catch {
      // Preserve the marker conflict or claim error after attempting cleanup.
    }
    if (claim?.kind === "claimed") {
      try {
        const current = await readMarker(markerPath);
        if (current?.marker?.generation === marker.generation) unlinkSync(markerPath);
      } catch {
        // Never remove a marker we cannot prove is still ours.
      }
    }
    throw error;
  }

  let stopped = false;
  return {
    kind: "started",
    endpoint,
    generation: marker.generation,
    markerPath,
    async stop(): Promise<void> {
      if (stopped) return;
      stopped = true;
      await closeHttpServer(httpServer, mcp);
      try {
        const current = await readMarker(markerPath);
        if (current?.marker?.generation === marker.generation) unlinkSync(markerPath);
      } catch {
        // A successor marker belongs to another server; never remove it.
      }
    }
  };
}
