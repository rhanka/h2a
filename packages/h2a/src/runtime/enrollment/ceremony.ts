/**
 * h2a's side of the PRINCIPAL↔AGENT enrollment ceremony (P1, step 3).
 *
 * Implements Part B of the ratified contract
 * `docs/superpowers/specs/2026-07-24-h2a-feed-contract-for-sentropic.md`
 * (RATIFIED by the sentropic architect 2026-07-24, amended 2026-07-25), and
 * step 3 of `docs/specs/2026-07-25-p1-joint-plan-h2a-sessions-in-sentropic-ui.md`.
 *
 * AUTHORITY MODEL — read this before touching anything below.
 * ----------------------------------------------------------
 * **The 39-auth PRINCIPAL is the authorizing authority. This module only
 * proves that the local agent controls its ed25519 key.** A valid signature
 * proves *authorship* (this key produced this signature); it NEVER proves
 * *authorization* (this key may appear in this principal's feed). Those are two
 * different checks and the code keeps them structurally separate:
 *
 * - h2a produces a proof of key control. That is the whole of h2a's part.
 * - sentropic decides what the proof authorizes, by looking up an ACTIVE
 *   `(principalSub, agentPubKey)` binding row in ITS OWN store.
 *
 * Three consequences that are load-bearing, not stylistic:
 *
 * 1. **No binding store here.** h2a has no concept of a 39-auth principal, so
 *    it cannot own the binding record (`H2APrincipalAgentBinding` — Part B,
 *    "Binding record": owned and stored by sentropic). Nothing in this module
 *    writes, caches or reads a binding.
 * 2. **The proof asserts nothing about a principal.** It carries exactly the
 *    four fields of Part B step 4 — `{ nonce, signature, publicKeyPem,
 *    instance }` — and no `principalSub`. An optional `principalSub` on the
 *    *challenge* is accepted for the owner's own on-screen confirmation and is
 *    deliberately dropped on the way out (see {@link signEnrollmentChallenge}):
 *    a proof that named a principal would look like a claim to belong to it.
 * 3. **No outward transport.** This module never opens a socket. Not behind a
 *    flag, not behind a default-off flag. The proof is returned to the caller;
 *    delivering it to the gateway is the gateway lane's step, and the seam for
 *    it ({@link EnrollmentProofSubmitter}) has NO default implementation — an
 *    unsupplied submitter is reported as such, never silently attempted.
 *
 * Per the amendment accepted after ratification (joint plan, finding 2),
 * enrollment on the AUTH side requires an active **first-party session** and is
 * deliberately unreachable by bearer tokens — otherwise any relying party the
 * owner ever consented to could mint a durable binding for its own key,
 * escalating "read the owner's data" into "permanently be the owner's agent".
 * That gate is the auth lane's. Nothing here assumes, carries or accepts a
 * bearer token; there is no credential input to this module at all.
 *
 * REUSE, not new crypto: `signCanonical` / `verifyCanonical`
 * (`packages/h2a/src/signature.ts`) over the existing identity keypair at
 * `<root>/keys/<instance>.key.pem` — the exact primitive already used for
 * reclaim proof-of-possession (`runtime/identity/live.ts` `provesLocalKey`,
 * `runtime/identity/bindings.ts` `verifyReclaimProof`). No new key, no new
 * algorithm, no new file.
 */
import { readFileSync } from "node:fs";

import { signCanonical, verifyCanonical, type H2ASignature } from "@sentropic/h2a";

import {
  H2A_CLI_DECLARED_CAPABILITIES,
  publicKeyFingerprint,
  resolveLiveIdentity
} from "../identity/live.js";
import { createLocalStore } from "../local-files/store.js";

/**
 * Upper bound on a nonce we are willing to sign.
 *
 * The nonce is opaque to h2a — it comes from the gateway and is echoed back
 * verbatim — so its *content* cannot be validated. Its size can. Signing is
 * not authorizing, but an unbounded blob is still something we would be putting
 * our key over on a stranger's say-so, so refuse it rather than sign it.
 */
export const H2A_ENROLLMENT_MAX_NONCE_LENGTH = 4096;

/**
 * A gateway-issued enrollment challenge, as the local agent receives it.
 *
 * Part B, flow step 2: *"Gateway issues a challenge: a random nonce, TTL-bound,
 * scoped to that `sub`."* The TTL and the `sub`-scoping are facts the GATEWAY
 * holds and re-checks at verification time (flow step 5a); the two optional
 * fields here are the agent-visible shadow of them and are advisory only.
 */
export interface H2AEnrollmentChallenge {
  /**
   * The random nonce. This exact string is the signed message — see
   * {@link signEnrollmentChallenge}.
   */
  readonly nonce: string;
  /**
   * Optional ISO-8601 expiry, as told to the agent. **Advisory**: the gateway
   * remains the authority on the TTL (flow step 5a). Present, it lets the agent
   * refuse to spend a signature on a challenge it can already see is dead —
   * which can only ever narrow what happens, never widen it.
   */
  readonly expiresAt?: string;
  /**
   * Optional 39-auth `sub` the challenge was issued to. **Display only, for the
   * owner's confirmation.** h2a never treats it as authority and never puts it
   * in the proof: h2a cannot verify a principal, so it must not appear to
   * assert one.
   */
  readonly principalSub?: string;
}

/**
 * The proof payload the agent returns to the gateway — Part B, flow step 4:
 * *"The agent returns `{ nonce, signature, publicKeyPem, instance }`."*
 *
 * Exactly those four fields, and nothing else. In particular: no private key
 * material, no filesystem path, no principal claim, no bearer token, no
 * capability list. What the gateway does with it is Part B flow step 5.
 */
export interface H2AEnrollmentProof {
  /** The gateway's nonce, echoed verbatim. It is also the signed message. */
  readonly nonce: string;
  /**
   * `signCanonical(nonce, { by: instance, privateKeyPem })` — an
   * `H2ASignature` `{ by, alg: 'ed25519', value }` (`types.ts` `H2ASignature`,
   * reused unchanged per Part B's "Reuse vs. new" table).
   *
   * NOTE on what the signature covers: the signed message is the canonical
   * encoding of the nonce ALONE, because that is what the gateway verifies
   * (flow step 5b: `verifyCanonical(nonce, signature, publicKeyPem)`). So
   * `signature.by`, `instance` and `publicKeyPem` are NOT cryptographically
   * bound to the signature by this payload. That is the spec's shape and it is
   * safe under the spec's own gate — the nonce is single-use, TTL-bound and
   * issued to a first-party session — but it does mean the transport must not
   * be relied on to tell the gateway *who* signed: the gateway learns the key
   * from `publicKeyPem` and must decide for itself whether that key may be
   * bound. See the "spec concerns" note in the PR body.
   */
  readonly signature: H2ASignature;
  /** The agent's CURRENT public key PEM (SPKI). Public material, not a secret. */
  readonly publicKeyPem: string;
  /** The agent's CURRENT live instance id. Provenance for the gateway's audit. */
  readonly instance: string;
}

/**
 * Refuse to prove control of a key h2a itself does not list as ACTIVE.
 *
 * h2a-side key validity is *necessary but not sufficient* for exposure — the
 * binding governs that (Part B, fail-closed item 4) — but a key h2a considers
 * revoked must never be offered up for a NEW binding.
 *
 * This is DEFENCE IN DEPTH, and its call site is unreachable in practice: when
 * the live key has been revoked, `resolveLiveIdentity`'s reclaim proof
 * (`provesLocalKey`, which requires at least one active key) fails, so it MINTS
 * a fresh identity instead of returning the revoked one — verified by the
 * "a locally revoked key is never the key proved" test. The guard exists so that
 * remains a CHECKED fact rather than a relied-upon one, and it is exported so it
 * can be exercised directly instead of sitting untested behind a path that
 * cannot reach it.
 *
 * An empty key list is an ERROR here, never a silent pass: "no active keys" is
 * not the fact "this key is fine".
 */
export function assertKeyIsLocallyActive(input: {
  readonly instance: string;
  readonly publicKeyPem: string;
  readonly activeKeys: readonly string[];
}): void {
  if (input.activeKeys.length === 0) {
    throw new Error(
      `h2a enrollment: instance "${input.instance}" has NO active key in the local registry — ` +
        "refusing to prove control of a key h2a itself does not list as active"
    );
  }
  if (!input.activeKeys.includes(input.publicKeyPem)) {
    throw new Error(
      `h2a enrollment: the resolved public key of "${input.instance}" is not active in the local ` +
        "registry (revoked, or superseded) — re-run `h2a connect` before enrolling"
    );
  }
}

/** The local key material the ceremony proves control of. */
export interface H2AEnrollmentIdentity {
  /** The live instance id, resolved at run time — never a recorded value. */
  readonly instance: string;
  /** PKCS#8 PEM. Read from disk, used to sign, and NEVER returned outward. */
  readonly privateKeyPem: string;
  /** SPKI PEM. Public material; this one does go on the wire. */
  readonly publicKeyPem: string;
}

/** Where {@link buildEnrollmentProof} looks for the live agent identity. */
export interface ResolveEnrollmentIdentityInput {
  /** The h2a store root (`<root>/keys/...`). */
  readonly root: string;
  /** The provider host (`claude`, `codex`, ...) — an input to live resolution. */
  readonly host: string;
  /** The working directory, for workspace resolution. */
  readonly cwd: string;
}

/**
 * Seam for the identity resolution. Injected by tests; the default
 * ({@link resolveEnrollmentIdentity}) is the only production implementation.
 */
export type EnrollmentIdentityResolver = (
  input: ResolveEnrollmentIdentityInput
) => H2AEnrollmentIdentity;

/**
 * Resolve the CURRENT live identity and load its keypair.
 *
 * Why this resolves live, every single time, and takes no instance id:
 * **a memory that names an instance-id ROTS.** That is a documented failure in
 * this project (a stale recorded mapping sent a consultation to the wrong
 * instance), and it is the same failure the identity re-anchor of 2026-06-07
 * created for enrollment: the stability unit moved from `(host, workspaceId)`
 * to the provider conversation UUID, so an agent enrolled before it now
 * presents a DIFFERENT instance handle and a DIFFERENT keypair (Part B,
 * "Re-enrollment of a post-re-anchor key"). The previously enrolled
 * `agentPubKey` is simply no longer produced by any live agent — which is why a
 * push today is rejected 401.
 *
 * So there is deliberately **no `instance` parameter anywhere in this module's
 * public surface**. The id cannot be passed in, therefore a stale one cannot be
 * used. `resolveLiveIdentity` is called without `explicitInstance` (which would
 * short-circuit before any keypair exists — `identity/live.ts`), and the key is
 * then read from the paths THAT resolution returned.
 *
 * Two fail-closed checks, both named:
 * - the resolution must have produced keypair paths (otherwise we cannot prove
 *   control of anything and must not pretend to);
 * - the resolved public key must be ACTIVE in h2a's own local registry — see
 *   {@link assertKeyIsLocallyActive}.
 *
 * DOCUMENTED LIMIT on what the returned `instance` contains: an instance id is
 * `<host>:<label>:<uuid>` and its label is the host-native session name or the
 * workspace directory's BASENAME (`identity/live.ts` `deriveInstanceId`). So the
 * proof carries a workspace *label*, which Part A's opacity boundary explicitly
 * permits ("never a filesystem path beyond a human label") — but never a path.
 * It is free text the owner controls, so a consumer must escape it like any
 * user content; see joint plan §9.
 */
export function resolveEnrollmentIdentity(
  input: ResolveEnrollmentIdentityInput
): H2AEnrollmentIdentity {
  const identity = resolveLiveIdentity({
    root: input.root,
    host: input.host,
    cwd: input.cwd,
    // Display-only list, exactly as `h2a connect` declares it. Never an
    // authorization input (feed contract ratification condition #3).
    declaredCapabilities: H2A_CLI_DECLARED_CAPABILITIES
    // No `explicitInstance`: see the doc comment. A named id is the rot.
  });

  if (identity.privateKeyPath === undefined || identity.publicKeyPath === undefined) {
    throw new Error(
      `h2a enrollment: live identity resolution for "${identity.instance}" returned no keypair ` +
        "(action=" +
        identity.action +
        ") — cannot prove control of a key that was never resolved"
    );
  }

  let privateKeyPem: string;
  let publicKeyPem: string;
  try {
    privateKeyPem = readFileSync(identity.privateKeyPath, "utf8");
    publicKeyPem = readFileSync(identity.publicKeyPath, "utf8");
  } catch (error) {
    // Name the source, never degrade into "no identity".
    throw new Error(
      `h2a enrollment: cannot read the identity keypair of "${identity.instance}" ` +
        `(${(error as Error).message})`
    );
  }

  assertKeyIsLocallyActive({
    instance: identity.instance,
    publicKeyPem,
    activeKeys: createLocalStore({ root: input.root }).listInstanceKeys(identity.instance)
  });

  return { instance: identity.instance, privateKeyPem, publicKeyPem };
}

/** Input to the pure signing step. No I/O, no clock unless injected. */
export interface SignEnrollmentChallengeInput {
  /** The gateway-issued challenge. */
  readonly challenge: H2AEnrollmentChallenge;
  /** The identity whose control is being proved. */
  readonly identity: H2AEnrollmentIdentity;
  /** Clock, for the advisory expiry check. Defaults to `Date.now`. */
  readonly now?: () => number;
}

/**
 * Reject a challenge we must not sign. Narrowing only — this can refuse a
 * signature, never authorize one. Throws with a message naming the reason.
 *
 * Exported so a caller that classifies errors (the CLI, which owes a distinct
 * exit code for "your challenge is bad" vs "my local key state is bad") can
 * check the input it was handed BEFORE touching any identity.
 * {@link signEnrollmentChallenge} calls it again regardless: each entry point
 * validates its own input, and an upstream check is never assumed.
 */
export function assertSignableEnrollmentChallenge(
  challenge: H2AEnrollmentChallenge,
  nowMs: number
): void {
  if (typeof challenge.nonce !== "string" || challenge.nonce.length === 0) {
    throw new Error(
      "h2a enrollment: the challenge carries no nonce — nothing to prove key control over"
    );
  }
  if (challenge.nonce.length > H2A_ENROLLMENT_MAX_NONCE_LENGTH) {
    throw new Error(
      `h2a enrollment: challenge nonce is ${challenge.nonce.length} chars, over the ` +
        `${H2A_ENROLLMENT_MAX_NONCE_LENGTH}-char limit — refusing to sign an unbounded blob`
    );
  }
  if (challenge.expiresAt !== undefined) {
    const expiresAtMs = Date.parse(challenge.expiresAt);
    if (Number.isNaN(expiresAtMs)) {
      throw new Error(
        `h2a enrollment: challenge expiresAt "${challenge.expiresAt}" is not an ISO-8601 instant`
      );
    }
    if (expiresAtMs <= nowMs) {
      throw new Error(
        `h2a enrollment: challenge expired at ${challenge.expiresAt} — ask the gateway for a new one`
      );
    }
  }
}

/**
 * Sign a gateway-issued challenge with the agent's identity key and return the
 * Part B proof payload. PURE apart from the injected clock: no I/O, no network,
 * no store.
 *
 * The signed message is the nonce ALONE, matching Part B flow steps 3 and 5b
 * exactly (`signCanonical(nonce, …)` / `verifyCanonical(nonce, signature,
 * publicKeyPem)`). Signing anything else — a composite object, a
 * domain-separated string — would produce a proof the spec-conformant gateway
 * rejects, so the shape is not ours to change unilaterally; see the note on
 * {@link H2AEnrollmentProof.signature}.
 *
 * Before returning, the proof is VERIFIED against the public key it ships. A
 * proof we cannot verify ourselves is never emitted: that is what catches a
 * mismatched keypair locally instead of at the gateway, where the failure is
 * indistinguishable from an attack.
 */
export function signEnrollmentChallenge(
  input: SignEnrollmentChallengeInput
): H2AEnrollmentProof {
  const now = input.now ?? Date.now;
  assertSignableEnrollmentChallenge(input.challenge, now());

  const { instance, privateKeyPem, publicKeyPem } = input.identity;
  const signature = signCanonical(input.challenge.nonce, {
    by: instance,
    privateKeyPem
  });

  if (!verifyCanonical(input.challenge.nonce, signature, publicKeyPem)) {
    throw new Error(
      `h2a enrollment: the proof for "${instance}" does not verify against its own public key ` +
        "(private/public key mismatch) — refusing to emit an unverifiable proof"
    );
  }

  // Exactly the four fields of Part B step 4. `challenge.principalSub` is
  // deliberately NOT carried: h2a cannot verify a principal, so a proof of
  // h2a's must not look like a claim to belong to one.
  return { nonce: input.challenge.nonce, signature, publicKeyPem, instance };
}

/** Options for the synchronous, network-free proof build. */
export interface BuildEnrollmentProofOptions {
  /** The h2a store root. */
  readonly root: string;
  /** The provider host (`claude`, `codex`, ...). */
  readonly host: string;
  /** The working directory. */
  readonly cwd: string;
  /** The gateway-issued challenge. */
  readonly challenge: H2AEnrollmentChallenge;
  /** Clock, for the advisory expiry check. */
  readonly now?: () => number;
  /** Identity-resolution seam. Defaults to {@link resolveEnrollmentIdentity}. */
  readonly resolveIdentityImpl?: EnrollmentIdentityResolver;
}

/** What the ceremony produced, plus the owner-facing provenance. */
export interface EnrollmentProofResult {
  /** The payload to hand to the gateway. */
  readonly proof: H2AEnrollmentProof;
  /** The live instance the proof was produced for (same as `proof.instance`). */
  readonly instance: string;
  /**
   * Short sha256 prefix of the proved public key — the same fingerprint the
   * reclaim proof uses. For the OWNER to eyeball which key was proved; it is
   * not part of the proof and carries no authority.
   */
  readonly publicKeyFingerprint: string;
}

/**
 * Resolve the live identity, sign the challenge, return the proof.
 *
 * SYNCHRONOUS and network-free by construction: there is no transport in this
 * function at all, so the CLI path (`h2a keys prove-control`) cannot reach one.
 * Re-enrollment needs no separate entry point — this IS the re-enrollment path,
 * because it resolves the current identity every time and can therefore only
 * ever produce a proof for the key that is live now. A changed controlling key
 * means the owner re-runs this and the gateway mints a NEW binding, revoking the
 * old row (Part B, "Re-enrollment of a post-re-anchor key"); nothing here
 * reuses or rotates anything.
 */
export function buildEnrollmentProof(
  options: BuildEnrollmentProofOptions
): EnrollmentProofResult {
  const resolveIdentity = options.resolveIdentityImpl ?? resolveEnrollmentIdentity;
  const identity = resolveIdentity({
    root: options.root,
    host: options.host,
    cwd: options.cwd
  });
  const proof = signEnrollmentChallenge({
    challenge: options.challenge,
    identity,
    ...(options.now !== undefined ? { now: options.now } : {})
  });
  return {
    proof,
    instance: proof.instance,
    publicKeyFingerprint: publicKeyFingerprint(proof.publicKeyPem)
  };
}

/**
 * Seam for handing the proof to the gateway.
 *
 * **There is no default implementation and h2a ships none.** The gateway's
 * challenge/verify endpoint is the auth lane's step 2 and is not built yet; the
 * per-binding push keying is step 4b and carries its own BLOCKING cross-verify
 * requirement (path-identity vs key-identity). Until then a submitter is
 * supplied by the caller — in tests, always a fake — and its absence is
 * REPORTED as a fact, never papered over.
 */
export type EnrollmentProofSubmitter = (
  proof: H2AEnrollmentProof
) => Promise<unknown>;

/**
 * What happened to the proof, from an EXPLICIT branch on whether a transport
 * exists — never a defaulted value. "Not attempted" is a fact the caller can
 * act on; a silent `undefined` would be indistinguishable from a failed send.
 */
export type EnrollmentSubmission =
  | {
      readonly attempted: false;
      /** No transport was supplied, so nothing was sent anywhere. */
      readonly reason: "no-transport-configured";
    }
  | {
      readonly attempted: true;
      /** Whatever the injected submitter returned. Opaque to h2a. */
      readonly response: unknown;
    };

/** Options for the full ceremony, including the optional injected transport. */
export interface RunEnrollmentCeremonyOptions extends BuildEnrollmentProofOptions {
  /**
   * Injected transport. Omitted (the production default), the proof is returned
   * for out-of-band delivery and `submission.attempted` is `false`.
   */
  readonly submitImpl?: EnrollmentProofSubmitter;
}

/** The ceremony's outcome: the proof, plus what was done with it. */
export interface EnrollmentCeremonyResult extends EnrollmentProofResult {
  readonly submission: EnrollmentSubmission;
}

/**
 * Run the ceremony end to end: resolve the live identity, sign the challenge,
 * and — only if a transport was injected — hand the proof over.
 *
 * With no `submitImpl` this makes NO network call of any kind. That is not a
 * default-off flag; there is no hosted endpoint in this file to turn on.
 */
export async function runEnrollmentCeremony(
  options: RunEnrollmentCeremonyOptions
): Promise<EnrollmentCeremonyResult> {
  const built = buildEnrollmentProof(options);
  if (options.submitImpl === undefined) {
    return { ...built, submission: { attempted: false, reason: "no-transport-configured" } };
  }
  const response = await options.submitImpl(built.proof);
  return { ...built, submission: { attempted: true, response } };
}
