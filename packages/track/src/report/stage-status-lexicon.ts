// Stage/status lexicon (amendment D10) — the per-language labels for the new
// surface, mirroring the `friendly.ts` code/lexicon separation.
//
// Codes are the identity (D2) and are carried by JSON; human labels come from
// here, keyed by an OPEN `--lang <bcp47>` parameter — never a closed language
// enum, never a silent French fallback: an unknown language renders the codes
// themselves.
import type { ReportStage } from '../model/report-status.js'
import type { StatusCode } from './stage-status.js'

/** Human labels for the stage/status codes in one language. */
export interface StageStatusLabels {
  stage: Record<ReportStage, string>
  status: Record<StatusCode, string>
}

const NEUTRAL_STAGE_LABELS: Record<ReportStage, string> = {
  brainstorm: 'brainstorm',
  spec: 'spec',
  plan: 'plan',
  dev: 'dev',
  test: 'test',
  pr: 'pr',
  review: 'review',
  merged: 'merged',
  published: 'published',
  preprod: 'preprod',
  prod: 'prod',
  done: 'done',
}

const FR: StageStatusLabels = {
  stage: { ...NEUTRAL_STAGE_LABELS },
  status: {
    withdrawn: 'retiré',
    blocked: 'bloqué',
    unforeseen: 'dérive',
    waiting: 'en attente',
    done: 'fait',
    'on-track': 'sur la voie',
    'not-started': 'pas commencé',
    'not-qualified': 'sans témoin',
  },
}

const EN: StageStatusLabels = {
  stage: { ...NEUTRAL_STAGE_LABELS },
  status: {
    withdrawn: 'withdrawn',
    blocked: 'blocked',
    unforeseen: 'drift',
    waiting: 'waiting',
    done: 'done',
    'on-track': 'on track',
    'not-started': 'not started',
    'not-qualified': 'no witness',
  },
}

const ES: StageStatusLabels = {
  stage: { ...NEUTRAL_STAGE_LABELS },
  status: {
    withdrawn: 'retirado',
    blocked: 'bloqueado',
    unforeseen: 'desviación',
    waiting: 'en espera',
    done: 'hecho',
    'on-track': 'encaminado',
    'not-started': 'no iniciado',
    'not-qualified': 'sin testigo',
  },
}

const JA: StageStatusLabels = {
  stage: { ...NEUTRAL_STAGE_LABELS },
  status: {
    withdrawn: '取下げ',
    blocked: 'ブロック中',
    unforeseen: '遅延・逸脱',
    waiting: '待機中',
    done: '完了',
    'on-track': '順調',
    'not-started': '未着手',
    'not-qualified': '証跡なし',
  },
}

const AR: StageStatusLabels = {
  stage: { ...NEUTRAL_STAGE_LABELS },
  status: {
    withdrawn: 'مسحوب',
    blocked: 'محظور',
    unforeseen: 'انحراف',
    waiting: 'قيد الانتظار',
    done: 'منجز',
    'on-track': 'على المسار',
    'not-started': 'لم يبدأ',
    'not-qualified': 'بلا شاهد',
  },
}

/** Shipped languages, keyed by primary BCP47 subtag (lowercase). */
export const STAGE_STATUS_LEXICON: Record<string, StageStatusLabels> = {
  fr: FR,
  en: EN,
  es: ES,
  ja: JA,
  ar: AR,
}

/** Neutral codes used when no language matches — the identity, not a fallback tongue. */
export const CODE_LABELS: StageStatusLabels = {
  stage: { ...NEUTRAL_STAGE_LABELS },
  status: {
    withdrawn: 'withdrawn',
    blocked: 'blocked',
    unforeseen: 'unforeseen',
    waiting: 'waiting',
    done: 'done',
    'on-track': 'on-track',
    'not-started': 'not-started',
    'not-qualified': 'not-qualified',
  },
}

export interface ResolvedStageStatusLabels {
  /** The primary subtag that matched, or the requested tag when nothing matched. */
  lang: string
  matched: boolean
  labels: StageStatusLabels
}

/**
 * Resolve labels for an open BCP47 tag: exact match, then the primary
 * subtag (`es-MX` ⇒ `es`, case-insensitive), else the neutral codes.
 * An unprepared language NEVER falls back to French — it renders codes.
 */
export function resolveStageStatusLabels(lang: string | undefined): ResolvedStageStatusLabels {
  const requested = (lang ?? '').trim().toLowerCase()
  if (requested === '') return { lang: '', matched: false, labels: CODE_LABELS }
  const direct = STAGE_STATUS_LEXICON[requested]
  if (direct !== undefined) return { lang: requested, matched: true, labels: direct }
  const primary = requested.split('-')[0]!
  const fallback = STAGE_STATUS_LEXICON[primary]
  if (fallback !== undefined) return { lang: primary, matched: true, labels: fallback }
  return { lang: requested, matched: false, labels: CODE_LABELS }
}
