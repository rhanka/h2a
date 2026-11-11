import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
  GatewaySessionState,
  PublicAccountDescriptor,
  SessionLedgerEntry,
} from "./gateway-host/ledger.js";
import {
  llmMeshPidPath,
  llmMeshTokenPath,
} from "./gateway-host/daemon.js";
import { readLlmMeshConfig } from "./gateway-host/config-file.js";
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
  readonly nowMs?: number;
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
  nativeWorkerPidForSession?: (session: string) => number | undefined,
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
      ? entry.kind === "local-native"
        ? nativeWorkerPidForSession?.(entry.tmuxSession)
        : workerPidForTmuxSession(entry.tmuxSession)
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
    const isLiveTmuxWorker =
      entry.kind === "local-tmux" &&
      entry.tmuxSession !== undefined &&
      liveTmux.has(entry.tmuxSession);
    const isLiveNativeWorker =
      entry.kind === "local-native" &&
      entry.tmuxSession !== undefined &&
      nativeWorkerPidForSession !== undefined &&
      liveWorkerPid !== undefined;
    if (!isLiveTmuxWorker && !isLiveNativeWorker) {
      // The structured MCP launcher terminates its session with the agent.
      // A vanished row without a terminal result is unverifiable, not failed.
      degraded = true;
      continue;
    }
    // A session wrapper can outlive or replace an agent. For executable work, the
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
    const projected = gatewayFromLedger(entry, options.nowMs);
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

export type NativeStatusBarLinkState = "attached" | "reconnecting" | "exited";

export interface NativeStatusBarSnapshot {
  readonly cli: string | "unknown";
  readonly sessionName: string;
  readonly linkState: NativeStatusBarLinkState;
  readonly role: string | "unknown";
  readonly workload: {
    readonly j: {
      readonly open: number;
      readonly attention: number;
      readonly degraded: boolean;
    };
    readonly i: {
      readonly waiting: number;
      readonly degraded: boolean;
    };
    readonly l: {
      readonly active: number;
      readonly attention: number;
      readonly degraded: boolean;
    };
  };
  readonly delegatedSessions: number | "unknown";
  readonly gateway: H2AGatewayStatusV1;
}

export interface ReadNativeStatusBarOptions {
  readonly sessionName: string;
  readonly linkState?: NativeStatusBarLinkState;
  readonly registryPath?: string;
  readonly h2aRoot?: string;
  readonly ownerInstance?: string;
  readonly role?: string;
  readonly gatewayMode?: "gateway" | "direct";
  readonly gatewayBaseUrl?: string;
  readonly gatewayStateDir?: string;
  readonly fetchImpl?: typeof fetch;
  readonly gatewayTimeoutMs?: number;
  readonly nowMs?: number;
  readonly nativeWorkerPidForSession?: (session: string) => number | undefined;
}

const INSTANCE_TOKEN_RE = /^[A-Za-z0-9][A-Za-z0-9._:~-]{0,255}$/;
const TERMINAL_LOOP_STATUSES = new Set([
  "completed",
  "cancelled",
  "canceled",
  "superseded",
  "closed",
  "done",
]);
const ATTENTION_LOOP_STATUSES = new Set([
  "waiting-human",
  "stalled",
  "degraded",
  "blocked",
  "failed",
  "paused",
]);

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function resolveLocalGatewayBaseUrl(stateDir?: string): string | undefined {
  const envUrl = process.env.ANTHROPIC_BASE_URL?.trim();
  if (envUrl && localGatewayStatusUrl(envUrl, "probe")) {
    return envUrl;
  }
  try {
    const tokenPath = llmMeshTokenPath(stateDir);
    if (existsSync(tokenPath)) {
      const parsed = JSON.parse(readFileSync(tokenPath, "utf8")) as {
        baseUrl?: unknown;
        pid?: unknown;
      };
      if (
        typeof parsed.baseUrl === "string" &&
        localGatewayStatusUrl(parsed.baseUrl, "probe") &&
        (typeof parsed.pid !== "number" || isPidAlive(parsed.pid))
      ) {
        return parsed.baseUrl;
      }
    }
  } catch {
    // Fall back to config below.
  }
  try {
    const pidPath = llmMeshPidPath(stateDir);
    if (existsSync(pidPath)) {
      const pid = Number.parseInt(readFileSync(pidPath, "utf8").trim(), 10);
      if (Number.isInteger(pid) && pid > 0 && isPidAlive(pid)) {
        const cfg = readLlmMeshConfig(stateDir);
        const port = cfg?.port;
        if (typeof port === "number" && Number.isInteger(port) && port > 0) {
          return `http://127.0.0.1:${port}`;
        }
      }
    }
  } catch {
    // Unavailable.
  }
  return undefined;
}

interface PresenceFileRecord {
  readonly sessionId: string;
  readonly instance: string;
  readonly status?: string;
  readonly expiresAt: string;
  readonly launchContext?: {
    readonly nativePty?: { readonly session?: string };
    readonly tmux?: { readonly session?: string };
  };
}

function readLivePresenceForRoot(
  h2aRoot: string | undefined,
  nowMs: number,
): { records: PresenceFileRecord[]; degraded: boolean } {
  if (!h2aRoot || !existsSync(h2aRoot)) {
    return { records: [], degraded: true };
  }
  const presenceDir = join(h2aRoot, "presence");
  if (!existsSync(presenceDir)) {
    return { records: [], degraded: false };
  }
  try {
    const files = readdirSync(presenceDir);
    const records: PresenceFileRecord[] = [];
    let degraded = false;
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      try {
        const raw = JSON.parse(
          readFileSync(join(presenceDir, file), "utf8"),
        ) as Partial<PresenceFileRecord>;
        if (
          typeof raw.sessionId !== "string" ||
          typeof raw.instance !== "string" ||
          !INSTANCE_TOKEN_RE.test(raw.instance) ||
          typeof raw.expiresAt !== "string"
        ) {
          degraded = true;
          continue;
        }
        const expiresMs = Date.parse(raw.expiresAt);
        if (!Number.isFinite(expiresMs)) {
          degraded = true;
          continue;
        }
        if (raw.status === "closed" || expiresMs <= nowMs) continue;
        records.push(raw as PresenceFileRecord);
      } catch {
        degraded = true;
      }
    }
    return { records, degraded };
  } catch {
    return { records: [], degraded: true };
  }
}

function resolveOwnerInstanceFromPresence(
  records: readonly PresenceFileRecord[],
  sessionName: string,
): string | undefined {
  const matched = new Set<string>();
  for (const record of records) {
    const nativeSession = record.launchContext?.nativePty?.session;
    const tmuxSession = record.launchContext?.tmux?.session;
    if (nativeSession === sessionName || tmuxSession === sessionName) {
      matched.add(record.instance);
    }
  }
  if (matched.size !== 1) return undefined;
  return [...matched][0];
}

function resolveInstanceRoleFromStore(
  h2aRoot: string | undefined,
  ownerInstance: string | undefined,
): string | undefined {
  if (!h2aRoot || !ownerInstance) return undefined;
  const instancesPath = join(h2aRoot, "registry", "instances.jsonl");
  if (!existsSync(instancesPath)) return undefined;
  try {
    const st = statSync(instancesPath);
    if (st.size > 64 * 1024) return undefined;
    const lines = readFileSync(instancesPath, "utf8").split("\n");
    let matchedRole: string | undefined;
    for (const line of lines) {
      if (!line.trim()) continue;
      const row = JSON.parse(line) as {
        instance?: unknown;
        roles?: unknown;
      };
      if (
        row.instance === ownerInstance &&
        Array.isArray(row.roles) &&
        typeof row.roles[0] === "string" &&
        row.roles[0].trim().length > 0
      ) {
        matchedRole = cleanDisplay(row.roles[0], 32).toLowerCase();
      }
    }
    return matchedRole;
  } catch {
    return undefined;
  }
}

function readMcpAttestationsFromStore(
  h2aRoot: string | undefined,
): { values: H2AMcpDelegationAttestationV1[]; known: boolean } {
  if (!h2aRoot || !existsSync(h2aRoot)) {
    return { values: [], known: true };
  }
  const filePath = join(h2aRoot, "registry", "mcp-delegations.jsonl");
  if (!existsSync(filePath)) {
    return { values: [], known: true };
  }
  try {
    const st = statSync(filePath);
    if (st.size > 32 * 1024) return { values: [], known: false };
    const text = readFileSync(filePath, "utf8");
    const values: H2AMcpDelegationAttestationV1[] = [];
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      const row = JSON.parse(line) as Record<string, unknown>;
      if (
        row.version !== 1 ||
        row.origin !== "mcp:h2a_run" ||
        typeof row.workerTmuxSession !== "string" ||
        !/^(?:h2a|remote)-[A-Za-z0-9_.#-]{1,120}$/.test(row.workerTmuxSession) ||
        typeof row.workerPid !== "number" ||
        !Number.isInteger(row.workerPid) ||
        row.workerPid <= 0 ||
        typeof row.delegatorInstance !== "string" ||
        !INSTANCE_TOKEN_RE.test(row.delegatorInstance) ||
        typeof row.delegatorTmuxSession !== "string" ||
        !/^(?:h2a|remote)-[A-Za-z0-9_.#-]{1,120}$/.test(row.delegatorTmuxSession) ||
        typeof row.recordedAt !== "string" ||
        !Number.isFinite(Date.parse(row.recordedAt))
      ) {
        return { values: [], known: false };
      }
      values.push({
        workerTmuxSession: row.workerTmuxSession,
        workerPid: row.workerPid,
        origin: "mcp:h2a_run",
        delegatorInstance: row.delegatorInstance,
        delegatorTmuxSession: row.delegatorTmuxSession,
      });
    }
    return { values, known: true };
  } catch {
    return { values: [], known: false };
  }
}

function canonicalRecipientAddress(address: string): string {
  return address.trim().toLowerCase();
}

function inboxDirectoryName(recipient: string, lower = true): string {
  const normalized = lower ? canonicalRecipientAddress(recipient) : recipient.trim();
  return normalized.replace(/[^A-Za-z0-9._-]/g, "__");
}

function readInboxWaitingCount(
  h2aRoot: string | undefined,
  ownerInstance: string | undefined,
): { waiting: number; degraded: boolean } {
  if (!h2aRoot || !ownerInstance || !existsSync(h2aRoot)) {
    return { waiting: 0, degraded: true };
  }
  const inboxRoot = join(h2aRoot, "inbox");
  const subagentsFile = join(h2aRoot, "registry", "subagents.jsonl");
  const auditFile = join(h2aRoot, "registry", "subagent-audit.jsonl");
  if (!existsSync(inboxRoot) || !existsSync(subagentsFile) || !existsSync(auditFile)) {
    return { waiting: 0, degraded: true };
  }
  try {
    const subagentIds = new Set<string>();
    for (const line of readFileSync(subagentsFile, "utf8").split("\n")) {
      if (!line.trim()) continue;
      const row = JSON.parse(line) as {
        id?: unknown;
        parentInstance?: unknown;
        name?: unknown;
        createdAt?: unknown;
      };
      const expectedId = `${String(row.parentInstance ?? "")}~${String(row.name ?? "")}`;
      if (
        typeof row.id !== "string" ||
        typeof row.parentInstance !== "string" ||
        row.parentInstance.length === 0 ||
        typeof row.name !== "string" ||
        row.name.length === 0 ||
        row.name.includes("~") ||
        row.id !== expectedId ||
        typeof row.createdAt !== "string" ||
        !Number.isFinite(Date.parse(row.createdAt))
      ) {
        return { waiting: 0, degraded: true };
      }
      if (canonicalRecipientAddress(row.parentInstance) === canonicalRecipientAddress(ownerInstance)) {
        subagentIds.add(row.id);
      }
    }
    const revoked = new Set<string>();
    for (const line of readFileSync(auditFile, "utf8").split("\n")) {
      if (!line.trim()) continue;
      const row = JSON.parse(line) as {
        subagent?: unknown;
        type?: unknown;
        at?: unknown;
        envelopeId?: unknown;
        mailbox?: unknown;
      };
      const validType =
        row.type === "registered" || row.type === "routed" || row.type === "revoked";
      if (
        typeof row.subagent !== "string" ||
        !validType ||
        typeof row.at !== "string" ||
        !Number.isFinite(Date.parse(row.at)) ||
        (row.type === "routed" &&
          (typeof row.envelopeId !== "string" ||
            (row.mailbox !== "inbox" && row.mailbox !== "outbox")))
      ) {
        return { waiting: 0, degraded: true };
      }
      if (row.type === "revoked") revoked.add(row.subagent);
    }
    const recipients = [
      ownerInstance,
      ...[...subagentIds].filter((id) => !revoked.has(id)),
    ];
    const dirs = new Map<string, string>();
    for (const r of recipients) {
      const canon = canonicalRecipientAddress(r);
      dirs.set(join(inboxRoot, inboxDirectoryName(r, true)), canon);
      dirs.set(join(inboxRoot, inboxDirectoryName(r, false)), canon);
    }
    const waitingKeys = new Set<string>();
    for (const [dirPath, recipientCanon] of dirs) {
      if (!existsSync(dirPath)) continue;
      for (const file of readdirSync(dirPath)) {
        if (!file.endsWith(".json")) continue;
        const env = JSON.parse(readFileSync(join(dirPath, file), "utf8")) as {
          protocol?: unknown;
          id?: unknown;
          type?: unknown;
          actor?: { instance?: unknown };
          createdAt?: unknown;
        };
        if (
          env.protocol !== "sentropic.h2a" ||
          typeof env.id !== "string" ||
          typeof env.type !== "string" ||
          typeof env.actor?.instance !== "string" ||
          typeof env.createdAt !== "string"
        ) {
          return { waiting: 0, degraded: true };
        }
        waitingKeys.add(`${recipientCanon}\u0000${env.id}`);
      }
    }
    return { waiting: waitingKeys.size, degraded: false };
  } catch {
    return { waiting: 0, degraded: true };
  }
}

function readLoopsStatusCount(
  h2aRoot: string | undefined,
  livePresenceInstances: ReadonlySet<string>,
  presenceDegraded: boolean,
): { active: number; attention: number; degraded: boolean } {
  if (!h2aRoot || !existsSync(h2aRoot)) {
    return { active: 0, attention: 0, degraded: true };
  }
  const loopsRoot = join(h2aRoot, "loops");
  if (!existsSync(loopsRoot)) {
    return { active: 0, attention: 0, degraded: true };
  }
  try {
    const entries = readdirSync(loopsRoot, { withFileTypes: true });
    let active = 0;
    const attentionIds = new Set<string>();
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const stateFile = join(loopsRoot, entry.name, "state.json");
      if (!existsSync(stateFile)) continue;
      const raw = JSON.parse(readFileSync(stateFile, "utf8")) as {
        id?: unknown;
        name?: unknown;
        goal?: unknown;
        status?: unknown;
        agents?: unknown;
        createdAt?: unknown;
        updatedAt?: unknown;
      };
      if (
        typeof raw.id !== "string" ||
        typeof raw.name !== "string" ||
        typeof raw.goal !== "string" ||
        typeof raw.status !== "string" ||
        !Array.isArray(raw.agents) ||
        typeof raw.createdAt !== "string" ||
        typeof raw.updatedAt !== "string"
      ) {
        return { active: 0, attention: 0, degraded: true };
      }
      const statusLower = raw.status.toLowerCase();
      const isTerminal = TERMINAL_LOOP_STATUSES.has(statusLower);
      if (!isTerminal) {
        active += 1;
        if (raw.agents.length > 0) {
          if (presenceDegraded) {
            return { active: 0, attention: 0, degraded: true };
          }
          const anyPresent = raw.agents.some((a) => {
            const inst =
              typeof a === "string"
                ? a
                : a && typeof a === "object" && typeof (a as { instance?: unknown }).instance === "string"
                  ? ((a as { instance: string }).instance)
                  : undefined;
            return inst !== undefined && livePresenceInstances.has(inst);
          });
          if (!anyPresent) attentionIds.add(raw.id);
        }
      }
      if (ATTENTION_LOOP_STATUSES.has(statusLower)) {
        attentionIds.add(raw.id);
      }
    }
    return { active, attention: attentionIds.size, degraded: false };
  } catch {
    return { active: 0, attention: 0, degraded: true };
  }
}

export async function readNativeStatusBarSnapshot(
  options: ReadNativeStatusBarOptions,
): Promise<NativeStatusBarSnapshot> {
  const nowMs = options.nowMs ?? Date.now();
  const sessionName = cleanDisplay(options.sessionName, 64) || "unknown";
  const linkState: NativeStatusBarLinkState = options.linkState ?? "attached";

  const registry = loadRegistryWithDiagnostics(options.registryPath);
  const entry = registry.entries.find(
    (e) =>
      e.endedAt === undefined &&
      (e.tmuxSession === sessionName || e.id === sessionName || e.label === sessionName),
  );

  const cli = entry?.tool ? cleanDisplay(entry.tool, 24) : "unknown";
  const h2aRoot =
    options.h2aRoot ??
    process.env.H2A_ROOT ??
    (entry?.cwd && existsSync(join(entry.cwd, ".h2a"))
      ? join(entry.cwd, ".h2a")
      : !process.env.H2A_TEST_OWNED_PROC_ROOT
        ? join(homedir(), "h2a-workspace", ".h2a")
        : undefined);

  const presence = readLivePresenceForRoot(h2aRoot, nowMs);
  const ownerInstance =
    options.ownerInstance && INSTANCE_TOKEN_RE.test(options.ownerInstance)
      ? options.ownerInstance
      : resolveOwnerInstanceFromPresence(presence.records, sessionName);

  const storeRole = resolveInstanceRoleFromStore(h2aRoot, ownerInstance);
  const role =
    options.role
      ? cleanDisplay(options.role, 24)
      : storeRole ??
        (entry?.role
          ? cleanDisplay(entry.role, 24)
          : entry?.sessionClass
            ? cleanDisplay(entry.sessionClass, 24)
            : "unknown");

  const mcpAttestations = readMcpAttestationsFromStore(h2aRoot);
  const defaultNativeWorkerPid = (workerSession: string): number | undefined => {
    const workerRow = registry.entries.find(
      (e) =>
        e.kind === "local-native" &&
        e.endedAt === undefined &&
        e.tmuxSession === workerSession,
    );
    return workerRow?.pid !== undefined && isPidAlive(workerRow.pid)
      ? workerRow.pid
      : undefined;
  };
  const delegations = projectDelegatedExecutions(
    registry.entries,
    registry.known,
    [],
    sessionName,
    ownerInstance,
    mcpAttestations.values,
    mcpAttestations.known,
    localSessionAgentPanePid,
    options.nativeWorkerPidForSession ?? defaultNativeWorkerPid,
  );
  const jOpen = delegations.executions.filter((item) => item.state !== "failed").length;
  const jAttention = delegations.executions.filter(
    (item) =>
      item.state === "pending" ||
      item.state === "throttled" ||
      item.state === "failed",
  ).length;

  const inbox = readInboxWaitingCount(h2aRoot, ownerInstance);
  const livePresenceInstances = new Set(presence.records.map((r) => r.instance));
  const loops = readLoopsStatusCount(h2aRoot, livePresenceInstances, presence.degraded);

  const gatewayMode = options.gatewayMode ?? entry?.gatewayMode;
  let gateway: H2AGatewayStatusV1;
  if (gatewayMode === "direct") {
    gateway = { state: "off", clientSessionId: sessionName };
  } else if (gatewayMode === "gateway") {
    const baseUrl =
      options.gatewayBaseUrl ?? resolveLocalGatewayBaseUrl(options.gatewayStateDir);
    const fakeSession: LocalSession = {
      tmuxId: "",
      tmuxCreatedAt: "",
      tmuxServerPid: "",
      tmuxSocketPath: "",
      name: sessionName,
      slug: entry?.label ?? entry?.id ?? sessionName,
      profile: entry?.tool ?? "claude",
      path: entry?.cwd ?? "",
      attached: true,
    };
    const launchCtx: LaunchContext = {
      profile: entry?.tool ?? "claude",
      cwd: entry?.cwd ?? "",
      gateway: "on",
      modelMap: "",
      ...(baseUrl ? { gatewayBaseUrl: baseUrl } : {}),
    };
    gateway = await readGatewayStatus(fakeSession, launchCtx, {
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
      ...(options.gatewayTimeoutMs !== undefined
        ? { gatewayTimeoutMs: options.gatewayTimeoutMs }
        : {}),
      nowMs,
    });
  } else {
    gateway = {
      state: "unknown",
      clientSessionId: sessionName,
      reason: "session has no recorded gateway mode",
    };
  }

  return {
    cli,
    sessionName,
    linkState,
    role,
    workload: {
      j: { open: jOpen, attention: jAttention, degraded: delegations.degraded },
      i: inbox,
      l: loops,
    },
    delegatedSessions: delegations.degraded ? "unknown" : jOpen,
    gateway,
  };
}

export function terminalDisplayColumns(value: string): number {
  let columns = 0;
  for (const scalar of value) {
    if (/\p{Mark}/u.test(scalar)) continue;
    const code = scalar.codePointAt(0)!;
    const wide =
      code >= 0x1100 &&
      (code <= 0x115f ||
        code === 0x2329 ||
        code === 0x232a ||
        (code >= 0x2e80 && code <= 0xa4cf && code !== 0x303f) ||
        (code >= 0xac00 && code <= 0xd7a3) ||
        (code >= 0xf900 && code <= 0xfaff) ||
        (code >= 0xfe10 && code <= 0xfe19) ||
        (code >= 0xfe30 && code <= 0xfe6f) ||
        (code >= 0xff00 && code <= 0xff60) ||
        (code >= 0xffe0 && code <= 0xffe6) ||
        (code >= 0x1f300 && code <= 0x1faff) ||
        (code >= 0x20000 && code <= 0x3fffd));
    columns += wide ? 2 : 1;
  }
  return columns;
}

function formatCounter(
  prefix: string,
  count: number,
  attention: number | undefined,
  degraded: boolean,
): string {
  if (degraded) return `${prefix}?`;
  if (attention !== undefined && attention > 0) return `${prefix}${count}!${attention}`;
  return `${prefix}${count}`;
}

export function renderNativeStatusBarLine(
  snapshot: NativeStatusBarSnapshot,
  cols: number,
): string {
  const safeCols = Math.max(1, Math.trunc(cols));
  const cliToken = snapshot.cli === "unknown" ? "?" : cleanDisplay(snapshot.cli, 24);
  const sessionToken = cleanDisplay(snapshot.sessionName, 48) || "?";
  const left = ` ${cliToken} · ${sessionToken} · ${snapshot.linkState}`;

  const workloadToken = [
    formatCounter(
      "J",
      snapshot.workload.j.open,
      snapshot.workload.j.attention,
      snapshot.workload.j.degraded,
    ),
    formatCounter(
      "I",
      snapshot.workload.i.waiting,
      undefined,
      snapshot.workload.i.degraded,
    ),
    formatCounter(
      "L",
      snapshot.workload.l.active,
      snapshot.workload.l.attention,
      snapshot.workload.l.degraded,
    ),
  ].join(" ");

  const roleToken = `role ${snapshot.role === "unknown" ? "?" : cleanDisplay(snapshot.role, 24)}`;
  const gwState =
    snapshot.gateway.state === "unknown"
      ? "gw ?"
      : snapshot.gateway.state === "rate-limited"
        ? "gw 429"
        : `gw ${snapshot.gateway.state}`;

  let routeToken: string | undefined;
  if (
    snapshot.gateway.state === "active" ||
    snapshot.gateway.state === "rate-limited" ||
    snapshot.gateway.state === "idle"
  ) {
    if (snapshot.gateway.requestedModelTruncated || snapshot.gateway.upstreamModelTruncated) {
      routeToken = "route [cut]";
    } else if (snapshot.gateway.requestedModel && snapshot.gateway.upstreamModel) {
      routeToken = `${cleanDisplay(snapshot.gateway.requestedModel, 96)}→${cleanDisplay(snapshot.gateway.upstreamModel, 96)}`;
    }
  }

  const delegToken = `deleg ${snapshot.delegatedSessions === "unknown" ? "?" : snapshot.delegatedSessions}`;

  const candidates = [
    `${workloadToken} · ${roleToken} · ${gwState}${routeToken ? ` · ${routeToken}` : ""} · ${delegToken} `,
    ...(routeToken
      ? [`${workloadToken} · ${roleToken} · ${gwState} · ${delegToken} `]
      : []),
    `${workloadToken} · ${gwState} · ${delegToken} `,
    `${workloadToken} · ${gwState} `,
  ];

  const leftCols = terminalDisplayColumns(left);
  for (const right of candidates) {
    const rightCols = terminalDisplayColumns(right);
    if (leftCols + 2 + rightCols <= safeCols) {
      const pad = " ".repeat(safeCols - leftCols - rightCols);
      return `${left}${pad}${right}`;
    }
  }

  const fallback = `${left}  ${candidates[0]!.trimEnd()}`;
  let out = "";
  let used = 0;
  for (const scalar of fallback) {
    const w = terminalDisplayColumns(scalar);
    if (used + w > safeCols) break;
    out += scalar;
    used += w;
  }
  return used < safeCols ? `${out}${" ".repeat(safeCols - used)}` : out;
}
