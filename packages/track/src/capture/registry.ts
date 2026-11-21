import { join } from 'node:path'

import { withFileLock } from '../events/lock.js'
import {
  assertStateHomeOutsideGit,
  lstatNoFollow,
  readFileNoFollow,
  writeFileAtomicPrivate,
} from '../fs-private.js'
import { ensurePrivateDir } from '../journal/index-store.js'
import { DomainError } from '../model/item.js'
import { trackStateHome } from '../state-home.js'

export const CAPTURE_REGISTRY_VERSION = 1 as const
export const CAPTURE_REGISTRY_FILENAME = 'capture-clis.json'
export const SAFE_CLI_NAME_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/iu
const RESERVED_CLI_NAMES: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype'])
const FORBIDDEN_VERSION_CHARS_RE = /[\x00-\x1f\x7f·]/u

export function assertValidCliName(cli: string, context: string): string {
  const trimmed = cli.trim()
  if (
    trimmed.length === 0 ||
    !SAFE_CLI_NAME_RE.test(trimmed) ||
    RESERVED_CLI_NAMES.has(trimmed.toLowerCase())
  ) {
    throw new DomainError(
      `${context}: --cli must match /^[a-z0-9][a-z0-9_-]{0,31}$/i`,
    )
  }
  return trimmed
}

export const CAPTURE_CLI_MODES = ['direct', 'deferred', 'not-covered'] as const
export type CaptureCliMode = (typeof CAPTURE_CLI_MODES)[number]

export interface CaptureCliEntry {
  version: string
  mode: CaptureCliMode
  registeredAt: string
  lastCaptureAt: string | null
}

/**
 * Versioned schema of `capture-clis.json` in `trackStateHome` (spec §7.1, plan/07 Lot 1).
 */
export interface CaptureRegistryV1 {
  version: typeof CAPTURE_REGISTRY_VERSION
  clis: Record<string, CaptureCliEntry>
}

export interface CaptureRegistryOptions {
  env?: NodeJS.ProcessEnv | undefined
  now?: string | undefined
}

export function captureRegistryPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(trackStateHome(env), CAPTURE_REGISTRY_FILENAME)
}

function emptyRegistry(): CaptureRegistryV1 {
  return {
    version: CAPTURE_REGISTRY_VERSION,
    clis: Object.create(null) as Record<string, CaptureCliEntry>,
  }
}

function parseRegistry(raw: string, filePath: string): CaptureRegistryV1 {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    throw new DomainError(
      `capture registry ${filePath} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new DomainError(`capture registry ${filePath} must be a JSON object`)
  }
  const obj = parsed as Record<string, unknown>
  if (obj['version'] !== CAPTURE_REGISTRY_VERSION) {
    throw new DomainError(
      `unsupported capture registry version ${String(obj['version'])} in ${filePath}`,
    )
  }
  const clisRaw = obj['clis']
  if (typeof clisRaw !== 'object' || clisRaw === null || Array.isArray(clisRaw)) {
    throw new DomainError(`capture registry ${filePath} has invalid clis map`)
  }
  const safeClis = Object.create(null) as Record<string, CaptureCliEntry>
  for (const [key, val] of Object.entries(clisRaw as Record<string, CaptureCliEntry>)) {
    if (!SAFE_CLI_NAME_RE.test(key) || RESERVED_CLI_NAMES.has(key.toLowerCase())) continue
    safeClis[key] = val
  }
  return {
    version: CAPTURE_REGISTRY_VERSION,
    clis: safeClis,
  }
}

/**
 * Pure read-only load of `capture-clis.json` (V4): never creates directories, files, or locks.
 * Fails closed on symbolic links.
 */
export function readCaptureRegistry(env: NodeJS.ProcessEnv = process.env): CaptureRegistryV1 {
  const stateHome = trackStateHome(env)
  lstatNoFollow(stateHome)
  const filePath = captureRegistryPath(env)
  const raw = readFileNoFollow(filePath)
  if (raw === undefined) return emptyRegistry()
  return parseRegistry(raw, filePath)
}

function writeRegistryAtomically(filePath: string, registry: CaptureRegistryV1): void {
  const payload = `${JSON.stringify(registry, null, 2)}\n`
  writeFileAtomicPrivate(filePath, payload, 0o600)
}

function mutateRegistry<T>(env: NodeJS.ProcessEnv, fn: (reg: CaptureRegistryV1) => T): T {
  const stateHome = trackStateHome(env)
  assertStateHomeOutsideGit(stateHome, env)
  ensurePrivateDir(stateHome)
  const filePath = join(stateHome, CAPTURE_REGISTRY_FILENAME)
  return withFileLock(filePath, () => {
    const raw = readFileNoFollow(filePath)
    const reg = raw !== undefined ? parseRegistry(raw, filePath) : emptyRegistry()
    const result = fn(reg)
    writeRegistryAtomically(filePath, reg)
    return result
  })
}

export function registerCaptureCli(
  input: { cli: string; version: string; mode: CaptureCliMode },
  opts: CaptureRegistryOptions = {},
): CaptureCliEntry {
  const cliName = assertValidCliName(input.cli, 'capture register')
  const version = input.version.trim()
  if (version.length === 0 || version.length > 64 || FORBIDDEN_VERSION_CHARS_RE.test(version)) {
    throw new DomainError('capture register: --version must be non-empty, <= 64 chars, without control characters')
  }
  if (!(CAPTURE_CLI_MODES as readonly string[]).includes(input.mode)) {
    throw new DomainError(
      `capture register: --mode must be one of ${CAPTURE_CLI_MODES.join('|')}`,
    )
  }
  const env = opts.env ?? process.env
  const now = opts.now ?? new Date().toISOString()

  return mutateRegistry(env, (reg) => {
    const prev = Object.hasOwn(reg.clis, cliName) ? reg.clis[cliName] : undefined
    const entry: CaptureCliEntry = {
      version,
      mode: input.mode,
      registeredAt: now,
      lastCaptureAt: prev?.lastCaptureAt ?? null,
    }
    reg.clis[cliName] = entry
    return structuredClone(entry)
  })
}

/**
 * Update `lastCaptureAt` for an already registered CLI. An unregistered CLI stays unknown to Track
 * (spec §7.1: only registration records a CLI's mode).
 */
export function recordCliLastCapture(
  cli: string,
  at: string,
  opts: { env?: NodeJS.ProcessEnv | undefined } = {},
): boolean {
  const cliName = cli.trim()
  if (
    cliName.length === 0 ||
    !SAFE_CLI_NAME_RE.test(cliName) ||
    RESERVED_CLI_NAMES.has(cliName.toLowerCase())
  ) {
    return false
  }
  const env = opts.env ?? process.env
  const stateHome = trackStateHome(env)
  lstatNoFollow(stateHome)
  const filePath = captureRegistryPath(env)
  if (lstatNoFollow(filePath) === undefined) return false

  return mutateRegistry(env, (reg) => {
    if (!Object.hasOwn(reg.clis, cliName)) return false
    const existing = reg.clis[cliName]
    if (existing === undefined) return false
    existing.lastCaptureAt = at
    return true
  })
}
