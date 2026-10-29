/**
 * H2a daemon-side local composition over the published Sentropic registry.
 *
 * H2a acceptance (SPEC §5 lot H2a): the daemon composes REAL coordination and
 * Track loaded definitions through `createMcpRegistry` from
 * `@sentropic/cluster-mesh/mcp/registry` (mesh 0.22.4 + platform 0.4.0), and
 * the private preparation compiler (`./registry.js` `createRegistry`) is no
 * longer on the service-dispatch preparation path. Coordination-only,
 * Track-only and combined views execute their real handlers; excluded calls
 * are denied (`unknown_tool`) before any handler runs.
 *
 * Format mapping (h2a private → published API):
 * - h2a `RegistryEntry` (descriptors.ts: `sentropic.registry-entry/v1`,
 *   contract 1.1.4, kind/id/entryVersion/publisher/compatibility/parameters/
 *   bindings/assets/mcp) is publisher metadata for the h2a-side lifecycle. The
 *   published kernel takes `AppMcpProviderManifest` (platform manifest:
 *   appId/providerId/version/displayName + closed CapabilityTool entries).
 *   Mapping: entry.id → manifest.providerId, entry.entryVersion →
 *   manifest.version, publisher.packageName → manifest.appId; tool surfaces
 *   come from the real descriptors (`H2A_CLI_MCP_TOOL_DESCRIPTORS` minus the
 *   Track read names for coordination, `TRACK_READ_TOOL_DESCRIPTORS` for
 *   Track) with closed CapabilityTool defaults (empty scopes/claims,
 *   `redactionClass: 'none'`, per-surface mutability, idempotency not
 *   required, all gates false, `outputSchema: { type: 'object' }`).
 * - h2a `LazyLocalDefinition` (`{ descriptor, manifest, schemas,
 *   load: async () => { manifest, handlers: Map<string, fn> } }`) differs
 *   from published `LazyDefinition` (`{ kind: 'lazy', manifest,
 *   parameterSchema, requiredPorts, provenance,
 *   load: sync () => { adapter, handlers, toolValues } }`): async vs sync
 *   loader, executable handler map vs handler-binding metadata. This module
 *   uses published `LoadedDefinition` (everything in memory, no loader gap):
 *   executable behavior lives in `adapter.invokeTool`, which delegates to the
 *   real in-process server (`createMcpServer(...).callTool`); `handlers` /
 *   `toolValues` carry `{ handlerId, capabilityRef, configSchema }` /
 *   `{ handlerId, values }` metadata per tool.
 * - h2a private `bindings`/`compatibility` (named attachment contracts, host
 *   features, protocol versions) map to the kernel's `requiredPorts: []` +
 *   `parameterSchema: { properties: {} }` for local daemon composition: the
 *   daemon IS the provider process, so no attachment port is required here.
 *   Authenticated attachment bindings and lock selection stay H2b/S3 scope;
 *   this module makes no bridge/native acceptance claim.
 *
 * Round 2: the shared central service dispatches through this plan. The
 * attachment hook (`../runtime/mcp-central-attachment.js`
 * `wrapMcpServerWithDaemonRegistry`) binds the per-attachment server behind
 * the composed views, so context, identity and fencing stay with the H1
 * attachment while selection/denial come from the Sentropic plan.
 */

import { createClusterMeshModules } from "@sentropic/cluster-mesh";
import { createMcpRegistry } from "@sentropic/cluster-mesh/mcp/registry";
import type {
  CompiledMcpRegistry,
  LoadedDefinition,
  RegistryDefinition
} from "@sentropic/mcp-platform/registry";
import { computeManifestDigest } from "@sentropic/mcp-platform/tool-configuration";
import { authorizeDispatch } from "@sentropic/mcp-platform/transport/dispatch";
import { TRACK_READ_TOOL_DESCRIPTORS } from "@sentropic/track/mcp";
import { createMcpServer, isMcpTransportResult, type McpServer } from "../runtime/mcp/server.js";
import { H2A_CLI_MCP_TOOL_DESCRIPTORS } from "../runtime/mcp/tools.js";
import { validateBridgeLock, type BridgeLock } from "./bridge-lock.js";
import { missingMemoryBuiltin, MEMORY_PROVIDER_ID, MEMORY_TOOL_NAMES, type MemoryProviderRegistration } from "./memory-provider.js";

/** Pinned to the published facade; asserted by the H2a daemon tests. */
export const USES_SENTROPIC_FACADE = true;

export type DaemonView = "coordination" | "track" | "combined";

export interface ComposeDaemonOptions {
  view: DaemonView;
  /** Filesystem root for the backing local-files store (tests: mkdtemp). */
  root: string;
  workspaceRoot?: string;
  lock?: BridgeLock;
  memory?: MemoryProviderRegistration;
  /** Existing attachment/participant supplied by the host, never tool args. */
  attachment?: unknown;
}

export interface DaemonDispatchOutput {
  text: string;
  hint?: string;
  transport: unknown;
}

export interface DaemonDispatchResult {
  ok: boolean;
  output: DaemonDispatchOutput;
  providerId: string;
  capabilityName: string;
}

type Manifest = LoadedDefinition["manifest"];
type Adapter = LoadedDefinition["adapter"];
type InvokeRequest = Parameters<Adapter["invokeTool"]>[0];

function fail(code: string, message: string): never {
  throw Object.assign(new Error(`${code}: ${message}`), { code });
}

interface FlatTool {
  name: string;
  description: string;
  inputSchema: unknown;
}

function flatTools(value: unknown): FlatTool[] {
  const list = value as ReadonlyArray<{ name: unknown; description: unknown; inputSchema: unknown }>;
  return [...list].map((tool) => ({
    name: String(tool.name),
    description: typeof tool.description === "string" ? tool.description : String(tool.description ?? ""),
    inputSchema: tool.inputSchema
  }));
}

const TRACK_NAMES = new Set<string>(flatTools(TRACK_READ_TOOL_DESCRIPTORS).map((tool) => tool.name));

function coordinationTools(): FlatTool[] {
  return flatTools(H2A_CLI_MCP_TOOL_DESCRIPTORS).filter((tool) => !TRACK_NAMES.has(tool.name));
}

function trackTools(): FlatTool[] {
  return flatTools(TRACK_READ_TOOL_DESCRIPTORS);
}

function toCapabilityTool(tool: FlatTool, readOnly: boolean): Manifest["tools"][number] {
  return {
    kind: "tool",
    name: tool.name,
    description: tool.description,
    requiredScopes: [],
    requiredClaims: [],
    inputSchema: tool.inputSchema,
    outputSchema: { type: "object" },
    redactionClass: "none",
    mutability: readOnly ? "read-only" : "state-transition",
    mutatesExternalSystem: readOnly ? false : true,
    idempotency: { required: false },
    gates: {
      requiresElicitation: false,
      requiresHumanConfirmation: false,
      requiresPrincipalGate: false
    }
  } as Manifest["tools"][number];
}

function buildManifest(
  providerId: string,
  appId: string,
  displayName: string,
  tools: FlatTool[],
  readOnly: boolean
): Manifest {
  return {
    appId,
    providerId,
    version: "1.0.0",
    displayName,
    resources: [],
    tools: tools.map((tool) => toCapabilityTool(tool, readOnly)),
    prompts: [],
    authz: { requiredClaims: [], scopes: [], tenantResolution: "connector-instance" },
    audit: { eventKinds: [] },
    durability: {}
  } as Manifest;
}

/**
 * The attachment's own dispatch, captured BEFORE the registry wrapper is
 * installed. The adapter delegates execution to it, so identity guards,
 * participant fencing, store and workspace stay with the H1 attachment;
 * only selection and denial come from the composed plan. Passing the bound
 * function (not the server object) keeps the wrapper from recursing into
 * itself once `server.callTool` is replaced.
 */
export type DaemonRawCallTool = (
  name: string,
  args: Record<string, unknown>
) => unknown | Promise<unknown>;

function contentText(raw: unknown): { text: string; hint?: string } | null {
  if (raw === null || typeof raw !== "object" || !("content" in raw)) return null;
  const content = (raw as { content: unknown }).content;
  if (!Array.isArray(content) || content.length === 0) return null;
  const first = (content[0] as { text?: unknown }).text;
  if (typeof first !== "string") return null;
  const second = (content[1] as { text?: unknown } | undefined)?.text;
  return { text: first, ...(typeof second === "string" ? { hint: second } : {}) };
}

function buildAdapter(manifest: Manifest, connectorId: string, rawCallTool: DaemonRawCallTool): Adapter {
  return {
    appId: manifest.appId,
    connectorId,
    manifest,
    resolveTenant: async () => ({
      principalRef: "h2a-daemon-local",
      tenantRef: "h2a-daemon-local",
      connectorInstanceId: "h2a-daemon-local"
    }),
    listCapabilities: async () => [...manifest.tools],
    invokeTool: async (req: InvokeRequest) => {
      const name = req.capabilityRef;
      const owned = manifest.tools.some((tool) => tool.name === name);
      if (!owned) {
        return {
          ok: false,
          auditId: "h2a-daemon-local",
          redactionClass: "none",
          error: { code: "unknown_tool", message: `unknown tool ${name}`, retriable: false }
        };
      }
      let raw: unknown;
      try {
        raw = await rawCallTool(name, (req.input ?? {}) as Record<string, unknown>);
      } catch (error) {
        return {
          ok: false,
          auditId: "h2a-daemon-local",
          redactionClass: "none",
          error: { code: "handler_failed", message: error instanceof Error ? error.message : String(error), retriable: false }
        };
      }
      if (
        raw !== null && typeof raw === "object" && "isError" in raw &&
        (raw as { isError?: unknown }).isError === true
      ) {
        const parsed = contentText(raw);
        return {
          ok: false,
          auditId: "h2a-daemon-local",
          redactionClass: "none",
          error: { code: "handler_error", message: parsed?.text ?? JSON.stringify(raw).slice(0, 500), retriable: false }
        };
      }
      // Coordination handlers also report business refusals as
      // `McpErrorResult { error: string }` (no `content`/`isError` envelope):
      // `h2a_send` without a signing identity, `h2a_register_instance`
      // without a registration, `h2a_session_open` without args. Those are
      // failures, never `ok:true` payloads.
      if (
        raw !== null && typeof raw === "object" && !isMcpTransportResult(raw) &&
        typeof (raw as { error?: unknown }).error === "string"
      ) {
        return {
          ok: false,
          auditId: "h2a-daemon-local",
          redactionClass: "none",
          error: { code: "handler_error", message: (raw as { error: string }).error, retriable: false }
        };
      }
      const parsed = contentText(raw);
      if (parsed) {
        return {
          ok: true,
          output: { ...parsed, transport: raw },
          auditId: "h2a-daemon-local",
          redactionClass: "none"
        };
      }
      return {
        ok: true,
        output: { text: JSON.stringify(raw), transport: raw },
        auditId: "h2a-daemon-local",
        redactionClass: "none"
      };
    },
    readResource: async () => ({
      ok: false,
      auditId: "h2a-daemon-local",
      redactionClass: "none",
      error: { code: "unknown_tool", message: "no resources in the daemon local composition", retriable: false }
    }),
    validateSecrets: async () => []
  } as Adapter;
}

function buildLoadedDefinition(manifest: Manifest, connectorId: string, rawCallTool: DaemonRawCallTool): LoadedDefinition {
  const handlers: Record<string, { handlerId: string; capabilityRef: string; configSchema: unknown }> = {};
  const toolValues: Record<string, { handlerId: string; values: Record<string, unknown> }> = {};
  for (const tool of manifest.tools) {
    // The kernel requires a top-level object configSchema per handler
    // binding; `{ type: 'object' }` carries no per-tool policy (local daemon
    // composition configures nothing per tool — values stay `{}`).
    handlers[tool.name] = { handlerId: tool.name, capabilityRef: tool.name, configSchema: { type: "object" } };
    toolValues[tool.name] = { handlerId: tool.name, values: {} };
  }
  return {
    manifest,
    adapter: buildAdapter(manifest, connectorId, rawCallTool),
    parameterSchema: { properties: {} },
    handlers,
    requiredPorts: [],
    provenance: {
      approvalRef: "h2a-h2a-daemon-local",
      revision: "1",
      manifestDigest: "",
      reviewedBy: ["h2a"]
    },
    toolValues
  };
}

const LOCAL_PRINCIPAL = { sub: "h2a-daemon-local", clientId: "h2a-daemon", scopes: [], claims: [] };

export interface ComposedDaemonRegistry {
  facade: ReturnType<typeof createMcpRegistry>;
  compiled: CompiledMcpRegistry;
  catalog: () => Array<{ providerId: string; version: string; capabilities: string[] }>;
  toolNames: () => string[];
  tools: () => ReturnType<McpServer["listTools"]>;
  dispatch: (toolName: string, args: Record<string, unknown>) => Promise<DaemonDispatchResult>;
}

/**
 * Compose one view around an ALREADY-BOUND server dispatch (the attachment's
 * own `callTool`, captured before wrapping). Execution stays in that server
 * — store, workspace, identity, participant fencing — while the compiled
 * Sentropic plan decides selection and denial.
 */
export async function composeDaemonRegistryForServer(
  rawCallTool: DaemonRawCallTool,
  options: ComposeDaemonOptions
): Promise<ComposedDaemonRegistry> {
  const lock = options.lock ? validateBridgeLock(structuredClone(options.lock), options.memory?.entry) : undefined;
  const ids = lock?.selection.map(selected => selected.id);
  const wantCoordination = ids ? ids.includes("sentropic.h2a") : options.view === "coordination" || options.view === "combined";
  const wantTrack = ids ? ids.includes("sentropic.track") : options.view === "track" || options.view === "combined";
  const memory = ids?.includes(MEMORY_PROVIDER_ID) ? options.memory ?? missingMemoryBuiltin() : undefined;
  if (memory && (!memory.builtin || memory.builtin.providerId !== MEMORY_PROVIDER_ID)) missingMemoryBuiltin();

  const definitions: LoadedDefinition[] = [];
  if (wantCoordination) {
    definitions.push(
      buildLoadedDefinition(
        buildManifest("sentropic.h2a", "@sentropic/h2a", "h2a coordination", coordinationTools(), false),
        "h2a-coordination",
        rawCallTool
      )
    );
  }
  if (wantTrack) {
    definitions.push(
      buildLoadedDefinition(
        buildManifest("sentropic.track", "@sentropic/track", "track reads", trackTools(), true),
        "track-read",
        rawCallTool
      )
    );
  }
  const modules = createClusterMeshModules();
  let memoryDefinition: LoadedDefinition | undefined;
  const compatibility: Record<string, { manifestDigest: string }> = {};
  const facade = createMcpRegistry({ modules, builtins: memory ? [{
    ...memory.builtin,
    load: async () => {
      const definition = await memory.builtin.load();
      if ("kind" in definition || definition.manifest.providerId !== MEMORY_PROVIDER_ID ||
          definition.manifest.version !== memory.builtin.version ||
          definition.manifest.version !== memory.entry.entryVersion ||
          definition.manifest.tools.length !== MEMORY_TOOL_NAMES.length ||
          new Set(definition.manifest.tools.map(tool => tool.name)).size !== MEMORY_TOOL_NAMES.length ||
          definition.manifest.tools.some(tool => !MEMORY_TOOL_NAMES.includes(tool.name)) ||
          memory.builtin.capabilities.length !== MEMORY_TOOL_NAMES.length ||
          new Set(memory.builtin.capabilities).size !== MEMORY_TOOL_NAMES.length ||
          memory.builtin.capabilities.some(name => !MEMORY_TOOL_NAMES.includes(name))) {
        fail("invalid_entry", "cluster-mesh memory builtin does not match its locked six-tool contract");
      }
      memoryDefinition = definition;
      compatibility[MEMORY_PROVIDER_ID] = { manifestDigest: computeManifestDigest(definition.manifest) };
      return definition;
    }
  }] : [] });
  const registered: LoadedDefinition[] = [];
  for (const definition of definitions) {
    const registrable: RegistryDefinition = definition;
    facade.register(registrable);
    registered.push(definition);
  }
  const selected = [...registered.map((definition) => definition.manifest.providerId), ...(memory ? [MEMORY_PROVIDER_ID] : [])];
  facade.select(selected);
  for (const providerId of selected) facade.configure(providerId, providerId === MEMORY_PROVIDER_ID ? lock!.entries[providerId].config : {});

  for (const definition of registered) {
    compatibility[definition.manifest.providerId] = {
      manifestDigest: computeManifestDigest(definition.manifest)
    };
  }
  const result = await facade.compile({ bindings: {}, compatibility });
  if (!result.ok) {
    const first = result.diagnostics[0];
    fail("invalid_entry", `daemon compile refused: ${first?.code ?? "unknown"} ${first?.message ?? ""} @ ${first?.path ?? ""}`);
  }
  const compiled: CompiledMcpRegistry = facade.compiled() ??
    fail("invalid_entry", "daemon compile reported ok but publishes no plan");

  const adapters = new Map<string, Adapter>();
  for (const definition of registered) adapters.set(definition.manifest.providerId, definition.adapter);

  async function dispatch(toolName: string, args: Record<string, unknown>): Promise<DaemonDispatchResult> {
    const resolved = compiled.resolveTool(toolName);
    if (!resolved) fail("unknown_tool", `unknown tool ${toolName} for the active selection`);
    if (resolved.providerId === MEMORY_PROVIDER_ID) {
      // The mesh adapter owns invocation context, authorization, confirmation
      // and audit. Forward the bound attachment; never invent a principal.
      if (!memoryDefinition) missingMemoryBuiltin();
      const invoked = await memoryDefinition.adapter.invokeTool({
        capabilityRef: resolved.capabilityName, input: args ?? {}, ctx: options.attachment,
        ...(typeof args?.idempotency_key === "string" ? { idempotencyKey: args.idempotency_key } : {})
      } as InvokeRequest);
      if (typeof invoked !== "string" && !invoked.ok) fail(invoked.error?.code ?? "handler_error", invoked.error?.message ?? "memory builtin refused");
      const raw = typeof invoked === "string" ? invoked : invoked.output;
      return { ok: !(raw as { isError?: boolean })?.isError,
        output: { ...(contentText(raw) ?? { text: JSON.stringify(raw) }), transport: raw },
        providerId: resolved.providerId, capabilityName: resolved.capabilityName };
    }
    const decision = authorizeDispatch({ registry: compiled, toolName, principal: LOCAL_PRINCIPAL });
    if (!decision.allowed) fail(decision.code, `denied tool ${toolName}: ${decision.code}`);
    const adapter = adapters.get(decision.providerId);
    if (!adapter) fail("unknown_tool", `no adapter for provider ${decision.providerId}`);
    const invoked = await adapter.invokeTool({
      capabilityRef: decision.capabilityName,
      input: args ?? {},
      ctx: {
        requestId: `daemon:${toolName}`,
        correlationId: `daemon:${toolName}`,
        auditId: "h2a-daemon-local",
        principal: {
          sub: LOCAL_PRINCIPAL.sub,
          claims: {},
          scopes: [],
          tenantRef: "h2a-daemon-local",
          workspaceRef: options.workspaceRoot ?? options.root,
          authTime: new Date(0).toISOString()
        },
        surface: "backend",
        session: { mcpSessionId: "h2a-daemon-local" },
        tenantRef: "h2a-daemon-local",
        workspaceRef: options.workspaceRoot ?? options.root,
        connectorInstanceId: "h2a-daemon-local",
        consentRefs: [],
        grantRefs: [],
        getSecret: async () => fail("missing_binding", "daemon local composition carries no secrets"),
        connectorConfig: {},
        audit: { emit: async () => {} },
        logger: undefined
      },
      idempotencyKey: `${toolName}:daemon`
    } as unknown as InvokeRequest);
    if (typeof invoked === "string") {
      return {
        ok: true,
        output: { text: invoked, transport: invoked },
        providerId: decision.providerId,
        capabilityName: decision.capabilityName
      };
    }
    if (!invoked.ok) {
      const code = invoked.error?.code === "unknown_tool" ? "unknown_tool" : "handler_error";
      fail(code, invoked.error?.message ?? `handler refused ${toolName}`);
    }
    const output = invoked.output as DaemonDispatchOutput;
    return { ok: true, output, providerId: decision.providerId, capabilityName: decision.capabilityName };
  }

  return {
    facade,
    compiled,
    catalog: () => facade.catalog() as Array<{ providerId: string; version: string; capabilities: string[] }>,
    toolNames: () => [...compiled.tools.keys()],
    tools: () => [
      ...H2A_CLI_MCP_TOOL_DESCRIPTORS.filter(tool => compiled.resolveTool(tool.name)),
      ...(memoryDefinition?.manifest.tools.map(tool => ({ name: tool.name, description: tool.description,
        inputSchema: tool.inputSchema, outputSchema: tool.outputSchema })) ?? [])
    ] as ReturnType<McpServer["listTools"]>,
    dispatch
  };
}

/**
 * Standalone composition: a fresh in-process server behind the requested
 * view. The service path uses `composeDaemonRegistryForServer` with the
 * attachment's server instead; this entry keeps the preflight and test
 * composition.
 */
export async function composeDaemonRegistry(options: ComposeDaemonOptions): Promise<ComposedDaemonRegistry> {
  const server = createMcpServer({
    root: options.root,
    workspaceRoot: options.workspaceRoot ?? options.root,
    storeInitialize: false,
    sessions: { autoHeartbeat: false }
  });
  return composeDaemonRegistryForServer(server.callTool.bind(server) as DaemonRawCallTool, options);
}

/**
 * The `dispatch` refusals the attachment wrapper converts back into the
 * server's historical `{ error }` shape (same observable protocol outcome
 * as the direct call: an `isError` tool result, single execution, no
 * fallback re-run). Anything else — a poisoned dispatch, a failed compile,
 * an unexpected defect — propagates and breaks the call loudly.
 */
const DAEMON_DOMAIN_REFUSAL_CODES = new Set([
  "unknown_tool",
  "handler_error",
  "handler_failed",
  "insufficient_scope",
  "insufficient_claims"
]);

export function isDaemonDomainRefusal(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    DAEMON_DOMAIN_REFUSAL_CODES.has(String((error as { code: unknown }).code))
  );
}

/**
 * Route a server's tool dispatch through the composed Sentropic registry
 * plan (combined view: the full served surface). The raw dispatch is
 * captured first and stays the only executor, so per-attachment context,
 * identity and fencing are unchanged; the plan only admits or denies, and a
 * successful dispatch returns the raw result bytes untouched.
 *
 * Takes only the `callTool` property, so callers without a full server
 * (such as the attachment hook, which lazy-loads this module to keep the
 * light-shim static graph free of the mesh packages) can route a captured
 * dispatch without a cast.
 */
export function wrapMcpServerWithDaemonRegistry(
  server: Pick<McpServer, "callTool">,
  options: { root: string; workspaceRoot?: string }
): Pick<McpServer, "callTool"> {
  // Bound NOW: the original function object, so the adapter never re-enters
  // the wrapper installed below (a property lookup at call time would).
  const rawCallTool = server.callTool.bind(server) as DaemonRawCallTool;
  let composedPromise: Promise<ComposedDaemonRegistry> | undefined;
  const composed = (): Promise<ComposedDaemonRegistry> =>
    (composedPromise ??= composeDaemonRegistryForServer(rawCallTool, {
      view: "combined",
      root: options.root,
      workspaceRoot: options.workspaceRoot
    }));
  const wrapped: McpServer["callTool"] = (async (name: string, args: Record<string, unknown> | undefined) => {
    const plan = await composed();
    try {
      const result = await plan.dispatch(name, args ?? {});
      return result.output.transport as Awaited<ReturnType<McpServer["callTool"]>>;
    } catch (error) {
      if (isDaemonDomainRefusal(error)) return { error: (error as Error).message };
      throw error;
    }
  }) as McpServer["callTool"];
  server.callTool = wrapped;
  return server;
}

/** Eager selected composition for an attachment, before MCP discovery. */
export async function configureMcpServerRegistry(server: McpServer, options: ComposeDaemonOptions): Promise<void> {
  const rawCallTool = server.callTool.bind(server) as DaemonRawCallTool;
  const plan = await composeDaemonRegistryForServer(rawCallTool, options);
  const descriptors = plan.tools();
  server.listTools = () => descriptors.slice();
  server.callTool = ((name: string, args: Record<string, unknown> | undefined) => {
    // The H1 lifecycle depends on the synchronous identity fast path.
    if (name === "h2a_identity_status" && plan.toolNames().includes(name)) return rawCallTool(name, args ?? {});
    return plan.dispatch(name, args ?? {}).then(result => result.output.transport).catch(error => {
      if (isDaemonDomainRefusal(error)) return { error: (error as Error).message };
      throw error;
    });
  }) as McpServer["callTool"];
}
