import type { PublicAccountDescriptor } from "./llm-gateway-runtime/accounts.js";
import type {
  GatewaySessionState,
  SessionLedgerEntry,
} from "./llm-gateway-runtime/session-ledger.js";
import { projectRemoteAgents, type RemoteAgentProjection } from "./agents-projection.js";
import {
  loadRegistryWithDiagnostics,
  listJobs,
  listLive,
  localLsRows,
  type RegistryEntry,
  type LocalLsRow,
} from "./registry.js";
import {
  currentTmuxSessionName,
  localSessionAgentPanePid,
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
  /** True means the identifier exceeded its display cap; omit the route. */
  readonly requestedModelTruncated?: boolean;
  readonly upstreamModelTruncated?: boolean;
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

export interface H2ADelegatedExecutionV1 {
  readonly id: string;
  readonly origin: "mcp:h2a_run" | "cli:h2a-delegate";
  readonly delegatorInstance: string;
  readonly delegatorTmuxSession: string;
  readonly tool: string;
  readonly state: "pending" | "running" | "throttled" | "failed";
}

/** A launch record written by the originating MCP sidecar, never by `run`. */
export interface H2AMcpDelegationAttestationV1 {
  readonly workerTmuxSession: string;
  /** Bind the attestation to this launch, not a later reused tmux name. */
  readonly workerPid: number;
  readonly origin: "mcp:h2a_run";
  readonly delegatorInstance: string;
  readonly delegatorTmuxSession: string;
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
  /** Owner-scoped executions only; never a count of ordinary tmux sessions. */
  readonly delegations: {
    readonly executions: readonly H2ADelegatedExecutionV1[];
    readonly degraded: boolean;
  };
  readonly gateway: H2AGatewayStatusV1;
  readonly warnings: readonly string[];
}

export interface ProjectStatusForH2aOptions {
  readonly tmuxSession?: string;
  /** Exact owner attested by the MCP sidecar for the requested tmux session. */
  readonly ownerInstance?: string;
  readonly includeGateway?: boolean;
  /** Gateway-only bar reads do not need registry or delegated-work projection. */
  readonly includeDelegations?: boolean;
  /** The detailed human view alone needs the broad managed-work inventory. */
  readonly includeManagedInventory?: boolean;
  /** Sidecar-owned records that bind generic runtime rows to an MCP launch. */
  readonly delegationAttestations?: readonly H2AMcpDelegationAttestationV1[];
  readonly delegationAttestationsKnown?: boolean;
  readonly fetchImpl?: typeof fetch;
  readonly gatewayTimeoutMs?: number;
}

function cleanDisplay(value: string, maxScalars = 256): string {
  const clean = value
    .replace(/[\p{Cc}\p{Cf}\p{Cs}\u2028\u2029]/gu, " ")
    .replace(/[#\[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const scalars = Array.from(clean);
  return scalars.length > maxScalars
    ? `${scalars.slice(0, maxScalars).join("")}[cut]`
    : clean;
}

function cleanGatewayModel(value: string): { value: string; truncated: boolean } {
  const clean = value
    .replace(/[\p{Cc}\p{Cf}\p{Cs}\u2028\u2029]/gu, " ")
    .replace(/[#\[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const scalars = Array.from(clean);
  return {
    value: scalars.slice(0, 256).join(""),
    truncated: scalars.length > 256,
  };
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

  const requested = !entry.detailsAmbiguous && entry.requestedModel
    ? cleanGatewayModel(entry.requestedModel)
    : undefined;
  const upstream = !entry.detailsAmbiguous && entry.upstreamModel
    ? cleanGatewayModel(entry.upstreamModel)
    : undefined;
  return {
    state: entry.state,
    clientSessionId: cleanDisplay(entry.clientSessionId),
    gatewaySessionId: cleanDisplay(entry.gatewaySessionId),
    ...(requested
      ? {
          requestedModel: requested.value,
          ...(requested.truncated ? { requestedModelTruncated: true } : {}),
        }
      : {}),
    ...(upstream
      ? {
          upstreamModel: upstream.value,
          ...(upstream.truncated ? { upstreamModelTruncated: true } : {}),
        }
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

function localGatewayStatusUrl(
  baseUrl: string,
  clientSessionId: string,
): string | undefined {
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
    return new URL(
      `/v1/status/client/${encodeURIComponent(clientSessionId)}`,
      parsed.origin,
    ).toString();
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

/**
 * Project only work that carries an explicit delegator identity AND the exact
 * tmux session that made the request.  Old background sessions and generic
 * registry jobs cannot be attributed retrospectively, so they degrade J to
 * UNKNOWN rather than being silently omitted or counted for the wrong owner.
 */
export function projectDelegatedExecutions(
  entries: readonly RegistryEntry[],
  registryKnown: boolean,
  tmuxSessions: readonly LocalSession[],
  delegatorTmuxSession: string | undefined,
  delegatorInstance: string | undefined,
  attestations: readonly H2AMcpDelegationAttestationV1[] = [],
  attestationsKnown = true,
  workerPidForTmuxSession: (session: string) => number | undefined =
    localSessionAgentPanePid,
): { executions: H2ADelegatedExecutionV1[]; degraded: boolean } {
  if (!registryKnown || !attestationsKnown || !delegatorTmuxSession || !delegatorInstance) {
    return { executions: [], degraded: true };
  }
  const attestationByWorker = new Map<string, H2AMcpDelegationAttestationV1>();
  const ambiguousWorkers = new Set<string>();
  for (const attestation of attestations) {
    const existing = attestationByWorker.get(attestation.workerTmuxSession);
    if (existing) {
      ambiguousWorkers.add(attestation.workerTmuxSession);
      continue;
    }
    attestationByWorker.set(attestation.workerTmuxSession, attestation);
  }
  const liveTmux = new Set(tmuxSessions.map((session) => session.name));
  let degraded = false;
  const executions: H2ADelegatedExecutionV1[] = [];
  for (const entry of entries) {
    if (entry.sessionClass !== "background" && entry.role !== "job") continue;
    if (entry.jobState === "done") continue;
    const attestation = entry.tmuxSession && !ambiguousWorkers.has(entry.tmuxSession)
      ? attestationByWorker.get(entry.tmuxSession)
      : undefined;
    // Session names are reusable. A sidecar attestation establishes MCP origin
    // only when it also binds to the pid that the runtime observed for this
    // currently-live worker; otherwise it is stale/unverifiable evidence.
    const requiresLivePaneProof = attestation !== undefined ||
      (entry.delegationOrigin === "cli:h2a-delegate" &&
        entry.jobState !== "pending" && entry.jobState !== "failed");
    const liveWorkerPid = requiresLivePaneProof && entry.tmuxSession
      ? workerPidForTmuxSession(entry.tmuxSession)
      : undefined;
    const attestationMatchesWorker = attestation !== undefined &&
      liveWorkerPid !== undefined && liveWorkerPid === attestation.workerPid;
    // MCP provenance is authoritative only through the sidecar record. Older
    // runtime rows that merely spell `mcp:h2a_run` have no trusted origin.
    const inlineOrigin = entry.delegationOrigin === "cli:h2a-delegate"
      ? entry.delegationOrigin
      : undefined;
    const origin = attestationMatchesWorker ? attestation!.origin : inlineOrigin;
    const entryDelegatorInstance = attestationMatchesWorker
      ? attestation!.delegatorInstance
      : inlineOrigin ? entry.delegatorInstance : undefined;
    const entryDelegatorTmuxSession = attestationMatchesWorker
      ? attestation!.delegatorTmuxSession
      : inlineOrigin ? entry.delegatorTmuxSession : undefined;
    const hasProvenance =
      origin !== undefined &&
      typeof entryDelegatorInstance === "string" &&
      entryDelegatorInstance.length > 0 &&
      typeof entryDelegatorTmuxSession === "string" &&
      entryDelegatorTmuxSession.length > 0;
    if (!hasProvenance) {
      // It may belong to this owner, but the old record gives no authority to
      // claim either zero or another owner's work.
      degraded = true;
      continue;
    }
    if (
      entryDelegatorTmuxSession !== delegatorTmuxSession ||
      entryDelegatorInstance !== delegatorInstance
    ) continue;
    if (entry.jobState === "failed") {
      executions.push({
        id: entry.id,
        origin: origin!,
        delegatorInstance: entryDelegatorInstance!,
        delegatorTmuxSession: entryDelegatorTmuxSession!,
        tool: entry.tool,
        state: "failed",
      });
      continue;
    }
    if (entry.jobState === "pending") {
      // Queued work has a durable lifecycle row but no worker pane yet.
      executions.push({
        id: entry.id,
        origin: origin!,
        delegatorInstance: entryDelegatorInstance!,
        delegatorTmuxSession: entryDelegatorTmuxSession!,
        tool: entry.tool,
        state: "pending",
      });
      continue;
    }
    if (entry.kind !== "local-tmux" || !entry.tmuxSession || !liveTmux.has(entry.tmuxSession)) {
      // The structured MCP launcher terminates its tmux session with the agent.
      // A vanished row without a terminal result is unverifiable, not failed.
      degraded = true;
      continue;
    }
    // A tmux wrapper can outlive or replace an agent. For executable work, the
    // recorded launch pid must still be the exact recorded agent pane pid.
    if (entry.pid === undefined || liveWorkerPid !== entry.pid) {
      degraded = true;
      continue;
    }
    executions.push({
      id: entry.id,
      origin: origin!,
      delegatorInstance: entryDelegatorInstance!,
      delegatorTmuxSession: entryDelegatorTmuxSession!,
      tool: entry.tool,
      state: entry.jobState === "throttled"
        ? entry.jobState
        : "running",
    });
  }
  return { executions, degraded };
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
  if (!localGatewayStatusUrl(launchContext.gatewayBaseUrl, session.name)) {
    return {
      state: "unavailable",
      clientSessionId: session.name,
      reason: "gateway status URL is not a safe local URL",
    };
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  try {
    const readExactClient = async (
      clientSessionId: string,
    ): Promise<SessionLedgerEntry | undefined> => {
      const url = localGatewayStatusUrl(
        launchContext.gatewayBaseUrl!,
        clientSessionId,
      );
      if (!url) throw new Error("unsafe gateway status URL");
      const response = await fetchImpl(url, {
        signal: AbortSignal.timeout(options.gatewayTimeoutMs ?? 400),
      });
      if (response.status === 404) return undefined;
      if (!response.ok) throw new Error(`gateway status returned ${response.status}`);
      const body: unknown = await response.json();
      if (!isLedgerEntry(body)) throw new Error("gateway status returned an invalid snapshot");
      return body;
    };
    const exactEntry = await readExactClient(session.name);
    const legacyClientSessionId = exactEntry
      ? undefined
      : legacyClientSessionIdForMigratedSession(session);
    const entry = exactEntry ??
      (legacyClientSessionId
        ? await readExactClient(legacyClientSessionId)
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
  let registryEntries: RegistryEntry[] = [];
  let registryKnown = false;
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
    if (options.includeDelegations !== false) {
      const registry = loadRegistryWithDiagnostics();
      registryEntries = registry.entries;
      registryKnown = registry.known;
      if (!registryKnown) {
        warnings.push(registry.reason ?? "registry is unavailable");
      }
    }
    // The bar's owner-scoped J signal does not consume the broad managed
    // inventory. Keep this potentially expensive registry/job traversal for
    // the explicit human detail view only.
    if (options.includeManagedInventory !== false) {
      const live = listLive();
      rows = localLsRows(sessions, live);
      agents = uniqueManagedWork(
        projectRemoteAgents({ jobs: listJobs(), localRows: rows }).agents,
      );
    }
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
  const delegations = options.includeDelegations === false
    ? { executions: [], degraded: true }
    : projectDelegatedExecutions(
        registryEntries,
        registryKnown,
        sessions,
        requestedTmuxSession,
        options.ownerInstance,
        options.delegationAttestations,
        options.delegationAttestationsKnown,
      );
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
    delegations,
    gateway,
    warnings,
  };
}
