import {
  DEFAULT_MODEL_EQUIVALENCE_COUNCIL,
  DEFAULT_ROUTE_POLICY,
  InMemoryRoutePolicyProfiles,
  modelProfiles,
  validateEquivalenceCouncil,
  validateRoutePolicy,
  type ModelEquivalenceCouncil,
  type RoutePolicy,
  type RoutePolicyProfile,
  type RouteSelector,
} from "@sentropic/llm-mesh";

export interface LlmMeshRoutingConfig {
  /** Host-level public policy override. Canonical routing knowledge remains in llm-mesh. */
  policy?: RoutePolicy;
  /** Optional named policies, validated and activated by llm-mesh. */
  profiles?: RoutePolicyProfile[];
  activeProfile?: string;
  /** Optional request constraint; account selectors use only redacted refs. */
  explicit?: RouteSelector;
  /** Optional reviewed council replacement. Never synthesize one in h2a. */
  council?: ModelEquivalenceCouncil;
}

export const ROUTING_TRANSPORT_ALIASES = {
  codex: "codex",
  "cloud-code": "cloud-code",
  agy: "cloud-code",
} as const;

export type RoutingTransportAlias = keyof typeof ROUTING_TRANSPORT_ALIASES;

export function routeSelectorForTransport(value: string): RouteSelector {
  const transport = ROUTING_TRANSPORT_ALIASES[value as RoutingTransportAlias];
  if (!transport) {
    throw new Error(
      `unsupported routing transport "${value}"; expected codex, cloud-code, or agy`,
    );
  }
  return { transportProviderId: transport };
}

export function validateLlmMeshRoutingConfig(
  config: LlmMeshRoutingConfig,
): LlmMeshRoutingConfig {
  if (config.policy) validateRoutePolicy(config.policy);
  const names = new Set<string>();
  for (const profile of config.profiles ?? []) {
    if (names.has(profile.name)) {
      throw new Error(`duplicate llm-mesh route profile: ${profile.name}`);
    }
    names.add(profile.name);
    validateRoutePolicy(profile.policy);
  }
  if (config.activeProfile && !names.has(config.activeProfile)) {
    throw new Error(`unknown llm-mesh route profile: ${config.activeProfile}`);
  }
  if (config.council) {
    validateEquivalenceCouncil(config.council, modelProfiles);
  }
  return config;
}

export function routingProfiles(
  config: LlmMeshRoutingConfig | undefined,
): InMemoryRoutePolicyProfiles | undefined {
  if (!config?.profiles?.length) return undefined;
  const profiles = new InMemoryRoutePolicyProfiles(config.profiles);
  if (config.activeProfile) profiles.activate(config.activeProfile);
  return profiles;
}

export function preferredRoutingConfig(
  current: LlmMeshRoutingConfig | undefined,
  transports: readonly string[],
): LlmMeshRoutingConfig {
  if (transports.length === 0) {
    throw new Error("at least one routing transport is required");
  }
  const policy: RoutePolicy = {
    ...(current?.policy ?? DEFAULT_ROUTE_POLICY),
    strategy: {
      kind: "ordered",
      preferences: transports.map(routeSelectorForTransport),
    },
  };
  return validateLlmMeshRoutingConfig({ ...current, policy });
}

export function strategyRoutingConfig(
  current: LlmMeshRoutingConfig | undefined,
  strategy: "last-enrolled" | "round-robin",
): LlmMeshRoutingConfig {
  const policy: RoutePolicy = {
    ...(current?.policy ?? DEFAULT_ROUTE_POLICY),
    strategy: strategy === "last-enrolled"
      ? { kind: "last-enrolled" }
      : { kind: "round-robin", scope: "new-affinity" },
  };
  return validateLlmMeshRoutingConfig({ ...current, policy });
}

export function effectiveRoutingPolicy(
  config: LlmMeshRoutingConfig | undefined,
): RoutePolicy {
  return config?.policy ?? DEFAULT_ROUTE_POLICY;
}

export function effectiveRoutingCouncil(
  config: LlmMeshRoutingConfig | undefined,
): ModelEquivalenceCouncil {
  return config?.council ?? DEFAULT_MODEL_EQUIVALENCE_COUNCIL;
}

export function parseLlmMeshRoutingConfig(value: string): LlmMeshRoutingConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new Error(`invalid routing JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("routing JSON must be an object");
  }
  return validateLlmMeshRoutingConfig(parsed as LlmMeshRoutingConfig);
}

export function describeLlmMeshRoutingConfig(
  config: LlmMeshRoutingConfig | undefined,
): Record<string, unknown> {
  const policy = effectiveRoutingPolicy(config);
  return {
    strategy: policy.strategy,
    fallbackMode: policy.fallbackMode,
    negativeCacheTtlMs: policy.negativeCacheTtlMs,
    maxAttempts: policy.maxAttempts,
    preferSameTransport: policy.preferSameTransport,
    stickyAccount: policy.stickyAccount,
    allowEquivalentModels: policy.allowEquivalentModels,
    rotateEquivalentAccounts: policy.rotateEquivalentAccounts,
    rules: policy.rules,
    activeProfile: config?.activeProfile ?? null,
    profiles: (config?.profiles ?? []).map(({ name, revision }) => ({ name, revision })),
    explicit: config?.explicit ?? null,
    councilRevision: effectiveRoutingCouncil(config).revision,
  };
}
