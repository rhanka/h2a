import { DomainError } from './item.js'

export const REPORT_STAGES = ['spec', 'dev', 'PR', 'mergé', 'déployé'] as const
export type ReportStage = typeof REPORT_STAGES[number]
export const REPORT_STATUSES = ['progressing', 'unforeseen', 'blocked', 'decision-awaited'] as const
export type ReportStatus = typeof REPORT_STATUSES[number]

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

export function assertItemReportStatus(value: unknown): asserts value is ItemReportStatus {
  if (!object(value)) fail('report must be an object')
  keys(value, ['ownerRequest', 'stage', 'status', 'proposal', 'decisionExpectations', 'facts', 'nextAction', 'waitingOn', 'suspended'])
  for (const key of ['ownerRequest', 'proposal', 'facts', 'nextAction', 'waitingOn', 'suspended']) {
    if (value[key] !== undefined && !text(value[key])) fail(`${key} must be a non-empty string`)
  }
  if (value["status"] !== undefined && !REPORT_STATUSES.includes(value["status"] as ReportStatus)) fail('invalid status')
  if (value["stage"] !== undefined) {
    if (!object(value["stage"])) fail('stage must be an object')
    keys(value["stage"], ['value', 'evidence'])
    if (!REPORT_STAGES.includes(value["stage"]["value"] as ReportStage)) fail('invalid stage')
    if (value["stage"]["evidence"] !== undefined && !text(value["stage"]["evidence"])) fail('stage evidence must be non-empty')
    if (['PR', 'mergé', 'déployé'].includes(String(value["stage"]["value"])) && !text(value["stage"]["evidence"])) fail('PR/mergé/déployé requires evidence')
  }
  if (value["decisionExpectations"] !== undefined) assertDecisionExpectations(value["decisionExpectations"])
  // Incomplete red/blue declarations are retained so the renderer can flag and route their repair.
}
