import type { CaptureCliMode } from '../capture/registry.js'
import type { JournalResolutionKind } from '../cli/journal-reference.js'

/**
 * Closed table of owner-facing strings (spec annex F).
 * No other file of the qualified reader adds owner-facing literals.
 */

export type MaskMotif =
  | 'empreinte de commit'
  | 'identifiant interne'
  | 'jargon interne'
  | 'terme réservé'

export type FlagMotif =
  | 'cause absente'
  | 'ETA incomplète'
  | 'texte absent'
  | 'moins de deux lots'
  | 'motif de retrait absent'
  | 'étape et statut incohérents'
  | 'décision absente'
  | 'structure'

export type DecisionQualifierLabel = 'hors demande' | 'sans dossier' | 'à instruire' | 'à numéroter'

export const DISPLAY_CUT_CHARS = 160

/** Plural rule (annex F): 0 or 1 takes singular; any other takes plural. */
export function pluralize(count: number, singular: string, plural: string): string {
  return count === 0 || count === 1 ? singular : plural
}

/** Format an ISO UTC date as `JJ/MM`, or `JJ/MM/AAAA` when year differs from rendering clock. */
export function formatUtcDate(iso: string | undefined, nowIso?: string): string {
  if (iso === undefined || iso.trim() === '') return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const dd = String(d.getUTCDate()).padStart(2, '0')
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  const yyyy = d.getUTCFullYear()
  const refDate = nowIso !== undefined ? new Date(nowIso) : new Date()
  const refYear = Number.isNaN(refDate.getTime()) ? yyyy : refDate.getUTCFullYear()
  return yyyy === refYear ? `${dd}/${mm}` : `${dd}/${mm}/${yyyy}`
}

/** Whole UTC days between decision creation and rendering clock (clamped >= 0). */
export function computeAgeDays(createdIso: string | undefined, nowIso?: string): number {
  if (createdIso === undefined || createdIso.trim() === '') return 0
  const createdMs = Date.parse(createdIso)
  const nowMs = nowIso !== undefined ? Date.parse(nowIso) : Date.now()
  if (Number.isNaN(createdMs) || Number.isNaN(nowMs)) return 0
  const diffDays = Math.floor((nowMs - createdMs) / 86_400_000)
  return Math.max(0, diffDays)
}

export function formatAge(days: number): string {
  if (days <= 0) return "moins d'un jour"
  if (days === 1) return '1 jour'
  return `${days} jours`
}

export function formatAgeClause(days: number, deferred: boolean): string {
  const base = `attend depuis ${formatAge(days)}`
  return deferred ? `reportée, ${base}` : base
}

/** Cut a captured text over 160 characters for Markdown/text display (annex F). */
export function cutCapturedDisplayText(text: string): string {
  if (text.length <= DISPLAY_CUT_CHARS) return text
  return `${text.slice(0, DISPLAY_CUT_CHARS)}…`
}

// ---- Header strings ----------------------------------------------------------------------------

export const FALLBACK_JOURNAL_LABEL = 'journal'

export function formatHeaderJournalLine(
  label: string,
  resolution: JournalResolutionKind,
  lastEventDate: string | null,
  writeMode?: { mode: 'open' | 'exclusive'; holder?: string | null },
): string {
  const base =
    lastEventDate === null
      ? `Journal : ${label} · ${resolution} · aucun événement`
      : `Journal : ${label} · ${resolution} · dernier événement ${lastEventDate}`
  if (writeMode === undefined) return base
  return `${base}${formatHeaderWriteModeSuffix(writeMode)}`
}

export function formatHeaderNoJournalActiveCaptureLine(label: string): string {
  return `Journal : aucun · dossier ${label} · créé à la première inscription`
}

export function formatHeaderWriteModeSuffix(writeMode: {
  mode: 'open' | 'exclusive'
  holder?: string | null
}): string {
  if (writeMode.mode === 'exclusive') {
    return ` · rédacteur exclusif : ${writeMode.holder ?? 'inconnu'}`
  }
  return ' · journal ouvert'
}

export function formatCaptureCliState(mode: CaptureCliMode | 'unqualified'): string {
  switch (mode) {
    case 'direct':
      return 'directe'
    case 'deferred':
      return 'différée'
    case 'not-covered':
      return 'non couverte'
    case 'unqualified':
      return 'non qualifiée'
  }
}

export function formatHeaderCaptureLine(
  clis: readonly { cli: string; mode: CaptureCliMode | 'unqualified' }[],
): string {
  if (clis.length === 0) return 'Captation : aucune CLI recensée'
  return `Captation : ${clis.map((c) => `${c.cli} ${formatCaptureCliState(c.mode)}`).join(' · ')}`
}

export function formatHeaderMotifsLine(motifs: readonly string[]): string {
  return `Périmètre partiel : ${motifs.join(' · ')}`
}

export function formatHeaderLocalCopyLine(count: number): string {
  const evWord = pluralize(count, 'événement absent', 'événements absents')
  return `Copie locale : ${count} ${evWord} du journal de référence`
}

// ---- Scope & gap motifs (exact annex F order 1..19) --------------------------------------------

export const MOTIF_UNASSIGNED_JOURNAL = 'journal de référence non désigné'
export const MOTIF_CAPTURE_INACTIVE = 'captation inactive'
export const MOTIF_CAPTURE_PARTIAL = 'captation partielle'
export const MOTIF_FREE_TEXT_QUESTIONS = 'questions en texte libre non suivies'
export const MOTIF_POLICY_ABSENT = 'politique de termes privés absente'
export const MOTIF_ZERO_DEMANDS = '0 demande enregistrée'

export function formatMotifUnclassified(count: number): string {
  return `${count} ${pluralize(count, 'message non classé', 'messages non classés')}`
}

export function formatMotifExpiredUnclassified(count: number): string {
  return `${count} ${pluralize(count, 'expiré non classé', 'expirés non classés')}`
}

export function formatMotifCapturedNotInscribed(count: number): string {
  return `${count} ${pluralize(count, 'capté non inscrit', 'captés non inscrits')}`
}

export function formatMotifAllArchived(archivedCount: number): string {
  return `0 demande active, ${archivedCount} ${pluralize(archivedCount, 'archivée', 'archivées')}`
}

export function formatMotifToAttach(count: number): string {
  return `${count} ${pluralize(count, 'demande', 'demandes')} à rattacher`
}

export function formatMotifRowsToComplete(count: number): string {
  return `${count} ${pluralize(count, 'ligne', 'lignes')} à compléter`
}

export function formatMotifDecisionsToComplete(count: number): string {
  return `${count} ${pluralize(count, 'décision', 'décisions')} à compléter`
}

export function formatMotifDecisionsPending(count: number): string {
  return `${count} ${pluralize(count, 'décision', 'décisions')} en attente`
}

export function formatMotifOwnerGates(count: number): string {
  return `${count} OWNER GATE ${pluralize(count, 'ouverte', 'ouvertes')}`
}

export function formatMotifOpenQuestions(count: number): string {
  return `${count} ${pluralize(count, 'question', 'questions')} de dossier sans réponse`
}

export function formatMotifMaskedCells(count: number): string {
  return `${count} ${pluralize(count, 'cellule masquée', 'cellules masquées')}`
}

export function formatMotifDesyncDocs(count: number): string {
  return `${count} ${pluralize(count, 'document désynchronisé', 'documents désynchronisés')}`
}

export function formatMotifUnverifiedDocs(count: number): string {
  return `${count} ${pluralize(count, 'document non vérifié', 'documents non vérifiés')}`
}

// ---- Sections & lines --------------------------------------------------------------------------

export function formatPartialScopeNoDecisionsSentence(scopeMotifs: readonly string[]): string {
  return `Aucune décision enregistrée au journal (périmètre partiel : ${scopeMotifs.join(' · ')}).`
}

export function formatToAttachHeading(count: number): string {
  const noun = pluralize(count, 'demande connue', 'demandes connues')
  return `À rattacher — ${count} ${noun}, sans numéro`
}

export function formatToAttachLine(params: {
  date: string
  text: string
  captured: boolean
  captureOrigin?: string | undefined
  maskMotif?: MaskMotif | undefined
}): string {
  if (params.maskMotif !== undefined) {
    return `- ${params.date} · ${formatMaskText(params.maskMotif)}`
  }
  if (params.captured) {
    const cut = cutCapturedDisplayText(params.text)
    if (params.captureOrigin === 'owner') {
      return `- ${params.date} · capté · « ${cut} »`
    }
    return `- ${params.date} · capté · ${cut} (capté, origine non prouvée)`
  }
  return `- ${params.date} · non capté · ${params.text}`
}

export function formatCapturedWaitingHeading(count: number): string {
  return `Captées, pas encore inscrites — ${count}`
}

export function formatCapturedWaitingClass(params: {
  classKind: 'new-demand' | 'follow-up' | 'decision-answer'
  demandNumber?: number | undefined
  decisionRef?: string | undefined
}): string {
  if (params.classKind === 'new-demand') return 'nouvelle demande'
  if (params.classKind === 'follow-up') return `suite de #${params.demandNumber ?? '?'}`
  return `réponse à ${params.decisionRef ?? 'D?'}`
}

export function formatCapturedWaitingLine(params: {
  date: string
  classKind: 'new-demand' | 'follow-up' | 'decision-answer'
  title: string
  demandNumber?: number | undefined
  decisionRef?: string | undefined
}): string {
  return `- ${params.date} · ${formatCapturedWaitingClass(params)} · ${params.title}`
}

export const DECISIONS_HEADING_EMPTY = "Décisions qui t'attendent"

export function formatDecisionsHeading(counts: {
  total: number
  outsideDemand: number
  withoutDossier: number
  toInstruct: number
  toNumber?: number
  openQuestionCount: number
  decisionsWithOpenQuestions: number
}): string {
  if (counts.total === 0) return DECISIONS_HEADING_EMPTY
  const parts: string[] = []
  if (counts.outsideDemand > 0) parts.push(`${counts.outsideDemand} hors demande`)
  if (counts.withoutDossier > 0) parts.push(`${counts.withoutDossier} sans dossier`)
  if (counts.toInstruct > 0) parts.push(`${counts.toInstruct} à instruire`)
  if ((counts.toNumber ?? 0) > 0) parts.push(`${counts.toNumber} à numéroter`)

  let heading = `Décisions qui t'attendent — ${counts.total}`
  if (parts.length > 0) {
    heading += ` (${parts.join(', ')})`
  }
  if (counts.openQuestionCount > 0) {
    const qWord = pluralize(counts.openQuestionCount, 'question', 'questions')
    const dWord = pluralize(counts.decisionsWithOpenQuestions, 'décision', 'décisions')
    heading += ` · ${counts.openQuestionCount} ${qWord} de dossier sans réponse (${counts.decisionsWithOpenQuestions} ${dWord})`
  }
  return heading
}

export const OWNER_GATE_UNNAMED_SESSION =
  "à répondre dans la session requise (non nommée dans l'enregistrement)"

export function formatOwnerGateLine(session: string | null, ageDays: number, deferred: boolean): string {
  const sessionClause =
    session !== null && session.trim() !== ''
      ? `à répondre dans la session ${session.trim()}`
      : OWNER_GATE_UNNAMED_SESSION
  return `- OWNER GATE · ${sessionClause} · ${formatAgeClause(ageDays, deferred)}`
}

export const DOSSIER_ABSENT = 'Dossier : absent'
export const NO_OPTIONS_RECORDED = "pas d'options enregistrées"

export function formatDossierSegment(dossierLink: string | undefined): string {
  if (dossierLink === undefined || dossierLink.trim() === '') return DOSSIER_ABSENT
  return `Dossier : ${dossierLink.trim()}`
}

export function formatDecisionSummaryLine(params: {
  ref: string | null
  qualifiers: readonly DecisionQualifierLabel[]
  ageDays: number
  deferred: boolean
  subject: string
  dossierLink?: string | undefined
  sansObjet?: boolean | undefined
  isToInstruct: boolean
}): string {
  const segments: string[] = []
  if (params.ref !== null && params.ref !== '') {
    segments.push(params.sansObjet === true ? `${params.ref} (décision sans objet)` : params.ref)
  }
  for (const q of params.qualifiers) {
    // When ref is absent on E5, `à instruire` sits first; `sans dossier` is expressed by `Dossier : absent`
    if (q === 'sans dossier') continue
    segments.push(q)
  }
  segments.push(formatAgeClause(params.ageDays, params.deferred))
  segments.push(params.subject)
  if (params.isToInstruct) {
    if (params.dossierLink !== undefined && params.dossierLink.trim() !== '') {
      segments.push(formatDossierSegment(params.dossierLink))
    } else if (params.qualifiers.includes('sans dossier')) {
      segments.push(DOSSIER_ABSENT)
    }
    segments.push(NO_OPTIONS_RECORDED)
  } else {
    segments.push(formatDossierSegment(params.dossierLink))
  }
  return `- ${segments.join(' · ')}`
}

// ---- Cells, masks, flags, strict diagnostic labels ---------------------------------------------

export const TOKEN_OWNER_GATE = 'OWNER GATE'
export const TOKEN_TO_INSTRUCT = 'à instruire'
export const TOKEN_TO_NUMBER = 'à numéroter'

export function formatDecisionCellToken(params: {
  kind: 'decision' | 'owner-gate'
  ref: string | null
  isToInstruct: boolean
  isToNumber?: boolean
  blocking: boolean
  sansObjet: boolean
}): string {
  if (params.kind === 'owner-gate') {
    return params.sansObjet ? `${TOKEN_OWNER_GATE} (décision sans objet)` : TOKEN_OWNER_GATE
  }
  if (params.isToInstruct) {
    return params.sansObjet ? `${TOKEN_TO_INSTRUCT} (décision sans objet)` : TOKEN_TO_INSTRUCT
  }
  if (params.isToNumber || params.ref === null || params.ref === '') {
    return params.sansObjet ? `${TOKEN_TO_NUMBER} (décision sans objet)` : TOKEN_TO_NUMBER
  }
  if (params.sansObjet) return `${params.ref} (décision sans objet)`
  return params.blocking ? `🚩 ${params.ref} bloquante` : params.ref
}

export function formatBlockingDecisionTodoCause(params: {
  kind: 'decision' | 'owner-gate'
  ref: string | null
  isToInstruct: boolean
  isToNumber?: boolean
  session?: string | null | undefined
}): string {
  if (params.kind === 'owner-gate') {
    if (params.session !== undefined && params.session !== null && params.session.trim() !== '') {
      return `bloqué par OWNER GATE (session ${params.session.trim()})`
    }
    return 'bloqué par OWNER GATE (session requise non nommée)'
  }
  if (params.isToInstruct) {
    return 'bloqué par décision à instruire (owner)'
  }
  if (params.isToNumber || params.ref === null || params.ref === '') {
    return 'bloqué par décision à numéroter (owner)'
  }
  return `bloqué par ${params.ref} (owner)`
}

export function formatStrictEmptyRefLabel(kind: 'decision' | 'owner-gate', isToNumber = false): string {
  if (kind === 'owner-gate') return TOKEN_OWNER_GATE
  return isToNumber ? 'décision à numéroter' : 'décision à instruire'
}

export function formatReplyLine(entries: readonly { ref: string; letter: string }[]): string | null {
  if (entries.length === 0) return null
  return `Réponse : ${entries.map((e) => `${e.ref} ${e.letter}`).join(' · ')}`
}

export function formatRequestCellNotCaptured(text: string): string {
  if (text.trim() === '' || text.trim() === '—') return '—'
  return `${text} (non capté)`
}

export function formatRequestCellWithOriginLabel(originLabel: string, requestCell: string): string {
  return `[${originLabel}] ${requestCell}`
}

export const MASKED_AT_INSCRIPTION_LABEL = 'masqué'

export function formatRequestCellCapturedOwner(
  text: string,
  title?: string,
  opts?: { maskedAtInscription?: boolean; titleMask?: MaskMotif; textMask?: MaskMotif },
): string {
  const titlePart =
    title !== undefined && title.trim() !== ''
      ? opts?.titleMask !== undefined
        ? formatMaskText(opts.titleMask)
        : title.trim()
      : undefined
  const textPart =
    opts?.textMask !== undefined
      ? formatMaskText(opts.textMask)
      : `« ${cutCapturedDisplayText(text)} »`
  const base = titlePart !== undefined ? `${titlePart} — ${textPart}` : textPart
  return opts?.maskedAtInscription === true ? `${base} (${MASKED_AT_INSCRIPTION_LABEL})` : base
}

export function formatRequestCellCapturedDoubtful(
  text: string,
  title?: string,
  opts?: { maskedAtInscription?: boolean; titleMask?: MaskMotif; textMask?: MaskMotif },
): string {
  const titlePart =
    title !== undefined && title.trim() !== ''
      ? opts?.titleMask !== undefined
        ? formatMaskText(opts.titleMask)
        : title.trim()
      : undefined
  const textPart =
    opts?.textMask !== undefined
      ? formatMaskText(opts.textMask)
      : cutCapturedDisplayText(text)
  const suffix =
    opts?.maskedAtInscription === true
      ? `(capté, origine non prouvée, ${MASKED_AT_INSCRIPTION_LABEL})`
      : '(capté, origine non prouvée)'
  const base = titlePart !== undefined ? `${titlePart} — ${textPart}` : textPart
  return `${base} ${suffix}`
}

export function formatMaskText(motif: MaskMotif): string {
  return `texte masqué (${motif}), à réécrire`
}

export function formatFlagSuffix(motif: FlagMotif): string {
  return ` ⚠ ${motif}`
}
