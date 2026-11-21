import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { runCli } from '../cli/index.js'
import { EventStore } from '../events/store.js'
import { Track } from '../track.js'
import { identityDigest, identityOf } from './identity.js'
import { prepareInscriptionJournal } from './inscription.js'

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

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'track-off-repo-'))
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

describe('journal outside the repository (lot 4a)', () => {
  it('in a folder without a journal, git or not, an inscribed demand is displayed and git status is unchanged, with no h2a on the machine (T4a-a)', () => {
    // 1. Git repository without `.track`
    const gitRepo = join(scratch, 'projet-sans-journal')
    mkdirSync(gitRepo, { recursive: true })
    git(gitRepo, ['init', '-b', 'main'])
    writeFileSync(join(gitRepo, 'README.md'), '# Projet\n', 'utf8')
    git(gitRepo, ['add', 'README.md'])
    git(gitRepo, ['commit', '-m', 'init'])

    expect(git(gitRepo, ['status', '--porcelain'])).toBe('')
    expect(existsSync(join(gitRepo, '.track'))).toBe(false)

    const gitIdent = identityOf(gitRepo)
    const gitPrep = prepareInscriptionJournal({ cwd: gitRepo })
    expect(gitPrep.createdOffRepo).toBe(true)
    const expectedGitJournal = join(stateHome, 'journals', identityDigest(gitIdent.id), '.track')
    expect(gitPrep.trackDir).toBe(expectedGitJournal)
    expect(existsSync(expectedGitJournal)).toBe(true)
    expect(existsSync(join(gitRepo, '.track'))).toBe(false)

    // Modes 0700 on state dir and 0600 on journals.json
    expect(statSync(stateHome).mode & 0o777).toBe(0o700)
    expect(statSync(expectedGitJournal).mode & 0o777).toBe(0o700)
    expect(statSync(join(stateHome, 'journals.json')).mode & 0o777).toBe(0o600)

    const gitTrack = new Track(new EventStore(gitPrep.eventsPath), {
      by: 'owner',
      now: () => '2026-11-20T10:00:00.000Z',
    })
    const gitDemandId = gitTrack.raiseDemand({
      type: 'feature',
      workspace: gitPrep.identity,
      raw: { text: 'Afficher les demandes sans créer de dossier dans le dépôt' },
      source: { kind: 'human' },
    })
    gitTrack.numberDemand(gitDemandId, 1)

    // git status remains strictly empty and nothing was added to the repository
    expect(git(gitRepo, ['status', '--porcelain'])).toBe('')
    expect(existsSync(join(gitRepo, '.track'))).toBe(false)

    const gitReport = cli(gitRepo, [
      'report',
      '--owner-table',
      '--format',
      'md',
      '--now',
      '2026-11-20T12:00:00.000Z',
      '--commit',
      'HEAD',
    ])
    expect(gitReport.code, gitReport.err).toBe(0)
    expect(gitReport.out).toContain('Journal : projet-sans-journal · journal hors dépôt · dernier événement 20/11')
    expect(gitReport.out).toContain('Afficher les demandes sans créer de dossier dans le dépôt')

    // 2. Non-git folder without `.track`
    const plainDir = join(scratch, 'dossier-libre')
    mkdirSync(plainDir, { recursive: true })
    const plainIdent = identityOf(plainDir)
    expect(plainIdent.kind).toBe('folder')

    const plainPrep = prepareInscriptionJournal({ cwd: plainDir })
    expect(plainPrep.createdOffRepo).toBe(true)
    const expectedPlainJournal = join(stateHome, 'journals', identityDigest(plainIdent.id), '.track')
    expect(plainPrep.trackDir).toBe(expectedPlainJournal)
    expect(existsSync(join(plainDir, '.track'))).toBe(false)

    const plainTrack = new Track(new EventStore(plainPrep.eventsPath), {
      by: 'owner',
      now: () => '2026-11-20T10:30:00.000Z',
    })
    const plainDemandId = plainTrack.raiseDemand({
      type: 'chore',
      workspace: plainPrep.identity,
      raw: { text: 'Suivre un dossier hors git en autonomie' },
      source: { kind: 'human' },
    })
    plainTrack.numberDemand(plainDemandId, 1)

    const plainReport = cli(plainDir, [
      'report',
      '--owner-table',
      '--format',
      'md',
      '--now',
      '2026-11-20T12:00:00.000Z',
      '--commit',
      'c1',
    ])
    expect(plainReport.code, plainReport.err).toBe(0)
    expect(plainReport.out).toContain('Journal : dossier-libre · journal hors dépôt · dernier événement 20/11')
    expect(plainReport.out).toContain('Suivre un dossier hors git en autonomie')
    expect(existsSync(join(plainDir, '.track'))).toBe(false)
  })
})
