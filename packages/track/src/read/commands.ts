// Lot v2.3a — transport-agnostic READ command layer. CLI and the MCP server are thin adapters over
// these pure functions: a `TrackReader` (no git/fs beyond the event log) + the SAME formatters, with
// the adapter supplying `baselineCommit` (CLI from git HEAD, MCP from a tool argument). This is what
// makes CLI≡MCP parity STRUCTURAL (one layer), not coincidental.

import { assertReportFormat, buildWpConductorView, formatActionReport, formatReport, formatRows, formatWpConductor, formatWpConductorInline, reportPeriod, reportPeriodPayload, wpTotals, type Format, type InlineOptions, type ReportOmission, type ReportPeriodPayload, type ReportScopeProjection, type WithdrawalNotice } from '../report/format.js'
import type { ConductorMeta } from '../report/format.js'
import { BUCKETS } from '../report/buckets.js'
import type { QueryFilter, Report, ReportOptions } from '../report/build.js'
import type { StatusLevel } from '../report/status-by-level.js'
import type { WpNode } from '../report/rollup.js'
import { fold } from '../state/fold.js'
import type { ReportSnapshot, TrackReader } from './contract.js'

/** A CLI-resolved selector. Dates are already absolute instants; refs are full commit ids when applicable. */
export interface ReportPeriodSelection {
  requested: string
  from?: string
  to?: string
  fromRef: string | null
  toRef: string | null
}

interface ReportPeriodProjection {
  payload: ReportPeriodPayload
  deliveredItemIds: ReadonlySet<string>
}

/**
 * Project a requested time interval from the COMPLETE snapshot. The report's state was folded before this
 * runs; filtering events here can therefore change FAIT but never make a container or open work disappear.
 */
function periodProjection(
  snapshot: ReportSnapshot,
  selection: ReportPeriodSelection | undefined,
  now?: string,
): ReportPeriodProjection {
  const selected = selection !== undefined
  let from = selection?.from ?? snapshot.logWindow.from
  const to = selection?.to ?? (selected ? snapshot.logWindow.to : now ?? snapshot.logWindow.to)
  let fromMs = from === undefined ? undefined : Date.parse(from)
  const toMs = to === undefined ? undefined : Date.parse(to)
  // Every resolved period is ordered at this one boundary. A caller-pinned clock before the journal makes
  // an honest empty whole-log interval; an explicit reversed selector remains invalid.
  if (fromMs !== undefined && toMs !== undefined && fromMs > toMs) {
    if (selection === undefined && now !== undefined) {
      from = to
      fromMs = toMs
    } else if (selection?.from !== undefined && selection.to === undefined) {
      throw new Error('--since must not be after the journal head')
    } else {
      throw new Error('resolved report period must not end before it begins')
    }
  }
  const events = snapshot.events.filter((event) => {
    const at = Date.parse(event.at)
    return (fromMs === undefined || at >= fromMs) && (toMs === undefined || at <= toMs)
  })
  const deliveredItemIds = new Set(
    events
      .filter((event) => event.aggregate === 'item' && event.type === 'realization.transition' && event.payload['to'] === 'done')
      .map((event) => event.aggregateId),
  )
  return {
    payload: {
      requested: selection?.requested ?? null,
      ...(from !== undefined ? { from } : {}),
      ...(to !== undefined ? { to } : {}),
      fromRef: selection?.fromRef ?? null,
      toRef: selection?.toRef ?? null,
      eventsInWindow: events.length,
      eventsTotal: snapshot.events.length,
    },
    deliveredItemIds,
  }
}

/**
 * `report` rendered exactly as the CLI renders it (SPEC §7).
 *
 * Default for text/md: the four-section conductor, including outside-WP work
 * when the forest is empty. Use `--flat` to force the deprecated legacy bucket dump.
 * JSON stays the flat structured contract unless `--wp` is explicit.
 *
 * The conductor renders deterministic FAIT / À-FAIRE / ACTIONS DÉRIVÉES tables for `text`/`md`.
 * For `json` the contract is UNCHANGED from 0.19.0: the additive `{...report, wpTotals}` flat structure
 * (so existing machine consumers keep working), PLUS an OPTIONAL `view` field carrying the conductor view
 * model (for presentation skills), also when no WP containers exist.
 */
/**
 * Criterion 21 — the window bounds the LOG carries, plus the caller's clock when it injected one. This
 * module is the boundary: the renderer stays clockless, so the same log and the same `now` always render
 * the same bytes.
 */
function conductorMeta(
  options: ReportOptions,
  snapshot: ReportSnapshot,
  now?: string,
  subWp?: boolean,
  scopeProjection?: ReportScopeProjection,
  period?: ReportPeriodProjection,
  windowedDeliveries = false,
  extras?: {
    itemFacts?: ConductorMeta['itemFacts']
    withdrawnNotices?: ConductorMeta['withdrawnNotices']
    withdrawnOmitted?: ConductorMeta['withdrawnOmitted']
    lang?: string
  },
): ConductorMeta {
  const window = snapshot.logWindow
  const revision = snapshot.cursor
  return {
    baselineCommit: options.baselineCommit,
    ...(options.requireAccepted === true ? { requireAccepted: true } : {}),
    ...(window.from !== undefined ? { logFrom: window.from } : {}),
    ...(window.to !== undefined ? { logTo: window.to } : {}),
    journalRevision: { events: revision.count, head: revision.head },
    ...(now !== undefined ? { now } : {}),
    ...(subWp === true ? { subWp } : {}),
    ...(scopeProjection !== undefined ? { scopeProjection } : {}),
    ...(period !== undefined ? { periodWindow: period.payload } : {}),
    ...(windowedDeliveries ? { deliveredItemIds: period?.deliveredItemIds ?? new Set<string>() } : {}),
    ...(extras?.itemFacts !== undefined ? { itemFacts: extras.itemFacts } : {}),
    ...(extras?.withdrawnNotices !== undefined && extras.withdrawnNotices.length > 0
      ? { withdrawnNotices: extras.withdrawnNotices }
      : {}),
    ...(extras?.withdrawnOmitted !== undefined && extras.withdrawnOmitted.length > 0
      ? { withdrawnOmitted: extras.withdrawnOmitted }
      : {}),
    ...(extras?.lang !== undefined ? { lang: extras.lang } : {}),
  }
}

/**
 * Amendment D9 — split the report's withdrawal candidates into served
 * notices and declared omissions. Relevant ⟺ withdrawn or decided inside the
 * selected window, or still carrying a live gate; deduplicated by item id. A
 * withdrawal with neither stays in history, out of the served tables. Scoped
 * reports keep only the candidates inside the scoped buckets.
 */
function withdrawalServing(
  snapshot: ReportSnapshot,
  report: Report,
  period: ReportPeriodPayload,
): { itemFacts: ConductorMeta['itemFacts']; withdrawnNotices?: WithdrawalNotice[]; withdrawnOmitted?: ReportOmission[] } {
  const itemFacts = report.itemFacts
  const candidates = report.withdrawals ?? []
  if (candidates.length === 0) return { itemFacts }
  const state = fold(snapshot.events)
  const inScope = new Set<string>()
  for (const bucket of BUCKETS) for (const row of report.buckets[bucket]) inScope.add(row.id)
  const fromMs = period.from === undefined ? Number.NEGATIVE_INFINITY : Date.parse(period.from)
  const toMs = period.to === undefined ? Number.POSITIVE_INFINITY : Date.parse(period.to)
  const inWindow = (at: string): boolean => {
    const ms = Date.parse(at)
    return ms >= fromMs && ms <= toMs
  }
  const transitionsInWindow = new Set<string>()
  const settlementsInWindow = new Map<string, number>()
  snapshot.events.forEach((event) => {
    if (!inWindow(event.at)) return
    if (event.type === 'realization.transition') {
      const to = (event.payload as { to?: string }).to
      if (to === 'cancelled' || to === 'rejected') transitionsInWindow.add(event.aggregateId)
    }
    if (event.type === 'decision.outcome') {
      const to = (event.payload as { to?: string }).to
      if (to === 'go' || to === 'no-go') {
        const decision = state.decisions.get(event.aggregateId)
        for (const targetId of decision?.targets ?? []) {
          settlementsInWindow.set(targetId, (settlementsInWindow.get(targetId) ?? 0) + 1)
        }
      }
    }
  })
  const notices: WithdrawalNotice[] = []
  const omitted: ReportOmission[] = []
  const seen = new Set<string>()
  for (const candidate of candidates) {
    if (seen.has(candidate.id) || !inScope.has(candidate.id)) continue
    seen.add(candidate.id)
    const relevant =
      transitionsInWindow.has(candidate.id) ||
      (settlementsInWindow.get(candidate.id) ?? 0) > 0 ||
      candidate.hasLiveGate
    if (relevant) {
      notices.push({
        id: candidate.id,
        title: candidate.title,
        ...(candidate.containerId !== undefined ? { containerId: candidate.containerId } : {}),
        ...(candidate.reason !== undefined ? { reason: candidate.reason } : {}),
        dossierIds: candidate.dossierIds,
      })
    } else {
      omitted.push({
        label: candidate.title,
        reason: 'retiré hors fenêtre, sans gate actif ni décision liée en fenêtre',
      })
    }
  }
  return {
    itemFacts,
    ...(notices.length > 0 ? { withdrawnNotices: notices } : {}),
    ...(omitted.length > 0 ? { withdrawnOmitted: omitted } : {}),
  }
}

export interface ScopedReportProjection {
  report: Report
  scope: ReportScopeProjection
}

function flattenWpTree(nodes: readonly WpNode[]): WpNode[] {
  const flat: WpNode[] = []
  const walk = (node: WpNode): void => {
    flat.push(node)
    for (const child of node.children) walk(child)
  }
  for (const node of nodes) walk(node)
  return flat
}

/**
 * Read-only `report --scope` projection. A selector is exact and may name a container id, assigned
 * code, or derived label; a match against more than one container fails rather than drifting after a
 * positional-label renumbering. The selected root carries its complete nested subtree.
 */
export function projectReportScope(report: Report, selector: string): ScopedReportProjection {
  const tree = report.wpTree ?? []
  const allNodes = flattenWpTree(tree)
  const needle = selector.trim()
  const exactCodeMatches = allNodes.filter((node) => node.code === selector)
  if (needle === '' && exactCodeMatches.length === 0) throw new Error('scope selector must not be empty')
  const matches = allNodes.filter((node) => node.id === needle || node.code === selector || node.label === needle)
  if (matches.length === 0) {
    throw new Error(`unknown scope selector: ${selector} (use an exact container id, assigned code, or derived label)`)
  }
  if (matches.length > 1) {
    throw new Error(`ambiguous scope selector: ${selector} (${matches.map((node) => `${node.label} (${node.id})`).join(', ')})`)
  }
  const selected = matches[0]!
  const selectedNodes = flattenWpTree([selected])
  const leafIds = new Set(selectedNodes.flatMap((node) => node.leaves.map((leaf) => leaf.id)))
  const decisionRefs = new Set(
    selectedNodes.flatMap((node) => node.leaves.flatMap((leaf) => leaf.openBlockers))
      .filter((blocker) => blocker.kind === 'decision' && blocker.ref !== undefined)
      .map((blocker) => blocker.ref!),
  )
  const decisions = report.decisions?.filter((decision) => decisionRefs.has(decision.id))
  const buckets = {
    AWAITED: report.buckets.AWAITED.filter((row) => leafIds.has(row.id)),
    DROPPED: report.buckets.DROPPED.filter((row) => leafIds.has(row.id)),
    DONE: report.buckets.DONE.filter((row) => leafIds.has(row.id)),
    'TO-DO': report.buckets['TO-DO'].filter((row) => leafIds.has(row.id)),
  }
  const projectedRows = allNodes.length + (report.outsideRollup?.length ?? 0) + (report.decisions?.length ?? 0)
  const scopedRows = selectedNodes.length + (decisions?.length ?? 0)
  return {
    report: {
      buckets,
      ...(decisions !== undefined ? { decisions } : {}),
      wpTree: [selected],
      // Amendment D3/D9/D11 — the per-item conductor facts and withdrawal
      // candidates travel with the scoped projection (additive); relevance is
      // still filtered to the scoped buckets by the serving step.
      ...(report.itemFacts !== undefined ? { itemFacts: report.itemFacts } : {}),
      ...(report.withdrawals !== undefined ? { withdrawals: report.withdrawals } : {}),
    },
    scope: {
      selector: exactCodeMatches.includes(selected) ? selector : needle,
      id: selected.id,
      label: selected.label,
      includes: 'subtree',
      excludedProjectionRows: projectedRows - scopedRows,
    },
  }
}

export function reportText(
  reader: TrackReader,
  options: ReportOptions,
  format: Format,
  now?: string,
  subWp?: boolean,
  scopeSelector?: string,
  periodSelection?: ReportPeriodSelection,
  // Amendment D1 — `--status-table` selects the same validated report (same
  // set and order in every format); the flag is accepted, not a second
  // projection. The rolling default comes from the CLI boundary (lot 3).
  statusTable = false,
  // Amendment D10 — open `--lang <bcp47>` label selection for the new
  // stage/status surface. Absent ⇒ established rendering, byte-identical.
  lang?: string,
): string {
  assertReportFormat(format)
  const snapshot = reader.reportSnapshot(statusTable ? { ...options, wpTree: true, decisions: true } : options)
  const globalReport = snapshot.report
  const scoped = scopeSelector === undefined ? undefined : projectReportScope(globalReport, scopeSelector)
  const report = scoped?.report ?? globalReport
  const projection = periodProjection(snapshot, periodSelection, now)
  // Amendment D3/D9/D11 — per-item conductor facts + withdrawal serving ride
  // the same meta the conductor renders from, so `--status-table` and the
  // validated route over an identical period are byte-identical.
  const serving = withdrawalServing(snapshot, report, projection.payload)
  const meta = conductorMeta(options, snapshot, now, subWp, scoped?.scope, projection, periodSelection !== undefined, { ...serving, ...(lang !== undefined ? { lang } : {}) })
  const period = reportPeriod(meta)
  const payload = reportPeriodPayload(meta)

  if ((options.wpTree && report.wpTree !== undefined) || statusTable) {
    const tree = report.wpTree ?? []
    if (format === 'json') {
      // Machine contract preserved (0.19.0 shape) + additive optional `view` for skill rendering. WP-codes
      // A3: `--active-roster` is a HUMAN-render option only — JSON ALWAYS carries the full forest (every node
      // + its `terminal` flag) so a machine consumer filters terminal roots itself.
      const view = buildWpConductorView(
        tree,
        report.decisions ?? [],
        report.outsideRollup,
        scoped === undefined ? 'global' : `${scoped.scope.label} (sous-arbre)`,
        meta,
      )
      return `${JSON.stringify({ ...report, period: payload, wpTotals: wpTotals(tree, report.outsideRollup), view }, null, 2)}\n`
    }
    // text/md: the rendered conductor tables when there is an actual WP forest. WP-codes A3 (DESIGN §A3) —
    // `--active-roster` OMITS terminal (DROPPED) ROOTS from the rendered roster. The ordinals were assigned in
    // `computeWpTree` over ALL roots, so the survivors keep their `WP<n>`/code (a gap appears) — no re-pack.
    const roster = options.activeRoster === true ? tree.filter((n) => n.terminal !== true) : tree
    if (roster.length > 0 || options.activeRoster !== true) {
      return formatWpConductor(
        roster, format, report.decisions, report.outsideRollup,
        options.activeRoster === true ? 'roster actif (terminal exclu)' : scoped === undefined ? 'global' : `${scoped.scope.label} (sous-arbre)`,
        meta,
      )
    }
    // No WP containers yet (or every root filtered out): keep the report action-oriented, not a flat dump.
    return `${period.label}\n\n${formatActionReport(report, format)}\n`
  }

  if (format === 'json') return `${JSON.stringify({ ...report, period: payload }, null, 2)}\n`
  return `${period.label}\n\n${formatReport(report, format)}`
}

/**
 * report-revamp §B — the INLINE (compact, one-screen) conductor render. Same read path + directive set as
 * `reportText`; only the presentation differs (cohort-collapse + width truncation live in the renderer). A
 * WP-less repo falls back to the concise action report (never a flat dump).
 */
export function reportInline(
  reader: TrackReader,
  options: ReportOptions,
  inline: InlineOptions = {},
  now?: string,
  periodSelection?: ReportPeriodSelection,
): string {
  const snapshot = reader.reportSnapshot(options)
  const report = snapshot.report
  const projection = periodProjection(snapshot, periodSelection, now)
  const meta = conductorMeta(options, snapshot, now, undefined, undefined, projection, periodSelection !== undefined)
  if (report.wpTree !== undefined && report.wpTree.length > 0) {
    const roster = options.activeRoster === true ? report.wpTree.filter((n) => n.terminal !== true) : report.wpTree
    if (roster.length > 0) {
      return formatWpConductorInline(
        roster,
        report.decisions ?? [],
        { ...inline, ...(options.activeRoster === true ? { totalScope: 'roster actif (terminal exclu)' } : {}) },
        report.outsideRollup,
        meta,
      )
    }
  }
  return `${reportPeriod(meta).label}\n\n${formatActionReport(report, 'text')}\n`
}

/**
 * Criterion 10b — THE one command that resolves a short handle (`8.1`, `H.2`, `D3`) back to its item or
 * dossier. Without it a report the owner can read is a report they cannot act on; with it, no ULID has to
 * appear in a column to keep a row dispatchable.
 */
/**
 * Amendment D4/D13 — the exact rendering context a `--resolve` rebinds so a
 * handle resolves against the same period, sub-WP expansion, scope, baseline
 * and journal revision the report was rendered from. Handles are positional:
 * resolving without the captured context can point at the wrong row.
 */
export interface ResolveContext {
  periodSelection?: ReportPeriodSelection
  now?: string
  subWp?: boolean
  /**
   * Journal revision the report was rendered from. When present, each defined
   * part must match the current snapshot cursor — a moved journal is refused
   * rather than resolved against the wrong rows.
   */
  expectedRevision?: { events?: number; head?: string | null }
}

export function resolveHandle(
  reader: TrackReader,
  options: ReportOptions,
  handle: string,
  scopeSelector?: string,
  // Amendment D1/D13 — accepted as an alias resolving to the exact same
  // report context (the withdrawn `#` numbering is gone; handles are `[n.m]`
  // on the single validated view).
  statusTable = false,
  ctx: ResolveContext = {},
): string {
  const snapshot = reader.reportSnapshot({ ...options, decisions: true, wpTree: true })
  if (ctx.expectedRevision !== undefined) {
    const cursor = snapshot.cursor
    const expected = ctx.expectedRevision
    const moved =
      (expected.events !== undefined && expected.events !== cursor.count) ||
      (expected.head !== undefined && expected.head !== cursor.head)
    if (moved) {
      throw new Error(
        `journal revision changed since the report was rendered (report: ${expected.events ?? '?'} events, head ${expected.head ?? 'none'}; now: ${cursor.count} events, head ${cursor.head ?? 'none'}) — re-render, then resolve against the same log and baseline`,
      )
    }
  }
  const globalReport = snapshot.report
  const scoped = scopeSelector === undefined ? undefined : projectReportScope(globalReport, scopeSelector)
  const report = scoped?.report ?? globalReport
  const projection = periodProjection(snapshot, ctx.periodSelection, ctx.now)
  void statusTable
  const serving = withdrawalServing(snapshot, report, projection.payload)
  const meta = conductorMeta(
    options, snapshot, ctx.now, ctx.subWp, scoped?.scope, projection, ctx.periodSelection !== undefined, serving,
  )
  const view = buildWpConductorView(
    report.wpTree ?? [], report.decisions ?? [], report.outsideRollup,
    scoped === undefined ? 'global' : `${scoped.scope.label} (sous-arbre)`,
    meta,
  )
  const wanted = handle.trim().replace(/^\[|\]$/gu, '').toUpperCase()
  const hit = view.handles.find((h) => h.handle.toUpperCase() === wanted)
  if (hit === undefined) {
    const known = view.handles.map((h) => h.handle).join(' ')
    return `handle introuvable: ${handle}\nhandles connus: ${known === '' ? '(aucun)' : known}\n`
  }
  return `${hit.handle}\t${hit.kind}\t${hit.id}\t${hit.title}${hit.wpLabel === undefined ? '' : `\t${hit.wpLabel}`}\n`
}

/**
 * `report --level <spec|plan|wp|lot|task>` rendered (Scope §A/§B). `json` carries the structured status
 * groups; `text`/`md` render a one-line-per-group `done/active (pct) STATUS label — title` table. Pure
 * read over the shared `TrackReader.statusByLevel` (same path the MCP surface uses).
 */
export function statusText(
  reader: TrackReader,
  level: StatusLevel,
  options: ReportOptions,
  format: Format,
): string {
  const groups = reader.statusByLevel(level, options)
  if (format === 'json') return `${JSON.stringify({ level, groups }, null, 2)}\n`
  const head = `# status — level: ${level}\n`
  const body = groups
    .map((g) => {
      const pct = g.pct === 'n/a' ? 'n/a' : `${g.pct}%`
      return `${g.label}  ${g.done}/${g.active} (${pct})  ${g.status}${g.dropped > 0 ? ` [${g.dropped} dropped]` : ''} — ${g.title}`
    })
    .join('\n')
  return `${head}${body}${groups.length > 0 ? '\n' : ''}`
}

/** `query` rendered exactly as the CLI renders it: raw JSON for `json`, else the row formatter. */
export function queryText(
  reader: TrackReader,
  filter: QueryFilter,
  options: ReportOptions,
  format: Format,
): string {
  const rows = reader.query(filter, options)
  return format === 'json' ? `${JSON.stringify(rows, null, 2)}\n` : formatRows(rows, format)
}
