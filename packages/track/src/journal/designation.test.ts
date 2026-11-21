import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { runCli } from '../cli/index.js'
import { resolveJournalOfReference } from '../cli/journal-reference.js'
import { EventStore } from '../events/store.js'
import { Track } from '../track.js'
import { identityOf } from './identity.js'
import { JOURNAL_INDEX_VERSION, journalIndexPath, readJournalIndex, recordCopy } from './index-store.js'
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

function fingerprintTree(rootDir: string): string {
  if (!existsSync(rootDir)) return 'ABSENT'
  const hash = createHash('sha256')
  const walk = (dir: string, rel: string): void => {
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

function initRepoWithDemand(dir: string, text: string, num = 1): void {
  mkdirSync(dir, { recursive: true })
  git(dir, ['init', '-b', 'main'])
  writeFileSync(join(dir, 'README.md'), '# Repo\n', 'utf8')
  git(dir, ['add', 'README.md'])
  git(dir, ['commit', '-m', 'init'])
  const track = new Track(new EventStore(join(dir, '.track', 'events.jsonl')), {
    by: 'test',
    now: () => '2026-11-19T10:00:00.000Z',
  })
  const dId = track.raiseDemand({
    type: 'feature',
    workspace: identityOf(dir).id,
    raw: { text },
    source: { kind: 'human' },
  })
  track.numberDemand(dId, num)
}

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'track-designation-'))
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

describe('journal index store and designation (lot 4a)', () => {
  it('index store reads without creating files and writes atomically with modes 0700/0600', () => {
    expect(existsSync(stateHome)).toBe(false)
    const empty = readJournalIndex()
    expect(empty).toEqual({ version: JOURNAL_INDEX_VERSION, identities: {} })
    expect(existsSync(stateHome)).toBe(false)
    expect(existsSync(journalIndexPath())).toBe(false)

    const rootDir = join(scratch, 'sample-root')
    const copyDir = join(rootDir, '.track')
    mkdirSync(copyDir, { recursive: true })
    const entry = recordCopy('dir:abc', rootDir, copyDir, { now: '2026-11-20T09:00:00.000Z' })
    expect(entry.root).toBe(realpathSync(rootDir))
    expect(entry.reference).toBeNull()
    expect(entry.attachedTo).toBeNull()
    expect(entry.copies).toEqual([
      {
        path: realpathSync(copyDir),
        firstSeen: '2026-11-20T09:00:00.000Z',
        lastSeen: '2026-11-20T09:00:00.000Z',
      },
    ])
    expect(statSync(stateHome).mode & 0o777).toBe(0o700)
    expect(statSync(journalIndexPath()).mode & 0o777).toBe(0o600)
  })

  it('with one designated journal both clones render the same table (T4a-c)', () => {
    const cloneA = join(scratch, 'clone-a')
    initRepoWithDemand(cloneA, 'Demande de référence du clone A')
    const cloneB = join(scratch, 'clone-b')
    git(scratch, ['clone', cloneA, cloneB])

    // Give clone B its own divergent local `.track`
    const trackB = new Track(new EventStore(join(cloneB, '.track', 'events.jsonl')), {
      by: 'test',
      now: () => '2026-11-20T08:00:00.000Z',
    })
    const localB = trackB.raiseDemand({
      type: 'feature',
      workspace: identityOf(cloneB).id,
      raw: { text: 'Demande divergente du clone B' },
      source: { kind: 'human' },
    })
    trackB.numberDemand(localB, 1)

    const des = cli(cloneA, ['journal', 'designate', cloneA, '--by', 'owner'])
    expect(des.code, des.err).toBe(0)

    const reportA = cli(cloneA, [
      'report',
      '--owner-table',
      '--format',
      'md',
      '--now',
      '2026-11-20T12:00:00.000Z',
      '--commit',
      'HEAD',
    ])
    const reportB = cli(cloneB, [
      'report',
      '--owner-table',
      '--format',
      'md',
      '--now',
      '2026-11-20T12:00:00.000Z',
      '--commit',
      'HEAD',
    ])
    expect(reportA.code, reportA.err).toBe(0)
    expect(reportB.code, reportB.err).toBe(0)

    expect(reportA.out).toContain('Journal : clone-a · journal désigné · dernier événement 19/11')
    expect(reportB.out).toContain('Journal : clone-a · journal désigné · dernier événement 19/11')
    expect(reportA.out).toContain('Demande de référence du clone A')
    expect(reportB.out).toContain('Demande de référence du clone A')
    expect(reportB.out).not.toContain('Demande divergente du clone B')
    expect(reportB.out).toContain('Copie locale : 2 événements absents du journal de référence')

    // Compare the table rows rendered from both clones — identical
    const tableRows = (md: string): string[] => md.split('\n').filter((l) => l.startsWith('|'))
    expect(tableRows(reportB.out)).toEqual(tableRows(reportA.out))
  })

  it('with several copies and none designated the table says copie non désignée and nothing is inscribed into a copy (T4a-d)', () => {
    const cloneA = join(scratch, 'multi-a')
    initRepoWithDemand(cloneA, 'Demande dans copie A')
    const cloneB = join(scratch, 'multi-b')
    git(scratch, ['clone', cloneA, cloneB])

    const trackB = new Track(new EventStore(join(cloneB, '.track', 'events.jsonl')), {
      by: 'test',
      now: () => '2026-11-20T08:00:00.000Z',
    })
    const dB = trackB.raiseDemand({
      type: 'feature',
      workspace: identityOf(cloneB).id,
      raw: { text: 'Demande dans copie B' },
      source: { kind: 'human' },
    })
    trackB.numberDemand(dB, 1)

    const id = identityOf(cloneA).id
    recordCopy(id, cloneA, join(cloneA, '.track'))

    // Attempting inscription in clone B records B's copy and refuses naming `track journal designate`
    const fpABefore = fingerprintTree(join(cloneA, '.track'))
    const fpBBefore = fingerprintTree(join(cloneB, '.track'))

    expect(() => prepareInscriptionJournal({ cwd: cloneB })).toThrow(/track journal designate/u)
    expect(fingerprintTree(join(cloneA, '.track'))).toBe(fpABefore)
    expect(fingerprintTree(join(cloneB, '.track'))).toBe(fpBBefore)

    // Both copies are now known in the index, and neither is designated
    const idx = readJournalIndex()
    expect(idx.identities[id]?.reference).toBeNull()
    expect(idx.identities[id]?.copies.length).toBe(2)

    // Refused in clone A as well
    expect(() => prepareInscriptionJournal({ cwd: cloneA })).toThrow(/track journal designate/u)
    expect(fingerprintTree(join(cloneA, '.track'))).toBe(fpABefore)

    // Read part: table says `copie non désignée (2 copies connues)` and scope motif `journal de référence non désigné`
    for (const dir of [cloneA, cloneB]) {
      const rep = cli(dir, [
        'report',
        '--owner-table',
        '--format',
        'md',
        '--now',
        '2026-11-20T12:00:00.000Z',
        '--commit',
        'HEAD',
      ])
      expect(rep.code, rep.err).toBe(0)
      expect(rep.out).toContain('copie non désignée (2 copies connues)')
      expect(rep.out).toContain('journal de référence non désigné')
    }
  })

  it('a read creates neither a journal nor an index entry (T4a-h)', () => {
    // 1. Folder without a journal (outside git)
    const emptyFolder = join(scratch, 'read-empty')
    mkdirSync(emptyFolder, { recursive: true })
    const stateBefore1 = fingerprintTree(stateHome)
    const folderBefore1 = fingerprintTree(emptyFolder)

    cli(emptyFolder, ['report', '--owner-table', '--format', 'md', '--now', '2026-11-20T12:00:00.000Z', '--commit', 'c1'])
    cli(emptyFolder, ['journal', 'which'])
    cli(emptyFolder, ['journal', 'which', '--format', 'json'])
    cli(emptyFolder, ['decision', 'ls'])

    expect(fingerprintTree(stateHome)).toBe(stateBefore1)
    expect(fingerprintTree(emptyFolder)).toBe(folderBefore1)
    expect(existsSync(stateHome)).toBe(false)

    // 2. Git repository with an existing `.track`
    const repo = join(scratch, 'read-repo')
    initRepoWithDemand(repo, 'Demande existante en lecture seule')
    const stateBefore2 = fingerprintTree(stateHome)
    const repoBefore2 = fingerprintTree(repo)

    const rep = cli(repo, ['report', '--owner-table', '--format', 'md', '--now', '2026-11-20T12:00:00.000Z', '--commit', 'HEAD'])
    expect(rep.code, rep.err).toBe(0)
    const wh = cli(repo, ['journal', 'which'])
    expect(wh.code, wh.err).toBe(0)
    const dls = cli(repo, ['decision', 'ls'])
    expect(dls.code, dls.err).toBe(0)

    expect(fingerprintTree(stateHome)).toBe(stateBefore2)
    expect(fingerprintTree(repo)).toBe(repoBefore2)
    expect(existsSync(stateHome)).toBe(false)
  })

  it('the first copy seen is never designated on its own (T4a-i)', () => {
    const cloneA = join(scratch, 'first-seen-a')
    initRepoWithDemand(cloneA, 'Première demande dans copie A')

    // First inscription in clone A records clone A as a copy, NEVER designates it
    const prepA = prepareInscriptionJournal({ cwd: cloneA })
    expect(prepA.trackDir).toBe(join(realpathSync(cloneA), '.track'))

    const id = identityOf(cloneA).id
    const idxAfterA = readJournalIndex()
    expect(idxAfterA.identities[id]?.copies.length).toBe(1)
    expect(idxAfterA.identities[id]?.reference).toBeNull()

    const resolvedA = resolveJournalOfReference({ cwd: cloneA })
    expect(resolvedA.designated).toBe(false)
    expect(resolvedA.inscriptionAllowed).toBe(true)

    // Once a second clone B has its own `.track`, clone A was NOT auto-designated:
    // clone B sees 2 undesignated copies and refuses inscription
    const cloneB = join(scratch, 'first-seen-b')
    git(scratch, ['clone', cloneA, cloneB])
    mkdirSync(join(cloneB, '.track'), { recursive: true })
    writeFileSync(join(cloneB, '.track', 'events.jsonl'), '', 'utf8')

    const resolvedB = resolveJournalOfReference({ cwd: cloneB })
    expect(resolvedB.designated).toBe(false)
    expect(resolvedB.inscriptionAllowed).toBe(false)
    expect(resolvedB.resolution).toBe('copie non désignée (2 copies connues)')
    expect(() => prepareInscriptionJournal({ cwd: cloneB })).toThrow(/track journal designate/u)
  })
})
