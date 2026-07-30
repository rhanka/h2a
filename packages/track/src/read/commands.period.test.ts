import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { runCli, type CliIO } from '../cli/index.js'
import { EventStore } from '../events/store.js'
import { Track } from '../track.js'
import { TrackReader } from './contract.js'
import { reportHtml, reportText, type ReportPeriodSelection } from './commands.js'

let dir: string
let eventsPath: string
let instant: string
let track: Track

const options = { baselineCommit: 'c1', decisions: true, wpTree: true }
const NOW = '2026-07-20T12:00:00.000Z'

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'track-report-period-'))
  eventsPath = join(dir, '.track', 'events.jsonl')
  instant = '2026-07-01T09:00:00.000Z'
  track = new Track(new EventStore(eventsPath), { by: 'human:period', now: () => instant })
})

afterEach(() => rmSync(dir, { recursive: true, force: true }))

function at(value: string, act: () => void): void {
  instant = value
  act()
}

function done(id: string, atValue: string): void {
  at(atValue, () => track.setRealization(id, 'in-progress'))
  at(atValue, () => track.setRealization(id, 'done'))
}

function seed(): { root: string; nested: string; open: string; delivered: string } {
  const root = track.createItem({ kind: 'chore', title: 'Parent workpackage', workspace: 'ws', role: 'workpackage' })
  const nested = track.createItem({ kind: 'chore', title: 'Nested workpackage', workspace: 'ws', parentId: root, role: 'workpackage' })
  const delivered = track.createItem({ kind: 'feature', title: 'old delivery', workspace: 'ws', parentId: nested })
  done(delivered, '2026-07-03T10:00:00.000Z')
  let open = ''
  at('2026-07-04T10:00:00.000Z', () => {
    open = track.createItem({ kind: 'feature', title: 'still open', workspace: 'ws', parentId: nested })
  })
  return { root, nested, open, delivered }
}

function selection(from: string, to: string): ReportPeriodSelection {
  return { requested: `${from}..${to}`, from, to, fromRef: null, toRef: null }
}

function jsonFor(period?: ReportPeriodSelection): Record<string, unknown> {
  return JSON.parse(reportText(new TrackReader(eventsPath), options, 'json', NOW, false, undefined, period)) as Record<string, unknown>
}

function table(value: Record<string, unknown>, id: string): { rows: Array<Record<string, string>> } {
  const view = value['view'] as { tables: Array<{ id: string; rows: Array<Record<string, string>> }> }
  return view.tables.find((candidate) => candidate.id === id)!
}

function cli(args: string[]): { code: number; out: string; err: string } {
  const out: string[] = []
  const err: string[] = []
  const io: CliIO = { cwd: dir, out: (value) => out.push(value), err: (value) => err.push(value) }
  const code = runCli(args, io)
  expect(typeof code).toBe('number')
  return { code: code as number, out: out.join(''), err: err.join('') }
}

describe('report period — project the complete fold, never a truncated journal', () => {
  it('keeps the current WP tree and À-FAIRE while an empty short window says no delivery', () => {
    const { open } = seed()
    const all = jsonFor()
    const short = jsonFor(selection('2026-07-20T00:00:00.000Z', '2026-07-20T23:59:59.999Z'))

    expect(short['wpTree']).toEqual(all['wpTree'])
    // The short-period reader may expand a sub-WP, but it must retain the same current open work.
    expect(table(short, 'todo').rows.flatMap((row) => Object.values(row)).join(' ')).toContain('still open')
    expect(table(all, 'todo').rows.flatMap((row) => Object.values(row)).join(' ')).toContain('still open')
    expect(table(short, 'todo').rows.flatMap((row) => Object.values(row)).join(' ')).toContain('still open')
    expect(table(short, 'done').rows[0]!['lastActions']).toBe('aucune action enregistrée')

    const period = short['period'] as Record<string, unknown>
    expect(period).toMatchObject({
      requested: '2026-07-20T00:00:00.000Z..2026-07-20T23:59:59.999Z',
      eventsInWindow: 0,
      eventsTotal: expect.any(Number),
      fromRef: null,
      toRef: null,
    })
    expect(period['eventsTotal']).toBeGreaterThan(0)
    expect(open).not.toBe('')
  })

  it('scopes FAIT to done transitions while preserving historical and current delivery truth', () => {
    seed()
    const deliveryDay = jsonFor(selection('2026-07-03T00:00:00.000Z', '2026-07-03T23:59:59.999Z'))
    const oldWindow = jsonFor(selection('2026-07-01T00:00:00.000Z', '2026-07-02T23:59:59.999Z'))

    expect(table(deliveryDay, 'done').rows.flatMap((row) => Object.values(row)).join(' ')).toContain('old delivery')
    expect(table(oldWindow, 'done').rows[0]!['lastActions']).toBe('aucune action enregistrée')
  })

  it('makes the existing short and long reading branches reachable from resolved bounds', () => {
    seed()
    const short = jsonFor(selection('2026-07-03T00:00:00.000Z', '2026-07-03T23:59:59.999Z'))
    const long = jsonFor(selection('2026-07-01T00:00:00.000Z', '2026-07-20T23:59:59.999Z'))
    const scopes = (value: Record<string, unknown>): string[] =>
      table(value, 'todo').rows.map((row) => row['wp']).filter((scope): scope is string => scope !== undefined)
    const shortScopes = scopes(short)
    const longScopes = scopes(long)

    expect(shortScopes.some((scope) => scope.includes('WP1.1'))).toBe(true)
    expect(longScopes.some((scope) => scope.includes('WP1.1'))).toBe(false)
    expect(longScopes.some((scope) => scope.includes('WP1'))).toBe(true)
  })

  it('uses one resolved header across JSON, text, Markdown and HTML', () => {
    seed()
    const period = selection('2026-07-03T00:00:00.000Z', '2026-07-03T23:59:59.999Z')
    const rendered = [
      JSON.stringify((jsonFor(period)['view'] as { header: { period: { label: string } } }).header.period.label),
      reportText(new TrackReader(eventsPath), options, 'text', NOW, false, undefined, period),
      reportText(new TrackReader(eventsPath), options, 'md', NOW, false, undefined, period),
      reportHtml(new TrackReader(eventsPath), options, NOW, false, period),
    ]
    for (const output of rendered) {
      expect(output).toContain('période : 2026-07-03 → 2026-07-03')
      expect(output).toContain('sélecteur : 2026-07-03T00:00:00.000Z..2026-07-03T23:59:59.999Z')
    }
  })
})

describe('report period — CLI boundary', () => {
  it('resolves named periods and no selector to absolute JSON payloads', () => {
    seed()
    const today = cli(['report', '--period', 'today', '--now', NOW, '--format', 'json'])
    expect(today.code).toBe(0)
    const period = (JSON.parse(today.out) as { period: Record<string, unknown> }).period
    expect(period).toMatchObject({
      requested: 'today',
      from: new Date(2026, 6, 20).toISOString(),
      to: new Date(2026, 6, 20, 23, 59, 59, 999).toISOString(),
      fromRef: null,
      toRef: null,
      eventsInWindow: 0,
    })

    const all = cli(['report', '--period', 'all', '--now', NOW, '--format', 'json'])
    const allPeriod = (JSON.parse(all.out) as { period: Record<string, unknown> }).period
    expect(allPeriod).toMatchObject({ requested: 'all' })
    expect(allPeriod['eventsInWindow']).toBe(allPeriod['eventsTotal'])

    for (const named of ['week', 'month']) {
      const result = cli(['report', '--period', named, '--now', NOW, '--format', 'json'])
      expect(result.code).toBe(0)
      expect((JSON.parse(result.out) as { period: Record<string, unknown> }).period['requested']).toBe(named)
    }

    const implicit = cli(['report', '--now', NOW, '--format', 'json'])
    const implicitPeriod = (JSON.parse(implicit.out) as { period: Record<string, unknown> }).period
    expect(implicitPeriod).toMatchObject({ requested: null, to: NOW })
    expect(implicitPeriod['eventsInWindow']).toBe(implicitPeriod['eventsTotal'])
  })

  it('resolves local dates, rejects incompatible selectors, and keeps --commit orthogonal', () => {
    seed()
    const dated = cli(['report', '--since', '2026-07-03', '--until', '2026-07-03', '--commit', 'baseline-x', '--wp', '--format', 'json'])
    expect(dated.code).toBe(0)
    const parsed = JSON.parse(dated.out) as { period: Record<string, unknown>; view: { header: { baselineCommit: string } } }
    const period = parsed.period
    expect(period).toMatchObject({
      requested: '2026-07-03..2026-07-03',
      from: new Date(2026, 6, 3).toISOString(),
      to: new Date(2026, 6, 3, 23, 59, 59, 999).toISOString(),
    })
    expect(parsed.view.header.baselineCommit).toBe('baseline-x')

    const both = cli(['report', '--since', '2026-07-03', '--period', 'today'])
    expect(both.code).toBe(1)
    expect(both.err).toContain('--since and --period are mutually exclusive')
    const untilOnly = cli(['report', '--until', '2026-07-03'])
    expect(untilOnly.code).toBe(1)
    expect(untilOnly.err).toContain('--until requires --since')
  })

  it('resolves SHA bounds by their committer timestamps and returns their full refs', () => {
    seed()
    execFileSync('git', ['init', '-q'], { cwd: dir })
    execFileSync('git', ['config', 'user.email', 'period@example.test'], { cwd: dir })
    execFileSync('git', ['config', 'user.name', 'Period'], { cwd: dir })
    writeFileSync(join(dir, 'period.txt'), 'period\n')
    execFileSync('git', ['add', 'period.txt'], { cwd: dir })
    execFileSync('git', ['commit', '-q', '-m', 'period'], {
      cwd: dir,
      env: { ...process.env, GIT_AUTHOR_DATE: '2026-07-03T10:30:00+00:00', GIT_COMMITTER_DATE: '2026-07-03T10:30:00+00:00' },
    })
    const ref = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim()
    const committedAt = execFileSync('git', ['show', '-s', '--format=%cI', ref], { cwd: dir, encoding: 'utf8' }).trim()

    const result = cli(['report', '--since', ref.slice(0, 10), '--format', 'json'])
    expect(result.code).toBe(0)
    const period = (JSON.parse(result.out) as { period: Record<string, unknown> }).period
    expect(period).toMatchObject({ requested: ref.slice(0, 10), from: committedAt, fromRef: ref, toRef: null })
    expect(period['to']).toBe(new TrackReader(eventsPath).logWindow().to)
  })
})
