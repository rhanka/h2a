import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { EventStore } from './events/store.js'
import { validate } from './events/validate.js'
import type { Dossier } from './model/decision.js'
import { openBlockersForItem } from './state/fold.js'
import { Track } from './track.js'

let dir: string
let store: EventStore
let track: Track

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'track-decision-'))
  store = new EventStore(join(dir, '.track', 'events.jsonl'))
  let n = 0
  track = new Track(store, {
    by: 'tester',
    now: () => '2026-06-03T10:00:00.000Z',
    newId: () => `id-${String(++n).padStart(4, '0')}`,
  })
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function dossier(): Dossier {
  return {
    context: 'ctx',
    options: [
      { id: 'a', title: 'Option A', summary: 'Take the first path' },
      { id: 'b', title: 'Option B', summary: 'Take the second path' },
    ],
    qa: [],
    recommendation: { optionId: 'a', rationale: 'A is safer' },
  }
}

function feature(title = 'f'): string {
  return track.createItem({ kind: 'feature', title, workspace: 'ws' })
}

describe('createDecision (A7)', () => {
  it('opens one decision blocker per target; targets are AWAITED, decision pending', () => {
    const t1 = feature('t1')
    const t2 = feature('t2')
    const d = track.createDecision({
      decisionKind: 'orientation',
      title: 'orient',
      workspace: 'ws',
      targets: [t1, t2],
      dossier: dossier(),
    })

    const state = track.state()
    const decBlockers = [...state.blockers.values()].filter((b) => b.kind === 'decision' && b.ref === d)
    expect(decBlockers).toHaveLength(2)
    expect(decBlockers.every((b) => b.open)).toBe(true)
    expect(openBlockersForItem(state, t1)).toHaveLength(1)
    expect(openBlockersForItem(state, t2)).toHaveLength(1)
    expect(state.decisions.get(d)!.outcome).toBe('pending')
    expect(validate(store.readAll()).ok).toBe(true)
  })

  it('rejects a decision targeting another decision (A3 recursion guard)', () => {
    const t = feature()
    const d1 = track.createDecision({
      decisionKind: 'orientation',
      title: 'd1',
      workspace: 'ws',
      targets: [t],
      dossier: dossier(),
    })
    expect(() =>
      track.createDecision({
        decisionKind: 'orientation',
        title: 'd2',
        workspace: 'ws',
        targets: [d1],
        dossier: dossier(),
      }),
    ).toThrow(/cannot target another decision/)
  })

  it('rejects duplicate target ids', () => {
    const t = feature()
    expect(() =>
      track.createDecision({
        decisionKind: 'orientation',
        title: 'x',
        workspace: 'ws',
        targets: [t, t],
        dossier: dossier(),
      }),
    ).toThrow(/same target twice/)
  })

  it('rejects an unknown target and an empty target list', () => {
    expect(() =>
      track.createDecision({
        decisionKind: 'orientation',
        title: 'x',
        workspace: 'ws',
        targets: ['nope'],
        dossier: dossier(),
      }),
    ).toThrow(/unknown target/)
    expect(() =>
      track.createDecision({
        decisionKind: 'orientation',
        title: 'x',
        workspace: 'ws',
        targets: [],
        dossier: dossier(),
      }),
    ).toThrow(/at least one target/)
  })
})

describe('outcome machine + target effect (A5, §2.6)', () => {
  it('deferred leaves the target AWAITED; a later go resolves it and auto-completes the gate', () => {
    const t = feature()
    const d = track.createDecision({
      decisionKind: 'orientation',
      title: 'orient',
      workspace: 'ws',
      targets: [t],
      dossier: dossier(),
    })

    track.setOutcome(d, 'deferred')
    let s = track.state()
    expect(s.decisions.get(d)!.outcome).toBe('deferred')
    expect(openBlockersForItem(s, t)).toHaveLength(1) // still AWAITED

    track.selectDecisionOption(d, 'a') // deferred -> selected go is legal
    s = track.state()
    expect(s.decisions.get(d)!.outcome).toBe('go')
    expect(s.decisions.get(d)!.dossier.selectedOptionId).toBe('a')
    expect(openBlockersForItem(s, t)).toHaveLength(0) // resolved
    expect(s.items.get(t)!.realization).toBe('to-do') // go does not drop
    expect(s.items.get(t)!.disposition.orientation).toBe('completed')
    expect(validate(store.readAll()).ok).toBe(true)
  })

  it('no-go resolves the blocker AND drops the target (rejected) as one atomic batch', () => {
    const t = feature()
    const d = track.createDecision({
      decisionKind: 'commitment',
      title: 'commit',
      workspace: 'ws',
      targets: [t],
      dossier: dossier(),
    })

    track.selectDecisionOption(d, 'b', 'no-go')
    const s = track.state()
    expect(s.decisions.get(d)!.outcome).toBe('no-go')
    expect(openBlockersForItem(s, t)).toHaveLength(0)
    expect(s.items.get(t)!.realization).toBe('rejected')
    expect(s.items.get(t)!.disposition.commitment).toBe('completed')

    // the effect is ONE atomic cmdId batch (selected option + outcome + blocker resolution + rejection)
    const events = store.readAll()
    const outcomeEvent = events.find((e) => e.type === 'decision.outcome')!
    expect(outcomeEvent.cmdId).toBeDefined()
    const batch = events.filter((e) => e.cmdId === outcomeEvent.cmdId)
    expect(batch.map((e) => e.type).sort()).toEqual([
      'blocker.resolved',
      'decision.option-selected',
      'decision.outcome',
      'realization.transition',
    ])
    expect(validate(events).ok).toBe(true)
  })

  it('flags a partial batch when a no-go member is dropped (A5 repair)', () => {
    const t = feature()
    const d = track.createDecision({
      decisionKind: 'commitment',
      title: 'commit',
      workspace: 'ws',
      targets: [t],
      dossier: dossier(),
    })
    track.selectDecisionOption(d, 'b', 'no-go')

    const full = store.readAll()
    const partial = full.slice(0, -1) // drop the trailing batch member (realization.transition)
    const result = validate(partial)
    expect(result.findings.some((f) => f.kind === 'prev-hash')).toBe(false)
    expect(result.findings.some((f) => f.kind === 'partial-batch')).toBe(true)
  })

  it('rejects an outcome transition out of a terminal go/no-go', () => {
    const t = feature()
    const d = track.createDecision({
      decisionKind: 'orientation',
      title: 'orient',
      workspace: 'ws',
      targets: [t],
      dossier: dossier(),
    })
    track.selectDecisionOption(d, 'a')
    expect(() => track.selectDecisionOption(d, 'b', 'no-go')).toThrow(/illegal outcome transition go -> no-go/)
  })
})

describe('decision realization (prep) + dossier + disposition', () => {
  it('a decision is prepared (realization done) independently of being settled', () => {
    const t = feature()
    const d = track.createDecision({
      decisionKind: 'orientation',
      title: 'orient',
      workspace: 'ws',
      targets: [t],
      dossier: dossier(),
    })
    track.setRealization(d, 'in-progress')
    track.setRealization(d, 'done')
    const decision = track.state().decisions.get(d)!
    expect(decision.realization).toBe('done') // prepared
    expect(decision.outcome).toBe('pending') // but not settled
  })

  it('revises the dossier', () => {
    const t = feature()
    const d = track.createDecision({
      decisionKind: 'orientation',
      title: 'orient',
      workspace: 'ws',
      targets: [t],
      dossier: dossier(),
    })
    track.reviseDossier(d, { ...dossier(), context: 'updated' })
    expect(track.state().decisions.get(d)!.dossier.context).toBe('updated')
  })

  it('rejects optionless creation and records an existing selected option durably', () => {
    const t = feature()
    expect(() => track.createDecision({
      decisionKind: 'orientation', title: 'legacy-shaped', workspace: 'ws', targets: [t],
      dossier: { context: 'old prose', options: [], qa: [] },
    })).toThrow(/at least two options/)

    const d = track.createDecision({ decisionKind: 'orientation', title: 'structured', workspace: 'ws', targets: [t], dossier: dossier() })
    expect(() => track.selectDecisionOption(d, 'unknown')).toThrow(/not declared/)
    track.selectDecisionOption(d, 'a')
    expect(track.state().decisions.get(d)!.dossier.selectedOptionId).toBe('a')
  })

  it('freezes the selected option and recorded recommendation after settlement', () => {
    const t = feature()
    const d = track.createDecision({ decisionKind: 'orientation', title: 'structured', workspace: 'ws', targets: [t], dossier: dossier() })
    track.selectDecisionOption(d, 'a')

    expect(() => track.reviseDossier(d, {
      ...dossier(), selectedOptionId: 'a',
      options: [{ id: 'a', title: 'Changed', summary: 'Changed meaning' }, { id: 'b', title: 'Option B', summary: 'Take the second path' }],
    })).toThrow(/cannot change its selected option/)
    expect(() => track.reviseDossier(d, {
      ...dossier(), selectedOptionId: 'a', recommendation: { optionId: 'b', rationale: 'Changed recommendation' },
    })).toThrow(/cannot change its recorded recommendation/)
    expect(() => track.setOutcome(d, 'no-go')).toThrow(/must use decision.select/)

    track.reviseDossier(d, { ...dossier(), selectedOptionId: 'a', context: 'Post-settlement note' })
    expect(track.state().decisions.get(d)!.dossier.context).toBe('Post-settlement note')
  })

  it('sets explicit dispositions and rejects explicit completed', () => {
    const t = feature()
    track.setDisposition(t, 'orientation', 'skipped')
    expect(track.state().items.get(t)!.disposition.orientation).toBe('skipped')
    expect(() => track.setDisposition(t, 'commitment', 'completed')).toThrow(/automatically/)
  })
})
