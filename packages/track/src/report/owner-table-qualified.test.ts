import { createHash } from 'node:crypto'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { runCli } from '../cli/index.js'
import { resolveJournalOfReference } from '../cli/journal-reference.js'
import { EventStore } from '../events/store.js'
import { fold } from '../state/fold.js'
import { Track } from '../track.js'
import {
  LEGACY_LIKE_COMMIT,
  LEGACY_LIKE_FIXTURE_DIR,
  LEGACY_LIKE_NOW,
  STRICT_REFUSAL_FIXTURE_FILE,
} from './legacy-like-journal.fixture.test.js'
import { projectOwnerTable, renderOwnerTable, type OwnerTableRow, type OwnerTableView } from './owner-table.js'
import { buildQualifiedOwnerTable, renderQualifiedOwnerTable } from './owner-table-qualified.js'

const RESERVED_PHRASE = 'Aucune décision en attente'
const RESERVED_REPLY = 'Réponse : aucune décision en attente'

let scratch: string
let savedEnv: Record<string, string | undefined>

function isolateEnv(stateHome: string): void {
  savedEnv = {
    TRACK_OWNER_POLICY_FILE: process.env['TRACK_OWNER_POLICY_FILE'],
    TRACK_OWNER_REPORT_POLICY: process.env['TRACK_OWNER_REPORT_POLICY'],
    TRACK_STATE_HOME: process.env['TRACK_STATE_HOME'],
    TRACK_DIR: process.env['TRACK_DIR'],
  }
  delete process.env['TRACK_OWNER_POLICY_FILE']
  delete process.env['TRACK_OWNER_REPORT_POLICY']
  delete process.env['TRACK_DIR']
  process.env['TRACK_STATE_HOME'] = stateHome
}

function restoreEnv(): void {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
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

function copyLegacyFixture(destParent: string): string {
  const trackDir = join(destParent, '.track')
  cpSync(LEGACY_LIKE_FIXTURE_DIR, trackDir, { recursive: true })
  return trackDir
}

function makeCleanNumberedView(): OwnerTableView {
  return {
    kind: 'owner-table-report',
    registeredNumbers: [1],
    archivedNumbers: [],
    rows: [
      {
        kind: 'single',
        num: 1,
        id: 'req-clean-1',
        status: 'on-track',
        stage: 'dev',
        etas: [{ targetStage: 'pr', when: '2026-11-25', source: 'committed', by: 'Alice' }],
        request: 'Ajouter le filtre par date',
        done: 'Branche ouverte et tests verts',
        todo: 'Ouvrir la revue (équipe)',
        decisionRefs: [],
        hasWitness: true,
      },
    ],
    decisions: [],
    replyLine: '',
  }
}

function fingerprintTree(rootDir: string): string {
  const hash = createHash('sha256')
  const walk = (dir: string, rel: string): void => {
    if (!existsSync(dir)) return
    const entries = readdirSync(dir).sort()
    for (const name of entries) {
      const full = join(dir, name)
      const relPath = rel === '' ? name : `${rel}/${name}`
      const st = statSync(full)
      if (st.isDirectory()) {
        hash.update(`dir:${relPath}\0`)
        walk(full, relPath)
      } else {
        hash.update(`file:${relPath}:${st.size}\0`)
        hash.update(readFileSync(full))
        hash.update('\0')
      }
    }
  }
  walk(rootDir, '')
  return hash.digest('hex')
}

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'track-owner-qual-'))
  const isolatedState = join(scratch, 'state-home')
  mkdirSync(isolatedState, { recursive: true })
  isolateEnv(isolatedState)
})

afterEach(() => {
  restoreEnv()
  rmSync(scratch, { recursive: true, force: true })
})

describe('owner-table qualified reader (lot 1)', () => {
  it('renders 14 rows, 13 demands to attach, 18 decisions of which 16 outside a demand, 15 without dossier and 1 to instruct, and counts 30 dossier questions (T1-a)', () => {
    const repo = join(scratch, 'legacy-repo')
    mkdirSync(repo, { recursive: true })
    copyLegacyFixture(repo)

    const mdRes = cli(repo, [
      'report',
      '--owner-table',
      '--format',
      'md',
      '--now',
      LEGACY_LIKE_NOW,
      '--commit',
      LEGACY_LIKE_COMMIT,
    ])
    expect(mdRes.code, mdRes.err).toBe(0)
    expect(mdRes.out).toContain('Journal : legacy-repo · dossier · dernier événement 19/11')
    expect(mdRes.out).toContain('13 demandes à rattacher')
    expect(mdRes.out).toContain('18 décisions à compléter')
    expect(mdRes.out).toContain('30 questions de dossier sans réponse')
    expect(mdRes.out).toContain('À rattacher — 13 demandes connues, sans numéro')
    expect(mdRes.out).toContain(
      "Décisions qui t'attendent — 18 (16 hors demande, 15 sans dossier, 1 à instruire) · 30 questions de dossier sans réponse (1 décision)",
    )

    const jsonRes = cli(repo, [
      'report',
      '--owner-table',
      '--format',
      'json',
      '--now',
      LEGACY_LIKE_NOW,
      '--commit',
      LEGACY_LIKE_COMMIT,
    ])
    expect(jsonRes.code, jsonRes.err).toBe(0)
    const parsed = JSON.parse(jsonRes.out)
    expect(parsed.rows).toHaveLength(14)
    expect(parsed.toAttach).toHaveLength(13)
    expect(parsed.decisions).toHaveLength(18)
    expect(parsed.counts.outsideDemand).toBe(16)
    expect(parsed.counts.withoutDossier).toBe(15)
    expect(parsed.counts.toInstruct).toBe(1)
    expect(parsed.counts.openQuestionCount).toBe(30)
    expect(parsed.counts.decisionsWithOpenQuestions).toBe(1)
  })

  it('strict mode refuses with the frozen lot-0 output, byte for byte (T1-b)', () => {
    const repo = join(scratch, 'strict-repo')
    mkdirSync(repo, { recursive: true })
    copyLegacyFixture(repo)
    const expectedStderr = readFileSync(STRICT_REFUSAL_FIXTURE_FILE, 'utf8')

    const res = cli(repo, [
      'report',
      '--owner-table',
      '--strict',
      '--format',
      'md',
      '--now',
      LEGACY_LIKE_NOW,
      '--commit',
      LEGACY_LIKE_COMMIT,
    ])
    expect(res.code).toBe(1)
    expect(res.out).toBe('')
    expect(res.err).toBe(expectedStderr)
  })

  it('a journal with no demand and no decision renders its header and the partial-scope sentence with exit 0, and refuses no-owner-demands under strict (T1-c)', () => {
    const repo = join(scratch, 'empty-repo')
    mkdirSync(repo, { recursive: true })
    expect(cli(repo, ['init']).code).toBe(0)

    const defRes = cli(repo, ['report', '--owner-table', '--format', 'md', '--now', LEGACY_LIKE_NOW, '--commit', 'c1'])
    expect(defRes.code, defRes.err).toBe(0)
    expect(defRes.out).toContain('Journal : empty-repo · dossier · aucun événement')
    expect(defRes.out).toContain('0 demande enregistrée')
    expect(defRes.out).toContain(
      'Aucune décision enregistrée au journal (périmètre partiel : captation inactive · politique de termes privés absente).',
    )
    expect(defRes.out).not.toContain(RESERVED_PHRASE)
    expect(defRes.out).not.toContain(RESERVED_REPLY)

    const strictRes = cli(repo, [
      'report',
      '--owner-table',
      '--strict',
      '--format',
      'md',
      '--now',
      LEGACY_LIKE_NOW,
      '--commit',
      'c1',
    ])
    expect(strictRes.code).toBe(1)
    expect(strictRes.err).toContain('[no-owner-demands]')

    // --strict is accepted only together with --owner-table
    const badStrict = cli(repo, ['report', '--strict', '--format', 'md'])
    expect(badStrict.code).toBe(1)
    expect(badStrict.err).toContain('--strict is only valid with --owner-table')
  })

  it('a pending or deferred decision without options is listed to instruct, without number or letters, outside the reply line (T1-d)', () => {
    for (const outcome of ['pending', 'deferred'] as const) {
      const repo = join(scratch, `e5-${outcome}`)
      mkdirSync(repo, { recursive: true })
      const store = new EventStore(join(repo, '.track', 'events.jsonl'))
      const clock = '2026-11-10T10:00:00.000Z'
      const track = new Track(store, { by: 'test', now: () => clock })
      const d1 = track.raiseDemand({
        type: 'feature',
        workspace: 'ws',
        raw: { text: 'Demande active' },
        source: { kind: 'human' },
      })
      track.numberDemand(d1, 1)
      const legacyDecId = '01K0E5TESTDECISION00000001'
      store.appendCommand([
        {
          id: '01K0E5TESTEVENT00000000001',
          type: 'decision.created',
          aggregate: 'decision',
          aggregateId: legacyDecId,
          at: clock,
          by: 'test',
          payload: {
            decisionKind: 'commitment',
            title: 'Arbitrage sans options',
            workspace: 'ws',
            targets: [d1],
            dossier: { context: 'Pas encore instruit.', options: [], qa: [] },
          },
        },
      ])
      if (outcome === 'deferred') track.setOutcome(legacyDecId, 'deferred')

      const res = cli(repo, ['report', '--owner-table', '--format', 'md', '--now', LEGACY_LIKE_NOW, '--commit', 'c1'])
      expect(res.code, res.err).toBe(0)
      expect(res.out).toContain('à instruire')
      expect(res.out).toContain("pas d'options enregistrées")
      if (outcome === 'deferred') {
        expect(res.out).toContain('reportée, attend depuis 10 jours')
      } else {
        expect(res.out).toContain('attend depuis 10 jours')
      }
      expect(res.out).not.toMatch(/\bD1\b/u)
      expect(res.out).not.toContain('Réponse :')

      const jsonRes = cli(repo, [
        'report',
        '--owner-table',
        '--format',
        'json',
        '--now',
        LEGACY_LIKE_NOW,
        '--commit',
        'c1',
      ])
      expect(jsonRes.code, jsonRes.err).toBe(0)
      const parsed = JSON.parse(jsonRes.out)
      expect(parsed.decisions[0].ref).toBeNull()
      expect(parsed.decisions[0].qualifiers).toContain('à instruire')
      expect(parsed.replyLine).toBeNull()
    }
  })

  it('an OWNER GATE on an otherwise valid targeted demand keeps its blocking cause, renders without a number or reply entry, and passes strict mode (T1-e)', () => {
    const repo = join(scratch, 'owner-gate-repo')
    mkdirSync(repo, { recursive: true })
    const store = new EventStore(join(repo, '.track', 'events.jsonl'))
    const clock = '2026-11-18T10:00:00.000Z'
    const track = new Track(store, { by: 'test', now: () => clock })

    // Demand #1: single demand blocked by a named-session pending OWNER GATE + an ordinary numbered decision
    const d1 = track.raiseDemand({
      type: 'feature',
      workspace: 'ws',
      raw: { text: 'Valider le passage en production' },
      source: { kind: 'human' },
    })
    track.numberDemand(d1, 1)
    track.claimDemand(d1, {})
    const [item1] = track.agreeDemand(d1, {
      items: [{ title: 'Mise en prod', links: [{ kind: 'spec', locator: 'docs/s1.md' }] }],
    })
    track.setRealization(item1!, 'in-progress')

    const namedGateId = track.createDecision({
      decisionKind: 'commitment',
      title: 'OWNER GATE og-1 — confirmer la fenêtre de déploiement',
      workspace: 'ws',
      targets: [item1!],
      dossier: {
        context: 'Target Instance And Session: prod-deploy-1\nDemande de confirmation.',
        qa: [],
        options: [
          { id: 'go', title: 'Confirmer', summary: 'Déploie maintenant' },
          { id: 'hold', title: 'Attendre', summary: 'Reporte' },
        ],
        recommendation: { optionId: 'go', rationale: 'Fenêtre ouverte' },
      },
    })
    track.openBlocker({ targetId: item1!, kind: 'decision', ref: namedGateId, reason: 'Attente owner gate' })

    const ordinaryDecId = track.createDecision({
      decisionKind: 'orientation',
      title: 'Quel canal de notification retenir ?',
      workspace: 'ws',
      targets: [item1!],
      dossier: {
        context: 'Choix du canal.',
        qa: [],
        options: [
          { id: 'a', title: 'Direct', summary: 'Simple' },
          { id: 'b', title: 'Différé', summary: 'Batch' },
        ],
        recommendation: { optionId: 'a', rationale: 'Immédiat' },
        artifacts: [{ kind: 'rendered-view', viewRef: 'docs/dossiers/canal.md' }],
      },
    })

    // Demand #2: unnamed-session deferred OWNER GATE + second gate (multiple gates on one row)
    const d2 = track.raiseDemand({
      type: 'feature',
      workspace: 'ws',
      raw: { text: 'Autoriser la migration de schéma' },
      source: { kind: 'human' },
    })
    track.numberDemand(d2, 2)
    track.claimDemand(d2, {})
    const [item2] = track.agreeDemand(d2, {
      items: [{ title: 'Migration', links: [{ kind: 'spec', locator: 'docs/s2.md' }] }],
    })
    track.setRealization(item2!, 'in-progress')
    const unnamedGateId = track.createDecision({
      decisionKind: 'commitment',
      title: 'OWNER GATE og-2 — valider la migration',
      workspace: 'ws',
      targets: [item2!],
      dossier: {
        context: 'Aucune ligne de session ici.',
        qa: [],
        options: [
          { id: 'a', title: 'Oui', summary: 'Lance' },
          { id: 'b', title: 'Non', summary: 'Annule' },
        ],
        recommendation: { optionId: 'a', rationale: 'Prêt' },
      },
    })
    track.setOutcome(unnamedGateId, 'deferred')
    track.openBlocker({ targetId: item2!, kind: 'decision', ref: unnamedGateId, reason: 'Gate non nommée' })

    const secondGateId = track.createDecision({
      decisionKind: 'commitment',
      title: 'OWNER GATE og-3 — second contrôle',
      workspace: 'ws',
      targets: [item2!],
      dossier: {
        context: 'target instance and session: db-admin-2',
        qa: [],
        options: [
          { id: 'a', title: 'Oui', summary: 'OK' },
          { id: 'b', title: 'Non', summary: 'Stop' },
        ],
        recommendation: { optionId: 'a', rationale: 'OK' },
      },
    })
    track.openBlocker({ targetId: item2!, kind: 'decision', ref: secondGateId, reason: 'Second gate' })

    // Demand #3: multi-lot demand with title-level gate and child lots (one withdrawn with sansObjet gate)
    const d3 = track.raiseDemand({
      type: 'feature',
      workspace: 'ws',
      raw: { text: 'Refonte multi-lots avec gate' },
      source: { kind: 'human' },
    })
    track.numberDemand(d3, 3)
    track.claimDemand(d3, {})
    const [lot1, lot2] = track.agreeDemand(d3, {
      items: [
        { title: 'Socle actif', links: [{ kind: 'spec', locator: 'docs/s3.md' }] },
        { title: 'Volet retiré' },
      ],
    })
    track.setRealization(lot1!, 'in-progress')
    track.setReportStatus(lot1!, { status: 'on-track', facts: 'Spec validée' })
    track.setRealization(lot2!, 'cancelled')
    track.setReportStatus(lot2!, { facts: 'Volet abandonné' })

    const titleGateId = track.createDecision({
      decisionKind: 'commitment',
      title: 'OWNER GATE og-title — cadrage global',
      workspace: 'ws',
      targets: [d3],
      dossier: {
        context: 'Target instance and session: global-sess',
        qa: [],
        options: [
          { id: 'a', title: 'Oui', summary: 'Valide' },
          { id: 'b', title: 'Non', summary: 'Bloque' },
        ],
        recommendation: { optionId: 'a', rationale: 'Prêt' },
      },
    })

    const withdrawnGateId = track.createDecision({
      decisionKind: 'commitment',
      title: 'OWNER GATE og-withdrawn — ancien lot',
      workspace: 'ws',
      targets: [lot2!],
      dossier: {
        context: 'Target instance and session: old-sess',
        qa: [],
        options: [
          { id: 'a', title: 'Oui', summary: 'OK' },
          { id: 'b', title: 'Non', summary: 'Non' },
        ],
        recommendation: { optionId: 'a', rationale: 'OK' },
      },
    })

    // Strict mode MUST pass with rc=0 on clean OWNER GATEs + valid ordinary decision!
    const strictMd = cli(repo, [
      'report',
      '--owner-table',
      '--strict',
      '--format',
      'md',
      '--now',
      LEGACY_LIKE_NOW,
      '--commit',
      'c1',
    ])
    expect(strictMd.code, strictMd.err).toBe(0)
    // Ordinary decision keeps D1 (never shifted by preceding gates)
    expect(strictMd.out).toContain('D1')
    expect(strictMd.out).not.toMatch(/\bD2\b/u)
    expect(strictMd.out).toContain('`Réponse : D1 A`')
    expect(strictMd.out).toContain('bloqué par OWNER GATE (session prod-deploy-1) ; bloqué par D1 (owner)')
    expect(strictMd.out).toContain(
      'bloqué par OWNER GATE (session requise non nommée) ; bloqué par OWNER GATE (session db-admin-2)',
    )
    expect(strictMd.out).toContain('OWNER GATE · 🚩 D1 bloquante')
    expect(strictMd.out).toContain('OWNER GATE · OWNER GATE')
    expect(strictMd.out).toContain('- OWNER GATE · à répondre dans la session prod-deploy-1 · attend depuis 2 jours')
    expect(strictMd.out).toContain(
      "- OWNER GATE · à répondre dans la session requise (non nommée dans l'enregistrement) · reportée, attend depuis 2 jours",
    )

    const strictJson = cli(repo, [
      'report',
      '--owner-table',
      '--strict',
      '--format',
      'json',
      '--now',
      LEGACY_LIKE_NOW,
      '--commit',
      'c1',
    ])
    expect(strictJson.code, strictJson.err).toBe(0)
    const parsed = JSON.parse(strictJson.out)
    const row1 = parsed.rows.find((r: { num: number }) => r.num === 1)
    expect(row1.status).toBe('blocked')
    expect(row1.decisionIds).toEqual([namedGateId, ordinaryDecId])
    expect(row1.blockingDecisionIds).toEqual([namedGateId, ordinaryDecId])
    const row2 = parsed.rows.find((r: { num: number }) => r.num === 2)
    expect(row2.decisionIds).toEqual([unnamedGateId, secondGateId])
    expect(row2.blockingDecisionIds).toEqual([unnamedGateId, secondGateId])
    const titleRow = parsed.rows.find((r: { id: string }) => r.id === d3)
    expect(titleRow.todo).toBe('—')
    expect(titleRow.decisionIds).toEqual([titleGateId])
    expect(titleRow.blockingDecisionIds).toEqual([titleGateId])
    const lot2Row = parsed.rows.find((r: { id: string }) => r.id === lot2)
    expect(lot2Row.sansObjetDecisionIds).toEqual([withdrawnGateId])

    const gateEntries = parsed.decisions.filter((d: { kind: string }) => d.kind === 'owner-gate')
    expect(gateEntries).toHaveLength(5)
    for (const g of gateEntries) {
      expect(g.ref).toBeNull()
    }
    const ordEntry = parsed.decisions.find((d: { id: string }) => d.id === ordinaryDecId)
    expect(ordEntry.ref).toBe('D1')

    // A separate unrelated gap on the targeted row must STILL refuse under --strict (no blanket exemption)
    track.setReportStatus(item1!, { facts: 'Révision 483a5f356 vérifiée' })
    const strictWithGap = cli(repo, [
      'report',
      '--owner-table',
      '--strict',
      '--format',
      'md',
      '--now',
      LEGACY_LIKE_NOW,
      '--commit',
      'c1',
    ])
    expect(strictWithGap.code).toBe(1)
    expect(strictWithGap.err).toContain('[internal-jargon]')
  })

  it('an integrity finding refuses in every mode; a desynchronisation finding alone renders and is counted, and refuses under strict (T1-f)', () => {
    const setupValidRepo = (name: string): string => {
      const repo = join(scratch, name)
      mkdirSync(repo, { recursive: true })
      const store = new EventStore(join(repo, '.track', 'events.jsonl'))
      const track = new Track(store, { by: 'test', now: () => '2026-11-18T10:00:00.000Z' })
      const d1 = track.raiseDemand({
        type: 'feature',
        workspace: 'ws',
        raw: { text: 'Demande valide' },
        source: { kind: 'human' },
      })
      track.numberDemand(d1, 1)
      return repo
    }

    // (1) head.json disagrees with stream
    const headRepo = setupValidRepo('integrity-head')
    writeFileSync(
      join(headRepo, '.track', 'head.json'),
      JSON.stringify({ streamLength: 2, lastContentHash: `sha256:${'0'.repeat(64)}` }),
      'utf8',
    )
    for (const extra of [[], ['--strict']]) {
      const res = cli(headRepo, ['report', '--owner-table', ...extra, '--format', 'md', '--now', LEGACY_LIKE_NOW, '--commit', 'c1'])
      expect(res.code).toBe(1)
      expect(res.err).toContain('[journal-integrity]')
    }

    // (2) event whose content no longer matches its hash
    const hashRepo = setupValidRepo('integrity-hash')
    const eventsFile = join(hashRepo, '.track', 'events.jsonl')
    const tampered = readFileSync(eventsFile, 'utf8').replace('Demande valide', 'Demande altérée')
    writeFileSync(eventsFile, tampered, 'utf8')
    for (const extra of [[], ['--strict']]) {
      const res = cli(hashRepo, ['report', '--owner-table', ...extra, '--format', 'md', '--now', LEGACY_LIKE_NOW, '--commit', 'c1'])
      expect(res.code).toBe(1)
      expect(res.err).toContain('[journal-integrity]')
    }

    // (3) unparsable line
    const parseRepo = setupValidRepo('integrity-parse')
    writeFileSync(join(parseRepo, '.track', 'events.jsonl'), '{not json\n', 'utf8')
    for (const extra of [[], ['--strict']]) {
      const res = cli(parseRepo, ['report', '--owner-table', ...extra, '--format', 'md', '--now', LEGACY_LIKE_NOW, '--commit', 'c1'])
      expect(res.code).toBe(1)
      expect(res.err).toContain('[journal-integrity]')
    }

    // (4) desynchronisation finding alone: renders with exit 0 in default mode and counts it; refuses under --strict
    const desyncRepo = setupValidRepo('desync-only')
    const desyncTrack = new Track(new EventStore(join(desyncRepo, '.track', 'events.jsonl')), {
      by: 'test',
      now: () => '2026-11-18T10:00:00.000Z',
    })
    desyncTrack.createItem({
      kind: 'chore',
      title: 'Doc manquante',
      workspace: 'ws',
      body: 'docs/specs/missing-doc.md',
    })
    const defRes = cli(desyncRepo, ['report', '--owner-table', '--format', 'md', '--now', LEGACY_LIKE_NOW, '--commit', 'c1'])
    expect(defRes.code, defRes.err).toBe(0)
    expect(defRes.out).toContain('1 document désynchronisé')

    const strictRes = cli(desyncRepo, [
      'report',
      '--owner-table',
      '--strict',
      '--format',
      'md',
      '--now',
      LEGACY_LIKE_NOW,
      '--commit',
      'c1',
    ])
    expect(strictRes.code).toBe(1)
    expect(strictRes.err).toContain('[document-desync]')
  })

  it('a masked cell never shows the offending text and no text is rewritten (T1-h)', () => {
    const repo = join(scratch, 'masked-repo')
    mkdirSync(join(repo, '.track'), { recursive: true })
    const store = new EventStore(join(repo, '.track', 'events.jsonl'))
    const track = new Track(store, { by: 'test', now: () => '2026-11-18T10:00:00.000Z' })

    const salt = 'mask-salt'
    const secretTerm = 'clientconfidentiel'
    const secretHash = createHash('sha256').update(`${salt}:${secretTerm}`, 'utf8').digest('hex')
    writeFileSync(
      join(repo, '.track', 'owner-report-policy.json'),
      JSON.stringify({ salt, privateTermHashes: [secretHash] }),
      'utf8',
    )

    const d1 = track.raiseDemand({
      type: 'feature',
      workspace: 'ws',
      raw: { text: 'Livrer 483a5f356 sans casser' },
      source: { kind: 'human' },
    })
    track.numberDemand(d1, 1)
    track.claimDemand(d1, {})
    const [it1] = track.agreeDemand(d1, {
      items: [{ title: 'Lot 1', links: [{ kind: 'spec', locator: 'docs/s.md' }] }],
    })
    track.setRealization(it1!, 'in-progress')
    track.setReportStatus(it1!, {
      status: 'on-track',
      facts: 'Suivi 01JTEST0000000000000000001 validé',
      nextAction: `Vérifier ${secretTerm} sur worktree`,
    })

    // Unnumbered item with jargon
    const unnum = track.createItem({ kind: 'feature', title: 'Item', workspace: 'ws' })
    track.setReportStatus(unnum, { status: 'not-started', ownerRequest: 'Nettoyer le worktree local' })

    // Clean demand whose text must never be rewritten
    const d2 = track.raiseDemand({
      type: 'feature',
      workspace: 'ws',
      raw: { text: 'Texte exact conservé tel quel' },
      source: { kind: 'human' },
    })
    track.numberDemand(d2, 2)

    const res = cli(repo, ['report', '--owner-table', '--format', 'md', '--now', LEGACY_LIKE_NOW, '--commit', 'c1'])
    expect(res.code, res.err).toBe(0)
    expect(res.out).toContain('texte masqué (empreinte de commit), à réécrire')
    expect(res.out).toContain('texte masqué (identifiant interne), à réécrire')
    expect(res.out).toContain('texte masqué (jargon interne), à réécrire')
    expect(res.out).toContain('texte masqué (terme réservé), à réécrire')
    expect(res.out).not.toContain('483a5f356')
    expect(res.out).not.toContain('01JTEST0000000000000000001')
    expect(res.out).not.toContain(secretTerm)
    expect(res.out).not.toContain('worktree')
    expect(res.out).toContain('Texte exact conservé tel quel (non capté)')
  })

  it('a journal whose demands are all archived renders zero active demand and the archived count (T1-i)', () => {
    const repo = join(scratch, 'all-archived-repo')
    mkdirSync(repo, { recursive: true })
    const store = new EventStore(join(repo, '.track', 'events.jsonl'))
    const track = new Track(store, { by: 'test', now: () => '2026-11-18T10:00:00.000Z' })
    for (let n = 1; n <= 2; n++) {
      const d = track.raiseDemand({
        type: 'feature',
        workspace: 'ws',
        raw: { text: `Demande archivée ${n}` },
        source: { kind: 'human' },
      })
      track.numberDemand(d, n)
      const dec = track.createDecision({
        decisionKind: 'commitment',
        title: `Archiver ${n} ?`,
        workspace: 'ws',
        targets: [d],
        dossier: {
          context: 'Clôture.',
          qa: [],
          options: [
            { id: 'y', title: 'Oui', summary: 'Archiver' },
            { id: 'n', title: 'Non', summary: 'Garder' },
          ],
          recommendation: { optionId: 'y', rationale: 'Fait' },
          artifacts: [{ kind: 'rendered-view', viewRef: `docs/a${n}.md` }],
        },
      })
      track.selectDecisionOption(dec, 'y', 'go')
      track.archiveDemand(d, { decisionId: dec, reason: 'Archivée' })
    }

    const res = cli(repo, ['report', '--owner-table', '--format', 'md', '--now', LEGACY_LIKE_NOW, '--commit', 'c1'])
    expect(res.code, res.err).toBe(0)
    expect(res.out).toContain('0 demande active, 2 archivées')
    expect(res.out).not.toContain(RESERVED_PHRASE)
    expect(res.out).not.toContain(RESERVED_REPLY)
  })

  it('the reserved absolute sentences are emitted by no mode on any fixture (T1-j)', () => {
    // (1) Clean numbered demand with 0 decisions — today this prints BOTH reserved sentences!
    const cleanRepo = join(scratch, 'sweep-clean')
    mkdirSync(cleanRepo, { recursive: true })
    const cleanTrack = new Track(new EventStore(join(cleanRepo, '.track', 'events.jsonl')), {
      by: 'test',
      now: () => '2026-11-18T10:00:00.000Z',
    })
    const d1 = cleanTrack.raiseDemand({
      type: 'feature',
      workspace: 'ws',
      raw: { text: 'Demande propre sans décision' },
      source: { kind: 'human' },
    })
    cleanTrack.numberDemand(d1, 1)

    // (2) Legacy-like fixture
    const legacyRepo = join(scratch, 'sweep-legacy')
    mkdirSync(legacyRepo, { recursive: true })
    copyLegacyFixture(legacyRepo)

    // (3) Empty journal
    const emptyRepo = join(scratch, 'sweep-empty')
    mkdirSync(emptyRepo, { recursive: true })
    cli(emptyRepo, ['init'])

    for (const repo of [cleanRepo, legacyRepo, emptyRepo]) {
      for (const mode of [[], ['--strict']]) {
        for (const format of ['md', 'text', 'json']) {
          const res = cli(repo, [
            'report',
            '--owner-table',
            ...mode,
            '--format',
            format,
            '--now',
            LEGACY_LIKE_NOW,
            '--commit',
            'c1',
          ])
          const combined = res.out + res.err
          expect(combined, `${repo} ${mode.join(' ')} ${format}`).not.toContain(RESERVED_PHRASE)
          expect(combined, `${repo} ${mode.join(' ')} ${format}`).not.toContain(RESERVED_REPLY)
        }
      }
    }

    // Also check direct renderOwnerTable on clean view
    const directView = makeCleanNumberedView()
    for (const format of ['md', 'text', 'json'] as const) {
      const rendered = renderOwnerTable(directView, format)
      expect(rendered).not.toContain(RESERVED_PHRASE)
      expect(rendered).not.toContain(RESERVED_REPLY)
    }
  })

  it('document references are resolved against the journal folder, not the current directory (T1-k)', () => {
    const repoA = join(scratch, 'repo-a')
    const repoB = join(scratch, 'repo-b')
    mkdirSync(join(repoA, 'docs'), { recursive: true })
    mkdirSync(join(repoB, 'docs'), { recursive: true })

    writeFileSync(join(repoA, 'docs', 'spec.md'), '# Spec existante\n', 'utf8')
    // repoB does NOT have docs/spec.md, but DOES have docs/only-in-b.md
    writeFileSync(join(repoB, 'docs', 'only-in-b.md'), '# Seulement dans B\n', 'utf8')

    const track = new Track(new EventStore(join(repoA, '.track', 'events.jsonl')), {
      by: 'test',
      now: () => '2026-11-18T10:00:00.000Z',
    })
    const d1 = track.raiseDemand({
      type: 'feature',
      workspace: 'ws',
      raw: { text: 'Demande avec doc' },
      source: { kind: 'human' },
    })
    track.numberDemand(d1, 1)
    track.createItem({ kind: 'chore', title: 'Spec existante', workspace: 'ws', body: 'docs/spec.md' })

    // Run from repoB targeting repoA/.track: docs/spec.md exists in repoA ⇒ 0 desync!
    const valClean = cli(repoB, ['--track-dir', join(repoA, '.track'), 'validate'])
    expect(valClean.code, valClean.out + valClean.err).toBe(0)
    const repClean = cli(repoB, [
      '--track-dir',
      join(repoA, '.track'),
      'report',
      '--owner-table',
      '--strict',
      '--format',
      'md',
      '--now',
      LEGACY_LIKE_NOW,
      '--commit',
      'c1',
    ])
    expect(repClean.code, repClean.err).toBe(0)
    expect(repClean.out).not.toContain('désynchronisé')

    // Now add an item referencing docs/only-in-b.md (present in cwd repoB, absent from journal folder repoA) ⇒ 1 desync!
    track.createItem({ kind: 'chore', title: 'Seulement dans B', workspace: 'ws', body: 'docs/only-in-b.md' })
    const valDesync = cli(repoB, ['--track-dir', join(repoA, '.track'), 'validate'])
    expect(valDesync.code).toBe(1)
    expect(valDesync.out).toContain('1 desync')

    const repDesync = cli(repoB, [
      '--track-dir',
      join(repoA, '.track'),
      'report',
      '--owner-table',
      '--format',
      'md',
      '--now',
      LEGACY_LIKE_NOW,
      '--commit',
      'c1',
    ])
    expect(repDesync.code, repDesync.err).toBe(0)
    expect(repDesync.out).toContain('1 document désynchronisé')
  })

  it('each header counter equals the number of elements it names, and overlapping qualifiers are not summed (T1-m)', () => {
    const repo = join(scratch, 'counters-repo')
    mkdirSync(repo, { recursive: true })
    copyLegacyFixture(repo)

    const res = cli(repo, [
      'report',
      '--owner-table',
      '--format',
      'json',
      '--now',
      LEGACY_LIKE_NOW,
      '--commit',
      LEGACY_LIKE_COMMIT,
    ])
    expect(res.code, res.err).toBe(0)
    const parsed = JSON.parse(res.out)

    expect(parsed.counts.toAttach).toBe(parsed.toAttach.length)
    expect(parsed.counts.rowsToComplete).toBe(
      parsed.rows.filter((r: { flags: unknown[] }) => r.flags.length > 0).length,
    )
    const decisionsWithQualifiers = parsed.decisions.filter(
      (d: { kind: string; qualifiers: string[] }) => d.kind !== 'owner-gate' && d.qualifiers.length > 0,
    )
    const decisionsPendingClean = parsed.decisions.filter(
      (d: { kind: string; qualifiers: string[] }) => d.kind !== 'owner-gate' && d.qualifiers.length === 0,
    )
    // Overlapping qualifiers (16 hors demande + 15 sans dossier + 1 à instruire = 32) must NOT be summed:
    // decisionsToComplete must equal the exact number of decisions carrying >= 1 qualifier (18).
    expect(parsed.counts.decisionsToComplete).toBe(decisionsWithQualifiers.length)
    expect(parsed.counts.decisionsToComplete).toBe(18)
    expect(parsed.counts.decisionsPending).toBe(decisionsPendingClean.length)
    expect(parsed.counts.ownerGates).toBe(
      parsed.decisions.filter((d: { kind: string }) => d.kind === 'owner-gate').length,
    )
    expect(parsed.counts.openQuestionCount).toBe(
      parsed.decisions.reduce((sum: number, d: { openQuestionCount: number }) => sum + d.openQuestionCount, 0),
    )
  })

  it('a vanished number, a number from 1 up held twice or a hole below the highest number refuses in every mode, and rows without a number never trip that gate (T1-n)', () => {
    // (1) Vanished registered number (registered [1, 2], only row #1 present, #2 not archived)
    const vanished = makeCleanNumberedView()
    vanished.registeredNumbers = [1, 2]
    expect(() => buildQualifiedOwnerTable(vanished, { now: LEGACY_LIKE_NOW })).toThrow(/REFUSED:/)

    // (2) Duplicate number >= 1
    const dup = makeCleanNumberedView()
    dup.rows.push({ ...dup.rows[0]!, id: 'req-clean-dup' })
    expect(() => buildQualifiedOwnerTable(dup, { now: LEGACY_LIKE_NOW })).toThrow(/REFUSED:/)

    // (3) Hole below highest number (rows #1 and #3, #2 missing and not archived)
    const hole = makeCleanNumberedView()
    hole.registeredNumbers = [1, 3]
    hole.rows.push({ ...hole.rows[0]!, id: 'req-clean-3', num: 3 })
    expect(() => buildQualifiedOwnerTable(hole, { now: LEGACY_LIKE_NOW })).toThrow(/REFUSED:/)

    // (4) The 13 unnumbered rows (num === 0) in legacy-like-journal never trip G2 and render with exit 0
    const repo = join(scratch, 'unnumbered-ok')
    mkdirSync(repo, { recursive: true })
    copyLegacyFixture(repo)
    const events = new EventStore(join(repo, '.track', 'events.jsonl')).readAll()
    const legacyView = projectOwnerTable(fold(events), events, {
      baselineCommit: LEGACY_LIKE_COMMIT,
      now: LEGACY_LIKE_NOW,
    })
    const qualified = buildQualifiedOwnerTable(legacyView, { now: LEGACY_LIKE_NOW })
    expect(qualified.rows).toHaveLength(14)
    expect(qualified.toAttach).toHaveLength(13)
  })

  it('a row that would show done or on-track without its witness refuses in every mode (T1-o)', () => {
    const doneNoWitness = makeCleanNumberedView()
    doneNoWitness.rows[0] = { ...doneNoWitness.rows[0]!, status: 'done', stage: 'done', etas: [], hasWitness: false }
    expect(() => buildQualifiedOwnerTable(doneNoWitness, { now: LEGACY_LIKE_NOW })).toThrow(/REFUSED:/)

    const doneWrongStage = makeCleanNumberedView()
    doneWrongStage.rows[0] = { ...doneWrongStage.rows[0]!, status: 'done', stage: 'merged', etas: [], hasWitness: true }
    expect(() => buildQualifiedOwnerTable(doneWrongStage, { now: LEGACY_LIKE_NOW })).toThrow(/REFUSED:/)

    const onTrackNoWitness = makeCleanNumberedView()
    onTrackNoWitness.rows[0] = { ...onTrackNoWitness.rows[0]!, status: 'on-track', hasWitness: false }
    expect(() => buildQualifiedOwnerTable(onTrackNoWitness, { now: LEGACY_LIKE_NOW })).toThrow(/REFUSED:/)
  })

  it('rendering leaves the journal folder byte-identical and creates no file anywhere (T1-p)', () => {
    const repo = join(scratch, 'readonly-repo')
    mkdirSync(repo, { recursive: true })
    copyLegacyFixture(repo)

    const beforeScratch = fingerprintTree(scratch)
    const resolved = resolveJournalOfReference({ cwd: repo })
    expect(resolved.trackDir).toBe(join(repo, '.track'))

    for (const mode of [[], ['--strict']]) {
      for (const format of ['md', 'text', 'json']) {
        cli(repo, ['report', '--owner-table', ...mode, '--format', format, '--now', LEGACY_LIKE_NOW, '--commit', 'c1'])
      }
    }
    expect(fingerprintTree(scratch)).toBe(beforeScratch)
  })

  it('Markdown, text and strict diagnostics print no decision identifier, including OWNER GATE, and JSON carries it (T1-q)', () => {
    const repo = join(scratch, 'ids-repo')
    mkdirSync(repo, { recursive: true })
    const store = new EventStore(join(repo, '.track', 'events.jsonl'))
    const track = new Track(store, { by: 'test', now: () => '2026-11-18T10:00:00.000Z' })

    const d1 = track.raiseDemand({
      type: 'feature',
      workspace: 'ws',
      raw: { text: 'Demande avec gate et expectation' },
      source: { kind: 'human' },
    })
    track.numberDemand(d1, 1)
    track.claimDemand(d1, {})
    const [item1] = track.agreeDemand(d1, {
      items: [{ title: 'Lot gate', links: [{ kind: 'spec', locator: 'docs/s1.md' }] }],
    })
    track.setRealization(item1!, 'in-progress')

    const gateId = track.createDecision({
      decisionKind: 'commitment',
      title: 'OWNER GATE og-id — confirmer',
      workspace: 'ws',
      targets: [item1!],
      dossier: {
        context: 'Target instance and session: sess-q',
        qa: [],
        options: [
          { id: 'a', title: 'Oui', summary: 'OK' },
          { id: 'b', title: 'Non', summary: 'Stop' },
        ],
        recommendation: { optionId: 'a', rationale: 'OK' },
      },
    })
    track.openBlocker({ targetId: item1!, kind: 'decision', ref: gateId, reason: 'Attente' })

    const decId = track.createDecision({
      decisionKind: 'orientation',
      title: 'Décision ordinaire sans dossier ?',
      workspace: 'ws',
      targets: [item1!],
      dossier: {
        context: 'Choix.',
        qa: [],
        options: [
          { id: 'a', title: 'A', summary: 'A' },
          { id: 'b', title: 'B', summary: 'B' },
        ],
        recommendation: { optionId: 'a', rationale: 'A' },
      },
    })

    // Demand #2 with synthetic :expectation decision (not in state.decisions)
    const d2 = track.raiseDemand({
      type: 'feature',
      workspace: 'ws',
      raw: { text: 'Demande avec expectation synthétique' },
      source: { kind: 'human' },
    })
    track.numberDemand(d2, 2)
    track.claimDemand(d2, {})
    const [item2] = track.agreeDemand(d2, {
      items: [{ title: 'Lot expectation', links: [{ kind: 'spec', locator: 'docs/s2.md' }] }],
    })
    track.setReportStatus(item2!, {
      status: 'not-started',
      decisionExpectations: {
        question: 'Valider la variante synthétique ?',
        dossier: 'docs/dossiers/synth.md',
        readingMinutes: 2,
        options: [
          { label: 'Option 1', consequence: 'Conséquence 1' },
          { label: 'Option 2', consequence: 'Conséquence 2' },
        ],
      },
    })
    const syntheticId = `${d2}:expectation`

    for (const format of ['md', 'text']) {
      const res = cli(repo, ['report', '--owner-table', '--format', format, '--now', LEGACY_LIKE_NOW, '--commit', 'c1'])
      expect(res.code, res.err).toBe(0)
      expect(res.out).not.toContain(gateId)
      expect(res.out).not.toContain(decId)
      expect(res.out).not.toContain(syntheticId)
      expect(res.out).not.toContain(':expectation')
    }

    // Strict diagnostics also print no decision identifier, and synthetic expectation keeps its strict findings
    const strictRes = cli(repo, [
      'report',
      '--owner-table',
      '--strict',
      '--format',
      'md',
      '--now',
      LEGACY_LIKE_NOW,
      '--commit',
      'c1',
    ])
    expect(strictRes.code).toBe(1)
    expect(strictRes.err).not.toContain(gateId)
    expect(strictRes.err).not.toContain(decId)
    expect(strictRes.err).not.toContain(syntheticId)
    expect(strictRes.err).toContain('[invalid-decision]')

    // JSON carries every decision id (gate, ordinary, and synthetic :expectation)
    const jsonRes = cli(repo, ['report', '--owner-table', '--format', 'json', '--now', LEGACY_LIKE_NOW, '--commit', 'c1'])
    expect(jsonRes.code, jsonRes.err).toBe(0)
    const parsed = JSON.parse(jsonRes.out)
    const ids = parsed.decisions.map((d: { id: string }) => d.id)
    expect(ids).toContain(gateId)
    expect(ids).toContain(decId)
    expect(ids).toContain(syntheticId)
  })

  it('a text that was not captured is labelled non capté and never quoted (T1-r)', () => {
    const repo = join(scratch, 'uncaptured-repo')
    mkdirSync(repo, { recursive: true })
    const track = new Track(new EventStore(join(repo, '.track', 'events.jsonl')), {
      by: 'test',
      now: () => '2026-11-18T10:00:00.000Z',
    })
    const d1 = track.raiseDemand({
      type: 'feature',
      workspace: 'ws',
      raw: { text: 'Rendre le tableau lisible' },
      source: { kind: 'human' },
    })
    track.numberDemand(d1, 1)
    const unnum = track.createItem({ kind: 'feature', title: 'Sujet', workspace: 'ws' })
    track.setReportStatus(unnum, { status: 'not-started', ownerRequest: 'Demande reconstruite sans numéro' })

    const res = cli(repo, ['report', '--owner-table', '--format', 'md', '--now', LEGACY_LIKE_NOW, '--commit', 'c1'])
    expect(res.code, res.err).toBe(0)
    expect(res.out).toContain('Rendre le tableau lisible (non capté)')
    expect(res.out).not.toContain('« Rendre le tableau lisible »')
    expect(res.out).toContain('- 18/11 · non capté · Demande reconstruite sans numéro')
    expect(res.out).not.toContain('« Demande reconstruite sans numéro »')
  })

  it('every row-level gap is flagged on its own row and cell and counted, and the row stays (T1-t)', () => {
    interface E3Case {
      name: string
      mutate: (view: OwnerTableView) => void
      expectedCell: 'request' | 'done' | 'todo' | 'eta' | 'decision' | 'status' | 'stage'
      expectedFlag: string
    }

    const cases: E3Case[] = [
      {
        name: 'blocked without cause',
        mutate: (v) => {
          v.rows[0] = { ...v.rows[0]!, status: 'blocked', todo: '—' }
        },
        expectedCell: 'todo',
        expectedFlag: 'cause absente',
      },
      {
        name: 'blocking decision without blocked status',
        mutate: (v) => {
          v.decisions = [
            {
              ref: 'D1',
              id: 'dec-1',
              question: 'Choix ?',
              options: [
                { letter: 'A', label: 'A', consequence: 'A' },
                { letter: 'B', label: 'B', consequence: 'B' },
              ],
              recommendedLetter: 'A',
              recommendation: 'Simple',
              dossierLink: 'docs/d.md',
              blocking: true,
            },
          ]
          v.rows[0] = {
            ...v.rows[0]!,
            status: 'on-track',
            decisionRefs: ['D1'],
            blockingDecisionRefs: ['D1'],
            decisionBlocking: true,
            todo: 'bloqué par D1 (owner)',
          }
        },
        expectedCell: 'status',
        expectedFlag: 'étape et statut incohérents',
      },
      {
        name: 'missing ETA',
        mutate: (v) => {
          v.rows[0] = { ...v.rows[0]!, etas: [] }
        },
        expectedCell: 'eta',
        expectedFlag: 'ETA incomplète',
      },
      {
        name: 'missing request text',
        mutate: (v) => {
          v.rows[0] = { ...v.rows[0]!, request: '' }
        },
        expectedCell: 'request',
        expectedFlag: 'texte absent',
      },
      {
        name: 'demand-title with fewer than 2 lots',
        mutate: (v) => {
          const title: OwnerTableRow = {
            kind: 'demand-title',
            num: 1,
            id: 'title-1',
            etas: [],
            request: 'Demande multi-lots',
            done: '—',
            todo: '—',
            decisionRefs: [],
          }
          const lot1: OwnerTableRow = {
            ...v.rows[0]!,
            kind: 'lot',
            parentDemandId: 'title-1',
            id: 'lot-1',
            request: '↳ lot 1 — Unique lot',
          }
          v.rows = [title, lot1]
        },
        expectedCell: 'request',
        expectedFlag: 'moins de deux lots',
      },
      {
        name: 'lot row not formatted as ↳ lot N —',
        mutate: (v) => {
          const title: OwnerTableRow = {
            kind: 'demand-title',
            num: 1,
            id: 'title-1',
            etas: [],
            request: 'Demande multi-lots',
            done: '—',
            todo: '—',
            decisionRefs: [],
          }
          const lot1: OwnerTableRow = {
            ...v.rows[0]!,
            kind: 'lot',
            parentDemandId: 'title-1',
            id: 'lot-1',
            request: 'Mauvais format de lot',
          }
          const lot2: OwnerTableRow = {
            ...v.rows[0]!,
            kind: 'lot',
            parentDemandId: 'title-1',
            id: 'lot-2',
            request: '↳ lot 2 — Deuxième lot',
          }
          v.rows = [title, lot1, lot2]
        },
        expectedCell: 'request',
        expectedFlag: 'structure',
      },
      {
        name: 'demand-title carrying status',
        mutate: (v) => {
          const title: OwnerTableRow = {
            kind: 'demand-title',
            num: 1,
            id: 'title-1',
            status: 'not-started',
            etas: [],
            request: 'Demande multi-lots',
            done: '—',
            todo: '—',
            decisionRefs: [],
          }
          const lot1: OwnerTableRow = {
            ...v.rows[0]!,
            kind: 'lot',
            parentDemandId: 'title-1',
            id: 'lot-1',
            request: '↳ lot 1 — Premier lot',
          }
          const lot2: OwnerTableRow = {
            ...v.rows[0]!,
            kind: 'lot',
            parentDemandId: 'title-1',
            id: 'lot-2',
            request: '↳ lot 2 — Deuxième lot',
          }
          v.rows = [title, lot1, lot2]
        },
        expectedCell: 'status',
        expectedFlag: 'structure',
      },
      {
        name: 'stage done while status is not done',
        mutate: (v) => {
          v.rows[0] = { ...v.rows[0]!, status: 'waiting', stage: 'done' }
        },
        expectedCell: 'stage',
        expectedFlag: 'étape et statut incohérents',
      },
      {
        name: 'withdrawn without reason',
        mutate: (v) => {
          v.rows[0] = { ...v.rows[0]!, status: 'withdrawn', etas: [], done: '—', todo: '—' }
        },
        expectedCell: 'done',
        expectedFlag: 'motif de retrait absent',
      },
      {
        name: 'row pointing to unlisted decision',
        mutate: (v) => {
          v.rows[0] = { ...v.rows[0]!, decisionRefs: ['D9'] }
        },
        expectedCell: 'decision',
        expectedFlag: 'décision absente',
      },
      {
        name: 'rows from 1 up not in ascending order',
        mutate: (v) => {
          v.registeredNumbers = [1, 2]
          v.rows = [
            { ...v.rows[0]!, id: 'req-2', num: 2 },
            { ...v.rows[0]!, id: 'req-1', num: 1 },
          ]
        },
        expectedCell: 'request',
        expectedFlag: 'structure',
      },
    ]

    for (const tc of cases) {
      const view = makeCleanNumberedView()
      tc.mutate(view)
      const q = buildQualifiedOwnerTable(view, { now: LEGACY_LIKE_NOW })
      expect(q.rows.length, tc.name).toBeGreaterThanOrEqual(1)
      expect(q.counts.rowsToComplete, tc.name).toBeGreaterThanOrEqual(1)
      const flaggedRow = q.rows.find((r) => r.flags.some((f) => f.cell === tc.expectedCell && f.motif === tc.expectedFlag))
      expect(flaggedRow, `${tc.name}: expected flag "${tc.expectedFlag}" on cell "${tc.expectedCell}"`).toBeDefined()
      const rendered = renderQualifiedOwnerTable(q, 'md')
      expect(rendered, tc.name).toContain(`⚠ ${tc.expectedFlag}`)
      expect(rendered, tc.name).toContain('ligne à compléter')
    }
  })

  it('renders lot 4a scope/gap motifs (unassigned journal, unverified docs) and sanitized origin labels', () => {
    const view = makeCleanNumberedView()
    const qualified = buildQualifiedOwnerTable(view, {
      now: LEGACY_LIKE_NOW,
      unassignedJournal: true,
      unverifiedDocsCount: 2,
      rowOriginLabels: new Map([['req-clean-1', 'sat-app']]),
      header: {
        label: 'conducteur',
        resolution: 'copie non désignée (2 copies connues)',
        lastEventAt: '2026-11-19T10:00:00.000Z',
      },
    })
    expect(qualified.scope.motifs[0]).toEqual({
      kind: 'scope',
      text: 'journal de référence non désigné',
    })
    expect(qualified.scope.motifs.at(-1)).toEqual({
      kind: 'gap',
      text: '2 documents non vérifiés',
    })
    expect(qualified.counts.unverifiedDocs).toBe(2)
    expect(qualified.rows[0]?.originLabel).toBe('sat-app')

    const md = renderQualifiedOwnerTable(qualified, 'md')
    expect(md).toContain('Journal : conducteur · copie non désignée (2 copies connues) · dernier événement 19/11')
    expect(md).toContain('Périmètre partiel : journal de référence non désigné · captation inactive')
    expect(md).toContain('2 documents non vérifiés')
    expect(md).toContain('[sat-app] Ajouter le filtre par date (non capté)')
    expect(md).toContain(
      'Aucune décision enregistrée au journal (périmètre partiel : journal de référence non désigné · captation inactive · politique de termes privés absente).',
    )

    // Origin label failing a text gate falls back to `journal`
    const sanitized = buildQualifiedOwnerTable(makeCleanNumberedView(), {
      now: LEGACY_LIKE_NOW,
      rowOriginLabels: new Map([['req-clean-1', 'deadbeef1234']]),
    })
    expect(sanitized.rows[0]?.originLabel).toBe('journal')
  })
})
