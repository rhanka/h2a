import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runCli } from '../cli/index.js'
import { EventStore } from '../events/store.js'
import { Track } from '../track.js'
import { auditStatusProposals, describeStatusProposals } from '../report/audit.js'
import { auditNextActions, describeRowNextActions } from '../report/format.js'
import { deriveItemStageStatus } from '../report/stage-status.js'
import { reportText } from './commands.js'
import { TrackReader } from './contract.js'

let dir: string
let store: EventStore
let track: Track
let instant: string
const NOW = '2026-10-18T12:00:00.000Z'
const options = { baselineCommit: 'c1', decisions: true, wpTree: true }
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'track-rev374-'))
  store = new EventStore(join(dir, 'events.jsonl'))
  instant = '2026-10-01T12:00:00.000Z'
  track = new Track(store, { by: 'review-fixture', now: () => instant })
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))
const wp = () => track.createItem({ kind: 'chore', title: 'WP', workspace: 'ws', role: 'workpackage' })
const item = (parentId?: string) => track.createItem({ kind: 'feature', title: 'technical implementation', workspace: 'ws', ...(parentId === undefined ? {} : { parentId }) })
function cli(args: string[]) {
  let out = ''; let err = ''
  const code = runCli(['--track-dir', dir, ...args], { cwd: dir, out: s => { out += s }, err: s => { err += s } })
  return { code, out, err }
}
function served(extra: string[] = []) {
  const result = cli(['report', '--status-table', '--commit', 'c1', '--now', NOW, '--period', 'all', '--format', 'json', ...extra])
  expect(result.code, result.err).toBe(0)
  return JSON.parse(result.out)
}
const todo = (view: any) => view.tables.find((t: any) => t.id === 'todo')
function resolvePrinted(view: any, id: string) {
  const handle = view.handles.find((h: any) => h.id === id).handle
  // Every fixture argument is a safe bare token; execute the actual printed command.
  return () => cli(view.header.handleCommand.replace('<handle>', handle).split(' ').slice(1))
}
function decision(target: string) {
  return track.createDecision({ decisionKind: 'orientation', title: 'Keep scope?', workspace: 'ws', targets: [target], dossier: {
    context: 'Scope choice', qa: [], options: [
      { id: 'keep', title: 'Keep', summary: 'Conservar el alcance' },
      { id: 'cut', title: 'Cut', summary: 'Retirar el duplicado' },
    ], recommendation: { optionId: 'keep', rationale: 'Keep is recommended' },
  } })
}

describe('PR 374 correction regressions', () => {
  it('R1 refuses the printed command after the journal moves', () => {
    const id = item(wp())
    const view = served().view
    const replay = resolvePrinted(view, id)
    expect(replay().out).toContain(id)
    item(wp())
    const stale = replay()
    expect(stale.code).toBe(1)
    expect(stale.err).toContain('journal revision changed')
  })

  it('R1 keeps the captured clock and full baseline in the printed command', () => {
    instant = '2026-08-10T18:00:00.000Z'
    const id = item(wp())
    track.setRealization(id, 'in-progress')
    const result = cli(['report', '--status-table', '--commit', '0123456789abcdef0123456789abcdef01234567', '--now', instant, '--period', 'last-day', '--format', 'json'])
    const view = JSON.parse(result.out).view
    expect(view.header.handleCommand).toContain(`--now ${instant}`)
    expect(view.header.handleCommand).toContain('--commit 0123456789abcdef0123456789abcdef01234567')
    expect(view.header.handleCommand).toContain('--expect-head ')
    expect(resolvePrinted(view, id)().out).toContain(id)
  })

  it.each(['since', 'until'] as const)('R1 keeps the printed --%s commit bound when HEAD moves', bound => {
    const git = (args: string[], at = instant) => execFileSync('git', [
      '-c', `core.hooksPath=${join(dir, 'hooks')}`, '-c', 'commit.gpgsign=false', ...args,
    ], {
      cwd: dir, encoding: 'utf8',
      env: { ...process.env, GIT_AUTHOR_DATE: at, GIT_COMMITTER_DATE: at },
    }).trim()
    git(['init', '-q'])
    git(['config', 'user.name', 'Report regression'])
    git(['config', 'user.email', 'report@example.test'])
    git(['commit', '--allow-empty', '-q', '-m', 'initial boundary'],
      bound === 'since' ? instant : '2026-10-16T12:00:00.000Z')
    const ref = git(['rev-parse', 'HEAD'])
    const parent = wp()
    const first = item(parent)
    const second = item(parent)
    const [a, b] = bound === 'since' ? [first, second] : [second, first]
    instant = '2026-10-10T12:00:00.000Z'
    track.setRealization(a, 'cancelled')
    instant = NOW
    track.setRealization(b, 'cancelled')
    const selector = bound === 'since' ? ['--since', 'HEAD'] : ['--since', '2026-10-01', '--until', 'HEAD']
    const result = cli(['report', '--status-table', '--commit', 'c1', '--now', NOW, '--format', 'json', ...selector])
    expect(result.code, result.err).toBe(0)
    const { view, period } = JSON.parse(result.out)
    expect(period[bound === 'since' ? 'fromRef' : 'toRef']).toBe(ref)
    expect(view.handles.find((h: any) => h.id === a).handle).toBe('1.1')
    const replay = resolvePrinted(view, a)
    const original = replay()
    expect(original.code, original.err).toBe(0)
    expect(original.out).toContain(a)

    // Only git moves: the report clock, baseline and journal revision stay fixed.
    git(['commit', '--allow-empty', '-q', '-m', 'move boundary'],
      bound === 'since' ? '2026-10-16T12:00:00.000Z' : '2026-10-20T12:00:00.000Z')
    const moved = replay()
    expect(moved.code, moved.err).toBe(0)
    expect(moved.out).toBe(original.out)
    expect(view.header.handleCommand).toContain(`--${bound} ${ref}`)
  })

  it.each(['non instruite', 'no instruida', '未指示', 'غير موجّهة'])('R2 preserves machine instruction metadata for %s', nextAction => {
    const rows = [{ focus: 'false', instruction: 'not-instructed', nextAction }]
    expect(auditNextActions(describeRowNextActions(rows)).uninstructed).toBe(0)
    const instructed = [{ focus: 'true', instruction: 'investigated', actionOrigin: 'investigated', nextAction: 'Abrir commands.ts y comprobar el límite' }]
    expect(auditNextActions(describeRowNextActions(instructed))).toMatchObject({ uninstructed: 0, ok: true })
  })

  it('R2 tags renderer rows and never certifies a text-only marker', () => {
    item(wp())
    const rows = todo(served().view).rows
    expect(rows[0].instruction).toBe('to-instruct')
    const textOnly = [{ focus: 'false', nextAction: 'non instruite' }]
    expect(auditNextActions(describeRowNextActions(textOnly)).uninstructed).toBe(1)
  })

  it.each(['absent', 'to-instruct', 'reopened'])('R3 rejects a %s proposal on the served surface', mode => {
    const id = item(wp())
    track.setRealization(id, 'in-progress')
    track.setReportStatus(id, { proposal: 'Investigar la propuesta pendiente' })
    if (mode === 'reopened') {
      track.setRealization(id, 'done')
      track.reopenItem(id, { motive: 'regression-observed', reason: 'New regression' })
    }
    track.openBlocker({ targetId: id, kind: 'dependency', ref: item(), reason: 'New gate' })
    const view = served().view
    if (mode === 'to-instruct') view.proposals = [{ itemId: id, proposal: 'Investigar la propuesta pendiente', proposalState: 'to-instruct' }]
    const described = describeStatusProposals(track.state(), new TrackReader(join(dir, 'events.jsonl')).reportSnapshot(options).report, view)
    expect(auditStatusProposals(described.rows, described.decisionRefs)).toMatchObject({ ok: false, missingProposals: [id] })
  })

  it.each(['both', 'action-only', 'recommendation-only', 'uninvestigated', 'duplicate'])('R3 audits the investigated served proposal in both sections: %s', placement => {
    const id = item(wp())
    track.openBlocker({ targetId: id, kind: 'dependency', ref: item(), reason: 'Waiting' })
    const parsed = served()
    const view = parsed.view
    const proposal = 'Comprobar la dependencia con una ejecución aislada'
    const row = todo(view).rows.find((r: any) => r.todo.includes('technical implementation'))
    Object.assign(row, { instruction: 'investigated', actionOrigin: 'investigated' })
    if (placement !== 'recommendation-only') row.nextAction = proposal
    if (placement !== 'action-only') view.tables.find((t: any) => t.id === 'recommendation').lines.push(proposal)
    view.proposals = [{ itemId: id, proposal, proposalState: placement === 'uninvestigated' ? 'to-instruct' : 'investigated' }]
    if (placement === 'duplicate') view.proposals.push(view.proposals[0])
    const described = describeStatusProposals(track.state(), new TrackReader(join(dir, 'events.jsonl')).reportSnapshot(options).report, view)
    expect(auditStatusProposals(described.rows, described.decisionRefs).ok).toBe(placement === 'both')
  })

  it.each([undefined, '2026-10-25T12:00:00.000Z'])('R4 uses the explicit until even with now=%s', now => {
    const id = item(wp())
    instant = '2026-10-20T12:00:00.000Z'
    track.setRealization(id, 'cancelled')
    const parsed = JSON.parse(reportText(new TrackReader(join(dir, 'events.jsonl')), options, 'json', now, false, undefined, {
      requested: '2026-10-10..2026-10-15', from: '2026-10-10T00:00:00.000Z', to: '2026-10-15T23:59:59.999Z', fromRef: null, toRef: null,
    }))
    expect(parsed.period.eventsInWindow).toBe(0)
    expect(parsed.view.handles.some((h: any) => h.id === id)).toBe(false)
  })

  it('R5 derives withdrawal reason from the selected option', () => {
    const id = item(wp())
    track.selectDecisionOption(decision(id), 'cut', 'go')
    track.setRealization(id, 'cancelled')
    const parsed = served()
    expect(parsed.withdrawals.find((w: any) => w.id === id).reason).toBe('Retirar el duplicado')
  })

  it.each([true, false])('R6 retains withdrawal reason or declared absence with a live gate (reason=%s)', hasReason => {
    const id = item(wp())
    if (hasReason) track.selectDecisionOption(decision(id), 'cut', 'go')
    track.setRealization(id, 'cancelled')
    track.openBlocker({ targetId: id, kind: 'dependency', ref: item(), reason: 'Still waiting' })
    const parsed = served()
    const cell = todo(parsed.view).rows.find((r: any) => r.todo.includes('technical implementation')).todo
    expect(cell).toContain(hasReason ? 'Retirar el duplicado' : 'motif non enregistré')
    expect(parsed.view.handles.filter((h: any) => h.id === id)).toHaveLength(1)
  })

  it('R6 preserves the reason on every visible parent/sub-WP projection of a gated withdrawal', () => {
    const sub = track.createItem({ kind: 'chore', title: 'Sub WP', workspace: 'ws', role: 'workpackage', parentId: wp() })
    const id = item(sub)
    track.selectDecisionOption(decision(id), 'cut', 'go')
    track.setRealization(id, 'cancelled')
    track.openBlocker({ targetId: id, kind: 'dependency', ref: item(), reason: 'Still waiting' })
    const parsed = served()
    const handles = parsed.view.handles.filter((h: any) => h.id === id)
    expect(handles).toHaveLength(2)
    for (const handle of handles) {
      expect(todo(parsed.view).rows[Number(handle.handle.split('.')[0]) - 1].todo).toContain('Retirar el duplicado')
    }
  })

  it.each(['json', 'text', 'md'])('R7 keeps four sections and outside-wp without any WP in %s', format => {
    item()
    const result = cli(['report', '--status-table', '--commit', 'c1', '--now', NOW, '--format', format])
    expect(result.code, result.err).toBe(0)
    if (format === 'json') {
      const view = JSON.parse(result.out).view
      expect(view?.tables.map((t: any) => t.id)).toEqual(['done', 'todo', 'decisions', 'recommendation'])
      expect(todo(view).columns.map((c: any) => c.id)).toEqual(['wp', 'progress', 'stage', 'status', 'todo', 'blocked', 'nextAction'])
    } else {
      for (const name of ['FAIT', 'À-FAIRE', 'DÉCISIONS', 'RECOMMANDATION', 'outside-wp']) expect(result.out).toContain(name)
    }
  })

  it('R7 serves parentless items through the library status-table selector with default options', () => {
    const id = item()
    const parsed = JSON.parse(reportText(new TrackReader(join(dir, 'events.jsonl')), { baselineCommit: 'c1' }, 'json', NOW, false, undefined, undefined, true))
    expect(parsed.view.handles.some((h: any) => h.id === id)).toBe(true)
  })

  it('R8 requires every acceptance run to follow reopening in journal order at equal timestamps', () => {
    const id = item()
    track.setRealization(id, 'in-progress')
    const e1 = track.linkEvidence(track.addCriterion(id, 'first'), 'unit', 'first')
    const e2 = track.linkEvidence(track.addCriterion(id, 'second'), 'unit', 'second')
    const run = (e: string) => track.recordRun(e, { commit: 'c1', env: 'test', runner: 'regression', result: 'pass' })
    run(e1); run(e2)
    track.setRealization(id, 'done')
    track.reopenItem(id, { motive: 'regression-observed', reason: 'Regression' })
    const derive = () => deriveItemStageStatus(track.state(), store.readAll(), track.state().items.get(id)!, 'c1')
    expect(derive()).toMatchObject({ qualified: false, status: 'unforeseen' })
    run(e1)
    expect(derive().qualified).toBe(false)
    run(e2)
    expect(derive()).toMatchObject({ qualified: true, status: 'progressing' })
  })

  it.each(['Quiero reanudar mi sesión', 'セッションを再開したい', 'أريد استئناف جلستي'])('R9 carries immutable demand source and legacy provenance: %s', text => {
    wp()
    const demand = track.raiseDemand({ type: 'feature', workspace: 'ws', raw: { text }, source: { kind: 'human' }, handler: 'h' })
    track.claimDemand(demand, { handler: 'h' })
    const ids = track.agreeDemand(demand, { items: [{ title: 'technical implementation' }, { title: 'another contribution' }] })
    const legacy = item()
    const parsed = served()
    const rows = Object.values(parsed.buckets).flat() as any[]
    for (const id of ids) expect(rows.find(r => r.id === id).requestSource).toEqual({ provenance: 'demand-raw', demandId: demand, text })
    expect(rows.find(r => r.id === legacy).requestSource).toEqual({ provenance: 'legacy-title', text: 'technical implementation' })
    expect(JSON.stringify(todo(parsed.view))).toContain(text)
  })
})
