import {
  H2A_ROLES,
  H2A_SESSION_NOTIFICATION_TOPICS,
  H2A_SESSION_STATES,
  auditNhiPosture,
  computeHash,
  nhiAttestationEnvelope,
  signCanonical,
  signEnvelope,
  type H2AActorRegistration,
  type H2AEnvelope,
  type H2AJournalPayload,
  type H2ANegotiationRecord,
  type H2ARole,
  type H2ASessionInterests,
  type H2ASessionNotificationTopic,
  type H2ASessionState
} from "@sentropic/h2a";

import type { LocalStore } from "../local-files/store.js";
import { gatherNhiSnapshot } from "../nhi.js";
import type { SessionRegistry } from "./sessions.js";

export interface McpToolResult {
  [key: string]: unknown;
}

export interface McpErrorResult {
  error: string;
}

const ESCALATION_CHANNELS = new Set(["advise", "decide", "alert"]);

function safeError(reason: unknown): McpErrorResult {
  if (reason instanceof Error) return { error: reason.message };
  return { error: String(reason) };
}

function nowIso(): string {
  return new Date().toISOString();
}

export function handleRegisterInstance(
  store: LocalStore,
  args: { registration?: H2AActorRegistration } | undefined
): McpToolResult | McpErrorResult {
  if (!args || typeof args.registration !== "object" || args.registration === null) {
    return { error: "h2a_register_instance: missing 'registration' object" };
  }
  try {
    store.registerInstance(args.registration);
    return { ok: true, instance: args.registration.id };
  } catch (err) {
    return safeError(err);
  }
}

export function handleDiscoverInstances(
  store: LocalStore,
  args: { role?: H2ARole; scope?: string } | undefined
): McpToolResult | McpErrorResult {
  try {
    let instances = store.listInstances();
    if (args?.role) {
      const wanted = args.role;
      instances = instances.filter((reg) => reg.roles.includes(wanted));
    }
    if (args?.scope) {
      const wanted = args.scope;
      instances = instances.filter((reg) => reg.scopes.includes(wanted));
    }
    return { instances };
  } catch (err) {
    return safeError(err);
  }
}

export function handleInbox(
  store: LocalStore,
  args:
    | {
        action?: "read" | "put" | "pop";
        instance?: string;
        envelope?: H2AEnvelope;
        envelopeId?: string;
      }
    | undefined
): McpToolResult | McpErrorResult {
  if (!args || typeof args.instance !== "string" || args.instance.length === 0) {
    return { error: "h2a_inbox: missing 'instance'" };
  }
  try {
    switch (args.action) {
      case "read":
        return { envelopes: store.readInbox(args.instance) };
      case "put": {
        if (!args.envelope) return { error: "h2a_inbox put: missing 'envelope'" };
        store.putInboxMessage(args.instance, args.envelope);
        return { ok: true, envelopeId: args.envelope.id };
      }
      case "pop": {
        if (typeof args.envelopeId !== "string" || args.envelopeId.length === 0) {
          return { error: "h2a_inbox pop: missing 'envelopeId'" };
        }
        const envelope = store.popInboxMessage(args.instance, args.envelopeId);
        if (!envelope) {
          return { error: `h2a_inbox pop: no envelope ${args.envelopeId} for ${args.instance}` };
        }
        return { envelope };
      }
      default:
        return {
          error: `h2a_inbox: unknown action '${String(args.action)}', expected read|put|pop`
        };
    }
  } catch (err) {
    return safeError(err);
  }
}

export function handleAppendJournal(
  store: LocalStore,
  args: { negotiationId?: string; payload?: H2AJournalPayload<unknown> } | undefined
): McpToolResult | McpErrorResult {
  if (!args || typeof args.negotiationId !== "string" || args.negotiationId.length === 0) {
    return { error: "h2a_append_journal: missing 'negotiationId'" };
  }
  if (!args.payload || typeof args.payload !== "object") {
    return { error: "h2a_append_journal: missing 'payload'" };
  }
  try {
    const entry = store.appendNegotiationEvent(args.negotiationId, args.payload);
    return { entry };
  } catch (err) {
    return safeError(err);
  }
}

export function handleOpenNegotiation(
  store: LocalStore,
  args: { record?: H2ANegotiationRecord } | undefined
): McpToolResult | McpErrorResult {
  if (!args || typeof args.record !== "object" || args.record === null) {
    return { error: "h2a_open_negotiation: missing 'record' object" };
  }
  try {
    const persisted = store.openNegotiation(args.record);
    return { record: persisted };
  } catch (err) {
    return safeError(err);
  }
}

interface OfferLikeArgs {
  negotiationId?: string;
  instance?: string;
  artifact?: unknown;
  eventId?: string;
  causationId?: string;
  correlationId?: string;
}

/**
 * Resolve causation/correlation for an MCP-driven journal append, mirroring
 * the CLI semantics (DEC-033): explicit args always win, otherwise inherit
 * from the previous journal entry — `causationId` defaults to the previous
 * entry's `id`, `correlationId` is propagated as-is.
 */
function resolveChain(
  store: LocalStore,
  negotiationId: string,
  explicit: { causationId?: string; correlationId?: string }
): { causationId?: string; correlationId?: string } {
  const entries = store.readNegotiationJournal(negotiationId);
  const previous = entries[entries.length - 1] as
    | { id: string; correlationId?: string }
    | undefined;
  const out: { causationId?: string; correlationId?: string } = {};
  if (explicit.causationId) {
    out.causationId = explicit.causationId;
  } else if (previous) {
    out.causationId = previous.id;
  }
  if (explicit.correlationId) {
    out.correlationId = explicit.correlationId;
  } else if (previous && previous.correlationId !== undefined) {
    out.correlationId = previous.correlationId;
  }
  return out;
}

function handleOfferLike(
  store: LocalStore,
  toolName: "h2a_offer" | "h2a_counteroffer",
  args: OfferLikeArgs | undefined
): McpToolResult | McpErrorResult {
  if (!args || typeof args.negotiationId !== "string" || args.negotiationId.length === 0) {
    return { error: `${toolName}: missing 'negotiationId'` };
  }
  if (typeof args.instance !== "string" || args.instance.length === 0) {
    return { error: `${toolName}: missing 'instance'` };
  }
  if (args.artifact === undefined) {
    return { error: `${toolName}: missing 'artifact'` };
  }
  const record = store.readNegotiation(args.negotiationId);
  if (!record) {
    return { error: `${toolName}: negotiation ${args.negotiationId} not found` };
  }
  const type = toolName === "h2a_offer" ? "propose" : "counter";
  const chain = resolveChain(store, args.negotiationId, {
    causationId: args.causationId,
    correlationId: args.correlationId
  });
  const payload: H2AJournalPayload<{ artifact: unknown }> = {
    id: args.eventId ?? `evt-${type}-${Date.now().toString(36)}`,
    type,
    actor: { instance: args.instance, role: "CONDUCTOR", scope: record.scope },
    body: { artifact: args.artifact },
    createdAt: nowIso(),
    ...chain
  };
  try {
    const entry = store.appendNegotiationEvent(args.negotiationId, payload);
    return { entry };
  } catch (err) {
    return safeError(err);
  }
}

export function handleOffer(
  store: LocalStore,
  args: OfferLikeArgs | undefined
): McpToolResult | McpErrorResult {
  return handleOfferLike(store, "h2a_offer", args);
}

export function handleCounteroffer(
  store: LocalStore,
  args: OfferLikeArgs | undefined
): McpToolResult | McpErrorResult {
  return handleOfferLike(store, "h2a_counteroffer", args);
}

export function handleSign(
  store: LocalStore,
  args:
    | {
        negotiationId?: string;
        instance?: string;
        artifact?: unknown;
        privateKeyPem?: string;
        eventId?: string;
        causationId?: string;
        correlationId?: string;
      }
    | undefined
): McpToolResult | McpErrorResult {
  if (!args || typeof args.negotiationId !== "string" || args.negotiationId.length === 0) {
    return { error: "h2a_sign: missing 'negotiationId'" };
  }
  if (typeof args.instance !== "string" || args.instance.length === 0) {
    return { error: "h2a_sign: missing 'instance'" };
  }
  if (args.artifact === undefined) {
    return { error: "h2a_sign: missing 'artifact'" };
  }
  if (typeof args.privateKeyPem !== "string" || args.privateKeyPem.length === 0) {
    return { error: "h2a_sign: missing 'privateKeyPem'" };
  }
  const record = store.readNegotiation(args.negotiationId);
  if (!record) {
    return { error: `h2a_sign: negotiation ${args.negotiationId} not found` };
  }
  try {
    const artifactHash = computeHash(args.artifact);
    const signature = signCanonical(
      { artifactHash },
      { by: args.instance, privateKeyPem: args.privateKeyPem }
    );
    const chain = resolveChain(store, args.negotiationId, {
      causationId: args.causationId,
      correlationId: args.correlationId
    });
    const payload: H2AJournalPayload<{
      kind: "signature";
      artifactHash: string;
      signature: typeof signature;
    }> = {
      id: args.eventId ?? `evt-sign-${Date.now().toString(36)}`,
      type: "event",
      actor: { instance: args.instance, role: "CONDUCTOR", scope: record.scope },
      body: { kind: "signature", artifactHash, signature },
      createdAt: nowIso(),
      ...chain
    };
    const entry = store.appendNegotiationEvent(args.negotiationId, payload);
    return { entry };
  } catch (err) {
    return safeError(err);
  }
}

export function handleStabilize(
  store: LocalStore,
  args: { negotiationId?: string; eventId?: string } | undefined
): McpToolResult | McpErrorResult {
  if (!args || typeof args.negotiationId !== "string" || args.negotiationId.length === 0) {
    return { error: "h2a_stabilize: missing 'negotiationId'" };
  }
  try {
    const result = store.stabilizeNegotiation(args.negotiationId, { eventId: args.eventId });
    return {
      record: result.record,
      artifactHash: result.artifactHash,
      signers: result.signers,
      artifactPath: result.artifactPath,
      finalEvent: { id: result.finalEvent.id, sequence: result.finalEvent.sequence }
    };
  } catch (err) {
    return safeError(err);
  }
}

export function handleEscalate(
  store: LocalStore,
  args:
    | {
        negotiationId?: string;
        instance?: string;
        channel?: string;
        payload?: unknown;
        causationId?: string;
        correlationId?: string;
      }
    | undefined
): McpToolResult | McpErrorResult {
  if (!args || typeof args.negotiationId !== "string" || args.negotiationId.length === 0) {
    return { error: "h2a_escalate: missing 'negotiationId'" };
  }
  if (typeof args.instance !== "string" || args.instance.length === 0) {
    return { error: "h2a_escalate: missing 'instance'" };
  }
  if (typeof args.channel !== "string" || !ESCALATION_CHANNELS.has(args.channel)) {
    return { error: "h2a_escalate: channel must be advise|decide|alert" };
  }
  const record = store.readNegotiation(args.negotiationId);
  if (!record) {
    return { error: `h2a_escalate: negotiation ${args.negotiationId} not found` };
  }
  const channel = args.channel as "advise" | "decide" | "alert";
  const chain = resolveChain(store, args.negotiationId, {
    causationId: args.causationId,
    correlationId: args.correlationId
  });
  const payload: H2AJournalPayload<{
    kind: "escalation";
    channel: "advise" | "decide" | "alert";
    payload: unknown;
  }> = {
    id: `evt-escalate-${Date.now().toString(36)}`,
    type: "escalate",
    actor: { instance: args.instance, role: "MANDATAIRE", scope: record.scope },
    body: { kind: "escalation", channel, payload: args.payload ?? null },
    createdAt: nowIso(),
    ...chain
  };
  try {
    const entry = store.appendNegotiationEvent(args.negotiationId, payload);
    return { entry };
  } catch (err) {
    return safeError(err);
  }
}

export function handleSessionOpen(
  sessions: SessionRegistry,
  args:
    | {
        instance?: string;
        host?: string;
        pid?: number;
        interests?: Partial<H2ASessionInterests>;
        subscribedTopics?: readonly string[];
        sessionId?: string;
      }
    | undefined
): McpToolResult | McpErrorResult {
  if (!args || typeof args.instance !== "string" || args.instance.length === 0) {
    return { error: "h2a_session_open: missing 'instance'" };
  }
  if (
    args.subscribedTopics !== undefined &&
    (!Array.isArray(args.subscribedTopics) ||
      args.subscribedTopics.some(
        (topic) =>
          typeof topic !== "string" ||
          !(H2A_SESSION_NOTIFICATION_TOPICS as readonly string[]).includes(topic)
      ))
  ) {
    return {
      error:
        "h2a_session_open: 'subscribedTopics' must be a subset of the canonical topic list"
    };
  }
  try {
    const session = sessions.open({
      instance: args.instance,
      ...(args.host !== undefined ? { host: args.host } : {}),
      ...(args.pid !== undefined ? { pid: args.pid } : {}),
      ...(args.interests !== undefined ? { interests: args.interests } : {}),
      ...(args.subscribedTopics !== undefined
        ? {
            subscribedTopics: args.subscribedTopics as readonly H2ASessionNotificationTopic[]
          }
        : {}),
      ...(args.sessionId !== undefined ? { sessionId: args.sessionId } : {})
    });
    const peers = sessions
      .scanFresh()
      .filter((peer) => peer.sessionId !== session.sessionId);
    return { session, peers };
  } catch (err) {
    return safeError(err);
  }
}

export function handleSessionClose(
  sessions: SessionRegistry,
  args: { sessionId?: string; state?: H2ASessionState } | undefined
): McpToolResult | McpErrorResult {
  if (!args || typeof args.sessionId !== "string" || args.sessionId.length === 0) {
    return { error: "h2a_session_close: missing 'sessionId'" };
  }
  if (
    args.state !== undefined &&
    !H2A_SESSION_STATES.includes(args.state)
  ) {
    return {
      error: `h2a_session_close: unknown state '${String(args.state)}'`
    };
  }
  try {
    const closed = sessions.close(args.sessionId, args.state ?? "closed");
    return { ok: true, sessionId: args.sessionId, session: closed };
  } catch (err) {
    return safeError(err);
  }
}

export function handleDiscoverSessions(
  sessions: SessionRegistry,
  args: { scope?: string; instance?: string } | undefined
): McpToolResult | McpErrorResult {
  try {
    let fresh = sessions.scanFresh();
    if (args?.scope) {
      const wanted = args.scope;
      fresh = fresh.filter((session) =>
        session.interests.scopes.includes(wanted)
      );
    }
    if (args?.instance) {
      const wanted = args.instance;
      fresh = fresh.filter((session) => session.instance === wanted);
    }
    return { sessions: fresh };
  } catch (err) {
    return safeError(err);
  }
}

// DEC-087: NHI posture over the registry. Mirrors `h2a nhi report` — same
// snapshot gatherer + core `auditNhiPosture`, so CLI and MCP agree.
export function handleNhiReport(
  store: LocalStore,
  args: { longLivedKeyMaxDays?: number } | undefined
): McpToolResult | McpErrorResult {
  try {
    const { instances, subagents, keyEvents } = gatherNhiSnapshot(store);
    const report = auditNhiPosture({
      instances,
      subagents,
      keyEvents,
      ...(typeof args?.longLivedKeyMaxDays === "number"
        ? { longLivedKeyMaxDays: args.longLivedKeyMaxDays }
        : {})
    });
    return { report };
  } catch (err) {
    return safeError(err);
  }
}

// DEC-087 (P1b): sign the current posture into an attestation envelope. Same
// snapshot + classifier + envelope builder as `h2a nhi attest`.
export function handleNhiAttest(
  store: LocalStore,
  args:
    | {
        instance?: string;
        privateKeyPem?: string;
        role?: string;
        scope?: string;
        longLivedKeyMaxDays?: number;
      }
    | undefined
): McpToolResult | McpErrorResult {
  if (!args || typeof args.instance !== "string" || args.instance.length === 0) {
    return { error: "h2a_nhi_attest: missing 'instance'" };
  }
  if (typeof args.privateKeyPem !== "string" || args.privateKeyPem.length === 0) {
    return { error: "h2a_nhi_attest: missing 'privateKeyPem'" };
  }
  try {
    const registration = store.findInstance(args.instance);
    const role = args.role ?? registration?.roles?.[0];
    const scope = args.scope ?? registration?.scopes?.[0];
    if (!role || !scope) {
      return {
        error: `h2a_nhi_attest: cannot resolve actor for "${args.instance}" — register it first, or pass role and scope`
      };
    }
    if (!(H2A_ROLES as readonly string[]).includes(role)) {
      return { error: `h2a_nhi_attest: invalid role "${role}"` };
    }
    const { instances, subagents, keyEvents } = gatherNhiSnapshot(store);
    const report = auditNhiPosture({
      instances,
      subagents,
      keyEvents,
      ...(typeof args.longLivedKeyMaxDays === "number"
        ? { longLivedKeyMaxDays: args.longLivedKeyMaxDays }
        : {})
    });
    const envelope = nhiAttestationEnvelope({
      report,
      actor: { instance: args.instance, role: role as H2ARole, scope }
    });
    const attestation = signEnvelope(envelope, {
      by: args.instance,
      privateKeyPem: args.privateKeyPem
    });
    return { attestation };
  } catch (err) {
    return safeError(err);
  }
}

// DEC-089 (P1c): coordinated decommission — revoke keys + subagents + tombstone.
export function handleNhiOffboard(
  store: LocalStore,
  args: { instance?: string; reason?: string } | undefined
): McpToolResult | McpErrorResult {
  if (!args || typeof args.instance !== "string" || args.instance.length === 0) {
    return { error: "h2a_nhi_offboard: missing 'instance'" };
  }
  try {
    const tombstone = store.offboardInstance(args.instance, args.reason);
    return { tombstone };
  } catch (err) {
    return safeError(err);
  }
}

export function notImplemented(toolName: string): McpErrorResult {
  return { error: `${toolName}: not implemented in this slice` };
}
