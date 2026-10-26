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
 * No `mcp-central-*.ts` change: this module is consumed from the registry
 * service path (`cli-registry.ts` bridge preflight) and directly by tests.
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
import { createMcpServer } from "../runtime/mcp/server.js";
import { H2A_CLI_MCP_TOOL_DESCRIPTORS } from "../runtime/mcp/tools.js";

/** Pinned to the published facade; asserted by the H2a daemon tests. */
export const USES_SENTROPIC_FACADE = true;

export type DaemonView = "coordination" | "track" | "combined";

export interface ComposeDaemonOptions {
  view: DaemonView;
  /** Filesystem root for the backing local-files store (tests: mkdtemp). */
  root: string;
  workspaceRoot?: string;
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

type McpServerLike = ReturnType<typeof createMcpServer>;

function contentText(raw: unknown): { text: string; hint?: string } | null {
  if (raw === null || typeof raw !== "object" || !("content" in raw)) return null;
  const content = (raw as { content: unknown }).content;
  if (!Array.isArray(content) || content.length === 0) return null;
  const first = (content[0] as { text?: unknown }).text;
  if (typeof first !== "string") return null;
  const second = (content[1] as { text?: unknown } | undefined)?.text;
  return { text: first, ...(typeof second === "string" ? { hint: second } : {}) };
}

function buildAdapter(manifest: Manifest, connectorId: string, server: McpServerLike): Adapter {
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
        raw = await server.callTool(name, (req.input ?? {}) as Record<string, unknown>);
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

function buildLoadedDefinition(manifest: Manifest, connectorId: string, server: McpServerLike): LoadedDefinition {
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
    adapter: buildAdapter(manifest, connectorId, server),
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

export async function composeDaemonRegistry(options: ComposeDaemonOptions): Promise<{
  facade: ReturnType<typeof createMcpRegistry>;
  compiled: CompiledMcpRegistry;
  catalog: () => Array<{ providerId: string; version: string; capabilities: string[] }>;
  toolNames: () => string[];
  dispatch: (toolName: string, args: Record<string, unknown>) => Promise<DaemonDispatchResult>;
}> {
  const server = createMcpServer({
    root: options.root,
    workspaceRoot: options.workspaceRoot ?? options.root,
    storeInitialize: false,
    sessions: { autoHeartbeat: false }
  });

  const wantCoordination = options.view === "coordination" || options.view === "combined";
  const wantTrack = options.view === "track" || options.view === "combined";

  const definitions: LoadedDefinition[] = [];
  if (wantCoordination) {
    definitions.push(
      buildLoadedDefinition(
        buildManifest("sentropic.h2a", "@sentropic/h2a", "h2a coordination", coordinationTools(), false),
        "h2a-coordination",
        server
      )
    );
  }
  if (wantTrack) {
    definitions.push(
      buildLoadedDefinition(
        buildManifest("sentropic.track", "@sentropic/track", "track reads", trackTools(), true),
        "track-read",
        server
      )
    );
  }

  const modules = createClusterMeshModules();
  const facade = createMcpRegistry({ modules });
  const registered: LoadedDefinition[] = [];
  for (const definition of definitions) {
    const registrable: RegistryDefinition = definition;
    facade.register(registrable);
    registered.push(definition);
  }
  const selected = registered.map((definition) => definition.manifest.providerId);
  facade.select(selected);
  for (const providerId of selected) facade.configure(providerId, {});

  const compatibility: Record<string, { manifestDigest: string }> = {};
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
    dispatch
  };
}
