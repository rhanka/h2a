/**
 * Reuse stdio's identity/presence/wake activation behind a per-attachment
 * HTTP transport, with tool dispatch routed through the composed Sentropic
 * registry plan (round 2, lazy on first call so the light-shim static graph
 * stays mesh-free). The route only admits or denies: execution stays in
 * this attachment's server, so identity, workspace, store and participant
 * fencing are unchanged from H1.
 */
import { PassThrough, Writable } from "node:stream";
import type { Notification } from "@modelcontextprotocol/sdk/types.js";
import { runMcpServe } from "../cli.js";
import type { createLocalStore } from "./local-files/index.js";
import { createMcpServer, type McpCallContext, type McpServer } from "./mcp/server.js";
import { createUiRenderModule, type UiRenderModule } from "./mcp/ui-render/index.js";
import type { H2aRunExecutor } from "./mcp/agent-launch.js";
import { CENTRAL_ATTACHMENT_ENV, buildSessionAdmissionEvidence, SESSION_ADMISSION_CHANNEL_BINDINGS, type CentralMcpAttachment, type SessionAdmissionEvidenceV1, type SessionAdmissionIdentity } from "./mcp-central-context.js";
import type { AttachmentParticipant } from "./handover/participants.js";
import type { ComposeDaemonOptions } from "../registry/sentropic-daemon.js";

export type CentralAttachmentHandle = { mcp: McpServer; ready?: Promise<void>; close(): Promise<void> };

export type { SessionAdmissionEvidenceV1 } from "./mcp-central-context.js";

/**
 * The verified transport material the central holds for one call. It rides
 * ALONGSIDE the H3 record (the sibling `transport` member of the resolver
 * input), never inside the frozen 11-key wire shape.
 */
export interface CentralAdmissionTransport {
  /** Verified per-request transport MAC (admitted request proof). */
  readonly transportMac: string;
  /** Channel binding from the closed set (attachment: `stdio_host_managed_verified`). */
  readonly channelBinding: string;
  /** The admitted MCP session id of this attachment. */
  readonly sessionId: string;
}

/** A per-call admission: the frozen H3 record plus its lateral transport material. */
export interface CentralAdmission {
  readonly evidence: SessionAdmissionEvidenceV1;
  readonly transport: CentralAdmissionTransport;
}

/**
 * The runtime material the assembler turns into a `CentralAdmission`. The
 * `transportEpoch` is the attachment's fenced logical counter (a positive
 * integer, formatted into the frozen `epoch:YYYYMMDD:NNNN` token from the
 * admission instant) or a preformed epoch token/decimal string.
 */
export interface CentralAdmissionMaterial {
  /** Verified attachment id (participant token binding). */
  readonly attachmentId: string;
  /** Verified per-request transport MAC (admitted request proof). */
  readonly transportMac: string;
  /** Fenced transport epoch of the attachment's logical transport. */
  readonly transportEpoch: number | string;
  /** The admitted MCP session id of this attachment. */
  readonly sessionId: string;
  /** The supported central host that admitted the attachment. */
  readonly centralHost: string;
  /** Channel binding from the closed set (attachment: `stdio_host_managed_verified`). */
  readonly channelBinding: string;
  /** Signed (MAC-verified) request id this dispatch rides on. */
  readonly signedRequestId: string;
  /** Identity correlation from the binding store; no evidence without it. */
  readonly identity?: SessionAdmissionIdentity;
  /** Admission instant (canonical ISO); defaults to the evidence build time. */
  readonly admittedAt?: string;
}

const TRANSPORT_MAC_PATTERN = /^[0-9a-f]{64}$/;

/** Format the fenced logical counter into the frozen epoch token (`epoch:YYYYMMDD:NNNN`). */
function formatTransportEpoch(counter: number, admittedAt: string): string {
  if (!Number.isInteger(counter) || counter < 1) throw new Error("invalid transport epoch counter");
  const date = admittedAt.slice(0, 10).replace(/-/g, "");
  return `epoch:${date}:${String(counter).padStart(4, "0")}`;
}

/**
 * Total H3 assembler: binds the verified material into a `CentralAdmission`
 * (the frozen 11-key evidence plus the lateral transport material), or
 * returns undefined when the material is absent, partial or inconsistent
 * (fail-closed — never a partial record, never a throw).
 */
export function sessionAdmissionEvidence(material: CentralAdmissionMaterial | undefined): CentralAdmission | undefined {
  if (!material?.identity) return undefined;
  try {
    if (typeof material.transportMac !== "string" || !TRANSPORT_MAC_PATTERN.test(material.transportMac)) return undefined;
    if (typeof material.channelBinding !== "string" || !(SESSION_ADMISSION_CHANNEL_BINDINGS as readonly string[]).includes(material.channelBinding)) return undefined;
    if (typeof material.sessionId !== "string" || !material.sessionId) return undefined;
    const admittedAt = material.admittedAt ?? new Date().toISOString();
    const transportEpoch = typeof material.transportEpoch === "number"
      ? formatTransportEpoch(material.transportEpoch, admittedAt)
      : material.transportEpoch;
    const evidence = buildSessionAdmissionEvidence({
      attachmentRef: material.attachmentId,
      transportEpoch,
      centralHost: material.centralHost as SessionAdmissionEvidenceV1["centralHost"],
      agentUuid: material.identity.agentUuid,
      instanceId: material.identity.instanceId,
      launchName: material.identity.launchName,
      admittedAt,
      signedRequestId: material.signedRequestId
    });
    return { evidence, transport: { transportMac: material.transportMac, channelBinding: material.channelBinding, sessionId: material.sessionId } };
  } catch {
    return undefined;
  }
}

/**
 * Install the Sentropic-registry dispatch route on an attachment server.
 * The registry module (and its mesh packages) loads LAZILY on the first
 * tool call: the light-shim fixture tree ships no nested `node_modules`,
 * so a static import here would break every shim child at startup even
 * though the shim path never dispatches. The raw dispatch is captured
 * synchronously at install time, so the later wrapper can never recurse
 * into itself.
 */
function installRegistryDispatch(mcp: McpServer, options: { root: string; workspaceRoot: string } & Pick<ComposeDaemonOptions, "lock" | "memory" | "admission">): void {
  const rawCallTool = mcp.callTool.bind(mcp) as McpServer["callTool"];
  let delegate: McpServer["callTool"] | undefined;
  let pending: Promise<McpServer["callTool"]> | undefined;
  const stub = ((name: string, args: Record<string, unknown> | undefined, context?: McpCallContext) => {
    // H1 internals read `h2a_identity_status` SYNCHRONOUSLY
    // (`handover/participants.js identity()`, freeze/checkpoint path): the
    // raw call is sync for the status tool, while any plan route is async by
    // construction. The status read is side-effect-free, identity-scoped and
    // admitted in every view, so it keeps the exact historical sync bytes;
    // every other tool routes through the composed plan below. The MCP call
    // context (per-connection SEP-1865 ui capability) travels with every
    // routed tool so session-scoped tools keep their connection identity.
    if (name === "h2a_identity_status") return rawCallTool(name, args, context);
    return (async () => {
      pending ??= (async () => {
        const { wrapMcpServerWithDaemonRegistry } = await import("../registry/sentropic-daemon.js");
        return wrapMcpServerWithDaemonRegistry({ callTool: rawCallTool }, options).callTool;
      })();
      delegate ??= await pending;
      return delegate(name, args, context);
    })();
  }) as McpServer["callTool"];
  mcp.callTool = stub;
}

export function openCentralAttachment(
  root: string,
  workspace: string,
  store: ReturnType<typeof createLocalStore>,
  context: CentralMcpAttachment | undefined,
  notify: (notification: Notification) => Promise<void>,
  runExecutor?: H2aRunExecutor,
  participant?: AttachmentParticipant,
  registry?: Pick<ComposeDaemonOptions, "lock" | "memory" | "admission">,
  attachmentOptions?: { env?: Readonly<Record<string, string | undefined>> }
): CentralAttachmentHandle {
  if (!context) {
    // Direct HTTP sessions serve the ui:// resource surface from the vendored
    // DS build when it verifies (h2a spec §7.2: a load failure NEVER takes the
    // central server down — it serves without ui:// resources, noted on stderr
    // only). The central environment (theme, locale, watermark gate) comes
    // from the server options, defaulting to the live process environment.
    let uiRender: UiRenderModule | undefined;
    try {
      uiRender = createUiRenderModule(attachmentOptions?.env !== undefined
        ? { env: { ...attachmentOptions.env } }
        : undefined);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`h2a central attachment: ui-render assets unavailable (ui:// resources disabled): ${message}\n`);
    }
    const mcp = createMcpServer({ root, workspaceRoot: workspace, store, ...(participant ? { participant } : {}), ...(runExecutor ? { runExecutor } : {}), ...(uiRender ? { uiRender } : {}) });
    participant?.bind(mcp);
    const ready = registry ? configureSelectedRegistry(mcp, root, workspace, registry) : undefined;
    if (!registry) installRegistryDispatch(mcp, { root, workspaceRoot: workspace });
    return { mcp, ready, async close() {
      mcp.notifications.stop();
      if (participant?.transferred()) mcp.sessions.suspend();
      else mcp.sessions.closeAll("closed");
    } };
  }
  const input = new PassThrough();
  const controller = new AbortController();
  let mcp: McpServer | undefined;
  const output = new Writable({ write(chunk: Buffer, _encoding, done) {
    try {
      const deliveries: Promise<void>[] = [];
      for (const line of chunk.toString("utf8").split("\n").filter(Boolean)) {
        const message = JSON.parse(line) as Notification;
        if (message.method) deliveries.push(notify(message));
      }
      void Promise.all(deliveries).then(() => done(), done);
    } catch (error) { done(error as Error); }
  } });
  const daemonEnvironment = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    !(CENTRAL_ATTACHMENT_ENV as readonly string[]).includes(key) &&
    !key.startsWith("H2A_NATIVE_") && !key.startsWith("H2A_MCP_READY_")
  ));
  const serving = runMcpServe({ ...context.flags, root, host: context.host }, {
    stdin: input, stdout: output, stderr: process.stderr,
    cwd: () => workspace,
    env: { ...daemonEnvironment, ...context.env, H2A_ROOT: root },
    sharedStore: store,
    ...(participant ? { participant } : {}),
    centralAttachment: true,
    reclaimOnly: context.resume,
    expectedInstance: context.expectedInstance,
    signal: controller.signal,
    onServer(server) { mcp = server; participant?.bind(server); },
    ...(runExecutor ? { runExecutor } : {})
  });
  if (!mcp) { controller.abort(); input.end(); throw new Error("central attachment activation failed"); }
  const ready = registry ? configureSelectedRegistry(mcp, root, workspace, registry) : undefined;
  if (!registry) installRegistryDispatch(mcp, { root, workspaceRoot: workspace });
  return { mcp, ready, async close() {
    controller.abort();
    input.end();
    await serving;
    output.destroy();
  } };
}

async function configureSelectedRegistry(mcp: McpServer, root: string, workspaceRoot: string,
  registry: Pick<ComposeDaemonOptions, "lock" | "memory" | "admission">): Promise<void> {
  const { configureMcpServerRegistry } = await import("../registry/sentropic-daemon.js");
  await configureMcpServerRegistry(mcp, { view: "combined", root, workspaceRoot, ...registry });
}
