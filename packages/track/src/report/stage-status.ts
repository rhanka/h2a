// Stage and status derivation (amendment D2, D5–D9, P1, P3, P6).
//
// Stage and status are NEUTRAL, DERIVED codes computed per tracked item from
// facts already recorded in the journal — realisation, spec status, open
// blockers, acceptance, linked pending dossiers, explicit delivery links,
// reopenings. JSON carries codes, never localised words, as identity. There is
// no mandatory backfill: derivation, not storage, is the primary path.
//
// D6's single precedence table governs; first matching row wins. Open gates
// and acceptance are evaluated against the report's baseline. A qualifying
// fact is either current `acceptanceStatus = pass` backed by its recorded runs,
// or a valid `item.report-updated` assertion with `status = progressing` and
// non-empty `facts` (a recorded conformity assertion, not an independently
// verified result). Either witness must postdate the last reopening/regression
// and must not be superseded by a contrary fact. A bare stored green, a
// stage, `in-progress`, `done`, or absence of a gate is not such a witness.

import { acceptanceStatus } from '../accept/status.js'
import type { TrackEvent } from '../events/types.js'
import {
  assertItemReportStatus,
  normalizeReportStage,
  normalizeStoredReport,
  type ItemReportStatus,
  type ReportStage,
} from '../model/report-status.js'
import { isSettled, isStructuredDossier } from '../model/decision.js'
import type { ItemState } from '../model/item.js'
import type { State } from '../state/fold.js'
import { effectiveOpenBlockersForItem } from './blocker-status.js'

/** Neutral stage codes (D2). */
export type StageCode = ReportStage
/** Neutral status codes (D2): the four health states plus colourless `not-qualified` and terminal `withdrawn`. */
export type StatusCode = 'progressing' | 'unforeseen' | 'blocked' | 'decision-awaited' | 'not-qualified' | 'withdrawn'

/**
 * Health colour by status code. Only the first four carry one (D2, D8, D9):
 * `not-qualified` and `withdrawn` render without colour (`—` glyph in the
 * cell, the code in JSON). No fifth colour exists: lane waits and suspension
 * stay in the action cell.
 */
export const STATUS_HEALTH: Record<StatusCode, string | undefined> = {
  progressing: '🟢',
  unforeseen: '🟠',
  blocked: '🔴',
  'decision-awaited': '🔵',
  'not-qualified': undefined,
  withdrawn: undefined,
}

/**
 * Explicit recorded delivery-link kinds that prove a stage (D5). NOTHING else
 * does: `done` does not prove a merge, CI does not prove a merge, publishing
 * a release does not prove deployment to an environment.
 */
const EVIDENCE_LINK_STAGES: Record<string, StageCode> = {
  'pr-open': 'pr',
  'pr-merged': 'merged',
  deployed: 'deployed',
}

const STAGE_RANK: Record<StageCode, number> = { spec: 0, dev: 1, pr: 2, merged: 3, deployed: 4 }

export interface ItemStageStatus {
  stage: StageCode
  /** Recorded evidence locator for the stage; absent unless the stage was proven. */
  stageEvidence?: string
  /** True when a reopening voided a previously derived or stored high stage. */
  stageVoidedByReopening: boolean
  status: StatusCode
  /** Pending, structured, answerable native dossiers gating this item (visible even when red wins). */
  blueDossierIds: string[]
  /** An open decision gate with no answerable dossier: structuring work, never a D-number or green. */
  unanswerableDecisionGate: boolean
  /** A qualifying fact (acceptance pass or fresh conformity assertion) is present. */
  qualified: boolean
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

/** The latest valid stored report assertion, with its stream position, if any. */
function lastStoredAssertion(
  events: readonly TrackEvent[],
  itemId: string,
): { report: ItemReportStatus; index: number; at: string } | undefined {
  let found: { report: ItemReportStatus; index: number; at: string } | undefined
  events.forEach((event, index) => {
    if (event.type !== 'item.report-updated' || event.aggregateId !== itemId) return
    // Read-path tolerance (same as fold): historical French stage values
    // still assert; only genuinely invalid events are skipped.
    const report = normalizeStoredReport(event.payload)
    try {
      assertItemReportStatus(report)
    } catch {
      return // an invalid report event asserts nothing; a later valid one still counts
    }
    found = { report, index, at: event.at }
  })
  return found
}

function lastReopeningIndex(events: readonly TrackEvent[], itemId: string): number {
  let last = -1
  events.forEach((event, index) => {
    if (event.type === 'realization.reopened' && event.aggregateId === itemId) last = index
  })
  return last
}

/** The highest-ranked explicit delivery link with a non-blank locator, if any. */
function linkDerivedStage(item: ItemState): { value: StageCode; evidence: string } | undefined {
  const links = (item.links ?? [])
    .filter((link) => EVIDENCE_LINK_STAGES[link.kind] !== undefined && nonEmpty(link.locator))
    .sort((a, b) => STAGE_RANK[EVIDENCE_LINK_STAGES[b.kind]!] - STAGE_RANK[EVIDENCE_LINK_STAGES[a.kind]!])
  const link = links[0]
  if (link === undefined) return undefined
  return { value: EVIDENCE_LINK_STAGES[link.kind]!, evidence: link.locator }
}

function defaultStage(item: ItemState): StageCode {
  return item.realization === 'in-progress' || item.realization === 'done' ? 'dev' : 'spec'
}

export function deriveItemStageStatus(
  state: State,
  events: readonly TrackEvent[],
  item: ItemState,
  baselineCommit: string,
): ItemStageStatus {
  const lastReopen = lastReopeningIndex(events, item.id)
  const reopened = lastReopen >= 0
  const lastReopenAt = item.reopenings?.at(-1)?.at

  // A stored report is VOID after a reopening until requalified: only an
  // assertion recorded after the reopening still speaks (P6).
  const stored = lastStoredAssertion(events, item.id)
  const freshStored = stored !== undefined && stored.index > lastReopen ? stored.report : undefined

  // ---- stage (D5) -----------------------------------------------------------
  const storedStageValue = freshStored?.stage === undefined ? undefined : normalizeReportStage(freshStored.stage.value)
  const storedStage = storedStageValue === undefined
    ? undefined
    : { value: storedStageValue, evidence: freshStored!.stage!.evidence }
  const linked = linkDerivedStage(item)
  let stage: StageCode
  let stageEvidence: string | undefined
  let stageVoidedByReopening = false
  if (storedStage !== undefined && (STAGE_RANK[storedStage.value] <= 1 || nonEmpty(storedStage.evidence))) {
    stage = storedStage.value
    stageEvidence = nonEmpty(storedStage.evidence) ? storedStage.evidence!.trim() : undefined
  } else if (linked === undefined) {
    stage = storedStage?.value ?? defaultStage(item)
  } else if (!reopened || STAGE_RANK[linked.value] <= 1) {
    stage = linked.value
    stageEvidence = linked.evidence
  } else if (freshStored !== undefined) {
    // A reopening voids a derived high stage — but a fresh stored assertion
    // requalifies the item, so the old link stays void SILENTLY (it is not
    // resurrected, and no flag is owed). Only a high stage with NO fresh
    // assertion at all is flagged below (D5).
    stage = 'dev'
  } else {
    stage = 'dev'
    stageVoidedByReopening = true
  }

  // ---- gates, dossiers, acceptance ------------------------------------------
  const blockers = effectiveOpenBlockersForItem(state, item.id, baselineCommit)
  const nonDecisionBlockers = blockers.filter((blocker) => blocker.kind !== 'decision')
  const decisionBlockers = blockers.filter((blocker) => blocker.kind === 'decision')
  const acceptance = acceptanceStatus(state, item.id, baselineCommit)

  const linkedDecisions = [...state.decisions.values()].filter((decision) => decision.targets.includes(item.id))
  const blueDossiers = linkedDecisions.filter(
    (decision) => !isSettled(decision.outcome) && isStructuredDossier(decision.dossier),
  )
  const effectiveBlue = decisionBlockers.length > 0
    ? blueDossiers.filter((decision) =>
      decisionBlockers.some((blocker) => blocker.ref === undefined || blocker.ref === decision.id),
    )
    : []
  const unanswerableDecisionGate = decisionBlockers.length > 0 && effectiveBlue.length === 0

  // ---- qualification witnesses (D6, P6) --------------------------------------
  const criteria = [...state.criteria.values()].filter((criterion) => criterion.itemId === item.id)
  const acceptanceWitness =
    acceptance === 'pass' &&
    criteria.every((criterion) => {
      const runs = [...state.evidence.values()]
        .filter((entry) => entry.criterionId === criterion.id)
        .map((entry) => entry.latestRun)
      if (criterion.waiver !== undefined) return true // a recorded waiver is a conformity decision, not a gap
      return runs.length > 0 && runs.every((run) =>
        run !== undefined && run.result === 'pass' && (lastReopenAt === undefined || run.at >= lastReopenAt),
      )
    })
  const storedWitness =
    freshStored?.status === 'progressing' && nonEmpty(freshStored.facts)
  const qualified = acceptanceWitness || storedWitness === true

  // An unforeseen fact (D6 priority 4): an unresolved recorded
  // reopening/regression or a stale acceptance — never mere silence or
  // elapsed time. A requalification supersedes the reopening; a fresh
  // conformity assertion recorded no earlier than the stale runs supersedes
  // the staleness.
  const reopenUnresolved = reopened && !qualified
  let staleUnresolved = acceptance === 'stale'
  if (staleUnresolved && storedWitness === true && stored !== undefined) {
    const runAts = criteria.flatMap((criterion) =>
      [...state.evidence.values()]
        .filter((entry) => entry.criterionId === criterion.id)
        .map((entry) => entry.latestRun?.at)
        .filter((at): at is string => at !== undefined),
    )
    staleUnresolved = !runAts.every((runAt) => stored.at >= runAt)
  }
  const unforeseenFact = reopenUnresolved || staleUnresolved

  // ---- D6 precedence: first matching row wins ---------------------------------
  let status: StatusCode
  if (item.realization === 'cancelled' || item.realization === 'rejected') {
    status = 'withdrawn'
  } else if (nonDecisionBlockers.length > 0 || acceptance === 'fail') {
    status = 'blocked'
  } else if (effectiveBlue.length > 0) {
    status = 'decision-awaited'
  } else if (unforeseenFact) {
    status = 'unforeseen'
  } else if (
    // No open gate of any kind: an unanswerable decision gate still blocks
    // green (it stays visible as structuring work, never a D-number or green).
    blockers.length === 0 && qualified &&
    (item.realization === 'in-progress' || (item.realization === 'done' && acceptance === 'pass'))
  ) {
    status = 'progressing'
  } else {
    status = 'not-qualified'
  }

  return {
    stage,
    ...(stageEvidence !== undefined ? { stageEvidence } : {}),
    stageVoidedByReopening,
    status,
    blueDossierIds: effectiveBlue.map((decision) => decision.id),
    unanswerableDecisionGate,
    qualified,
  }
}
