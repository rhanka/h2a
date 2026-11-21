import { DomainError } from '../model/item.js'
import type { Format } from './format.js'
import {
  auditOwnerTable,
  type AuditOwnerTableOptions,
  type OwnerTableCell,
  type OwnerTableGateCheck,
  type OwnerTableGateViolation,
  type OwnerTableRow,
  type OwnerTableView,
} from './owner-table.js'

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

export interface QualifiedRowFlag {
  cell: OwnerTableCell
  check: OwnerTableGateCheck | undefined
  motif: string
}

export interface QualifiedRowMask {
  cell: OwnerTableCell
  check: OwnerTableGateCheck | undefined
  motif: string
}

export interface QualifiedOwnerTableRow extends OwnerTableRow {
  flags: QualifiedRowFlag[]
  masks: QualifiedRowMask[]
  captured: boolean
}

export interface QualifiedToAttachItem {
  id: string
  date: string
  createdAt?: string | undefined
  text: string
  captured: boolean
  maskMotif?: string | undefined
}

export interface QualifiedOwnerTableOptions extends AuditOwnerTableOptions {
  now?: string
  mode?: 'default' | 'strict'
}

export interface QualifiedOwnerTableView {
  kind: 'owner-table-report'
  mode: 'default' | 'strict'
  rows: QualifiedOwnerTableRow[]
  toAttach: QualifiedToAttachItem[]
  counts: {
    toAttach: number
    rowsToComplete: number
  }
}

export function buildQualifiedOwnerTable(
  view: OwnerTableView,
  options: QualifiedOwnerTableOptions = {},
): QualifiedOwnerTableView {
  const audit = auditOwnerTable(view, options)
  const classified = audit.violations.map((violation) => ({
    violation,
    gapClass: classifyViolation(violation),
  }))

  const globalViolations = classified.filter((entry) => isGlobalGate(entry.gapClass))
  if (globalViolations.length > 0) {
    const details = globalViolations.map((e) => `- [${e.violation.code}] ${e.violation.message}`).join('\n')
    throw new DomainError(`REFUSED: owner table failed blocking gates:\n${details}`)
  }

  const numberedRows: QualifiedOwnerTableRow[] = []
  const toAttach: QualifiedToAttachItem[] = []
  for (const row of view.rows) {
    if (!Number.isInteger(row.num) || row.num < 1) {
      toAttach.push({
        id: row.id,
        date: '',
        text: row.request,
        captured: false,
      })
    } else {
      numberedRows.push({
        ...row,
        flags: [],
        masks: [],
        captured: false,
      })
    }
  }

  return {
    kind: 'owner-table-report',
    mode: options.mode ?? 'default',
    rows: numberedRows,
    toAttach,
    counts: {
      toAttach: toAttach.length,
      rowsToComplete: 0,
    },
  }
}

export function renderQualifiedOwnerTable(
  qualified: QualifiedOwnerTableView,
  format: Format = 'md',
): string {
  if (format === 'json') {
    return `${JSON.stringify(qualified, null, 2)}\n`
  }
  return ''
}
