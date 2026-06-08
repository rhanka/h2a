import { signCanonical, verifyCanonical, type SignOptions } from "./signature.js";
import {
  H2A_ENVELOPE_TYPES,
  H2A_PROTOCOL,
  H2A_ROLES,
  H2A_VERSION,
  type H2AActorRef,
  type H2AEnvelope,
  type H2AEnvelopeType
} from "./types.js";

type CreateEnvelopeInput<TBody> = Omit<
  H2AEnvelope<TBody>,
  "protocol" | "version" | "createdAt"
> & {
  createdAt?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isEnvelopeType(value: unknown): value is H2AEnvelopeType {
  return typeof value === "string" && H2A_ENVELOPE_TYPES.includes(value as H2AEnvelopeType);
}

function isActorRef(value: unknown): value is H2AActorRef {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.instance === "string" &&
    typeof value.scope === "string" &&
    typeof value.role === "string" &&
    H2A_ROLES.includes(value.role as H2AActorRef["role"]) &&
    (value.mandate === undefined || typeof value.mandate === "string")
  );
}

export function createEnvelope<TBody>(
  input: CreateEnvelopeInput<TBody>
): H2AEnvelope<TBody> {
  return {
    protocol: H2A_PROTOCOL,
    version: H2A_VERSION,
    createdAt: input.createdAt ?? new Date().toISOString(),
    ...input
  };
}

/**
 * The portion of an envelope that a signature covers: everything except the
 * `signatures` array itself. Excluding `signatures` makes the signed content
 * stable, so multiple signers each sign the same provenance (DEC-073) — the
 * same model as artifact signing (DEC-035).
 */
function envelopeSigningView<TBody>(
  envelope: H2AEnvelope<TBody>
): Omit<H2AEnvelope<TBody>, "signatures"> {
  const { signatures: _omit, ...rest } = envelope;
  return rest;
}

/**
 * Sign an envelope's provenance (DEC-073). Returns a new envelope with the
 * ed25519 signature appended to `signatures[]`; the original is not mutated.
 * This is the "signed bearer" primitive underpinning authenticated transport
 * (DEC-032): a recipient can verify *who* emitted an envelope independently of
 * the channel it arrived on.
 */
export function signEnvelope<TBody>(
  envelope: H2AEnvelope<TBody>,
  options: SignOptions
): H2AEnvelope<TBody> {
  const signature = signCanonical(envelopeSigningView(envelope), options);
  return {
    ...envelope,
    signatures: [...(envelope.signatures ?? []), signature]
  };
}

/**
 * Verify an envelope's signature(s) against a public key (DEC-073). With
 * `options.by`, only that signer's signature(s) are checked; otherwise any
 * signature that verifies against the key counts. Returns false when the
 * envelope carries no (matching) signature.
 */
export function verifyEnvelopeSignature<TBody>(
  envelope: H2AEnvelope<TBody>,
  publicKeyPem: string,
  options: { by?: string } = {}
): boolean {
  const signatures = envelope.signatures ?? [];
  const candidates = options.by
    ? signatures.filter((s) => s.by === options.by)
    : signatures;
  if (candidates.length === 0) {
    return false;
  }
  const view = envelopeSigningView(envelope);
  return candidates.some((sig) => verifyCanonical(view, sig, publicKeyPem));
}

export function isH2AEnvelope<TBody = unknown>(
  value: unknown
): value is H2AEnvelope<TBody> {
  if (!isRecord(value)) {
    return false;
  }

  if (
    value.protocol !== H2A_PROTOCOL ||
    value.version !== H2A_VERSION ||
    typeof value.id !== "string" ||
    !isEnvelopeType(value.type) ||
    !isActorRef(value.actor) ||
    !("body" in value) ||
    typeof value.createdAt !== "string"
  ) {
    return false;
  }
  // EVO-inbox-threading: optional fields validated only when present.
  if (value.threadId !== undefined && typeof value.threadId !== "string") return false;
  if (value.replyTo !== undefined && typeof value.replyTo !== "string") return false;
  return true;
}
