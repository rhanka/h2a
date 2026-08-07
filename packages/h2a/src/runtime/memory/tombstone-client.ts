/**
 * Tombstone client — WP11 TOMBSTONE SLICE. Requests an erasure through an
 * INJECTED `MemoryProducerPort.requestTombstone`, applying the SAME
 * anti-fabrication discipline `./d11-ceremony.ts` fought four independent
 * NO-GO rounds to establish, because a tombstone is ALSO a destructive op
 * (see `destructive_op_two_invariants`): INV-1 (prove authorization
 * POSITIVELY, never absence-of-denial) and INV-2 (the check→act step is
 * STRUCTURAL, not a cooperative assertion a caller can skip).
 *
 * THE PORT'S OWN DOC (`./port-v1.ts`, `TombstoneAuthorization`) states the
 * requirement in one line: "authority never rests on a fabricable asserted
 * `requester`" — the signed authorization's "cryptographic verification is
 * h2a's". This module IS that verification.
 *
 * REUSED, NOT REINVENTED (I4 — no second trust vocabulary): the trust anchor
 * is `D11TrustedKeystore` / `VerifySignatureFn` / `defaultVerifySignature`,
 * imported UNCHANGED from `./d11-ceremony.ts`. There is exactly ONE
 * construction-time keystore concept in `runtime/memory/`, not one per
 * client — a caller wiring `createTombstoneRequester` and
 * `createD11Ceremony` at the same trusted construction site hands both the
 * SAME `trustedKeystore` instance.
 *
 * ===========================================================================
 * SECURITY DESIGN — applying the D11 rounds 1-4 lessons up front, not as
 * afterthoughts (this module has no "round 2/3/4" of its own precisely
 * because it starts from what those rounds already proved).
 * ===========================================================================
 *
 * 1. CONSTRUCTION-TIME ANCHOR (D11 ROUND 1 §1): `createTombstoneRequester({
 *    trustedKeystore, verifySignature? })` CLOSES OVER the trusted keystore.
 *    `trustedKeystore` is never a per-call input to the returned
 *    `requestTombstone(...)` — a per-call-injectable trust anchor is not a
 *    defense, it is a hook for the caller (the untrusted party this module
 *    exists to defend against) to supply their own keystore and sign their
 *    own fabrication. Throws SYNCHRONOUSLY on a missing/malformed keystore —
 *    a construction-site wiring bug fails loudly, not silently.
 *
 * 2. AUTHORITY = THE SIGNATURE, NEVER THE `requester` STRING. The per-call
 *    `requester` argument is carried into the outgoing `TombstoneAuthorization`
 *    purely as the DECORATIVE hint the port's own doc says it is — it is
 *    structurally NEVER read by any check in this module. The erasure
 *    proceeds ONLY when `signedAuthorization` verifies against the trusted
 *    keystore for its OWN CLAIMED `signerLeg` — the canonical CRYPTO
 *    PRINCIPAL, exactly the D11 ROUND 4 FIX 2 discipline (compare/authorize
 *    on the verified key, never a session/name string a caller merely
 *    asserts). A caller lying about `requester` — supplying a signature
 *    genuinely produced by leg A while claiming `requester: "someone-else"`
 *    — has ZERO effect on the outcome: it is not a trust decision anywhere
 *    in this module.
 *
 * 3. TARGET-BINDING (anti-replay, the D11 ROUND 4 lesson mapped onto this
 *    module's own replay surface): the signed payload MUST include the FULL
 *    `target` (node id, or edge source+target+relation) actually being
 *    requested. TWO INDEPENDENT layers enforce this, mirroring ROUND 4 FIX
 *    1's double-check (structural equality AND an independent payload
 *    rebuild, neither trusting the other):
 *      a. STRUCTURAL — `signedAuthorization.target` must canonicalize
 *         identically to the `target` argument actually being requested
 *         (`canonicalize`, the SAME primitive `./d11-ceremony.ts` signs
 *         with) — refused on any mismatch, before a single signature byte
 *         is checked.
 *      b. CRYPTOGRAPHIC — the signature is verified over a payload REBUILT
 *         from THIS CALL's OWN `target` argument, never from
 *         `signedAuthorization.target` as the source of truth. A signature
 *         genuinely produced for target A, attached to a
 *         `signedAuthorization` object whose `target` field is edited to
 *         CLAIM B (to slip past check (a)), still fails here: the payload
 *         built from the real argument B does not match what was actually
 *         signed (A). Either edit — the target argument or the claimed
 *         field — is caught by one of (a)/(b) independently, so a signed
 *         authorization for target A can never be replayed to erase target
 *         B, regardless of which side of the mismatch an attacker tampers.
 *
 *    MUTATION-CHECK RESULT (reproduced, honest residual — see
 *    `test/memory-tombstone-client.test.js`'s own comment for the procedure):
 *    neutralizing layer (a) ALONE still leaves every REPLAY attempt refused
 *    — layer (b) alone is sufficient, because it always rebuilds its payload
 *    from the real `target` argument regardless of what layer (a) does.
 *    Layer (a) is therefore NOT an independently load-bearing security
 *    boundary the way D11 ROUND 4's nonce/fingerprint checks are each
 *    necessary for a DISTINCT attack — it is a cheap, non-cryptographic
 *    EARLY reject (saves a keystore lookup + signature verification on an
 *    obviously-mismatched claim) and defense-in-depth against a
 *    hypothetically broken or malicious injected `verifySignature` that
 *    ignores its own payload argument. Neutralizing the KEYSTORE LOOKUP and
 *    the SIGNATURE VERIFICATION together, by contrast, DOES let an
 *    untrusted-key, a tampered/garbage signature, and a claim-edited replay
 *    all reach `applied:true` — those two checks (folded into layer (b)) are
 *    the module's actual anti-fabrication anchor; layer (a) is a hardening
 *    measure on top of it, not a second independent one.
 *
 * 4. FAIL-CLOSED (I5), at every step, in order: a malformed `target`, a
 *    missing/malformed `signedAuthorization`, a target-binding mismatch, an
 *    untrusted/unknown `signerLeg`, an invalid signature, a missing `port`,
 *    or a `port` call that throws/rejects — ALL produce a structured
 *    `{applied:false, reason}`, NEVER a silent success and never an uncaught
 *    throw a caller might mistake for "nothing happened". `port.requestTombstone`
 *    is reached ONLY after every prior check has POSITIVELY passed — this
 *    module proves authorization affirmatively (INV-1); it never infers
 *    authorization from the absence of a denial.
 *
 * ===========================================================================
 * BOUNDARY (enforceability ladder — where THIS module's guarantee stops):
 * ===========================================================================
 * graphify keeps the `principal_owner` authority check (§3.5) — this client
 * verifies WHO cryptographically signed the request, not whether that
 * signer is authorized to erase THIS PRINCIPAL's facts; that policy decision
 * remains graphify's, gate-side, on the far side of the port. graphify ALSO
 * owns the recall-side tombstone FOLD-OUT CASCADE over edges (a tombstoned
 * node's edges fold out at recall, §7) — this client requests ONE tombstone
 * for ONE target and does NOT enumerate or cascade to a node's edges itself;
 * the cascade is graphify's, entirely on the read side, out of this write-side
 * client's scope. Stated plainly: this module's guarantee stops at "a
 * cryptographically verified, target-bound request reached the port
 * unmodified" — everything past the port (principal authority, cascade,
 * durable erasure) is graphify's to enforce and is not re-verified here.
 */

import type {
  MemoryContext,
  MemoryProducerPort,
  TombstoneAuthorization,
  TombstoneOutcome,
  TombstoneTarget
} from "./port-v1.js";
import {
  defaultVerifySignature,
  type D11TrustedKeystore,
  type VerifySignatureFn
} from "./d11-ceremony.js";
import type { LegIdentity } from "./promote-client.js";
import { canonicalize } from "../../canonical.js";

/**
 * The signed authorization shape a caller must supply as
 * `TombstoneAuthorization.signedAuthorization` for this client to ever
 * proceed. `signerLeg` reuses `LegIdentity` (I4 — the SAME opaque
 * `{model, session}` shape `./d11-ceremony.ts` and `./promote-client.ts`
 * already use, not a second identity taxonomy) precisely so it is looked up
 * in the SAME `trustedKeystore` a leg's key is. The signature is a base64
 * Ed25519 signature over the canonicalized `{signerLeg, target}` payload —
 * binding the identity claim to BOTH who claims it and which target it
 * authorizes (target-binding, see the module doc §3).
 */
export interface TombstoneSignedAuthorization {
  readonly signerLeg: LegIdentity;
  readonly target: TombstoneTarget;
  readonly signature: string;
}

/** What `createTombstoneRequester` closes over — construction-time only, never per-call. */
export interface CreateTombstoneRequesterOptions {
  /** The trust anchor. See `D11TrustedKeystore` (`./d11-ceremony.ts`) — reused unchanged (I4). */
  readonly trustedKeystore: D11TrustedKeystore;
  /** Defaults to real Ed25519 (`defaultVerifySignature`, `./d11-ceremony.ts`). Override only for tests. */
  readonly verifySignature?: VerifySignatureFn | undefined;
}

export interface RequestTombstoneResult {
  readonly outcome: TombstoneOutcome;
  /** True when refused locally (bad shape, target-binding mismatch, untrusted/invalid signature, or an absent/unreachable port) — the port was never called, or its call never resolved to a success. */
  readonly localOnly: boolean;
}

export type RequestTombstone = (
  target: TombstoneTarget,
  requester: string,
  signedAuthorization: unknown,
  ctx: MemoryContext,
  port: MemoryProducerPort | undefined | null
) => Promise<RequestTombstoneResult>;

function refuse(reason: string): RequestTombstoneResult {
  return { outcome: { applied: false, reason }, localOnly: true };
}

function errorReason(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Shape-validate a `TombstoneTarget` — malformed input REFUSES (I5), never reaches the port. */
function isValidTombstoneTarget(value: unknown): value is TombstoneTarget {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.kind === "node") {
    return typeof v.id === "string" && v.id.length > 0;
  }
  if (v.kind === "edge") {
    if (typeof v.source !== "string" || v.source.length === 0) return false;
    if (typeof v.target !== "string" || v.target.length === 0) return false;
    if (v.relation !== undefined && typeof v.relation !== "string") return false;
    return true;
  }
  return false;
}

/**
 * Shape-validate a `TombstoneSignedAuthorization` BEFORE any crypto — a
 * malformed or absent value refuses here, cheaply, mirroring
 * `d11-ceremony.ts`'s `isAuthorSignatureShape` discipline (shape-before-
 * signature).
 */
function isTombstoneSignedAuthorizationShape(value: unknown): value is TombstoneSignedAuthorization {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.signature !== "string" || v.signature.length === 0) return false;
  if (typeof v.signerLeg !== "object" || v.signerLeg === null) return false;
  const leg = v.signerLeg as Record<string, unknown>;
  if (typeof leg.model !== "string" || typeof leg.session !== "string") return false;
  return isValidTombstoneTarget(v.target);
}

/**
 * The signed payload — built from `signerLeg` (as CLAIMED by the
 * authorization, looked up against the trusted keystore separately) and
 * `target` as an EXPLICIT parameter, never read off
 * `signedAuthorization.target`. Callers of this function (the gate, below)
 * ALWAYS pass THIS CALL's own `target` argument — the one source of truth
 * for what a valid signature must cover — so a signature genuinely produced
 * for a DIFFERENT target fails to verify here even if the authorization
 * object's own `target` field were tampered to match (module doc §3b).
 */
function tombstoneSignedPayload(signerLeg: LegIdentity, target: TombstoneTarget): unknown {
  return { signerLeg, target };
}

/**
 * Factory: builds the actual `requestTombstone` function, CLOSED OVER
 * `trustedKeystore` (and, optionally, `verifySignature`) — the D11 ROUND 1
 * §1 anti-fabrication anchor, applied here from the start. Throws
 * synchronously on a missing/malformed `trustedKeystore`.
 */
export function createTombstoneRequester(options: CreateTombstoneRequesterOptions): RequestTombstone {
  if (!options || typeof options.trustedKeystore?.getPublicKey !== "function") {
    throw new Error(
      "createTombstoneRequester requires a trustedKeystore with getPublicKey(leg) — construction-time, not caller-swappable"
    );
  }
  const trustedKeystore = options.trustedKeystore;
  const verifySignature: VerifySignatureFn =
    typeof options.verifySignature === "function" ? options.verifySignature : defaultVerifySignature;

  /**
   * Request an erasure of `target`. `requester` is a DECORATIVE hint only —
   * see the module doc §2 — structurally never consulted for a trust
   * decision anywhere below. `signedAuthorization` is verified in full
   * (shape, target-binding, trusted signer, signature) BEFORE `port` is
   * ever touched (I5, positive-proof — see module doc §4); on ANY failure,
   * the port is NEVER called.
   */
  return async function requestTombstone(
    target: TombstoneTarget,
    requester: string,
    signedAuthorization: unknown,
    ctx: MemoryContext,
    port: MemoryProducerPort | undefined | null
  ): Promise<RequestTombstoneResult> {
    if (!isValidTombstoneTarget(target)) {
      return refuse("malformed tombstone target — refusing (fail-closed)");
    }

    if (!isTombstoneSignedAuthorizationShape(signedAuthorization)) {
      return refuse(
        "no valid signed authorization (signerLeg/target/signature) — refusing (fail-closed); authority never rests on the asserted requester"
      );
    }

    // --- Target-binding, layer (a): STRUCTURAL equality (module doc §3a). ---
    if (canonicalize(signedAuthorization.target) !== canonicalize(target)) {
      return refuse(
        "the signed authorization's target does not match the requested target — refusing (anti-replay, target-binding)"
      );
    }

    const publicKey = trustedKeystore.getPublicKey(signedAuthorization.signerLeg);
    if (typeof publicKey !== "string" || publicKey.length === 0) {
      return refuse(
        "no trusted public key for the claimed signer — refusing (fail-closed; unknown signer or empty keystore)"
      );
    }

    // --- Target-binding, layer (b): CRYPTOGRAPHIC, rebuilt from THIS call's
    // own `target` argument, never from `signedAuthorization.target`
    // (module doc §3b). ---
    let signatureOk: boolean;
    try {
      signatureOk = verifySignature(
        tombstoneSignedPayload(signedAuthorization.signerLeg, target),
        signedAuthorization.signature,
        publicKey
      );
    } catch (err) {
      return refuse(`signature verification threw — ${errorReason(err)}`);
    }
    if (!signatureOk) {
      return refuse(
        "the signed authorization is invalid — refusing (fabricated, tampered, or signed by the wrong key)"
      );
    }

    // Authorization POSITIVELY proven. `requester` is still never consulted
    // above this line — it travels into the outgoing `TombstoneAuthorization`
    // purely as the decorative field the port's own doc describes.
    const auth: TombstoneAuthorization = { requester, signedAuthorization };

    if (!port) {
      return refuse("no memory producer port injected — refusing (fail-closed, I5)");
    }

    try {
      const outcome = await port.requestTombstone(target, auth, ctx);
      return { outcome, localOnly: false };
    } catch (err) {
      return refuse(`memory producer port unreachable: ${errorReason(err)}`);
    }
  };
}
