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
  resolveRequestedTargets,
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
import {
  createObservedUpstreamFetch,
  createRequestTrace,
  extractSanitizedThrownError,
  formatGatewayRequestLogLine,
  INFERENCE_ROUTES,
  parseRetryAfterHeaderSeconds,
  RateLimitCooldownTracker,
  remapRateLimited503Response,
  requestTraceStorage,
  type GatewayRequestLogEntry,
  type SanitizedUpstreamError,
} from "./request-log.js";
import {
  createCloudCodeRetryFetch,
  formatCloudCodeRetryLogLine,
  type CloudCodeRetryPolicy,
} from "./cloud-code-retry.js";

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

const runtimeMesh = (
  claudeClient: AnthropicAdapterClient,
  upstreamFetch: typeof fetch,
  cloudCodeFetch: typeof fetch,
) => createLlmMesh({
  registry: createProviderRegistry([
    new OpenAIAdapter({ client: new CodexRuntimeClient({ fetch: upstreamFetch }) }),
    new GeminiAdapter({ client: new CloudCodeRuntimeClient(cloudCodeFetch) }),
    new MistralAdapter({ client: new MistralRuntimeClient({ fetch: upstreamFetch }) }),
    new MuseAdapter({ client: new MuseRuntimeClient({ fetch: upstreamFetch }) }),
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

/** Canonical Cloud Code identities for effort-suffixed Gemini 4 aliases. */
export const GEMINI_4_ARGON_MODEL = "gemini-4-argon";
export const GEMINI_4_NEON_MODEL = "gemini-4-neon";
export const GEMINI_4_HYDROGEN_MODEL = "gemini-4-hydrogen";

export type CloudCodeSuffixedModel =
  | typeof GEMINI_4_ARGON_MODEL
  | typeof GEMINI_4_NEON_MODEL
  | typeof GEMINI_4_HYDROGEN_MODEL;

export type CloudCodeSuffixEffort = "low" | "medium" | "high" | "xhigh";

const SUFFIXED_CLOUD_CODE_TARGETS: Readonly<
  Record<
    string,
    {
      readonly model: CloudCodeSuffixedModel;
      readonly effort: CloudCodeSuffixEffort;
    }
  >
> = {
  "gemini-4-argon-low": { model: GEMINI_4_ARGON_MODEL, effort: "low" },
  "gemini-4-argon-medium": { model: GEMINI_4_ARGON_MODEL, effort: "medium" },
  "gemini-4-argon-high": { model: GEMINI_4_ARGON_MODEL, effort: "high" },
  "gemini-4-neon-low": { model: GEMINI_4_NEON_MODEL, effort: "low" },
  "gemini-4-neon-medium": { model: GEMINI_4_NEON_MODEL, effort: "medium" },
  "gemini-4-neon-high": { model: GEMINI_4_NEON_MODEL, effort: "high" },
  "gemini-4-neon-xhigh": { model: GEMINI_4_NEON_MODEL, effort: "xhigh" },
  "gemini-4-hydrogen-low": { model: GEMINI_4_HYDROGEN_MODEL, effort: "low" },
  "gemini-4-hydrogen-medium": { model: GEMINI_4_HYDROGEN_MODEL, effort: "medium" },
  "gemini-4-hydrogen-high": { model: GEMINI_4_HYDROGEN_MODEL, effort: "high" },
  "gemini-4-hydrogen-xhigh": { model: GEMINI_4_HYDROGEN_MODEL, effort: "xhigh" },
};

/**
 * Canonical base model and effort carried by a suffixed Cloud Code Gemini 4
 * requested model, if any. Only byte-exact canonical ids qualify: the planner
 * normalizes `gemini-4-{argon,neon,hydrogen}-<effort>` to the bare canonical
 * target with no effort, so the suffix is otherwise lost before the Cloud Code
 * wire. Argon supports `low|medium|high`; Neon and Hydrogen also support
 * `xhigh` (llm-mesh 0.38.4).
 */
export function cloudCodeSuffixTarget(
  requestedModel: string,
):
  | {
      readonly model: CloudCodeSuffixedModel;
      readonly effort: CloudCodeSuffixEffort;
    }
  | undefined {
  // Byte-exact like the planner's normalizeExactModelId / isExactModelTarget:
  // a non-canonical spelling must fall through to the planner's graceful
  // unknown-model refusal, never to a targetCandidatesOverride that the
  // exact-model gate would reject with a contract error.
  return Object.hasOwn(SUFFIXED_CLOUD_CODE_TARGETS, requestedModel)
    ? SUFFIXED_CLOUD_CODE_TARGETS[requestedModel]
    : undefined;
}

/**
 * Planner override that carries a suffixed Cloud Code Gemini 4 model's effort
 * as `target.effort` when the client supplied none. The directory copies only
 * `target.effort` into `reasoning.effort`, which the Cloud Code client expands
 * to the suffixed wire model (`gemini-4-{argon,neon,hydrogen}-<effort>`);
 * without it the wire falls back to the bare canonical model (404
 * `model_not_found`). An explicit client effort owns the wire and suppresses
 * the override.
 */
export function cloudCodeEffortOverride(
  requestedModel: string,
  clientEffort: string | undefined,
):
  | readonly {
      providerId: "gemini";
      transportProviderId: "cloud-code";
      model: CloudCodeSuffixedModel;
      effort: CloudCodeSuffixEffort;
    }[]
  | undefined {
  const target = cloudCodeSuffixTarget(requestedModel);
  if (!target || clientEffort !== undefined) return undefined;
  return [
    {
      providerId: "gemini",
      transportProviderId: "cloud-code",
      model: target.model,
      effort: target.effort,
    },
  ];
}

/**
 * Effort suffix carried by a suffixed Argon requested model, if any.
 * Kept as a narrow helper over `cloudCodeSuffixTarget` for Argon-only callers.
 */
export function argonSuffixEffort(
  requestedModel: string,
): "low" | "medium" | "high" | undefined {
  const target = cloudCodeSuffixTarget(requestedModel);
  if (!target || target.model !== GEMINI_4_ARGON_MODEL || target.effort === "xhigh") {
    return undefined;
  }
  return target.effort;
}

/**
 * Planner override for suffixed Argon models (backwards-compatible wrapper
 * over `cloudCodeEffortOverride`).
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

function extractPlanErrorTrace(error: unknown): {
  readonly code?: string;
  readonly diagnostics?: readonly { readonly code?: string; readonly transport?: string }[];
} {
  if (!error || typeof error !== "object") return {};
  const rec = error as Record<string, unknown>;
  const code = typeof rec.code === "string" ? rec.code : undefined;
  const rawList = Array.isArray(rec.diagnostics)
    ? rec.diagnostics
    : rec.diagnostic && typeof rec.diagnostic === "object"
      ? [rec.diagnostic]
      : [];
  const diagnostics: { readonly code?: string; readonly transport?: string }[] = [];
  for (const item of rawList) {
    if (!item || typeof item !== "object") continue;
    const d = item as Record<string, unknown>;
    const dCode = typeof d.code === "string" ? d.code : undefined;
    const dTransport = typeof d.transportProviderId === "string" ? d.transportProviderId : undefined;
    if (dCode || dTransport) {
      diagnostics.push({
        ...(dCode ? { code: dCode } : {}),
        ...(dTransport ? { transport: dTransport } : {}),
      });
    }
  }
  return {
    ...(code ? { code } : {}),
    ...(diagnostics.length > 0 ? { diagnostics } : {}),
  };
}

const observablePlanner = (delegate: RoutePlanner): RoutePlanner => ({
  ...(delegate.listModels
    ? { listModels: (subject) => delegate.listModels!(subject) }
    : {}),
  async plan(subject: VerifiedRoutingSubject, input: RoutePlanInput) {
    const trace = requestTraceStorage.getStore();
    if (trace && !trace.requestedModel) {
      trace.requestedModel = input.requestedModel;
    }
    try {
      const plan = await delegate.plan(subject, input);
      const session = lookupSessionById(subject.principalRef);
      if (session) recordRoutePlan(session, input, plan);
      if (trace) {
        trace.negativeCacheTtlMs = plan.policy.negativeCacheTtlMs;
        for (const diag of plan.diagnostics) {
          const entry = {
            candidateRef: diag.candidateRef,
            provider: diag.actualProviderId,
            model: diag.actualModelId,
            transport: diag.actualTransportProviderId,
            accountId: diag.diagnosticAccountRef,
          };
          trace.plannedByCandidate.set(diag.candidateRef, entry);
          if (!trace.resolved) trace.resolved = entry;
        }
      }
      return plan;
    } catch (error) {
      if (trace) {
        trace.planError = extractPlanErrorTrace(error);
      }
      throw error;
    }
  },
  async prepareAttempt(subject, planRef, candidateRef, requestId, attemptIndex) {
    const trace = requestTraceStorage.getStore();
    const diag = trace?.plannedByCandidate.get(candidateRef);
    if (trace && diag) trace.resolved = diag;
    const attempt = await delegate.prepareAttempt(
      subject,
      planRef,
      candidateRef,
      requestId,
      attemptIndex,
    );
    if (!trace) return attempt;

    const recordAttemptOutcome = (outcome: string, retryAfterMs?: number): void => {
      const target = diag ?? trace.resolved;
      const retryAfterSeconds = typeof retryAfterMs === "number" && retryAfterMs > 0
        ? Math.ceil(retryAfterMs / 1000)
        : undefined;
      trace.attempts.push({
        provider: target?.provider ?? "unknown",
        model: target?.model ?? "unknown",
        transport: target?.transport ?? "unknown",
        accountId: target?.accountId ?? "unknown",
        outcome,
        ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
      });
    };

    const noteThrownIfUnobserved = (beforeCount: number, error: unknown): void => {
      if (trace.upstreamFailures.length > beforeCount) return;
      const sanitized = extractSanitizedThrownError(error);
      if (sanitized) trace.upstreamFailures.push(sanitized);
    };

    return {
      ...attempt,
      async generate(request) {
        const beforeCount = trace.upstreamFailures.length;
        try {
          return await attempt.generate(request);
        } catch (error) {
          noteThrownIfUnobserved(beforeCount, error);
          throw error;
        }
      },
      async stream(request) {
        const beforeCount = trace.upstreamFailures.length;
        let iterable: Awaited<ReturnType<typeof attempt.stream>>;
        try {
          iterable = await attempt.stream(request);
        } catch (error) {
          noteThrownIfUnobserved(beforeCount, error);
          throw error;
        }
        return (async function* () {
          try {
            for await (const event of iterable) {
              if (event && typeof event === "object" && (event as { type?: unknown }).type === "error") {
                noteThrownIfUnobserved(beforeCount, (event as { data?: unknown }).data);
              }
              yield event;
            }
          } catch (error) {
            noteThrownIfUnobserved(beforeCount, error);
            throw error;
          }
        })();
      },
      async recordOutcome(classification, usage) {
        recordAttemptOutcome(classification.reason, classification.retryAfterMs);
        return attempt.recordOutcome(classification, usage);
      },
      async complete(usage) {
        recordAttemptOutcome("success");
        return attempt.complete(usage);
      },
      async releaseCancelled() {
        recordAttemptOutcome("cancelled");
        return attempt.releaseCancelled();
      },
    };
  },
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
  /** Optional upstream fetch override (test seam); wrapped with sanitized observer. */
  readonly upstreamFetch?: typeof fetch;
  /** Optional structured log sink (test seam); defaults to process.stdout.write. */
  readonly writeLog?: (line: string) => void;
  /**
   * Explicit Cloud Code upstream fetch override (test seam). Wrapped by
   * createCloudCodeRetryFetch and createObservedUpstreamFetch.
   */
  readonly cloudCodeFetch?: typeof fetch;
  /** Bounded Cloud Code 429 retry policy override (mainly for tests). */
  readonly cloudCodeRetry?: CloudCodeRetryPolicy;
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

async function readRequestedModelFromRaw(raw: Request, pathname: string): Promise<string | undefined> {
  if (raw.method !== "POST") return undefined;
  if (!INFERENCE_ROUTES.has(pathname) && pathname !== "/v1/messages/count_tokens") return undefined;
  try {
    const text = await raw.clone().text();
    if (!text) return undefined;
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
    const model = (parsed as Record<string, unknown>).model;
    return typeof model === "string" && model.trim() ? model.trim() : undefined;
  } catch {
    return undefined;
  }
}

export class GatewayAlreadyRunningError extends Error {
  readonly code = "EADDRINUSE" as const;
  readonly port: number;
  readonly existingPid?: number;

  constructor(port: number, existingPid?: number) {
    super(
      `Gateway is already running on 127.0.0.1:${port}` +
        (existingPid ? ` (pid ${existingPid})` : ""),
    );
    this.name = "GatewayAlreadyRunningError";
    this.port = port;
    if (existingPid !== undefined) this.existingPid = existingPid;
  }
}

async function probeLocalGatewayOnPort(
  port: number,
  timeoutMs = 1_500,
): Promise<{ readonly running: true; readonly pid?: number } | { readonly running: false }> {
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    let resp = await fetch(`${baseUrl}/readyz`, { signal: AbortSignal.timeout(timeoutMs) });
    if (resp.status === 404) {
      resp = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(timeoutMs) });
    }
    if (!resp.ok) return { running: false };
    const rawPid = resp.headers.get("x-h2a-gateway-pid");
    const parsedPid = rawPid ? Number.parseInt(rawPid, 10) : Number.NaN;
    return Number.isInteger(parsedPid) && parsedPid > 0
      ? { running: true, pid: parsedPid }
      : { running: true };
  } catch {
    return { running: false };
  }
}

export function createGatewayHost(options: LocalGatewayAppOptions = {}): { app: Hono; ready: Promise<void> } {
  let composed = false;
  const readiness = { async isReady() { return composed; } };
  // Claude seat like every other seat: an explicit override wins (test seam),
  // otherwise compose the PATH-resolved seat unconditionally.
  const claudeClient = options.claudeClient ?? createClaudeSeatClient();
  const rawBaseFetch: typeof fetch = options.upstreamFetch ?? ((input, init) => fetch(input, init));
  const upstreamFetch = createObservedUpstreamFetch(rawBaseFetch);
  const writeLog = options.writeLog ?? ((line: string) => { process.stdout.write(line); });
  const rateLimitTracker = new RateLimitCooldownTracker();
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
  const cloudCodeRetryPolicy: CloudCodeRetryPolicy = {
    onLog: (event) => writeLog(formatCloudCodeRetryLogLine(event)),
    ...options.cloudCodeRetry,
  };
  const cloudCodeFetch = createObservedUpstreamFetch(
    createCloudCodeRetryFetch(options.cloudCodeFetch ?? rawBaseFetch, cloudCodeRetryPolicy),
  );
  const facade = createCliLlmMeshFacade();
  const profiles = routingProfiles(routing);
  const planner = observablePlanner(
    options.routePlanner ??
      facade.createRoutePlanner(runtimeMesh(claudeClient, upstreamFetch, cloudCodeFetch), {
        ...(routing?.council ? { council: routing.council } : {}),
        ...(profiles ? { profiles } : {}),
      }),
  );
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

  async function allMatchingAccountsInPersistedCooldown(
    requestedModel: string,
  ): Promise<boolean> {
    if (options.routePlanner) return false;
    try {
      const accounts = await facade.listAccounts({ ownerScope: ownerScopeRef });
      if (accounts.length === 0) return false;
      const activeRouting = currentRouting();
      const allowEquivalent = activeRouting?.policy?.allowEquivalentModels ?? false;
      const explicitTransport = activeRouting?.explicit?.transportProviderId;
      const resolution = resolveRequestedTargets({ requestedModel }, allowEquivalent);
      const candidateTransports = new Set<string>();
      if (explicitTransport) {
        candidateTransports.add(explicitTransport);
      } else if (resolution.kind === "known") {
        for (const target of resolution.targets) {
          if (typeof target.transportProviderId === "string") {
            candidateTransports.add(target.transportProviderId);
          }
        }
      }
      if (candidateTransports.size === 0) return false;
      const matching = accounts.filter((account) => candidateTransports.has(account.providerId));
      return matching.length > 0 && matching.every((account) => account.status === "cooldown");
    } catch {
      return false;
    }
  }

  const app = new Hono();
  let gatewayPlugin: Hono | undefined;
  app.get("/health", (c) => c.json({ ok: true }));
  // This route also covers the interval before the composed router is mounted.
  app.get("/readyz", async (c) => {
    const ready = await readiness.isReady();
    c.header("x-h2a-gateway-pid", String(process.pid));
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
    let pathname = "/";
    try {
      pathname = new URL(c.req.raw.url).pathname;
    } catch {
      pathname = c.req.path;
    }
    const trace = createRequestTrace(c.req.raw.method, pathname);
    return requestTraceStorage.run(trace, async () => {
      const routed = await rewriteRequestIfMatched(c.req.raw, modelRewrites);
      if (routed.fromModel && routed.toModel) {
        trace.requestedModel = routed.fromModel;
        trace.rewrittenModel = routed.toModel;
      } else {
        const rawModel = await readRequestedModelFromRaw(c.req.raw, pathname);
        if (rawModel) trace.requestedModel = rawModel;
      }

      let response = await gatewayPlugin!.fetch(routed.request, c.env);
      const effectiveModel = routed.toModel ?? trace.requestedModel;
      const lastAttempt = trace.attempts.at(-1);
      let lastUpstream: SanitizedUpstreamError | undefined = trace.upstreamFailures.at(-1);
      const allAttemptsRateLimited =
        trace.attempts.length > 0 &&
        trace.attempts.every((attempt) => attempt.outcome === "rate-limited");
      const allUpstream429 =
        trace.upstreamFailures.length > 0 &&
        trace.upstreamFailures.every((failure) => failure.status === 429);
      let retryAfterSeconds =
        parseRetryAfterHeaderSeconds(response.headers.get("retry-after")) ??
        lastUpstream?.retryAfterSeconds ??
        lastAttempt?.retryAfterSeconds;

      if (response.status >= 200 && response.status < 300) {
        if (effectiveModel) rateLimitTracker.clear(ownerScopeRef, effectiveModel);
        if (trace.requestedModel && trace.requestedModel !== effectiveModel) {
          rateLimitTracker.clear(ownerScopeRef, trace.requestedModel);
        }
      } else if (
        effectiveModel &&
        (response.status === 429 || allAttemptsRateLimited || allUpstream429)
      ) {
        const ttlMs =
          retryAfterSeconds !== undefined && retryAfterSeconds > 0
            ? retryAfterSeconds * 1000
            : Math.max(trace.negativeCacheTtlMs ?? 300_000, 60_000);
        rateLimitTracker.record(ownerScopeRef, effectiveModel, {
          ttlMs,
          ...(trace.resolved?.provider ? { provider: trace.resolved.provider } : {}),
          ...(trace.resolved?.model ? { model: trace.resolved.model } : {}),
          ...(trace.resolved?.transport ? { transport: trace.resolved.transport } : {}),
          ...(trace.resolved?.accountId ? { accountId: trace.resolved.accountId } : {}),
          ...(lastUpstream ? { upstream: lastUpstream } : {}),
        });
      }

      // h2a-side upstream-429 preservation: never mask an upstream 429 (or an
      // active rate-limit cooldown / negative-cache suppression from a prior
      // upstream 429) as 503 "No route available". Real route absences and
      // reauth/reenrollment diagnostics stay 503.
      let remappedFrom: number | undefined;
      let resolvedProvider = trace.resolved?.provider ?? lastAttempt?.provider ?? null;
      let resolvedModel = trace.resolved?.model ?? lastAttempt?.model ?? null;
      let resolvedTransport = trace.resolved?.transport ?? lastAttempt?.transport ?? null;
      let resolvedAccountId = trace.resolved?.accountId ?? lastAttempt?.accountId ?? null;

      if (
        response.status === 503 &&
        INFERENCE_ROUTES.has(pathname) &&
        !response.headers.has("x-sentropic-route-action")
      ) {
        if (allAttemptsRateLimited || allUpstream429) {
          const remapRetry = retryAfterSeconds ?? 60;
          remappedFrom = 503;
          retryAfterSeconds = remapRetry;
          response = remapRateLimited503Response(response, pathname, remapRetry);
        } else if (trace.planError?.code === "no-route" && effectiveModel) {
          const activeCooldown = rateLimitTracker.getActive(ownerScopeRef, effectiveModel);
          if (activeCooldown) {
            remappedFrom = 503;
            retryAfterSeconds = activeCooldown.remainingSeconds;
            resolvedProvider = resolvedProvider ?? activeCooldown.provider ?? null;
            resolvedModel = resolvedModel ?? activeCooldown.model ?? null;
            resolvedTransport = resolvedTransport ?? activeCooldown.transport ?? null;
            resolvedAccountId = resolvedAccountId ?? activeCooldown.accountId ?? null;
            lastUpstream = lastUpstream ?? activeCooldown.upstream;
            response = remapRateLimited503Response(
              response,
              pathname,
              activeCooldown.remainingSeconds,
            );
          } else if (await allMatchingAccountsInPersistedCooldown(effectiveModel)) {
            remappedFrom = 503;
            retryAfterSeconds = 60;
            response = remapRateLimited503Response(response, pathname, 60);
          }
        }
      }

      const latencyMs = Math.max(0, Date.now() - trace.startedAtMs);
      const outcome =
        response.status >= 200 && response.status < 300
          ? "success"
          : lastAttempt?.outcome ?? trace.planError?.code ?? (response.status === 401 ? "unauthorized" : undefined);

      const logEntry: GatewayRequestLogEntry = {
        time: trace.time,
        route: pathname,
        method: trace.method,
        requestedModel: trace.requestedModel ?? null,
        ...(trace.rewrittenModel && response.status !== 401 ? { rewrittenModel: trace.rewrittenModel } : {}),
        provider: resolvedProvider,
        model: resolvedModel,
        transport: resolvedTransport,
        accountId: resolvedAccountId,
        status: response.status,
        latencyMs,
        ...(outcome ? { outcome } : {}),
        ...(trace.planError?.code ? { planError: trace.planError.code } : {}),
        ...(trace.planError?.diagnostics ? { planDiagnostics: trace.planError.diagnostics } : {}),
        ...(remappedFrom !== undefined ? { remappedFrom } : {}),
        ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
        ...(lastUpstream ? { upstream: lastUpstream } : {}),
        ...(trace.attempts.length > 1 || (trace.attempts.length === 1 && response.status >= 400)
          ? { attempts: trace.attempts }
          : {}),
      };
      writeLog(formatGatewayRequestLogLine(logEntry));

      if (!routed.fromModel || !routed.toModel) return response;
      // An unauthenticated caller learns nothing and leaves no rewrite log line.
      if (response.status === 401) return response;
      if (routed.logLine) writeLog(routed.logLine);
      const visible = new Response(response.body, response);
      visible.headers.set("x-h2a-model-rewrite", `${routed.fromModel} -> ${routed.toModel}`);
      return visible;
    });
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
            const effortOverride = cloudCodeEffortOverride(
              request.model,
              canonical.request.reasoning?.effort,
            );
            return {
              affinityKey: session?.clientSessionId ?? cost.principalId,
              ...(session?.workspaceId ? { workspaceId: session.workspaceId } : {}),
              ...(activeRouting?.policy ? { policyOverride: activeRouting.policy } : {}),
              ...(activeRouting?.activeProfile ? { policyProfile: activeRouting.activeProfile } : {}),
              ...(activeRouting?.explicit ? { explicit: activeRouting.explicit } : {}),
              ...(effortOverride ? { targetCandidatesOverride: effortOverride } : {}),
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
  return await new Promise<ReturnType<typeof serve>>((resolveServer, rejectServer) => {
    let settled = false;
    let server: ReturnType<typeof serve> | undefined;
    const onListening = () => {
      if (settled) return;
      settled = true;
      if (server && typeof (server as { off?: unknown }).off === "function") {
        (server as unknown as { off(event: string, fn: (...args: unknown[]) => void): void })
          .off("error", onError);
      }
      process.stdout.write(
        `[gateway-host] listening on :${port} — ${sessionCount()} local bearers\n`,
      );
      if (server !== undefined) resolveServer(server);
    };
    const onError = (error: unknown) => {
      if (settled) return;
      settled = true;
      const err = error as NodeJS.ErrnoException;
      if (err?.code === "EADDRINUSE") {
        void probeLocalGatewayOnPort(port).then(
          (probe) => {
            if (probe.running) {
              rejectServer(new GatewayAlreadyRunningError(port, probe.pid));
            } else {
              const occupied = new Error(
                `Port 127.0.0.1:${port} is already in use by another process`,
              ) as NodeJS.ErrnoException;
              occupied.code = "EADDRINUSE";
              rejectServer(occupied);
            }
          },
          () => rejectServer(error),
        );
        return;
      }
      rejectServer(error);
    };

    try {
      server = listen({ fetch: app.fetch, port, hostname: "127.0.0.1" }, onListening);
    } catch (error) {
      onError(error);
      return;
    }

    if (settled) {
      resolveServer(server);
      return;
    }

    if (server && typeof (server as { once?: unknown }).once === "function") {
      (server as unknown as { once(event: string, fn: (...args: unknown[]) => void): void })
        .once("error", onError);
    } else {
      settled = true;
      resolveServer(server);
    }
  });
}

export function handleGatewayStartupError(
  error: unknown,
  stdout: (chunk: string) => unknown = (chunk) => process.stdout.write(chunk),
  stderr: (chunk: string) => unknown = (chunk) => process.stderr.write(chunk),
): number {
  if (error instanceof GatewayAlreadyRunningError) {
    stdout(`[gateway-host] ${error.message}; reusing running gateway and exiting cleanly\n`);
    return 0;
  }
  const err = error as NodeJS.ErrnoException | undefined;
  if (err?.code === "EADDRINUSE") {
    stderr(`[gateway-host] ${err.message}\n`);
    return 1;
  }
  stderr(
    `[gateway-host] startup failed before bind: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  return 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startServer().catch((error: unknown) => {
    process.exitCode = handleGatewayStartupError(error);
  });
}
