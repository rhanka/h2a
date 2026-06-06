import { randomBytes } from "node:crypto";

import {
  H2A_SESSION_DEFAULT_EXPIRY_MS,
  H2A_SESSION_DEFAULT_HEARTBEAT_INTERVAL_MS,
  H2A_SESSION_NOTIFICATION_TOPICS,
  type H2AAgentVersion,
  type H2ALaunchContext,
  type H2ASession,
  type H2ASessionInterests,
  type H2ASessionNotificationTopic,
  type H2ASessionState,
  type H2AWorkspaceRef
} from "@sentropic/h2a";

import {
  deletePresence,
  listPresence,
  updatePresence,
  writePresence
} from "../local-files/presence.js";

export interface OpenSessionRequest {
  /** Identity of the live attachment. Required. */
  readonly instance: string;
  /** Host CLI hint (claude / codex / gemini / ...). Optional. */
  readonly host?: string;
  /** First-class workspace trace for the perennial identity. */
  readonly workspace?: H2AWorkspaceRef;
  /** Mutable display name for the perennial agent. */
  readonly name?: string;
  /** PID of the holding process. Defaults to process.pid. */
  readonly pid?: number;
  /** Scopes / negotiations the session wants to follow. Defaults to empty arrays. */
  readonly interests?: Partial<H2ASessionInterests>;
  /** Topics the session subscribes to. Defaults to all four canonical topics. */
  readonly subscribedTopics?: readonly H2ASessionNotificationTopic[];
  /** Deployed-version stamp ({cli, skill}) for drift visibility. */
  readonly version?: H2AAgentVersion;
  /** Launch context (e.g. the tmux pane) so wake/relance drivers can target this agent. */
  readonly launchContext?: H2ALaunchContext;
  /** Optional explicit session id (UUID-ish). Generated if omitted. */
  readonly sessionId?: string;
}

export interface SessionRegistryOptions {
  /** Heartbeat interval (ms). Defaults to H2A_SESSION_DEFAULT_HEARTBEAT_INTERVAL_MS. */
  readonly heartbeatIntervalMs?: number;
  /** Expiry window (ms). Defaults to H2A_SESSION_DEFAULT_EXPIRY_MS. */
  readonly expiryMs?: number;
  /**
   * When true, schedule a setInterval that touches each session's heartbeat
   * on disk. Disabled by default so unit tests can drive the clock manually.
   */
  readonly autoHeartbeat?: boolean;
}

interface SessionEntry {
  session: H2ASession;
  heartbeatHandle?: ReturnType<typeof setInterval>;
}

function nowIso(): string {
  return new Date().toISOString();
}

function generateSessionId(): string {
  return `sess:${randomBytes(8).toString("hex")}`;
}

function normalizeTopics(
  raw: readonly string[] | undefined
): readonly H2ASessionNotificationTopic[] {
  if (!raw) return H2A_SESSION_NOTIFICATION_TOPICS;
  const seen = new Set<H2ASessionNotificationTopic>();
  for (const topic of raw) {
    if (
      typeof topic === "string" &&
      (H2A_SESSION_NOTIFICATION_TOPICS as readonly string[]).includes(topic)
    ) {
      seen.add(topic as H2ASessionNotificationTopic);
    }
  }
  return Array.from(seen);
}

/**
 * Per-process registry of MCP sessions. Owns the in-memory map and the
 * heartbeat timers. Each session corresponds to one client connection
 * (one mcp-serve subprocess attachment). The registry writes a presence
 * file under `<root>/.h2a/presence/<sessionId>.json` and keeps it fresh.
 */
export class SessionRegistry {
  private readonly entries = new Map<string, SessionEntry>();
  private readonly heartbeatIntervalMs: number;
  private readonly expiryMs: number;
  private readonly autoHeartbeat: boolean;

  constructor(
    private readonly root: string,
    options: SessionRegistryOptions = {}
  ) {
    this.heartbeatIntervalMs =
      options.heartbeatIntervalMs ?? H2A_SESSION_DEFAULT_HEARTBEAT_INTERVAL_MS;
    this.expiryMs = options.expiryMs ?? H2A_SESSION_DEFAULT_EXPIRY_MS;
    this.autoHeartbeat = options.autoHeartbeat ?? true;
  }

  open(request: OpenSessionRequest): H2ASession {
    if (typeof request.instance !== "string" || request.instance.length === 0) {
      throw new TypeError("SessionRegistry.open: 'instance' is required");
    }
    const sessionId = request.sessionId ?? generateSessionId();
    if (this.entries.has(sessionId)) {
      throw new Error(`SessionRegistry.open: session ${sessionId} already open`);
    }
    const now = nowIso();
    const session: H2ASession = {
      sessionId,
      instance: request.instance,
      ...(request.host !== undefined ? { host: request.host } : {}),
      ...(request.workspace !== undefined ? { workspace: request.workspace } : {}),
      ...(request.name !== undefined ? { name: request.name } : {}),
      ...(request.version !== undefined ? { version: request.version } : {}),
      ...(request.launchContext !== undefined ? { launchContext: request.launchContext } : {}),
      pid: request.pid ?? process.pid,
      startedAt: now,
      heartbeatAt: now,
      state: "live",
      interests: {
        scopes: request.interests?.scopes ?? [],
        negotiations: request.interests?.negotiations ?? []
      },
      subscribedTopics: normalizeTopics(request.subscribedTopics)
    };
    writePresence(this.root, session);
    const entry: SessionEntry = { session };
    if (this.autoHeartbeat) {
      entry.heartbeatHandle = setInterval(
        () => this.touch(sessionId),
        this.heartbeatIntervalMs
      );
      // Keep the timer from holding the event loop open when stdin closes.
      entry.heartbeatHandle.unref?.();
    }
    this.entries.set(sessionId, entry);
    return session;
  }

  close(sessionId: string, finalState: H2ASessionState = "closed"): H2ASession | undefined {
    const entry = this.entries.get(sessionId);
    if (entry?.heartbeatHandle) {
      clearInterval(entry.heartbeatHandle);
    }
    const updated = updatePresence(this.root, sessionId, {
      state: finalState,
      heartbeatAt: nowIso()
    });
    this.entries.delete(sessionId);
    if (finalState === "closed" || finalState === "expired") {
      deletePresence(this.root, sessionId);
    }
    return updated;
  }

  /** Mark heartbeat on disk for a known session. Idempotent on unknown ids. */
  touch(sessionId: string): H2ASession | undefined {
    const entry = this.entries.get(sessionId);
    if (!entry) return undefined;
    const updated = updatePresence(this.root, sessionId, {
      heartbeatAt: nowIso()
    });
    if (updated) entry.session = updated;
    return updated;
  }

  /** Snapshot of in-memory sessions held by this process. */
  list(): H2ASession[] {
    return Array.from(this.entries.values(), (entry) => entry.session);
  }

  /** Scan all presence files under root (own + peers), filtered by freshness. */
  scanFresh(now: number = Date.now()): H2ASession[] {
    return listPresence(this.root, { now, expiryMs: this.expiryMs });
  }

  /**
   * Close every live session held by this process. Idempotent. Used by
   * mcp-serve's shutdown hook when stdin reaches EOF or a signal lands.
   */
  closeAll(finalState: H2ASessionState = "closed"): void {
    for (const sessionId of Array.from(this.entries.keys())) {
      try {
        this.close(sessionId, finalState);
      } catch {
        // best-effort cleanup
      }
    }
  }
}
