import { Participants } from "./handover/participants.js";
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
import { PassiveLiveSource } from "./handover/live-source.js";
import { AttachmentTransports } from "./handover/attachment-transports.js";
import { describeCatalogue } from "./handover/catalogue.js";
import { H2A_CLI_MCP_TOOL_DESCRIPTORS } from "./mcp/tools.js";
import { validate } from "./handover/formats.js";
import { recordGenerationEnd } from "./handover/generation-end.js";
import { EvidenceAcceptances, recordShimAcceptance } from "./handover/evidence.js";
import { shimEvidenceOptions } from "./handover/shim-evidence.js";
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

function createCentralProtocolServer(mcp: McpServer, participant: import('./handover/participants.js').AttachmentParticipant): Server {
  const server = new Server(
    { name: "@sentropic/h2a", version: currentCliVersion() },
    { capabilities: { tools: { listChanged: true } } }
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: mcp.listTools() }));
  server.setRequestHandler(
    CallToolRequestSchema,
    async (request): Promise<CallToolResult> => participant.call(async () => {
      for (const session of mcp.sessions.list()) mcp.sessions.markActivity(session.sessionId);
      return centralToolResult(mcp, request.params.name, request.params.arguments ?? {});
    })
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
  participants: () => Participants | undefined,
  options: { requestStop(): void; idleTimeoutMs: number; sessionLeaseMs: number; maxAttachments: number; precheck?: boolean; endpointPinned?: boolean; managedImage?: boolean; runExecutor?: H2aRunExecutor }
): { app: Hono; ready(): void; inventory(): { revision: number; transports: unknown[] }; drain(): { revision: number; calls: number; children: number; briefs: number; callbacks: number; effects: number }; close(): Promise<void> } {
  const app = new Hono();
  const lag = monitorEventLoopDelay({ resolution: 20 });
  lag.enable();
  app.use(new URL(endpoint).pathname, bodyLimit({ maxSize: 4 * 1024 * 1024 }));
  type Attachment = { participant: import("./handover/participants.js").AttachmentParticipant; transport: StreamableHTTPTransport; handle: CentralAttachmentHandle; touched: number; closing?: Promise<void>; logical?: any; disconnected?: boolean };
  const sessions = new Map<string, Attachment>();
  const transports = new AttachmentTransports({ generation, capacity: options.maxAttachments });
  const descriptor = describeCatalogue(JSON.parse(JSON.stringify(H2A_CLI_MCP_TOOL_DESCRIPTORS)));
  const evidenceAcceptances = new EvidenceAcceptances(256);
  const shimItem = (context: any) => {
    const id = context.req.param('id'), a = transports.attachments.get(id);
    if (!a || context.req.header('x-h2a-auth-attachment-id') !== id) throw new Error('attachment_context_mismatch');
    return a;
  };
  let lastBusy = Date.now();
  let ready = false;
  let closing = false;
  let activeCalls = 0;
  let drainRevision = 1;
  let inventoryRevision = 1;
  let launches = 0;
  let callbacks = 0;
  let unresolvedEffects = 0;
  const runExecutor = options.runExecutor;
  const closeAttachment = (id: string, attachment: Attachment): Promise<void> => {
    attachment.closing ??= (async () => {
      sessions.delete(id);
      if (attachment.logical) transports.close(attachment.logical.id);
      inventoryRevision++;
      await attachment.participant.close(() => attachment.handle.close());
      await attachment.transport.close();
      lastBusy = Date.now();
    })();
    return attachment.closing;
  };
  const sweep = setInterval(() => {
    if (!ready) return;
    const now = Date.now();
    const liveTransaction = administration()?.transaction()?.value;
    const pendingAttachments = new Set(participants()?.ledger.operations().filter((op: any) => op.state !== 'completed').map((op: any) => op.attachmentId));
    for (const [id, attachment] of sessions) {
      if (!(liveTransaction?.mode === 'live-transfer' && !['ABORTED', 'RETIRED'].includes(liveTransaction.state)) &&
          (attachment.disconnected || now - attachment.touched > options.sessionLeaseMs)) {
        const liveness = attachment.disconnected ? 'dead' : ownerLiveness({ processIdentity: attachment.logical?.context.shimProcessIdentity }, currentIdentity());
        if (attachment.logical) transports.detach(attachment.logical.id, liveness);
        attachment.transport.detachNotifications();
        const pending = pendingAttachments.has(attachment.participant.token.attachmentId);
        if (liveness === 'dead' && !pending) void closeAttachment(id, attachment);
      }
    }
    try { administration()?.expire(); administration()?.poll(); }
    catch (error) {
      if (administration()) administration()!.indeterminate = true;
      process.stderr.write(`h2a central: recovery_blocked: ${(error as Error).message}\n`);
    }
    const transaction = administration()?.transaction()?.value;
    const pending = transaction && !["ABORTED", "READY"].includes(transaction.state);
    if (!closing && activeCalls === 0 && launches === 0 && callbacks === 0 && unresolvedEffects === 0 && sessions.size === 0 &&
      participants()?.drain().complete && administration()?.admissionsOpen() && !pending && now - lastBusy > options.idleTimeoutMs) options.requestStop();
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
  app.get("/_h2a-central/status", context => context.json({ generation, root, pid: process.pid, attachments: sessions.size, attachmentLimit: options.maxAttachments, protocol: 2,
    transports: [...transports.attachments.values()].map(a => ({ attachmentId: a.id, transportEpoch: a.transportEpoch, state: a.state })),
    eventLoopLagMs: { p99: lag.percentile(99) / 1e6, max: lag.max / 1e6 }
  }));
  app.get("/_h2a-central/catalogue", context => context.json({ ...descriptor, revision: 1 }));
  app.get('/_h2a-central/shim/:id/status', context => {
    try {
      const a = shimItem(context), encoded = context.req.header('x-h2a-attachment');
      if (!encoded || Number(context.req.header('x-h2a-auth-transport-epoch')) !== a.transportEpoch) throw new Error('transport_fenced');
      const { resume, expectedInstance, ...immutable } = parseCentralAttachment(encoded, root);
      if (digest(immutable) !== a.contextDigest) throw new Error('attachment_context_mismatch');
      // This read grants no lease, resume, activation or business admission.
      return context.json({ attachmentId: a.id, generation, transportEpoch: a.transportEpoch, expectedInstance: a.expectedInstance });
    } catch (error) { return context.json({ error: (error as Error).message }, 409); }
  });
  app.post('/_h2a-central/shim/:id/register', async context => {
    try {
      if (!administration()?.admissionsOpen()) throw new Error('admission_closed');
      const a = shimItem(context), advertisement = await context.req.json();
      validate('shimInventoryItem', advertisement);
      if (advertisement.attachmentId !== a.id || digest(advertisement.shimProcessIdentity) !== digest(a.context.shimProcessIdentity) ||
          advertisement.servedDescriptorDigest !== descriptor.descriptorDigest || advertisement.servedContractDigest !== descriptor.contractDigest) throw new Error('shim_inventory_mismatch');
      if (digest(a.advertisement ?? null) !== digest(advertisement)) { a.advertisement = advertisement; transports.revision++; }
      a.challengeNonce ??= randomUUID();
      a.sourceView = { generation, buildId: administration()!.marker.buildId, profileId: advertisement.clientQualification.profileId,
        descriptorDigest: advertisement.servedDescriptorDigest, contractDigest: advertisement.servedContractDigest };
      a.activation.participant.advertisement = advertisement;
      return context.json({ challengeNonce: a.challengeNonce, sourceView: a.sourceView, inventoryRevision: transports.revision });
    } catch (error) { return context.json({ error: (error as Error).message }, 409); }
  });
  // A delegated external controller offers; .7 never initiates a transaction.
  app.post('/_h2a-central/shim/:id/offer', async context => {
    try {
      const a = transports.attachments.get(context.req.param('id'));
      if (!a?.advertisement) throw new Error('shim_inventory_missing');
      const admin = administration()!, live = admin.options.liveSource;
      if (!live) throw new Error('live_authorization_unavailable');
      const offer = await context.req.json();
      if (a.offer && digest(a.offer) === digest(offer)) return context.json({ proofDigest: a.offerReceipt.proofDigest });
      const options = shimEvidenceOptions(offer, { marker: admin.marker, markerPath: live.markerPath,
        rootKey: live.rootKey, installation: live.installation, sourceView: a.sourceView, attachmentId: a.id,
        inventoryRevision: transports.revision, challengeNonce: a.challengeNonce });
      const receipt = evidenceAcceptances.accept(offer.proof, options);
      if (a.offer && digest(a.offer) !== digest(offer)) throw new Error('shim_offer_conflict');
      a.offer = offer; a.offerReceipt = receipt;
      return context.json({ proofDigest: receipt.proofDigest });
    } catch (error) { return context.json({ error: (error as Error).message }, 409); }
  });
  app.get('/_h2a-central/shim/:id/offer', context => {
    try { const a = shimItem(context); return context.json({ offer: a.offer ?? null, challengeNonce: a.challengeNonce,
      sourceView: a.sourceView, inventoryRevision: transports.revision, acceptance: a.acceptance ?? null }); }
    catch (error) { return context.json({ error: (error as Error).message }, 409); }
  });
  app.post('/_h2a-central/shim/:id/ack', async context => {
    try {
      const a = shimItem(context), receipt = await context.req.json();
      if (!a.offer || digest(receipt) !== digest(a.offerReceipt)) throw new Error('shim_ack_mismatch');
      if (a.acceptance && digest(a.acceptance) !== digest(receipt)) throw new Error('shim_ack_conflict');
      const live = administration()!.options.liveSource;
      if (!live) throw new Error('live_authorization_unavailable');
      recordShimAcceptance(administration()!.marker, live.rootKey, receipt);
      a.acceptance = receipt; a.activation.participant.shimAcceptance = receipt;
      return context.json(receipt);
    } catch (error) { return context.json({ error: (error as Error).message }, 409); }
  });
  app.post("/_h2a-central/resume", async context => {
    try {
      if (!administration()?.admissionsOpen()) throw new Error('admission_closed');
      const body = validate('resume', await context.req.json());
      const a = transports.attachments.get(body.attachmentId);
      const encoded = context.req.header('x-h2a-attachment');
      const captured = encoded ? parseCentralAttachment(encoded, root) : a?.context;
      if (!a || !captured || context.req.header('x-h2a-auth-attachment-id') !== a.id) throw new Error('attachment_context_mismatch');
      const liveness = ownerLiveness({ processIdentity: a.context.shimProcessIdentity }, currentIdentity());
      const result = transports.resume(body, captured, liveness);
      a.resumeResults ??= new Map();
      if (a.resumeResults.has(body.resumeAttemptId)) return context.json(a.resumeResults.get(body.resumeAttemptId));
      const attachment = a.activation as Attachment;
      attachment.transport.detachNotifications(); attachment.touched = Date.now();
      const reply = { ...result, sessionId: attachment.transport.sessionId,
        protocolVersion: attachment.participant.downstreamProtocol,
        notificationGap: result.notificationGap && (!a.notifications?.length || body.lastAcceptedNotificationSequence < a.notifications[0].sequence - 1),
        notifications: (a.notifications ?? []).filter((n: any) => n.sequence > body.lastAcceptedNotificationSequence).map((n: any) => n.message) };
      a.resumeResultBytes ??= 0;
      if (a.resumeResultBytes + Buffer.byteLength(JSON.stringify(reply)) > 1024 * 1024) {
        reply.notifications = []; reply.notificationGap = a.sequence > body.lastAcceptedNotificationSequence;
      }
      a.resumeResultBytes += Buffer.byteLength(JSON.stringify(reply));
      a.resumeResults.set(body.resumeAttemptId, reply);
      return context.json(reply);
    } catch (error) { return context.json({ error: (error as Error).message }, 409); }
  });
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
    try { if (attachment.logical) transports.admit(attachment.logical.id, Number(context.req.header('x-h2a-auth-transport-epoch'))); }
    catch { return context.json({ error: 'transport_fenced' }, 409); }
    attachment.touched = Date.now();
    const status = attachment.handle.mcp.callTool("h2a_identity_status", {}) as { content: Array<{ text: string }> };
    const value = JSON.parse(status.content[0].text);
    if (attachment.logical && value.state === 'identity_ready') attachment.logical.expectedInstance = value.instance;
    return context.json(value);
  });
  app.all(new URL(endpoint).pathname, async context => {
    activeCalls++; drainRevision++;
    try {
    if (options.precheck) return context.json({ error: "precheck_admission_closed" }, 409);
    if (closing) return context.json({ error: "central MCP is stopping" }, 503);
    if (!administration()?.admissionsOpen()) {
      let control = context.req.method === "GET";
      if (context.req.method === "POST") {
        try {
          const message = await context.req.json();
          const frames = Array.isArray(message) ? message : [message];
          control = frames.length > 0 && frames.every(frame => frame?.method === 'notifications/cancelled' && !('id' in frame));
        } catch { control = false; }
      }
      if (!control) { const tx = administration()?.transaction()?.value;
        return context.json({ error: "admission_closed", accepted: false, execution: "not_started",
          ...(tx ? { handoverId: tx.handoverId, transactionEpoch: tx.transactionEpoch } : {}) }, 409); }
    }
    const sharedStore = store();
    if (!sharedStore) return context.json({ error: "central MCP is starting" }, 503);
    const requestedSessionId = context.req.header("mcp-session-id");
    let attachment = requestedSessionId ? sessions.get(requestedSessionId) : undefined;
    if (requestedSessionId && !attachment) return context.json({ error: "central MCP session expired" }, 404);
    if (attachment?.logical) {
      try {
        const authenticatedId = context.req.header('x-h2a-auth-attachment-id');
        if (authenticatedId !== 'control' && authenticatedId !== attachment.logical.id) throw new Error('attachment_context_mismatch');
        const message = context.req.method === 'POST' ? await context.req.json().catch(() => null) : null;
        // Cancel already admitted work even after transport fencing.
        if (context.req.method === 'DELETE' && Number(context.req.header('x-h2a-auth-transport-epoch')) !== attachment.logical.transportEpoch) throw new Error('transport_fenced');
        if (message?.method !== 'notifications/cancelled' && context.req.method !== 'DELETE') transports.admit(attachment.logical.id, Number(context.req.header('x-h2a-auth-transport-epoch')));
      } catch (error) { return context.json({ error: (error as Error).message }, 409); }
    }
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
        const message = await context.req.json();
        if (message?.method !== 'initialize' || message.id === undefined) throw new Error('initialize required');
      } catch (error) { return context.json({ error: (error as Error).message }, 400); }
      const logicalId = captured?.id ?? context.req.header('x-h2a-attachment-id') ?? randomUUID();
      if (transports.attachments.has(logicalId)) return context.json({ error: 'attachment_exists_resume_required' }, 409);
      if (transports.attachments.size >= transports.capacity) return context.json({ error: 'attachment_capacity' }, 429);
      let created: Attachment | undefined;
      let protocol: Server | undefined;
      const transport = new StreamableHTTPTransport({
        enableJsonResponse: true,
        sessionIdGenerator: randomUUID,
        onsessioninitialized: id => { if (created) { sessions.set(id, created); inventoryRevision++; } },
        onsessionclosed: id => { const current = sessions.get(id); if (current) void closeAttachment(id, current); }
      });
      const participant = participants()!.attach(logicalId, { workspace, ...(captured ? { attachment: captured } : {}) });
      participant.initialized = false;
      const handle = participant.runOwner(() => openCentralAttachment(root, workspace, sharedStore, captured, async notification => {
        const logical = created?.logical;
        if (logical) {
          logical.sequence++;
          notification = { ...notification, params: { ...notification.params, _meta: { ...notification.params?._meta, h2aNotificationSequence: logical.sequence } } };
          const size = Buffer.byteLength(JSON.stringify(notification));
          logical.notifications ??= []; logical.notificationBytes ??= 0;
          logical.notifications.push({ sequence: logical.sequence, message: notification, size }); logical.notificationBytes += size;
          while (logical.notificationBytes > 3 * 1024 * 1024 || logical.notifications.length > 256) logical.notificationBytes -= logical.notifications.shift().size;
          if (logical.state !== 'attached') return;
        }
        if (protocol) {
          callbacks++; drainRevision++;
          const operation = participant.begin('callback');
          try { await protocol.notification(notification); participant.finish(operation, { delivered: true }); }
          catch (error) { participant.finish(operation, { state: 'unknown', error: String(error) }, true); throw error; }
          finally { callbacks--; drainRevision++; }
        }
      }, runExecutor, participant));
      protocol = createCentralProtocolServer(handle.mcp, participant);
      attachment = created = { participant, transport, handle, touched: Date.now() };
      attachment.logical = transports.attach(logicalId, captured ?? { id: logicalId, workspace }, () => attachment!);
      try { await protocol.connect(transport); }
      catch (error) { await participant.close(() => handle.close()); await transport.close(); throw error; }
    }
    attachment.touched = Date.now();
    if (context.req.method === 'DELETE') {
      attachment.disconnected = true;
      if (attachment.logical) transports.detach(attachment.logical.id, 'dead');
      attachment.transport.detachNotifications();
      const pending = participants()?.ledger.operations().some((op: any) => op.attachmentId === attachment!.participant.token.attachmentId && op.state !== 'completed');
      if (!pending) await closeAttachment(requestedSessionId!, attachment);
      return context.body(null, 200);
    }
    lastBusy = Date.now();
    let response;
    try { response = await attachment.transport.handleRequest(context); }
    catch (error) {
      if (!requestedSessionId) { await attachment.participant.close(() => attachment.handle.close()); await attachment.transport.close(); }
      throw error;
    }
    // The server owns identity; the shim only retains the expected resume id.
    const statusResult = attachment.handle.mcp.callTool("h2a_identity_status", {}) as { content: Array<{ text: string }> };
    const status = JSON.parse(statusResult.content[0].text) as { state?: string; instance?: string };
    if (status.state === "identity_ready" && status.instance) {
      context.header("x-h2a-instance", status.instance);
      if (attachment.logical) attachment.logical.expectedInstance = status.instance;
    }
    if (!requestedSessionId && response?.ok) {
      try {
        const initialized = await response.clone().json() as { result?: { protocolVersion?: string } };
        if (initialized.result?.protocolVersion) {
          attachment.participant.downstreamProtocol = initialized.result.protocolVersion;
          attachment.participant.initialized = true;
        }
      } catch { /* Without a negotiated version, freeze remains refused. */ }
    }
    if (!requestedSessionId && ![...sessions.values()].includes(attachment)) { await attachment.participant.close(() => attachment.handle.close()); await attachment.transport.close(); }
    return response ?? context.body(null, 202);
    } finally { activeCalls--; drainRevision++; }
  });
  return { app, ready() { lastBusy = Date.now(); ready = true; }, inventory: () => ({ ...(participants()?.inventory() ?? { schemaVersion: 1, shims: [], transports: [], operations: [], quarantines: [], launches: [], writerRestrictions: ["precheck_admission_closed"] }),
    shims: [...transports.attachments.values()].flatMap(a => a.advertisement ? [a.advertisement] : []),
    transports: [...transports.attachments.values()].map(a => ({ attachmentId: a.id, transportEpoch: a.transportEpoch, state: a.state,
      ownershipEpoch: a.activation.participant.token.ownershipEpoch, ownerGeneration: generation,
      retiredOperations: participants()?.ledger.operations().filter((o: any) => o.attachmentId === a.id && o.state !== 'completed').map((o: any) => o.operationId) ?? [] })),
    quarantines: [...transports.attachments.values()].filter(a => a.state === 'quarantined').map(a => a.id), revision: transports.revision }),
    drain: () => {
      const durable = participants()?.drain() ?? { revision: 1, calls: 0, children: 0, briefs: 0, callbacks: 0, effects: 0 };
      return { ...durable, revision: drainRevision + durable.revision, calls: activeCalls + durable.calls, callbacks: callbacks + durable.callbacks };
    },
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
  /** Trusted admission-closure verifier; absent means continuity is refused. */
  writerProof?: { evidenceDigest: string; verify(context: unknown): string };
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
  let participants: Participants | undefined;
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
      if (pause?.value.paused && !options.automatic) replaceState(pausePath, { ...pause.value, revision: pause.value.revision + 1, paused: false }, "pause", pause);
      let endpoint = explicitEndpoint ? parseCentralMcpEndpoint(explicitEndpoint) : "http://127.0.0.1:1/mcp";
      const endpointUrl = new URL(endpoint);
      marker = { schemaVersion: 2, service: "h2a-mcp-central", namespaceId: authority.domain.namespaceId,
        stateDirectory, prefixId: authority.domain.prefixId, endpoint,
        endpointMode: explicitEndpoint ? "fixed" : "discovered", generation: randomUUID(), publicationEpoch,
        predecessorGeneration: options.successor ? plan.reservation.source.generation : null, root, uid: uid(), pid: process.pid, startedAt: new Date().toISOString(),
        processIdentity: identity, packageVersion: plan.selection?.packageVersion ?? currentCliVersion(), buildId: plan.selection?.buildId ?? "npm-unmanaged",
        manifestDigest: plan.selection?.manifestDigest ?? digest({ packageVersion: currentCliVersion(), entry: physicalPrefix }),
        protocol: 2, handoverProtocol: 1, handoverCapabilities: { managedImage: Boolean(installation),
          endpointPinned: Boolean(explicitEndpoint), restrictions: [...(installation ? [] : ["unmanaged_image"]), "store_writer_set_unknown"],
          primitives: ["describe", "inventory", "reserve", "barrier", "renew", "freeze", "checkpoint", "drain-status", "abort", "retire", "commit-stop", "stop-status"],
          attachTransfer: false, liveCoordinator: false }, mcpProtocolVersions: ["2025-06-18"],
        descriptorDigest: digest({ tools: [] }), contractDigest: digest({ tools: [] }), state: "ready",
        token: randomUUID(), authKeyReference: authority.authKeyReference };
      application = createCentralApp(root, () => sharedStore, endpoint, marker.generation, () => administration, () => participants, {
        precheck: options.precheck,
        endpointPinned: Boolean(explicitEndpoint), managedImage: Boolean(installation),
        idleTimeoutMs: options.idleTimeoutMs ?? 60_000, sessionLeaseMs: options.sessionLeaseMs ?? 90_000,
        maxAttachments: plan.manifest?.maxAttachments ?? 256,
        ...(options.runExecutor ? { runExecutor: options.runExecutor } : {}),
        requestStop() { setImmediate(() => void stopServer()); }
      });
      const auth = new ConnectionAuthentication(marker, authority.rootKey);
      authentication = auth;
      (auth as any).ready = false;
      httpServer = createAuthenticatedServer(auth, application.app.fetch);
      httpServer.listen(explicitEndpoint ? Number(endpointUrl.port) : 0, endpointUrl.hostname.replace(/^\[|\]$/g, ""));
      if (!httpServer.listening) await once(httpServer, "listening");
      const address = httpServer.address();
      if (!address || typeof address === "string") throw new Error("listener_address_unknown");
      endpointUrl.port = String(address.port); marker.endpoint = endpoint = endpointUrl.href;
      // Writer and catalogue are ready before durable marker publication.
      mkdirSync(root, { recursive: true, mode: 0o700 });
      if (!options.precheck) {
        participants = new Participants({ root, directory: stateDirectory, marker, writerProof: options.writerProof, authenticationKey: authority.rootKey });
        // The admission preclaim has already proved any previous owner dead.
        // A committed old writer gate is reopened only by this new authority.
        if (participants.writerControl().gate !== 'OPEN') {
          const { updateWriterControl } = await import('./handover/mutation.js');
          updateWriterControl(root, { gate: 'OPEN', handoverId: null });
        }
      }
      sharedStore = createLocalStore({ root, initialize: false, readOnly: Boolean(options.precheck), alwaysEmitConsentBudget: true });
      const catalogServer = createMcpServer({ root, store: sharedStore });
      const catalogue = JSON.parse(JSON.stringify(catalogServer.listTools())) as ReturnType<McpServer["listTools"]>;
      catalogServer.notifications.stop();
      const described = describeCatalogue(catalogue);
      marker.descriptorDigest = described.descriptorDigest;
      marker.contractDigest = described.contractDigest;
      marker.mcpProtocolVersions = described.protocolVersions;
      const nowControl = readState(join(stateDirectory, "component-control.json"), "componentControl");
      if (nowControl) replaceState(join(stateDirectory, "component-control.json"), { ...nowControl.value, revision: nowControl.value.revision + 1,
        sourceGeneration: marker.generation, ownerIdentity: identity, ownerState: "ACTIVE",
        operatorStopCommitted: false, operatorStopped: false }, "componentControl", nowControl);
      const liveSource = installation && participants ? new PassiveLiveSource({ installation, marker, markerPath, rootKey: authority.rootKey, participants }) : undefined;
      administration = new ColdAdministration({ directory: stateDirectory, marker, inventory: application.inventory, drain: application.drain,
        ...(liveSource ? { liveSource } : {}),
        ...(installation ? { pinDirectory: join(installation.managedRoot, "state", "pins") } : {}),
        verifyAuthority: (_operation: string, tx: any) => {
          if (!claim) throw new Error("readiness_unavailable");
          if (!liveSource?.verifyAuthority(tx)) compareMarker(markerPath, claim);
        },
        ...(participants ? {
          withMutationLock: (fn: () => unknown) => participants!.registry.withLock(fn),
          reconcileParticipants: (tx: any) => participants!.reconcileTransaction(tx),
          assertEligible: () => participants!.assertEligible(),
          barrier: (tx: any) => participants!.barrier(tx.handoverId),
          abort: (tx: any) => participants!.abort(tx.handoverId),
          freeze: (_payload: any, tx: any) => participants!.freeze(tx.handoverId),
          checkpoint: (_payload: any, tx: any) => participants!.checkpoint(tx.handoverId),
          commit: () => participants!.commit()
        } : {}),
        ...(installation && !options.precheck ? {
          authorizeTarget: (target: any, epoch: number) => verifyTarget(installation, target, epoch),
          verifyEntry: (phase: string) => checkManagedEntry(installation, managedEntry, phase),
          verifyPrecheck: (evidence: string, target: any) => verifyPrecheckEvidence(stateDirectory, evidence, target,
            resolveSelectedEntry(installation).selection.selectionEpoch)
        } : {}),
        close() { setImmediate(() => void stopServer()); } });
      if (participants) participants.registry.onIndeterminate = () => { administration!.indeterminate = true; };
      await options.beforeExclusiveMarkerPublish?.();
      await options.afterMarkerClaim?.();
      return marker;
    }, (published: NonNullable<ReturnType<typeof readMarkerObservation>>) => {
      claim = published;
      if (options.successor && plan.transactionPath) readySuccessor(plan.transactionPath, options.successor, identity);
      markStartupReady(stateDirectory, identity);
      application!.ready();
      (authentication as any).ready = true;
    });
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
        const drained = application!.drain();
        if (['calls', 'children', 'briefs', 'callbacks', 'effects'].every(k => drained[k as keyof typeof drained] === 0)) recordGenerationEnd(authentication!.marker, authority.rootKey);
        const retiring = administration?.transaction()?.value;
        if (claim && !(retiring?.mode === 'live-transfer' && retiring.state === 'RETIRED')) removeMarker(markerPath, claim);
        const closeOwnControl = () => {
          const stoppedControl = administration!.control()!;
          if (stoppedControl.value.sourceGeneration !== marker.generation ||
              digest(stoppedControl.value.ownerIdentity) !== digest(identity)) return;
          replaceState(join(stateDirectory, "component-control.json"), {
            ...stoppedControl.value, revision: stoppedControl.value.revision + 1, ownerState: "CLOSED",
            operatorStopped: stoppedControl.value.operatorStopCommitted }, "componentControl", stoppedControl);
        };
        if (participants) participants.registry.withLock(closeOwnControl);
        else closeOwnControl();
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
