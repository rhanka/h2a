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
 *
 * ── INGEST BOUNDARY (2026-07-25) ───────────────────────────────────────────
 *
 * Verification says the bytes came from a key we trust. It says nothing about
 * what is IN them, and a trusted sender running an older CLI sends raw records —
 * `workspace.path`, `launchContext`, `pid`, `file://` endpoints. So every record
 * is narrowed by `ingest.ts` (which reuses the SEND plans) before it reaches a
 * caller's apply callback.
 *
 * That narrowing is made structural by the callback TYPES: they take
 * `H2AMirrored*`, not the local record types, so no caller of this function can
 * be handed an unnarrowed record even by writing its callback carelessly. Same
 * instrument as `sanitizeActorForMirror` on the send side — the raw value is not
 * in scope at the point it would be used, so "it cannot leak here" is a
 * consequence of the signature rather than a claim in a comment.
 *
 * Ordering, since a signed payload forces it: narrowing is strictly AFTER
 * signature verification (narrowing first would alter the signed bytes and every
 * push would fail), and strictly after the `publicKeys` authorization filter, so
 * it can never change an authorization outcome. See `ingest.ts` for the full
 * argument and for what this consequently does NOT claim.
 */
import {
  isH2AEnvelope,
  verifyEnvelopeSignature,
  type H2AEnvelope,
  type H2AReplayCheck,
  type H2AReplayGuard
} from "@sentropic/h2a";

import { H2A_MIRROR_BODY_KIND, type H2AInstanceMirrorBody } from "./build.js";
import {
  createNarrowingTally,
  narrowIngestedPresence,
  narrowIngestedRegistration,
  narrowIngestedSubagent,
  type H2AMirroredRegistration,
  type H2AMirroredSession,
  type H2AMirroredSubagentBinding,
  type MirrorNarrowingReport
} from "./ingest.js";

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
  | "stale-sequence"
  | "instance-key-mismatch";

export type H2AMirrorResult =
  | {
      ok: true;
      applied: string[];
      signer: string;
      /**
       * What the ingest boundary removed from this push. `records: 0` means the
       * sender already sends narrowed records — i.e. it is running a CLI with the
       * send boundary. Anything higher is an un-upgraded sender, and this is the
       * signal that makes that visible instead of silent.
       */
      narrowed: MirrorNarrowingReport;
    }
  | { ok: false; reason: H2AMirrorRejection };

export interface AcceptMirrorOptions {
  /** Active public-key PEMs already registered for the signer (registry + keyring, minus revoked). */
  resolvePublicKeys: (signerInstance: string) => string[];
  /** Operator-enrolled key PEMs allowed to mirror/bootstrap (out-of-band trust, not a wire token). */
  enrolledKeys: readonly string[];
  /** Replay guard (DEC-074) — its freshness window also enforces timestamp checks. */
  guard: H2AReplayGuard;
  /**
   * Apply an authorized registration to the local (remote-side) store.
   *
   * Receives the NARROWED row (`H2AMirroredRegistration`), never the raw one —
   * see the ingest-boundary note in the module header. The type is the boundary.
   */
  applyRegistration: (registration: H2AMirroredRegistration) => void;
  /**
   * P2: apply a presence session (the impl RE-STAMPS heartbeatAt with the remote
   * clock so freshness derives from the beat). Only called for sessions whose
   * instance is owned by the verified key. Omit to ignore presence (P1 behavior).
   *
   * Receives the NARROWED record (`H2AMirroredSession`), never the raw one.
   */
  applyPresence?: (session: H2AMirroredSession) => void;
  /**
   * P2 fencing: return true iff `seq` is strictly newer than the last applied
   * for `signerInstance` (and record it). Return false to reject a stale/replayed
   * beat. Omit to skip fencing (P1 behavior).
   */
  fenceSequence?: (signerInstance: string, seq: number) => boolean;
  /**
   * P3: apply a subagent binding (the impl is idempotent — a known binding is a
   * no-op). Only called for bindings whose `parentInstance` is owned by the
   * verified key. Omit to ignore subagents (P1/P2 behavior).
   *
   * Receives the NARROWED binding (`H2AMirroredSubagentBinding`).
   */
  applySubagent?: (binding: H2AMirroredSubagentBinding) => void;
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

  // P2 monotonic fencing — after replay/freshness so a stale beat (new id, fresh
  // window) still can't regress/resurrect state across a guard reset/restart.
  if (typeof body.seq === "number" && options.fenceSequence) {
    if (!options.fenceSequence(signer, body.seq)) return { ok: false, reason: "stale-sequence" };
  }

  // ── INGEST BOUNDARY ───────────────────────────────────────────────────────
  // Everything below narrows before it applies. The tally observes what the
  // plans removed, so an un-upgraded sender is a number on the response instead
  // of a silent repair. Narrowing starts only HERE: every authorization decision
  // above (key ownership, replay, fencing) has already been taken on the record
  // as the sender signed it, so no narrowing step can have influenced one.
  const tally = createNarrowingTally();

  const narrowedRegistrations = authorized.map((reg) => {
    const narrowed = narrowIngestedRegistration(reg);
    tally.note(reg, narrowed);
    return narrowed;
  });
  for (const reg of narrowedRegistrations) options.applyRegistration(reg);

  // Ownership derives from the NARROWED rows: `id`/`instance` are transmitted by
  // the registration plan, so this is the same set either way — taken from the
  // narrowed rows so the raw list is not read again after this point.
  const owned = new Set(narrowedRegistrations.map((r) => r.instance ?? r.id));

  // P2 presence — only sessions whose instance the verified key owns.
  if (options.applyPresence && Array.isArray(body.presence)) {
    for (const session of body.presence) {
      if (!owned.has(session.instance)) continue;
      const narrowed = narrowIngestedPresence(session);
      tally.note(session, narrowed);
      options.applyPresence(narrowed);
    }
  }

  // P3 subagents — only bindings whose parent the verified key owns.
  if (options.applySubagent && Array.isArray(body.subagents)) {
    for (const binding of body.subagents) {
      if (!owned.has(binding.parentInstance)) continue;
      const narrowed = narrowIngestedSubagent(binding);
      tally.note(binding, narrowed);
      options.applySubagent(narrowed);
    }
  }

  return {
    ok: true,
    applied: narrowedRegistrations.map((r) => r.instance ?? r.id),
    signer,
    narrowed: tally.report()
  };
}
