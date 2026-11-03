/**
 * Public entry for the N1 `remote-action-v1` verifier surface.
 *
 * Exported as `@sentropic/h2a-runtime/remote-action`. Pure verifier
 * primitives only: frozen contract data, pinned trust, conservative clock,
 * Ed25519/JWS verification and route payload-shape gates. No network, no
 * store, no effect.
 */

export {
  ACTION_ROUTES,
  ACTION_TTL_MS,
  CONSERVATIVE_SKEW_MS,
  MAX_ENVELOPE_BYTES,
  MAX_INPUT_BYTES,
  MAX_RESULT_BYTES,
  NONCE_TTL_MS,
  PROOF_TTL_MS,
  RC2_R3_PIN,
  REMOTE_ACTION_VERSION,
  SIGNED_BODY_ALGS,
  JWS_ALGS,
  SIGNING_DOMAINS,
  TARGET_FIELDS,
  canonicalJson,
  digestDomain,
  isGeneration,
  isTargetRecord,
  isWireId,
  rawHash,
  type ActionRouteId,
  type SigningDomain,
} from "./remote-action-contract.js";

export {
  TrustError,
  assertLiveKey,
  createPinnedTrust,
  isAllowedBodyAlg,
  isAllowedJwsAlg,
  resolveTrustEntry,
  type PinnedKey,
  type PinnedTrust,
  type TrustFailureCode,
} from "./remote-action-trust.js";

export {
  ClockError,
  checkNumericDateSeconds,
  evaluateAdmissionDeadline,
  isWithinLifetime,
  type ClockState,
  type DeadlineDecision,
  type DeadlineInput,
} from "./remote-action-clock.js";

export {
  VerifyError,
  verifyActionClaim,
  verifyActionEnvelope,
  verifyCliSessionProof,
  verifyIdpEvidenceJws,
  verifyNoncePublication,
  verifyResultReport,
  type ExpectedBindings,
  type VerifyFailureCode,
  type VerifyOptions,
} from "./remote-action-verifier.js";

export {
  isEndpointRefusalShape,
  parseActionRouteRecord,
  publicRefusalFor,
  refusalHttpStatus,
  type ParsedRouteRecord,
} from "./remote-action-api.js";
