// Stage and status derivation (amendment D2, D5–D9, P1, P3, P6, Owner Decisions 14/11).
//
// Stage and status are NEUTRAL, DERIVED codes computed per tracked item from
// facts already recorded in the journal — realisation, spec status, open
// blockers, acceptance, linked pending dossiers, explicit delivery links,
// reopenings. JSON carries codes, never localised words, as identity.

import { acceptanceStatus } from '../accept/status.js'
import type { TrackEvent } from '../events/types.js'
import {
  assertItemReportStatus,
  EVIDENCE_REQUIRED_STAGES,
  normalizeReportStage,
  normalizeStoredReport,
  type ItemReportStatus,
  type ReportStage,
  type ReportStatus,
} from '../model/report-status.js'
import { isSettled, isStructuredDossier } from '../model/decision.js'
import type { ItemState, Link } from '../model/item.js'
import type { State } from '../state/fold.js'
import { effectiveOpenBlockersForItem } from './blocker-status.js'

/** Neutral stage codes (12 ordered workflow stages). */
export type StageCode = ReportStage
/** Neutral status codes (8 owner-validated statuses). */
export type StatusCode = ReportStatus

/**
 * Health emoji by status code (Owner Decisions 14/11):
 * - `withdrawn`: ⚫
 * - `blocked`: 🔴
 * - `unforeseen`: 🟠
 * - `waiting`: 🟡
 * - `done`: ✅
 * - `on-track`: 🔵
 * - `not-started`: ⚪
 * - `not-qualified`: undefined (`— sans témoin` in the rendered cell)
 */
export const STATUS_HEALTH: Record<StatusCode, string | undefined> = {
  withdrawn: '⚫',
  blocked: '🔴',
  unforeseen: '🟠',
  waiting: '🟡',
  done: '✅',
  'on-track': '🔵',
  'not-started': '⚪',
  'not-qualified': undefined,
}

/** Ordered rank of the 12 report stages. */
export const STAGE_RANK: Record<StageCode, number> = {
  brainstorm: 0,
  spec: 1,
  plan: 2,
  dev: 3,
  test: 4,
  pr: 5,
  review: 6,
  merged: 7,
  published: 8,
  preprod: 9,
  prod: 10,
  done: 11,
}

function isProdLocator(locator: string): boolean {
  const trimmed = locator.trim()
  if (!/^prod:/iu.test(trimmed)) return false
  return !/(?:-rc[.\d]*|\brc\d*\b|staging|preprod|canary)/iu.test(trimmed)
}

/**
 * Explicit recorded delivery-link kinds that prove a stage (D5).
 * An old `deployed` link with no environment (or a non-`prod:` locator) maps to `preprod`.
 */
function resolveSingleLinkStage(link: Link): StageCode | undefined {
  switch (link.kind) {
    case 'brainstorm':
    case 'benchmark':
    case 'spike':
      return 'brainstorm'
    case 'spec':
    case 'spec-exempt':
      return 'spec'
    case 'plan':
      return 'plan'
    case 'dev-branch':
    case 'commit':
      return 'dev'
    case 'test-run':
    case 'ci-run':
      return 'test'
    case 'pr-open':
      return 'pr'
    case 'pr-review':
    case 'review':
      return 'review'
    case 'pr-merged':
      return 'merged'
    case 'published':
    case 'release':
      return 'published'
    case 'deployed-preprod':
      return 'preprod'
    case 'deployed-prod':
      return isProdLocator(link.locator) ? 'prod' : undefined
    case 'deployed':
      return isProdLocator(link.locator) ? 'prod' : 'preprod'
    default:
      return undefined
  }
}

export interface ItemStageStatus {
  stage: StageCode
  /** Recorded evidence locator for the stage; absent unless the stage was proven. */
  stageEvidence?: string
  /** Stage proven strictly by a recorded link in `item.links` (absent when no link proves a stage). */
  linkedStage?: StageCode
  /** Evidence locator from the recorded link in `item.links`. */
  linkedStageEvidence?: string
  /** True when a reopening voided a previously derived or stored high stage. */
  stageVoidedByReopening: boolean
  status: StatusCode
  /** True when the item is paused by a recorded owner decision (`pausedByOwner` + `pauseDecisionId`). */
  pausedByOwner?: boolean
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
    const report = normalizeStoredReport(event.payload)
    try {
      assertItemReportStatus(report, 'read')
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

/** Links recorded strictly after `lastReopen` (or all item links when never reopened). */
function postReopenLinks(
  item: ItemState,
  events: readonly TrackEvent[],
  lastReopen: number,
): readonly Link[] {
  if (lastReopen < 0) {
    return item.links ?? []
  }
  const links: Link[] = []
  events.forEach((event, index) => {
    if (index <= lastReopen) return
    if (event.type !== 'item.link-added' || event.aggregateId !== item.id) return
    const link = (event.payload as { link?: Link }).link
    if (link !== undefined) {
      links.push(link)
    }
  })
  return links
}

/** The highest-ranked explicit delivery link with a non-blank locator from `links`, if any. */
function linkDerivedStage(
  links: readonly Link[],
  realization: ItemState['realization'],
): { value: StageCode; evidence: string } | undefined {
  const rawLinks = links.filter((link) => nonEmpty(link.locator))
  const resolved: { value: StageCode; evidence: string }[] = []
  let hasProdProof = false
  for (const link of rawLinks) {
    const stage = resolveSingleLinkStage(link)
    if (stage !== undefined) {
      resolved.push({ value: stage, evidence: link.locator })
      if (stage === 'prod') hasProdProof = true
    }
  }
  // `done` requires production proof + acceptance/owner sign-off link + realization === 'done'
  if (realization === 'done' && hasProdProof) {
    const acceptedLink = rawLinks.find(
      (link) =>
        (link.kind === 'prod-accepted' || link.kind === 'uat-accepted') &&
        !/(?:-rc[.\d]*|\brc\d*\b|staging|preprod|canary)/iu.test(link.locator.trim()),
    )
    if (acceptedLink !== undefined) {
      resolved.push({ value: 'done', evidence: acceptedLink.locator })
    }
  }
  resolved.sort((a, b) => STAGE_RANK[b.value] - STAGE_RANK[a.value])
  return resolved[0]
}

function defaultStage(item: ItemState): StageCode {
  return item.realization === 'in-progress' || item.realization === 'done' ? 'dev' : 'spec'
}

function requiresStageEvidence(stage: StageCode): boolean {
  return (EVIDENCE_REQUIRED_STAGES as readonly string[]).includes(stage)
}

export function deriveItemStageStatus(
  state: State,
  events: readonly TrackEvent[],
  item: ItemState,
  baselineCommit: string,
): ItemStageStatus {
  const lastReopen = lastReopeningIndex(events, item.id)
  const reopened = lastReopen >= 0

  // A stored report is VOID after a reopening until requalified: only an
  // assertion recorded after the reopening still speaks (P6).
  const stored = lastStoredAssertion(events, item.id)
  const freshStored = stored !== undefined && stored.index > lastReopen ? stored.report : undefined

  // ---- stage (D5) -----------------------------------------------------------
  const storedStageValue =
    freshStored?.stage === undefined
      ? undefined
      : normalizeReportStage(freshStored.stage.value, freshStored.stage.evidence)
  const storedStage =
    storedStageValue === undefined || storedStageValue === 'prod' || storedStageValue === 'done'
      ? undefined
      : { value: storedStageValue, evidence: freshStored!.stage!.evidence }
  const validStoredStage =
    storedStage !== undefined &&
    (!requiresStageEvidence(storedStage.value) || nonEmpty(storedStage.evidence))
      ? {
          value: storedStage.value,
          ...(nonEmpty(storedStage.evidence) ? { evidence: storedStage.evidence.trim() } : {}),
        }
      : undefined
  const allLinked = linkDerivedStage(item.links ?? [], item.realization)
  const validLinked = linkDerivedStage(postReopenLinks(item, events, lastReopen), item.realization)
  let stage: StageCode
  let stageEvidence: string | undefined
  let stageVoidedByReopening = false
  if (
    validLinked !== undefined &&
    (validStoredStage === undefined || STAGE_RANK[validLinked.value] >= STAGE_RANK[validStoredStage.value])
  ) {
    stage = validLinked.value
    stageEvidence = validLinked.evidence
  } else if (validStoredStage !== undefined) {
    stage = validStoredStage.value
    stageEvidence = validStoredStage.evidence
  } else if (allLinked === undefined) {
    stage =
      storedStage !== undefined && !requiresStageEvidence(storedStage.value)
        ? storedStage.value
        : defaultStage(item)
  } else if (freshStored !== undefined) {
    stage = 'dev'
  } else {
    stage = 'dev'
    stageVoidedByReopening = true
  }

  // Owner pause requires `pausedByOwner: true` backed by a recorded owner decision (`pauseDecisionId`)
  const pauseDecision =
    freshStored?.pausedByOwner === true && nonEmpty(freshStored.pauseDecisionId)
      ? state.decisions.get(freshStored.pauseDecisionId)
      : undefined
  const ownerPaused =
    pauseDecision !== undefined &&
    (pauseDecision.outcome === 'go' || pauseDecision.outcome === 'deferred')

  // ---- gates, dossiers, acceptance ------------------------------------------
  const blockers = effectiveOpenBlockersForItem(state, item.id, baselineCommit)
  const nonDecisionBlockers = blockers.filter((blocker) => blocker.kind !== 'decision')
  const decisionBlockers = blockers.filter((blocker) => {
    if (blocker.kind !== 'decision') return false
    if (ownerPaused && pauseDecision !== undefined && (blocker.ref === undefined || blocker.ref === pauseDecision.id)) {
      return false
    }
    return true
  })
  const plannedWaitBlockers = nonDecisionBlockers.filter(
    (blocker) => nonEmpty((blocker as { scheduledUntil?: string }).scheduledUntil),
  )
  const hardBlockers = nonDecisionBlockers.filter(
    (blocker) => !nonEmpty((blocker as { scheduledUntil?: string }).scheduledUntil),
  )
  const acceptance = acceptanceStatus(state, item.id, baselineCommit)

  const linkedDecisions = [...state.decisions.values()].filter((decision) => decision.targets.includes(item.id))
  const blueDossiers = linkedDecisions.filter(
    (decision) =>
      !isSettled(decision.outcome) &&
      !(ownerPaused && pauseDecision !== undefined && decision.id === pauseDecision.id) &&
      isStructuredDossier(decision.dossier),
  )
  const effectiveBlue = decisionBlockers.length > 0
    ? blueDossiers.filter((decision) =>
      decisionBlockers.some((blocker) => blocker.ref === undefined || blocker.ref === decision.id),
    )
    : []
  const unanswerableDecisionGate = decisionBlockers.length > 0 && effectiveBlue.length === 0

  // ---- qualification witnesses (D6, P6) --------------------------------------
  const criteria = [...state.criteria.values()].filter((criterion) => criterion.itemId === item.id)
  const latestRunIndexes = new Map<string, number>()
  events.forEach((event, index) => {
    if (event.type === 'acceptance.run') {
      latestRunIndexes.set((event.payload as { evidenceId: string }).evidenceId, index)
    }
  })
  const acceptanceWitness =
    acceptance === 'pass' &&
    criteria.every((criterion) => {
      const runs = [...state.evidence.values()]
        .filter((entry) => entry.criterionId === criterion.id)
        .map((entry) => entry.latestRun)
      if (criterion.waiver !== undefined) return true
      return runs.length > 0 && runs.every((run) =>
        run !== undefined && run.result === 'pass' && (latestRunIndexes.get(run.evidenceId) ?? -1) > lastReopen,
      )
    })
  const storedWitness =
    freshStored?.status === 'on-track' && nonEmpty(freshStored.facts)
  const qualified = acceptanceWitness || storedWitness === true

  // An unforeseen fact (D6): an unresolved recorded reopening/regression or a stale acceptance.
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

  // ---- D6 precedence (8 statuses): first matching row wins -------------------
  let status: StatusCode
  if (
    item.realization === 'cancelled' ||
    item.realization === 'rejected'
  ) {
    status = 'withdrawn'
  } else if (
    hardBlockers.length > 0 ||
    acceptance === 'fail' ||
    effectiveBlue.length > 0
  ) {
    status = 'blocked'
  } else if (ownerPaused) {
    status = 'not-started'
  } else if (unforeseenFact) {
    status = 'unforeseen'
  } else if (plannedWaitBlockers.length > 0) {
    status = 'waiting'
  } else if (
    stage === 'done' &&
    validLinked?.value === 'done' &&
    item.realization === 'done' &&
    blockers.length === 0 &&
    acceptanceWitness &&
    nonEmpty(stageEvidence)
  ) {
    status = 'done'
  } else if (
    stage !== 'done' &&
    blockers.length === 0 &&
    qualified &&
    (item.realization === 'in-progress' || (item.realization === 'done' && acceptanceWitness))
  ) {
    status = 'on-track'
  } else if (item.realization === 'to-do' && !reopened && !unanswerableDecisionGate) {
    status = 'not-started'
  } else {
    status = 'not-qualified'
  }

  return {
    stage,
    ...(stageEvidence !== undefined ? { stageEvidence } : {}),
    ...(validLinked !== undefined
      ? { linkedStage: validLinked.value, linkedStageEvidence: validLinked.evidence }
      : {}),
    stageVoidedByReopening,
    status,
    ...(ownerPaused ? { pausedByOwner: true } : {}),
    blueDossierIds: effectiveBlue.map((decision) => decision.id),
    unanswerableDecisionGate,
    qualified,
  }
}
