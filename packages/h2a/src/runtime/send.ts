import { randomUUID } from "node:crypto";

import {
  createEnvelope,
  signEnvelope,
  verifyEnvelopeSignature,
  type H2AEnvelope,
  type H2ARole
} from "@sentropic/h2a";

import {
  assertHostQualifiedAddress,
  canonicalAddress,
  resolveRecipient,
  type RecipientResolution
} from "./local-files/paths.js";
import { listPresence } from "./local-files/presence.js";
import type { LocalStore } from "./local-files/store.js";

export const H2A_SEND_MAX_MESSAGE_BYTES = 64 * 1024;

export interface H2ASendSigner {
  readonly instance: string;
  readonly privateKeyPem: string;
}

export interface H2ASendMessageBody {
  readonly kind: "message";
  readonly topic: "MESSAGE";
  readonly text: string;
}

export interface SendLocalMessageInput {
  readonly store: LocalStore;
  readonly to: string;
  readonly message: string;
  readonly signer: H2ASendSigner;
  readonly now?: () => number;
  readonly randomId?: () => string;
}

export interface SendLocalMessageResult {
  readonly ok: true;
  readonly from: string;
  readonly requestedRecipient: string;
  readonly recipient: string;
  readonly recipientLive: boolean;
  readonly freshSessions: number;
  readonly resolution: RecipientResolution["kind"] | "registered-name";
  readonly dormant: boolean;
  readonly reason?: string;
  readonly envelope: H2AEnvelope<H2ASendMessageBody>;
}

function requiredText(value: string, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`h2a send: ${label} must be a non-empty string`);
  }
  if (value.includes("\0")) {
    throw new Error(`h2a send: ${label} must not contain NUL bytes`);
  }
  return value;
}

function resolveRegisteredName(
  target: string,
  registrations: ReturnType<LocalStore["listInstances"]>
): { target: string; resolved: boolean } {
  if (target.includes(":") || target.includes("~")) return { target, resolved: false };
  const key = target.trim().toLocaleLowerCase();
  const matches = registrations.filter(
    (registration) => registration.name?.trim().toLocaleLowerCase() === key
  );
  if (matches.length > 1) {
    throw new Error(
      `'${target}' is ambiguous — ${matches.length} registered agents share it; ` +
        `address the exact instance (${matches.map((entry) => entry.instance).join(", ")}).`
    );
  }
  return matches.length === 1
    ? { target: matches[0].instance, resolved: true }
    : { target, resolved: false };
}

/**
 * Create and persist one authenticated local message. This is the only send
 * primitive used by the CLI and MCP adapters: resolution, signing and the
 * active-key check cannot drift between surfaces.
 */
export function sendLocalMessage(input: SendLocalMessageInput): SendLocalMessageResult {
  const requestedRecipient = requiredText(input.to, "target").trim();
  const message = requiredText(input.message, "message");
  if (Buffer.byteLength(message, "utf8") > H2A_SEND_MAX_MESSAGE_BYTES) {
    throw new Error(`h2a send: message exceeds ${H2A_SEND_MAX_MESSAGE_BYTES} UTF-8 bytes`);
  }

  const registration = input.store.findInstance(input.signer.instance);
  if (!registration) {
    throw new Error(`h2a send: sender is not registered: ${input.signer.instance}`);
  }
  const registrations = input.store.listInstances();
  const live = listPresence(input.store.paths.root);
  const registeredName = resolveRegisteredName(requestedRecipient, registrations);
  const resolution = resolveRecipient({
    target: registeredName.target,
    liveInstances: live,
    registeredInstances: registrations.map((entry) => entry.instance)
  });
  if (resolution.kind === "refuse" || resolution.kind === "list") {
    throw new Error(resolution.reason);
  }

  let recipient = registeredName.target;
  if (resolution.kind === "deliver-resolved") recipient = resolution.recipient;
  if (resolution.kind === "deliver-hint") recipient = resolution.liveCandidate;
  assertHostQualifiedAddress(recipient, "recipient");

  const registeredRecipient = registrations.some(
    (entry) => canonicalAddress(entry.instance) === canonicalAddress(recipient)
  );
  const liveRecipient = live.filter(
    (session) => canonicalAddress(session.instance) === canonicalAddress(recipient)
  );
  if (!registeredRecipient && liveRecipient.length === 0) {
    throw new Error(
      `h2a send: '${requestedRecipient}' matches no live or registered agent; resolve the peer first.`
    );
  }

  const role = (registration.roles[0] ?? "AGENTS") as H2ARole;
  const scope = registration.scopes[0] ?? "scope:default";
  const createdAt = new Date((input.now ?? Date.now)()).toISOString();
  const unsigned = createEnvelope<H2ASendMessageBody>({
    id: `env:send:${(input.randomId ?? randomUUID)()}`,
    type: "event",
    actor: { instance: input.signer.instance, role, scope },
    target: { instance: recipient },
    body: { kind: "message", topic: "MESSAGE", text: message },
    createdAt
  });
  const envelope = signEnvelope(unsigned, {
    by: input.signer.instance,
    privateKeyPem: input.signer.privateKeyPem
  });
  const keyIsActive = input.store
    .listInstanceKeys(input.signer.instance)
    .some((publicKeyPem) =>
      verifyEnvelopeSignature(envelope, publicKeyPem, { by: input.signer.instance })
    );
  if (!keyIsActive) {
    throw new Error(`h2a send: private key is not active for ${input.signer.instance}`);
  }

  input.store.putInboxMessage(recipient, envelope);
  const resolutionKind = registeredName.resolved ? "registered-name" : resolution.kind;
  const reason = registeredName.resolved
    ? `registered name resolved to ${recipient}.`
    : "reason" in resolution
      ? resolution.reason
      : undefined;
  return {
    ok: true,
    from: input.signer.instance,
    requestedRecipient,
    recipient,
    recipientLive: liveRecipient.length > 0,
    freshSessions: liveRecipient.length,
    resolution: resolutionKind,
    dormant: liveRecipient.length === 0,
    ...(reason ? { reason } : {}),
    envelope
  };
}

