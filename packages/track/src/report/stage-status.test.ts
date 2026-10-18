// Lot 1 (D2, D5–D9, P1, P3, P6) — D6's single precedence table and qualification
// witnesses. Every row and overlap of the table, especially: in-progress with
// no gate and unknown acceptance is colourless `not-qualified` (never orange);
// a bare stored green is not a witness; done without accepted conformity is
// not green; a live gate overrides green while a pending dossier stays
// visible; withdrawn stays colourless even with a gate; reopening voids
// earlier qualification and stage until a newer witness requalifies.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { EventStore } from '../events/store.js'
import { fold } from '../state/fold.js'
import { Track } from '../track.js'
import { deriveItemStageStatus, STATUS_HEALTH, type ItemStageStatus } from './stage-status.js'

let dir: string
let store: EventStore
let track: Track
let instant: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'track-stage-status-'))
  store = new EventStore(join(dir, 'events.jsonl'))
  instant = '2026-10-10T12:00:00.000Z'
  track = new Track(store, { by: 'test-stage-status', now: () => instant })
})

afterEach(() => rmSync(dir, { recursive: true, force: true }))

const at = (value: string, act: () => void): void => {
  instant = value
  act()
}

const item = (title = 'tracked work', extra: Record<string, unknown> = {}): string =>
  track.createItem({ kind: 'feature', title, workspace: 'ws', ...extra })

function derive(id: string): ItemStageStatus {
  const events = store.readAll()
  const state = fold(events)
  const itemState = state.items.get(id)
  expect(itemState).toBeDefined()
  return deriveItemStageStatus(state, events, itemState!, 'c1')
}

function structuredDecision(id: string): string {
  return track.createDecision({
    decisionKind: 'commitment',
    title: 'Share the connector?',
    workspace: 'ws',
    targets: [id],
    dossier: {
      context: 'The choice changes connection handling.',
      qa: [],
      options: [
        { id: 'a', title: 'Share', summary: 'One connection' },
        { id: 'b', title: 'Isolate', summary: 'One connection per session' },
      ],
      recommendation: { optionId: 'a', rationale: 'Fewer connections' },
    },
  })
}

function acceptancePass(id: string): void {
  const criterion = track.addCriterion(id, 'the work holds under retry')
  const evidence = track.linkEvidence(criterion, 'e2e', 'https://example.test/run/1')
  track.recordRun(evidence, { commit: 'c1', env: 'ci', runner: 'ci', result: 'pass' })
}

describe('D6 precedence — status codes', () => {
  it('in-progress, no gate, unknown acceptance, never qualified ⇒ not-qualified without colour', () => {
    const id = item()
    track.setRealization(id, 'in-progress')
    expect(derive(id).status).toBe('not-qualified')
    expect(STATUS_HEALTH['not-qualified']).toBeUndefined()
  })

  it('a qualifying recorded assertion ⇒ progressing green', () => {
    const id = item()
    track.setRealization(id, 'in-progress')
    track.setReportStatus(id, { status: 'progressing', facts: 'Correctif en cours, recette de régression ouverte.' })
    const derived = derive(id)
    expect(derived.status).toBe('progressing')
    expect(STATUS_HEALTH[derived.status]).toBe('🟢')
  })

  it('a bare stored green without facts is insufficient', () => {
    const id = item()
    track.setRealization(id, 'in-progress')
    track.setReportStatus(id, { status: 'progressing' })
    expect(derive(id).status).toBe('not-qualified')
  })

  it('done without accepted conformity is not green; done with acceptance pass is', () => {
    const bare = item('bare delivery')
    track.setRealization(bare, 'in-progress')
    track.setRealization(bare, 'done')
    expect(derive(bare).status).toBe('not-qualified')

    const verified = item('verified delivery')
    track.setRealization(verified, 'in-progress')
    acceptancePass(verified)
    track.setRealization(verified, 'done')
    expect(derive(verified).status).toBe('progressing')
  })

  it('a live non-decision gate overrides green while the pending dossier stays visible', () => {
    const id = item()
    track.setRealization(id, 'in-progress')
    track.setReportStatus(id, { status: 'progressing', facts: 'Avancement constaté.' })
    expect(derive(id).status).toBe('progressing')
    const decisionId = structuredDecision(id)
    const dep = item('external prerequisite')
    track.openBlocker({ targetId: id, kind: 'dependency', ref: dep, reason: 'Waiting on the other lane' })
    const derived = derive(id)
    expect(derived.status).toBe('blocked')
    expect(STATUS_HEALTH[derived.status]).toBe('🔴')
    expect(derived.blueDossierIds).toContain(decisionId)
  })

  it('acceptance fail overrides green', () => {
    const id = item()
    track.setRealization(id, 'in-progress')
    track.setReportStatus(id, { status: 'progressing', facts: 'Avancement constaté.' })
    const criterion = track.addCriterion(id, 'the work holds under retry')
    const evidence = track.linkEvidence(criterion, 'e2e', 'https://example.test/run/1')
    track.recordRun(evidence, { commit: 'c1', env: 'ci', runner: 'ci', result: 'fail' })
    expect(derive(id).status).toBe('blocked')
  })

  it('an effective decision gate on a pending structured dossier ⇒ decision-awaited blue', () => {
    const id = item()
    track.setRealization(id, 'in-progress')
    const decisionId = structuredDecision(id)
    track.openBlocker({ targetId: id, kind: 'decision', ref: decisionId, reason: 'Owner choice pending' })
    const derived = derive(id)
    expect(derived.status).toBe('decision-awaited')
    expect(STATUS_HEALTH[derived.status]).toBe('🔵')
    expect(derived.blueDossierIds).toEqual([decisionId])
  })

  it('a gate pointing at a settled dossier is structuring work, never blue and never green', () => {
    const id = item()
    track.setRealization(id, 'in-progress')
    track.setReportStatus(id, { status: 'progressing', facts: 'Avancement constaté.' })
    const decisionId = structuredDecision(id)
    track.selectDecisionOption(decisionId, 'a', 'go')
    track.openBlocker({ targetId: id, kind: 'decision', ref: decisionId, reason: 'Stale pointer at a settled dossier' })
    const derived = derive(id)
    expect(derived.status).toBe('not-qualified')
    expect(derived.unanswerableDecisionGate).toBe(true)
    expect(derived.blueDossierIds).toEqual([])
  })

  it('withdrawn stays colourless even with a live gate', () => {
    const id = item()
    track.setRealization(id, 'in-progress')
    track.setRealization(id, 'cancelled')
    const dep = item('external prerequisite')
    track.openBlocker({ targetId: id, kind: 'dependency', ref: dep, reason: 'Still referenced' })
    const derived = derive(id)
    expect(derived.status).toBe('withdrawn')
    expect(STATUS_HEALTH[derived.status]).toBeUndefined()
  })

  it('no event is never orange: a fresh to-do item is not-qualified', () => {
    const derived = derive(item())
    expect(derived.status).toBe('not-qualified')
    expect(STATUS_HEALTH[derived.status]).toBeUndefined()
  })

  it('stale acceptance is an unforeseen fact, never silence', () => {
    const id = item()
    track.setRealization(id, 'in-progress')
    const criterion = track.addCriterion(id, 'the work holds under retry')
    const evidence = track.linkEvidence(criterion, 'e2e', 'https://example.test/run/1')
    track.recordRun(evidence, { commit: 'other-baseline', env: 'ci', runner: 'ci', result: 'pass' })
    const derived = derive(id)
    expect(derived.status).toBe('unforeseen')
    expect(STATUS_HEALTH[derived.status]).toBe('🟠')
  })
})

describe('reopening requalifies qualification and stage', () => {
  it('a reopening voids earlier qualification until a newer witness requalifies', () => {
    const id = item()
    at('2026-10-10T12:00:00.000Z', () => {
      track.setRealization(id, 'in-progress')
      track.setReportStatus(id, { status: 'progressing', facts: 'Avancement constaté.' })
    })
    expect(derive(id).status).toBe('progressing')
    at('2026-10-11T12:00:00.000Z', () => {
      track.setRealization(id, 'done')
      track.reopenItem(id, { motive: 'regression-observed', reason: 'The fix broke again' })
    })
    expect(derive(id).status).toBe('unforeseen')
    at('2026-10-12T12:00:00.000Z', () => {
      track.setReportStatus(id, { status: 'progressing', facts: 'Repaired and re-verified.' })
    })
    expect(derive(id).status).toBe('progressing')
  })

  it('acceptance runs must postdate the last reopening to qualify', () => {
    const id = item()
    at('2026-10-10T12:00:00.000Z', () => {
      track.setRealization(id, 'in-progress')
      acceptancePass(id)
    })
    expect(derive(id).status).toBe('progressing')
    at('2026-10-11T12:00:00.000Z', () => {
      track.setRealization(id, 'done')
      track.reopenItem(id, { motive: 'regression-observed', reason: 'The fix broke again' })
    })
    expect(derive(id).status).toBe('unforeseen')
  })
})

describe('D5 — stage requires recorded evidence', () => {
  it.each([
    ['pr-open', 'pr'],
    ['pr-merged', 'merged'],
    ['deployed', 'deployed'],
  ])('derives stage %s from explicit link kind %s with its locator as evidence', (kind, stage) => {
    const id = item('linked work', { links: [{ kind, locator: 'https://example.test/evidence/42' }] })
    const derived = derive(id)
    expect(derived.stage).toBe(stage)
    expect(derived.stageEvidence).toBe('https://example.test/evidence/42')
  })

  it('a release publication does not prove deployment; done alone does not prove a merge', () => {
    const released = item('released work', { links: [{ kind: 'release-published', locator: 'https://example.test/r/7' }] })
    expect(derive(released).stage).toBe('spec')
    const done = item('finished work')
    track.setRealization(done, 'in-progress')
    track.setRealization(done, 'done')
    expect(derive(done).stage).toBe('dev')
  })

  it('a reopening voids a derived high stage until a fresh stored stage requalifies', () => {
    const id = item('linked work', { links: [{ kind: 'pr-merged', locator: 'https://example.test/pr/1' }] })
    expect(derive(id).stage).toBe('merged')
    at('2026-10-11T12:00:00.000Z', () => {
      track.setRealization(id, 'in-progress')
      track.setRealization(id, 'done')
      track.reopenItem(id, { motive: 'regression-observed', reason: 'The merge broke main' })
    })
    const voided = derive(id)
    expect(voided.stage).toBe('dev')
    expect(voided.stageEvidence).toBeUndefined()
    expect(voided.stageVoidedByReopening).toBe(true)
    at('2026-10-12T12:00:00.000Z', () => {
      track.setReportStatus(id, {
        status: 'progressing',
        facts: 'Repaired.',
        stage: { value: 'pr', evidence: 'https://example.test/pr/fix' },
      })
    })
    const requalified = derive(id)
    expect(requalified.stage).toBe('pr')
    expect(requalified.stageEvidence).toBe('https://example.test/pr/fix')
    expect(requalified.stageVoidedByReopening).toBe(false)
  })

  it('a fresh assertion without a stage keeps the voided link silent at dev', () => {
    const id = item('linked work', { links: [{ kind: 'pr-merged', locator: 'https://example.test/pr/1' }] })
    at('2026-10-11T12:00:00.000Z', () => {
      track.setRealization(id, 'in-progress')
      track.setRealization(id, 'done')
      track.reopenItem(id, { motive: 'regression-observed', reason: 'The merge broke main' })
    })
    expect(derive(id).stageVoidedByReopening).toBe(true)
    at('2026-10-12T12:00:00.000Z', () => {
      track.setReportStatus(id, { status: 'progressing', facts: 'Repaired.' })
    })
    const requalified = derive(id)
    expect(requalified.stage).toBe('dev')
    expect(requalified.stageEvidence).toBeUndefined()
    expect(requalified.stageVoidedByReopening).toBe(false)
    expect(requalified.status).toBe('progressing')
  })

  it('a stored stage with evidence is honoured before any reopening', () => {
    const id = item()
    track.setReportStatus(id, {
      status: 'progressing',
      facts: 'Avancement constaté.',
      stage: { value: 'pr', evidence: 'https://example.test/pull/9' },
    })
    const derived = derive(id)
    expect(derived.stage).toBe('pr')
    expect(derived.stageEvidence).toBe('https://example.test/pull/9')
  })
})

describe('legacy French stage values are read-compatible and rejected on write', () => {
  it('historical mergé/déployé/PR events read as neutral merged/deployed/pr codes', () => {
    const id = item('legacy staged work')
    for (const [legacy, neutral] of [['mergé', 'merged'], ['déployé', 'deployed'], ['PR', 'pr']] as const) {
      store.appendCommand([{
        id: `legacy-${legacy}`,
        type: 'item.report-updated',
        aggregate: 'item',
        aggregateId: id,
        at: '2026-10-09T12:00:00.000Z',
        by: 'test-stage-status',
        payload: { stage: { value: legacy, evidence: 'https://example.test/legacy' } },
      }])
      expect(fold(store.readAll()).items.get(id)?.report?.stage?.value).toBe(neutral)
      expect(derive(id).stage).toBe(neutral)
    }
  })

  it('rejects invalid report assertions on write without touching the log', () => {
    const id = item()
    const before = store.readAll().length
    const invalid = [
      null,
      [],
      { status: 'purple' },
      { stage: { value: 'merged' } },
      { stage: { value: 'mergé' } },
      { proposal: 2 },
      { unknown: true },
      { decisionExpectations: { question: 'Q' } },
    ]
    for (const report of invalid) {
      expect(() => track.setReportStatus(id, report as never)).toThrow()
    }
    expect(store.readAll()).toHaveLength(before)
  })

  it('new writes reject French stage values', () => {
    const id = item()
    for (const legacy of ['mergé', 'déployé', 'PR']) {
      expect(() => track.setReportStatus(id, {
        stage: { value: legacy as never, evidence: 'https://example.test/x' },
      })).toThrow()
    }
    expect(fold(store.readAll()).items.get(id)?.report).toBeUndefined()
  })
})
