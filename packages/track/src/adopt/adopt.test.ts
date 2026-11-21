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
import { EventStore } from '../events/store.js'
import {
  LEGACY_LIKE_COMMIT,
  LEGACY_LIKE_FIXTURE_DIR,
  LEGACY_LIKE_NOW,
  LEGACY_LIKE_RESOLVED_PLAN_FILE,
} from '../report/legacy-like-journal.fixture.test.js'
import { Track } from '../track.js'
import { computeAdoptionPlanHash, type AdoptionPlan, type AdoptionPlanEntry } from './plan.js'

let scratch: string
let savedEnv: Record<string, string | undefined>

function isolateEnv(stateHome: string): void {
  savedEnv = {
    TRACK_OWNER_POLICY_FILE: process.env['TRACK_OWNER_POLICY_FILE'],
    TRACK_OWNER_REPORT_POLICY: process.env['TRACK_OWNER_REPORT_POLICY'],
    TRACK_STATE_HOME: process.env['TRACK_STATE_HOME'],
    TRACK_DIR: process.env['TRACK_DIR'],
    TRACK_WRITER_TOKEN: process.env['TRACK_WRITER_TOKEN'],
  }
  delete process.env['TRACK_OWNER_POLICY_FILE']
  delete process.env['TRACK_OWNER_REPORT_POLICY']
  delete process.env['TRACK_DIR']
  delete process.env['TRACK_WRITER_TOKEN']
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

function loadLegacyResolvedPlan(): AdoptionPlan {
  return JSON.parse(readFileSync(LEGACY_LIKE_RESOLVED_PLAN_FILE, 'utf8')) as AdoptionPlan
}

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'track-adopt-'))
  const isolatedState = join(scratch, 'state-home')
  mkdirSync(isolatedState, { recursive: true })
  isolateEnv(isolatedState)
})

afterEach(() => {
  restoreEnv()
  rmSync(scratch, { recursive: true, force: true })
})

describe('track adopt (lot 5a)', () => {
  it('the dry run writes nothing and lists every write it would make (T5a-a)', () => {
    const repo = join(scratch, 'legacy-dry-run')
    mkdirSync(repo, { recursive: true })
    const trackDir = copyLegacyFixture(repo)
    const stateHome = process.env['TRACK_STATE_HOME']!

    const beforeJournal = fingerprintTree(trackDir)
    const beforeState = fingerprintTree(stateHome)

    const res = cli(repo, [
      'adopt',
      'plan',
      '--now',
      LEGACY_LIKE_NOW,
      '--commit',
      LEGACY_LIKE_COMMIT,
    ])
    expect(res.code, res.err).toBe(0)

    const afterJournal = fingerprintTree(trackDir)
    const afterState = fingerprintTree(stateHome)
    expect(afterJournal).toBe(beforeJournal)
    expect(afterState).toBe(beforeState)

    const plan = JSON.parse(res.out) as AdoptionPlan
    expect(plan.version).toBe(1)
    expect(typeof plan.planHash).toBe('string')
    expect(plan.planHash.length).toBeGreaterThan(0)

    const e1 = plan.entries.filter((e) => e.class === 'E1')
    const e4 = plan.entries.filter((e) => e.class === 'E4')
    const e5 = plan.entries.filter((e) => e.class === 'E5')
    const e6 = plan.entries.filter((e) => e.class === 'E6')

    expect(e1).toHaveLength(13)
    expect(e1.every((e) => e.kind === 'mechanical' && e.action === 'reconstruct-demand')).toBe(true)
    expect(e4).toHaveLength(16)
    expect(e4.every((e) => e.kind === 'to-decide' && e.action === 'attach-decision' && typeof e.question === 'string')).toBe(true)
    expect(e5).toHaveLength(1)
    expect(e5.every((e) => e.kind === 'to-decide' && e.action === 'instruct-decision' && typeof e.question === 'string')).toBe(true)
    expect(e6).toHaveLength(15)
    expect(e6.every((e) => e.kind === 'to-decide' && e.action === 'attach-dossier' && typeof e.question === 'string')).toBe(true)

    // --out outside the journal folder writes only that file and leaves journal/state unchanged
    const outFile = join(scratch, 'adoption-plan.json')
    const outRes = cli(repo, [
      'adopt',
      'plan',
      '--out',
      outFile,
      '--now',
      LEGACY_LIKE_NOW,
      '--commit',
      LEGACY_LIKE_COMMIT,
    ])
    expect(outRes.code, outRes.err).toBe(0)
    expect(existsSync(outFile)).toBe(true)
    expect(readFileSync(outFile, 'utf8')).toBe(res.out)
    expect(fingerprintTree(trackDir)).toBe(beforeJournal)
    expect(fingerprintTree(stateHome)).toBe(beforeState)

    // --out inside the journal folder is refused
    const badOut = cli(repo, ['adopt', 'plan', '--out', join(trackDir, 'plan.json')])
    expect(badOut.code).toBe(1)
    expect(fingerprintTree(trackDir)).toBe(beforeJournal)
  })

  it('applying a plan twice writes nothing the second time (T5a-b)', () => {
    const repo = join(scratch, 'idempotent-apply')
    mkdirSync(repo, { recursive: true })
    const trackDir = copyLegacyFixture(repo)

    const first = cli(repo, [
      'adopt',
      'apply',
      LEGACY_LIKE_RESOLVED_PLAN_FILE,
      '--now',
      LEGACY_LIKE_NOW,
      '--commit',
      LEGACY_LIKE_COMMIT,
    ])
    expect(first.code, first.err).toBe(0)
    expect(first.out).toContain(': applied')
    expect(first.out).not.toContain('refused:')

    const afterFirst = fingerprintTree(trackDir)
    const countAfterFirst = new EventStore(join(trackDir, 'events.jsonl')).readAll().length

    const second = cli(repo, [
      'adopt',
      'apply',
      LEGACY_LIKE_RESOLVED_PLAN_FILE,
      '--now',
      LEGACY_LIKE_NOW,
      '--commit',
      LEGACY_LIKE_COMMIT,
    ])
    expect(second.code, second.err).toBe(0)
    expect(second.out).toContain(': already applied')
    expect(second.out).not.toContain(': applied')
    expect(second.out).not.toContain('refused:')

    expect(fingerprintTree(trackDir)).toBe(afterFirst)
    expect(new EventStore(join(trackDir, 'events.jsonl')).readAll().length).toBe(countAfterFirst)
  })

  it('a reconstructed demand is inscribed as not captured and is never quoted (T5a-c)', () => {
    const repo = join(scratch, 'reconstructed-demand')
    mkdirSync(repo, { recursive: true })
    const store = new EventStore(join(repo, '.track', 'events.jsonl'))
    const track = new Track(store, { by: 'test', now: () => '2026-10-20T10:00:00.000Z' })
    const itemId = track.createItem({
      kind: 'feature',
      title: 'Ancienne demande reconstruite',
      workspace: 'ws-adopt',
    })
    track.setReportStatus(itemId, {
      status: 'not-started',
      ownerRequest: 'Exporter les rapports mensuels en CSV',
    })

    const planRes = cli(repo, [
      'adopt',
      'plan',
      '--now',
      LEGACY_LIKE_NOW,
      '--commit',
      LEGACY_LIKE_COMMIT,
    ])
    expect(planRes.code, planRes.err).toBe(0)
    const planFile = join(scratch, 'reconstruct-plan.json')
    writeFileSync(planFile, planRes.out, 'utf8')

    const applyRes = cli(repo, [
      'adopt',
      'apply',
      planFile,
      '--now',
      LEGACY_LIKE_NOW,
      '--commit',
      LEGACY_LIKE_COMMIT,
    ])
    expect(applyRes.code, applyRes.err).toBe(0)

    const events = store.readAll()
    const raised = events.filter((e) => e.type === 'demand.raised')
    expect(raised).toHaveLength(1)
    expect(raised[0]!.prov?.transport).toBe('cli')
    expect((raised[0]!.prov as { transport?: string } | undefined)?.transport).not.toBe('capture')

    const reportRes = cli(repo, [
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
    expect(reportRes.code, reportRes.err).toBe(0)
    expect(reportRes.out).toContain('Exporter les rapports mensuels en CSV (non capté)')
    expect(reportRes.out).not.toContain('« Exporter les rapports mensuels en CSV »')
  })

  it('after a fully resolved plan is applied the legacy-like journal passes the strict table (T5a-d)', () => {
    const repo = join(scratch, 'legacy-strict-after-adopt')
    mkdirSync(repo, { recursive: true })
    copyLegacyFixture(repo)

    const beforeStrict = cli(repo, [
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
    expect(beforeStrict.code).toBe(1)

    const applyRes = cli(repo, [
      'adopt',
      'apply',
      LEGACY_LIKE_RESOLVED_PLAN_FILE,
      '--now',
      LEGACY_LIKE_NOW,
      '--commit',
      LEGACY_LIKE_COMMIT,
    ])
    expect(applyRes.code, applyRes.err).toBe(0)

    const afterStrictMd = cli(repo, [
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
    expect(afterStrictMd.code, afterStrictMd.err).toBe(0)
    expect(afterStrictMd.out).not.toContain('À rattacher')
    expect(afterStrictMd.out).toContain('18 décisions en attente')

    const afterStrictJson = cli(repo, [
      'report',
      '--owner-table',
      '--strict',
      '--format',
      'json',
      '--now',
      LEGACY_LIKE_NOW,
      '--commit',
      LEGACY_LIKE_COMMIT,
    ])
    expect(afterStrictJson.code, afterStrictJson.err).toBe(0)
    const parsed = JSON.parse(afterStrictJson.out)
    expect(parsed.rows).toHaveLength(27)
    expect(parsed.toAttach).toHaveLength(0)
    expect(parsed.counts.outsideDemand).toBe(0)
    expect(parsed.counts.withoutDossier).toBe(0)
    expect(parsed.counts.toInstruct).toBe(0)
    expect(parsed.counts.decisionsPending).toBe(18)
    expect(parsed.gaps).toHaveLength(0)

    const validateRes = cli(repo, ['validate'])
    expect(validateRes.code, validateRes.err).toBe(0)
  })

  it('no decision is settled or archived without a recorded owner answer or a traced replacement (T5a-e)', () => {
    const repo = join(scratch, 'no-settle-unresolved')
    mkdirSync(repo, { recursive: true })
    const trackDir = copyLegacyFixture(repo)
    const eventsPath = join(trackDir, 'events.jsonl')
    const store = new EventStore(eventsPath)
    const settlingBefore = store
      .readAll()
      .filter(
        (e) =>
          e.type === 'decision.outcome' ||
          e.type === 'decision.option-selected' ||
          e.type === 'demand.owner-archived',
      )
      .length

    const partiallyResolved = loadLegacyResolvedPlan()
    const unresolvedTarget = partiallyResolved.entries.find((e) => e.action === 'instruct-decision')!
    expect(unresolvedTarget).toBeDefined()
    unresolvedTarget.resolution = null

    const planFile = join(scratch, 'partial-plan.json')
    writeFileSync(planFile, `${JSON.stringify(partiallyResolved, null, 2)}\n`, 'utf8')

    const applyRes = cli(repo, [
      'adopt',
      'apply',
      planFile,
      '--now',
      LEGACY_LIKE_NOW,
      '--commit',
      LEGACY_LIKE_COMMIT,
    ])
    expect(applyRes.code).toBe(1)
    expect(applyRes.out).toContain(`${unresolvedTarget.id}: refused:`)

    const settlingAfter = store
      .readAll()
      .filter(
        (e) =>
          e.type === 'decision.outcome' ||
          e.type === 'decision.option-selected' ||
          e.type === 'demand.owner-archived',
      )
      .length
    expect(settlingAfter).toBe(settlingBefore)

    // Hand-crafted settling action is unknown to the tool, refused by name, and writes no settling event
    const fakeEntry = {
      id: 'FORBIDDEN:settle-decision:fake',
      class: 'E4',
      kind: 'to-decide',
      action: 'settle-decision',
      element: { kind: 'decision', id: unresolvedTarget.element.id },
      proposedWrite: { outcome: 'go' },
      resolution: { outcome: 'go' },
    } as unknown as AdoptionPlanEntry
    const fakePlan: AdoptionPlan = {
      version: 1,
      planHash: computeAdoptionPlanHash([fakeEntry]),
      baseline: partiallyResolved.baseline,
      counts: { total: 1, mechanical: 0, toDecide: 1, unresolved: 0 },
      entries: [fakeEntry],
    }
    const fakePlanFile = join(scratch, 'forbidden-action.json')
    writeFileSync(fakePlanFile, `${JSON.stringify(fakePlan, null, 2)}\n`, 'utf8')
    const fakeRes = cli(repo, [
      'adopt',
      'apply',
      fakePlanFile,
      '--now',
      LEGACY_LIKE_NOW,
      '--commit',
      LEGACY_LIKE_COMMIT,
    ])
    expect(fakeRes.code).toBe(1)
    expect(fakeRes.out).toContain('FORBIDDEN:settle-decision:fake: refused:')
    expect(
      store
        .readAll()
        .filter(
          (e) =>
            e.type === 'decision.outcome' ||
            e.type === 'decision.option-selected' ||
            e.type === 'demand.owner-archived',
        ).length,
    ).toBe(settlingBefore)
  })

  it('refuses a stale plan when the journal changed since the dry run', () => {
    const repo = join(scratch, 'stale-plan')
    mkdirSync(repo, { recursive: true })
    const store = new EventStore(join(repo, '.track', 'events.jsonl'))
    const track = new Track(store, { by: 'test', now: () => '2026-11-10T10:00:00.000Z' })
    const d1 = track.raiseDemand({
      type: 'feature',
      workspace: 'ws',
      raw: { text: 'Demande sans numéro' },
      source: { kind: 'human' },
    })

    const planRes = cli(repo, ['adopt', 'plan', '--now', LEGACY_LIKE_NOW, '--commit', 'c1'])
    expect(planRes.code, planRes.err).toBe(0)
    const planFile = join(scratch, 'stale.json')
    writeFileSync(planFile, planRes.out, 'utf8')

    // Mutate the journal out of band
    track.createItem({ kind: 'chore', title: 'Changement externe', workspace: 'ws' })
    const countBefore = store.readAll().length

    const applyRes = cli(repo, ['adopt', 'apply', planFile, '--now', LEGACY_LIKE_NOW, '--commit', 'c1'])
    expect(applyRes.code).toBe(1)
    expect(applyRes.err).toContain('no longer matches')
    expect(store.readAll().length).toBe(countBefore)
    expect(track.state().demands.get(d1)?.ownerNumber).toBeUndefined()
  })

  it('refuses application on an exclusive journal unless the holder presents its token', () => {
    const repo = join(scratch, 'exclusive-journal')
    mkdirSync(repo, { recursive: true })
    const trackDir = join(repo, '.track')
    const store = new EventStore(join(trackDir, 'events.jsonl'))
    const track = new Track(store, { by: 'test', now: () => '2026-11-10T10:00:00.000Z' })
    track.raiseDemand({
      type: 'feature',
      workspace: 'ws',
      raw: { text: 'Demande sur journal exclusif' },
      source: { kind: 'human' },
    })

    const secretToken = 'holder-secret-token-42'
    const tokenHash = createHash('sha256').update(secretToken, 'utf8').digest('hex')
    writeFileSync(
      join(trackDir, 'write-policy.json'),
      JSON.stringify({ mode: 'exclusive', holder: 'cond-main', epoch: 1, tokenHash }),
      'utf8',
    )

    const planRes = cli(repo, ['adopt', 'plan', '--now', LEGACY_LIKE_NOW, '--commit', 'c1'])
    expect(planRes.code, planRes.err).toBe(0)
    const planFile = join(scratch, 'exclusive-plan.json')
    writeFileSync(planFile, planRes.out, 'utf8')
    const countBefore = store.readAll().length

    // Without token: refused
    const refused = cli(repo, ['adopt', 'apply', planFile, '--now', LEGACY_LIKE_NOW, '--commit', 'c1'])
    expect(refused.code).toBe(1)
    expect(refused.err).toContain('exclusive')
    expect(refused.err).toContain('cond-main')
    expect(store.readAll().length).toBe(countBefore)

    // With --writer-token-file holding the right token: succeeds
    const tokenFile = join(scratch, 'holder.token')
    writeFileSync(tokenFile, `${secretToken}\n`, 'utf8')
    const ok = cli(repo, [
      'adopt',
      'apply',
      planFile,
      '--writer-token-file',
      tokenFile,
      '--now',
      LEGACY_LIKE_NOW,
      '--commit',
      'c1',
    ])
    expect(ok.code, ok.err).toBe(0)
    expect(ok.out).toContain(': applied')
  })

  it('handles E1 unnumbered demand, E3 blocked-without-cause, and E7 masked-text rewrite', () => {
    const repo = join(scratch, 'e1-e3-e7')
    mkdirSync(repo, { recursive: true })
    const store = new EventStore(join(repo, '.track', 'events.jsonl'))
    const track = new Track(store, { by: 'test', now: () => '2026-11-10T10:00:00.000Z' })

    // E1 unnumbered demand
    track.raiseDemand({
      type: 'feature',
      workspace: 'ws',
      raw: { text: 'Demande sans numéro à numéroter' },
      source: { kind: 'human' },
    })

    // Numbered demand with blocked-without-cause (E3) and commit-hash in request text (E7)
    const depAnchor = track.createItem({ kind: 'chore', title: 'Dépendance ouverte', workspace: 'ws' })
    const d2 = track.raiseDemand({
      type: 'feature',
      workspace: 'ws',
      raw: { text: 'Corriger la régression 483a5f356 en production' },
      source: { kind: 'human' },
    })
    track.numberDemand(d2, 1)
    track.claimDemand(d2, {})
    const [item2] = track.agreeDemand(d2, { items: [{ title: 'Correctif' }] })
    track.openBlocker({ targetId: item2!, kind: 'dependency', ref: depAnchor, reason: '' })

    const planRes = cli(repo, ['adopt', 'plan', '--now', LEGACY_LIKE_NOW, '--commit', 'c1'])
    expect(planRes.code, planRes.err).toBe(0)
    const plan = JSON.parse(planRes.out) as AdoptionPlan

    expect(plan.entries.some((e) => e.action === 'number-demand' && e.kind === 'mechanical')).toBe(true)
    expect(plan.entries.some((e) => e.action === 'set-blocked-cause' && e.kind === 'to-decide')).toBe(true)
    expect(plan.entries.some((e) => e.action === 'rewrite-masked-text' && e.kind === 'to-decide')).toBe(true)

    const resolved: AdoptionPlan = {
      ...plan,
      entries: plan.entries.map((e) => {
        if (e.action === 'set-blocked-cause') {
          return { ...e, resolution: { cause: 'Attente accès environnement de préproduction (infra)' } }
        }
        if (e.action === 'rewrite-masked-text') {
          return { ...e, resolution: { text: 'Corriger la régression observée en production' } }
        }
        return e
      }),
    }
    const planFile = join(scratch, 'e1-e3-e7.json')
    writeFileSync(planFile, `${JSON.stringify(resolved, null, 2)}\n`, 'utf8')

    const applyRes = cli(repo, ['adopt', 'apply', planFile, '--now', LEGACY_LIKE_NOW, '--commit', 'c1'])
    expect(applyRes.code, applyRes.err).toBe(0)

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
    expect(strictRes.code, strictRes.err).toBe(0)
    expect(strictRes.out).toContain('Corriger la régression observée en production (non capté)')
    expect(strictRes.out).toContain('Attente accès environnement de préproduction (infra)')
  })
})
