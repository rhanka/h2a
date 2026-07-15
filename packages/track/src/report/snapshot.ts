import { canonicalize } from '../events/canonical.js'
import type { TrackEvent } from '../events/types.js'
import { fold } from '../state/fold.js'
import { buildReport, type Report } from './build.js'
import { buildDirectives } from './directive.js'
import { directivePhrase, wpTotals, type WpTotals } from './format.js'
import type { WpNode } from './rollup.js'

export const SNAPSHOT_SCHEMA = 'track.snapshot/v1' as const
export const SNAPSHOT_EVENT_LIMIT = 200

export interface SnapshotDirective {
  id: string
  source: 'rule-derived'
  kind: string
  aggregateId?: string
  text: string
}

export interface SnapshotRecentEvent {
  position: number
  eventId: string
  kind: string
  aggregateId?: string
  summary?: string
}

export interface SnapshotV1 {
  schema: typeof SNAPSHOT_SCHEMA
  baseline: { input: string; resolvedCommit: string }
  report: Report
  wpTotals: WpTotals
  directives: SnapshotDirective[]
  recentEvents: SnapshotRecentEvent[]
}

export interface SnapshotOptions {
  baselineInput: string
  resolvedCommit: string
  requireAccepted?: boolean
}

/** Locale/ICU-independent JS UTF-16 code-unit ordering for canonical snapshot arrays. */
export function ordinalCompare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

function stableWpTree(tree: readonly WpNode[]): WpNode[] {
  return tree
    .map((node) => ({
      ...node,
      leaves: [...node.leaves].sort((a, b) => ordinalCompare(a.id, b.id)),
      children: stableWpTree(node.children),
    }))
    .sort((a, b) => ordinalCompare(a.id, b.id))
}

function stableReport(report: Report): Report {
  const tree = stableWpTree(report.wpTree ?? [])
  return {
    buckets: {
      AWAITED: [...report.buckets.AWAITED].sort((a, b) => ordinalCompare(a.id, b.id)),
      DROPPED: [...report.buckets.DROPPED].sort((a, b) => ordinalCompare(a.id, b.id)),
      DONE: [...report.buckets.DONE].sort((a, b) => ordinalCompare(a.id, b.id)),
      'TO-DO': [...report.buckets['TO-DO']].sort((a, b) => ordinalCompare(a.id, b.id)),
    },
    decisions: [...(report.decisions ?? [])].sort((a, b) => ordinalCompare(a.id, b.id)),
    wpTree: tree,
  }
}

/**
 * A deliberately narrow event summary. Never copy arbitrary prose-bearing payload fields: the event kind,
 * aggregate id, and append position already carry the useful change signal for the AI context.
 */
function recentEvents(events: readonly TrackEvent[]): SnapshotRecentEvent[] {
  const start = Math.max(0, events.length - SNAPSHOT_EVENT_LIMIT)
  return events.slice(start).map((event, offset) => ({
    position: start + offset + 1,
    eventId: event.id,
    kind: event.type,
    aggregateId: event.aggregateId,
  }))
}

export function buildSnapshot(events: readonly TrackEvent[], options: SnapshotOptions): SnapshotV1 {
  const report = stableReport(
    buildReport(fold(events), {
      baselineCommit: options.resolvedCommit,
      requireAccepted: options.requireAccepted ?? false,
      decisions: true,
      wpTree: true,
      activeRoster: false,
    }, ordinalCompare),
  )
  const directives = buildDirectives(report.wpTree ?? [], report.decisions ?? [], ordinalCompare)
    .map((directive): SnapshotDirective => ({
      id: directive.id,
      source: 'rule-derived',
      kind: directive.step.code,
      aggregateId: directive.target.id,
      text: directivePhrase(directive),
    }))
    .sort((a, b) => ordinalCompare(a.id, b.id))

  return {
    schema: SNAPSHOT_SCHEMA,
    baseline: { input: options.baselineInput, resolvedCommit: options.resolvedCommit },
    report,
    wpTotals: wpTotals(report.wpTree ?? []),
    directives,
    recentEvents: recentEvents(events),
  }
}

export function snapshotJson(snapshot: SnapshotV1): string {
  return `${canonicalize(snapshot)}\n`
}

function clean(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
}

function markdown(value: string): string {
  return clean(value).replace(/([\\`*_{}\[\]()#+\-.!|<>~])/gu, '\\$1')
}

export function snapshotDiagnostic(snapshot: SnapshotV1, format: 'text' | 'md'): string {
  const h = (value: string): string => (format === 'md' ? `## ${value}` : value)
  const esc = format === 'md' ? markdown : clean
  const lines = [
    format === 'md' ? '# Track factual snapshot' : 'TRACK FACTUAL SNAPSHOT',
    `schema: ${snapshot.schema}`,
    `baseline: ${esc(snapshot.baseline.resolvedCommit)}`,
    '',
    h('BUCKETS'),
    `AWAITED ${snapshot.report.buckets.AWAITED.length} · DROPPED ${snapshot.report.buckets.DROPPED.length} · DONE ${snapshot.report.buckets.DONE.length} · TO-DO ${snapshot.report.buckets['TO-DO'].length}`,
    '',
    h('RULE-DERIVED FACTS (NOT AI ADVICE)'),
  ]
  for (const directive of snapshot.directives) {
    lines.push(`- [${esc(directive.kind)}] ${esc(directive.text)} (${esc(directive.id)})`)
  }
  if (snapshot.directives.length === 0) lines.push('- none')
  lines.push('', h('RECENT EVENTS'))
  for (const event of snapshot.recentEvents) {
    lines.push(`- #${event.position} ${esc(event.kind)} · ${esc(event.aggregateId ?? '-')}`)
  }
  if (snapshot.recentEvents.length === 0) lines.push('- none')
  return `${lines.join('\n').trimEnd()}\n`
}

export function renderSnapshot(snapshot: SnapshotV1, format: 'json' | 'text' | 'md'): string {
  return format === 'json' ? snapshotJson(snapshot) : snapshotDiagnostic(snapshot, format)
}
