import { describeCanonicalTargetRoutes } from "@sentropic/llm-gateway";

export type AccountPool = "anthropic" | "codex" | "google";
export type GatewayProtocol = "anthropic.messages";
export type RoutingPolicy = "round-robin";

export interface ModelCatalogEntry {
  id: string;
  provider: AccountPool;
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
const GOOGLE_CAPABILITIES = ["streaming", "tools"] as const;

const CLOUD_CODE_CATALOG: readonly ModelCatalogEntry[] = [
  {
    id: "gemini-2.5-pro",
    provider: "google",
    targetProviderId: "google",
    transportProviderId: "cloud-code",
    upstreamModel: "gemini-2.5-pro",
    accountPool: "google",
    inputProtocol: "anthropic.messages",
    outputProtocol: "anthropic.messages",
    capabilities: [...GOOGLE_CAPABILITIES],
    defaultPolicy: "round-robin",
    routeKind: "faithful",
  },
  {
    id: "gemini-2.5-flash",
    provider: "google",
    targetProviderId: "google",
    transportProviderId: "cloud-code",
    upstreamModel: "gemini-2.5-flash",
    accountPool: "google",
    inputProtocol: "anthropic.messages",
    outputProtocol: "anthropic.messages",
    capabilities: [...GOOGLE_CAPABILITIES],
    defaultPolicy: "round-robin",
    routeKind: "faithful",
  },
];

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
  return Object.entries(parseEnvModelMap()).map(([id, upstreamModel]) => {
    const isGoogle = upstreamModel.toLowerCase().includes("gemini");
    const isAnthropic = upstreamModel.toLowerCase().includes("claude");

    return {
      id,
      provider: isGoogle ? "google" : (isAnthropic ? "anthropic" : "codex"),
      targetProviderId: isGoogle
        ? "google"
        : isAnthropic
          ? "anthropic"
          : "openai",
      transportProviderId: isGoogle
        ? "cloud-code"
        : isAnthropic
          ? "claude-code"
          : "codex",
      upstreamModel,
      accountPool: isGoogle ? "google" : (isAnthropic ? "anthropic" : "codex"),
      inputProtocol: "anthropic.messages",
      outputProtocol: "anthropic.messages",
      capabilities: isGoogle ? [...GOOGLE_CAPABILITIES] : [...CODEX_CAPABILITIES],
      defaultPolicy: "round-robin",
      routeKind: upstreamModel === id ? "faithful" : "alias",
    };
  });
}

export function listModelCatalog(): ModelCatalogEntry[] {
  if (!_catalog) {
    const canonical = describeCanonicalTargetRoutes().map((route) => {
      const accountPool = accountPoolForProvider(route.transportProviderId) ??
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
        capabilities:
          accountPool === "google"
            ? [...GOOGLE_CAPABILITIES]
            : [...CODEX_CAPABILITIES],
        defaultPolicy: "round-robin" as const,
        ...(route.effort ? { effort: route.effort } : {}),
        routeKind: route.kind,
      } satisfies ModelCatalogEntry;
    });
    const byId = new Map<string, ModelCatalogEntry>(
      canonical.map((entry) => [entry.id, entry]),
    );
    for (const entry of CLOUD_CODE_CATALOG) byId.set(entry.id, entry);
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
  if (normalized === "openai" || normalized === "codex") {
    return "codex";
  }
  if (
    normalized === "google" ||
    normalized === "gemini" ||
    normalized === "gcp" ||
    normalized === "cloud-code"
  ) {
    return "google";
  }
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
    const isGoogle = envUpstream.toLowerCase().includes("gemini") || envUpstream.toLowerCase().includes("google");
    const isAnthropic = envUpstream.toLowerCase().includes("claude");
    return {
      requestedModel: model,
      catalogModelId: model,
      upstreamModel: envUpstream,
      accountPool: isGoogle ? "google" : (isAnthropic ? "anthropic" : "codex"),
      routingPolicy: "round-robin",
      routeReason: "env-model-map",
      providerId: isGoogle ? "google" : (isAnthropic ? "anthropic" : "openai"),
      transportProviderId: isGoogle ? "cloud-code" : (isAnthropic ? "claude-code" : "codex"),
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
  data: Array<Record<string, unknown> & { id: string; object: "model"; owned_by: string }>;
} {
  const modelMap = new Map<
    string,
    Record<string, unknown> & { id: string; object: "model"; owned_by: string }
  >();

  for (const entry of entries) {
    modelMap.set(entry.id, {
      ...entry,
      id: entry.id,
      object: "model" as const,
      owned_by: entry.provider,
    });
  }

  return {
    object: "list",
    data: Array.from(modelMap.values()),
  };
}
