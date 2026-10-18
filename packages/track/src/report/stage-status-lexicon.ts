// Stage/status lexicon (amendment D10) — the per-language labels for the new
// surface, mirroring the `friendly.ts` code/lexicon separation.
//
// Codes are the identity (D2) and are carried by JSON; human labels come from
// here, keyed by an OPEN `--lang <bcp47>` parameter — never a closed language
// enum, never a silent French fallback: an unknown language renders the codes
// themselves. Scope limit (D10): this amendment makes the new stage/status
// surface language-neutral; full localisation of the existing French
// deterministic renderer (`format.ts`, `friendly.ts`) is a separate WP.
import type { ReportStage } from '../model/report-status.js'
import type { StatusCode } from './stage-status.js'

/** Human labels for the stage/status codes in one language. */
export interface StageStatusLabels {
  stage: Record<ReportStage, string>
  status: Record<StatusCode, string>
}

const FR: StageStatusLabels = {
  // French keeps the neutral stage tokens (no invented French stage words);
  // statuses are plain French words.
  stage: { spec: 'spec', dev: 'dev', pr: 'pr', merged: 'merged', deployed: 'deployed' },
  status: {
    progressing: 'en progression',
    unforeseen: 'imprévu',
    blocked: 'bloqué',
    'decision-awaited': 'décision attendue',
    'not-qualified': 'non qualifié',
    withdrawn: 'retiré',
  },
}

const EN: StageStatusLabels = {
  stage: { spec: 'spec', dev: 'dev', pr: 'pr', merged: 'merged', deployed: 'deployed' },
  status: {
    progressing: 'progressing',
    unforeseen: 'unforeseen',
    blocked: 'blocked',
    'decision-awaited': 'awaiting decision',
    'not-qualified': 'not qualified',
    withdrawn: 'withdrawn',
  },
}

const ES: StageStatusLabels = {
  stage: { spec: 'spec', dev: 'dev', pr: 'pr', merged: 'merged', deployed: 'deployed' },
  status: {
    progressing: 'en progreso',
    unforeseen: 'imprevisto',
    blocked: 'bloqueado',
    'decision-awaited': 'decisión pendiente',
    'not-qualified': 'no calificado',
    withdrawn: 'retirado',
  },
}

const JA: StageStatusLabels = {
  stage: { spec: 'spec', dev: 'dev', pr: 'pr', merged: 'merged', deployed: 'deployed' },
  status: {
    progressing: '進行中',
    unforeseen: '想定外',
    blocked: 'ブロック中',
    'decision-awaited': '意思決定待ち',
    'not-qualified': '未評価',
    withdrawn: '取下げ',
  },
}

const AR: StageStatusLabels = {
  stage: { spec: 'spec', dev: 'dev', pr: 'pr', merged: 'merged', deployed: 'deployed' },
  status: {
    progressing: 'قيد التقدم',
    unforeseen: 'غير متوقع',
    blocked: 'محظور',
    'decision-awaited': 'بانتظار القرار',
    'not-qualified': 'غير مؤهل',
    withdrawn: 'مسحوب',
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
  stage: { spec: 'spec', dev: 'dev', pr: 'pr', merged: 'merged', deployed: 'deployed' },
  status: {
    progressing: 'progressing',
    unforeseen: 'unforeseen',
    blocked: 'blocked',
    'decision-awaited': 'decision-awaited',
    'not-qualified': 'not-qualified',
    withdrawn: 'withdrawn',
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
