import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { buildAdoptionPlan, type AdoptionPlan } from '../adopt/plan.js'
import { desyncFindings } from '../cli/desync.js'
import { readHead } from '../events/head.js'
import { EventStore } from '../events/store.js'
import type { CommandEvent } from '../events/types.js'
import { validate } from '../events/validate.js'
import type { DecisionCreatedPayload } from '../model/decision.js'
import { fold } from '../state/fold.js'
import { Track } from '../track.js'

export const LEGACY_LIKE_FIXTURE_DIR = resolve(import.meta.dirname, '__fixtures__', 'legacy-like-journal')
export const LEGACY_LIKE_RESOLVED_PLAN_FILE = resolve(
  import.meta.dirname,
  '__fixtures__',
  'legacy-like-journal-resolved-plan.json',
)
export const STRICT_REFUSAL_FIXTURE_FILE = resolve(
  import.meta.dirname,
  '__fixtures__',
  'owner-table-strict-refusal.txt',
)
export const LEGACY_LIKE_NOW = '2026-11-20T12:00:00.000Z'
export const LEGACY_LIKE_COMMIT = 'c1'

function makeDeterministicIdGenerator(): () => string {
  let seq = 0
  return () => `01K0FXT${String(++seq).padStart(19, '0')}`
}

/**
 * Deterministically build the legacy-like journal fixture under `trackDir`
 * (`events.jsonl` and `head.json`):
 * - 14 numbered demands (#1..#14)
 * - 13 owner-request items that never received a number
 * - 18 unsettled decisions:
 *   - 16 attached to no row (hors demande)
 *   - 15 without a dossier link (sans dossier)
 *   - 1 deferred without options (à instruire)
 *   - 1 decision holding 30 unanswered dossier questions
 */
export function buildLegacyLikeJournal(trackDir: string): void {
  mkdirSync(trackDir, { recursive: true })
  const eventsPath = join(trackDir, 'events.jsonl')
  const store = new EventStore(eventsPath)
  const nextId = makeDeterministicIdGenerator()
  let currentTime = '2026-06-08T10:00:00.000Z'

  const track = new Track(store, {
    by: 'fixture-builder',
    now: () => currentTime,
    newId: nextId,
  })

  // Technical anchor item (not an owner request, never becomes a row in the owner table).
  const techItem = track.createItem({
    kind: 'chore',
    title: 'Socle technique sans demande',
    workspace: 'ws-legacy',
  })

  // 1 deferred legacy decision without options (attached to techItem, no dossier link).
  // Built via direct EventStore.appendCommand because the current write boundary requires >= 2 options.
  const deferredNoOptId = nextId()
  store.appendCommand([
    {
      id: nextId(),
      type: 'decision.created',
      aggregate: 'decision',
      aggregateId: deferredNoOptId,
      at: currentTime,
      by: 'fixture-builder',
      payload: {
        decisionKind: 'commitment',
        title: 'Arbitrage historique reporté sans options',
        workspace: 'ws-legacy',
        targets: [techItem],
        dossier: {
          context: 'Ancienne décision sans options structurées.',
          options: [],
          qa: [],
        },
      },
    },
  ])
  currentTime = '2026-06-09T10:00:00.000Z'
  track.setOutcome(deferredNoOptId, 'deferred')

  // 14 numbered demands (#1..#14).
  const demandIds: string[] = []
  for (let n = 1; n <= 14; n++) {
    const day = String(n).padStart(2, '0')
    currentTime = `2026-10-${day}T09:00:00.000Z`
    const demandId = track.raiseDemand({
      type: 'feature',
      workspace: 'ws-legacy',
      raw: { text: `Demande produit numéro ${n}` },
      source: { kind: 'human' },
    })
    track.numberDemand(demandId, n)
    demandIds.push(demandId)
  }

  // 13 owner-request items that never received a number.
  for (let i = 1; i <= 13; i++) {
    const day = String(15 + i).padStart(2, '0')
    currentTime = `2026-10-${day}T11:00:00.000Z`
    const itemId = track.createItem({
      kind: 'feature',
      title: `Sujet historique ${i}`,
      workspace: 'ws-legacy',
    })
    track.setReportStatus(itemId, {
      status: 'not-started',
      ownerRequest: `Demande historique sans numéro ${i}`,
    })
  }

  // Pre-lot-2 structured decisions (no `decision.owner-numbered` event): emitted directly through
  // `EventStore.appendCommand` with the exact pre-lot-2 batch layout so the committed legacy fixture
  // remains byte-identical and exercises class E9 (`decision-unnumbered`) after lot 2.
  const appendPreLot2Decision = (input: DecisionCreatedPayload): string => {
    const decisionId = nextId()
    const blockerSpecs = input.targets.map((targetId) => ({ blockerId: nextId(), targetId }))
    const at = currentTime
    const batch: CommandEvent[] = [
      {
        id: nextId(),
        type: 'decision.created',
        aggregate: 'decision',
        aggregateId: decisionId,
        at,
        by: 'fixture-builder',
        payload: { ...input },
      },
      ...blockerSpecs.map(({ blockerId, targetId }) => ({
        id: nextId(),
        type: 'blocker.opened' as const,
        aggregate: 'blocker' as const,
        aggregateId: blockerId,
        at,
        by: 'fixture-builder',
        payload: {
          blockerId,
          targetId,
          kind: 'decision',
          ref: decisionId,
          reason: `awaiting ${input.decisionKind} decision`,
        },
      })),
    ]
    store.appendCommand(batch, { cmdId: nextId() })
    return decisionId
  }

  // 2 decisions attached to numbered demands #1 and #2, without dossier links (2 sans dossier).
  for (let i = 0; i < 2; i++) {
    currentTime = `2026-11-0${i + 1}T10:00:00.000Z`
    appendPreLot2Decision({
      decisionKind: 'commitment',
      title: `Choix rattaché à la demande ${i + 1} ?`,
      workspace: 'ws-legacy',
      targets: [demandIds[i]!],
      dossier: {
        context: `Contexte pour la demande ${i + 1}.`,
        qa: [],
        options: [
          { id: 'a', title: 'Option A', summary: 'Conséquence A' },
          { id: 'b', title: 'Option B', summary: 'Conséquence B' },
        ],
        recommendation: { optionId: 'a', rationale: 'Solution la plus directe' },
      },
    })
  }

  // 12 pending decisions outside any row, without dossier links (+12 hors demande, +12 sans dossier).
  for (let i = 1; i <= 12; i++) {
    const day = String(2 + i).padStart(2, '0')
    currentTime = `2026-11-${day}T10:00:00.000Z`
    appendPreLot2Decision({
      decisionKind: 'orientation',
      title: `Décision hors demande sans dossier ${i} ?`,
      workspace: 'ws-legacy',
      targets: [techItem],
      dossier: {
        context: `Contexte de la décision ${i}.`,
        qa: [],
        options: [
          { id: 'a', title: 'Conserver', summary: 'Garde le comportement actuel' },
          { id: 'b', title: 'Faire évoluer', summary: 'Ouvre une évolution dédiée' },
        ],
        recommendation: { optionId: 'a', rationale: 'Moindre risque immédiat' },
      },
    })
  }

  // 3 pending decisions outside any row WITH dossier links (+3 hors demande, +0 sans dossier).
  // The first of these holds 30 unanswered dossier questions.
  const thirtyOpenQuestions = Array.from({ length: 30 }, (_, idx) => ({
    id: `q${idx + 1}`,
    question: `Question de dossier ouverte ${idx + 1} ?`,
  }))
  for (let i = 1; i <= 3; i++) {
    const day = String(16 + i).padStart(2, '0')
    currentTime = `2026-11-${day}T14:00:00.000Z`
    appendPreLot2Decision({
      decisionKind: 'commitment',
      title: `Décision hors demande avec dossier ${i} ?`,
      workspace: 'ws-legacy',
      targets: [techItem],
      dossier: {
        context: `Contexte documenté ${i}.`,
        qa: i === 1 ? thirtyOpenQuestions : [],
        options: [
          { id: 'a', title: 'Valider', summary: 'Poursuit selon le dossier' },
          { id: 'b', title: 'Différer', summary: 'Reporte la décision' },
        ],
        recommendation: { optionId: 'a', rationale: 'Conforme au cadrage' },
        artifacts: [{ kind: 'rendered-view', viewRef: `docs/dossiers/legacy-decision-${i}.md` }],
      },
    })
  }
}

/**
 * Deterministically resolve every `to-decide` entry of the legacy-like journal adoption plan.
 * Attaches outside-demand decisions to item-backed rows (#15..#27), instructs the legacy optionless
 * decision, and supplies clean dossier links without settling or archiving any decision.
 */
export function buildLegacyLikeResolvedPlan(trackDir: string): AdoptionPlan {
  const plan = buildAdoptionPlan(join(trackDir, 'events.jsonl'), {
    baselineCommit: LEGACY_LIKE_COMMIT,
    now: LEGACY_LIKE_NOW,
  })
  let nextAttachRow = 15
  let dossierSeq = 0
  const entries = plan.entries.map((entry) => {
    if (entry.kind === 'mechanical') return entry
    if (entry.action === 'attach-decision') {
      const rowNumber = nextAttachRow
      nextAttachRow = nextAttachRow < 27 ? nextAttachRow + 1 : 15
      return { ...entry, resolution: { rowNumber } }
    }
    if (entry.action === 'instruct-decision') {
      return {
        ...entry,
        resolution: {
          options: [
            { id: 'a', title: 'Option A', summary: 'Maintenir la trajectoire existante' },
            { id: 'b', title: 'Option B', summary: 'Revoir le périmètre ultérieurement' },
          ],
          recommendation: {
            optionId: 'a',
            rationale: 'Option recommandée pour conserver la continuité',
          },
        },
      }
    }
    if (entry.action === 'attach-dossier') {
      dossierSeq += 1
      return {
        ...entry,
        resolution: {
          dossierLink: `docs/dossiers/adopted-decision-${dossierSeq}.md`,
        },
      }
    }
    return entry
  })
  return {
    ...plan,
    counts: {
      ...plan.counts,
      unresolved: entries.filter(
        (e) => e.kind === 'to-decide' && (e.resolution === undefined || e.resolution === null),
      ).length,
    },
    entries,
  }
}

describe('legacy-like-journal fixture', () => {
  it('committed fixture data matches the deterministic builder byte for byte and is intact with zero desync', () => {
    expect(existsSync(join(LEGACY_LIKE_FIXTURE_DIR, 'events.jsonl'))).toBe(true)
    expect(existsSync(join(LEGACY_LIKE_FIXTURE_DIR, 'head.json'))).toBe(true)

    const scratch = mkdtempSync(join(tmpdir(), 'track-legacy-fixture-'))
    try {
      const builtDir = join(scratch, '.track')
      buildLegacyLikeJournal(builtDir)

      for (const name of ['events.jsonl', 'head.json']) {
        const committed = readFileSync(join(LEGACY_LIKE_FIXTURE_DIR, name), 'utf8')
        const rebuilt = readFileSync(join(builtDir, name), 'utf8')
        expect(committed, `${name} drifted from builder`).toBe(rebuilt)
      }

      const eventsPath = join(builtDir, 'events.jsonl')
      const events = new EventStore(eventsPath).readAll()
      const integrity = validate(events, readHead(eventsPath))
      expect(integrity.ok, JSON.stringify(integrity.findings)).toBe(true)

      const state = fold(events)
      expect(desyncFindings(state, scratch)).toEqual([])
      expect(state.demands.size).toBe(14)
      expect(state.decisions.size).toBe(18)
      const openQuestions = [...state.decisions.values()].reduce(
        (sum, d) => sum + d.dossier.qa.filter((q) => !q.answer || q.answer.trim() === '').length,
        0,
      )
      expect(openQuestions).toBe(30)

      expect(existsSync(LEGACY_LIKE_RESOLVED_PLAN_FILE)).toBe(true)
      const committedPlan = readFileSync(LEGACY_LIKE_RESOLVED_PLAN_FILE, 'utf8')
      const rebuiltPlan = `${JSON.stringify(buildLegacyLikeResolvedPlan(builtDir), null, 2)}\n`
      expect(committedPlan, 'legacy-like-journal-resolved-plan.json drifted from builder').toBe(rebuiltPlan)
    } finally {
      rmSync(scratch, { recursive: true, force: true })
    }
  })
})
