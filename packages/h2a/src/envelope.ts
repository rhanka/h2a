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

/**
 * Field-level envelope validator. Collects ALL failures into `errors` rather
 * than stopping at the first. Used by `isH2AEnvelope` so the two never drift.
 */
export function validateH2AEnvelope(
  value: unknown
): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];

  if (!isRecord(value)) {
    return { ok: false, errors: ["envelope must be a JSON object"] };
  }

  if (value.protocol !== H2A_PROTOCOL) {
    errors.push(`protocol must be "${H2A_PROTOCOL}" (saw ${JSON.stringify(value.protocol)})`);
  }

  if (typeof value.version !== "string") {
    errors.push("version (string) is required");
  }

  if (typeof value.id !== "string") {
    errors.push("id (string) is required");
  }

  if (!isEnvelopeType(value.type)) {
    errors.push(
      `type must be one of ${H2A_ENVELOPE_TYPES.join(", ")} (saw ${JSON.stringify(value.type)})`
    );
  }

  if (!isRecord(value.actor) || typeof (value.actor as Record<string, unknown>).instance !== "string") {
    errors.push("actor.instance (string) is required");
  }

  if (!("body" in value) || !isRecord(value.body)) {
    errors.push(
      'body (object) is required — message content goes under body, not at the top level' +
      ' (e.g. {"body":{"kind":"message","text":"…"}})'
    );
  }

  if (typeof value.createdAt !== "string") {
    errors.push("createdAt (ISO-8601 string) is required");
  }

  // EVO-inbox-threading: optional fields validated only when present.
  if (value.threadId !== undefined && typeof value.threadId !== "string") {
    errors.push("threadId must be a string when present");
  }
  if (value.replyTo !== undefined && typeof value.replyTo !== "string") {
    errors.push("replyTo must be a string when present");
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true };
}

export function isH2AEnvelope<TBody = unknown>(
  value: unknown
): value is H2AEnvelope<TBody> {
  return validateH2AEnvelope(value).ok;
}
