/**
 * Machine-local central MCP server. Election is independent of endpoint and
 * workspace within the current private UID runtime namespace.
 */
import { randomUUID } from "node:crypto";
import {
  existsSync,
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
import { monitorEventLoopDelay } from "node:perf_hooks";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { realpathSync, statSync } from "node:fs";

import { StreamableHTTPTransport } from "@hono/mcp";
import { serve } from "@hono/node-server";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  type CallToolResult,
  ListToolsRequestSchema
} from "@modelcontextprotocol/sdk/types.js";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";

import { currentCliVersion } from "./upgrade/index.js";
import {
  createMcpServer,
  isMcpTransportResult,
  type McpServer
} from "./mcp/server.js";
import { boundCallToolResult } from "./mcp/frame-budget.js";
import { createLocalStore } from "./local-files/index.js";
import { openCentralAttachment, type CentralAttachmentHandle } from "./mcp-central-attachment.js";
import { parseCentralAttachment } from "./mcp-central-context.js";
import type { H2aRunExecutor } from "./mcp/agent-launch.js";
import { centralPausePath } from "./mcp-central-operator.js";

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

import { H2A_MCP_CENTRAL_ENDPOINT_ENV, centralMcpMarkerPath, expectedMode, isLoopbackHostname, markerDirectory, parseCentralMcpEndpoint, runtimeBase, uid, type CentralMcpMarker, type CentralMcpPathsOptions } from "./mcp-central-discovery.js";
export { H2A_MCP_CENTRAL_ENV, H2A_MCP_CENTRAL_ENDPOINT_ENV, centralMcpEnabled, centralMcpClientEndpoint, centralMcpMarkerPath, parseCentralMcpEndpoint, readCentralMcpMarker } from "./mcp-central-discovery.js";
export type { CentralMcpMarker, CentralMcpPathsOptions, CentralMcpClientEndpoint } from "./mcp-central-discovery.js";
export { bridgeCentralMcpStdio } from "./mcp-central-client.js";
export type { CentralMcpStdioBridgeOptions } from "./mcp-central-client.js";
const CENTRAL_RUNTIME_DIRECTORY = "h2a-mcp-central";
const CENTRAL_MARKER_FILE = "marker.json";
const CENTRAL_RECLAIM_LOCK_FILE = "reclaim.lock";
const CENTRAL_PING_PATH = "/_h2a-central/ping";
const CENTRAL_LIVENESS_TIMEOUT_MS = 1_500;
const CENTRAL_LIVENESS_ATTEMPTS = 3;
const CENTRAL_LIVENESS_BACKOFF_MS = 100;

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
  if (!options.runtimeBase && !process.env.XDG_RUNTIME_DIR && base === join("/tmp", `h2a-mcp-runtime-${uid()}`)) mkdirSync(base, { mode: 0o700, recursive: true });
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
          token: value.token,
          ...(typeof value.root === "string" ? { root: value.root } : {}),
          ...(typeof value.protocol === "number" ? { protocol: value.protocol } : {})
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

export type CentralMcpPingResult =
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

export async function centralMcpPing(
  endpoint: string,
  timeoutMs = CENTRAL_LIVENESS_TIMEOUT_MS
): Promise<CentralMcpPingResult> {
  const canonicalEndpoint = parseCentralMcpEndpoint(endpoint);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(pingUrl(canonicalEndpoint), { signal: controller.signal });
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
    const result = await centralMcpPing(
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
  beforeExclusivePublish?: () => Promise<void>,
  reuseAnyEndpoint = false
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
        if (observation.marker.endpoint === endpoint || reuseAnyEndpoint) return { kind: "reused", marker: observation.marker };
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

async function centralToolResult(server: McpServer, name: string, args: Record<string, unknown>): Promise<CallToolResult> {
  const result = await server.callTool(name, args);
  const shaped: CallToolResult = isMcpTransportResult(result)
    ? (result as CallToolResult)
    : {
        content: [{ type: "text", text: JSON.stringify(result) }],
        isError: Boolean(result && typeof result === "object" && "error" in result)
      };
  // L1: bound the final SDK frame — an oversize tool result becomes a bounded
  // -32010-style error result with a recovery ref, never a raw >B frame.
  return boundCallToolResult(shaped as never, server.frameBudget, (j) => {
    try {
      return server.payloadStore.persistOutput(Buffer.from(j, "utf8"));
    } catch {
      return undefined;
    }
  }) as CallToolResult;
}

function createCentralProtocolServer(mcp: McpServer): Server {
  const server = new Server(
    { name: "@sentropic/h2a", version: currentCliVersion() },
    { capabilities: { tools: {} } }
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: mcp.listTools() }));
  server.setRequestHandler(
    CallToolRequestSchema,
    async (request): Promise<CallToolResult> => {
      for (const session of mcp.sessions.list()) mcp.sessions.markActivity(session.sessionId);
      return centralToolResult(mcp, request.params.name, request.params.arguments ?? {});
    }
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
  root: string,
  store: () => ReturnType<typeof createLocalStore> | undefined,
  endpoint: string,
  generation: string,
  token: string,
  options: { requestStop(): void; idleTimeoutMs: number; sessionLeaseMs: number; runExecutor?: H2aRunExecutor }
): { app: Hono; close(): Promise<void> } {
  const app = new Hono();
  const lag = monitorEventLoopDelay({ resolution: 20 });
  lag.enable();
  app.use(new URL(endpoint).pathname, bodyLimit({ maxSize: 4 * 1024 * 1024 }));
  type Attachment = { transport: StreamableHTTPTransport; handle: CentralAttachmentHandle; touched: number; closing?: Promise<void> };
  const sessions = new Map<string, Attachment>();
  let lastBusy = Date.now();
  let closing = false;
  const closeAttachment = (id: string, attachment: Attachment): Promise<void> => {
    attachment.closing ??= (async () => {
      sessions.delete(id);
      await attachment.handle.close();
      await attachment.transport.close();
      lastBusy = Date.now();
    })();
    return attachment.closing;
  };
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [id, attachment] of sessions) {
      if (now - attachment.touched > options.sessionLeaseMs) void closeAttachment(id, attachment);
    }
    if (!closing && sessions.size === 0 && now - lastBusy > options.idleTimeoutMs) options.requestStop();
  }, Math.max(25, Math.min(1000, options.idleTimeoutMs, options.sessionLeaseMs) / 2));
  sweep.unref();
  app.use("*", async (context, next) => {
    const host = context.req.header("host");
    if (!host || !loopbackHostHeader(host) || !sameHttpOrigin(context.req.header("origin"), host)) {
      return context.json({ error: "central MCP request origin is not allowed" }, 403);
    }
    if (context.req.path !== CENTRAL_PING_PATH && context.req.header("authorization") !== `Bearer ${token}`) {
      context.header("www-authenticate", "Bearer");
      return context.json({ error: "central MCP authorization is required" }, 401);
    }
    await next();
  });
  app.get(CENTRAL_PING_PATH, context => context.json({ generation }));
  app.get("/_h2a-central/status", context => context.json({ generation, root, pid: process.pid, attachments: sessions.size, protocol: 2,
    eventLoopLagMs: { p99: lag.percentile(99) / 1e6, max: lag.max / 1e6 }
  }));
  app.post("/_h2a-central/stop", context => {
    options.requestStop();
    return context.json({ stopped: true, generation });
  });
  app.get("/_h2a-central/lease/:id", context => {
    const attachment = sessions.get(context.req.param("id"));
    if (!attachment) return context.json({ error: "unknown attachment" }, 404);
    attachment.touched = Date.now();
    const status = attachment.handle.mcp.callTool("h2a_identity_status", {}) as { content: Array<{ text: string }> };
    return context.json(JSON.parse(status.content[0].text));
  });
  app.all(new URL(endpoint).pathname, async context => {
    if (closing) return context.json({ error: "central MCP is stopping" }, 503);
    const sharedStore = store();
    if (!sharedStore) return context.json({ error: "central MCP is starting" }, 503);
    const requestedSessionId = context.req.header("mcp-session-id");
    let attachment = requestedSessionId ? sessions.get(requestedSessionId) : undefined;
    if (requestedSessionId && !attachment) return context.json({ error: "central MCP session expired" }, 404);
    if (!attachment) {
      if (context.req.method !== "POST") return context.json({ error: "initialize required" }, 400);
      let workspace = process.env.HOME ?? dirname(root);
      let captured;
      try {
        const encoded = context.req.header("x-h2a-attachment");
        captured = encoded ? parseCentralAttachment(encoded, root) : undefined;
        workspace = captured?.workspace ?? decodeURIComponent(context.req.header("x-h2a-workspace") ?? workspace);
        if (!isAbsolute(workspace) || !statSync(workspace).isDirectory()) throw new Error("workspace must be an existing absolute directory");
        workspace = realpathSync(workspace);
      } catch (error) { return context.json({ error: (error as Error).message }, 400); }
      let created: Attachment | undefined;
      let protocol: Server | undefined;
      const transport = new StreamableHTTPTransport({
        enableJsonResponse: true,
        sessionIdGenerator: randomUUID,
        onsessioninitialized: id => { if (created) sessions.set(id, created); },
        onsessionclosed: id => { const current = sessions.get(id); if (current) void closeAttachment(id, current); }
      });
      const handle = openCentralAttachment(root, workspace, sharedStore, captured, notification => {
        if (protocol) void protocol.notification(notification).catch(() => {});
      }, options.runExecutor);
      protocol = createCentralProtocolServer(handle.mcp);
      attachment = created = { transport, handle, touched: Date.now() };
      await protocol.connect(transport);
    }
    attachment.touched = Date.now();
    lastBusy = Date.now();
    let response;
    try { response = await attachment.transport.handleRequest(context); }
    catch (error) {
      if (!requestedSessionId) { await attachment.handle.close(); await attachment.transport.close(); }
      throw error;
    }
    // The server owns identity; the shim only retains the expected resume id.
    const statusResult = attachment.handle.mcp.callTool("h2a_identity_status", {}) as { content: Array<{ text: string }> };
    const status = JSON.parse(statusResult.content[0].text) as { state?: string; instance?: string };
    if (status.state === "identity_ready" && status.instance) context.header("x-h2a-instance", status.instance);
    if (!requestedSessionId && ![...sessions.values()].includes(attachment)) { await attachment.handle.close(); await attachment.transport.close(); }
    return response ?? context.body(null, 202);
  });
  return { app, async close() {
    closing = true;
    clearInterval(sweep);
    lag.disable();
    await Promise.all([...sessions.entries()].map(([id, attachment]) => closeAttachment(id, attachment)));
  } };
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
    const ping = await centralMcpPing(endpoint, CENTRAL_LIVENESS_TIMEOUT_MS);
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

async function closeHttpServer(httpServer: ReturnType<typeof serve>, closeAttachments: () => Promise<void>): Promise<void> {
  try {
    await closeAttachments();
    (httpServer as import("node:http").Server).closeAllConnections?.();
    await new Promise<void>((resolve, reject) => {
      httpServer.close((error?: Error) => error ? reject(error) : resolve());
    });
  } finally {
    await closeAttachments();
  }
}

export interface StartCentralMcpServerOptions extends CentralMcpPathsOptions {
  root: string;
  env?: Readonly<Record<string, string | undefined>>;
  idleTimeoutMs?: number;
  sessionLeaseMs?: number;
  runExecutor?: H2aRunExecutor;
  automatic?: boolean;
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
      closed: Promise<void>;
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
  if (!options.root || !isAbsolute(options.root)) {
    throw new Error(`central MCP root must be an absolute path (received "${options.root ?? ""}")`);
  }
  const root = options.root;
  const env = options.env ?? process.env;
  const explicitEndpoint = env[H2A_MCP_CENTRAL_ENDPOINT_ENV];
  let endpoint = explicitEndpoint ? parseCentralMcpEndpoint(explicitEndpoint) : "http://127.0.0.1:1/mcp";
  const paths: CentralMcpPathsOptions = options.runtimeBase ? { runtimeBase: options.runtimeBase } : {};
  const markerPath = centralMcpMarkerPath(paths);
  // Foreground serve is the explicit resume action. Auto-start checks this
  // protected inhibition before invoking us.
  if (options.automatic && existsSync(centralPausePath(paths))) throw new Error("central MCP was stopped by the operator");
  try { if (!options.automatic) unlinkSync(centralPausePath(paths)); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  let marker: CentralMcpMarker = { ...newMarker(endpoint, randomUUID()), root, protocol: 2 };
  const endpointUrl = new URL(endpoint);
  const hostname = endpointUrl.hostname.startsWith("[")
    ? endpointUrl.hostname.slice(1, -1)
    : endpointUrl.hostname;
  await loadRuntimeOwnership(); // Pin the runtime implementation before accepting attachments.
  let sharedStore: ReturnType<typeof createLocalStore> | undefined;
  let closePromise: Promise<void> | undefined;
  let finish!: () => void;
  const closed = new Promise<void>(resolve => { finish = resolve; });
  let stopServer: () => Promise<void> = async () => {};
  const application = createCentralApp(root, () => sharedStore, endpoint, marker.generation, marker.token, {
    idleTimeoutMs: options.idleTimeoutMs ?? 60_000,
    sessionLeaseMs: options.sessionLeaseMs ?? 90_000,
    ...(options.runExecutor ? { runExecutor: options.runExecutor } : {}),
    requestStop() { setImmediate(() => void stopServer()); }
  });
  let httpServer: ReturnType<typeof serve> | undefined;
  try {
    httpServer = serve({
      fetch: application.app.fetch,
      hostname,
      port: explicitEndpoint ? Number(endpointUrl.port) : 0
    });
    if (!httpServer.listening) await once(httpServer, "listening");
    if (!explicitEndpoint) {
      const address = httpServer.address();
      if (!address || typeof address === "string") throw new Error("central MCP listener has no TCP address");
      endpointUrl.port = String(address.port);
      endpoint = endpointUrl.href;
      marker = { ...marker, endpoint };
    }
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
      await application.close();
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
      options.beforeExclusiveMarkerPublish,
      !explicitEndpoint
    );
    if (claim.kind === "reused") {
      await closeHttpServer(httpServer, application.close);
      return {
        kind: "reused",
        endpoint: claim.marker.endpoint,
        generation: claim.marker.generation,
        markerPath
      };
    }
    // The existing launch-index readers are shared with stdio; qualify their
    // large-volume behavior before expanding central session budgets.
    sharedStore = createLocalStore({ root, initialize: false, alwaysEmitConsentBudget: true });
    await options.afterMarkerClaim?.();
  } catch (error) {
    try {
      await closeHttpServer(httpServer, application.close);
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

  stopServer = (): Promise<void> => {
    closePromise ??= (async () => {
      try {
        await closeHttpServer(httpServer!, application.close);
        try {
          const current = await readMarker(markerPath);
          if (current?.marker?.generation === marker.generation) unlinkSync(markerPath);
        } catch { /* Never remove a successor marker. */ }
      } finally { finish(); }
    })();
    return closePromise;
  };
  return {
    kind: "started", endpoint, generation: marker.generation, markerPath, closed,
    stop: stopServer
  };
}
