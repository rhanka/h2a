import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { computeDurableWorkspaceId } from '../workspace-id.js'
import { folderIdentity, identityOf, projectIdentity } from './identity.js'

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

function initRepo(dir: string, filename = 'README.md', content = '# Repo\n'): string {
  mkdirSync(dir, { recursive: true })
  git(dir, ['init', '-b', 'main'])
  writeFileSync(join(dir, filename), content, 'utf8')
  git(dir, ['add', filename])
  git(dir, ['commit', '-m', 'init'])
  return git(dir, ['rev-list', '--max-parents=0', 'HEAD'])
}

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'track-identity-'))
})

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true })
})

describe('journal identities (lot 4a)', () => {
  it('two clones of one repository share the project identity (T4a-b)', () => {
    const repoA = join(scratch, 'repo-a')
    const rootSha = initRepo(repoA)
    const repoB = join(scratch, 'repo-b')
    git(scratch, ['clone', repoA, repoB])
    const linkedWt = join(scratch, 'repo-a-wt')
    git(repoA, ['worktree', 'add', '-b', 'wt-branch', linkedWt])

    const expected = computeDurableWorkspaceId(rootSha, '')
    expect(expected.startsWith('ws:')).toBe(true)

    const idA = projectIdentity(repoA)
    const idB = projectIdentity(repoB)
    const idWt = projectIdentity(linkedWt)

    expect(idA).toBe(expected)
    expect(idB).toBe(expected)
    expect(idWt).toBe(expected)

    const identA = identityOf(repoA)
    const identB = identityOf(repoB)
    expect(identA.id).toBe(expected)
    expect(identA.kind).toBe('project')
    expect(identB.id).toBe(expected)
    expect(identB.kind).toBe('project')
  })

  it('a folder outside git gets a dir identity and the ws conformance vectors pass unchanged (T4a-e)', () => {
    const outsideParent = join(scratch, 'outside-parent')
    const outsideChild = join(outsideParent, 'child')
    mkdirSync(outsideChild, { recursive: true })

    expect(projectIdentity(outsideParent)).toBeUndefined()
    expect(projectIdentity(outsideChild)).toBeUndefined()

    const realParent = realpathSync(outsideParent)
    const realChild = realpathSync(outsideChild)
    const expectedParent = `dir:${createHash('sha256').update(realParent, 'utf8').digest('hex')}`
    const expectedChild = `dir:${createHash('sha256').update(realChild, 'utf8').digest('hex')}`

    expect(folderIdentity(outsideParent)).toBe(expectedParent)
    expect(folderIdentity(outsideChild)).toBe(expectedChild)
    expect(folderIdentity(outsideParent)).not.toBe(folderIdentity(outsideChild))

    const identParent = identityOf(outsideParent)
    const identChild = identityOf(outsideChild)
    expect(identParent).toEqual({ id: expectedParent, kind: 'folder', root: realParent })
    expect(identChild).toEqual({ id: expectedChild, kind: 'folder', root: realChild })

    // Published ws: conformance vector remains unchanged
    expect(computeDurableWorkspaceId('0123456789abcdef0123456789abcdef01234567', '')).toBe(
      `ws:${createHash('sha256').update('0123456789abcdef0123456789abcdef01234567\n', 'utf8').digest('hex')}`,
    )
  })
})
