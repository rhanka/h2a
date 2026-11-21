import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { EventStore } from '../events/store.js'
import { Track } from '../track.js'
import { runCli } from './index.js'
import { resolveJournalOfReference } from './journal-reference.js'

let scratch: string

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

function isInside(child: string, parent: string): boolean {
  const c = realpathSync(resolve(child))
  const p = realpathSync(resolve(parent))
  return c === p || c.startsWith(`${p}/`)
}

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'track-journal-ref-'))
})

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true })
})

describe('journal of reference resolver (lot 1)', () => {
  it('from a linked worktree the table reads the main checkout journal, names it, and reports events held only by the local copy (T1-g)', () => {
    const mainRepo = join(scratch, 'mon-projet')
    const linkedWt = join(scratch, 'mon-projet-wt')
    mkdirSync(mainRepo, { recursive: true })
    git(mainRepo, ['init', '-b', 'main'])
    writeFileSync(join(mainRepo, 'README.md'), '# Projet\n', 'utf8')
    git(mainRepo, ['add', 'README.md'])
    git(mainRepo, ['commit', '-m', 'init'])

    // Populate main checkout journal
    const mainTrack = new Track(new EventStore(join(mainRepo, '.track', 'events.jsonl')), {
      by: 'test',
      now: () => '2026-11-18T10:00:00.000Z',
    })
    const dMain = mainTrack.raiseDemand({
      type: 'feature',
      workspace: 'ws',
      raw: { text: 'Demande du dépôt principal' },
      source: { kind: 'human' },
    })
    mainTrack.numberDemand(dMain, 1)

    // Create a linked worktree with its own divergent local .track copy (2 extra events)
    git(mainRepo, ['worktree', 'add', '-b', 'wt-branch', linkedWt])
    const wtTrack = new Track(new EventStore(join(linkedWt, '.track', 'events.jsonl')), {
      by: 'test',
      now: () => '2026-11-19T10:00:00.000Z',
    })
    const dLocal = wtTrack.raiseDemand({
      type: 'feature',
      workspace: 'ws',
      raw: { text: 'Demande locale au worktree' },
      source: { kind: 'human' },
    })
    wtTrack.numberDemand(dLocal, 1)

    const resolved = resolveJournalOfReference({ cwd: linkedWt })
    expect(resolved.trackDir).toBe(join(realpathSync(mainRepo), '.track'))
    expect(resolved.resolution).toBe('dépôt principal')
    expect(resolved.label).toBe('mon-projet')
    expect(resolved.localOnlyEventCount).toBe(2)

    let out = ''
    let err = ''
    const code = runCli(
      ['report', '--owner-table', '--format', 'md', '--now', '2026-11-20T12:00:00.000Z', '--commit', 'c1'],
      {
        cwd: linkedWt,
        out: (s) => {
          out += s
        },
        err: (s) => {
          err += s
        },
      },
    )
    expect(code, err).toBe(0)
    expect(out).toContain('Journal : mon-projet · dépôt principal · dernier événement 18/11')
    expect(out).toContain('Copie locale : 2 événements absents du journal de référence')
    expect(out).toContain('Demande du dépôt principal')
    expect(out).not.toContain('Demande locale au worktree')

    // When main checkout has NO journal, worktree copy is NEVER read as the journal of reference
    rmSync(join(mainRepo, '.track'), { recursive: true, force: true })
    const noMain = resolveJournalOfReference({ cwd: linkedWt })
    expect(noMain.trackDir).toBeNull()
    expect(noMain.reason).toContain('dépôt principal')
  })

  it('a folder under the temporary root never resolves to a journal above that root (T1-u)', () => {
    const tmpRoot = resolve(tmpdir())

    // (1) Folder outside git under tmpdir()
    const outsideGit = join(scratch, 'no-git', 'deep')
    mkdirSync(outsideGit, { recursive: true })
    const rOutside = resolveJournalOfReference({ cwd: outsideGit })
    expect(rOutside.trackDir).toBeNull()

    // (2) Throwaway git repository without .track + linked worktree under tmpdir()
    const repo = join(scratch, 'throwaway-repo')
    const wt = join(scratch, 'throwaway-wt')
    mkdirSync(repo, { recursive: true })
    git(repo, ['init', '-b', 'main'])
    writeFileSync(join(repo, 'a.txt'), 'a\n', 'utf8')
    git(repo, ['add', 'a.txt'])
    git(repo, ['commit', '-m', 'init'])
    git(repo, ['worktree', 'add', '-b', 'feat-wt', wt])

    for (const dir of [repo, wt]) {
      const res = resolveJournalOfReference({ cwd: dir })
      if (res.trackDir !== null) {
        expect(isInside(res.trackDir, tmpRoot)).toBe(true)
      }
      expect(res.trackDir).toBeNull()
    }
  })
})
