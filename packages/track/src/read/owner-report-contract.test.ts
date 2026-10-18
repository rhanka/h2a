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
