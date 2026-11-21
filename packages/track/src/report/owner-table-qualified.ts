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
  formatDecisionCellToken,
  formatDecisionsHeading,
  formatDecisionSummaryLine,
  formatFlagSuffix,
  formatHeaderJournalLine,
  formatHeaderLocalCopyLine,
  formatHeaderMotifsLine,
  formatMaskText,
  formatOwnerGateLine,
  formatPartialScopeNoDecisionsSentence,
  formatReplyLine,
  formatRequestCellNotCaptured,
  formatToAttachHeading,
  formatToAttachLine,
  formatUtcDate,
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

/**
 * Classify a strict-audit violation into global gate (G1–G3) or per-element gap (E1–E8),
 * using the violation's stable `check` identifier and row number (spec annex B, DS-5).
 */
export function classifyViolation(v: OwnerTableGateViolation): OwnerTableGapClass {
  if (v.code === 'journal-integrity' || v.check === 'journal.integrity') return 'G1'
  if (v.code === 'document-desync' || v.check === 'document.desync') return 'E8'
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
}

export interface QualifiedToAttachItem {
  id: string
  date: string
  createdAt: string | null
  text: string
  captured: boolean
  maskMotif?: MaskMotif | undefined
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
  ownerGates: number
  openQuestionCount: number
  decisionsWithOpenQuestions: number
  maskedCells: number
  desyncCount: number
}

export interface QualifiedOwnerTableOptions extends AuditOwnerTableOptions {
  now?: string
  mode?: 'default' | 'strict'
  header?: {
    label?: string
    resolution?: JournalResolutionKind
    lastEventAt?: string
    localOnlyEventCount?: number
  }
  policyFound?: boolean
  desyncFindings?: readonly DesyncFinding[]
}

export interface QualifiedOwnerTableView {
  kind: 'owner-table-report'
  mode: 'default' | 'strict'
  header: QualifiedHeaderMeta
  scope: OwnerTableScopeEvaluation
  rows: QualifiedOwnerTableRow[]
  toAttach: QualifiedToAttachItem[]
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
    }
  }

  // Build qualified decisions first so rows can inspect E5 / OWNER GATE status by identity
  const qualifierOrder: readonly DecisionQualifierLabel[] = [
    'à instruire',
    'hors demande',
    'sans dossier',
    'à numéroter',
  ]
  const qualifiedDecisions: QualifiedDecisionItem[] = view.decisions.map((d) => {
    const kind: OwnerTableDecisionKind = d.kind ?? 'decision'
    const qSet = decisionQualifiersMap.get(d.id) ?? new Set<DecisionQualifierLabel>()
    const qualifiers = kind === 'owner-gate'
      ? []
      : qualifierOrder.filter((q) => qSet.has(q))
    const isToInstruct = qualifiers.includes('à instruire')
    const displayRef = kind === 'owner-gate' || isToInstruct || d.ref.trim() === '' ? null : d.ref
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

  for (const row of view.rows) {
    if (!Number.isInteger(row.num) || row.num < 1) {
      const reqMask = rowMasksMap.get(row.id)?.get('request')?.motif
      if (reqMask !== undefined) maskedCells++
      toAttach.push({
        id: row.id,
        date: formatUtcDate(row.createdAt, options.now),
        createdAt: row.createdAt ?? null,
        text: row.request,
        captured: false,
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
    numberedRows.push({
      ...row,
      decisionIds: row.decisionIds ?? [],
      blockingDecisionIds: row.blockingDecisionIds ?? [],
      sansObjetDecisionIds: row.sansObjetDecisionIds ?? [],
      flags,
      masks,
      captured: false,
    })
  }

  for (const d of qualifiedDecisions) {
    maskedCells += Object.keys(d.masks).length
  }

  // Reply line: only numbered non-gate non-E5 decisions with recorded recommendation, in number order
  const replyEntries: { ref: string; letter: string }[] = []
  for (const d of qualifiedDecisions) {
    if (
      d.kind !== 'owner-gate' &&
      d.ref !== null &&
      !d.qualifiers.includes('à instruire') &&
      d.recommendedLetter !== '' &&
      d.recommendation !== ''
    ) {
      replyEntries.push({ ref: d.ref, letter: d.recommendedLetter })
    }
  }
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
  const header: QualifiedHeaderMeta = {
    label,
    resolution: options.header?.resolution ?? 'dossier',
    lastEventAt,
    lastEventDate,
    localOnlyEventCount: options.header?.localOnlyEventCount ?? 0,
  }

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
  const ownerGates = qualifiedDecisions.filter((d) => d.kind === 'owner-gate').length
  const openQuestionCount = qualifiedDecisions.reduce((sum, d) => sum + d.openQuestionCount, 0)
  const decisionsWithOpenQuestions = qualifiedDecisions.filter((d) => d.openQuestionCount > 0).length

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
    ownerGates,
    openQuestionCount,
    decisionsWithOpenQuestions,
    maskedCells,
    desyncCount: desync.length,
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
  })

  // Ensure blocking E5 decisions on rows render their annex-F todo cause instead of an internal D#
  for (const row of numberedRows) {
    if ((row.kind ?? 'single') === 'demand-title') continue
    if (row.blockingDecisionIds.length === 0) continue
    const hasToInstructBlocker = row.blockingDecisionIds.some((dId) => {
      const dec = qualifiedDecisionById.get(dId)
      return dec !== undefined && dec.qualifiers.includes('à instruire')
    })
    if (!hasToInstructBlocker) continue
    const rewrittenCauses = row.blockingDecisionIds
      .map((dId) => {
        const dec = qualifiedDecisionById.get(dId)
        if (dec === undefined) return undefined
        return formatBlockingDecisionTodoCause({
          kind: dec.kind,
          ref: dec.ref,
          isToInstruct: dec.qualifiers.includes('à instruire'),
          session: dec.session ?? null,
        })
      })
      .filter((s): s is string => s !== undefined)
    const nonDecisionParts = row.todo
      .split(' ; ')
      .filter((part) => !/^bloqué par /u.test(part.trim()) && part.trim() !== '—')
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

  // Header (up to 3 lines in lot 1)
  lines.push(
    formatHeaderJournalLine(
      qualified.header.label,
      qualified.header.resolution,
      qualified.header.lastEventDate,
    ),
  )
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
      const requestBase = formatRequestCellNotCaptured(row.request)
      const requestCell = applyCellMasksAndFlags(requestBase, 'request', row)
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
          maskMotif: item.maskMotif,
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
