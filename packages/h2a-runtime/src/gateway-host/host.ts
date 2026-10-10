import { randomUUID } from "node:crypto";
import { serve } from "@hono/node-server";
import {
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
import { readLlmMeshConfig } from "./config-file.js";
import {
  createCliLlmMeshFacade,
  llmMeshOwnerScopeRef,
} from "../llm-mesh-accounts.js";
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

const runtimeMesh = () => createLlmMesh({
  registry: createProviderRegistry([
    new OpenAIAdapter({ client: new CodexRuntimeClient() }),
    new GeminiAdapter({ client: new CloudCodeRuntimeClient() }),
    new MistralAdapter({ client: new MistralRuntimeClient() }),
    new MuseAdapter({ client: new MuseRuntimeClient() }),
  ]),
});

const bearerFromHeaders = (headers: Readonly<Record<string, string>>): string | undefined => {
  const authorization = headers.authorization;
  if (authorization?.toLowerCase().startsWith("bearer ")) {
    return authorization.slice(7).trim();
  }
  return headers["x-api-key"]?.trim() || undefined;
};

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
  /** Composition injection for readiness and fail-before-bind qualification. */
  readonly prepareNamespace?: typeof createGatewayNamespaceModule;
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
  const routing = options.routing ?? routingConfigFromEnvironment();
  const currentRouting = (): LlmMeshRoutingConfig | undefined => {
    if (options.routing) return options.routing;
    const publicConfig = readLlmMeshConfig();
    // A present config with no routing field is an intentional live reset.
    // Fall back to the startup environment only when no config exists at all.
    return publicConfig ? publicConfig.routing : routing;
  };
  const ownerScopeRef = options.ownerScopeRef ?? llmMeshOwnerScopeRef();
  const facade = createCliLlmMeshFacade();
  const profiles = routingProfiles(routing);
  const planner = observablePlanner(facade.createRoutePlanner(runtimeMesh(), {
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
  app.all("*", (c) => gatewayPlugin
    ? gatewayPlugin.fetch(c.req.raw, c.env)
    : c.json({ error: "gateway composition incomplete" }, 503));
  const ready = (async () => {
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
          routeInput({ cost }) {
            const session = lookupSessionById(cost.principalId);
            const activeRouting = currentRouting();
            return {
              affinityKey: session?.clientSessionId ?? cost.principalId,
              ...(session?.workspaceId ? { workspaceId: session.workspaceId } : {}),
              ...(activeRouting?.policy ? { policyOverride: activeRouting.policy } : {}),
              ...(activeRouting?.activeProfile ? { policyProfile: activeRouting.activeProfile } : {}),
              ...(activeRouting?.explicit ? { explicit: activeRouting.explicit } : {}),
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
