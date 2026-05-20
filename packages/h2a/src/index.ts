export {
  createEnvelope,
  isH2AEnvelope
} from "./envelope.js";
export { assertValidNegotiationState } from "./negotiation.js";
export { canonicalize, computeHash } from "./canonical.js";
export { signCanonical, verifyCanonical } from "./signature.js";
export type { SignOptions } from "./signature.js";
export {
  appendJournalEntry,
  createJournalEntry,
  journalEntryAsCanonicalString,
  verifyJournalChain
} from "./journal.js";
export type {
  H2AJournalEntry,
  H2AJournalPayload,
  H2AJournalVerification
} from "./journal.js";
export {
  isAmendment,
  isAuthority,
  isContract,
  isEnforcementPlan,
  isEngagement,
  isMandate,
  isPolicy,
  isSignature
} from "./artifacts.js";
export {
  H2A_AUTHORITY_MATRIX,
  assertCanSignArtifactKind,
  canSignArtifactKind
} from "./authority.js";
export { H2A_CANONICAL_FIXTURES } from "./fixtures-index.js";
export type { H2ACanonicalFixtureManifestEntry } from "./fixtures-index.js";
export {
  H2A_ARTIFACT_KINDS,
  H2A_AUTHORITY_KINDS,
  H2A_ENVELOPE_TYPES,
  H2A_NEGOTIATION_STATES,
  H2A_POLICY_ADOPTION_MODES,
  H2A_PROTOCOL,
  H2A_ROLES,
  H2A_VERSION
} from "./types.js";
export type {
  H2AActorRef,
  H2AActorRegistration,
  H2AAmendment,
  H2AArtifactKind,
  H2AAuthority,
  H2AAuthorityKind,
  H2AContract,
  H2AEnforcementPlan,
  H2AEngagement,
  H2AEnvelope,
  H2AEnvelopeType,
  H2AMandate,
  H2ANegotiationRecord,
  H2ANegotiationState,
  H2APolicy,
  H2APolicyAdoptionMode,
  H2ARole,
  H2ASignature
} from "./types.js";
