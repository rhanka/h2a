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

export interface ReportEtaEntry {
  targetStage: ReportStage
  /** Target stage label qualification (e.g. `MEP` for `prod (MEP)`). */
  targetLabel?: string
  /** Human-readable date token (e.g. `15/11`, `2026-11-15`) or `—` when unknown. */
  when: string
  source: ReportEtaSource
  /** Required when `source === 'committed'`. */
  by?: string
  /** Optional slip annotation when the initial ETA was missed. */
  slip?: { initialWhen: string; reason?: string }
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

export function assertReportEtaEntry(value: unknown, grammar: 'read' | 'write' = 'write'): asserts value is ReportEtaEntry {
  if (!object(value)) fail('eta entry must be an object')
  keys(value, ['targetStage', 'targetLabel', 'when', 'source', 'by', 'slip'])
  if (!REPORT_STAGES.includes(value['targetStage'] as ReportStage)) fail('eta targetStage must be a valid stage')
  if (value['targetLabel'] !== undefined && !text(value['targetLabel'])) fail('eta targetLabel must be non-empty')
  if (!text(value['when'])) fail('eta when is required')
  if (value['source'] !== 'measured' && value['source'] !== 'committed' && value['source'] !== 'unknown') {
    fail('eta source must be measured, committed or unknown')
  }
  if (grammar === 'write' && value['source'] === 'measured') {
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
