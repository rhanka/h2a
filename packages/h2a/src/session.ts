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
  "negotiation.event_appended"
] as const;

export const H2A_SESSION_DEFAULT_HEARTBEAT_INTERVAL_MS = 5000;
export const H2A_SESSION_DEFAULT_EXPIRY_MS = 15000;

export type H2ASessionState = (typeof H2A_SESSION_STATES)[number];
export type H2ASessionNotificationTopic =
  (typeof H2A_SESSION_NOTIFICATION_TOPICS)[number];

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
