import {
  computeHash,
  signCanonical,
  type H2AActorRegistration,
  type H2AEnvelope,
  type H2AJournalPayload,
  type H2ANegotiationRecord,
  type H2ARole
} from "@sentropic/h2a";

import type { LocalStore } from "../local-files/store.js";

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

export function notImplemented(toolName: string): McpErrorResult {
  return { error: `${toolName}: not implemented in this slice` };
}
