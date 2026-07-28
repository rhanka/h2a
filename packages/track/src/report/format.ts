import { BUCKETS } from './buckets.js'
import type { DecisionRow, Report, ReportRow } from './build.js'
import type { WpLeaf, WpNode } from './rollup.js'
import {
  buildDirectives,
  decisionNeedsFocus,
  dispatchQueueOf,
  keystoneOf,
  type Directive,
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

/** A display-safe title: control-normalized for text, plus markdown-metacharacter-escaped for md. */
export function displayText(s: string, format: Format): string {
  const t = cleanDisplayText(s)
  if (format !== 'md') return t
  let out = ''
  for (const ch of t) out += MD_META.has(ch) ? BACKSLASH + ch : ch
  return out
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

function table(headers: readonly string[], rows: readonly (readonly string[])[]): string[] {
  // Terminal-first padded table: aligned columns, bounded width, MULTI-LINE cells.
  // No ellipsis: long content wraps inside the column so the report stays readable and complete enough.
  const caps = headers.map((h) => {
    const k = h.toLowerCase()
    if (k.includes('sujet') || k.includes('items') || k.includes('à faire')) return 72
    if (k.includes('préconisation') || k.includes('dernières actions')) return 64
    if (k.includes('complexité') || k.includes('notes') || k.includes('dropped')) return 38
    if (k.includes('scope') || k.includes('wp')) return 42
    return 24
  })
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

export interface ReportView {
  kind: 'wp-conductor-report'
  locale: 'fr'
  tables: readonly ReportViewTable[]
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

export function buildWpConductorView(
  tree: readonly WpNode[],
  decisions: readonly DecisionRow[] = [],
  outsideRollup: readonly ReportRow[] = [],
  totalScope = 'global',
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

  // The rule-derived action table is derived from the directive set (each directive ⇒ one row, phrase
  // rendered, never stored). It deliberately has no decision label: native decision dossiers have their
  // own `DÉCISIONS` table below.
  const directives = buildDirectives(tree, decisions)
  const dispatchQueue = dispatchQueueOf(directives)
  const keystone = keystoneOf(tree)
  const { structured: structuredDecisions, legacyPending, legacySettled } = classifyDecisions(decisions)
  const legacyIds = new Set(legacyPending.map((d) => d.id))
  // A legacy dossier may still have a decision blocker on a leaf. Its directive is deliberately
  // withheld from the owner-facing decision section: it belongs in À INSTRUIRE until the recorded
  // option/recommendation model is populated by an authenticated revision.
  const displayDirectives = directives.filter((d) => !legacyIds.has(d.gate?.ref ?? ''))
  const humanDecisions = displayDirectives.filter((d) => d.mode === 'human-decision')
  const focusNeeded = humanDecisions.filter((d) => d.step.code === 'focus-decision').length

  const doneRows: Record<string, string>[] = [
    { scope: totalScope, progress: `${totals.done}/${totals.active} (${pctStr(totals.pct)})`, completion: 'agrégat de périmètre; pas une action' },
    ...wpNodes.filter((n) => n.pct === 100).map((n) => ({ scope: wpName(n), progress: `${n.done}/${n.active} (100%)`, completion: 'WP clos (état enregistré)' })),
  ]

  // À-FAIRE is a ready-to-render projection.  A consumer MUST NOT join `tables.todo` back to
  // `directives`: directives with no WP scope (notably standalone pending decisions) have no
  // `scope.wpLabel`, and WP labels are presentation text rather than an identity key.  We attach by
  // `scope.wpId` here, then retain the directive ids as an auditable machine-only row property.
  const directivesByWpId = new Map<string, Directive[]>()
  for (const directive of directives) {
    const wpId = directive.scope.wpId
    if (wpId === undefined) continue
    const attached = directivesByWpId.get(wpId)
    if (attached === undefined) directivesByWpId.set(wpId, [directive])
    else attached.push(directive)
  }
  const noGate = 'Aucun blocage enregistré'
  const noDirectAction = 'Aucune directive directe'
  const blocked = (attached: readonly Directive[]): string =>
    attached.map((directive) => gatePhraseFr(directive.gate) ?? noGate).join(' / ') || noGate
  const nextAction = (attached: readonly Directive[]): string =>
    attached.map(directivePhrase).join(' / ') || noDirectAction
  const directiveIds = (attached: readonly Directive[]): string => attached.map((directive) => directive.id).join(',')
  // A directive may target a DONE item with acceptance debt while the row's open-work list is empty. This
  // explicit field makes that intentional cross-bucket relationship visible without a consumer-side join.
  const actionTargets = (attached: readonly Directive[]): string =>
    attached.map((directive) => `${directive.target.id} · ${clean(directive.target.title ?? directive.target.id)} [${directive.facts.bucket}]`).join(' / ') || '-'

  // A completed WP can still carry a stale/failed acceptance directive, so retain it whenever a
  // directive is attached even when its rollup percentage is 100.
  const todoRows = wpNodes.filter((n) => n.pct !== 100 || directivesByWpId.has(n.id)).map((n) => {
    const open = openLeaves(n)
    const listed = open.map((l) => clean(l.title)).join(' / ')
    const attached = directivesByWpId.get(n.id) ?? []
    return {
      wp: wpName(n),
      progress: `${n.done}/${n.active} (${pctStr(n.pct)})`,
      todo: listed || 'aucun item ouvert direct',
      blocked: blocked(attached),
      nextAction: nextAction(attached),
      actionTarget: actionTargets(attached),
      directiveIds: directiveIds(attached),
    }
  })

  // A pending decision may be a real directive without a WP ancestor.  It is not a HORS ROLLUP item,
  // so give it an explicit same-shape table rather than silently assigning it to a similarly named WP.
  const unscopedTodoRows = directives.filter((directive) => directive.scope.wpId === undefined).map((directive) => ({
    wp: 'sans WP',
    progress: '-',
    todo: clean(directive.target.title ?? directive.target.id),
    blocked: blocked([directive]),
    nextAction: nextAction([directive]),
    actionTarget: actionTargets([directive]),
    directiveIds: directive.id,
  }))

  // Rule-derived action rows. Native decision dossiers are rendered only in the separate DÉCISIONS table.
  // This is deliberately exhaustive: a conductor table is the deterministic route to every open row.
  const actionRows: Record<string, string>[] = []
  if (focusNeeded >= 2 || humanDecisions.length >= 4) {
    actionRows.push({ scope: '-', subject: 'décisions accumulées', recommendation: 'focus (lecture): instruire le dossier, puis enregistrer le choix avec track decision select' })
  }
  for (const d of humanDecisions) {
    actionRows.push({ scope: directiveScopeLabel(d), subject: clean(d.target.title ?? d.target.id), recommendation: directivePhrase(d) })
  }
  for (const d of displayDirectives.filter((x) => x.mode !== 'human-decision')) {
    actionRows.push({ scope: directiveScopeLabel(d), subject: clean(d.target.title ?? d.target.id), recommendation: directivePhrase(d) })
  }
  const outsideRows = outsideRollup.map((row) => ({
    id: row.id,
    workspace: row.workspace,
    scope: row.wpId === undefined ? 'sans WP' : `intermédiaire · ${row.wpLabel ?? '-'}`,
    progress: row.bucket,
    item: clean(row.title),
    acceptance: row.detail.acceptanceLabel,
    summary: row.detail.summary ?? '—',
  }))

  return {
    kind: 'wp-conductor-report',
    locale: 'fr',
    tables: [
      { id: 'done', title: 'FAIT', columns: [{ id: 'scope', label: 'scope' }, { id: 'progress', label: 'avancement' }, { id: 'completion', label: 'constat' }], rows: doneRows },
      {
        id: 'todo',
        title: 'À-FAIRE',
        columns: [
          { id: 'wp', label: 'WP' },
          { id: 'progress', label: 'avancement' },
          { id: 'todo', label: 'à faire' },
          { id: 'blocked', label: 'bloqué' },
          { id: 'nextAction', label: 'prochaine action' },
          { id: 'actionTarget', label: 'cible action' },
        ],
        rows: todoRows.length > 0
          ? todoRows
          : [{ wp: '-', progress: '-', todo: 'aucun WP ouvert', blocked: noGate, nextAction: noDirectAction, actionTarget: '-', directiveIds: '' }],
      },
      ...(unscopedTodoRows.length > 0
        ? [{
            id: 'todo-unscoped',
            title: 'À-FAIRE SANS WP',
            columns: [
              { id: 'wp', label: 'WP' },
              { id: 'progress', label: 'avancement' },
              { id: 'todo', label: 'à faire' },
              { id: 'blocked', label: 'bloqué' },
              { id: 'nextAction', label: 'prochaine action' },
              { id: 'actionTarget', label: 'cible action' },
            ],
            rows: unscopedTodoRows,
          }]
        : []),
      ...(outsideRows.length > 0
        ? [{ id: 'outside-rollup', title: 'HORS ROLLUP', columns: [{ id: 'id', label: 'id' }, { id: 'workspace', label: 'workspace' }, { id: 'scope', label: 'rattachement' }, { id: 'progress', label: 'état' }, { id: 'item', label: 'item' }, { id: 'acceptance', label: 'recette' }, { id: 'summary', label: 'extrait' }], rows: outsideRows }]
        : []),
      ...(structuredDecisions.length > 0 ? [{ id: 'decisions', title: 'DÉCISIONS', columns: [{ id: 'decision', label: 'dossier' }, { id: 'alternatives', label: 'alternatives enregistrées' }, { id: 'recommendation', label: 'recommandation / règlement' }], rows: structuredDecisions.map((d) => ({
        decision: `${d.id} — ${clean(d.title)} (${d.outcome})`,
        alternatives: d.options!.map((option) => `${option.id}: ${clean(option.title)} — ${clean(option.summary)}`).join(' / '),
        recommendation: `recommandée:${d.recommendation!.optionId} — ${clean(d.recommendation!.rationale)}${d.selectedOptionId !== undefined ? `; sélectionnée:${d.selectedOptionId}` : ''}`,
      })) }] : []),
      ...(legacyPending.length > 0 ? [{ id: 'prepare', title: 'À INSTRUIRE', columns: [{ id: 'decision', label: 'dossier legacy' }, { id: 'action', label: 'disposition sûre' }], rows: legacyPending.map((d) => ({ decision: `${d.id} — ${clean(d.title)}`, action: legacyRevisionAction(d) })) }] : []),
      ...(legacySettled.length > 0 ? [{ id: 'legacy-history', title: 'HISTORIQUE NON STRUCTURÉ', columns: [{ id: 'decision', label: 'dossier legacy' }, { id: 'record', label: 'constat' }], rows: legacySettled.map((d) => ({ decision: `${d.id} — ${clean(d.title)}`, record: legacyHistoryNote(d) })) }] : []),
      { id: 'rule-derived-actions', title: 'ACTIONS DÉRIVÉES', columns: [{ id: 'scope', label: 'scope/gate' }, { id: 'subject', label: 'sujet' }, { id: 'recommendation', label: 'préconisation' }], rows: actionRows.length > 0 ? actionRows : [{ scope: '-', subject: 'aucune action ouverte dans les WP actifs', recommendation: '-' }] },
    ],
    directives,
    directivesProjection: { kind: 'conductor-action-directives', order: 'canonical-urgency' },
    dispatchQueue,
    dispatchQueueProjection: { kind: 'delegable-directive-ids', order: 'canonical-urgency', modes: ['subagent', 'local'] },
    ...(keystone !== undefined ? { keystone } : {}),
  }
}

function renderReportView(view: ReportView, format: Format): string {
  if (format === 'json') return JSON.stringify(view, null, 2) + '\n'
  // User-originated cell content (titles) is escaped per-format: `md` escapes markdown metacharacters so a
  // crafted item title cannot inject formatting (parity with the legacy `formatReport`/`title` path); `text`
  // is clean. The view model itself stays RAW (escaping is a render-only concern).
  const esc = (s: string): string => title(s, format)
  const h = (label: string): string => (format === 'md' ? `## ${label}` : label)
  const lines: string[] = []
  for (const section of view.tables) {
    lines.push(h(section.title))
    lines.push(...table(section.columns.map((c) => c.label), section.rows.map((row) => section.columns.map((c) => esc(row[c.id] ?? '')))))
    lines.push('')
  }
  return lines.join('\n').trimEnd() + '\n'
}

export function formatWpConductor(
  tree: readonly WpNode[],
  format: Format,
  decisions: readonly DecisionRow[] = [],
  outsideRollup: readonly ReportRow[] = [],
  totalScope = 'global',
): string {
  return renderReportView(buildWpConductorView(tree, decisions, outsideRollup, totalScope), format)
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
