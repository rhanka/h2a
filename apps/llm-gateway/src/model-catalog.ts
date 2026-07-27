import { describeCanonicalTargetRoutes } from "@sentropic/llm-gateway";

export type AccountPool = "anthropic" | "codex";
export type GatewayProtocol = "anthropic.messages";
export type RoutingPolicy = "round-robin";

export interface ModelCatalogEntry {
  id: string;
  provider: "anthropic" | "codex";
  targetProviderId: string;
  transportProviderId: string;
  upstreamModel: string;
  accountPool: AccountPool;
  inputProtocol: GatewayProtocol;
  outputProtocol: GatewayProtocol;
  capabilities: string[];
  defaultPolicy: RoutingPolicy;
  effort?: string;
  routeKind: "faithful" | "alias";
}

export interface RoutingTarget {
  requestedModel?: string;
  catalogModelId?: string;
  upstreamModel?: string;
  accountPool: AccountPool;
  routingPolicy: RoutingPolicy;
  routeReason:
    | "env-model-map"
    | "provider-request"
    | "canonical-route";
  providerId?: string;
  transportProviderId?: string;
  effort?: string;
  routeKind?: "faithful" | "alias";
}

const CODEX_CAPABILITIES = ["streaming", "tools", "reasoning_effort"] as const;

let _catalog: ModelCatalogEntry[] | null = null;
let _envModelMap: Record<string, string> | null = null;

function parseEnvModelMap(): Record<string, string> {
  if (_envModelMap) return _envModelMap;
  if (!process.env.OPENAI_MODEL_MAP) {
    _envModelMap = {};
    return _envModelMap;
  }
  _envModelMap = JSON.parse(process.env.OPENAI_MODEL_MAP) as Record<
    string,
    string
  >;
  return _envModelMap;
}

function envCatalogEntries(): ModelCatalogEntry[] {
  return Object.entries(parseEnvModelMap()).map(([id, upstreamModel]) => ({
    id,
    provider: "codex" as const,
    targetProviderId: "openai",
    transportProviderId: "codex",
    upstreamModel,
    accountPool: "codex" as const,
    inputProtocol: "anthropic.messages" as const,
    outputProtocol: "anthropic.messages" as const,
    capabilities: [...CODEX_CAPABILITIES],
    defaultPolicy: "round-robin" as const,
    routeKind: upstreamModel === id ? "faithful" as const : "alias" as const,
  }));
}

export function listModelCatalog(): ModelCatalogEntry[] {
  if (!_catalog) {
    const canonical = describeCanonicalTargetRoutes().map((route) => {
      const accountPool =
        accountPoolForProvider(route.transportProviderId) ??
        accountPoolForProvider(route.providerId);
      if (!accountPool) {
        throw new Error(
          `canonical route ${route.requestedId} has unsupported transport ${route.transportProviderId}`,
        );
      }
      return {
        id: route.requestedId,
        provider: accountPool,
        targetProviderId: route.providerId,
        transportProviderId: route.transportProviderId,
        upstreamModel: route.model,
        accountPool,
        inputProtocol: "anthropic.messages" as const,
        outputProtocol: "anthropic.messages" as const,
        capabilities: [...CODEX_CAPABILITIES],
        defaultPolicy: "round-robin" as const,
        ...(route.effort ? { effort: route.effort } : {}),
        routeKind: route.kind,
      } satisfies ModelCatalogEntry;
    });
    const byId = new Map<string, ModelCatalogEntry>(
      canonical.map((entry) => [entry.id, entry]),
    );
    for (const entry of envCatalogEntries()) byId.set(entry.id, entry);
    _catalog = [...byId.values()];
  }
  return _catalog;
}

export function resetModelCatalogCache(): void {
  _catalog = null;
  _envModelMap = null;
}

export function accountPoolForProvider(
  provider: string,
): AccountPool | undefined {
  const normalized = provider.toLowerCase();
  if (normalized === "openai" || normalized === "codex") return "codex";
  if (normalized === "anthropic" || normalized === "claude-code")
    return "anthropic";
  return undefined;
}

export function routeForProvider(provider: string): RoutingTarget | undefined {
  const accountPool = accountPoolForProvider(provider);
  if (!accountPool) return undefined;
  return {
    accountPool,
    routingPolicy: "round-robin",
    routeReason: "provider-request",
  };
}

export function resolveModelRoute(model: string): RoutingTarget | undefined {
  const envMap = parseEnvModelMap();
  const envUpstream = envMap[model];
  if (envUpstream) {
    return {
      requestedModel: model,
      catalogModelId: model,
      upstreamModel: envUpstream,
      accountPool: "codex",
      routingPolicy: "round-robin",
      routeReason: "env-model-map",
      providerId: "openai",
      transportProviderId: "codex",
      routeKind: envUpstream === model ? "faithful" : "alias",
    };
  }

  for (const entry of listModelCatalog()) {
    if (entry.id === model) {
      return {
        requestedModel: model,
        catalogModelId: entry.id,
        upstreamModel: entry.upstreamModel,
        accountPool: entry.accountPool,
        routingPolicy: entry.defaultPolicy,
        routeReason: "canonical-route",
        providerId: entry.targetProviderId,
        transportProviderId: entry.transportProviderId,
        ...(entry.effort ? { effort: entry.effort } : {}),
        routeKind: entry.routeKind,
      };
    }
  }

  return undefined;
}

export function routeModelOrThrow(model: string): RoutingTarget {
  const route = resolveModelRoute(model);
  if (!route) throw new Error(`unsupported model: ${model}`);
  return route;
}

export function modelCatalogResponse(entries = listModelCatalog()): {
  object: "list";
  data: Array<ModelCatalogEntry & { object: "model"; owned_by: string }>;
} {
  return {
    object: "list",
    data: entries.map((entry) => ({
      ...entry,
      object: "model" as const,
      owned_by: entry.provider,
    })),
  };
}
