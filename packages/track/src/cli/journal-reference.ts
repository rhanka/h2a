import { execFileSync } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'

import { isCaptureActiveForIdentity } from '../capture/reader.js'
import {
  canonicalPath,
  identityDigest,
  identityOf,
  isInsideDir,
  tmpCeilingFor,
  type JournalIdentityKind,
} from '../journal/identity.js'
import { readJournalIndex } from '../journal/index-store.js'
import { trackStateHome } from '../state-home.js'
import { idsOf } from './events-contains.js'
import { TrackDirNotFoundError, type ResolveOptions } from './resolve.js'

export type JournalResolutionKind =
  | '--track-dir'
  | 'TRACK_DIR'
  | 'dépôt principal'
  | 'dossier'
  | 'journal désigné'
  | `satellite de ${string}`
  | `copie non désignée (${number} copies connues)`
  | 'journal hors dépôt'

export interface JournalResolutionStep {
  step: number
  name: string
  outcome: string
}

export interface JournalResolveOptions extends ResolveOptions {
  /** Optional process environment injection (for `TRACK_STATE_HOME` / `XDG_STATE_HOME` isolation). */
  processEnv?: NodeJS.ProcessEnv | undefined
}

export interface JournalReferenceResult {
  /** Existing readable journal directory, or `null` when absent on disk or blocked by ceiling. */
  trackDir: string | null
  /** Retained journal directory path (including step-6 off-repo path even before creation), or `null`. */
  journal: string | null
  /** True when `journal` exists on disk as a directory. */
  exists: boolean
  resolution: JournalResolutionKind | null
  label: string
  localOnlyEventCount: number
  identity: string
  identityKind: JournalIdentityKind
  identityRoot: string
  startFolder: string
  rewrittenFrom: string | null
  steps: JournalResolutionStep[]
  designated: boolean
  inscriptionAllowed: boolean
  knownCopies: number
  matchedStep: number | null
  /** Path discovered at step 5 when step 5 matched, used by inscription/designation to record copies. */
  step5CopyPath?: string | null
  /** Conductor identity when step 4 matched. */
  conductorIdentity?: string | null
  /** True when capture is active for this folder (DS-2: direct/deferred CLI in registry, or open queue entry). */
  captureActive: boolean
  reason?: string
}

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}

/**
 * Check whether `target` (which may not exist yet) resides inside `ceiling`, handling
 * symlinked temporary roots (e.g. `/var` -> `/private/var`).
 */
function isWithinCeiling(target: string, ceiling: string | undefined): boolean {
  if (ceiling === undefined) return true
  const absTarget = resolve(target)
  const absCeiling = resolve(ceiling)
  if (isInsideDir(absTarget, absCeiling)) return true
  const realCeiling = canonicalPath(ceiling)
  // Resolve the deepest existing ancestor of `target` so nonexistent children under a symlinked
  // tmpdir still match `realCeiling`.
  let cur = absTarget
  for (;;) {
    if (existsSync(cur)) {
      const realAncestor = canonicalPath(cur)
      const tail = absTarget.slice(cur.length)
      return isInsideDir(`${realAncestor}${tail}`, realCeiling)
    }
    const parent = dirname(cur)
    if (parent === cur) break
    cur = parent
  }
  return isInsideDir(canonicalPath(target), realCeiling)
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
    if (ceiling !== undefined && (cur === ceiling || canonicalPath(cur) === canonicalPath(ceiling))) {
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
  if (canonicalPath(localTrackDir) === canonicalPath(refTrackDir)) return 0
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
 * Resolve the journal of reference (spec §6.1, steps 1 to 6 + temporary-root ceiling).
 * Pure read-only: never creates any directory, file, lock, or index entry (V4).
 */
export function resolveJournalOfReference(opts: JournalResolveOptions): JournalReferenceResult {
  const rawStart = resolve(opts.cwd)
  const ceiling = tmpCeilingFor(rawStart)
  const procEnv = opts.processEnv ?? process.env
  const stateHome = trackStateHome(procEnv)
  const stateHomeAllowed = isWithinCeiling(stateHome, ceiling)
  const steps: JournalResolutionStep[] = []

  // Step 1: explicit --track-dir flag or TRACK_DIR environment override.
  const hasFlag = opts.flag !== undefined && opts.flag.length > 0
  const hasEnv = !hasFlag && opts.env !== undefined && opts.env.length > 0
  if (hasFlag || hasEnv) {
    const raw = (hasFlag ? opts.flag : opts.env)!
    const abs = isAbsolute(raw) ? raw : resolve(rawStart, raw)
    if (!isDir(abs)) throw new TrackDirNotFoundError(opts.cwd, true)
    const ident = identityOf(rawStart)
    const captureActive = stateHomeAllowed ? isCaptureActiveForIdentity(ident.id, { env: procEnv }) : false
    const index = stateHomeAllowed ? readJournalIndex(procEnv) : { version: 1 as const, identities: {} }
    const knownCopies = index.identities[ident.id]?.copies.length ?? 0
    const localCopy = walkUpForTrackDir(rawStart, ceiling)
    const resolution: JournalResolutionKind = hasFlag ? '--track-dir' : 'TRACK_DIR'
    steps.push({ step: 1, name: resolution, outcome: `retained: ${abs}` })
    return {
      trackDir: abs,
      journal: abs,
      exists: true,
      resolution,
      label: deriveRawLabel(abs),
      localOnlyEventCount: countLocalOnlyEvents(localCopy, abs),
      identity: ident.id,
      identityKind: ident.kind,
      identityRoot: ident.root,
      startFolder: canonicalPath(rawStart),
      rewrittenFrom: null,
      steps,
      designated: true,
      inscriptionAllowed: true,
      knownCopies,
      matchedStep: 1,
      captureActive,
    }
  }
  steps.push({ step: 1, name: '--track-dir / TRACK_DIR', outcome: 'not set' })

  // Step 2: linked worktree -> main checkout (spec §6.1 step 2).
  const gitDir = git(rawStart, ['rev-parse', '--git-dir'], ceiling)
  const commonDir = git(rawStart, ['rev-parse', '--git-common-dir'], ceiling)
  const isGitRepo = gitDir !== undefined && commonDir !== undefined
  const isLinkedWorktree =
    isGitRepo && canonicalPath(resolve(rawStart, gitDir)) !== canonicalPath(resolve(rawStart, commonDir))

  let effectiveStart = canonicalPath(rawStart)
  let rewrittenFrom: string | null = null
  let localCopyFromWorktree: string | null = null

  if (isLinkedWorktree) {
    const wtTop = git(rawStart, ['rev-parse', '--show-toplevel'], ceiling)
    localCopyFromWorktree =
      wtTop !== undefined && isDir(join(wtTop, '.track'))
        ? join(wtTop, '.track')
        : walkUpForTrackDir(rawStart, wtTop ?? ceiling)
    const porcelain = git(rawStart, ['worktree', 'list', '--porcelain'], ceiling)
    const mainCheckout = porcelain !== undefined ? parseMainWorktree(porcelain) : undefined
    if (mainCheckout === undefined || !isWithinCeiling(mainCheckout, ceiling)) {
      const ident = identityOf(rawStart)
      const captureActive = stateHomeAllowed ? isCaptureActiveForIdentity(ident.id, { env: procEnv }) : false
      steps.push({
        step: 2,
        name: 'linked-worktree',
        outcome:
          mainCheckout === undefined
            ? 'blocked: main checkout not found'
            : 'blocked: main checkout outside temporary root',
      })
      return {
        trackDir: null,
        journal: null,
        exists: false,
        resolution: null,
        label: basename(rawStart) || 'journal',
        localOnlyEventCount: 0,
        identity: ident.id,
        identityKind: ident.kind,
        identityRoot: ident.root,
        startFolder: canonicalPath(rawStart),
        rewrittenFrom: null,
        steps,
        designated: false,
        inscriptionAllowed: false,
        knownCopies: 0,
        matchedStep: null,
        captureActive,
        reason:
          mainCheckout === undefined
            ? 'le dépôt principal ne contient aucun journal .track'
            : 'le dépôt principal est hors du périmètre temporaire',
      }
    }
    effectiveStart = canonicalPath(mainCheckout)
    rewrittenFrom = canonicalPath(rawStart)
    steps.push({ step: 2, name: 'linked-worktree', outcome: `rewritten to ${effectiveStart}` })
  } else {
    steps.push({ step: 2, name: 'linked-worktree', outcome: 'not a linked worktree' })
  }

  // Identity & read-only index lookup (capped at temporary root).
  const ident = identityOf(effectiveStart)
  const captureActive = stateHomeAllowed ? isCaptureActiveForIdentity(ident.id, { env: procEnv }) : false
  const index = stateHomeAllowed ? readJournalIndex(procEnv) : { version: 1 as const, identities: {} }
  const entry = index.identities[ident.id]
  const indexCopies = entry?.copies ?? []
  const offRepoRoot = join(canonicalPath(stateHome), 'journals')

  // Step 3: journal designated for the project/folder in the local index.
  if (entry?.reference !== null && entry?.reference !== undefined) {
    const refPath = entry.reference.path
    if (!isWithinCeiling(refPath, ceiling)) {
      steps.push({ step: 3, name: 'designated', outcome: 'skipped: outside temporary root' })
    } else {
      const exists = isDir(refPath)
      const localCopy = localCopyFromWorktree ?? walkUpForTrackDir(effectiveStart, ceiling)
      const isOffRepoRef = isInsideDir(canonicalPath(refPath), offRepoRoot)
      const label = isOffRepoRef ? (basename(entry.root) || 'journal') : deriveRawLabel(refPath)
      steps.push({
        step: 3,
        name: 'designated',
        outcome: exists ? `retained: ${refPath}` : `retained (absent on disk): ${refPath}`,
      })
      return {
        trackDir: exists ? refPath : null,
        journal: refPath,
        exists,
        resolution: 'journal désigné',
        label,
        localOnlyEventCount: exists ? countLocalOnlyEvents(localCopy, refPath) : 0,
        identity: ident.id,
        identityKind: ident.kind,
        identityRoot: ident.root,
        startFolder: effectiveStart,
        rewrittenFrom,
        steps,
        designated: true,
        inscriptionAllowed: exists,
        knownCopies: indexCopies.length,
        matchedStep: 3,
        captureActive,
        ...(!exists ? { reason: `le journal désigné n'existe pas sur disque : ${refPath}` } : {}),
      }
    }
  } else {
    steps.push({ step: 3, name: 'designated', outcome: 'none' })
  }

  // Step 4: attached satellite -> conductor's designated journal.
  if (entry?.attachedTo !== null && entry?.attachedTo !== undefined) {
    const conductorId = entry.attachedTo
    const condEntry = index.identities[conductorId]
    if (
      condEntry?.reference !== null &&
      condEntry?.reference !== undefined &&
      isWithinCeiling(condEntry.reference.path, ceiling)
    ) {
      const condJournal = condEntry.reference.path
      const exists = isDir(condJournal)
      const condLabel = basename(condEntry.root) || deriveRawLabel(condJournal)
      const isOffRepoCond = isInsideDir(canonicalPath(condJournal), offRepoRoot)
      const journalLabel = isOffRepoCond ? condLabel : deriveRawLabel(condJournal)
      const localCopy = localCopyFromWorktree ?? walkUpForTrackDir(effectiveStart, ceiling)
      steps.push({
        step: 4,
        name: 'attached-satellite',
        outcome: `retained: ${condJournal} (conductor ${conductorId})`,
      })
      return {
        trackDir: exists ? condJournal : null,
        journal: condJournal,
        exists,
        resolution: `satellite de ${condLabel}`,
        label: journalLabel,
        localOnlyEventCount: exists ? countLocalOnlyEvents(localCopy, condJournal) : 0,
        identity: ident.id,
        identityKind: ident.kind,
        identityRoot: ident.root,
        startFolder: effectiveStart,
        rewrittenFrom,
        steps,
        designated: true,
        inscriptionAllowed: exists,
        knownCopies: indexCopies.length,
        matchedStep: 4,
        conductorIdentity: conductorId,
        captureActive,
        ...(!exists ? { reason: `le journal du conducteur n'existe pas sur disque : ${condJournal}` } : {}),
      }
    }
    steps.push({ step: 4, name: 'attached-satellite', outcome: 'conductor has no designated journal' })
  } else {
    steps.push({ step: 4, name: 'attached-satellite', outcome: 'not attached' })
  }

  // Step 5: nearest ancestor `.track` (capped at temporary root when started under it).
  const found = walkUpForTrackDir(effectiveStart, ceiling)
  if (found !== null) {
    const knownSet = new Set(indexCopies.map((c) => canonicalPath(c.path)))
    const foundCanon = canonicalPath(found)
    const allCopies = new Set(knownSet)
    allCopies.add(foundCanon)

    if (allCopies.size > 1) {
      const count = allCopies.size
      const resolution: JournalResolutionKind = `copie non désignée (${count} copies connues)`
      steps.push({
        step: 5,
        name: 'nearest-ancestor',
        outcome: `retained (undesignated copy, ${count} known copies): ${found}`,
      })
      return {
        trackDir: found,
        journal: found,
        exists: true,
        resolution,
        label: deriveRawLabel(found),
        localOnlyEventCount: countLocalOnlyEvents(localCopyFromWorktree, found),
        identity: ident.id,
        identityKind: ident.kind,
        identityRoot: ident.root,
        startFolder: effectiveStart,
        rewrittenFrom,
        steps,
        designated: false,
        inscriptionAllowed: false,
        knownCopies: count,
        matchedStep: 5,
        step5CopyPath: found,
        captureActive,
      }
    }

    const resolution: JournalResolutionKind = ident.kind === 'project' ? 'dépôt principal' : 'dossier'
    steps.push({ step: 5, name: 'nearest-ancestor', outcome: `retained: ${found}` })
    return {
      trackDir: found,
      journal: found,
      exists: true,
      resolution,
      label: deriveRawLabel(found),
      localOnlyEventCount: countLocalOnlyEvents(localCopyFromWorktree, found),
      identity: ident.id,
      identityKind: ident.kind,
      identityRoot: ident.root,
      startFolder: effectiveStart,
      rewrittenFrom,
      steps,
      designated: false,
      inscriptionAllowed: true,
      knownCopies: knownSet.size,
      matchedStep: 5,
      step5CopyPath: found,
      captureActive,
    }
  }
  steps.push({ step: 5, name: 'nearest-ancestor', outcome: 'none' })

  // Step 6: journal outside the repository under `trackStateHome/journals/<digest>/.track`.
  if (!stateHomeAllowed) {
    steps.push({ step: 6, name: 'off-repo-journal', outcome: 'blocked: state home outside temporary root' })
    return {
      trackDir: null,
      journal: null,
      exists: false,
      resolution: null,
      label: basename(effectiveStart) || 'journal',
      localOnlyEventCount: 0,
      identity: ident.id,
      identityKind: ident.kind,
      identityRoot: ident.root,
      startFolder: effectiveStart,
      rewrittenFrom,
      steps,
      designated: false,
      inscriptionAllowed: false,
      knownCopies: indexCopies.length,
      matchedStep: null,
      captureActive,
      reason:
        rewrittenFrom !== null
          ? 'le dépôt principal ne contient aucun journal .track'
          : `aucun journal .track trouvé depuis ${opts.cwd} et aucune captation active`,
    }
  }

  const offRepoPath = join(stateHome, 'journals', identityDigest(ident.id), '.track')
  const offRepoExists = isDir(offRepoPath)
  const offRepoLabel = basename(entry?.root ?? ident.root) || 'journal'
  steps.push({
    step: 6,
    name: 'off-repo-journal',
    outcome: offRepoExists
      ? `retained: ${offRepoPath}`
      : `absent (created at first inscription): ${offRepoPath}`,
  })
  return {
    trackDir: offRepoExists ? offRepoPath : null,
    journal: offRepoPath,
    exists: offRepoExists,
    resolution: 'journal hors dépôt',
    label: offRepoLabel,
    localOnlyEventCount: offRepoExists ? countLocalOnlyEvents(localCopyFromWorktree, offRepoPath) : 0,
    identity: ident.id,
    identityKind: ident.kind,
    identityRoot: ident.root,
    startFolder: effectiveStart,
    rewrittenFrom,
    steps,
    designated: false,
    inscriptionAllowed: true,
    knownCopies: indexCopies.length,
    matchedStep: 6,
    captureActive,
    ...(!offRepoExists
      ? {
          reason:
            rewrittenFrom !== null
              ? 'le dépôt principal ne contient aucun journal .track'
              : `aucun journal .track trouvé depuis ${opts.cwd} et aucune captation active`,
        }
      : {}),
  }
}
