import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { runCli } from '../cli/index.js'
import { EventStore } from '../events/store.js'
import { Track } from '../track.js'
import { identityDigest, identityOf } from './identity.js'

let scratch: string
let stateHome: string
let savedEnv: Record<string, string | undefined>

const EXACT_WHICH_JSON_KEYS = [
  'designated',
  'exists',
  'identity',
  'identityKind',
  'inscriptionAllowed',
  'journal',
  'knownCopies',
  'resolution',
  'rewrittenFrom',
  'startFolder',
  'steps',
]

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
  scratch = mkdtempSync(join(tmpdir(), 'track-which-'))
  stateHome = join(scratch, 'state-home')
  savedEnv = {
    TRACK_STATE_HOME: process.env['TRACK_STATE_HOME'],
    TRACK_DIR: process.env['TRACK_DIR'],
  }
  process.env['TRACK_STATE_HOME'] = stateHome
  delete process.env['TRACK_DIR']
})

afterEach(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  rmSync(scratch, { recursive: true, force: true })
})

describe('track journal which (lot 4a)', () => {
  it('journal which prints the identity, each step tried and the journal retained (T4a-g)', () => {
    // 1. Repository with `.track` and a linked worktree
    const mainRepo = join(scratch, 'which-main')
    mkdirSync(mainRepo, { recursive: true })
    git(mainRepo, ['init', '-b', 'main'])
    writeFileSync(join(mainRepo, 'README.md'), '# Main\n', 'utf8')
    git(mainRepo, ['add', 'README.md'])
    git(mainRepo, ['commit', '-m', 'init'])
    new Track(new EventStore(join(mainRepo, '.track', 'events.jsonl')), { by: 'test' }).createItem({
      kind: 'feature',
      title: 'Init',
      workspace: 'ws',
    })
    const wt = join(scratch, 'which-wt')
    git(mainRepo, ['worktree', 'add', '-b', 'wt-which', wt])

    const textRes = cli(wt, ['journal', 'which'])
    expect(textRes.code, textRes.err).toBe(0)
    const expectedId = identityOf(mainRepo).id
    expect(textRes.out).toContain(expectedId)
    expect(textRes.out).toContain(join(realpathSync(mainRepo), '.track'))
    expect(textRes.out).toContain('dépôt principal')

    const jsonRes = cli(wt, ['journal', 'which', '--format', 'json'])
    expect(jsonRes.code, jsonRes.err).toBe(0)
    const parsed = JSON.parse(jsonRes.out) as Record<string, unknown>
    expect(Object.keys(parsed).sort()).toEqual(EXACT_WHICH_JSON_KEYS)
    expect(parsed['identity']).toBe(expectedId)
    expect(parsed['identityKind']).toBe('project')
    expect(parsed['startFolder']).toBe(realpathSync(mainRepo))
    expect(parsed['rewrittenFrom']).toBe(realpathSync(wt))
    expect(parsed['journal']).toBe(join(realpathSync(mainRepo), '.track'))
    expect(parsed['exists']).toBe(true)
    expect(parsed['resolution']).toBe('dépôt principal')
    expect(parsed['designated']).toBe(false)
    expect(parsed['inscriptionAllowed']).toBe(true)
    expect(parsed['knownCopies']).toBe(0)
    const steps = parsed['steps'] as Array<{ step: number; name: string; outcome: string }>
    expect(Array.isArray(steps)).toBe(true)
    expect(steps.map((s) => s.step)).toEqual([1, 2, 3, 4, 5])

    // 2. Folder outside git without a journal (step 6 absent)
    const plain = join(scratch, 'which-plain')
    mkdirSync(plain, { recursive: true })
    const plainIdent = identityOf(plain)
    const plainJson = cli(plain, ['journal', 'which', '--format', 'json'])
    expect(plainJson.code, plainJson.err).toBe(0)
    const pParsed = JSON.parse(plainJson.out) as Record<string, unknown>
    expect(Object.keys(pParsed).sort()).toEqual(EXACT_WHICH_JSON_KEYS)
    expect(pParsed['identity']).toBe(plainIdent.id)
    expect(pParsed['identityKind']).toBe('folder')
    expect(pParsed['rewrittenFrom']).toBeNull()
    expect(pParsed['journal']).toBe(join(stateHome, 'journals', identityDigest(plainIdent.id), '.track'))
    expect(pParsed['exists']).toBe(false)
    expect(pParsed['resolution']).toBe('journal hors dépôt')
    expect(pParsed['designated']).toBe(false)
    expect(pParsed['inscriptionAllowed']).toBe(true)
    expect((pParsed['steps'] as Array<{ step: number }>).map((s) => s.step)).toEqual([1, 2, 3, 4, 5, 6])

    // 3. Designated journal (step 3) and attached satellite (step 4)
    expect(cli(mainRepo, ['journal', 'designate', mainRepo, '--by', 'owner']).code).toBe(0)
    const desJson = cli(mainRepo, ['journal', 'which', '--format', 'json'])
    expect(desJson.code, desJson.err).toBe(0)
    const dParsed = JSON.parse(desJson.out) as Record<string, unknown>
    expect(Object.keys(dParsed).sort()).toEqual(EXACT_WHICH_JSON_KEYS)
    expect(dParsed['resolution']).toBe('journal désigné')
    expect(dParsed['designated']).toBe(true)
    expect(dParsed['knownCopies']).toBe(1)
    expect((dParsed['steps'] as Array<{ step: number }>).map((s) => s.step)).toEqual([1, 2, 3])

    const satRepo = join(scratch, 'which-sat')
    mkdirSync(satRepo, { recursive: true })
    git(satRepo, ['init', '-b', 'main'])
    writeFileSync(join(satRepo, 'sat.txt'), 'sat\n', 'utf8')
    git(satRepo, ['add', 'sat.txt'])
    git(satRepo, ['commit', '-m', 'init'])
    expect(cli(satRepo, ['journal', 'attach', '--to', mainRepo]).code).toBe(0)

    const satJson = cli(satRepo, ['journal', 'which', '--format', 'json'])
    expect(satJson.code, satJson.err).toBe(0)
    const sParsed = JSON.parse(satJson.out) as Record<string, unknown>
    expect(Object.keys(sParsed).sort()).toEqual(EXACT_WHICH_JSON_KEYS)
    expect(sParsed['journal']).toBe(join(realpathSync(mainRepo), '.track'))
    expect(sParsed['resolution']).toBe('satellite de which-main')
    expect(sParsed['designated']).toBe(true)
    expect((sParsed['steps'] as Array<{ step: number }>).map((s) => s.step)).toEqual([1, 2, 3, 4])
  })
})
