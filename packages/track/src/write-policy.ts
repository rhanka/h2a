import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { maskSecrets } from './capture/secrets.js'
import { withFileLock } from './events/lock.js'
import {
  ensurePrivateDirHardened,
  lstatNoFollow,
  readFileNoFollow,
  writeFileAtomicPrivate,
} from './fs-private.js'
import { DomainError } from './model/item.js'

export const WRITE_POLICY_VERSION = 1 as const
export const WRITE_POLICY_FILENAME = 'write-policy.json'
const MAX_HISTORY_ENTRIES = 20
const MAX_HOLDER_LENGTH = 64
const FORBIDDEN_HOLDER_CHARS_RE = /[\x00-\x1f\x7f·]/u

function assertValidHolder(holder: string, context: string): string {
  const trimmed = holder.trim()
  if (trimmed.length === 0) {
    throw new DomainError(`${context}: --holder must be non-empty`)
  }
  if (trimmed.length > MAX_HOLDER_LENGTH) {
    throw new DomainError(`${context}: --holder must be at most ${MAX_HOLDER_LENGTH} characters`)
  }
  if (FORBIDDEN_HOLDER_CHARS_RE.test(trimmed)) {
    throw new DomainError(`${context}: --holder must not contain control characters or '·'`)
  }
  return trimmed
}

export type WritePolicyMode = 'open' | 'exclusive'

export interface WritePolicyHistoryEntry {
  action: 'declare' | 'takeover' | 'release'
  holder: string | null
  epoch: number
  at: string
  reason?: string
}

export interface WritePolicyState {
  version: typeof WRITE_POLICY_VERSION
  mode: WritePolicyMode
  holder: string | null
  epoch: number
  tokenDigest: string | null
  updatedAt: string | null
  history: WritePolicyHistoryEntry[]
}

export interface WriterTokenInput {
  writerToken?: string | undefined
  writerTokenFile?: string | undefined
  env?: NodeJS.ProcessEnv | undefined
}

export class WritePolicyError extends DomainError {
  constructor(
    message: string,
    readonly holder: string | null,
    readonly epoch: number,
  ) {
    super(message)
    this.name = 'WritePolicyError'
  }
}

export function writePolicyPathFor(eventsPath: string): string {
  return join(dirname(eventsPath), WRITE_POLICY_FILENAME)
}

function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex')
}

export function digestWriterToken(token: string): string {
  return `sha256:${sha256Hex(token)}`
}

function constantTimeDigestEqual(presentedDigest: string, expectedDigest: string): boolean {
  const normA = presentedDigest.replace(/^sha256:/iu, '').trim().toLowerCase()
  const normB = expectedDigest.replace(/^sha256:/iu, '').trim().toLowerCase()
  if (normA.length === 0 || normA.length !== normB.length) return false
  return timingSafeEqual(Buffer.from(normA, 'utf8'), Buffer.from(normB, 'utf8'))
}

function defaultOpenPolicy(): WritePolicyState {
  return {
    version: WRITE_POLICY_VERSION,
    mode: 'open',
    holder: null,
    epoch: 0,
    tokenDigest: null,
    updatedAt: null,
    history: [],
  }
}

function parseWritePolicy(raw: string, filePath: string): WritePolicyState {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    throw new WritePolicyError(
      `malformed write-policy.json at ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
      null,
      0,
    )
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new WritePolicyError(`malformed write-policy.json at ${filePath}: expected JSON object`, null, 0)
  }
  const obj = parsed as Record<string, unknown>
  const mode = obj['mode']
  if (mode !== 'open' && mode !== 'exclusive') {
    throw new WritePolicyError(`invalid write-policy mode "${String(mode)}" at ${filePath}`, null, 0)
  }
  const holder =
    typeof obj['holder'] === 'string' && obj['holder'].trim() !== '' ? obj['holder'].trim() : null
  const epoch =
    typeof obj['epoch'] === 'number' && Number.isInteger(obj['epoch']) && obj['epoch'] >= 0
      ? obj['epoch']
      : 0
  // Accept both `tokenDigest` (lot 3a) and `tokenHash` (lot 5a adopt fixture compatibility)
  const rawDigest =
    typeof obj['tokenDigest'] === 'string' && obj['tokenDigest'].trim() !== ''
      ? obj['tokenDigest'].trim()
      : typeof obj['tokenHash'] === 'string' && obj['tokenHash'].trim() !== ''
        ? obj['tokenHash'].trim()
        : null
  const updatedAt = typeof obj['updatedAt'] === 'string' ? obj['updatedAt'] : null
  const history = Array.isArray(obj['history']) ? (obj['history'] as WritePolicyHistoryEntry[]) : []

  if (holder !== null && (holder.length > MAX_HOLDER_LENGTH || FORBIDDEN_HOLDER_CHARS_RE.test(holder))) {
    throw new WritePolicyError(
      `malformed write-policy.json at ${filePath}: invalid holder value`,
      null,
      epoch,
    )
  }

  if (mode === 'exclusive' && (holder === null || rawDigest === null)) {
    throw new WritePolicyError(
      `malformed exclusive write-policy.json at ${filePath}: missing holder or token digest`,
      holder,
      epoch,
    )
  }

  return {
    version: WRITE_POLICY_VERSION,
    mode,
    holder,
    epoch,
    tokenDigest: rawDigest,
    updatedAt,
    history,
  }
}

/**
 * Pure read-only view of a journal's write policy (V4: never creates or modifies files).
 * Absent file (`ENOENT` only) means open, epoch 0 (spec §7.4). Fails closed (`WritePolicyError`)
 * on symlinks, permission errors (`EACCES`), or any other unreadable state.
 */
export function readWritePolicy(eventsPath: string): WritePolicyState {
  const filePath = writePolicyPathFor(eventsPath)
  const raw = readFileNoFollow(filePath, (msg) => new WritePolicyError(msg, null, 0))
  if (raw === undefined) return defaultOpenPolicy()
  return parseWritePolicy(raw, filePath)
}

function writePolicyAtomically(filePath: string, policy: WritePolicyState): void {
  const parent = dirname(filePath)
  if (lstatNoFollow(parent) === undefined) {
    mkdirSync(parent, { recursive: true })
  }
  const payload = `${JSON.stringify(policy, null, 2)}\n`
  writeFileAtomicPrivate(filePath, payload, 0o600, (msg) => new WritePolicyError(msg, policy.holder, policy.epoch))
}

export function writeTokenFilePrivate(tokenFilePath: string, token: string): void {
  const parent = dirname(tokenFilePath)
  const parentSt = lstatNoFollow(parent)
  if (parentSt === undefined) {
    ensurePrivateDirHardened(parent)
  } else if (!parentSt.isDirectory()) {
    throw new DomainError(`token file parent is not a directory: ${parent}`)
  }
  writeFileAtomicPrivate(tokenFilePath, `${token}\n`, 0o600)
}

/**
 * Resolve the presented writer token from explicit option, `--writer-token-file`, or
 * `TRACK_WRITER_TOKEN` env var. Throws `WritePolicyError` if an explicit token file is missing,
 * a symbolic link, or unreadable.
 */
export function resolvePresentedWriterToken(
  input: WriterTokenInput = {},
  policyForError?: Pick<WritePolicyState, 'holder' | 'epoch'>,
): string | undefined {
  if (input.writerToken !== undefined) {
    const trimmed = input.writerToken.trim()
    return trimmed.length > 0 ? trimmed : undefined
  }
  if (input.writerTokenFile !== undefined) {
    const makeErr = (msg: string): Error =>
      new WritePolicyError(
        `write refused: journal is in exclusive mode (holder: ${policyForError?.holder ?? 'unknown'}, epoch: ${policyForError?.epoch ?? 0}); ${msg}`,
        policyForError?.holder ?? null,
        policyForError?.epoch ?? 0,
      )
    const raw = readFileNoFollow(input.writerTokenFile, makeErr)
    if (raw === undefined) {
      throw makeErr(`writer token file not found: ${input.writerTokenFile}`)
    }
    const content = raw.trim()
    return content.length > 0 ? content : undefined
  }
  const env = input.env ?? process.env
  const fromEnv = env['TRACK_WRITER_TOKEN']?.trim()
  return fromEnv !== undefined && fromEnv.length > 0 ? fromEnv : undefined
}

/**
 * Enforce the journal's write policy. Intended to be called INSIDE `withFileLock(eventsPath, ...)`
 * BEFORE any integrity check or mutation (plan/07 Lot 3).
 *
 * Refuses (throws `WritePolicyError` naming holder and epoch) whenever `mode === 'exclusive'` and
 * the presented token does not match the recorded digest. No expiry or automatic takeover exists.
 */
export function assertWritePolicyAllows(eventsPath: string, input: WriterTokenInput = {}): void {
  const policy = readWritePolicy(eventsPath)
  if (policy.mode !== 'exclusive') return

  const presented = resolvePresentedWriterToken(input, policy)
  if (
    presented === undefined ||
    policy.tokenDigest === null ||
    !constantTimeDigestEqual(digestWriterToken(presented), policy.tokenDigest)
  ) {
    throw new WritePolicyError(
      `write refused: journal is in exclusive write mode (holder: ${policy.holder ?? 'unknown'}, epoch: ${policy.epoch}); present the current writer token via TRACK_WRITER_TOKEN or --writer-token-file`,
      policy.holder,
      policy.epoch,
    )
  }
}

function generateWriterToken(): string {
  return randomBytes(32).toString('hex')
}

function appendHistory(
  prev: readonly WritePolicyHistoryEntry[],
  entry: WritePolicyHistoryEntry,
): WritePolicyHistoryEntry[] {
  const next = [...prev, entry]
  return next.length > MAX_HISTORY_ENTRIES ? next.slice(next.length - MAX_HISTORY_ENTRIES) : next
}

/**
 * Declare an exclusive writer on an open journal (`track journal declare-writer`).
 * Refuses if the journal is already exclusive (never replaces a holder without explicit takeover).
 */
export function declareExclusiveWriter(
  eventsPath: string,
  holder: string,
  opts: { now?: string | undefined; tokenFile?: string | undefined } = {},
): { policy: WritePolicyState; token: string } {
  const trimmedHolder = assertValidHolder(holder, 'journal declare-writer')
  const now = opts.now ?? new Date().toISOString()

  return withFileLock(eventsPath, () => {
    const current = readWritePolicy(eventsPath)
    if (current.mode === 'exclusive') {
      throw new WritePolicyError(
        `journal declare-writer: journal is already in exclusive mode (holder: ${current.holder ?? 'unknown'}, epoch: ${current.epoch}); use \`track journal takeover --holder <name> --reason <text>\` to replace the holder`,
        current.holder,
        current.epoch,
      )
    }
    const token = generateWriterToken()
    const epoch = current.epoch + 1
    const next: WritePolicyState = {
      version: WRITE_POLICY_VERSION,
      mode: 'exclusive',
      holder: trimmedHolder,
      epoch,
      tokenDigest: digestWriterToken(token),
      updatedAt: now,
      history: appendHistory(current.history, {
        action: 'declare',
        holder: trimmedHolder,
        epoch,
        at: now,
      }),
    }
    writePolicyAtomically(writePolicyPathFor(eventsPath), next)
    if (opts.tokenFile !== undefined) {
      writeTokenFilePrivate(opts.tokenFile, token)
    }
    return { policy: next, token }
  })
}

/**
 * Explicit takeover (`track journal takeover`): raises epoch, issues a fresh token, immediately
 * invalidating any prior holder's token. Never automatic (spec V6, §7.4).
 */
export function takeoverExclusiveWriter(
  eventsPath: string,
  holder: string,
  reason: string,
  opts: { now?: string | undefined; tokenFile?: string | undefined } = {},
): { policy: WritePolicyState; token: string } {
  const trimmedHolder = assertValidHolder(holder, 'journal takeover')
  const trimmedReason = reason.trim()
  if (trimmedReason.length === 0) {
    throw new DomainError('journal takeover: --reason must be non-empty')
  }
  const maskedReason = maskSecrets(trimmedReason).text
  const now = opts.now ?? new Date().toISOString()

  return withFileLock(eventsPath, () => {
    const current = readWritePolicy(eventsPath)
    const token = generateWriterToken()
    const epoch = current.epoch + 1
    const next: WritePolicyState = {
      version: WRITE_POLICY_VERSION,
      mode: 'exclusive',
      holder: trimmedHolder,
      epoch,
      tokenDigest: digestWriterToken(token),
      updatedAt: now,
      history: appendHistory(current.history, {
        action: 'takeover',
        holder: trimmedHolder,
        epoch,
        at: now,
        reason: maskedReason,
      }),
    }
    writePolicyAtomically(writePolicyPathFor(eventsPath), next)
    if (opts.tokenFile !== undefined) {
      writeTokenFilePrivate(opts.tokenFile, token)
    }
    return { policy: next, token }
  })
}

/**
 * Release exclusivity (`track journal release`): holder-only (requires current token), raises
 * epoch and returns the journal to `open` mode.
 */
export function releaseExclusiveWriter(
  eventsPath: string,
  tokenInput: WriterTokenInput = {},
  opts: { now?: string | undefined } = {},
): WritePolicyState {
  const now = opts.now ?? new Date().toISOString()

  return withFileLock(eventsPath, () => {
    const current = readWritePolicy(eventsPath)
    if (current.mode !== 'exclusive') {
      throw new DomainError('journal release: journal is already in open mode')
    }
    assertWritePolicyAllows(eventsPath, tokenInput)
    const epoch = current.epoch + 1
    const next: WritePolicyState = {
      version: WRITE_POLICY_VERSION,
      mode: 'open',
      holder: null,
      epoch,
      tokenDigest: null,
      updatedAt: now,
      history: appendHistory(current.history, {
        action: 'release',
        holder: current.holder,
        epoch,
        at: now,
      }),
    }
    writePolicyAtomically(writePolicyPathFor(eventsPath), next)
    return next
  })
}
