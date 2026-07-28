import { acceptanceStatus } from '../accept/status.js'
import type { ActorId } from '../events/types.js'
import type { AcceptanceStatus } from '../model/acceptance.js'
import { isStructuredDossier, type DecisionKind, type DossierArtifact, type Option, type Outcome } from '../model/decision.js'
import { isRoleContainer, type ItemId, type ItemKind, type ItemRole, type ItemState, type Realization } from '../model/item.js'
import type { State } from '../state/fold.js'
import { BUCKETS, bucketOf, type Bucket, type ReportConfig } from './buckets.js'
import { computeWpTree, type WpNode } from './rollup.js'

/**
 * focus-wp-enrichment (additive) — a short per-item DETAIL block for the focus card. It carries what a
 * consumer needs to show "more detail per item" WITHOUT re-reading the raw event log: a cleaned body
 * excerpt + the item's recette/acceptance state rendered `en clair`. The machine acceptance stays on
 * `ReportRow.acceptance` (unchanged) — this block is the render-ready human view of the same fact.
 */
export interface ReportRowDetail {
  /** A cleaned, one-line, capped excerpt of the item `body`/summary (present iff a non-empty body exists). */
  summary?: string
  /** The item's acceptance/recette state rendered `en clair` in FR (the report locale) — render-ready. */
  acceptanceLabel: string
}

export interface ReportRow {
  id: ItemId
  title: string
  kind: ItemKind
  workspace: string
  bucket: Bucket
  realization: Realization
  acceptance: AcceptanceStatus
  priority?: number
  accountable?: ActorId // RACI-A (Lot A) — surfaced for "who is answerable for this item"
  engagementRef?: string // present ⇒ an h2a contract backs this item
  role?: ItemRole // present ⇒ a workpackage (Workpackages §2) — excluded from the flat buckets
  /**
   * focus-wp-enrichment (additive) — the item's OWNING workpackage: the id of the NEAREST role-container
   * ancestor (workpackage / spec-phase / stream), IDENTICAL to the matching directive's `scope.wpId`. It is
   * derived by walking the item's OWN ancestry, so it is available for EVERY bucket (DONE/DROPPED included),
   * not only the open items the directive set covers. Drop-when-absent (an item outside any WP forest).
   */
  wpId?: ItemId
  /**
   * focus-wp-enrichment (additive) — the OWNING workpackage's derived DISPLAY label (positional `WP<n>` /
   * dotted `WP1.2` / `S<n>` / an assigned `code`), byte-identical to the directive's `scope.wpLabel` and the
   * rendered WP tree (it is READ from `computeWpTree`, never re-derived here). Drop-when-absent (no WP).
   */
  wpLabel?: string
  /** focus-wp-enrichment (additive) — the per-item detail block (body excerpt + recette state en clair). */
  detail: ReportRowDetail
}

export interface DecisionRow {
  id: ItemId
  title: string
  workspace: string
  decisionKind: DecisionKind
  realization: Realization
  outcome: Outcome
  /** True only when options + recommendation are recorded in the native dossier model. */
  structured?: boolean
  accountable?: ActorId // the decision sponsor (D6)
  optionCount?: number
  openQuestionCount?: number
  hasRecommendation?: boolean
  /**
   * Whether this decision can be rendered as choices + recommendation without parsing its prose context.
   * Existing prose-only dossiers are deliberately `unstructured`: the reader must not invent alternatives.
   */
  structure?: 'structured' | 'unstructured'
  options?: Option[]
  recommendation?: { optionId: string; rationale: string }
  selectedOptionId?: string
  // M5 (additive) — record-only pointers to an h2a decision dossier / rendered view / mockup, the read
  // surface the DS render consumes. Present iff the decision has appended artifacts.
  artifacts?: DossierArtifact[]
}

export interface Report {
  buckets: Record<Bucket, ReportRow[]>
  decisions?: DecisionRow[]
  /** Workpackages §2 — the %-by-WP rollup forest. Present iff `ReportOptions.wpTree` (additive, opt-in). */
  wpTree?: WpNode[]
  /**
   * Bucket rows not represented by a WP leaf. This includes items outside a WP and non-WP intermediate
   * items that a leaf-only rollup intentionally descends through. Keeping them explicit makes the conductor
   * global total reconcile with the flat buckets instead of silently losing work.
   */
  outsideRollup?: ReportRow[]
}

export interface ReportOptions {
  baselineCommit: string
  requireAccepted?: boolean
  decisions?: boolean
  /** Include the WP rollup forest on `report.wpTree` (Workpackages §2). Absent ⇒ unchanged behavior. */
  wpTree?: boolean
  /**
   * WP-codes A3 (DESIGN §A3) — RENDER-ONLY display option, IGNORED by `buildReport`/`computeWpTree` (which
   * always keep ALL roots so the `WP<n>` ordinals stay POSITIONALLY stable). Consumed by the renderer
   * (`reportText`): when `true`, the human TEXT/MD roster OMITS terminal (DROPPED) ROOTS WITHOUT renumbering
   * the survivors (a gap appears). Absent/false ⇒ byte-identical to today. The JSON contract is UNAFFECTED —
   * it always carries the full forest + per-node `terminal` flag for a machine consumer to filter itself.
   */
  activeRoster?: boolean
}

// focus-wp-enrichment — FR gloss of every acceptance/recette state (the report locale). A Record over the
// full `AcceptanceStatus` union so a new enum value is a compile error here (never a silent `undefined`).
const ACCEPTANCE_FR: Record<AcceptanceStatus, string> = {
  pass: 'recette OK',
  fail: 'recette en échec',
  stale: 'recette obsolète (à rejouer)',
  waived: 'recette dérogée',
  unknown: 'recette non évaluée',
  'n/a': 'sans recette',
}

const BODY_EXCERPT_MAX = 200

/**
 * focus-wp-enrichment — a cleaned, one-line, capped excerpt of an item body: collapse every control char /
 * whitespace run to a single space, trim, then cap at `BODY_EXCERPT_MAX` with a trailing ellipsis. Returns
 * `undefined` for an absent/blank body (drop-when-absent on `detail.summary`). Local (no render-layer import).
 */
function bodyExcerpt(body: string | undefined): string | undefined {
  if (body === undefined) return undefined
  let out = ''
  let prevSpace = false
  for (const ch of body) {
    const code = ch.codePointAt(0) ?? 0
    const isSpace = code < 0x20 || code === 0x7f || code === 0x2028 || code === 0x2029 || ch === ' '
    if (isSpace) {
      if (!prevSpace) {
        out += ' '
        prevSpace = true
      }
    } else {
      out += ch
      prevSpace = false
    }
  }
  const trimmed = out.trim()
  if (trimmed.length === 0) return undefined
  return trimmed.length <= BODY_EXCERPT_MAX ? trimmed : `${trimmed.slice(0, BODY_EXCERPT_MAX - 1)}…`
}

/**
 * focus-wp-enrichment — the container-id → derived-label map READ from a computed WP forest. Every
 * role-container (root OR nested sub-node) is a `WpNode`, so this covers the whole forest. Reusing the
 * tree's labels (never re-deriving) keeps a row's `wpLabel` byte-identical to the directive/tree label.
 */
function containerLabels(tree: readonly WpNode[]): Map<ItemId, string> {
  const map = new Map<ItemId, string>()
  const walk = (n: WpNode): void => {
    map.set(n.id, n.label)
    for (const c of n.children) walk(c)
  }
  for (const n of tree) walk(n)
  return map
}

/**
 * focus-wp-enrichment — the item's OWNING workpackage: the NEAREST role-container ancestor id, walking
 * `parentId` (the row's item is never itself a container — `buildReport` excludes those). This is exactly
 * the node `directLeaves`/`buildDirectives` attach the leaf to, so `wpId` matches the directive `scope.wpId`.
 * Available for EVERY item (any bucket) since it reads the item's own ancestry. O(depth), cycle-guarded.
 * Returns `undefined` for an item with no role-container ancestor (outside any WP forest).
 */
function owningWpId(items: Map<ItemId, ItemState>, itemId: ItemId): ItemId | undefined {
  const seen = new Set<ItemId>()
  let cursor = items.get(itemId)?.parentId
  while (cursor !== undefined && !seen.has(cursor)) {
    seen.add(cursor)
    const it = items.get(cursor)
    if (it === undefined) break
    if (isRoleContainer(it)) return cursor
    cursor = it.parentId
  }
  return undefined
}

function toRow(state: State, item: ItemState, config: ReportConfig, labels: Map<ItemId, string>): ReportRow {
  const acceptance = acceptanceStatus(state, item.id, config.baselineCommit)
  const wpId = owningWpId(state.items, item.id)
  const wpLabel = wpId !== undefined ? labels.get(wpId) : undefined
  const summary = bodyExcerpt(item.body)
  return {
    id: item.id,
    title: item.title,
    kind: item.kind,
    workspace: item.workspace,
    bucket: bucketOf(state, item, config),
    realization: item.realization,
    acceptance,
    ...(item.priority !== undefined ? { priority: item.priority.score } : {}),
    ...(item.accountable !== undefined ? { accountable: item.accountable } : {}),
    ...(item.engagementRef !== undefined ? { engagementRef: item.engagementRef } : {}),
    ...(item.role !== undefined ? { role: item.role } : {}),
    // focus-wp-enrichment (additive) — WP attribution for EVERY bucket + a render-ready detail block.
    ...(wpId !== undefined ? { wpId } : {}),
    ...(wpLabel !== undefined ? { wpLabel } : {}),
    detail: {
      ...(summary !== undefined ? { summary } : {}),
      acceptanceLabel: ACCEPTANCE_FR[acceptance],
    },
  }
}

// Active prioritization scheme: higher score first; un-prioritized items after; stable by id.
function byPriority(
  a: ReportRow,
  b: ReportRow,
  compareIds: (a: string, b: string) => number = (left, right) => left.localeCompare(right),
): number {
  if (a.priority !== undefined && b.priority !== undefined) {
    return b.priority - a.priority || compareIds(a.id, b.id)
  }
  if (a.priority !== undefined) return -1
  if (b.priority !== undefined) return 1
  return compareIds(a.id, b.id)
}

/** Build the bucketed report over non-decision items (SPEC §7). `decisions:true` adds the decision view. */
export function buildReport(
  state: State,
  options: ReportOptions,
  compareIds: (a: string, b: string) => number = (a, b) => a.localeCompare(b),
): Report {
  const config: ReportConfig = {
    baselineCommit: options.baselineCommit,
    requireAccepted: options.requireAccepted ?? false,
  }
  // focus-wp-enrichment — compute the WP forest ONCE: it supplies both the additive per-row WP labels
  // (via `toRow` below) and the optional `report.wpTree`. The derived labels (positional `WP<n>`/dotted/
  // codes/streams) live ONLY in `computeWpTree`, so reading them here keeps a row's `wpLabel` byte-identical
  // to the directive's `scope.wpLabel` and the rendered tree — no second, drift-prone derivation.
  const tree = computeWpTree(state, config, compareIds)
  const labels = containerLabels(tree)
  const buckets: Record<Bucket, ReportRow[]> = { AWAITED: [], DROPPED: [], DONE: [], 'TO-DO': [] }
  for (const item of state.items.values()) {
    // Workpackages §2 / Scope §B(a) — a WP or spec-phase is a container, not a leaf: keep it out of the
    // flat buckets entirely so it can never be mis-counted as a TO-DO leaf (the false-% bug the design
    // warns about). The container forest is surfaced separately on `report.wpTree`.
    if (isRoleContainer(item)) continue
    const row = toRow(state, item, config, labels)
    buckets[row.bucket].push(row)
  }
  for (const bucket of BUCKETS) buckets[bucket].sort((a, b) => byPriority(a, b, compareIds))

  const report: Report = { buckets }
  if (options.wpTree) {
    const represented = new Set<ItemId>()
    const collectLeaves = (nodes: readonly WpNode[]): void => {
      for (const node of nodes) {
        for (const leaf of node.leaves) represented.add(leaf.id)
        collectLeaves(node.children)
      }
    }
    collectLeaves(tree)
    const outsideRollup = BUCKETS.flatMap((bucket) => buckets[bucket]).filter((row) => !represented.has(row.id))
    report.wpTree = tree
    if (outsideRollup.length > 0) report.outsideRollup = outsideRollup
  }
  if (options.decisions) {
    report.decisions = [...state.decisions.values()].map((d) => {
      const structured = isStructuredDossier(d.dossier)
      return {
        id: d.id,
        title: d.title,
        workspace: d.workspace,
        decisionKind: d.decisionKind,
        realization: d.realization,
        outcome: d.outcome,
        structured,
        structure: structured ? 'structured' : 'unstructured',
        ...(d.accountable !== undefined ? { accountable: d.accountable } : {}),
        optionCount: d.dossier.options.length,
        openQuestionCount: d.dossier.qa.filter((q) => q.answer === undefined || q.answer.trim() === '').length,
        hasRecommendation: d.dossier.recommendation !== undefined,
        ...(structured
          ? {
              options: d.dossier.options,
              recommendation: d.dossier.recommendation!,
              ...(d.dossier.selectedOptionId !== undefined ? { selectedOptionId: d.dossier.selectedOptionId } : {}),
            }
          : {}),
        ...(d.dossier.artifacts !== undefined ? { artifacts: d.dossier.artifacts } : {}),
      }
    })
  }
  return report
}

export interface QueryFilter {
  // `query` projects the non-decision report rows; filtering by `'decision'` is a compile error
  // (use `report({decisions:true})` for the decision view).
  kind?: Exclude<ItemKind, 'decision'>
  workspace?: string
  bucket?: Bucket
  realization?: Realization
  acceptance?: AcceptanceStatus
  /** Workpackages §2 — select container items. Without it, WP items stay EXCLUDED (unchanged behavior). */
  role?: ItemRole
}

/** Flat, filtered view over the report rows (SPEC §6 `query`). */
export function query(state: State, filter: QueryFilter, options: ReportOptions): ReportRow[] {
  // Source rows in the SAME bucket order as before (each bucket internally priority-sorted) so existing
  // query results are byte-identical. WP containers are excluded from the buckets; a `role` filter
  // reaches them via a separate, priority-sorted projection appended after the bucket rows.
  const report = buildReport(state, options)
  let rows = BUCKETS.flatMap((bucket) => report.buckets[bucket])
  if (filter.role !== undefined) {
    const config: ReportConfig = {
      baselineCommit: options.baselineCommit,
      requireAccepted: options.requireAccepted ?? false,
    }
    // focus-wp-enrichment — a container row is enriched via its OWN owning ancestor (its parent WP), so it
    // needs the same forest label map. Computed here for the (rare) role-filter branch; the bucket rows above
    // already came enriched from `buildReport`.
    const labels = containerLabels(computeWpTree(state, config))
    const wpRows = [...state.items.values()]
      .filter((i) => i.role !== undefined)
      .map((i) => toRow(state, i, config, labels))
      .sort(byPriority)
    rows = [...rows, ...wpRows]
  }
  return rows.filter(
    (r) =>
      (filter.role === undefined || r.role === filter.role) &&
      (filter.kind === undefined || r.kind === filter.kind) &&
      (filter.workspace === undefined || r.workspace === filter.workspace) &&
      (filter.bucket === undefined || r.bucket === filter.bucket) &&
      (filter.realization === undefined || r.realization === filter.realization) &&
      (filter.acceptance === undefined || r.acceptance === filter.acceptance),
  )
}
