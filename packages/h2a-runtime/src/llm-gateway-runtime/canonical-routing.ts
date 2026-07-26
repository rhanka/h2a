/**
 * Model routing for the embedded h2a gateway runtime.
 *
 * h2a is a PURE CONSUMER of the routing owned by `@sentropic/llm-gateway`.
 * This module declares NO alias and NO model -> upstream mapping. It READS the
 * canonical target map via `describeCanonicalTargetRoutes()` /
 * `createCanonicalTargetResolver()` (both zero-argument) and adapts it to the
 * account-pool shape the runtime's accounts/sticky layer expects.
 *
 * It deliberately does NOT call `defineLaunchAliases()`: declaring aliases here
 * would make h2a a CO-OWNER of the mapping, which is exactly the duplication
 * this module replaces. The former `model-catalog.ts` carried its own copy of
 * the table and had already drifted -- it routed `claude-opus-4-8` to
 * `gemini-3.1-pro` on the Google pool while the gateway routes the bare id
 * provider-faithfully to Anthropic. A copy is not a cache; it is a fork.
 *
 * Host-owned knobs that are NOT routing duplication are kept here on purpose:
 *   - `OPENAI_MODEL_MAP`: deployment-level override, h2a's own configuration.
 *   - `gpt-*` passthrough: h2a's own policy for explicitly-named upstream ids.
 * Neither re-declares an alias served by the canonical map.
 */
import {
  createCanonicalTargetResolver,
  describeCanonicalTargetRoutes,
} from "@sentropic/llm-gateway";

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
  /** Reasoning effort the canonical route pins, when it pins one. */
  effort?: string;
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
  /**
   * Effort implied by the canonical route. h2a is a pure pass-through: it
   * carries the value and never substitutes one of its own.
   */
  effort?: string;
}

const CODEX_CAPABILITIES = ["streaming", "tools", "reasoning_effort"] as const;
const ANTHROPIC_CAPABILITIES = ["streaming", "tools"] as const;
const GOOGLE_CAPABILITIES = ["streaming", "tools"] as const;

/** Map a provider/transport id onto the runtime's account-pool vocabulary. */
export function accountPoolForProvider(
  provider: string,
): AccountPool | undefined {
  const normalized = provider.toLowerCase();
  if (normalized === "openai" || normalized === "codex") return "codex";
  if (
    normalized === "google" ||
    normalized === "gemini" ||
    normalized === "gcp" ||
    normalized === "gemini-code-assist"
  ) {
    return "google";
  }
  if (normalized === "anthropic" || normalized === "claude-code") {
    return "anthropic";
  }
  return undefined;
}

function capabilitiesForPool(pool: AccountPool): string[] {
  if (pool === "codex") return [...CODEX_CAPABILITIES];
  if (pool === "google") return [...GOOGLE_CAPABILITIES];
  return [...ANTHROPIC_CAPABILITIES];
}

let _catalog: ModelCatalogEntry[] | null = null;
let _envModelMap: Record<string, string> | null = null;
let _resolveCanonical: ReturnType<typeof createCanonicalTargetResolver> | null =
  null;

function canonicalResolver(): ReturnType<typeof createCanonicalTargetResolver> {
  if (!_resolveCanonical) _resolveCanonical = createCanonicalTargetResolver();
  return _resolveCanonical;
}

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

/** Pool inferred from an env-map upstream id (host-owned override only). */
function poolForEnvUpstream(upstream: string): AccountPool {
  const lowered = upstream.toLowerCase();
  if (lowered.includes("gemini") || lowered.includes("google")) return "google";
  if (lowered.includes("claude")) return "anthropic";
  return "codex";
}

function envCatalogEntries(): ModelCatalogEntry[] {
  return Object.entries(parseEnvModelMap()).map(([id, upstreamModel]) => {
    const pool = poolForEnvUpstream(upstreamModel);
    return {
      id,
      provider: pool,
      upstreamModel,
      accountPool: pool,
      inputProtocol: "anthropic.messages" as const,
      outputProtocol: "anthropic.messages" as const,
      capabilities: capabilitiesForPool(pool),
      defaultPolicy: "round-robin" as const,
    };
  });
}

/**
 * The servable catalogue, READ from the gateway's canonical target map. Every
 * entry -- faithful id and launch alias alike -- comes from
 * `describeCanonicalTargetRoutes()`; nothing here is declared locally.
 */
function canonicalCatalogEntries(): ModelCatalogEntry[] {
  const entries: ModelCatalogEntry[] = [];
  for (const route of describeCanonicalTargetRoutes()) {
    const pool = accountPoolForProvider(route.transportProviderId);
    // An unmapped transport is skipped rather than defaulted: a silent pool
    // fallback is how a request reaches an upstream nobody chose.
    if (!pool) continue;
    entries.push({
      id: route.requestedId,
      provider: pool,
      upstreamModel: route.model,
      accountPool: pool,
      inputProtocol: "anthropic.messages",
      outputProtocol: "anthropic.messages",
      capabilities: capabilitiesForPool(pool),
      defaultPolicy: "round-robin",
      ...(route.effort ? { effort: route.effort } : {}),
    });
  }
  return entries;
}

export function listModelCatalog(): ModelCatalogEntry[] {
  if (!_catalog) {
    _catalog = [...canonicalCatalogEntries(), ...envCatalogEntries()];
  }
  return _catalog;
}

export function resetModelCatalogCache(): void {
  _catalog = null;
  _envModelMap = null;
  _resolveCanonical = null;
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
  // 1. Deployment override wins -- h2a's own configuration, not a routing copy.
  const envUpstream = parseEnvModelMap()[model];
  if (envUpstream) {
    return {
      requestedModel: model,
      catalogModelId: model,
      upstreamModel: envUpstream,
      accountPool: poolForEnvUpstream(envUpstream),
      routingPolicy: "round-robin",
      routeReason: "env-model-map",
    };
  }

  // 2. THE routing: read from the gateway, never re-described here.
  const target = canonicalResolver()(model);
  if (target) {
    const pool = accountPoolForProvider(target.transportProviderId);
    if (pool) {
      return {
        requestedModel: model,
        catalogModelId: target.model,
        upstreamModel: target.model,
        accountPool: pool,
        routingPolicy: "round-robin",
        // `faithful` == the requested id IS the upstream model.
        routeReason: target.model === model ? "catalog-id" : "catalog-alias",
        ...(target.effort ? { effort: target.effort } : {}),
      };
    }
  }

  // 3. Explicitly-named upstream ids stay addressable.
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

  // No cross-pool fallback: an unknown id is a 400, not a surprise upstream.
  return undefined;
}

export function routeModelOrThrow(model: string): RoutingTarget {
  const route = resolveModelRoute(model);
  if (!route) throw new Error(`unsupported model: ${model}`);
  return route;
}

export function modelCatalogResponse(entries = listModelCatalog()): {
  object: "list";
  data: Array<
    Record<string, unknown> & { id: string; object: "model"; owned_by: string }
  >;
} {
  const byId = new Map<
    string,
    Record<string, unknown> & { id: string; object: "model"; owned_by: string }
  >();
  for (const entry of entries) {
    // Aliases are first-class routes in the canonical map, so each servable id
    // is already its own entry -- no local alias expansion to get wrong.
    if (byId.has(entry.id)) continue;
    byId.set(entry.id, {
      ...entry,
      id: entry.id,
      object: "model" as const,
      owned_by: entry.provider,
    });
  }
  return { object: "list", data: Array.from(byId.values()) };
}
