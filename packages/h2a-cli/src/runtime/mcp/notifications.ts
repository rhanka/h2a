import {
  H2A_SESSION_NOTIFICATION_TOPICS,
  isActiveBlockage,
  type H2ASession,
  type H2ASessionNotificationTopic
} from "@sentropic/h2a";

import { listBlockages } from "../blockage/registry.js";
import type { LocalStore } from "../local-files/store.js";
import type { SessionRegistry } from "./sessions.js";

/** JSON-RPC notification (no id, no response) emitted on push. */
export interface McpPushNotification {
  jsonrpc: "2.0";
  method: "notifications/h2a";
  params: {
    topic: H2ASessionNotificationTopic;
    sessionId: string;
    data: Record<string, unknown>;
  };
}

export type NotificationSink = (notification: McpPushNotification) => void;

interface InboxSnapshot {
  /** Set of envelope ids seen in this session's inbox at last scan. */
  envelopeIds: Set<string>;
}

interface NegotiationSnapshot {
  /** Number of journal entries observed at last scan. */
  count: number;
}

interface SessionDiffState {
  /** Peer presence (sessionId set) observed at last scan, minus self. */
  peers: Set<string>;
  inbox: InboxSnapshot;
  /** Per-negotiation journal-length snapshots. */
  negotiations: Map<string, NegotiationSnapshot>;
  /** Instances seen with an active in-scope blockage (minus self) at last scan. */
  blocked: Set<string>;
}

function isInterestedIn(
  session: H2ASession,
  topic: H2ASessionNotificationTopic
): boolean {
  return session.subscribedTopics.includes(topic);
}

function readInboxIds(store: LocalStore, instance: string): string[] {
  try {
    return store.readInbox(instance).map((envelope) => envelope.id);
  } catch {
    return [];
  }
}

function readJournalLength(store: LocalStore, negotiationId: string): number {
  try {
    return store.readNegotiationJournal(negotiationId).length;
  } catch {
    return 0;
  }
}

function emptyDiffState(): SessionDiffState {
  return {
    peers: new Set(),
    inbox: { envelopeIds: new Set() },
    negotiations: new Map(),
    blocked: new Set()
  };
}

/**
 * Owns the per-session diff snapshots and the periodic scan that turns
 * filesystem changes into pushed JSON-RPC notifications. One dispatcher per
 * `mcp-serve` process; the SessionRegistry tells it which sessions to follow
 * and the LocalStore provides the read side.
 */
export class NotificationDispatcher {
  private readonly snapshots = new Map<string, SessionDiffState>();
  private timer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly registry: SessionRegistry,
    private readonly store: LocalStore,
    private readonly root: string,
    private sink: NotificationSink | undefined,
    private readonly intervalMs: number
  ) {}

  setSink(sink: NotificationSink | undefined): void {
    this.sink = sink;
  }

  /**
   * EVO-1 wake hook (bug #3): invoked once per tick, per own session that saw
   * new inbox envelopes. mcp-serve wires this to the inbox-wake handler so an
   * idle host is woken on arrival. Non-breaking (optional).
   */
  private onInboxArrival?: (instance: string) => void;
  setOnInboxArrival(cb: ((instance: string) => void) | undefined): void {
    this.onInboxArrival = cb;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), this.intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = undefined;
  }

  /**
   * Compute and emit one round of diffs. Pulled into a public method so
   * tests can drive the dispatch deterministically without a timer.
   */
  tick(): void {
    if (!this.sink) return;
    const ownSessions = this.registry.list();
    if (ownSessions.length === 0) return;

    // Peer set: everyone in presence files, fresh according to the
    // registry's TTL (so test configurations with short expiry behave
    // correctly), regardless of which process wrote the file.
    const freshPeers = this.registry.scanFresh();
    const peerIds = new Set(freshPeers.map((s) => s.sessionId));

    // Active blockages, computed once per tick (EVO-3, DEC-092). Per session we
    // filter to its scopes and exclude its own blockage.
    const activeBlockages = listBlockages(this.root).filter(isActiveBlockage);

    for (const session of ownSessions) {
      const prev = this.snapshots.get(session.sessionId) ?? emptyDiffState();

      // 1. Presence join/leave (excluding self)
      const others = new Set(
        [...peerIds].filter((sid) => sid !== session.sessionId)
      );
      if (isInterestedIn(session, "presence.peer_joined")) {
        for (const sid of others) {
          if (!prev.peers.has(sid)) {
            const peer = freshPeers.find((p) => p.sessionId === sid);
            if (peer) {
              this.push(session.sessionId, "presence.peer_joined", {
                peer: {
                  sessionId: peer.sessionId,
                  instance: peer.instance,
                  host: peer.host,
                  interests: peer.interests
                }
              });
            }
          }
        }
      }
      if (isInterestedIn(session, "presence.peer_left")) {
        for (const sid of prev.peers) {
          if (!others.has(sid)) {
            this.push(session.sessionId, "presence.peer_left", {
              peer: { sessionId: sid }
            });
          }
        }
      }

      // 2. Inbox arrivals
      const inboxIds = isInterestedIn(session, "inbox.envelope_arrived")
        ? readInboxIds(this.store, session.instance)
        : [];
      if (isInterestedIn(session, "inbox.envelope_arrived")) {
        for (const envelopeId of inboxIds) {
          if (!prev.inbox.envelopeIds.has(envelopeId)) {
            this.push(session.sessionId, "inbox.envelope_arrived", {
              instance: session.instance,
              envelopeId
            });
          }
        }
        // EVO-1 wake (bug #3): nudge the host every tick while the inbox is
        // NON-EMPTY (not just on a fresh arrival). The inbox-wake handler dedups
        // via its own `seen`, so this is a no-op once a wake has landed — but it
        // is what RETRIES a wake that was DEFERRED (driver returned false because
        // a human was typing in the pane) until it can land without clobbering.
        if (inboxIds.length > 0) this.onInboxArrival?.(session.instance);
      }

      // 3. Negotiation event arrivals (only on negotiations the session follows)
      const negotiationSnap = new Map<string, NegotiationSnapshot>();
      if (isInterestedIn(session, "negotiation.event_appended")) {
        for (const negotiationId of session.interests.negotiations) {
          const count = readJournalLength(this.store, negotiationId);
          const prevCount =
            prev.negotiations.get(negotiationId)?.count ?? 0;
          if (count > prevCount) {
            this.push(session.sessionId, "negotiation.event_appended", {
              negotiationId,
              newEntries: count - prevCount,
              totalEntries: count
            });
          }
          negotiationSnap.set(negotiationId, { count });
        }
      }

      // 4. Peer blockages in this session's scope (EVO-3). Notify of a peer's
      // active blockage (peer.blocked) and of its clearing (peer.unblocked).
      const inScope = activeBlockages.filter(
        (b) =>
          b.instance !== session.instance &&
          session.interests.scopes.includes(b.scope)
      );
      const blockedNow = new Set(inScope.map((b) => b.instance));
      if (isInterestedIn(session, "peer.blocked")) {
        for (const b of inScope) {
          if (!prev.blocked.has(b.instance)) {
            this.push(session.sessionId, "peer.blocked", {
              instance: b.instance,
              scope: b.scope,
              reason: b.reason,
              ...(b.needs ? { needs: b.needs } : {})
            });
          }
        }
      }
      if (isInterestedIn(session, "peer.unblocked")) {
        for (const instance of prev.blocked) {
          if (!blockedNow.has(instance)) {
            this.push(session.sessionId, "peer.unblocked", { instance });
          }
        }
      }

      this.snapshots.set(session.sessionId, {
        peers: others,
        inbox: { envelopeIds: new Set(inboxIds) },
        negotiations: negotiationSnap,
        blocked: blockedNow
      });
    }
  }

  private push(
    sessionId: string,
    topic: H2ASessionNotificationTopic,
    data: Record<string, unknown>
  ): void {
    if (!this.sink) return;
    if (!H2A_SESSION_NOTIFICATION_TOPICS.includes(topic)) return;
    this.sink({
      jsonrpc: "2.0",
      method: "notifications/h2a",
      params: { topic, sessionId, data }
    });
  }
}
