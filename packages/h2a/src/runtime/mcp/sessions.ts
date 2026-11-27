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
  deletePresenceAsync,
  listPresence,
  updatePresence,
  updatePresenceAsync,
  writePresence,
  writePresenceAsync
} from "../local-files/presence.js";
import { readPidNamespaceId } from "../identity/session-auth.js";
import { withoutLockOwnership } from "../handover/mutation.js";

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
  /** Linux PID namespace of the owning session process. Defaults to current process namespace. */
  readonly pidNamespace?: string;
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
   * on disk. Tests can disable it to drive the clock manually.
   */
  readonly autoHeartbeat?: boolean;
  readonly onHeartbeatError?: (error: unknown) => void;
}

interface SessionEntry {
  session: H2ASession;
  heartbeatHandle?: ReturnType<typeof setInterval>;
  touchInFlight?: boolean;
  /**
   * Spec 2026-07-25-h2a-lane-addressing §D1b: re-reads the host-native display
   * title (Claude `customTitle` / Codex `thread_name`) so a mid-session rename
   * converges into presence within one heartbeat. Installed only when the
   * operator did NOT pass an explicit `--name`. Absent = the name is frozen.
   */
  resolveDisplayName?: () => string | undefined;
  /**
   * WP-F: in-memory ISO timestamp of the last inbound MCP line for this session.
   * `markActivity()` updates it cheaply on every line; the next heartbeat
   * `touch()` flushes it to the presence file, so a burst never thrashes disk.
   * Seeded at `open()` (the boot handshake counts as activity).
   */
  lastActivityAt?: string;
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
  private readonly openingSessionIds = new Set<string>();
  private readonly heartbeatIntervalMs: number;
  private readonly expiryMs: number;
  private readonly autoHeartbeat: boolean;
  private readonly onHeartbeatError?: (error: unknown) => void;

  constructor(
    private readonly root: string,
    options: SessionRegistryOptions = {}
  ) {
    this.heartbeatIntervalMs =
      options.heartbeatIntervalMs ?? H2A_SESSION_DEFAULT_HEARTBEAT_INTERVAL_MS;
    this.expiryMs = options.expiryMs ?? H2A_SESSION_DEFAULT_EXPIRY_MS;
    this.autoHeartbeat = options.autoHeartbeat ?? true;
    this.onHeartbeatError = options.onHeartbeatError;
  }

  private armHeartbeat(sessionId: string, entry: SessionEntry): void {
    // R2-04: never arm long-lived timers while lockOwnership ALS is bound.
    withoutLockOwnership(() => {
      entry.heartbeatHandle = setInterval(() => {
        if (entry.touchInFlight) return;
        void this.touchAsync(sessionId, { nonBlocking: true }).catch((error) => {
          try { this.onHeartbeatError?.(error); } catch { /* diagnostic only */ }
        });
      }, this.heartbeatIntervalMs);
      entry.heartbeatHandle.unref?.();
    });
  }

  private buildSession(request: OpenSessionRequest, sessionId: string, now: string): H2ASession {
    const pidNamespace = request.pidNamespace ?? readPidNamespaceId("self");
    return {
      sessionId,
      instance: request.instance,
      ...(request.host !== undefined ? { host: request.host } : {}),
      ...(request.workspace !== undefined ? { workspace: request.workspace } : {}),
      ...(request.name !== undefined ? { name: request.name } : {}),
      ...(request.version !== undefined ? { version: request.version } : {}),
      ...(request.launchContext !== undefined ? { launchContext: request.launchContext } : {}),
      pid: request.pid ?? process.pid,
      ...(pidNamespace !== undefined ? { pidNamespace } : {}),
      startedAt: now,
      heartbeatAt: now,
      // WP-F: boot = a live MCP channel (the initialize handshake just landed).
      lastMcpActivityAt: now,
      state: "live",
      interests: {
        scopes: request.interests?.scopes ?? [],
        negotiations: request.interests?.negotiations ?? []
      },
      subscribedTopics: normalizeTopics(request.subscribedTopics)
    };
  }

  open(request: OpenSessionRequest): H2ASession {
    if (typeof request.instance !== "string" || request.instance.length === 0) {
      throw new TypeError("SessionRegistry.open: 'instance' is required");
    }
    const sessionId = request.sessionId ?? generateSessionId();
    if (this.entries.has(sessionId) || this.openingSessionIds.has(sessionId)) {
      throw new Error(`SessionRegistry.open: session ${sessionId} already open`);
    }
    const now = nowIso();
    const session = this.buildSession(request, sessionId, now);
    writePresence(this.root, session);
    const entry: SessionEntry = { session, lastActivityAt: now };
    if (this.autoHeartbeat) {
      this.armHeartbeat(sessionId, entry);
    }
    this.entries.set(sessionId, entry);
    return session;
  }

  async openAsync(request: OpenSessionRequest): Promise<H2ASession> {
    if (typeof request.instance !== "string" || request.instance.length === 0) {
      throw new TypeError("SessionRegistry.openAsync: 'instance' is required");
    }
    const sessionId = request.sessionId ?? generateSessionId();
    // PR-05: reserve sessionId synchronously before the first await to reject concurrent duplicates.
    if (this.entries.has(sessionId) || this.openingSessionIds.has(sessionId)) {
      throw new Error(`SessionRegistry.openAsync: session ${sessionId} already open`);
    }
    this.openingSessionIds.add(sessionId);
    try {
      const now = nowIso();
      const session = this.buildSession(request, sessionId, now);
      await writePresenceAsync(this.root, session);
      const entry: SessionEntry = { session, lastActivityAt: now };
      if (this.autoHeartbeat) {
        this.armHeartbeat(sessionId, entry);
      }
      this.entries.set(sessionId, entry);
      return session;
    } finally {
      this.openingSessionIds.delete(sessionId);
    }
  }

  close(sessionId: string, finalState: H2ASessionState = "closed"): H2ASession | undefined {
    const entry = this.entries.get(sessionId);
    if (entry?.heartbeatHandle) {
      clearInterval(entry.heartbeatHandle);
      entry.heartbeatHandle = undefined;
    }
    try {
      const updated = updatePresence(this.root, sessionId, {
        state: finalState,
        heartbeatAt: nowIso()
      });
      if (finalState === "closed" || finalState === "expired") {
        deletePresence(this.root, sessionId);
      }
      return updated;
    } finally {
      this.entries.delete(sessionId);
    }
  }

  async closeAsync(
    sessionId: string,
    finalState: H2ASessionState = "closed",
    options?: { timeoutMs?: number; nonBlocking?: boolean }
  ): Promise<H2ASession | undefined> {
    const entry = this.entries.get(sessionId);
    if (entry?.heartbeatHandle) {
      clearInterval(entry.heartbeatHandle);
      entry.heartbeatHandle = undefined;
    }
    try {
      const updated = await updatePresenceAsync(this.root, sessionId, {
        state: finalState,
        heartbeatAt: nowIso()
      }, options);
      if (finalState === "closed" || finalState === "expired") {
        await deletePresenceAsync(this.root, sessionId, options);
      }
      return updated;
    } finally {
      this.entries.delete(sessionId);
    }
  }

  /**
   * Install (or replace) the host-native display-name resolver for a session.
   * Spec 2026-07-25-h2a-lane-addressing §D1b. Idempotent on unknown ids.
   */
  setDisplayNameResolver(
    sessionId: string,
    resolve: () => string | undefined
  ): void {
    const entry = this.entries.get(sessionId);
    if (!entry) return;
    entry.resolveDisplayName = resolve;
  }

  /**
   * Re-derive the host-native display name for a session, returning it only
   * when it is a real CHANGE worth writing.
   *
   * Deliberately conservative in three ways (spec §D1b):
   * - a resolver that throws is swallowed — a naming bug must never break the
   *   heartbeat, which is what liveness is computed from;
   * - `undefined` (transcript rotated, deleted, or not yet findable) keeps the
   *   name we already have. It must NEVER downgrade a real host-native name back
   *   to the cwd basename — refresh is monotonic in confidence;
   * - an unchanged value returns undefined so the patch key is omitted entirely
   *   rather than re-writing the same string.
   */
  private nextDisplayName(entry: SessionEntry): string | undefined {
    if (!entry.resolveDisplayName) return undefined;
    let resolved: string | undefined;
    try {
      resolved = entry.resolveDisplayName();
    } catch {
      return undefined;
    }
    if (!resolved) return undefined;
    if (resolved === entry.session.name) return undefined;
    return resolved;
  }

  /** Mark heartbeat on disk for a known session. Idempotent on unknown ids. */
  touch(sessionId: string): H2ASession | undefined {
    const entry = this.entries.get(sessionId);
    if (!entry) return undefined;
    const nextName = this.nextDisplayName(entry);
    let updated = updatePresence(this.root, sessionId, {
      heartbeatAt: nowIso(),
      // WP-F: flush the latest in-memory MCP-activity timestamp alongside the
      // blind heartbeat. Unlike heartbeatAt (which the external keepalive prober
      // can also refresh), this only advances on real inbound MCP traffic.
      ...(entry.lastActivityAt ? { lastMcpActivityAt: entry.lastActivityAt } : {}),
      ...(nextName ? { name: nextName } : {})
    });
    if (!updated) {
      updated = {
        ...entry.session,
        heartbeatAt: nowIso(),
        ...(entry.lastActivityAt ? { lastMcpActivityAt: entry.lastActivityAt } : {}),
        ...(nextName ? { name: nextName } : {})
      };
      writePresence(this.root, updated);
    }
    if (updated) entry.session = updated;
    return updated;
  }

  async touchAsync(
    sessionId: string,
    options?: { timeoutMs?: number; nonBlocking?: boolean }
  ): Promise<H2ASession | undefined> {
    const entry = this.entries.get(sessionId);
    if (!entry || entry.touchInFlight) return undefined;
    entry.touchInFlight = true;
    try {
      const nextName = this.nextDisplayName(entry);
      let updated = await updatePresenceAsync(this.root, sessionId, {
        heartbeatAt: nowIso(),
        ...(entry.lastActivityAt ? { lastMcpActivityAt: entry.lastActivityAt } : {}),
        ...(nextName ? { name: nextName } : {})
      }, options);
      if (!updated) {
        updated = {
          ...entry.session,
          heartbeatAt: nowIso(),
          ...(entry.lastActivityAt ? { lastMcpActivityAt: entry.lastActivityAt } : {}),
          ...(nextName ? { name: nextName } : {})
        };
        await writePresenceAsync(this.root, updated, options);
      }
      if (updated) entry.session = updated;
      return updated;
    } finally {
      entry.touchInFlight = false;
    }
  }

  /**
   * WP-F: record that the MCP channel carried an inbound line right now. Cheap
   * (in-memory only); flushed to the presence file by the next heartbeat
   * `touch()`. No-op on an unknown session id.
   */
  markActivity(sessionId: string): void {
    const entry = this.entries.get(sessionId);
    if (entry) entry.lastActivityAt = nowIso();
  }

  /** Snapshot of in-memory sessions held by this process. */
  list(): H2ASession[] {
    return Array.from(this.entries.values(), (entry) => entry.session);
  }

  /** Suspend owner heartbeats without deleting the checkpointed presence. */
  suspend(): void {
    for (const entry of this.entries.values()) {
      if (entry.heartbeatHandle) clearInterval(entry.heartbeatHandle);
      entry.heartbeatHandle = undefined;
    }
  }

  resume(): void {
    if (!this.autoHeartbeat) return;
    for (const [id, entry] of this.entries) {
      if (!entry.heartbeatHandle) {
        this.armHeartbeat(id, entry);
      }
    }
  }

  /**
   * Scan all presence files under root (own + peers), filtered by freshness.
   *
   * L2: `sweep:false` also disables orphan temporary-file collection so
   * discovery / inbox reads on pending identity or a read-only store never
   * attempt a write. Published presence files are never deleted by a scan.
   */
  scanFresh(now: number = Date.now(), options?: { sweep?: boolean }): H2ASession[] {
    return listPresence(this.root, {
      now,
      expiryMs: this.expiryMs,
      ...(options?.sweep !== undefined ? { sweep: options.sweep } : {})
    });
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

  async closeAllAsync(
    finalState: H2ASessionState = "closed",
    options?: { timeoutMs?: number; nonBlocking?: boolean }
  ): Promise<void> {
    for (const sessionId of Array.from(this.entries.keys())) {
      try {
        await this.closeAsync(sessionId, finalState, options);
      } catch {
        // best-effort cleanup
      }
    }
  }
}
