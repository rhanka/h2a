import { dirname } from 'node:path'

import { computeHash } from '../events/canonical.js'
import { readHead } from '../events/head.js'
import type { DemandType } from '../model/demand.js'
import type { ItemKind } from '../model/item.js'
import { TrackReader } from '../read/contract.js'
import type { OwnerTableCell, ProjectOwnerTableOptions } from '../report/owner-table.js'
import {
  buildQualifiedOwnerTable,
  type OwnerTableGapClass,
  type QualifiedOwnerTableView,
} from '../report/owner-table-qualified.js'
import { resolveOwnerTablePolicyFile } from '../state-home.js'

export type AdoptionGapClass = OwnerTableGapClass | 'E9'
export type AdoptionEntryKind = 'mechanical' | 'to-decide'

/**
 * Closed set of adoption actions.
 * Settling, withdrawing, or archiving a decision is intentionally absent from this union.
 */
export type AdoptionAction =
  | 'number-demand'
  | 'reconstruct-demand'
  | 'number-decision'
  | 'attach-decision'
  | 'instruct-decision'
  | 'attach-dossier'
  | 'set-blocked-cause'
  | 'rewrite-masked-text'
  | 'raise-initial-demand'
  | 'resolve-row-gap'
  | 'resolve-desync'

export const ALLOWED_ADOPTION_ACTIONS: ReadonlySet<string> = new Set<AdoptionAction>([
  'number-demand',
  'reconstruct-demand',
  'number-decision',
  'attach-decision',
  'instruct-decision',
  'attach-dossier',
  'set-blocked-cause',
  'rewrite-masked-text',
  'raise-initial-demand',
  'resolve-row-gap',
  'resolve-desync',
])

export interface AdoptionElement {
  kind: 'demand' | 'item' | 'decision' | 'row' | 'journal' | 'document'
  id?: string
  ref?: string | null
  rowNum?: number
  cell?: OwnerTableCell
  field?: string
  subject?: string
}

export interface AdoptionPlanEntry {
  id: string
  class: AdoptionGapClass
  kind: AdoptionEntryKind
  action: AdoptionAction
  element: AdoptionElement
  proposedWrite: Record<string, unknown>
  question?: string
  resolution?: Record<string, unknown> | null
  pendingOn?: 'lot-2'
}

export interface AdoptionPlanCounts {
  total: number
  mechanical: number
  toDecide: number
  unresolved: number
}

export interface AdoptionPlan {
  version: 1
  planHash: string
  baseline: {
    streamLength: number
    lastContentHash: string | null
  }
  counts: AdoptionPlanCounts
  entries: AdoptionPlanEntry[]
}

export interface BuildAdoptionPlanOptions extends ProjectOwnerTableOptions {
  now?: string
}

function mapItemKindToDemandType(kind: ItemKind): DemandType {
  if (kind === 'bug' || kind === 'defect') return 'defect'
  if (kind === 'chore') return 'chore'
  return 'feature'
}

function decisionLabel(ref: string | null, subject: string): string {
  return ref !== null && ref.trim() !== '' ? `${ref} ("${subject}")` : `"${subject}"`
}

/**
 * Compute the content hash of a plan's immutable dry-run entries (independent of human resolutions).
 * Filling in `resolution` fields in the plan file preserves `planHash` and every entry's idempotency key.
 */
export function computeAdoptionPlanHash(
  entries: readonly Pick<
    AdoptionPlanEntry,
    'id' | 'class' | 'kind' | 'action' | 'element' | 'proposedWrite' | 'pendingOn'
  >[],
): string {
  const canonical = entries.map((e) => ({
    id: e.id,
    class: e.class,
    kind: e.kind,
    action: e.action,
    element: e.element,
    proposedWrite: e.proposedWrite,
    ...(e.pendingOn !== undefined ? { pendingOn: e.pendingOn } : {}),
  }))
  return computeHash(canonical)
}

/** Deterministic idempotency key stamped on every event written for a plan entry. */
export function adoptionEntryClientToken(planHash: string, entryId: string): string {
  return `adopt:${planHash}:${entryId}`
}

function extractEntries(
  qualified: QualifiedOwnerTableView,
  ctx: ReturnType<TrackReader['ownerTableContext']>,
): AdoptionPlanEntry[] {
  const entries: AdoptionPlanEntry[] = []
  const seenIds = new Set<string>()
  const pushUnique = (entry: AdoptionPlanEntry): void => {
    if (seenIds.has(entry.id)) return
    seenIds.add(entry.id)
    entries.push(entry)
  }

  const allExistingNums = [...ctx.view.registeredNumbers, ...ctx.view.archivedNumbers]
  let nextNumber = (allExistingNums.length > 0 ? Math.max(...allExistingNums) : 0) + 1

  // E1 — unnumbered demands and owner-request items (mechanical)
  for (const item of qualified.toAttach) {
    const existingDemand = ctx.state.demands.get(item.id)
    if (existingDemand !== undefined) {
      const assigned = nextNumber++
      pushUnique({
        id: `E1:number-demand:${existingDemand.id}`,
        class: 'E1',
        kind: 'mechanical',
        action: 'number-demand',
        element: { kind: 'demand', id: existingDemand.id },
        proposedWrite: {
          demandId: existingDemand.id,
          number: assigned,
        },
      })
      continue
    }
    const existingItem = ctx.state.items.get(item.id)
    if (existingItem !== undefined) {
      const assigned = nextNumber++
      const text =
        item.text.trim() !== ''
          ? item.text.trim()
          : (existingItem.report?.ownerSummary ?? existingItem.report?.ownerRequest ?? existingItem.title)
      pushUnique({
        id: `E1:reconstruct-demand:${existingItem.id}`,
        class: 'E1',
        kind: 'mechanical',
        action: 'reconstruct-demand',
        element: { kind: 'item', id: existingItem.id },
        proposedWrite: {
          itemId: existingItem.id,
          number: assigned,
          text,
          workspace: existingItem.workspace,
          type: mapItemKindToDemandType(existingItem.kind),
          transport: 'cli',
        },
      })
    }
  }

  // E2 — journal without active numbered demands (only when E1 does not already supply one)
  const hasE2 = qualified.gaps.some((g) => g.class === 'E2')
  if (hasE2 && qualified.toAttach.length === 0) {
    pushUnique({
      id: 'E2:raise-initial-demand',
      class: 'E2',
      kind: 'to-decide',
      action: 'raise-initial-demand',
      element: { kind: 'journal' },
      proposedWrite: { transport: 'cli' },
      question:
        'No active numbered demand exists in this journal. Supply { "text": "...", "workspace": "..." } to inscribe an initial demand (non capté), or raise one directly via CLI.',
      resolution: null,
    })
  }

  // E3 — row-level gaps (blocked without cause, or other row-level flags)
  const rowById = new Map(qualified.rows.map((r) => [r.id, r]))
  for (const gap of qualified.gaps) {
    if (gap.class !== 'E3' || gap.rowId === undefined) continue
    const row = rowById.get(gap.rowId)
    const rowNum = row?.num
    const cell = gap.cell ?? 'request'
    if (gap.check === 'row.blocked-no-cause') {
      pushUnique({
        id: `E3:set-blocked-cause:${gap.rowId}`,
        class: 'E3',
        kind: 'to-decide',
        action: 'set-blocked-cause',
        element: { kind: 'row', id: gap.rowId, ...(rowNum !== undefined ? { rowNum } : {}), cell: 'todo' },
        proposedWrite: { rowId: gap.rowId, ...(rowNum !== undefined ? { rowNum } : {}), cell: 'todo' },
        question: `Provide the blocking cause for blocked row #${rowNum ?? gap.rowId}. Supply { "cause": "..." }.`,
        resolution: null,
      })
    } else {
      const checkName = gap.check ?? 'structure'
      pushUnique({
        id: `E3:resolve-row-gap:${gap.rowId}:${checkName}:${cell}`,
        class: 'E3',
        kind: 'to-decide',
        action: 'resolve-row-gap',
        element: { kind: 'row', id: gap.rowId, ...(rowNum !== undefined ? { rowNum } : {}), cell },
        proposedWrite: { rowId: gap.rowId, ...(rowNum !== undefined ? { rowNum } : {}), check: checkName, cell },
        question: `Resolve row gap (${checkName}) on row #${rowNum ?? gap.rowId} cell "${cell}".`,
        resolution: null,
      })
    }
  }

  // E4, E5, E6, E9 — decision-level gaps
  const decisionById = new Map(qualified.decisions.map((d) => [d.id, d]))
  for (const gap of qualified.gaps) {
    if (gap.decisionId === undefined) continue
    const dec = decisionById.get(gap.decisionId)
    if (dec === undefined) continue
    const label = decisionLabel(dec.ref, dec.question)

    if (gap.class === 'E4') {
      pushUnique({
        id: `E4:attach-decision:${dec.id}`,
        class: 'E4',
        kind: 'to-decide',
        action: 'attach-decision',
        element: { kind: 'decision', id: dec.id, ref: dec.ref, subject: dec.question },
        proposedWrite: { decisionId: dec.id },
        question: `To which numbered row does decision ${label} belong? Supply { "rowNumber": <n> }.`,
        resolution: null,
      })
    } else if (gap.class === 'E5') {
      pushUnique({
        id: `E5:instruct-decision:${dec.id}`,
        class: 'E5',
        kind: 'to-decide',
        action: 'instruct-decision',
        element: { kind: 'decision', id: dec.id, ref: dec.ref, subject: dec.question },
        proposedWrite: { decisionId: dec.id },
        question: `Provide at least two options and a recommendation for decision ${label}. Supply { "options": [{ "id", "title", "summary" }, ...], "recommendation": { "optionId", "rationale" } }.`,
        resolution: null,
      })
    } else if (gap.class === 'E6') {
      pushUnique({
        id: `E6:attach-dossier:${dec.id}`,
        class: 'E6',
        kind: 'to-decide',
        action: 'attach-dossier',
        element: { kind: 'decision', id: dec.id, ref: dec.ref, subject: dec.question },
        proposedWrite: { decisionId: dec.id },
        question: `Provide the dossier link for decision ${label}. Supply { "dossierLink": "<path-or-uri>" }.`,
        resolution: null,
      })
    } else if (gap.class === 'E9') {
      pushUnique({
        id: `E9:number-decision:${dec.id}`,
        class: 'E9',
        kind: 'mechanical',
        action: 'number-decision',
        element: { kind: 'decision', id: dec.id, ref: dec.ref, subject: dec.question },
        proposedWrite: { decisionId: dec.id },
      })
    }
  }

  // E7 — masked texts on rows, unnumbered items, and decisions
  for (const row of qualified.rows) {
    for (const mask of row.masks) {
      pushUnique({
        id: `E7:rewrite-masked-text:row:${row.id}:${mask.cell}`,
        class: 'E7',
        kind: 'to-decide',
        action: 'rewrite-masked-text',
        element: { kind: 'row', id: row.id, rowNum: row.num, cell: mask.cell },
        proposedWrite: { targetKind: 'row', id: row.id, rowNum: row.num, cell: mask.cell, maskMotif: mask.motif },
        question: `Rewrite masked text (${mask.motif}) on row #${row.num} cell "${mask.cell}". Supply { "text": "..." }.`,
        resolution: null,
      })
    }
  }
  for (const item of qualified.toAttach) {
    if (item.maskMotif !== undefined) {
      pushUnique({
        id: `E7:rewrite-masked-text:row:${item.id}:request`,
        class: 'E7',
        kind: 'to-decide',
        action: 'rewrite-masked-text',
        element: { kind: 'row', id: item.id, cell: 'request' },
        proposedWrite: { targetKind: 'row', id: item.id, cell: 'request', maskMotif: item.maskMotif },
        question: `Rewrite masked text (${item.maskMotif}) on unnumbered demand ${item.id} cell "request". Supply { "text": "..." }.`,
        resolution: null,
      })
    }
  }
  for (const dec of qualified.decisions) {
    for (const [field, motif] of Object.entries(dec.masks)) {
      const label = decisionLabel(dec.ref, dec.question)
      pushUnique({
        id: `E7:rewrite-masked-text:decision:${dec.id}:${field}`,
        class: 'E7',
        kind: 'to-decide',
        action: 'rewrite-masked-text',
        element: { kind: 'decision', id: dec.id, ref: dec.ref, field, subject: dec.question },
        proposedWrite: { targetKind: 'decision', id: dec.id, field, maskMotif: motif },
        question: `Rewrite masked text (${motif}) on decision ${label} field "${field}". Supply { "text": "..." }.`,
        resolution: null,
      })
    }
  }

  // E8 — document desynchronisation findings
  for (const finding of ctx.desync) {
    pushUnique({
      id: `E8:resolve-desync:${finding.itemId}:${computeHash(finding.reason).slice(0, 12)}`,
      class: 'E8',
      kind: 'to-decide',
      action: 'resolve-desync',
      element: { kind: 'document', id: finding.itemId },
      proposedWrite: { itemId: finding.itemId, reason: finding.reason },
      question: `Resolve document desynchronisation for item ${finding.itemId}: ${finding.reason}`,
      resolution: null,
    })
  }

  return entries
}

/**
 * Pure read-only dry run: inspect the journal via the qualified reader (refusing G1–G3)
 * and return the adoption plan listing every mechanical and `to-decide` write.
 * Writes nothing to disk.
 */
export function buildAdoptionPlan(
  eventsPath: string,
  options: BuildAdoptionPlanOptions = {},
): AdoptionPlan {
  const trackDir = dirname(eventsPath)
  const resolvedPolicy = resolveOwnerTablePolicyFile({
    flagPolicyPath: options.policyPath,
    trackDir,
  })
  const projOpts: ProjectOwnerTableOptions = {
    ...options,
    ...(resolvedPolicy.defaultPolicyPath !== undefined
      ? { defaultPolicyPath: resolvedPolicy.defaultPolicyPath }
      : {}),
    statePolicyPath: resolvedPolicy.statePolicyPath,
    ...(resolvedPolicy.policyPath !== undefined ? { policyPath: resolvedPolicy.policyPath } : {}),
  }

  const reader = new TrackReader(eventsPath)
  const ctx = reader.ownerTableContext(projOpts)
  const qualified = buildQualifiedOwnerTable(ctx.view, {
    ...projOpts,
    mode: 'default',
    ...(options.now !== undefined ? { now: options.now } : {}),
    policyFound: ctx.policyFound,
    desyncFindings: ctx.desync,
    header: {
      ...(ctx.lastEventAt !== undefined ? { lastEventAt: ctx.lastEventAt } : {}),
    },
  })

  const entries = extractEntries(qualified, ctx)
  const planHash = computeAdoptionPlanHash(entries)
  const head = readHead(eventsPath)
  const lastContentHash =
    head?.lastContentHash ??
    (ctx.events.length > 0 ? ctx.events[ctx.events.length - 1]!.contentHash : null)

  const mechanical = entries.filter((e) => e.kind === 'mechanical').length
  const toDecide = entries.filter((e) => e.kind === 'to-decide').length
  const unresolved = entries.filter(
    (e) => e.kind === 'to-decide' && (e.resolution === undefined || e.resolution === null),
  ).length

  return {
    version: 1,
    planHash,
    baseline: {
      streamLength: ctx.events.length,
      lastContentHash,
    },
    counts: {
      total: entries.length,
      mechanical,
      toDecide,
      unresolved,
    },
    entries,
  }
}
