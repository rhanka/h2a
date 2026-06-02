/**
 * EVO-13 P1 — ingestion trust boundary for an instance mirror (DEC-125).
 *
 * Reuses the EVO-11 verification primitives (`verifyEnvelopeSignature` +
 * `H2AReplayGuard`). Authority is **possession of a key the operator enrolled**,
 * never a self-declared instance id and never a shared bearer token (the Opus
 * review rejected both). Two safeguards, both keyed on the VERIFIED signing key:
 *   1. the envelope must verify against a registry key for the signer OR an
 *      operator-enrolled key (`enrolledKeys`) — an unknown key is refused (no
 *      trust-on-first-use across the remote boundary);
 *   2. a registration is applied only if its `publicKeys` contains the verified
 *      key — an agent can mirror ONLY its own identity (no namespace squatting).
 *
 * Never throws on rejection; only the caller-supplied `applyRegistration` may.
 */
import {
  isH2AEnvelope,
  verifyEnvelopeSignature,
  type H2AActorRegistration,
  type H2AEnvelope,
  type H2AReplayCheck,
  type H2AReplayGuard
} from "@sentropic/h2a";

import { H2A_MIRROR_BODY_KIND, type H2AInstanceMirrorBody } from "./build.js";

export type H2AMirrorRejection =
  | "malformed"
  | "not-mirror"
  | "no-signature"
  | "unauthorized-key"
  | "bad-signature"
  | "invalid-timestamp"
  | "expired"
  | "future"
  | "replayed"
  | "instance-key-mismatch";

export type H2AMirrorResult =
  | { ok: true; applied: string[]; signer: string }
  | { ok: false; reason: H2AMirrorRejection };

export interface AcceptMirrorOptions {
  /** Active public-key PEMs already registered for the signer (registry + keyring, minus revoked). */
  resolvePublicKeys: (signerInstance: string) => string[];
  /** Operator-enrolled key PEMs allowed to mirror/bootstrap (out-of-band trust, not a wire token). */
  enrolledKeys: readonly string[];
  /** Replay guard (DEC-074) — its freshness window also enforces timestamp checks. */
  guard: H2AReplayGuard;
  /** Apply an authorized registration to the local (remote-side) store. */
  applyRegistration: (registration: H2AActorRegistration) => void;
  /** Reference time (ms epoch) for the guard. Defaults to `Date.now()`. */
  now?: number;
}

export function acceptMirrorEnvelope(payload: unknown, options: AcceptMirrorOptions): H2AMirrorResult {
  if (!isH2AEnvelope(payload)) return { ok: false, reason: "malformed" };
  const envelope = payload as H2AEnvelope<H2AInstanceMirrorBody>;
  const body = envelope.body;
  if (!body || body.kind !== H2A_MIRROR_BODY_KIND || !Array.isArray(body.registrations)) {
    return { ok: false, reason: "not-mirror" };
  }

  const signer = envelope.actor.instance;
  if (!(envelope.signatures ?? []).some((s) => s.by === signer)) {
    return { ok: false, reason: "no-signature" };
  }

  const candidates = Array.from(new Set([...options.resolvePublicKeys(signer), ...options.enrolledKeys]));
  if (candidates.length === 0) return { ok: false, reason: "unauthorized-key" };
  const verifiedPem = candidates.find((pem) => verifyEnvelopeSignature(envelope, pem, { by: signer }));
  if (!verifiedPem) return { ok: false, reason: "bad-signature" };

  // Namespacing: only registrations whose publicKeys include the verified key —
  // an agent can publish ONLY its own identity. Checked BEFORE the guard so a
  // wholly-unauthorized payload does not consume the envelope id.
  const authorized = body.registrations.filter(
    (reg) => Array.isArray(reg.publicKeys) && reg.publicKeys.includes(verifiedPem)
  );
  if (authorized.length === 0) return { ok: false, reason: "instance-key-mismatch" };

  const replay: H2AReplayCheck = options.guard.accept(envelope, options.now);
  if (!replay.ok) return { ok: false, reason: replay.reason as H2AMirrorRejection };

  for (const reg of authorized) options.applyRegistration(reg);
  return { ok: true, applied: authorized.map((r) => r.instance ?? r.id), signer };
}
