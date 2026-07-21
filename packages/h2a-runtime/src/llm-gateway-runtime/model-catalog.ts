export type AccountPool = "anthropic" | "codex" | "google";
export type GatewayProtocol = "anthropic.messages";
export type RoutingPolicy = "round-robin";

export interface ModelCatalogEntry {
  id: string;
  provider: "anthropic" | "codex" | "google";
  upstreamModel: string;
  accountPool: AccountPool;
  inputProtocol: GatewayProtocol;
  outputProtocol: GatewayProtocol;
  capabilities: string[];
  defaultPolicy: RoutingPolicy;
  aliases?: string[];
}

export interface RoutingTarget {
  requestedModel?: string;
  catalogModelId?: string;
  upstreamModel?: string;
  accountPool: AccountPool;
  routingPolicy: RoutingPolicy;
  routeReason:
    | "catalog-id"
    | "catalog-alias"
    | "env-model-map"
    | "provider-request"
    | "passthrough-gpt";
}

const CODEX_CAPABILITIES = ["streaming", "tools", "reasoning_effort"] as const;
const GOOGLE_CAPABILITIES = ["streaming", "tools"] as const;

const DEFAULT_MODEL_CATALOG: ModelCatalogEntry[] = [
  {
    id: "gpt-5.6-terra",
    provider: "codex",
    upstreamModel: "gpt-5.6-terra",
    accountPool: "codex",
    inputProtocol: "anthropic.messages",
    outputProtocol: "anthropic.messages",
    capabilities: [...CODEX_CAPABILITIES],
    defaultPolicy: "round-robin",
    aliases: [],
  },
  {
    id: "gpt-5.6-sol",
    provider: "codex",
    upstreamModel: "gpt-5.6-sol",
    accountPool: "codex",
    inputProtocol: "anthropic.messages",
    outputProtocol: "anthropic.messages",
    capabilities: [...CODEX_CAPABILITIES],
    defaultPolicy: "round-robin",
    aliases: ["claude-fable-5", "fable-5"],
  },
  {
    id: "gpt-5.6-luna",
    provider: "codex",
    upstreamModel: "gpt-5.6-luna",
    accountPool: "codex",
    inputProtocol: "anthropic.messages",
    outputProtocol: "anthropic.messages",
    capabilities: [...CODEX_CAPABILITIES],
    defaultPolicy: "round-robin",
  },
  {
    id: "gpt-5.5",
    provider: "codex",
    upstreamModel: "gpt-5.5",
    accountPool: "codex",
    inputProtocol: "anthropic.messages",
    outputProtocol: "anthropic.messages",
    capabilities: [...CODEX_CAPABILITIES],
    defaultPolicy: "round-robin",
    aliases: [
      "claude-opus-4-7",
      "claude-opus-4-6",
      "claude-sonnet-4-6",
      "claude-sonnet-4-5",
      "claude-haiku-4-5-20251001",
    ],
  },
  {
    id: "gpt-5.3-codex-spark",
    provider: "codex",
    upstreamModel: "gpt-5.3-codex-spark",
    accountPool: "codex",
    inputProtocol: "anthropic.messages",
    outputProtocol: "anthropic.messages",
    capabilities: [...CODEX_CAPABILITIES],
    defaultPolicy: "round-robin",
  },
  // ── Google / Gemini models ──
  {
    id: "gemini-3.5-flash",
    provider: "google",
    upstreamModel: "gemini-2.5-flash",
    accountPool: "google",
    inputProtocol: "anthropic.messages",
    outputProtocol: "anthropic.messages",
    capabilities: [...GOOGLE_CAPABILITIES],
    defaultPolicy: "round-robin",
    aliases: ["gemini-3.5-high", "gemini-flash", "claude-sonnet-5", "claude-sonnet-5-high"],
  },
  {
    id: "gemini-3.1-pro",
    provider: "google",
    upstreamModel: "gemini-2.5-pro",
    accountPool: "google",
    inputProtocol: "anthropic.messages",
    outputProtocol: "anthropic.messages",
    capabilities: [...GOOGLE_CAPABILITIES],
    defaultPolicy: "round-robin",
    aliases: ["gemini-3.1-pro-high", "gemini-pro-high", "gemini-pro", "claude-opus-4-8", "claude-opus-4-8-xhigh"],
  },
  {
    id: "gemini-2.5-pro",
    provider: "google",
    upstreamModel: "gemini-2.5-pro",
    accountPool: "google",
    inputProtocol: "anthropic.messages",
    outputProtocol: "anthropic.messages",
    capabilities: [...GOOGLE_CAPABILITIES],
    defaultPolicy: "round-robin",
    aliases: [],
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
      upstreamModel,
      accountPool: isGoogle ? "google" : (isAnthropic ? "anthropic" : "codex"),
      inputProtocol: "anthropic.messages",
      outputProtocol: "anthropic.messages",
      capabilities: isGoogle ? [...GOOGLE_CAPABILITIES] : [...CODEX_CAPABILITIES],
      defaultPolicy: "round-robin",
    };
  });
}

export function listModelCatalog(): ModelCatalogEntry[] {
  if (!_catalog) _catalog = [...DEFAULT_MODEL_CATALOG, ...envCatalogEntries()];
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
    normalized === "gemini-code-assist"
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
        routeReason: "catalog-id",
      };
    }
    if (entry.aliases?.includes(model)) {
      return {
        requestedModel: model,
        catalogModelId: entry.id,
        upstreamModel: entry.upstreamModel,
        accountPool: entry.accountPool,
        routingPolicy: entry.defaultPolicy,
        routeReason: "catalog-alias",
      };
    }
  }

  if (model.startsWith("gpt-")) {
    return {
      requestedModel: model,
      catalogModelId: model,
      upstreamModel: model,
      accountPool: "codex",
      routingPolicy: "round-robin",
      routeReason: "passthrough-gpt",
    };
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
    if (entry.aliases) {
      for (const alias of entry.aliases) {
        if (!modelMap.has(alias)) {
          modelMap.set(alias, {
            ...entry,
            id: alias,
            object: "model" as const,
            owned_by: entry.provider,
          });
        }
      }
    }
  }

  return {
    object: "list",
    data: Array.from(modelMap.values()),
  };
}
