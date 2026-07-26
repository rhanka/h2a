import type { AccountDescriptor, PublicAccountDescriptor } from "./accounts.js";
import {
  publicAccountDescriptor,
  upstreamTransportForAccount,
  type GatewayUpstreamTransport,
} from "./accounts.js";
import type { RoutingTarget } from "./model-catalog.js";

export type GatewaySessionState = "idle" | "active" | "rate-limited";

export interface GatewayRateLimitSnapshot {
  at: string;
  account: PublicAccountDescriptor;
  retryAfterMs?: number;
}

export interface GatewayFallbackSnapshot {
  at: string;
  from: PublicAccountDescriptor;
  to: PublicAccountDescriptor;
}

export interface SessionLedgerEntry {
  gatewaySessionId: string;
  clientSessionId: string;
  workspaceId?: string;
  profile?: string;
  account: PublicAccountDescriptor;
  transport: GatewayUpstreamTransport;
  state: GatewaySessionState;
  requestedModel?: string;
  modelId?: string;
  upstreamModel?: string;
  routePolicy?: string;
  routeReason?: string;
  createdAt: string;
  lastUsedAt: string;
  updatedAt: string;
  requestCount: number;
  /** Requests whose response body (or terminal error response) is not complete. */
  inFlightRequests: number;
  /** Overlapping requests made singular route/account details non-attributable. */
  detailsAmbiguous: boolean;
  lastRateLimit?: GatewayRateLimitSnapshot;
  /** Recorded only after a rebind actually succeeds; never inferred from account changes. */
  lastFallback?: GatewayFallbackSnapshot;
}

export interface UpsertSessionLedgerInput {
  gatewaySessionId: string;
  clientSessionId?: string;
  workspaceId?: string;
  profile?: string;
  account: AccountDescriptor;
  route?: RoutingTarget;
  now?: Date;
}

const _ledger = new Map<string, SessionLedgerEntry>();

function timestamp(now = new Date()): string {
  return now.toISOString();
}

function routeFields(route?: RoutingTarget): Partial<SessionLedgerEntry> {
  if (!route) return {};
  return {
    ...(route.requestedModel ? { requestedModel: route.requestedModel } : {}),
    ...(route.catalogModelId ? { modelId: route.catalogModelId } : {}),
    ...(route.upstreamModel ? { upstreamModel: route.upstreamModel } : {}),
    routePolicy: route.routingPolicy,
    routeReason: route.routeReason,
  };
}

function existingRouteFields(
  entry: SessionLedgerEntry | undefined,
): Partial<SessionLedgerEntry> {
  if (!entry) return {};
  return {
    ...(entry.requestedModel ? { requestedModel: entry.requestedModel } : {}),
    ...(entry.modelId ? { modelId: entry.modelId } : {}),
    ...(entry.upstreamModel ? { upstreamModel: entry.upstreamModel } : {}),
    ...(entry.routePolicy ? { routePolicy: entry.routePolicy } : {}),
    ...(entry.routeReason ? { routeReason: entry.routeReason } : {}),
  };
}

export function upsertSessionLedger(
  input: UpsertSessionLedgerInput,
): SessionLedgerEntry {
  const now = timestamp(input.now);
  const existing = _ledger.get(input.gatewaySessionId);
  const workspaceId = input.workspaceId ?? existing?.workspaceId;
  const profile = input.profile ?? existing?.profile;
  const account = publicAccountDescriptor(input.account);
  const entry: SessionLedgerEntry = {
    gatewaySessionId: input.gatewaySessionId,
    clientSessionId:
      input.clientSessionId ??
      existing?.clientSessionId ??
      input.gatewaySessionId,
    ...(workspaceId ? { workspaceId } : {}),
    ...(profile ? { profile } : {}),
    account,
    transport: upstreamTransportForAccount(input.account),
    state: existing?.state ?? "idle",
    ...existingRouteFields(existing),
    ...routeFields(input.route),
    createdAt: existing?.createdAt ?? now,
    lastUsedAt: now,
    updatedAt: now,
    requestCount: existing?.requestCount ?? 0,
    inFlightRequests: existing?.inFlightRequests ?? 0,
    detailsAmbiguous: existing?.detailsAmbiguous ?? false,
    ...(existing?.lastRateLimit
      ? { lastRateLimit: existing.lastRateLimit }
      : {}),
    ...(existing?.lastFallback ? { lastFallback: existing.lastFallback } : {}),
  };
  _ledger.set(entry.gatewaySessionId, entry);
  return entry;
}

export function recordSessionRequest(
  gatewaySessionId: string | undefined,
  route?: RoutingTarget,
  now = new Date(),
): SessionLedgerEntry | undefined {
  if (!gatewaySessionId) return undefined;
  const existing = _ledger.get(gatewaySessionId);
  if (!existing) return undefined;
  const withoutRoute = { ...existing };
  delete withoutRoute.requestedModel;
  delete withoutRoute.modelId;
  delete withoutRoute.upstreamModel;
  delete withoutRoute.routePolicy;
  delete withoutRoute.routeReason;
  delete withoutRoute.lastFallback;
  const detailsAmbiguous = existing.inFlightRequests > 0;
  const entry: SessionLedgerEntry = {
    ...withoutRoute,
    ...(detailsAmbiguous ? {} : routeFields(route)),
    state: "active",
    lastUsedAt: timestamp(now),
    updatedAt: timestamp(now),
    requestCount: existing.requestCount + 1,
    inFlightRequests: existing.inFlightRequests + 1,
    detailsAmbiguous,
  };
  _ledger.set(gatewaySessionId, entry);
  return entry;
}

export function recordSessionActive(
  gatewaySessionId: string | undefined,
  route?: RoutingTarget,
  now = new Date(),
): SessionLedgerEntry | undefined {
  if (!gatewaySessionId) return undefined;
  const existing = _ledger.get(gatewaySessionId);
  if (!existing) return undefined;
  const entry: SessionLedgerEntry = {
    ...existing,
    ...(existing.detailsAmbiguous ? {} : routeFields(route)),
    state: "active",
    lastUsedAt: timestamp(now),
    updatedAt: timestamp(now),
  };
  _ledger.set(gatewaySessionId, entry);
  return entry;
}

export function recordSessionIdle(
  gatewaySessionId: string | undefined,
  route?: RoutingTarget,
  now = new Date(),
): SessionLedgerEntry | undefined {
  if (!gatewaySessionId) return undefined;
  const existing = _ledger.get(gatewaySessionId);
  if (!existing) return undefined;
  const inFlightRequests = Math.max(0, existing.inFlightRequests - 1);
  const entry: SessionLedgerEntry = {
    ...existing,
    ...(existing.detailsAmbiguous ? {} : routeFields(route)),
    state: inFlightRequests > 0 ? "active" : "idle",
    lastUsedAt: timestamp(now),
    updatedAt: timestamp(now),
    inFlightRequests,
  };
  _ledger.set(gatewaySessionId, entry);
  return entry;
}

export function recordSessionFallback(
  gatewaySessionId: string | undefined,
  from: AccountDescriptor,
  to: AccountDescriptor,
  route?: RoutingTarget,
  now = new Date(),
): SessionLedgerEntry | undefined {
  if (!gatewaySessionId) return undefined;
  const existing = _ledger.get(gatewaySessionId);
  if (!existing) return undefined;
  const at = timestamp(now);
  const entry: SessionLedgerEntry = {
    ...existing,
    ...(existing.detailsAmbiguous || !route ? {} : routeFields(route)),
    account: publicAccountDescriptor(to),
    transport: upstreamTransportForAccount(to),
    state: "active",
    lastUsedAt: at,
    updatedAt: at,
    ...(existing.detailsAmbiguous
      ? {}
      : {
          lastFallback: {
            at,
            from: publicAccountDescriptor(from),
            to: publicAccountDescriptor(to),
          },
        }),
  };
  _ledger.set(gatewaySessionId, entry);
  return entry;
}

export function recordSessionRateLimited(
  gatewaySessionId: string | undefined,
  account: AccountDescriptor,
  options: {
    route?: RoutingTarget;
    retryAfterMs?: number;
    now?: Date;
  } = {},
): SessionLedgerEntry | undefined {
  if (!gatewaySessionId) return undefined;
  const existing = _ledger.get(gatewaySessionId);
  if (!existing) return undefined;
  const now = timestamp(options.now);
  const rateLimit: GatewayRateLimitSnapshot = {
    at: now,
    account: publicAccountDescriptor(account),
    ...(options.retryAfterMs !== undefined
      ? { retryAfterMs: options.retryAfterMs }
      : {}),
  };
  const entry: SessionLedgerEntry = {
    ...existing,
    ...(existing.detailsAmbiguous || !options.route
      ? {}
      : routeFields(options.route)),
    state: existing.inFlightRequests > 1 ? "active" : "rate-limited",
    lastUsedAt: now,
    updatedAt: now,
    lastRateLimit: rateLimit,
  };
  _ledger.set(gatewaySessionId, entry);
  return entry;
}

/** Complete a terminal 429 after fallback selection/rebind has failed. */
export function recordSessionRateLimitComplete(
  gatewaySessionId: string | undefined,
  route?: RoutingTarget,
  now = new Date(),
): SessionLedgerEntry | undefined {
  if (!gatewaySessionId) return undefined;
  const existing = _ledger.get(gatewaySessionId);
  if (!existing) return undefined;
  const inFlightRequests = Math.max(0, existing.inFlightRequests - 1);
  const at = timestamp(now);
  const entry: SessionLedgerEntry = {
    ...existing,
    ...(existing.detailsAmbiguous || !route ? {} : routeFields(route)),
    state: inFlightRequests > 0 ? "active" : "rate-limited",
    lastUsedAt: at,
    updatedAt: at,
    inFlightRequests,
  };
  _ledger.set(gatewaySessionId, entry);
  return entry;
}

export function listSessionLedger(): SessionLedgerEntry[] {
  return [..._ledger.values()].sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  );
}

export function getSessionLedgerEntry(
  gatewaySessionId: string,
): SessionLedgerEntry | undefined {
  return _ledger.get(gatewaySessionId);
}

export function resetSessionLedger(): void {
  _ledger.clear();
}
