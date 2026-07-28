import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { EventStore } from './events/store.js'
import { ingest, type IngestContext } from './ingest/ingest.js'
import { Track } from './track.js'

let dir: string | undefined
afterEach(() => {
  if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
  dir = undefined
})

const validDossier = {
  context: 'Choose the delivery route',
  options: [
    { id: 'a', title: 'Route A', summary: 'Use the first recorded route' },
    { id: 'b', title: 'Route B', summary: 'Use the second recorded route' },
  ],
  qa: [],
  recommendation: { optionId: 'a', rationale: 'Route A has the lower risk' },
}

function setup(): { store: EventStore; track: Track; itemId: string; context: IngestContext } {
  dir = mkdtempSync(join(tmpdir(), 'track-structured-decision-'))
  const store = new EventStore(join(dir, '.track', 'events.jsonl'))
  let n = 0
  const track = new Track(store, { by: 'human:owner', newId: () => `id-${++n}` })
  const itemId = track.createItem({ kind: 'feature', title: 'Target', workspace: 'ws' })
  return {
    store,
    track,
    itemId,
    context: { by: 'human:owner', workspace: 'ws', prov: { transport: 'import', proposed: false, auth: 'local-user' } },
  }
}

describe('structured decision write boundaries', () => {
  it('rejects optionless creation and revision through both the facade and neutral ingest', () => {
    const { store, track, itemId, context } = setup()
    const legacy = { context: 'old prose', options: [], qa: [] }

    expect(() => track.createDecision({ decisionKind: 'orientation', title: 'Facade', workspace: 'ws', targets: [itemId], dossier: legacy }))
      .toThrow(/at least two options/)
    expect(() => ingest([{ v: 1, kind: 'decision.create', payload: { decisionKind: 'orientation', title: 'Ingest', workspace: 'ws', targets: [itemId], dossier: legacy } }], context, store))
      .toThrow(/at least two options/)

    const decisionId = track.createDecision({ decisionKind: 'orientation', title: 'Structured', workspace: 'ws', targets: [itemId], dossier: validDossier })
    expect(() => track.reviseDossier(decisionId, legacy)).toThrow(/at least two options/)
    expect(() => ingest([{ v: 1, kind: 'decision.dossier', payload: { decisionId, dossier: legacy } }], context, store))
      .toThrow(/at least two options/)

    // Read-only pre-enforcement event fixture: existing logs remain visible, but neither the facade nor
    // neutral ingest may create a fresh go/no-go settlement without a selected native option.
    const legacyId = 'legacy-prose-only'
    store.appendCommand([{
      id: 'legacy-prose-event', type: 'decision.created', aggregate: 'decision', aggregateId: legacyId,
      at: '2026-07-28T00:00:00.000Z', by: 'legacy-fixture',
      payload: { decisionKind: 'orientation', title: 'Legacy', workspace: 'ws', targets: [itemId], dossier: legacy },
    }])
    expect(() => new Track(store).setOutcome(legacyId, 'go')).toThrow(/unstructured legacy decision must be revised/)
    expect(() => ingest([{ v: 1, kind: 'decision.outcome', payload: { decisionId: legacyId, to: 'go' } }], context, store))
      .toThrow()
    expect(() => new Track(store).setOutcome(legacyId, 'deferred')).not.toThrow()
  })

  it('persists a selected existing option through the neutral ingest surface', () => {
    const { store, track, itemId, context } = setup()
    const decisionId = track.createDecision({ decisionKind: 'orientation', title: 'Structured', workspace: 'ws', targets: [itemId], dossier: validDossier })
    expect(ingest([{ v: 1, kind: 'decision.select', payload: { decisionId, optionId: 'b' } }], context, store).count).toBe(1)
    const decision = new Track(store).state().decisions.get(decisionId)!
    expect(decision.dossier.selectedOptionId).toBe('b')
    expect(decision.outcome).toBe('go')
  })
})
