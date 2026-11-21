import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { runCli } from './cli/index.js'
import { readHead } from './events/head.js'
import { EventStore } from './events/store.js'
import { validate } from './events/validate.js'
import type { Dossier } from './model/decision.js'
import { fold } from './state/fold.js'
import { Track } from './track.js'

let scratch: string
let savedTrackDir: string | undefined

function makeDossier(viewRef = 'docs/dossiers/choice.md', context = 'Contexte de choix.'): Dossier {
  return {
    context,
    qa: [],
    options: [
      { id: 'a', title: 'Option A', summary: 'Première voie' },
      { id: 'b', title: 'Option B', summary: 'Seconde voie' },
    ],
    recommendation: { optionId: 'a', rationale: 'Plus simple' },
    artifacts: [{ kind: 'rendered-view', viewRef }],
  }
}

function cli(cwd: string, args: string[]): { code: number; out: string; err: string } {
  let out = ''
  let err = ''
  const code = runCli(args, {
    cwd,
    out: (s) => {
      out += s
    },
    err: (s) => {
      err += s
    },
  })
  return { code: code as number, out, err }
}

beforeEach(() => {
  savedTrackDir = process.env['TRACK_DIR']
  delete process.env['TRACK_DIR']
  scratch = mkdtempSync(join(tmpdir(), 'track-decision-number-'))
})

afterEach(() => {
  if (savedTrackDir === undefined) delete process.env['TRACK_DIR']
  else process.env['TRACK_DIR'] = savedTrackDir
  rmSync(scratch, { recursive: true, force: true })
})

describe('stable decision numbers (lot 2)', () => {
  it('a decision keeps its number when another one is settled (T2-c)', () => {
    const repo = join(scratch, 'repo-t2c')
    mkdirSync(repo, { recursive: true })
    const eventsPath = join(repo, '.track', 'events.jsonl')
    const store = new EventStore(eventsPath)
    const track = new Track(store, { by: 'tester', now: () => '2026-11-18T10:00:00.000Z' })

    const item = track.createItem({ kind: 'feature', title: 'Sujet', workspace: 'ws:test' })
    const d1 = track.createDecision({
      decisionKind: 'orientation',
      title: 'Première décision ?',
      workspace: 'ws:test',
      targets: [item],
      dossier: makeDossier('docs/dossiers/d1.md'),
    })
    const d2 = track.createDecision({
      decisionKind: 'commitment',
      title: 'Deuxième décision ?',
      workspace: 'ws:test',
      targets: [item],
      dossier: makeDossier('docs/dossiers/d2.md'),
    })
    const d3 = track.createDecision({
      decisionKind: 'orientation',
      title: 'Troisième décision ?',
      workspace: 'ws:test',
      targets: [item],
      dossier: makeDossier('docs/dossiers/d3.md'),
    })

    // Each decision received its stable number in the same batch as decision.created
    const createdEvents = store.readAll()
    for (const [idx, decId] of [d1, d2, d3].entries()) {
      const created = createdEvents.find((e) => e.type === 'decision.created' && e.aggregateId === decId)
      const numbered = createdEvents.find((e) => e.type === 'decision.owner-numbered' && e.aggregateId === decId)
      expect(created).toBeDefined()
      expect(numbered).toBeDefined()
      expect(numbered!.cmdId).toBe(created!.cmdId)
      expect((numbered!.payload as { number: number }).number).toBe(idx + 1)
    }

    let state = fold(store.readAll())
    expect((state.decisions.get(d1) as { ownerNumber?: number }).ownerNumber).toBe(1)
    expect((state.decisions.get(d2) as { ownerNumber?: number }).ownerNumber).toBe(2)
    expect((state.decisions.get(d3) as { ownerNumber?: number }).ownerNumber).toBe(3)

    // Settle D1: D2 and D3 keep 2 and 3; a newly created decision gets 4 (1 is never reassigned)
    track.selectDecisionOption(d1, 'a', 'go')
    const d4 = track.createDecision({
      decisionKind: 'commitment',
      title: 'Quatrième décision ?',
      workspace: 'ws:test',
      targets: [item],
      dossier: makeDossier('docs/dossiers/d4.md'),
    })

    state = fold(store.readAll())
    expect((state.decisions.get(d1) as { ownerNumber?: number }).ownerNumber).toBe(1)
    expect((state.decisions.get(d2) as { ownerNumber?: number }).ownerNumber).toBe(2)
    expect((state.decisions.get(d3) as { ownerNumber?: number }).ownerNumber).toBe(3)
    expect((state.decisions.get(d4) as { ownerNumber?: number }).ownerNumber).toBe(4)

    // Pre-lot-2 legacy unnumbered structured decisions can be numbered via CLI, in creation order, idempotently
    const legacy1 = '01K0T2CLEGACY0000000000001'
    const legacy2 = '01K0T2CLEGACY0000000000002'
    const legacyUnstructured = '01K0T2CLEGACY0000000000003'
    store.appendCommand([
      {
        id: '01K0T2CLEGACYEVT0000000001',
        type: 'decision.created',
        aggregate: 'decision',
        aggregateId: legacy1,
        at: '2026-11-18T11:00:00.000Z',
        by: 'legacy',
        payload: {
          decisionKind: 'orientation',
          title: 'Ancienne décision 1 ?',
          workspace: 'ws:test',
          targets: [item],
          dossier: makeDossier('docs/dossiers/l1.md'),
        },
      },
    ])
    store.appendCommand([
      {
        id: '01K0T2CLEGACYEVT0000000002',
        type: 'decision.created',
        aggregate: 'decision',
        aggregateId: legacyUnstructured,
        at: '2026-11-18T11:05:00.000Z',
        by: 'legacy',
        payload: {
          decisionKind: 'orientation',
          title: 'Ancienne sans options',
          workspace: 'ws:test',
          targets: [item],
          dossier: { context: 'Pas encore instruit.', options: [], qa: [] },
        },
      },
    ])
    store.appendCommand([
      {
        id: '01K0T2CLEGACYEVT0000000003',
        type: 'decision.created',
        aggregate: 'decision',
        aggregateId: legacy2,
        at: '2026-11-18T11:10:00.000Z',
        by: 'legacy',
        payload: {
          decisionKind: 'commitment',
          title: 'Ancienne décision 2 ?',
          workspace: 'ws:test',
          targets: [item],
          dossier: makeDossier('docs/dossiers/l2.md'),
        },
      },
    ])

    // Number single decision first -> gets 5
    const singleRes = cli(repo, ['decision', 'number', legacy1])
    expect(singleRes.code, singleRes.err).toBe(0)
    expect((fold(store.readAll()).decisions.get(legacy1) as { ownerNumber?: number }).ownerNumber).toBe(5)

    // Number remaining unnumbered structured decisions -> legacy2 gets 6; legacyUnstructured stays undefined
    const allRes = cli(repo, ['decision', 'number', '--all-unnumbered'])
    expect(allRes.code, allRes.err).toBe(0)
    state = fold(store.readAll())
    expect((state.decisions.get(legacy2) as { ownerNumber?: number }).ownerNumber).toBe(6)
    expect((state.decisions.get(legacyUnstructured) as { ownerNumber?: number }).ownerNumber).toBeUndefined()

    // Second run appends nothing (byte-identical events.jsonl)
    const rawBeforeSecond = readFileSync(eventsPath, 'utf8')
    const secondAll = cli(repo, ['decision', 'number', '--all-unnumbered'])
    expect(secondAll.code, secondAll.err).toBe(0)
    expect(readFileSync(eventsPath, 'utf8')).toBe(rawBeforeSecond)

    const secondSingle = cli(repo, ['decision', 'number', legacy1])
    expect(secondSingle.code, secondSingle.err).toBe(0)
    expect(readFileSync(eventsPath, 'utf8')).toBe(rawBeforeSecond)

    expect(validate(store.readAll(), readHead(eventsPath)).ok).toBe(true)
  })

  it('an OWNER GATE decision receives no number (T2-e)', () => {
    const repo = join(scratch, 'repo-t2e')
    mkdirSync(repo, { recursive: true })
    const eventsPath = join(repo, '.track', 'events.jsonl')
    const store = new EventStore(eventsPath)
    const track = new Track(store, { by: 'tester', now: () => '2026-11-18T10:00:00.000Z' })

    const item = track.createItem({ kind: 'feature', title: 'Sujet gate', workspace: 'ws:test' })
    const gateId = track.createDecision({
      decisionKind: 'commitment',
      title: 'OWNER GATE og-1 — confirmer la mise en prod',
      workspace: 'ws:test',
      targets: [item],
      dossier: makeDossier('docs/dossiers/og1.md', 'Target instance and session: deploy-1\nConfirmer.'),
    })
    const ordinaryId = track.createDecision({
      decisionKind: 'orientation',
      title: 'Décision ordinaire après gate ?',
      workspace: 'ws:test',
      targets: [item],
      dossier: makeDossier('docs/dossiers/ord.md'),
    })

    const events = store.readAll()
    expect(events.filter((e) => e.type === 'decision.owner-numbered' && e.aggregateId === gateId)).toHaveLength(0)
    expect(events.filter((e) => e.type === 'decision.owner-numbered' && e.aggregateId === ordinaryId)).toHaveLength(1)

    const state = fold(events)
    expect((state.decisions.get(gateId) as { ownerNumber?: number }).ownerNumber).toBeUndefined()
    // Ordinary decision gets #1 (gate never consumes a number)
    expect((state.decisions.get(ordinaryId) as { ownerNumber?: number }).ownerNumber).toBe(1)

    // Explicit `track decision number <gateId>` refuses; `--all-unnumbered` skips OWNER GATE
    const rawBefore = readFileSync(eventsPath, 'utf8')
    const singleGate = cli(repo, ['decision', 'number', gateId])
    expect(singleGate.code).toBe(1)
    expect(readFileSync(eventsPath, 'utf8')).toBe(rawBefore)

    const allRes = cli(repo, ['decision', 'number', '--all-unnumbered'])
    expect(allRes.code, allRes.err).toBe(0)
    expect(readFileSync(eventsPath, 'utf8')).toBe(rawBefore)
    expect((fold(store.readAll()).decisions.get(gateId) as { ownerNumber?: number }).ownerNumber).toBeUndefined()
    expect(validate(store.readAll(), readHead(eventsPath)).ok).toBe(true)
  })
})
