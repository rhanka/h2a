/**
 * Session protocol vocabulary (DEC-050).
 *
 * A SESSION is the live attachment of an INSTANCE to the protocol over a
 * given transport. The INSTANCE (`claude:session-42`) is identity; the
 * SESSION is the heartbeat-bounded liveness of one process holding that
 * identity. An instance MAY have several concurrent sessions; the heartbeat
 * is what distinguishes a live attachment from a stale registration.
 *
 * V1 ships this as a declarative vocabulary + presence guard. The actual
 * heartbeat producer, presence-file format on disk, and MCP notification
 * dispatch are implemented in `@sentropic/h2a-cli` (DEC-051 / DEC-052).
 */

import { isH2AWorkspaceRef } from "./identity.js";
import type { H2AWorkspaceRef } from "./identity.js";

export const H2A_SESSION_STATES = [
  "opening",
  "live",
  "draining",
  "closed",
  "expired"
] as const;

export const H2A_SESSION_NOTIFICATION_TOPICS = [
  "presence.peer_joined",
  "presence.peer_left",
  "inbox.envelope_arrived",
  "negotiation.event_appended",
  "peer.blocked",
  "peer.unblocked"
] as const;

export const H2A_SESSION_DEFAULT_HEARTBEAT_INTERVAL_MS = 5000;
export const H2A_SESSION_DEFAULT_EXPIRY_MS = 15000;

export type H2ASessionState = (typeof H2A_SESSION_STATES)[number];
export type H2ASessionNotificationTopic =
  (typeof H2A_SESSION_NOTIFICATION_TOPICS)[number];

// Drumbeat (DEC-084): an agent's self-reported work status, surfaced in the
// presence record so an external relance loop can detect stalls.
export const H2A_WORK_STATUSES = [
  "working",
  "paused",
  "done",
  "blocked",
  "out-of-tokens"
] as const;
export type H2AWorkStatus = (typeof H2A_WORK_STATUSES)[number];

/**
 * Where/how an agent session was launched — captured AT LAUNCH (DEC-084). It
 * cannot be inferred later (a shell that did not launch the session cannot
 * find its tmux pane), so the host plugin records it at start for the
 * relauncher to use.
 */
export interface H2ALaunchContext {
  readonly cwd: string;
  /** The command that launched the session. */
  readonly command: string;
  /** How to resume it (e.g. `codex resume`, `claude -r <id>`). */
  readonly resumeCommand?: string;
  readonly tty?: string;
  readonly tmux?: {
    readonly session: string;
    readonly window?: string;
    readonly pane: string;
  };
}

export interface H2ASessionInterests {
  /** Scopes the session wants to observe for presence and negotiation events. */
  readonly scopes: readonly string[];
  /** Specific negotiation ids the session wants to follow. */
  readonly negotiations: readonly string[];
}

export interface H2ASession {
  readonly sessionId: string;
  readonly instance: string;
  /** Optional host CLI hint (e.g. "claude", "codex", "gemini"). */
  readonly host?: string;
  /** Optional PID of the process holding the session (for same-machine staleness checks). */
  readonly pid?: number;
  /** ISO timestamp when the session was opened. */
  readonly startedAt: string;
  /** ISO timestamp of the last heartbeat. Drives expiry. */
  readonly heartbeatAt: string;
  readonly state: H2ASessionState;
  readonly interests: H2ASessionInterests;
  readonly subscribedTopics: readonly H2ASessionNotificationTopic[];
  /** Drumbeat (DEC-084): the agent's self-reported work status, if any. */
  readonly workStatus?: H2AWorkStatus;
  /** Drumbeat (DEC-084): launch context captured at session start, for relance. */
  readonly launchContext?: H2ALaunchContext;
  /**
   * DEC-114 (agent-identity fix): first-class WORKSPACE the session is attached
   * to (a traced place, not an actor). Additive — old presence records without
   * it stay valid; the guard validates it only when present.
   */
  readonly workspace?: H2AWorkspaceRef;
  /**
   * DEC-114: the perennial agent's mutable display name (e.g. set via `--name`
   * or a `/rename`). UX only — never a routing key (the `instance` handle is).
   */
  readonly name?: string;
  /**
   * Deployed-version stamp captured at session open, so drift is visible in
   * `/h2a discover` / `h2a doctor` without polling each host: `cli` = the running
   * `@sentropic/h2a-cli`, `skill` = the installed h2a skill for this host (the
   * binary auto-upgrades but the skill does not). Additive; absent on old records.
   */
  readonly version?: H2AAgentVersion;
  /**
   * ISO timestamp set by the mirror ingester when this session's presence was
   * ingested from a remote/sidecar (absent for a directly-connected local session).
   */
  readonly mirroredAt?: string;
}

/** Deployed-version stamp for an agent session (see {@link H2ASession.version}). */
export interface H2AAgentVersion {
  /** Running `@sentropic/h2a-cli` version (its package.json). */
  readonly cli?: string;
  /** Installed h2a skill version for the host (frontmatter `version:`), if resolvable. */
  readonly skill?: string;
}

function isLaunchContext(value: unknown): value is H2ALaunchContext {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (typeof v.cwd !== "string" || typeof v.command !== "string") return false;
  if (v.resumeCommand !== undefined && typeof v.resumeCommand !== "string") return false;
  if (v.tty !== undefined && typeof v.tty !== "string") return false;
  if (v.tmux !== undefined) {
    if (!v.tmux || typeof v.tmux !== "object") return false;
    const t = v.tmux as Record<string, unknown>;
    if (typeof t.session !== "string" || typeof t.pane !== "string") return false;
    if (t.window !== undefined && typeof t.window !== "string") return false;
  }
  return true;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isInterests(value: unknown): value is H2ASessionInterests {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return isStringArray(v.scopes) && isStringArray(v.negotiations);
}

export function isH2ASession(value: unknown): value is H2ASession {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (typeof v.sessionId !== "string" || v.sessionId.length === 0) return false;
  if (typeof v.instance !== "string" || v.instance.length === 0) return false;
  if (typeof v.startedAt !== "string") return false;
  if (typeof v.heartbeatAt !== "string") return false;
  if (
    typeof v.state !== "string" ||
    !H2A_SESSION_STATES.includes(v.state as H2ASessionState)
  ) {
    return false;
  }
  if (!isInterests(v.interests)) return false;
  if (
    !Array.isArray(v.subscribedTopics) ||
    !v.subscribedTopics.every(
      (topic) =>
        typeof topic === "string" &&
        H2A_SESSION_NOTIFICATION_TOPICS.includes(
          topic as H2ASessionNotificationTopic
        )
    )
  ) {
    return false;
  }
  if (v.host !== undefined && typeof v.host !== "string") return false;
  if (v.pid !== undefined && (typeof v.pid !== "number" || !Number.isInteger(v.pid))) {
    return false;
  }
  if (
    v.workStatus !== undefined &&
    !(typeof v.workStatus === "string" &&
      H2A_WORK_STATUSES.includes(v.workStatus as H2AWorkStatus))
  ) {
    return false;
  }
  if (v.launchContext !== undefined && !isLaunchContext(v.launchContext)) {
    return false;
  }
  if (v.workspace !== undefined && !isH2AWorkspaceRef(v.workspace)) {
    return false;
  }
  if (v.name !== undefined && typeof v.name !== "string") {
    return false;
  }
  if (v.mirroredAt !== undefined && typeof v.mirroredAt !== "string") {
    return false;
  }
  return true;
}

export interface H2ASessionExpiryOptions {
  /** Reference instant; defaults to Date.now(). */
  readonly now?: number;
  /** Expiry window in ms; defaults to H2A_SESSION_DEFAULT_EXPIRY_MS. */
  readonly expiryMs?: number;
}

function parseHeartbeat(session: H2ASession): number {
  const parsed = Date.parse(session.heartbeatAt);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * A session is expired iff its state is already `expired` or `closed`, or if
 * its last heartbeat is older than `expiryMs` from `now`. The `opening` and
 * `draining` states stay fresh as long as the heartbeat is recent — they
 * describe lifecycle, not absence.
 */
export function isSessionExpired(
  session: H2ASession,
  options: H2ASessionExpiryOptions = {}
): boolean {
  if (session.state === "closed" || session.state === "expired") return true;
  const now = options.now ?? Date.now();
  const expiryMs = options.expiryMs ?? H2A_SESSION_DEFAULT_EXPIRY_MS;
  const beat = parseHeartbeat(session);
  if (beat === 0) return true;
  return now - beat > expiryMs;
}

/**
 * Filter a list of sessions to those whose heartbeat is still within
 * `expiryMs` of `now` and whose state is not `closed`/`expired`. Pure helper,
 * no I/O.
 */
export function pickFreshSessions(
  sessions: readonly H2ASession[],
  options: H2ASessionExpiryOptions = {}
): H2ASession[] {
  return sessions.filter((session) => !isSessionExpired(session, options));
}

/** Default idle window before a still-"working" session is treated as stalled. */
export const H2A_DEFAULT_STALL_IDLE_MS = 120_000;

export type H2AStallReason = "out-of-tokens" | "idle" | "idle-heuristic";

export interface H2AStallOptions {
  /** Reference instant; defaults to Date.now(). */
  readonly now?: number;
  /** Idle window (ms) before a working/paused session counts as stalled. */
  readonly idleMs?: number;
}

export interface H2AStallVerdict {
  readonly stalled: boolean;
  readonly reason?: H2AStallReason;
}

/**
 * Pure stall detection for the drumbeat (DEC-084): does this session look like
 * an agent that stopped without finishing? It is session-level only — the
 * daemon enriches it with engagement/journal progress.
 *
 * Rules:
 * - `closed`/`expired` lifecycle, or `workStatus: "done"` → not a stall.
 * - `workStatus: "blocked"` → not a drumbeat stall (the explicit-blockage
 *   feedback loop, EVO-3, owns that).
 * - `workStatus: "out-of-tokens"` → stalled, regardless of heartbeat.
 * - otherwise, a heartbeat older than `idleMs` is a stall: reason `idle` when
 *   the agent said it was `working`/`paused`, `idle-heuristic` when it never
 *   reported a status. A fresh or unparseable heartbeat → not a stall.
 */
export function inferStall(
  session: H2ASession,
  options: H2AStallOptions = {}
): H2AStallVerdict {
  if (session.state === "closed" || session.state === "expired") {
    return { stalled: false };
  }
  if (session.workStatus === "done" || session.workStatus === "blocked") {
    return { stalled: false };
  }
  if (session.workStatus === "out-of-tokens") {
    return { stalled: true, reason: "out-of-tokens" };
  }
  const now = options.now ?? Date.now();
  const idleMs = options.idleMs ?? H2A_DEFAULT_STALL_IDLE_MS;
  const beat = parseHeartbeat(session);
  if (beat === 0) return { stalled: false };
  if (now - beat <= idleMs) return { stalled: false };
  if (session.workStatus === "working" || session.workStatus === "paused") {
    return { stalled: true, reason: "idle" };
  }
  if (session.workStatus === undefined) {
    return { stalled: true, reason: "idle-heuristic" };
  }
  return { stalled: false };
}
