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
    expect(set(id, { status: 'blocked', facts: 'La recette échoue.' }).code).toBe(0)
    expect(rows()[0]).toMatchObject({ id, status: '🔴', issues: ['missing-proposal'] })
    expect(report('md')).toContain('NON CONFORME : proposition obligatoire')
    expect(set(id, { status: 'blocked', proposal: 'Corriger la résolution puis rejouer la recette.' }).code).toBe(0)
    expect(rows()[0].issues).not.toContain('missing-proposal')
    expect(report('text')).toContain('Proposition : Corriger la résolution')
  })

  it.each(['0.98.7', 'v0.98.7', 'Release 0.98.7', 'Version 0.98.7 (PR #42)', 'PR #42'])('flags the version/reference-only subject %s', title => {
    const id = item(title)
    expect(rows()[0].issues).toContain('version-only-subject')
    expect(report('md')).toContain('NON CONFORME : finalité propriétaire manquante')
    set(id, { ownerRequest: 'Je veux retrouver mes agents (PR #42)', status: 'progressing' })
    expect(rows()[0].issues).not.toContain('version-only-subject')
  })

  it('persists an additive event, replays after restart, and replaces stale report fields', () => {
    const id = item()
    const prefix = readFileSync(join(dir, 'events.jsonl'), 'utf8')
    expect(set(id, { stage: { value: 'PR', evidence: 'https://github.com/rhanka/h2a/pull/42' }, status: 'blocked', proposal: 'Rejouer CI' }).code).toBe(0)
    expect(store.readAll().at(-1)?.type).toBe('item.report-updated')
    expect(readFileSync(join(dir, 'events.jsonl'), 'utf8').startsWith(prefix)).toBe(true)
    expect(new Track(store).state().items.get(id)).toHaveProperty('report.status', 'blocked')
    set(id, { status: 'progressing', stage: { value: 'dev' } })
    expect(new Track(store).state().items.get(id)).not.toHaveProperty('report.proposal')
    expect(rows()[0]).toMatchObject({ stage: 'dev', status: '🟢' })
  })

  it('keeps historical items readable without asserting conformity or merge from done', () => {
    const id = item()
    track.setRealization(id, 'in-progress')
    track.setRealization(id, 'done')
    expect(new Track(store).state().items.get(id)).not.toHaveProperty('report')
    expect(rows()[0]).toMatchObject({ stage: 'dev', status: '🟠' })
    expect(report('text')).toContain('statut de conformité non renseigné')
    expect(rows()[0].action).toContain('Ensuite :')
  })

  it.each([
    ['pr', 'spec'], ['pr-open', 'PR'], ['pr-merged', 'mergé'],
    ['release', 'spec'], ['release-published', 'spec'], ['deployed', 'déployé'],
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
    const id = item()
    set(id, { status: 'decision-awaited' })
    expect(rows()[0].issues).toContain('missing-decision-expectations')
    const decisionExpectations = {
      question: 'Faut-il partager le MCP ?',
      options: [{ label: 'A : partager', consequence: 'Une connexion commune.' }, { label: 'B : isoler', consequence: 'Une connexion par session.' }],
      dossier: 'https://example.test/dossier/42', readingMinutes: 2,
    }
    expect(set(id, { status: 'decision-awaited', decisionExpectations }).code).toBe(0)
    const out = report('md')
    for (const value of ['Faut-il partager le MCP', 'Une connexion commune.', 'Une connexion par session.', '[dossier](https://example.test/dossier/42)', 'ton GO', 'DÉCISIONS']) expect(out.replace(/\\-/gu, '-')).toContain(value)
    expect(rows()[0].issues).toEqual([])
    expect(set(id, { status: 'decision-awaited', decisionExpectations: { ...decisionExpectations, readingMinutes: 3 } }).code).not.toBe(0)
  })

  it('keeps actual pending decision dossiers and flags missing presentation rather than inventing it', () => {
    const id = item()
    track.createDecision({ decisionKind: 'commitment', title: 'Partager le MCP ?', workspace: 'ws', targets: [id], dossier: { context: 'Le choix change les connexions.', qa: [], options: [{ id: 'a', title: 'Partager', summary: 'Une connexion' }, { id: 'b', title: 'Isoler', summary: 'Plusieurs connexions' }], recommendation: { optionId: 'a', rationale: 'Moins de connexions' } } })
    expect(rows()[0].status).toBe('🔵')
    expect(rows()[0].issues).toContain('missing-decision-expectations')
    const out = report('text')
    for (const text of ['DÉCISIONS', 'Partager', 'Isoler', 'Une connexion', 'Plusieurs connexions', 'Réponds']) expect(out).toContain(text)
  })

  it('orders urgent first and describes lane waits and suspension in the action column', () => {
    set(item('Travail normal'), { status: 'progressing' })
    set(item('Choix propriétaire'), { status: 'decision-awaited' })
    set(item('Incident bloquant'), { status: 'blocked', proposal: 'Corriger', waitingOn: 'lane tests', suspended: 'attente de capacité' })
    set(item('Imprévu'), { status: 'unforeseen' })
    expect(rows().map((r: { status: string }) => r.status)).toEqual(['🔴', '🔵', '🟠', '🟢'])
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

  it('uses recorded owner quotes and flags old merge evidence after reopening', () => {
    const id = item('Titre technique', { body: 'Phrase owner : « Je veux reprendre ma session »', links: [{ kind: 'pr-merged', locator: 'https://example.test/pr/1' }] })
    track.setRealization(id, 'in-progress')
    track.setRealization(id, 'done')
    expect(rows()[0]).toMatchObject({ request: ' Je veux reprendre ma session ', requestSource: 'owner-quote', stage: 'mergé' })
    track.reopenItem(id, { motive: 'regression-observed', reason: 'La reprise échoue de nouveau' })
    expect(rows()[0].stage).toBe('dev')
    expect(rows()[0].issues).toContain('stage-predates-reopening')
  })

  it('derives complete expectations from the native dossier and keeps a separate block red', () => {
    const id = item()
    track.createDecision({ decisionKind: 'commitment', title: 'Partager ?', workspace: 'ws', targets: [id], dossier: {
      context: 'Choix de connexion.', qa: [], readability: { readingBudgetMinutes: 2 },
      options: [{ id: 'a', title: 'Partager', summary: 'Une connexion' }, { id: 'b', title: 'Isoler', summary: 'Deux connexions' }],
      recommendation: { optionId: 'a', rationale: 'Moins de connexions' }, artifacts: [{ kind: 'rendered-view', viewRef: 'https://example.test/dossier/native' }],
    } })
    expect(rows()[0]).toMatchObject({ status: '🔵', issues: [], dossierRefs: ['https://example.test/dossier/native'] })
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
