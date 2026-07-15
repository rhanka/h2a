// report + query: bucket engine with SPEC §7 precedence (AWAITED > DROPPED > DONE > TO-DO).
export { BUCKETS, bucketOf, type Bucket, type ReportConfig } from './buckets.js'
export {
  buildReport,
  query,
  type DecisionRow,
  type QueryFilter,
  type Report,
  type ReportOptions,
  type ReportRow,
} from './build.js'
export {
  formatReport,
  formatRows,
  formatWpConductor,
  formatWpTree,
  wpTotals,
  type Format,
  type WpTotals,
} from './format.js'
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
export {
  AI_SECTION_NAMES,
  AiReportError,
  buildReportContext,
  generateAiReport,
  normalizeAiText,
  redactText,
  renderAiReport,
  reporterEnvironment,
  REPORTER_TIMEOUT_DEFAULT_MS,
  REPORTER_TIMEOUT_MAX_MS,
  REPORTER_TIMEOUT_MIN_MS,
  resolveReporterConfig,
  resolveReporterArgv,
  type AiEntry,
  type AiReportRequest,
  type AiReportResultV1,
  type Citation,
  type ContextReference,
  type DocumentContextEntry,
  type GenerateAiReportOptions,
  type GitContextEntry,
  type H2aContextEntry,
  type ReportContextBodyV1,
  type ReportContextEnvelopeV1,
  type ReporterConfigV1,
  type Source,
} from './ai-report.js'
