import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { runCli } from '../cli/index.js'
import { EventStore } from '../events/store.js'
import { buildWpConductorView } from '../report/format.js'
import { Track } from '../track.js'
import { TrackReader } from './contract.js'
import { projectReportScope, reportText } from './commands.js'

let dir: string
let eventsPath: string
let track: Track

const now = (): string => '2026-07-29T00:00:00.000Z'
const options = { baselineCommit: 'c1', decisions: true, wpTree: true }
const NOW = '2026-07-30T00:00:00.000Z'

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'track-report-scope-'))
  eventsPath = join(dir, '.track', 'events.jsonl')
  track = new Track(new EventStore(eventsPath), { by: 'human:x', now })
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

function done(id: string): void {
  track.setRealization(id, 'in-progress')
  track.setRealization(id, 'done')
}

function seed(): { root: string; nestedLeaf: string; engagementLeaf: string; outsideLeaf: string } {
  const root = track.createItem({ kind: 'chore', title: 'Tracking', workspace: 'ws', role: 'workpackage' })
  track.assignCode(root, 'TRACK')
  done(track.createItem({ kind: 'feature', title: 'tracked delivery', workspace: 'ws', parentId: root }))

  const nested = track.createItem({ kind: 'chore', title: 'reporting phase', workspace: 'ws', parentId: root, role: 'spec-phase' })
  const nestedLeaf = track.createItem({
    kind: 'feature',
    title: 'scoped pending work',
    workspace: 'ws',
    parentId: nested,
    body: 'La référence interne 01KYR161DN1BMPF682QJX3G3BE ne doit pas paraître dans la table propriétaire.',
  })
  track.createDecision({
    decisionKind: 'commitment',
    title: 'choose scoped path',
    workspace: 'ws',
    targets: [nestedLeaf],
    dossier: {
      context: 'recorded context',
      options: [{ id: 'a', title: 'A', summary: 'first' }, { id: 'b', title: 'B', summary: 'second' }],
      qa: [],
      recommendation: { optionId: 'a', rationale: 'first' },
    },
  })
  const engagementLeaf = track.createItem({
    kind: 'feature',
    title: 'engagement-backed work',
    workspace: 'ws',
    parentId: root,
    engagementRef: 'thr:track-scope-test',
  })

  const outside = track.createItem({ kind: 'chore', title: 'Outside', workspace: 'ws', role: 'workpackage' })
  const outsideLeaf = track.createItem({ kind: 'feature', title: 'outside work', workspace: 'ws', parentId: outside })
  track.createItem({ kind: 'feature', title: 'orphan work', workspace: 'ws' })
  return { root, nestedLeaf, engagementLeaf, outsideLeaf }
}

describe('report --scope', () => {
  it('projects one complete subtree with the same rows as the global report and declares exclusions', () => {
    const { root, outsideLeaf } = seed()
    const reader = new TrackReader(eventsPath)
    const global = reader.report(options)
    const projection = projectReportScope(global, 'TRACK')
    const globalRows = Object.values(global.buckets).flat()
    const scopedRows = Object.values(projection.report.buckets).flat()
    const selectedLeafIds = new Set(
      projection.report.wpTree!.flatMap((node) => [node, ...node.children]).flatMap((node) => node.leaves.map((leaf) => leaf.id)),
    )

    expect(projection.scope).toMatchObject({ selector: 'TRACK', id: root, label: 'TRACK', includes: 'subtree' })
    expect(scopedRows).toEqual(globalRows.filter((row) => selectedLeafIds.has(row.id)))
    expect(scopedRows.map((row) => row.id)).not.toContain(outsideLeaf)

    const rendered = JSON.parse(reportText(reader, options, 'json', NOW, false, 'TRACK')) as {
      buckets: Record<string, Array<{ id: string }>>
      view: { header: { scopeProjection: { includes: string; excludedProjectionRows: number }; sources: string[] }; tables: Array<{ id: string }> }
    }
    expect(rendered.buckets).toEqual(projection.report.buckets)
    expect(rendered.view.header.scopeProjection).toMatchObject({ includes: 'subtree', excludedProjectionRows: 2 })
    expect(rendered.view.header.sources.join(' ')).toContain('2 lignes hors scope exclues')
    const revision = reader.cursor()
    expect(rendered.view.header.sources.join(' ')).toContain(`révision du journal : ${revision.count} événements ; tête : ${revision.head}`)
    expect(rendered.view.tables.map((table) => table.id)).toEqual(['done', 'todo', 'decisions', 'recommendation'])
    expect(reportText(reader, options, 'text', NOW, false, 'TRACK')).toContain('2 lignes hors scope exclues')
  })

  it('accepts the stable container id and the current derived label, while an unknown selector fails loudly', () => {
    const { root, outsideLeaf } = seed()
    const reader = new TrackReader(eventsPath)
    const global = reader.report(options)

    expect(projectReportScope(global, root).scope.id).toBe(root)
    expect(projectReportScope(global, 'WP1').report.buckets['TO-DO'].map((row) => row.id)).toContain(outsideLeaf)

    const out: string[] = []
    const err: string[] = []
    const code = runCli(['report', '--scope', 'missing-scope', '--commit', 'c1'], {
      cwd: dir,
      out: (line) => out.push(line),
      err: (line) => err.push(line),
    })
    expect(code).toBe(1)
    expect(out).toEqual([])
    expect(err.join('')).toContain('unknown scope selector: missing-scope')
  })

  it('keeps an engagement blockage on its target row instead of adding a title-twin row', () => {
    const { engagementLeaf } = seed()
    const reader = new TrackReader(eventsPath)
    const report = reader.report(options)
    const view = buildWpConductorView(report.wpTree ?? [], report.decisions ?? [], report.outsideRollup)
    const todo = view.tables.find((table) => table.id === 'todo')!
    const renderedTodo = todo.rows.map((row) => row['todo']).join('\n')
    const matchingHandles = view.handles.filter((handle) => handle.title === 'engagement-backed work')

    expect(renderedTodo.match(/engagement-backed work/gu)).toHaveLength(1)
    expect(matchingHandles).toEqual([
      expect.objectContaining({ id: engagementLeaf, kind: 'item', title: 'engagement-backed work' }),
    ])
  })

  it('prints a scoped resolve command that returns the scoped handle target', () => {
    const { outsideLeaf } = seed()
    const out: string[] = []
    const code = runCli(['report', '--scope', 'WP1', '--commit', 'c1'], {
      cwd: dir,
      out: (line) => out.push(line),
      err: () => undefined,
    })
    const rendered = out.join('')
    expect(code).toBe(0)
    const printed = rendered.match(/^commande : (?<command>.+)$/mu)?.groups?.['command']
    expect(printed).toBe('track report --scope WP1 --resolve <handle>')

    const resolved: string[] = []
    const [binary, ...printedArgs] = printed!.replace('<handle>', '[1.1]').split(' ')
    expect(binary).toBe('track')
    const resolveCode = runCli([...printedArgs, '--commit', 'c1'], {
      cwd: dir,
      out: (line) => resolved.push(line),
      err: () => undefined,
    })
    expect(resolveCode).toBe(0)
    expect(resolved.join('')).toContain(outsideLeaf)
    expect(resolved.join('')).toContain('outside work')
  })

  it('keeps ULIDs out of the owner-facing sections while retaining machine handles', () => {
    seed()
    const rendered = reportText(new TrackReader(eventsPath), options, 'text', NOW, false, 'TRACK')
    const ownerSections = rendered.split('RÉSOLUTION DES HANDLES')[0]!

    expect(ownerSections).not.toMatch(/[0-9A-HJKMNP-TV-Z]{26}/u)
    expect(rendered).toContain('référence interne')
    expect(rendered.slice(rendered.indexOf('RÉSOLUTION DES HANDLES'))).toMatch(/[0-9A-HJKMNP-TV-Z]{26}/u)
  })

  it('matches an assigned code exactly, including its recorded whitespace', () => {
    const padded = track.createItem({ kind: 'chore', title: 'Padded code', workspace: 'ws', role: 'workpackage' })
    track.assignCode(padded, ' PADDED ')
    track.createItem({ kind: 'feature', title: 'padded work', workspace: 'ws', parentId: padded })
    const reader = new TrackReader(eventsPath)
    const projection = projectReportScope(reader.report(options), ' PADDED ')

    expect(projection.scope).toMatchObject({ id: padded, selector: ' PADDED ' })
    expect(reportText(reader, options, 'text', NOW, false, ' PADDED ')).toContain("track report --scope ' PADDED ' --resolve <handle>")
  })
})
