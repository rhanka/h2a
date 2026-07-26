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
// Status polling addresses a tmux client session, not an implementation
// gateway id. Keep that correlation as an index so the status line never has
// to download and search the whole ledger.
const _ledgerByClientSessionId = new Map<string, Set<string>>();
// The value is omitted when two records are tied for freshest; a status line
// must say UNKNOWN rather than choose one arbitrary route.
const _freshestGatewayByClientSessionId = new Map<string, string | undefined>();

function removeClientIndex(clientSessionId: string, gatewaySessionId: string): void {
  const entries = _ledgerByClientSessionId.get(clientSessionId);
  if (!entries) return;
  entries.delete(gatewaySessionId);
  if (entries.size === 0) _ledgerByClientSessionId.delete(clientSessionId);
}

function addClientIndex(clientSessionId: string, gatewaySessionId: string): void {
  const entries = _ledgerByClientSessionId.get(clientSessionId) ?? new Set<string>();
  entries.add(gatewaySessionId);
  _ledgerByClientSessionId.set(clientSessionId, entries);
}

function refreshFreshestClientIndex(clientSessionId: string): void {
  const ids = _ledgerByClientSessionId.get(clientSessionId);
  if (!ids || ids.size === 0) {
    _freshestGatewayByClientSessionId.delete(clientSessionId);
    return;
  }
  let freshest: SessionLedgerEntry | undefined;
  let tied = false;
  for (const id of ids) {
    const entry = _ledger.get(id);
    if (!entry) continue;
    if (!freshest || entry.updatedAt > freshest.updatedAt) {
      freshest = entry;
      tied = false;
    } else if (entry.updatedAt === freshest.updatedAt) {
      tied = true;
    }
  }
  _freshestGatewayByClientSessionId.set(
    clientSessionId,
    !freshest || tied ? undefined : freshest.gatewaySessionId,
  );
}

function setLedgerEntry(entry: SessionLedgerEntry): void {
  _ledger.set(entry.gatewaySessionId, entry);
  refreshFreshestClientIndex(entry.clientSessionId);
}

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
    // Acquiring (or re-acquiring) a gateway session only selects a possible
    // route. It is not evidence that a request using that route left the
    // gateway. Route fields are written exclusively by the dispatch lifecycle.
    ...existingRouteFields(existing),
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
  if (existing && existing.clientSessionId !== entry.clientSessionId &&
      _ledgerByClientSessionId.has(existing.clientSessionId)) {
    removeClientIndex(existing.clientSessionId, entry.gatewaySessionId);
  }
  addClientIndex(entry.clientSessionId, entry.gatewaySessionId);
  refreshFreshestClientIndex(entry.clientSessionId);
  if (existing && existing.clientSessionId !== entry.clientSessionId) {
    refreshFreshestClientIndex(existing.clientSessionId);
  }
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
  setLedgerEntry(entry);
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
  setLedgerEntry(entry);
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
  setLedgerEntry(entry);
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
    // The caller passes a route only after its first actual dispatch. A
    // rebind may then retain that already-observed route while it updates the
    // account, but cannot manufacture a new one.
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
  setLedgerEntry(entry);
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
  setLedgerEntry(entry);
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
  setLedgerEntry(entry);
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

/** O(1) lookup for the exact client/tmux session status endpoint. */
export function getSessionLedgerEntryForClient(
  clientSessionId: string,
): SessionLedgerEntry | undefined {
  const gatewaySessionId = _freshestGatewayByClientSessionId.get(clientSessionId);
  return gatewaySessionId ? _ledger.get(gatewaySessionId) : undefined;
}

export function resetSessionLedger(): void {
  _ledger.clear();
  _ledgerByClientSessionId.clear();
  _freshestGatewayByClientSessionId.clear();
}
