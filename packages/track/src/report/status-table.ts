import type { TrackEvent } from '../events/types.js'
import { acceptanceStatus } from '../accept/status.js'
import { assertDecisionExpectations, assertItemReportStatus, type DecisionExpectations, type ItemReportStatus, type ReportStage, type ReportStatus } from '../model/report-status.js'
import type { DecisionState } from '../model/decision.js'
import type { ItemState } from '../model/item.js'
import { fold } from '../state/fold.js'
import type { Report, ReportOptions } from './build.js'
import { effectiveOpenBlockersForItem } from './blocker-status.js'
import { buildDirectives } from './directive.js'
import { buildWpConductorView, displayCell, renderReportView, type Format, type ConductorMeta } from './format.js'

const COLORS: Record<ReportStatus, string> = { progressing: '🟢', unforeseen: '🟠', blocked: '🔴', 'decision-awaited': '🔵' }
const URGENCY: Record<ReportStatus, number> = { blocked: 0, 'decision-awaited': 1, unforeseen: 2, progressing: 3 }
const LINK_STAGES: Record<string, ReportStage> = { 'pr-open': 'PR', 'pr-merged': 'mergé', deployed: 'déployé' }
const STAGES: ReportStage[] = ['spec', 'dev', 'PR', 'mergé', 'déployé']
const COLUMNS = [
  { id: 'n', label: '#' }, { id: 'request', label: 'Ta demande' }, { id: 'stage', label: 'Étape' },
  { id: 'status', label: 'Statut' }, { id: 'action', label: 'Où ça en est / prochaine action' },
] as const

/** References may support a purpose, but cannot BE that purpose. No invented replacement prose. */
export function versionOnlySubject(value: string): boolean {
  return value.replace(/https?:\/\/\S+/giu, '').replace(/\bv?\d+\.\d+(?:\.\d+)?(?:-[\w.]+)?\b/giu, '')
    .replace(/\b(?:version|release|publication|PR)\b/giu, '').replace(/#\d+/gu, '').replace(/[\s()[\]{}.,:;—–\-·/]/gu, '') === ''
}

function nativeExpectations(d: DecisionState): DecisionExpectations | undefined {
  const artifact = d.dossier.artifacts?.find(a => a.kind === 'rendered-view')
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
  requestSource: 'report-event' | 'demand' | 'owner-quote' | 'legacy-title'
  stage: ReportStage
  stageEvidence?: string
  status: string
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
  const directives = buildDirectives(report.wpTree ?? [], report.decisions ?? [])
  const directiveOrder = new Map(directives.map((d, i) => [d.target.id, i]))
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
    const demand = item.demandId === undefined ? undefined : state.demands.get(item.demandId)
    const quote = item.body?.match(/Phrases? owner\s*:\s*«([^»]+)»/iu)?.[1]
    const request = info.ownerRequest ?? demand?.raw.text ?? quote ?? item.title
    const requestSource = info.ownerRequest ? 'report-event' : demand ? 'demand' : quote ? 'owner-quote' : 'legacy-title'
    if (versionOnlySubject(request)) issues.push('version-only-subject')
    const blockers = effectiveOpenBlockersForItem(state, item.id, options.baselineCommit)
    const linked = [...state.decisions.values()].filter(d => d.targets.includes(item.id))
    const pending = linked.filter(d => d.outcome === 'pending')
    const failed = acceptanceStatus(state, item.id, options.baselineCommit) === 'fail'
    let status: ReportStatus = info.status ?? 'unforeseen'
    if (info.status === undefined && blockers.length === 0 && !failed) issues.push('unrecorded-status')
    if (pending.length > 0 && status !== 'blocked') status = 'decision-awaited'
    if (blockers.some(b => b.kind !== 'decision') || failed) status = 'blocked'
    if (info.status === 'progressing' && status !== 'progressing') issues.push('status-contradicts-live-gate')
    if (info.status === 'decision-awaited' && linked.length > 0 && pending.length === 0) {
      if (status !== 'blocked') status = 'unforeseen'
      issues.push('settled-decision-expectations')
    }
    if (status === 'blocked' && !info.proposal) issues.push('missing-proposal')
    const expectations: DecisionExpectations[] = []
    if (status === 'decision-awaited') {
      if (pending.length === 0 && info.decisionExpectations) expectations.push(info.decisionExpectations)
      for (const d of pending) {
        const native = nativeExpectations(d)
        const supplied = info.decisionExpectations
        const matches = supplied && supplied.question === (d.dossier.subject ?? d.title) &&
          supplied.options.length === d.dossier.options.length && supplied.options.every((o, i) => o.label === d.dossier.options[i]!.title && o.consequence === d.dossier.options[i]!.summary)
        if (supplied && !matches) issues.push('decision-expectations-conflict')
        if (native) expectations.push(native)
        else if (matches) expectations.push(supplied)
      }
      if (expectations.length < Math.max(1, pending.length)) issues.push('missing-decision-expectations')
    }
    const derived = deriveStage(item)
    let stage = info.stage?.value ?? derived.value
    let evidence = info.stage?.evidence ?? derived.evidence
    const lastReopen = lastReopenById.get(item.id) ?? -1
    const lastReport = lastReportById.get(item.id) ?? -1
    if (lastReopen >= 0 && (lastReport < lastReopen || info.stage === undefined) && STAGES.indexOf(stage) > 1) {
      stage = 'dev'; evidence = undefined; issues.push('stage-predates-reopening')
    }
    const facts = [
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
      : info.nextAction ?? (issues.includes('unrecorded-status') ? 'vérifier puis renseigner le statut de conformité.' : 'renseigner la prochaine action vérifiée.')
    const row: StatusTableRow = { id: item.id, n: '', request, requestSource, stage, ...(evidence ? { stageEvidence: evidence } : {}), status: COLORS[status], action: `${facts.join(' ')} Ensuite : ${next}`, issues: [...new Set(issues)], expectations, dossierRefs: expectations.map(e => e.dossier) }
    return { row, urgency: URGENCY[status], priority: source.priority ?? -Infinity, directive: directiveOrder.get(item.id) ?? Infinity }
  })
  entries.sort((a, b) => a.urgency - b.urgency || a.directive - b.directive || b.priority - a.priority || a.row.id.localeCompare(b.row.id))
  return { columns: COLUMNS, rows: entries.map(({ row }, i) => ({ ...row, n: String(i + 1) })), order: 'blocage, décision propriétaire, imprévu, progression ; puis urgence canonique, priorité, identifiant' }
}

function deriveStage(item: ItemState): { value: ReportStage; evidence?: string } {
  const links = (item.links ?? []).filter(l => LINK_STAGES[l.kind] && l.locator.trim())
    .sort((a, b) => STAGES.indexOf(LINK_STAGES[b.kind]!) - STAGES.indexOf(LINK_STAGES[a.kind]!))
  const link = links[0]
  if (link) return { value: LINK_STAGES[link.kind]!, evidence: link.locator }
  return { value: item.realization === 'in-progress' || item.realization === 'done' ? 'dev' : 'spec' }
}

function issueText(issue: string): string {
  const labels: Record<string, string> = {
    'missing-proposal': 'proposition obligatoire', 'version-only-subject': 'finalité propriétaire manquante',
    'missing-decision-expectations': 'question, options avec conséquences, budget ≤2 min et lien du dossier requis',
    'unrecorded-status': 'statut de conformité non renseigné', 'invalid-report-event': 'événement de rapport invalide',
    'status-contradicts-live-gate': 'statut déclaré contredit par un blocage actif',
    'settled-decision-expectations': 'attendus périmés : décision déjà rendue',
    'decision-expectations-conflict': 'attendus différents du dossier de décision courant',
    'stage-predates-reopening': 'preuve d’étape antérieure à la réouverture',
  }
  return `NON CONFORME : ${labels[issue] ?? issue}.`
}

/** Keep the existing DÉCISIONS/attendus and recommendation, replacing only the activity tables. */
export function renderStatusTable(statusTable: StatusTable, report: Report, format: Format, meta: ConductorMeta): string {
  const view = buildWpConductorView(report.wpTree ?? [], report.decisions ?? [], report.outsideRollup, meta.scopeProjection?.label ?? 'global', meta)
  const decisions = view.tables.find(t => t.id === 'decisions')!
  const pendingCount = report.decisions?.filter(d => d.outcome === 'pending').length ?? 0
  const omitted = (report.decisions ?? []).filter(d => d.outcome !== 'pending').map(d => ({ label: d.title, reason: 'décision déjà tranchée' }))
  const count = statusTable.rows.length + pendingCount + omitted.length
  const coverage = { projected: count, rendered: count - omitted.length, omitted, aggregated: [] }
  const recommendation = {
    id: 'recommendation', title: 'RECOMMANDATION', render: 'prose' as const, columns: [], rows: [],
    lines: [
      'Traiter les lignes dans l’ordre indiqué ; toute NON CONFORME demande une vérification ou un complément avant action.',
      '🔴 : instruire la proposition de déblocage. 🔵 : Réponds à la question avec l’option choisie après lecture du dossier ; aucun GO implicite.',
      ...(report.decisions ?? []).filter(d => d.outcome === 'pending' && !d.structured).map(d => `À structurer : ${d.title} — enregistrer les options, leurs conséquences et une recommandation avant de demander une réponse.`),
      ...view.tables.find(t => t.id === 'recommendation')!.lines!.filter(line => /^D\d+ /u.test(line)),
    ],
  }
  const statusView = { ...view, coverage, header: { ...view.header, coverage, sources: [...view.header.sources, 'track report --status-table ; étapes et statuts enregistrés, sans vérification réseau'] }, tables: [decisions, recommendation] }
  if (format === 'json') return `${JSON.stringify({ ...report, statusTable, view: statusView }, null, 2)}\n`
  const rendered = renderReportView(statusView, format)
  const lines = [format === "md" ? "## DEMANDES" : "DEMANDES", "",
    `ordre : ${statusTable.order} ; ${statusTable.rows.length} demandes, aucune omission.`, "",
    `| ${COLUMNS.map(c => c.label).join(" | ")} |`, `| ${COLUMNS.map(() => "---").join(" | ")} |`,
    ...statusTable.rows.map(row => {
      const cells = COLUMNS.map(c => {
        const value = displayCell(row[c.id], format).replace(/\n/gu, format === 'md' ? '<br>' : ' ')
        return format === 'md' ? value : value.replace(/\|/gu, '\\|')
      })
      const refs = row.dossierRefs.map(ref => dossierLink(ref, format))
      if (refs.length > 0) cells[4] += ` ${refs.join(" ; ")}`
      return `| ${cells.join(" | ")} |`
    }), "", "",
  ]
  const marker = format === "md" ? "## DÉCISIONS" : "DÉCISIONS"
  return rendered.replace(`\n${marker}\n`, `\n${lines.join('\n')}${marker}\n`)
}

function dossierLink(ref: string, format: Format): string {
  if (format !== "md" || /^(?!https?:)[a-z][a-z\d+.-]*:/iu.test(ref)) return `dossier : ${displayCell(ref, format)}`
  const destination = encodeURI(ref).replace(/[<>()|\\]/gu, c => `%${c.charCodeAt(0).toString(16)}`)
  return `[dossier](${destination})`
}
