import { randomBytes } from 'node:crypto'
import { chmodSync, existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { withFileLock } from '../events/lock.js'
import { ensurePrivateDir } from '../journal/index-store.js'
import { DomainError } from '../model/item.js'
import { trackStateHome } from '../state-home.js'

export const CAPTURE_REGISTRY_VERSION = 1 as const
export const CAPTURE_REGISTRY_FILENAME = 'capture-clis.json'

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
  return { version: CAPTURE_REGISTRY_VERSION, clis: {} }
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
  const clis = obj['clis']
  if (typeof clis !== 'object' || clis === null || Array.isArray(clis)) {
    throw new DomainError(`capture registry ${filePath} has invalid clis map`)
  }
  return {
    version: CAPTURE_REGISTRY_VERSION,
    clis: clis as Record<string, CaptureCliEntry>,
  }
}

/**
 * Pure read-only load of `capture-clis.json` (V4): never creates directories, files, or locks.
 */
export function readCaptureRegistry(env: NodeJS.ProcessEnv = process.env): CaptureRegistryV1 {
  const filePath = captureRegistryPath(env)
  if (!existsSync(filePath)) return emptyRegistry()
  return parseRegistry(readFileSync(filePath, 'utf8'), filePath)
}

function writeRegistryAtomically(filePath: string, registry: CaptureRegistryV1): void {
  const tmpFile = `${filePath}.tmp-${process.pid}-${randomBytes(6).toString('hex')}`
  const payload = `${JSON.stringify(registry, null, 2)}\n`
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

function mutateRegistry<T>(env: NodeJS.ProcessEnv, fn: (reg: CaptureRegistryV1) => T): T {
  const stateHome = trackStateHome(env)
  ensurePrivateDir(stateHome)
  const filePath = join(stateHome, CAPTURE_REGISTRY_FILENAME)
  return withFileLock(filePath, () => {
    const reg = existsSync(filePath)
      ? parseRegistry(readFileSync(filePath, 'utf8'), filePath)
      : emptyRegistry()
    const result = fn(reg)
    writeRegistryAtomically(filePath, reg)
    return result
  })
}

export function registerCaptureCli(
  input: { cli: string; version: string; mode: CaptureCliMode },
  opts: CaptureRegistryOptions = {},
): CaptureCliEntry {
  const cliName = input.cli.trim()
  if (cliName.length === 0) throw new DomainError('capture register: --cli must be non-empty')
  const version = input.version.trim()
  if (version.length === 0) throw new DomainError('capture register: --version must be non-empty')
  if (!(CAPTURE_CLI_MODES as readonly string[]).includes(input.mode)) {
    throw new DomainError(
      `capture register: --mode must be one of ${CAPTURE_CLI_MODES.join('|')} (got "${String(input.mode)}")`,
    )
  }
  const env = opts.env ?? process.env
  const now = opts.now ?? new Date().toISOString()

  return mutateRegistry(env, (reg) => {
    const prev = reg.clis[cliName]
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
  if (cliName.length === 0) return false
  const env = opts.env ?? process.env
  const filePath = captureRegistryPath(env)
  if (!existsSync(filePath)) return false

  return mutateRegistry(env, (reg) => {
    const existing = reg.clis[cliName]
    if (existing === undefined) return false
    existing.lastCaptureAt = at
    return true
  })
}
