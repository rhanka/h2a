import { DomainError } from './item.js'

/**
 * Neutral stage codes (D2, D5) — the 12 ordered workflow stages carried by JSON,
 * never localised words. Historical 2026-10-17 French values (`mergé`/`déployé`),
 * `PR`, and bare `deployed` are legacy aliases: normalised on read
 * (`normalizeReportStage`, fold-time), rejected on new writes
 * (`assertItemReportStatus`). Historical events are never rewritten.
 */
export const REPORT_STAGES = [
  'brainstorm',
  'spec',
  'plan',
  'dev',
  'test',
  'pr',
  'review',
  'merged',
  'published',
  'preprod',
  'prod',
  'done',
] as const
export type ReportStage = typeof REPORT_STAGES[number]
/**
 * Only the 10 pre-production stages can be asserted via `item.report.stage` on writes;
 * `prod` and `done` require recorded delivery and acceptance links (`deployed-prod` +
 * `prod-accepted` / `uat-accepted`).
 */
export const WRITABLE_REPORT_STAGES = [
  'brainstorm',
  'spec',
  'plan',
  'dev',
  'test',
  'pr',
  'review',
  'merged',
  'published',
  'preprod',
] as const

/**
 * Neutral status codes (D2, D6, Owner Decision 14/11):
 * - `withdrawn`     -> ⚫ retiré
 * - `blocked`       -> 🔴 bloqué
 * - `unforeseen`    -> 🟠 dérive
 * - `waiting`       -> 🟡 en attente
 * - `done`          -> ✅ fait
 * - `on-track`      -> 🔵 sur la voie
 * - `not-started`   -> ⚪ pas commencé / en pause
 * - `not-qualified` -> — sans témoin
 * Note: `decision-awaited` is no longer a status (blocking decisions make the row `blocked`).
 */
export const REPORT_STATUSES = [
  'withdrawn',
  'blocked',
  'unforeseen',
  'waiting',
  'done',
  'on-track',
  'not-started',
  'not-qualified',
] as const
export type ReportStatus = typeof REPORT_STATUSES[number]

/** Legacy stored stage values mapped to their neutral code (read path only). */
const LEGACY_STAGE_ALIASES: Record<string, ReportStage> = {
  PR: 'pr',
  'mergé': 'merged',
  'préprod': 'preprod',
  'revue': 'review',
  'en revue': 'review',
  'publié': 'published',
  'publication': 'published',
  bench: 'brainstorm',
  benchmark: 'brainstorm',
  cadrage: 'brainstorm',
  'dév': 'dev',
}

/** Legacy stored status values mapped to their neutral code (read path only). */
const LEGACY_STATUS_ALIASES: Record<string, ReportStatus> = {
  progressing: 'on-track',
  ontrack: 'on-track',
  drift: 'unforeseen',
  idle: 'not-started',
  nowitness: 'not-qualified',
}

function isProdEvidenceLocator(evidence: unknown): boolean {
  if (typeof evidence !== 'string') return false
  const trimmed = evidence.trim()
  if (!/^prod:/iu.test(trimmed)) return false
  return !/(?:-rc\.|staging|preprod|canary)/iu.test(trimmed)
}

/**
 * Map a stored stage value to its neutral code. Returns `undefined` for an
 * unknown value (the caller then ignores the stored stage rather than
 * inventing one). Neutral codes map to themselves. An old `deployed` / `déployé`
 * with no environment (or a non-prod locator) maps to `preprod`.
 */
export function normalizeReportStage(value: unknown, evidence?: unknown): ReportStage | undefined {
  if (typeof value !== 'string') return undefined
  if ((REPORT_STAGES as readonly string[]).includes(value)) return value as ReportStage
  if (value === 'deployed' || value === 'déployé') {
    return isProdEvidenceLocator(evidence) ? 'prod' : 'preprod'
  }
  return LEGACY_STAGE_ALIASES[value]
}

/**
 * Map a stored status value to its neutral code. Returns `undefined` for
 * `decision-awaited` (no longer a status) or unknown values.
 */
export function normalizeReportStatus(value: unknown): ReportStatus | undefined {
  if (typeof value !== 'string') return undefined
  if ((REPORT_STATUSES as readonly string[]).includes(value)) return value as ReportStatus
  return LEGACY_STATUS_ALIASES[value]
}

export type ReportEtaSource = 'measured' | 'committed' | 'unknown'

export interface MeasuredVelocityProvenance {
  predictedAt: string
  evidenceCutoff: string
  p80Seconds: number
  sampleCount: number
  support: 'descriptive'
  lockedDigest: string
  currentDigest: string
}

export interface EtaSlipRecord {
  fromWhen: string
  toWhen: string
  at: string
  reason?: string
  rebaselineDecisionId?: string
}

export interface ReportEtaEntry {
  targetStage: ReportStage
  /** Target stage label qualification (e.g. `MEP` for `prod (MEP)`). */
  targetLabel?: string
  /** ISO-8601 date token (`YYYY-MM-DD`) or `—` when unknown. */
  when: string
  source: ReportEtaSource
  /** Required when `source === 'committed'`. */
  by?: string
  /** Optional slip annotation when the initial ETA was missed or moved. */
  slip?: { initialWhen: string; reason?: string }
  /** Required when `source === 'measured'`: provenance from `qualifyVelocityEta` (#376). */
  measured?: MeasuredVelocityProvenance
}

export interface EtaJournalEntry extends ReportEtaEntry {
  /** First non-blank `when` recorded for `targetStage` (or re-anchored by a settled `go` decision). */
  initialWhen: string
  /** ISO-8601 timestamp of the latest `eta-set` event on this slot. */
  updatedAt: string
  /** Monotonic stream index of the latest `eta-set` event on this slot. */
  updatedOrder?: number
  /** Append-only slip history for this `targetStage` slot. */
  slips: EtaSlipRecord[]
  /** Optional settled `'go'` decision that re-baselined `initialWhen` on the latest event. */
  rebaselineDecisionId?: string
  /** All settled `'go'` decision IDs ever consumed to rebaseline this slot (each `'go'` decision rebaselines once). */
  rebaselineDecisionIds?: string[]
  /** True when explicitly acknowledged as delivered on time (extinguishes a demand-level ETA without cross-lot reads). */
  delivered?: boolean
}

export interface SetEtaInput {
  targetStage: ReportStage
  targetLabel?: string
  when?: string
  source?: ReportEtaSource
  by?: string
  reason?: string
  rebaselineDecisionId?: string
  measured?: MeasuredVelocityProvenance
  delivered?: boolean
}

/**
 * Read-path tolerance for a stored report assertion (fold + derivation).
 * Historical stage/status values read as neutral codes; the events themselves
 * are never rewritten. Unknown stage values and retired `decision-awaited`
 * statuses are dropped on read. New writes still go through
 * `assertItemReportStatus`, which rejects legacy values.
 */
export function normalizeStoredReport(value: unknown): ItemReportStatus {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return value as ItemReportStatus
  }
  const source = value as Partial<ItemReportStatus> & {
    stage?: { value?: unknown; evidence?: string }
    status?: unknown
  }
  const copy: Record<string, unknown> = { ...(value as Record<string, unknown>) }

  const storedStage = source.stage
  if (storedStage !== undefined && typeof storedStage === 'object' && storedStage !== null) {
    const normalizedStage = normalizeReportStage(storedStage.value, storedStage.evidence)
    if (normalizedStage === undefined) {
      delete copy['stage']
    } else {
      copy['stage'] = { ...storedStage, value: normalizedStage }
    }
  }

  if (source.status !== undefined) {
    if ((source.status as unknown) === 'decision-awaited') {
      delete copy['status']
    } else {
      const normalizedStatus = normalizeReportStatus(source.status)
      if (normalizedStatus !== undefined) {
        copy['status'] = normalizedStatus
      }
    }
  }

  return copy as ItemReportStatus
}

export interface DecisionExpectations {
  /** Exact question and consequences, not option identifiers alone. */
  question: string
  options: { label: string; consequence: string }[]
  dossier: string
  readingMinutes: number
}

/** Full replacement, display-only record. Does not mutate realization, acceptance or decisions. */
export interface ItemReportStatus {
  ownerRequest?: string
  ownerNumber?: number
  ownerSummary?: string
  requestedStage?: ReportStage
  stage?: { value: ReportStage; evidence?: string }
  status?: ReportStatus
  proposal?: string
  decisionExpectations?: DecisionExpectations
  facts?: string
  nextAction?: string
  waitingOn?: string
  suspended?: string
  pausedByOwner?: boolean
  pauseDecisionId?: string
  etas?: ReportEtaEntry[]
  decisionRefs?: string[]
  decisionBlocking?: boolean
  archived?: { decisionId: string; reason: string }
}

const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const text = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0
function fail(message: string): never { throw new DomainError(`item report-set: ${message}`) }
function keys(v: Record<string, unknown>, allowed: string[]): void {
  if (Object.keys(v).some(k => !allowed.includes(k))) fail('unknown field')
}

export function isValidIsoDateToken(value: string): boolean {
  const trimmed = value.trim()
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?$/u.exec(trimmed)
  if (!match) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) return false
  const probe = new Date(Date.UTC(year, month - 1, day))
  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
  )
}

export function assertDecisionExpectations(value: unknown): asserts value is DecisionExpectations {
  if (!object(value)) fail('decisionExpectations must be an object')
  keys(value, ['question', 'options', 'dossier', 'readingMinutes'])
  if (!text(value["question"]) || !text(value["dossier"])) fail('question and dossier are required')
  if (typeof value["readingMinutes"] !== 'number' || !Number.isFinite(value["readingMinutes"]) || value["readingMinutes"] <= 0 || value["readingMinutes"] > 2) fail('readingMinutes must be > 0 and <= 2')
  if (!Array.isArray(value["options"]) || value["options"].length < 2) fail('at least two options with consequences are required')
  for (const option of value["options"]) {
    if (!object(option)) fail('invalid option')
    keys(option, ['label', 'consequence'])
    if (!text(option["label"]) || !text(option["consequence"])) fail('option label and consequence are required')
  }
  if (new Set(value["options"].map(o => o["label"])).size !== value["options"].length) fail('option labels must be distinct')
  // A declared budget alone cannot make an unbounded essay a two-minute decision.
  const words = [value['question'], ...value['options'].flatMap(o => [o['label'], o['consequence']])].join(' ').split(/\s+/u).length
  if (words > 400) fail('decision summary exceeds 400 words (two minutes)')
}

const UNMEASURED_EARLY_STAGES: ReadonlySet<ReportStage> = new Set(['brainstorm', 'spec', 'plan'])

export function isValidMeasuredVelocityProvenance(value: unknown): value is MeasuredVelocityProvenance {
  if (!object(value)) return false
  const allowed = [
    'predictedAt',
    'evidenceCutoff',
    'p80Seconds',
    'sampleCount',
    'support',
    'lockedDigest',
    'currentDigest',
  ]
  if (Object.keys(value).some((k) => !allowed.includes(k))) return false
  if (value['support'] !== 'descriptive') return false
  if (typeof value['p80Seconds'] !== 'number' || !Number.isFinite(value['p80Seconds']) || value['p80Seconds'] <= 0) {
    return false
  }
  if (
    typeof value['sampleCount'] !== 'number' ||
    !Number.isInteger(value['sampleCount']) ||
    value['sampleCount'] <= 0
  ) {
    return false
  }
  if (!text(value['predictedAt']) || !text(value['evidenceCutoff'])) return false
  const predictedMs = Date.parse(value['predictedAt'])
  const cutoffMs = Date.parse(value['evidenceCutoff'])
  if (Number.isNaN(predictedMs) || Number.isNaN(cutoffMs) || cutoffMs > predictedMs) return false
  if (!text(value['lockedDigest']) || !text(value['currentDigest'])) return false
  if (value['lockedDigest'].trim() !== value['currentDigest'].trim()) return false
  return true
}

export function assertReportEtaEntry(value: unknown, grammar: 'read' | 'write' = 'write'): asserts value is ReportEtaEntry {
  if (!object(value)) fail('eta entry must be an object')
  keys(value, ['targetStage', 'targetLabel', 'when', 'source', 'by', 'slip', 'measured'])
  if (!REPORT_STAGES.includes(value['targetStage'] as ReportStage)) fail('eta targetStage must be a valid stage')
  if (value['targetLabel'] !== undefined && !text(value['targetLabel'])) fail('eta targetLabel must be non-empty')
  if (!text(value['when'])) fail('eta when is required')
  if (value['source'] !== 'measured' && value['source'] !== 'committed' && value['source'] !== 'unknown') {
    fail('eta source must be measured, committed or unknown')
  }
  if (value['measured'] !== undefined && !isValidMeasuredVelocityProvenance(value['measured'])) {
    fail('eta measured provenance is invalid')
  }
  if (
    grammar === 'write' &&
    value['source'] === 'measured' &&
    (!isValidMeasuredVelocityProvenance(value['measured']) ||
      UNMEASURED_EARLY_STAGES.has(value['targetStage'] as ReportStage))
  ) {
    fail('measured eta requires qualified velocity estimator provenance')
  }
  if (value['source'] === 'unknown' && String(value['when']).trim() !== '—') {
    fail('unknown eta must have when === "—"')
  }
  if (grammar === 'write' && value['source'] !== 'unknown' && !isValidIsoDateToken(String(value['when']))) {
    fail('eta when must be an ISO date (YYYY-MM-DD)')
  }
  if (value['source'] === 'committed' && !text(value['by'])) {
    fail('committed eta requires by')
  }
  if (value['by'] !== undefined && !text(value['by'])) fail('eta by must be non-empty')
  if (value['slip'] !== undefined) {
    if (!object(value['slip'])) fail('eta slip must be an object')
    keys(value['slip'], ['initialWhen', 'reason'])
    if (!text(value['slip']['initialWhen'])) fail('eta slip initialWhen is required')
    if (value['slip']['reason'] !== undefined && !text(value['slip']['reason'])) fail('eta slip reason must be non-empty')
  }
}

export function assertSetEtaInput(
  value: unknown,
  options: { allowMeasured?: boolean } = {},
): SetEtaInput & { when: string; source: ReportEtaSource } {
  if (!object(value)) throw new DomainError('eta-set: input must be an object')
  const allowed = [
    'targetStage',
    'targetLabel',
    'when',
    'source',
    'by',
    'reason',
    'rebaselineDecisionId',
    'measured',
    'delivered',
  ]
  if (Object.keys(value).some((k) => !allowed.includes(k))) {
    throw new DomainError('eta-set: unknown field')
  }
  if (!REPORT_STAGES.includes(value['targetStage'] as ReportStage)) {
    throw new DomainError('eta-set: targetStage must be a valid stage')
  }
  const targetStage = value['targetStage'] as ReportStage
  if (value['targetLabel'] !== undefined && !text(value['targetLabel'])) {
    throw new DomainError('eta-set: targetLabel must be non-empty')
  }
  if (value['delivered'] !== undefined && typeof value['delivered'] !== 'boolean') {
    throw new DomainError('eta-set: delivered must be a boolean')
  }
  const delivered = value['delivered'] === true
  const rawWhenVal = delivered && value['when'] === undefined ? '—' : value['when']
  const rawSourceVal = delivered && value['source'] === undefined ? 'unknown' : value['source']
  if (!text(rawWhenVal)) {
    throw new DomainError('eta-set: when is required')
  }
  const when = (rawWhenVal as string).trim()
  const source = rawSourceVal
  if (source !== 'measured' && source !== 'committed' && source !== 'unknown') {
    throw new DomainError('eta-set: source must be measured, committed or unknown')
  }
  if (source === 'measured') {
    if (
      options.allowMeasured !== true ||
      !isValidMeasuredVelocityProvenance(value['measured']) ||
      UNMEASURED_EARLY_STAGES.has(targetStage)
    ) {
      throw new DomainError(
        'eta-set: source "measured" requires qualified velocity estimator inputs via qualifyVelocityEta',
      )
    }
  }
  if (source === 'unknown' && when !== '—') {
    throw new DomainError('eta-set: unknown eta must have when === "—"')
  }
  if (source !== 'unknown' && !isValidIsoDateToken(when)) {
    throw new DomainError('eta-set: when must be an ISO date (YYYY-MM-DD)')
  }
  if (source === 'committed' && !text(value['by'])) {
    throw new DomainError('eta-set: committed eta requires by')
  }
  if (value['by'] !== undefined && !text(value['by'])) {
    throw new DomainError('eta-set: by must be non-empty')
  }
  if (value['reason'] !== undefined && !text(value['reason'])) {
    throw new DomainError('eta-set: reason must be non-empty')
  }
  if (value['rebaselineDecisionId'] !== undefined && !text(value['rebaselineDecisionId'])) {
    throw new DomainError('eta-set: rebaselineDecisionId must be non-empty')
  }
  return {
    targetStage,
    when,
    source,
    ...(value['targetLabel'] !== undefined ? { targetLabel: (value['targetLabel'] as string).trim() } : {}),
    ...(value['by'] !== undefined ? { by: (value['by'] as string).trim() } : {}),
    ...(value['reason'] !== undefined ? { reason: (value['reason'] as string).trim() } : {}),
    ...(value['rebaselineDecisionId'] !== undefined
      ? { rebaselineDecisionId: (value['rebaselineDecisionId'] as string).trim() }
      : {}),
    ...(source === 'measured' && isValidMeasuredVelocityProvenance(value['measured'])
      ? { measured: value['measured'] }
      : {}),
    ...(delivered ? { delivered: true } : {}),
  }
}

/** High stages that always require a recorded evidence locator. */
export const EVIDENCE_REQUIRED_STAGES: readonly ReportStage[] = [
  'pr',
  'review',
  'merged',
  'published',
  'preprod',
  'prod',
  'done',
] as const

/**
 * Validate a report assertion. `'read'` accepts all 12 neutral stages in `REPORT_STAGES`;
 * `'write'` accepts the 10 pre-prod stages in `WRITABLE_REPORT_STAGES` (`prod` and `done`
 * require recorded links) and the 8 neutral statuses in `REPORT_STATUSES`.
 */
export function assertItemReportStatus(value: unknown, grammar: 'read' | 'write' = 'write'): asserts value is ItemReportStatus {
  if (!object(value)) fail('report must be an object')
  keys(value, [
    'ownerRequest',
    'ownerNumber',
    'ownerSummary',
    'requestedStage',
    'stage',
    'status',
    'proposal',
    'decisionExpectations',
    'facts',
    'nextAction',
    'waitingOn',
    'suspended',
    'pausedByOwner',
    'pauseDecisionId',
    'etas',
    'decisionRefs',
    'decisionBlocking',
    'archived',
  ])
  for (const key of ['ownerRequest', 'ownerSummary', 'proposal', 'facts', 'nextAction', 'waitingOn', 'suspended', 'pauseDecisionId']) {
    if (value[key] !== undefined && !text(value[key])) fail(`${key} must be a non-empty string`)
  }
  if (value['ownerNumber'] !== undefined) {
    if (typeof value['ownerNumber'] !== 'number' || !Number.isInteger(value['ownerNumber']) || value['ownerNumber'] < 1) {
      fail('ownerNumber must be a positive integer')
    }
  }
  if (value['requestedStage'] !== undefined && !REPORT_STAGES.includes(value['requestedStage'] as ReportStage)) {
    fail('invalid requestedStage')
  }
  if (value['pausedByOwner'] !== undefined && typeof value['pausedByOwner'] !== 'boolean') {
    fail('pausedByOwner must be a boolean')
  }
  if (grammar === 'write' && value['pausedByOwner'] === true && !text(value['pauseDecisionId'])) {
    fail('pausedByOwner requires pauseDecisionId')
  }
  if (value['decisionBlocking'] !== undefined && typeof value['decisionBlocking'] !== 'boolean') {
    fail('decisionBlocking must be a boolean')
  }
  if (value['decisionRefs'] !== undefined) {
    if (!Array.isArray(value['decisionRefs']) || value['decisionRefs'].some(ref => !text(ref))) {
      fail('decisionRefs must be an array of non-empty strings')
    }
  }
  if (value['etas'] !== undefined) {
    if (!Array.isArray(value['etas']) || value['etas'].length > 2) {
      fail('etas must be an array of at most 2 entries')
    }
    for (const entry of value['etas']) assertReportEtaEntry(entry, grammar)
  }
  if (value['archived'] !== undefined) {
    if (!object(value['archived'])) fail('archived must be an object')
    keys(value['archived'], ['decisionId', 'reason'])
    if (!text(value['archived']['decisionId']) || !text(value['archived']['reason'])) {
      fail('archived requires decisionId and reason')
    }
  }
  if (value["status"] !== undefined && !REPORT_STATUSES.includes(value["status"] as ReportStatus)) fail('invalid status')
  if (value["stage"] !== undefined) {
    if (!object(value["stage"])) fail('stage must be an object')
    keys(value["stage"], ['value', 'evidence'])
    const stageGrammar = (grammar === 'read' ? REPORT_STAGES : WRITABLE_REPORT_STAGES) as readonly string[]
    if (!stageGrammar.includes(value["stage"]["value"] as string)) fail('invalid stage')
    if (value["stage"]["evidence"] !== undefined && !text(value["stage"]["evidence"])) fail('stage evidence must be non-empty')
    const evidenceStages = EVIDENCE_REQUIRED_STAGES as readonly string[]
    if (evidenceStages.includes(String(value["stage"]["value"])) && !text(value["stage"]["evidence"])) {
      fail(`${evidenceStages.join('/')} requires evidence`)
    }
  }
  if (value["decisionExpectations"] !== undefined) assertDecisionExpectations(value["decisionExpectations"])
}
