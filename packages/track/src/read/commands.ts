// Lot v2.3a — transport-agnostic READ command layer. CLI and the MCP server are thin adapters over
// these pure functions: a `TrackReader` (no git/fs beyond the event log) + the SAME formatters, with
// the adapter supplying `baselineCommit` (CLI from git HEAD, MCP from a tool argument). This is what
// makes CLI≡MCP parity STRUCTURAL (one layer), not coincidental.

import { buildWpConductorView, formatActionReport, formatReport, formatRows, formatWpConductor, formatWpConductorInline, wpTotals, type Format, type InlineOptions, type ReportScopeProjection } from '../report/format.js'
import { formatWpConductorHtml } from '../report/html.js'
import type { ConductorMeta } from '../report/format.js'
import type { QueryFilter, Report, ReportOptions } from '../report/build.js'
import type { StatusLevel } from '../report/status-by-level.js'
import type { WpNode } from '../report/rollup.js'
import type { ReportSnapshot, TrackReader } from './contract.js'

/**
 * `report` rendered exactly as the CLI renders it (SPEC §7).
 *
 * Default for text/md (0.19.1): a directive action report — WP/table conductor when a WP forest exists,
 * deterministic action/decision fallback otherwise. Use `--flat` to force the deprecated legacy bucket dump.
 * JSON stays the flat structured contract unless `--wp` is explicit.
 *
 * The conductor renders deterministic FAIT / À-FAIRE / ACTIONS DÉRIVÉES tables for `text`/`md`.
 * For `json` the contract is UNCHANGED from 0.19.0: the additive `{...report, wpTotals}` flat structure
 * (so existing machine consumers keep working), PLUS an OPTIONAL `view` field carrying the conductor view
 * model (for presentation skills). If no WP forest exists, text/md falls back to the deterministic action view.
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
): ConductorMeta {
  const window = snapshot.logWindow
  const revision = snapshot.cursor
  return {
    baselineCommit: options.baselineCommit,
    ...(window.from !== undefined ? { logFrom: window.from } : {}),
    ...(window.to !== undefined ? { logTo: window.to } : {}),
    journalRevision: { events: revision.count, head: revision.head },
    ...(now !== undefined ? { now } : {}),
    ...(subWp === true ? { subWp } : {}),
    ...(scopeProjection !== undefined ? { scopeProjection } : {}),
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
): string {
  const snapshot = reader.reportSnapshot(options)
  const globalReport = snapshot.report
  const scoped = scopeSelector === undefined ? undefined : projectReportScope(globalReport, scopeSelector)
  const report = scoped?.report ?? globalReport
  const meta = conductorMeta(options, snapshot, now, subWp, scoped?.scope)

  if (options.wpTree && report.wpTree !== undefined) {
    if (format === 'json') {
      // Machine contract preserved (0.19.0 shape) + additive optional `view` for skill rendering. WP-codes
      // A3: `--active-roster` is a HUMAN-render option only — JSON ALWAYS carries the full forest (every node
      // + its `terminal` flag) so a machine consumer filters terminal roots itself.
      const view = report.wpTree.length > 0
        ? buildWpConductorView(
            report.wpTree,
            report.decisions ?? [],
            report.outsideRollup,
            scoped === undefined ? 'global' : `${scoped.scope.label} (sous-arbre)`,
            meta,
          )
        : undefined
      return `${JSON.stringify({ ...report, wpTotals: wpTotals(report.wpTree, report.outsideRollup), ...(view !== undefined ? { view } : {}) }, null, 2)}\n`
    }
    // text/md: the rendered conductor tables when there is an actual WP forest. WP-codes A3 (DESIGN §A3) —
    // `--active-roster` OMITS terminal (DROPPED) ROOTS from the rendered roster. The ordinals were assigned in
    // `computeWpTree` over ALL roots, so the survivors keep their `WP<n>`/code (a gap appears) — no re-pack.
    const roster = options.activeRoster === true ? report.wpTree.filter((n) => n.terminal !== true) : report.wpTree
    if (roster.length > 0) {
      return formatWpConductor(
        roster, format, report.decisions, report.outsideRollup,
        options.activeRoster === true ? 'roster actif (terminal exclu)' : scoped === undefined ? 'global' : `${scoped.scope.label} (sous-arbre)`,
        meta,
      )
    }
    // No WP containers yet (or every root filtered out): keep the report action-oriented, not a flat dump.
    return formatActionReport(report, format)
  }

  return formatReport(report, format)
}

/**
 * report-revamp §B — the INLINE (compact, one-screen) conductor render. Same read path + directive set as
 * `reportText`; only the presentation differs (cohort-collapse + width truncation live in the renderer). A
 * WP-less repo falls back to the concise action report (never a flat dump).
 */
export function reportInline(reader: TrackReader, options: ReportOptions, inline: InlineOptions = {}): string {
  const report = reader.report(options)
  if (report.wpTree !== undefined && report.wpTree.length > 0) {
    const roster = options.activeRoster === true ? report.wpTree.filter((n) => n.terminal !== true) : report.wpTree
    if (roster.length > 0) {
      return formatWpConductorInline(
        roster,
        report.decisions ?? [],
        { ...inline, ...(options.activeRoster === true ? { totalScope: 'roster actif (terminal exclu)' } : {}) },
        report.outsideRollup,
      )
    }
  }
  return formatActionReport(report, 'text')
}

/**
 * report-revamp §C — the DS-compatible HTML FRAGMENT render (`--format html`). Reuses the SHARED presenter
 * contract (the same path focus's `renderHtml` uses) over the SAME `ReportView` the JSON path exposes. A
 * WP-less repo still yields a valid (empty-state) fragment via the same presenter.
 */
export function reportHtml(
  reader: TrackReader,
  options: ReportOptions,
  now?: string,
  subWp?: boolean,
): string {
  const snapshot = reader.reportSnapshot(options)
  const report = snapshot.report
  const meta = conductorMeta(options, snapshot, now, subWp)
  const decisions = report.decisions ?? []
  if (report.wpTree !== undefined && report.wpTree.length > 0) {
    const roster = options.activeRoster === true ? report.wpTree.filter((n) => n.terminal !== true) : report.wpTree
    if (roster.length > 0) {
      return `${formatWpConductorHtml(
        roster, decisions, undefined, report.outsideRollup,
        options.activeRoster === true ? 'roster actif (terminal exclu)' : 'global',
        meta,
      )}\n`
    }
  }
  return `${formatWpConductorHtml([], decisions, undefined, report.outsideRollup, 'global', meta)}\n`
}

/**
 * Criterion 10b — THE one command that resolves a short handle (`8.1`, `H.2`, `D3`) back to its item or
 * dossier. Without it a report the owner can read is a report they cannot act on; with it, no ULID has to
 * appear in a column to keep a row dispatchable.
 */
export function resolveHandle(reader: TrackReader, options: ReportOptions, handle: string, scopeSelector?: string): string {
  const snapshot = reader.reportSnapshot({ ...options, decisions: true, wpTree: true })
  const globalReport = snapshot.report
  const scoped = scopeSelector === undefined ? undefined : projectReportScope(globalReport, scopeSelector)
  const report = scoped?.report ?? globalReport
  const view = buildWpConductorView(
    report.wpTree ?? [], report.decisions ?? [], report.outsideRollup,
    scoped === undefined ? 'global' : `${scoped.scope.label} (sous-arbre)`,
    conductorMeta(options, snapshot, undefined, undefined, scoped?.scope),
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
