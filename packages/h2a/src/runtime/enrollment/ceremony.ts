/**
 * h2a's side of the PRINCIPAL↔AGENT enrollment ceremony (P1, step 3).
 *
 * Implements Part B of the ratified contract
 * `docs/superpowers/specs/2026-07-24-h2a-feed-contract-for-sentropic.md`
 * (RATIFIED by the sentropic architect 2026-07-24, amended 2026-07-25 and again
 * 2026-07-25 by the SIGNED-COMPOSITE amendment recorded in Part B), and step 3 of
 * `docs/specs/2026-07-25-p1-joint-plan-h2a-sessions-in-sentropic-ui.md`.
 *
 * AUTHORITY MODEL — read this before touching anything below.
 * ----------------------------------------------------------
 * **The 39-auth PRINCIPAL is the authorizing authority. This module only
 * proves that the local agent controls its ed25519 key.** A valid signature
 * proves *authorship* (this key produced this payload); it NEVER proves
 * *authorization* (this key may appear in this principal's feed). Those are two
 * different checks and the code keeps them structurally separate:
 *
 * - h2a produces a proof of key control. That is the whole of h2a's part.
 * - sentropic decides what the proof authorizes, by looking up an ACTIVE
 *   `(principalSub, agentPubKey)` binding row in ITS OWN store.
 *
 * **SIGNED ≠ AUTHORIZED.** The signature now covers `instance` as well as the
 * nonce and the key (see {@link enrollmentProofSignedPayload}). That makes the
 * *provenance* of `instance` trustworthy — it does **NOT** make `instance` an
 * authorization input, and nothing downstream may start treating it as one.
 * Authorization stays the active-binding lookup on
 * `(principalSub, agentPubKey)`, with the instance re-resolved live at read time
 * (Part B: `agentInstanceIdAtBinding` is "provenance only — NEVER re-used as
 * authority at read time"). This is the same line as authorship ≠ authorization,
 * one field further in: a signature widens what you may *believe about the
 * payload*, never what the payload may *reach*.
 *
 * Four consequences that are load-bearing, not stylistic:
 *
 * 1. **No binding store here.** h2a has no concept of a 39-auth principal, so
 *    it cannot own the binding record (`H2APrincipalAgentBinding` — Part B,
 *    "Binding record": owned and stored by sentropic). Nothing in this module
 *    writes, caches or reads a binding.
 * 2. **The agent never receives a principal identifier at all.** The challenge
 *    type has no `principalSub`, and the CLI refuses a challenge document that
 *    carries one. The agent signs a nonce; it has no functional need for the
 *    principal's id, and putting one into an agent process and context window
 *    buys nothing. *Minimal disclosure beats verified non-retention* — so this
 *    is enforced at receipt, not merely proven absent from the output.
 * 3. **Every field the proof carries is signed.** A proof must attest to
 *    everything it carries: a reader sees a signature and reasonably infers it
 *    covers the payload, so an unsigned-but-present field is a claim wider than
 *    its evidence — in the one artifact whose whole job is to be exactly as wide
 *    as its evidence. If a field does not deserve signing, it must be REMOVED
 *    from the proof rather than carried unsigned. Pinned by a test that derives
 *    the covered set from the proof's own keys.
 * 4. **No outward transport.** This module never opens a socket. Not behind a
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
 * `<root>/keys/<instance>.key.pem` — the same primitive already used for reclaim
 * proof-of-possession (`runtime/identity/live.ts` `provesLocalKey`,
 * `runtime/identity/bindings.ts` `verifyReclaimProof`). `signCanonical` already
 * takes `unknown`, so signing a composite is the same primitive with a different
 * argument: no new key, no new algorithm, no new file, no extra round-trip.
 */
import { createPrivateKey } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// Siblings and leaf primitives are imported RELATIVELY. `index.ts` re-exports
// this barrel, so importing `@sentropic/h2a` here would close a self-referential
// cycle through the package root.
import { signCanonical, verifyCanonical } from "../../signature.js";
import type { H2ASignature } from "../../types.js";
import {
  H2A_CLI_DECLARED_CAPABILITIES,
  publicKeyFingerprint,
  resolveLiveIdentity
} from "../identity/live.js";
import { createLocalStore } from "../local-files/store.js";

/**
 * Minimum entropy a gateway nonce must carry. Not a preference: below this a
 * "nonce" is guessable, and a guessable challenge is a challenge an attacker can
 * pre-compute a proof for.
 */
export const H2A_ENROLLMENT_NONCE_MIN_BITS = 256;

/**
 * The nonce's accepted shape, stated POSITIVELY: base64url characters only.
 *
 * A negative bound accepts everything not yet excluded; a positive shape accepts
 * only what was specified. So the nonce is not "anything under N characters" —
 * it is base64url of at least {@link H2A_ENROLLMENT_NONCE_MIN_BITS} bits, and
 * anything else is refused, including free text, JSON, a URL, or a message
 * borrowed from some other protocol.
 */
export const H2A_ENROLLMENT_NONCE_PATTERN = /^[A-Za-z0-9_-]+$/;

/**
 * Minimum nonce length: base64url packs 6 bits per character, so
 * `ceil(256 / 6) = 43` characters is the 256-bit floor.
 *
 * A MINIMUM rather than an exact length, deliberately. The auth lane's issuer
 * does not exist yet; requiring exactly 43 would reject a *stronger* nonce (a
 * 48-byte one is 64 characters) and turn a strictly-safer choice on their side
 * into an outage on ours. More entropy than specified is never the failure mode
 * worth guarding against.
 */
export const H2A_ENROLLMENT_NONCE_MIN_LENGTH = Math.ceil(H2A_ENROLLMENT_NONCE_MIN_BITS / 6);

/**
 * Cheap PRE-PARSE cap, and nothing more.
 *
 * This is a DoS sanity bound, not a definition of a nonce — the definition is
 * {@link H2A_ENROLLMENT_NONCE_PATTERN} plus the minimum length. Kept separate so
 * neither is mistaken for the other.
 */
export const H2A_ENROLLMENT_MAX_NONCE_LENGTH = 4096;

/**
 * A gateway-issued enrollment challenge, as the local agent receives it.
 *
 * Part B, flow step 2: *"Gateway issues a challenge: a random nonce, TTL-bound,
 * scoped to that `sub`."* The `sub`-scoping is a fact the GATEWAY holds and
 * re-checks at verification time (flow step 5a) and the agent never sees it —
 * see consequence 2 in the module header.
 */
export interface H2AEnrollmentChallenge {
  /**
   * The random nonce: base64url, ≥256 bits. It is one of the three signed
   * fields — see {@link enrollmentProofSignedPayload}.
   */
  readonly nonce: string;
  /**
   * Optional ISO-8601 expiry, as told to the agent. **Advisory**: the gateway
   * remains the authority on the TTL (flow step 5a). Present, it lets the agent
   * refuse to spend a signature on a challenge it can already see is dead —
   * which can only ever narrow what happens, never widen it.
   */
  readonly expiresAt?: string;
}

/**
 * The proof payload the agent returns to the gateway — Part B, flow step 4:
 * *"The agent returns `{ nonce, signature, publicKeyPem, instance }`."*
 *
 * Exactly those four fields, and nothing else. In particular: no private key
 * material, no filesystem path, no principal identifier, no bearer token, no
 * capability list. What the gateway does with it is Part B flow step 5.
 */
export interface H2AEnrollmentProof {
  /** The gateway's nonce, echoed verbatim. Signed. */
  readonly nonce: string;
  /**
   * `signCanonical(enrollmentProofSignedPayload(proof), { by: instance,
   * privateKeyPem })` — an `H2ASignature` `{ by, alg: 'ed25519', value }`
   * (`types.ts` `H2ASignature`, reused unchanged per Part B's "Reuse vs. new"
   * table).
   *
   * `signature.by` is NOT part of the signed message; it is a routing label that
   * duplicates the signed `instance`. A verifier must read `instance`, never
   * `by`.
   */
  readonly signature: H2ASignature;
  /**
   * The agent's CURRENT public key PEM (SPKI). Public material, not a secret.
   * Signed — so a payload cannot be re-pointed at another key and still verify
   * against this signature.
   */
  readonly publicKeyPem: string;
  /**
   * The agent's CURRENT live instance id. Signed, so its PROVENANCE is
   * trustworthy. That is emphatically not permission: see SIGNED ≠ AUTHORIZED in
   * the module header. It maps to Part B's `agentInstanceIdAtBinding`, which the
   * contract already marks "provenance only — NEVER re-used as authority at read
   * time".
   */
  readonly instance: string;
}

/**
 * The exact object the signature covers: **every field the proof carries except
 * the signature itself**.
 *
 * Single definition on purpose. The gateway's verification (Part B flow step 5b,
 * as amended) is `verifyCanonical(enrollmentProofSignedPayload(proof),
 * proof.signature, proof.publicKeyPem)`, and field ordering is irrelevant
 * because `canonicalize` normalizes it — so an independent implementation cannot
 * disagree about what was signed by guessing at key order.
 *
 * The rule this function exists to make CHECKABLE: adding a field to
 * {@link H2AEnrollmentProof} without adding it here must break a test, because a
 * carried-but-unsigned field is a claim wider than its evidence.
 */
export function enrollmentProofSignedPayload(
  // `Omit<…, "signature">` states the rule in the type itself: the signature is
  // the ONE field a signature cannot cover, and it is also the only field this
  // function is allowed not to see. A full proof satisfies this parameter too.
  proof: Omit<H2AEnrollmentProof, "signature">
): {
  readonly nonce: string;
  readonly instance: string;
  readonly publicKeyPem: string;
} {
  return { nonce: proof.nonce, instance: proof.instance, publicKeyPem: proof.publicKeyPem };
}

/**
 * Verify a proof the way the gateway must: the signature over the whole
 * composite, checked against the key the proof ships.
 *
 * **This answers "did this key produce this payload", and NOTHING else.** It is
 * not an authorization check and must never be used as one: a `true` here on a
 * key with no active binding row still authorizes nothing (Part B, fail-closed
 * item 3 — "verifying the signature must never, by itself, cause any row to be
 * returned"). Provided so the two lanes verify the same bytes, not so a caller
 * can shortcut a binding lookup.
 */
export function verifyEnrollmentProof(proof: H2AEnrollmentProof): boolean {
  return verifyCanonical(
    enrollmentProofSignedPayload(proof),
    proof.signature,
    proof.publicKeyPem
  );
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
  /**
   * How live resolution arrived at this identity: `reclaim` re-proved an existing
   * local key, `mint` created a NEW one. Reported so a mint is never silent — a
   * mint the owner did not expect means an earlier keypair was unusable (see
   * {@link listUnusablePrivateKeys}) or the agent re-anchored. Optional so an
   * injected resolver need not synthesize a provenance it does not have.
   */
  readonly identityAction?: "override" | "reclaim" | "mint";
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
 * WHAT ACTUALLY HAPPENS WHEN THE LOCAL KEY IS UNUSABLE — stated because the
 * obvious reading ("it fails closed") is wrong, and an overstated guard comment
 * is worse than none:
 *
 * - **Corrupt, truncated or passphrase-protected private key** → `provesLocalKey`
 *   catches its own failure and returns `false`, so `resolveLiveIdentity` MINTS a
 *   fresh identity. The ceremony then succeeds, with exit 0, proving control of a
 *   BRAND-NEW key — the corrupt file is left on disk and the old instance stays
 *   listed active. It does not fail, and it does not prove the damaged key. The
 *   mint is the same self-healing mechanism as the revoked-key case, but here it
 *   would MASK TAMPERING, so silence is the defect: the CLI names any unusable
 *   key file on stderr before this runs (see {@link listUnusablePrivateKeys}),
 *   and `identityAction` reports the mint. Pinned by an OBSERVED BEHAVIOUR test.
 * - **Unreadable private key (EACCES)** → `readKeypair` reads the same file
 *   earlier, inside `resolveLiveIdentity` and outside any `try`, so the raw errno
 *   escapes from there rather than from the guard below. That is why the whole
 *   resolution call is wrapped: the failure is re-thrown with the root named,
 *   instead of surfacing as a bare `EACCES` with no indication of which store it
 *   came from.
 * - **The two guards below are NARROWING, not behaviour.** The
 *   `privateKeyPath === undefined` branch exists because the type is optional
 *   (`explicitInstance` is the only resolution path that omits the paths, and
 *   this function never passes one), and the `readFileSync` branch is belt and
 *   braces behind the earlier read. Neither is reachable on this path; they are
 *   not the reason a broken key is safe. {@link assertKeyIsLocallyActive} is in
 *   the same position and says so itself.
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
  let identity;
  try {
    identity = resolveLiveIdentity({
      root: input.root,
      host: input.host,
      cwd: input.cwd,
      // Display-only list, exactly as `h2a connect` declares it. Never an
      // authorization input (feed contract ratification condition #3).
      declaredCapabilities: H2A_CLI_DECLARED_CAPABILITIES
      // No `explicitInstance`: see the doc comment. A named id is the rot.
    });
  } catch (error) {
    // `resolveLiveIdentity` reads the keypair internally, outside any try, so an
    // unreadable key surfaces HERE as a bare errno. Name the source rather than
    // letting an `EACCES` escape with no indication of which store produced it.
    throw new Error(
      `h2a enrollment: live identity resolution failed under root "${input.root}" ` +
        `(${(error as Error).message})`
    );
  }

  // NARROWING, not a fail-closed behaviour: the paths are optional on the type
  // because `explicitInstance` resolution omits them, and this function never
  // passes one. See the doc comment for what actually happens to a broken key.
  if (identity.privateKeyPath === undefined || identity.publicKeyPath === undefined) {
    throw new Error(
      `h2a enrollment: live identity resolution for "${identity.instance}" returned no keypair ` +
        `(action=${identity.action})`
    );
  }

  let privateKeyPem: string;
  let publicKeyPem: string;
  try {
    privateKeyPem = readFileSync(identity.privateKeyPath, "utf8");
    publicKeyPem = readFileSync(identity.publicKeyPath, "utf8");
  } catch (error) {
    // Belt and braces behind the read that already happened inside the
    // resolution above; unreachable on this path.
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

  return {
    instance: identity.instance,
    privateKeyPem,
    publicKeyPem,
    identityAction: identity.action
  };
}

/**
 * Every private key file under `<root>/keys` that exists but cannot be loaded as
 * a private key — corrupt, truncated, or passphrase-protected.
 *
 * This exists because of what does NOT happen when the live key is one of those:
 * live resolution's reclaim proof fails silently and MINTS a fresh identity, so
 * the ceremony succeeds with exit 0 on a brand-new key while a damaged file sits
 * on disk. The mint is defensible; doing it silently is not, because it is
 * indistinguishable from tampering. So the caller can name the file.
 *
 * Read-only and total: it never throws, and a missing `keys` directory yields an
 * empty list from an EXPLICIT branch — "there is no key directory" is an
 * established fact, not a default.
 */
export function listUnusablePrivateKeys(root: string): string[] {
  const keysDir = join(root, "keys");
  if (!existsSync(keysDir)) return [];
  let entries: string[];
  try {
    entries = readdirSync(keysDir);
  } catch {
    // The directory exists but cannot be listed: report nothing rather than
    // claim health. The caller's real check is the ceremony itself.
    return [];
  }
  const unusable: string[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".key.pem")) continue;
    const path = join(keysDir, entry);
    try {
      createPrivateKey({ key: readFileSync(path, "utf8"), format: "pem" });
    } catch {
      unusable.push(path);
    }
  }
  return unusable.sort();
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
  // Cheap pre-parse bound first, so a hostile blob is dropped before any regex
  // walks it. This is a DoS cap, NOT the nonce's definition.
  if (challenge.nonce.length > H2A_ENROLLMENT_MAX_NONCE_LENGTH) {
    throw new Error(
      `h2a enrollment: challenge nonce is ${challenge.nonce.length} chars, over the ` +
        `${H2A_ENROLLMENT_MAX_NONCE_LENGTH}-char pre-parse cap — refusing to read an unbounded blob`
    );
  }
  // The definition, stated positively: base64url of at least 256 bits. Free
  // text, JSON, a URL, or a message borrowed from another protocol all fail here
  // because they are not the specified shape — not because they were enumerated.
  if (!H2A_ENROLLMENT_NONCE_PATTERN.test(challenge.nonce)) {
    throw new Error(
      "h2a enrollment: challenge nonce is not base64url ([A-Za-z0-9_-]) — a nonce is a random " +
        "value of a specified shape, and anything else is refused rather than signed"
    );
  }
  if (challenge.nonce.length < H2A_ENROLLMENT_NONCE_MIN_LENGTH) {
    throw new Error(
      `h2a enrollment: challenge nonce is ${challenge.nonce.length} base64url chars, under the ` +
        `${H2A_ENROLLMENT_NONCE_MIN_LENGTH} needed for ${H2A_ENROLLMENT_NONCE_MIN_BITS} bits — ` +
        "a guessable challenge is one an attacker can pre-compute a proof for"
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
 * The signed message is the CANONICAL COMPOSITE
 * {@link enrollmentProofSignedPayload} — `{ nonce, instance, publicKeyPem }` —
 * per the signed-composite amendment. The earlier shape signed the bare nonce
 * (Part B flow steps 3 and 5b as originally written), which was safe only
 * because nothing yet consumed `instance`: safety derived from the *absence* of a
 * consumer, which expires the moment someone adds one. A proof must attest to
 * everything it carries.
 *
 * A structural consequence worth knowing, because it removes a whole finding
 * rather than guarding against it: the reclaim proof-of-possession signs a
 * STRING (`identity-reclaim:<instance>:<fingerprint>`), and this signs an
 * OBJECT. `canonicalize` type-tags the two differently, so no enrollment
 * signature can ever satisfy `verifyReclaimProof` — the signing-oracle collision
 * is impossible by construction, not by refusal. There is deliberately no guard
 * against it: a guard that cannot fire is the defect this PR spent its time
 * finding. The property is pinned by a regression test instead.
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
  // Build the unsigned proof first, then sign the payload DERIVED from it, so the
  // signed bytes and the shipped fields cannot drift apart.
  const unsigned = { nonce: input.challenge.nonce, instance, publicKeyPem };
  const signature = signCanonical(enrollmentProofSignedPayload(unsigned), {
    by: instance,
    privateKeyPem
  });

  const proof: H2AEnrollmentProof = { ...unsigned, signature };
  if (!verifyEnrollmentProof(proof)) {
    throw new Error(
      `h2a enrollment: the proof for "${instance}" does not verify against its own public key ` +
        "(private/public key mismatch) — refusing to emit an unverifiable proof"
    );
  }
  return proof;
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
  /**
   * Provenance of the identity this run proved — see
   * {@link H2AEnrollmentIdentity.identityAction}. Absent when an injected
   * resolver did not report one.
   */
  readonly identityAction?: "override" | "reclaim" | "mint";
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
    publicKeyFingerprint: publicKeyFingerprint(proof.publicKeyPem),
    ...(identity.identityAction !== undefined
      ? { identityAction: identity.identityAction }
      : {})
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
