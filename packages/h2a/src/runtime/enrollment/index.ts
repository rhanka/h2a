/**
 * h2a's side of the principal↔agent enrollment ceremony (P1, step 3).
 *
 * Contract: Part B of
 * `docs/superpowers/specs/2026-07-24-h2a-feed-contract-for-sentropic.md`
 * (ratified 2026-07-24, amended 2026-07-25, signed-composite amendment
 * 2026-07-25).
 *
 * Step 3 = proving control of the agent's ed25519 key over a gateway-issued
 * challenge, and nothing else. The 39-auth principal is the authorizing
 * authority; the binding record and the challenge/verify endpoint are
 * sentropic's. No binding store, no network transport, no bearer token, and no
 * principal identifier ever reaches the agent.
 */
export {
  assertKeyIsLocallyActive,
  assertSignableEnrollmentChallenge,
  buildEnrollmentProof,
  enrollmentProofSignedPayload,
  listUnusablePrivateKeys,
  resolveEnrollmentIdentity,
  runEnrollmentCeremony,
  signEnrollmentChallenge,
  verifyEnrollmentProof,
  H2A_ENROLLMENT_MAX_NONCE_LENGTH,
  H2A_ENROLLMENT_NONCE_MIN_BITS,
  H2A_ENROLLMENT_NONCE_MIN_LENGTH,
  H2A_ENROLLMENT_NONCE_PATTERN,
  type BuildEnrollmentProofOptions,
  type EnrollmentCeremonyResult,
  type EnrollmentIdentityResolver,
  type EnrollmentProofResult,
  type EnrollmentProofSubmitter,
  type EnrollmentSubmission,
  type H2AEnrollmentChallenge,
  type H2AEnrollmentIdentity,
  type H2AEnrollmentProof,
  type ResolveEnrollmentIdentityInput,
  type RunEnrollmentCeremonyOptions,
  type SignEnrollmentChallengeInput
} from "./ceremony.js";
