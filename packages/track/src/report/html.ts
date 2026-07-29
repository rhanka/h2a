// report-revamp §C — the DS-compatible HTML FRAGMENT renderer for the conductor report. Implements the
// shared `DsFragmentPresenter` contract (present.ts) — the SAME presenter path as focus's `renderHtml`, not
// a second engine: a self-contained `<article>` with namespaced classes + `data-*` variants, every
// interpolation escaped (§A4), the whole fragment run through the host `sanitizeHtml` hook. It consumes the
// SAME `ReportView` the JSON path exposes (tables + directives + keystone), so the HTML and the table render
// share one derived model. The design system supplies the CSS/tokens and embeds the fragment.

import { buildWpConductorView, directivePhrase, type ReportView, type ReportViewTable } from './format.js'
import type { DecisionRow, ReportRow } from './build.js'
import type { Directive } from './directive.js'
import type { WpNode } from './rollup.js'
import { escapeHtml, IDENTITY_HOOKS, type DsFragmentHooks, type DsFragmentPresenter } from './present.js'

/** One conductor table → a `<section>` with a `<table class="report-table">`; cells escaped (§A4). */
function renderTable(t: ReportViewTable): string {
  const head = t.columns.map((c) => `<th>${escapeHtml(c.label)}</th>`).join('')
  const body = t.rows
    .map((row) => `<tr>${t.columns.map((c) => `<td>${escapeHtml(row[c.id] ?? '')}</td>`).join('')}</tr>`)
    .join('')
  return (
    `<section class="report-section" data-section="${escapeHtml(t.id)}">` +
    `<h2>${escapeHtml(t.title)}</h2>` +
    `<table class="report-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>` +
    `</section>`
  )
}

/**
 * The machine-attributed directive list — the DS-consumable variant surface (mirrors focus's
 * `data-annotation`/`data-modality` convention): each `<li>` carries `data-mode`, `data-advice-kind`,
 * `data-rank`, `data-step`, and (when present) `data-gate`/`data-blocked-by`/`data-fan-in`, so the design
 * system styles chips WITHOUT parsing the phrase. The rendered phrase reuses `directivePhrase` (same bytes
 * as the table). Every interpolated title/ref is escaped.
 */
function renderDirectives(dirs: readonly Directive[]): string {
  if (dirs.length === 0) return ''
  const items = dirs
    .map((d) => {
      const g = d.gate
      const attrs = [
        `data-mode="${escapeHtml(d.mode)}"`,
        `data-advice-kind="${escapeHtml(d.adviceKind)}"`,
        `data-rank="${escapeHtml(d.rank)}"`,
        `data-step="${escapeHtml(d.step.code)}"`,
        ...(g?.code !== undefined ? [`data-gate="${escapeHtml(g.code)}"`] : []),
        ...(g?.blockedBy !== undefined ? [`data-blocked-by="${escapeHtml(g.blockedBy)}"`] : []),
        ...(d.facts.fanIn !== undefined ? [`data-fan-in="${escapeHtml(String(d.facts.fanIn))}"`] : []),
      ].join(' ')
      const subject = escapeHtml(d.target.title ?? d.target.id)
      const blocker =
        g?.blockedByTitle !== undefined
          ? ` <span class="report-directive-blocker">bloqué par « ${escapeHtml(g.blockedByTitle)} »</span>`
          : ''
      return (
        `<li class="report-directive" ${attrs}>` +
        `<strong class="report-directive-subject">${subject}</strong> — ` +
        `<span class="report-directive-phrase">${escapeHtml(directivePhrase(d))}</span>${blocker}</li>`
      )
    })
    .join('')
  return `<section class="report-section" data-section="directives"><h2>Directives</h2><ul class="report-directives">${items}</ul></section>`
}

function renderHeader(view: ReportView): string {
  const k = view.keystone
  const keystone =
    k !== undefined
      ? ` · <span class="report-keystone" data-keystone-id="${escapeHtml(k.id)}" data-blocks="${escapeHtml(String(k.blocks))}">goulot: ${escapeHtml(k.title)} (bloque ${escapeHtml(String(k.blocks))})</span>`
      : ''
  return (
    `<header class="report-header"><h1>Report — conducteur</h1>` +
    `<p class="report-meta">vue: <code>${escapeHtml(view.kind)}</code> · locale: ${escapeHtml(view.locale)}${keystone}</p></header>`
  )
}

/** Render a `ReportView` to a sanitized, DS-styled `<article>` fragment (the shared presenter, §C). */
export const renderReportHtml: DsFragmentPresenter<ReportView> = (view, hooks = IDENTITY_HOOKS) => {
  const html =
    `<article class="report-document" data-kind="${escapeHtml(view.kind)}" data-locale="${escapeHtml(view.locale)}">` +
    renderHeader(view) +
    view.tables.map(renderTable).join('') +
    renderDirectives(view.directives) +
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
): string {
  return renderReportHtml(buildWpConductorView(tree, decisions, outsideRollup, totalScope), hooks)
}
