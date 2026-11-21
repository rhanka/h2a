import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { runCli } from '../cli/index.js'
import { EventStore } from '../events/store.js'
import { Track } from '../track.js'
import { identityOf } from './identity.js'
import { nextOwnerDemandNumber, prepareInscriptionJournal } from './inscription.js'

let scratch: string
let stateHome: string
let savedEnv: Record<string, string | undefined>

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Test',
      GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'Test',
      GIT_COMMITTER_EMAIL: 'test@example.com',
      GIT_CEILING_DIRECTORIES: resolve(tmpdir()),
    },
  }).trim()
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

function initRepo(dir: string, filename = 'README.md', content = '# Repo\n'): void {
  mkdirSync(dir, { recursive: true })
  git(dir, ['init', '-b', 'main'])
  writeFileSync(join(dir, filename), content, 'utf8')
  git(dir, ['add', filename])
  git(dir, ['commit', '-m', 'init'])
}

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'track-satellite-'))
  stateHome = join(scratch, 'state-home')
  savedEnv = {
    TRACK_STATE_HOME: process.env['TRACK_STATE_HOME'],
    TRACK_DIR: process.env['TRACK_DIR'],
    TRACK_OWNER_POLICY_FILE: process.env['TRACK_OWNER_POLICY_FILE'],
    TRACK_OWNER_REPORT_POLICY: process.env['TRACK_OWNER_REPORT_POLICY'],
  }
  process.env['TRACK_STATE_HOME'] = stateHome
  delete process.env['TRACK_DIR']
  delete process.env['TRACK_OWNER_POLICY_FILE']
  delete process.env['TRACK_OWNER_REPORT_POLICY']
})

afterEach(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  rmSync(scratch, { recursive: true, force: true })
})

describe('attached satellites and per-project document references (lot 4a)', () => {
  it('an attached satellite takes the next numbers of its conductor journal, is read on the entire journal and carries its origin label (T4a-f)', () => {
    const conductor = join(scratch, 'conducteur')
    const satellite = join(scratch, 'sat-app')
    initRepo(conductor, 'README.md', '# Conducteur\n')
    initRepo(satellite, 'README.md', '# Satellite\n')

    const condIdent = identityOf(conductor)
    const satIdent = identityOf(satellite)
    expect(condIdent.id).not.toBe(satIdent.id)

    // Conductor has demand #1 in its `.track`
    const condTrack = new Track(new EventStore(join(conductor, '.track', 'events.jsonl')), {
      by: 'owner',
      now: () => '2026-11-19T10:00:00.000Z',
    })
    const d1 = condTrack.raiseDemand({
      type: 'feature',
      workspace: condIdent.id,
      raw: { text: 'Demande du conducteur' },
      source: { kind: 'human' },
    })
    condTrack.numberDemand(d1, 1)

    // Designate conductor's journal and attach satellite to conductor
    const des = cli(conductor, ['journal', 'designate', conductor, '--by', 'owner'])
    expect(des.code, des.err).toBe(0)
    const att = cli(satellite, ['journal', 'attach', '--to', conductor])
    expect(att.code, att.err).toBe(0)

    // From satellite, inscribe a demand into the conductor's journal -> takes #2
    const satPrep = prepareInscriptionJournal({ cwd: satellite })
    expect(satPrep.trackDir).toBe(join(realpathSync(conductor), '.track'))
    const satStore = new EventStore(satPrep.eventsPath)
    const nextNum = nextOwnerDemandNumber(satStore)
    expect(nextNum).toBe(2)

    const satTrack = new Track(satStore, {
      by: 'owner',
      now: () => '2026-11-20T10:00:00.000Z',
    })
    const d2 = satTrack.raiseDemand({
      type: 'feature',
      workspace: satPrep.identity,
      raw: { text: 'Demande issue du satellite' },
      source: { kind: 'human' },
    })
    satTrack.numberDemand(d2, nextNum)

    // Read from satellite: header names `satellite de conducteur`, entire journal (#1 and #2) is shown,
    // and row #2 carries the satellite origin label `sat-app`
    const satReport = cli(satellite, [
      'report',
      '--owner-table',
      '--format',
      'md',
      '--now',
      '2026-11-20T12:00:00.000Z',
      '--commit',
      'HEAD',
    ])
    expect(satReport.code, satReport.err).toBe(0)
    expect(satReport.out).toContain('Journal : conducteur · satellite de conducteur · dernier événement 20/11')
    expect(satReport.out).toContain('| 1 |')
    expect(satReport.out).toContain('| 2 |')
    expect(satReport.out).toContain('Demande du conducteur')
    expect(satReport.out).toContain('Demande issue du satellite')

    // Check origin label specifically on row #2 (and NOT on conductor's own row #1)
    const row1Line = satReport.out.split('\n').find((l) => l.startsWith('| 1 |')) ?? ''
    const row2Line = satReport.out.split('\n').find((l) => l.startsWith('| 2 |')) ?? ''
    expect(row2Line).toContain('sat-app')
    expect(row1Line).not.toContain('sat-app')

    // Read from conductor also shows the entire journal and satellite origin label on #2
    const condReport = cli(conductor, [
      'report',
      '--owner-table',
      '--format',
      'md',
      '--now',
      '2026-11-20T12:00:00.000Z',
      '--commit',
      'HEAD',
    ])
    expect(condReport.code, condReport.err).toBe(0)
    expect(condReport.out).toContain('| 1 |')
    expect(condReport.out).toContain('| 2 |')
    const condRow2 = condReport.out.split('\n').find((l) => l.startsWith('| 2 |')) ?? ''
    expect(condRow2).toContain('sat-app')
  })

  it('document references of a journal outside the repository and of a satellite resolve against their own project folder, and an unknown folder is counted as not verified (T4a-j)', () => {
    // 1. Journal outside the repository
    const offRepoProj = join(scratch, 'proj-hors-depot')
    initRepo(offRepoProj, 'README.md', '# OffRepo\n')
    mkdirSync(join(offRepoProj, 'docs'), { recursive: true })
    writeFileSync(join(offRepoProj, 'docs', 'spec-locale.md'), '# Spec locale\n', 'utf8')

    const offPrep = prepareInscriptionJournal({ cwd: offRepoProj })
    const offTrack = new Track(new EventStore(offPrep.eventsPath), {
      by: 'owner',
      now: () => '2026-11-20T10:00:00.000Z',
    })
    const offDem = offTrack.raiseDemand({
      type: 'feature',
      workspace: offPrep.identity,
      raw: { text: 'Suivre la spec hors dépôt' },
      source: { kind: 'human' },
    })
    offTrack.numberDemand(offDem, 1)
    offTrack.createItem({
      kind: 'feature',
      title: 'Spec locale',
      workspace: offPrep.identity,
      body: 'docs/spec-locale.md',
    })

    const offOk = cli(offRepoProj, [
      'report',
      '--owner-table',
      '--format',
      'json',
      '--now',
      '2026-11-20T12:00:00.000Z',
      '--commit',
      'HEAD',
    ])
    expect(offOk.code, offOk.err).toBe(0)
    const offOkJson = JSON.parse(offOk.out) as { counts: { desyncCount: number; unverifiedDocs: number } }
    expect(offOkJson.counts.desyncCount).toBe(0)
    expect(offOkJson.counts.unverifiedDocs).toBe(0)

    // Diverging H1 in offRepoProj/docs/spec-locale.md is detected against offRepoProj
    writeFileSync(join(offRepoProj, 'docs', 'spec-locale.md'), '# Titre différent\n', 'utf8')
    const offBad = cli(offRepoProj, [
      'report',
      '--owner-table',
      '--format',
      'json',
      '--now',
      '2026-11-20T12:00:00.000Z',
      '--commit',
      'HEAD',
    ])
    expect(offBad.code, offBad.err).toBe(0)
    const offBadJson = JSON.parse(offBad.out) as { counts: { desyncCount: number; unverifiedDocs: number } }
    expect(offBadJson.counts.desyncCount).toBe(1)
    expect(offBadJson.counts.unverifiedDocs).toBe(0)

    // 2. Attached satellite + conductor + unknown folder identity
    const conductor = join(scratch, 'cond-docs')
    const satellite = join(scratch, 'sat-docs')
    initRepo(conductor, 'README.md', '# Cond\n')
    initRepo(satellite, 'README.md', '# Sat\n')
    mkdirSync(join(conductor, 'docs'), { recursive: true })
    mkdirSync(join(satellite, 'docs'), { recursive: true })
    writeFileSync(join(conductor, 'docs', 'cond-spec.md'), '# Spec conducteur\n', 'utf8')
    writeFileSync(join(satellite, 'docs', 'sat-spec.md'), '# Spec satellite\n', 'utf8')

    const condIdent = identityOf(conductor)
    const satIdent = identityOf(satellite)

    const cTrack = new Track(new EventStore(join(conductor, '.track', 'events.jsonl')), {
      by: 'owner',
      now: () => '2026-11-20T10:00:00.000Z',
    })
    const cd1 = cTrack.raiseDemand({
      type: 'feature',
      workspace: condIdent.id,
      raw: { text: 'Demande conducteur' },
      source: { kind: 'human' },
    })
    cTrack.numberDemand(cd1, 1)
    cTrack.createItem({
      kind: 'feature',
      title: 'Spec conducteur',
      workspace: condIdent.id,
      body: 'docs/cond-spec.md',
    })
    cTrack.createItem({
      kind: 'feature',
      title: 'Spec satellite',
      workspace: satIdent.id,
      body: 'docs/sat-spec.md',
    })
    // Item with an unknown identity not recorded in the index
    const unknownIdentity = `ws:${'a'.repeat(64)}`
    cTrack.createItem({
      kind: 'feature',
      title: 'Spec inconnue',
      workspace: unknownIdentity,
      body: 'docs/unknown-spec.md',
    })

    expect(cli(conductor, ['journal', 'designate', conductor, '--by', 'owner']).code).toBe(0)
    expect(cli(satellite, ['journal', 'attach', '--to', conductor]).code).toBe(0)

    // Both conductor & satellite docs resolve clean against their own folders; unknown identity is counted as not verified
    const repMd = cli(satellite, [
      'report',
      '--owner-table',
      '--format',
      'md',
      '--now',
      '2026-11-20T12:00:00.000Z',
      '--commit',
      'HEAD',
    ])
    expect(repMd.code, repMd.err).toBe(0)
    expect(repMd.out).toContain('1 document non vérifié')
    expect(repMd.out).not.toContain('document désynchronisé')

    const repJson = cli(satellite, [
      'report',
      '--owner-table',
      '--format',
      'json',
      '--now',
      '2026-11-20T12:00:00.000Z',
      '--commit',
      'HEAD',
    ])
    expect(repJson.code, repJson.err).toBe(0)
    const parsed = JSON.parse(repJson.out) as { counts: { desyncCount: number; unverifiedDocs: number } }
    expect(parsed.counts.desyncCount).toBe(0)
    expect(parsed.counts.unverifiedDocs).toBe(1)

    // Breaking satellite's doc triggers 1 desync (resolved against satellite folder), while unknown stays 1 unverified
    writeFileSync(join(satellite, 'docs', 'sat-spec.md'), '# Mauvais titre\n', 'utf8')
    const repBroken = cli(conductor, [
      'report',
      '--owner-table',
      '--format',
      'json',
      '--now',
      '2026-11-20T12:00:00.000Z',
      '--commit',
      'HEAD',
    ])
    expect(repBroken.code, repBroken.err).toBe(0)
    const brokenJson = JSON.parse(repBroken.out) as { counts: { desyncCount: number; unverifiedDocs: number } }
    expect(brokenJson.counts.desyncCount).toBe(1)
    expect(brokenJson.counts.unverifiedDocs).toBe(1)
  })
})
