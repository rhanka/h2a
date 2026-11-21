import { randomBytes } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'

import { withFileLock } from '../events/lock.js'
import type { CaptureOrigin } from '../events/types.js'
import { ulid } from 'ulid'
import { identityDigest } from '../journal/identity.js'
import { ensurePrivateDir } from '../journal/index-store.js'
import { DomainError } from '../model/item.js'
import { trackStateHome } from '../state-home.js'
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
  folder: string
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
    return {
      ...entry,
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
  const tmpFile = `${filePath}.tmp-${process.pid}-${randomBytes(6).toString('hex')}`
  const payload = `${JSON.stringify(entry, null, 2)}\n`
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

function parseEntryFile(filePath: string): CaptureEntry | undefined {
  try {
    const raw = readFileSync(filePath, 'utf8')
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

/**
 * Pure read-only lookup of a single capture entry (V4).
 */
export function readCaptureEntry(
  identity: string,
  captureId: string,
  env: NodeJS.ProcessEnv = process.env,
): CaptureEntry | undefined {
  if (!SAFE_CAPTURE_ID_RE.test(captureId)) return undefined
  const filePath = join(captureDirForIdentity(identity, env), `${captureId}.json`)
  if (!existsSync(filePath)) return undefined
  return parseEntryFile(filePath)
}

/**
 * Pure read-only search for a capture entry by id across the preferred identity first, then any
 * identity directory under `capture/` (V4).
 */
export function findCaptureEntry(
  captureId: string,
  preferredIdentity: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): { entry: CaptureEntry; identityDir: string } | undefined {
  if (!SAFE_CAPTURE_ID_RE.test(captureId)) return undefined
  if (preferredIdentity !== undefined) {
    const dir = captureDirForIdentity(preferredIdentity, env)
    const entry = readCaptureEntry(preferredIdentity, captureId, env)
    if (entry !== undefined) return { entry, identityDir: dir }
  }
  const root = captureRootDir(env)
  if (!existsSync(root)) return undefined
  for (const sub of readdirSync(root)) {
    const dir = join(root, sub)
    try {
      if (!statSync(dir).isDirectory()) continue
    } catch {
      continue
    }
    const candidate = join(dir, `${captureId}.json`)
    if (!existsSync(candidate)) continue
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
  const dir = captureDirForIdentity(identity, env)
  if (!existsSync(dir)) return []

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
  const root = captureRootDir(env)
  const out = new Map<string, CaptureEntry[]>()
  if (!existsSync(root)) return out

  for (const sub of readdirSync(root).sort()) {
    const dir = join(root, sub)
    try {
      if (!statSync(dir).isDirectory()) continue
    } catch {
      continue
    }
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
 * Secret masking runs BEFORE any byte is written to disk (spec V8).
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
  const masked = maskSecrets(input.rawText)
  const id = input.id ?? ulid()
  assertSafeCaptureId(id)

  const stateHome = trackStateHome(env)
  const rootDir = captureRootDir(env)
  const idDir = captureDirForIdentity(input.identity, env)
  ensurePrivateDir(stateHome)
  ensurePrivateDir(rootDir)
  ensurePrivateDir(idDir)

  const entry: CaptureEntry = {
    id,
    at: now,
    cli: input.cli,
    session: input.session,
    folder: input.folder,
    identity: input.identity,
    origin: input.origin,
    text: masked.text,
    size: Buffer.byteLength(masked.text, 'utf8'),
    maskedSecretCount: masked.maskedCount,
    transcript: input.transcript,
    announced: false,
    state: 'captured',
  }

  return withFileLock(lockTargetForDir(idDir), () => {
    const filePath = join(idDir, `${id}.json`)
    writeEntryAtomically(filePath, entry)
    return structuredClone(entry)
  })
}

/**
 * Atomically mutate an existing capture entry under the identity queue lock (mode 0600).
 */
export function updateCaptureEntry(
  identity: string,
  captureId: string,
  mutator: (current: CaptureEntry) => CaptureEntry,
  opts: { env?: NodeJS.ProcessEnv | undefined } = {},
): CaptureEntry {
  assertSafeCaptureId(captureId)
  const env = opts.env ?? process.env
  const idDir = captureDirForIdentity(identity, env)
  if (!existsSync(idDir)) {
    throw new DomainError(`capture entry ${captureId} not found`)
  }
  return withFileLock(lockTargetForDir(idDir), () => {
    const filePath = join(idDir, `${captureId}.json`)
    if (!existsSync(filePath)) {
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
}

/**
 * Sweep expired unclassified texts across EVERY queue directory under `trackStateHome` (spec §7.5,
 * plan/07 Lot 1 & Lot 2). Removes the text (`text: null`) and sets `state: 'expired'` while keeping
 * time, session, CLI, size and transcript pointer. Returns the number of entries expired.
 */
export function sweepExpiredQueues(opts: CaptureQueueOptions = {}): number {
  const env = opts.env ?? process.env
  const now = opts.now ?? new Date().toISOString()
  const retentionHours = resolveCaptureRetentionHours(env)
  const root = captureRootDir(env)
  if (!existsSync(root)) return 0

  let expiredCount = 0
  for (const sub of readdirSync(root)) {
    const dir = join(root, sub)
    try {
      if (!statSync(dir).isDirectory()) continue
    } catch {
      continue
    }
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
        const expired: CaptureEntry = {
          ...current,
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
 * `announced: true` under the queue lock, and return them (plan/07 Lot 1 `track capture remind`).
 */
export function consumeUnannouncedForSession(
  identity: string,
  session: string,
  opts: CaptureQueueOptions = {},
): CaptureEntry[] {
  const env = opts.env ?? process.env
  const now = opts.now ?? new Date().toISOString()
  const retentionHours = resolveCaptureRetentionHours(env)
  const idDir = captureDirForIdentity(identity, env)
  if (!existsSync(idDir)) return []

  return withFileLock(lockTargetForDir(idDir), () => {
    const matched: CaptureEntry[] = []
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
      matched.push(updated)
    }
    matched.sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id))
    return matched
  })
}
