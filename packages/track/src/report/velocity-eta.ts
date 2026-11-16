// Binding to the velocity estimator of branch `feat/velocity-estimator` (#376)
// and deterministic ETA deadline / slip evaluation for `track report --owner-table`.
//
// An ETA bound to the velocity estimator is labelled `mesuré` (`source: 'measured'`)
// ONLY when all of its inputs are qualified:
//   1. `forecast.support === 'descriptive'` with a finite positive `p80Seconds`
//      and no lookahead violation (`evidenceCutoff <= predictedAt`, `referencePublishedAt <= predictedAt`);
//   2. `plan` has zero `openGates`, no `blockedReason`, and positive `capacities`;
//   3. `knowledge.applicability === 'applicable'` (and matching `lockedDigest`/`currentDigest` when supplied);
//   4. For `preprod`, `prod`, or `done` target stages, `installReceipts` are present and all `verdict === 'held'`.
// Whenever any input is missing or unqualified, the ETA degrades fail-closed to
// `inconnu` (`source: 'unknown'`, `when: '—'`).

import type {
  MeasuredVelocityProvenance,
  ReportEtaEntry,
  ReportEtaSource,
  ReportStage,
} from '../model/report-status.js'
import { STAGE_RANK } from './stage-status.js'

/** Quantile distribution from `packages/agent-stats/src/velocity/types.ts` (#376). */
export interface VelocityForecastQuantiles {
  p50Seconds: number | null
  p80Seconds: number | null
  p95Seconds: number | null
}

/** Forecast output shape from `packages/agent-stats/src/velocity/types.ts` (#376). */
export interface VelocityForecastInput {
  quantiles: VelocityForecastQuantiles
  predictedAt: string
  evidenceCutoff: string
  support: 'descriptive' | 'insufficient-evidence'
  referencePublishedAt?: string
  sampleCount?: number
}

/** Plan & gate qualification shape from `packages/agent-stats/src/velocity/plan-input.ts` (#376). */
export interface VelocityPlanQualificationInput {
  openGates?: readonly string[]
  blockedReason?: string
  capacities?: Readonly<Record<string, number>>
}

/** Knowledge lock applicability shape from `packages/agent-stats/src/velocity/knowledge.ts` (#376). */
export interface VelocityKnowledgeQualificationInput {
  applicability: 'applicable' | 'conditional-historical' | 'incomplete'
  historyPreserved?: boolean
  boundsNewRegime?: boolean
  lockedDigest?: string
  currentDigest?: string
}

/** Target installation receipt shape from `packages/agent-stats/src/velocity/install.ts` (#376). */
export interface VelocityInstallQualificationInput {
  installedAt: string
  verdict: 'held' | 'missed' | 'unknown'
  reason?: string
  mergeToInstalledSeconds: number | null
}

export interface VelocityEtaBindingInput {
  targetStage: ReportStage
  targetLabel?: string
  forecast?: VelocityForecastInput
  plan?: VelocityPlanQualificationInput
  knowledge?: VelocityKnowledgeQualificationInput
  /** Required when `targetStage` is `'preprod'`, `'prod'`, or `'done'`. */
  installReceipts?: readonly VelocityInstallQualificationInput[]
  slip?: { initialWhen: string; reason?: string }
}

export interface VelocityEtaQualificationResult {
  qualified: boolean
  source: ReportEtaSource
  sourceLabel: 'mesuré' | 'inconnu'
  unqualifiedReasons: string[]
  eta: ReportEtaEntry
}

const INSTALL_GATED_STAGES: ReadonlySet<ReportStage> = new Set(['preprod', 'prod', 'done'])

function formatUtcIsoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

/**
 * Qualify a velocity-estimator forecast and its supporting plan, knowledge lock,
 * and installation receipts (#376). Labels the resulting ETA `'measured'` (`mesuré`)
 * ONLY when all inputs are qualified; otherwise degrades to `'unknown'` (`inconnu`).
 */
export function qualifyVelocityEta(input: VelocityEtaBindingInput): VelocityEtaQualificationResult {
  const reasons: string[] = []

  // 0. Stage qualification: brainstorm, spec, and plan are unmeasured by the estimator
  if (STAGE_RANK[input.targetStage] < STAGE_RANK['dev']) {
    reasons.push('unmeasured-early-stage')
  }

  // 1. Forecast qualification
  const forecast = input.forecast
  let predictedMs = Number.NaN
  let p80Seconds: number | null = null
  if (forecast === undefined) {
    reasons.push('missing-forecast')
  } else {
    if (forecast.support !== 'descriptive') {
      reasons.push('forecast-insufficient-evidence')
    }
    p80Seconds = forecast.quantiles?.p80Seconds ?? null
    if (p80Seconds === null || !Number.isFinite(p80Seconds) || p80Seconds <= 0) {
      reasons.push('forecast-missing-p80')
    }
    if (
      typeof forecast.sampleCount !== 'number' ||
      !Number.isInteger(forecast.sampleCount) ||
      forecast.sampleCount <= 0
    ) {
      reasons.push('forecast-zero-samples')
    }
    predictedMs = Date.parse(forecast.predictedAt)
    const cutoffMs = Date.parse(forecast.evidenceCutoff)
    if (Number.isNaN(predictedMs) || Number.isNaN(cutoffMs)) {
      reasons.push('forecast-invalid-timestamps')
    } else if (cutoffMs > predictedMs) {
      reasons.push('forecast-lookahead-cutoff')
    }
    if (forecast.referencePublishedAt !== undefined) {
      const refMs = Date.parse(forecast.referencePublishedAt)
      if (Number.isNaN(refMs) || (!Number.isNaN(predictedMs) && refMs > predictedMs)) {
        reasons.push('forecast-late-reference')
      }
    }
  }

  // 2. Plan & gate qualification
  const plan = input.plan
  if (plan === undefined) {
    reasons.push('missing-plan')
  } else {
    if ((plan.openGates ?? []).length > 0) {
      reasons.push('plan-open-gates')
    }
    if (plan.blockedReason !== undefined && plan.blockedReason.trim() !== '') {
      reasons.push('plan-blocked')
    }
    const capEntries = Object.values(plan.capacities ?? {})
    if (capEntries.length === 0 || !capEntries.every((c) => typeof c === 'number' && Number.isFinite(c) && c > 0)) {
      reasons.push('plan-unqualified-capacities')
    }
  }

  // 3. Knowledge lock qualification
  const knowledge = input.knowledge
  if (knowledge === undefined) {
    reasons.push('missing-knowledge-lock')
  } else {
    if (knowledge.applicability !== 'applicable') {
      reasons.push(`knowledge-${knowledge.applicability}`)
    }
    if (
      typeof knowledge.lockedDigest !== 'string' ||
      knowledge.lockedDigest.trim() === '' ||
      typeof knowledge.currentDigest !== 'string' ||
      knowledge.currentDigest.trim() === ''
    ) {
      reasons.push('knowledge-missing-digests')
    } else if (knowledge.lockedDigest.trim() !== knowledge.currentDigest.trim()) {
      reasons.push('knowledge-digest-mismatch')
    }
  }

  // 4. Target installation receipt qualification for preprod / prod / done
  if (INSTALL_GATED_STAGES.has(input.targetStage)) {
    const receipts = input.installReceipts
    if (receipts === undefined || receipts.length === 0) {
      reasons.push('missing-install-receipts')
    } else {
      const allHeld = receipts.every(
        (r) =>
          r.verdict === 'held' &&
          typeof r.installedAt === 'string' &&
          r.installedAt.trim() !== '' &&
          r.installedAt !== 'unknown',
      )
      if (!allHeld) {
        reasons.push('install-receipt-not-held')
      }
    }
  }

  const qualified = reasons.length === 0
  if (!qualified) {
    return {
      qualified: false,
      source: 'unknown',
      sourceLabel: 'inconnu',
      unqualifiedReasons: reasons,
      eta: {
        targetStage: input.targetStage,
        ...(input.targetLabel !== undefined ? { targetLabel: input.targetLabel } : {}),
        when: '—',
        source: 'unknown',
        ...(input.slip !== undefined ? { slip: input.slip } : {}),
      },
    }
  }

  const computedWhen = formatUtcIsoDate(predictedMs + (p80Seconds as number) * 1000)
  const measured: MeasuredVelocityProvenance = {
    predictedAt: forecast!.predictedAt,
    evidenceCutoff: forecast!.evidenceCutoff,
    p80Seconds: p80Seconds as number,
    sampleCount: forecast!.sampleCount as number,
    support: 'descriptive',
    lockedDigest: knowledge!.lockedDigest!.trim(),
    currentDigest: knowledge!.currentDigest!.trim(),
  }

  return {
    qualified: true,
    source: 'measured',
    sourceLabel: 'mesuré',
    unqualifiedReasons: [],
    eta: {
      targetStage: input.targetStage,
      ...(input.targetLabel !== undefined ? { targetLabel: input.targetLabel } : {}),
      when: computedWhen,
      source: 'measured',
      measured,
      ...(input.slip !== undefined ? { slip: input.slip } : {}),
    },
  }
}

/**
 * Parse an ISO date token (`YYYY-MM-DD`, ISO timestamp, or `DD/MM/YYYY`) to end-of-day UTC ms.
 * Returns `undefined` when `when` is `'—'`, yearless, or unparseable.
 */
export function parseEtaEndOfDayMs(when: string, _referenceNowIso?: string): number | undefined {
  const trimmed = when.trim()
  if (trimmed === '' || trimmed === '—' || trimmed === '-') return undefined

  const isoDateMatch = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(trimmed)
  if (isoDateMatch !== null) {
    const year = Number(isoDateMatch[1])
    const month = Number(isoDateMatch[2])
    const day = Number(isoDateMatch[3])
    return Date.UTC(year, month - 1, day, 23, 59, 59, 999)
  }

  const ddMmYyyyMatch = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/u.exec(trimmed)
  if (ddMmYyyyMatch !== null) {
    const day = Number(ddMmYyyyMatch[1])
    const month = Number(ddMmYyyyMatch[2])
    const year = Number(ddMmYyyyMatch[3])
    return Date.UTC(year, month - 1, day, 23, 59, 59, 999)
  }

  if (/^\d{1,2}\/\d{1,2}$/u.test(trimmed)) {
    return undefined
  }

  const parsed = Date.parse(trimmed)
  return Number.isNaN(parsed) ? undefined : parsed
}

/**
 * Evaluate whether an ETA is missed at `options.now` (or the current clock when omitted)
 * or already carries a recorded slip, while `currentStage` is strictly below `eta.targetStage`.
 * Owner pause (`pausedByOwner === true`) freezes missed-ETA evaluation.
 */
export function evaluateEtaDeadline(
  eta: ReportEtaEntry,
  currentStage: ReportStage | undefined,
  options: { now?: string; pausedByOwner?: boolean } = {},
): { eta: ReportEtaEntry; missed: boolean } {
  if (options.pausedByOwner === true) {
    return { eta, missed: false }
  }
  if (currentStage !== undefined && STAGE_RANK[currentStage] >= STAGE_RANK[eta.targetStage]) {
    return { eta, missed: false }
  }
  if (eta.slip !== undefined) {
    return { eta, missed: true }
  }
  const nowIso = options.now ?? new Date().toISOString()
  const nowMs = Date.parse(nowIso)
  const deadlineMs = parseEtaEndOfDayMs(eta.when, nowIso)
  if (!Number.isNaN(nowMs) && deadlineMs !== undefined && nowMs > deadlineMs) {
    return {
      eta: {
        ...eta,
        slip: {
          initialWhen: eta.when,
          reason: 'échéance dépassée',
        },
      },
      missed: true,
    }
  }
  return { eta, missed: false }
}
