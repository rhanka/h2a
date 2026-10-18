// Lot 3 (D4, D13) — rolling periods and handle context.
//
// A handle rendered on a short window with a visible sub-WP resolves to the
// same item under the captured context (period, --sub-wp, scope, baseline,
// journal revision); a different journal revision is refused.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { runCli, type CliIO } from '../cli/index.js'
import { EventStore } from '../events/store.js'
import { Track } from '../track.js'
import { auditStatusProposals, describeStatusProposals } from '../report/audit.js'
import { reportText, resolveHandle, type ReportPeriodSelection } from './commands.js'
import { TrackReader } from './contract.js'

let dir: string
let eventsPath: string
let track: Track

const NOW = '2026-10-18T12:00:00.000Z'
const DAY = '2026-10-17T12:00:00.000Z'
const options = { baselineCommit: 'c1', decisions: true, wpTree: true }

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'track-owner-contract-'))
  eventsPath = join(dir, '.track', 'events.jsonl')
  track = new Track(new EventStore(eventsPath), { by: 'contract', now: () => NOW })
})

afterEach(() => rmSync(dir, { recursive: true, force: true }))

function cli(args: string[]): { code: number; out: string; err: string } {
  const out: string[] = []
  const err: string[] = []
  const io: CliIO = { cwd: dir, out: (value) => out.push(value), err: (value) => err.push(value) }
  const code = runCli(args, io)
  expect(typeof code).toBe('number')
  return { code: code as number, out: out.join(''), err: err.join('') }
}

/** A root WP with a visible sub-WP holding open work, plus old open work. */
function seed(): { leaf: string } {
  const root = track.createItem({ kind: 'chore', title: 'Root WP', workspace: 'ws', role: 'workpackage' })
  const sub = track.createItem({ kind: 'chore', title: 'Sub WP', workspace: 'ws', parentId: root, role: 'workpackage' })
  const leaf = track.createItem({ kind: 'chore', title: 'sub-wp work', workspace: 'ws', parentId: sub })
  track.setRealization(leaf, 'in-progress')
  return { leaf }
}

const lastDay = (): ReportPeriodSelection => ({ requested: 'last-day', from: DAY, to: NOW, fromRef: null, toRef: null })

describe('handle context — period, sub-WP, scope, baseline, revision', () => {
  it('a handle rendered on a short window with a visible sub-WP resolves under the captured context', () => {
    const { leaf } = seed()
    const reader = new TrackReader(eventsPath)
    const parsed = JSON.parse(reportText(reader, options, 'json', NOW, false, undefined, lastDay())) as {
      view: { handles: Array<{ handle: string; id: string }> }
    }
    const handle = parsed.view.handles.find((candidate) => candidate.id === leaf)!.handle
    const revision = reader.reportSnapshot(options).cursor
    const resolved = resolveHandle(reader, options, handle, undefined, false, {
      periodSelection: lastDay(),
      now: NOW,
      subWp: false,
      expectedRevision: { events: revision.count, head: revision.head },
    })
    expect(resolved).toContain(`item\t${leaf}\t`)
  })

  it('a different journal revision is refused', () => {
    const { leaf } = seed()
    const reader = new TrackReader(eventsPath)
    const parsed = JSON.parse(reportText(reader, options, 'json', NOW, false, undefined, lastDay())) as {
      view: { handles: Array<{ handle: string; id: string }> }
    }
    const handle = parsed.view.handles.find((candidate) => candidate.id === leaf)!.handle
    expect(() =>
      resolveHandle(reader, options, handle, undefined, false, {
        periodSelection: lastDay(),
        now: NOW,
        expectedRevision: { events: 0, head: null },
      }),
    ).toThrow(/journal revision/i)
  })

})

describe('rendering cutover — --status-table selects the validated report (D1, D3, D9, D11-D13)', () => {
  const T0 = '2026-10-10T12:00:00.000Z'
  const T1 = '2026-10-17T18:00:00.000Z'
  let instant: string

  const cutoverTrack = (): Track => {
    instant = T0
    return new Track(new EventStore(eventsPath), { by: 'cutover', now: () => instant })
  }

  const at = (value: string, act: () => void): void => {
    instant = value
    act()
  }

  interface CutoverIds {
    open: string
    blockedMember: string
    blueMember: string
    decisionId: string
    gone: string
    oldGone: string
    shipped: string
    demandItems: string[]
    demandId: string
    deferredId: string
  }

  /** Two WPs, delivered and open work, red and blue members, withdrawals, a deployed link, a 1→N demand. */
  function seedCutover(t: Track): CutoverIds {
    const wp1 = t.createItem({ kind: 'chore', title: 'WP1', workspace: 'ws', role: 'workpackage' })
    const wp2 = t.createItem({ kind: 'chore', title: 'WP2', workspace: 'ws', role: 'workpackage' })
    const open = t.createItem({ kind: 'chore', title: 'open work', workspace: 'ws', parentId: wp1 })
    t.setRealization(open, 'in-progress')
    const blockedMember = t.createItem({ kind: 'chore', title: 'blocked work', workspace: 'ws', parentId: wp1 })
    t.setRealization(blockedMember, 'in-progress')
    const dep = t.createItem({ kind: 'chore', title: 'external prerequisite', workspace: 'ws' })
    t.openBlocker({ targetId: blockedMember, kind: 'dependency', ref: dep, reason: 'Waiting on the other lane' })
    t.setReportStatus(blockedMember, { status: 'blocked', facts: 'Blocked by the lane.', proposal: 'Unblock the lane, then replay.' })
    const blueMember = t.createItem({ kind: 'chore', title: 'blue work', workspace: 'ws', parentId: wp1 })
    t.setRealization(blueMember, 'in-progress')
    const decisionId = t.createDecision({
      decisionKind: 'commitment', title: 'Share the connector ?', workspace: 'ws', targets: [blueMember],
      dossier: {
        context: 'The choice changes connection handling.', qa: [], readability: { readingBudgetMinutes: 2 },
        options: [
          { id: 'a', title: 'Share', summary: 'One connection' },
          { id: 'b', title: 'Isolate', summary: 'Two connections' },
        ],
        recommendation: { optionId: 'a', rationale: 'Fewer connections' },
        artifacts: [{ kind: 'rendered-view', viewRef: 'https://example.test/dossier/share' }],
      },
    })
    t.openBlocker({ targetId: blueMember, kind: 'decision', ref: decisionId, reason: 'Owner choice pending' })
    const toDeliver = t.createItem({ kind: 'chore', title: 'shipped feature', workspace: 'ws', parentId: wp2 })
    const shipped = t.createItem({
      kind: 'chore', title: 'deployed member', workspace: 'ws', parentId: wp2,
      links: [{ kind: 'deployed', locator: 'https://example.test/env/prod' }],
    })
    const openDeployed = t.createItem({
      kind: 'chore', title: 'open deployed work', workspace: 'ws', parentId: wp2,
      links: [{ kind: 'deployed', locator: 'https://example.test/env/staging' }],
    })
    t.setRealization(openDeployed, 'in-progress')
    const oldGone = t.createItem({ kind: 'chore', title: 'old withdrawal', workspace: 'ws', parentId: wp1 })
    t.setRealization(oldGone, 'cancelled')
    const demandId = t.raiseDemand({
      type: 'feature', workspace: 'ws', raw: { text: 'Split this in two' }, source: { kind: 'human' }, handler: 'h',
    })
    t.claimDemand(demandId, { handler: 'h' })
    const demandItems = t.agreeDemand(demandId, { items: [{ title: 'first half' }, { title: 'second half' }] })
    const deferredId = t.createDecision({
      decisionKind: 'orientation', title: 'Later question ?', workspace: 'ws', targets: [open],
      dossier: {
        context: 'Not now.', qa: [], readability: { readingBudgetMinutes: 2 },
        options: [
          { id: 'a', title: 'Now', summary: 'Decide now' },
          { id: 'b', title: 'Later', summary: 'Decide later' },
        ],
        recommendation: { optionId: 'b', rationale: 'Later is cheaper' },
      },
    })
    t.setOutcome(deferredId, 'deferred')
    at(T1, () => {
      t.setRealization(toDeliver, 'in-progress')
      t.setRealization(toDeliver, 'done')
      t.setRealization(shipped, 'in-progress')
      t.setRealization(shipped, 'done')
      const gone = t.createItem({ kind: 'chore', title: 'fresh withdrawal', workspace: 'ws', parentId: wp1 })
      t.setRealization(gone, 'in-progress')
      t.setRealization(gone, 'cancelled')
    })
    const gone = [...t.state().items.values()].find((item) => item.title === 'fresh withdrawal')!.id
    return { open, blockedMember, blueMember, decisionId, gone, oldGone, shipped, demandItems, demandId, deferredId }
  }

  const statusJson = (extra: string[]): { code: number; parsed: any; out: string } => {
    const result = cli(['report', '--status-table', '--commit', 'c1', '--now', NOW, '--format', 'json', ...extra])
    return { code: result.code, parsed: JSON.parse(result.out), out: result.out }
  }

  it('serves exactly four sections with both recommendation paths and exactly one reply line', () => {
    const t = cutoverTrack()
    seedCutover(t)
    const { code, parsed } = statusJson([])
    expect(code).toBe(0)
    expect(parsed.view.tables.map((table: { id: string }) => table.id)).toEqual([
      'done', 'todo', 'decisions', 'recommendation',
    ])
    const recommendation = parsed.view.tables.find((table: { id: string }) => table.id === 'recommendation')! as {
      lines: string[]
    }
    expect(recommendation.lines.some((line: string) => line.startsWith('Sans décision :'))).toBe(true)
    expect(recommendation.lines.some((line: string) => /^D\d/.test(line))).toBe(true)
    expect(recommendation.lines.filter((line: string) => line.startsWith('Réponds')).length).toBe(1)
  })

  it('an explicit identical period makes --status-table and the validated route byte-identical', () => {
    const t = cutoverTrack()
    seedCutover(t)
    const viaStatusTable = cli([
      'report', '--status-table', '--commit', 'c1', '--now', NOW, '--period', 'last-day', '--format', 'json',
    ])
    const viaValidated = cli([
      'report', '--wp', '--decisions', '--commit', 'c1', '--now', NOW, '--period', 'last-day', '--format', 'json',
    ])
    expect(viaStatusTable.code).toBe(0)
    expect(viaValidated.code, viaValidated.err).toBe(0)
    expect(viaStatusTable.out).toBe(viaValidated.out)
  })

  it('D9 — an in-window withdrawal is an identifiable notice; an older gateless one is omitted, never delivered', () => {
    const t = cutoverTrack()
    const ids = seedCutover(t)
    const { code, parsed } = statusJson(['--period', 'last-day'])
    expect(code).toBe(0)
    const todoText = JSON.stringify(parsed.view.tables.find((table: { id: string }) => table.id === 'todo'))
    // Identifiable: the notice carries a handle resolving to the withdrawn item (ULIDs never print in columns).
    const handles = parsed.view.handles as Array<{ handle: string; id: string; kind: string }>
    const notice = handles.find((handle) => handle.kind === 'item' && handle.id === ids.gone)!
    expect(notice.handle).toMatch(/^\d+\.\d+$/u)
    expect(todoText).toContain('fresh withdrawal')
    expect(todoText).toContain('retir')
    expect(handles.some((handle) => handle.id === ids.oldGone)).toBe(false)
    const doneText = JSON.stringify(parsed.view.tables.find((table: { id: string }) => table.id === 'done'))
    expect(doneText).not.toContain('fresh withdrawal')
    expect(doneText).not.toContain('old withdrawal')
    const omitted = parsed.view.coverage.omitted as Array<{ label: string }>
    expect(omitted.some((entry) => entry.label.includes('old withdrawal'))).toBe(true)
  })

  it('D11 — strict-WP ancestry: phase-only, stream-only and parentless flag outside-wp; nested-under-WP does not', () => {
    const t = cutoverTrack()
    const phase = t.createItem({ kind: 'chore', title: 'Lone phase', workspace: 'ws', role: 'spec-phase' })
    const phaseLeaf = t.createItem({ kind: 'chore', title: 'phase-only work', workspace: 'ws', parentId: phase })
    void phaseLeaf
    const stream = t.createItem({ kind: 'chore', title: 'Lone stream', workspace: 'ws', role: 'stream' })
    t.createItem({ kind: 'chore', title: 'stream-only work', workspace: 'ws', parentId: stream })
    t.createItem({ kind: 'chore', title: 'parentless work', workspace: 'ws' })
    const wp = t.createItem({ kind: 'chore', title: 'Real WP', workspace: 'ws', role: 'workpackage' })
    const nestedPhase = t.createItem({ kind: 'chore', title: 'Nested phase', workspace: 'ws', parentId: wp, role: 'spec-phase' })
    t.createItem({ kind: 'chore', title: 'nested work', workspace: 'ws', parentId: nestedPhase })
    const { code, parsed } = statusJson([])
    expect(code).toBe(0)
    const todoText = JSON.stringify(parsed.view.tables.find((table: { id: string }) => table.id === 'todo'))
    for (const title of ['phase-only work', 'stream-only work', 'parentless work']) {
      expect(todoText).toContain(title)
    }
    expect(todoText.match(/outside-wp/gu)!.length).toBeGreaterThanOrEqual(3)
    const nestedLine = parsed.view.tables
      .find((table: { id: string }) => table.id === 'todo')!
      .rows.flatMap((row: { todo: string }) => row.todo.split('\n'))
      .find((line: string) => line.includes('nested work'))!
    expect(nestedLine).not.toContain('outside-wp')
  })

  it('D11 — one demand promoted into two items preserves one source and two identifiable contributions', () => {
    const t = cutoverTrack()
    const ids = seedCutover(t)
    const { code, parsed } = statusJson([])
    expect(code).toBe(0)
    const rows = parsed.buckets['TO-DO'] as Array<{ id: string; demandId?: string }>
    const halves = rows.filter((row) => ids.demandItems.includes(row.id))
    expect(halves).toHaveLength(2)
    expect(new Set(halves.map((row) => row.demandId))).toEqual(new Set([ids.demandId]))
    const handles = parsed.view.handles as Array<{ id: string }>
    expect(handles.filter((handle) => ids.demandItems.includes(handle.id))).toHaveLength(2)
  })

  it('a WP with red and blue members keeps both visible; one deployed member does not make the WP deployed', () => {
    const t = cutoverTrack()
    const ids = seedCutover(t)
    const { code, parsed } = statusJson([])
    expect(code).toBe(0)
    const todoRows = parsed.view.tables.find((table: { id: string }) => table.id === 'todo')!.rows as Array<{
      todo: string
      stage: string
      status: string
    }>
    const wp1Row = todoRows.find((row) => row.todo.includes('blocked work'))!
    expect(wp1Row.todo).toContain('blue work')
    expect(wp1Row.status).toContain('🔴')
    expect(wp1Row.status).toContain('🔵')
    const wp2Row = todoRows.find((row) => row.todo.includes('open deployed work'))!
    expect(wp2Row.stage).toContain('deployed')
    // Per-item annotation only: FAIT carries no stage/status columns and no
    // WP-level stage exists anywhere in the served tables.
    const fait = parsed.view.tables.find((table: { id: string }) => table.id === 'done')! as {
      columns: Array<{ id: string }>
      rows: Array<Record<string, string>>
    }
    expect(fait.columns.map((column) => column.id)).toEqual(['scope', 'progress', 'lastActions'])
    expect(JSON.stringify(fait.rows)).not.toContain('[1.1] deployed')
  })

  it('D12 — a deferred dossier stays answerable instead of vanishing as settled', () => {
    const t = cutoverTrack()
    const ids = seedCutover(t)
    const { code, parsed } = statusJson([])
    expect(code).toBe(0)
    const decisions = parsed.view.tables.find((table: { id: string }) => table.id === 'decisions')!
    expect(JSON.stringify(decisions)).toContain('Later question ?')
    expect(parsed.view.handles.some((handle: { id: string }) => handle.id === ids.deferredId)).toBe(true)
  })

  it('membership — removing the two new columns recovers validated open work plus the explicit D9 addition', () => {
    const t = cutoverTrack()
    seedCutover(t)
    const { code, parsed } = statusJson(['--period', 'last-day'])
    expect(code).toBe(0)
    const todoIds = new Set(
      (parsed.view.handles as Array<{ handle: string; id: string; kind: string }>)
        .filter((handle) => handle.kind === 'item' && /^\d+\.\d+$/u.test(handle.handle))
        .map((handle) => handle.id),
    )
    const state = t.state()
    const openIds = new Set(
      [...state.items.values()]
        .filter((item) => item.role === undefined && (item.realization === 'to-do' || item.realization === 'in-progress'))
        .map((item) => item.id),
    )
    // Every open item is reachable; the only reachable non-open item is the D9 notice.
    for (const id of openIds) expect(todoIds.has(id)).toBe(true)
    const extra = [...todoIds].filter((id) => !openIds.has(id))
    expect(extra).toHaveLength(1)
  })

  it('redacts internal IDs from owner columns while the dossier stays answerable', () => {
    // Migrated link-safety essence (the withdrawn view's redaction block):
    // owner text never prints an internal ID; the resolution block maps the
    // real ids by design, and the dossier keeps its D-number and handle.
    const t = cutoverTrack()
    const internal = '01M515ED3S5WVMD3GVQ6E9WM5G'
    const wp = t.createItem({ kind: 'chore', title: 'WP', workspace: 'ws', role: 'workpackage' })
    const blue = t.createItem({ kind: 'chore', title: `Retrouver ${internal}`, workspace: 'ws', parentId: wp })
    const decisionId = t.createDecision({
      decisionKind: 'commitment', title: 'Share ?', workspace: 'ws', targets: [blue],
      dossier: {
        context: 'Connection choice.', qa: [], readability: { readingBudgetMinutes: 2 },
        options: [
          { id: 'a', title: 'Share', summary: 'One connection' },
          { id: 'b', title: 'Isolate', summary: 'Two connections' },
        ],
        recommendation: { optionId: 'a', rationale: 'Fewer connections' },
      },
    })
    t.openBlocker({ targetId: blue, kind: 'decision', ref: decisionId, reason: `Attendre ${internal}` })
    const text = cli(['report', '--status-table', '--commit', 'c1', '--now', NOW, '--format', 'text']).out
    const ownerText = text.split('RÉSOLUTION DES HANDLES')[0]!
    expect(ownerText).not.toContain(internal)
    expect(ownerText).toContain('référence interne')
    const json = JSON.parse(
      cli(['report', '--status-table', '--commit', 'c1', '--now', NOW, '--format', 'json']).out,
    ) as { view: { handles: Array<{ handle: string; id: string }>; tables: Array<{ id: string }> } }
    expect(json.view.handles.some((handle) => handle.id === decisionId)).toBe(true)
    expect(json.view.handles.some((handle) => handle.id === blue)).toBe(true)
    expect(text).toContain(decisionId)
  })

  it('the served report passes the red-proposal audit when red carries a proposal and blue matches', () => {
    const t = cutoverTrack()
    seedCutover(t)
    const reader = new TrackReader(eventsPath)
    const snapshot = reader.reportSnapshot({ baselineCommit: 'c1', decisions: true, wpTree: true })
    const view = JSON.parse(
      cli(['report', '--status-table', '--commit', 'c1', '--now', NOW, '--format', 'json']).out,
    ).view
    const described = describeStatusProposals(t.state(), snapshot.report, view)
    expect(auditStatusProposals(described.rows, described.decisionRefs)).toEqual({
      missingProposals: [],
      orphanBlue: [],
      ok: true,
    })
  })

  it('a red row without a recorded proposal fails the served audit', () => {
    const t = cutoverTrack()
    const wp = t.createItem({ kind: 'chore', title: 'WP', workspace: 'ws', role: 'workpackage' })
    const red = t.createItem({ kind: 'chore', title: 'red without proposal', workspace: 'ws', parentId: wp })
    t.setRealization(red, 'in-progress')
    const dep = t.createItem({ kind: 'chore', title: 'prerequisite', workspace: 'ws' })
    t.openBlocker({ targetId: red, kind: 'dependency', ref: dep, reason: 'Waiting' })
    const reader = new TrackReader(eventsPath)
    const snapshot = reader.reportSnapshot({ baselineCommit: 'c1', decisions: true, wpTree: true })
    const view = JSON.parse(
      cli(['report', '--status-table', '--commit', 'c1', '--now', NOW, '--format', 'json']).out,
    ).view
    const described = describeStatusProposals(t.state(), snapshot.report, view)
    const audit = auditStatusProposals(described.rows, described.decisionRefs)
    expect(audit.missingProposals).toEqual([red])
    expect(audit.ok).toBe(false)
  })

  it('[n.m] handles rendered on the served report resolve under the captured context', () => {
    const t = cutoverTrack()
    const ids = seedCutover(t)
    const { code, parsed } = statusJson(['--period', 'last-day'])
    expect(code).toBe(0)
    const target = (parsed.view.handles as Array<{ handle: string; id: string }>).find(
      (handle) => handle.id === ids.blueMember,
    )!
    expect(target.handle).toMatch(/^\d+\.\d+$/u)
    const resolved = resolveHandle(
      new TrackReader(eventsPath), options, target.handle, undefined, false,
      {
        periodSelection: { requested: 'last-day', from: DAY, to: NOW, fromRef: null, toRef: null },
        now: NOW,
        expectedRevision: (() => {
          const cursor = new TrackReader(eventsPath).reportSnapshot(options).cursor
          return { events: cursor.count, head: cursor.head }
        })(),
      },
    )
    expect(resolved).toContain(`item\t${ids.blueMember}\t`)
  })

  it('the CLI resolve path rebinds the same context and refuses a stale revision', () => {
    seed()
    const rendered = cli(['report', '--wp', '--period', 'last-day', '--now', NOW, '--format', 'json'])
    expect(rendered.code).toBe(0)
    const view = (JSON.parse(rendered.out) as {
      view: { handles: Array<{ handle: string; id: string }> }
    }).view
    const target = view.handles[0]!
    const revision = JSON.parse(rendered.out) as {
      view: { header: { journalRevision: { events: number; head: string | null } } }
    }
    const cursor = revision.view.header.journalRevision
    const ok = cli([
      'report', '--resolve', target.handle, '--period', 'last-day', '--now', NOW,
      '--expect-events', String(cursor.events), '--commit', 'c1',
    ])
    expect(ok.code, ok.err).toBe(0)
    expect(ok.out).toContain(target.id)
    const stale = cli([
      'report', '--resolve', target.handle, '--period', 'last-day', '--now', NOW,
      '--expect-events', '0', '--commit', 'c1',
    ])
    expect(stale.code).toBe(1)
    expect(stale.err).toMatch(/journal revision/i)
  })
})
