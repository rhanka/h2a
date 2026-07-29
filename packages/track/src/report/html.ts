// report-revamp §C — the DS-compatible HTML FRAGMENT renderer for the conductor report. Implements the
// shared `DsFragmentPresenter` contract (present.ts) — the SAME presenter path as focus's `renderHtml`, not
// a second engine: a self-contained `<article>` with namespaced classes + `data-*` variants, every
// interpolation escaped (§A4), the whole fragment run through the host `sanitizeHtml` hook. It consumes the
// SAME `ReportView` the JSON path exposes (tables + directives + keystone), so the HTML and the table render
// share one derived model. The design system supplies the CSS/tokens and embeds the fragment.

import {
  buildWpConductorView,
  coverageLine,
  resolutionLines,
  type ConductorMeta,
  type ReportView,
  type ReportViewTable,
} from './format.js'
import type { DecisionRow, ReportRow } from './build.js'
import type { WpNode } from './rollup.js'
import { escapeHtml, IDENTITY_HOOKS, type DsFragmentHooks, type DsFragmentPresenter } from './present.js'

/** The À-FAIRE ordering rule, stated on screen exactly as the terminal states it (criterion 6). */
const TODO_ORDER_NOTE = 'ordre = priorité ; les cinq premiers sont le focus'

/**
 * One conductor section → a `<section>`: a `<table class="report-table">` for the grid sections, an
 * ordered prose block for RECOMMANDATION. Cells are escaped (§A4); a cell's explicit `\n` line breaks
 * (the DÉCISIONS alternatives, one per line) become `<br>` so an option and its recommendation stay
 * on the same visual line as they do in the terminal.
 */
function renderTable(t: ReportViewTable): string {
  const open = `<section class="report-section" data-section="${escapeHtml(t.id)}"><h2>${escapeHtml(t.title)}</h2>`
  if (t.render === 'prose') {
    const body = (t.lines ?? []).map((line) => `<p class="report-line">${escapeHtml(line)}</p>`).join('')
    return `${open}${body}</section>`
  }
  const note = t.id === 'todo' ? `<p class="report-note">${escapeHtml(TODO_ORDER_NOTE)}</p>` : ''
  const multiline = (value: string): string => escapeHtml(value).split('\n').join('<br>')
  const head = t.columns.map((c) => `<th>${escapeHtml(c.label)}</th>`).join('')
  const body = t.rows
    .map((row) => `<tr>${t.columns.map((c) => `<td>${multiline(row[c.id] ?? '')}</td>`).join('')}</tr>`)
    .join('')
  return (
    `${open}${note}` +
    `<table class="report-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>` +
    `</section>`
  )
}

/**
 * The header carries the ACCEPTANCE BASELINE, the honest statement that the report covers the whole log
 * (criterion 1, as scoped), and the projected/rendered row accounting (criterion 17). It carries NO bucket
 * counters. The machine directive list is NOT a section: the four sections are FAIT, À-FAIRE, DÉCISIONS,
 * RECOMMANDATION and nothing else — `view.directives` remains available on the JSON surface for the DS.
 */
function renderHeader(view: ReportView): string {
  const h = view.header
  const k = view.keystone
  const keystone =
    k !== undefined
      ? ` · <span class="report-keystone" data-blocks="${escapeHtml(String(k.blocks))}">goulot: ${escapeHtml(k.title)} (bloque ${escapeHtml(String(k.blocks))})</span>`
      : ''
  return (
    `<header class="report-header"><h1>TRACK REPORT — ${escapeHtml(h.scope)} · ${escapeHtml(h.progress)}</h1>` +
    `<p class="report-period">${escapeHtml(h.period.label)}${keystone}</p>` +
    `<p class="report-meta">baseline d’acceptance : <code>${escapeHtml(h.baselineCommit ?? 'non résolue')}</code></p>` +
    `<p class="report-coverage">${escapeHtml(coverageLine(h.coverage))}</p>` +
    `<p class="report-sources">sources : ${escapeHtml(h.sources.join(' ; '))}</p></header>`
  )
}

/**
 * Criteria 10b/10c — the resolution block. A `<footer>`, deliberately NOT a `<section>` and NOT a
 * `report-table`: it is the machine's half of the page, and the only place an item id appears.
 */
function renderResolution(view: ReportView): string {
  const [title, ...rest] = resolutionLines(view)
  const body = rest.map((line) => `<p>${escapeHtml(line)}</p>`).join('')
  return `<footer class="report-resolution" data-section="resolution"><h2>${escapeHtml(title ?? '')}</h2>${body}</footer>`
}

/** Render a `ReportView` to a sanitized, DS-styled `<article>` fragment (the shared presenter, §C). */
export const renderReportHtml: DsFragmentPresenter<ReportView> = (view, hooks = IDENTITY_HOOKS) => {
  const html =
    `<article class="report-document" data-kind="${escapeHtml(view.kind)}" data-locale="${escapeHtml(view.locale)}">` +
    renderHeader(view) +
    view.tables.map(renderTable).join('') +
    renderResolution(view) +
    `</article>`
  return hooks.sanitizeHtml(html)
}

/** Build the conductor view from the forest and render its DS fragment (the CLI `--format html` path). */
export function formatWpConductorHtml(
  tree: readonly WpNode[],
  decisions: readonly DecisionRow[] = [],
  hooks: DsFragmentHooks = IDENTITY_HOOKS,
  outsideRollup: readonly ReportRow[] = [],
  totalScope = 'global',
  meta: ConductorMeta = {},
): string {
  return renderReportHtml(buildWpConductorView(tree, decisions, outsideRollup, totalScope, meta), hooks)
}
