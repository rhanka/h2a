import type { TrackEvent } from '../events/types.js'
import { acceptanceStatus } from '../accept/status.js'
import { assertDecisionExpectations, assertItemReportStatus, type DecisionExpectations, type ItemReportStatus, type ReportStage } from '../model/report-status.js'
import { isSettled, type DecisionState } from '../model/decision.js'
import type { ItemState } from '../model/item.js'
import { fold } from '../state/fold.js'
import type { Report, ReportOptions } from './build.js'
import { effectiveOpenBlockersForItem } from './blocker-status.js'
import { canonicalLeafUrgency } from './directive.js'
import { buildWpConductorView, redactOwnerTable, renderReportView, reportPeriodPayload, type Format, type ConductorMeta, type ReportView } from './format.js'
import { deriveItemStageStatus, STATUS_HEALTH, type StatusCode } from './stage-status.js'
import { resolveStageStatusLabels } from './stage-status-lexicon.js'

// Amendment D2 — the transitional view consumes the shared derivation; it no
// longer computes its own stage/status. Colours stay the four health states;
// colourless codes render `—` (D8, D9) until lot 4 removes these builders.
const URGENCY: Record<StatusCode, number> = { blocked: 0, 'decision-awaited': 1, unforeseen: 2, progressing: 3, 'not-qualified': 4, withdrawn: 5 }
const COLUMNS = [
  { id: 'n', label: '#' }, { id: 'request', label: 'Ta demande' }, { id: 'stage', label: 'Étape' },
  { id: 'status', label: 'Statut' }, { id: 'action', label: 'Où ça en est / prochaine action' },
] as const

function nativeExpectations(d: DecisionState): DecisionExpectations | undefined {
  const artifact = d.dossier.artifacts?.filter(a => a.kind === 'rendered-view').at(-1)
  const dossier = artifact?.kind === 'rendered-view' ? artifact.viewRef : d.links?.find(l => l.kind === 'dossier')?.locator
  const value = {
    question: d.dossier.subject ?? d.title,
    options: d.dossier.options.map(o => ({ label: o.title, consequence: o.summary })),
    dossier, readingMinutes: d.dossier.readability?.readingBudgetMinutes,
  }
  try { assertDecisionExpectations(value); return value } catch { return undefined }
}

export interface StatusTableRow {
  id: string
  n: string
  request: string
  requestSource: 'report-event' | 'demand' | 'legacy-title'
  stage: ReportStage
  stageEvidence?: string
  status: string
  /** Neutral status code identity (D2); the `status` cell is its rendering. */
  statusCode: StatusCode
  action: string
  issues: string[]
  expectations: DecisionExpectations[]
  dossierRefs: string[]
}
export interface StatusTable {
  columns: typeof COLUMNS
  rows: StatusTableRow[]
  order: string
}

export function buildStatusTable(events: readonly TrackEvent[], report: Report, options: ReportOptions): StatusTable {
  const state = fold(events)
  const sourceRows = Object.values(report.buckets).flat()
  const lastReopenById = new Map<string, number>()
  const lastReportById = new Map<string, number>()
  events.forEach((e, i) => {
    if (e.type === 'realization.reopened') lastReopenById.set(e.aggregateId, i)
    if (e.type === 'item.report-updated') lastReportById.set(e.aggregateId, i)
  })
  const entries = sourceRows.map(source => {
    const item = state.items.get(source.id)!
    const issues: string[] = []
    let info: ItemReportStatus = item.report ?? {}
    try { assertItemReportStatus(info) } catch { issues.push('invalid-report-event'); info = {} }
    const lastReopen = lastReopenById.get(item.id) ?? -1
    const lastReport = lastReportById.get(item.id) ?? -1
    const staleReport = lastReopen > lastReport
    if (staleReport) {
      issues.push('status-predates-reopening')
      // The request remains the owner's request; lifecycle assertions need fresh qualification.
      info = info.ownerRequest === undefined ? {} : { ownerRequest: info.ownerRequest }
    }
    // Amendment P3 — request text comes from the structured demand
    // (`raw.text`, immutable) when the item is linked; otherwise from the
    // item title, flagged as a title (`legacy-title` provenance). The
    // `Phrase(s) owner : « … »` body grep is deleted, not replaced.
    const demand = item.demandId === undefined ? undefined : state.demands.get(item.demandId)
    const request = info.ownerRequest ?? demand?.raw.text ?? item.title
    const requestSource = info.ownerRequest ? 'report-event' : demand ? 'demand' : 'legacy-title'
    // Amendment D10 — no natural-language classification of the request, in
    // any language. The `versionOnlySubject` word-list detector is deleted,
    // not replaced by detectors in other languages.
    // Amendment D2 — stage and status come from the shared derivation (D6's
    // single precedence table). This view flags; it never recomputes.
    const derived = deriveItemStageStatus(state, events, item, options.baselineCommit)
    const stage = derived.stage
    const evidence = derived.stageEvidence
    const status: StatusCode = derived.status
    if (derived.stageVoidedByReopening) issues.push('stage-predates-reopening')
    const blockers = effectiveOpenBlockersForItem(state, item.id, options.baselineCommit)
    const linked = [...state.decisions.values()].filter(d => d.targets.includes(item.id))
    const pending = linked.filter(d => !isSettled(d.outcome))
    const failed = acceptanceStatus(state, item.id, options.baselineCommit) === 'fail'
    const dropped = source.bucket === 'DROPPED'
    // A live gate overrides a stored green (D6): the declaration stays
    // visible in the facts, the derived status wins.
    if (info.status === 'progressing' && status !== 'progressing') issues.push('status-contradicts-live-gate')
    if (info.status === 'decision-awaited' && linked.length > 0 && pending.length === 0) {
      issues.push('settled-decision-expectations')
    }
    if (derived.unanswerableDecisionGate) issues.push('unanswerable-decision-gate')
    if (status === 'blocked' && !info.proposal) issues.push('missing-proposal')
    const blue = linked.filter(d => derived.blueDossierIds.includes(d.id))
    const expectations: DecisionExpectations[] = []
    if (status === 'decision-awaited') {
      if (blue.length === 0 && info.decisionExpectations) expectations.push(info.decisionExpectations)
      const supplied = info.decisionExpectations
      const matches = (d: DecisionState): boolean => supplied !== undefined && supplied.question === (d.dossier.subject ?? d.title) &&
        supplied.options.length === d.dossier.options.length && supplied.options.every((o, i) => o.label === d.dossier.options[i]!.title && o.consequence === d.dossier.options[i]!.summary)
      if (supplied && blue.length > 0 && !blue.some(matches)) issues.push('decision-expectations-conflict')
      for (const d of blue) {
        const native = nativeExpectations(d)
        if (native) expectations.push(native)
        else if (supplied && matches(d)) expectations.push(supplied)
      }
      if (expectations.length < Math.max(1, blue.length)) issues.push('missing-decision-expectations')
    }
    const facts = [
      item.reopenings?.at(-1) ? `Réouverture : ${item.reopenings.at(-1)!.reason}.` : undefined,
      info.facts, `État enregistré : ${item.realization}.`,
      evidence ? `Preuve ${stage} : ${evidence}.` : undefined,
      ...blockers.map(b => `Attente enregistrée : ${b.reason}.`),
      failed ? 'Recette en échec.' : undefined,
      requestSource === 'legacy-title' ? 'Formulation issue du titre historique ; citation propriétaire non reliée.' : undefined,
      info.status ? `Statut déclaré : ${info.status}.` : undefined,
      info.waitingOn ? `En attente de ${info.waitingOn}.` : undefined,
      info.suspended ? `Suspendu : ${info.suspended}.` : undefined,
      info.proposal ? `Proposition : ${info.proposal}` : undefined,
      ...pending.map(d => `Décision : ${d.dossier.subject ?? d.title}.`),
      ...expectations.map(e => `Question : ${e.question} Options : ${e.options.map(o => `${o.label} → ${o.consequence}`).join(' ; ')}. Lecture : ${e.readingMinutes} min.`),
      ...issues.map(issueText),
    ].filter(Boolean)
    const next = status === 'decision-awaited' ? (issues.includes('missing-decision-expectations') ? 'compléter les attendus et le lien du dossier avant de demander ton GO.' : 'ton GO sur la question et les options ci-dessus.')
      : status === 'blocked' ? info.nextAction ?? info.proposal ?? 'rédiger une proposition de déblocage.'
      : status === 'not-qualified' ? info.nextAction ?? 'qualifier la conformité (faits constatés ou recette), puis renseigner la prochaine action.'
      : info.nextAction ?? (issues.some(i => i === 'status-predates-reopening') ? 'vérifier puis renseigner le statut de conformité.' : dropped ? 'aucune action : demande retirée.' : 'renseigner la prochaine action vérifiée.')
    const row: StatusTableRow = { id: item.id, n: '', request, requestSource, stage, ...(evidence ? { stageEvidence: evidence } : {}), status: STATUS_HEALTH[status] ?? '—', statusCode: status, action: `${facts.join(' ')} Ensuite : ${next}`, issues: [...new Set(issues)], expectations, dossierRefs: expectations.map(e => e.dossier) }
    const terminal = (source.bucket === 'DONE' || dropped) && blockers.length === 0 && !['fail', 'stale'].includes(source.acceptance)
    const canonical = canonicalLeafUrgency({ realization: item.realization, acceptance: source.acceptance, specStatus: item.specStatus ?? 'n/a', openBlockers: blockers.map(b => ({ ...b, blockerId: b.id })) })
    return { row, terminal: Number(terminal), urgency: URGENCY[status], priority: source.priority ?? -Infinity, canonical }
  })
  entries.sort((a, b) => a.terminal - b.terminal || a.urgency - b.urgency || a.canonical - b.canonical || b.priority - a.priority || a.row.id.localeCompare(b.row.id))
  return { columns: COLUMNS, rows: entries.map(({ row }, i) => ({ ...row, n: String(i + 1) })), order: 'demandes actives avant clôturées ; blocage, décision propriétaire, imprévu, progression ; puis urgence canonique, priorité, identifiant' }
}

function issueText(issue: string): string {
  const labels: Record<string, string> = {
    'missing-proposal': 'proposition obligatoire', 'unanswerable-decision-gate': 'dossier sans attendus actionnables : structurer avant de demander un GO',
    'missing-decision-expectations': 'question, options avec conséquences, budget ≤2 min et lien du dossier requis',
    'unrecorded-status': 'statut de conformité non renseigné', 'invalid-report-event': 'événement de rapport invalide',
    'status-contradicts-live-gate': 'statut déclaré contredit par un blocage actif',
    'settled-decision-expectations': 'attendus périmés : décision déjà rendue',
    'decision-expectations-conflict': 'attendus différents du dossier de décision courant',
    'stage-predates-reopening': 'preuve d’étape antérieure à la réouverture',
    'status-predates-reopening': 'conformité à requalifier après la réouverture',
  }
  return `NON CONFORME : ${labels[issue] ?? issue}.`
}

/** Keep the existing DÉCISIONS/attendus and recommendation, replacing only the activity tables. */
export function buildStatusTableView(statusTable: StatusTable, report: Report, meta: ConductorMeta, lang?: string): ReportView {
  // Deferred decisions still await settlement. Keep legacy rendering unchanged outside this opt-in view.
  const decisionsForView = (report.decisions ?? []).map(d => d.outcome === 'deferred' ? { ...d, outcome: 'pending' as const } : d)
  const view = buildWpConductorView(report.wpTree ?? [], decisionsForView, report.outsideRollup, meta.scopeProjection?.label ?? 'global', meta)
  const decisions = view.tables.find(t => t.id === 'decisions')!
  const pendingCount = report.decisions?.filter(d => !isSettled(d.outcome)).length ?? 0
  const omitted = (report.decisions ?? []).filter(d => isSettled(d.outcome)).map(d => ({ label: d.title, reason: 'décision déjà tranchée' }))
  const count = statusTable.rows.length + pendingCount + omitted.length
  const coverage = { projected: count, rendered: count - omitted.length, omitted, aggregated: [] }
  const recommendation = {
    id: 'recommendation', title: 'RECOMMANDATION', render: 'prose' as const, columns: [], rows: [],
    lines: [
      'Traiter les lignes dans l’ordre indiqué ; toute NON CONFORME demande une vérification ou un complément avant action.',
      '🔴 : instruire la proposition de déblocage. 🔵 : Réponds à la question avec l’option choisie après lecture du dossier ; aucun GO implicite.',
      ...(report.decisions ?? []).filter(d => !isSettled(d.outcome) && !d.structured).map(d => `À structurer : ${d.title} — enregistrer les options, leurs conséquences et une recommandation avant de demander une réponse.`),
      ...view.tables.find(t => t.id === 'recommendation')!.lines!.filter(line => /^D\d+ /u.test(line)),
    ],
  }
  // Amendment D10 — with an explicit `--lang`, the transitional stage/status
  // CELLS render through the per-language lexicon. The row codes
  // (`stage`, `statusCode`) stay language-neutral identities; only the
  // owner-facing cells are labelled. Without `--lang` the cells are
  // byte-identical to the established rendering.
  const labels = lang === undefined ? undefined : resolveStageStatusLabels(lang).labels
  const cellFor = (row: StatusTableRow, column: string): string => {
    if (labels !== undefined && column === 'stage') return labels.stage[row.stage]
    if (labels !== undefined && column === 'status') {
      const health = STATUS_HEALTH[row.statusCode]
      const label = labels.status[row.statusCode]
      return health === undefined ? label : `${health} ${label}`
    }
    return row[column as keyof StatusTableRow] as unknown as string
  }
  const requests = redactOwnerTable({
    id: 'requests', title: 'DEMANDES', render: 'pipe', columns: COLUMNS,
    rows: statusTable.rows.map(row => Object.fromEntries(COLUMNS.map(c => [c.id, cellFor(row, c.id)]))),
    lines: [`ordre : ${statusTable.order} ; ${statusTable.rows.length} demandes, aucune omission.`],
    links: statusTable.rows.flatMap((row, index) => row.dossierRefs.map(destination => ({ row: index, column: 'action', label: 'dossier', destination }))),
  })
  const handles = [
    ...statusTable.rows.map(row => ({ handle: row.n, kind: 'item' as const, id: row.id, title: row.request })),
    ...view.handles.filter(h => h.kind === 'decision'),
  ]
  return { ...view, handles, coverage, header: { ...view.header, coverage,
    handleCommand: view.header.handleCommand.replace('track report', 'track report --status-table'),
    sources: [...view.header.sources, 'track report --status-table ; étapes et statuts enregistrés, sans vérification réseau'],
  }, tables: [requests, decisions, redactOwnerTable(recommendation)] }
}

export function renderStatusTable(statusTable: StatusTable, report: Report, format: Format, meta: ConductorMeta, lang?: string): string {
  const view = buildStatusTableView(statusTable, report, meta, lang)
  // Amendment D4 — the full `period` payload is present in every format and
  // every mode (the withdrawn view dropped it; the validated contract keeps it).
  if (format === 'json') return `${JSON.stringify({ ...report, period: reportPeriodPayload(meta), statusTable, view }, null, 2)}\n`
  return renderReportView(view, format)
}
