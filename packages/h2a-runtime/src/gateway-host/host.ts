import { randomUUID } from "node:crypto";
import { serve } from "@hono/node-server";
import {
  AnthropicAdapter,
  type AnthropicAdapterClient,
  CloudCodeRuntimeClient,
  CodexRuntimeClient,
  GeminiAdapter,
  MistralAdapter,
  MistralRuntimeClient,
  MuseAdapter,
  MuseRuntimeClient,
  OpenAIAdapter,
  createLlmMesh,
  createProviderRegistry,
  type RoutePlanInput,
  type RoutePlanner,
  type VerifiedRoutingSubject,
} from "@sentropic/cluster-mesh/llm-mesh";
import {
  type CallerAuthPort,
  type RouteMeteringSink,
} from "@sentropic/cluster-mesh/gateway";
import { Hono } from "hono";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import {
  createClusterMeshModules,
  createClusterMeshPlugin,
  createClusterMeshRuntime,
} from "@sentropic/cluster-mesh";
import { createGatewayNamespaceModule } from "@sentropic/cluster-mesh/compose/gateway";
import {
  applyModelRewrite,
  matchModelRewrite,
  readLlmMeshConfig,
  validateModelRewrites,
  type GatewayModelRewrite,
} from "./config-file.js";
import {
  createCliLlmMeshFacade,
  llmMeshOwnerScopeRef,
} from "../llm-mesh-accounts.js";
import { createClaudeSeatClient } from "./claude-seat-client.js";
import {
  parseLlmMeshRoutingConfig,
  routingProfiles,
  type LlmMeshRoutingConfig,
} from "../routing-preferences.js";
import {
  getSessionLedgerEntry,
  getSessionLedgerEntryForClient,
  listSessionLedger,
  recordRoutePlan,
  recordRouteSettlement,
  type SessionLedgerEntry,
} from "./ledger.js";
import {
  acquireSession,
  lookupSessionById,
  lookupToken,
  listPublicSessions,
  sessionCount,
} from "./sessions.js";
import { sweepOrphanSandboxes } from "../claude-code-cli-lifecycle.js";

/** Pending upstream U3: legacy config ports are inert on the planner-routed path. */
const legacyPortReached = (): never => { throw new Error("Inert legacy gateway port reached (pending upstream U3)"); };
export const LEGACY_PORTS_INERT = {
  mode: "personal-passthrough" as const,
  crossUserPoolEnabled: false,
  pool: { listEligibleAccounts: legacyPortReached, select: legacyPortReached, snapshotModels: legacyPortReached },
  authResolver: { resolve: legacyPortReached },
  dispatch: { dispatch: legacyPortReached, dispatchStream: legacyPortReached },
};

const routingConfigFromEnvironment = (): LlmMeshRoutingConfig | undefined => {
  const raw = process.env.H2A_LLM_MESH_ROUTING_JSON;
  return raw ? parseLlmMeshRoutingConfig(raw) : undefined;
};

const runtimeMesh = (claudeClient: AnthropicAdapterClient) => createLlmMesh({
  registry: createProviderRegistry([
    new OpenAIAdapter({ client: new CodexRuntimeClient() }),
    new GeminiAdapter({ client: new CloudCodeRuntimeClient() }),
    new MistralAdapter({ client: new MistralRuntimeClient() }),
    new MuseAdapter({ client: new MuseRuntimeClient() }),
    new AnthropicAdapter({ client: claudeClient }),
  ]),
});

const bearerFromHeaders = (headers: Readonly<Record<string, string>>): string | undefined => {
  const authorization = headers.authorization;
  if (authorization?.toLowerCase().startsWith("bearer ")) {
    return authorization.slice(7).trim();
  }
  return headers["x-api-key"]?.trim() || undefined;
};

/** Canonical Cloud Code identity for every suffixed Argon alias. */
export const GEMINI_4_ARGON_MODEL = "gemini-4-argon";

/**
 * Effort suffix carried by a suffixed Argon requested model, if any.
 * Only the canonical `gemini-4-argon-{low,medium,high}` ids qualify: the
 * planner normalizes those to the bare canonical target with no effort, so
 * the suffix is otherwise lost before the Cloud Code wire.
 */
export function argonSuffixEffort(
  requestedModel: string,
): "low" | "medium" | "high" | undefined {
  // Byte-exact like the planner's normalizeExactModelId / isExactModelTarget:
  // a non-canonical spelling must fall through to the planner's graceful
  // unknown-model refusal, never to a targetCandidatesOverride that the
  // exact-model gate would reject with a contract error.
  if (requestedModel === "gemini-4-argon-low") return "low";
  if (requestedModel === "gemini-4-argon-medium") return "medium";
  if (requestedModel === "gemini-4-argon-high") return "high";
  return undefined;
}

/**
 * Planner override that carries a suffixed Argon's effort as
 * `target.effort` when the client supplied none. The directory copies only
 * `target.effort` into `reasoning.effort`, which the Cloud Code client
 * expands to the suffixed wire model; without it the wire falls back to the
 * bare canonical model (404 `model_not_found` since 0.38.1). An explicit
 * client effort owns the wire and suppresses the override.
 */
export function argonEffortOverride(
  requestedModel: string,
  clientEffort: string | undefined,
):
  | readonly {
      providerId: "gemini";
      transportProviderId: "cloud-code";
      model: typeof GEMINI_4_ARGON_MODEL;
      effort: "low" | "medium" | "high";
    }[]
  | undefined {
  const effort = argonSuffixEffort(requestedModel);
  if (!effort || clientEffort !== undefined) return undefined;
  return [
    {
      providerId: "gemini",
      transportProviderId: "cloud-code",
      model: GEMINI_4_ARGON_MODEL,
      effort,
    },
  ];
}

const observablePlanner = (delegate: RoutePlanner): RoutePlanner => ({
  ...(delegate.listModels
    ? { listModels: (subject) => delegate.listModels!(subject) }
    : {}),
  async plan(subject: VerifiedRoutingSubject, input: RoutePlanInput) {
    const plan = await delegate.plan(subject, input);
    const session = lookupSessionById(subject.principalRef);
    if (session) recordRoutePlan(session, input, plan);
    return plan;
  },
  prepareAttempt: (...args) => delegate.prepareAttempt(...args),
  describeAffinity: (...args) => delegate.describeAffinity(...args),
  promoteAffinity: (...args) => delegate.promoteAffinity(...args),
  rebindAffinity: (...args) => delegate.rebindAffinity(...args),
  resetAffinity: (...args) => delegate.resetAffinity(...args),
});

export interface LocalGatewayAppOptions {
  readonly routing?: LlmMeshRoutingConfig;
  readonly ownerScopeRef?: string;
  /**
   * Optional request rewrites, validated at load. When absent, the gateway
   * config file list applies; absent or empty everywhere changes nothing.
   */
  readonly modelRewrites?: readonly GatewayModelRewrite[];
  /** Composition injection for readiness and fail-before-bind qualification. */
  readonly prepareNamespace?: typeof createGatewayNamespaceModule;
  /**
   * Explicit Claude seat client override (test seam). When absent, the host
   * composes the PATH-resolved seat like every other seat in the registry.
   */
  readonly claudeClient?: AnthropicAdapterClient;
  /**
   * Explicit route planner override (test seam). When absent, the host
   * composes the facade planner over the real provider registry.
   */
  readonly routePlanner?: RoutePlanner;
}

/**
 * Routed generation wires a rewrite may touch: the Anthropic Messages wire
 * Claude Code uses (never count_tokens). The OpenAI Chat wire is left
 * untouched: there any effort adds the `reasoning-controls` feature, which
 * the target route may not serve (`no_route`), so a rewrite carrying its
 * target effort could not be honoured.
 */
const MODEL_REWRITE_PATHS = new Set(["/v1/messages"]);

interface RoutedRewrite {
  readonly request: Request;
  readonly fromModel?: string;
  readonly toModel?: string;
  /** Log line (models and efforts only), emitted once the bearer passed. */
  readonly logLine?: string;
}

/**
 * Apply the first matching rewrite to the raw request, before the gateway
 * router (and therefore the llm-mesh planner) sees it. Unmatched, malformed
 * or non-generation requests keep the original request untouched. The log
 * line carries models and efforts only, never request content.
 */
async function rewriteRequestIfMatched(
  raw: Request,
  rewrites: readonly GatewayModelRewrite[],
): Promise<RoutedRewrite> {
  if (rewrites.length === 0 || raw.method !== "POST") return { request: raw };
  let pathname: string;
  try {
    pathname = new URL(raw.url).pathname;
  } catch {
    return { request: raw };
  }
  if (!MODEL_REWRITE_PATHS.has(pathname)) return { request: raw };
  let text: string;
  try {
    text = await raw.clone().text();
  } catch {
    return { request: raw };
  }
  if (!text) return { request: raw };
  let body: unknown;
  try {
    body = JSON.parse(text) as unknown;
  } catch {
    return { request: raw };
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return { request: raw };
  const matched = matchModelRewrite(rewrites, body as Record<string, unknown>);
  if (!matched) return { request: raw };
  const rewritten = applyModelRewrite(body as Record<string, unknown>, matched.entry);
  // The rewritten body has a different size: never forward a stale length.
  const headers = new Headers(raw.headers);
  headers.delete("content-length");
  const request = new Request(raw.url, {
    method: raw.method,
    headers,
    body: JSON.stringify(rewritten),
    signal: raw.signal,
  });
  return {
    request,
    fromModel: matched.fromModel,
    toModel: matched.entry.target.model,
    logLine: `[gateway-host] model rewrite: ${matched.fromModel} -> ${matched.entry.target.model}`
      + ` (effort ${matched.requestedEffort ?? "none"} -> ${matched.entry.target.effort})\n`,
  };
}

function publicSessionLedger(): SessionLedgerEntry[] {
  const routed = listSessionLedger();
  const routedIds = new Set(routed.map((entry) => entry.gatewaySessionId));
  const idle: SessionLedgerEntry[] = listPublicSessions()
    .filter((session) => !routedIds.has(session.sessionId))
    .map((session) => ({
      gatewaySessionId: session.sessionId,
      clientSessionId: session.clientSessionId,
      ...(session.workspaceId ? { workspaceId: session.workspaceId } : {}),
      ...(session.profile ? { profile: session.profile } : {}),
      account: { id: "unselected", provider: "mesh", label: "unselected" },
      transport: "mesh",
      state: "idle",
      createdAt: session.createdAt,
      lastUsedAt: session.createdAt,
      updatedAt: session.createdAt,
      requestCount: 0,
      inFlightRequests: 0,
      detailsAmbiguous: false,
    }));
  return [...routed, ...idle].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function createGatewayHost(options: LocalGatewayAppOptions = {}): { app: Hono; ready: Promise<void> } {
  let composed = false;
  const readiness = { async isReady() { return composed; } };
  // Claude seat like every other seat: an explicit override wins (test seam),
  // otherwise compose the PATH-resolved seat unconditionally.
  const claudeClient = options.claudeClient ?? createClaudeSeatClient();
  const routing = options.routing ?? routingConfigFromEnvironment();
  const currentRouting = (): LlmMeshRoutingConfig | undefined => {
    if (options.routing) return options.routing;
    const publicConfig = readLlmMeshConfig();
    // A present config with no routing field is an intentional live reset.
    // Fall back to the startup environment only when no config exists at all.
    return publicConfig ? publicConfig.routing : routing;
  };
  const ownerScopeRef = options.ownerScopeRef ?? llmMeshOwnerScopeRef();
  // Rewrites load once at startup (restart to change them) and fail the
  // startup when an entry names an unknown or unroutable target.
  // A non-array value is refused (never silently ignored).
  const modelRewrites = validateModelRewrites(
    options.modelRewrites ?? readLlmMeshConfig()?.modelRewrites,
  );
  const facade = createCliLlmMeshFacade();
  const profiles = routingProfiles(routing);
  const planner = observablePlanner(options.routePlanner ?? facade.createRoutePlanner(runtimeMesh(claudeClient), {
    ...(routing?.council ? { council: routing.council } : {}),
    ...(profiles ? { profiles } : {}),
  }));
  const callerAuth: CallerAuthPort = {
    async verify(headers) {
      const token = bearerFromHeaders(headers);
      const session = token ? await lookupToken(token) : undefined;
      if (!session) return { ok: false, reason: "invalid local gateway bearer" };
      return {
        ok: true,
        cost: {
          tenantId: ownerScopeRef,
          principalId: session.sessionId,
          ownerScopeRef,
          ...(session.workspaceId ? { workspaceId: session.workspaceId } : {}),
          source: "h2a-local-gateway",
          correlationId: randomUUID(),
        },
      };
    },
  };
  const routeMetering: RouteMeteringSink = {
    settleRoute(settlement) {
      recordRouteSettlement(settlement);
    },
  };


  const app = new Hono();
  let gatewayPlugin: Hono | undefined;
  app.get("/health", (c) => c.json({ ok: true }));
  // This route also covers the interval before the composed router is mounted.
  app.get("/readyz", async (c) => {
    const ready = await readiness.isReady();
    return c.json({ ready }, ready ? 200 : 503);
  });
  app.post("/v1/session", async (c) => {
    let body: {
      sessionId?: unknown;
      clientSessionId?: unknown;
      workspaceId?: unknown;
      profile?: unknown;
    };
    try {
      body = await c.req.json<typeof body>();
    } catch {
      return c.json({ error: "invalid JSON" }, 400);
    }
    if (typeof body.sessionId !== "string" || !body.sessionId.trim()) {
      return c.json({ error: "sessionId (string) required" }, 400);
    }
    const session = await acquireSession(body.sessionId, {
      ...(typeof body.clientSessionId === "string"
        ? { clientSessionId: body.clientSessionId }
        : {}),
      ...(typeof body.workspaceId === "string" ? { workspaceId: body.workspaceId } : {}),
      ...(typeof body.profile === "string" ? { profile: body.profile } : {}),
    });
    return c.json(session, 201);
  });
  app.get("/v1/sessions", (c) => c.json({ data: publicSessionLedger() }));
  app.get("/v1/sessions/:id", (c) => {
    const entry = getSessionLedgerEntry(c.req.param("id"));
    return entry ? c.json(entry) : c.json({ error: "session not found" }, 404);
  });
  app.get("/v1/status/client/:clientSessionId", (c) => {
    const entry = getSessionLedgerEntryForClient(c.req.param("clientSessionId"));
    return entry ? c.json(entry) : c.json({ error: "client session not found" }, 404);
  });
  // Hono freezes its matcher on first use. Register the delegation before
  // composition so in-process readiness checks cannot freeze a partial router.
  // A matched rewrite replaces the request before the gateway router plans
  // it; the served header stays exactly as llm-mesh sets it.
  app.all("*", async (c) => {
    if (!gatewayPlugin) return c.json({ error: "gateway composition incomplete" }, 503);
    const routed = await rewriteRequestIfMatched(c.req.raw, modelRewrites);
    const response = await gatewayPlugin.fetch(routed.request, c.env);
    if (!routed.fromModel || !routed.toModel) return response;
    // An unauthenticated caller learns nothing and leaves no log line.
    if (response.status === 401) return response;
    if (routed.logLine) process.stdout.write(routed.logLine);
    const visible = new Response(response.body, response);
    visible.headers.set("x-h2a-model-rewrite", `${routed.fromModel} -> ${routed.toModel}`);
    return visible;
  });
  const ready = (async () => {
    // The Claude seat is always composed, so its startup orphan sweep
    // always runs (best-effort hygiene over the private runtime root).
    try {
      const sweepResult = await sweepOrphanSandboxes(undefined, {
        onUnprovenChild: (unproven) => {
          process.stderr.write(
            `[claude-orphan-sweep] unproven child ${unproven.childPid} in ${unproven.runDir} skipped: ${unproven.reason}\n`,
          );
        },
      });
      if (sweepResult.skippedUnprovenChild) {
        process.stderr.write(
          `[claude-orphan-sweep] skipped ${sweepResult.skippedUnprovenChild} unproven child process(es)\n`,
        );
      }
    } catch {
      // Best-effort startup sweep
    }
    const modules = createClusterMeshModules();
    const namespace = await (options.prepareNamespace ?? createGatewayNamespaceModule)(modules, {
      enabled: true,
      authMode: "host",
      createRouter({ gateway }) {
        return gateway.createGatewayRouter({
          config: { ...LEGACY_PORTS_INERT, callerAuth },
          readiness,
          routePlanner: planner,
          routeMetering,
          routeInput({ cost, request, canonical }) {
            const session = lookupSessionById(cost.principalId);
            const activeRouting = currentRouting();
            const argonOverride = argonEffortOverride(
              request.model,
              canonical.request.reasoning?.effort,
            );
            return {
              affinityKey: session?.clientSessionId ?? cost.principalId,
              ...(session?.workspaceId ? { workspaceId: session.workspaceId } : {}),
              ...(activeRouting?.policy ? { policyOverride: activeRouting.policy } : {}),
              ...(activeRouting?.activeProfile ? { policyProfile: activeRouting.activeProfile } : {}),
              ...(activeRouting?.explicit ? { explicit: activeRouting.explicit } : {}),
              ...(argonOverride ? { targetCandidatesOverride: argonOverride } : {}),
            };
          },
        });
      },
    });
    // Session-control ports are deliberately unavailable on this local gateway host.
    // Bearer authentication and route settlement are injected above, through gateway ports.
    const runtime = createClusterMeshRuntime({
      generationId: randomUUID(),
      config: { capacity: { poolSize: 1 } },
      context: { async verify() { throw new Error("Session control is unavailable on the local gateway host"); } },
      registration: { async authorize() { return { ok: false, reason: "missing_registration" }; } },
      receipts: { async append() { throw new Error("Session-control receipts are unavailable on the local gateway host"); } },
    });
    gatewayPlugin = createClusterMeshPlugin({ runtime, namespaces: [namespace], mounts: { "/gw": "/" } });
    composed = true;
  })();
  return { app, ready };
}

/** Await preflight and composition before exposing a ready application. */
export async function createLocalGatewayApp(options: LocalGatewayAppOptions = {}): Promise<Hono> {
  const host = createGatewayHost(options);
  await host.ready;
  return host.app;
}

export async function startServer(
  options: LocalGatewayAppOptions = {},
  listen: typeof serve = serve,
): Promise<ReturnType<typeof serve>> {
  const port = Number.parseInt(process.env.PORT ?? "3002", 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid gateway PORT: expected 1..65535");
  const app = await createLocalGatewayApp(options);
  // Session minting is unauthenticated local control-plane traffic: loopback only.
  return listen({ fetch: app.fetch, port, hostname: "127.0.0.1" }, () => {
    process.stdout.write(
      `[gateway-host] listening on :${port} — ${sessionCount()} local bearers\n`,
    );
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startServer().catch((error: unknown) => {
    process.stderr.write(`[gateway-host] startup failed before bind: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
