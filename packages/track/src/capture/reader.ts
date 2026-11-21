import {
  effectiveCaptureEntry,
  isOpenCaptureState,
  listCaptures,
  resolveCaptureRetentionHours,
  type CaptureEntry,
} from './queue.js'
import { readCaptureRegistry, type CaptureCliMode } from './registry.js'

export interface CaptureCliStatusView {
  cli: string
  version: string
  mode: CaptureCliMode
  lastCaptureAt: string | null
}

export interface CapturedWaitingItem {
  id: string
  at: string
  classKind: 'new-demand' | 'follow-up' | 'decision-answer'
  title: string
  demandNumber?: number
  decisionRef?: string
}

export interface CaptureReaderView {
  clis: CaptureCliStatusView[]
  unclassifiedCount: number
  expiredUnclassifiedCount: number
  capturedNotInscribed: CapturedWaitingItem[]
  hasOpenQueueEntry: boolean
  active: boolean
}

/**
 * Pure read-only view of the capture registry and the identity's capture queue (V4).
 * Never creates any file or folder, never acquires a lock, never mutates or purges disk state;
 * over-age `captured` entries are counted as `expired` in memory against `now`.
 */
export function readCaptureViewForIdentity(
  identity: string,
  opts: { env?: NodeJS.ProcessEnv | undefined; now?: string | undefined } = {},
): CaptureReaderView {
  const env = opts.env ?? process.env
  const now = opts.now ?? new Date().toISOString()
  const retentionHours = resolveCaptureRetentionHours(env)

  const registry = readCaptureRegistry(env)
  const clis: CaptureCliStatusView[] = Object.entries(registry.clis)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([cli, info]) => ({
      cli,
      version: info.version,
      mode: info.mode,
      lastCaptureAt: info.lastCaptureAt,
    }))

  const rawEntries = listCaptures(identity, { env, now })
  let unclassifiedCount = 0
  let expiredUnclassifiedCount = 0
  let hasOpenQueueEntry = false
  const capturedNotInscribed: CapturedWaitingItem[] = []

  for (const raw of rawEntries) {
    const entry: CaptureEntry = effectiveCaptureEntry(raw, now, retentionHours)
    if (isOpenCaptureState(entry.state)) hasOpenQueueEntry = true
    if (entry.state === 'captured') {
      unclassifiedCount += 1
    } else if (entry.state === 'expired') {
      expiredUnclassifiedCount += 1
    } else if (entry.state === 'classified' && entry.classification !== undefined) {
      const kind = entry.classification.as
      if (kind === 'new-demand' || kind === 'follow-up' || kind === 'decision-answer') {
        capturedNotInscribed.push({
          id: entry.id,
          at: entry.at,
          classKind: kind,
          title: entry.classification.title?.trim() || '(sans titre)',
          ...(entry.classification.demandNumber !== undefined
            ? { demandNumber: entry.classification.demandNumber }
            : {}),
          ...(entry.classification.decisionRef !== undefined
            ? { decisionRef: entry.classification.decisionRef }
            : {}),
        })
      }
    }
  }

  const hasActiveCli = clis.some((c) => c.mode === 'direct' || c.mode === 'deferred')
  return {
    clis,
    unclassifiedCount,
    expiredUnclassifiedCount,
    capturedNotInscribed,
    hasOpenQueueEntry,
    active: hasActiveCli || hasOpenQueueEntry,
  }
}

/**
 * Pure read-only predicate (DS-2, spec §7.1): capture is active for a folder's identity when
 * the registry lists at least one CLI as `direct` or `deferred`, OR the folder's queue holds
 * at least one entry that is not closed.
 */
export function isCaptureActiveForIdentity(
  identity: string,
  opts: { env?: NodeJS.ProcessEnv | undefined; now?: string | undefined } = {},
): boolean {
  return readCaptureViewForIdentity(identity, opts).active
}
