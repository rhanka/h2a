import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { EventStore } from '../events/store.js'
import { Track } from '../track.js'
import { runCli, type CliIO } from './index.js'

let root: string
let eventsPath: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'track-decision-ls-'))
  mkdirSync(join(root, '.track'), { recursive: true })
  eventsPath = join(root, '.track', 'events.jsonl')
})

afterEach(() => rmSync(root, { recursive: true, force: true }))

function cli(args: string[]): { code: number; out: string; err: string } {
  const out: string[] = []
  const err: string[] = []
  const result = runCli(args, { cwd: root, out: (value) => out.push(value), err: (value) => err.push(value) } satisfies CliIO)
  expect(typeof result).toBe('number')
  return { code: result as number, out: out.join(''), err: err.join('') }
}

function legacyDecision(input: { id: string; title: string; workspace: string; targets: string[] }): string {
  // Read-only historical fixture: old logs predate write-boundary validation and can contain prose-only
  // dossiers. It is deliberately injected at the event-store seam solely to prove the reader labels it
  // unstructured; all current public decision writers are exercised with structured dossiers below.
  new EventStore(eventsPath).appendCommand([{
    id: `event-${input.id}`,
    type: 'decision.created',
    aggregate: 'decision',
    aggregateId: input.id,
    at: '2026-07-28T00:00:00.000Z',
    by: 'legacy-fixture',
    payload: {
      decisionKind: 'commitment',
      title: input.title,
      workspace: input.workspace,
      targets: input.targets,
      dossier: { context: 'Choix A: prose only', options: [], qa: [] },
    },
  }])
  return input.id
}

function dossier() {
  return {
    context: 'Choose one documented alternative.',
    options: [
      { id: 'A', title: 'Option A', summary: 'first' },
      { id: 'B', title: 'Option B', summary: 'second' },
    ],
    recommendation: { optionId: 'A', rationale: 'evidence' },
    qa: [],
  }
}

describe('track decision ls', () => {
  it('lists every pending decision and exposes whether alternatives are structured', () => {
    const track = new Track(new EventStore(eventsPath), { by: 'tester' })
    const target = track.createItem({ kind: 'feature', title: 'target', workspace: 'ws-a' })
    const structured = track.createDecision({
      decisionKind: 'orientation',
      title: 'structured decision',
      workspace: 'ws-a',
      targets: [target],
      dossier: dossier(),
    })
    const prose = legacyDecision({ id: 'legacy-prose', title: 'prose-only decision', workspace: 'ws-b', targets: [target] })
    for (let i = 0; i < 8; i++) {
      track.createDecision({
        decisionKind: 'orientation', title: `extra ${i}`, workspace: 'ws-a', targets: [target],
        dossier: dossier(),
      })
    }

    const all = cli(['decision', 'ls', '--outcome', 'pending', '--format', 'json', '--commit', 'c1'])
    expect(all.code, all.err).toBe(0)
    const rows = JSON.parse(all.out) as Array<{
      id: string
      structure: string
      options: Array<{ id: string }>
      recommendation?: { optionId: string }
    }>
    expect(rows).toHaveLength(10)
    expect(rows.find((row) => row.id === structured)).toMatchObject({ structure: 'structured', options: [{ id: 'A' }, { id: 'B' }], recommendation: { optionId: 'A' } })
    expect(rows.find((row) => row.id === prose)).toMatchObject({ structure: 'unstructured', options: [] })

    const scoped = cli(['decision', 'ls', '--workspace', 'ws-b', '--format', 'json', '--commit', 'c1'])
    expect(scoped.code, scoped.err).toBe(0)
    expect(JSON.parse(scoped.out)).toHaveLength(1)
  })

  it('sanitizes hostile titles in text and Markdown without changing JSON facts', () => {
    const track = new Track(new EventStore(eventsPath), { by: 'tester' })
    const target = track.createItem({ kind: 'feature', title: 'target', workspace: 'ws' })
    const decisionId = track.createDecision({
      decisionKind: 'orientation', title: 'safe\n- forged | **markdown**\u001b[31m', workspace: 'ws', targets: [target],
      dossier: dossier(),
    })

    const text = cli(['decision', 'ls', '--format', 'text', '--commit', 'c1'])
    expect(text.code, text.err).toBe(0)
    expect(text.out).toContain(decisionId)
    expect(text.out).not.toContain('\n- forged')
    expect(text.out).not.toContain('\u001b')

    const md = cli(['decision', 'ls', '--format', 'md', '--commit', 'c1'])
    expect(md.code, md.err).toBe(0)
    expect(md.out).not.toContain('\n- forged')
    expect(md.out).toContain('\\*\\*markdown\\*\\*')
  })

  it('permits decision outcome only for an authenticated deferral; go/no-go uses decision select', () => {
    const track = new Track(new EventStore(eventsPath), { by: 'tester' })
    const target = track.createItem({ kind: 'feature', title: 'target', workspace: 'ws' })
    const decisionId = track.createDecision({ decisionKind: 'orientation', title: 'structured', workspace: 'ws', targets: [target], dossier: dossier() })

    const go = cli(['decision', 'outcome', decisionId, 'go'])
    expect(go.code).toBe(1)
    expect(go.err).toMatch(/deferred/)

    const deferred = cli(['decision', 'outcome', decisionId, 'deferred'])
    expect(deferred.code, deferred.err).toBe(0)
    expect(new Track(new EventStore(eventsPath)).state().decisions.get(decisionId)!.outcome).toBe('deferred')
  })

  it('serves an empty read without a sidecar, but rejects an explicit missing --track-dir', () => {
    const unadopted = mkdtempSync(join(tmpdir(), 'track-decision-ls-unadopted-'))
    try {
      const out: string[] = []
      const err: string[] = []
      const code = runCli(['decision', 'ls', '--format', 'json', '--commit', 'c1'], {
        cwd: unadopted, out: (value) => out.push(value), err: (value) => err.push(value),
      })
      expect(code).toBe(0)
      expect(out.join('')).toBe('[]\n')
      expect(err.join('')).toMatch(/Serving an empty view/)
      expect(existsSync(join(unadopted, '.track'))).toBe(false)

      const badErr: string[] = []
      const bad = runCli(['decision', 'ls', '--track-dir', join(unadopted, 'missing'), '--format', 'json'], {
        cwd: unadopted, out: () => {}, err: (value) => badErr.push(value),
      })
      expect(bad).toBe(1)
      expect(badErr.join('')).toMatch(/requested --track-dir/)
      expect(existsSync(join(unadopted, '.track'))).toBe(false)
    } finally {
      rmSync(unadopted, { recursive: true, force: true })
    }
  })
})
