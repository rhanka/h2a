import { execFileSync } from 'node:child_process'
import { existsSync, realpathSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'

import { idsOf } from './events-contains.js'
import { TrackDirNotFoundError, type ResolveOptions } from './resolve.js'

export type JournalResolutionKind = '--track-dir' | 'TRACK_DIR' | 'dépôt principal' | 'dossier'

export interface JournalReferenceResult {
  trackDir: string | null
  resolution: JournalResolutionKind | null
  label: string
  localOnlyEventCount: number
  reason?: string
}

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}

function canonical(p: string): string {
  const abs = resolve(p)
  try {
    return realpathSync(abs)
  } catch {
    return abs
  }
}

function isInsideDir(child: string, parent: string): boolean {
  return child === parent || child.startsWith(`${parent}/`)
}

function tmpCeilingFor(dir: string): string | undefined {
  const absDir = resolve(dir)
  const tmpRoot = resolve(tmpdir())
  if (isInsideDir(absDir, tmpRoot)) return tmpRoot
  const realDir = canonical(dir)
  const realTmp = canonical(tmpdir())
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

function walkUpForTrackDir(startDir: string, ceiling: string | undefined): string | null {
  let cur = resolve(startDir)
  for (;;) {
    const candidate = join(cur, '.track')
    if (existsSync(candidate) && isDir(candidate)) return candidate
    if (ceiling !== undefined && (cur === ceiling || canonical(cur) === canonical(ceiling))) {
      return null
    }
    const parent = dirname(cur)
    if (parent === cur) return null
    cur = parent
  }
}

function deriveRawLabel(trackDir: string): string {
  const abs = resolve(trackDir)
  const holder = basename(abs) === '.track' ? dirname(abs) : abs
  const name = basename(holder)
  return name.length > 0 ? name : 'journal'
}

function countLocalOnlyEvents(localTrackDir: string | null, refTrackDir: string): number {
  if (localTrackDir === null) return 0
  if (canonical(localTrackDir) === canonical(refTrackDir)) return 0
  const localEventsPath = join(localTrackDir, 'events.jsonl')
  if (!existsSync(localEventsPath)) return 0
  const refEventsPath = join(refTrackDir, 'events.jsonl')
  try {
    const localIds = idsOf(localEventsPath)
    if (localIds.size === 0) return 0
    const refIds = existsSync(refEventsPath) ? idsOf(refEventsPath) : new Set<string>()
    let absent = 0
    for (const id of localIds) {
      if (!refIds.has(id)) absent++
    }
    return absent
  } catch {
    return 0
  }
}

/**
 * Resolve the journal of reference for the owner table (spec §6.1, steps 1, 2, 5, 7 + ceiling).
 * Pure read-only: never creates any directory, file, lock, or index entry (V4).
 */
export function resolveJournalOfReference(opts: ResolveOptions): JournalReferenceResult {
  const startCwd = resolve(opts.cwd)
  const ceiling = tmpCeilingFor(startCwd)

  // Step 1: explicit --track-dir flag or TRACK_DIR environment override.
  const hasFlag = opts.flag !== undefined && opts.flag.length > 0
  const hasEnv = !hasFlag && opts.env !== undefined && opts.env.length > 0
  if (hasFlag || hasEnv) {
    const raw = (hasFlag ? opts.flag : opts.env)!
    const abs = isAbsolute(raw) ? raw : resolve(startCwd, raw)
    if (!isDir(abs)) throw new TrackDirNotFoundError(opts.cwd, true)
    const localCopy = walkUpForTrackDir(startCwd, ceiling)
    return {
      trackDir: abs,
      resolution: hasFlag ? '--track-dir' : 'TRACK_DIR',
      label: deriveRawLabel(abs),
      localOnlyEventCount: countLocalOnlyEvents(localCopy, abs),
    }
  }

  // Step 2: linked worktree -> main checkout (workspace-id.ts:78-86 detection).
  const gitDir = git(startCwd, ['rev-parse', '--git-dir'], ceiling)
  const commonDir = git(startCwd, ['rev-parse', '--git-common-dir'], ceiling)
  const isGitRepo = gitDir !== undefined && commonDir !== undefined
  const isLinkedWorktree =
    isGitRepo && canonical(resolve(startCwd, gitDir)) !== canonical(resolve(startCwd, commonDir))

  if (isLinkedWorktree) {
    const wtTop = git(startCwd, ['rev-parse', '--show-toplevel'], ceiling)
    const localCopy =
      wtTop !== undefined && isDir(join(wtTop, '.track'))
        ? join(wtTop, '.track')
        : walkUpForTrackDir(startCwd, wtTop ?? ceiling)
    const porcelain = git(startCwd, ['worktree', 'list', '--porcelain'], ceiling)
    const mainCheckout = porcelain !== undefined ? parseMainWorktree(porcelain) : undefined
    if (mainCheckout !== undefined) {
      const mainAbs = canonical(mainCheckout)
      if (ceiling !== undefined && !isInsideDir(mainAbs, canonical(ceiling))) {
        return {
          trackDir: null,
          resolution: null,
          label: basename(startCwd) || 'journal',
          localOnlyEventCount: 0,
          reason: 'le dépôt principal est hors du périmètre temporaire',
        }
      }
      const mainTrackDir = walkUpForTrackDir(mainAbs, ceiling)
      if (mainTrackDir !== null) {
        return {
          trackDir: mainTrackDir,
          resolution: 'dépôt principal',
          label: deriveRawLabel(mainTrackDir),
          localOnlyEventCount: countLocalOnlyEvents(localCopy, mainTrackDir),
        }
      }
      return {
        trackDir: null,
        resolution: null,
        label: basename(mainAbs) || 'journal',
        localOnlyEventCount: 0,
        reason: `le dépôt principal ne contient aucun journal .track`,
      }
    }
    return {
      trackDir: null,
      resolution: null,
      label: basename(startCwd) || 'journal',
      localOnlyEventCount: 0,
      reason: `le dépôt principal ne contient aucun journal .track`,
    }
  }

  // Step 5: nearest ancestor `.track` (capped at temporary root when started under it).
  const found = walkUpForTrackDir(startCwd, ceiling)
  if (found !== null) {
    return {
      trackDir: found,
      resolution: isGitRepo ? 'dépôt principal' : 'dossier',
      label: deriveRawLabel(found),
      localOnlyEventCount: 0,
    }
  }

  // Step 7: nothing readable (G4).
  return {
    trackDir: null,
    resolution: null,
    label: basename(startCwd) || 'journal',
    localOnlyEventCount: 0,
    reason: `aucun journal .track trouvé depuis ${opts.cwd} et aucune captation active`,
  }
}
