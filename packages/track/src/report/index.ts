// report + query: bucket engine with SPEC §7 precedence (AWAITED > DROPPED > DONE > TO-DO).
export { BUCKETS, bucketOf, type Bucket, type ReportConfig } from './buckets.js'
export {
  buildReport,
  query,
  type DecisionRow,
  type QueryFilter,
  type Report,
  type ReportItemFacts,
  type ReportOptions,
  type ReportRow,
  type WithdrawalCandidate,
} from './build.js'
export {
  auditNextActions,
  coverageLine,
  describeRowNextActions,
  DETERMINISTIC_NEXT_ACTIONS,
  formatReport,
  formatRows,
  formatWpConductor,
  formatWpTree,
  handleCommandFor,
  resolutionLines,
  wpTotals,
  type ConductorMeta,
  type Format,
  type NextActionAudit,
  type NextActionAuditDescriptor,
  type NextActionInstruction,
  type NextActionOrigin,
  type ReportCoverage,
  type ReportHandle,
  type ReportHeader,
  type ReportOmission,
  type ReportPeriod,
  type WithdrawalNotice,
  type WpTotals,
} from './format.js'
// Amendment D10 — the per-language stage/status lexicon (codes stay the identity).
export {
  CODE_LABELS,
  resolveStageStatusLabels,
  STAGE_STATUS_LEXICON,
  type ResolvedStageStatusLabels,
  type StageStatusLabels,
} from './stage-status-lexicon.js'
export {
  deriveItemStageStatus,
  STATUS_HEALTH,
  type ItemStageStatus,
  type StageCode,
  type StatusCode,
} from './stage-status.js'
// Workpackages §2 — the %-by-WP rollup forest (pure).
export { computeWpTree, tally, type WpLeaf, type WpNode } from './rollup.js'
// Scope §A/§B — status(level) projection (spec|plan|wp|lot|task), additive read-only.
export {
  statusByLevel,
  STATUS_LEVELS,
  type GroupStatus,
  type StatusGroup,
  type StatusLevel,
} from './status-by-level.js'
// Commit-relative blocker openness (v2.2a hybrid-A) — `linked-accepted` derived at projection time.
export { effectiveBlockerOpen, effectiveOpenBlockersForItem } from './blocker-status.js'
// Amendment D7 — the public red/blue proposal audit (deterministic flags, never fabricated text).
export {
  auditStatusProposals,
  describeStatusProposals,
  type StatusProposalAudit,
  type StatusProposalRow,
  type StatusProposalView,
} from './audit.js'
export {
  SNAPSHOT_EVENT_LIMIT,
  SNAPSHOT_SCHEMA,
  buildSnapshot,
  renderSnapshot,
  snapshotDiagnostic,
  snapshotJson,
  type SnapshotDirective,
  type SnapshotOptions,
  type SnapshotRecentEvent,
  type SnapshotV1,
} from './snapshot.js'
