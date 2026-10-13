/**
 * Machine-local central MCP server. Election is independent of endpoint and
 * workspace within the current private UID runtime namespace.
 */
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { admitGeneration, prepareAuthority, currentIdentity, canonicalRootPath, readMarkerObservation, compareMarker, removeMarker, ownerLiveness } from "./handover/admission.js";
import { readState, replaceState, publishState } from "./handover/state.js";
import { digest } from "./handover/wire.js";
import { ConnectionAuthentication } from "./handover/authentication.js";
import { createAuthenticatedServer } from "./handover/authenticated-http.js";
import { ColdAdministration } from "./handover/administration.js";
import { installationForEntry, physicalPrefixForEntry, starterPlan, resolveSelectedEntry } from "./handover/selection.js";
import { checkStartupReservation, markStartupReady } from "./handover/launch.js";
import { recordSuccessor, readySuccessor } from "./handover/successor.js";
import { verifyTarget, verifyPrecheckEvidence } from "./handover/precheck.js";
import { captureManagedEntry, checkManagedEntry } from "./handover/entry.js";
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
import { dirname, isAbsolute, join, resolve, relative } from "node:path";
import { realpathSync, statSync } from "node:fs";

import { StreamableHTTPTransport } from "./mcp/transport/streamable-http.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ReadResourceRequestSchema,
  type CallToolResult,
  type JSONRPCMessage,
  type ListResourcesResult,
  type ReadResourceResult
} from "@modelcontextprotocol/sdk/types.js";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";

import { currentCliVersion } from "./upgrade/index.js";
import {
  createMcpServer,
  isMcpTransportResult,
  type McpCallContext,
  type McpServer
} from "./mcp/server.js";
import { boundCallToolResult } from "./mcp/frame-budget.js";
import { createUiRenderModule, type UiRenderModule } from "./mcp/ui-render/index.js";
import {
  negotiateUiExtension,
  serverUiExtensionCapability
} from "./mcp/ui-render/negotiation.js";
import { UnknownResourceError, type UiExtensionCapability } from "./mcp/ui-render/types.js";
import { createLocalStore } from "./local-files/index.js";
import { openCentralAttachment, type CentralAttachmentHandle } from "./mcp-central-attachment.js";
import { parseCentralAttachment } from "./mcp-central-context.js";
import { executeH2aRun, type H2aRunExecutor } from "./mcp/agent-launch.js";
import { centralPausePath } from "./mcp-central-operator.js";

import { H2A_MCP_CENTRAL_ENDPOINT_ENV, centralMcpMarkerPath, expectedMode, isLoopbackHostname, markerDirectory, parseCentralMcpEndpoint, runtimeBase, uid, type CentralMcpMarker, type CentralMcpPathsOptions } from "./mcp-central-discovery.js";
export { H2A_MCP_CENTRAL_ENV, H2A_MCP_CENTRAL_ENDPOINT_ENV, centralMcpEnabled, centralMcpClientEndpoint, centralMcpMarkerPath, parseCentralMcpEndpoint, readCentralMcpMarker } from "./mcp-central-discovery.js";
export type { CentralMcpMarker, CentralMcpPathsOptions, CentralMcpClientEndpoint } from "./mcp-central-discovery.js";
export { bridgeCentralMcpStdio } from "./mcp-central-client.js";
export type { CentralMcpStdioBridgeOptions } from "./mcp-central-client.js";
const CENTRAL_PING_PATH = "/_h2a-central/ping";
const CENTRAL_LIVENESS_TIMEOUT_MS = 1_500;

export type CentralMcpPingResult = Readonly<{ kind: "generation"; generation: string }> | Readonly<{ kind: "dead" }> | Readonly<{ kind: "ambiguous" }>;
export async function centralMcpPing(
  endpoint: string,
  timeoutMs = CENTRAL_LIVENESS_TIMEOUT_MS
): Promise<CentralMcpPingResult> {
  const canonicalEndpoint = parseCentralMcpEndpoint(endpoint);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(new URL(CENTRAL_PING_PATH, canonicalEndpoint), { signal: controller.signal });
    if (!response.ok) return { kind: "ambiguous" };
    try {
      const body = await response.json() as { generation?: unknown };
      return typeof body.generation === "string" && body.generation.length > 0
        ? { kind: "generation", generation: body.generation }
        : { kind: "ambiguous" };
    } catch {
      // An HTTP peer answered but did not provide a registration generation.
      return { kind: "ambiguous" };
    }
  } catch (error) {
    return { kind: "ambiguous" }; // HTTP never proves process death.
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

async function centralToolResult(
  server: McpServer,
  name: string,
  args: Record<string, unknown>,
  context: McpCallContext
): Promise<CallToolResult> {
  const result = await server.callTool(name, args, context);
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
  // L3 (json-render): the central server advertises tools.listChanged, the
  // resource surface and the SEP-1865 ui extension (h2a spec §2.1.3).
  const server = new Server(
    { name: "@sentropic/h2a", version: currentCliVersion() },
    {
      capabilities: {
        tools: { listChanged: true },
        resources: {},
        extensions: { "io.modelcontextprotocol/ui": serverUiExtensionCapability }
      }
    }
  );
  // L3: one SDK Server per transport → one negotiation per HTTP session:
  // getClientCapabilities() reflects THIS session's initialize params.
  const negotiated = (): UiExtensionCapability =>
    negotiateUiExtension({ capabilities: server.getClientCapabilities() });
  // Stable identity for this transport; capability stays current after initialize.
  const connection: McpCallContext = { get uiCapability() { return negotiated(); } };
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: mcp.listTools() }));
  server.setRequestHandler(ListResourcesRequestSchema, async (): Promise<ListResourcesResult> => ({
    resources: mcp.listResources(connection).resources
  }));
  server.setRequestHandler(ReadResourceRequestSchema, async (request): Promise<ReadResourceResult> => {
    try {
      // Shape-compatible with the SDK's TextResourceContents modulo readonly
      // arrays (the handler-side descriptors are deeply readonly).
      return mcp.readResource(request.params.uri, connection) as ReadResourceResult;
    } catch (error) {
      // An unknown resource URI is a typed -32002 refusal (h2a spec §3.3).
      if (error instanceof UnknownResourceError) {
        throw new McpError(-32002, error.message);
      }
      throw error;
    }
  });
  server.setRequestHandler(
    CallToolRequestSchema,
    async (request): Promise<CallToolResult> => {
      for (const session of mcp.sessions.list()) mcp.sessions.markActivity(session.sessionId);
      return centralToolResult(mcp, request.params.name, request.params.arguments ?? {}, connection);
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
  administration: () => ColdAdministration | undefined,
  options: { requestStop(): void; idleTimeoutMs: number; sessionLeaseMs: number; precheck?: boolean; endpointPinned?: boolean; managedImage?: boolean; runExecutor?: H2aRunExecutor }
): { app: Hono; inventory(): { revision: number; transports: unknown[] }; drain(): { revision: number; calls: number; children: number; briefs: number; callbacks: number; effects: number }; close(): Promise<void> } {
  const app = new Hono();
  const lag = monitorEventLoopDelay({ resolution: 20 });
  lag.enable();
  app.use(new URL(endpoint).pathname, bodyLimit({ maxSize: 4 * 1024 * 1024 }));
  type Attachment = { transport: StreamableHTTPTransport; handle: CentralAttachmentHandle; touched: number; closing?: Promise<void> };
  const sessions = new Map<string, Attachment>();
  let lastBusy = Date.now();
  let closing = false;
  let activeCalls = 0;
  let drainRevision = 1;
  let inventoryRevision = 1;
  let launches = 0;
  let callbacks = 0;
  let unresolvedEffects = 0;
  const runExecutor: H2aRunExecutor = request => {
    launches++; drainRevision++;
    const finish = (value: unknown) => {
      launches--; drainRevision++;
      if (!value || ["unknown", "launching", "cleanup-failed"].includes((value as { state?: string }).state ?? "")) unresolvedEffects++;
      return value as Record<string, unknown>;
    };
    try {
      const value = (options.runExecutor ?? executeH2aRun)(request);
      return value instanceof Promise ? value.then(finish, error => { finish({ state: "unknown" }); throw error; }) : finish(value);
    } catch (error) { finish({ state: "unknown" }); throw error; }
  };
  const closeAttachment = (id: string, attachment: Attachment): Promise<void> => {
    attachment.closing ??= (async () => {
      sessions.delete(id);
      inventoryRevision++;
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
    try { administration()?.expire(); administration()?.poll(); }
    catch (error) {
      if (administration()) administration()!.indeterminate = true;
      process.stderr.write(`h2a central: recovery_blocked: ${(error as Error).message}\n`);
    }
    const transaction = administration()?.transaction()?.value;
    const pending = transaction && !["ABORTED", "READY"].includes(transaction.state);
    if (!closing && activeCalls === 0 && launches === 0 && callbacks === 0 && unresolvedEffects === 0 && sessions.size === 0 &&
      administration()?.admissionsOpen() && !pending && now - lastBusy > options.idleTimeoutMs) options.requestStop();
  }, Math.max(25, Math.min(1000, options.idleTimeoutMs, options.sessionLeaseMs) / 2));
  sweep.unref();
  app.use("*", async (context, next) => {
    const host = context.req.header("host");
    if (!host || !loopbackHostHeader(host) || !sameHttpOrigin(context.req.header("origin"), host)) {
      return context.json({ error: "central MCP request origin is not allowed" }, 403);
    }
    await next();
  });
  app.get(CENTRAL_PING_PATH, context => context.json({ generation }));
  app.get("/_h2a-central/status", context => context.json({ generation, root, pid: process.pid, attachments: sessions.size, protocol: 2,
    eventLoopLagMs: { p99: lag.percentile(99) / 1e6, max: lag.max / 1e6 }
  }));
  app.post("/_h2a-central/stop", context => {
    const admin = administration();
    if (!admin) return context.json({ error: "central MCP is starting" }, 503);
    return context.json(admin.operatorStop());
  });
  app.post("/_h2a-central/admin/:operation", async context => {
    const admin = administration();
    if (!admin) return context.json({ error: "central MCP is starting" }, 503);
    try {
      const { step, payload, coordinator } = await context.req.json();
      return context.json(admin.execute(context.req.param("operation"), step, payload, coordinator));
    } catch (error) { return context.json({ error: (error as Error).message }, 409); }
  });
  app.get("/_h2a-central/lease/:id", context => {
    const attachment = sessions.get(context.req.param("id"));
    if (!attachment) return context.json({ error: "unknown attachment" }, 404);
    attachment.touched = Date.now();
    const status = attachment.handle.mcp.callTool("h2a_identity_status", {}) as { content: Array<{ text: string }> };
    return context.json(JSON.parse(status.content[0].text));
  });
  app.all(new URL(endpoint).pathname, async context => {
    activeCalls++; drainRevision++;
    try {
    if (options.precheck) return context.json({ error: "precheck_admission_closed" }, 409);
    if (closing) return context.json({ error: "central MCP is stopping" }, 503);
    if (!administration()?.admissionsOpen()) {
      const control = context.req.method !== "POST" || /notifications\/cancelled/.test(await context.req.text());
      if (!control) return context.json({ error: "admission_closed", accepted: false, execution: "not_started" }, 409);
    }
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
        onsessioninitialized: id => { if (created) { sessions.set(id, created); inventoryRevision++; } },
        onsessionclosed: id => { const current = sessions.get(id); if (current) void closeAttachment(id, current); }
      });
      const handle = openCentralAttachment(root, workspace, sharedStore, captured, notification => {
        if (protocol) {
          callbacks++; drainRevision++;
          void protocol.notification(notification).catch(() => {}).finally(() => { callbacks--; drainRevision++; });
        }
      }, runExecutor);
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
    } finally { activeCalls--; drainRevision++; }
  });
  return { app, inventory: () => ({ schemaVersion: 1, revision: inventoryRevision, shims: [],
      transports: [...sessions.keys()].map(sessionId => ({ sessionId, attachmentProtocol: "unqualified" })),
      operations: [{ activeCalls, callbacks, launches, unresolvedEffects }], quarantines: [], launches: [],
      endpointPinned: Boolean(options.endpointPinned), managedImage: Boolean(options.managedImage),
      writerRestrictions: sessions.size ? ["participant_checkpoint_unqualified"] : [] }),
    drain: () => ({ revision: drainRevision, calls: activeCalls, children: launches, briefs: launches, callbacks, effects: unresolvedEffects }),
    async close() {
    closing = true;
    clearInterval(sweep);
    lag.disable();
    await Promise.all([...sessions.entries()].map(([id, attachment]) => closeAttachment(id, attachment)));
  } };
}

export interface StartCentralMcpServerOptions extends CentralMcpPathsOptions {
  root: string;
  precheck?: boolean;
  successor?: { handoverId: string; transactionEpoch: number; attempt: number };
  /** Verified physical installation prefix; explicit laboratory installation seam. */
  physicalPrefix?: string;
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
  const root = canonicalRootPath(options.root);
  const env = options.env ?? process.env;
  const explicitEndpoint = env[H2A_MCP_CENTRAL_ENDPOINT_ENV];
  const paths: CentralMcpPathsOptions = options.runtimeBase ? { runtimeBase: options.runtimeBase } : {};
  const markerPath = options.precheck ? join(runtimeBase(paths), "h2a-mcp-central", "marker.json") : centralMcpMarkerPath(paths);
  const directory = dirname(markerPath);
  const identity = currentIdentity();
  const entrypoint = fileURLToPath(new URL("../bin.js", import.meta.url));
  const installation = options.precheck ? undefined : installationForEntry(entrypoint);
  const managedEntry = installation ? captureManagedEntry(installation) : undefined;
  const physicalPrefix = options.physicalPrefix ?? installation?.canonicalPrefix ?? physicalPrefixForEntry(entrypoint) ?? fileURLToPath(new URL("../../", import.meta.url));
  const authority = await prepareAuthority({ directory, root, physicalPrefix, frame: identity });
  const stateDirectory = authority.stateDirectory;
  const pausePath = join(stateDirectory, "operator-stop.json");
  const pause = readState(pausePath, "pause");
  if (pause?.value.paused && options.automatic) throw new Error("deferred_paused");
  const current = readMarkerObservation(markerPath);
  if (current) {
    const liveness = ownerLiveness(current.value, identity);
    if (liveness === "alive") {
      if (current.value.root !== root || current.value.protocol !== 2) throw new Error("owner_alive_incompatible");
      return { kind: "reused", endpoint: current.value.endpoint, generation: current.value.generation, markerPath };
    }
    if (liveness !== "dead") throw new Error("owner_liveness_unknown");
  }
  let sharedStore: ReturnType<typeof createLocalStore> | undefined;
  let administration: ColdAdministration | undefined;
  let authentication: ConnectionAuthentication | undefined;
  let marker: any;
  let httpServer: ReturnType<typeof createAuthenticatedServer> | undefined;
  let stopServer: () => Promise<void> = async () => {};
  let finish!: () => void;
  const closed = new Promise<void>(resolve => { finish = resolve; });
  let application: ReturnType<typeof createCentralApp> | undefined;
  let claim: ReturnType<typeof readMarkerObservation>;
  let plan: ReturnType<typeof starterPlan>;
  try {
    claim = await admitGeneration(authority, async (publicationEpoch: { bootId: string; counter: number }) => {
      plan = starterPlan({ installation, directory: stateDirectory, kind: options.automatic ? "auto-serve" : "explicit-serve", fallbackEntry: entrypoint,
        expectedReservation: options.successor });
      if (realpathSync(plan.entrypoint) !== realpathSync(entrypoint) &&
        !plan.manifest?.files.some((file: any) => file.path === relative(plan.imageRoot!, realpathSync(entrypoint)) && file.type === "file")) throw new Error("selected_entry_required");
      checkStartupReservation(stateDirectory, plan.entrypoint, identity);
      // An explicit serve may lift pause only before any committed transaction.
      const control = readState(join(stateDirectory, "component-control.json"), "componentControl");
      if (control?.value.activeTransaction) {
        const tx = readState(join(stateDirectory, control.value.activeTransaction), "componentTransaction");
        if (tx && !["ABORTED", "READY"].includes(tx.value.state)) {
          if (!options.successor || tx.value.state !== "STARTING" ||
            options.successor.attempt !== tx.value.successorReservation.attempts ||
            digest(tx.value.successorReservation.candidateIdentity) !== digest(identity)) throw new Error("successor_reservation_required");
          if (pause?.value.paused) throw new Error("deferred_paused");
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
    // L3: load and verify the vendored DS elements build before serving. An
    // integrity_mismatch (or any load failure) NEVER takes the central server
    // down (§7.2): it serves without the ui:// resource surface, noted on
    // stderr only.
    let uiRender: UiRenderModule | undefined;
    try {
      uiRender = createUiRenderModule({ env: env as Record<string, string | undefined> });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`h2a central MCP: ui-render assets unavailable (ui:// resources disabled): ${message}\n`);
    }
    mcp = createMcpServer({
      root: options.root,
      workspaceRoot: process.cwd(),
      ...(uiRender ? { uiRender } : {})
    });
    await options.afterMarkerClaim?.();
  } catch (error) {
    if (httpServer) { httpServer.closeAllConnections(); await new Promise<void>(resolve => httpServer!.close(() => resolve())); }
    await application?.close();
    if (claim) removeMarker(markerPath, claim);
    throw error;
  }
  let stopping: Promise<void> | undefined;
  stopServer = () => {
    stopping ??= (async () => {
      try {
        await application!.close(); httpServer!.closeAllConnections();
        await new Promise<void>((resolve, reject) => httpServer!.close(error => error ? reject(error) : resolve()));
        if (claim) removeMarker(markerPath, claim);
        const stoppedControl = administration!.control()!;
        replaceState(join(stateDirectory, "component-control.json"), {
          ...stoppedControl.value, revision: stoppedControl.value.revision + 1, ownerState: "CLOSED",
          operatorStopped: stoppedControl.value.operatorStopCommitted }, "componentControl", stoppedControl);
        const transaction = administration?.transaction();
        if (transaction?.value.state === "STOP_COMMITTED") {
          const control = administration!.control()!.value;
          replaceState(join(stateDirectory, control.activeTransaction!), { ...transaction.value,
            revision: transaction.value.revision + 1, state: "STOPPED" }, "componentTransaction", transaction);
        }
      } finally { finish(); }
    })();
    return stopping;
  };
  return { kind: "started", endpoint: marker.endpoint, generation: marker.generation, markerPath, closed, stop: stopServer };
}
