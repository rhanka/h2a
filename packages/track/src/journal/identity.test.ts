import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { computeDurableWorkspaceId, durableWorkspaceId } from '../workspace-id.js'
import { folderIdentity, identityOf, projectIdentity } from './identity.js'

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

describe('journal identities (lot 4a)', () => {
  let scratch: string

  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), 'track-identity-'))
  })

  afterEach(() => {
    rmSync(scratch, { recursive: true, force: true })
  })

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

describe('projectIdentity (lot 2)', () => {
  let scratch: string

  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), 'track-proj-id-'))
  })

  afterEach(() => {
    rmSync(scratch, { recursive: true, force: true })
  })

  it('yields the same identity from a repository, a subdirectory, a linked worktree, and a separate clone', () => {
    const mainRepo = join(scratch, 'main-repo')
    mkdirSync(mainRepo, { recursive: true })
    git(mainRepo, ['init', '-q', '-b', 'main'])
    git(mainRepo, ['commit', '-q', '--allow-empty', '-m', 'root'])
    git(mainRepo, ['commit', '-q', '--allow-empty', '-m', 'second'])

    const subDir = join(mainRepo, 'a', 'b')
    mkdirSync(subDir, { recursive: true })

    const wtDir = join(scratch, 'linked-wt')
    git(mainRepo, ['worktree', 'add', '-q', '-b', 'feat-wt', wtDir])

    const cloneDir = join(scratch, 'clone-repo')
    git(scratch, ['clone', '-q', mainRepo, cloneDir])

    const rootSha = git(mainRepo, ['rev-list', '--max-parents=0', 'HEAD'])
    const expected = computeDurableWorkspaceId(rootSha, '')

    expect(projectIdentity(mainRepo)).toBe(expected)
    expect(projectIdentity(subDir)).toBe(expected)
    expect(projectIdentity(wtDir)).toBe(expected)
    expect(projectIdentity(cloneDir)).toBe(expected)

    // Distinct from durableWorkspaceId on the linked worktree
    expect(durableWorkspaceId(wtDir)).not.toBe(expected)
  })

  it('returns undefined outside git even when the temp dir sits inside a real checkout', () => {
    const plain = join(scratch, 'plain-no-git')
    mkdirSync(plain, { recursive: true })
    expect(projectIdentity(plain)).toBeUndefined()
  })

  it('sorts multiple root commits ascending and joins them with a comma', () => {
    const repo = join(scratch, 'multi-root')
    mkdirSync(repo, { recursive: true })
    git(repo, ['init', '-q', '-b', 'main'])
    git(repo, ['commit', '-q', '--allow-empty', '-m', 'root-1'])
    git(repo, ['checkout', '-q', '--orphan', 'other'])
    git(repo, ['commit', '-q', '--allow-empty', '-m', 'root-2'])
    git(repo, ['checkout', '-q', 'main'])
    git(repo, ['merge', '-q', '--allow-unrelated-histories', '--no-edit', 'other'])

    const roots = git(repo, ['rev-list', '--max-parents=0', 'HEAD'])
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
    expect(roots.length).toBeGreaterThanOrEqual(2)
    const expected = computeDurableWorkspaceId([...roots].sort().join(','), '')
    expect(projectIdentity(repo)).toBe(expected)
  })
})
