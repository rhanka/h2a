import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { EventStore } from '../events/store.js'
import { Track } from '../track.js'
import { runCli } from '../cli/index.js'

let dir: string
let store: EventStore
let track: Track
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'track-status-'))
  store = new EventStore(join(dir, 'events.jsonl'))
  track = new Track(store, { by: 'fixture', now: () => '2026-10-17T12:00:00.000Z' })
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))
const item = (title = 'Je veux retrouver mes agents', extra = {}) => track.createItem({ kind: 'feature', title, workspace: 'ws', ...extra })
function cli(args: string[]) {
  let out = '', err = ''
  const code = runCli(['--track-dir', dir, ...args], { cwd: dir, out: s => { out += s }, err: s => { err += s } })
  return { code, out, err }
}
const set = (id: string, report: unknown) => cli(['item', 'report-set', id, '--json', JSON.stringify(report)])
function report(format = 'json', extra: string[] = []) {
  const result = cli(['report', '--status-table', '--commit', 'fixture', '--format', format, ...extra])
  expect(result.code, result.err).toBe(0)
  return result.out
}
const rows = () => JSON.parse(report()).statusTable.rows

describe('owner status table regression fixtures', () => {
  it('flags a red row without a proposal in JSON and the rendered row', () => {
    const id = item()
    const dep = item('Dépendance externe')
    track.openBlocker({ targetId: id, kind: 'dependency', ref: dep, reason: 'Attente autre piste' })
    expect(set(id, { status: 'blocked', facts: 'La recette échoue.' }).code).toBe(0)
    expect(rows()[0]).toMatchObject({ id, status: '🔴', statusCode: 'blocked', issues: ['missing-proposal'] })
    expect(report('md')).toContain('NON CONFORME : proposition obligatoire')
    expect(set(id, { status: 'blocked', proposal: 'Corriger la résolution puis rejouer la recette.' }).code).toBe(0)
    expect(rows()[0].issues).not.toContain('missing-proposal')
    expect(report('text')).toContain('Proposition : Corriger la résolution')
  })

  // Amendment D10 — the lexical version/reference word-list detector is
  // retired: no test infers purpose from words, in any language. Provenance
  // is structural (`requestSource`: report-event, demand, or legacy-title).
  it('tracks request provenance structurally without classifying prose', () => {
    const id = item('0.98.7')
    expect(rows()[0]).toMatchObject({ request: '0.98.7', requestSource: 'legacy-title' })
    expect(rows()[0].issues).not.toContain('version-only-subject')
    set(id, { ownerRequest: 'Je veux retrouver mes agents (PR #42)', status: 'progressing' })
    expect(rows()[0]).toMatchObject({ request: 'Je veux retrouver mes agents (PR #42)', requestSource: 'report-event' })
  })

  it('persists an additive event, replays after restart, and replaces stale report fields', () => {
    const id = item()
    const prefix = readFileSync(join(dir, 'events.jsonl'), 'utf8')
    expect(set(id, { stage: { value: 'pr', evidence: 'https://github.com/rhanka/h2a/pull/42' }, status: 'blocked', proposal: 'Rejouer CI' }).code).toBe(0)
    expect(store.readAll().at(-1)?.type).toBe('item.report-updated')
    expect(readFileSync(join(dir, 'events.jsonl'), 'utf8').startsWith(prefix)).toBe(true)
    expect(new Track(store).state().items.get(id)).toHaveProperty('report.status', 'blocked')
    track.setRealization(id, 'in-progress')
    set(id, { status: 'progressing', facts: 'Avancement constaté.', stage: { value: 'dev' } })
    expect(new Track(store).state().items.get(id)).not.toHaveProperty('report.proposal')
    expect(rows()[0]).toMatchObject({ stage: 'dev', status: '🟢', statusCode: 'progressing' })
  })

  it('keeps historical items readable without asserting conformity or merge from done', () => {
    const id = item()
    track.setRealization(id, 'in-progress')
    track.setRealization(id, 'done')
    expect(new Track(store).state().items.get(id)).not.toHaveProperty('report')
    // Amendment D8 — never qualified, no colour: a reported gap, not an incident.
    expect(rows()[0]).toMatchObject({ stage: 'dev', status: '—', statusCode: 'not-qualified' })
    expect(rows()[0].issues).toEqual([])
    expect(report('text')).toContain('qualifier la conformité')
    expect(rows()[0].action).toContain('Ensuite :')
  })

  it.each([
    ['pr', 'spec'], ['pr-open', 'pr'], ['pr-merged', 'merged'],
    ['release', 'spec'], ['release-published', 'spec'], ['deployed', 'deployed'],
  ])('derives stage from explicit evidence kind %s only', (kind, stage) => {
    item(undefined, { links: [{ kind, locator: 'https://example.test/evidence/42' }] })
    expect(rows()[0].stage).toBe(stage)
    if (stage !== 'spec') expect(rows()[0].action).toContain('https://example.test/evidence/42')
  })

  it('rejects invalid enum/shape and stages beyond dev without evidence without appending', () => {
    const id = item()
    const count = store.readAll().length
    for (const value of [null, [], { status: 'purple' }, { stage: { value: 'merged' } }, { stage: { value: 'mergé' } }, { proposal: 2 }, { unknown: true }, { decisionExpectations: { question: 'Q' } }]) {
      expect(set(id, value).code).not.toBe(0)
    }
    expect(store.readAll()).toHaveLength(count)
    expect(set('missing', { status: 'progressing' }).code).not.toBe(0)
    expect(set(id, {}).code).toBe(0)
  })

  it('prints blue expectations verbatim with consequences and a clickable dossier; flags incomplete blue', () => {
    // Amendment D6 — blue requires an effective gate on a pending, structured,
    // answerable native dossier: the expectations below come from the dossier.
    const incomplete = item('Choix incomplet')
    const pendingDossier = {
      context: 'Le choix change les connexions.',
      qa: [],
      options: [{ id: 'a', title: 'A : partager', summary: 'Une connexion commune.' }, { id: 'b', title: 'B : isoler', summary: 'Une connexion par session.' }],
      recommendation: { optionId: 'a', rationale: 'Moins de connexions' },
    }
    const d1 = track.createDecision({ decisionKind: 'commitment', title: 'Faut-il partager le MCP ?', workspace: 'ws', targets: [incomplete], dossier: pendingDossier })
    track.openBlocker({ targetId: incomplete, kind: 'decision', ref: d1, reason: 'Choix propriétaire en attente' })
    expect(rows().find((r: { id: string }) => r.id === incomplete)!.issues).toContain('missing-decision-expectations')
    const id = item()
    const d2 = track.createDecision({ decisionKind: 'commitment', title: 'Faut-il partager le MCP ?', workspace: 'ws', targets: [id], dossier: {
      ...pendingDossier,
      readability: { readingBudgetMinutes: 2 },
      artifacts: [{ kind: 'rendered-view', viewRef: 'https://example.test/dossier/42' }],
    } })
    track.openBlocker({ targetId: id, kind: 'decision', ref: d2, reason: 'Choix propriétaire en attente' })
    const out = report('md')
    for (const value of ['Faut-il partager le MCP', 'Une connexion commune.', 'Une connexion par session.', '[dossier](https://example.test/dossier/42)', 'ton GO', 'DÉCISIONS']) expect(out.replace(/\\-/gu, '-')).toContain(value)
    expect(rows().find((r: { id: string }) => r.id === id)!.issues).toEqual([])
    const decisionExpectations = {
      question: 'Faut-il partager le MCP ?',
      options: [{ label: 'A : partager', consequence: 'Une connexion commune.' }, { label: 'B : isoler', consequence: 'Une connexion par session.' }],
      dossier: 'https://example.test/dossier/42', readingMinutes: 3,
    }
    expect(set(id, { status: 'decision-awaited', decisionExpectations }).code).not.toBe(0)
  })

  it('keeps actual pending decision dossiers and flags missing presentation rather than inventing it', () => {
    const id = item()
    const decisionId = track.createDecision({ decisionKind: 'commitment', title: 'Partager le MCP ?', workspace: 'ws', targets: [id], dossier: { context: 'Le choix change les connexions.', qa: [], options: [{ id: 'a', title: 'Partager', summary: 'Une connexion' }, { id: 'b', title: 'Isoler', summary: 'Plusieurs connexions' }], recommendation: { optionId: 'a', rationale: 'Moins de connexions' } } })
    track.openBlocker({ targetId: id, kind: 'decision', ref: decisionId, reason: 'Choix propriétaire en attente' })
    const row = rows().find((r: { id: string }) => r.id === id)!
    expect(row.status).toBe('🔵')
    expect(row.statusCode).toBe('decision-awaited')
    expect(row.issues).toContain('missing-decision-expectations')
    const out = report('text')
    for (const text of ['DÉCISIONS', 'Partager', 'Isoler', 'Une connexion', 'Plusieurs connexions', 'Réponds']) expect(out).toContain(text)
  })

  it('orders urgent first and describes lane waits and suspension in the action column', () => {
    const normal = item('Travail normal')
    track.setRealization(normal, 'in-progress')
    set(normal, { status: 'progressing', facts: 'Avancement constaté.' })
    const choice = item('Choix propriétaire')
    track.setRealization(choice, 'in-progress')
    const choiceDecision = track.createDecision({ decisionKind: 'commitment', title: 'Partager ?', workspace: 'ws', targets: [choice], dossier: {
      context: 'Choix de connexion.', qa: [], readability: { readingBudgetMinutes: 2 },
      options: [{ id: 'a', title: 'Partager', summary: 'Une connexion' }, { id: 'b', title: 'Isoler', summary: 'Deux connexions' }],
      recommendation: { optionId: 'a', rationale: 'Moins de connexions' },
      artifacts: [{ kind: 'rendered-view', viewRef: 'https://example.test/dossier/choix' }],
    } })
    track.openBlocker({ targetId: choice, kind: 'decision', ref: choiceDecision, reason: 'Choix propriétaire en attente' })
    const red = item('Incident bloquant')
    const redDep = item('Prérequis bloquant')
    track.openBlocker({ targetId: red, kind: 'dependency', ref: redDep, reason: 'Prérequis manquant' })
    set(red, { status: 'blocked', proposal: 'Corriger', waitingOn: 'lane tests', suspended: 'attente de capacité' })
    const orange = item('Imprévu')
    track.setRealization(orange, 'in-progress')
    track.setRealization(orange, 'done')
    track.reopenItem(orange, { motive: 'regression-observed', reason: 'Régression constatée' })
    expect(rows().filter((r: { id: string }) => r.id !== redDep).map((r: { status: string }) => r.status)).toEqual(['🔴', '🔵', '🟠', '🟢'])
    expect(rows()[0].action).toContain('En attente de lane tests')
    expect(rows()[0].action).toContain('Suspendu : attente de capacité')
    const header = report('md').split('\n').find(l => l.startsWith('| #'))!
    expect(header).toBe('| # | Ta demande | Étape | Statut | Où ça en est / prochaine action |')
  })

  it('supports scoped markdown and preserves the legacy JSON contract when not selected', () => {
    const wp = item('Demandes propriétaire', { role: 'workpackage', kind: 'chore' })
    item('Demande incluse', { parentId: wp })
    item('Demande extérieure')
    expect(report('md', ['--scope', wp])).toContain('Demande incluse')
    expect(report('md', ['--scope', wp])).not.toContain('Demande extérieure')
    const result = cli(['report', '--format', 'json', '--commit', 'fixture'])
    expect(result.code, result.err).toBe(0)
    expect(JSON.parse(result.out)).not.toHaveProperty('statusTable')
    for (const extra of [['--flat'], ['--inline'], ['--raw'], ['--level', 'wp']]) {
      expect(cli(['report', '--status-table', ...extra]).code).not.toBe(0)
    }
  })

  it('overrides stale green with an effective blocker and demands a proposal', () => {
    const id = item()
    set(id, { status: 'progressing' })
    const dep = item('Dépendance externe')
    track.openBlocker({ targetId: id, kind: 'dependency', ref: dep, reason: 'Attente autre piste' })
    const row = rows().find((r: { id: string }) => r.id === id)
    expect(row.status).toBe('🔴')
    expect(row.issues).toContain('missing-proposal')
    expect(row.issues).toContain('status-contradicts-live-gate')
  })

  it('keeps Markdown cells intact and does not turn arbitrary dossier schemes into links', () => {
    set(item('But | citation\nligne'), { status: 'decision-awaited', decisionExpectations: {
      question: 'Q | suite ?', options: [{ label: 'A', consequence: 'a | b' }, { label: 'B', consequence: 'c' }], dossier: 'javascript:alert(1)', readingMinutes: 1,
    } })
    const out = report('md')
    expect(out).toContain('But \\| citation')
    expect(out).not.toContain('[dossier](javascript:')
    expect(out.split('\n').filter(l => l.startsWith('| 1 '))).toHaveLength(1)
  })

  it('uses the structured demand text and flags old merge evidence after reopening', () => {
    // Amendment P3 — the request comes from the linked demand (`raw.text`,
    // immutable); the body grope for `Phrase(s) owner : « … »` is deleted.
    const demand = track.raiseDemand({ type: 'feature', workspace: 'ws', raw: { text: 'Je veux reprendre ma session' }, source: { kind: 'human' }, handler: 'h' })
    track.claimDemand(demand, { handler: 'h' })
    const [promoted] = track.agreeDemand(demand, { items: [{ title: 'Titre technique', links: [{ kind: 'pr-merged', locator: 'https://example.test/pr/1' }] }] })
    const id: string = promoted!
    track.setRealization(id, 'in-progress')
    track.setRealization(id, 'done')
    expect(rows()[0]).toMatchObject({ request: 'Je veux reprendre ma session', requestSource: 'demand', stage: 'merged' })
    track.reopenItem(id, { motive: 'regression-observed', reason: 'La reprise échoue de nouveau' })
    expect(rows()[0].stage).toBe('dev')
    expect(rows()[0].issues).toContain('stage-predates-reopening')
  })

  it('derives complete expectations from the native dossier and keeps a separate block red', () => {
    const id = item()
    const decisionId = track.createDecision({ decisionKind: 'commitment', title: 'Partager ?', workspace: 'ws', targets: [id], dossier: {
      context: 'Choix de connexion.', qa: [], readability: { readingBudgetMinutes: 2 },
      options: [{ id: 'a', title: 'Partager', summary: 'Une connexion' }, { id: 'b', title: 'Isoler', summary: 'Deux connexions' }],
      recommendation: { optionId: 'a', rationale: 'Moins de connexions' }, artifacts: [{ kind: 'rendered-view', viewRef: 'https://example.test/dossier/native' }],
    } })
    track.openBlocker({ targetId: id, kind: 'decision', ref: decisionId, reason: 'Choix propriétaire en attente' })
    expect(rows()[0]).toMatchObject({ status: '🔵', statusCode: 'decision-awaited', issues: [], dossierRefs: ['https://example.test/dossier/native'] })
    const dep = item('Prérequis bloquant')
    track.openBlocker({ targetId: id, kind: 'dependency', ref: dep, reason: 'Transport à corriger' })
    set(id, { status: 'blocked', proposal: 'Corriger le transport avant le choix.' })
    expect(rows()[0].status).toBe('🔴')
    expect(report('md')).toContain('Partager')
  })

  it('keeps the blocked proposal and the separately recorded concrete next gesture', () => {
    set(item(), { status: 'blocked', proposal: 'Réparer la reconnexion.', nextAction: 'Ouvrir resolver.ts et corriger la cible.' })
    expect(rows()[0].action).toContain('Proposition : Réparer la reconnexion.')
    expect(rows()[0].action).toContain('Ensuite : Ouvrir resolver.ts et corriger la cible.')
  })

  it('requires renewed conformity after a recorded regression reopens an old green request', () => {
    const id = item()
    set(id, { status: 'progressing' })
    track.setRealization(id, 'in-progress')
    track.setRealization(id, 'done')
    track.reopenItem(id, { motive: 'regression-observed', reason: 'La reprise est cassée' })
    expect(rows()[0]).toMatchObject({ status: '🟠', issues: ['status-predates-reopening'] })
    set(id, { status: 'progressing', facts: 'Correctif en cours, recette de régression ouverte.' })
    expect(rows()[0].status).toBe('🟢')
  })
})

describe('independent review regressions', () => {
  const decision = (id: string, title = 'Partager ?') => track.createDecision({
    decisionKind: 'commitment', title, workspace: 'ws', targets: [id], dossier: {
      context: 'Choix de connexion.', qa: [], readability: { readingBudgetMinutes: 2 },
      options: [{ id: 'a', title: 'Partager', summary: 'Une connexion' }, { id: 'b', title: 'Isoler', summary: 'Deux connexions' }],
      recommendation: { optionId: 'a', rationale: 'Moins de connexions' },
      artifacts: [{ kind: 'rendered-view', viewRef: 'https://example.test/dossier/old' }],
    },
  })
  const reopen = (id: string) => {
    track.setRealization(id, 'in-progress')
    track.setRealization(id, 'done')
    track.reopenItem(id, { motive: 'regression-observed', reason: 'La reprise échoue de nouveau' })
  }
  const expectations = {
    question: 'Partager ?', options: [{ label: 'Partager', consequence: 'Une connexion' }, { label: 'Isoler', consequence: 'Deux connexions' }],
    dossier: 'https://example.test/dossier/old', readingMinutes: 2,
  }

  it('review #1: reads the structured demand lineage as the request', () => {
    // Amendment P3 — the body grope for owner-quote markers is deleted: the
    // request is the linked demand text, else the title flagged legacy-title.
    const demand = track.raiseDemand({ type: 'feature', workspace: 'ws', raw: { text: 'Je veux reprendre ma session' }, source: { kind: 'human' }, handler: 'h' })
    track.claimDemand(demand, { handler: 'h' })
    const [promotedTitle] = track.agreeDemand(demand, { items: [{ title: 'Titre technique' }] })
    const id: string = promotedTitle!
    expect(rows().find((r: { id: string }) => r.id === id)).toMatchObject({ request: 'Je veux reprendre ma session', requestSource: 'demand' })
    expect(rows().find((r: { id: string }) => r.id === id)!.issues).not.toContain('version-only-subject')
  })

  it('review #1: an item without a demand falls back to its title, flagged legacy-title', () => {
    item('Reprendre la session')
    expect(rows()[0]).toMatchObject({ request: 'Reprendre la session', requestSource: 'legacy-title' })
    expect(rows()[0].issues).not.toContain('version-only-subject')
  })

  it.each(['progressing', 'blocked', 'decision-awaited'])('review #2: invalidates all stale report fields after reopening from %s', status => {
    const id = item()
    set(id, { status, facts: 'PR fusionnée', nextAction: 'ras', proposal: 'Ancienne proposition', waitingOn: 'Ancienne attente', suspended: 'Ancienne suspension', decisionExpectations: expectations })
    reopen(id)
    const row = rows()[0]
    expect(row).toMatchObject({ status: '🟠', issues: ['status-predates-reopening'] })
    expect(row.action).toContain('La reprise échoue de nouveau')
    expect(row.action).toContain('Ensuite : vérifier puis renseigner le statut de conformité.')
    for (const stale of ['PR fusionnée', 'ras', 'Ancienne proposition', 'Ancienne attente', 'Ancienne suspension', 'Partager ?']) expect(row.action).not.toContain(stale)
    expect(row.expectations).toEqual([])
  })

  it('review #2: requalifies a derived stage after a fresh report without --stage', () => {
    const id = item(undefined, { links: [{ kind: 'pr-merged', locator: 'https://example.test/pr/1' }] })
    set(id, { status: 'progressing' })
    reopen(id)
    expect(rows()[0].issues).toContain('stage-predates-reopening')
    set(id, { status: 'progressing', facts: 'Correctif en cours' })
    expect(rows()[0]).toMatchObject({ status: '🟢', stage: 'dev', issues: [] })
    expect(rows()[0]).not.toHaveProperty('stageEvidence')
    expect(rows()[0].action).not.toContain('https://example.test/pr/1')
    // Full replacement: the requalifying stage carries its conformity facts.
    set(id, { status: 'progressing', facts: 'Correctif vérifié.', stage: { value: 'pr', evidence: 'https://example.test/pr/fix' } })
    expect(rows()[0]).toMatchObject({ stage: 'pr', stageEvidence: 'https://example.test/pr/fix', issues: [] })
  })

  it('review #2: still enforces live gates and a fresh proposal after reopening', () => {
    const id = item()
    set(id, { status: 'blocked', proposal: 'Ancienne proposition' })
    reopen(id)
    track.openBlocker({ targetId: id, kind: 'dependency', ref: item('Prérequis'), reason: 'Prérequis manquant' })
    const row = rows().find((r: { id: string }) => r.id === id)
    expect(row.status).toBe('🔴')
    expect(row.issues).toContain('status-predates-reopening')
    expect(row.issues).toContain('missing-proposal')
    expect(row.action).toContain('Prérequis manquant')
    expect(row.action).not.toContain('Ancienne proposition')
  })

  it.each([true, false])('review #3: ranks every active leaf before closed leaves (WP=%s)', inWp => {
    const parentId = inWp ? item('WP', { role: 'workpackage', kind: 'chore' }) : undefined
    const closed = item('Ancienne livraison', { parentId })
    track.setRealization(closed, 'in-progress'); track.setRealization(closed, 'done')
    const todo = item('À démarrer', { parentId })
    const active = [item('En cours A', { parentId }), item('En cours B', { parentId, engagementRef: 'contract-42' }), item('En cours C', { parentId })]
    for (const id of active) track.setRealization(id, 'in-progress')
    expect(rows().map((r: { id: string }) => r.id)).toEqual([...active, todo, closed])
  })

  it('review #4: resolves the exact DEMANDES numbering including closed and scoped rows', () => {
    const wp = item('WP', { role: 'workpackage', kind: 'chore' })
    const closed = item('Fini', { parentId: wp })
    track.setRealization(closed, 'in-progress'); track.setRealization(closed, 'done')
    item('Actif', { parentId: wp })
    item('Hors scope')
    for (const extra of [[], ['--scope', wp]]) {
      const json = JSON.parse(report('json', extra))
      const handles = json.view.handles.filter((h: { kind: string }) => h.kind === 'item')
      expect(handles.map((h: { handle: string; id: string }) => [h.handle, h.id])).toEqual(json.statusTable.rows.map((r: { n: string; id: string }) => [r.n, r.id]))
      const text = report('text', extra)
      expect(text).toContain('report --status-table')
      for (const row of json.statusTable.rows) {
        expect(text).toContain(`${row.n}\t${row.id}\t`)
        const resolved = cli(['report', '--status-table', '--resolve', row.n, '--commit', 'fixture', ...extra])
        expect(resolved.code, resolved.err).toBe(0)
        expect(resolved.out).toContain(`${row.n}\titem\t${row.id}\t`)
      }
    }
  })

  it.each(['spec', 'dev'])('review #5: does not inherit link evidence for an explicit %s stage', stage => {
    const id = item(undefined, { links: [{ kind: 'pr-open', locator: 'https://example.test/pr/42' }] })
    track.setRealization(id, 'in-progress')
    set(id, { stage: { value: stage }, status: 'progressing', facts: 'Avancement constaté.' })
    expect(rows()[0]).toMatchObject({ stage, status: '🟢', statusCode: 'progressing' })
    expect(rows()[0]).not.toHaveProperty('stageEvidence')
    expect(rows()[0].action).not.toContain('https://example.test/pr/42')
  })

  it('review #6: selects the latest rendered dossier', () => {
    const d = decision(item())
    track.addDecisionArtifact(d, { kind: 'rendered-view', viewRef: 'https://example.test/dossier/current' })
    expect(rows()[0].dossierRefs).toEqual(['https://example.test/dossier/current'])
    expect(report('md')).toContain('[dossier](https://example.test/dossier/current)')
  })

  it('review #6: matches supplied expectations to one of multiple decisions while guarding conflicts', () => {
    const id = item()
    decision(id); decision(id, 'Isoler les sessions ?')
    set(id, { status: 'decision-awaited', decisionExpectations: expectations })
    expect(rows()[0].expectations).toHaveLength(2)
    expect(rows()[0].issues).not.toContain('decision-expectations-conflict')
    set(id, { status: 'decision-awaited', decisionExpectations: { ...expectations, question: 'Question périmée ?' } })
    expect(rows()[0].issues).toContain('decision-expectations-conflict')
  })

  it('review #6: does not reuse one supplied summary for another incomplete decision', () => {
    const id = item()
    decision(id)
    track.createDecision({ decisionKind: 'commitment', title: 'Autre question ?', workspace: 'ws', targets: [id], dossier: {
      context: 'Une autre décision.', qa: [], options: [{ id: 'a', title: 'A', summary: 'Conséquence A' }, { id: 'b', title: 'B', summary: 'Conséquence B' }],
      recommendation: { optionId: 'a', rationale: 'Choix A' },
    } })
    set(id, { status: 'decision-awaited', decisionExpectations: expectations })
    expect(rows()[0].expectations).toHaveLength(1)
    expect(rows()[0].issues).toContain('missing-decision-expectations')
    expect(rows()[0].issues).not.toContain('decision-expectations-conflict')
  })

  it.each(['progressing', 'decision-awaited'])('review #6: keeps a deferred decision unresolved from %s', status => {
    const id = item()
    const d = decision(id)
    track.setOutcome(d, 'deferred')
    set(id, { status })
    expect(rows()[0].status).toBe('🔵')
    expect(rows()[0].issues).not.toContain('settled-decision-expectations')
    expect(rows()[0].expectations).toHaveLength(1)
    const json = JSON.parse(report())
    expect(json.view.coverage.omitted).toEqual([])
    expect(json.view.tables.find((t: { id: string }) => t.id === 'decisions').rows).toHaveLength(1)
  })

  it.each(['cancelled', 'rejected'])('review #6: records terminal %s requests colourless, never green', realization => {
    // Amendment D9 — a withdrawn request carries no progress colour.
    const id = item()
    if (realization === 'rejected') track.selectDecisionOption(decision(id), 'b', 'no-go')
    else track.setRealization(id, 'cancelled')
    expect(rows()[0]).toMatchObject({ status: '—', statusCode: 'withdrawn', issues: [] })
    expect(rows()[0].action).toContain(realization)
    expect(rows()[0].action).not.toContain('renseigner')
  })

  // Amendment D6 — blue expectations come from an effective native dossier
  // gate, not from a stored declaration alone.
  const blueDossier = (id: string, dossier: string): void => {
    const decisionId = track.createDecision({
      decisionKind: 'commitment', title: 'Partager ?', workspace: 'ws', targets: [id], links: [{ kind: 'dossier', locator: dossier }],
      dossier: {
        context: 'Choix de connexion.', qa: [], readability: { readingBudgetMinutes: 2 },
        options: [{ id: 'a', title: 'Partager', summary: 'Une connexion' }, { id: 'b', title: 'Isoler', summary: 'Deux connexions' }],
        recommendation: { optionId: 'a', rationale: 'Moins de connexions' },
      },
    })
    track.openBlocker({ targetId: id, kind: 'decision', ref: decisionId, reason: 'Choix propriétaire en attente' })
  }

  it('review #7: preserves escaped URL bytes', () => {
    blueDossier(item(), 'https://example.test/my%20doc.md?q=a%2Fb')
    expect(report('md')).toContain('[dossier](https://example.test/my%20doc.md?q=a%2Fb)')
  })

  it('review #7: preserves dossier destinations containing internal IDs without printing IDs as owner text', () => {
    const internal = '01M515ED3S5WVMD3GVQ6E9WM5G'
    const dossier = `https://example.test/dossiers/${internal}.md`
    blueDossier(item(), dossier)
    expect(report('md')).toContain(`[dossier](${dossier})`)
    expect(report('text').split('RÉSOLUTION DES HANDLES')[0]).not.toContain(internal)
    const view = JSON.parse(report()).view
    expect(view.tables.find((t: { id: string }) => t.id === 'requests').links[0].destination).toBe(dossier)
  })

  it.each([' javascript:alert(1)', '\n\tdata:text/html,hello'])('review #7: rejects whitespace-prefixed schemes %s', dossier => {
    blueDossier(item(), dossier)
    expect(report('md')).not.toContain('[dossier](')
  })

  it.each(['md', 'text'])('review #7: protects table cells including dossier references in %s', format => {
    blueDossier(item(), 'https://example.test/doc|extra\nsecond-row')
    const out = report(format)
    const table = out.split('DEMANDES')[1]!.split('DÉCISIONS')[0]!
    expect(table).not.toContain('\nsecond-row')
    const row = table.split('\n').find(l => l.startsWith('| 1 '))!
    expect(row.replace(/\\\|/gu, '').split('|')).toHaveLength(7)
  })

  it.each(['md', 'text', 'json'])('review #7: shares a redacted DEMANDES view in %s', format => {
    const internal = '01M515ED3S5WVMD3GVQ6E9WM5G'
    const id = item(`Retrouver ${internal}`)
    const dep = item(`Prérequis ${internal}`)
    track.openBlocker({ targetId: id, kind: 'dependency', ref: dep, reason: `Attendre ${internal}` })
    set(id, { status: 'blocked', facts: `Échec ${internal}`, proposal: `Corriger ${internal}` })
    const demand = track.raiseDemand({ type: 'feature', workspace: 'ws', raw: { text: `Reprendre ${internal}` }, source: { kind: 'human' }, handler: 'h' })
    track.claimDemand(demand, { handler: 'h' })
    const [quotedItem] = track.agreeDemand(demand, { items: [{ title: 'Titre' }] })
    const quoted: string = quotedItem!
    track.openBlocker({ targetId: quoted, kind: 'dependency', ref: id, reason: `Attendre ${internal}` })
    const json = JSON.parse(report())
    const table = json.view.tables.find((t: { id: string }) => t.id === 'requests')
    expect(table).toBeDefined()
    expect(JSON.stringify(table)).not.toContain(internal)
    if (format !== 'json') {
      const ownerText = report(format).split('RÉSOLUTION DES HANDLES')[0]!
      expect(ownerText).not.toContain(internal)
      expect(ownerText).toContain('référence interne')
    }
  })
})
