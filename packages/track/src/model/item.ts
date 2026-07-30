import type { ActorId, Ulid } from '../events/types.js'
import type { PriorityAssessment } from './priority.js'

export type ItemId = Ulid
export type BlockerId = Ulid

// `'defect'` is ADDITIVE (demand-lifecycle Mode A): a defect demand promotes into a `kind:'defect'` item.
// Additive to the enum — pre-demand logs never carry it, so it changes no existing event/hash/bucket.
//
// `bug` vs `defect` — kept DISTINCT (rule):
//   - `defect`  = promoted from a `DemandType:'defect'` demand (carries the `concerns` regression back-link;
//                 reachable ONLY via demand promotion (`agreeDemand`), NEVER a direct `item.create`).
//   - `bug`     = the legacy ad-hoc kind (a direct create with no demand parent).
//   The `bug`→`defect` deprecation/merge is DEFERRED to a later lot. (See demand-lifecycle-modeA-DESIGN §Type.)
//   `defect` is intentionally promotion-only ⇒ it is NOT in the ingest `ITEM_KINDS` / MCP direct-create enums.
export type ItemKind = 'feature' | 'bug' | 'chore' | 'decision' | 'defect'
/**
 * An optional, additive container marker (Workpackages design §2; Scope §B(a)). A workpackage is
 * `kind:'chore'` + `role:'workpackage'` — WP-ness comes ONLY from this field, never inferred from kind,
 * children, a `wp:` sourceKey, or a link. A `'spec-phase'` is a finer container nested under a WP or
 * spec-phase (labels derive from tree position; the rollup descends through it like a WP). Both are
 * orthogonal/optional like `accountable`/`engagementRef` ⇒ zero hash change, explicit, queryable,
 * rename-stable. (A durable public `code?` label is deferred.)
 */
// A2 (DESIGN wp-codes-and-stream-role §A2) — `'stream'` is a THIRD container category: an EPIC ABOVE the
// workpackage. Like the other two it is a CONTAINER (descended through, excluded from leaf counts/flat
// buckets), but — UNLIKE `workpackage` — it is NOT numbered `WP<n>`: the rollup labels it on a SEPARATE
// derived `S<n>` sequence (or its A1 `code`, verbatim, when present). So the 3 categories no longer alias
// "isRoleContainer == WP-numbered": (a) `spec-phase` container, NOT WP-numbered; (b) `workpackage`,
// `WP<n>`/code; (c) `stream`, `S<n>`/code. A `stream` is NEVER a `wpRoot` (that stays STRICT workpackage).
export type ItemRole = 'workpackage' | 'spec-phase' | 'stream'

/**
 * Scope §B(a) — a declarative scope on a WP/spec-phase: INERT path globs (track stores the strings,
 * NEVER matches them — the harness reads them to compute the path verdict). Additive/optional on
 * ItemState + ItemCreatedPayload; set/replaced by a `scope.declare` WorkEvent → `scope.declared` event.
 */
export interface ScopeDecl {
  allowed?: string[]
  forbidden?: string[]
  conditional?: string[]
}
export type SpecStatus = 'to-specify' | 'specified'
export type Realization = 'to-do' | 'in-progress' | 'done' | 'cancelled' | 'rejected'

// Decision gates an Item passes (SPEC §2.10). `Gate` doubles as a Decision's `decisionKind`.
export type Gate = 'orientation' | 'commitment'
export type Disposition = 'required' | 'skipped' | 'not-applicable' | 'completed'

export interface Link {
  kind: string
  locator: string
}

/** A realization → `rejected` is the consequence of a `no-go` Decision (SPEC §2.3, §2.6). */
export interface RealizationCause {
  decisionId: ItemId
}

/**
 * Regression expression (decision 01KYQ5RRN67190YMZ08EGGBSBT, owner GO on option A, 2026-07-29) — WHY a
 * closed item is being reopened. The two motives are the two ways a closure can be wrong:
 *   - `closed-without-owner-uat` — the closure rested on a technical recipe the owner never validated;
 *   - `regression-observed`      — the capability WAS delivered and is now broken.
 * The motive is RECORDED, never verified: track has no owner-UAT marker today, so it cannot prove a closure
 * lacked one (that marker is a separate item). The guarantee here is that a reopening cannot be MOTIVE-LESS.
 */
export const REOPEN_MOTIVES = ['closed-without-owner-uat', 'regression-observed'] as const
export type ReopenMotive = (typeof REOPEN_MOTIVES)[number]

/** The two terminal realizations a reopening corrects. `rejected` is NOT one of them — it is the
 *  consequence of a `no-go` Decision, so it is undone by revising that decision, never by a reopening. */
export type ReopenableRealization = Extract<Realization, 'done' | 'cancelled'>

/**
 * One recorded reopening, folded onto the item in stream order (the trace IS the value — nothing is
 * erased: the closure it corrects stays in the log, and so does every prior reopening). `from` is the
 * terminal realization this reopening corrected; `at`/`by` come from the event frame, not the payload.
 */
export interface ReopenRecord {
  from: ReopenableRealization
  motive: ReopenMotive
  reason: string
  at: string
  by: ActorId
}

/** The `realization.reopened` payload (the WHAT; `at`/`by`/`from` are not producer-supplied). */
export interface ReopenPayload {
  itemId: ItemId
  motive: ReopenMotive
  reason: string
}

export interface ItemState {
  id: ItemId
  kind: ItemKind
  title: string
  workspace: string
  specStatus: SpecStatus | 'n/a' // `n/a` for kind:"decision" (SPEC §2.2)
  realization: Realization
  disposition: Record<Gate, Disposition> // per-gate disposition (SPEC §2.10)
  priority?: PriorityAssessment // latest assessment, live sort key (SPEC §2.8)
  parentId?: ItemId
  role?: ItemRole // additive container marker (Workpackages §2); present ⇒ a workpackage / spec-phase
  /**
   * WP-codes (DESIGN wp-codes A1) — a DURABLE, re-assignable DISPLAY label for a role-container (WP/
   * spec-phase) that DECOUPLES stability from the derived `WP<n>` numbering. Additive/optional; set/
   * replaced by an `item.code-assigned` event (LWW). Present ⇒ the rollup renders this code verbatim
   * instead of the positional `WP<n>`. A code is NEVER an identity/ref (`wpRootId`/`wpRef`/objective-refs
   * stay ULID) — it is a render label only. Absent ⇒ byte-identical to the pre-codes behavior.
   */
  code?: string
  scope?: ScopeDecl // Scope §B(a) — declarative INERT path globs on a WP/spec-phase (track never matches)
  sourceKey?: string
  body?: string
  links?: Link[]
  // RACI (Lot A, additive): WHO is answerable/doing — domain data about the work, distinct from
  // the event writer `by` (which the ingest seam pins to the channel). `engagementRef` links to an
  // h2a ENGAGEMENT (the executable contract); present ⇒ a contract exists. track records, never owns it.
  accountable?: ActorId // RACI-A — the single neck-to-grab
  responsible?: ActorId[] // RACI-R — the doers
  engagementRef?: string
  /**
   * Acceptance-freshness lifecycle — the item's realization ANCHOR commit (the SHA its work landed at, or
   * the merge commit after consolidation). A READ-ONLY DETAIL the freshness projection consumes (run-SHA vs
   * anchor-SHA); it does NOT touch AcceptanceStatus/buckets/gates (those stay strict-against-baselineCommit).
   * Set by the `realization.anchored` event (LAST-write-wins); absent ⇒ no anchor (fall back to baseline).
   */
  realizedCommit?: string
  /**
   * Demand lifecycle (Mode A, additive) — the parent `demand` this item was PROMOTED from at `agreed`.
   * Set by `item.created{demandId}` (the atomic promotion batch); absent on every directly-created item
   * (canonicalize drops undefined ⇒ a pre-demand item.created hashes byte-identical). A stable back-link
   * for the demand→item read trace.
   */
  demandId?: Ulid // = DemandId; kept as the foundational Ulid to avoid an item↔demand model import cycle
  /**
   * Regression expression — every recorded reopening of this item, in stream order (see {@link ReopenRecord}).
   * Drop-when-absent: an item that was never reopened carries no field, so a pre-reopen log folds
   * byte-identically. READ-ONLY detail: the realization axis itself is folded by the reopening event.
   */
  reopenings?: ReopenRecord[]
}

/**
 * Scope §B(a) / A2 — is this item a CONTAINER node (a `workpackage`, `spec-phase`, OR `stream`), i.e. not
 * a flat leaf? The rollup descends through all three and excludes all three from leaf counts / the flat
 * buckets. Centralized so rollup/status/report/read all share ONE definition of "container vs leaf".
 * NOTE (A2): "container" is DECOUPLED from "WP-numbered" — a `stream` is a container but is numbered `S<n>`,
 * not `WP<n>` (the numbering partition lives in `computeWpTree`/`statusByLevel`, NOT here).
 */
export function isRoleContainer(item: { role?: ItemRole }): boolean {
  return item.role === 'workpackage' || item.role === 'spec-phase' || item.role === 'stream'
}

export interface ItemCreatedPayload {
  kind: ItemKind
  title: string
  workspace: string
  parentId?: ItemId
  role?: ItemRole
  scope?: ScopeDecl // Scope §B(a) — INERT path globs on a WP/spec-phase
  sourceKey?: string
  body?: string
  links?: Link[]
  accountable?: ActorId
  responsible?: ActorId[]
  engagementRef?: string
  /**
   * Demand lifecycle (Mode A, additive) — the parent `demand` this item is promoted from (set ONLY by the
   * atomic `agreeDemand` batch). Absent on a directly-created item ⇒ canonicalize drops it ⇒ byte-identical.
   */
  demandId?: Ulid
}

/**
 * The RACI subset of `ItemCreatedPayload`, reused verbatim for an existing-item update. An omitted axis
 * means "no assertion about that axis", so it is preserved rather than cleared; a clear needs an explicit,
 * unambiguous future wire shape instead of silently deleting a recorded governance assignment.
 */
export type ItemRaciUpdate = Pick<ItemCreatedPayload, 'accountable' | 'responsible'>

/**
 * Demand lifecycle (Mode A, additive) — the optional WHO-is-handling fields carried on a spec/realization
 * transition payload. `handler` = the h2a instance id (DISTINCT from the channel `by`/`prov.principal`);
 * `leaseId` correlates to the ephemeral lease (Build 2). Both drop-when-absent ⇒ a pre-demand transition
 * hashes byte-identical (the additive invariant). Folded into NO new state field in Build 1 (handler logging
 * is reconstructed from the raw log by the read surface — the demand sibling of amendmentTrace).
 */
export interface TransitionHandlerFields {
  handler?: ActorId
  leaseId?: string
}

/** A rejected domain command (illegal transition, unknown aggregate, …). */
export class DomainError extends Error {
  override name = 'DomainError'
}

/**
 * Scope §B(a) / A2 — the role nesting invariant, checked by createItem/reparentItem/setRole BEFORE any
 * append:
 *   - a `'workpackage'` nests only under a `'workpackage'` OR a `'stream'` (A2: an epic may own WPs);
 *   - a `'spec-phase'` nests only under a `'workpackage'` or `'spec-phase'`;
 *   - a `'stream'` nests only at ROOT or under another `'stream'` — an EPIC never nests under a
 *     `workpackage`/`spec-phase`/leaf (A2);
 *   - a non-role leaf nests under anything (unchanged back-compat).
 * `childRole` is the moving/created/promoted item's role; `parentRole` the prospective parent's role.
 * This is ONLY called when a PARENT EXISTS (every caller guards `parentId !== undefined`), so here
 * `parentRole === undefined` means "the parent is a plain leaf", NEVER "root" — a root container is legal
 * precisely because its caller does not call this. Throws DomainError; `childId`/`parentId` are for the message.
 */
export function assertRoleNesting(
  childRole: ItemRole | undefined,
  parentRole: ItemRole | undefined,
  childId: ItemId,
  parentId: ItemId,
): void {
  if (childRole === 'workpackage' && parentRole !== 'workpackage' && parentRole !== 'stream') {
    throw new DomainError(
      `cannot nest workpackage ${childId} under ${parentId}: a workpackage may only nest under a workpackage or a stream (Scope §B(a) / A2)`,
    )
  }
  if (childRole === 'spec-phase' && parentRole !== 'workpackage' && parentRole !== 'spec-phase') {
    throw new DomainError(
      `cannot nest spec-phase ${childId} under ${parentId}: a spec-phase may only nest under a workpackage or spec-phase (Scope §B(a))`,
    )
  }
  if (childRole === 'stream' && parentRole !== 'stream') {
    throw new DomainError(
      `cannot nest stream ${childId} under ${parentId}: a stream (epic) may only nest at root or under another stream, never under a ${parentRole ?? 'leaf'} (A2)`,
    )
  }
}

/**
 * Scope §B(a) — fail-closed validation of a ScopeDecl payload (mirrors assertVerificationRun). The
 * envelope schema checks each field is a `string[]`; this re-asserts that AND normalizes (drops absent
 * optionals so the recorded shape is minimal + hash-stable). track stores the strings, NEVER matches them.
 */
export function assertScopeDecl(input: unknown): ScopeDecl {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new DomainError('scope.declare: scope must be an object')
  }
  const a = input as Record<string, unknown>
  const list = (key: string): string[] | undefined => {
    const v = a[key]
    if (v === undefined) return undefined
    if (!Array.isArray(v) || !v.every((x) => typeof x === 'string')) {
      throw new DomainError(`scope.declare: ${key} must be a string[]`)
    }
    return v as string[]
  }
  const allowed = list('allowed')
  const forbidden = list('forbidden')
  const conditional = list('conditional')
  return {
    ...(allowed !== undefined ? { allowed } : {}),
    ...(forbidden !== undefined ? { forbidden } : {}),
    ...(conditional !== undefined ? { conditional } : {}),
  }
}

// Spec axis is monotone: `to-specify → specified` once; reverse rejected (SPEC §2.2).
const SPEC_TRANSITIONS: Record<SpecStatus, ReadonlyArray<SpecStatus>> = {
  'to-specify': ['specified'],
  specified: [],
}

// Realization forward transitions (SPEC §2.3). `rejected` is handled separately — it is only
// reachable from a `no-go` Decision (with a cause), never a manual transition.
//
// `done` and `cancelled` stay TERMINAL here ON PURPOSE, after the 2026-07-29 ruling that a wrongly-closed
// item must be reopenable: reopening is a DISTINCT, MOTIVATED command (`realization.reopened` /
// `assertReopenTransition`), never a side effect of the ordinary `item realize` verb. So `item realize <id>
// in-progress` on a closed item still fails, and no import/replay path can reopen work by accident.
const REALIZATION_TRANSITIONS: Record<Realization, ReadonlyArray<Realization>> = {
  'to-do': ['in-progress', 'cancelled'],
  'in-progress': ['done', 'cancelled'],
  done: [],
  cancelled: [],
  rejected: [],
}

export function assertSpecTransition(item: ItemState, to: SpecStatus): void {
  if (item.specStatus === 'n/a') {
    throw new DomainError(`spec axis is n/a for ${item.kind} item ${item.id}`)
  }
  if (!SPEC_TRANSITIONS[item.specStatus].includes(to)) {
    throw new DomainError(`illegal spec transition ${item.specStatus} -> ${to} (item ${item.id})`)
  }
}

export function assertRealizationTransition(
  item: { id: ItemId; realization: Realization }, // ItemState or DecisionState — both have realization
  to: Realization,
  hasCause: boolean,
): void {
  if (to === 'rejected') {
    if (!hasCause) {
      throw new DomainError(`realization -> rejected requires a decision cause (item ${item.id})`)
    }
    if (item.realization !== 'to-do' && item.realization !== 'in-progress') {
      throw new DomainError(
        `illegal realization transition ${item.realization} -> rejected (item ${item.id})`,
      )
    }
    return
  }
  if (!REALIZATION_TRANSITIONS[item.realization].includes(to)) {
    throw new DomainError(
      `illegal realization transition ${item.realization} -> ${to} (item ${item.id})`,
    )
  }
}

/**
 * Regression expression — fail-closed validation of a reopening payload (mirrors {@link assertScopeDecl}).
 * A reopening MUST carry one of the declared motives and a non-blank reason: the whole point of the 2026-07-29
 * ruling is that the log says WHY a closure was wrong, so a motive-less reopening is refused BEFORE any append.
 */
export function assertReopenPayload(input: unknown): { motive: ReopenMotive; reason: string } {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new DomainError('item.reopen: the reopening must be an object')
  }
  const a = input as Record<string, unknown>
  if (typeof a['motive'] !== 'string' || !REOPEN_MOTIVES.includes(a['motive'] as ReopenMotive)) {
    throw new DomainError(
      `item.reopen: motive must be one of ${REOPEN_MOTIVES.join('|')} (got ${JSON.stringify(a['motive'])})`,
    )
  }
  if (typeof a['reason'] !== 'string' || a['reason'].trim().length === 0) {
    throw new DomainError('item.reopen: reason must be a non-empty string (the log must say why)')
  }
  return { motive: a['motive'] as ReopenMotive, reason: a['reason'] }
}

/**
 * Regression expression — the reopening transition, checked BEFORE any append. Legal ONLY from a terminal
 * closure (`done` / `cancelled`), and it lands on `in-progress` (the owner-selected option A: the item goes
 * back to being work in flight, distinguishable from a never-started TO-DO). Returns the corrected `from` for
 * a caller that wants it; the FOLD does not use the return — it re-derives `from` off its own state, so the
 * recorded trace can never contradict the log.
 *   - `rejected` is refused: it is the consequence of a `no-go` Decision, undone by revising that decision;
 *   - `to-do` / `in-progress` are refused: there is no closure to correct.
 */
export function assertReopenTransition(item: {
  id: ItemId
  realization: Realization
}): ReopenableRealization {
  if (item.realization === 'done' || item.realization === 'cancelled') return item.realization
  if (item.realization === 'rejected') {
    throw new DomainError(
      `item ${item.id} is rejected — that is the consequence of a no-go decision, so revise the decision instead of reopening the item`,
    )
  }
  throw new DomainError(
    `item ${item.id} is not closed (realization ${item.realization}) — there is no closure to reopen`,
  )
}
