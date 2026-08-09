import type {
  RouteDiagnostic,
  RoutePlan,
  RoutePlanInput,
} from "@sentropic/llm-mesh";
import type { RouteRequestSettlement } from "@sentropic/llm-gateway";
import type { SessionEntry } from "./sticky.js";

export type GatewaySessionState = "idle" | "active" | "rate-limited";

export interface PublicAccountDescriptor {
  /** Redacted mesh diagnostic reference, never an executable account id. */
  readonly id: string;
  readonly provider: string;
  readonly label: string;
}

export interface GatewayRateLimitSnapshot {
  readonly at: string;
  readonly account: PublicAccountDescriptor;
  readonly retryAfterMs?: number;
}

export interface GatewayFallbackSnapshot {
  readonly at: string;
  readonly from: PublicAccountDescriptor;
  readonly to: PublicAccountDescriptor;
}

export interface SessionLedgerEntry {
  readonly gatewaySessionId: string;
  readonly clientSessionId: string;
  readonly workspaceId?: string;
  readonly profile?: string;
  readonly account: PublicAccountDescriptor;
  readonly transport: string;
  readonly state: GatewaySessionState;
  readonly requestedModel?: string;
  readonly modelId?: string;
  readonly upstreamModel?: string;
  readonly routePolicy?: string;
  readonly routeReason?: string;
  readonly createdAt: string;
  readonly lastUsedAt: string;
  readonly updatedAt: string;
  readonly requestCount: number;
  readonly inFlightRequests: number;
  readonly detailsAmbiguous: boolean;
  readonly lastRateLimit?: GatewayRateLimitSnapshot;
  readonly lastFallback?: GatewayFallbackSnapshot;
}

interface PlannedRequest {
  readonly session: SessionEntry;
  readonly input: RoutePlanInput;
  readonly plan: RoutePlan;
  readonly diagnostics: ReadonlyMap<string, RouteDiagnostic>;
}

const ledger = new Map<string, SessionLedgerEntry>();
const byClientSession = new Map<string, string>();
const plansByCandidate = new Map<string, PlannedRequest>();

const unselectedAccount = (provider = "mesh"): PublicAccountDescriptor => ({
  id: "unselected",
  provider,
  label: "unselected",
});

const accountFromDiagnostic = (diagnostic: RouteDiagnostic): PublicAccountDescriptor => ({
  id: diagnostic.diagnosticAccountRef,
  provider: diagnostic.actualProviderId,
  label: diagnostic.diagnosticAccountRef,
});

export function recordRoutePlan(
  session: SessionEntry,
  input: RoutePlanInput,
  plan: RoutePlan,
  now = new Date(),
): void {
  const diagnostics = new Map(plan.diagnostics.map((value) => [value.candidateRef, value]));
  const request: PlannedRequest = { session, input, plan, diagnostics };
  for (const candidateRef of plan.candidateRefs) plansByCandidate.set(candidateRef, request);
  const at = now.toISOString();
  const existing = ledger.get(session.sessionId);
  const first = plan.diagnostics[0];
  const detailsAmbiguous = (existing?.inFlightRequests ?? 0) > 0;
  const entry: SessionLedgerEntry = {
    gatewaySessionId: session.sessionId,
    clientSessionId: session.clientSessionId,
    ...(session.workspaceId ? { workspaceId: session.workspaceId } : {}),
    ...(session.profile ? { profile: session.profile } : {}),
    account: detailsAmbiguous || !first
      ? unselectedAccount()
      : accountFromDiagnostic(first),
    transport: detailsAmbiguous || !first ? "mesh" : first.actualTransportProviderId,
    state: "active",
    ...(detailsAmbiguous ? {} : {
      requestedModel: input.requestedModel,
      ...(first ? {
        modelId: first.actualModelId,
        upstreamModel: first.actualModelId,
        routeReason: first.reason,
      } : {}),
      routePolicy: plan.policy.strategy.kind,
    }),
    createdAt: existing?.createdAt ?? at,
    lastUsedAt: at,
    updatedAt: at,
    requestCount: (existing?.requestCount ?? 0) + 1,
    inFlightRequests: (existing?.inFlightRequests ?? 0) + 1,
    detailsAmbiguous,
    ...(existing?.lastRateLimit ? { lastRateLimit: existing.lastRateLimit } : {}),
    ...(existing?.lastFallback ? { lastFallback: existing.lastFallback } : {}),
  };
  ledger.set(session.sessionId, entry);
  byClientSession.set(session.clientSessionId, session.sessionId);
}

export function recordRouteSettlement(
  settlement: RouteRequestSettlement,
  now = new Date(),
): void {
  const lastAttempt = settlement.attempts.at(-1);
  const planned = lastAttempt ? plansByCandidate.get(lastAttempt.candidateRef) : undefined;
  const sessionId = planned?.session.sessionId ?? settlement.cost.principalId;
  const existing = ledger.get(sessionId);
  if (!existing) return;
  const diagnostic = lastAttempt ? planned?.diagnostics.get(lastAttempt.candidateRef) : undefined;
  const at = now.toISOString();
  const inFlightRequests = Math.max(0, existing.inFlightRequests - 1);
  const rateLimited = lastAttempt?.outcome === "rate-limited";
  const detailsAmbiguous = inFlightRequests > 0;
  const account = diagnostic ? accountFromDiagnostic(diagnostic) : existing.account;
  const firstAttempt = settlement.attempts[0];
  const firstDiagnostic = firstAttempt
    ? planned?.diagnostics.get(firstAttempt.candidateRef)
    : undefined;
  const fallback = firstDiagnostic && diagnostic
    && firstDiagnostic.candidateRef !== diagnostic.candidateRef
    ? {
        at,
        from: accountFromDiagnostic(firstDiagnostic),
        to: account,
      }
    : undefined;
  const entry: SessionLedgerEntry = {
    ...existing,
    account: detailsAmbiguous ? unselectedAccount() : account,
    transport: detailsAmbiguous
      ? "mesh"
      : diagnostic?.actualTransportProviderId ?? existing.transport,
    state: inFlightRequests > 0 ? "active" : rateLimited ? "rate-limited" : "idle",
    ...(detailsAmbiguous ? {} : {
      requestedModel: settlement.requestedModel,
      ...(diagnostic ? {
        modelId: diagnostic.actualModelId,
        upstreamModel: diagnostic.actualModelId,
        routeReason: diagnostic.reason,
      } : {}),
    }),
    lastUsedAt: at,
    updatedAt: at,
    inFlightRequests,
    detailsAmbiguous,
    ...(rateLimited ? {
      lastRateLimit: { at, account },
    } : {}),
    ...(fallback ? { lastFallback: fallback } : {}),
  };
  ledger.set(sessionId, entry);
  if (planned) {
    for (const candidateRef of planned.plan.candidateRefs) plansByCandidate.delete(candidateRef);
  }
}

export function listSessionLedger(): SessionLedgerEntry[] {
  return [...ledger.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function getSessionLedgerEntry(sessionId: string): SessionLedgerEntry | undefined {
  return ledger.get(sessionId);
}

export function getSessionLedgerEntryForClient(
  clientSessionId: string,
): SessionLedgerEntry | undefined {
  const sessionId = byClientSession.get(clientSessionId);
  return sessionId ? ledger.get(sessionId) : undefined;
}

export function resetSessionLedger(): void {
  ledger.clear();
  byClientSession.clear();
  plansByCandidate.clear();
}
