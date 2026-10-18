// DESIGN R4 (Lot 2) — `track audit` = a SEPARATE, DETERMINISTIC `AuditFinding[]` producer. NOT inlined in
// `buildDirectives` (which emits one WORK directive per WP node). Findings are STRUCTURAL facts derived
// purely from folded state — NO fuzzy naming heuristic (C7 cut as locale-sensitive noise). The actionable
// `orphan` hand-off routes via the PLAN flow, never a `commandHint`: `assertSafeCommandHint` forbids hinting
// `reparent`, so the audit can never hint its own fix (the reuse is the guard).

import { isRoleContainer, type ItemId, type ItemState } from '../model/item.js'
import type { State } from '../state/fold.js'
import type { Report } from './build.js'
import { assertSafeCommandHint } from './directive.js'
import { wpRootId } from './rollup.js'
import type { StatusCode } from './stage-status.js'

export type AuditFindingKind =
  | 'orphan'
  | 'empty-wp'
  | 'duplicate'
  | 'cross-workspace-subtree'
  | 'singleton-workspace'

/** `action` = a finding the plan flow should resolve; `info` = an expected/structural observation. */
export type AuditSeverity = 'action' | 'info'

export interface AuditFinding {
  kind: AuditFindingKind
  severity: AuditSeverity
  detail: string
  workspace?: string
  /** Single subject (orphan, empty-wp). */
  itemId?: ItemId
  /** A group (duplicate). */
  itemIds?: ItemId[]
  /** The top workpackage of a cross-workspace subtree. */
  wpRootId?: ItemId
  /** The distinct workspaces a cross-workspace subtree spans. */
  workspaces?: string[]
  /** Record-only, `assertSafeCommandHint`-guarded. NEVER a `reparent` (the fix routes via the plan flow). */
  commandHint?: string
}

const KIND_ORDER: Record<AuditFindingKind, number> = {
  orphan: 0,
  'empty-wp': 1,
  duplicate: 2,
  'cross-workspace-subtree': 3,
  'singleton-workspace': 4,
}

/** A stable sort key so two runs over the same state are byte-identical (determinism is the contract). */
function sortKey(f: AuditFinding): string {
  const primary = f.itemId ?? f.wpRootId ?? f.itemIds?.[0] ?? f.workspace ?? ''
  return `${KIND_ORDER[f.kind]}:${f.workspace ?? ''}:${primary}`
}

const isOpen = (i: ItemState): boolean => i.realization === 'to-do' || i.realization === 'in-progress'

/**
 * Produce the deterministic structural findings for the folded state. PURE; no clock, no I/O. The findings
 * are sorted by (kind, workspace, primary id) so the output never flickers.
 */
export function auditFindings(state: State): AuditFinding[] {
  const items = state.items
  const all = [...items.values()]
  const findings: AuditFinding[] = []

  // children index for transitive leaf walks.
  const childrenOf = new Map<ItemId | undefined, ItemState[]>()
  for (const item of all) {
    const list = childrenOf.get(item.parentId) ?? []
    list.push(item)
    childrenOf.set(item.parentId, list)
  }
  // Transitive TRUE leaves (non-container, no children) under a root — their workspaces, and the count.
  const transitiveLeaves = (rootId: ItemId): { count: number; workspaces: Set<string> } => {
    const workspaces = new Set<string>()
    let count = 0
    const walk = (id: ItemId): void => {
      for (const child of childrenOf.get(id) ?? []) {
        const kids = childrenOf.get(child.id) ?? []
        if (!isRoleContainer(child) && kids.length === 0) {
          count++
          workspaces.add(child.workspace)
        } else {
          walk(child.id) // descend through a container OR a non-leaf non-container
        }
      }
    }
    walk(rootId)
    return { count, workspaces }
  }

  // Which workspaces contain ≥1 workpackage (an orphan is meaningful only where WP structure is expected).
  const workspacesWithWp = new Set<string>()
  for (const i of all) if (i.role === 'workpackage') workspacesWithWp.add(i.workspace)

  // items per workspace (singleton detection).
  const perWorkspace = new Map<string, number>()
  for (const i of all) perWorkspace.set(i.workspace, (perWorkspace.get(i.workspace) ?? 0) + 1)

  // --- orphan: an OPEN, non-container leaf with no workpackage ancestor, in a WP-using workspace ---
  for (const i of all) {
    if (i.role !== undefined) continue // a container is never an orphan
    if (!isOpen(i)) continue
    if (!workspacesWithWp.has(i.workspace)) continue // no WP here ⇒ a top-level item is legitimate, not orphan
    if (wpRootId(items, i.id) !== undefined) continue // has a WP ancestor ⇒ homed
    findings.push({ kind: 'orphan', severity: 'action', itemId: i.id, workspace: i.workspace, detail: `open item "${i.title}" has no workpackage ancestor` })
  }

  // --- empty-wp / cross-workspace-subtree (per workpackage) ---
  for (const wp of all) {
    if (wp.role !== 'workpackage') continue
    const { count, workspaces } = transitiveLeaves(wp.id)
    if (count === 0) {
      findings.push({ kind: 'empty-wp', severity: 'action', itemId: wp.id, workspace: wp.workspace, detail: `workpackage "${wp.title}" has no leaf` })
    }
    // cross-workspace-subtree is reported once, on the TOP workpackage of the subtree (avoid sub-WP duplicates).
    if (workspaces.size > 1 && wpRootId(items, wp.id) === wp.id) {
      findings.push({
        kind: 'cross-workspace-subtree',
        severity: 'info',
        wpRootId: wp.id,
        workspace: wp.workspace,
        workspaces: [...workspaces].sort(),
        detail: `workpackage "${wp.title}" spans workspaces ${[...workspaces].sort().join(', ')}`,
      })
    }
  }

  // --- duplicate: exact (title, kind, workspace) ---
  const byTuple = new Map<string, ItemState[]>()
  for (const i of all) {
    const key = JSON.stringify([i.title, i.kind, i.workspace])
    const list = byTuple.get(key) ?? []
    list.push(i)
    byTuple.set(key, list)
  }
  for (const group of byTuple.values()) {
    if (group.length < 2) continue
    const itemIds = group.map((g) => g.id).sort()
    findings.push({ kind: 'duplicate', severity: 'action', itemIds, workspace: group[0]!.workspace, detail: `${group.length}× exact duplicate "${group[0]!.title}" (${group[0]!.kind})` })
  }

  // --- singleton-workspace (INFO: a new workspace legitimately starts at 1 item) ---
  for (const [workspace, n] of perWorkspace) {
    if (n === 1) findings.push({ kind: 'singleton-workspace', severity: 'info', workspace, detail: `workspace "${workspace}" holds a single item` })
  }

  for (const f of findings) assertSafeCommandHint(f.commandHint) // reuse the record-only allowlist guard
  return findings.sort((a, b) => sortKey(a).localeCompare(sortKey(b)))
}

// ---- auditStatusProposals (amendment D7) --------------------------------------
// Red carries a proposal, or the served report fails its audit. The proposal
// itself is investigated agent work of the same nature as criterion 20,
// carried by `prochaine action` and RECOMMANDATION; this deterministic layer
// only FLAGS — it never fabricates proposal text, and a green mechanical
// audit never certifies prose quality.

/** One served row for the red/blue audit: codes and recorded text, never prose to classify. */
export interface StatusProposalRow {
  id: string
  status: StatusCode
  /**
   * The recorded proposal text, if any. Opaque data: compared for equality
   * only (gate-clause echo, cross-row repetition), never classified.
   */
  proposal?: string
  /** Investigation and presence belong to the served report, never a stored assertion. */
  proposalState?: 'investigated' | 'to-instruct'
  inNextAction?: boolean
  inRecommendation?: boolean
  /** Machine gate-class phrases backing the row (the row's `gateStep`, never rendered words). */
  gateClauses?: readonly string[]
  /** Dossier refs the row cites (`D#`/`Q#` handle tokens, never prose). */
  dossierRefs?: readonly string[]
}

export interface StatusProposalAudit {
  /** Blocked rows lacking an investigated proposal (`missing-proposal`). */
  missingProposals: string[]
  /** Blue rows with no matching DÉCISIONS entry. */
  orphanBlue: string[]
  ok: boolean
}

/**
 * The mechanical half of D7. A proposal must be tagged as investigated on
 * the served report and present in both its action and recommendation. It
 * must be non-empty, not an exact echo of the row's own gate clause, and not a slogan
 * repeated verbatim across three or more rows. A generic instruction to
 * "handle red rows" fails exactly here when it parrots the gate class or the
 * other red rows. Anything subtler is prose quality — out of mechanical
 * reach by design.
 */
export function auditStatusProposals(
  rows: readonly StatusProposalRow[],
  decisionRefs: readonly string[],
): StatusProposalAudit {
  const proposals = rows
    .filter((row) => row.status === 'blocked' && row.proposal !== undefined && row.proposal.trim() !== '')
    .map((row) => row.proposal!)
  const counts = new Map<string, number>()
  for (const proposal of proposals) counts.set(proposal, (counts.get(proposal) ?? 0) + 1)
  const missingProposals = rows
    .filter((row) => {
      if (row.status !== 'blocked') return false
      const proposal = row.proposal?.trim() ?? ''
      if (proposal === '') return true
      if (row.proposalState !== 'investigated' || row.inNextAction !== true || row.inRecommendation !== true) return true
      if ((row.gateClauses ?? []).includes(row.proposal!)) return true
      return (counts.get(row.proposal!) ?? 0) > 2
    })
    .map((row) => row.id)
  const known = new Set(decisionRefs)
  const orphanBlue = rows
    .filter((row) =>
      row.status === 'decision-awaited' &&
      (row.dossierRefs ?? []).every((ref) => !known.has(ref)),
    )
    .map((row) => row.id)
  return { missingProposals, orphanBlue, ok: missingProposals.length === 0 && orphanBlue.length === 0 }
}

/** The served view surface the proposal audit reads: handles, todo rows, decision numbers. */
export interface StatusProposalView {
  handles: readonly { handle: string; id: string; kind: string }[]
  tables: readonly { id: string; rows: readonly Record<string, string>[]; lines?: readonly string[] }[]
  /** Filled by the contextual serving layer after investigating each red item. */
  proposals?: readonly { itemId: string; proposal: string; proposalState: 'investigated' | 'to-instruct' }[]
}

/**
 * Describe a served report (folded state + bucket rows + rendered view) as
 * red/blue audit rows. Row status comes from the derived report codes;
 * proposals and their instruction state from the served view; gate clauses
 * from the rows' machine-only `gateStep`; dossier refs from the `D#`/`Q#`
 * handle tokens the blocked cells cite. No natural language is matched, in
 * any language.
 */
export function describeStatusProposals(
  state: State,
  report: Report,
  view: StatusProposalView,
): { rows: StatusProposalRow[]; decisionRefs: string[] } {
  // Kept in the public signature for callers migrating from stored proposals.
  // Historical assertions cannot certify a current investigation.
  void state
  const todo = view.tables.find((table) => table.id === 'todo')
  // Item handles are positional `[row.item]` (1-based): the row part locates
  // the view row carrying the machine-only `gateStep` and the `bloqué` cell.
  const rowIndexById = new Map<string, number>()
  for (const handle of view.handles) {
    if (handle.kind !== 'item') continue
    const dot = handle.handle.indexOf('.')
    if (dot < 0) continue
    const rowIndex = Number(handle.handle.slice(0, dot)) - 1
    if (Number.isInteger(rowIndex) && rowIndex >= 0) rowIndexById.set(handle.id, rowIndex)
  }
  const gateSteps = new Map<string, string>()
  const blockedCells = new Map<string, string>()
  const actionCells = new Map<string, string>()
  for (const [id, rowIndex] of rowIndexById) {
    const row = todo?.rows[rowIndex]
    if (row === undefined) continue
    if (row['gateStep'] !== undefined && row['gateStep'] !== '') gateSteps.set(id, row['gateStep'])
    if (row['blocked'] !== undefined) blockedCells.set(id, row['blocked'])
    if (row['instruction'] === 'investigated' && row['actionOrigin'] === 'investigated' && row['nextAction'] !== undefined) {
      actionCells.set(id, row['nextAction'])
    }
  }
  const recommendation = view.tables.find(table => table.id === 'recommendation')
  const recommendationTexts = [
    ...(recommendation?.lines ?? []),
    ...(recommendation?.rows ?? []).flatMap(row => Object.values(row)),
  ]
  const rows: StatusProposalRow[] = []
  for (const bucket of ['AWAITED', 'DROPPED', 'DONE', 'TO-DO'] as const) {
    for (const row of report.buckets[bucket] ?? []) {
      if (row.status !== 'blocked' && row.status !== 'decision-awaited') continue
      const proposals = view.proposals?.filter(proposal => proposal.itemId === row.id) ?? []
      // D7 requires exactly one proposal per red item, even on grouped WP rows.
      const served = proposals.length === 1 ? proposals[0] : undefined
      rows.push({
        id: row.id,
        status: row.status,
        ...(served === undefined ? {} : {
          proposal: served.proposal,
          proposalState: served.proposalState,
          inNextAction: served.proposal.trim() !== '' && (actionCells.get(row.id) ?? '').includes(served.proposal),
          inRecommendation: served.proposal.trim() !== '' && recommendationTexts.some(text => text.includes(served.proposal)),
        }),
        ...(gateSteps.get(row.id) !== undefined ? { gateClauses: [gateSteps.get(row.id)!] } : {}),
        ...(row.status === 'decision-awaited'
          ? { dossierRefs: dossierRefsOf(blockedCells.get(row.id) ?? '') }
          : {}),
      })
    }
  }
  const decisions = view.tables.find((table) => table.id === 'decisions')
  const decisionRefs = (decisions?.rows ?? []).map((row) => row['n']).filter((ref) => ref !== undefined)
  return { rows, decisionRefs }
}

/** `D#`/`Q#` handle tokens cited by a blocked cell (handle grammar, never prose). */
function dossierRefsOf(blocked: string): string[] {
  const refs = blocked.match(/(?<![0-9A-Z])D\d+|(?<![0-9A-Z])Q\d+/gu)
  return refs === null ? [] : [...new Set(refs)]
}
