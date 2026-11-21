import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { runCli } from '../cli/index.js'
import { EventStore } from '../events/store.js'
import { REPORT_STAGES, REPORT_STATUSES } from '../model/report-status.js'
import { TrackReader } from '../read/contract.js'
import { fold } from '../state/fold.js'
import { Track } from '../track.js'
import {
  auditOwnerTable,
  formatOwnerDecisionCell,
  formatOwnerEtaCell,
  formatOwnerStageCell,
  formatOwnerStatusCell,
  formatOwnerTableNoJournalMessage,
  optionLetter,
  OWNER_TABLE_ALL_ARCHIVED_MESSAGE,
  OWNER_TABLE_HEADERS,
  OWNER_TABLE_NO_DEMANDS_MESSAGE,
  projectOwnerTable,
  renderOwnerTable,
  type OwnerTableRow,
  type OwnerTableView,
} from './owner-table.js'
import { deriveItemStageStatus } from './stage-status.js'

let dir: string
let eventsPath: string
let store: EventStore
let track: Track
let clock: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'track-owner-table-'))
  eventsPath = join(dir, '.track', 'events.jsonl')
  store = new EventStore(eventsPath)
  clock = '2026-11-14T12:00:00.000Z'
  track = new Track(store, { by: 'test-owner-table', now: () => clock })
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function cli(args: string[]): { code: number; out: string; err: string } {
  let out = ''
  let err = ''
  const code = runCli(args, {
    cwd: dir,
    out: (s) => {
      out += s
    },
    err: (s) => {
      err += s
    },
  })
  return { code: code as number, out, err }
}

describe('owner-table — 14/11 binding owner decisions', () => {
  it('enforces the exact 8 columns in order and renders the prototype statuses, stages, ETAs, decisions, and reply line', () => {
    expect(OWNER_TABLE_HEADERS).toEqual([
      '#',
      'Statut',
      'Étape',
      'ETA (étape cible)',
      'Ta demande',
      'Fait',
      'À faire (qui)',
      'Décision',
    ])
    expect(REPORT_STAGES).toEqual([
      'brainstorm',
      'spec',
      'plan',
      'dev',
      'test',
      'pr',
      'review',
      'merged',
      'published',
      'preprod',
      'prod',
      'done',
    ])
    expect(REPORT_STATUSES).toEqual([
      'withdrawn',
      'blocked',
      'unforeseen',
      'waiting',
      'done',
      'on-track',
      'not-started',
      'not-qualified',
    ])

    expect(formatOwnerStatusCell({ status: 'on-track' })).toBe('🔵 sur la voie')
    expect(formatOwnerStatusCell({ status: 'waiting' })).toBe('🟡 en attente')
    expect(formatOwnerStatusCell({ status: 'unforeseen' })).toBe('🟠 dérive')
    expect(formatOwnerStatusCell({ status: 'blocked' })).toBe('🔴 bloqué')
    expect(formatOwnerStatusCell({ status: 'not-started', pausedByOwner: false })).toBe('⚪ pas commencé')
    expect(formatOwnerStatusCell({ status: 'not-started', pausedByOwner: true })).toBe('⚪ en pause')
    expect(formatOwnerStatusCell({ status: 'done' })).toBe('✅ fait')
    expect(formatOwnerStatusCell({ status: 'withdrawn' })).toBe('⚫ retiré')
    expect(formatOwnerStatusCell({ status: 'not-qualified' })).toBe('— sans témoin')
    expect(formatOwnerStatusCell({ kind: 'demand-title', status: undefined })).toBe('—')

    expect(optionLetter(0)).toBe('A')
    expect(optionLetter(25)).toBe('Z')
    expect(optionLetter(26)).toBe('AA')
    expect(optionLetter(27)).toBe('AB')
    expect(optionLetter(51)).toBe('AZ')
    expect(optionLetter(52)).toBe('BA')
    expect(optionLetter(89)).toBe('CL')

    expect(formatOwnerStageCell({})).toBe('—')
    expect(formatOwnerStageCell({ stage: 'spec', requestedStage: 'spec' })).toBe('spec (demandée)')
    expect(formatOwnerStageCell({ stage: 'merged', requestedStage: 'done' })).toBe('merged')

    expect(
      formatOwnerEtaCell([
        { targetStage: 'spec', when: '2026-11-15', source: 'measured' },
        { targetStage: 'prod', targetLabel: 'MEP', when: '2026-11-20', source: 'committed', by: 'Jean' },
      ]),
    ).toBe('spec → 2026-11-15 (mesuré) · prod (MEP) → 2026-11-20 (engagé : Jean)')
    expect(
      formatOwnerEtaCell([
        { targetStage: 'prod', targetLabel: 'MEP', when: '2026-11-18', slip: { initialWhen: '2026-11-12' }, source: 'measured' },
      ]),
    ).toBe('prod (MEP) → 2026-11-18 (mesuré, glissement depuis 2026-11-12)')

    expect(formatOwnerDecisionCell({ decisionRefs: ['D1'], decisionBlocking: true })).toBe('🚩 D1 bloquante')
    expect(
      formatOwnerDecisionCell({
        decisionRefs: ['D1', 'D2'],
        blockingDecisionRefs: ['D1'],
        decisionBlocking: true,
      }),
    ).toBe('🚩 D1 bloquante · D2')
    expect(formatOwnerDecisionCell({ decisionRefs: ['D2'], decisionBlocking: false })).toBe('D2')
    expect(formatOwnerDecisionCell({ decisionRefs: [], decisionBlocking: false })).toBe('—')
  })

  it('projects numbered demands, items, and structured decisions and renders the complete owner table + reply line', () => {
    const d1 = track.raiseDemand({
      type: 'feature',
      workspace: 'ws',
      raw: { text: 'Spécifier la refonte du rapport owner' },
      source: { kind: 'human' },
    })
    track.numberDemand(d1, 1)
    track.updateDemandOwnerSummary(d1, {
      summary: 'Spécifier la refonte du rapport owner',
      requestedStage: 'spec',
    })
    track.claimDemand(d1, {})
    const [item1] = track.agreeDemand(d1, {
      items: [
        {
          title: 'Refonte rapport owner',
          links: [{ kind: 'spec', locator: 'docs/specs/owner-table.md' }],
        },
      ],
    })
    track.setRealization(item1!, 'in-progress')
    track.setReportStatus(item1!, {
      status: 'on-track',
      facts: 'Spécification consolidée (docs/specs/owner-table.md).',
      nextAction: 'Valider la maquette finale (équipe produit)',
      etas: [{ targetStage: 'dev', when: '2026-11-15', source: 'committed', by: 'Marie' }],
    })

    const d2 = track.raiseDemand({
      type: 'feature',
      workspace: 'ws',
      raw: { text: 'Choisir le canal de notification de livraison' },
      source: { kind: 'human' },
    })
    track.numberDemand(d2, 2)
    track.claimDemand(d2, {})
    const [item2] = track.agreeDemand(d2, {
      items: [{ title: 'Canal de notification', links: [{ kind: 'spec', locator: 'docs/specs/canal.md' }] }],
    })
    track.setRealization(item2!, 'in-progress')
    const decisionId = track.createDecision({
      decisionKind: 'orientation',
      title: 'Quel canal utiliser pour notifier la mise en production ?',
      workspace: 'ws',
      targets: [item2!],
      dossier: {
        context: 'Arbitrage requis avant le branchement.',
        qa: [],
        options: [
          { id: 'a', title: 'Webhook dédié', summary: 'Simple et immédiat, un seul point de sortie' },
          { id: 'b', title: 'File de messages', summary: 'Reprise sur panne mais infrastructure supplémentaire' },
        ],
        recommendation: { optionId: 'a', rationale: 'Délai court et zéro dépendance externe' },
        artifacts: [{ kind: 'rendered-view', viewRef: 'docs/dossiers/canal-notification.md' }],
      },
    })
    void decisionId

    const reader = new TrackReader(eventsPath)
    const view = reader.ownerTable({ baselineCommit: 'c1', now: '2026-11-14T12:00:00.000Z' })
    expect(view.rows).toHaveLength(2)
    expect(view.rows[0]?.num).toBe(1)
    expect(view.rows[0]?.status).toBe('on-track')
    expect(view.rows[0]?.stage).toBe('spec')
    expect(view.rows[0]?.requestedStage).toBe('spec')
    expect(view.rows[1]?.num).toBe(2)
    expect(view.rows[1]?.status).toBe('blocked')
    expect(view.rows[1]?.decisionRefs).toEqual(['D1'])
    expect(view.rows[1]?.decisionBlocking).toBe(true)
    expect(view.rows[1]?.todo).toContain('bloqué par D1')

    const md = renderOwnerTable(view)
    expect(md).toContain('| # | Statut | Étape | ETA (étape cible) | Ta demande | Fait | À faire (qui) | Décision |')
    expect(md).toContain('🔵 sur la voie')
    expect(md).toContain('spec (demandée)')
    expect(md).toContain('dev → 2026-11-15 (engagé : Marie)')
    expect(md).toContain('🔴 bloqué')
    expect(md).toContain('🚩 D1 bloquante')
    expect(md).toContain('Dossier : docs/dossiers/canal-notification.md')
    expect(md).toContain("**Décisions qui t'attendent**")
    expect(md).toContain('`Réponse : D1 A`')

    const cliRes = cli(['report', '--owner-table', '--commit', 'c1', '--now', '2026-11-14T12:00:00.000Z', '--format', 'md'])
    expect(cliRes.code, cliRes.err).toBe(0)
    expect(cliRes.out).toContain('| # | Statut | Étape | ETA (étape cible) | Ta demande | Fait | À faire (qui) | Décision |')
    expect(cliRes.out).toContain('🔵 sur la voie')
    expect(cliRes.out).toContain('spec (demandée)')
    expect(cliRes.out).toContain('dev → 2026-11-15 (engagé : Marie)')
    expect(cliRes.out).toContain('🔴 bloqué')
    expect(cliRes.out).toContain('🚩 D1 bloquante')
    expect(cliRes.out).toContain('Dossier : docs/dossiers/canal-notification.md')
    expect(cliRes.out).toContain("Décisions qui t'attendent — 1")
    expect(cliRes.out).toContain('`Réponse : D1 A`')

    const strictRes = cli([
      'report',
      '--owner-table',
      '--strict',
      '--commit',
      'c1',
      '--now',
      '2026-11-14T12:00:00.000Z',
      '--format',
      'md',
    ])
    expect(strictRes.code, strictRes.err).toBe(0)
    expect(strictRes.out).toBe(cliRes.out)
  })

  it('enforces uniqueness and immutability on numberDemand/setReportStatus and requires a settled go decision for archiving (Findings 1, 2, P3-4)', () => {
    const d1 = track.raiseDemand({
      type: 'feature',
      workspace: 'ws',
      raw: { text: 'Première demande' },
      source: { kind: 'human' },
    })
    const d2 = track.raiseDemand({
      type: 'feature',
      workspace: 'ws',
      raw: { text: 'Deuxième demande' },
      source: { kind: 'human' },
    })
    track.numberDemand(d1, 1)
    expect(() => track.numberDemand(d1, 3)).toThrow(/already has owner request number #1/)
    expect(() => track.numberDemand(d2, 1)).toThrow(/already assigned/)

    const item1 = track.createItem({ kind: 'feature', title: 'Support archive', workspace: 'ws' })
    const dec = track.createDecision({
      decisionKind: 'commitment',
      title: 'Archiver la demande 1 ?',
      workspace: 'ws',
      targets: [item1],
      dossier: {
        context: 'Demande remplacée.',
        qa: [],
        options: [
          { id: 'yes', title: 'Archiver', summary: 'Retirer de la table active' },
          { id: 'no', title: 'Garder', summary: 'Maintenir dans la table active' },
        ],
        recommendation: { optionId: 'yes', rationale: 'Traitée ailleurs' },
        artifacts: [{ kind: 'rendered-view', viewRef: 'docs/dossiers/archive-1.md' }],
      },
    })
    expect(() => track.archiveDemand(d1, { decisionId: dec, reason: 'Pas encore tranchée' })).toThrow(/must be settled/)
    // Item-level archiving also requires a settled 'go' decision
    expect(() =>
      track.setReportStatus(item1, {
        ownerNumber: 3,
        ownerRequest: 'Demande directe',
        archived: { decisionId: dec, reason: 'Non tranchée' },
      }),
    ).toThrow(/must be settled with outcome "go"/)

    track.selectDecisionOption(dec, 'yes', 'go')
    track.archiveDemand(d1, { decisionId: dec, reason: 'Archivée avec accord owner' })

    track.numberDemand(d2, 2)
    const state = fold(store.readAll())
    expect(state.demands.get(d1)?.archived).toMatchObject({
      decisionId: dec,
      reason: 'Archivée avec accord owner',
    })
    const view = projectOwnerTable(state, store.readAll(), { baselineCommit: 'c1' })
    expect(view.archivedNumbers).toContain(1)
    expect(view.rows.map((r) => r.num)).toEqual([2])
    expect(auditOwnerTable(view).ok).toBe(true)
  })

  it('preserves historical ownerNumber and ownerRequest when a later report-set omits them, and never invents a number when none was ever assigned (Finding 1, P1-1)', () => {
    const id1 = track.createItem({
      kind: 'feature',
      title: 'First item',
      workspace: 'ws',
      links: [{ kind: 'spec', locator: 'docs/specs/f1.md' }],
    })
    track.setRealization(id1, 'in-progress')
    track.setReportStatus(id1, {
      ownerNumber: 1,
      ownerRequest: 'Permettre l export CSV',
      status: 'on-track',
      facts: 'Spec validée (docs/specs/f1.md)',
    })
    expect(() =>
      track.setReportStatus(id1, {
        ownerNumber: 2,
        ownerRequest: 'Permettre l export CSV',
      }),
    ).toThrow(/already has owner request number #1/)

    const id2 = track.createItem({
      kind: 'feature',
      title: 'Second item',
      workspace: 'ws',
      links: [{ kind: 'dev-branch', locator: 'feat/f2' }],
    })
    track.setRealization(id2, 'in-progress')
    track.setReportStatus(id2, {
      ownerNumber: 2,
      ownerRequest: 'Ajouter le tri multi-colonnes',
      status: 'on-track',
      facts: 'Branche ouverte (feat/f2)',
    })

    // A later setReportStatus on id2 that omits ownerNumber and ownerRequest preserves both #2 and the request text (P1-1)
    track.setReportStatus(id2, {
      status: 'on-track',
      facts: 'Développement en cours (feat/f2)',
    })

    let events = store.readAll()
    let view = projectOwnerTable(fold(events), events, { baselineCommit: 'c1' })
    expect(view.registeredNumbers).toEqual([1, 2])
    expect(view.rows.map((r) => r.num)).toEqual([1, 2])
    expect(view.rows[1]?.request).toBe('Ajouter le tri multi-colonnes')
    expect(auditOwnerTable(view).ok).toBe(true)

    // An item that had ownerRequest (later overwritten) but NEVER had an ownerNumber stays at num: 0 and fails missing-row
    const idUnnumbered = track.createItem({
      kind: 'feature',
      title: 'Unnumbered item',
      workspace: 'ws',
      links: [{ kind: 'spec', locator: 'docs/specs/f3.md' }],
    })
    track.setRealization(idUnnumbered, 'in-progress')
    track.setReportStatus(idUnnumbered, {
      ownerRequest: 'Demande non numérotée',
      status: 'on-track',
      facts: 'Spec initiale',
    })
    track.setReportStatus(idUnnumbered, {
      status: 'on-track',
      facts: 'Spec mise à jour',
    })
    events = store.readAll()
    view = projectOwnerTable(fold(events), events, { baselineCommit: 'c1' })
    expect(view.rows).toHaveLength(3)
    expect(view.rows.find((r) => r.id === idUnnumbered)?.num).toBe(0)
    const audit = auditOwnerTable(view)
    expect(audit.ok).toBe(false)
    expect(audit.violations.map((v) => v.code)).toContain('missing-row')
  })

  it('never invents fallback causes on blocked/withdrawn rows, requires links for stages and witnesses, and requires prod+acceptance links for done (Findings 3, 4, 13, 14, 15, 16, 19)', () => {
    // 1. Fresh to-do item with no link has status 'not-started' (⚪ pas commencé) and stage undefined (—)
    const d1 = track.raiseDemand({
      type: 'feature',
      workspace: 'ws',
      raw: { text: 'Nouvelle demande non démarrée' },
      source: { kind: 'human' },
    })
    track.numberDemand(d1, 1)
    track.claimDemand(d1, {})
    const [todoItem] = track.agreeDemand(d1, { items: [{ title: 'Lot à démarrer' }] })
    void todoItem

    // 2. Blocked item without blocker reason or todo action fails blocked-without-cause (no fallback text)
    const d2 = track.raiseDemand({
      type: 'defect',
      workspace: 'ws',
      raw: { text: 'Corriger le connecteur' },
      source: { kind: 'human' },
    })
    track.numberDemand(d2, 2)
    track.claimDemand(d2, {})
    const [blockedItem] = track.agreeDemand(d2, { items: [{ title: 'Lot bloqué' }] })
    track.setRealization(blockedItem!, 'in-progress')
    const crit = track.addCriterion(blockedItem!, 'holds under load')
    const ev = track.linkEvidence(crit, 'e2e', 'https://example.test/e2e/1')
    track.recordRun(ev, { commit: 'c1', env: 'ci', runner: 'ci', result: 'fail' })

    // 3. Cancelled item without withdrawal reason fails missing-witness (no 'retiré par décision' fallback)
    const d3 = track.raiseDemand({
      type: 'feature',
      workspace: 'ws',
      raw: { text: 'Ancienne piste abandonnée' },
      source: { kind: 'human' },
    })
    track.numberDemand(d3, 3)
    track.claimDemand(d3, {})
    const [cancelledItem] = track.agreeDemand(d3, { items: [{ title: 'Lot annulé' }] })
    track.setRealization(cancelledItem!, 'cancelled')

    // 4. Item with unrequested link kind ('artifact') has no stage and cannot be 🔵 sur la voie
    const d4 = track.raiseDemand({
      type: 'feature',
      workspace: 'ws',
      raw: { text: 'Demande sans lien d étape valide' },
      source: { kind: 'human' },
    })
    track.numberDemand(d4, 4)
    track.claimDemand(d4, {})
    const [unlinkedItem] = track.agreeDemand(d4, {
      items: [{ title: 'Lot sans lien', links: [{ kind: 'artifact', locator: 'docs/note.md' }] }],
    })
    track.setRealization(unlinkedItem!, 'in-progress')
    track.setReportStatus(unlinkedItem!, {
      status: 'on-track',
      facts: 'Note rédigée.',
    })

    const events = store.readAll()
    const view = projectOwnerTable(fold(events), events, { baselineCommit: 'c1' })
    expect(view.rows[0]?.status).toBe('not-started')
    expect(view.rows[0]?.stage).toBeUndefined()
    expect(formatOwnerStageCell(view.rows[0]!)).toBe('—')

    expect(view.rows[1]?.status).toBe('blocked')
    expect(view.rows[1]?.todo).toBe('—')

    expect(view.rows[2]?.status).toBe('withdrawn')
    expect(view.rows[2]?.done).toBe('—')

    expect(view.rows[3]?.stage).toBeUndefined()
    expect(view.rows[3]?.status).toBe('not-qualified')

    const audit = auditOwnerTable(view)
    expect(audit.ok).toBe(false)
    expect(audit.violations.some((v) => v.rowNum === 2 && v.code === 'blocked-without-cause')).toBe(true)
    expect(audit.violations.some((v) => v.rowNum === 3 && v.code === 'missing-witness')).toBe(true)
  })

  it('requires deployed-prod + prod-accepted/uat-accepted links + done realization + qualification for ✅ fait (Finding 4)', () => {
    const d1 = track.raiseDemand({
      type: 'feature',
      workspace: 'ws',
      raw: { text: 'Livrer la fonctionnalité en production' },
      source: { kind: 'human' },
    })
    track.numberDemand(d1, 1)
    track.claimDemand(d1, {})
    const [item1] = track.agreeDemand(d1, {
      items: [
        {
          title: 'Livraison prod',
          links: [{ kind: 'deployed-prod', locator: 'prod:v1.2.0' }],
        },
      ],
    })
    track.setRealization(item1!, 'in-progress')
    track.setRealization(item1!, 'done')
    track.setReportStatus(item1!, {
      status: 'on-track',
      facts: 'Déployé en production (prod:v1.2.0), en attente de validation.',
    })
    // Without prod-accepted / uat-accepted link, stage is 'prod', never 'done'
    let view = projectOwnerTable(fold(store.readAll()), store.readAll(), { baselineCommit: 'c1' })
    expect(view.rows[0]?.stage).toBe('prod')
    expect(view.rows[0]?.status).not.toBe('done')

    // Adding prod-accepted link + qualifying acceptance makes it stage 'done' and status 'done' (✅ fait)
    const crit = track.addCriterion(item1!, 'validated in prod')
    const ev = track.linkEvidence(crit, 'e2e', 'https://example.test/prod-check')
    track.recordRun(ev, { commit: 'c1', env: 'prod', runner: 'smoke', result: 'pass' })
    track.addItemLink(item1!, { kind: 'prod-accepted', locator: 'owner:signoff-2026-11-14' })

    view = projectOwnerTable(fold(store.readAll()), store.readAll(), { baselineCommit: 'c1' })
    expect(view.rows[0]?.stage).toBe('done')
    expect(view.rows[0]?.status).toBe('done')
    expect(auditOwnerTable(view).ok).toBe(true)
  })

  it('renders multi-item demands as a demand-title row followed by one row per lot (Owner Decision 15/11)', () => {
    const d1 = track.raiseDemand({
      type: 'feature',
      workspace: 'ws',
      raw: { text: 'Migration en deux lots' },
      source: { kind: 'human' },
    })
    track.numberDemand(d1, 1)
    track.claimDemand(d1, {})
    const [lot1, lot2] = track.agreeDemand(d1, {
      items: [
        { title: 'Lot 1', links: [{ kind: 'pr-merged', locator: 'PR #10' }] },
        { title: 'Lot 2', links: [{ kind: 'dev-branch', locator: 'branch/lot-2' }] },
      ],
    })
    track.setRealization(lot1!, 'in-progress')
    track.setReportStatus(lot1!, {
      status: 'on-track',
      facts: 'Lot 1 fusionné (PR #10).',
    })
    track.setRealization(lot2!, 'in-progress')
    const dep = track.createItem({ kind: 'chore', title: 'Dépendance externe', workspace: 'ws' })
    track.openBlocker({ targetId: lot2!, kind: 'dependency', ref: dep, reason: 'Attente accès API tiers (équipe infra)' })

    const view = projectOwnerTable(fold(store.readAll()), store.readAll(), { baselineCommit: 'c1' })
    expect(view.rows).toHaveLength(3)
    expect(view.rows[0]).toMatchObject({
      kind: 'demand-title',
      num: 1,
      id: d1,
      etas: [],
      request: 'Migration en deux lots',
      done: '—',
      todo: '—',
      decisionRefs: [],
    })
    expect(view.rows[0]?.status).toBeUndefined()
    expect(view.rows[0]?.stage).toBeUndefined()
    expect(view.rows[1]).toMatchObject({
      kind: 'lot',
      parentDemandId: d1,
      num: 1,
      id: lot1,
      status: 'on-track',
      stage: 'merged',
      request: '↳ lot 1 — Lot 1',
      done: 'Lot 1 fusionné (PR #10).',
    })
    expect(view.rows[2]).toMatchObject({
      kind: 'lot',
      parentDemandId: d1,
      num: 1,
      id: lot2,
      status: 'blocked',
      stage: 'dev',
      request: '↳ lot 2 — Lot 2',
    })
    expect(view.rows[2]?.todo).toContain('Attente accès API tiers')
    expect(auditOwnerTable(view).ok).toBe(true)
  })

  it('lists every pending structured decision and refuses orphan decisions, missing recommendations, or missing dossier links (Findings 6, 17, 18)', () => {
    const d1 = track.raiseDemand({
      type: 'feature',
      workspace: 'ws',
      raw: { text: 'Demande active' },
      source: { kind: 'human' },
    })
    track.numberDemand(d1, 1)
    track.claimDemand(d1, {})
    const [item1] = track.agreeDemand(d1, {
      items: [{ title: 'Lot actif', links: [{ kind: 'spec', locator: 'docs/specs/d1.md' }] }],
    })
    track.setRealization(item1!, 'in-progress')
    track.setReportStatus(item1!, {
      status: 'on-track',
      facts: 'Spec prête.',
    })

    // Orphan decision targeting an item that is not in the owner table, and missing recommendation + dossierLink
    const unrelated = track.createItem({ kind: 'chore', title: 'Unrelated internal item', workspace: 'ws' })
    const orphanDecId = track.createDecision({
      decisionKind: 'orientation',
      title: 'Décision orpheline sans recommandation ni lien ?',
      workspace: 'ws',
      targets: [unrelated],
      dossier: {
        context: 'Test.',
        qa: [],
        options: [
          { id: 'x', title: 'Option X', summary: 'Conséquence X' },
          { id: 'y', title: 'Option Y', summary: 'Conséquence Y' },
        ],
        recommendation: { optionId: 'x', rationale: 'Choix X' },
      },
    })
    const events = store.readAll()
    const state = fold(events)
    // Simulate a legacy decision in state whose recommendation is missing to verify projectOwnerTable never invents 'A'
    delete state.decisions.get(orphanDecId)!.dossier.recommendation

    const view = projectOwnerTable(state, events, { baselineCommit: 'c1' })
    expect(view.decisions).toHaveLength(1)
    expect(view.decisions[0]?.recommendedLetter).toBe('')
    const audit = auditOwnerTable(view)
    expect(audit.ok).toBe(false)
    expect(audit.violations.filter((v) => v.code === 'invalid-decision').length).toBeGreaterThanOrEqual(3)
  })

  it('does not bypass text gates by rewriting raw prose in projectOwnerTable (Finding 5)', () => {
    const bannedWord = Buffer.from([0x68, 0x6f, 0x6e, 0x65, 0x73, 0x74, 0x6c, 0x79]).toString('utf8')
    const d1 = track.raiseDemand({
      type: 'feature',
      workspace: 'ws',
      raw: { text: 'Demande avec jargon brut' },
      source: { kind: 'human' },
    })
    track.numberDemand(d1, 1)
    track.claimDemand(d1, {})
    const [item1] = track.agreeDemand(d1, {
      items: [{ title: 'Lot', links: [{ kind: 'spec', locator: 'docs/specs/s.md' }] }],
    })
    track.setRealization(item1!, 'in-progress')
    track.setReportStatus(item1!, {
      status: 'on-track',
      facts: `Vérifié ${bannedWord} sur 483a5f356 dans worktree WP1 par claude:opus`,
    })

    const view = projectOwnerTable(fold(store.readAll()), store.readAll(), { baselineCommit: 'c1' })
    const audit = auditOwnerTable(view)
    expect(audit.ok).toBe(false)
    expect(audit.violations.map((v) => v.code)).toContain('internal-jargon')
    expect(audit.violations.map((v) => v.code)).toContain('banned-word')
    expect(() => renderOwnerTable(view)).toThrow(/REFUSED: owner table failed blocking gates/)
  })

  it('refuses rendering on every one of the 7 blocking gates', () => {
    const baseView = (): OwnerTableView => ({
      kind: 'owner-table-report',
      registeredNumbers: [1],
      archivedNumbers: [],
      rows: [
        {
          num: 1,
          id: 'req-1',
          status: 'on-track',
          stage: 'dev',
          etas: [{ targetStage: 'pr', when: '2026-11-18', source: 'committed', by: 'Alice' }],
          request: 'Ajouter le filtre par période',
          done: 'Branche ouverte et tests unitaires verts (PR #42)',
          todo: 'Ouvrir la revue (équipe produit)',
          decisionRefs: [],
          hasWitness: true,
        },
      ],
      decisions: [],
      replyLine: '',
    })

    expect(auditOwnerTable(baseView()).ok).toBe(true)

    // Gate 1: missing unarchived row
    const missingRow = baseView()
    missingRow.registeredNumbers = [1, 2]
    expect(auditOwnerTable(missingRow).violations.map((v) => v.code)).toContain('missing-row')
    expect(() => renderOwnerTable(missingRow)).toThrow(/REFUSED: owner table failed blocking gates/)

    // Gate 2: 🔴 without a cause
    const blockedNoCause = baseView()
    blockedNoCause.rows[0] = { ...blockedNoCause.rows[0]!, status: 'blocked', todo: '—' }
    expect(auditOwnerTable(blockedNoCause).violations.map((v) => v.code)).toContain('blocked-without-cause')

    // Gate 3a: 🔵 without a witness
    const blueNoWitness = baseView()
    blueNoWitness.rows[0] = { ...blueNoWitness.rows[0]!, status: 'on-track', hasWitness: false }
    expect(auditOwnerTable(blueNoWitness).violations.map((v) => v.code)).toContain('missing-witness')

    // Gate 3b: ✅ at merged (merged is never fait)
    const mergedDone = baseView()
    mergedDone.rows[0] = { ...mergedDone.rows[0]!, status: 'done', stage: 'merged', hasWitness: true }
    expect(auditOwnerTable(mergedDone).violations.map((v) => v.code)).toContain('missing-witness')

    // Gate 4: ETA without a target stage or source, or > 2 ETAs, or committed without by, or unknown with date, or measured without provenance
    const badEta = baseView()
    badEta.rows[0] = {
      ...badEta.rows[0]!,
      etas: [{ targetStage: 'prod', when: '2026-11-20', source: 'committed' }],
    }
    expect(auditOwnerTable(badEta).violations.map((v) => v.code)).toContain('invalid-eta')

    const unknownWithDate = baseView()
    unknownWithDate.rows[0] = {
      ...unknownWithDate.rows[0]!,
      etas: [{ targetStage: 'prod', when: '2026-11-20', source: 'unknown' }],
    }
    expect(auditOwnerTable(unknownWithDate).violations.map((v) => v.code)).toContain('invalid-eta')

    const measuredWithoutProvenance = baseView()
    measuredWithoutProvenance.rows[0] = {
      ...measuredWithoutProvenance.rows[0]!,
      etas: [{ targetStage: 'prod', when: '2026-11-20', source: 'measured' }],
    }
    expect(auditOwnerTable(measuredWithoutProvenance).violations.map((v) => v.code)).toContain('invalid-eta')

    // Gate 5: D# without a row or row pointing to unlisted D#
    const badDecision = baseView()
    badDecision.rows[0] = {
      ...badDecision.rows[0]!,
      status: 'blocked',
      todo: 'bloqué par D9',
      decisionRefs: ['D9'],
      decisionBlocking: true,
    }
    expect(auditOwnerTable(badDecision).violations.map((v) => v.code)).toContain('invalid-decision')

    // Gate 6: commit hash / ULID / internal jargon / WPx in owner text
    const withHash = baseView()
    withHash.rows[0] = {
      ...withHash.rows[0]!,
      done: 'Livré sur 483a5f356 dans le worktree principal',
    }
    expect(auditOwnerTable(withHash).violations.map((v) => v.code)).toContain('internal-jargon')

    const withWp = baseView()
    withWp.rows[0] = {
      ...withWp.rows[0]!,
      todo: 'Rattacher au WP2 (équipe)',
    }
    expect(auditOwnerTable(withWp).violations.map((v) => v.code)).toContain('internal-jargon')

    // Gate 7: banned word (constructed from char codes so literal never appears in source)
    const bannedWord = Buffer.from([0x68, 0x6f, 0x6e, 0x65, 0x73, 0x74, 0x6c, 0x79]).toString('utf8')
    const withBanned = baseView()
    withBanned.rows[0] = {
      ...withBanned.rows[0]!,
      done: `État ${bannedWord} vérifié`,
    }
    expect(auditOwnerTable(withBanned).violations.map((v) => v.code)).toContain('banned-word')

    // Gate 7c: NFD decomposed banned word is also caught
    const bannedDecomposed = 'honn\u0065\u0302te'
    const withDecomposedBanned = baseView()
    withDecomposedBanned.rows[0] = {
      ...withDecomposedBanned.rows[0]!,
      done: `État ${bannedDecomposed} vérifié`,
    }
    expect(auditOwnerTable(withDecomposedBanned).violations.map((v) => v.code)).toContain('banned-word')

    // Gate 8: private terms loaded from an unversioned local policy file as salted SHA-256 hashes;
    // without the file, the private-name gate is skipped with an explicit notice.
    const noPolicyAudit = auditOwnerTable(baseView())
    expect(noPolicyAudit.ok).toBe(true)
    expect(noPolicyAudit.notices?.[0]).toMatch(/Private-name gate skipped/)

    const salt = 'test-policy-salt-v1'
    const syntheticPrivateToken = 'syntheticclientxyz'
    const saltedDigest = createHash('sha256').update(`${salt}:${syntheticPrivateToken}`, 'utf8').digest('hex')
    const policyFile = join(dir, 'local-owner-policy.json')
    writeFileSync(policyFile, JSON.stringify({ salt, privateTermHashes: [saltedDigest] }), 'utf8')
    const withPrivateTerm = baseView()
    withPrivateTerm.rows[0] = {
      ...withPrivateTerm.rows[0]!,
      done: `Déploiement dédié pour ${syntheticPrivateToken.toUpperCase()} validé`,
    }
    const policyAudit = auditOwnerTable(withPrivateTerm, { policyPath: policyFile })
    expect(policyAudit.ok).toBe(false)
    expect(policyAudit.notices).toBeUndefined()
    expect(policyAudit.violations.map((v) => v.code)).toContain('banned-word')
  })

  it('replays the real .track log in read-only mode, surfaces all 13 historical owner requests and gate violations without silent rewriting, and leaves the log byte-identical', () => {
    const candidates = [
      resolve(import.meta.dirname, '../../../../.track/events.jsonl'),
      resolve(process.cwd(), '.track/events.jsonl'),
    ]
    const realEventsPath = candidates.find((p) => existsSync(p))
    expect(realEventsPath).toBeDefined()

    const beforeBytes = readFileSync(realEventsPath!)
    const beforeHash = createHash('sha256').update(beforeBytes).digest('hex')

    const reader = new TrackReader(realEventsPath!)
    const view = reader.ownerTable({
      baselineCommit: '9227bc9160000000000000000000000000000000',
      now: '2026-11-14T12:00:00.000Z',
    })
    // All 13 historical items that ever carried ownerRequest (including 2 whose ownerRequest was later overwritten) are retained
    expect(view.rows).toHaveLength(13)
    const audit = auditOwnerTable(view)
    expect(audit.ok).toBe(false)
    const codes = new Set(audit.violations.map((v) => v.code))
    expect(codes.has('missing-row')).toBe(true)
    expect(codes.has('invalid-decision')).toBe(true)
    expect(codes.has('internal-jargon')).toBe(true)
    expect(() => renderOwnerTable(view)).toThrow(/REFUSED: owner table failed blocking gates/)

    const afterBytes = readFileSync(realEventsPath!)
    const afterHash = createHash('sha256').update(afterBytes).digest('hex')
    expect(afterHash).toBe(beforeHash)
  })

  it('handles reopening (P1-2), strict ✅ fait witnesses & storedStage precedence (P1-3), duplicate demand reasons (P2-2), --track-dir policy resolution (P2-3), and early-stage measured ETA gate (P3-1)', () => {
    // P1-2: Reopened item invalidates pre-reopen dev link and can prove pr..done again with post-reopen links
    const d1 = track.raiseDemand({
      type: 'feature',
      workspace: 'ws-r2',
      raw: { text: 'Fiabiliser le cycle de réouverture' },
      source: { kind: 'human' },
    })
    track.numberDemand(d1, 1)
    track.claimDemand(d1, {})
    const [reopenedItem] = track.agreeDemand(d1, {
      items: [{ title: 'Lot réouvert', links: [{ kind: 'dev-branch', locator: 'feat/old-branch' }] }],
    })
    track.setRealization(reopenedItem!, 'in-progress')
    track.setRealization(reopenedItem!, 'done')
    track.reopenItem(reopenedItem!, { motive: 'regression-observed', reason: 'Régression détectée' })

    // Immediately after reopen: old dev-branch link is invalidated -> stage is undefined (—)
    let events = store.readAll()
    let view = projectOwnerTable(fold(events), events, { baselineCommit: 'c1', workspace: 'ws-r2' })
    expect(view.rows[0]?.stage).toBeUndefined()
    expect(view.rows[0]?.status).toBe('unforeseen')

    // Post-reopen links + stored preprod stage + acceptance pass + done realization -> ✅ fait | done (P1-2 & P1-3)
    track.setReportStatus(reopenedItem!, {
      stage: { value: 'preprod', evidence: 'preprod:v1.9.0' },
      status: 'on-track',
      facts: 'Validé en préprod puis livré en production.',
    })
    track.addItemLink(reopenedItem!, { kind: 'pr-open', locator: 'PR #301' })
    track.addItemLink(reopenedItem!, { kind: 'pr-merged', locator: 'PR #301' })
    // Non-prod locator on deployed-prod is refused (P1-3)
    track.addItemLink(reopenedItem!, { kind: 'deployed-prod', locator: 'staging-rc.1' })
    track.addItemLink(reopenedItem!, { kind: 'prod-accepted', locator: 'owner:signoff-r2' })
    track.setRealization(reopenedItem!, 'done')

    // Without valid prod: locator and without acceptance criterion pass, cannot be ✅ fait
    events = store.readAll()
    view = projectOwnerTable(fold(events), events, { baselineCommit: 'c1', workspace: 'ws-r2' })
    expect(view.rows[0]?.stage).toBe('merged')
    expect(view.rows[0]?.status).not.toBe('done')

    // Add valid prod:v2.0.0 locator, still 0 acceptance criteria (untested) -> stage is 'done', status is 'not-qualified' (never ✅ fait or 🔵 sur la voie)
    track.addItemLink(reopenedItem!, { kind: 'deployed-prod', locator: 'prod:v2.0.0' })
    events = store.readAll()
    view = projectOwnerTable(fold(events), events, { baselineCommit: 'c1', workspace: 'ws-r2' })
    expect(view.rows[0]?.stage).toBe('done')
    expect(view.rows[0]?.status).toBe('not-qualified')

    // Add acceptance criterion + pass run -> now ✅ fait | done (storedStage 'preprod' does not override validLinked 'done')
    const crit = track.addCriterion(reopenedItem!, 'tenue en production vérifiée')
    const ev = track.linkEvidence(crit, 'e2e', 'https://example.test/prod-r2')
    track.recordRun(ev, { commit: 'c1', env: 'prod', runner: 'smoke', result: 'pass' })
    events = store.readAll()
    view = projectOwnerTable(fold(events), events, { baselineCommit: 'c1', workspace: 'ws-r2' })
    expect(view.rows[0]?.stage).toBe('done')
    expect(view.rows[0]?.status).toBe('done')

    // P2-2: Demand disposed as duplicate persists its reason and passes ⚫ retiré gate
    const d2 = track.raiseDemand({
      type: 'feature',
      workspace: 'ws-r2',
      raw: { text: 'Demande en doublon' },
      source: { kind: 'human' },
    })
    track.numberDemand(d2, 2)
    track.claimDemand(d2, {})
    track.disposeDemand(d2, {
      outcome: 'duplicate',
      reason: 'Doublon de la demande #1 déjà livrée',
      duplicateOf: { kind: 'demand', id: d1 },
    })
    events = store.readAll()
    view = projectOwnerTable(fold(events), events, { baselineCommit: 'c1', workspace: 'ws-r2' })
    expect(view.rows).toHaveLength(2)
    expect(view.rows[1]?.status).toBe('withdrawn')
    expect(view.rows[1]?.done).toBe('Doublon de la demande #1 déjà livrée')
    expect(auditOwnerTable(view).ok).toBe(true)

    // P1-3 & P3-1 gate checks on auditOwnerTable:
    // - row with stage: 'done' and status: 'on-track' is refused
    const onTrackAtDone: OwnerTableView = {
      ...view,
      rows: [
        {
          ...view.rows[0]!,
          status: 'on-track',
          stage: 'done',
          etas: [{ targetStage: 'done', when: '—', source: 'unknown' }],
          hasWitness: true,
        },
        view.rows[1]!,
      ],
    }
    expect(auditOwnerTable(onTrackAtDone).ok).toBe(false)
    expect(auditOwnerTable(onTrackAtDone).violations.map((v) => v.code)).toContain('missing-witness')

    // - measured ETA on early stage ('spec') is refused by auditOwnerTable even with provenance (P3-1)
    const earlyMeasured: OwnerTableView = {
      ...view,
      rows: [
        {
          ...view.rows[0]!,
          status: 'on-track',
          stage: 'brainstorm',
          etas: [
            {
              targetStage: 'spec',
              when: '2026-11-20',
              source: 'measured',
              measured: {
                predictedAt: '2026-11-14T00:00:00.000Z',
                evidenceCutoff: '2026-11-13T23:00:00.000Z',
                p80Seconds: 86400,
                sampleCount: 5,
                support: 'descriptive',
                lockedDigest: 'd1',
                currentDigest: 'd1',
              },
            } as never,
          ],
          hasWitness: true,
        },
        view.rows[1]!,
      ],
    }
    expect(auditOwnerTable(earlyMeasured).ok).toBe(false)
    expect(auditOwnerTable(earlyMeasured).violations.map((v) => v.code)).toContain('invalid-eta')

    // P2-3: Policy file next to --track-dir (dirname(eventsPath)) is resolved even when cwd is different
    const otherCwd = mkdtempSync(join(tmpdir(), 'track-other-cwd-'))
    try {
      const salt = 'r2-policy-salt'
      const secretWord = 'doublon'
      const hash = createHash('sha256').update(`${salt}:${secretWord}`, 'utf8').digest('hex')
      writeFileSync(
        join(dir, '.track', 'owner-report-policy.json'),
        JSON.stringify({ salt, privateTermHashes: [hash] }),
        'utf8',
      )
      let out = ''
      let err = ''
      const code = runCli(
        ['--track-dir', join(dir, '.track'), 'report', '--owner-table', '--strict', '--commit', 'c1'],
        {
          cwd: otherCwd,
          out: (s) => {
            out += s
          },
          err: (s) => {
            err += s
          },
        },
      )
      expect(code).toBe(1)
      expect(err).toContain('banned-word')
    } finally {
      rmSync(otherCwd, { recursive: true, force: true })
    }
  })

  it('Round 3 P1-1 & P1-2: owner pause ⚪ wins for deferred decision, parked demand, and partly finished multi-lot demand; terminal rows drop old ETAs and reached target stages are not shown', () => {
    // 1. P1-1a: Item paused via a `deferred` decision renders ⚪ en pause (never 🔴 bloqué, never listed as 🚩 D# bloquante)
    const d1 = track.raiseDemand({
      type: 'feature',
      workspace: 'ws-r3',
      raw: { text: 'Sujet mis en pause sur décision différée' },
      source: { kind: 'human' },
    })
    track.numberDemand(d1, 1)
    track.claimDemand(d1, {})
    const [pausedItem] = track.agreeDemand(d1, {
      items: [{ title: 'Lot en pause différée', links: [{ kind: 'spec', locator: 'docs/specs/pause.md' }] }],
    })
    track.setRealization(pausedItem!, 'in-progress')
    const deferredDec = track.createDecision({
      decisionKind: 'orientation',
      title: 'Lancer le chantier maintenant ou différer ?',
      workspace: 'ws-r3',
      targets: [pausedItem!],
      dossier: {
        context: 'Arbitrage calendrier.',
        qa: [],
        options: [
          { id: 'now', title: 'Maintenant', summary: 'Démarrer immédiatement' },
          { id: 'later', title: 'Différer', summary: 'Mettre en pause owner' },
        ],
        recommendation: { optionId: 'later', rationale: 'Prioriser le socle' },
        artifacts: [{ kind: 'rendered-view', viewRef: 'docs/dossiers/pause.md' }],
      },
    })
    track.setOutcome(deferredDec, 'deferred')
    track.setReportStatus(pausedItem!, {
      status: 'not-started',
      pausedByOwner: true,
      pauseDecisionId: deferredDec,
      facts: 'Spécification posée (docs/specs/pause.md).',
      nextAction: 'En pause sur décision owner (équipe)',
    })

    // 2. P1-1b: Unpromoted demand disposed as `parked` with a reason renders ⚪ en pause (never — sans témoin)
    const d2 = track.raiseDemand({
      type: 'feature',
      workspace: 'ws-r3',
      raw: { text: 'Demande parquée par l owner' },
      source: { kind: 'human' },
    })
    track.numberDemand(d2, 2)
    track.claimDemand(d2, {})
    track.disposeDemand(d2, {
      outcome: 'parked',
      reason: 'Reporté après la livraison majeure',
    })

    // 3. P1-1c: Multi-lot demand with lot1 `done` and lot2 paused by owner (`go`) renders ⚪ en pause
    const d3 = track.raiseDemand({
      type: 'feature',
      workspace: 'ws-r3',
      raw: { text: 'Demande multi-lots partiellement terminée et mise en pause' },
      source: { kind: 'human' },
    })
    track.numberDemand(d3, 3)
    track.claimDemand(d3, {})
    const [mLot1, mLot2] = track.agreeDemand(d3, {
      items: [
        {
          title: 'Lot 1 terminé',
          links: [
            { kind: 'deployed-prod', locator: 'prod:v1.0.0' },
            { kind: 'prod-accepted', locator: 'owner:ok-lot1' },
          ],
        },
        {
          title: 'Lot 2 en pause',
          links: [{ kind: 'dev-branch', locator: 'feat/lot2-pause' }],
        },
      ],
    })
    track.setRealization(mLot1!, 'in-progress')
    const crit1 = track.addCriterion(mLot1!, 'lot 1 prod ok')
    const ev1 = track.linkEvidence(crit1, 'e2e', 'https://example.test/lot1')
    track.recordRun(ev1, { commit: 'c1', env: 'prod', runner: 'smoke', result: 'pass' })
    track.setRealization(mLot1!, 'done')
    track.setReportStatus(mLot1!, {
      status: 'on-track',
      facts: 'Lot 1 en production (prod:v1.0.0).',
    })

    track.setRealization(mLot2!, 'in-progress')
    const pauseGoDec = track.createDecision({
      decisionKind: 'commitment',
      title: 'Mettre le lot 2 en pause ?',
      workspace: 'ws-r3',
      targets: [mLot2!],
      dossier: {
        context: 'Pause après lot 1.',
        qa: [],
        options: [
          { id: 'pause', title: 'Pause', summary: 'Geler le lot 2' },
          { id: 'continue', title: 'Continuer', summary: 'Poursuivre le lot 2' },
        ],
        recommendation: { optionId: 'pause', rationale: 'Lot 1 suffit pour l instant' },
        artifacts: [{ kind: 'rendered-view', viewRef: 'docs/dossiers/pause-lot2.md' }],
      },
    })
    track.selectDecisionOption(pauseGoDec, 'pause', 'go')
    track.setReportStatus(mLot2!, {
      status: 'not-started',
      pausedByOwner: true,
      pauseDecisionId: pauseGoDec,
      facts: 'Branche lot 2 initialisée (feat/lot2-pause).',
      nextAction: 'En pause owner après lot 1 (équipe)',
    })

    // 4. P1-2: Terminal rows (`done` and `withdrawn`) drop old ETAs (`etas = []`), and a reached targetStage is not shown
    const d4 = track.raiseDemand({
      type: 'feature',
      workspace: 'ws-r3',
      raw: { text: 'Demande terminée ayant eu une ETA' },
      source: { kind: 'human' },
    })
    track.numberDemand(d4, 4)
    track.claimDemand(d4, {})
    const [doneWithEta] = track.agreeDemand(d4, {
      items: [
        {
          title: 'Lot livré avec ancienne ETA',
          links: [
            { kind: 'deployed-prod', locator: 'prod:v2.1.0' },
            { kind: 'prod-accepted', locator: 'owner:ok-d4' },
          ],
        },
      ],
    })
    track.setRealization(doneWithEta!, 'in-progress')
    const crit4 = track.addCriterion(doneWithEta!, 'prod d4 ok')
    const ev4 = track.linkEvidence(crit4, 'e2e', 'https://example.test/d4')
    track.recordRun(ev4, { commit: 'c1', env: 'prod', runner: 'smoke', result: 'pass' })
    track.setRealization(doneWithEta!, 'done')
    track.setReportStatus(doneWithEta!, {
      status: 'on-track',
      facts: 'Livré en production (prod:v2.1.0).',
      etas: [{ targetStage: 'pr', when: '2026-11-10', source: 'committed', by: 'équipe' }],
    })

    const d5 = track.raiseDemand({
      type: 'feature',
      workspace: 'ws-r3',
      raw: { text: 'Demande retirée ayant eu une ETA' },
      source: { kind: 'human' },
    })
    track.numberDemand(d5, 5)
    track.claimDemand(d5, {})
    const [withdrawnWithEta] = track.agreeDemand(d5, {
      items: [{ title: 'Lot retiré avec ancienne ETA' }],
    })
    track.setRealization(withdrawnWithEta!, 'in-progress')
    track.setReportStatus(withdrawnWithEta!, {
      facts: 'Abandonné sur décision produit.',
      etas: [{ targetStage: 'pr', when: '2026-11-01', source: 'committed', by: 'équipe' }],
    })
    track.setRealization(withdrawnWithEta!, 'cancelled')

    const d6 = track.raiseDemand({
      type: 'feature',
      workspace: 'ws-r3',
      raw: { text: 'Demande fusionnée avec ancienne ETA sur pr' },
      source: { kind: 'human' },
    })
    track.numberDemand(d6, 6)
    track.claimDemand(d6, {})
    const [mergedWithPrEta] = track.agreeDemand(d6, {
      items: [{ title: 'Lot fusionné', links: [{ kind: 'pr-merged', locator: 'PR #450' }] }],
    })
    track.setRealization(mergedWithPrEta!, 'in-progress')
    track.setReportStatus(mergedWithPrEta!, {
      status: 'on-track',
      facts: 'PR #450 fusionnée.',
      nextAction: 'Publier la release (équipe)',
      etas: [{ targetStage: 'pr', when: '2026-11-10', source: 'committed', by: 'équipe' }],
    })

    const events = store.readAll()
    const view = projectOwnerTable(fold(events), events, { baselineCommit: 'c1', workspace: 'ws-r3' })
    expect(view.rows).toHaveLength(8)
    expect(view.decisions).toHaveLength(0)

    // Row 1 (#1): deferred decision pause -> ⚪ en pause, no blocking D#
    expect(view.rows[0]?.status).toBe('not-started')
    expect(view.rows[0]?.pausedByOwner).toBe(true)
    expect(formatOwnerStatusCell(view.rows[0]!)).toBe('⚪ en pause')
    expect(view.rows[0]?.decisionRefs).toEqual([])
    expect(view.rows[0]?.decisionBlocking).toBeUndefined()

    // Row 2 (#2): parked demand -> ⚪ en pause
    expect(view.rows[1]?.status).toBe('not-started')
    expect(view.rows[1]?.pausedByOwner).toBe(true)
    expect(formatOwnerStatusCell(view.rows[1]!)).toBe('⚪ en pause')
    expect(view.rows[1]?.todo).toContain('en pause (Reporté après la livraison majeure)')

    // Demand #3: multi-lot demand -> title row + lot 1 (✅ fait at done) + lot 2 (⚪ en pause at dev)
    expect(view.rows[2]).toMatchObject({
      kind: 'demand-title',
      num: 3,
      id: d3,
      etas: [],
    })
    expect(view.rows[2]?.status).toBeUndefined()
    expect(formatOwnerStatusCell(view.rows[2]!)).toBe('—')
    expect(view.rows[3]).toMatchObject({
      kind: 'lot',
      parentDemandId: d3,
      num: 3,
      id: mLot1,
      status: 'done',
      stage: 'done',
      etas: [],
      request: '↳ lot 1 — Lot 1 terminé',
    })
    expect(view.rows[4]).toMatchObject({
      kind: 'lot',
      parentDemandId: d3,
      num: 3,
      id: mLot2,
      status: 'not-started',
      pausedByOwner: true,
      stage: 'dev',
      request: '↳ lot 2 — Lot 2 en pause',
    })
    expect(formatOwnerStatusCell(view.rows[4]!)).toBe('⚪ en pause')

    // Demand #4: ✅ fait terminal row drops old ETA -> etas = [] ('—')
    expect(view.rows[5]?.status).toBe('done')
    expect(view.rows[5]?.etas).toEqual([])
    expect(formatOwnerEtaCell(view.rows[5]!.etas)).toBe('—')

    // Demand #5: ⚫ retiré terminal row drops old ETA -> etas = [] ('—')
    expect(view.rows[6]?.status).toBe('withdrawn')
    expect(view.rows[6]?.etas).toEqual([])
    expect(formatOwnerEtaCell(view.rows[6]!.etas)).toBe('—')

    // Demand #6: merged item drops already-reached `pr` ETA and falls back to `published -> — (inconnu)`
    expect(view.rows[7]?.stage).toBe('merged')
    expect(view.rows[7]?.etas).toEqual([{ targetStage: 'published', when: '—', source: 'unknown' }])

    expect(auditOwnerTable(view).ok).toBe(true)

    // auditOwnerTable refuses non-empty etas on terminal rows (`done` / `withdrawn`)
    const badTerminalEta: OwnerTableView = {
      ...view,
      rows: [
        {
          ...view.rows[5]!,
          etas: [{ targetStage: 'pr', when: '2026-11-10', source: 'committed', by: 'équipe' }],
        },
      ],
      registeredNumbers: [4],
      archivedNumbers: [],
    }
    expect(auditOwnerTable(badTerminalEta).ok).toBe(false)
    expect(auditOwnerTable(badTerminalEta).violations.map((v) => v.code)).toContain('invalid-eta')
  })

  it('Round 4 & Round 5: real .track 5 blueDossierIds & D17 base-26 optionLetter, plus 15/11 per-lot layout across all multi-lot owner cases', () => {
    // 1. Verify on the real .track log that the 5 blueDossierIds across the 4 items with deferred decisions are restored
    const candidates = [
      resolve(import.meta.dirname, '../../../../.track/events.jsonl'),
      resolve(process.cwd(), '.track/events.jsonl'),
    ]
    const realEventsPath = candidates.find((p) => existsSync(p))
    expect(realEventsPath).toBeDefined()
    const realEvents = new EventStore(realEventsPath!).readAll()
    const realState = fold(realEvents)
    const targetRealItems: Array<{ itemId: string; expectedDeferredDossiers: string[] }> = [
      { itemId: '01KWWXCCM1GPD7ZCXTQAX7NTSB', expectedDeferredDossiers: ['01KYQYDMN5KCKZRGMFFK6Q3KH0'] },
      { itemId: '01KYQXFSBRXXB7PTY98G88N1SK', expectedDeferredDossiers: ['01KYQYDMN5KCKZRGMFFK6Q3KH0'] },
      {
        itemId: '01M0F7Y33GP1Z07SEGPFBF26FW',
        expectedDeferredDossiers: ['01M0GSTADZSF39AATM5CW7PZY5', '01M0GSTAK1M8E6EHMNDSZMQ9X6'],
      },
      { itemId: '01M0NEDR3PF9EETAJ36V9F0X36', expectedDeferredDossiers: ['01M0NEPFRWTSHPWRJ7FJ3W482B'] },
    ]
    const recoveredBlueDossiers = targetRealItems.flatMap(({ itemId, expectedDeferredDossiers }) => {
      const it = realState.items.get(itemId)
      expect(it).toBeDefined()
      const derived = deriveItemStageStatus(realState, realEvents, it!, '1f57127dee0bf671e559c347cd86960180cd64c9')
      for (const defId of expectedDeferredDossiers) {
        expect(derived.blueDossierIds, `item ${itemId} missing deferred dossier ${defId}`).toContain(defId)
      }
      return derived.blueDossierIds
    })
    expect(recoveredBlueDossiers).toHaveLength(10)

    const realView = projectOwnerTable(realState, realEvents, {
      baselineCommit: '1f57127dee0bf671e559c347cd86960180cd64c9',
      now: '2026-11-14T19:00:00.000Z',
    })
    for (const ref of ['D3', 'D9', 'D10', 'D13']) {
      const dec = realView.decisions.find((d) => d.ref === ref)
      expect(dec?.blocking).toBe(true)
    }

    // P3-1: D18 in real .track has 90 options -> base-26 letters A..Z, AA..AZ, BA..BZ, CA..CL
    const d18 = realView.decisions.find((d) => d.ref === 'D18')
    expect(d18).toBeDefined()
    expect(d18!.options).toHaveLength(90)
    expect(d18!.options[0]?.letter).toBe('A')
    expect(d18!.options[25]?.letter).toBe('Z')
    expect(d18!.options[26]?.letter).toBe('AA')
    expect(d18!.options[51]?.letter).toBe('AZ')
    expect(d18!.options[52]?.letter).toBe('BA')
    expect(d18!.options[89]?.letter).toBe('CL')
    expect(d18!.options.every((o) => /^[A-Z]+$/u.test(o.letter))).toBe(true)

    // 2. Owner Case 1 (Carbon R5 P1-1 case 1): lot2 has a linked spec but is not started (to-do), while lot1 is in-progress (🔵 at dev)
    const dCase1 = track.raiseDemand({
      type: 'feature',
      workspace: 'ws-r5',
      raw: { text: 'Cas 1 : lot 2 avec spec liée mais non démarré' },
      source: { kind: 'human' },
    })
    track.numberDemand(dCase1, 1)
    track.claimDemand(dCase1, {})
    const [c1Lot1, c1Lot2] = track.agreeDemand(dCase1, {
      items: [
        { title: 'Socle dev', links: [{ kind: 'dev-branch', locator: 'feat/c1-lot1' }] },
        { title: 'Cadrage lot 2', links: [{ kind: 'spec', locator: 'docs/specs/c1-lot2.md' }] },
      ],
    })
    track.setRealization(c1Lot1!, 'in-progress')
    track.setReportStatus(c1Lot1!, {
      status: 'on-track',
      facts: 'Branche feat/c1-lot1 active.',
      nextAction: 'Poursuivre le développement (équipe)',
    })
    void c1Lot2

    // 3. Owner Case 2 (Carbon R5 P1-1 case 2): lot2 (with link) is paused by the owner, while lot1 is on-track at dev
    const dCase2 = track.raiseDemand({
      type: 'feature',
      workspace: 'ws-r5',
      raw: { text: 'Cas 2 : lot 2 mis en pause par l owner' },
      source: { kind: 'human' },
    })
    track.numberDemand(dCase2, 2)
    track.claimDemand(dCase2, {})
    const [c2Lot1, c2Lot2] = track.agreeDemand(dCase2, {
      items: [
        { title: 'Flux principal', links: [{ kind: 'dev-branch', locator: 'feat/c2-lot1' }] },
        { title: 'Extension différée', links: [{ kind: 'spec', locator: 'docs/specs/c2-lot2.md' }] },
      ],
    })
    track.setRealization(c2Lot1!, 'in-progress')
    track.setReportStatus(c2Lot1!, {
      status: 'on-track',
      facts: 'Branche feat/c2-lot1 active.',
      nextAction: 'Livrer le flux principal (équipe)',
    })
    const c2PauseDec = track.createDecision({
      decisionKind: 'commitment',
      title: 'Mettre l extension en pause ?',
      workspace: 'ws-r5',
      targets: [c2Lot2!],
      dossier: {
        context: 'Prioriser le flux principal.',
        qa: [],
        options: [
          { id: 'pause', title: 'Pause', summary: 'Geler le lot 2' },
          { id: 'go', title: 'Lancer', summary: 'Démarrer le lot 2' },
        ],
        recommendation: { optionId: 'pause', rationale: 'Séquence validée' },
        artifacts: [{ kind: 'rendered-view', viewRef: 'docs/dossiers/c2-pause.md' }],
      },
    })
    track.selectDecisionOption(c2PauseDec, 'pause', 'go')
    track.setReportStatus(c2Lot2!, {
      status: 'not-started',
      pausedByOwner: true,
      pauseDecisionId: c2PauseDec,
      nextAction: 'En pause sur décision owner (équipe)',
      etas: [{ targetStage: 'prod', when: '2026-11-25', source: 'committed', by: 'équipe' }],
    })

    // 4. Owner Case 3 (Carbon R5 P1-1 case 3): lot1 gets a no-go (with prior decisionBlocking: true), then lot2 continues — auditOwnerTable must pass
    const dCase3 = track.raiseDemand({
      type: 'feature',
      workspace: 'ws-r5',
      raw: { text: 'Cas 3 : lot 1 no-go puis lot 2 continue' },
      source: { kind: 'human' },
    })
    track.numberDemand(dCase3, 3)
    track.claimDemand(dCase3, {})
    const [c3Lot1, c3Lot2] = track.agreeDemand(dCase3, {
      items: [
        { title: 'Variante abandonnée', links: [{ kind: 'spec', locator: 'docs/specs/c3-lot1.md' }] },
        { title: 'Variante retenue', links: [{ kind: 'dev-branch', locator: 'feat/c3-lot2' }] },
      ],
    })
    track.setRealization(c3Lot1!, 'in-progress')
    const c3NoGoDec = track.createDecision({
      decisionKind: 'orientation',
      title: 'Maintenir la variante 1 ?',
      workspace: 'ws-r5',
      targets: [c3Lot1!],
      dossier: {
        context: 'Arbitrage sur la variante 1.',
        qa: [],
        options: [
          { id: 'a', title: 'Maintenir', summary: 'Poursuivre la variante 1' },
          { id: 'b', title: 'Retirer la variante 1', summary: 'Abandonner la variante 1 au profit du lot 2' },
        ],
        recommendation: { optionId: 'b', rationale: 'Lot 2 couvre le besoin' },
        artifacts: [{ kind: 'rendered-view', viewRef: 'docs/dossiers/c3-nogo.md' }],
      },
    })
    track.setReportStatus(c3Lot1!, {
      decisionBlocking: true,
      nextAction: 'Trancher la variante 1 (owner)',
    })
    track.selectDecisionOption(c3NoGoDec, 'b', 'no-go')
    track.setRealization(c3Lot2!, 'in-progress')
    track.setReportStatus(c3Lot2!, {
      status: 'on-track',
      facts: 'Branche feat/c3-lot2 active.',
      nextAction: 'Finaliser la variante retenue (équipe)',
    })

    // 5. Owner Case 4 & Case 5: lot1 merged vs lot2 in dev; lot1 cancelled with old ETA vs lot2 active
    const dCase4 = track.raiseDemand({
      type: 'feature',
      workspace: 'ws-r5',
      raw: { text: 'Cas 4 : lot 1 fusionné et lot 2 en dev' },
      source: { kind: 'human' },
    })
    track.numberDemand(dCase4, 4)
    track.claimDemand(dCase4, {})
    const [c4Lot1, c4Lot2] = track.agreeDemand(dCase4, {
      items: [
        { title: 'Lot 1 fusionné', links: [{ kind: 'pr-merged', locator: 'PR #401' }] },
        { title: 'Lot 2 en dev', links: [{ kind: 'dev-branch', locator: 'feat/c4-lot2' }] },
      ],
    })
    track.setRealization(c4Lot1!, 'in-progress')
    track.setReportStatus(c4Lot1!, {
      status: 'on-track',
      facts: 'PR #401 fusionnée.',
      etas: [
        { targetStage: 'merged', when: '2026-11-10', source: 'committed', by: 'Alice' },
        { targetStage: 'prod', when: '2026-11-16', source: 'committed', by: 'Alice' },
      ],
    })
    track.setRealization(c4Lot2!, 'in-progress')
    track.setReportStatus(c4Lot2!, {
      status: 'on-track',
      facts: 'Branche feat/c4-lot2 active.',
      nextAction: 'Finaliser le lot 2 (équipe)',
      etas: [{ targetStage: 'merged', when: '2026-11-28', source: 'committed', by: 'Bob' }],
    })

    const dCase5 = track.raiseDemand({
      type: 'feature',
      workspace: 'ws-r5',
      raw: { text: 'Cas 5 : lot 1 annulé avec ancienne ETA et lot 2 actif' },
      source: { kind: 'human' },
    })
    track.numberDemand(dCase5, 5)
    track.claimDemand(dCase5, {})
    const [c5Lot1, c5Lot2] = track.agreeDemand(dCase5, {
      items: [
        { title: 'Lot 1 annulé', links: [{ kind: 'dev-branch', locator: 'feat/c5-lot1' }] },
        { title: 'Lot 2 actif', links: [{ kind: 'dev-branch', locator: 'feat/c5-lot2' }] },
      ],
    })
    track.setRealization(c5Lot1!, 'in-progress')
    track.setReportStatus(c5Lot1!, {
      facts: 'Lot 1 annulé par resserrage de périmètre.',
      etas: [{ targetStage: 'pr', when: '2026-11-01', source: 'committed', by: 'Alice' }],
    })
    track.setRealization(c5Lot1!, 'cancelled')
    track.setRealization(c5Lot2!, 'in-progress')
    track.setReportStatus(c5Lot2!, {
      status: 'on-track',
      facts: 'Branche feat/c5-lot2 active.',
      nextAction: 'Livrer le lot 2 (équipe)',
    })

    // 6. Decision routing: decision targeting demand appears on demand-title row; decision targeting lot appears on that lot row
    const dCase6 = track.raiseDemand({
      type: 'feature',
      workspace: 'ws-r5',
      raw: { text: 'Cas 6 : décisions sur la demande et sur un lot' },
      source: { kind: 'human' },
    })
    track.numberDemand(dCase6, 6)
    track.claimDemand(dCase6, {})
    const [c6Lot1, c6Lot2] = track.agreeDemand(dCase6, {
      items: [
        { title: 'Lot 1 autonome', links: [{ kind: 'dev-branch', locator: 'feat/c6-lot1' }] },
        { title: 'Lot 2 avec décision', links: [{ kind: 'dev-branch', locator: 'feat/c6-lot2' }] },
      ],
    })
    track.setRealization(c6Lot1!, 'in-progress')
    track.setReportStatus(c6Lot1!, {
      status: 'on-track',
      facts: 'Branche feat/c6-lot1 active.',
    })
    track.setRealization(c6Lot2!, 'in-progress')
    track.setReportStatus(c6Lot2!, {
      status: 'on-track',
      facts: 'Branche feat/c6-lot2 active.',
    })
    const demandDec = track.createDecision({
      decisionKind: 'orientation',
      title: 'Valider l enveloppe globale de la demande 6 ?',
      workspace: 'ws-r5',
      targets: [dCase6],
      dossier: {
        context: 'Arbitrage global.',
        qa: [],
        options: [
          { id: 'a', title: 'Enveloppe A', summary: 'Périmètre complet' },
          { id: 'b', title: 'Enveloppe B', summary: 'Périmètre réduit' },
        ],
        recommendation: { optionId: 'a', rationale: 'Aligné roadmap' },
        artifacts: [{ kind: 'rendered-view', viewRef: 'docs/dossiers/c6-demand.md' }],
      },
    })
    const lot2Dec = track.createDecision({
      decisionKind: 'orientation',
      title: 'Quel connecteur pour le lot 2 ?',
      workspace: 'ws-r5',
      targets: [c6Lot2!],
      dossier: {
        context: 'Arbitrage lot 2.',
        qa: [],
        options: [
          { id: 'a', title: 'Connecteur A', summary: 'Direct' },
          { id: 'b', title: 'Connecteur B', summary: 'Asynchrone' },
        ],
        recommendation: { optionId: 'a', rationale: 'Plus simple' },
        artifacts: [{ kind: 'rendered-view', viewRef: 'docs/dossiers/c6-lot2.md' }],
      },
    })
    void demandDec
    void lot2Dec

    const events = store.readAll()
    const folded = fold(events)
    const view = projectOwnerTable(folded, events, { baselineCommit: 'c1', workspace: 'ws-r5', now: '2026-11-14T12:00:00.000Z' })
    // 6 multi-lot demands x (1 title row + 2 lot rows) = 18 rows
    expect(view.rows).toHaveLength(18)
    expect(auditOwnerTable(view).ok, JSON.stringify(auditOwnerTable(view).violations)).toBe(true)

    const byId = new Map(view.rows.map((r) => [r.id, r]))

    // Case 1 assertions: lot1 stays 🔵 at dev, lot2 stays ⚪ pas commencé at spec
    expect(byId.get(dCase1)).toMatchObject({ kind: 'demand-title', num: 1, etas: [] })
    expect(byId.get(dCase1)?.status).toBeUndefined()
    expect(byId.get(c1Lot1!)).toMatchObject({
      kind: 'lot',
      parentDemandId: dCase1,
      num: 1,
      status: 'on-track',
      stage: 'dev',
      request: '↳ lot 1 — Socle dev',
    })
    expect(byId.get(c1Lot2!)).toMatchObject({
      kind: 'lot',
      parentDemandId: dCase1,
      num: 1,
      status: 'not-started',
      stage: 'spec',
      request: '↳ lot 2 — Cadrage lot 2',
    })
    expect(formatOwnerStatusCell(byId.get(c1Lot2!)!)).toBe('⚪ pas commencé')

    // Case 2 assertions: lot1 stays 🔵 at dev, lot2 renders ⚪ en pause at spec with its prod ETA
    expect(byId.get(c2Lot1!)).toMatchObject({
      kind: 'lot',
      parentDemandId: dCase2,
      num: 2,
      status: 'on-track',
      stage: 'dev',
    })
    expect(byId.get(c2Lot2!)).toMatchObject({
      kind: 'lot',
      parentDemandId: dCase2,
      num: 2,
      status: 'not-started',
      pausedByOwner: true,
      stage: 'spec',
      etas: [{ targetStage: 'prod', when: '2026-11-25', source: 'committed', by: 'équipe' }],
    })
    expect(formatOwnerStatusCell(byId.get(c2Lot2!)!)).toBe('⚪ en pause')

    // Case 3 assertions: lot1 is ⚫ retiré with its no-go option summary and no decisionBlocking; lot2 is 🔵 at dev
    expect(byId.get(c3Lot1!)).toMatchObject({
      kind: 'lot',
      parentDemandId: dCase3,
      num: 3,
      status: 'withdrawn',
      etas: [],
      done: 'Abandonner la variante 1 au profit du lot 2',
      todo: '—',
      decisionRefs: [],
    })
    expect(byId.get(c3Lot1!)?.decisionBlocking).toBeUndefined()
    expect(byId.get(c3Lot2!)).toMatchObject({
      kind: 'lot',
      parentDemandId: dCase3,
      num: 3,
      status: 'on-track',
      stage: 'dev',
    })

    // Case 4 assertions: lot1 at merged drops reached merged ETA and keeps prod ETA; lot2 at dev keeps merged ETA
    expect(byId.get(c4Lot1!)?.stage).toBe('merged')
    expect(byId.get(c4Lot1!)?.etas).toEqual([
      { targetStage: 'prod', when: '2026-11-16', source: 'committed', by: 'Alice' },
    ])
    expect(byId.get(c4Lot2!)?.stage).toBe('dev')
    expect(byId.get(c4Lot2!)?.etas).toEqual([
      { targetStage: 'merged', when: '2026-11-28', source: 'committed', by: 'Bob' },
    ])

    // Case 5 assertions: lot1 cancelled is ⚫ retiré with etas = []; lot2 is 🔵 at dev
    expect(byId.get(c5Lot1!)).toMatchObject({
      kind: 'lot',
      parentDemandId: dCase5,
      num: 5,
      status: 'withdrawn',
      etas: [],
      done: 'Lot 1 annulé par resserrage de périmètre.',
    })
    expect(byId.get(c5Lot2!)).toMatchObject({
      kind: 'lot',
      parentDemandId: dCase5,
      num: 5,
      status: 'on-track',
      stage: 'dev',
    })

    // Case 6 assertions: D1 on demand-title row, D2 on lot2 row only, lot1 stays 🔵 sur la voie
    expect(byId.get(dCase6)?.decisionRefs).toEqual(['D1'])
    expect(byId.get(dCase6)?.status).toBeUndefined()
    expect(byId.get(c6Lot1!)?.decisionRefs).toEqual([])
    expect(byId.get(c6Lot1!)?.status).toBe('on-track')
    expect(byId.get(c6Lot2!)?.decisionRefs).toEqual(['D2'])
    expect(byId.get(c6Lot2!)?.decisionBlocking).toBe(true)
    expect(byId.get(c6Lot2!)?.status).toBe('blocked')
    expect(byId.get(c6Lot2!)?.todo).toContain('bloqué par D2 (owner)')

    // Renderers (md / text / json) succeed and expose kind + parentDemandId
    const md = renderOwnerTable(view, 'md')
    expect(md).toContain('| 1 | — | — | — | Cas 1 : lot 2 avec spec liée mais non démarré | — | — | — |')
    expect(md).toContain('↳ lot 1 — Socle dev')
    expect(md).toContain('↳ lot 2 — Cadrage lot 2')
    const jsonParsed = JSON.parse(renderOwnerTable(view, 'json')) as OwnerTableView
    expect(jsonParsed.rows[0]?.kind).toBe('demand-title')
    expect(jsonParsed.rows[1]?.kind).toBe('lot')
    expect(jsonParsed.rows[1]?.parentDemandId).toBe(dCase1)

    // auditOwnerTable refuses stage === 'done' for any status other than 'done' or 'withdrawn'
    const sampleLotRow = byId.get(c1Lot1!)!
    for (const nonDoneStatus of ['not-started', 'on-track', 'waiting', 'unforeseen', 'blocked', 'not-qualified'] as const) {
      const invalidStageDoneView: OwnerTableView = {
        ...view,
        rows: [
          {
            ...sampleLotRow,
            kind: 'single',
            parentDemandId: undefined,
            num: 1,
            status: nonDoneStatus,
            stage: 'done',
            todo: nonDoneStatus === 'blocked' ? 'bloqué par tiers (équipe)' : sampleLotRow.todo,
          },
        ],
        decisions: [],
        registeredNumbers: [1],
        archivedNumbers: [],
      }
      expect(auditOwnerTable(invalidStageDoneView).ok, `stage=done with status=${nonDoneStatus}`).toBe(false)
      expect(auditOwnerTable(invalidStageDoneView).violations.map((v) => v.code)).toContain('missing-witness')
    }

    // auditOwnerTable refuses a demand-title row that carries a status or has fewer than 2 lot rows
    const badTitleWithStatus: OwnerTableView = {
      ...view,
      rows: [
        { ...byId.get(dCase1)!, status: 'on-track' },
        byId.get(c1Lot1!)!,
        byId.get(c1Lot2!)!,
      ],
      decisions: [],
      registeredNumbers: [1],
      archivedNumbers: [],
    }
    expect(auditOwnerTable(badTitleWithStatus).ok).toBe(false)
    expect(auditOwnerTable(badTitleWithStatus).violations.map((v) => v.code)).toContain('missing-witness')
  })

  it('Round 6: P1-1 (withdrawn lot / archived demand with unanswered decision), P2-1 (promoted lot ownerNumber/archived), P2-2 (demand-title gates & decisionBlocking)', () => {
    // 1. P1-1a: lot1 has a pending decision D1, then lot1 is cancelled while lot2 continues -> D1 is shown on lot1 as "décision sans objet" (no 🚩, never blocks), stays in view.decisions, and auditOwnerTable passes
    const dCancel = track.raiseDemand({
      type: 'feature',
      workspace: 'ws-r6',
      raw: { text: 'Demande R6-1 : lot 1 annulé avec décision en attente, lot 2 continue' },
      source: { kind: 'human' },
    })
    track.numberDemand(dCancel, 1)
    track.claimDemand(dCancel, {})
    const [r6c1Lot1, r6c1Lot2] = track.agreeDemand(dCancel, {
      items: [
        { title: 'Lot 1 annulé avec décision', links: [{ kind: 'spec', locator: 'docs/specs/r6-c1-l1.md' }] },
        { title: 'Lot 2 actif en dev', links: [{ kind: 'dev-branch', locator: 'feat/r6-c1-l2' }] },
      ],
    })
    const decOnCancelledLot = track.createDecision({
      decisionKind: 'orientation',
      title: 'Quel schéma pour le lot 1 annulé ?',
      workspace: 'ws-r6',
      targets: [r6c1Lot1!],
      dossier: {
        context: 'Devenu sans objet suite à annulation du lot 1.',
        qa: [],
        options: [
          { id: 'a', title: 'Schéma A', summary: 'Conserver A' },
          { id: 'b', title: 'Clore sans objet', summary: 'Clore la décision du lot annulé' },
        ],
        recommendation: { optionId: 'b', rationale: 'Lot annulé' },
        artifacts: [{ kind: 'rendered-view', viewRef: 'docs/dossiers/r6-c1-l1.md' }],
      },
    })
    track.setReportStatus(r6c1Lot1!, {
      facts: 'Lot 1 annulé par resserrage de périmètre.',
      decisionBlocking: true,
    })
    track.setRealization(r6c1Lot1!, 'cancelled')
    track.setRealization(r6c1Lot2!, 'in-progress')
    track.setReportStatus(r6c1Lot2!, {
      status: 'on-track',
      facts: 'Branche feat/r6-c1-l2 active.',
      nextAction: 'Continuer le lot 2 (équipe)',
    })

    // 2. P1-1b: lot1 has TWO decisions (D_nogo + D_remaining); owner selects no-go on D_nogo while D_remaining stays pending and lot2 continues
    const dMultiNoGo = track.raiseDemand({
      type: 'feature',
      workspace: 'ws-r6',
      raw: { text: 'Demande R6-2 : lot 1 en no-go avec seconde décision restante, lot 2 continue' },
      source: { kind: 'human' },
    })
    track.numberDemand(dMultiNoGo, 2)
    track.claimDemand(dMultiNoGo, {})
    const [r6c2Lot1, r6c2Lot2] = track.agreeDemand(dMultiNoGo, {
      items: [
        { title: 'Lot 1 rejeté', links: [{ kind: 'spec', locator: 'docs/specs/r6-c2-l1.md' }] },
        { title: 'Lot 2 maintenu', links: [{ kind: 'dev-branch', locator: 'feat/r6-c2-l2' }] },
      ],
    })
    const decNoGo1 = track.createDecision({
      decisionKind: 'orientation',
      title: 'Faut-il lancer le lot 1 ?',
      workspace: 'ws-r6',
      targets: [r6c2Lot1!],
      dossier: {
        context: 'Arbitrage go/no-go lot 1.',
        qa: [],
        options: [
          { id: 'go', title: 'Lancer', summary: 'Démarrer le lot 1' },
          { id: 'stop', title: 'Abandonner', summary: 'Retrait du lot 1 confirmé par l owner' },
        ],
        recommendation: { optionId: 'stop', rationale: 'Redondant avec le lot 2' },
        artifacts: [{ kind: 'rendered-view', viewRef: 'docs/dossiers/r6-c2-nogo.md' }],
      },
    })
    const decRemainingOnNoGoLot = track.createDecision({
      decisionKind: 'orientation',
      title: 'Quelle variante technique pour le lot 1 ?',
      workspace: 'ws-r6',
      targets: [r6c2Lot1!],
      dossier: {
        context: 'Seconde question posée avant le no-go du lot 1.',
        qa: [],
        options: [
          { id: 'v1', title: 'Variante 1', summary: 'Option V1' },
          { id: 'v2', title: 'Clore sans objet', summary: 'Lot 1 retiré' },
        ],
        recommendation: { optionId: 'v2', rationale: 'Lot 1 retiré' },
        artifacts: [{ kind: 'rendered-view', viewRef: 'docs/dossiers/r6-c2-rem.md' }],
      },
    })
    track.selectDecisionOption(decNoGo1, 'stop', 'no-go')
    track.setRealization(r6c2Lot2!, 'in-progress')
    track.setReportStatus(r6c2Lot2!, {
      status: 'on-track',
      facts: 'Branche feat/r6-c2-l2 active.',
      nextAction: 'Livrer le lot 2 (équipe)',
    })

    // 3. P1-1c: Demand #3 had a pending decision D_arch_pending and is then archived via a 'go' decision; Demand #4 is active with 2 lots (and P2-1 + P2-2)
    const dArchived = track.raiseDemand({
      type: 'feature',
      workspace: 'ws-r6',
      raw: { text: 'Demande R6-3 archivée mais ayant encore une décision ouverte' },
      source: { kind: 'human' },
    })
    track.numberDemand(dArchived, 3)
    const decOnArchivedDemand = track.createDecision({
      decisionKind: 'orientation',
      title: 'Option sur la demande 3 désormais archivée ?',
      workspace: 'ws-r6',
      targets: [dArchived],
      dossier: {
        context: 'Question ouverte avant archivage de la demande 3.',
        qa: [],
        options: [
          { id: 'a', title: 'Option A', summary: 'Garder A' },
          { id: 'b', title: 'Clore', summary: 'Demande archivée' },
        ],
        recommendation: { optionId: 'b', rationale: 'Demande archivée' },
        artifacts: [{ kind: 'rendered-view', viewRef: 'docs/dossiers/r6-c3-pending.md' }],
      },
    })
    const archiveGoDec = track.createDecision({
      decisionKind: 'commitment',
      title: 'Archiver la demande 3 ?',
      workspace: 'ws-r6',
      targets: [dArchived],
      dossier: {
        context: 'Archivage owner de la demande 3.',
        qa: [],
        options: [
          { id: 'yes', title: 'Archiver', summary: 'Archiver la demande 3' },
          { id: 'no', title: 'Conserver', summary: 'Garder active' },
        ],
        recommendation: { optionId: 'yes', rationale: 'Remplacée par la demande 4' },
        artifacts: [{ kind: 'rendered-view', viewRef: 'docs/dossiers/r6-c3-arch.md' }],
      },
    })
    track.selectDecisionOption(archiveGoDec, 'yes', 'go')
    track.archiveDemand(dArchived, { decisionId: archiveGoDec, reason: 'Archivée par l owner' })

    // 4. P2-1 & P2-2: Demand #4 has 2 promoted lots where a promoted lot carries a stray ownerNumber (99) and archived record, plus a blocking decision on demand #4
    const dActive4 = track.raiseDemand({
      type: 'feature',
      workspace: 'ws-r6',
      raw: { text: 'Demande R6-4 : 2 lots avec numéro/archive parasites sur lot enfant et décision bloquante sur demande' },
      source: { kind: 'human' },
    })
    track.numberDemand(dActive4, 4)
    track.claimDemand(dActive4, {})
    const [r6c4Lot1, r6c4Lot2] = track.agreeDemand(dActive4, {
      items: [
        { title: 'Lot 4.1 actif', links: [{ kind: 'dev-branch', locator: 'feat/r6-c4-l1' }] },
        { title: 'Lot 4.2 actif', links: [{ kind: 'dev-branch', locator: 'feat/r6-c4-l2' }] },
      ],
    })
    track.setRealization(r6c4Lot1!, 'in-progress')
    // Promoted child lot carries ownerNumber: 99 and archived (must be ignored at top-level registeredNumbers/archivedNumbers)
    track.setReportStatus(r6c4Lot1!, {
      ownerNumber: 99,
      archived: { decisionId: archiveGoDec, reason: 'Archive sur lot enfant' },
      status: 'on-track',
      facts: 'Branche feat/r6-c4-l1 active.',
      nextAction: 'Finaliser le lot 4.1 (équipe)',
    })
    track.setRealization(r6c4Lot2!, 'in-progress')
    track.setReportStatus(r6c4Lot2!, {
      status: 'on-track',
      facts: 'Branche feat/r6-c4-l2 active.',
      nextAction: 'Finaliser le lot 4.2 (équipe)',
    })
    const decBlockingDemand4 = track.createDecision({
      decisionKind: 'commitment',
      title: 'Valider le cadrage global de la demande 4 ?',
      workspace: 'ws-r6',
      targets: [dActive4],
      dossier: {
        context: 'Décision bloquante sur la ligne de titre de la demande 4.',
        qa: [],
        options: [
          { id: 'a', title: 'Valider', summary: 'Cadrage A' },
          { id: 'b', title: 'Variante', summary: 'Cadrage B' },
        ],
        recommendation: { optionId: 'a', rationale: 'Recommandé' },
        artifacts: [{ kind: 'rendered-view', viewRef: 'docs/dossiers/r6-c4-title.md' }],
      },
    })
    void decOnCancelledLot
    void decRemainingOnNoGoLot
    void decOnArchivedDemand
    void decBlockingDemand4

    const events = store.readAll()
    const folded = fold(events)
    const view = projectOwnerTable(folded, events, { baselineCommit: 'c1', workspace: 'ws-r6' })
    const audit = auditOwnerTable(view)
    expect(audit.ok, JSON.stringify(audit.violations)).toBe(true)

    // P2-1: registeredNumbers is [1, 2, 3, 4] (never polluted by 99 on promoted child lot), archivedNumbers is [3]
    expect(view.registeredNumbers).toEqual([1, 2, 3, 4])
    expect(view.archivedNumbers).toEqual([3])

    const byId = new Map(view.rows.map((r) => [r.id, r]))

    // P1-1a & P1-1b: withdrawn lots show "D# (décision sans objet)" without 🚩 and without blocking siblings
    const lot1CancelRow = byId.get(r6c1Lot1!)!
    expect(lot1CancelRow.status).toBe('withdrawn')
    expect(lot1CancelRow.decisionRefs).toEqual(['D1'])
    expect(lot1CancelRow.decisionBlocking).toBeUndefined()
    expect(lot1CancelRow.blockingDecisionRefs).toBeUndefined()
    expect(formatOwnerDecisionCell(lot1CancelRow)).toBe('D1 (décision sans objet)')
    expect(byId.get(r6c1Lot2!)?.status).toBe('on-track')

    const lot1NoGoRow = byId.get(r6c2Lot1!)!
    expect(lot1NoGoRow.status).toBe('withdrawn')
    expect(lot1NoGoRow.decisionRefs).toEqual(['D2'])
    expect(lot1NoGoRow.decisionBlocking).toBeUndefined()
    expect(lot1NoGoRow.blockingDecisionRefs).toBeUndefined()
    expect(formatOwnerDecisionCell(lot1NoGoRow)).toBe('D2 (décision sans objet)')
    expect(byId.get(r6c2Lot2!)?.status).toBe('on-track')

    // P1-1a/b/c: D1, D2, D3 stay in view.decisions below the table with sansObjet: true and blocking: false
    expect(view.decisions).toHaveLength(4)
    for (const ref of ['D1', 'D2', 'D3']) {
      const dec = view.decisions.find((d) => d.ref === ref)!
      expect(dec).toBeDefined()
      expect(dec.sansObjet).toBe(true)
      expect(dec.blocking).toBe(false)
    }
    const d4 = view.decisions.find((d) => d.ref === 'D4')!
    expect(d4.sansObjet).toBeUndefined()
    expect(d4.blocking).toBe(true)

    // P2-2 (1): demand-title row for Demand #4 has decisionBlocking: true alongside blockingDecisionRefs: ['D4']
    const title4Row = byId.get(dActive4)!
    expect(title4Row.kind).toBe('demand-title')
    expect(title4Row.decisionRefs).toEqual(['D4'])
    expect(title4Row.blockingDecisionRefs).toEqual(['D4'])
    expect(title4Row.decisionBlocking).toBe(true)
    expect(formatOwnerDecisionCell(title4Row)).toBe('🚩 D4 bloquante')

    const renderedMd = renderOwnerTable(view, 'md')
    expect(renderedMd).toContain('D1 (décision sans objet)')
    expect(renderedMd).toContain('D2 (décision sans objet)')
    expect(renderedMd).toContain('- **D1** (décision sans objet) —')
    expect(renderedMd).toContain('- **D2** (décision sans objet) —')
    expect(renderedMd).toContain('- **D3** (décision sans objet) —')
    expect(renderedMd).toContain('- **D4** —')

    // P2-2 (2): auditOwnerTable refuses demand-title rows with non-dash done/todo, pausedByOwner, hasWitness, inconsistent decisionBlocking, or non-empty etas in #456
    const baseTitle = byId.get(dCancel)!
    const lotA = byId.get(r6c1Lot2!)!
    const lotB = { ...lotA, id: 'lot-b', request: '↳ lot 2 — Lot B' }
    const checkTitleRejection = (override: Partial<OwnerTableRow>, expectedCode: string) => {
      const candidateView: OwnerTableView = {
        ...view,
        rows: [{ ...baseTitle, num: 1, ...override }, { ...lotA, num: 1, parentDemandId: baseTitle.id }, { ...lotB, num: 1, parentDemandId: baseTitle.id }],
        decisions: [],
        registeredNumbers: [1],
        archivedNumbers: [],
      }
      const res = auditOwnerTable(candidateView)
      expect(res.ok, `expected rejection for ${JSON.stringify(override)}`).toBe(false)
      expect(res.violations.map((v) => v.code)).toContain(expectedCode)
    }
    checkTitleRejection({ done: 'Fait illégal sur titre' }, 'missing-witness')
    checkTitleRejection({ todo: 'Action illégale sur titre' }, 'missing-witness')
    checkTitleRejection({ pausedByOwner: true }, 'missing-witness')
    checkTitleRejection({ hasWitness: true }, 'missing-witness')
    checkTitleRejection({ decisionBlocking: true }, 'invalid-decision')
    checkTitleRejection({ etas: [{ targetStage: 'prod', when: '2026-11-25', source: 'committed' }] }, 'invalid-eta')
  })

  it('Round 7: P2-1 preserves "décision sans objet" in md/text on a demand-title row whose lots are all withdrawn and on an archived target, and enforces the sansObjet audit guard on withdrawn rows', () => {
    // 1. Multi-lot demand #1 has a pending decision D1 targeting the demand itself, and both of its lots are withdrawn (cancelled + no-go)
    const dAllWithdrawn = track.raiseDemand({
      type: 'feature',
      workspace: 'ws-r7',
      raw: { text: 'Demande R7-1 : 2 lots retirés avec décision sur la demande' },
      source: { kind: 'human' },
    })
    track.numberDemand(dAllWithdrawn, 1)
    track.claimDemand(dAllWithdrawn, {})
    const [r7Lot1, r7Lot2] = track.agreeDemand(dAllWithdrawn, {
      items: [
        { title: 'Lot 1 annulé', links: [{ kind: 'spec', locator: 'docs/specs/r7-l1.md' }] },
        { title: 'Lot 2 arrêté en no-go', links: [{ kind: 'spec', locator: 'docs/specs/r7-l2.md' }] },
      ],
    })
    const decOnDemandAllWithdrawn = track.createDecision({
      decisionKind: 'orientation',
      title: 'Quel cadrage global pour la demande 1 dont tous les lots sont retirés ?',
      workspace: 'ws-r7',
      targets: [dAllWithdrawn],
      dossier: {
        context: 'Tous les lots de la demande 1 ont été retirés.',
        qa: [],
        options: [
          { id: 'a', title: 'Option A', summary: 'Cadrage A' },
          { id: 'b', title: 'Clore sans objet', summary: 'Tous les lots sont retirés' },
        ],
        recommendation: { optionId: 'b', rationale: 'Lots retirés' },
        artifacts: [{ kind: 'rendered-view', viewRef: 'docs/dossiers/r7-d1.md' }],
      },
    })
    track.setReportStatus(r7Lot1!, { facts: 'Lot 1 annulé par l owner.' })
    track.setRealization(r7Lot1!, 'cancelled')
    const decNoGoLot2 = track.createDecision({
      decisionKind: 'orientation',
      title: 'Arrêter le lot 2 ?',
      workspace: 'ws-r7',
      targets: [r7Lot2!],
      dossier: {
        context: 'Arbitrage lot 2.',
        qa: [],
        options: [
          { id: 'go', title: 'Continuer', summary: 'Poursuivre le lot 2' },
          { id: 'stop', title: 'Arrêter', summary: 'Retrait du lot 2 validé par l owner' },
        ],
        recommendation: { optionId: 'stop', rationale: 'Hors périmètre' },
        artifacts: [{ kind: 'rendered-view', viewRef: 'docs/dossiers/r7-l2-nogo.md' }],
      },
    })
    track.selectDecisionOption(decNoGoLot2, 'stop', 'no-go')

    // 2. Demand #2 has an open decision D2 and is then archived via a settled 'go' decision
    const dArch2 = track.raiseDemand({
      type: 'feature',
      workspace: 'ws-r7',
      raw: { text: 'Demande R7-2 archivée avec décision en attente' },
      source: { kind: 'human' },
    })
    track.numberDemand(dArch2, 2)
    const decOnArch2 = track.createDecision({
      decisionKind: 'orientation',
      title: 'Faut-il retenir la variante X de la demande 2 archivée ?',
      workspace: 'ws-r7',
      targets: [dArch2],
      dossier: {
        context: 'Demande 2 archivée.',
        qa: [],
        options: [
          { id: 'x', title: 'Variante X', summary: 'Garder X' },
          { id: 'close', title: 'Clore sans objet', summary: 'Demande 2 archivée' },
        ],
        recommendation: { optionId: 'close', rationale: 'Archivée' },
        artifacts: [{ kind: 'rendered-view', viewRef: 'docs/dossiers/r7-d2-arch.md' }],
      },
    })
    const goArch2 = track.createDecision({
      decisionKind: 'commitment',
      title: 'Archiver la demande 2 ?',
      workspace: 'ws-r7',
      targets: [dArch2],
      dossier: {
        context: 'Archivage owner.',
        qa: [],
        options: [
          { id: 'yes', title: 'Archiver', summary: 'Archiver la demande 2' },
          { id: 'no', title: 'Conserver', summary: 'Garder active' },
        ],
        recommendation: { optionId: 'yes', rationale: 'Archiver' },
        artifacts: [{ kind: 'rendered-view', viewRef: 'docs/dossiers/r7-d2-go.md' }],
      },
    })
    track.selectDecisionOption(goArch2, 'yes', 'go')
    track.archiveDemand(dArch2, { decisionId: goArch2, reason: 'Archivée sur GO owner' })

    void decOnDemandAllWithdrawn
    void decOnArch2

    const events = store.readAll()
    const folded = fold(events)
    const view = projectOwnerTable(folded, events, { baselineCommit: 'c1', workspace: 'ws-r7' })
    const audit = auditOwnerTable(view)
    expect(audit.ok, JSON.stringify(audit.violations)).toBe(true)

    const byId = new Map(view.rows.map((r) => [r.id, r]))
    const titleRow = byId.get(dAllWithdrawn)!
    expect(titleRow.kind).toBe('demand-title')
    expect(titleRow.status).toBeUndefined()
    expect(titleRow.decisionRefs).toEqual(['D1'])
    expect(titleRow.sansObjetDecisionRefs).toEqual(['D1'])
    expect(titleRow.blockingDecisionRefs).toBeUndefined()
    expect(titleRow.decisionBlocking).toBeUndefined()
    expect(formatOwnerDecisionCell(titleRow)).toBe('D1 (décision sans objet)')

    const md = renderOwnerTable(view, 'md')
    expect(md).toContain('| D1 (décision sans objet) |')
    expect(md).toContain('- **D1** (décision sans objet) — Quel cadrage global pour la demande 1 dont tous les lots sont retirés ?')
    expect(md).toContain('- **D2** (décision sans objet) — Faut-il retenir la variante X de la demande 2 archivée ?')

    // 3. Audit guard: a withdrawn row referencing a decision that is NOT sansObjet is rejected
    const { sansObjet: _omitted, ...activeDec } = view.decisions[0]!
    void _omitted
    const withdrawnRowWithActiveDecision: OwnerTableView = {
      ...view,
      rows: [
        titleRow,
        {
          ...byId.get(r7Lot1!)!,
          decisionRefs: ['D1'],
          sansObjetDecisionRefs: ['D1'],
        },
        byId.get(r7Lot2!)!,
      ],
      decisions: [activeDec, view.decisions[1]!],
    }
    const badWithdrawnAudit = auditOwnerTable(withdrawnRowWithActiveDecision)
    expect(badWithdrawnAudit.ok).toBe(false)
    expect(badWithdrawnAudit.violations.map((v) => v.code)).toContain('invalid-decision')

    // 4. Audit guard: a demand-title row referencing a sansObjet decision without sansObjetDecisionRefs is rejected
    const titleWithoutSansObjetRefs: OwnerTableView = {
      ...view,
      rows: [
        {
          ...titleRow,
          sansObjetDecisionRefs: undefined,
        },
        byId.get(r7Lot1!)!,
        byId.get(r7Lot2!)!,
      ],
    }
    const badTitleAudit = auditOwnerTable(titleWithoutSansObjetRefs)
    expect(badTitleAudit.ok).toBe(false)
    expect(badTitleAudit.violations.map((v) => v.code)).toContain('invalid-decision')
  })

  it('fails closed when a journal has zero owner-numbered demands, all demands archived, or orphan pending decisions, while keeping --status-table unchanged', () => {
    const expectedNoDemandsMsg =
      'aucune demande owner numérotée dans le journal (.track) — tableau owner refusé ' +
      '(des demandes ou décisions owner ouvertes peuvent exister hors journal ; ' +
      'ingère une ligne `demand.raise` avec `track ingest <file.jsonl> --workspace <w>` puis numérote-la avec `track demand number <demandId> --number <n>`, ' +
      'ou utilise `track report --status-table` pour la vue technique)'

    // (b1) Journal exists with non-demand events (0 demand.* events)
    track.createItem({ kind: 'chore', title: 'Tâche technique sans demande owner', workspace: 'ws-empty' })
    const eventsNoDemands = store.readAll()
    const viewNoDemands = projectOwnerTable(fold(eventsNoDemands), eventsNoDemands, { baselineCommit: 'c1' })
    expect(viewNoDemands.rows).toHaveLength(0)
    expect(viewNoDemands.replyLine).toBe('')
    const auditNoDemands = auditOwnerTable(viewNoDemands)
    expect(auditNoDemands.ok).toBe(false)
    expect(auditNoDemands.violations).toMatchObject([
      { code: 'no-owner-demands', check: 'demands.none', message: expectedNoDemandsMsg },
    ])
    expect(() => renderOwnerTable(viewNoDemands, 'md')).toThrow(
      `REFUSED: owner table failed blocking gates:\n- [no-owner-demands] ${expectedNoDemandsMsg}`,
    )

    for (const format of ['md', 'text', 'json'] as const) {
      const out: string[] = []
      const err: string[] = []
      const code = runCli(['report', '--owner-table', '--strict', '--format', format, '--commit', 'c1'], {
        cwd: dir,
        out: (s) => out.push(s),
        err: (s) => err.push(s),
      })
      expect(code).toBe(1)
      expect(out.join('')).toBe('')
      expect(err.join('')).toContain(
        `error: REFUSED: owner table failed blocking gates:\n- [no-owner-demands] ${expectedNoDemandsMsg}\n`,
      )
      expect(out.join('') + err.join('')).not.toContain('Aucune décision en attente')
      expect(out.join('') + err.join('')).not.toContain('Réponse : aucune décision en attente')
    }

    // --status-table stays unchanged on the same zero-demand journal
    const statusOut: string[] = []
    const statusErr: string[] = []
    const statusCode = runCli(['report', '--status-table', '--format', 'md', '--commit', 'c1'], {
      cwd: dir,
      out: (s) => statusOut.push(s),
      err: (s) => statusErr.push(s),
    })
    expect(statusCode, statusErr.join('')).toBe(0)
    expect(statusOut.join('')).toContain('À-FAIRE')

    // (b2 + c) Journal with zero owner-numbered demands AND an orphan pending structured decision
    const itemForDec = track.createItem({ kind: 'feature', title: 'Sujet avec décision ouverte', workspace: 'ws-empty' })
    track.createDecision({
      decisionKind: 'commitment',
      title: 'Quel mode retenir ?',
      workspace: 'ws-empty',
      targets: [itemForDec],
      dossier: {
        context: 'Arbitrage ouvert.',
        qa: [],
        options: [
          { id: 'a', title: 'Option A', summary: 'Conséquence A' },
          { id: 'b', title: 'Option B', summary: 'Conséquence B' },
        ],
        recommendation: { optionId: 'a', rationale: 'Plus simple' },
        artifacts: [{ kind: 'rendered-view', viewRef: 'docs/dossiers/orphan.md' }],
      },
    })
    const outOrphan: string[] = []
    const errOrphan: string[] = []
    const codeOrphan = runCli(['report', '--owner-table', '--strict', '--format', 'md', '--commit', 'c1'], {
      cwd: dir,
      out: (s) => outOrphan.push(s),
      err: (s) => errOrphan.push(s),
    })
    expect(codeOrphan).toBe(1)
    expect(outOrphan.join('')).toBe('')
    expect(errOrphan.join('')).toContain(`[no-owner-demands] ${expectedNoDemandsMsg}`)
    expect(errOrphan.join('')).toContain('[invalid-decision] decision D1 is not referenced by any row')
    expect(outOrphan.join('') + errOrphan.join('')).not.toContain('Aucune décision en attente')
    expect(outOrphan.join('') + errOrphan.join('')).not.toContain('Réponse : aucune décision en attente')

    // (b4) Fresh `track init` directory (empty .track, 0 events) and unnumbered `demand.raised` (0 `demand.owner-numbered`)
    const initDir = mkdtempSync(join(tmpdir(), 'track-owner-fresh-init-'))
    try {
      expect(runCli(['init'], { cwd: initDir, out: () => {}, err: () => {} })).toBe(0)
      const initOut: string[] = []
      const initErr: string[] = []
      const initCode = runCli(['report', '--owner-table', '--strict', '--format', 'md', '--commit', 'c1'], {
        cwd: initDir,
        out: (s) => initOut.push(s),
        err: (s) => initErr.push(s),
      })
      expect(initCode).toBe(1)
      expect(initOut.join('')).toBe('')
      expect(initErr.join('')).toContain(
        `error: REFUSED: owner table failed blocking gates:\n- [no-owner-demands] ${expectedNoDemandsMsg}\n`,
      )
      expect(initOut.join('') + initErr.join('')).not.toContain('Aucune décision en attente')
      expect(initOut.join('') + initErr.join('')).not.toContain('Réponse : aucune décision en attente')

      // Raising a demand without numbering it still has zero owner-numbered demands
      const unnumberedTrack = new Track(new EventStore(join(initDir, '.track', 'events.jsonl')), {
        by: 'test-owner-table',
        now: () => clock,
      })
      unnumberedTrack.raiseDemand({
        type: 'feature',
        workspace: 'ws-init',
        raw: { text: 'Demande non numérotée' },
        source: { kind: 'human' },
      })
      const unnumOut: string[] = []
      const unnumErr: string[] = []
      const unnumCode = runCli(['report', '--owner-table', '--strict', '--format', 'md', '--commit', 'c1'], {
        cwd: initDir,
        out: (s) => unnumOut.push(s),
        err: (s) => unnumErr.push(s),
      })
      expect(unnumCode).toBe(1)
      expect(unnumOut.join('')).toBe('')
      expect(unnumErr.join('')).toContain(`[no-owner-demands] ${expectedNoDemandsMsg}`)
      expect(unnumOut.join('') + unnumErr.join('')).not.toContain('Aucune décision en attente')
      expect(unnumOut.join('') + unnumErr.join('')).not.toContain('Réponse : aucune décision en attente')
    } finally {
      rmSync(initDir, { recursive: true, force: true })
    }
  })

  it('refuses a numbered journal that still holds a pending or deferred decision without options (T0-a)', () => {
    for (const outcome of ['pending', 'deferred'] as const) {
      const caseDir = mkdtempSync(join(tmpdir(), `track-owner-t0a-${outcome}-`))
      try {
        const caseStore = new EventStore(join(caseDir, '.track', 'events.jsonl'))
        const caseTrack = new Track(caseStore, { by: 'test-owner-table', now: () => clock })
        const demandId = caseTrack.raiseDemand({
          type: 'feature',
          workspace: 'ws-t0a',
          raw: { text: 'Suivre une demande avec décision sans options' },
          source: { kind: 'human' },
        })
        caseTrack.numberDemand(demandId, 1)

        const legacyDecisionId = '01JTESTLEGACYDECISION00001'
        caseStore.appendCommand([
          {
            id: '01JTESTLEGACYDECISIONEVT01',
            type: 'decision.created',
            aggregate: 'decision',
            aggregateId: legacyDecisionId,
            at: clock,
            by: 'test-owner-table',
            payload: {
              decisionKind: 'commitment',
              title: 'Arbitrage historique sans options',
              workspace: 'ws-t0a',
              targets: [demandId],
              dossier: {
                context: 'Décision historique sans options structurées.',
                options: [],
                qa: [],
              },
            },
          },
        ])
        if (outcome === 'deferred') {
          caseTrack.setOutcome(legacyDecisionId, 'deferred')
        }

        const out: string[] = []
        const err: string[] = []
        const code = runCli(['report', '--owner-table', '--strict', '--format', 'md'], {
          cwd: caseDir,
          out: (s) => out.push(s),
          err: (s) => err.push(s),
        })
        expect(code, `outcome=${outcome}\nstdout:\n${out.join('')}\nstderr:\n${err.join('')}`).toBe(1)
        expect(err.join(''), `outcome=${outcome}`).toContain('[invalid-decision]')
        expect(out.join(''), `outcome=${outcome}`).toBe('')
        expect(out.join('') + err.join(''), `outcome=${outcome}`).not.toContain('Aucune décision en attente')
        expect(out.join('') + err.join(''), `outcome=${outcome}`).not.toContain(
          'Réponse : aucune décision en attente',
        )
      } finally {
        rmSync(caseDir, { recursive: true, force: true })
      }
    }
  })

  it('refuses a journal whose numbered demands are all archived with its own message and never the absolute sentence (T0-b)', () => {
    const expectedAllArchivedMsg =
      'aucune demande owner active dans le journal (.track) — toutes les demandes numérotées sont archivées, ' +
      'tableau owner vide refusé'

    const archivedDir = mkdtempSync(join(tmpdir(), 'track-owner-all-archived-'))
    try {
      const archivedStore = new EventStore(join(archivedDir, '.track', 'events.jsonl'))
      const archivedTrack = new Track(archivedStore, { by: 'test-owner-table', now: () => clock })
      const d1 = archivedTrack.raiseDemand({
        type: 'feature',
        workspace: 'ws-arch',
        raw: { text: 'Demande archivée uniquement' },
        source: { kind: 'human' },
      })
      archivedTrack.numberDemand(d1, 1)
      const goArch = archivedTrack.createDecision({
        decisionKind: 'commitment',
        title: 'Archiver la demande 1 ?',
        workspace: 'ws-arch',
        targets: [d1],
        dossier: {
          context: 'Clôture.',
          qa: [],
          options: [
            { id: 'yes', title: 'Archiver', summary: 'Retirer de la table' },
            { id: 'no', title: 'Garder', summary: 'Conserver' },
          ],
          recommendation: { optionId: 'yes', rationale: 'Terminée' },
          artifacts: [{ kind: 'rendered-view', viewRef: 'docs/dossiers/arch-only.md' }],
        },
      })
      archivedTrack.selectDecisionOption(goArch, 'yes', 'go')
      archivedTrack.archiveDemand(d1, { decisionId: goArch, reason: 'Archivée avec accord owner' })

      const archOut: string[] = []
      const archErr: string[] = []
      const archCode = runCli(['report', '--owner-table', '--strict', '--format', 'md', '--commit', 'c1'], {
        cwd: archivedDir,
        out: (s) => archOut.push(s),
        err: (s) => archErr.push(s),
      })
      expect(archCode).toBe(1)
      expect(archOut.join('')).toBe('')
      expect(archErr.join('')).toContain(
        `error: REFUSED: owner table failed blocking gates:\n- [no-owner-demands] ${expectedAllArchivedMsg}\n`,
      )
      expect(archOut.join('') + archErr.join('')).not.toContain('Aucune décision en attente')
      expect(archOut.join('') + archErr.join('')).not.toContain('Réponse : aucune décision en attente')
    } finally {
      rmSync(archivedDir, { recursive: true, force: true })
    }
  })

  it('every command quoted by a refusal message runs without a usage error (T0-c)', () => {
    const messages = [
      OWNER_TABLE_NO_DEMANDS_MESSAGE,
      OWNER_TABLE_ALL_ARCHIVED_MESSAGE,
      formatOwnerTableNoJournalMessage(join(dir, 'placeholder-cwd')),
    ]
    const commands: string[] = []
    for (const msg of messages) {
      for (const match of msg.matchAll(/`(track [^`]+)`/gu)) {
        commands.push(match[1]!)
      }
    }
    expect(commands.length).toBeGreaterThan(0)

    const failures: string[] = []
    for (const command of commands) {
      const cmdDir = mkdtempSync(join(tmpdir(), 'track-owner-t0c-'))
      try {
        const cmdStore = new EventStore(join(cmdDir, '.track', 'events.jsonl'))
        const cmdTrack = new Track(cmdStore, { by: 'test-owner-table', now: () => clock })
        const unnumberedDemandId = cmdTrack.raiseDemand({
          type: 'feature',
          workspace: 'ws',
          raw: { text: 'Demande de test non numérotée' },
          source: { kind: 'human' },
        })
        const ingestFile = join(cmdDir, 'demand-raise.jsonl')
        writeFileSync(
          ingestFile,
          `${JSON.stringify({
            v: 1,
            kind: 'demand.raise',
            payload: {
              type: 'feature',
              raw: { text: 'Demande de test', title: 'Demande de test' },
              source: { kind: 'human' },
              workspace: 'ws',
            },
          })}\n`,
          'utf8',
        )

        const substitutions: Record<string, string> = {
          '<id>': unnumberedDemandId,
          '<demandId>': unnumberedDemandId,
          '<n>': '1',
          '<text>': 'Demande de test',
          '<file.jsonl>': ingestFile,
          '<w>': 'ws',
          '<dossier>': join(cmdDir, '.track'),
        }

        const argv = command
          .split(/\s+/u)
          .slice(1)
          .map((token) => {
            if (/^<[^>]+>$/u.test(token)) {
              expect(substitutions, `unknown placeholder ${token} in "${command}"`).toHaveProperty(token)
              return substitutions[token]!
            }
            expect(token, `unsubstituted placeholder in "${command}"`).not.toMatch(/<[^>]+>/u)
            return token
          })

        const out: string[] = []
        const err: string[] = []
        const code = runCli(argv, {
          cwd: cmdDir,
          out: (s) => out.push(s),
          err: (s) => err.push(s),
        })
        if (code !== 0) {
          failures.push(`${command} -> exit ${code}: ${err.join('').trim()}`)
        }
      } finally {
        rmSync(cmdDir, { recursive: true, force: true })
      }
    }
    expect(failures).toEqual([])
  })
})
