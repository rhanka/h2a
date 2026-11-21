import { dirname, join } from 'node:path'

import {
  resolveJournalOfReference,
  type JournalResolutionKind,
  type JournalResolveOptions,
} from '../cli/journal-reference.js'
import type { EventStore } from '../events/store.js'
import { DomainError } from '../model/item.js'
import { fold } from '../state/fold.js'
import { trackStateHome } from '../state-home.js'
import type { JournalIdentityKind } from './identity.js'
import { ensureIdentityRoot, ensurePrivateDir, recordCopy } from './index-store.js'

export interface InscriptionJournalResult {
  trackDir: string
  eventsPath: string
  identity: string
  identityKind: JournalIdentityKind
  identityRoot: string
  resolution: JournalResolutionKind
  createdOffRepo: boolean
}

/**
 * Prepare the journal of reference for an inscription command (`demand raise`, `decision number`,
 * or capture inscription):
 *   1. Records any step-5 `.track` copy BEFORE checking whether writing is allowed, so a refused
 *      inscription still makes its copy known (spec §6.3, plan/06 Lot 2 & Lot 4).
 *   2. Refuses with a message naming `track journal designate` when `inscriptionAllowed` is false.
 *   3. Creates the off-repo journal directory (`0700`) and records the identity's `root` (`0600`)
 *      when step 6 is reached and the journal does not yet exist.
 */
export function prepareInscriptionJournal(opts: JournalResolveOptions): InscriptionJournalResult {
  const procEnv = opts.processEnv ?? process.env
  let resolved = resolveJournalOfReference(opts)

  if (resolved.matchedStep === 5 && resolved.step5CopyPath != null) {
    recordCopy(resolved.identity, resolved.identityRoot, resolved.step5CopyPath, { env: procEnv })
    resolved = resolveJournalOfReference(opts)
  }

  if (!resolved.inscriptionAllowed) {
    const detail =
      resolved.knownCopies > 1
        ? `copie non désignée (${resolved.knownCopies} copies connues) pour ${resolved.identity}`
        : (resolved.reason ?? `inscription non autorisée pour ${resolved.identity}`)
    throw new DomainError(
      `inscription refusée : ${detail}. Exécutez \`track journal designate <dir>\` pour désigner le journal de référence.`,
    )
  }

  if (resolved.matchedStep === 6 && resolved.journal !== null) {
    const stateHome = trackStateHome(procEnv)
    const journalsRoot = join(stateHome, 'journals')
    const digestDir = dirname(resolved.journal)
    const createdOffRepo = !resolved.exists
    ensurePrivateDir(stateHome)
    ensurePrivateDir(journalsRoot)
    ensurePrivateDir(digestDir)
    ensurePrivateDir(resolved.journal)
    ensureIdentityRoot(resolved.identity, resolved.identityRoot, { env: procEnv })
    return {
      trackDir: resolved.journal,
      eventsPath: join(resolved.journal, 'events.jsonl'),
      identity: resolved.identity,
      identityKind: resolved.identityKind,
      identityRoot: resolved.identityRoot,
      resolution: 'journal hors dépôt',
      createdOffRepo,
    }
  }

  if (resolved.trackDir === null || resolved.resolution === null) {
    throw new DomainError(
      `inscription refusée : aucun journal accessible pour ${resolved.identity}. Exécutez \`track journal designate <dir>\` ou initialisez un journal.`,
    )
  }

  return {
    trackDir: resolved.trackDir,
    eventsPath: join(resolved.trackDir, 'events.jsonl'),
    identity: resolved.identity,
    identityKind: resolved.identityKind,
    identityRoot: resolved.identityRoot,
    resolution: resolved.resolution,
    createdOffRepo: false,
  }
}

/**
 * Compute the next global owner demand number across the entire journal (demands + legacy items,
 * never filtered by `workspace` — spec V5 & §6.3).
 */
export function nextOwnerDemandNumber(store: EventStore): number {
  const events = store.readAll()
  const state = fold(events)
  let maxNum = 0
  for (const d of state.demands.values()) {
    if (d.ownerNumber !== undefined && d.ownerNumber > maxNum) maxNum = d.ownerNumber
  }
  for (const it of state.items.values()) {
    if (it.report?.ownerNumber !== undefined && it.report.ownerNumber > maxNum) {
      maxNum = it.report.ownerNumber
    }
  }
  for (const ev of events) {
    if (ev.type === 'demand.owner-numbered') {
      const n = (ev.payload as { number?: number }).number
      if (typeof n === 'number' && Number.isInteger(n) && n > maxNum) maxNum = n
    } else if (ev.type === 'item.report-updated') {
      const n = (ev.payload as { ownerNumber?: number }).ownerNumber
      if (typeof n === 'number' && Number.isInteger(n) && n > maxNum) maxNum = n
    }
  }
  return maxNum + 1
}
