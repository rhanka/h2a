// Scope §A/§B — `status(level)` projection: a generalization of `computeWpTree`+`bucketOf` over the
// scope tiers {spec, plan, wp, lot, task}. ADDITIVE + READ-ONLY: it adds NO aggregate and NO stored
// status axis — it is a pure re-grouping of the SAME leaf buckets the report already computes.
//
//   task            = the leaf bucket (each non-WP leaf is its own group).
//   wp              = the existing role:'workpackage'+parentId rollup (≡ every computeWpTree node).
//   lot|plan|spec   = the SAME rollup over tiers derived from WP-NESTING DEPTH: a ROOT WP is the
//                     plan/spec tier; a nested sub-WP is the wp/lot tier.
//
// Group rollup (over a tier node's TRANSITIVE non-WP leaves): AWAITED if any ACTIVE descendant is
// awaited; else DONE if all active are done; else DROPPED if only dropped remain; else TO-DO. Counts
// done/active/dropped/pct via the shared `tally()` (SUM of leaves, never mean-of-pcts); dropped excluded
// from the denominator; 0/0 ⇒ 'n/a'. Reuses `bucketOf`/`tally`/the WP-forest shape verbatim.

import { isRoleContainer, type ItemId, type ItemState } from '../model/item.js'
import type { State } from '../state/fold.js'
import { bucketOf, type Bucket, type ReportConfig } from './buckets.js'
import { buildWpLeaf, computeWpTree, tally, type WpLeaf } from './rollup.js'

export type StatusLevel = 'spec' | 'plan' | 'wp' | 'lot' | 'task'
export const STATUS_LEVELS: readonly StatusLevel[] = ['spec', 'plan', 'wp', 'lot', 'task']

/** The rolled-up status of a tier/leaf group — the group analogue of a leaf `Bucket`. */
export type GroupStatus = Bucket

/** One status group at the requested level — a tier WP (or a single leaf for `task`). */
export interface StatusGroup {
  id: ItemId
  title: string
  /** Conductor label (assigned code when present, otherwise derived dotted code); the leaf id for `task`. */
  label: string
  /** The WP-nesting depth (root WP = 0); `task` groups carry the depth of their nearest WP ancestor + 1. */
  depth: number
  status: GroupStatus
  done: number
  active: number
  dropped: number
  pct: number | 'n/a'
}

// A CONTAINER node (workpackage OR spec-phase) — descended through, never a leaf (Scope §B(a)).
const isWp = (item: ItemState): boolean => isRoleContainer(item)

/** Roll a set of leaf buckets up to a group status (first match wins, mirroring `bucketOf` precedence). */
function rollupStatus(leaves: readonly WpLeaf[], emptyStatus: GroupStatus): GroupStatus {
  if (leaves.length === 0) return emptyStatus
  if (leaves.some((l) => l.bucket === 'AWAITED')) return 'AWAITED'
  const active = leaves.filter((l) => l.bucket !== 'DROPPED')
  if (active.length === 0) return 'DROPPED' // only dropped remain
  if (active.every((l) => l.bucket === 'DONE')) return 'DONE'
  return 'TO-DO'
}

/**
 * Project the folded state into status groups at `level`. Pure; the same `config.baselineCommit` that
 * drives `bucketOf`/AWAITED governs here (no new boundary).
 */
export function statusByLevel(state: State, level: StatusLevel, config: ReportConfig): StatusGroup[] {
  const items = [...state.items.values()]
  // children index: parentId → direct children (id-sorted for deterministic labels/order — same as rollup).
  const childrenOf = new Map<ItemId | undefined, ItemState[]>()
  for (const item of items) {
    const list = childrenOf.get(item.parentId) ?? []
    list.push(item)
    childrenOf.set(item.parentId, list)
  }
  for (const list of childrenOf.values()) list.sort((a, b) => a.id.localeCompare(b.id))

  // Every NON-WP leaf TRANSITIVELY under `node` (descending THROUGH nested sub-WPs — a tier node owns all
  // its descendants' leaves; SUM, not mean). A non-WP container (a feature with chore children) is descended.
  const transitiveLeaves = (node: ItemId): WpLeaf[] => {
    const out: WpLeaf[] = []
    const walk = (parentId: ItemId): void => {
      for (const child of childrenOf.get(parentId) ?? []) {
        if (isWp(child)) {
          walk(child.id) // descend INTO the sub-WP — its leaves still count at this ancestor tier
          continue
        }
        const grandkids = childrenOf.get(child.id) ?? []
        if (grandkids.length === 0) {
          out.push(buildWpLeaf(state, child, config))
        } else {
          walk(child.id) // non-WP container — descend
        }
      }
    }
    walk(node)
    return out
  }

  const groupOf = (wp: ItemState, label: string, depth: number): StatusGroup => {
    const leaves = transitiveLeaves(wp.id)
    const { done, active, dropped } = tally(leaves)
    return {
      id: wp.id,
      title: wp.title,
      label,
      depth,
      status: rollupStatus(leaves, bucketOf(state, wp, config)),
      done,
      active,
      dropped,
      pct: active === 0 ? 'n/a' : Math.round((done / active) * 100),
    }
  }

  // ---- task: every non-WP leaf is its own group (the leaf bucket as a 1-leaf rollup). ----
  if (level === 'task') {
    const out: StatusGroup[] = []
    const walkLeaves = (parentId: ItemId | undefined, depth: number): void => {
      for (const child of childrenOf.get(parentId) ?? []) {
        if (isWp(child)) {
          walkLeaves(child.id, depth + 1)
          continue
        }
        const grandkids = childrenOf.get(child.id) ?? []
        if (grandkids.length === 0) {
          const leaf: WpLeaf = buildWpLeaf(state, child, config)
          const { done, active, dropped } = tally([leaf])
          out.push({
            id: child.id,
            title: child.title,
            label: child.id,
            depth,
            status: leaf.bucket,
            done,
            active,
            dropped,
            pct: active === 0 ? 'n/a' : Math.round((done / active) * 100),
          })
        } else {
          walkLeaves(child.id, depth)
        }
      }
    }
    walkLeaves(undefined, 0)
    return out
  }

  // ---- WP-tier levels: flatten the actual WP forest, not a second labelling implementation. ----
  // `computeWpTree` owns assigned-code handling and the mixed coded/derived ordinal reservation. Reusing
  // its labels makes `status --level wp` identity-compatible with the conductor even when only some WPs
  // have durable codes; an independent counter silently gave one label two meanings.
  const all: Array<{ wp: ItemState; label: string; depth: number }> = []
  const visit = (node: ReturnType<typeof computeWpTree>[number], depth: number): void => {
    const wp = state.items.get(node.id)
    if (wp !== undefined) all.push({ wp, label: node.label, depth })
    for (const child of node.children) visit(child, depth + 1)
  }
  for (const node of computeWpTree(state, config)) visit(node, 0)

  // Level → which depth tier. `wp` = ALL WP nodes (≡ computeWpTree). `spec`/`plan` = the ROOT tier
  // (depth 0). `lot` = the next nested tier (depth 1); deeper sub-WPs also surface as their own `lot`
  // groups (a lot may nest), matching the rollup's "every nested sub-WP is a node".
  const selected =
    level === 'wp'
      ? all
      : level === 'spec' || level === 'plan'
        ? all.filter((n) => n.depth === 0)
        : all.filter((n) => n.depth >= 1) // 'lot' — the nested-WP tier(s)

  return selected.map((n) => groupOf(n.wp, n.label, n.depth))
}
