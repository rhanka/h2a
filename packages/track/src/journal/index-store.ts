import { randomBytes } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'

import { withFileLock } from '../events/lock.js'
import { DomainError } from '../model/item.js'
import { trackStateHome } from '../state-home.js'
import { canonicalPath } from './identity.js'

export const JOURNAL_INDEX_VERSION = 1 as const
export const JOURNAL_INDEX_FILENAME = 'journals.json'

export interface JournalReferenceDesignation {
  path: string
  by: string
  at: string
}

export interface JournalKnownCopy {
  path: string
  firstSeen: string
  lastSeen: string
}

export interface JournalIndexEntry {
  root: string
  reference: JournalReferenceDesignation | null
  copies: JournalKnownCopy[]
  attachedTo: string | null
}

/**
 * Versioned schema of `journals.json` under the Track state home (spec §6.3).
 * Read by h2a at lot 4b without invoking Track; any shape change bumps `version`.
 */
export interface JournalIndexV1 {
  version: typeof JOURNAL_INDEX_VERSION
  identities: Record<string, JournalIndexEntry>
}

export interface JournalIndexOptions {
  env?: NodeJS.ProcessEnv | undefined
  now?: string | undefined
}

export function journalIndexPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(trackStateHome(env), JOURNAL_INDEX_FILENAME)
}

export function ensurePrivateDir(dirPath: string): void {
  mkdirSync(dirPath, { recursive: true, mode: 0o700 })
  chmodSync(dirPath, 0o700)
}

function emptyIndex(): JournalIndexV1 {
  return { version: JOURNAL_INDEX_VERSION, identities: {} }
}

function parseIndex(raw: string, filePath: string): JournalIndexV1 {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    throw new DomainError(
      `journal index ${filePath} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new DomainError(`journal index ${filePath} must be a JSON object`)
  }
  const obj = parsed as Record<string, unknown>
  if (obj['version'] !== JOURNAL_INDEX_VERSION) {
    throw new DomainError(
      `unsupported journal index version ${String(obj['version'])} in ${filePath} (expected ${JOURNAL_INDEX_VERSION})`,
    )
  }
  const ids = obj['identities']
  if (typeof ids !== 'object' || ids === null || Array.isArray(ids)) {
    throw new DomainError(`journal index ${filePath} has invalid identities map`)
  }
  return {
    version: JOURNAL_INDEX_VERSION,
    identities: ids as Record<string, JournalIndexEntry>,
  }
}

/**
 * Pure read-only load of `journals.json` (V4): never creates the file or its directory.
 */
export function readJournalIndex(env: NodeJS.ProcessEnv = process.env): JournalIndexV1 {
  const filePath = journalIndexPath(env)
  if (!existsSync(filePath)) return emptyIndex()
  return parseIndex(readFileSync(filePath, 'utf8'), filePath)
}

function writeIndexAtomically(filePath: string, index: JournalIndexV1): void {
  const tmpFile = `${filePath}.tmp-${process.pid}-${randomBytes(6).toString('hex')}`
  const payload = `${JSON.stringify(index, null, 2)}\n`
  try {
    writeFileSync(tmpFile, payload, { encoding: 'utf8', mode: 0o600 })
    chmodSync(tmpFile, 0o600)
    renameSync(tmpFile, filePath)
  } catch (err) {
    try {
      unlinkSync(tmpFile)
    } catch {
      // ignore cleanup failure
    }
    throw err
  }
}

function mutateJournalIndex<T>(
  env: NodeJS.ProcessEnv,
  fn: (index: JournalIndexV1) => T,
): T {
  const stateHome = trackStateHome(env)
  ensurePrivateDir(stateHome)
  const filePath = join(stateHome, JOURNAL_INDEX_FILENAME)
  return withFileLock(filePath, () => {
    const index = existsSync(filePath)
      ? parseIndex(readFileSync(filePath, 'utf8'), filePath)
      : emptyIndex()
    const result = fn(index)
    writeIndexAtomically(filePath, index)
    return result
  })
}

function getOrCreateEntry(index: JournalIndexV1, identity: string, canonicalRoot: string): JournalIndexEntry {
  const existing = index.identities[identity]
  if (existing !== undefined) {
    if (existing.root.trim() === '' && canonicalRoot.length > 0) {
      existing.root = canonicalRoot
    }
    return existing
  }
  const created: JournalIndexEntry = {
    root: canonicalRoot,
    reference: null,
    copies: [],
    attachedTo: null,
  }
  index.identities[identity] = created
  return created
}

function upsertCopy(entry: JournalIndexEntry, canonicalCopyPath: string, now: string): void {
  const found = entry.copies.find((c) => canonicalPath(c.path) === canonicalCopyPath)
  if (found !== undefined) {
    found.path = canonicalCopyPath
    found.lastSeen = now
    return
  }
  entry.copies.push({
    path: canonicalCopyPath,
    firstSeen: now,
    lastSeen: now,
  })
}

/**
 * Record an existing `.track` copy resolved at step 5. Never sets `reference` (V5: first copy
 * seen is never designated on its own).
 */
export function recordCopy(
  identity: string,
  root: string,
  copyPath: string,
  opts: JournalIndexOptions = {},
): JournalIndexEntry {
  const env = opts.env ?? process.env
  const now = opts.now ?? new Date().toISOString()
  const canonRoot = canonicalPath(root)
  const canonCopy = canonicalPath(copyPath)
  return mutateJournalIndex(env, (index) => {
    const entry = getOrCreateEntry(index, identity, canonRoot)
    upsertCopy(entry, canonCopy, now)
    return structuredClone(entry)
  })
}

/**
 * Explicitly designate the journal of reference for `identity` (called only by `journal designate`).
 */
export function designateJournal(
  identity: string,
  root: string,
  journalPath: string,
  by: string,
  opts: JournalIndexOptions = {},
): JournalIndexEntry {
  const env = opts.env ?? process.env
  const now = opts.now ?? new Date().toISOString()
  const canonRoot = canonicalPath(root)
  const canonJournal = canonicalPath(journalPath)
  return mutateJournalIndex(env, (index) => {
    const entry = getOrCreateEntry(index, identity, canonRoot)
    entry.root = canonRoot
    upsertCopy(entry, canonJournal, now)
    entry.reference = {
      path: canonJournal,
      by: by.trim() || 'owner',
      at: now,
    }
    return structuredClone(entry)
  })
}

/**
 * Attach a satellite project/folder identity to a conductor identity (called only by `journal attach`).
 */
export function attachSatellite(
  satelliteIdentity: string,
  satelliteRoot: string,
  conductorIdentity: string,
  opts: JournalIndexOptions = {},
): JournalIndexEntry {
  const env = opts.env ?? process.env
  const canonRoot = canonicalPath(satelliteRoot)
  return mutateJournalIndex(env, (index) => {
    const entry = getOrCreateEntry(index, satelliteIdentity, canonRoot)
    entry.root = canonRoot
    entry.attachedTo = conductorIdentity
    return structuredClone(entry)
  })
}

/**
 * Record or refresh `root` for `identity` (used when creating a step-6 journal outside the repository).
 */
export function ensureIdentityRoot(
  identity: string,
  root: string,
  opts: JournalIndexOptions = {},
): JournalIndexEntry {
  const env = opts.env ?? process.env
  const canonRoot = canonicalPath(root)
  return mutateJournalIndex(env, (index) => {
    const entry = getOrCreateEntry(index, identity, canonRoot)
    entry.root = canonRoot
    return structuredClone(entry)
  })
}

/** Derive a short display label for `identity` from its recorded `root` in the index. */
export function deriveLabelFromIndex(identity: string, index: JournalIndexV1): string | undefined {
  const root = index.identities[identity]?.root
  if (root === undefined || root.trim() === '') return undefined
  const name = basename(root)
  return name.length > 0 ? name : undefined
}
