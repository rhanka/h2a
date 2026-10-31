import { DomainError } from './item.js'

/**
 * Neutral stage codes (D2) — the identity carried by JSON, never localised
 * words. B1 (Lot L1) adds `review` and `published` as READERS first: the write
 * grammar stays `WRITABLE_REPORT_STAGES` until Lot L5 opens the writers. The
 * 2026-10-17 French values (`mergé`/`déployé`) and `PR` are legacy aliases:
 * normalised on read (`normalizeReportStage`, fold-time), rejected on new
 * writes (`assertItemReportStatus`). Historical events are never rewritten.
 */
export const REPORT_STAGES = ['spec', 'dev', 'pr', 'review', 'merged', 'published', 'deployed'] as const
export type ReportStage = typeof REPORT_STAGES[number]
/** Stages accepted on NEW writes (B1 Lot L1): the `review`/`published` writers open in Lot L5. */
export const WRITABLE_REPORT_STAGES = ['spec', 'dev', 'pr', 'merged', 'deployed'] as const
export const REPORT_STATUSES = ['progressing', 'unforeseen', 'blocked', 'decision-awaited', 'not-qualified', 'withdrawn'] as const
export type ReportStatus = typeof REPORT_STATUSES[number]

/** Legacy stored stage values mapped to their neutral code (read path only). */
const LEGACY_STAGE_ALIASES: Record<string, ReportStage> = {
  PR: 'pr',
  'mergé': 'merged',
  'déployé': 'deployed',
  'revue': 'review',
  'en revue': 'review',
  'publié': 'published',
  'publication': 'published',
}

/**
 * Map a stored stage value to its neutral code. Returns `undefined` for an
 * unknown value (the caller then ignores the stored stage rather than
 * inventing one). Neutral codes map to themselves.
 */
export function normalizeReportStage(value: unknown): ReportStage | undefined {
  if (typeof value !== 'string') return undefined
  if ((REPORT_STAGES as readonly string[]).includes(value)) return value as ReportStage
  return LEGACY_STAGE_ALIASES[value]
}

/**
 * Read-path tolerance for a stored report assertion (fold + derivation).
 * Historical 2026-10-17 French stage values read as neutral codes; the
 * events themselves are never rewritten. Unknown stage values are dropped
 * (the caller ignores the stored stage rather than inventing one). This is
 * the READ path — new writes still go through `assertItemReportStatus`, which
 * rejects the legacy values.
 */
export function normalizeStoredReport(value: unknown): ItemReportStatus {
  const source = value as Partial<ItemReportStatus> & { stage?: { value?: unknown; evidence?: string } }
  const stored = source.stage
  if (stored === undefined || typeof stored !== 'object' || stored === null) {
    return { ...(value as ItemReportStatus) }
  }
  const normalized = normalizeReportStage(stored.value)
  if (normalized === undefined) {
    const { stage: _dropped, ...rest } = value as ItemReportStatus & { stage?: unknown }
    void _dropped
    return { ...rest }
  }
  return { ...(value as ItemReportStatus), stage: { ...stored, value: normalized } }
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
  stage?: { value: ReportStage; evidence?: string }
  status?: ReportStatus
  proposal?: string
  decisionExpectations?: DecisionExpectations
  facts?: string
  nextAction?: string
  waitingOn?: string
  suspended?: string
}

const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const text = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0
function fail(message: string): never { throw new DomainError(`item report-set: ${message}`) }
function keys(v: Record<string, unknown>, allowed: string[]): void {
  if (Object.keys(v).some(k => !allowed.includes(k))) fail('unknown field')
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

/**
 * Validate a report assertion. The default `'write'` grammar accepts only
 * `WRITABLE_REPORT_STAGES` (B1 Lot L1: the `review`/`published` writers open
 * in Lot L5); `'read'` accepts the full `REPORT_STAGES` grammar, so a stored
 * review/published assertion still asserts on the fold/derivation path.
 */
export function assertItemReportStatus(value: unknown, grammar: 'read' | 'write' = 'write'): asserts value is ItemReportStatus {
  if (!object(value)) fail('report must be an object')
  keys(value, ['ownerRequest', 'stage', 'status', 'proposal', 'decisionExpectations', 'facts', 'nextAction', 'waitingOn', 'suspended'])
  for (const key of ['ownerRequest', 'proposal', 'facts', 'nextAction', 'waitingOn', 'suspended']) {
    if (value[key] !== undefined && !text(value[key])) fail(`${key} must be a non-empty string`)
  }
  if (value["status"] !== undefined && !REPORT_STATUSES.includes(value["status"] as ReportStatus)) fail('invalid status')
  if (value["stage"] !== undefined) {
    if (!object(value["stage"])) fail('stage must be an object')
    keys(value["stage"], ['value', 'evidence'])
    const stageGrammar = (grammar === 'read' ? REPORT_STAGES : WRITABLE_REPORT_STAGES) as readonly string[]
    if (!stageGrammar.includes(value["stage"]["value"] as string)) fail('invalid stage')
    if (value["stage"]["evidence"] !== undefined && !text(value["stage"]["evidence"])) fail('stage evidence must be non-empty')
    const evidenceStages = grammar === 'read'
      ? ['pr', 'review', 'merged', 'published', 'deployed']
      : ['pr', 'merged', 'deployed']
    if (evidenceStages.includes(String(value["stage"]["value"])) && !text(value["stage"]["evidence"])) fail(`${evidenceStages.join('/')} requires evidence`)
  }
  if (value["decisionExpectations"] !== undefined) assertDecisionExpectations(value["decisionExpectations"])
  // Incomplete red/blue declarations are retained so the renderer can flag and route their repair.
}
