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

/** Reject stale JavaScript callers rather than treating an unsupported runtime value as text. */
export function assertReportFormat(format: string): asserts format is Format {
  if (format !== 'json' && format !== 'text' && format !== 'md') {
    throw new Error(`unsupported report format: ${format}`)
  }
}

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
  // Criterion 27 — an explicit `\n` is an EDITORIAL break (one idea per line) and survives to the
  // renderer; every other control character still collapses to a space.
  return s
    .split('\n')
    .map((line) => {
      const t = cleanDisplayText(line)
      if (format !== 'md') return t
      return t
        .split(new RegExp(`(${HANDLE_TOKEN_SOURCE})`, 'u'))
        .map((part, index) => (index % 2 === 1 ? part : escapeMdMeta(part)))
        .join('')
    })
    .join('\n')
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
  // Criterion 27 — a cell is written like an editor writes: one idea per line. An explicit `\n` is a
  // break the reader asked for; wrapping only handles what overflows a line.
  const wrappedRows = rows.map((row) =>
    headers.map((_, i) =>
      (row[i] ?? '').split('\n').flatMap((line) => (line.trim() === '' ? [''] : wrapCell(line, caps[i]!))),
    ),
  )
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

/** Criterion 24 — an omission is a declared act WITH A REASON, never a silent drop. */
export interface ReportOmission {
  label: string
  reason: string
}

/**
 * Criterion 17 (as reconciled) — compactness accounting. `projected` counts the rows the deterministic
 * projection carries (WP nodes + hors-rollup rows + dossiers); `rendered` counts how many of those the
 * four sections actually restitute. Compression is legitimate — a report is a decision surface, not an
 * inventory — but it must be DECLARED, never silent. Criterion 24 adds the WHY: every omission names its
 * reason. Criterion 18 still protects the two classes that may never be omitted.
 */
export interface ReportCoverage {
  projected: number
  rendered: number
  omitted: readonly ReportOmission[]
  /**
   * Criterion 25 — sub-WPs whose content was merged into their parent row. They are RENDERED (their
   * leaves and directives are in the parent), not omitted; naming the count keeps the compression
   * declared rather than silent.
   */
  aggregated: readonly string[]
}

/**
 * Criterion 21 — the window ALWAYS exists and always has bounds. "The whole log" IS a window: first
 * recorded event → now. Both bounds are readable without any selector, so the header always carries
 * dates. This LIFTS criterion 1's constraint rather than breaking it: a window MEASURED IN THE LOG is not
 * an invented one. What stays forbidden is announcing a window nothing supports.
 */
export interface ReportPeriod {
  /** ISO date (UTC) of the first recorded event; absent only for an empty log. */
  from?: string
  /** ISO date (UTC) of the upper bound — `now` when the caller injects a clock, else the last event. */
  to?: string
  /** How the upper bound was obtained, so the header never overstates it. */
  toSource: 'now' | 'last-event' | 'unknown'
  /** The rendered French line: `période : … → … (intégralité du journal)`. */
  label: string
}

/**
 * The additive JSON contract for a requested report window. Unlike the compact human header, this keeps
 * absolute instants and full commit identities so another consumer can reproduce the exact projection.
 */
export interface ReportPeriodPayload {
  requested: string | null
  from?: string
  to?: string
  fromRef: string | null
  toRef: string | null
  eventsInWindow: number
  eventsTotal: number
}

/**
 * The header carries the ACCEPTANCE BASELINE (which is NOT a window) and the period (which is). It never
 * carries bucket counters.
 */
export interface ReportHeader {
  scope: string
  /** Present only on `report --scope`; text keeps it in the existing header's sources line. */
  scopeProjection?: ReportScopeProjection
  /** Cursor derived from the same event snapshot as this view's rows. */
  journalRevision?: { events: number; head: string | null }
  progress: string
  baselineCommit?: string
  period: ReportPeriod
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
  // (table `esc`, inline `clean`) escapes them (§A4). A decision surfaces as a "décision"
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

/**
 * A period is a projection over the already-folded log, not a second state fold. When one is selected,
 * FAIT names precisely the leaves that emitted `realization.transition → done` inside it. This deliberately
 * includes a delivery subsequently reopened: the delivery happened during the asked period even though the
 * item's current bucket is no longer DONE.
 */
function periodDoneLeaves(node: WpNode, deliveredItemIds: ReadonlySet<string> | undefined): WpNode['leaves'] {
  if (deliveredItemIds === undefined) return recentDoneLeaves(node)
  const out: WpNode['leaves'] = []
  const walk = (n: WpNode): void => {
    for (const leaf of n.leaves) if (deliveredItemIds.has(leaf.id)) out.push(leaf)
    for (const child of n.children) walk(child)
  }
  walk(node)
  return out.sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
}

const LAST_ACTIONS_SHOWN = 3

/**
 * FAIT's third column (criteria 3/4/22/26/27).
 *
 * When the scope's completions fit, they ARE the statement — one per line (27), not a `·`-joined block.
 *
 * When they do not, the renderer must NOT emit the titles: a chronological list of item titles is a
 * commit log translated into French, which is precisely the shape criterion 26 forbids. It has no reading
 * of them to offer, so it says what it owes and what writing it takes — three lines, one idea each. That
 * cell is an instruction to the agent, never a result.
 */
function lastActionsCell(titles: readonly string[]): string {
  if (titles.length === 0) return 'aucune action enregistrée'
  if (titles.length <= LAST_ACTIONS_SHOWN) return titles.join('\n')
  return [
    `bilan à écrire : ${titles.length} livraisons sur la fenêtre, titres seuls dans le projeté.`,
    'Écrire par la finalité — la capacité atteinte, la classe de problème fermée ; chiffres en appui.',
  ].join('\n')
}

// ---- `prochaine action` (criterion 20) -----------------------------------------------------------
// The gate-derived clause (`Terminer l'incrément en cours`, `Rédiger la spécification`) names the CLASS of
// the work, never the work. Twenty rows, five distinct sentences, zero information — that is a template,
// not a recommendation, and this renderer must stop presenting one as the other. The class is not lost: it
// is exactly what the `bloqué` column already says, under a label that is honest about being a class.
//
// So the deterministic layer emits a marker that CANNOT be mistaken for a recommendation, and the skill
// makes the agent replace it — on the focus rows only, by opening the item — with the concrete gesture.

/** A focus row: the agent MUST open the item and name the gesture before this report is served. */
const NEXT_ACTION_TO_INSTRUCT = 'à instruire : ouvrir l’item et nommer le geste'
/** A non-focus row: the report says plainly that the action was not instructed, rather than faking one. */
const NEXT_ACTION_NOT_INSTRUCTED = 'non instruite'
/** Criterion 24 — what would make an unanswerable dossier answerable. Specific, not a gate class. */
const NEXT_ACTION_STRUCTURE_DOSSIER = 'à structurer : enregistrer options + recommandation'
/** How many leading rows are the focus — the same five the À-FAIRE ordering line already names. */
const FOCUS_ROWS = 5

/**
 * Criterion 25 — beyond this many days the window is LONG, and the WP is the unit of reading: a sub-WP is
 * implementation detail that inflates the table and blurs the reading by theme. Sub-levels are aggregated
 * into their parent, never listed beside it. They come back on a short window or on explicit owner
 * request (`--sub-wp`).
 */
const LONG_WINDOW_DAYS = 14

function windowDays(period: ReportPeriod): number | undefined {
  if (period.from === undefined || period.to === undefined) return undefined
  const from = Date.parse(period.from)
  const to = Date.parse(period.to)
  return Number.isNaN(from) || Number.isNaN(to) ? undefined : Math.round((to - from) / 86_400_000)
}

/**
 * How much of an item's RECORDED body the `à faire` cell shows. Tight on purpose: one clause, enough to
 * tell the owner what the row is about, cut at a word boundary and always marked `extrait :` so nobody
 * reads it as the full record — the same honesty the old `extrait` column applied.
 */
const TODO_EXCERPT_MAX = 100
const ULID = /[0-9A-HJKMNP-TV-Z]{26}/gu

/**
 * Owner-facing conductor cells never print aggregate identifiers. This runs while the shared view is built,
 * so JSON, text, and Markdown consume the same redacted cells. The machine-only handle-resolution block
 * keeps its ids intact so the report remains actionable.
 */
function redactOwnerText(value: string): string {
  return value.replace(ULID, 'référence interne')
}

function redactOwnerTable(table: ReportViewTable): ReportViewTable {
  const ownerColumns = new Set(table.columns.map((column) => column.id))
  return {
    ...table,
    rows: table.rows.map((row) => Object.fromEntries(
      Object.entries(row).map(([key, value]) => [key, ownerColumns.has(key) ? redactOwnerText(value) : value]),
    )),
    ...(table.lines === undefined ? {} : { lines: table.lines.map(redactOwnerText) }),
  }
}

/** `undefined` for an absent/blank body — a bare title is then the HONEST render, not a gap to fill. */
export function todoExcerpt(body: string | undefined): string | undefined {
  // Owner-facing excerpts can mention a record, but the record's ULID belongs in the machine-only handle block.
  const cleaned = body === undefined ? undefined : clean(redactOwnerText(body))
  if (cleaned === undefined || cleaned === '') return undefined
  if (cleaned.length <= TODO_EXCERPT_MAX) return cleaned
  const cut = cleaned.slice(0, TODO_EXCERPT_MAX)
  const boundary = cut.lastIndexOf(' ')
  return `${(boundary > TODO_EXCERPT_MAX / 2 ? cut.slice(0, boundary) : cut).trimEnd()}…`
}

/** The `prochaine action` values this renderer may emit. A test pins that no gate clause joins them. */
export const DETERMINISTIC_NEXT_ACTIONS: readonly string[] = [
  NEXT_ACTION_TO_INSTRUCT, NEXT_ACTION_NOT_INSTRUCTED, NEXT_ACTION_STRUCTURE_DOSSIER, '—',
]

export interface NextActionAudit {
  /** Rows still carrying a renderer marker — the work criterion 20 asks the agent to do. */
  uninstructed: number
  /** A substantive action served on 3+ rows: by construction it names a class, not a gesture. */
  repeated: readonly string[]
  /** A substantive action equal to a gate clause: the exact template criterion 20 rejects. */
  gateClauses: readonly string[]
  ok: boolean
}

/**
 * Criterion 20, made checkable. The owner's judgement — is the sentence RIGHT — is out of reach of any
 * test; these two mechanical failures are not. A contextual report passes when every focus row has been
 * instructed AND no substantive action repeats more than twice or equals a gate clause.
 *
 * The renderer's own markers are counted as `uninstructed`, never as violations: they are the honest
 * statement that the work is still owed, which is exactly what the report must say until it is done.
 */
export function auditNextActions(values: readonly string[], gateClauses: readonly string[]): NextActionAudit {
  const marker = new Set<string>(DETERMINISTIC_NEXT_ACTIONS)
  const substantive = values.filter((value) => !marker.has(value))
  const counts = new Map<string, number>()
  for (const value of substantive) counts.set(value, (counts.get(value) ?? 0) + 1)
  const repeated = [...counts.entries()].filter(([, n]) => n > 2).map(([value]) => value)
  const bare = (value: string): string => value.replace(/^(?:action|engagement|décision) \([^)]*\)\s*:\s*/u, '')
  const gates = new Set(gateClauses)
  const hits = substantive.filter((value) => gates.has(bare(value)))
  const uninstructed = values.filter((value) => value === NEXT_ACTION_TO_INSTRUCT).length
  return { uninstructed, repeated, gateClauses: [...new Set(hits)], ok: repeated.length === 0 && hits.length === 0 }
}

/** `2026-07-29T11:02:03.000Z` → `2026-07-29`. UTC, so the header is TZ-independent and reproducible. */
function isoDate(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString().slice(0, 10)
}

/** Criterion 21 — the period, always bounded, always read from the log (plus the caller's clock). */
export function reportPeriod(meta: ConductorMeta): ReportPeriod {
  if (meta.periodWindow !== undefined) {
    const period = meta.periodWindow
    const from = isoDate(period.from)
    const to = isoDate(period.to)
    if (period.requested === null) {
      const toSource: ReportPeriod['toSource'] = meta.now !== undefined ? 'now' : meta.logTo !== undefined ? 'last-event' : 'unknown'
      const suffix = toSource === 'last-event' ? ' (intégralité du journal, borne haute = dernier événement)' : ' (intégralité du journal)'
      const label =
        from === undefined || to === undefined
          ? 'période : journal vide (aucun événement enregistré)'
          : `période : ${from} → ${to}${suffix}`
      return { ...(from !== undefined ? { from } : {}), ...(to !== undefined ? { to } : {}), toSource, label }
    }
    const selector = period.requested === 'all' ? 'intégralité du journal' : `sélecteur : ${period.requested ?? 'intégralité du journal'}`
    const label =
      from === undefined || to === undefined
        ? 'période : journal vide (aucun événement enregistré)'
        : `période : ${from} → ${to} (${selector}; ${period.eventsInWindow}/${period.eventsTotal} événements)`
    return { ...(from !== undefined ? { from } : {}), ...(to !== undefined ? { to } : {}), toSource: 'unknown', label }
  }
  const from = isoDate(meta.logFrom)
  const now = isoDate(meta.now)
  const last = isoDate(meta.logTo)
  const to = now ?? last
  const toSource: ReportPeriod['toSource'] = now !== undefined ? 'now' : last !== undefined ? 'last-event' : 'unknown'
  const suffix = toSource === 'last-event' ? ' (intégralité du journal, borne haute = dernier événement)' : ' (intégralité du journal)'
  const label =
    from === undefined || to === undefined
      ? 'période : journal vide (aucun événement enregistré)'
      : `période : ${from} → ${to}${suffix}`
  return {
    ...(from !== undefined ? { from } : {}),
    ...(to !== undefined ? { to } : {}),
    toSource,
    label,
  }
}

/** The raw period payload mirrors `reportPeriod` without reducing instants to calendar dates. */
export function reportPeriodPayload(meta: ConductorMeta): ReportPeriodPayload {
  if (meta.periodWindow !== undefined) return meta.periodWindow
  const from = meta.logFrom
  const to = meta.now ?? meta.logTo
  const events = meta.journalRevision?.events ?? 0
  return {
    requested: null,
    ...(from !== undefined ? { from } : {}),
    ...(to !== undefined ? { to } : {}),
    fromRef: null,
    toRef: null,
    eventsInWindow: events,
    eventsTotal: events,
  }
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
  /** ISO timestamp of the FIRST recorded event — the window's lower bound (criterion 21). */
  logFrom?: string
  /** ISO timestamp of the LAST recorded event — the fallback upper bound when no clock is injected. */
  logTo?: string
  /** Stable journal cursor for the projection; it distinguishes reports rendered at different log heads. */
  journalRevision?: { events: number; head: string | null }
  /** Resolved period bounds and projection coverage, all derived from the same report snapshot. */
  periodWindow?: ReportPeriodPayload
  /** Item ids with a `realization.transition → done` inside `periodWindow`; absent preserves legacy FAIT. */
  deliveredItemIds?: ReadonlySet<string>
  /**
   * The caller's clock, injected at ITS boundary so this module stays clockless and byte-reproducible
   * (same pattern as `workspace-activity --now`). Present ⇒ the window's upper bound is `now`.
   */
  now?: string
  /**
   * Criterion 25 — the EXPLICIT owner request for sub-WP detail. Absent, the reading unit follows the
   * window: sub-levels are aggregated into their parent on a long window, listed on a short one.
   */
  subWp?: boolean
  /** A read-only workpackage projection, present only for `report --scope`. */
  scopeProjection?: ReportScopeProjection
}

/** Additive machine-readable scope boundary for a scoped conductor report. */
export interface ReportScopeProjection {
  selector: string
  id: string
  label: string
  includes: 'subtree'
  excludedProjectionRows: number
}

function shellArgument(value: string): string {
  return /^[A-Za-z0-9_./:-]+$/u.test(value) ? value : `'${value.replace(/'/gu, "'\"'\"'")}'`
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

  // ---- criterion 25: the reading unit ---------------------------------------------------------------
  // On a long window the WP is the unit and a sub-WP is implementation detail. Sub-levels are AGGREGATED
  // into their root — their leaves already roll up (`openLeaves`/`recentDoneLeaves` walk children), so
  // nothing is lost; only their row disappears. The aggregation is DECLARED in the header, like every
  // other compression in this report.
  const period = reportPeriod(meta)
  const days = windowDays(period)
  const subWpDetail = meta.subWp === true || (days !== undefined && days < LONG_WINDOW_DAYS)
  const rowNodes = subWpDetail ? wpNodes : [...tree]
  const subNodes = wpNodes.filter((n) => !rowNodes.includes(n))
  /** Every node whose content merges into `n` when sub-levels are aggregated (`n` itself included). */
  const branchOf = (n: WpNode): WpNode[] => {
    const out: WpNode[] = []
    const walk = (node: WpNode): void => {
      out.push(node)
      for (const child of node.children) walk(child)
    }
    walk(n)
    return subWpDetail ? [n] : out
  }

  const directives = buildDirectives(tree, decisions)
  const dispatchQueue = dispatchQueueOf(directives)
  const keystone = keystoneOf(tree)
  const { structured: structuredDecisions, legacyPending } = classifyDecisions(decisions)

  // ---- decision numbering (criteria 16/23/24) ------------------------------------------------------
  // 16 — a D-number is RESERVED for a dossier whose options AND recommendation are stored and still
  //      pending: those are the only ones an owner can answer with a letter.
  // 23 — DÉCISIONS is the surface where the owner DECIDES. A settled dossier has nothing to answer; it
  //      crowds out the ones still waiting and is already visible where it counts (a freed `bloqué`
  //      cell, or FAIT if it produced something). It leaves the report and is counted among omissions.
  // 24 — a pending dossier with no stored options cannot be answered either. It is not dressed up as a
  //      choice: it appears in À-FAIRE as the work of making it answerable.
  const structuredPending = structuredDecisions.filter((d) => d.outcome === 'pending')
  const settledDecisions = decisions.filter((d) => d.outcome !== 'pending')
  const decisionRef = new Map<string, string>()
  structuredPending.forEach((d, i) => decisionRef.set(d.id, `D${i + 1}`))
  legacyPending.forEach((d, i) => decisionRef.set(d.id, `Q${i + 1}`))
  const isPending = new Set(decisions.filter((d) => d.outcome === 'pending').map((d) => d.id))

  // ---- handles (criteria 10b/10c) -----------------------------------------------------------------
  // Handles are POSITIONAL WITHIN THIS REPORT (`[row.item]`), assigned AFTER À-FAIRE is ordered. Leg A
  // established that no content-derived handle can be stable across runs — ordering, titles and WP
  // membership all move — so the identifier is RELOCATED, not invented: the resolution block at the end
  // of the page maps every emitted handle to its item id, and no ULID enters a column the owner reads.
  const handles: ReportHandle[] = []

  // ---- FAIT ---------------------------------------------------------------------------------------
  const outsideDone = meta.deliveredItemIds === undefined
    ? outsideRollup.filter((r) => r.bucket === 'DONE' || r.bucket === 'DROPPED')
    : outsideRollup.filter((r) => meta.deliveredItemIds!.has(r.id))
  const periodLeaves = (node: WpNode): WpNode['leaves'] => periodDoneLeaves(node, meta.deliveredItemIds)
  const doneRows: Record<string, string>[] = [
    {
      scope: totalScope,
      progress: `${totals.done}/${totals.active} (${pctStr(totals.pct)})`,
      lastActions: lastActionsCell(
        wpNodes
          .flatMap((n) => meta.deliveredItemIds === undefined ? n.leaves.filter((l) => l.bucket === 'DONE') : n.leaves.filter((l) => meta.deliveredItemIds!.has(l.id)))
          .sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
          .map((l) => clean(l.title)),
      ),
    },
    // Criterion 25 — one row per READING unit: the WP on a long window, the sub-level only when the
    // window is short or the owner asked. `recentDoneLeaves` already walks children, so a root's row
    // carries its sub-levels' deliveries rather than losing them.
    ...rowNodes
      .filter((n) => periodLeaves(n).length > 0)
      .map((n) => ({
        scope: wpName(n),
        progress: `${n.done}/${n.active} (${pctStr(n.pct)})`,
        lastActions: lastActionsCell(periodLeaves(n).map((l) => clean(l.title))),
      })),
    ...(outsideDone.length > 0
      ? [{
          scope: 'hors WP',
          progress: (() => {
            const done = meta.deliveredItemIds === undefined
              ? outsideRollup.filter((r) => r.bucket === 'DONE').length
              : outsideRollup.filter((r) => meta.deliveredItemIds!.has(r.id)).length
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
      if (gate.code !== 'decision-pending') {
        refs.push(GATE_TOKEN[gate.code] ?? 'blocage')
        continue
      }
      const ref = gate.ref ?? ''
      const number = decisionRef.get(ref)
      // A blocker still open against a dossier that has ALREADY been settled is an anomaly the owner
      // should see, not a number pointing at a row this report no longer carries (criterion 23).
      refs.push(number ?? (ref !== '' && !isPending.has(ref) ? 'décision réglée' : 'décision'))
    }
    return refs.length === 0 ? NO_GATE : compactRefs(refs)
  }
  /**
   * Criterion 20 — the gate CLASS, kept as a machine-only property. It is what the old `prochaine action`
   * printed; it is legitimate as a starting point for the agent's investigation and illegitimate as a
   * recommendation, so it is carried and never rendered.
   */
  const gateStepClass = (attached: readonly Directive[]): string =>
    [...new Set(attached.filter((d) => d.mode !== 'human-decision').map((d) => directivePhrase(d)))].join(' / ')
  /** Does this row wait on a dossier the owner can answer? Then it owes no next action (criterion 14). */
  const gatedOnPendingDecision = (attached: readonly Directive[]): boolean =>
    attached.length > 0 &&
    attached.every((d) => d.mode === 'human-decision' && isPending.has(d.gate?.ref ?? ''))
  const directiveIds = (attached: readonly Directive[]): string => attached.map((d) => d.id).join(',')
  // Machine-only audit properties (NOT declared columns, so no renderer ever prints them): the precise
  // gate phrase the short `bloqué` token compacts, kept so nothing is lost from the projection.
  const gateDetail = (attached: readonly Directive[]): string =>
    [...new Set(attached.map((d) => gatePhraseFr(d.gate)).filter((p): p is string => p !== undefined))].join(' / ')

  /** One actionable item inside an À-FAIRE row — its handle is assigned once the rows are ordered. */
  interface TodoItem { id: string; title: string; note?: string; excerpt?: string }
  interface TodoDraft {
    wp: string
    progress: string
    items: TodoItem[]
    blocked: string
    /** Fixed only for the rows whose next action is NOT a per-row investigation (criterion 20). */
    fixedNextAction?: string
    gatedOnDecision: boolean
    directiveIds: string
    gateDetail: string
    gateStep: string
    order: string
  }

  const wpTodoDrafts: TodoDraft[] = rowNodes
    .filter((n) => openLeaves(n).length > 0 || branchOf(n).some((b) => directivesByWpId.has(b.id)))
    .map((n) => {
      // Criterion 25 — a sub-level's directives merge UPWARD with its leaves; they are not dropped.
      const attached = branchOf(n).flatMap((b) => directivesByWpId.get(b.id) ?? [])
      // The item's recorded body is ALREADY in the log; surfacing it costs no investigation and is what
      // makes a `non instruite` row still say something (or admit that the log says nothing).
      const items: TodoItem[] = openLeaves(n).map((l) => ({
        id: l.id,
        title: clean(l.title),
        ...(todoExcerpt(l.summary) !== undefined ? { excerpt: todoExcerpt(l.summary)! } : {}),
      }))
      // A directive may target a DONE leaf with acceptance debt: name it here (with its own handle)
      // instead of exiling it to a `cible action` column the owner never asked for.
      for (const d of attached) {
        // An engagement/blockage directive points at its own actionable ref (for example a thread),
        // while its title deliberately names the already-listed target leaf. Adding it made a title-twin
        // sibling row. Only an item directive can introduce a missing DONE acceptance debt.
        if (d.target.kind !== 'item' || items.some((i) => i.id === d.target.id)) continue
        const debtLeaf = wpNodes.flatMap((node) => node.leaves).find((l) => l.id === d.target.id)
        items.push({
          id: d.target.id,
          title: clean(d.target.title ?? d.target.id),
          note: d.facts.bucket.toLowerCase(),
          ...(todoExcerpt(debtLeaf?.summary) !== undefined ? { excerpt: todoExcerpt(debtLeaf?.summary)! } : {}),
        })
      }
      const gated = gatedOnPendingDecision(attached)
      return {
        wp: wpName(n),
        progress: pctStr(n.pct),
        items,
        blocked: blockedCell(attached),
        gatedOnDecision: gated,
        ...(gated ? { fixedNextAction: NO_ACTION } : {}),
        directiveIds: directiveIds(attached),
        gateDetail: gateDetail(attached),
        gateStep: gateStepClass(attached),
        order: String(Math.min(...attached.map((d) => urgencyIndex.get(d.id) ?? 9999), 9999)).padStart(5, '0'),
      }
    })

  // Criterion 24 — a PENDING dossier with no stored options cannot be answered, so it is not offered as a
  // choice in DÉCISIONS. It is real open work: it appears here, with what would make it answerable.
  // A structured pending dossier needs no À-FAIRE row — DÉCISIONS is where the owner answers it.
  const unscopedDirectives = directives.filter((d) => d.scope.wpId === undefined)
  const toStructure = unscopedDirectives.filter((d) => {
    const ref = d.gate?.ref ?? d.target.id
    return decisionRef.get(ref)?.startsWith('Q') === true
  })
  const outsideOpen = outsideRollup.filter(
    (r) => (r.bucket === 'TO-DO' || r.bucket === 'AWAITED') && !unscopedDirectives.some((d) => d.target.id === r.id),
  )
  const horsWpDrafts: TodoDraft[] = []
  if (toStructure.length > 0) {
    horsWpDrafts.push({
      wp: 'hors WP · dossiers à structurer',
      progress: 'n/a',
      // A dossier with no stored options says nothing by its title alone. Its prose context is recorded:
      // show it as an EXCERPT — never as options, which is what `unstructured` forbids (criterion 16).
      items: toStructure.map((d) => {
        const ref = d.gate?.ref ?? d.target.id
        const excerpt = todoExcerpt(decisions.find((row) => row.id === ref)?.contextExcerpt)
        return {
          id: d.target.id,
          title: clean(d.target.title ?? d.target.id),
          ...(excerpt !== undefined ? { excerpt } : {}),
        }
      }),
      // Criterion 19 — a gate IS recorded, so this is never `—`; and it names the actual blockage rather
      // than pointing back at the row's own dossiers.
      blocked: 'options non enregistrées',
      fixedNextAction: NEXT_ACTION_STRUCTURE_DOSSIER,
      gatedOnDecision: false,
      directiveIds: directiveIds(toStructure),
      gateDetail: gateDetail(toStructure),
      gateStep: gateStepClass(toStructure),
      order: String(Math.min(...toStructure.map((d) => urgencyIndex.get(d.id) ?? 9999))).padStart(5, '0'),
    })
  }
  if (outsideOpen.length > 0) {
    horsWpDrafts.push({
      wp: 'hors WP · items',
      progress: 'n/a',
      items: outsideOpen.map((r) => ({
        id: r.id,
        title: clean(r.title),
        ...(todoExcerpt(r.detail.summary) !== undefined ? { excerpt: todoExcerpt(r.detail.summary)! } : {}),
      })),
      blocked: NO_GATE,
      gatedOnDecision: false,
      directiveIds: '',
      gateDetail: '',
      gateStep: '',
      order: '09998',
    })
  }

  const orderedDrafts = [...wpTodoDrafts, ...horsWpDrafts].sort((a, b) =>
    a.order === b.order ? a.wp.localeCompare(b.wp) : a.order.localeCompare(b.order),
  )

  // Handles are assigned HERE, once the order is final: `[row.item]`, both 1-based (criterion 10b/10c).
  // `prochaine action` is decided here too, because whether a row is FOCUS depends on that same order
  // (criterion 20: the per-row investigation is bounded to the five rows the ordering line names).
  const orderedTodo: Record<string, string>[] = orderedDrafts.map((draft, rowIndex) => {
    const cells = draft.items.map((item, itemIndex) => {
      const handle = `${rowIndex + 1}.${itemIndex + 1}`
      const wpLabel = draft.wp.split(' · ')[0]
      handles.push({
        handle, kind: 'item', id: item.id, title: item.title,
        ...(wpLabel === undefined ? {} : { wpLabel }),
      })
      // Criterion 27 — one idea per line: the item on its line, and its recorded excerpt as a
      // SUBORDINATE clause on its own, never a paragraph appended to the title.
      const note = item.note === undefined ? '' : ` (${item.note})`
      const excerpt = item.excerpt === undefined ? '' : `\n↳ extrait : ${item.excerpt}`
      return `[${handle}] ${item.title}${note}${excerpt}`
    })
    const nextAction =
      draft.fixedNextAction ??
      (draft.items.length === 0
        ? NO_ACTION
        : rowIndex < FOCUS_ROWS
          ? NEXT_ACTION_TO_INSTRUCT
          : NEXT_ACTION_NOT_INSTRUCTED)
    return {
      wp: draft.wp,
      progress: draft.progress,
      todo: cells.join('\n'),
      blocked: draft.blocked,
      nextAction,
      directiveIds: draft.directiveIds,
      gateDetail: draft.gateDetail,
      gateStep: draft.gateStep,
      focus: rowIndex < FOCUS_ROWS ? 'true' : 'false',
    }
  })
  for (const d of [...structuredPending, ...legacyPending]) {
    handles.push({ handle: decisionRef.get(d.id)!, kind: 'decision', id: d.id, title: clean(d.title) })
  }

  const todoRows = orderedTodo.length > 0
    ? orderedTodo
    : [{ wp: '—', progress: 'n/a', todo: 'aucun WP ouvert', blocked: NO_GATE, nextAction: NO_ACTION, directiveIds: '' }]

  // ---- DÉCISIONS ----------------------------------------------------------------------------------
  // Criterion 23 — pending, answerable dossiers ONLY. Nothing else.
  const decisionRows: Record<string, string>[] = []
  for (const d of structuredPending) {
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
      const wrapped = wrapCell(`${letter} ${redactOwnerText(clean(option.title))} — ${redactOwnerText(clean(option.summary))}`, DECISION_CAPS[2])
      const marks: string[] = []
      if (letter === recommended) marks.push(letter)
      if (letter === selected) marks.push('retenu')
      altLines.push(...wrapped)
      precoLines.push(marks.join(' '), ...Array<string>(wrapped.length - 1).fill(''))
    })
    const alternatives = options.length > 0 ? altLines.join('\n') : 'non enregistrées'
    let preco = precoLines.join('\n')
    if (preco.trim() === '') preco = '—'
    decisionRows.push({ n: ref, subject: shortDecisionSubject(d.title), alternatives, preco })
  }
  if (decisionRows.length === 0) {
    decisionRows.push({
      n: '—',
      subject: 'aucun dossier en attente que tu puisses trancher maintenant',
      alternatives: 'non enregistrées',
      preco: '—',
    })
  }

  // ---- RECOMMANDATION ------------------------------------------------------------------------------
  const startable = orderedTodo.filter(
    (row) => row['nextAction'] !== NO_ACTION && !/(^|[^A-Z])D\d/u.test(row['blocked'] ?? ''),
  )
  // Word-boundary match: `includes('D1')` also matches `D10`, which would credit the wrong dossier.
  const unlockedBy = (ref: string): string[] =>
    orderedTodo
      .filter((row) => new RegExp(`(^|[^0-9A-Z])${ref}([^0-9]|$)`, 'u').test(row['blocked'] ?? ''))
      .map((row) => (row['wp'] ?? '').split(' · ')[0]!)
  const recommendationLines: string[] = []
  recommendationLines.push(
    startable.length === 0
      ? 'Sans décision : aucune lane exécutable sans réponse n’est attestée dans le journal.'
      : `Sans décision : ${startable
          .slice(0, 3)
          .map((row) => (row['wp'] ?? '').split(' · ')[0])
          .join(', ')} peuvent démarrer — le geste concret reste à instruire par ligne.`,
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

  // Criteria 17/24 — compression is allowed, silence is not, and every omission NAMES ITS REASON.
  // Criterion 18 is what keeps this safe: a WP carrying open work, and every dossier the owner can still
  // answer, are in the rendered lists above and can never fall here.
  const empty = (n: WpNode): boolean =>
    n.done === 0 && openLeaves(n).length === 0 && !directivesByWpId.has(n.id)
  // Criterion 25 — a sub-level that CARRIES something is restituted inside its parent, so it is neither
  // rendered as a row nor omitted: it is aggregated, and the header says how many.
  const aggregated = subNodes.filter((n) => !empty(n)).map(wpName)
  const omitted: ReportOmission[] = [
    ...wpNodes
      .filter(empty)
      .map((n) => ({ label: wpName(n), reason: 'WP sans item ouvert, sans blocage et sans livraison' })),
    ...settledDecisions.map((d) => ({
      label: shortDecisionSubject(d.title),
      reason: 'décision déjà tranchée (visible dans bloqué ou FAIT, plus rien à y répondre)',
    })),
  ]

  // ---- coverage (criteria 17/18) --------------------------------------------------------------------
  // 17 — the report STATES both counts, so omission is a declared act rather than a silent one. Both
  // numbers count the SAME unit: rows of the deterministic projection. `rendered` is therefore always a
  // subset of `projected`, and `projected - rendered === omitted.length`.
  // 18 — the two classes that may never be omitted (a WP carrying open work, a pending dossier) are
  // structurally in the rendered lists above, whatever the compression ratio.
  // An unscoped directive always TARGETS a dossier already counted in `decisions`, so counting it again
  // would inflate the denominator against itself.
  const projectedRows = wpNodes.length + outsideRollup.length + decisions.length
  const coverage: ReportCoverage = {
    projected: projectedRows,
    rendered: projectedRows - omitted.length,
    omitted,
    aggregated,
  }

  const header: ReportHeader = {
    scope: totalScope,
    ...(meta.scopeProjection !== undefined ? { scopeProjection: meta.scopeProjection } : {}),
    ...(meta.journalRevision !== undefined ? { journalRevision: meta.journalRevision } : {}),
    progress: `${totals.done}/${totals.active} (${pctStr(totals.pct)})`,
    ...(meta.baselineCommit !== undefined ? { baselineCommit: meta.baselineCommit.slice(0, 12) } : {}),
    // Criterion 21 — the window is measured in the log, so it is always stated, always with dates.
    period,
    sources: [
      'projection déterministe du journal (track report --wp --decisions)',
      ...(meta.journalRevision === undefined
        ? []
        : [`révision du journal : ${meta.journalRevision.events} événements ; tête : ${meta.journalRevision.head ?? 'aucune'}`]),
      ...(meta.scopeProjection === undefined
        ? []
        : [
            `scope : ${meta.scopeProjection.label} et son sous-arbre inclus ; ${meta.scopeProjection.excludedProjectionRows} lignes hors scope exclues`,
          ]),
    ],
    coverage,
    handleCommand: meta.scopeProjection === undefined
      ? 'track report --resolve <handle>'
      : `track report --scope ${shellArgument(meta.scopeProjection.selector)} --resolve <handle>`,
  }

  const tables: ReportViewTable[] = [
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
  ]

  return {
    kind: 'wp-conductor-report',
    locale: 'fr',
    header,
    tables: tables.map(redactOwnerTable),
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

/**
 * Criteria 17/24 — both counts AND the reason for every omission, grouped so the line stays readable.
 * "Omitted" without a why is the silence the criterion exists to forbid.
 */
export function coverageLine(coverage: ReportCoverage): string {
  const merged =
    coverage.aggregated.length > 0
      ? ` · ${coverage.aggregated.length} sous-WP agrégés dans leur parent`
      : ''
  const head = `couverture : ${coverage.projected} lignes projetées · ${coverage.rendered} rendues${merged}`
  if (coverage.omitted.length === 0) return `${head} · aucune omission`
  const byReason = new Map<string, number>()
  for (const omission of coverage.omitted) byReason.set(omission.reason, (byReason.get(omission.reason) ?? 0) + 1)
  const detail = [...byReason.entries()].map(([reason, count]) => `${count} ${reason}`).join(' · ')
  return `${head} · ${coverage.omitted.length} omise${coverage.omitted.length > 1 ? 's' : ''} : ${detail}`
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
    em(h.period.label),
    em(`baseline d’acceptance : ${h.baselineCommit ?? 'non résolue'}`),
    em(coverageLine(h.coverage)),
    em(`sources : ${h.sources.join(' ; ')}`),
    '',
  ]
  return lines.map(redactOwnerText)
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
  assertReportFormat(format)
  if (format === 'json') return JSON.stringify(view, null, 2) + '\n'
  // The builder already redacts owner cells for every format. Rendering only escapes Markdown metacharacters;
  // `displayCell` keeps the machine-generated `[n.m]` handle out of that escaped span.
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
  const c = redactOwnerText(clean(s))
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
  return redactOwnerText(head + m + tail)
}

export function formatWpConductorInline(
  tree: readonly WpNode[],
  decisions: readonly DecisionRow[] = [],
  opts: InlineOptions = {},
  outsideRollup: readonly ReportRow[] = [],
  meta?: ConductorMeta,
): string {
  const width = Math.min(240, Math.max(40, opts.width ?? 80))
  const maxDir = Math.max(1, opts.maxDirectives ?? 10)
  const view = buildWpConductorView(tree, decisions, outsideRollup, 'global', meta)
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

  // INLINE is still a report rendering. The CLI supplies meta and therefore names the exact period; direct
  // presenter callers that have no reporting context retain their existing compact-only contract.
  if (meta !== undefined) lines.push(truncateLine(view.header.period.label, width))

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
