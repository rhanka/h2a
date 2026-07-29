import { BUCKETS } from './buckets.js'
import type { DecisionRow, Report, ReportRow } from './build.js'
import type { WpLeaf, WpNode } from './rollup.js'
import {
  buildDirectives,
  decisionNeedsFocus,
  dispatchQueueOf,
  keystoneOf,
  type Directive,
  type DirectiveGateCode,
  type Keystone,
} from './directive.js'
// Unified report presentation (spec 2026-07-11) — the SINGLE enum→French lexicon the cockpit shares, so
// the two surfaces can never re-word apart. The terminal composes its own `<nature> (<actor>): <clause>`
// sentence but sources the canonical action clause + scope label from here.
import { directiveScopeLabelFr as directiveScopeLabel, gatePhraseFr, stepActionFr } from './friendly.js'

export type Format = 'json' | 'text' | 'md'

const BACKSLASH = String.fromCharCode(92)
// Markdown metacharacters escaped in `md` titles so a user title can't inject formatting.
const MD_META = new Set([
  BACKSLASH, '`', '*', '_', '[', ']', '{', '}', '(', ')', '#', '+', '|', '<', '>', '!', '~', '-',
])

/** Collapse control characters (newlines, tabs, line separators) to single spaces. */
export function cleanDisplayText(s: string): string {
  let out = ''
  let prevSpace = false
  for (const ch of s) {
    const code = ch.codePointAt(0) ?? 0
    const isControlOrSpace =
      code < 0x20 || code === 0x7f || code === 0x2028 || code === 0x2029 || ch === ' '
    if (isControlOrSpace) {
      if (!prevSpace) {
        out += ' '
        prevSpace = true
      }
    } else {
      out += ch
      prevSpace = false
    }
  }
  return out.trim()
}

/** Backslash-escape every markdown metacharacter. Does NOT trim — the caller owns normalization. */
function escapeMdMeta(s: string): string {
  let out = ''
  for (const ch of s) out += MD_META.has(ch) ? BACKSLASH + ch : ch
  return out
}

/** A display-safe title: control-normalized for text, plus markdown-metacharacter-escaped for md. */
export function displayText(s: string, format: Format): string {
  const t = cleanDisplayText(s)
  return format === 'md' ? escapeMdMeta(t) : t
}

/**
 * The row handle token `[n.m]` — ONE definition, three consumers: the builder emits it, the renderer
 * keeps it OUT of the markdown-escaped span, and the parity test extracts it. It is exempt from escaping
 * because it is MACHINE-GENERATED, never user content: `track report --resolve <handle>` is the documented
 * path from a rendered row to an action, and a handle a machine has to unescape first is a handle that
 * breaks that path in exactly one of the three formats.
 *
 * The exemption cannot become an injection route: only the literal token matches, and every other
 * character around it — including the `(` `)` a markdown link would need — is still escaped.
 */
export const HANDLE_TOKEN_SOURCE = String.raw`\[\d+\.\d+\]`

/** Fresh instance per call: a shared `g`-flagged regex carries `lastIndex` state between callers. */
export function handleTokenRegex(): RegExp {
  return new RegExp(HANDLE_TOKEN_SOURCE, 'gu')
}

/**
 * A display-safe TABLE CELL. Same guarantee as `displayText` for every user-originated fragment, with the
 * machine-generated handle token passed through verbatim so all three formats yield the SAME handle set.
 */
export function displayCell(s: string, format: Format): string {
  const t = cleanDisplayText(s)
  if (format !== 'md') return t
  return t
    .split(new RegExp(`(${HANDLE_TOKEN_SOURCE})`, 'u'))
    .map((part, index) => (index % 2 === 1 ? part : escapeMdMeta(part)))
    .join('')
}

function clean(s: string): string {
  return cleanDisplayText(s)
}

function title(s: string, format: Format): string {
  return displayText(s, format)
}

function heading(label: string, count: number, format: Format): string {
  return format === 'md' ? `## ${label} (${count})` : `${label} (${count})`
}

function meta(r: ReportRow): string {
  return `${r.realization} · ${r.acceptance}${r.priority !== undefined ? ` · wsjf:${r.priority}` : ''}`
}

function rowLine(r: ReportRow, format: Format): string {
  return format === 'md'
    ? `- **${title(r.title, format)}** — ${meta(r)}`
    : `  - ${title(r.title, format)} [${meta(r)}]`
}

interface DecisionPresentation {
  structured: DecisionRow[]
  legacyPending: DecisionRow[]
  legacySettled: DecisionRow[]
}

/**
 * Classify folded decision rows once for every human renderer. Legacy events remain
 * readable, but only a dossier that satisfies the native validator is actionable.
 */
function classifyDecisions(decisions: readonly DecisionRow[]): DecisionPresentation {
  return {
    structured: decisions.filter((decision) => decision.structured === true),
    legacyPending: decisions.filter((decision) => decision.structured !== true && decision.outcome === 'pending'),
    legacySettled: decisions.filter((decision) => decision.structured !== true && decision.outcome !== 'pending'),
  }
}

function legacyRevisionAction(decision: DecisionRow): string {
  return `alternatives et recommandation non enregistrées; réviser avec track decision dossier ${decision.id}`
}

function legacyHistoryNote(decision: DecisionRow): string {
  return `outcome historique:${decision.outcome}; aucune option sélectionnée n'est attestée`
}

export function formatReport(report: Report, format: Format): string {
  if (format === 'json') return JSON.stringify(report, null, 2)
  const lines: string[] = []
  for (const bucket of BUCKETS) {
    const rows = report.buckets[bucket]
    lines.push(heading(bucket, rows.length, format))
    for (const r of rows) lines.push(rowLine(r, format))
    lines.push('')
  }
  if (report.decisions !== undefined) {
    const { structured, legacyPending, legacySettled } = classifyDecisions(report.decisions)
    lines.push(heading('DECISIONS', structured.length, format))
    for (const d of structured) {
      const t = title(d.title, format)
      // D6-B (WP5): surface the sponsor (= `accountable`, D6 resolved) when present. Additive — a
      // decision without a sponsor renders exactly as before (no trailing segment).
      const sponsor = d.accountable !== undefined ? ` · sponsor:${d.accountable}` : ''
      lines.push(
        format === 'md'
          ? `- **${t}** — ${d.decisionKind} · ${d.realization} · outcome:${d.outcome}${sponsor}`
          : `  - ${t} [${d.decisionKind}, ${d.realization}, outcome:${d.outcome}${d.accountable !== undefined ? `, sponsor:${d.accountable}` : ''}]`,
      )
      const alternatives = d.options?.map((option) => `${option.id}: ${title(option.title, format)} — ${title(option.summary, format)}`).join(' / ') ?? ''
      const recommendation = d.recommendation === undefined
        ? ''
        : `recommandation:${d.recommendation.optionId} — ${title(d.recommendation.rationale, format)}`
      lines.push(format === 'md' ? `  - alternatives: ${alternatives}` : `    alternatives: ${alternatives}`)
      lines.push(format === 'md' ? `  - ${recommendation}` : `    ${recommendation}`)
    }
    if (legacyPending.length > 0) {
      lines.push(heading('À INSTRUIRE (legacy)', legacyPending.length, format))
      for (const d of legacyPending) {
        const t = title(d.title, format)
        lines.push(format === 'md' ? `- **${t}** — ${legacyRevisionAction(d)}` : `  - ${t} [${legacyRevisionAction(d)}]`)
      }
    }
    if (legacySettled.length > 0) {
      lines.push(heading('HISTORIQUE NON STRUCTURÉ', legacySettled.length, format))
      for (const d of legacySettled) {
        const t = title(d.title, format)
        lines.push(format === 'md' ? `- **${t}** — ${legacyHistoryNote(d)}` : `  - ${t} [${legacyHistoryNote(d)}]`)
      }
    }
  }
  return lines.join('\n').trimEnd() + '\n'
}

function actionDisposition(r: ReportRow): string {
  if (r.engagementRef !== undefined) return 'relancer engagement/subagent'
  if (r.acceptance === 'fail' || r.acceptance === 'stale') return 'corriger puis revalider acceptance'
  if (r.realization === 'in-progress') return 'terminer ou expliciter blocage'
  return 'exécuter prochain incrément'
}

function cell(s: string): string {
  return clean(s).replaceAll('|', '¦')
}

function wrapCell(s: string, width: number): string[] {
  const c = cell(s).trim()
  if (c.length === 0) return ['']
  const words = c.split(/\s+/)
  const lines: string[] = []
  let line = ''
  for (const originalWord of words) {
    let word = originalWord
    while (word.length > width) {
      if (line.length > 0) {
        lines.push(line)
        line = ''
      }
      lines.push(word.slice(0, width))
      word = word.slice(width)
    }
    const next = line.length === 0 ? word : `${line} ${word}`
    if (next.length <= width) line = next
    else {
      lines.push(line)
      line = word
    }
  }
  if (line.length > 0) lines.push(line)
  return lines
}

function defaultCap(header: string): number {
  const k = header.toLowerCase()
  if (k.includes('sujet') || k.includes('items') || k.includes('à faire')) return 72
  if (k.includes('préconisation') || k.includes('dernières actions')) return 64
  if (k.includes('prochaine action')) return 44
  if (k.includes('complexité') || k.includes('notes') || k.includes('dropped')) return 38
  if (k.includes('scope')) return 42
  if (k === 'wp') return 30
  if (k.includes('wp')) return 42
  if (k === 'av.') return 6
  if (k.includes('bloqué')) return 18
  return 24
}

function table(
  headers: readonly string[],
  rows: readonly (readonly string[])[],
  capOverrides?: readonly (number | undefined)[],
): string[] {
  // Terminal-first padded table: aligned columns, bounded width, MULTI-LINE cells.
  // No ellipsis: long content wraps inside the column so the report stays readable and complete enough.
  const caps = headers.map((h, i) => capOverrides?.[i] ?? defaultCap(h))
  const head = headers.map((h, i) => cell(h).slice(0, caps[i]!))
  const wrappedRows = rows.map((row) => headers.map((_, i) => wrapCell(row[i] ?? '', caps[i]!)))
  const widths = head.map((h, i) => Math.min(caps[i]!, Math.max(h.length, ...wrappedRows.flatMap((r) => r[i]!).map((v) => v.length))))
  // Padding aligns interior columns; remove only terminal padding so reports and committed fixtures do not
  // carry invisible trailing whitespace.
  const renderLine = (row: readonly string[]): string => row.map((v, i) => v.padEnd(widths[i]!)).join('   ').trimEnd()
  const out = [renderLine(head), renderLine(widths.map((w) => '─'.repeat(w)))]
  for (const row of wrappedRows) {
    const height = Math.max(...row.map((cellLines) => cellLines.length))
    for (let y = 0; y < height; y++) out.push(renderLine(row.map((cellLines) => cellLines[y] ?? '')))
    out.push('') // breathing room between logical rows
  }
  if (out[out.length - 1] === '') out.pop()
  return out
}

/**
 * A BOX-DRAWN table (the shape the owner validated for DÉCISIONS). Cells may carry explicit `\n`
 * line breaks — one alternative per line — so a recommendation can sit on the line of its own option.
 * Deterministic: widths are derived from the content, capped per column, and long lines wrap.
 */
function drawTable(
  headers: readonly string[],
  rows: readonly (readonly string[])[],
  caps: readonly number[],
  center: readonly boolean[] = [],
): string[] {
  const split = (value: string, width: number): string[] =>
    value.split('\n').flatMap((line) => (line.trim() === '' ? [''] : wrapCell(line, width)))
  const wrapped = rows.map((row) => headers.map((_, i) => split(row[i] ?? '', caps[i]!)))
  const widths = headers.map((h, i) =>
    Math.min(caps[i]!, Math.max(cell(h).length, ...wrapped.flatMap((r) => r[i]!).map((v) => v.length), 1)),
  )
  const pad = (value: string, i: number): string =>
    center[i] === true
      ? ' '.repeat(Math.floor((widths[i]! - value.length) / 2)) +
        value +
        ' '.repeat(widths[i]! - value.length - Math.floor((widths[i]! - value.length) / 2))
      : value.padEnd(widths[i]!)
  const rule = (left: string, mid: string, right: string): string =>
    left + widths.map((w) => '─'.repeat(w + 2)).join(mid) + right
  const line = (cells: readonly string[]): string =>
    '│ ' + cells.map((v, i) => pad(v, i)).join(' │ ') + ' │'
  const out: string[] = [rule('┌', '┬', '┐'), line(headers.map((h) => cell(h))), rule('├', '┼', '┤')]
  wrapped.forEach((row, index) => {
    const height = Math.max(...row.map((cellLines) => cellLines.length))
    for (let y = 0; y < height; y++) out.push(line(row.map((cellLines) => cellLines[y] ?? '')))
    if (index < wrapped.length - 1) out.push(rule('├', '┼', '┤'))
  })
  out.push(rule('└', '┴', '┘'))
  return out
}

/**
 * Directive fallback for repos that have no WP containers yet. This is intentionally NOT the exhaustive
 * flat dump: it keeps deterministic action guidance while `--flat` remains available for
 * the full bucket listing.
 */
export function formatActionReport(report: Report, format: Format): string {
  if (format === 'json') return JSON.stringify(report, null, 2)
  const h = (label: string): string => (format === 'md' ? `## ${label}` : label)
  const lines: string[] = []
  const awaited = report.buckets.AWAITED
  const todo = report.buckets['TO-DO']
  const done = report.buckets.DONE
  const dropped = report.buckets.DROPPED
  const allDecisions = report.decisions ?? []
  const { structured, legacyPending, legacySettled } = classifyDecisions(allDecisions)
  const pendingDecisions = structured.filter((d) => d.outcome === 'pending')

  lines.push(h('SYNTHÈSE'))
  lines.push(...table(['fait', 'à-faire', 'attendus', 'dropped', 'décisions pending'], [[String(done.length), String(todo.length), String(awaited.length), String(dropped.length), String(pendingDecisions.length)]]))
  lines.push('')

  lines.push(h('ACTIONS DÉRIVÉES'))
  const candidates = [...awaited, ...todo]
  const actionRows: string[][] = []
  const focusCount = pendingDecisions.filter(decisionNeedsFocus).length
  if (focusCount >= 2 || pendingDecisions.length >= 4) {
    actionRows.push(['focus', 'décisions accumulées', 'focus (humain): lancer focus HTML local; régler toute option choisie avec track decision select'])
  }
  for (const r of candidates) {
    actionRows.push([
      r.bucket,
      title(r.title, format),
      `action (${r.engagementRef !== undefined ? 'h2a/subagent' : 'local/subagent'}): ${actionDisposition(r)}`,
    ])
  }
  lines.push(...table(['scope/gate', 'sujet', 'préconisation'], actionRows.length > 0 ? actionRows : [['-', 'aucune action dérivée ouverte', '-']]))
  lines.push('')

  if (structured.length > 0) {
    lines.push(h('DÉCISIONS'))
    lines.push(...table(
      ['dossier', 'alternatives enregistrées', 'recommandation / règlement'],
      structured.map((d) => [
        `${d.id} — ${title(d.title, format)} (${d.outcome})`,
        d.options?.map((option) => `${option.id}: ${title(option.title, format)} — ${title(option.summary, format)}`).join(' / ') ?? '-',
        `recommandée:${d.recommendation?.optionId ?? '-'}${d.selectedOptionId !== undefined ? `; sélectionnée:${d.selectedOptionId}` : d.outcome === 'pending' ? `; régler avec track decision select ${d.id} <option-id> --outcome <go|no-go>` : ''}`,
      ]),
    ))
    lines.push('')
  }
  if (legacyPending.length > 0) {
    lines.push(h('À INSTRUIRE'))
    lines.push(...table(
      ['dossier legacy', 'disposition sûre'],
      legacyPending.map((d) => [`${d.id} — ${title(d.title, format)}`, legacyRevisionAction(d)]),
    ))
    lines.push('')
  }
  if (legacySettled.length > 0) {
    lines.push(h('HISTORIQUE NON STRUCTURÉ'))
    lines.push(...table(
      ['dossier legacy', 'constat'],
      legacySettled.map((d) => [`${d.id} — ${title(d.title, format)}`, legacyHistoryNote(d)]),
    ))
    lines.push('')
  }

  lines.push(h('FAIT RÉCENT / REPÈRES'))
  const doneRows = done.map((r) => ['done', title(r.title, format), r.acceptance])
  for (const r of dropped) doneRows.push(['dropped', title(r.title, format), r.acceptance])
  lines.push(...table(['type', 'sujet', 'acceptance'], doneRows.length > 0 ? doneRows : [['-', 'aucun repère récent', '-']]))

  return lines.join('\n').trimEnd() + '\n'
}

const pctStr = (p: number | 'n/a'): string => (p === 'n/a' ? 'n/a' : `${p}%`)

/**
 * Strip a redundant leading `WPn — `/`WPn · `/`WPn -` prefix the WP item TITLE may already carry, so
 * the renderer's derived `${label} · ` is never doubled (`WP1 · WP1 — …`). Case-insensitive on `WP`,
 * tolerant of `—`/`·`/`-` separators and surrounding spaces; a title with no such prefix is unchanged.
 */
function stripWpPrefix(s: string): string {
  return s.replace(/^WP\d+(?:\.\d+)*\s*[—·-]\s*/i, '')
}

/**
 * Render the WP rollup forest in agent-stats' shape (Workpackages §2):
 *   - **WP1 · <title>** (done/total, pct%)
 *     - **WP1.1 · <title>** (done/total, pct%)
 *       - [x] <leaf>   / [ ] <leaf>
 * `total` = `active` (DONE+TO-DO+AWAITED); DROPPED leaves are shown with `[~]` and excluded from %.
 * `pct` is `n/a` for a 0/0 node (never 100%). `format` gates escaping — `md` escapes markdown
 * metacharacters (no formatting injection); `text` is CLEAN (no backslash leaks). Defaults to `md`.
 */
export function formatWpTree(tree: readonly WpNode[], format: Format = 'md'): string {
  const lines: string[] = []
  const bold = (s: string): string => (format === 'md' ? `**${s}**` : s)
  const render = (node: WpNode, depth: number): void => {
    const indent = '  '.repeat(depth)
    const label = `${node.label} · ${title(stripWpPrefix(node.title), format)}`
    lines.push(`${indent}- ${bold(label)} (${node.done}/${node.active}, ${pctStr(node.pct)})`)
    for (const leaf of node.leaves) {
      const box = leaf.bucket === 'DONE' ? '[x]' : leaf.bucket === 'DROPPED' ? '[~]' : '[ ]'
      lines.push(`${indent}  - ${box} ${title(leaf.title, format)}`)
    }
    for (const child of node.children) render(child, depth + 1)
  }
  for (const node of tree) render(node, 0)
  return lines.join('\n') + (lines.length > 0 ? '\n' : '')
}

/**
 * Global totals — every directly-attached WP leaf exactly once, plus `outsideRollup` rows that a leaf-only
 * forest cannot represent. That makes the conductor denominator identical to the flat bucket denominator.
 */
export interface WpTotals {
  done: number
  active: number
  dropped: number
  pct: number | 'n/a'
}

/**
 * Sum the forest's leaves ONCE: every non-WP leaf is attached to exactly one node (`directLeaves`
 * stops at sub-WP boundaries), so a flat walk over `node.leaves` is the true global total — never the
 * roots' rolled-up counts (which would double-count nested sub-WP leaves).
 */
export function wpTotals(tree: readonly WpNode[], outsideRollup: readonly ReportRow[] = []): WpTotals {
  let done = 0
  let active = 0
  let dropped = 0
  const walk = (node: WpNode): void => {
    for (const l of node.leaves) {
      if (l.bucket === 'DONE') {
        done++
        active++
      } else if (l.bucket === 'AWAITED' || l.bucket === 'TO-DO') {
        active++
      } else dropped++
    }
    for (const c of node.children) walk(c)
  }
  for (const node of tree) walk(node)
  for (const row of outsideRollup) {
    if (row.bucket === 'DONE') {
      done++
      active++
    } else if (row.bucket === 'AWAITED' || row.bucket === 'TO-DO') {
      active++
    } else {
      dropped++
    }
  }
  return { done, active, dropped, pct: active === 0 ? 'n/a' : Math.round((done / active) * 100) }
}

/** Open (non-DONE, non-DROPPED) leaves under a node — what À-FAIRE lists as `◦ <title>`. */
function openLeaves(node: WpNode): WpNode['leaves'] {
  const out: WpNode['leaves'] = []
  const walk = (n: WpNode): void => {
    for (const l of n.leaves) if (l.bucket === 'TO-DO' || l.bucket === 'AWAITED') out.push(l)
    for (const c of n.children) walk(c)
  }
  walk(node)
  return out
}

/** DROPPED leaves under a node — shown aside in À-FAIRE, excluded from %. */
function droppedLeaves(node: WpNode): WpNode['leaves'] {
  const out: WpNode['leaves'] = []
  const walk = (n: WpNode): void => {
    for (const l of n.leaves) if (l.bucket === 'DROPPED') out.push(l)
    for (const c of n.children) walk(c)
  }
  walk(node)
  return out
}

/**
 * §A3 — a short human STATUS tag for one open leaf. It is the COHORT KEY for the render-only collapse:
 * two leaves in the SAME WP with the same tag are one cohort. RENDER-ONLY — never touches `directives[]`.
 */
function leafStatusTag(l: WpLeaf): string {
  if (l.acceptance === 'fail') return 'acceptance fail'
  if (l.acceptance === 'stale') return 'acceptance stale'
  if (l.realization === 'in-progress') return 'en cours'
  if (l.bucket === 'AWAITED') return 'en attente'
  if (l.openBlockers.length > 0) return 'bloqué'
  if (l.specStatus === 'to-specify') return 'à spécifier'
  return 'à démarrer'
}

export interface LeafCohort {
  tag: string
  count: number
  /** Member leaf titles (CLEAN, deterministic by leaf id). */
  titles: string[]
}

/**
 * §A3 — cohort-collapse: fold a WP's open leaves into `{tag, count, titles}` groups by `leafStatusTag`.
 * RENDER-ONLY and STRICTLY INTRA-WP (the caller passes ONE WP's leaves, so a cohort never spans WPs). The
 * machine `directives[]` / `dispatchQueue` are NEVER collapsed — this is a pure presentation fold. Cohorts
 * are ordered by first appearance in id-sorted leaf order (deterministic, no flicker).
 */
export function collapseLeafCohorts(leaves: readonly WpLeaf[]): LeafCohort[] {
  const byId = [...leaves].sort((a, b) => a.id.localeCompare(b.id))
  const order: string[] = []
  const groups = new Map<string, LeafCohort>()
  for (const l of byId) {
    const tag = leafStatusTag(l)
    let g = groups.get(tag)
    if (g === undefined) {
      g = { tag, count: 0, titles: [] }
      groups.set(tag, g)
      order.push(tag)
    }
    g.count++
    g.titles.push(clean(l.title))
  }
  return order.map((tag) => groups.get(tag)!)
}

/**
 * Report-revamp — the 3-table CONDUCTOR view over the WP forest (the owner reports THROUGH this):
 *   FAIT             — WPs at 100% + a global done/total, pct%.
 *   À-FAIRE (%·WP)   — one row per non-100% WP `WPn · title — done/active pct%`, then its OPEN leaves
 *                      (`◦ <title>`); DROPPED shown aside.
 *   ATTENDUS         — AWAITED (blocked) leaves carrying a derived disposition tag
 *                      (`décision: owner` when AWAITED-on-a-decision or carrying an open engagementRef,
 *                      else `action: agent`).
 * `format` gates escaping (md escapes; text is clean). The forest's leaves drive every section.
 */
export interface ReportViewTable {
  id: string
  title: string
  columns: readonly { id: string; label: string }[]
  rows: readonly Record<string, string>[]
  /**
   * How the section is rendered: `padded` = the aligned terminal table (default), `drawn` = the
   * box-drawn table the owner validated for DÉCISIONS, `prose` = `lines` instead of rows.
   */
  render?: 'padded' | 'drawn' | 'prose'
  /** Prose sections (RECOMMANDATION) carry ordered lines rather than a grid. */
  lines?: readonly string[]
}

/** Makes the two public `directives` arrays self-describing instead of relying on their JSON path. */
export interface DirectivesProjection {
  kind: 'conductor-action-directives'
  order: 'canonical-urgency'
}

/** Makes the flat directive-id queue self-describing instead of requiring a consumer-side filter. */
export interface DispatchQueueProjection {
  kind: 'delegable-directive-ids'
  order: 'canonical-urgency'
  modes: readonly ('subagent' | 'local')[]
}

/**
 * Criterion 10b — a short, stable handle for one actionable row. Derived from the WP position (`8.1` =
 * the first open item of WP8), so it is identical across two runs over the same log, and it carries NO
 * ULID (criterion 10a). `track report --resolve <handle>` is the one command that resolves it.
 */
export interface ReportHandle {
  handle: string
  kind: 'item' | 'decision'
  id: string
  title: string
  wpLabel?: string
}

/**
 * Criterion 17 (as reconciled) — compactness accounting. `projected` counts the rows the deterministic
 * projection carries (WP nodes + hors-rollup rows + unscoped rows + dossiers); `rendered` counts the rows
 * the four sections actually print. Compression is legitimate — a report is a decision surface, not an
 * inventory — but it must be DECLARED, never silent. `omitted` names what was dropped; by construction it
 * only ever holds WPs with no open work and no recorded gate (criterion 18 protects the rest).
 */
export interface ReportCoverage {
  projected: number
  rendered: number
  omitted: readonly string[]
}

/**
 * Criterion 1 (as scoped by the 2026-07-29 correction) — the header carries the ACCEPTANCE BASELINE and
 * states that the report covers the whole log. It must NOT name a window: `--since`/`--until`/`--period`
 * do not exist yet, so a named window would be a claim nothing can support.
 */
export interface ReportHeader {
  scope: string
  progress: string
  baselineCommit?: string
  window: string
  sources: readonly string[]
  coverage: ReportCoverage
  handleCommand: string
}

export interface ReportView {
  kind: 'wp-conductor-report'
  locale: 'fr'
  header: ReportHeader
  tables: readonly ReportViewTable[]
  /** Criterion 10b — every actionable row's handle, and what it resolves to. */
  handles: readonly ReportHandle[]
  coverage: ReportCoverage
  /**
   * The actionable directives rendered by this conductor. `directivesProjection` names their meaning and
   * canonical urgency ordering so they cannot be confused with SnapshotV1's rule-derived fact projection.
   */
  directives: readonly Directive[]
  directivesProjection: DirectivesProjection
  /** The flat, prioritized ids of the directive subset executable by a local/subagent lane. */
  dispatchQueue: readonly string[]
  dispatchQueueProjection: DispatchQueueProjection
  /**
   * ADDITIVE (report-revamp §A5) — the keystone item (max 1-hop fan-in, tie-break ULID): the single item
   * whose completion unblocks the most others. Present iff ≥1 open dependency exists. Drop-when-absent.
   */
  keystone?: Keystone
}

/**
 * Render ONE directive to a human FR phrase — RENDER-ONLY (no phrase is ever stored as data, DESIGN §3).
 * Maps the langue-neutre `(mode, step, gate)` to a sentence. An UNKNOWN `step.code` (a future vocabulary
 * entry this renderer predates) degrades to the `inspect-fallback` phrasing — forward-compat (DESIGN §7).
 */
export function directivePhrase(d: Directive): string {
  // §A6 — a directive renders a CONCRETE next move + the actor, and NAMES what blocks (the info the
  // `sujet` column does NOT already carry). All interpolated titles/refs are RAW here — the render layer
  // (table `esc`, inline `clean`, html `escapeHtml`) escapes them (§A4). A decision surfaces as a "décision"
  // line ONLY when it genuinely blocks (mode `human-decision`); otherwise the phrase préconise a step.
  //
  // Unified presentation (spec 2026-07-11) — the action CLAUSE is the shared canonical `stepActionFr`, so
  // the terminal and the cockpit can never re-word apart. The terminal keeps its OWN compact sentence frame
  // (`<nature> (<actor>): <clause>`) and its blocked-by suffix: those are renderer-owned, not shared.
  const on = (): string => {
    const t = d.gate?.blockedByTitle
    if (t !== undefined && t.trim() !== '') return ` sur « ${t} »`
    const r = d.gate?.ref
    return r !== undefined && r.trim() !== '' ? ` (réf ${r})` : ''
  }
  if (d.mode === 'human-decision') {
    const who = d.facts.accountable ?? 'owner'
    return `décision (${who}): ${stepActionFr(d.step.code)}`
  }
  if (d.mode === 'h2a-engagement') {
    const ref = d.gate?.ref
    return `engagement (h2a): ${stepActionFr(d.step.code)}${ref !== undefined && ref.trim() !== '' ? ` ${ref}` : ''}`
  }
  const mode = d.mode === 'local' ? 'local' : 'subagent'
  // The blocked-by detail (`sur « … »` / `(réf …)`) is info the single `préconisation` column adds beyond
  // the shared clause; the two steps that name a blocking target keep it.
  const suffix = d.step.code === 'resolve-external-blocker' || d.step.code === 'finish-increment' ? on() : ''
  return `action (${mode}): ${stepActionFr(d.step.code)}${suffix}`
}

// ---- the four owner-facing sections (spec 2026-07-29) ----------------------------------------------
// FAIT · À-FAIRE · DÉCISIONS · RECOMMANDATION. Nothing else is a top-level section: what mattered in the
// old `À-FAIRE SANS WP` / `HORS ROLLUP` / `À INSTRUIRE` / `HISTORIQUE NON STRUCTURÉ` / `ACTIONS DÉRIVÉES`
// tables is folded INTO the four, by title — never deleted (criteria 17/18).

/** No blockage is RECORDED. Never emitted when a gate exists (criterion 19). */
const NO_GATE = '—'
/** No next action, and none is owed: the row is gated on a decision (criterion 14, as scoped). */
const NO_ACTION = '—'

/** A gate → the SHORT token `bloqué` carries. A decision gate is replaced by its D/Q number. */
const GATE_TOKEN: Record<DirectiveGateCode, string> = {
  'decision-pending': 'décision',
  'engagement-pending': 'h2a',
  'external-dependency': 'dépendance',
  'linked-dependency': 'dépendance',
  'manual-blocker': 'blocage',
  'spec-not-ready': 'spec',
  'acceptance-failed': 'recette KO',
  'acceptance-stale': 'recette',
  'priority-missing': 'priorité',
}

/** DONE leaves under a node, most recent first (ULIDs sort by time), for FAIT's `dernières actions`. */
function recentDoneLeaves(node: WpNode): WpNode['leaves'] {
  const out: WpNode['leaves'] = []
  const walk = (n: WpNode): void => {
    for (const l of n.leaves) if (l.bucket === 'DONE') out.push(l)
    for (const c of n.children) walk(c)
  }
  walk(node)
  return out.sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
}

const LAST_ACTIONS_SHOWN = 3

/**
 * FAIT's third column (criterion 3/4): the LAST RECORDED ACTIONS of that scope — never a restatement of
 * the arithmetic. When the scope carries more completions than fit, the compression is DECLARED rather
 * than hidden behind a silent tail.
 */
function lastActionsCell(titles: readonly string[]): string {
  if (titles.length === 0) return 'aucune action enregistrée'
  const shown = titles.slice(0, LAST_ACTIONS_SHOWN)
  const suffix = titles.length > shown.length ? ` — ${shown.length} des ${titles.length} actions enregistrées` : ''
  return shown.join(' · ') + suffix
}

const OPTION_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const optionLetter = (index: number): string => OPTION_LETTERS[index] ?? `#${index + 1}`

/**
 * The DÉCISIONS column widths, SHARED between the builder and the renderer. The builder wraps the
 * `alternatives` cell itself so it can emit the `préco` cell with exactly matching blank lines: that is
 * what puts each recommendation ON THE LINE OF ITS OWN OPTION instead of on some continuation line.
 */
const DECISION_CAPS = [6, 40, 46, 14] as const

/** `[1,2,3,5]` → `D1–D3 · D5`: the compact form the validated report uses for a run of decisions. */
function compactRefs(refs: readonly string[]): string {
  const uniq = [...new Set(refs)]
  const numeric = uniq.filter((r) => /^D\d+$/u.test(r)).map((r) => Number(r.slice(1))).sort((a, b) => a - b)
  const other = uniq.filter((r) => !/^D\d+$/u.test(r))
  const parts: string[] = []
  for (let i = 0; i < numeric.length; ) {
    let j = i
    while (j + 1 < numeric.length && numeric[j + 1] === numeric[j]! + 1) j++
    parts.push(j - i >= 2 ? `D${numeric[i]}–D${numeric[j]}` : numeric.slice(i, j + 1).map((n) => `D${n}`).join(' · '))
    i = j + 1
  }
  return [...parts, ...other].join(' · ')
}

export interface ConductorMeta {
  /** The acceptance baseline the report is judged against — NOT a reporting window (criterion 1). */
  baselineCommit?: string
}

export function buildWpConductorView(
  tree: readonly WpNode[],
  decisions: readonly DecisionRow[] = [],
  outsideRollup: readonly ReportRow[] = [],
  totalScope = 'global',
  meta: ConductorMeta = {},
): ReportView {
  const wpName = (n: WpNode): string => `${n.label} · ${clean(stripWpPrefix(n.title))}`
  const totals = wpTotals(tree, outsideRollup)
  const wpNodes: WpNode[] = []
  const collectWpNodes = (nodes: readonly WpNode[]): void => {
    for (const node of nodes) {
      wpNodes.push(node)
      collectWpNodes(node.children)
    }
  }
  collectWpNodes(tree)

  const directives = buildDirectives(tree, decisions)
  const dispatchQueue = dispatchQueueOf(directives)
  const keystone = keystoneOf(tree)
  const { structured: structuredDecisions, legacyPending, legacySettled } = classifyDecisions(decisions)

  // ---- decision numbering (criterion 16) ----------------------------------------------------------
  // A D-number is RESERVED for a dossier whose options AND recommendation are stored and still pending:
  // those are the only ones an owner can answer with a letter. Everything else keeps a `Q` handle so it
  // stays addressable (10b) without ever being offered in the reply line.
  const structuredPending = structuredDecisions.filter((d) => d.outcome === 'pending')
  const decisionOrder = [
    ...structuredPending,
    ...structuredDecisions.filter((d) => d.outcome !== 'pending'),
    ...legacyPending,
    ...legacySettled,
  ]
  const decisionRef = new Map<string, string>()
  structuredPending.forEach((d, i) => decisionRef.set(d.id, `D${i + 1}`))
  let qCounter = 0
  for (const d of decisionOrder) if (!decisionRef.has(d.id)) decisionRef.set(d.id, `Q${++qCounter}`)

  // ---- handles (criteria 10b/10c) -----------------------------------------------------------------
  // Handles are POSITIONAL WITHIN THIS REPORT (`[row.item]`), assigned AFTER À-FAIRE is ordered. Leg A
  // established that no content-derived handle can be stable across runs — ordering, titles and WP
  // membership all move — so the identifier is RELOCATED, not invented: the resolution block at the end
  // of the page maps every emitted handle to its item id, and no ULID enters a column the owner reads.
  const handles: ReportHandle[] = []

  // ---- FAIT ---------------------------------------------------------------------------------------
  const outsideDone = outsideRollup.filter((r) => r.bucket === 'DONE' || r.bucket === 'DROPPED')
  const doneRows: Record<string, string>[] = [
    {
      scope: totalScope,
      progress: `${totals.done}/${totals.active} (${pctStr(totals.pct)})`,
      lastActions: lastActionsCell(
        wpNodes
          .flatMap((n) => n.leaves.filter((l) => l.bucket === 'DONE'))
          .sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
          .map((l) => clean(l.title)),
      ),
    },
    ...wpNodes
      .filter((n) => n.done > 0)
      .map((n) => ({
        scope: wpName(n),
        progress: `${n.done}/${n.active} (${pctStr(n.pct)})`,
        lastActions: lastActionsCell(recentDoneLeaves(n).map((l) => clean(l.title))),
      })),
    ...(outsideDone.length > 0
      ? [{
          scope: 'hors WP',
          progress: (() => {
            const done = outsideRollup.filter((r) => r.bucket === 'DONE').length
            const active = outsideRollup.filter((r) => r.bucket !== 'DROPPED').length
            return `${done}/${active} (${pctStr(active === 0 ? 'n/a' : Math.round((done / active) * 100))})`
          })(),
          lastActions: outsideDone
            .map((r) => `${clean(r.title)}${r.bucket === 'DROPPED' ? ' (abandonné)' : ''}`)
            .join(' · '),
        }]
      : []),
  ]

  // ---- À-FAIRE ------------------------------------------------------------------------------------
  const directivesByWpId = new Map<string, Directive[]>()
  for (const directive of directives) {
    const wpId = directive.scope.wpId
    if (wpId === undefined) continue
    const attached = directivesByWpId.get(wpId)
    if (attached === undefined) directivesByWpId.set(wpId, [directive])
    else attached.push(directive)
  }
  const urgencyIndex = new Map(directives.map((d, i) => [d.id, i]))

  /**
   * Criterion 7 + 19 — `bloqué` names the ANSWER that unblocks (a D-number) when the gate is a dossier,
   * and a short gate token otherwise. It renders `—` ONLY when no gate is recorded at all.
   */
  const blockedCell = (attached: readonly Directive[]): string => {
    const refs: string[] = []
    for (const d of attached) {
      const gate = d.gate
      if (gate === undefined) continue
      const dossier = gate.code === 'decision-pending' ? decisionRef.get(gate.ref ?? '') : undefined
      refs.push(dossier ?? GATE_TOKEN[gate.code] ?? 'blocage')
    }
    return refs.length === 0 ? NO_GATE : compactRefs(refs)
  }
  const nextActionCell = (attached: readonly Directive[]): string => {
    const phrases = attached.filter((d) => d.mode !== 'human-decision').map(directivePhrase)
    return phrases.length === 0 ? NO_ACTION : [...new Set(phrases)].join(' / ')
  }
  const directiveIds = (attached: readonly Directive[]): string => attached.map((d) => d.id).join(',')
  // Machine-only audit properties (NOT declared columns, so no renderer ever prints them): the precise
  // gate phrase the short `bloqué` token compacts, kept so nothing is lost from the projection.
  const gateDetail = (attached: readonly Directive[]): string =>
    [...new Set(attached.map((d) => gatePhraseFr(d.gate)).filter((p): p is string => p !== undefined))].join(' / ')

  /** One actionable item inside an À-FAIRE row — its handle is assigned once the rows are ordered. */
  interface TodoItem { id: string; title: string; note?: string }
  interface TodoDraft {
    wp: string
    progress: string
    items: TodoItem[]
    blocked: string
    nextAction: string
    directiveIds: string
    gateDetail: string
    order: string
  }

  const wpTodoDrafts: TodoDraft[] = wpNodes
    .filter((n) => openLeaves(n).length > 0 || directivesByWpId.has(n.id))
    .map((n) => {
      const attached = directivesByWpId.get(n.id) ?? []
      const items: TodoItem[] = openLeaves(n).map((l) => ({ id: l.id, title: clean(l.title) }))
      // A directive may target a DONE leaf with acceptance debt: name it here (with its own handle)
      // instead of exiling it to a `cible action` column the owner never asked for.
      for (const d of attached) {
        if (d.target.kind === 'decision' || items.some((i) => i.id === d.target.id)) continue
        items.push({ id: d.target.id, title: clean(d.target.title ?? d.target.id), note: d.facts.bucket.toLowerCase() })
      }
      return {
        wp: wpName(n),
        progress: pctStr(n.pct),
        items,
        blocked: blockedCell(attached),
        nextAction: nextActionCell(attached),
        directiveIds: directiveIds(attached),
        gateDetail: gateDetail(attached),
        order: String(Math.min(...attached.map((d) => urgencyIndex.get(d.id) ?? 9999), 9999)).padStart(5, '0'),
      }
    })

  // A pending dossier with no WP ancestor is still open work the owner must see: it lands in À-FAIRE
  // (criterion 2 — it is not a top-level section of its own), one row, gated on its own D/Q number.
  const unscopedDirectives = directives.filter((d) => d.scope.wpId === undefined)
  const outsideOpen = outsideRollup.filter(
    (r) => (r.bucket === 'TO-DO' || r.bucket === 'AWAITED') && !unscopedDirectives.some((d) => d.target.id === r.id),
  )
  const horsWpDrafts: TodoDraft[] = []
  if (unscopedDirectives.length > 0) {
    horsWpDrafts.push({
      wp: 'hors WP · dossiers',
      progress: 'n/a',
      items: unscopedDirectives.map((d) => ({ id: d.target.id, title: clean(d.target.title ?? d.target.id) })),
      blocked: blockedCell(unscopedDirectives),
      nextAction: nextActionCell(unscopedDirectives),
      directiveIds: directiveIds(unscopedDirectives),
      gateDetail: gateDetail(unscopedDirectives),
      order: String(Math.min(...unscopedDirectives.map((d) => urgencyIndex.get(d.id) ?? 9999))).padStart(5, '0'),
    })
  }
  if (outsideOpen.length > 0) {
    horsWpDrafts.push({
      wp: 'hors WP · items',
      progress: 'n/a',
      items: outsideOpen.map((r) => ({ id: r.id, title: clean(r.title) })),
      blocked: NO_GATE,
      nextAction: `action (subagent): ${stepActionFr('inspect-fallback')}`,
      directiveIds: '',
      gateDetail: '',
      order: '09998',
    })
  }

  // Criterion 17 — compression is allowed, silence is not. A WP with NO open work, NO recorded gate and
  // NO recorded completion appears in neither FAIT nor À-FAIRE: it is omitted, and DECLARED in the header
  // count. Criterion 18 is what keeps that safe: a WP that carries open work, and every pending dossier,
  // is in the rendered lists above and can never fall here.
  const omitted = wpNodes
    .filter((n) => n.done === 0 && openLeaves(n).length === 0 && !directivesByWpId.has(n.id))
    .map(wpName)

  const orderedDrafts = [...wpTodoDrafts, ...horsWpDrafts].sort((a, b) =>
    a.order === b.order ? a.wp.localeCompare(b.wp) : a.order.localeCompare(b.order),
  )

  // Handles are assigned HERE, once the order is final: `[row.item]`, both 1-based (criterion 10b/10c).
  const orderedTodo: Record<string, string>[] = orderedDrafts.map((draft, rowIndex) => {
    const cells = draft.items.map((item, itemIndex) => {
      const handle = `${rowIndex + 1}.${itemIndex + 1}`
      const wpLabel = draft.wp.split(' · ')[0]
      handles.push({
        handle, kind: 'item', id: item.id, title: item.title,
        ...(wpLabel === undefined ? {} : { wpLabel }),
      })
      return `[${handle}] ${item.title}${item.note === undefined ? '' : ` (${item.note})`}`
    })
    return {
      wp: draft.wp,
      progress: draft.progress,
      todo: cells.join(' / '),
      blocked: draft.blocked,
      nextAction: draft.nextAction,
      directiveIds: draft.directiveIds,
      gateDetail: draft.gateDetail,
    }
  })
  for (const d of decisionOrder) {
    handles.push({ handle: decisionRef.get(d.id)!, kind: 'decision', id: d.id, title: clean(d.title) })
  }

  const todoRows = orderedTodo.length > 0
    ? orderedTodo
    : [{ wp: '—', progress: 'n/a', todo: 'aucun WP ouvert', blocked: NO_GATE, nextAction: NO_ACTION, directiveIds: '' }]

  // ---- DÉCISIONS ----------------------------------------------------------------------------------
  const decisionRows: Record<string, string>[] = []
  for (const d of decisionOrder) {
    const ref = decisionRef.get(d.id)!
    const options = d.options ?? []
    const letterOf = new Map(options.map((option, i) => [option.id, optionLetter(i)]))
    // Criterion 16 — the recommendation sits on the LINE OF ITS OWN OPTION, and an unstructured dossier
    // carries no letter at all rather than being dressed up as an owner choice.
    const altLines: string[] = []
    const precoLines: string[] = []
    const recommended = d.recommendation === undefined ? undefined : letterOf.get(d.recommendation.optionId)
    const selected = d.selectedOptionId === undefined ? undefined : letterOf.get(d.selectedOptionId)
    options.forEach((option, i) => {
      const letter = optionLetter(i)
      const wrapped = wrapCell(`${letter} ${clean(option.title)} — ${clean(option.summary)}`, DECISION_CAPS[2])
      const marks: string[] = []
      if (letter === recommended) marks.push(letter)
      if (letter === selected) marks.push('retenu')
      altLines.push(...wrapped)
      precoLines.push(marks.join(' '), ...Array<string>(wrapped.length - 1).fill(''))
    })
    if (d.outcome !== 'pending') precoLines.push(`réglé (${d.outcome})`)
    const alternatives = options.length > 0 ? altLines.join('\n') : 'non enregistrées'
    let preco = options.length > 0
      ? precoLines.join('\n')
      : d.outcome === 'pending'
        ? 'à structurer'
        : `réglé (${d.outcome}) · aucune option attestée`
    if (preco.trim() === '') preco = '—'
    decisionRows.push({ n: ref, subject: shortDecisionSubject(d.title), alternatives, preco })
  }
  if (decisionRows.length === 0) {
    decisionRows.push({ n: '—', subject: 'aucun dossier enregistré', alternatives: 'non enregistrées', preco: '—' })
  }

  // ---- RECOMMANDATION ------------------------------------------------------------------------------
  const startable = orderedTodo.filter(
    (row) => row['nextAction'] !== NO_ACTION && !/^D\d/u.test(row['blocked'] ?? ''),
  )
  const unlockedBy = (ref: string): string[] =>
    orderedTodo.filter((row) => (row['blocked'] ?? '').includes(ref)).map((row) => (row['wp'] ?? '').split(' · ')[0]!)
  const recommendationLines: string[] = []
  recommendationLines.push(
    startable.length === 0
      ? 'Sans décision : aucune lane exécutable sans réponse n’est attestée dans le journal.'
      : `Sans décision : ${startable
          .slice(0, 3)
          .map((row) => `${(row['wp'] ?? '').split(' · ')[0]} — ${row['nextAction']}`)
          .join(' ; ')}.`,
  )
  if (structuredPending.length === 0) {
    recommendationLines.push('Aucun D# disponible : aucun dossier structuré sélectionnable dans le journal.')
  } else {
    for (const d of structuredPending) {
      const ref = decisionRef.get(d.id)!
      const letter = d.recommendation === undefined
        ? undefined
        : optionLetter((d.options ?? []).findIndex((o) => o.id === d.recommendation!.optionId))
      const targets = unlockedBy(ref)
      recommendationLines.push(
        `${ref}${letter === undefined ? '' : ` ${letter}`} → débloque ${targets.length > 0 ? [...new Set(targets)].join(', ') : 'le dossier lui-même'}.`,
      )
    }
  }
  const replyLine = structuredPending.length === 0
    ? 'Réponds « vas y » pour lancer les lanes sans décision.'
    : `Réponds « vas y » (les lanes sans décision) ou « ${structuredPending
        .map((d) => {
          const ref = decisionRef.get(d.id)!
          const letter = d.recommendation === undefined
            ? 'A'
            : optionLetter((d.options ?? []).findIndex((o) => o.id === d.recommendation!.optionId))
          return `${ref} ${letter}`
        })
        .join(' · ')} » (tout débloquer).`
  recommendationLines.push(replyLine)

  // ---- coverage (criteria 17/18) --------------------------------------------------------------------
  // 17 — the report STATES both counts, so omission is a declared act rather than a silent one. Both
  // numbers count the SAME unit: rows of the deterministic projection. `rendered` is therefore always a
  // subset of `projected`, and `projected - rendered === omitted.length`.
  // 18 — the two classes that may never be omitted (a WP carrying open work, a pending dossier) are
  // structurally in the rendered lists above, whatever the compression ratio.
  const projectedRows = wpNodes.length + outsideRollup.length + unscopedDirectives.length + decisions.length
  const coverage: ReportCoverage = {
    projected: projectedRows,
    rendered: projectedRows - omitted.length,
    omitted,
  }

  const header: ReportHeader = {
    scope: totalScope,
    progress: `${totals.done}/${totals.active} (${pctStr(totals.pct)})`,
    ...(meta.baselineCommit !== undefined ? { baselineCommit: meta.baselineCommit.slice(0, 12) } : {}),
    // Criterion 1, as scoped: no `--since`/`--until`/`--period` exists yet, so no window may be named.
    window: 'couvre l’intégralité du journal (aucune fenêtre de période)',
    sources: ['projection déterministe du journal (track report --wp --decisions)'],
    coverage,
    handleCommand: 'track report --resolve <handle>',
  }

  return {
    kind: 'wp-conductor-report',
    locale: 'fr',
    header,
    tables: [
      {
        id: 'done',
        title: 'FAIT',
        columns: [
          { id: 'scope', label: 'scope' },
          { id: 'progress', label: 'avancement' },
          { id: 'lastActions', label: 'dernières actions' },
        ],
        rows: doneRows,
      },
      {
        id: 'todo',
        title: 'À-FAIRE',
        columns: [
          { id: 'wp', label: 'WP' },
          { id: 'progress', label: 'av.' },
          { id: 'todo', label: 'à faire' },
          { id: 'blocked', label: 'bloqué' },
          { id: 'nextAction', label: 'prochaine action' },
        ],
        rows: todoRows,
      },
      {
        id: 'decisions',
        title: 'DÉCISIONS',
        render: 'drawn',
        columns: [
          { id: 'n', label: '#' },
          { id: 'subject', label: 'sujet' },
          { id: 'alternatives', label: 'alternatives' },
          { id: 'preco', label: 'préco' },
        ],
        rows: decisionRows,
      },
      {
        id: 'recommendation',
        title: 'RECOMMANDATION',
        render: 'prose',
        columns: [],
        rows: [],
        lines: recommendationLines,
      },
    ],
    handles,
    coverage,
    directives,
    directivesProjection: { kind: 'conductor-action-directives', order: 'canonical-urgency' },
    dispatchQueue,
    dispatchQueueProjection: { kind: 'delegable-directive-ids', order: 'canonical-urgency', modes: ['subagent', 'local'] },
    ...(keystone !== undefined ? { keystone } : {}),
  }
}

/**
 * Criterion 11 — a decision SUBJECT, not the stored title pasted verbatim. Deterministic and lossless of
 * meaning: it drops a leading enumeration counter (`1/6 — `, `x7 — `) that carries no question. Turning
 * the remainder into a short question is a synthesis act and belongs to the skill, not to this renderer:
 * inventing a shorter wording here would be fabrication.
 */
export function shortDecisionSubject(storedTitle: string): string {
  return clean(storedTitle).replace(/^(?:\d+\s*\/\s*\d+|x\d+|§\d+)\s*[—–-]\s*/u, '')
}

/** The À-FAIRE ordering rule, printed so the owner knows why the rows are in this order (criterion 6). */
const TODO_ORDER_NOTE = 'ordre = priorité ; les cinq premiers sont le focus'

function headerLines(view: ReportView, format: Format): string[] {
  const h = view.header
  const em = (s: string): string => (format === 'md' ? `*${s}*` : s)
  const lines = [
    format === 'md'
      ? `# TRACK REPORT — ${h.scope} · ${h.progress}`
      : `TRACK REPORT — ${h.scope} · ${h.progress}`,
    em(
      `baseline d’acceptance : ${h.baselineCommit ?? 'non résolue'} · ${h.window}`,
    ),
    em(`couverture : ${h.coverage.projected} lignes projetées · ${h.coverage.rendered} rendues${h.coverage.omitted.length > 0 ? ` · ${h.coverage.omitted.length} omise${h.coverage.omitted.length > 1 ? 's' : ''} (aucun travail ouvert, aucun blocage enregistré)` : ''}`),
    em(`sources : ${h.sources.join(' ; ')}`),
    '',
  ]
  return lines
}

/**
 * Criteria 10b/10c — the machine's half of the page. It is NOT a fifth section and NOT a table the owner
 * reads: it is the block that makes a handle actionable, and the place the ULID is allowed to live. It
 * states plainly that handles are positional and per-report, so a reply quoting `[3.2]` without the report
 * it came from is not actionable.
 */
export const RESOLUTION_TITLE = 'RÉSOLUTION DES HANDLES (bloc machine — pas une table à lire)'

export function resolutionLines(view: ReportView): string[] {
  const lines = [
    RESOLUTION_TITLE,
    'handles positionnels, valables pour CE rapport uniquement : une réponse qui cite un handle sans son rapport n’est pas actionnable.',
    `commande : ${view.header.handleCommand}`,
  ]
  for (const h of view.handles) lines.push(`${h.handle}\t${h.id}\t${h.title}`)
  if (view.handles.length === 0) lines.push('(aucun handle émis)')
  return lines
}

function renderReportView(view: ReportView, format: Format): string {
  if (format === 'json') return JSON.stringify(view, null, 2) + '\n'
  // User-originated cell content (titles) is escaped per-format: `md` escapes markdown metacharacters so a
  // crafted item title cannot inject formatting (parity with the legacy `formatReport`/`title` path); `text`
  // is clean. The view model itself stays RAW (escaping is a render-only concern). `displayCell` keeps the
  // machine-generated `[n.m]` handle out of that escaped span so the three formats agree on it.
  const esc = (s: string): string => displayCell(s, format)
  const h = (label: string): string => (format === 'md' ? `## ${label}` : label)
  const lines: string[] = headerLines(view, format)
  for (const section of view.tables) {
    lines.push(h(section.title))
    if (section.render === 'prose') {
      // Renderer-authored French sentences interpolating only derived labels, handles and D-numbers —
      // never a raw user title, so there is nothing to escape and nothing to inject.
      lines.push(...(section.lines ?? []))
    } else if (section.render === 'drawn') {
      // The box-drawn table is emitted verbatim; `md` fences it so the alignment survives.
      const drawn = drawTable(
        section.columns.map((c) => c.label),
        section.rows.map((row) => section.columns.map((c) => clean0(row[c.id] ?? ''))),
        DECISION_CAPS,
        [false, false, false, true],
      )
      const fence = fenceFor(drawn)
      if (format === 'md') lines.push(fence)
      lines.push(...drawn)
      if (format === 'md') lines.push(fence)
    } else {
      if (section.id === 'todo') lines.push(format === 'md' ? `*${TODO_ORDER_NOTE}*` : TODO_ORDER_NOTE)
      lines.push(
        ...table(
          section.columns.map((c) => c.label),
          section.rows.map((row) => section.columns.map((c) => esc(row[c.id] ?? ''))),
        ),
      )
    }
    lines.push('')
  }
  const resolution = resolutionLines(view)
  const resolutionFence = fenceFor(resolution)
  if (format === 'md') lines.push(resolutionFence)
  lines.push(...resolution)
  if (format === 'md') lines.push(resolutionFence)
  return lines.join('\n').trimEnd() + '\n'
}

/**
 * A fence long enough to contain `lines` (CommonMark: an opening fence must be longer than any backtick
 * run inside it). Without this, a single item title carrying ``` would close the fence early and let the
 * rest of a MACHINE block — the drawn table, the handle→id map — render as markdown.
 */
function fenceFor(lines: readonly string[]): string {
  let longest = 0
  for (const line of lines) {
    for (const run of line.match(/`+/gu) ?? []) longest = Math.max(longest, run.length)
  }
  return '`'.repeat(Math.max(3, longest + 1))
}

/** Like `clean`, but PRESERVES the explicit `\n` line breaks a drawn cell uses to align its options. */
function clean0(s: string): string {
  return s.split('\n').map((line) => cell(line)).join('\n')
}

export function formatWpConductor(
  tree: readonly WpNode[],
  format: Format,
  decisions: readonly DecisionRow[] = [],
  outsideRollup: readonly ReportRow[] = [],
  totalScope = 'global',
  meta: ConductorMeta = {},
): string {
  return renderReportView(buildWpConductorView(tree, decisions, outsideRollup, totalScope, meta), format)
}

// ---- INLINE mode (report-revamp §B) ----------------------------------------------------------------
// A COMPACT, width-calibrated render of the SAME conductor view, meant to fit one terminal screen: the 3
// blocks FAIT / À-FAIRE / PRÉCO, tight columns, clean truncation with an ellipsis, cohort-collapsed open
// leaves, and the keystone highlighted. It reuses the SAME directive set + phrases as the table render (no
// second engine) — collapse lives ONLY here (render), never in `directives[]`.

export interface InlineOptions {
  /** Target line width (terminal columns). Clamped to the CLI contract [40, 240]; defaults to 80. */
  width?: number
  /** Max PRÉCO lines before an omission count is surfaced (never a silent cut). Defaults to 10. */
  maxDirectives?: number
  /** Honest label when the caller deliberately filters the roster before rendering. */
  totalScope?: string
}

/** Clean + hard-truncate a line to `width` with a trailing ellipsis (never a silent cut mid-report). */
function truncateLine(s: string, width: number): string {
  const c = clean(s)
  return c.length <= width ? c : `${c.slice(0, Math.max(1, width - 1))}…`
}

/**
 * Fit `head + mid + tail` to `width` by truncating ONLY the middle (the long title), keeping the head
 * (rank/scope) and the tail (the concrete ACTION) intact — so the most useful part is never the part cut.
 * Falls back to a whole-line truncation only when head+tail alone already overflow (a very long phrase).
 */
function fitMiddle(head: string, mid: string, tail: string, width: number): string {
  const budget = width - head.length - tail.length
  if (budget < 8) return truncateLine(head + mid + tail, width)
  const m = mid.length <= budget ? mid : `${mid.slice(0, Math.max(1, budget - 1))}…`
  return head + m + tail
}

export function formatWpConductorInline(
  tree: readonly WpNode[],
  decisions: readonly DecisionRow[] = [],
  opts: InlineOptions = {},
  outsideRollup: readonly ReportRow[] = [],
): string {
  const width = Math.min(240, Math.max(40, opts.width ?? 80))
  const maxDir = Math.max(1, opts.maxDirectives ?? 10)
  const view = buildWpConductorView(tree, decisions, outsideRollup)
  const totals = wpTotals(tree, outsideRollup)
  const wpName = (n: WpNode): string => `${n.label} · ${clean(stripWpPrefix(n.title))}`
  const wpNodes: WpNode[] = []
  const collectWpNodes = (nodes: readonly WpNode[]): void => {
    for (const node of nodes) {
      wpNodes.push(node)
      collectWpNodes(node.children)
    }
  }
  collectWpNodes(tree)
  const lines: string[] = []

  // FAIT — one line: global progress + the closed WPs (by label).
  const closed = wpNodes.filter((n) => n.pct === 100).map((n) => n.label)
  lines.push(
    truncateLine(
      `FAIT${opts.totalScope !== undefined ? ` (${opts.totalScope})` : ''}  ${totals.done}/${totals.active} (${pctStr(totals.pct)})${closed.length > 0 ? `  ·  clos: ${closed.join(', ')}` : ''}${outsideRollup.length > 0 ? `  ·  hors rollup: ${outsideRollup.length}` : ''}`,
      width,
    ),
  )

  // À-FAIRE — one line per open WP that actually HAS open direct work; open leaves cohort-collapsed
  // (N× tag) so it stays on screen. WPs/streams with no open direct item ("0/0 — aucun item ouvert")
  // are pure noise (their remaining work, if any, shows under a child WP) and are dropped.
  lines.push('À-FAIRE')
  const openWps = wpNodes.filter((n) => n.pct !== 100)
  let shown = 0
  for (const n of openWps) {
    const cohorts = collapseLeafCohorts(openLeaves(n))
    const parts = cohorts.map((c) => (c.count > 1 ? `${c.count}× ${c.tag}` : (c.titles[0] ?? c.tag)))
    if (parts.length === 0) continue // no open direct item — skip, don't print an empty row
    lines.push(truncateLine(`  ${wpName(n)}  ${n.done}/${n.active} ${pctStr(n.pct)}  —  ${parts.join(' · ')}`, width))
    shown++
  }
  if (shown === 0) lines.push(truncateLine('  (aucun item ouvert au niveau WP)', width))

  // PRÉCO — one compact line per directive (concrete action + actor); keystone bottleneck flagged.
  lines.push(
    truncateLine(
      view.keystone !== undefined ? `PRÉCO  (goulot: ${clean(view.keystone.title)} bloque ${view.keystone.blocks})` : 'PRÉCO',
      width,
    ),
  )
  const dirs = view.directives
  if (dirs.length === 0) lines.push(truncateLine('  (aucune action ouverte)', width))
  for (const d of dirs.slice(0, maxDir)) {
    const rank = d.rank.split('_')[0] // P1..P5
    // Keep the rank/scope head AND the concrete action tail intact; truncate the (long) title in the
    // middle — so the action a human is meant to take is never the thing that gets cut off.
    lines.push(
      fitMiddle(`  ‣ [${rank}] ${directiveScopeLabel(d)} · `, clean(d.target.title ?? d.target.id), ` — ${clean(directivePhrase(d))}`, width),
    )
  }
  if (dirs.length > maxDir) {
    lines.push(truncateLine(`  (+${dirs.length - maxDir} autres — track report --format json)`, width))
  }
  return lines.join('\n') + '\n'
}

export function formatRows(rows: ReportRow[], format: Format): string {
  if (format === 'json') return JSON.stringify(rows, null, 2)
  if (rows.length === 0) return ''
  return (
    rows
      .map((r) =>
        format === 'md'
          ? `- **${title(r.title, format)}** — ${r.bucket} · ${r.realization} · ${r.acceptance}`
          : `  - ${title(r.title, format)} [${r.bucket}, ${r.realization}, ${r.acceptance}]`,
      )
      .join('\n') + '\n'
  )
}
