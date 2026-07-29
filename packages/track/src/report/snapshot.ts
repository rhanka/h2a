import { canonicalize } from '../events/canonical.js'
import type { TrackEvent } from '../events/types.js'
import { fold } from '../state/fold.js'
import {
  buildReport,
  type DecisionRow,
  type Report,
  type ReportRow,
} from './build.js'
import { buildDirectives } from './directive.js'
import { directivePhrase, wpTotals, type WpTotals } from './format.js'
import type { WpLeaf, WpLeafBlocker, WpNode } from './rollup.js'

export const SNAPSHOT_SCHEMA = 'track.snapshot/v1' as const
export const SNAPSHOT_EVENT_LIMIT = 200

/** Explains the otherwise similarly named top-level snapshot `directives` array. */
export interface SnapshotDirectivesProjection {
  kind: 'rule-derived-facts'
  order: 'aggregate-id-then-id'
}

/** Explains the bounded bare event projection without exposing event payload prose. */
export interface RecentEventsProjection {
  limit: typeof SNAPSHOT_EVENT_LIMIT
  order: 'append-order'
  content: 'position-event-id-kind-aggregate-id'
}

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

export type SnapshotReportRow = Pick<
  ReportRow,
  | 'id' | 'title' | 'kind' | 'workspace' | 'bucket' | 'realization' | 'acceptance'
  | 'priority' | 'accountable' | 'engagementRef' | 'role' | 'wpId' | 'wpLabel'
> & { detail: { acceptanceLabel: string } }

export type SnapshotDecisionRow = Pick<
  DecisionRow,
  | 'id' | 'title' | 'workspace' | 'decisionKind' | 'realization' | 'outcome'
  | 'structured' | 'structure' | 'accountable' | 'optionCount' | 'openQuestionCount' | 'hasRecommendation'
>

export type SnapshotWpLeafBlocker = Pick<
  WpLeafBlocker,
  'blockerId' | 'kind' | 'ref' | 'scope' | 'resolutionRule' | 'engagementRef' | 'reason'
>

export type SnapshotWpLeaf = Pick<
  WpLeaf,
  | 'id' | 'title' | 'bucket' | 'kind' | 'workspace' | 'realization' | 'acceptance'
  | 'priority' | 'specStatus' | 'accountable' | 'engagementRef' | 'awaitedOnDecision'
> & { openBlockers: SnapshotWpLeafBlocker[] }

export type SnapshotWpNode = Pick<
  WpNode,
  'id' | 'title' | 'label' | 'code' | 'role' | 'done' | 'active' | 'dropped' | 'pct' | 'terminal' | 'partial'
> & { leaves: SnapshotWpLeaf[]; children: SnapshotWpNode[] }

export interface SnapshotReport {
  buckets: {
    AWAITED: SnapshotReportRow[]
    DROPPED: SnapshotReportRow[]
    DONE: SnapshotReportRow[]
    'TO-DO': SnapshotReportRow[]
  }
  decisions: SnapshotDecisionRow[]
  wpTree: SnapshotWpNode[]
  outsideRollup?: SnapshotReportRow[]
}

export interface SnapshotV1 {
  schema: typeof SNAPSHOT_SCHEMA
  baseline: { input: string; resolvedCommit: string }
  report: SnapshotReport
  wpTotals: WpTotals
  directives: SnapshotDirective[]
  directivesProjection: SnapshotDirectivesProjection
  recentEvents: SnapshotRecentEvent[]
  recentEventsProjection: RecentEventsProjection
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
    ...(report.outsideRollup !== undefined
      ? { outsideRollup: [...report.outsideRollup].sort((a, b) => ordinalCompare(a.id, b.id)) }
      : {}),
  }
}

function projectRow(row: ReportRow): SnapshotReportRow {
  return {
    id: row.id,
    title: row.title,
    kind: row.kind,
    workspace: row.workspace,
    bucket: row.bucket,
    realization: row.realization,
    acceptance: row.acceptance,
    ...(row.priority !== undefined ? { priority: row.priority } : {}),
    ...(row.accountable !== undefined ? { accountable: row.accountable } : {}),
    ...(row.engagementRef !== undefined ? { engagementRef: row.engagementRef } : {}),
    ...(row.role !== undefined ? { role: row.role } : {}),
    ...(row.wpId !== undefined ? { wpId: row.wpId } : {}),
    ...(row.wpLabel !== undefined ? { wpLabel: row.wpLabel } : {}),
    detail: { acceptanceLabel: row.detail.acceptanceLabel },
  }
}

function projectDecision(decision: DecisionRow): SnapshotDecisionRow {
  return {
    id: decision.id,
    title: decision.title,
    workspace: decision.workspace,
    decisionKind: decision.decisionKind,
    realization: decision.realization,
    outcome: decision.outcome,
    ...(decision.structured !== undefined ? { structured: decision.structured } : {}),
    ...(decision.accountable !== undefined ? { accountable: decision.accountable } : {}),
    ...(decision.optionCount !== undefined ? { optionCount: decision.optionCount } : {}),
    ...(decision.openQuestionCount !== undefined ? { openQuestionCount: decision.openQuestionCount } : {}),
    ...(decision.hasRecommendation !== undefined ? { hasRecommendation: decision.hasRecommendation } : {}),
    structure: decision.structure ?? 'unstructured',
  }
}

function projectBlocker(blocker: WpLeafBlocker): SnapshotWpLeafBlocker {
  return {
    blockerId: blocker.blockerId,
    kind: blocker.kind,
    reason: blocker.reason,
    ...(blocker.ref !== undefined ? { ref: blocker.ref } : {}),
    ...(blocker.scope !== undefined ? { scope: blocker.scope } : {}),
    ...(blocker.resolutionRule !== undefined ? { resolutionRule: blocker.resolutionRule } : {}),
    ...(blocker.engagementRef !== undefined ? { engagementRef: blocker.engagementRef } : {}),
  }
}

function projectLeaf(leaf: WpLeaf): SnapshotWpLeaf {
  return {
    id: leaf.id,
    title: leaf.title,
    bucket: leaf.bucket,
    kind: leaf.kind,
    workspace: leaf.workspace,
    realization: leaf.realization,
    acceptance: leaf.acceptance,
    specStatus: leaf.specStatus,
    openBlockers: leaf.openBlockers.map(projectBlocker),
    ...(leaf.priority !== undefined ? { priority: leaf.priority } : {}),
    ...(leaf.accountable !== undefined ? { accountable: leaf.accountable } : {}),
    ...(leaf.engagementRef !== undefined ? { engagementRef: leaf.engagementRef } : {}),
    ...(leaf.awaitedOnDecision !== undefined ? { awaitedOnDecision: leaf.awaitedOnDecision } : {}),
  }
}

function projectNode(node: WpNode): SnapshotWpNode {
  return {
    id: node.id,
    title: node.title,
    label: node.label,
    done: node.done,
    active: node.active,
    dropped: node.dropped,
    pct: node.pct,
    leaves: node.leaves.map(projectLeaf),
    children: node.children.map(projectNode),
    ...(node.code !== undefined ? { code: node.code } : {}),
    ...(node.role !== undefined ? { role: node.role } : {}),
    ...(node.terminal !== undefined ? { terminal: node.terminal } : {}),
    ...(node.partial !== undefined ? { partial: node.partial } : {}),
  }
}

function projectReport(report: Report): SnapshotReport {
  return {
    buckets: {
      AWAITED: report.buckets.AWAITED.map(projectRow),
      DROPPED: report.buckets.DROPPED.map(projectRow),
      DONE: report.buckets.DONE.map(projectRow),
      'TO-DO': report.buckets['TO-DO'].map(projectRow),
    },
    decisions: (report.decisions ?? []).map(projectDecision),
    wpTree: (report.wpTree ?? []).map(projectNode),
    ...(report.outsideRollup !== undefined ? { outsideRollup: report.outsideRollup.map(projectRow) } : {}),
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
    .sort((a, b) => ordinalCompare(a.aggregateId ?? '', b.aggregateId ?? '') || ordinalCompare(a.id, b.id))

  return {
    schema: SNAPSHOT_SCHEMA,
    baseline: { input: options.baselineInput, resolvedCommit: options.resolvedCommit },
    report: projectReport(report),
    wpTotals: wpTotals(report.wpTree ?? [], report.outsideRollup),
    directives,
    directivesProjection: { kind: 'rule-derived-facts', order: 'aggregate-id-then-id' },
    recentEvents: recentEvents(events),
    recentEventsProjection: { limit: SNAPSHOT_EVENT_LIMIT, order: 'append-order', content: 'position-event-id-kind-aggregate-id' },
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
