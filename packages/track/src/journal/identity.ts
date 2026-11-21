import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

import { computeDurableWorkspaceId } from '../workspace-id.js'

export type JournalIdentityKind = 'project' | 'folder'

export interface JournalIdentity {
  id: string
  kind: JournalIdentityKind
  /** Canonical project root (main checkout inside git, or the folder itself outside git). */
  root: string
}

const IDENTITY_RE = /^(?:ws|dir):([0-9a-f]{64})$/u

export function canonicalPath(p: string): string {
  const abs = resolve(p)
  try {
    return realpathSync(abs)
  } catch {
    return abs
  }
}

export function isInsideDir(child: string, parent: string): boolean {
  return child === parent || child.startsWith(`${parent}/`)
}

export function tmpCeilingFor(dir: string): string | undefined {
  const absDir = resolve(dir)
  const tmpRoot = resolve(tmpdir())
  if (isInsideDir(absDir, tmpRoot)) return tmpRoot
  const realDir = canonicalPath(dir)
  const realTmp = canonicalPath(tmpdir())
  if (isInsideDir(realDir, realTmp)) return realTmp
  return undefined
}

function git(cwd: string, args: string[], ceiling: string | undefined): string | undefined {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      ...(ceiling !== undefined ? { env: { ...process.env, GIT_CEILING_DIRECTORIES: ceiling } } : {}),
    }).trim()
  } catch {
    return undefined
  }
}

function parseMainWorktree(porcelain: string): string | undefined {
  for (const line of porcelain.split('\n')) {
    if (line.startsWith('worktree ')) {
      const wtPath = line.slice('worktree '.length).trim()
      if (wtPath.length > 0) return wtPath
    }
  }
  return undefined
}

/**
 * Project identity shared by every clone and linked worktree of a git repository (spec §6.2):
 * sorted root commits (`git rev-list --max-parents=0 HEAD`), comma-joined, passed to
 * `computeDurableWorkspaceId(roots, '')`. Returns `undefined` outside git or when capped by
 * the temporary-root ceiling.
 */
export function projectIdentity(cwd: string): string | undefined {
  const start = resolve(cwd)
  const ceiling = tmpCeilingFor(start)
  const rawRoots = git(start, ['rev-list', '--max-parents=0', 'HEAD'], ceiling)
  if (rawRoots === undefined || rawRoots.length === 0) return undefined
  const roots = rawRoots
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  if (roots.length === 0) return undefined
  const rootCommitSHA = [...roots].sort().join(',')

  // Respect the temporary-root ceiling if a linked worktree points to a main checkout above it.
  if (ceiling !== undefined) {
    const porcelain = git(start, ['worktree', 'list', '--porcelain'], ceiling)
    const mainCheckout = porcelain !== undefined ? parseMainWorktree(porcelain) : undefined
    if (mainCheckout !== undefined && !isInsideDir(canonicalPath(mainCheckout), canonicalPath(ceiling))) {
      return undefined
    }
  }

  return computeDurableWorkspaceId(rootCommitSHA, '')
}

/**
 * Folder identity for a directory outside git (spec §6.2): `dir:` followed by the SHA-256 hex
 * digest of the canonical real path of exactly that directory (no ancestor adopted).
 */
export function folderIdentity(dir: string): string {
  const real = canonicalPath(dir)
  const digest = createHash('sha256').update(real, 'utf8').digest('hex')
  return `dir:${digest}`
}

/**
 * Resolve the canonical main checkout root of a git repository containing `cwd`, respecting
 * the temporary-root ceiling. Returns `undefined` outside git or when outside the ceiling.
 */
export function gitProjectRoot(cwd: string): string | undefined {
  const start = resolve(cwd)
  const ceiling = tmpCeilingFor(start)
  const porcelain = git(start, ['worktree', 'list', '--porcelain'], ceiling)
  const mainCheckout = porcelain !== undefined ? parseMainWorktree(porcelain) : undefined
  const top = mainCheckout ?? git(start, ['rev-parse', '--show-toplevel'], ceiling)
  if (top === undefined || top.length === 0) return undefined
  const canon = canonicalPath(top)
  if (ceiling !== undefined && !isInsideDir(canon, canonicalPath(ceiling))) {
    return undefined
  }
  return canon
}

/**
 * Compute the identity of `cwd`: `projectIdentity(cwd)` (kind `'project'`) inside git, else
 * `folderIdentity(cwd)` (kind `'folder'`) for exactly that directory.
 */
export function identityOf(cwd: string): JournalIdentity {
  const projId = projectIdentity(cwd)
  if (projId !== undefined) {
    const root = gitProjectRoot(cwd) ?? canonicalPath(cwd)
    return { id: projId, kind: 'project', root }
  }
  const real = canonicalPath(cwd)
  return { id: folderIdentity(real), kind: 'folder', root: real }
}

/** Extract the 64-hex digest from a `ws:` or `dir:` identity (used for off-repo journal paths). */
export function identityDigest(id: string): string {
  const m = IDENTITY_RE.exec(id)
  if (m !== null && m[1] !== undefined) return m[1]
  return createHash('sha256').update(id, 'utf8').digest('hex')
}

/** True when `value` is a Track project (`ws:`) or folder (`dir:`) identity digest. */
export function isJournalIdentity(value: string): boolean {
  return IDENTITY_RE.test(value)
}
