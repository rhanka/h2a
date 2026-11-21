import type { CaptureCliStatusView, CaptureReaderView } from '../capture/reader.js'
import type { DesyncFinding } from '../cli/desync.js'
import type { JournalResolutionKind } from '../cli/journal-reference.js'
import { DomainError } from '../model/item.js'
import { cleanDisplayText, type Format } from './format.js'
import {
  auditOwnerTable,
  formatOwnerDecisionCell,
  formatOwnerEtaCell,
  formatOwnerStageCell,
  formatOwnerStatusCell,
  hasTextGateViolation,
  OWNER_TABLE_HEADERS,
  type AuditOwnerTableOptions,
  type OwnerTableCell,
  type OwnerTableDecisionKind,
  type OwnerTableDecisionOption,
  type OwnerTableGateCheck,
  type OwnerTableGateViolation,
  type OwnerTableRow,
  type OwnerTableView,
} from './owner-table.js'
import { evaluateOwnerTableScope, type OwnerTableScopeEvaluation } from './owner-table-scope.js'
import {
  computeAgeDays,
  FALLBACK_JOURNAL_LABEL,
  formatBlockingDecisionTodoCause,
  formatCapturedWaitingHeading,
  formatCapturedWaitingLine,
  formatDecisionCellToken,
  formatDecisionsHeading,
  formatDecisionSummaryLine,
  formatFlagSuffix,
  formatHeaderCaptureLine,
  formatHeaderJournalLine,
  formatHeaderLocalCopyLine,
  formatHeaderMotifsLine,
  formatHeaderNoJournalActiveCaptureLine,
  formatMaskText,
  formatMotifUnverifiedDocs,
  formatOwnerGateLine,
  formatPartialScopeNoDecisionsSentence,
  formatReplyLine,
  formatRequestCellCapturedDoubtful,
  formatRequestCellCapturedOwner,
  formatRequestCellNotCaptured,
  formatRequestCellWithOriginLabel,
  formatToAttachHeading,
  formatToAttachLine,
  formatUtcDate,
  MOTIF_UNASSIGNED_JOURNAL,
  type DecisionQualifierLabel,
  type FlagMotif,
  type MaskMotif,
} from './owner-table-strings.js'

export type OwnerTableGapClass =
  | 'G1'
  | 'G2'
  | 'G3'
  | 'E1'
  | 'E2'
  | 'E3'
  | 'E4'
  | 'E5'
  | 'E6'
  | 'E7'
  | 'E8'
  | 'E9'

/**
 * Classify a strict-audit violation into global gate (G1–G3) or per-element gap (E1–E9),
 * using the violation's stable `check` identifier and row number (spec annex B, DS-5).
 */
export function classifyViolation(v: OwnerTableGateViolation): OwnerTableGapClass {
  if (v.code === 'journal-integrity' || v.check === 'journal.integrity') return 'G1'
  if (v.code === 'document-desync' || v.check === 'document.desync') return 'E8'
  if (v.code === 'decision-unnumbered' || v.check === 'decision.unnumbered') return 'E9'
  if (v.code === 'no-owner-demands' || v.check === 'demands.none' || v.check === 'demands.all-archived') {
    return 'E2'
  }
  if (v.code === 'internal-jargon' || v.code === 'banned-word') return 'E7'

  const isPositiveNum = v.rowNum !== undefined && Number.isInteger(v.rowNum) && v.rowNum >= 1

  if (v.check === 'row.unnumbered') return 'E1'
  if (!isPositiveNum && v.rowNum !== undefined && (v.check === 'registry.duplicate' || v.check === 'row.order')) {
    return 'E1'
  }
  if (
    (v.check === 'registry.duplicate' && isPositiveNum) ||
    v.check === 'registry.missing' ||
    v.check === 'registry.hole'
  ) {
    return 'G2'
  }
  if (v.check === 'status.unproven') return 'G3'
  if (v.check === 'decision.no-row') return 'E4'
  if (v.check === 'decision.to-instruct') return 'E5'
  if (v.check === 'decision.no-dossier') return 'E6'
  return 'E3'
}

export function isGlobalGate(gapClass: OwnerTableGapClass): boolean {
  return gapClass === 'G1' || gapClass === 'G2' || gapClass === 'G3'
}

const MASK_PRIORITY: Record<MaskMotif, number> = {
  'terme réservé': 4,
  'empreinte de commit': 3,
  'identifiant interne': 2,
  'jargon interne': 1,
}

function maskMotifForCheck(check: OwnerTableGateCheck | undefined): MaskMotif {
  switch (check) {
    case 'text.commit-hash':
      return 'empreinte de commit'
    case 'text.internal-id':
      return 'identifiant interne'
    case 'text.jargon':
      return 'jargon interne'
    case 'text.reserved':
    default:
      return 'terme réservé'
  }
}

function pickHigherMask(current: MaskMotif | undefined, next: MaskMotif): MaskMotif {
  if (current === undefined) return next
  return MASK_PRIORITY[next] > MASK_PRIORITY[current] ? next : current
}

function flagMotifForCheck(check: OwnerTableGateCheck | undefined): FlagMotif {
  switch (check) {
    case 'row.blocked-no-cause':
    case 'row.blocking-no-cause':
      return 'cause absente'
    case 'eta.too-many':
    case 'eta.invalid-stage':
    case 'eta.invalid-source':
    case 'eta.committed-no-by':
    case 'eta.unknown-with-date':
    case 'eta.measured-unproven':
    case 'eta.missing-date':
    case 'eta.missed-status':
    case 'eta.terminal-active':
    case 'eta.missing':
      return 'ETA incomplète'
    case 'row.request-missing':
      return 'texte absent'
    case 'row.title-few-lots':
      return 'moins de deux lots'
    case 'row.withdrawn-no-reason':
      return 'motif de retrait absent'
    case 'row.status-invalid':
    case 'row.stage-invalid':
    case 'row.stage-done-mismatch':
    case 'row.blocking-not-blocked':
      return 'étape et statut incohérents'
    case 'decision.unlisted':
    case 'decision.sans-objet-inconsistent':
    case 'decision.sans-objet-blocking':
    case 'row.blocking-no-ref':
    case 'row.withdrawn-blocking':
    case 'row.title-blocking-inconsistent':
      return 'décision absente'
    case 'row.order':
    case 'row.lot-orphan':
    case 'row.lot-format':
    case 'row.title-field':
    default:
      return 'structure'
  }
}

export interface QualifiedRowFlag {
  cell: OwnerTableCell
  check: OwnerTableGateCheck | undefined
  motif: FlagMotif
}

export interface QualifiedRowMask {
  cell: OwnerTableCell
  check: OwnerTableGateCheck | undefined
  motif: MaskMotif
}

export interface QualifiedOwnerTableRow extends OwnerTableRow {
  decisionIds: string[]
  blockingDecisionIds: string[]
  sansObjetDecisionIds: string[]
  flags: QualifiedRowFlag[]
  masks: QualifiedRowMask[]
  captured: boolean
  /** Separate E7 mask on captured short title vs captured text (spec §5). */
  requestTitleMask?: MaskMotif | undefined
  requestTextMask?: MaskMotif | undefined
  /** Short origin label when the demand was raised from another project/folder identity (lot 4a). */
  originLabel?: string | undefined
}

export interface QualifiedToAttachItem {
  id: string
  date: string
  createdAt: string | null
  text: string
  captured: boolean
  captureOrigin?: string | undefined
  maskMotif?: MaskMotif | undefined
}

export interface QualifiedCapturedWaitingItem {
  id: string
  date: string
  at: string
  classKind: 'new-demand' | 'follow-up' | 'decision-answer'
  title: string
  demandNumber?: number | undefined
  decisionRef?: string | undefined
}

export interface QualifiedDecisionItem {
  id: string
  ref: string | null
  kind: OwnerTableDecisionKind
  qualifiers: DecisionQualifierLabel[]
  createdAt: string | null
  ageDays: number
  deferred: boolean
  openQuestionCount: number
  session?: string | null
  question: string
  options: OwnerTableDecisionOption[]
  recommendedLetter: string
  recommendation: string
  dossierLink?: string | undefined
  blocking: boolean
  sansObjet: boolean
  masks: Record<string, MaskMotif>
}

export interface QualifiedGapRecord {
  class: OwnerTableGapClass
  check: OwnerTableGateCheck | undefined
  rowId?: string | undefined
  decisionId?: string | undefined
  cell?: OwnerTableCell | undefined
}

export interface QualifiedHeaderMeta {
  label: string
  resolution: JournalResolutionKind
  lastEventAt: string | null
  lastEventDate: string | null
  localOnlyEventCount: number
  noJournal?: boolean | undefined
  writeMode: 'open' | 'exclusive'
  writeHolder: string | null
  captureClis: CaptureCliStatusView[]
}

export interface QualifiedOwnerTableCounts {
  activeDemands: number
  archivedDemands: number
  toAttach: number
  rowsToComplete: number
  decisionsTotal: number
  decisionsToComplete: number
  decisionsPending: number
  outsideDemand: number
  withoutDossier: number
  toInstruct: number
  toNumber: number
  ownerGates: number
  openQuestionCount: number
  decisionsWithOpenQuestions: number
  maskedCells: number
  desyncCount: number
  unverifiedDocs: number
  unclassified: number
  expiredUnclassified: number
  capturedNotInscribed: number
}

export interface QualifiedOwnerTableOptions extends AuditOwnerTableOptions {
  now?: string
  mode?: 'default' | 'strict'
  header?: {
    label?: string
    resolution?: JournalResolutionKind
    lastEventAt?: string
    localOnlyEventCount?: number
    noJournal?: boolean
  }
  writePolicy?: {
    mode: 'open' | 'exclusive'
    holder: string | null
  }
  captureView?: CaptureReaderView
  policyFound?: boolean
  desyncFindings?: readonly DesyncFinding[]
  unverifiedDocsCount?: number
  /** True when several copies are known and none is designated (emits annex F scope motif #1). */
  unassignedJournal?: boolean
  /** Map from row id to raw short origin label for rows raised from another identity (lot 4a). */
  rowOriginLabels?: ReadonlyMap<string, string>
}

export interface QualifiedOwnerTableView {
  kind: 'owner-table-report'
  mode: 'default' | 'strict'
  header: QualifiedHeaderMeta
  scope: OwnerTableScopeEvaluation
  rows: QualifiedOwnerTableRow[]
  toAttach: QualifiedToAttachItem[]
  capturedWaiting: QualifiedCapturedWaitingItem[]
  decisions: QualifiedDecisionItem[]
  gaps: QualifiedGapRecord[]
  counts: QualifiedOwnerTableCounts
  replyLine: string | null
}

function decisionFieldKeyFromMessage(message: string): string {
  if (/ question contains /u.test(message)) return 'question'
  if (/ recommendation contains /u.test(message)) return 'recommendation'
  if (/ dossierLink contains /u.test(message)) return 'dossierLink'
  if (/ session contains /u.test(message)) return 'session'
  const opt = / option ([A-Z]+) contains /u.exec(message)
  if (opt !== null && opt[1] !== undefined) return `option:${opt[1]}`
  return 'question'
}

export function buildQualifiedOwnerTable(
  view: OwnerTableView,
  options: QualifiedOwnerTableOptions = {},
): QualifiedOwnerTableView {
  const mode = options.mode ?? 'default'
  const audit = auditOwnerTable(view, options)
  const desync = options.desyncFindings ?? []

  const allViolations: OwnerTableGateViolation[] = [
    ...audit.violations,
    ...desync.map((f): OwnerTableGateViolation => ({
      code: 'document-desync',
      check: 'document.desync',
      rowId: f.itemId,
      message: f.reason,
    })),
  ]

  const classified = allViolations.map((violation) => ({
    violation,
    gapClass: classifyViolation(violation),
  }))

  const globalViolations = classified.filter((entry) => isGlobalGate(entry.gapClass))
  if (globalViolations.length > 0) {
    const details = globalViolations.map((e) => `- [${e.violation.code}] ${e.violation.message}`).join('\n')
    throw new DomainError(`REFUSED: owner table failed blocking gates:\n${details}`)
  }

  if (mode === 'strict' && allViolations.length > 0) {
    const details = allViolations.map((v) => `- [${v.code}] ${v.message}`).join('\n')
    throw new DomainError(`REFUSED: owner table failed blocking gates:\n${details}`)
  }

  const policyFound =
    options.policyFound ??
    (audit.notices === undefined || audit.notices.length === 0)

  // Index E3 flags and E7 masks by rowId and decisionId
  const rowFlagsMap = new Map<string, QualifiedRowFlag[]>()
  const rowMasksMap = new Map<string, Map<OwnerTableCell, { motif: MaskMotif; check: OwnerTableGateCheck | undefined }>>()
  const rowCapturedTitleMasks = new Map<string, MaskMotif>()
  const rowCapturedTextMasks = new Map<string, MaskMotif>()
  const decisionQualifiersMap = new Map<string, Set<DecisionQualifierLabel>>()
  const decisionMasksMap = new Map<string, Map<string, MaskMotif>>()

  const addQualifier = (decisionId: string, q: DecisionQualifierLabel): void => {
    let set = decisionQualifiersMap.get(decisionId)
    if (set === undefined) {
      set = new Set()
      decisionQualifiersMap.set(decisionId, set)
    }
    set.add(q)
  }

  for (const { violation, gapClass } of classified) {
    if (gapClass === 'E3' && violation.rowId !== undefined) {
      const cell = violation.cell ?? 'request'
      const motif = flagMotifForCheck(violation.check)
      let list = rowFlagsMap.get(violation.rowId)
      if (list === undefined) {
        list = []
        rowFlagsMap.set(violation.rowId, list)
      }
      if (!list.some((existing) => existing.cell === cell && existing.motif === motif)) {
        list.push({ cell, check: violation.check, motif })
      }
    } else if (gapClass === 'E7') {
      const motif = maskMotifForCheck(violation.check)
      if (violation.rowId !== undefined) {
        const cell = violation.cell ?? 'request'
        if (cell === 'request' && violation.message.includes('(title)')) {
          rowCapturedTitleMasks.set(
            violation.rowId,
            pickHigherMask(rowCapturedTitleMasks.get(violation.rowId), motif),
          )
        } else if (cell === 'request' && violation.message.includes('(text)')) {
          rowCapturedTextMasks.set(
            violation.rowId,
            pickHigherMask(rowCapturedTextMasks.get(violation.rowId), motif),
          )
        }
        let cellMap = rowMasksMap.get(violation.rowId)
        if (cellMap === undefined) {
          cellMap = new Map()
          rowMasksMap.set(violation.rowId, cellMap)
        }
        const prev = cellMap.get(cell)
        const picked = pickHigherMask(prev?.motif, motif)
        cellMap.set(cell, { motif: picked, check: picked === motif ? violation.check : prev?.check })
      } else if (violation.decisionId !== undefined) {
        const fieldKey = decisionFieldKeyFromMessage(violation.message)
        let fieldMap = decisionMasksMap.get(violation.decisionId)
        if (fieldMap === undefined) {
          fieldMap = new Map()
          decisionMasksMap.set(violation.decisionId, fieldMap)
        }
        fieldMap.set(fieldKey, pickHigherMask(fieldMap.get(fieldKey), motif))
      }
    } else if (gapClass === 'E4' && violation.decisionId !== undefined) {
      addQualifier(violation.decisionId, 'hors demande')
    } else if (gapClass === 'E5' && violation.decisionId !== undefined) {
      addQualifier(violation.decisionId, 'à instruire')
    } else if (gapClass === 'E6' && violation.decisionId !== undefined) {
      addQualifier(violation.decisionId, 'sans dossier')
    } else if (gapClass === 'E9' && violation.decisionId !== undefined) {
      addQualifier(violation.decisionId, 'à numéroter')
    }
  }

  // Build qualified decisions first so rows can inspect E5 / E9 / OWNER GATE status by identity
  const qualifierOrder: readonly DecisionQualifierLabel[] = [
    'à instruire',
    'à numéroter',
    'hors demande',
    'sans dossier',
  ]
  const qualifiedDecisions: QualifiedDecisionItem[] = view.decisions.map((d) => {
    const kind: OwnerTableDecisionKind = d.kind ?? 'decision'
    const qSet = decisionQualifiersMap.get(d.id) ?? new Set<DecisionQualifierLabel>()
    const qualifiers = kind === 'owner-gate'
      ? []
      : qualifierOrder.filter((q) => qSet.has(q))
    const isToInstruct = qualifiers.includes('à instruire')
    const isToNumber = qualifiers.includes('à numéroter')
    const displayRef = kind === 'owner-gate' || isToInstruct || isToNumber || d.ref.trim() === '' ? null : d.ref
    const masksObj: Record<string, MaskMotif> = {}
    const dMasks = decisionMasksMap.get(d.id)
    if (dMasks !== undefined) {
      for (const [k, m] of dMasks) masksObj[k] = m
    }
    const ageDays = computeAgeDays(d.createdAt, options.now)
    return {
      id: d.id,
      ref: displayRef,
      kind,
      qualifiers,
      createdAt: d.createdAt ?? null,
      ageDays,
      deferred: d.deferred === true,
      openQuestionCount: d.openQuestionCount ?? 0,
      ...(kind === 'owner-gate' ? { session: d.session ?? null } : {}),
      question: d.question,
      options: d.options,
      recommendedLetter: d.recommendedLetter,
      recommendation: d.recommendation,
      ...(d.dossierLink !== undefined ? { dossierLink: d.dossierLink } : {}),
      blocking: d.blocking === true,
      sansObjet: d.sansObjet === true,
      masks: masksObj,
    }
  })

  const qualifiedDecisionById = new Map(qualifiedDecisions.map((d) => [d.id, d]))

  // Split numbered rows vs E1 unnumbered rows (`À rattacher`)
  const numberedRows: QualifiedOwnerTableRow[] = []
  const toAttach: QualifiedToAttachItem[] = []
  let maskedCells = 0

  const labelGateOpts = {
    ...(options.policy !== undefined ? { policy: options.policy } : {}),
    ...(options.policyPath !== undefined ? { policyPath: options.policyPath } : {}),
    ...(options.defaultPolicyPath !== undefined ? { defaultPolicyPath: options.defaultPolicyPath } : {}),
    ...(options.statePolicyPath !== undefined ? { statePolicyPath: options.statePolicyPath } : {}),
  }

  for (const row of view.rows) {
    if (!Number.isInteger(row.num) || row.num < 1) {
      const reqMask = rowMasksMap.get(row.id)?.get('request')?.motif
      if (reqMask !== undefined) maskedCells++
      toAttach.push({
        id: row.id,
        date: formatUtcDate(row.createdAt, options.now),
        createdAt: row.createdAt ?? null,
        text: row.captured === true ? (row.capturedText ?? row.request) : row.request,
        captured: row.captured === true,
        ...(row.captureOrigin !== undefined ? { captureOrigin: row.captureOrigin } : {}),
        ...(reqMask !== undefined ? { maskMotif: reqMask } : {}),
      })
      continue
    }
    const flags = rowFlagsMap.get(row.id) ?? []
    const masksMap = rowMasksMap.get(row.id)
    const masks: QualifiedRowMask[] = []
    if (masksMap !== undefined) {
      for (const [cell, entry] of masksMap) {
        masks.push({ cell, check: entry.check, motif: entry.motif })
        maskedCells++
      }
    }
    const rawOriginLabel = options.rowOriginLabels?.get(row.id)
    const sanitizedOriginLabel =
      rawOriginLabel !== undefined && rawOriginLabel.trim() !== ''
        ? hasTextGateViolation(rawOriginLabel, labelGateOpts)
          ? FALLBACK_JOURNAL_LABEL
          : rawOriginLabel.trim()
        : undefined
    const titleMask = rowCapturedTitleMasks.get(row.id)
    const textMask = rowCapturedTextMasks.get(row.id)
    numberedRows.push({
      ...row,
      decisionIds: row.decisionIds ?? [],
      blockingDecisionIds: row.blockingDecisionIds ?? [],
      sansObjetDecisionIds: row.sansObjetDecisionIds ?? [],
      flags,
      masks,
      captured: row.captured === true,
      ...(titleMask !== undefined ? { requestTitleMask: titleMask } : {}),
      ...(textMask !== undefined ? { requestTextMask: textMask } : {}),
      ...(sanitizedOriginLabel !== undefined ? { originLabel: sanitizedOriginLabel } : {}),
    })
  }

  for (const d of qualifiedDecisions) {
    maskedCells += Object.keys(d.masks).length
  }

  // Reply line: only numbered non-gate non-E5 non-E9 decisions with recorded recommendation, in number order
  const replyEntries: { ref: string; num: number; letter: string }[] = []
  for (const d of qualifiedDecisions) {
    if (
      d.kind !== 'owner-gate' &&
      d.ref !== null &&
      !d.qualifiers.includes('à instruire') &&
      !d.qualifiers.includes('à numéroter') &&
      d.recommendedLetter !== '' &&
      d.recommendation !== ''
    ) {
      const m = /^D(\d+)$/u.exec(d.ref)
      replyEntries.push({
        ref: d.ref,
        num: m !== null ? Number(m[1]) : Number.MAX_SAFE_INTEGER,
        letter: d.recommendedLetter,
      })
    }
  }
  replyEntries.sort((a, b) => a.num - b.num)
  const replyLine = formatReplyLine(replyEntries)

  // Header label derivation with text-gate fallback to `journal`
  const rawLabel = options.header?.label ?? FALLBACK_JOURNAL_LABEL
  const label =
    rawLabel.trim() === '' || hasTextGateViolation(rawLabel, {
      ...(options.policy !== undefined ? { policy: options.policy } : {}),
      ...(options.policyPath !== undefined ? { policyPath: options.policyPath } : {}),
      ...(options.defaultPolicyPath !== undefined ? { defaultPolicyPath: options.defaultPolicyPath } : {}),
      ...(options.statePolicyPath !== undefined ? { statePolicyPath: options.statePolicyPath } : {}),
    })
      ? FALLBACK_JOURNAL_LABEL
      : rawLabel.trim()

  const lastEventAt = options.header?.lastEventAt ?? null
  const lastEventDate = lastEventAt !== null ? formatUtcDate(lastEventAt, options.now) : null
  const captureView = options.captureView
  const captureClis = captureView?.clis ?? []
  const writeMode = options.writePolicy?.mode ?? 'open'
  const writeHolder = options.writePolicy?.holder ?? null
  const header: QualifiedHeaderMeta = {
    label,
    resolution: options.header?.resolution ?? 'dossier',
    lastEventAt,
    lastEventDate,
    localOnlyEventCount: options.header?.localOnlyEventCount ?? 0,
    ...(options.header?.noJournal === true ? { noJournal: true } : {}),
    writeMode,
    writeHolder,
    captureClis,
  }

  const capturedWaiting: QualifiedCapturedWaitingItem[] = (captureView?.capturedNotInscribed ?? []).map(
    (item) => ({
      id: item.id,
      at: item.at,
      date: formatUtcDate(item.at, options.now),
      classKind: item.classKind,
      title: hasTextGateViolation(item.title, labelGateOpts) ? formatMaskText('terme réservé') : item.title,
      ...(item.demandNumber !== undefined ? { demandNumber: item.demandNumber } : {}),
      ...(item.decisionRef !== undefined ? { decisionRef: item.decisionRef } : {}),
    }),
  )

  // Counts (V2: each counter equals the exact number of elements it names; qualifiers are never summed)
  const activeDemands = numberedRows.filter((r) => (r.kind ?? 'single') !== 'lot').length
  const archivedDemands = view.archivedNumbers.length
  const rowsToComplete = numberedRows.filter((r) => r.flags.length > 0).length
  const nonGateDecisions = qualifiedDecisions.filter((d) => d.kind !== 'owner-gate')
  const decisionsToComplete = nonGateDecisions.filter((d) => d.qualifiers.length > 0).length
  const decisionsPending = nonGateDecisions.filter((d) => d.qualifiers.length === 0).length
  const outsideDemand = nonGateDecisions.filter((d) => d.qualifiers.includes('hors demande')).length
  const withoutDossier = nonGateDecisions.filter((d) => d.qualifiers.includes('sans dossier')).length
  const toInstruct = nonGateDecisions.filter((d) => d.qualifiers.includes('à instruire')).length
  const toNumber = nonGateDecisions.filter((d) => d.qualifiers.includes('à numéroter')).length
  const ownerGates = qualifiedDecisions.filter((d) => d.kind === 'owner-gate').length
  const openQuestionCount = qualifiedDecisions.reduce((sum, d) => sum + d.openQuestionCount, 0)
  const decisionsWithOpenQuestions = qualifiedDecisions.filter((d) => d.openQuestionCount > 0).length

  const unverifiedDocs = options.unverifiedDocsCount ?? 0
  const unclassified = captureView?.unclassifiedCount ?? 0
  const expiredUnclassified = captureView?.expiredUnclassifiedCount ?? 0
  const capturedNotInscribed = capturedWaiting.length

  const counts: QualifiedOwnerTableCounts = {
    activeDemands,
    archivedDemands,
    toAttach: toAttach.length,
    rowsToComplete,
    decisionsTotal: qualifiedDecisions.length,
    decisionsToComplete,
    decisionsPending,
    outsideDemand,
    withoutDossier,
    toInstruct,
    toNumber,
    ownerGates,
    openQuestionCount,
    decisionsWithOpenQuestions,
    maskedCells,
    desyncCount: desync.length,
    unverifiedDocs,
    unclassified,
    expiredUnclassified,
    capturedNotInscribed,
  }

  const scope = evaluateOwnerTableScope({
    policyFound,
    activeDemands,
    archivedDemands,
    toAttach: counts.toAttach,
    rowsToComplete,
    decisionsToComplete,
    decisionsPending,
    ownerGates,
    openQuestionCount,
    maskedCells,
    desyncCount: desync.length,
    captureClis,
    unclassifiedCount: unclassified,
    expiredUnclassifiedCount: expiredUnclassified,
    capturedNotInscribedCount: capturedNotInscribed,
  })
  // Annex F order 1: unassigned reference journal when several copies are known.
  if (options.unassignedJournal === true) {
    scope.motifs.unshift({ kind: 'scope', text: MOTIF_UNASSIGNED_JOURNAL })
  }
  // Annex F order 19: document references whose owning project folder is not known.
  if (unverifiedDocs > 0) {
    scope.motifs.push({ kind: 'gap', text: formatMotifUnverifiedDocs(unverifiedDocs) })
  }

  // Ensure blocking E5 / E9 decisions on rows render their annex-F todo cause instead of an internal D#
  for (const row of numberedRows) {
    if ((row.kind ?? 'single') === 'demand-title') continue
    if (row.blockingDecisionIds.length === 0) continue
    const hasUnnumberedBlocker = row.blockingDecisionIds.some((dId) => {
      const dec = qualifiedDecisionById.get(dId)
      return (
        dec !== undefined &&
        (dec.qualifiers.includes('à instruire') || dec.qualifiers.includes('à numéroter'))
      )
    })
    if (!hasUnnumberedBlocker) continue
    const rewrittenCauses = row.blockingDecisionIds
      .map((dId) => {
        const dec = qualifiedDecisionById.get(dId)
        if (dec === undefined) return undefined
        return formatBlockingDecisionTodoCause({
          kind: dec.kind,
          ref: dec.ref,
          isToInstruct: dec.qualifiers.includes('à instruire'),
          isToNumber: dec.qualifiers.includes('à numéroter'),
          session: dec.session ?? null,
        })
      })
      .filter((s): s is string => s !== undefined)
    const nonDecisionParts = row.todo
      .split(' ; ')
      .filter(
        (part) =>
          !/^bloqué par (?:D\d+|OWNER GATE|décision à (?:instruire|numéroter))/u.test(part.trim()) &&
          part.trim() !== '—',
      )
    const combined = [...rewrittenCauses, ...nonDecisionParts]
    row.todo = combined.length > 0 ? combined.join(' ; ') : '—'
  }

  const gaps: QualifiedGapRecord[] = classified.map(({ violation, gapClass }) => ({
    class: gapClass,
    check: violation.check,
    ...(violation.rowId !== undefined ? { rowId: violation.rowId } : {}),
    ...(violation.decisionId !== undefined ? { decisionId: violation.decisionId } : {}),
    ...(violation.cell !== undefined ? { cell: violation.cell } : {}),
  }))

  return {
    kind: 'owner-table-report',
    mode,
    header,
    scope,
    rows: numberedRows,
    toAttach,
    capturedWaiting,
    decisions: qualifiedDecisions,
    gaps,
    counts,
    replyLine,
  }
}

function escapePipeCell(value: string): string {
  return cleanDisplayText(value).replace(/\|/gu, '\\|')
}

function applyCellMasksAndFlags(
  rawText: string,
  cell: OwnerTableCell,
  row: QualifiedOwnerTableRow,
): string {
  const mask = row.masks.find((m) => m.cell === cell)
  let out = mask !== undefined ? formatMaskText(mask.motif) : rawText
  for (const flag of row.flags) {
    if (flag.cell === cell) {
      out += formatFlagSuffix(flag.motif)
    }
  }
  return out
}

function renderQualifiedDecisionCell(
  row: QualifiedOwnerTableRow,
  decisionById: ReadonlyMap<string, QualifiedDecisionItem>,
): string {
  if (row.decisionIds.length > 0) {
    const blockingSet = new Set(row.blockingDecisionIds)
    const sansObjetSet = new Set(row.sansObjetDecisionIds)
    const tokens: string[] = []
    for (const dId of row.decisionIds) {
      const dec = decisionById.get(dId)
      if (dec === undefined) continue
      tokens.push(
        formatDecisionCellToken({
          kind: dec.kind,
          ref: dec.ref,
          isToInstruct: dec.qualifiers.includes('à instruire'),
          isToNumber: dec.qualifiers.includes('à numéroter'),
          blocking: blockingSet.has(dId),
          sansObjet: row.status === 'withdrawn' || sansObjetSet.has(dId),
        }),
      )
    }
    return tokens.length > 0 ? tokens.join(' · ') : '—'
  }
  return formatOwnerDecisionCell(row)
}

export function renderQualifiedOwnerTable(
  qualified: QualifiedOwnerTableView,
  format: Format = 'md',
): string {
  if (format === 'json') {
    return `${JSON.stringify(qualified, null, 2)}\n`
  }

  const lines: string[] = []

  // Header (up to 4 lines from lot 3a)
  if (qualified.header.noJournal === true) {
    lines.push(formatHeaderNoJournalActiveCaptureLine(qualified.header.label))
  } else {
    lines.push(
      formatHeaderJournalLine(
        qualified.header.label,
        qualified.header.resolution,
        qualified.header.lastEventDate,
        { mode: qualified.header.writeMode, holder: qualified.header.writeHolder },
      ),
    )
  }
  lines.push(formatHeaderCaptureLine(qualified.header.captureClis))
  lines.push(formatHeaderMotifsLine(qualified.scope.motifs.map((m) => m.text)))
  if (qualified.header.localOnlyEventCount > 0) {
    lines.push(formatHeaderLocalCopyLine(qualified.header.localOnlyEventCount))
  }

  const decisionById = new Map(qualified.decisions.map((d) => [d.id, d]))

  // Table of numbered demands (shown when at least 1 row)
  if (qualified.rows.length > 0) {
    lines.push('')
    lines.push(`| ${OWNER_TABLE_HEADERS.join(' | ')} |`)
    lines.push('| ---: | --- | --- | --- | --- | --- | --- | --- |')

    for (const row of qualified.rows) {
      const statusCell = applyCellMasksAndFlags(formatOwnerStatusCell(row), 'status', row)
      const stageCell = applyCellMasksAndFlags(formatOwnerStageCell(row), 'stage', row)
      const etaCell = applyCellMasksAndFlags(formatOwnerEtaCell(row.etas), 'eta', row)
      let requestWithMask: string
      if (row.captured) {
        const capText = row.capturedText ?? row.request
        const capTitle = row.capturedTitle
        const capOpts = {
          ...(row.maskedAtInscription === true ? { maskedAtInscription: true } : {}),
          ...(row.requestTitleMask !== undefined ? { titleMask: row.requestTitleMask } : {}),
          ...(row.requestTextMask !== undefined ? { textMask: row.requestTextMask } : {}),
        }
        requestWithMask =
          row.captureOrigin === 'owner'
            ? formatRequestCellCapturedOwner(capText, capTitle, capOpts)
            : formatRequestCellCapturedDoubtful(capText, capTitle, capOpts)
        for (const flag of row.flags) {
          if (flag.cell === 'request') requestWithMask += formatFlagSuffix(flag.motif)
        }
      } else {
        const requestBase = formatRequestCellNotCaptured(row.request)
        requestWithMask = applyCellMasksAndFlags(requestBase, 'request', row)
      }
      const requestCell =
        row.originLabel !== undefined
          ? formatRequestCellWithOriginLabel(row.originLabel, requestWithMask)
          : requestWithMask
      const doneCell = applyCellMasksAndFlags(row.done, 'done', row)
      const todoCell = applyCellMasksAndFlags(row.todo, 'todo', row)
      const decisionCell = applyCellMasksAndFlags(
        renderQualifiedDecisionCell(row, decisionById),
        'decision',
        row,
      )

      const cells = [
        String(row.num),
        escapePipeCell(statusCell),
        escapePipeCell(stageCell),
        escapePipeCell(etaCell),
        escapePipeCell(requestCell),
        escapePipeCell(doneCell),
        escapePipeCell(todoCell),
        escapePipeCell(decisionCell),
      ]
      lines.push(`| ${cells.join(' | ')} |`)
    }
  }

  // « À rattacher » section
  if (qualified.toAttach.length > 0) {
    lines.push('')
    lines.push(formatToAttachHeading(qualified.toAttach.length))
    for (const item of qualified.toAttach) {
      lines.push(
        formatToAttachLine({
          date: item.date,
          text: item.text.trim() === '' ? '—' : cleanDisplayText(item.text),
          captured: item.captured,
          captureOrigin: item.captureOrigin,
          maskMotif: item.maskMotif,
        }),
      )
    }
  }

  // « Captées, pas encore inscrites » section (lot 3a)
  if (qualified.capturedWaiting.length > 0) {
    lines.push('')
    lines.push(formatCapturedWaitingHeading(qualified.capturedWaiting.length))
    for (const item of qualified.capturedWaiting) {
      lines.push(
        formatCapturedWaitingLine({
          date: item.date,
          classKind: item.classKind,
          title: cleanDisplayText(item.title),
          demandNumber: item.demandNumber,
          decisionRef: item.decisionRef,
        }),
      )
    }
  }

  // « Décisions qui t'attendent » section
  lines.push('')
  lines.push(
    formatDecisionsHeading({
      total: qualified.counts.decisionsTotal,
      outsideDemand: qualified.counts.outsideDemand,
      withoutDossier: qualified.counts.withoutDossier,
      toInstruct: qualified.counts.toInstruct,
      toNumber: qualified.counts.toNumber,
      openQuestionCount: qualified.counts.openQuestionCount,
      decisionsWithOpenQuestions: qualified.counts.decisionsWithOpenQuestions,
    }),
  )

  if (qualified.decisions.length === 0) {
    lines.push('')
    const scopeOnlyMotifs = qualified.scope.motifs
      .filter((m) => m.kind === 'scope')
      .map((m) => m.text)
    lines.push(formatPartialScopeNoDecisionsSentence(scopeOnlyMotifs))
  } else {
    for (const d of qualified.decisions) {
      if (d.kind === 'owner-gate') {
        const maskedSession =
          d.masks['session'] !== undefined
            ? formatMaskText(d.masks['session'])
            : (d.session ?? null)
        lines.push(formatOwnerGateLine(maskedSession, d.ageDays, d.deferred))
        continue
      }
      const isToInstruct = d.qualifiers.includes('à instruire')
      const subject =
        d.masks['question'] !== undefined
          ? formatMaskText(d.masks['question'])
          : cleanDisplayText(d.question)
      const dossierLink =
        d.masks['dossierLink'] !== undefined
          ? formatMaskText(d.masks['dossierLink'])
          : d.dossierLink
      lines.push(
        formatDecisionSummaryLine({
          ref: d.ref,
          qualifiers: d.qualifiers,
          ageDays: d.ageDays,
          deferred: d.deferred,
          subject,
          dossierLink,
          sansObjet: d.sansObjet,
          isToInstruct,
        }),
      )
      if (!isToInstruct) {
        for (const opt of d.options) {
          const optMask = d.masks[`option:${opt.letter}`]
          if (optMask !== undefined) {
            lines.push(`  - **${opt.letter}** — ${formatMaskText(optMask)}`)
          } else {
            lines.push(
              `  - **${opt.letter} · ${cleanDisplayText(opt.label)}** — ${cleanDisplayText(opt.consequence)}`,
            )
          }
        }
        const recoText =
          d.masks['recommendation'] !== undefined
            ? formatMaskText(d.masks['recommendation'])
            : cleanDisplayText(d.recommendation)
        if (d.recommendedLetter !== '' && recoText !== '') {
          lines.push(`  - Reco : **${d.recommendedLetter}** (${recoText})`)
        }
      }
    }
  }

  if (qualified.replyLine !== null) {
    lines.push('')
    lines.push(`\`${qualified.replyLine}\``)
  }

  return `${lines.join('\n')}\n`
}
