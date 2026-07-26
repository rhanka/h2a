import type { PublicAccountDescriptor } from "./llm-gateway-runtime/accounts.js";
import type {
  GatewaySessionState,
  SessionLedgerEntry,
} from "./llm-gateway-runtime/session-ledger.js";
import { projectRemoteAgents, type RemoteAgentProjection } from "./agents-projection.js";
import {
  listJobs,
  listLive,
  localLsRows,
  type LocalLsRow,
} from "./registry.js";
import {
  currentTmuxSessionName,
  listLocalSessionsWithDiagnostics,
  readLaunchContext,
  type LocalSession,
} from "./tmux.js";
import type { LaunchContext } from "./launch-context.js";
import { legacyClientSessionIdForMigratedSession } from "./tmux-name-migration.js";

export type H2AGatewayStatusState =
  | "off"
  | GatewaySessionState
  | "unavailable"
  | "unknown";

export interface H2AGatewayStatusV1 {
  readonly state: H2AGatewayStatusState;
  readonly clientSessionId?: string;
  readonly gatewaySessionId?: string;
  readonly requestedModel?: string;
  readonly upstreamModel?: string;
  readonly provider?: string;
  readonly transport?: string;
  readonly accountId?: string;
  readonly accountLabel?: string;
  readonly previousAccountLabel?: string;
  readonly fallbackAccountLabel?: string;
  readonly retryAfterMs?: number;
  readonly updatedAt?: string;
  readonly reason?: string;
}

export interface H2AStatusRuntimeProjectionV1 {
  readonly kind: "h2a-status-runtime";
  readonly version: 1;
  readonly session: {
    readonly state: "present" | "absent" | "unknown";
    readonly tmuxSession?: string;
    readonly profile?: string;
    readonly path?: string;
    readonly launchContext?: LaunchContext;
  };
  readonly managed: {
    readonly agents: readonly RemoteAgentProjection[];
    readonly rows: readonly LocalLsRow[];
    readonly degraded: boolean;
    /** False until the runtime projection carries every design attention state. */
    readonly attentionComplete: false;
  };
  readonly gateway: H2AGatewayStatusV1;
  readonly warnings: readonly string[];
}

export interface ProjectStatusForH2aOptions {
  readonly tmuxSession?: string;
  readonly includeGateway?: boolean;
  readonly fetchImpl?: typeof fetch;
  readonly gatewayTimeoutMs?: number;
}

function cleanDisplay(value: string, maxScalars = 64): string {
  const clean = value
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(/[#\[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return Array.from(clean).slice(0, maxScalars).join("");
}

const GENERIC_ACCOUNT_LABEL = /^(?:raw\s+)?(?:api\s+key|bearer|oauth)$/i;
const ACTIVE_STALE_AFTER_MS = 5 * 60_000;
const RATE_LIMIT_WITHOUT_RETRY_STALE_AFTER_MS = 60_000;

function safeAccountLabel(account: PublicAccountDescriptor): string {
  const label = cleanDisplay(account.label);
  return !label || GENERIC_ACCOUNT_LABEL.test(label)
    ? cleanDisplay(account.id)
    : label;
}

function isPublicAccountDescriptor(
  value: unknown,
): value is PublicAccountDescriptor {
  if (!value || typeof value !== "object") return false;
  const account = value as Partial<PublicAccountDescriptor>;
  return (
    typeof account.id === "string" &&
    typeof account.provider === "string" &&
    typeof account.label === "string"
  );
}

function isLedgerEntry(value: unknown): value is SessionLedgerEntry {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<SessionLedgerEntry>;
  return (
    typeof row.gatewaySessionId === "string" &&
    typeof row.clientSessionId === "string" &&
    (row.state === "idle" || row.state === "active" || row.state === "rate-limited") &&
    typeof row.updatedAt === "string" &&
    (row.detailsAmbiguous === undefined ||
      typeof row.detailsAmbiguous === "boolean") &&
    isPublicAccountDescriptor(row.account) &&
    (row.lastRateLimit === undefined ||
      (!!row.lastRateLimit &&
        typeof row.lastRateLimit.at === "string" &&
        isPublicAccountDescriptor(row.lastRateLimit.account))) &&
    (row.lastFallback === undefined ||
      (!!row.lastFallback &&
        typeof row.lastFallback.at === "string" &&
        isPublicAccountDescriptor(row.lastFallback.from) &&
        isPublicAccountDescriptor(row.lastFallback.to)))
  );
}

export function selectExactGatewayLedgerEntry(
  values: readonly unknown[],
  clientSessionId: string,
): SessionLedgerEntry | undefined {
  return values
    .filter(isLedgerEntry)
    .filter((entry) => entry.clientSessionId === clientSessionId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
}

export function gatewayFromLedger(
  entry: SessionLedgerEntry,
  nowMs = Date.now(),
): H2AGatewayStatusV1 {
  const updatedAtMs = Date.parse(entry.updatedAt);
  if (!Number.isFinite(updatedAtMs)) {
    return {
      state: "unknown",
      clientSessionId: cleanDisplay(entry.clientSessionId),
      reason: "gateway snapshot has an invalid update time",
    };
  }
  if (
    entry.state === "active" &&
    nowMs - updatedAtMs > ACTIVE_STALE_AFTER_MS
  ) {
    return {
      state: "unknown",
      clientSessionId: cleanDisplay(entry.clientSessionId),
      updatedAt: entry.updatedAt,
      reason: "gateway active snapshot is stale",
    };
  }

  let retryAfter: number | undefined;
  if (entry.state === "rate-limited") {
    const rateLimitAt = entry.lastRateLimit
      ? Date.parse(entry.lastRateLimit.at)
      : Number.NaN;
    if (!Number.isFinite(rateLimitAt)) {
      return {
        state: "unknown",
        clientSessionId: cleanDisplay(entry.clientSessionId),
        updatedAt: entry.updatedAt,
        reason: "gateway 429 snapshot has no valid rate-limit time",
      };
    }
    if (entry.lastRateLimit?.retryAfterMs !== undefined) {
      retryAfter = Math.max(
        0,
        rateLimitAt + entry.lastRateLimit.retryAfterMs - nowMs,
      );
      if (retryAfter === 0) {
        return {
          state: "unknown",
          clientSessionId: cleanDisplay(entry.clientSessionId),
          updatedAt: entry.updatedAt,
          reason: "gateway 429 retry window has expired",
        };
      }
    } else if (
      nowMs - updatedAtMs > RATE_LIMIT_WITHOUT_RETRY_STALE_AFTER_MS
    ) {
      return {
        state: "unknown",
        clientSessionId: cleanDisplay(entry.clientSessionId),
        updatedAt: entry.updatedAt,
        reason: "gateway 429 snapshot is stale",
      };
    }
  }

  return {
    state: entry.state,
    clientSessionId: cleanDisplay(entry.clientSessionId),
    gatewaySessionId: cleanDisplay(entry.gatewaySessionId),
    ...(!entry.detailsAmbiguous && entry.requestedModel
      ? { requestedModel: cleanDisplay(entry.requestedModel) }
      : {}),
    ...(!entry.detailsAmbiguous && entry.upstreamModel
      ? { upstreamModel: cleanDisplay(entry.upstreamModel) }
      : {}),
    ...(!entry.detailsAmbiguous
      ? {
          provider: cleanDisplay(entry.account.provider),
          transport: entry.transport,
          accountId: cleanDisplay(entry.account.id),
          accountLabel: safeAccountLabel(entry.account),
        }
      : {}),
    ...(!entry.detailsAmbiguous && entry.lastFallback
      ? {
          previousAccountLabel: safeAccountLabel(entry.lastFallback.from),
          fallbackAccountLabel: safeAccountLabel(entry.lastFallback.to),
        }
      : {}),
    ...(retryAfter !== undefined ? { retryAfterMs: retryAfter } : {}),
    updatedAt: entry.updatedAt,
    ...(entry.detailsAmbiguous
      ? { reason: "gateway route/account details are ambiguous after overlapping requests" }
      : {}),
  };
}

function localGatewayStatusUrl(baseUrl: string): string | undefined {
  try {
    const parsed = new URL(baseUrl);
    if (
      (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
      (parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") ||
      parsed.username ||
      parsed.password
    ) {
      return undefined;
    }
    return new URL("/v1/sessions", parsed.origin).toString();
  } catch {
    return undefined;
  }
}

export function uniqueManagedWork(
  agents: readonly RemoteAgentProjection[],
): RemoteAgentProjection[] {
  const delegatedTmuxSessions = new Set(
    agents.flatMap((agent) =>
      agent.kind === "delegated-job" && agent.tmuxSession
        ? [agent.tmuxSession]
        : [],
    ),
  );
  return agents.filter(
    (agent) =>
      agent.kind !== "local-session" ||
      !agent.tmuxSession ||
      !delegatedTmuxSessions.has(agent.tmuxSession),
  );
}

async function readGatewayStatus(
  session: LocalSession,
  launchContext: LaunchContext | undefined,
  options: ProjectStatusForH2aOptions,
): Promise<H2AGatewayStatusV1> {
  if (!launchContext) {
    return {
      state: "unknown",
      clientSessionId: session.name,
      reason: "managed session has no recorded launch context",
    };
  }
  if (launchContext.gateway === "off") {
    return { state: "off", clientSessionId: session.name };
  }
  if (!launchContext.gatewayBaseUrl) {
    return {
      state: "unavailable",
      clientSessionId: session.name,
      reason: "gateway is on but no safe local status URL was recorded",
    };
  }
  const statusUrl = localGatewayStatusUrl(launchContext.gatewayBaseUrl);
  if (!statusUrl) {
    return {
      state: "unavailable",
      clientSessionId: session.name,
      reason: "gateway status URL is not a safe local URL",
    };
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  try {
    const response = await fetchImpl(statusUrl, {
      signal: AbortSignal.timeout(options.gatewayTimeoutMs ?? 400),
    });
    if (!response.ok) {
      return {
        state: "unavailable",
        clientSessionId: session.name,
        reason: `gateway status returned ${response.status}`,
      };
    }
    const body = (await response.json()) as { data?: unknown };
    const exactEntry = Array.isArray(body.data)
      ? selectExactGatewayLedgerEntry(body.data, session.name)
      : undefined;
    const legacyClientSessionId = exactEntry
      ? undefined
      : legacyClientSessionIdForMigratedSession(session);
    const entry = exactEntry ??
      (legacyClientSessionId && Array.isArray(body.data)
        ? selectExactGatewayLedgerEntry(body.data, legacyClientSessionId)
        : undefined);
    if (!entry) {
      return {
        state: "unknown",
        clientSessionId: session.name,
        reason: "gateway has no snapshot for this exact tmux session",
      };
    }
    const projected = gatewayFromLedger(entry);
    return legacyClientSessionId
      ? {
          ...projected,
          reason: projected.reason ??
            "gateway snapshot is correlated through the verified tmux rename journal",
        }
      : projected;
  } catch (error) {
    return {
      state: "unavailable",
      clientSessionId: session.name,
      reason:
        error instanceof Error && error.name === "TimeoutError"
          ? "gateway status timed out"
          : "gateway status could not be read",
    };
  }
}

export async function projectStatusForH2a(
  options: ProjectStatusForH2aOptions = {},
): Promise<H2AStatusRuntimeProjectionV1> {
  const warnings: string[] = [];
  let sessions: LocalSession[] = [];
  let rows: LocalLsRow[] = [];
  let agents: RemoteAgentProjection[] = [];
  let degraded = false;
  let tmuxKnown = true;
  try {
    const inventory = listLocalSessionsWithDiagnostics();
    sessions = inventory.sessions;
    tmuxKnown = inventory.known;
    if (!tmuxKnown) {
      degraded = true;
      warnings.push(inventory.reason ?? "tmux inventory is unavailable");
    }
    const live = listLive();
    rows = localLsRows(sessions, live);
    agents = uniqueManagedWork(
      projectRemoteAgents({ jobs: listJobs(), localRows: rows }).agents,
    );
  } catch {
    degraded = true;
    warnings.push("managed runtime projection could not be read");
  }

  const requestedTmuxSession = options.tmuxSession ?? currentTmuxSessionName();
  const exact = requestedTmuxSession
    ? sessions.find((session) => session.name === requestedTmuxSession)
    : undefined;
  const sessionState = requestedTmuxSession
    ? !tmuxKnown
      ? "unknown"
      : exact
      ? "present"
      : "absent"
    : "unknown";
  const launchContext = exact ? readLaunchContext(exact.name) : undefined;
  const gateway = exact
    ? options.includeGateway === false
      ? {
          state: "unknown" as const,
          clientSessionId: exact.name,
          reason: "gateway status was not requested",
        }
      : await readGatewayStatus(exact, launchContext, options)
    : {
        state: "unknown" as const,
        ...(requestedTmuxSession
          ? { clientSessionId: requestedTmuxSession, reason: "no managed h2a tmux session" }
          : { reason: "no exact tmux session requested" }),
      };

  return {
    kind: "h2a-status-runtime",
    version: 1,
    session: {
      state: sessionState,
      ...(requestedTmuxSession ? { tmuxSession: requestedTmuxSession } : {}),
      ...(exact ? { profile: exact.profile, path: exact.path } : {}),
      ...(launchContext ? { launchContext } : {}),
    },
    managed: { agents, rows, degraded, attentionComplete: false },
    gateway,
    warnings,
  };
}
