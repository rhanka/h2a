import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { runCli, type CliIO } from '../cli/index.js'
import { EventStore } from '../events/store.js'
import { TrackReader } from '../read/contract.js'
import { Track } from '../track.js'
import { renderSnapshot, snapshotJson } from './snapshot.js'

let dir: string
let eventsPath: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'track-snapshot-'))
  eventsPath = join(dir, '.track', 'events.jsonl')
  let n = 0
  const track = new Track(new EventStore(eventsPath), {
    by: 'tester',
    now: () => '2026-07-14T12:00:00.000Z',
    newId: () => `id-${String(++n).padStart(4, '0')}`,
  })
  const wp = track.createItem({ kind: 'chore', title: 'WP', workspace: 'ws', role: 'workpackage' })
  const item = track.createItem({ kind: 'feature', title: 'Deliver', workspace: 'ws', parentId: wp })
  track.createDecision({
    decisionKind: 'commitment', title: 'Choose', workspace: 'ws', targets: [item],
    dossier: { context: 'not copied verbatim', options: [], qa: [] },
  })
})

afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('SnapshotV1', () => {
  it('should emit canonical fixed facts without the optional presentation view', () => {
    const snapshot = new TrackReader(eventsPath).snapshot({ baselineInput: 'HEAD', resolvedCommit: 'abc' })
    expect(snapshot.schema).toBe('track.snapshot/v1')
    expect(snapshot.baseline).toEqual({ input: 'HEAD', resolvedCommit: 'abc' })
    expect(snapshot.report.decisions).toHaveLength(1)
    expect(snapshot.report.wpTree).toHaveLength(1)
    expect('view' in snapshot.report).toBe(false)
    expect(snapshot.recentEvents.map((event) => event.position)).toEqual([1, 2, 3, 4])
    expect(snapshot.recentEvents.every((event) => event.summary === undefined)).toBe(true)
    expect(snapshot.directives.every((directive) => directive.source === 'rule-derived')).toBe(true)
  })

  it('should produce identical bytes for the same log and baseline', () => {
    const reader = new TrackReader(eventsPath)
    const a = snapshotJson(reader.snapshot({ baselineInput: 'HEAD', resolvedCommit: 'abc' }))
    const localeCompare = vi.spyOn(String.prototype, 'localeCompare').mockImplementation(() => {
      throw new Error('SnapshotV1 must not depend on localeCompare/ICU')
    })
    let b: string
    try {
      b = snapshotJson(reader.snapshot({ baselineInput: 'HEAD', resolvedCommit: 'abc' }))
    } finally {
      localeCompare.mockRestore()
    }
    expect(b).toBe(a)
    expect(createHash('sha256').update(b).digest('hex')).toBe(createHash('sha256').update(a).digest('hex'))
  })

  it('should label diagnostics as factual and rule-derived, never AI advice', () => {
    const snapshot = new TrackReader(eventsPath).snapshot({ baselineInput: 'c1', resolvedCommit: 'c1' })
    snapshot.directives = [{ id: 'd1', source: 'rule-derived', kind: 'fact', text: 'safe\u202eevil\u2066' }]
    for (const format of ['text', 'md'] as const) {
      const output = renderSnapshot(snapshot, format)
      expect(output).toContain('RULE-DERIVED FACTS (NOT AI ADVICE)')
      expect(output).toContain('track.snapshot/v1')
      expect(output).not.toMatch(/[\u202a-\u202e\u2066-\u2069]/u)
    }
  })

  it('should make report --raw an exact alias of snapshot', () => {
    const run = (args: string[]): string => {
      const out: string[] = []
      const io: CliIO = { cwd: dir, out: (value) => out.push(value), err: (value) => out.push(value) }
      expect(runCli(args, io)).toBe(0)
      return out.join('')
    }
    expect(run(['report', '--raw', '--commit', 'c1'])).toBe(run(['snapshot', '--commit', 'c1']))
    expect(run(['report', '--raw', '--format', 'md', '--commit', 'c1'])).toBe(
      run(['snapshot', '--format', 'md', '--commit', 'c1']),
    )
    const out: string[] = []
    expect(runCli(['snapshot', '--raw'], { cwd: dir, out: (value) => out.push(value), err: (value) => out.push(value) })).toBe(1)
    expect(out.join('')).toMatch(/unsupported flag.*--raw/)
  })
})
