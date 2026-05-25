/**
 * Remote-receive pipeline (DEC-075), slice 3a of the signed-bearer
 * transport-auth workstream (DEC-032 / DEC-073 / DEC-074).
 *
 * `acceptRemoteEnvelope` is the trust boundary for an envelope arriving from
 * off-host: it does NOT trust the channel. It verifies, in order:
 *   1. the payload is a well-formed H2A envelope,
 *   2. it declares a local delivery target,
 *   3. it carries a signature by its emitter (`actor.instance`) that verifies
 *      against that emitter's public key (DEC-073),
 *   4. it is fresh and not a replay (DEC-074),
 * and only then delivers it to the target's local inbox.
 *
 * The pipeline takes its key lookup, replay guard and delivery as callbacks, so
 * it is transport-agnostic (the HTTP wiring is slice 3b) and testable without a
 * network or a real store.
 */

import {
  isH2AEnvelope,
  verifyEnvelopeSignature,
  type H2AEnvelope,
  type H2AReplayCheck,
  type H2AReplayGuard
} from "@sentropic/h2a";

export type H2AAcceptRejection =
  | "malformed"
  | "no-target"
  | "no-signature"
  | "no-public-key"
  | "bad-signature"
  | "invalid-timestamp"
  | "expired"
  | "future"
  | "replayed";

export type H2AAcceptResult =
  | { ok: true; deliveredTo: string; signer: string }
  | { ok: false; reason: H2AAcceptRejection };

export interface AcceptRemoteOptions {
  /**
   * Resolve a signer instance to its ed25519 public-key PEM (typically from the
   * local registry's `publicKeys`). Return undefined for an unknown signer.
   */
  resolvePublicKey: (signerInstance: string) => string | undefined;
  /** Replay guard (DEC-074). Its freshness window also enforces timestamp checks. */
  guard: H2AReplayGuard;
  /** Deliver the accepted envelope to a local recipient's inbox. */
  deliver: (recipient: string, envelope: H2AEnvelope) => void;
  /** Reference time (ms epoch) handed to the guard. Defaults to `Date.now()`. */
  now?: number;
}

/**
 * Validate and deliver a remotely-received envelope. Returns a structured
 * result; never throws on a rejection (only the caller-supplied `deliver` may
 * throw, which propagates).
 */
export function acceptRemoteEnvelope(
  payload: unknown,
  options: AcceptRemoteOptions
): H2AAcceptResult {
  if (!isH2AEnvelope(payload)) {
    return { ok: false, reason: "malformed" };
  }
  const envelope = payload;

  const recipient = envelope.target?.instance;
  if (!recipient) {
    return { ok: false, reason: "no-target" };
  }

  const signer = envelope.actor.instance;
  const hasSignerSig = (envelope.signatures ?? []).some((s) => s.by === signer);
  if (!hasSignerSig) {
    return { ok: false, reason: "no-signature" };
  }

  const publicKeyPem = options.resolvePublicKey(signer);
  if (!publicKeyPem) {
    return { ok: false, reason: "no-public-key" };
  }
  if (!verifyEnvelopeSignature(envelope, publicKeyPem, { by: signer })) {
    return { ok: false, reason: "bad-signature" };
  }

  const replay: H2AReplayCheck = options.guard.accept(envelope, options.now);
  if (!replay.ok) {
    // freshness/replay reasons map 1:1 onto our rejection union
    return { ok: false, reason: replay.reason as H2AAcceptRejection };
  }

  options.deliver(recipient, envelope);
  return { ok: true, deliveredTo: recipient, signer };
}
