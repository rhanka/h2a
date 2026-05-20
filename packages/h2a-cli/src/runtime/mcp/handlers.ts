import type {
  H2AActorRegistration,
  H2AEnvelope,
  H2AJournalPayload,
  H2ARole
} from "@sentropic/h2a";

import type { LocalStore } from "../local-files/store.js";

export interface McpToolResult {
  [key: string]: unknown;
}

export interface McpErrorResult {
  error: string;
}

function safeError(reason: unknown): McpErrorResult {
  if (reason instanceof Error) return { error: reason.message };
  return { error: String(reason) };
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

export function notImplemented(toolName: string): McpErrorResult {
  return { error: `${toolName}: not implemented in this slice` };
}
