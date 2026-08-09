import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { serve } from "@hono/node-server";
import {
  CloudCodeRuntimeClient,
  CodexRuntimeClient,
  GeminiAdapter,
  InMemoryRoutePolicyProfiles,
  OpenAIAdapter,
  createLlmMesh,
  createProviderRegistry,
  modelProfiles,
  validateEquivalenceCouncil,
  validateRoutePolicy,
  type ModelEquivalenceCouncil,
  type RoutePlanInput,
  type RoutePlanner,
  type RoutePolicy,
  type RoutePolicyProfile,
  type RouteSelector,
  type VerifiedRoutingSubject,
} from "@sentropic/llm-mesh";
import {
  createLlmMeshFacade,
  type ConfigResolver,
} from "@sentropic/llm-mesh/facade";
import {
  createGatewayRouter,
  stubGatewayConfig,
  type CallerAuthPort,
  type RouteMeteringSink,
} from "@sentropic/llm-gateway";
import { Hono } from "hono";
import {
  getSessionLedgerEntry,
  getSessionLedgerEntryForClient,
  listSessionLedger,
  recordRoutePlan,
  recordRouteSettlement,
} from "./session-ledger.js";
import {
  acquireSession,
  lookupSessionById,
  lookupToken,
  sessionCount,
} from "./sticky.js";

interface GatewayRoutingConfig {
  readonly policy?: RoutePolicy;
  readonly profiles?: readonly RoutePolicyProfile[];
  readonly activeProfile?: string;
  readonly explicit?: RouteSelector;
  readonly council?: ModelEquivalenceCouncil;
}

const configResolver: ConfigResolver = {
  async resolveConfig(configRef) {
    const raw = process.env.H2A_LLM_MESH_CONFIG_JSON;
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const scoped = parsed[configRef];
    return scoped && typeof scoped === "object" && !Array.isArray(scoped)
      ? scoped as Record<string, unknown>
      : parsed;
  },
};

function routingFromEnvironment(): GatewayRoutingConfig | undefined {
  const raw = process.env.H2A_LLM_MESH_ROUTING_JSON;
  if (!raw) return undefined;
  const value = JSON.parse(raw) as GatewayRoutingConfig;
  if (value.policy) validateRoutePolicy(value.policy);
  for (const profile of value.profiles ?? []) validateRoutePolicy(profile.policy);
  if (value.activeProfile && !(value.profiles ?? []).some(
    (profile) => profile.name === value.activeProfile,
  )) {
    throw new Error(`unknown llm-mesh route profile: ${value.activeProfile}`);
  }
  if (value.council) validateEquivalenceCouncil(value.council, modelProfiles);
  return value;
}

const routingProfiles = (
  routing: GatewayRoutingConfig | undefined,
): InMemoryRoutePolicyProfiles | undefined => {
  if (!routing?.profiles?.length) return undefined;
  const profiles = new InMemoryRoutePolicyProfiles(routing.profiles);
  if (routing.activeProfile) profiles.activate(routing.activeProfile);
  return profiles;
};

const runtimeMesh = () => createLlmMesh({
  registry: createProviderRegistry([
    new OpenAIAdapter({ client: new CodexRuntimeClient() }),
    new GeminiAdapter({ client: new CloudCodeRuntimeClient() }),
  ]),
});

const bearerFromHeaders = (
  headers: Readonly<Record<string, string>>,
): string | undefined => {
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

export interface GatewayAppOptions {
  readonly routing?: GatewayRoutingConfig;
  readonly ownerScopeRef?: string;
}

export function createGatewayApp(options: GatewayAppOptions = {}): Hono {
  const routing = options.routing ?? routingFromEnvironment();
  const ownerScopeRef = options.ownerScopeRef
    ?? process.env.H2A_LLM_MESH_OWNER_SCOPE?.trim()
    ?? `gateway:${hostname()}`;
  const facade = createLlmMeshFacade({
    configResolver,
    mode: "cli",
    legacyAccountOwnerScopeRef: ownerScopeRef,
  });
  const profiles = routingProfiles(routing);
  const planner = observablePlanner(facade.createRoutePlanner(runtimeMesh(), {
    ...(routing?.council ? { council: routing.council } : {}),
    ...(profiles ? { profiles } : {}),
  }));
  const callerAuth: CallerAuthPort = {
    async verify(headers) {
      const token = bearerFromHeaders(headers);
      const session = token ? await lookupToken(token) : undefined;
      if (!session) return { ok: false, reason: "invalid gateway bearer" };
      return {
        ok: true,
        cost: {
          tenantId: ownerScopeRef,
          principalId: session.sessionId,
          ownerScopeRef,
          ...(session.workspaceId ? { workspaceId: session.workspaceId } : {}),
          source: "h2a-gateway-host",
          correlationId: randomUUID(),
        },
      };
    },
  };
  const routeMetering: RouteMeteringSink = {
    settleRoute: recordRouteSettlement,
  };
  const gateway = createGatewayRouter({
    config: { ...stubGatewayConfig, callerAuth },
    routePlanner: planner,
    routeMetering,
    routeInput({ cost }) {
      const session = lookupSessionById(cost.principalId);
      return {
        affinityKey: session?.clientSessionId ?? cost.principalId,
        ...(session?.workspaceId ? { workspaceId: session.workspaceId } : {}),
        ...(routing?.policy ? { policyOverride: routing.policy } : {}),
        ...(routing?.activeProfile ? { policyProfile: routing.activeProfile } : {}),
        ...(routing?.explicit ? { explicit: routing.explicit } : {}),
      };
    },
  });

  const app = new Hono();
  app.get("/health", (c) => c.json({ ok: true }));
  app.get("/healthz", (c) => c.json({ ok: true }));
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
    const result = await acquireSession(body.sessionId, {
      ...(typeof body.clientSessionId === "string"
        ? { clientSessionId: body.clientSessionId }
        : {}),
      ...(typeof body.workspaceId === "string" ? { workspaceId: body.workspaceId } : {}),
      ...(typeof body.profile === "string" ? { profile: body.profile } : {}),
    });
    return c.json(result, 201);
  });
  app.get("/v1/sessions", (c) => c.json({ data: listSessionLedger() }));
  app.get("/v1/sessions/:id", (c) => {
    const entry = getSessionLedgerEntry(c.req.param("id"));
    return entry ? c.json(entry) : c.json({ error: "session not found" }, 404);
  });
  app.get("/v1/status/client/:clientSessionId", (c) => {
    const entry = getSessionLedgerEntryForClient(c.req.param("clientSessionId"));
    return entry ? c.json(entry) : c.json({ error: "client session not found" }, 404);
  });
  app.route("/", gateway);
  return app;
}

export const app = createGatewayApp();

export function startServer(): void {
  const port = Number.parseInt(process.env.PORT ?? "3002", 10);
  serve({ fetch: app.fetch, port }, () => {
    process.stdout.write(
      `[llm-gateway] listening on :${port} — ${sessionCount()} local bearers\n`,
    );
  });
}

if (process.env.NODE_ENV !== "test") startServer();
