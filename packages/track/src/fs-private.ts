import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import {
  chmodSync,
  closeSync,
  constants as fsConstants,
  fchmodSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  type Stats,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'

import { tmpCeilingFor } from './journal/identity.js'
import { DomainError } from './model/item.js'

const O_NOFOLLOW = fsConstants.O_NOFOLLOW ?? 0
const O_DIRECTORY = fsConstants.O_DIRECTORY ?? 0

function isEnoent(err: unknown): boolean {
  return (err as NodeJS.ErrnoException | null)?.code === 'ENOENT'
}

/**
 * Inspect `targetPath` via `lstatSync` without following symbolic links.
 * Returns `undefined` ONLY when `ENOENT`; throws `DomainError` (or custom error) on symlinks or
 * any other filesystem error (fail-closed).
 */
export function lstatNoFollow(
  targetPath: string,
  makeError: (msg: string) => Error = (msg) => new DomainError(msg),
): Stats | undefined {
  let st: Stats
  try {
    st = lstatSync(targetPath)
  } catch (err) {
    if (isEnoent(err)) return undefined
    throw makeError(`cannot stat ${targetPath}: ${err instanceof Error ? err.message : String(err)}`)
  }
  if (st.isSymbolicLink()) {
    throw makeError(`refusing symbolic link at ${targetPath}`)
  }
  return st
}

/**
 * Harden an existing directory's permissions to `mode` (default `0o700`) using an fd opened with
 * `O_DIRECTORY | O_NOFOLLOW` to eliminate path-based TOCTOU windows.
 */
function hardenDirMode(dirPath: string, mode = 0o700): void {
  if (O_DIRECTORY !== 0) {
    let fd: number | undefined
    try {
      fd = openSync(dirPath, fsConstants.O_RDONLY | O_DIRECTORY | O_NOFOLLOW)
      fchmodSync(fd, mode)
      return
    } finally {
      if (fd !== undefined) closeSync(fd)
    }
  }
  chmodSync(dirPath, mode)
}

/**
 * Ensure `dirPath` exists as a private (`0700`) real directory without following symbolic links.
 * Rejects any symbolic link at `dirPath` or its immediate existing ancestor when creating segments.
 */
export function ensurePrivateDirHardened(dirPath: string): void {
  const abs = resolve(dirPath)
  const existing = lstatNoFollow(abs)
  if (existing !== undefined) {
    if (!existing.isDirectory()) {
      throw new DomainError(`expected directory at ${abs}`)
    }
    hardenDirMode(abs, 0o700)
    return
  }

  const missing: string[] = [abs]
  let cur = dirname(abs)
  while (cur !== missing[missing.length - 1]) {
    const st = lstatNoFollow(cur)
    if (st !== undefined) {
      if (!st.isDirectory()) {
        throw new DomainError(`expected directory at ${cur}`)
      }
      break
    }
    missing.push(cur)
    const parent = dirname(cur)
    if (parent === cur) break
    cur = parent
  }

  for (let i = missing.length - 1; i >= 0; i--) {
    const seg = missing[i]!
    try {
      mkdirSync(seg, { mode: 0o700 })
    } catch (err) {
      if ((err as NodeJS.ErrnoException | null)?.code !== 'EEXIST') throw err
    }
    const st = lstatNoFollow(seg)
    if (st === undefined || !st.isDirectory()) {
      throw new DomainError(`expected directory at ${seg}`)
    }
    hardenDirMode(seg, 0o700)
  }
}

/**
 * Read a UTF-8 file without following symbolic links (`lstatSync` + `O_RDONLY | O_NOFOLLOW`).
 * Returns `undefined` ONLY when the file does not exist (`ENOENT`); fails closed on symlinks,
 * non-regular files, and permission/IO errors.
 */
export function readFileNoFollow(
  filePath: string,
  makeError: (msg: string) => Error = (msg) => new DomainError(msg),
): string | undefined {
  const st = lstatNoFollow(filePath, makeError)
  if (st === undefined) return undefined
  if (!st.isFile()) {
    throw makeError(`expected regular file at ${filePath}`)
  }
  let fd: number | undefined
  try {
    fd = openSync(filePath, fsConstants.O_RDONLY | O_NOFOLLOW)
    if (!fstatSync(fd).isFile()) {
      throw makeError(`expected regular file at ${filePath}`)
    }
    return readFileSync(fd, 'utf8')
  } catch (err) {
    if (err instanceof DomainError) throw err
    throw makeError(`cannot read ${filePath}: ${err instanceof Error ? err.message : String(err)}`)
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}

/**
 * Atomically write a private (`0600`) file using `O_CREAT | O_EXCL | O_WRONLY | O_NOFOLLOW`,
 * `fchmodSync`, and `fsyncSync` before `renameSync`. Refuses symbolic links on the target file
 * and its parent directory.
 */
export function writeFileAtomicPrivate(
  filePath: string,
  content: string,
  mode = 0o600,
  makeError: (msg: string) => Error = (msg) => new DomainError(msg),
): void {
  const parent = dirname(filePath)
  const parentSt = lstatNoFollow(parent, makeError)
  if (parentSt === undefined || !parentSt.isDirectory()) {
    throw makeError(`parent directory does not exist or is not a directory: ${parent}`)
  }
  const existingTarget = lstatNoFollow(filePath, makeError)
  if (existingTarget !== undefined && !existingTarget.isFile()) {
    throw makeError(`refusing non-regular file target at ${filePath}`)
  }

  const tmpFile = `${filePath}.tmp-${process.pid}-${randomBytes(6).toString('hex')}`
  const flags =
    fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY | O_NOFOLLOW
  let fd: number | undefined
  try {
    fd = openSync(tmpFile, flags, mode)
    fchmodSync(fd, mode)
    writeFileSync(fd, content, 'utf8')
    fsyncSync(fd)
    closeSync(fd)
    fd = undefined
    renameSync(tmpFile, filePath)
  } catch (err) {
    if (fd !== undefined) {
      try {
        closeSync(fd)
      } catch {
        // ignore close failure
      }
    }
    try {
      unlinkSync(tmpFile)
    } catch {
      // ignore cleanup failure
    }
    throw err
  }
}

/**
 * Determine whether `targetPath` sits inside a Git work tree and is NOT gitignored.
 * Uses `--` before `targetPath` in `git check-ignore` and propagates `procEnv` alongside
 * `GIT_CEILING_DIRECTORIES` for temporary directories.
 */
export function isPathInUnignoredGitTree(
  targetPath: string,
  procEnv: NodeJS.ProcessEnv = process.env,
): boolean {
  const absTarget = resolve(targetPath)
  let existingDir = absTarget
  for (;;) {
    try {
      const st = lstatSync(existingDir)
      if (st.isDirectory()) break
    } catch {
      // walk up
    }
    const parent = dirname(existingDir)
    if (parent === existingDir) return false
    existingDir = parent
  }

  const ceiling = tmpCeilingFor(existingDir)
  const env: NodeJS.ProcessEnv =
    ceiling !== undefined ? { ...procEnv, GIT_CEILING_DIRECTORIES: ceiling } : { ...procEnv }

  const inTree = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], {
    cwd: existingDir,
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  if (inTree.status !== 0 || inTree.stdout.trim() !== 'true') return false

  const ignored = spawnSync('git', ['check-ignore', '-q', '--', absTarget], {
    cwd: existingDir,
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'ignore', 'ignore'],
  })
  // git check-ignore exits 0 when ignored, 1 when NOT ignored
  return ignored.status === 1
}

/**
 * Refuse a `TRACK_STATE_HOME` that sits inside an unignored Git working tree (spec §7.1, C3).
 * Checks a child path (`<stateHome>/capture`) so directory-only `.gitignore` rules (e.g. `state/`)
 * match accurately even before `stateHome` is created on disk.
 */
export function assertStateHomeOutsideGit(
  stateHome: string,
  procEnv: NodeJS.ProcessEnv = process.env,
): void {
  const probe = join(resolve(stateHome), 'capture')
  if (isPathInUnignoredGitTree(probe, procEnv)) {
    throw new DomainError(
      `refusing TRACK_STATE_HOME inside an unignored git working tree: ${stateHome}`,
    )
  }
}
