import { readdirSync } from 'node:fs'
import { join } from 'node:path'

import { withFileLock } from '../events/lock.js'
import type { CaptureOrigin } from '../events/types.js'
import { ulid } from 'ulid'
import {
  assertStateHomeOutsideGit,
  lstatNoFollow,
  readFileNoFollow,
  writeFileAtomicPrivate,
} from '../fs-private.js'
import { identityDigest } from '../journal/identity.js'
import { ensurePrivateDir } from '../journal/index-store.js'
import { DomainError } from '../model/item.js'
import { trackStateHome } from '../state-home.js'
import { hasInjectionMarker } from './markers.js'
import { assertValidCliName } from './registry.js'
import { maskSecrets } from './secrets.js'

export const CAPTURE_ORIGINS = ['owner', 'doubtful', 'injected', 'subagent', 'background'] as const
export type { CaptureOrigin }

export const CAPTURE_STATES = [
  'captured',
  'classified',
  'inscribed',
  'dismissed',
  'expired',
  'acknowledged',
] as const
export type CaptureState = (typeof CAPTURE_STATES)[number]

export const CAPTURE_CLASS_KINDS = [
  'new-demand',
  'follow-up',
  'decision-answer',
  'not-a-demand',
] as const
export type CaptureClassKind = (typeof CAPTURE_CLASS_KINDS)[number]

export const CAPTURE_ACK_KINDS = [
  'late-demand',
  'not-a-demand',
  'recorded-elsewhere',
] as const
export type CaptureAckKind = (typeof CAPTURE_ACK_KINDS)[number]

/** Default unclassified text retention delay in hours (spec §7.5, plan/07 Lot 2 — cyber review). */
export const DEFAULT_CAPTURE_RETENTION_HOURS = 72
/** Lower and upper bounds for `TRACK_CAPTURE_RETENTION_HOURS` override (cyber review). */
export const MIN_CAPTURE_RETENTION_HOURS = 1
export const MAX_CAPTURE_RETENTION_HOURS = 168

const SAFE_CAPTURE_ID_RE = /^[0-9A-Za-z_-]{1,64}$/u
const IDENTITY_DIGEST_RE = /^[0-9a-f]{64}$/u
const FORBIDDEN_METADATA_CHARS_RE = /[\x00-\x1f\x7f]/u
export const MAX_CAPTURE_TRANSCRIPT_BYTES = 1024
export const MAX_CAPTURE_SESSION_BYTES = 256

function sanitizeCaptureMetadata(
  value: string | null,
  field: 'transcript' | 'session',
  maxBytes: number,
): string | null {
  if (value === null) return null
  if (FORBIDDEN_METADATA_CHARS_RE.test(value)) {
    throw new DomainError(`capture add: --${field} must not contain control characters or newlines`)
  }
  const masked = maskSecrets(value).text
  if (Buffer.byteLength(masked, 'utf8') > maxBytes) {
    throw new DomainError(`capture add: --${field} exceeds maximum length of ${maxBytes} bytes`)
  }
  return masked
}

export interface CaptureClassification {
  as: CaptureClassKind
  classifiedAt: string
  title?: string
  demandNumber?: number
  decisionRef?: string
}

export interface CaptureInscriptionReceipt {
  at: string
  demandId?: string
  demandNumber?: number
  decisionId?: string
  eventId?: string
  masked?: boolean
}

export interface CaptureAcknowledgement {
  as: CaptureAckKind
  at: string
  demandId?: string
  demandNumber?: number
}

export interface CaptureEntry {
  id: string
  at: string
  cli: string
  session: string | null
  /** Local folder path while open (`captured`/`classified`); omitted once purged (`expired`/`dismissed`/`inscribed`/`acknowledged`). */
  folder?: string | undefined
  identity: string
  origin: CaptureOrigin
  /** Masked captured text while open (`captured`/`classified`); `null` once purged. */
  text: string | null
  /** UTF-8 byte length of the captured (post-secret-mask) text. */
  size: number
  maskedSecretCount: number
  transcript: string | null
  announced: boolean
  state: CaptureState
  classification?: CaptureClassification
  inscribed?: CaptureInscriptionReceipt
  expiredAt?: string
  acknowledgement?: CaptureAcknowledgement
}

export interface CaptureQueueOptions {
  env?: NodeJS.ProcessEnv | undefined
  now?: string | undefined
}

export function resolveCaptureRetentionHours(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env['TRACK_CAPTURE_RETENTION_HOURS']?.trim()
  if (raw === undefined || raw === '') return DEFAULT_CAPTURE_RETENTION_HOURS
  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) return DEFAULT_CAPTURE_RETENTION_HOURS
  if (parsed < MIN_CAPTURE_RETENTION_HOURS) return MIN_CAPTURE_RETENTION_HOURS
  if (parsed > MAX_CAPTURE_RETENTION_HOURS) return MAX_CAPTURE_RETENTION_HOURS
  return parsed
}

export function isCaptureOverAge(
  entry: Pick<CaptureEntry, 'state' | 'at'>,
  nowIso: string,
  retentionHours: number,
): boolean {
  if (entry.state !== 'captured') return false
  const createdMs = Date.parse(entry.at)
  const nowMs = Date.parse(nowIso)
  if (Number.isNaN(createdMs) || Number.isNaN(nowMs)) return false
  return nowMs - createdMs >= retentionHours * 3_600_000
}

/**
 * Pure read-only effective state of a capture entry at `nowIso` (spec V4 & §7.5):
 * treats an over-age `captured` entry as `expired` (with `text: null`) without touching disk.
 */
export function effectiveCaptureEntry(
  entry: CaptureEntry,
  nowIso: string,
  retentionHours: number,
): CaptureEntry {
  if (isCaptureOverAge(entry, nowIso, retentionHours)) {
    const { folder: _strippedFolder, ...rest } = entry
    return {
      ...rest,
      state: 'expired',
      text: null,
      expiredAt: entry.expiredAt ?? nowIso,
    }
  }
  return entry
}

export function isOpenCaptureState(state: CaptureState): boolean {
  return state === 'captured' || state === 'classified' || state === 'expired'
}

export function captureRootDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(trackStateHome(env), 'capture')
}

export function captureDirForIdentity(identity: string, env: NodeJS.ProcessEnv = process.env): string {
  return join(captureRootDir(env), identityDigest(identity))
}

function assertSafeCaptureId(captureId: string): void {
  if (!SAFE_CAPTURE_ID_RE.test(captureId)) {
    throw new DomainError(`invalid capture id "${captureId}"`)
  }
}

function lockTargetForDir(identityDir: string): string {
  return join(identityDir, '.queue')
}

function writeEntryAtomically(filePath: string, entry: CaptureEntry): void {
  const payload = `${JSON.stringify(entry, null, 2)}\n`
  writeFileAtomicPrivate(filePath, payload, 0o600)
}

function parseEntryFile(filePath: string): CaptureEntry | undefined {
  const raw = readFileNoFollow(filePath)
  if (raw === undefined) return undefined
  try {
    const parsed = JSON.parse(raw) as unknown
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined
    const obj = parsed as Record<string, unknown>
    if (typeof obj['id'] !== 'string' || typeof obj['at'] !== 'string' || typeof obj['state'] !== 'string') {
      return undefined
    }
    return parsed as CaptureEntry
  } catch {
    return undefined
  }
}

function assertCaptureTreeNoSymlinks(env: NodeJS.ProcessEnv): { stateHome: string; root: string } {
  const stateHome = trackStateHome(env)
  lstatNoFollow(stateHome)
  const root = captureRootDir(env)
  lstatNoFollow(root)
  return { stateHome, root }
}

/**
 * Pure read-only lookup of a single capture entry (V4). Fails closed on symbolic links.
 */
export function readCaptureEntry(
  identity: string,
  captureId: string,
  env: NodeJS.ProcessEnv = process.env,
): CaptureEntry | undefined {
  if (!SAFE_CAPTURE_ID_RE.test(captureId)) return undefined
  assertCaptureTreeNoSymlinks(env)
  const idDir = captureDirForIdentity(identity, env)
  const dirSt = lstatNoFollow(idDir)
  if (dirSt === undefined || !dirSt.isDirectory()) return undefined
  const filePath = join(idDir, `${captureId}.json`)
  return parseEntryFile(filePath)
}

/**
 * Pure read-only search for a capture entry by id across the preferred identity first, then any
 * 64-hex identity directory under `capture/` (V4). Rejects symbolic links.
 */
export function findCaptureEntry(
  captureId: string,
  preferredIdentity: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): { entry: CaptureEntry; identityDir: string } | undefined {
  if (!SAFE_CAPTURE_ID_RE.test(captureId)) return undefined
  const { root } = assertCaptureTreeNoSymlinks(env)
  if (preferredIdentity !== undefined) {
    const dir = captureDirForIdentity(preferredIdentity, env)
    const entry = readCaptureEntry(preferredIdentity, captureId, env)
    if (entry !== undefined) return { entry, identityDir: dir }
  }
  const rootSt = lstatNoFollow(root)
  if (rootSt === undefined || !rootSt.isDirectory()) return undefined
  for (const sub of readdirSync(root)) {
    if (!IDENTITY_DIGEST_RE.test(sub)) continue
    const dir = join(root, sub)
    const st = lstatNoFollow(dir)
    if (st === undefined || !st.isDirectory()) continue
    const candidate = join(dir, `${captureId}.json`)
    const entry = parseEntryFile(candidate)
    if (entry !== undefined) return { entry, identityDir: dir }
  }
  return undefined
}

/**
 * Pure read-only listing of capture entries for one identity, applying effective expiry against
 * `now` without writing anything (V4). Sorted chronologically by `at` then `id`.
 */
export function listCaptures(
  identity: string,
  opts: CaptureQueueOptions & { session?: string; state?: CaptureState } = {},
): CaptureEntry[] {
  const env = opts.env ?? process.env
  const now = opts.now ?? new Date().toISOString()
  const retentionHours = resolveCaptureRetentionHours(env)
  assertCaptureTreeNoSymlinks(env)
  const dir = captureDirForIdentity(identity, env)
  const dirSt = lstatNoFollow(dir)
  if (dirSt === undefined || !dirSt.isDirectory()) return []

  const entries: CaptureEntry[] = []
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.json')) continue
    const parsed = parseEntryFile(join(dir, name))
    if (parsed === undefined) continue
    const eff = effectiveCaptureEntry(parsed, now, retentionHours)
    if (opts.session !== undefined && eff.session !== opts.session) continue
    if (opts.state !== undefined && eff.state !== opts.state) continue
    entries.push(eff)
  }
  entries.sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id))
  return entries
}

/**
 * Pure read-only listing of all capture entries across all identities in `trackStateHome` (V4).
 */
export function listAllCapturesByIdentity(
  opts: CaptureQueueOptions = {},
): Map<string, CaptureEntry[]> {
  const env = opts.env ?? process.env
  const now = opts.now ?? new Date().toISOString()
  const retentionHours = resolveCaptureRetentionHours(env)
  const { root } = assertCaptureTreeNoSymlinks(env)
  const out = new Map<string, CaptureEntry[]>()
  const rootSt = lstatNoFollow(root)
  if (rootSt === undefined || !rootSt.isDirectory()) return out

  for (const sub of readdirSync(root).sort()) {
    if (!IDENTITY_DIGEST_RE.test(sub)) continue
    const dir = join(root, sub)
    const st = lstatNoFollow(dir)
    if (st === undefined || !st.isDirectory()) continue
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.json')) continue
      const parsed = parseEntryFile(join(dir, name))
      if (parsed === undefined) continue
      const eff = effectiveCaptureEntry(parsed, now, retentionHours)
      const list = out.get(eff.identity) ?? []
      list.push(eff)
      out.set(eff.identity, list)
    }
  }
  for (const list of out.values()) {
    list.sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id))
  }
  return out
}

/**
 * Append a new captured message to the identity's queue (0700 folders, 0600 files).
 * Secret masking and injection-marker enforcement run BEFORE any byte is written to disk (spec V8, §7.6).
 */
export function appendCapture(
  input: {
    cli: string
    session: string | null
    folder: string
    identity: string
    origin: CaptureOrigin
    rawText: string
    transcript: string | null
    id?: string
  },
  opts: CaptureQueueOptions = {},
): CaptureEntry {
  const env = opts.env ?? process.env
  const now = opts.now ?? new Date().toISOString()
  const cliName = assertValidCliName(input.cli, 'capture add')
  const session = sanitizeCaptureMetadata(input.session, 'session', MAX_CAPTURE_SESSION_BYTES)
  const transcript = sanitizeCaptureMetadata(input.transcript, 'transcript', MAX_CAPTURE_TRANSCRIPT_BYTES)
  const effectiveOrigin: CaptureOrigin = hasInjectionMarker(input.rawText) ? 'injected' : input.origin
  const masked = maskSecrets(input.rawText)
  const id = input.id ?? ulid()
  assertSafeCaptureId(id)

  const stateHome = trackStateHome(env)
  assertStateHomeOutsideGit(stateHome, env)
  const rootDir = captureRootDir(env)
  const idDir = captureDirForIdentity(input.identity, env)
  ensurePrivateDir(stateHome)
  ensurePrivateDir(rootDir)
  ensurePrivateDir(idDir)

  const entry: CaptureEntry = {
    id,
    at: now,
    cli: cliName,
    session,
    folder: input.folder,
    identity: input.identity,
    origin: effectiveOrigin,
    text: masked.text,
    size: Buffer.byteLength(masked.text, 'utf8'),
    maskedSecretCount: masked.maskedCount,
    transcript,
    announced: false,
    state: 'captured',
  }

  const written = withFileLock(lockTargetForDir(idDir), () => {
    const filePath = join(idDir, `${id}.json`)
    writeEntryAtomically(filePath, entry)
    return structuredClone(entry)
  })
  // Spec §7.5: every write to a queue on the machine sweeps expired texts.
  sweepExpiredQueues({ env, now })
  return written
}

/**
 * Atomically mutate an existing capture entry under the identity queue lock (mode 0600), then
 * sweep expired texts across every queue on the machine (spec §7.5).
 */
export function updateCaptureEntry(
  identity: string,
  captureId: string,
  mutator: (current: CaptureEntry) => CaptureEntry,
  opts: { env?: NodeJS.ProcessEnv | undefined; now?: string | undefined } = {},
): CaptureEntry {
  assertSafeCaptureId(captureId)
  const env = opts.env ?? process.env
  const now = opts.now ?? new Date().toISOString()
  assertCaptureTreeNoSymlinks(env)
  const idDir = captureDirForIdentity(identity, env)
  const dirSt = lstatNoFollow(idDir)
  if (dirSt === undefined || !dirSt.isDirectory()) {
    throw new DomainError(`capture entry ${captureId} not found`)
  }
  const updated = withFileLock(lockTargetForDir(idDir), () => {
    const filePath = join(idDir, `${captureId}.json`)
    const fileSt = lstatNoFollow(filePath)
    if (fileSt === undefined) {
      throw new DomainError(`capture entry ${captureId} not found`)
    }
    const current = parseEntryFile(filePath)
    if (current === undefined) {
      throw new DomainError(`capture entry ${captureId} is unreadable`)
    }
    const next = mutator(structuredClone(current))
    writeEntryAtomically(filePath, next)
    return structuredClone(next)
  })
  sweepExpiredQueues({ env, now })
  return updated
}

/**
 * Sweep expired unclassified texts across EVERY queue directory under `trackStateHome` (spec §7.5,
 * plan/07 Lot 1 & Lot 2). Removes the text (`text: null`) and `folder`, setting `state: 'expired'`
 * while keeping time, session, CLI, size and sanitized transcript pointer.
 */
export function sweepExpiredQueues(opts: CaptureQueueOptions = {}): number {
  const env = opts.env ?? process.env
  const now = opts.now ?? new Date().toISOString()
  const retentionHours = resolveCaptureRetentionHours(env)
  const { root } = assertCaptureTreeNoSymlinks(env)
  const rootSt = lstatNoFollow(root)
  if (rootSt === undefined || !rootSt.isDirectory()) return 0

  let expiredCount = 0
  for (const sub of readdirSync(root)) {
    if (!IDENTITY_DIGEST_RE.test(sub)) continue
    const dir = join(root, sub)
    const dirSt = lstatNoFollow(dir)
    if (dirSt === undefined || !dirSt.isDirectory()) continue
    const candidateFiles: string[] = []
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.json')) continue
      const parsed = parseEntryFile(join(dir, name))
      if (parsed !== undefined && isCaptureOverAge(parsed, now, retentionHours)) {
        candidateFiles.push(name)
      }
    }
    if (candidateFiles.length === 0) continue

    withFileLock(lockTargetForDir(dir), () => {
      for (const name of candidateFiles) {
        const filePath = join(dir, name)
        const current = parseEntryFile(filePath)
        if (current === undefined) continue
        if (!isCaptureOverAge(current, now, retentionHours)) continue
        const { folder: _strippedFolder, ...rest } = current
        const expired: CaptureEntry = {
          ...rest,
          state: 'expired',
          text: null,
          expiredAt: now,
        }
        writeEntryAtomically(filePath, expired)
        expiredCount += 1
      }
    })
  }
  return expiredCount
}

/**
 * Find unannounced, unclassified (non-expired) captures for `session` in `identity`, mark them
 * `announced: true` under the queue lock, sweep expired queues, and return them (plan/07 Lot 1 `track capture remind`).
 */
export function consumeUnannouncedForSession(
  identity: string,
  session: string,
  opts: CaptureQueueOptions = {},
): CaptureEntry[] {
  const env = opts.env ?? process.env
  const now = opts.now ?? new Date().toISOString()
  const retentionHours = resolveCaptureRetentionHours(env)
  assertCaptureTreeNoSymlinks(env)
  const idDir = captureDirForIdentity(identity, env)
  const dirSt = lstatNoFollow(idDir)
  if (dirSt === undefined || !dirSt.isDirectory()) {
    sweepExpiredQueues({ env, now })
    return []
  }

  const matched = withFileLock(lockTargetForDir(idDir), () => {
    const out: CaptureEntry[] = []
    for (const name of readdirSync(idDir)) {
      if (!name.endsWith('.json')) continue
      const filePath = join(idDir, name)
      const current = parseEntryFile(filePath)
      if (current === undefined) continue
      if (current.state !== 'captured') continue
      if (current.announced) continue
      if (current.session !== session) continue
      if (isCaptureOverAge(current, now, retentionHours)) continue
      const updated: CaptureEntry = { ...current, announced: true }
      writeEntryAtomically(filePath, updated)
      out.push(updated)
    }
    out.sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id))
    return out
  })
  sweepExpiredQueues({ env, now })
  return matched
}
