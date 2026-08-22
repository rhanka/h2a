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
import {
  CallToolRequestSchema,
  type CallToolResult,
  ListToolsRequestSchema
} from "@modelcontextprotocol/sdk/types.js";
import { Hono } from "hono";

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
const CENTRAL_PING_PATH = "/_h2a-central/ping";
const CENTRAL_LIVENESS_TIMEOUT_MS = 750;

export type CentralMcpMarker = Readonly<{
  endpoint: string;
  generation: string;
  pid: number;
  startedAt: string;
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
  runtimeOwnership ??= import("@sentropic/h2a-runtime").then((runtime) => {
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
    !endpoint.hostname ||
    !endpoint.port ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash
  ) {
    throw new Error(`${H2A_MCP_CENTRAL_ENDPOINT_ENV} must be an absolute http URL with an explicit port`);
  }
  return endpoint.href;
}

/** Returns the central URL only when the explicit opt-in is enabled. */
export function centralMcpClientEndpoint(
  env: Readonly<Record<string, string | undefined>> = process.env
): string | undefined {
  return centralMcpEnabled(env)
    ? parseCentralMcpEndpoint(env[H2A_MCP_CENTRAL_ENDPOINT_ENV])
    : undefined;
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
      typeof value.startedAt !== "string"
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
          startedAt: value.startedAt
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

function writeExclusiveMarker(path: string, marker: CentralMcpMarker): boolean {
  try {
    writeFileSync(path, markerBytes(marker), { encoding: "utf8", mode: 0o600, flag: "wx" });
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
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
  marker: CentralMcpMarker
): Promise<boolean> {
  const ownership = await loadRuntimeOwnership();
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
  const temporary = join(dirname(path), `.${CENTRAL_MARKER_FILE}.${randomUUID()}.tmp`);
  // Do not use the endpoint or its host in the temporary name: this directory is
  // fixed per uid and the marker is the sole rendezvous record.
  try {
    writeFileSync(temporary, markerBytes(marker), { encoding: "utf8", mode: 0o600, flag: "wx" });
    renameSync(temporary, path);
    return true;
  } finally {
    try {
      unlinkSync(temporary);
    } catch {
      // A successful rename already consumed the temp file; cleanup is best effort.
    }
  }
}

function pingUrl(endpoint: string): string {
  return new URL(CENTRAL_PING_PATH, endpoint).href;
}

async function centralPingGeneration(endpoint: string): Promise<string | undefined> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CENTRAL_LIVENESS_TIMEOUT_MS);
  try {
    const response = await fetch(pingUrl(endpoint), { signal: controller.signal });
    if (!response.ok) return undefined;
    const body = await response.json() as { generation?: unknown };
    return typeof body.generation === "string" && body.generation.length > 0
      ? body.generation
      : undefined;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
}

/** Identity, not PID, is the only liveness proof for a registered server. */
async function markerIsLive(marker: CentralMcpMarker): Promise<boolean> {
  return (await centralPingGeneration(marker.endpoint)) === marker.generation;
}

function newMarker(endpoint: string, generation = randomUUID()): CentralMcpMarker {
  return {
    endpoint,
    generation,
    pid: process.pid,
    startedAt: new Date().toISOString()
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
  candidate: CentralMcpMarker
): Promise<MarkerClaim> {
  await ensureMarkerDirectory(paths);
  const path = centralMcpMarkerPath(paths);
  for (;;) {
    const observation = await readMarker(path);
    if (!observation) {
      if (writeExclusiveMarker(path, candidate)) return { kind: "claimed", marker: candidate };
      continue;
    }

    if (observation.marker && await markerIsLive(observation.marker)) {
      if (observation.marker.endpoint === endpoint) return { kind: "reused", marker: observation.marker };
      throw new Error(
        `a LIVE central MCP server is registered on ${observation.marker.endpoint}; this launcher requests ${endpoint}`
      );
    }

    // No response, or a response carrying another generation, is positive proof
    // that THIS registration is dead. Reclaim even when endpoints are equal.
    if (await reclaimMarker(path, observation.identity, candidate)) {
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

function createCentralApp(
  mcp: () => McpServer | undefined,
  endpoint: string,
  generation: string
): Hono {
  const app = new Hono();
  const sessions = new Map<string, StreamableHTTPTransport>();
  app.get(CENTRAL_PING_PATH, (context) => context.json({ generation }));
  app.all(new URL(endpoint).pathname, async (context) => {
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
  const deadline = Date.now() + CENTRAL_LIVENESS_TIMEOUT_MS * 2;
  for (;;) {
    const generation = await centralPingGeneration(endpoint);
    if (!generation) return undefined;
    const observation = await readMarker(markerPath);
    if (
      observation?.marker?.endpoint === endpoint &&
      observation.marker.generation === generation
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
      fetch: createCentralApp(() => mcp, endpoint, marker.generation).fetch,
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
    claim = await claimCentralMarker(endpoint, paths, marker);
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
