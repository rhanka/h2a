/**
 * EVO-13 — remote presence mirror (DEC-125). Local agents push signed snapshots
 * of their state to a remote h2a so its read-only surface reflects reality.
 * P1: instances only. Core stays dep-free; this lives in @sentropic/h2a.
 */
export {
  buildInstanceMirror,
  H2A_MIRROR_BODY_KIND,
  type H2AInstanceMirrorBody
} from "./build.js";
export {
  MIRROR_ENDPOINT_PLAN,
  MIRROR_INTERESTS_PLAN,
  MIRROR_PRESENCE_PLAN,
  MIRROR_REGISTRATION_PLAN,
  MIRROR_SUBAGENT_PLAN,
  sanitizeActorForMirror,
  sanitizePresenceForMirror,
  sanitizeRegistrationForMirror,
  sanitizeSubagentForMirror,
  sanitizeWorkspaceRefForMirror,
  unclassifiedMirrorFields,
  type H2AMirroredEndpoint,
  type H2AMirroredRegistration,
  type H2AMirroredSession,
  type H2AMirroredSessionInterests,
  type H2AMirroredSubagentBinding,
  type H2AMirroredWorkspaceRef,
  type MirrorFieldPlan,
  type MirrorWithholdReason
} from "./sanitize.js";
export {
  acceptMirrorEnvelope,
  type AcceptMirrorOptions,
  type H2AMirrorRejection,
  type H2AMirrorResult
} from "./accept.js";
export {
  INGEST_NARROWERS,
  createNarrowingTally,
  droppedKeyPaths,
  narrowIngestedPresence,
  narrowIngestedRegistration,
  narrowIngestedSubagent,
  type MirrorBodyRecordMember,
  type MirrorNarrowingReport
} from "./ingest.js";
export {
  mirrorServerForStore,
  mirrorRejectionStatus,
  type MirrorServerForStoreOptions
} from "./serve.js";
export {
  createMirrorPushRunner,
  isPushableHttpUrl,
  mirrorPushGloballyDisabled,
  redactEndpoint,
  runMirrorPushDaemon,
  sanitizeForLog,
  DEFAULT_MIRROR_AUTH_FAILURE_LIMIT,
  DEFAULT_MIRROR_BUILD_FAILURE_LIMIT,
  DEFAULT_MIRROR_PUSH_INTERVAL_MS,
  DEFAULT_MIRROR_REJECT_LIMIT,
  MIN_MIRROR_PUSH_INTERVAL_MS,
  MIRROR_PUSH_BACKOFF_BASE_MS,
  MIRROR_PUSH_BACKOFF_MAX_MS,
  MIRROR_PUSH_BUILD_FAILED_MESSAGE,
  MIRROR_PUSH_INVALID_URL_MESSAGE,
  MIRROR_PUSH_JITTER_FRACTION,
  MIRROR_PUSH_OFF_ENV,
  MIRROR_PUSH_REENROLLMENT_MESSAGE,
  MIRROR_PUSH_REJECTED_MESSAGE,
  type MirrorEnvelopeBuilder,
  type MirrorEnvelopeSender,
  type MirrorPushCycleLog,
  type MirrorPushCycleResult,
  type MirrorPushDaemonOptions,
  type MirrorPushDaemonSummary,
  type MirrorPushOutcome,
  type MirrorPushPayloadShape,
  type MirrorPushRunnerOptions,
  type MirrorPushStopReason
} from "./push-daemon.js";
