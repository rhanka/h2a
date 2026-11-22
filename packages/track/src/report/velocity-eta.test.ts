import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, vi } from 'vitest'

import { runCli } from '../cli/index.js'
import { EventStore } from '../events/store.js'
import { validate } from '../events/validate.js'
import { ENGRAM_STAGE_STATUS_ALIGNMENT, graphExportFromState } from '../graph-export.js'
import { DomainError } from '../model/item.js'
import { REPORT_STAGES, REPORT_STATUSES } from '../model/report-status.js'
import { TrackReader } from '../read/contract.js'
import { Track } from '../track.js'
import {
  auditOwnerTable,
  formatOwnerEtaCell,
  formatOwnerStatusCell,
  projectOwnerTable,
  renderOwnerTable,
} from './owner-table.js'
import { deriveItemStageStatus } from './stage-status.js'
import {
  evaluateEtaDeadline,
  parseEtaEndOfDayMs,
  qualifyVelocityEta,
  type VelocityEtaBindingInput,
} from './velocity-eta.js'

function withTempTrack<T>(fn: (ctx: { dir: string; eventsPath: string; track: Track }) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'track-velocity-eta-'))
  const eventsPath = join(dir, '.track', 'events.jsonl')
  try {
    const store = new EventStore(eventsPath)
    const track = new Track(store, { by: 'test-actor', now: () => '2026-11-14T12:00:00.000Z' })
    return fn({ dir, eventsPath, track })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function qualifiedBaseInput(targetStage: VelocityEtaBindingInput['targetStage'] = 'merged'): VelocityEtaBindingInput {
  return {
    targetStage,
    forecast: {
      quantiles: {
        p50Seconds: 86400,
        p80Seconds: 172800, // +2 days => 2026-11-16
        p95Seconds: 259200,
      },
      predictedAt: '2026-11-14T00:00:00.000Z',
      evidenceCutoff: '2026-11-13T23:00:00.000Z',
      support: 'descriptive',
      sampleCount: 18,
    },
    plan: {
      openGates: [],
      capacities: { default: 2 },
    },
    knowledge: {
      applicability: 'applicable',
      historyPreserved: true,
      boundsNewRegime: true,
      lockedDigest: 'digest-v1',
      currentDigest: 'digest-v1',
    },
  }
}

describe('PR-B — ETA journal with slips, velocity estimator qualification (#376) & Engram alignment', () => {
  it('records append-only ETA journal entries on demands and items, preserving initialWhen and slips', () => {
    withTempTrack(({ eventsPath, track }) => {
      const demandId = track.raiseDemand({
        type: 'feature',
        raw: { text: 'Livrer le tableau owner', title: 'Tableau owner' },
        source: { kind: 'human', actor: 'owner' },
        workspace: 'ws-eta',
      })
      track.numberDemand(demandId, 1)
      track.updateDemandOwnerSummary(demandId, {
        summary: 'Tableau unique de suivi owner',
        requestedStage: 'prod',
      })
      track.claimDemand(demandId)
      const [itemId] = track.agreeDemand(demandId, {
        items: [
          {
            title: 'Lot tableau owner',
            links: [{ kind: 'pr-open', locator: 'PR #456' }],
          },
        ],
      })
      track.setSpec(itemId!, 'specified')
      track.setRealization(itemId!, 'in-progress')
      track.setReportStatus(itemId!, {
        stage: { value: 'pr', evidence: 'PR #456' },
        status: 'on-track',
        facts: 'PR #456 ouverte et vérifiée',
        nextAction: 'Revue finale (équipe)',
      })

      // 1. Initial committed ETA: 2026-11-15
      track.setDemandEta(demandId, {
        targetStage: 'prod',
        targetLabel: 'MEP',
        when: '2026-11-15',
        source: 'committed',
        by: 'équipe Track',
      })

      let state = track.state()
      let journal = state.demands.get(demandId)?.etaJournal
      assert.equal(journal?.length, 1)
      assert.equal(journal?.[0]?.initialWhen, '2026-11-15')
      assert.equal(journal?.[0]?.when, '2026-11-15')
      assert.equal(journal?.[0]?.slips.length, 0)
      assert.equal(journal?.[0]?.slip, undefined)

      // 2. Slip ETA to 2026-11-18 without a rebaseline decision -> preserves initialWhen = 2026-11-15, records slip, turns row 🟠 dérive
      track.setDemandEta(demandId, {
        targetStage: 'prod',
        targetLabel: 'MEP',
        when: '2026-11-18',
        source: 'committed',
        by: 'équipe Track',
        reason: 'attente qualification CI',
      })

      state = track.state()
      journal = state.demands.get(demandId)?.etaJournal
      assert.equal(journal?.[0]?.initialWhen, '2026-11-15')
      assert.equal(journal?.[0]?.when, '2026-11-18')
      assert.equal(journal?.[0]?.slips.length, 1)
      assert.equal(journal?.[0]?.slips[0]?.fromWhen, '2026-11-15')
      assert.equal(journal?.[0]?.slips[0]?.toWhen, '2026-11-18')
      assert.deepEqual(journal?.[0]?.slip, {
        initialWhen: '2026-11-15',
        reason: 'attente qualification CI',
      })

      const reader = new TrackReader(eventsPath)
      const view = reader.ownerTable({ workspace: 'ws-eta', now: '2026-11-14T12:00:00.000Z' })
      assert.equal(view.rows.length, 1)
      assert.equal(view.rows[0]?.status, 'unforeseen')
      assert.equal(formatOwnerStatusCell(view.rows[0]!), '🟠 dérive')
      assert.equal(
        formatOwnerEtaCell(view.rows[0]!.etas),
        'prod (MEP) → 2026-11-18 (engagé : équipe Track, glissement depuis 2026-11-15)',
      )

      const rendered = renderOwnerTable(view, 'md')
      assert.ok(rendered.includes('🟠 dérive'))
      assert.ok(rendered.includes('glissement depuis 2026-11-15'))

      // 3. Rebaseline with a settled 'go' decision targeting the item/demand clears the slip and re-anchors initialWhen
      const decisionId = track.createDecision({
        decisionKind: 'commitment',
        title: 'Rebaseliner la MEP au 2026-11-20',
        workspace: 'ws-eta',
        targets: [itemId!],
        dossier: {
          context: 'Nouveau jalon validé',
          options: [
            { id: 'opt-a', title: 'Valider 2026-11-20', summary: 'Nouvelle cible MEP' },
            { id: 'opt-b', title: 'Maintenir 2026-11-15', summary: 'Conserver le glissement' },
          ],
          qa: [],
          recommendation: { optionId: 'opt-a', rationale: 'Alignement complet' },
        },
      })
      track.selectDecisionOption(decisionId, 'opt-a', 'go')

      track.setDemandEta(demandId, {
        targetStage: 'prod',
        targetLabel: 'MEP',
        when: '2026-11-20',
        source: 'committed',
        by: 'owner',
        rebaselineDecisionId: decisionId,
      })

      const rebaselinedView = new TrackReader(eventsPath).ownerTable({
        workspace: 'ws-eta',
        now: '2026-11-14T12:00:00.000Z',
      })
      assert.equal(rebaselinedView.rows[0]?.status, 'on-track')
      assert.equal(formatOwnerStatusCell(rebaselinedView.rows[0]!), '🔵 sur la voie')
      assert.equal(
        formatOwnerEtaCell(rebaselinedView.rows[0]!.etas),
        'prod (MEP) → 2026-11-20 (engagé : owner)',
      )

      // Integrity validation remains 100% green
      const events = new EventStore(eventsPath).readAll()
      assert.equal(validate(events).ok, true)
    })
  })

  it('detects past-due missed ETAs by default (without --now) and at --now, turning the row 🟠 dérive unless paused by owner with a decision', () => {
    withTempTrack(({ dir, eventsPath, track }) => {
      const itemId = track.createItem({
        kind: 'feature',
        title: 'Livraison spec API',
        workspace: 'ws-overdue',
        links: [{ kind: 'brainstorm', locator: 'docs/brainstorm.md' }],
      })
      track.setRealization(itemId, 'in-progress')
      track.setReportStatus(itemId, {
        ownerNumber: 1,
        ownerSummary: 'Spécification API v2',
        requestedStage: 'spec',
        stage: { value: 'brainstorm', evidence: 'docs/brainstorm.md' },
        status: 'on-track',
        facts: 'Cadrage terminé (docs/brainstorm.md)',
        nextAction: 'Rédiger la spec (équipe)',
      })
      track.setItemEta(itemId, {
        targetStage: 'spec',
        when: '2026-11-01',
        source: 'committed',
        by: 'équipe API',
      })

      const reader = new TrackReader(eventsPath)
      // Before deadline (2026-10-30): on-track
      const beforeView = reader.ownerTable({ workspace: 'ws-overdue', now: '2026-10-30T12:00:00.000Z' })
      assert.equal(beforeView.rows[0]?.status, 'on-track')
      assert.equal(formatOwnerEtaCell(beforeView.rows[0]!.etas), 'spec → 2026-11-01 (engagé : équipe API)')

      // Default (without --now): uses system clock (> 2026-11-01), turns 🟠 dérive and records slip (Finding 11 / E2)
      const defaultNowView = reader.ownerTable({ workspace: 'ws-overdue' })
      assert.equal(defaultNowView.rows[0]?.status, 'unforeseen')
      assert.equal(formatOwnerStatusCell(defaultNowView.rows[0]!), '🟠 dérive')
      assert.equal(
        formatOwnerEtaCell(defaultNowView.rows[0]!.etas),
        'spec → 2026-11-01 (dépassé : 2026-11-01, engagé : équipe API)',
      )

      // When paused by owner with a settled decision, missed-ETA clock is frozen (stays ⚪ en pause)
      const pauseDecId = track.createDecision({
        decisionKind: 'commitment',
        title: 'Mettre en pause la spec API v2',
        workspace: 'ws-overdue',
        targets: [itemId],
        dossier: {
          context: 'Priorité déplacée',
          options: [
            { id: 'opt-a', title: 'Mettre en pause', summary: 'Geler la cible' },
            { id: 'opt-b', title: 'Continuer', summary: 'Maintenir la cible' },
          ],
          qa: [],
          recommendation: { optionId: 'opt-a', rationale: 'Choix owner' },
        },
      })
      track.selectDecisionOption(pauseDecId, 'opt-a', 'go')

      track.setReportStatus(itemId, {
        ownerNumber: 1,
        ownerSummary: 'Spécification API v2',
        requestedStage: 'spec',
        stage: { value: 'brainstorm', evidence: 'docs/brainstorm.md' },
        status: 'not-started',
        pausedByOwner: true,
        pauseDecisionId: pauseDecId,
        facts: 'Cadrage terminé (docs/brainstorm.md)',
        nextAction: 'En pause (choix owner)',
      })
      const pausedView = new TrackReader(eventsPath).ownerTable({
        workspace: 'ws-overdue',
        now: '2026-11-17T09:00:00.000Z',
      })
      assert.equal(pausedView.rows[0]?.status, 'not-started')
      assert.equal(formatOwnerStatusCell(pausedView.rows[0]!), '⚪ en pause')

      // CLI `track item eta` works cleanly with ISO date
      const out: string[] = []
      const err: string[] = []
      const rc = runCli(
        [
          'item',
          'eta',
          itemId,
          '--target-stage',
          'spec',
          '--when',
          '2026-11-22',
          '--source',
          'committed',
          '--by',
          'équipe API',
          '--reason',
          'reprise',
        ],
        { cwd: dir, out: (s) => out.push(s), err: (s) => err.push(s) },
      )
      assert.equal(rc, 0)
      assert.equal(err.join(''), '')
    })
  })

  it('enforces ETA slot invariants: targetStage-only key (E6), earlier date not a slip (E7), item report etas through journal (E8), rebaseline target (E10), never evict slipped slot (E5), ISO dates only (E9)', () => {
    withTempTrack(({ eventsPath, track }) => {
      const itemId = track.createItem({
        kind: 'feature',
        title: 'Lot invariants ETA',
        workspace: 'ws-inv',
        links: [{ kind: 'pr-open', locator: 'PR #457' }],
      })
      track.setRealization(itemId, 'in-progress')
      track.setReportStatus(itemId, {
        ownerNumber: 1,
        ownerSummary: 'Vérification des invariants du journal ETA',
        stage: { value: 'pr', evidence: 'PR #457' },
        status: 'on-track',
        facts: 'PR #457 en revue',
        nextAction: 'Finaliser la revue (équipe)',
      })

      // E9 (Finding 26): yearless DD/MM is rejected on write and not guessed by parseEtaEndOfDayMs
      assert.throws(
        () =>
          track.setItemEta(itemId, {
            targetStage: 'prod',
            when: '15/01',
            source: 'committed',
            by: 'équipe',
          }),
        DomainError,
      )
      assert.equal(parseEtaEndOfDayMs('15/01', '2026-11-14T12:00:00.000Z'), undefined)

      // E7 (Finding 22): advancing an ETA to an earlier date is NOT a slip
      track.setItemEta(itemId, {
        targetStage: 'prod',
        targetLabel: 'MEP',
        when: '2026-11-20',
        source: 'committed',
        by: 'équipe',
      })
      track.setItemEta(itemId, {
        targetStage: 'prod',
        targetLabel: 'MEP',
        when: '2026-11-18',
        source: 'committed',
        by: 'équipe',
      })
      let journal = track.state().items.get(itemId)?.etaJournal
      assert.equal(journal?.length, 1)
      assert.equal(journal?.[0]?.when, '2026-11-18')
      assert.equal(journal?.[0]?.initialWhen, '2026-11-18')
      assert.equal(journal?.[0]?.slip, undefined)
      assert.equal(journal?.[0]?.slips.length, 0)
      let view = new TrackReader(eventsPath).ownerTable({
        workspace: 'ws-inv',
        now: '2026-11-14T12:00:00.000Z',
      })
      assert.equal(view.rows[0]?.status, 'on-track')

      // E6 (Finding 21): changing targetLabel on the same targetStage updates the SAME slot and records a slip
      track.setItemEta(itemId, {
        targetStage: 'prod',
        when: '2026-11-25',
        source: 'committed',
        by: 'équipe',
        reason: 'décalage MEP',
      })
      journal = track.state().items.get(itemId)?.etaJournal
      assert.equal(journal?.length, 1)
      assert.equal(journal?.[0]?.initialWhen, '2026-11-18')
      assert.equal(journal?.[0]?.when, '2026-11-25')
      assert.equal(journal?.[0]?.slip?.initialWhen, '2026-11-18')
      view = new TrackReader(eventsPath).ownerTable({
        workspace: 'ws-inv',
        now: '2026-11-14T12:00:00.000Z',
      })
      assert.equal(view.rows[0]?.status, 'unforeseen')

      // E5 (Finding 12 / Carbon P2-1): setting ETAs on 2 other stages never evicts the slipped `prod` slot
      track.setItemEta(itemId, {
        targetStage: 'merged',
        when: '2026-11-19',
        source: 'committed',
        by: 'équipe',
      })
      track.setItemEta(itemId, {
        targetStage: 'preprod',
        when: '2026-11-21',
        source: 'committed',
        by: 'équipe',
      })
      journal = track.state().items.get(itemId)?.etaJournal
      assert.equal(journal?.length, 2)
      assert.ok(journal?.some((e) => e.targetStage === 'prod' && e.slip?.initialWhen === '2026-11-18'))
      assert.ok(journal?.some((e) => e.targetStage === 'preprod'))
      view = new TrackReader(eventsPath).ownerTable({
        workspace: 'ws-inv',
        now: '2026-11-14T12:00:00.000Z',
      })
      assert.equal(view.rows[0]?.status, 'unforeseen')
      assert.equal(formatOwnerStatusCell(view.rows[0]!), '🟠 dérive')

      // When the 2nd slot (`preprod`) ALSO slips, opening a 3rd stage is refused at write time
      track.setItemEta(itemId, {
        targetStage: 'preprod',
        when: '2026-11-23',
        source: 'committed',
        by: 'équipe',
      })
      assert.throws(
        () =>
          track.setItemEta(itemId, {
            targetStage: 'published',
            when: '2026-11-22',
            source: 'committed',
            by: 'équipe',
          }),
        DomainError,
      )

      // E10 (Finding 24): rebaseline with a settled 'go' decision targeting an unrelated item is refused
      const otherItemId = track.createItem({
        kind: 'chore',
        title: 'Autre sujet sans rapport',
        workspace: 'ws-inv',
      })
      const unrelatedDecId = track.createDecision({
        decisionKind: 'commitment',
        title: 'Décision sur un autre sujet',
        workspace: 'ws-inv',
        targets: [otherItemId],
        dossier: {
          context: 'Autre lot',
          options: [
            { id: 'opt-a', title: 'Option A', summary: 'Go autre lot' },
            { id: 'opt-b', title: 'Option B', summary: 'No-go' },
          ],
          qa: [],
          recommendation: { optionId: 'opt-a', rationale: 'OK' },
        },
      })
      track.selectDecisionOption(unrelatedDecId, 'opt-a', 'go')

      assert.throws(
        () =>
          track.setItemEta(itemId, {
            targetStage: 'prod',
            when: '2026-11-28',
            source: 'committed',
            by: 'owner',
            rebaselineDecisionId: unrelatedDecId,
          }),
        DomainError,
      )

      // E8 (Finding 23): item report `etas` go through the journal and record slips
      const item2 = track.createItem({
        kind: 'feature',
        title: 'Lot rapport etas',
        workspace: 'ws-inv-2',
        links: [{ kind: 'pr-open', locator: 'PR #458' }],
      })
      track.setRealization(item2, 'in-progress')
      track.setReportStatus(item2, {
        ownerNumber: 2,
        ownerSummary: 'Suivi ETA via rapport item',
        stage: { value: 'pr', evidence: 'PR #458' },
        status: 'on-track',
        facts: 'PR #458 ouverte',
        nextAction: 'Livrer en prod (équipe)',
        etas: [{ targetStage: 'prod', when: '2026-11-16', source: 'committed', by: 'équipe' }],
      })
      track.setReportStatus(item2, {
        ownerNumber: 2,
        ownerSummary: 'Suivi ETA via rapport item',
        stage: { value: 'pr', evidence: 'PR #458' },
        status: 'on-track',
        facts: 'PR #458 ouverte',
        nextAction: 'Livrer en prod (équipe)',
        etas: [{ targetStage: 'prod', when: '2026-11-22', source: 'committed', by: 'équipe' }],
      })
      const view2 = new TrackReader(eventsPath).ownerTable({
        workspace: 'ws-inv-2',
        now: '2026-11-14T12:00:00.000Z',
      })
      assert.equal(view2.rows[0]?.status, 'unforeseen')
      assert.equal(
        formatOwnerEtaCell(view2.rows[0]!.etas),
        'prod → 2026-11-22 (engagé : équipe, glissement depuis 2026-11-16)',
      )
    })
  })

  it('labels velocity estimator ETAs "mesuré" ONLY when all #376 inputs are qualified (sampleCount > 0, both digests, stage >= dev, computed ISO date) and refuses manual "measured"', () => {
    // 1. Fully qualified non-install stage (merged) -> measured / mesuré with computed ISO date 2026-11-16
    const okMerged = qualifyVelocityEta(qualifiedBaseInput('merged'))
    assert.equal(okMerged.qualified, true)
    assert.equal(okMerged.source, 'measured')
    assert.equal(okMerged.sourceLabel, 'mesuré')
    assert.equal(okMerged.eta.when, '2026-11-16')
    assert.ok(okMerged.eta.measured !== undefined)
    assert.equal(okMerged.eta.measured?.sampleCount, 18)
    assert.equal(formatOwnerEtaCell([okMerged.eta]), 'merged → 2026-11-16 (mesuré)')

    // 2. Early stages (brainstorm, spec, plan) are unmeasured -> unknown / inconnu (Carbon P1-2)
    for (const earlyStage of ['brainstorm', 'spec', 'plan'] as const) {
      const early = qualifyVelocityEta(qualifiedBaseInput(earlyStage))
      assert.equal(early.qualified, false)
      assert.equal(early.source, 'unknown')
      assert.equal(early.eta.when, '—')
      assert.ok(early.unqualifiedReasons.includes('unmeasured-early-stage'))
    }

    // 3. sampleCount <= 0 or missing -> unknown / inconnu (Finding 25 / E11)
    const zeroSamples = qualifyVelocityEta({
      ...qualifiedBaseInput('merged'),
      forecast: {
        ...qualifiedBaseInput('merged').forecast!,
        sampleCount: 0,
      },
    })
    assert.equal(zeroSamples.qualified, false)
    assert.equal(zeroSamples.source, 'unknown')
    assert.ok(zeroSamples.unqualifiedReasons.includes('forecast-zero-samples'))

    // 4. Missing lockedDigest or currentDigest -> unknown / inconnu (Finding 25)
    const missingDigests = qualifyVelocityEta({
      ...qualifiedBaseInput('merged'),
      knowledge: {
        applicability: 'applicable',
        historyPreserved: true,
        boundsNewRegime: true,
      },
    })
    assert.equal(missingDigests.qualified, false)
    assert.equal(missingDigests.source, 'unknown')
    assert.ok(missingDigests.unqualifiedReasons.includes('knowledge-missing-digests'))

    // 5. Insufficient evidence in forecast -> unknown / inconnu
    const badSupport = qualifyVelocityEta({
      ...qualifiedBaseInput('merged'),
      forecast: {
        ...qualifiedBaseInput('merged').forecast!,
        support: 'insufficient-evidence',
      },
    })
    assert.equal(badSupport.qualified, false)
    assert.equal(badSupport.source, 'unknown')
    assert.equal(badSupport.sourceLabel, 'inconnu')
    assert.equal(badSupport.eta.when, '—')
    assert.ok(badSupport.unqualifiedReasons.includes('forecast-insufficient-evidence'))
    assert.equal(formatOwnerEtaCell([badSupport.eta]), 'merged → — (inconnu)')

    // 6. Open gates on plan (e.g. pending decision D1) -> unknown / inconnu
    const openGate = qualifyVelocityEta({
      ...qualifiedBaseInput('merged'),
      plan: {
        openGates: ['D1'],
        capacities: { default: 2 },
      },
    })
    assert.equal(openGate.qualified, false)
    assert.equal(openGate.source, 'unknown')
    assert.ok(openGate.unqualifiedReasons.includes('plan-open-gates'))

    // 7. Knowledge lock not applicable or digest mismatch -> unknown / inconnu
    const badKnowledge = qualifyVelocityEta({
      ...qualifiedBaseInput('merged'),
      knowledge: {
        applicability: 'conditional-historical',
        lockedDigest: 'digest-v1',
        currentDigest: 'digest-v2',
      },
    })
    assert.equal(badKnowledge.qualified, false)
    assert.equal(badKnowledge.source, 'unknown')
    assert.ok(badKnowledge.unqualifiedReasons.includes('knowledge-conditional-historical'))
    assert.ok(badKnowledge.unqualifiedReasons.includes('knowledge-digest-mismatch'))

    // 8. Target stage 'prod' without held installation receipts -> unknown / inconnu
    const prodNoInstall = qualifyVelocityEta({
      ...qualifiedBaseInput('prod'),
      targetLabel: 'MEP',
    })
    assert.equal(prodNoInstall.qualified, false)
    assert.equal(prodNoInstall.source, 'unknown')
    assert.ok(prodNoInstall.unqualifiedReasons.includes('missing-install-receipts'))
    assert.equal(formatOwnerEtaCell([prodNoInstall.eta]), 'prod (MEP) → — (inconnu)')

    const prodUnqualifiedInstall = qualifyVelocityEta({
      ...qualifiedBaseInput('prod'),
      targetLabel: 'MEP',
      installReceipts: [
        {
          installedAt: 'unknown',
          verdict: 'unknown',
          reason: 'no-observation',
          mergeToInstalledSeconds: null,
        },
      ],
    })
    assert.equal(prodUnqualifiedInstall.qualified, false)
    assert.equal(prodUnqualifiedInstall.source, 'unknown')
    assert.ok(prodUnqualifiedInstall.unqualifiedReasons.includes('install-receipt-not-held'))

    // 9. Target stage 'prod' WITH held installation receipt -> measured / mesuré
    const prodQualified = qualifyVelocityEta({
      ...qualifiedBaseInput('prod'),
      targetLabel: 'MEP',
      installReceipts: [
        {
          installedAt: '2026-11-13T18:00:00.000Z',
          verdict: 'held',
          mergeToInstalledSeconds: 1800,
        },
      ],
    })
    assert.equal(prodQualified.qualified, true)
    assert.equal(prodQualified.source, 'measured')
    assert.equal(prodQualified.sourceLabel, 'mesuré')
    assert.equal(formatOwnerEtaCell([prodQualified.eta]), 'prod (MEP) → 2026-11-16 (mesuré)')

    // 10. Manual `source: 'measured'` via setItemEta / setDemandEta / CLI is refused (Finding 10 / E1)
    withTempTrack(({ dir, track }) => {
      const id1 = track.createItem({
        kind: 'feature',
        title: 'Lot qualifié',
        workspace: 'ws-vel',
        links: [{ kind: 'pr-open', locator: 'PR #101' }],
      })
      track.setRealization(id1, 'in-progress')
      track.setReportStatus(id1, {
        ownerNumber: 1,
        ownerSummary: 'Lot avec vélocité qualifiée',
        stage: { value: 'pr', evidence: 'PR #101' },
        status: 'on-track',
        facts: 'PR #101 en revue',
        nextAction: 'Merger PR #101 (équipe)',
      })

      assert.throws(
        () =>
          track.setItemEta(id1, {
            targetStage: 'merged',
            when: '2026-11-16',
            source: 'measured',
          }),
        DomainError,
      )

      const out: string[] = []
      const err: string[] = []
      const rc = runCli(
        ['item', 'eta', id1, '--target-stage', 'merged', '--when', '2026-11-16', '--source', 'measured'],
        { cwd: dir, out: (s) => out.push(s), err: (s) => err.push(s) },
      )
      assert.notEqual(rc, 0)

      // Qualified velocity ETA via setItemVelocityEta succeeds and stores provenance
      const velRes = track.setItemVelocityEta(id1, qualifiedBaseInput('merged'))
      assert.equal(velRes.qualified, true)
      assert.equal(velRes.eta.when, '2026-11-16')

      const id2 = track.createItem({
        kind: 'feature',
        title: 'Lot non qualifié',
        workspace: 'ws-vel',
        links: [{ kind: 'pr-open', locator: 'PR #102' }],
      })
      track.setRealization(id2, 'in-progress')
      track.setReportStatus(id2, {
        ownerNumber: 2,
        ownerSummary: 'Lot avec vélocité non qualifiée',
        stage: { value: 'pr', evidence: 'PR #102' },
        status: 'on-track',
        facts: 'PR #102 en revue',
        nextAction: 'Merger PR #102 (équipe)',
      })

      const state = track.state()
      const events = new EventStore(join(tmpdir(), 'nonexistent-vel.jsonl')).readAll()
      const view = projectOwnerTable(state, events, {
        workspace: 'ws-vel',
        now: '2026-11-14T12:00:00.000Z',
        velocityBindings: {
          [id2]: {
            ...qualifiedBaseInput('merged'),
            plan: { openGates: ['D1'], capacities: { default: 1 } },
          },
        },
      })
      assert.equal(view.rows[0]?.etas[0]?.source, 'measured')
      assert.equal(formatOwnerEtaCell(view.rows[0]!.etas), 'merged → 2026-11-16 (mesuré)')
      assert.equal(view.rows[1]?.etas[0]?.source, 'unknown')
      assert.equal(formatOwnerEtaCell(view.rows[1]!.etas), 'merged → — (inconnu)')
      assert.equal(auditOwnerTable(view).ok, true)

      // evaluateEtaDeadline defaults `now` to clock when omitted
      const pastEvaluated = evaluateEtaDeadline(
        {
          targetStage: 'merged',
          when: '2026-11-01',
          source: 'committed',
          by: 'équipe',
        },
        'pr',
      )
      assert.equal(pastEvaluated.missed, true)
    })
  })

  it('exports Engram alignment constants and enriches graphExportFromState with Demand and stage/status/ETA facts', () => {
    assert.equal(ENGRAM_STAGE_STATUS_ALIGNMENT.profileId, 'request-lifecycle')
    assert.deepEqual(ENGRAM_STAGE_STATUS_ALIGNMENT.stages, REPORT_STAGES)
    assert.deepEqual(ENGRAM_STAGE_STATUS_ALIGNMENT.statuses, REPORT_STATUSES)
    assert.equal(ENGRAM_STAGE_STATUS_ALIGNMENT.authority, 'track-git-only')
    assert.deepEqual(ENGRAM_STAGE_STATUS_ALIGNMENT.unchangedProfiles, ['archi@1', 'archi@2'])

    withTempTrack(({ track }) => {
      const demandId = track.raiseDemand({
        type: 'feature',
        raw: { text: 'Alignement Engram', title: 'Alignement Engram' },
        source: { kind: 'human', actor: 'owner' },
        workspace: 'ws-engram',
      })
      track.numberDemand(demandId, 1)
      track.updateDemandOwnerSummary(demandId, {
        summary: 'Aligner le profil request-lifecycle',
        requestedStage: 'published',
      })
      track.setDemandEta(demandId, {
        targetStage: 'published',
        when: '2026-11-19',
        source: 'committed',
        by: 'équipe Engram',
      })
      track.claimDemand(demandId)
      const [itemId] = track.agreeDemand(demandId, {
        items: [{ title: 'Lot export graphe' }],
      })
      track.setReportStatus(itemId!, {
        ownerNumber: 1,
        stage: { value: 'dev', evidence: 'branch:feat/engram' },
        status: 'on-track',
        facts: 'Branche créée',
      })

      const fragment = graphExportFromState(track.state(), {
        repoKey: 'repo-test',
        sourceId: 'ws-engram',
        observedAt: '2026-11-14T12:00:00.000Z',
        sourceHash: 'sha256:0000',
      })

      const demandNode = fragment.nodes.find((n) => n.id === demandId)
      assert.ok(demandNode)
      assert.equal(demandNode.node_type, 'Demand')
      assert.equal(demandNode['owner_number'], 1)
      assert.equal(demandNode['requested_stage'], 'published')
      assert.equal(demandNode['eta_count'], 1)

      const itemNode = fragment.nodes.find((n) => n.id === itemId)
      assert.ok(itemNode)
      assert.equal(itemNode['report_stage'], 'dev')
      assert.equal(itemNode['report_status'], 'on-track')
      assert.equal(itemNode['owner_number'], 1)

      const promotesEdge = fragment.edges.find(
        (e) => e.source === demandId && e.target === itemId && e.relation === 'PROMOTES_TO',
      )
      assert.ok(promotesEdge)
    })
  })

  it('Round 2 P1-4: evaluates every slot (demand and all active child lots) before deduplicating/truncating to 2, sorts overdue slots first, and turns the row 🟠 dérive if any active child lot is overdue', () => {
    withTempTrack(({ eventsPath, track }) => {
      // Case 1: Demand with prod -> 2026-11-25 + active child lot in dev with pr -> 2026-11-01 (overdue at now = 2026-11-14T19:00:00.000Z)
      const d1 = track.raiseDemand({
        type: 'feature',
        raw: { text: 'Demande multi-lots avec échéance enfant dépassée', title: 'Demande multi-lots 1' },
        source: { kind: 'human', actor: 'owner' },
        workspace: 'ws-p1-4',
      })
      track.numberDemand(d1, 1)
      track.updateDemandOwnerSummary(d1, {
        summary: 'Demande avec jalon MEP et lot enfant en retard',
        requestedStage: 'prod',
      })
      track.setDemandEta(d1, {
        targetStage: 'prod',
        when: '2026-11-25',
        source: 'committed',
        by: 'équipe',
      })
      track.claimDemand(d1)
      const [lot1] = track.agreeDemand(d1, {
        items: [
          {
            title: 'Lot enfant en dev avec PR en retard',
            links: [{ kind: 'dev-branch', locator: 'branch:feat/lot1' }],
          },
        ],
      })
      track.setRealization(lot1!, 'in-progress')
      track.setReportStatus(lot1!, {
        stage: { value: 'dev', evidence: 'branch:feat/lot1' },
        status: 'on-track',
        facts: 'Branche feat/lot1 active',
        nextAction: 'Ouvrir la PR (équipe)',
      })
      track.setItemEta(lot1!, {
        targetStage: 'pr',
        when: '2026-11-01',
        source: 'committed',
        by: 'équipe',
      })

      // Case 2: Demand without demand.etaJournal and 3 active child lots: dev -> 2026-11-20, pr -> 2026-11-22, merged -> 2026-11-01 (overdue)
      const d2 = track.raiseDemand({
        type: 'feature',
        raw: { text: 'Demande à 3 lots actifs dont le 3e est en retard', title: 'Demande multi-lots 2' },
        source: { kind: 'human', actor: 'owner' },
        workspace: 'ws-p1-4',
      })
      track.numberDemand(d2, 2)
      track.updateDemandOwnerSummary(d2, {
        summary: 'Demande à trois lots actifs avec 3e créneau dépassé',
        requestedStage: 'merged',
      })
      track.claimDemand(d2)
      const [c1, c2, c3] = track.agreeDemand(d2, {
        items: [
          {
            title: 'Lot C1',
            links: [{ kind: 'plan', locator: 'docs/plan-c1.md' }],
          },
          {
            title: 'Lot C2',
            links: [{ kind: 'dev-branch', locator: 'branch:feat/c2' }],
          },
          {
            title: 'Lot C3',
            links: [{ kind: 'pr-open', locator: 'PR #499' }],
          },
        ],
      })
      for (const [cid, stg, ev] of [
        [c1!, 'plan', 'docs/plan-c1.md'],
        [c2!, 'dev', 'branch:feat/c2'],
        [c3!, 'pr', 'PR #499'],
      ] as const) {
        track.setRealization(cid, 'in-progress')
        track.setReportStatus(cid, {
          stage: { value: stg, evidence: ev },
          status: 'on-track',
          facts: `Preuve ${ev} enregistrée`,
          nextAction: 'Poursuivre le lot (équipe)',
        })
      }
      track.setItemEta(c1!, {
        targetStage: 'dev',
        when: '2026-11-20',
        source: 'committed',
        by: 'équipe',
      })
      track.setItemEta(c2!, {
        targetStage: 'pr',
        when: '2026-11-22',
        source: 'committed',
        by: 'équipe',
      })
      track.setItemEta(c3!, {
        targetStage: 'merged',
        when: '2026-11-01',
        source: 'committed',
        by: 'équipe',
      })

      const view = new TrackReader(eventsPath).ownerTable({
        workspace: 'ws-p1-4',
        now: '2026-11-14T19:00:00.000Z',
      })
      // d1 (1 lot -> 1 'single' row) + d2 (3 lots -> 1 'demand-title' row + 3 'lot' rows) = 5 rows
      assert.equal(view.rows.length, 5)

      // Row 1 (single-lot demand d1): overdue child lot `pr -> 2026-11-01` is NOT masked by demand `prod -> 2026-11-25`, sorted first, row is 🟠 dérive
      const row1 = view.rows.find((r) => r.num === 1)!
      assert.equal(row1.kind, 'single')
      assert.equal(row1.status, 'unforeseen')
      assert.equal(formatOwnerStatusCell(row1), '🟠 dérive')
      assert.equal(row1.etas.length, 2)
      assert.equal(row1.etas[0]?.targetStage, 'pr')
      assert.equal(row1.etas[0]?.slip?.initialWhen, '2026-11-01')
      assert.equal(row1.etas[1]?.targetStage, 'prod')

      // Demand #2 (3 lots -> 1 demand-title + 3 lot rows): 3rd child lot `merged -> 2026-11-01` is 🟠 dérive on its own lot row
      const d2Rows = view.rows.filter((r) => r.num === 2)
      assert.equal(d2Rows.length, 4)
      assert.equal(d2Rows[0]?.kind, 'demand-title')
      assert.equal(d2Rows[0]?.status, undefined)
      assert.equal(d2Rows[1]?.kind, 'lot')
      assert.equal(d2Rows[1]?.status, 'on-track')
      assert.equal(d2Rows[2]?.kind, 'lot')
      assert.equal(d2Rows[2]?.status, 'on-track')
      assert.equal(d2Rows[3]?.kind, 'lot')
      assert.equal(d2Rows[3]?.status, 'unforeseen')
      assert.equal(formatOwnerStatusCell(d2Rows[3]!), '🟠 dérive')
      assert.equal(d2Rows[3]?.etas[0]?.targetStage, 'merged')
      assert.equal(d2Rows[3]?.etas[0]?.slip?.initialWhen, '2026-11-01')
      assert.equal(auditOwnerTable(view).ok, true)
    })
  })

  it('Round 3 P1-1, P1-2 & P2-1: owner pause freezes overdue ETAs; terminal rows drop old ETAs, reached targetStage is hidden, item go-rebaseline clears overdue ETA, and per-lot rows isolate sibling ETAs and velocityBindings', () => {
    withTempTrack(({ eventsPath, track }) => {
      // 1. P1-1: Multi-lot demand with lot1 `done` + lot2 paused by owner (`go`), with an overdue demand ETA on the title row
      const d1 = track.raiseDemand({
        type: 'feature',
        raw: { text: 'Demande multi-lots partiellement finie et en pause', title: 'Multi-lots pause' },
        source: { kind: 'human', actor: 'owner' },
        workspace: 'ws-r3-eta',
      })
      track.numberDemand(d1, 1)
      track.updateDemandOwnerSummary(d1, {
        summary: 'Demande multi-lots partiellement finie et en pause',
        requestedStage: 'prod',
      })
      track.setDemandEta(d1, {
        targetStage: 'prod',
        when: '2026-11-01',
        source: 'committed',
        by: 'équipe',
      })
      track.claimDemand(d1)
      const [m1, m2] = track.agreeDemand(d1, {
        items: [
          {
            title: 'Lot 1 fini',
            links: [
              { kind: 'deployed-prod', locator: 'prod:v1.0.0' },
              { kind: 'prod-accepted', locator: 'owner:m1-ok' },
            ],
          },
          {
            title: 'Lot 2 en pause',
            links: [{ kind: 'dev-branch', locator: 'branch:feat/m2' }],
          },
        ],
      })
      track.setRealization(m1!, 'in-progress')
      const critM1 = track.addCriterion(m1!, 'm1 prod ok')
      const evM1 = track.linkEvidence(critM1, 'e2e', 'https://example.test/m1')
      track.recordRun(evM1, { commit: 'c1', env: 'prod', runner: 'smoke', result: 'pass' })
      track.setRealization(m1!, 'done')
      track.setReportStatus(m1!, {
        status: 'on-track',
        facts: 'Lot 1 en prod (prod:v1.0.0)',
      })

      track.setRealization(m2!, 'in-progress')
      const pauseDecM2 = track.createDecision({
        decisionKind: 'commitment',
        title: 'Mettre le lot 2 en pause ?',
        workspace: 'ws-r3-eta',
        targets: [m2!],
        dossier: {
          context: 'Pause après lot 1',
          options: [
            { id: 'pause', title: 'Pause', summary: 'Geler le lot 2' },
            { id: 'cont', title: 'Continuer', summary: 'Continuer le lot 2' },
          ],
          qa: [],
          recommendation: { optionId: 'pause', rationale: 'Choix owner' },
          artifacts: [{ kind: 'rendered-view', viewRef: 'docs/dossiers/m2.md' }],
        },
      })
      track.selectDecisionOption(pauseDecM2, 'pause', 'go')
      track.setReportStatus(m2!, {
        stage: { value: 'dev', evidence: 'branch:feat/m2' },
        status: 'not-started',
        pausedByOwner: true,
        pauseDecisionId: pauseDecM2,
        facts: 'Lot 2 initialisé',
        nextAction: 'En pause owner (équipe)',
      })

      // 2. P1-2a: Terminal rows (`✅ fait` and `⚫ retiré`) drop their old ETAs (`etas = []`)
      const d2 = track.raiseDemand({
        type: 'feature',
        raw: { text: 'Demande terminée avec ETA historique', title: 'Done avec ETA' },
        source: { kind: 'human', actor: 'owner' },
        workspace: 'ws-r3-eta',
      })
      track.numberDemand(d2, 2)
      track.claimDemand(d2)
      const [doneItem] = track.agreeDemand(d2, {
        items: [
          {
            title: 'Lot terminé',
            links: [
              { kind: 'deployed-prod', locator: 'prod:v2.0.0' },
              { kind: 'prod-accepted', locator: 'owner:done-ok' },
            ],
          },
        ],
      })
      track.setRealization(doneItem!, 'in-progress')
      track.setItemEta(doneItem!, {
        targetStage: 'pr',
        when: '2026-11-05',
        source: 'committed',
        by: 'équipe',
      })
      track.setItemEta(doneItem!, {
        targetStage: 'pr',
        when: '2026-11-10',
        source: 'committed',
        by: 'équipe',
        reason: 'retard revue',
      })
      const critDone = track.addCriterion(doneItem!, 'done prod ok')
      const evDone = track.linkEvidence(critDone, 'e2e', 'https://example.test/done')
      track.recordRun(evDone, { commit: 'c1', env: 'prod', runner: 'smoke', result: 'pass' })
      track.setRealization(doneItem!, 'done')
      track.setReportStatus(doneItem!, {
        status: 'on-track',
        facts: 'Livré en production (prod:v2.0.0)',
      })

      const d3 = track.raiseDemand({
        type: 'feature',
        raw: { text: 'Demande retirée avec ETA historique', title: 'Retiré avec ETA' },
        source: { kind: 'human', actor: 'owner' },
        workspace: 'ws-r3-eta',
      })
      track.numberDemand(d3, 3)
      track.setDemandEta(d3, {
        targetStage: 'pr',
        when: '2026-11-01',
        source: 'committed',
        by: 'équipe',
      })
      track.claimDemand(d3)
      track.disposeDemand(d3, {
        outcome: 'rejected',
        reason: 'Abandonné par l owner',
      })

      // 3. P1-2b: Target stage already passed (`pr` ETA on an item now at `merged`) is dropped in favour of next target (`published`)
      const d4 = track.raiseDemand({
        type: 'feature',
        raw: { text: 'Item fusionné ayant eu une ETA sur pr', title: 'Fusionné après pr' },
        source: { kind: 'human', actor: 'owner' },
        workspace: 'ws-r3-eta',
      })
      track.numberDemand(d4, 4)
      track.claimDemand(d4)
      const [mergedItem] = track.agreeDemand(d4, {
        items: [
          {
            title: 'Lot fusionné',
            links: [
              { kind: 'pr-open', locator: 'PR #410' },
              { kind: 'pr-merged', locator: 'PR #410' },
            ],
          },
        ],
      })
      track.setRealization(mergedItem!, 'in-progress')
      track.setItemEta(mergedItem!, {
        targetStage: 'pr',
        when: '2026-11-05',
        source: 'committed',
        by: 'équipe',
      })
      track.setItemEta(mergedItem!, {
        targetStage: 'pr',
        when: '2026-11-10',
        source: 'committed',
        by: 'équipe',
        reason: 'glissement initial',
      })
      track.setReportStatus(mergedItem!, {
        stage: { value: 'merged', evidence: 'PR #410' },
        status: 'on-track',
        facts: 'PR #410 fusionnée',
        nextAction: 'Publier le paquet (équipe)',
      })

      // 4. P1-2c: Item-level `go` rebaseline clears the lot's older overdue ETA on the same targetStage
      const d5 = track.raiseDemand({
        type: 'feature',
        raw: { text: 'Demande recalée par décision go owner', title: 'Recalage go demande' },
        source: { kind: 'human', actor: 'owner' },
        workspace: 'ws-r3-eta',
      })
      track.numberDemand(d5, 5)
      track.claimDemand(d5)
      const [rebLot] = track.agreeDemand(d5, {
        items: [
          {
            title: 'Lot enfant avec ancienne échéance dépassée',
            links: [{ kind: 'dev-branch', locator: 'branch:feat/rebaseline' }],
          },
        ],
      })
      track.setRealization(rebLot!, 'in-progress')
      track.setReportStatus(rebLot!, {
        stage: { value: 'dev', evidence: 'branch:feat/rebaseline' },
        status: 'on-track',
        facts: 'Développement actif',
        nextAction: 'Finaliser pour le 25/11 (équipe)',
      })
      track.setItemEta(rebLot!, {
        targetStage: 'prod',
        when: '2026-11-01',
        source: 'committed',
        by: 'équipe',
      })
      const rebDec = track.createDecision({
        decisionKind: 'commitment',
        title: 'Recaler la MEP au 25/11 ?',
        workspace: 'ws-r3-eta',
        targets: [rebLot!],
        dossier: {
          context: 'Recalage officiel',
          options: [
            { id: 'go-25', title: 'Recaler au 25/11', summary: 'Nouvelle cible MEP' },
            { id: 'keep', title: 'Maintenir 01/11', summary: 'Conserver le retard' },
          ],
          qa: [],
          recommendation: { optionId: 'go-25', rationale: 'Périmètre étendu' },
          artifacts: [{ kind: 'rendered-view', viewRef: 'docs/dossiers/reb.md' }],
        },
      })
      track.selectDecisionOption(rebDec, 'go-25', 'go')
      track.setItemEta(rebLot!, {
        targetStage: 'prod',
        when: '2026-11-25',
        source: 'committed',
        by: 'owner',
        rebaselineDecisionId: rebDec,
      })

      // 5. P2-1: Multi-lot demand renders 1 title row + 2 lot rows; each lot keeps its own ETA and velocityBinding
      const d6 = track.raiseDemand({
        type: 'feature',
        raw: { text: 'Demande à 2 lots engagés sur prod à deux dates', title: 'Deux lots distincts' },
        source: { kind: 'human', actor: 'owner' },
        workspace: 'ws-r3-eta',
      })
      track.numberDemand(d6, 6)
      track.claimDemand(d6)
      const [sLot1, sLot2] = track.agreeDemand(d6, {
        items: [
          { title: 'Lot S1', links: [{ kind: 'dev-branch', locator: 'branch:feat/s1' }] },
          { title: 'Lot S2', links: [{ kind: 'dev-branch', locator: 'branch:feat/s2' }] },
        ],
      })
      for (const [sid, br] of [
        [sLot1!, 'branch:feat/s1'],
        [sLot2!, 'branch:feat/s2'],
      ] as const) {
        track.setRealization(sid, 'in-progress')
        track.setReportStatus(sid, {
          stage: { value: 'dev', evidence: br },
          status: 'on-track',
          facts: `Branche ${br} active`,
          nextAction: 'Livrer en prod (équipe)',
        })
      }
      track.setItemEta(sLot1!, {
        targetStage: 'prod',
        when: '2026-11-16',
        source: 'committed',
        by: 'Alice',
      })
      track.setItemEta(sLot2!, {
        targetStage: 'prod',
        when: '2026-11-28',
        source: 'committed',
        by: 'Bob',
      })

      const state = track.state()
      const events = new EventStore(eventsPath).readAll()
      const view = projectOwnerTable(state, events, {
        workspace: 'ws-r3-eta',
        baselineCommit: 'c1',
        now: '2026-11-14T19:00:00.000Z',
        velocityBindings: {
          [sLot2!]: qualifiedBaseInput('merged'),
        },
      })

      // d1 (title + 2 lots = 3) + d2 (1) + d3 (1) + d4 (1) + d5 (1) + d6 (title + 2 lots = 3) = 10 rows
      assert.equal(view.rows.length, 10)

      // Demand #1: title row carries demand's overdue ETA; lot1 is ✅ fait (etas = []); lot2 is ⚪ en pause
      const d1Rows = view.rows.filter((r) => r.num === 1)
      assert.equal(d1Rows.length, 3)
      assert.equal(d1Rows[0]?.kind, 'demand-title')
      assert.equal(d1Rows[0]?.status, undefined)
      assert.equal(d1Rows[0]?.etas[0]?.slip?.initialWhen, '2026-11-01')
      assert.equal(d1Rows[1]?.kind, 'lot')
      assert.equal(d1Rows[1]?.status, 'done')
      assert.deepEqual(d1Rows[1]?.etas, [])
      assert.equal(d1Rows[2]?.kind, 'lot')
      assert.equal(d1Rows[2]?.status, 'not-started')
      assert.equal(d1Rows[2]?.pausedByOwner, true)
      assert.equal(formatOwnerStatusCell(d1Rows[2]!), '⚪ en pause')

      // Row 2: ✅ fait drops old ETAs
      const r2 = view.rows.find((r) => r.num === 2)!
      assert.equal(r2.status, 'done')
      assert.deepEqual(r2.etas, [])
      assert.equal(formatOwnerEtaCell(r2.etas), '—')

      // Row 3: ⚫ retiré drops old ETAs
      const r3 = view.rows.find((r) => r.num === 3)!
      assert.equal(r3.status, 'withdrawn')
      assert.deepEqual(r3.etas, [])
      assert.equal(formatOwnerEtaCell(r3.etas), '—')

      // Row 4: merged item drops already-passed `pr` slot and falls back to `published -> — (inconnu)`
      const r4 = view.rows.find((r) => r.num === 4)!
      assert.equal(r4.stage, 'merged')
      assert.equal(r4.status, 'on-track')
      assert.deepEqual(r4.etas, [{ targetStage: 'published', when: '—', source: 'unknown' }])

      // Row 5: item-level `go` rebaseline clears overdue `prod -> 2026-11-01`
      const r5 = view.rows.find((r) => r.num === 5)!
      assert.equal(r5.status, 'on-track')
      assert.equal(formatOwnerStatusCell(r5), '🔵 sur la voie')
      assert.equal(r5.etas.length, 1)
      assert.equal(r5.etas[0]?.targetStage, 'prod')
      assert.equal(r5.etas[0]?.when, '2026-11-25')
      assert.equal(r5.etas[0]?.slip, undefined)

      // Demand #6: title row + 2 lot rows; sLot1 has Alice's 2026-11-16, sLot2 has velocity merged + Bob's 2026-11-28
      const d6Rows = view.rows.filter((r) => r.num === 6)
      assert.equal(d6Rows.length, 3)
      assert.equal(d6Rows[0]?.kind, 'demand-title')
      assert.deepEqual(d6Rows[0]?.etas, [])
      assert.equal(d6Rows[1]?.kind, 'lot')
      assert.equal(d6Rows[1]?.etas.length, 1)
      assert.equal(d6Rows[1]?.etas[0]?.when, '2026-11-16')
      assert.equal(d6Rows[1]?.etas[0]?.by, 'Alice')
      assert.equal(d6Rows[2]?.kind, 'lot')
      assert.equal(d6Rows[2]?.etas.length, 2)
      assert.equal(d6Rows[2]?.etas[0]?.targetStage, 'merged')
      assert.equal(d6Rows[2]?.etas[0]?.source, 'measured')
      assert.equal(d6Rows[2]?.etas[0]?.when, '2026-11-16')
      assert.equal(d6Rows[2]?.etas[1]?.targetStage, 'prod')
      assert.equal(d6Rows[2]?.etas[1]?.when, '2026-11-28')
      assert.equal(d6Rows[2]?.etas[1]?.by, 'Bob')

      assert.equal(auditOwnerTable(view).ok, true)
    })
  })

  it('Round 4 P1-1, P1-2 & P3-1: per-lot stage/ETA isolation, overdue lot visibility, merged lot slip removal, and post-rebaseline slip detection', () => {
    withTempTrack(({ dir }) => {
      const eventsPath = join(dir, '.track-r4-eta', 'events.jsonl')
      let clock = '2026-11-10T09:00:00.000Z'
      const track = new Track(new EventStore(eventsPath), {
        by: 'test-r4-eta',
        now: () => clock,
      })

      // 1. P1-1 Case 3: lot1 done in prod + lot2 paused by owner at to-do (no link), with demand ETA prod -> 2026-11-25
      const d1 = track.raiseDemand({
        type: 'feature',
        workspace: 'ws-r4-eta',
        raw: { text: 'Demande 1 : lot 1 livré en prod, lot 2 en pause avant démarrage' },
        source: { kind: 'human' },
      })
      track.numberDemand(d1, 1)
      track.claimDemand(d1, {})
      const [d1Lot1, d1Lot2] = track.agreeDemand(d1, {
        items: [
          {
            title: 'Lot 1 prod done',
            links: [
              { kind: 'deployed-prod', locator: 'prod:v1.0.0' },
              { kind: 'prod-accepted', locator: 'owner:ok-d1' },
            ],
          },
          { title: 'Lot 2 to-do en pause' },
        ],
      })
      track.setRealization(d1Lot1!, 'in-progress')
      const d1Crit = track.addCriterion(d1Lot1!, 'prod ok d1')
      const d1Ev = track.linkEvidence(d1Crit, 'e2e', 'https://example.test/d1')
      track.recordRun(d1Ev, { commit: 'c1', env: 'prod', runner: 'smoke', result: 'pass' })
      track.setRealization(d1Lot1!, 'done')
      track.setReportStatus(d1Lot1!, {
        status: 'on-track',
        facts: 'Lot 1 en production (prod:v1.0.0).',
      })
      const pauseDec = track.createDecision({
        decisionKind: 'commitment',
        title: 'Mettre le lot 2 en pause avant démarrage ?',
        workspace: 'ws-r4-eta',
        targets: [d1Lot2!],
        dossier: {
          context: 'Pause lot 2.',
          qa: [],
          options: [
            { id: 'pause', title: 'Pause', summary: 'Geler le lot 2' },
            { id: 'go', title: 'Continuer', summary: 'Démarrer le lot 2' },
          ],
          recommendation: { optionId: 'pause', rationale: 'Prioriser le lot 1' },
          artifacts: [{ kind: 'rendered-view', viewRef: 'docs/dossiers/r4-d1-pause.md' }],
        },
      })
      track.selectDecisionOption(pauseDec, 'pause', 'go')
      track.setReportStatus(d1Lot2!, {
        status: 'not-started',
        pausedByOwner: true,
        pauseDecisionId: pauseDec,
        nextAction: 'En pause owner avant démarrage (équipe)',
      })
      track.setDemandEta(d1, {
        targetStage: 'prod',
        when: '2026-11-25',
        source: 'committed',
        by: 'Alice',
      })

      // 2. P1-2 Case 1: lot1 at merged + lot2 at to-do with overdue ETA pr -> 2026-11-10 -> lot2 has its own row and is 🟠 dérive
      const d2 = track.raiseDemand({
        type: 'feature',
        workspace: 'ws-r4-eta',
        raw: { text: 'Demande 2 : lot 1 fusionné, lot 2 en retard sur PR' },
        source: { kind: 'human' },
      })
      track.numberDemand(d2, 2)
      track.claimDemand(d2, {})
      const [d2Lot1, d2Lot2] = track.agreeDemand(d2, {
        items: [
          { title: 'Lot 1 merged', links: [{ kind: 'pr-merged', locator: 'PR #501' }] },
          { title: 'Lot 2 to-do overdue' },
        ],
      })
      track.setRealization(d2Lot1!, 'in-progress')
      track.setReportStatus(d2Lot1!, {
        status: 'on-track',
        facts: 'PR #501 fusionnée.',
        nextAction: 'Publier le lot 1 (équipe)',
      })
      track.setItemEta(d2Lot2!, {
        targetStage: 'pr',
        when: '2026-11-10',
        source: 'committed',
        by: 'Bob',
      })

      // 3. P1-2 Case 2: lot1 already at merged with a historical slipped ETA on merged + lot2 at dev with future ETA on prod -> never crashes auditOwnerTable
      const d3 = track.raiseDemand({
        type: 'feature',
        workspace: 'ws-r4-eta',
        raw: { text: 'Demande 3 : lot 1 déjà fusionné après glissement, lot 2 actif en dev' },
        source: { kind: 'human' },
      })
      track.numberDemand(d3, 3)
      track.claimDemand(d3, {})
      const [d3Lot1, d3Lot2] = track.agreeDemand(d3, {
        items: [
          { title: 'Lot 1 merged after slip', links: [{ kind: 'pr-merged', locator: 'PR #502' }] },
          { title: 'Lot 2 active in dev', links: [{ kind: 'dev-branch', locator: 'feat/d3-lot2' }] },
        ],
      })
      track.setRealization(d3Lot1!, 'in-progress')
      track.setItemEta(d3Lot1!, {
        targetStage: 'merged',
        when: '2026-11-05',
        source: 'committed',
        by: 'Alice',
      })
      clock = '2026-11-08T09:00:00.000Z'
      track.setItemEta(d3Lot1!, {
        targetStage: 'merged',
        when: '2026-11-12',
        source: 'committed',
        by: 'Alice',
        reason: 'Retard initial résorbé par la fusion',
      })
      track.setReportStatus(d3Lot1!, {
        status: 'on-track',
        facts: 'PR #502 fusionnée.',
      })
      track.setRealization(d3Lot2!, 'in-progress')
      track.setReportStatus(d3Lot2!, {
        status: 'on-track',
        facts: 'Branche feat/d3-lot2 active.',
        nextAction: 'Finaliser le lot 2 (équipe)',
      })
      track.setItemEta(d3Lot2!, {
        targetStage: 'prod',
        when: '2026-11-25',
        source: 'committed',
        by: 'Bob',
      })

      // 4. P1-2 Case 3: lot1 has a velocityBinding on prod (2026-11-16) while sibling lot2 has a committed ETA on prod (2026-11-28) -> each lot shows its own ETA
      const d4 = track.raiseDemand({
        type: 'feature',
        workspace: 'ws-r4-eta',
        raw: { text: 'Demande 4 : vélocité lot 1 vs engagement plus tardif lot 2 sur prod' },
        source: { kind: 'human' },
      })
      track.numberDemand(d4, 4)
      track.claimDemand(d4, {})
      const [d4Lot1, d4Lot2] = track.agreeDemand(d4, {
        items: [
          { title: 'Lot 1 dev', links: [{ kind: 'dev-branch', locator: 'feat/d4-lot1' }] },
          { title: 'Lot 2 dev', links: [{ kind: 'dev-branch', locator: 'feat/d4-lot2' }] },
        ],
      })
      for (const [lid, br] of [
        [d4Lot1!, 'feat/d4-lot1'],
        [d4Lot2!, 'feat/d4-lot2'],
      ] as const) {
        track.setRealization(lid, 'in-progress')
        track.setReportStatus(lid, {
          status: 'on-track',
          facts: `Branche ${br} active.`,
          nextAction: 'Livrer en production (équipe)',
        })
      }
      track.setItemEta(d4Lot2!, {
        targetStage: 'prod',
        when: '2026-11-28',
        source: 'committed',
        by: 'Bob',
      })

      // 5. P3-1: Same-timestamp demand rebaseline followed by a new item slip is NEVER masked by the demand
      clock = '2026-11-14T12:00:00.000Z'
      const d5 = track.raiseDemand({
        type: 'feature',
        workspace: 'ws-r4-eta',
        raw: { text: 'Demande 5 : rebaseline puis nouveau glissement à la même milliseconde' },
        source: { kind: 'human' },
      })
      track.numberDemand(d5, 5)
      track.claimDemand(d5, {})
      const [d5Lot1] = track.agreeDemand(d5, {
        items: [{ title: 'Lot 1 dev', links: [{ kind: 'dev-branch', locator: 'feat/d5-lot1' }] }],
      })
      track.setRealization(d5Lot1!, 'in-progress')
      track.setReportStatus(d5Lot1!, {
        status: 'on-track',
        facts: 'Branche feat/d5-lot1 active.',
        nextAction: 'Traiter le second glissement (équipe)',
      })

      const rebDec = track.createDecision({
        decisionKind: 'commitment',
        title: 'Rebaseliner Demande 5 au 20/11 ?',
        workspace: 'ws-r4-eta',
        targets: [d5Lot1!],
        dossier: {
          context: 'Premier recalage.',
          qa: [],
          options: [
            { id: 'accept', title: 'Accepter', summary: 'Nouvelle cible 20/11' },
            { id: 'reject', title: 'Refuser', summary: 'Maintenir la cible initiale' },
          ],
          recommendation: { optionId: 'accept', rationale: 'Recalage validé' },
          artifacts: [{ kind: 'rendered-view', viewRef: 'docs/dossiers/r4-d5-reb.md' }],
        },
      })
      track.selectDecisionOption(rebDec, 'accept', 'go')
      track.setDemandEta(d5, {
        targetStage: 'prod',
        when: '2026-11-20',
        source: 'committed',
        by: 'Alice',
        rebaselineDecisionId: rebDec,
      })
      track.setItemEta(d5Lot1!, {
        targetStage: 'prod',
        when: '2026-11-20',
        source: 'committed',
        by: 'Alice',
      })
      track.setItemEta(d5Lot1!, {
        targetStage: 'prod',
        when: '2026-11-27',
        source: 'committed',
        by: 'Alice',
        reason: 'Second glissement après rebaseline',
      })

      const state = track.state()
      const events = new EventStore(eventsPath).readAll()

      const d5Derived = deriveItemStageStatus(state, events, state.items.get(d5Lot1!)!, 'c1')
      assert.equal(d5Derived.status, 'unforeseen')

      const view = projectOwnerTable(state, events, {
        workspace: 'ws-r4-eta',
        baselineCommit: 'c1',
        now: '2026-11-14T19:00:00.000Z',
        velocityBindings: {
          [d4Lot1!]: {
            ...qualifiedBaseInput('prod'),
            installReceipts: [
              {
                installedAt: '2026-11-13T18:00:00.000Z',
                verdict: 'held',
                mergeToInstalledSeconds: 1800,
              },
            ],
          },
        },
      })

      // d1..d4 (4 * 3 = 12 rows) + d5 (1 single row) = 13 rows
      assert.equal(view.rows.length, 13)

      // Demand 1: title row carries prod -> 2026-11-25; lot 1 is ✅ fait at done; lot 2 is ⚪ en pause
      const d1Rows = view.rows.filter((r) => r.num === 1)
      assert.equal(d1Rows[0]?.kind, 'demand-title')
      assert.equal(d1Rows[0]?.etas[0]?.when, '2026-11-25')
      assert.equal(d1Rows[1]?.status, 'done')
      assert.equal(d1Rows[1]?.stage, 'done')
      assert.equal(d1Rows[2]?.status, 'not-started')
      assert.equal(d1Rows[2]?.pausedByOwner, true)
      assert.equal(formatOwnerStatusCell(d1Rows[2]!), '⚪ en pause')

      // Demand 2: lot 1 is 🔵 sur la voie at merged; lot 2 is 🟠 dérive with pr -> 2026-11-10
      const d2Rows = view.rows.filter((r) => r.num === 2)
      assert.equal(d2Rows[1]?.stage, 'merged')
      assert.equal(d2Rows[1]?.status, 'on-track')
      assert.equal(d2Rows[2]?.status, 'unforeseen')
      assert.equal(formatOwnerStatusCell(d2Rows[2]!), '🟠 dérive')
      assert.equal(d2Rows[2]?.etas[0]?.targetStage, 'pr')
      assert.equal(d2Rows[2]?.etas[0]?.slip?.initialWhen, '2026-11-10')

      // Demand 3: lot 1 already at merged drops its historical merged slip; lot 2 is 🔵 sur la voie at dev with prod -> 2026-11-25
      const d3Rows = view.rows.filter((r) => r.num === 3)
      assert.equal(d3Rows[1]?.stage, 'merged')
      assert.equal(d3Rows[1]?.status, 'on-track')
      assert.equal(d3Rows[2]?.stage, 'dev')
      assert.equal(d3Rows[2]?.status, 'on-track')
      assert.equal(d3Rows[2]?.etas[0]?.when, '2026-11-25')

      // Demand 4: lot 1 has measured 2026-11-16; lot 2 has committed 2026-11-28
      const d4Rows = view.rows.filter((r) => r.num === 4)
      assert.equal(d4Rows[1]?.etas[0]?.when, '2026-11-16')
      assert.equal(d4Rows[1]?.etas[0]?.source, 'measured')
      assert.equal(d4Rows[2]?.etas[0]?.when, '2026-11-28')
      assert.equal(d4Rows[2]?.etas[0]?.source, 'committed')

      // Row 5 (single): post-rebaseline slip is 🟠 dérive with prod -> 2026-11-27 (glissement depuis 2026-11-20)
      const row5 = view.rows.find((r) => r.num === 5)!
      assert.equal(row5.status, 'unforeseen')
      assert.equal(formatOwnerStatusCell(row5), '🟠 dérive')
      assert.equal(row5.etas[0]?.when, '2026-11-27')
      assert.equal(row5.etas[0]?.slip?.initialWhen, '2026-11-20')

      assert.equal(auditOwnerTable(view).ok, true)
    })
  })

  it('Round 5 — Owner Decision 15/11 (« Une ligne par lot ») — RED→GREEN dissolution of Carbon P1-1, P1-2 & P2-1 across all 6 owner cases', () => {
    withTempTrack(({ dir }) => {
      const eventsPath = join(dir, '.track-r5-eta', 'events.jsonl')
      let clock = '2026-11-10T09:00:00.000Z'
      const track = new Track(new EventStore(eventsPath), {
        by: 'test-r5-eta',
        now: () => clock,
      })

      // Case 1: lot2 has a linked spec (`{ kind: 'spec', locator: 'docs/specs/lot2.md' }`) but is not started (`to-do`),
      // while lot1 is in-progress (`on-track` at `dev`).
      const d1 = track.raiseDemand({
        type: 'feature',
        workspace: 'ws-r5-eta',
        raw: { text: 'Cas 1 : lot 1 actif en dev, lot 2 avec spec liée mais non démarré' },
        source: { kind: 'human' },
      })
      track.numberDemand(d1, 1)
      track.claimDemand(d1, {})
      const [c1Lot1, c1Lot2] = track.agreeDemand(d1, {
        items: [
          { title: 'Lot 1 en dev', links: [{ kind: 'dev-branch', locator: 'feat/c1-lot1' }] },
          { title: 'Lot 2 spec liée non démarré', links: [{ kind: 'spec', locator: 'docs/specs/lot2.md' }] },
        ],
      })
      track.setRealization(c1Lot1!, 'in-progress')
      track.setReportStatus(c1Lot1!, {
        status: 'on-track',
        facts: 'Branche feat/c1-lot1 vérifiée.',
        nextAction: 'Ouvrir la PR du lot 1 (équipe)',
      })

      // Case 2: lot2 (with link) is paused by the owner, while lot1 is on-track at dev.
      const d2 = track.raiseDemand({
        type: 'feature',
        workspace: 'ws-r5-eta',
        raw: { text: 'Cas 2 : lot 1 actif en dev, lot 2 mis en pause par l owner' },
        source: { kind: 'human' },
      })
      track.numberDemand(d2, 2)
      track.claimDemand(d2, {})
      const [c2Lot1, c2Lot2] = track.agreeDemand(d2, {
        items: [
          { title: 'Lot 1 en dev', links: [{ kind: 'dev-branch', locator: 'feat/c2-lot1' }] },
          { title: 'Lot 2 en pause owner', links: [{ kind: 'spec', locator: 'docs/specs/c2-lot2.md' }] },
        ],
      })
      track.setRealization(c2Lot1!, 'in-progress')
      track.setReportStatus(c2Lot1!, {
        status: 'on-track',
        facts: 'Branche feat/c2-lot1 active.',
        nextAction: 'Finaliser le lot 1 (équipe)',
      })
      const pauseDec2 = track.createDecision({
        decisionKind: 'commitment',
        title: 'Mettre le lot 2 en pause ?',
        workspace: 'ws-r5-eta',
        targets: [c2Lot2!],
        dossier: {
          context: 'Pause lot 2.',
          qa: [],
          options: [
            { id: 'pause', title: 'Pause', summary: 'Geler le lot 2' },
            { id: 'continue', title: 'Continuer', summary: 'Démarrer le lot 2' },
          ],
          recommendation: { optionId: 'pause', rationale: 'Prioriser le lot 1' },
          artifacts: [{ kind: 'rendered-view', viewRef: 'docs/dossiers/c2-pause.md' }],
        },
      })
      track.selectDecisionOption(pauseDec2, 'pause', 'go')
      track.setReportStatus(c2Lot2!, {
        status: 'not-started',
        pausedByOwner: true,
        pauseDecisionId: pauseDec2,
        nextAction: 'En pause owner (équipe)',
      })

      // Case 3: lot1 gets a no-go, then lot2 continues — auditOwnerTable must pass.
      const d3 = track.raiseDemand({
        type: 'feature',
        workspace: 'ws-r5-eta',
        raw: { text: 'Cas 3 : lot 1 arrêté par no-go, lot 2 continue' },
        source: { kind: 'human' },
      })
      track.numberDemand(d3, 3)
      track.claimDemand(d3, {})
      const [c3Lot1, c3Lot2] = track.agreeDemand(d3, {
        items: [
          { title: 'Lot 1 abandonné par no-go', links: [{ kind: 'spec', locator: 'docs/specs/c3-lot1.md' }] },
          { title: 'Lot 2 poursuivi', links: [{ kind: 'dev-branch', locator: 'feat/c3-lot2' }] },
        ],
      })
      const noGoDec3 = track.createDecision({
        decisionKind: 'commitment',
        title: 'Poursuivre le lot 1 ?',
        workspace: 'ws-r5-eta',
        targets: [c3Lot1!],
        dossier: {
          context: 'Arbitrage lot 1.',
          qa: [],
          options: [
            { id: 'a', title: 'Continuer', summary: 'Livrer le lot 1' },
            { id: 'b', title: 'Arrêter le lot 1', summary: 'Retrait du lot 1 validé par l owner' },
          ],
          recommendation: { optionId: 'b', rationale: 'Lot 2 suffit' },
          artifacts: [{ kind: 'rendered-view', viewRef: 'docs/dossiers/c3-nogo.md' }],
        },
      })
      track.selectDecisionOption(noGoDec3, 'b', 'no-go')
      track.setRealization(c3Lot2!, 'in-progress')
      track.setReportStatus(c3Lot2!, {
        status: 'on-track',
        facts: 'Branche feat/c3-lot2 active.',
        nextAction: 'Ouvrir la PR du lot 2 (équipe)',
      })

      // Case 4 (Carbon P1-1): lot1 slipped on merged then merged (`pr-merged`), while lot2 is on time in dev
      // with a velocityBinding on merged -> lot2 NEVER inherits lot1's slip.
      const d4 = track.raiseDemand({
        type: 'feature',
        workspace: 'ws-r5-eta',
        raw: { text: 'Cas 4 : lot 1 fusionné après glissement, lot 2 à l heure en dev avec vélocité' },
        source: { kind: 'human' },
      })
      track.numberDemand(d4, 4)
      track.claimDemand(d4, {})
      const [c4Lot1, c4Lot2] = track.agreeDemand(d4, {
        items: [
          { title: 'Lot 1 fusionné après glissement', links: [{ kind: 'pr-merged', locator: 'PR #601' }] },
          { title: 'Lot 2 à l heure en dev', links: [{ kind: 'dev-branch', locator: 'feat/c4-lot2' }] },
        ],
      })
      track.setRealization(c4Lot1!, 'in-progress')
      track.setItemEta(c4Lot1!, {
        targetStage: 'merged',
        when: '2026-11-05',
        source: 'committed',
        by: 'Alice',
      })
      clock = '2026-11-08T09:00:00.000Z'
      track.setItemEta(c4Lot1!, {
        targetStage: 'merged',
        when: '2026-11-12',
        source: 'committed',
        by: 'Alice',
        reason: 'Retard initial avant fusion',
      })
      track.setReportStatus(c4Lot1!, {
        status: 'on-track',
        facts: 'PR #601 fusionnée.',
      })
      track.setRealization(c4Lot2!, 'in-progress')
      track.setReportStatus(c4Lot2!, {
        status: 'on-track',
        facts: 'Branche feat/c4-lot2 active.',
        nextAction: 'Ouvrir la PR du lot 2 (équipe)',
      })

      // Case 5 (Carbon P1-2): lot1 is cancelled with an overdue ETA, while lot2 is active in dev -> lot2 stays 🔵.
      const d5 = track.raiseDemand({
        type: 'feature',
        workspace: 'ws-r5-eta',
        raw: { text: 'Cas 5 : lot 1 annulé avec échéance dépassée, lot 2 actif en dev' },
        source: { kind: 'human' },
      })
      track.numberDemand(d5, 5)
      track.claimDemand(d5, {})
      const [c5Lot1, c5Lot2] = track.agreeDemand(d5, {
        items: [
          { title: 'Lot 1 annulé avec ancienne ETA', links: [{ kind: 'spec', locator: 'docs/specs/c5-lot1.md' }] },
          { title: 'Lot 2 actif en dev', links: [{ kind: 'dev-branch', locator: 'feat/c5-lot2' }] },
        ],
      })
      track.setItemEta(c5Lot1!, {
        targetStage: 'pr',
        when: '2026-11-01',
        source: 'committed',
        by: 'Alice',
      })
      track.setRealization(c5Lot1!, 'cancelled')
      track.setReportStatus(c5Lot1!, {
        status: 'withdrawn',
        facts: 'Annulé par l owner.',
        etas: [{ targetStage: 'pr', when: '2026-11-01', source: 'committed', by: 'Alice' }],
      })
      track.setRealization(c5Lot2!, 'in-progress')
      track.setReportStatus(c5Lot2!, {
        status: 'on-track',
        facts: 'Branche feat/c5-lot2 active.',
        nextAction: 'Continuer le lot 2 (équipe)',
      })

      // Case 6 (Carbon P2-1): the demand is rebaselined, then a lot slips, then the demand ETA is edited without a decision
      // -> the lot keeps 🟠 dérive, and the demand title row also records its own slip.
      clock = '2026-11-12T09:00:00.000Z'
      const d6 = track.raiseDemand({
        type: 'feature',
        workspace: 'ws-r5-eta',
        raw: { text: 'Cas 6 : demande recalée, puis glissement du lot 1, puis édition de l ETA demande sans décision' },
        source: { kind: 'human' },
      })
      track.numberDemand(d6, 6)
      track.claimDemand(d6, {})
      const [c6Lot1, c6Lot2] = track.agreeDemand(d6, {
        items: [
          { title: 'Lot 1 qui glisse après recalage', links: [{ kind: 'dev-branch', locator: 'feat/c6-lot1' }] },
          { title: 'Lot 2 à l heure', links: [{ kind: 'dev-branch', locator: 'feat/c6-lot2' }] },
        ],
      })
      track.setRealization(c6Lot1!, 'in-progress')
      track.setReportStatus(c6Lot1!, {
        status: 'on-track',
        facts: 'Branche feat/c6-lot1 active.',
        nextAction: 'Livrer le lot 1 (équipe)',
      })
      track.setRealization(c6Lot2!, 'in-progress')
      track.setReportStatus(c6Lot2!, {
        status: 'on-track',
        facts: 'Branche feat/c6-lot2 active.',
        nextAction: 'Livrer le lot 2 (équipe)',
      })

      const rebDec6 = track.createDecision({
        decisionKind: 'commitment',
        title: 'Recaler la demande 6 au 20/11 ?',
        workspace: 'ws-r5-eta',
        targets: [d6],
        dossier: {
          context: 'Recalage initial demande 6.',
          qa: [],
          options: [
            { id: 'go', title: 'Valider 20/11', summary: 'Cible demande au 20/11' },
            { id: 'no', title: 'Refuser', summary: 'Garder ancienne date' },
          ],
          recommendation: { optionId: 'go', rationale: 'Alignement jalon' },
          artifacts: [{ kind: 'rendered-view', viewRef: 'docs/dossiers/c6-reb.md' }],
        },
      })
      track.selectDecisionOption(rebDec6, 'go', 'go')
      track.setDemandEta(d6, {
        targetStage: 'prod',
        when: '2026-11-20',
        source: 'committed',
        by: 'Owner',
        rebaselineDecisionId: rebDec6,
      })

      // Next, c6Lot1 sets its initial ETA to 2026-11-20 and then slips to 2026-11-26
      clock = '2026-11-13T09:00:00.000Z'
      track.setItemEta(c6Lot1!, {
        targetStage: 'prod',
        when: '2026-11-20',
        source: 'committed',
        by: 'Alice',
      })
      clock = '2026-11-14T09:00:00.000Z'
      track.setItemEta(c6Lot1!, {
        targetStage: 'prod',
        when: '2026-11-26',
        source: 'committed',
        by: 'Alice',
        reason: 'Glissement propre au lot 1',
      })

      // Finally, the demand ETA is edited to 2026-11-28 WITHOUT a rebaselineDecisionId
      clock = '2026-11-14T15:00:00.000Z'
      track.setDemandEta(d6, {
        targetStage: 'prod',
        when: '2026-11-28',
        source: 'committed',
        by: 'Alice',
        reason: 'Décalage global sans décision',
      })

      const state = track.state()
      const events = new EventStore(eventsPath).readAll()
      const view = projectOwnerTable(state, events, {
        workspace: 'ws-r5-eta',
        baselineCommit: 'c1',
        now: '2026-11-14T19:00:00.000Z',
        velocityBindings: {
          [c4Lot2!]: qualifiedBaseInput('merged'),
        },
      })

      // 6 multi-lot demands * 3 rows each (1 demand-title + 2 lot rows) = 18 rows
      assert.equal(view.rows.length, 18)

      // Case 1 assertions
      const r1 = view.rows.filter((r) => r.num === 1)
      assert.equal(r1[0]?.kind, 'demand-title')
      assert.equal(r1[0]?.status, undefined)
      assert.equal(r1[1]?.status, 'on-track')
      assert.equal(r1[1]?.stage, 'dev')
      assert.equal(r1[2]?.status, 'not-started')
      assert.equal(r1[2]?.stage, 'spec')
      assert.equal(formatOwnerStatusCell(r1[2]!), '⚪ pas commencé')

      // Case 2 assertions
      const r2 = view.rows.filter((r) => r.num === 2)
      assert.equal(r2[1]?.status, 'on-track')
      assert.equal(r2[1]?.stage, 'dev')
      assert.equal(r2[2]?.status, 'not-started')
      assert.equal(r2[2]?.pausedByOwner, true)
      assert.equal(formatOwnerStatusCell(r2[2]!), '⚪ en pause')

      // Case 3 assertions
      const r3 = view.rows.filter((r) => r.num === 3)
      assert.equal(r3[1]?.status, 'withdrawn')
      assert.equal(formatOwnerStatusCell(r3[1]!), '⚫ retiré')
      assert.equal(r3[1]?.done, 'Retrait du lot 1 validé par l owner')
      assert.equal(r3[2]?.status, 'on-track')
      assert.equal(r3[2]?.stage, 'dev')

      // Case 4 assertions: c4Lot2 has measured merged -> 2026-11-16 with NO slip from c4Lot1, and stays 🔵 sur la voie
      const r4 = view.rows.filter((r) => r.num === 4)
      assert.equal(r4[1]?.status, 'on-track')
      assert.equal(r4[1]?.stage, 'merged')
      assert.equal(r4[2]?.status, 'on-track')
      assert.equal(formatOwnerStatusCell(r4[2]!), '🔵 sur la voie')
      assert.equal(r4[2]?.etas[0]?.targetStage, 'merged')
      assert.equal(r4[2]?.etas[0]?.source, 'measured')
      assert.equal(r4[2]?.etas[0]?.when, '2026-11-16')
      assert.equal(r4[2]?.etas[0]?.slip, undefined)

      // Case 5 assertions: c5Lot1 is ⚫ retiré with etas = []; c5Lot2 is 🔵 sur la voie with no leaked overdue ETA
      const r5 = view.rows.filter((r) => r.num === 5)
      assert.equal(r5[1]?.status, 'withdrawn')
      assert.deepEqual(r5[1]?.etas, [])
      assert.equal(r5[2]?.status, 'on-track')
      assert.equal(formatOwnerStatusCell(r5[2]!), '🔵 sur la voie')
      assert.equal(r5[2]?.etas[0]?.slip, undefined)

      // Case 6 assertions: c6Lot1 keeps 🟠 dérive (glissement depuis 2026-11-20), and the demand title row also records its slip
      const r6 = view.rows.filter((r) => r.num === 6)
      assert.equal(r6[0]?.kind, 'demand-title')
      assert.equal(r6[0]?.etas[0]?.when, '2026-11-28')
      assert.equal(r6[0]?.etas[0]?.slip?.initialWhen, '2026-11-20')
      assert.equal(state.demands.get(d6)?.etaJournal?.[0]?.rebaselineDecisionId, undefined)
      assert.equal(r6[1]?.status, 'unforeseen')
      assert.equal(formatOwnerStatusCell(r6[1]!), '🟠 dérive')
      assert.equal(r6[1]?.etas[0]?.when, '2026-11-26')
      assert.equal(r6[1]?.etas[0]?.slip?.initialWhen, '2026-11-20')
      assert.equal(r6[2]?.status, 'on-track')
      assert.equal(formatOwnerStatusCell(r6[2]!), '🔵 sur la voie')

      assert.equal(auditOwnerTable(view).ok, true)
      const md = renderOwnerTable(view, 'md')
      assert.ok(md.includes('↳ lot 1 —'))
      assert.ok(md.includes('↳ lot 2 —'))
    })
  })

  it('Round 6 (#457): P1-2 (no cross-lot or demand↔lot rebaselineDecisionId leak + single-use go decision) & P3-1 (demand ETA delivered on time extinguished)', () => {
    withTempTrack(({ eventsPath }) => {
      let clock = '2026-11-12T10:00:00.000Z'
      const store = new EventStore(eventsPath)
      const track = new Track(store, {
        by: 'test-actor',
        now: () => clock,
      })

      const d1 = track.raiseDemand({
        type: 'feature',
        workspace: 'ws-r6-eta',
        raw: { text: 'Demande R6 : isolement rebaselineDecisionId entre lots et demande + extinction ETA livrée à temps' },
        source: { kind: 'human' },
      })
      track.numberDemand(d1, 1)
      track.claimDemand(d1, {})
      const [lot1, lot2] = track.agreeDemand(d1, {
        items: [
          { title: 'Lot 1', links: [{ kind: 'dev-branch', locator: 'feat/r6-lot1' }] },
          { title: 'Lot 2', links: [{ kind: 'dev-branch', locator: 'feat/r6-lot2' }] },
        ],
      })
      for (const [lid, br] of [
        [lot1!, 'feat/r6-lot1'],
        [lot2!, 'feat/r6-lot2'],
      ] as const) {
        track.setRealization(lid, 'in-progress')
        track.setReportStatus(lid, {
          status: 'on-track',
          facts: `Branche ${br} active.`,
          nextAction: 'Livrer en prod (équipe)',
        })
      }

      // Old 'go' decision settled BEFORE lot1's initial ETA is even set
      const oldGoDec = track.createDecision({
        decisionKind: 'orientation',
        title: 'Ancien GO antérieur à l ETA initiale du lot 1',
        workspace: 'ws-r6-eta',
        targets: [lot1!],
        dossier: {
          context: 'Tranché avant l engagement ETA.',
          qa: [],
          options: [
            { id: 'go', title: 'Valider', summary: 'GO initial' },
            { id: 'no', title: 'Refuser', summary: 'Non' },
          ],
          recommendation: { optionId: 'go', rationale: 'OK' },
          artifacts: [{ kind: 'rendered-view', viewRef: 'docs/dossiers/r6-old.md' }],
        },
      })
      track.selectDecisionOption(oldGoDec, 'go', 'go')

      // Set initial ETAs at t1
      clock = '2026-11-13T10:00:00.000Z'
      track.setDemandEta(d1, {
        targetStage: 'prod',
        when: '2026-11-18',
        source: 'committed',
        by: 'Owner',
      })
      track.setItemEta(lot1!, {
        targetStage: 'prod',
        when: '2026-11-18',
        source: 'committed',
        by: 'Alice',
      })
      track.setItemEta(lot2!, {
        targetStage: 'prod',
        when: '2026-11-18',
        source: 'committed',
        by: 'Bob',
      })

      // At t2, create & settle a 'go' decision targeting ONLY lot1, and a 'go' decision targeting ONLY demand d1
      clock = '2026-11-14T10:00:00.000Z'
      const decLot1 = track.createDecision({
        decisionKind: 'commitment',
        title: 'Recaler uniquement le lot 1 au 22/11 ?',
        workspace: 'ws-r6-eta',
        targets: [lot1!],
        dossier: {
          context: 'Recalage propre au lot 1.',
          qa: [],
          options: [
            { id: 'go', title: 'Valider 22/11', summary: 'Nouvelle cible lot 1' },
            { id: 'no', title: 'Maintenir 18/11', summary: 'Garder 18/11' },
          ],
          recommendation: { optionId: 'go', rationale: 'Isolé au lot 1' },
          artifacts: [{ kind: 'rendered-view', viewRef: 'docs/dossiers/r6-lot1.md' }],
        },
      })
      track.selectDecisionOption(decLot1, 'go', 'go')

      const decDemand = track.createDecision({
        decisionKind: 'commitment',
        title: 'Recaler l enveloppe demande 1 au 24/11 ?',
        workspace: 'ws-r6-eta',
        targets: [d1],
        dossier: {
          context: 'Recalage propre à la ligne de titre de la demande.',
          qa: [],
          options: [
            { id: 'go', title: 'Valider 24/11', summary: 'Nouvelle cible demande' },
            { id: 'no', title: 'Maintenir 18/11', summary: 'Garder 18/11' },
          ],
          recommendation: { optionId: 'go', rationale: 'Isolé à la demande' },
          artifacts: [{ kind: 'rendered-view', viewRef: 'docs/dossiers/r6-demand.md' }],
        },
      })
      track.selectDecisionOption(decDemand, 'go', 'go')

      // P1-2 (1): Cross-lot and demand↔lot rebaseline attempts are REJECTED at write time
      assert.throws(
        () =>
          track.setItemEta(lot2!, {
            targetStage: 'prod',
            when: '2026-11-22',
            source: 'committed',
            by: 'Bob',
            rebaselineDecisionId: decLot1,
          }),
        DomainError,
      )
      assert.throws(
        () =>
          track.setDemandEta(d1, {
            targetStage: 'prod',
            when: '2026-11-22',
            source: 'committed',
            by: 'Owner',
            rebaselineDecisionId: decLot1,
          }),
        DomainError,
      )
      assert.throws(
        () =>
          track.setItemEta(lot2!, {
            targetStage: 'prod',
            when: '2026-11-24',
            source: 'committed',
            by: 'Bob',
            rebaselineDecisionId: decDemand,
          }),
        DomainError,
      )

      // P1-2 (2a): Old 'go' decision settled BEFORE the current ETA was set cannot rebaseline a later slip
      assert.throws(
        () =>
          track.setItemEta(lot1!, {
            targetStage: 'prod',
            when: '2026-11-22',
            source: 'committed',
            by: 'Alice',
            rebaselineDecisionId: oldGoDec,
          }),
        DomainError,
      )

      // Legitimate single-use rebaselines on lot1 (with decLot1) and on demand d1 (with decDemand) succeed
      clock = '2026-11-14T11:00:00.000Z'
      track.setItemEta(lot1!, {
        targetStage: 'prod',
        when: '2026-11-22',
        source: 'committed',
        by: 'Alice',
        rebaselineDecisionId: decLot1,
      })
      track.setDemandEta(d1, {
        targetStage: 'prod',
        when: '2026-11-24',
        source: 'committed',
        by: 'Owner',
        rebaselineDecisionId: decDemand,
      })

      // P1-2 (2b): Reusing an already consumed 'go' decision on a later slip is REJECTED at write time
      clock = '2026-11-15T10:00:00.000Z'
      assert.throws(
        () =>
          track.setItemEta(lot1!, {
            targetStage: 'prod',
            when: '2026-11-28',
            source: 'committed',
            by: 'Alice',
            rebaselineDecisionId: decLot1,
          }),
        DomainError,
      )
      assert.throws(
        () =>
          track.setDemandEta(d1, {
            targetStage: 'prod',
            when: '2026-11-30',
            source: 'committed',
            by: 'Owner',
            rebaselineDecisionId: decDemand,
          }),
        DomainError,
      )

      // Even if lot1 slips without a decision first (22/11 -> 26/11), and then tries to reuse decLot1 on a 3rd update (26/11 -> 29/11), it is STILL rejected
      track.setItemEta(lot1!, {
        targetStage: 'prod',
        when: '2026-11-26',
        source: 'committed',
        by: 'Alice',
        reason: 'Nouveau retard lot 1',
      })
      assert.throws(
        () =>
          track.setItemEta(lot1!, {
            targetStage: 'prod',
            when: '2026-11-29',
            source: 'committed',
            by: 'Alice',
            rebaselineDecisionId: decLot1,
          }),
        DomainError,
      )

      // P3-1: Cannot mark a slipped ETA or a past-due ETA as delivered on time
      assert.throws(
        () =>
          track.setItemEta(lot1!, {
            targetStage: 'prod',
            delivered: true,
          }),
        DomainError,
      )
      clock = '2026-11-26T12:00:00.000Z'
      assert.throws(
        () =>
          track.setDemandEta(d1, {
            targetStage: 'prod',
            delivered: true,
          }),
        DomainError,
      )

      // P3-1: Demand d1's ETA (2026-11-24) is acknowledged as delivered on time at 2026-11-20 -> extinguished on demand-title row even when queried at 2026-11-28
      clock = '2026-11-20T12:00:00.000Z'
      track.setDemandEta(d1, {
        targetStage: 'prod',
        delivered: true,
      })

      const state = track.state()
      const events = store.readAll()
      const viewAfterDeadline = projectOwnerTable(state, events, {
        workspace: 'ws-r6-eta',
        baselineCommit: 'c1',
        now: '2026-11-28T12:00:00.000Z',
      })
      assert.equal(auditOwnerTable(viewAfterDeadline).ok, true)
      const d1Rows = viewAfterDeadline.rows.filter((r) => r.num === 1)
      assert.equal(d1Rows[0]?.kind, 'demand-title')
      assert.deepEqual(d1Rows[0]?.etas, [])
      assert.equal(formatOwnerEtaCell(d1Rows[0]!.etas), '—')
    })
  })

  it('Round 7 (#457): P2-2 (slot-local rebaseline consumption allows a multi-target go decision to rebaseline each targeted lot/slot once without cross-lot state scanning) & P3-1 (track item eta --delivered CLI symmetry)', () => {
    withTempTrack(({ dir, eventsPath }) => {
      let clock = '2026-11-12T10:00:00.000Z'
      const store = new EventStore(eventsPath)
      const track = new Track(store, {
        by: 'test-actor',
        now: () => clock,
      })

      const d1 = track.raiseDemand({
        type: 'feature',
        workspace: 'ws-r7-eta',
        raw: { text: 'Demande R7 : décision go multi-cibles sur lot 1 et lot 2 + CLI item eta --delivered' },
        source: { kind: 'human' },
      })
      track.numberDemand(d1, 1)
      track.claimDemand(d1, {})
      const [lot1, lot2, lot3] = track.agreeDemand(d1, {
        items: [
          { title: 'Lot 1', links: [{ kind: 'dev-branch', locator: 'feat/r7-lot1' }] },
          { title: 'Lot 2', links: [{ kind: 'dev-branch', locator: 'feat/r7-lot2' }] },
          { title: 'Lot 3', links: [{ kind: 'dev-branch', locator: 'feat/r7-lot3' }] },
        ],
      })
      for (const [lid, br] of [
        [lot1!, 'feat/r7-lot1'],
        [lot2!, 'feat/r7-lot2'],
        [lot3!, 'feat/r7-lot3'],
      ] as const) {
        track.setRealization(lid, 'in-progress')
        track.setReportStatus(lid, {
          status: 'on-track',
          facts: `Branche ${br} active.`,
          nextAction: 'Livrer en prod (équipe)',
        })
      }

      // Initial ETAs at t1: lot1 has pr + prod, lot2 has prod, lot3 has prod
      clock = '2026-11-13T10:00:00.000Z'
      track.setItemEta(lot1!, {
        targetStage: 'pr',
        when: '2026-11-16',
        source: 'committed',
        by: 'Alice',
      })
      track.setItemEta(lot1!, {
        targetStage: 'prod',
        when: '2026-11-18',
        source: 'committed',
        by: 'Alice',
      })
      track.setItemEta(lot2!, {
        targetStage: 'prod',
        when: '2026-11-18',
        source: 'committed',
        by: 'Bob',
      })
      track.setItemEta(lot3!, {
        targetStage: 'prod',
        when: '2026-11-18',
        source: 'committed',
        by: 'Charlie',
      })

      // At t2, create & settle a multi-target 'go' decision targeting [lot1, lot2] (not lot3)
      clock = '2026-11-14T10:00:00.000Z'
      const sharedGo = track.createDecision({
        decisionKind: 'commitment',
        title: 'Recaler les lots 1 et 2 au 25/11 ?',
        workspace: 'ws-r7-eta',
        targets: [lot1!, lot2!],
        dossier: {
          context: 'Recalage conjoint autorisé par l owner sur les lots 1 et 2.',
          qa: [],
          options: [
            { id: 'go', title: 'Valider 25/11', summary: 'Recaler lot 1 et lot 2' },
            { id: 'no', title: 'Maintenir 18/11', summary: 'Garder 18/11' },
          ],
          recommendation: { optionId: 'go', rationale: 'Lots 1 et 2 liés par la même contrainte' },
          artifacts: [{ kind: 'rendered-view', viewRef: 'docs/dossiers/r7-shared-go.md' }],
        },
      })
      track.selectDecisionOption(sharedGo, 'go', 'go')

      // P2-2: sharedGo rebaselines lot1 (both pr and prod slots) AND lot2 (prod slot) once without cross-lot rejection
      clock = '2026-11-14T11:00:00.000Z'
      track.setItemEta(lot1!, {
        targetStage: 'pr',
        when: '2026-11-21',
        source: 'committed',
        by: 'Alice',
        rebaselineDecisionId: sharedGo,
      })
      track.setItemEta(lot1!, {
        targetStage: 'prod',
        when: '2026-11-25',
        source: 'committed',
        by: 'Alice',
        rebaselineDecisionId: sharedGo,
      })
      track.setItemEta(lot2!, {
        targetStage: 'prod',
        when: '2026-11-25',
        source: 'committed',
        by: 'Bob',
        rebaselineDecisionId: sharedGo,
      })

      // Untargeted lot3 is still rejected by decisionTargetsAggregate
      assert.throws(
        () =>
          track.setItemEta(lot3!, {
            targetStage: 'prod',
            when: '2026-11-25',
            source: 'committed',
            by: 'Charlie',
            rebaselineDecisionId: sharedGo,
          }),
        DomainError,
      )

      // A second reuse of sharedGo on lot1's prod slot or lot2's prod slot is rejected by isSlotRebaselineDecisionConsumed
      clock = '2026-11-15T10:00:00.000Z'
      assert.throws(
        () =>
          track.setItemEta(lot1!, {
            targetStage: 'prod',
            when: '2026-11-29',
            source: 'committed',
            by: 'Alice',
            rebaselineDecisionId: sharedGo,
          }),
        DomainError,
      )
      assert.throws(
        () =>
          track.setItemEta(lot2!, {
            targetStage: 'prod',
            when: '2026-11-29',
            source: 'committed',
            by: 'Bob',
            rebaselineDecisionId: sharedGo,
          }),
        DomainError,
      )

      // P3-1: CLI symmetry — `track item eta <itemId> --target-stage pr --delivered` acknowledges on-time delivery.
      // The CLI builds its own Track on the wall clock, so pin it to the
      // test's logical time: without this, the 2026-11-21 ETA reads as
      // past-due as soon as the real date passes it (calendar time bomb).
      let cliOut = ''
      let cliErr = ''
      let rc: number | Promise<number>
      vi.useFakeTimers()
      try {
        vi.setSystemTime(new Date('2026-11-15T10:00:00.000Z'))
        rc = runCli(['item', 'eta', lot1!, '--target-stage', 'pr', '--delivered'], {
          cwd: dir,
          out: (s) => {
            cliOut += s
          },
          err: (s) => {
            cliErr += s
          },
        })
      } finally {
        vi.useRealTimers()
      }
      assert.equal(rc, 0, cliErr)
      assert.equal(cliOut, 'ok\n')

      const state = track.state()
      const events = store.readAll()
      const view = projectOwnerTable(state, events, {
        workspace: 'ws-r7-eta',
        baselineCommit: 'c1',
        now: '2026-11-17T12:00:00.000Z',
      })
      assert.equal(auditOwnerTable(view).ok, true)
      const byId = new Map(view.rows.map((r) => [r.id, r]))
      // lot1's pr ETA was delivered on time via CLI; only prod -> 2026-11-25 remains, with no slip
      assert.equal(byId.get(lot1!)?.status, 'on-track')
      assert.deepEqual(
        byId.get(lot1!)?.etas.map((e) => ({ targetStage: e.targetStage, when: e.when, slip: e.slip })),
        [{ targetStage: 'prod', when: '2026-11-25', slip: undefined }],
      )
      // lot2's prod ETA was rebaselined to 2026-11-25 by sharedGo, with no slip
      assert.equal(byId.get(lot2!)?.status, 'on-track')
      assert.deepEqual(
        byId.get(lot2!)?.etas.map((e) => ({ targetStage: e.targetStage, when: e.when, slip: e.slip })),
        [{ targetStage: 'prod', when: '2026-11-25', slip: undefined }],
      )
    })
  })

  it('Round 8 (#457) — P2-1 (1/3): foldEtaJournalEntry evicts a delivered slot before an active non-slipped slot, and writeDemandEta/writeItemEta saturation guard excludes delivered slots', () => {
    withTempTrack(({ eventsPath }) => {
      let clock = '2026-11-12T10:00:00.000Z'
      const store = new EventStore(eventsPath)
      const track = new Track(store, {
        by: 'test-actor',
        now: () => clock,
      })

      const d1 = track.raiseDemand({
        type: 'feature',
        workspace: 'ws-r8-eta-1',
        raw: { text: 'Demande R8-1 : priorité d éviction des créneaux delivered et garde de saturation' },
        source: { kind: 'human' },
      })
      track.numberDemand(d1, 1)
      track.claimDemand(d1, {})
      const [lot1, lot2] = track.agreeDemand(d1, {
        items: [
          { title: 'Lot 1', links: [{ kind: 'dev-branch', locator: 'feat/r8-1-lot1' }] },
          { title: 'Lot 2', links: [{ kind: 'dev-branch', locator: 'feat/r8-1-lot2' }] },
        ],
      })
      for (const [lid, br] of [
        [lot1!, 'feat/r8-1-lot1'],
        [lot2!, 'feat/r8-1-lot2'],
      ] as const) {
        track.setRealization(lid, 'in-progress')
        track.setReportStatus(lid, {
          status: 'on-track',
          facts: `Branche ${br} active.`,
          nextAction: 'Livrer en prod (équipe)',
        })
      }

      // 1) Demand d1: slot 0 is active (prod -> 2026-11-30), slot 1 is intermediate (pr -> 2026-11-18)
      clock = '2026-11-13T10:00:00.000Z'
      track.setDemandEta(d1, {
        targetStage: 'prod',
        when: '2026-11-30',
        source: 'committed',
        by: 'Alice',
      })
      track.setDemandEta(d1, {
        targetStage: 'pr',
        when: '2026-11-18',
        source: 'committed',
        by: 'Alice',
      })

      // At 2026-11-15, pr is acknowledged on time via delivered: true
      clock = '2026-11-15T10:00:00.000Z'
      track.setDemandEta(d1, {
        targetStage: 'pr',
        delivered: true,
      })

      // Next milestone review -> 2026-11-24 is added: must evict slot 1 (pr, delivered: true) and preserve slot 0 (prod -> 2026-11-30)
      clock = '2026-11-15T12:00:00.000Z'
      track.setDemandEta(d1, {
        targetStage: 'review',
        when: '2026-11-24',
        source: 'committed',
        by: 'Alice',
      })

      const view = projectOwnerTable(track.state(), store.readAll(), {
        workspace: 'ws-r8-eta-1',
        baselineCommit: 'c1',
        now: '2026-11-16T12:00:00.000Z',
      })
      assert.equal(auditOwnerTable(view).ok, true)
      const titleRow = view.rows.find((r) => r.kind === 'demand-title' && r.id === d1)
      assert.deepEqual(
        titleRow?.etas.map((e) => ({ targetStage: e.targetStage, when: e.when })),
        [
          { targetStage: 'review', when: '2026-11-24' },
          { targetStage: 'prod', when: '2026-11-30' },
        ],
      )

      // 2) Saturation guard: if slot 0 has slipped and slot 1 is delivered (even if slot 1 had a prior slip history cleared or another slot slipped),
      // delivered slots do not count as active slipped slots blocking a new targetStage.
      // Specifically: on lot1, slot 0 (prod) slips (2026-11-28 -> 2026-11-30), slot 1 (pr) is delivered on time; adding review -> 2026-11-24 succeeds and evicts pr.
      clock = '2026-11-13T10:00:00.000Z'
      track.setItemEta(lot1!, {
        targetStage: 'prod',
        when: '2026-11-28',
        source: 'committed',
        by: 'Bob',
      })
      track.setItemEta(lot1!, {
        targetStage: 'prod',
        when: '2026-11-30',
        source: 'committed',
        by: 'Bob',
        reason: 'Décalage prod de 2 jours',
      })
      track.setItemEta(lot1!, {
        targetStage: 'pr',
        when: '2026-11-18',
        source: 'committed',
        by: 'Bob',
      })
      clock = '2026-11-15T10:00:00.000Z'
      track.setItemEta(lot1!, {
        targetStage: 'pr',
        delivered: true,
      })
      track.setItemEta(lot1!, {
        targetStage: 'review',
        when: '2026-11-24',
        source: 'committed',
        by: 'Bob',
      })
      assert.deepEqual(
        track.state().items.get(lot1!)?.etaJournal?.map((e) => ({
          targetStage: e.targetStage,
          when: e.when,
          delivered: e.delivered,
          slipInitial: e.slip?.initialWhen,
        })),
        [
          { targetStage: 'prod', when: '2026-11-30', delivered: undefined, slipInitial: '2026-11-28' },
          { targetStage: 'review', when: '2026-11-24', delivered: undefined, slipInitial: undefined },
        ],
      )
    })
  })

  it('Round 8 (#457) — P2-1 (2/3): setting a new ETA on a previously delivered targetStage resets the slot as a fresh baseline without false slip while preserving priorConsumedIds', () => {
    withTempTrack(({ eventsPath }) => {
      let clock = '2026-11-12T10:00:00.000Z'
      const store = new EventStore(eventsPath)
      const track = new Track(store, {
        by: 'test-actor',
        now: () => clock,
      })

      const itemId = track.createItem({
        title: 'Lot autonome R8-2',
        kind: 'feature',
        workspace: 'ws-r8-eta-2',
        links: [{ kind: 'dev-branch', locator: 'feat/r8-2' }],
      })
      track.setRealization(itemId, 'in-progress')
      track.setReportStatus(itemId, {
        ownerNumber: 1,
        ownerRequest: 'Demande R8-2 : réinitialisation d un créneau livré',
        status: 'on-track',
        facts: 'Branche feat/r8-2 active.',
        nextAction: 'Ouvrir la PR (équipe)',
      })

      // Set initial pr -> 2026-11-15, rebaseline once with a go decision D1 to 2026-11-18, then mark delivered on time
      clock = '2026-11-12T12:00:00.000Z'
      track.setItemEta(itemId, {
        targetStage: 'pr',
        when: '2026-11-15',
        source: 'committed',
        by: 'Alice',
      })
      clock = '2026-11-13T10:00:00.000Z'
      const dGo = track.createDecision({
        decisionKind: 'commitment',
        title: 'Recaler PR au 18/11 ?',
        workspace: 'ws-r8-eta-2',
        targets: [itemId],
        dossier: {
          context: 'Recalage initial.',
          qa: [],
          options: [
            { id: 'go', title: 'Go 18/11', summary: 'Recaler au 18/11' },
            { id: 'no', title: 'Maintenir 15/11', summary: 'Maintenir' },
          ],
          recommendation: { optionId: 'go', rationale: 'Alignement' },
          artifacts: [{ kind: 'rendered-view', viewRef: 'docs/dossiers/r8-2.md' }],
        },
      })
      track.selectDecisionOption(dGo, 'go', 'go')
      clock = '2026-11-13T11:00:00.000Z'
      track.setItemEta(itemId, {
        targetStage: 'pr',
        when: '2026-11-18',
        source: 'committed',
        by: 'Alice',
        rebaselineDecisionId: dGo,
      })

      // Delivered on time at 2026-11-16
      clock = '2026-11-16T10:00:00.000Z'
      track.setItemEta(itemId, {
        targetStage: 'pr',
        delivered: true,
      })

      // Later, a new cycle sets a new ETA on the same targetStage 'pr' -> '2026-11-25' without a rebaseline decision
      clock = '2026-11-19T10:00:00.000Z'
      track.setItemEta(itemId, {
        targetStage: 'pr',
        when: '2026-11-25',
        source: 'committed',
        by: 'Alice',
      })

      const slot = track.state().items.get(itemId)?.etaJournal?.find((e) => e.targetStage === 'pr')
      assert.equal(slot?.when, '2026-11-25')
      assert.equal(slot?.initialWhen, '2026-11-25')
      assert.equal(slot?.delivered, undefined)
      assert.equal(slot?.slip, undefined)
      assert.deepEqual(slot?.slips, [])
      assert.deepEqual(slot?.rebaselineDecisionIds, [dGo])

      // Prior consumed decision dGo still cannot be reused on this slot
      assert.throws(
        () =>
          track.setItemEta(itemId, {
            targetStage: 'pr',
            when: '2026-11-28',
            source: 'committed',
            by: 'Alice',
            rebaselineDecisionId: dGo,
          }),
        DomainError,
      )

      const view = projectOwnerTable(track.state(), store.readAll(), {
        workspace: 'ws-r8-eta-2',
        baselineCommit: 'c1',
        now: '2026-11-20T12:00:00.000Z',
      })
      assert.equal(auditOwnerTable(view).ok, true)
      assert.equal(view.rows[0]?.status, 'on-track')
      assert.deepEqual(view.rows[0]?.etas, [
        { targetStage: 'pr', when: '2026-11-25', source: 'committed', by: 'Alice' },
      ])
    })
  })

  it('Round 8 (#457) — P2-1 (3/3): journalToReportEtas and graphExportFromState exclude delivered slots so subsequent setReportStatus does not resurrect a delivered ETA as 🟠 dérive', () => {
    withTempTrack(({ eventsPath }) => {
      let clock = '2026-11-12T10:00:00.000Z'
      const store = new EventStore(eventsPath)
      const track = new Track(store, {
        by: 'test-actor',
        now: () => clock,
      })

      const d1 = track.raiseDemand({
        type: 'feature',
        workspace: 'ws-r8-eta-3',
        raw: { text: 'Demande R8-3 : non-résurrection des ETAs livrées via report.etas et graphExportFromState' },
        source: { kind: 'human' },
      })
      track.numberDemand(d1, 1)
      track.claimDemand(d1, {})
      const [lot1] = track.agreeDemand(d1, {
        items: [{ title: 'Lot unique R8-3', links: [{ kind: 'dev-branch', locator: 'feat/r8-3' }] }],
      })
      track.setRealization(lot1!, 'in-progress')
      track.setReportStatus(lot1!, {
        status: 'on-track',
        facts: 'Branche feat/r8-3 active.',
        nextAction: 'Ouvrir la PR (équipe)',
      })

      // Set pr -> 2026-11-18 on both demand d1 and item lot1
      clock = '2026-11-13T10:00:00.000Z'
      track.setDemandEta(d1, {
        targetStage: 'pr',
        when: '2026-11-18',
        source: 'committed',
        by: 'Alice',
      })
      track.setItemEta(lot1!, {
        targetStage: 'pr',
        when: '2026-11-18',
        source: 'committed',
        by: 'Alice',
      })

      // Acknowledge both as delivered on time at 2026-11-15
      clock = '2026-11-15T10:00:00.000Z'
      track.setDemandEta(d1, {
        targetStage: 'pr',
        delivered: true,
      })
      track.setItemEta(lot1!, {
        targetStage: 'pr',
        delivered: true,
      })

      // 1) item.report.etas must be [] (delivered entry filtered out by journalToReportEtas)
      const itemAfterDelivered = track.state().items.get(lot1!)
      assert.deepEqual(itemAfterDelivered?.report?.etas, [])

      // 2) graphExportFromState must exclude delivered entries from eta_count on both Item and Demand nodes
      const graph = graphExportFromState(track.state(), {
        repoKey: 'repo-test',
        sourceId: 'ws-r8-eta-3',
        observedAt: '2026-11-15T10:00:00.000Z',
        sourceHash: 'sha256:0000',
      })
      const itemNode = graph.nodes.find((n) => n.id === lot1!)
      const demandNode = graph.nodes.find((n) => n.id === d1)
      assert.equal(itemNode?.['eta_count'], undefined)
      assert.equal(demandNode?.['eta_count'], undefined)

      // 3) Subsequent setReportStatus passing existing item.report.etas must NOT resurrect the delivered slot
      clock = '2026-11-16T10:00:00.000Z'
      track.setReportStatus(lot1!, {
        status: 'on-track',
        facts: 'PR livrée à l heure, suite du développement.',
        nextAction: 'Préparer la fusion (équipe)',
        ...(itemAfterDelivered?.report?.etas !== undefined ? { etas: itemAfterDelivered.report.etas } : {}),
      })

      // Evaluated after 2026-11-18 (at 2026-11-20), the lot stays 🔵 sur la voie ('on-track'), NOT 🟠 dérive ('unforeseen')
      const view = projectOwnerTable(track.state(), store.readAll(), {
        workspace: 'ws-r8-eta-3',
        baselineCommit: 'c1',
        now: '2026-11-20T12:00:00.000Z',
      })
      assert.equal(auditOwnerTable(view).ok, true)
      assert.equal(view.rows[0]?.status, 'on-track')
      assert.equal(formatOwnerStatusCell(view.rows[0]!), '🔵 sur la voie')
      assert.deepEqual(view.rows[0]?.etas, [
        { targetStage: 'pr', when: '—', source: 'unknown' },
      ])
    })
  })
})
