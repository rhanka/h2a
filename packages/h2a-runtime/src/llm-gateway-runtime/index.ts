import { randomUUID } from "node:crypto";
import { serve } from "@hono/node-server";
import {
  CloudCodeRuntimeClient,
  CodexRuntimeClient,
  GeminiAdapter,
  OpenAIAdapter,
  createLlmMesh,
  createProviderRegistry,
  type RoutePlanInput,
  type RoutePlanner,
  type VerifiedRoutingSubject,
} from "@sentropic/llm-mesh";
import {
  createGatewayRouter,
  stubGatewayConfig,
  type CallerAuthPort,
  type RouteMeteringSink,
} from "@sentropic/llm-gateway";
import { Hono } from "hono";
import {
  createCliLlmMeshFacade,
  llmMeshOwnerScopeRef,
  readLlmMeshConfig,
} from "../llm-mesh.js";
import {
  parseLlmMeshRoutingConfig,
  routingProfiles,
  type LlmMeshRoutingConfig,
} from "../llm-routing-config.js";
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

const routingConfigFromEnvironment = (): LlmMeshRoutingConfig | undefined => {
  const raw = process.env.H2A_LLM_MESH_ROUTING_JSON;
  return raw ? parseLlmMeshRoutingConfig(raw) : undefined;
};

const runtimeMesh = () => createLlmMesh({
  registry: createProviderRegistry([
    new OpenAIAdapter({ client: new CodexRuntimeClient() }),
    new GeminiAdapter({ client: new CloudCodeRuntimeClient() }),
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
}

export function createLocalGatewayApp(options: LocalGatewayAppOptions = {}): Hono {
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
  const gateway = createGatewayRouter({
    config: { ...stubGatewayConfig, callerAuth },
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

  const app = new Hono();
  app.get("/health", (c) => c.json({ ok: true }));
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

export const app = createLocalGatewayApp();

export function startServer(): void {
  const port = Number.parseInt(process.env.PORT ?? "3002", 10);
  // Session minting is intentionally unauthenticated control-plane traffic.
  // The embedded solo-dev host therefore never listens beyond loopback.
  serve({ fetch: app.fetch, port, hostname: "127.0.0.1" }, () => {
    process.stdout.write(
      `[llm-gateway] listening on :${port} — ${sessionCount()} local bearers\n`,
    );
  });
}

if (process.env.NODE_ENV !== "test") startServer();
