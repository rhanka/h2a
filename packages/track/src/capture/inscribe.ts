import { existsSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'

import type { JournalResolveOptions } from '../cli/journal-reference.js'
import { EventStore } from '../events/store.js'
import type { ActorId, CaptureOrigin, Provenance } from '../events/types.js'
import { isPathInUnignoredGitTree } from '../fs-private.js'
import { prepareInscriptionJournal } from '../journal/inscription.js'
import { DomainError } from '../model/item.js'
import { maskPrivateTermsWithPolicy, type OwnerTablePolicy } from '../report/owner-table.js'
import { resolveOwnerTablePolicyFile } from '../state-home.js'
import { fold } from '../state/fold.js'
import { Track } from '../track.js'
import { WritePolicyError, type WriterTokenInput } from '../write-policy.js'
import {
  effectiveCaptureEntry,
  findCaptureEntry,
  listCaptures,
  resolveCaptureRetentionHours,
  sweepExpiredQueues,
  updateCaptureEntry,
  type CaptureAckKind,
  type CaptureClassKind,
  type CaptureEntry,
  type CaptureInscriptionReceipt,
} from './queue.js'
import { maskSecrets } from './secrets.js'

const FORBIDDEN_DEMAND_ORIGINS: ReadonlySet<CaptureOrigin> = new Set([
  'injected',
  'subagent',
  'background',
])

export class InscriptionDeferredError extends DomainError {
  constructor(message: string) {
    super(message)
    this.name = 'InscriptionDeferredError'
  }
}

/**
 * Determine whether `eventsPath` sits in a git work tree and is NOT gitignored (spec §7.5, plan/07 Lot 4).
 */
export function isVersionedJournal(
  eventsPath: string,
  procEnv: NodeJS.ProcessEnv = process.env,
): boolean {
  return isPathInUnignoredGitTree(eventsPath, procEnv)
}

function loadPolicyForJournal(eventsPath: string, env: NodeJS.ProcessEnv): OwnerTablePolicy | undefined {
  const resolved = resolveOwnerTablePolicyFile({
    trackDir: dirname(eventsPath),
    env,
  })
  if (resolved.policyPath === undefined || !existsSync(resolved.policyPath)) return undefined
  try {
    return JSON.parse(readFileSync(resolved.policyPath, 'utf8')) as OwnerTablePolicy
  } catch {
    return undefined
  }
}

function resolveDecisionTargetId(
  store: EventStore,
  decisionRef: string,
): { id: string; displayRef: string } {
  const state = fold(store.readAll())
  const trimmed = decisionRef.trim()
  const numMatch = /^D?(\d+)$/iu.exec(trimmed)
  if (numMatch !== null && numMatch[1] !== undefined) {
    const n = Number(numMatch[1])
    for (const dec of state.decisions.values()) {
      if (dec.ownerNumber === n) {
        return { id: dec.id, displayRef: `D${n}` }
      }
    }
    throw new DomainError(`capture inscribe: no decision with number D${n}`)
  }
  const direct = state.decisions.get(trimmed)
  if (direct === undefined) {
    throw new DomainError(`capture inscribe: unknown decision "${maskSecrets(trimmed).text}"`)
  }
  return {
    id: direct.id,
    displayRef: direct.ownerNumber !== undefined ? `D${direct.ownerNumber}` : direct.id,
  }
}

function resolveDemandByNumber(store: EventStore, demandNumber: number): string {
  const state = fold(store.readAll())
  for (const demand of state.demands.values()) {
    if (demand.ownerNumber === demandNumber) return demand.id
  }
  throw new DomainError(`capture inscribe: no demand with number #${demandNumber}`)
}

export interface InscribeContext {
  resolveOpts: JournalResolveOptions
  by: ActorId
  tokenInput?: WriterTokenInput | undefined
  env?: NodeJS.ProcessEnv | undefined
  now?: string | undefined
}

export interface InscribeResult {
  entry: CaptureEntry
  alreadyInscribed: boolean
  receipt: CaptureInscriptionReceipt
}

/**
 * Inscribe one `classified` capture entry into its resolved journal of reference (plan/07 Lot 4).
 * Uses `entry.id` as the idempotency key across all three classes; purges queue text only AFTER
 * the journal write is confirmed.
 */
export function inscribeCaptureEntry(
  captureId: string,
  preferredIdentity: string | undefined,
  ctx: InscribeContext,
): InscribeResult {
  const env = ctx.env ?? process.env
  const now = ctx.now ?? new Date().toISOString()

  const found = findCaptureEntry(captureId, preferredIdentity, env)
  if (found === undefined) {
    throw new DomainError(`capture entry ${captureId} not found`)
  }
  const entry = found.entry
  if (entry.state === 'inscribed' && entry.inscribed !== undefined) {
    return { entry, alreadyInscribed: true, receipt: entry.inscribed }
  }
  if (entry.state !== 'classified' || entry.classification === undefined) {
    throw new DomainError(
      `capture inscribe: entry ${captureId} is in state "${entry.state}" (expected "classified")`,
    )
  }
  if (FORBIDDEN_DEMAND_ORIGINS.has(entry.origin)) {
    throw new DomainError(
      `capture inscribe: entry ${captureId} has origin "${entry.origin}" and cannot be inscribed`,
    )
  }
  if (entry.text === null) {
    throw new DomainError(`capture inscribe: entry ${captureId} has no text remaining`)
  }

  let journal
  try {
    journal = prepareInscriptionJournal({ ...ctx.resolveOpts, processEnv: env })
  } catch (err) {
    if (err instanceof DomainError && err.message.startsWith('inscription refusée')) {
      throw new InscriptionDeferredError(err.message)
    }
    throw err
  }

  const store = new EventStore(journal.eventsPath, {
    ...(ctx.tokenInput?.writerToken !== undefined ? { writerToken: ctx.tokenInput.writerToken } : {}),
    ...(ctx.tokenInput?.writerTokenFile !== undefined ? { writerTokenFile: ctx.tokenInput.writerTokenFile } : {}),
    env,
  })

  // Defense in depth: mask secrets on text and title before journal write, then apply private-term
  // masking when the journal is versioned (git work tree, not ignored).
  let textToInscribe = maskSecrets(entry.text).text
  let titleToInscribe =
    entry.classification.title !== undefined ? maskSecrets(entry.classification.title).text : undefined
  let maskedAtInscription = false
  if (isVersionedJournal(journal.eventsPath, env)) {
    const policy = loadPolicyForJournal(journal.eventsPath, env)
    if (policy !== undefined) {
      const maskedText = maskPrivateTermsWithPolicy(textToInscribe, policy)
      if (maskedText.masked) {
        textToInscribe = maskedText.text
        maskedAtInscription = true
      }
      if (titleToInscribe !== undefined) {
        const maskedTitle = maskPrivateTermsWithPolicy(titleToInscribe, policy)
        if (maskedTitle.masked) {
          titleToInscribe = maskedTitle.text
          maskedAtInscription = true
        }
      }
    }
  }

  const prov: Provenance = {
    transport: 'capture',
    proposed: false,
    auth: 'local-user',
    origin: entry.origin,
  }
  const track = new Track(store, { by: ctx.by, prov, now: () => now })

  let receipt: CaptureInscriptionReceipt
  const cls = entry.classification
  if (cls.as === 'new-demand') {
    const raised = track.raiseNumberedDemand({
      type: 'feature',
      raw: {
        text: textToInscribe,
        ...(titleToInscribe !== undefined && titleToInscribe.trim() !== ''
          ? { title: titleToInscribe.trim() }
          : {}),
      },
      source: { kind: 'human', ref: entry.id },
      workspace: entry.identity,
      key: entry.id,
      ...(maskedAtInscription ? { masked: true } : {}),
    })
    receipt = {
      at: now,
      demandId: raised.demandId,
      demandNumber: raised.number,
      ...(maskedAtInscription ? { masked: true } : {}),
    }
  } else if (cls.as === 'follow-up') {
    if (cls.demandNumber === undefined) {
      throw new DomainError(`capture inscribe: follow-up entry ${entry.id} is missing demandNumber`)
    }
    const demandId = resolveDemandByNumber(store, cls.demandNumber)
    const ev = track.addDemandOwnerMessage(demandId, {
      captureId: entry.id,
      at: entry.at,
      origin: entry.origin,
      text: textToInscribe,
      ...(maskedAtInscription ? { masked: true } : {}),
      key: entry.id,
    })
    receipt = {
      at: now,
      demandId,
      demandNumber: cls.demandNumber,
      eventId: ev.id,
      ...(maskedAtInscription ? { masked: true } : {}),
    }
  } else if (cls.as === 'decision-answer') {
    if (cls.decisionRef === undefined) {
      throw new DomainError(`capture inscribe: decision-answer entry ${entry.id} is missing decisionRef`)
    }
    const target = resolveDecisionTargetId(store, cls.decisionRef)
    const ev = track.addDecisionOwnerMessage(target.id, {
      captureId: entry.id,
      at: entry.at,
      origin: entry.origin,
      text: textToInscribe,
      ...(maskedAtInscription ? { masked: true } : {}),
      key: entry.id,
    })
    receipt = {
      at: now,
      decisionId: target.id,
      eventId: ev.id,
      ...(maskedAtInscription ? { masked: true } : {}),
    }
  } else {
    throw new DomainError(`capture inscribe: cannot inscribe classification "${cls.as}"`)
  }

  // Purge queue text, folder, and classification.title ONLY AFTER journal write succeeded (plan/07 Lot 4, C1/C4).
  const updated = updateCaptureEntry(
    entry.identity,
    entry.id,
    (cur) => {
      const { folder: _strippedFolder, ...rest } = cur
      const nextClassification =
        cur.classification !== undefined
          ? (() => {
              const { title: _strippedTitle, ...clsRest } = cur.classification
              return clsRest
            })()
          : undefined
      return {
        ...rest,
        state: 'inscribed',
        text: null,
        ...(nextClassification !== undefined ? { classification: nextClassification } : {}),
        inscribed: receipt,
      }
    },
    { env, now },
  )

  return { entry: updated, alreadyInscribed: false, receipt }
}

export interface ClassifyInput {
  captureId: string
  as: CaptureClassKind
  title?: string | undefined
  demandNumber?: number | undefined
  decisionRef?: string | undefined
}

export interface ClassifyResult {
  entry: CaptureEntry
  inscribed: boolean
  deferredReason?: string
  receipt?: CaptureInscriptionReceipt
}

/**
 * Classify a captured message and, when open, inscribe it immediately; when the journal refuses
 * (exclusive mode without token or undesignated copy), keep it `classified` in the queue.
 */
export function classifyCaptureEntry(
  input: ClassifyInput,
  preferredIdentity: string | undefined,
  ctx: InscribeContext,
): ClassifyResult {
  const env = ctx.env ?? process.env
  const now = ctx.now ?? new Date().toISOString()
  const retentionHours = resolveCaptureRetentionHours(env)

  const found = findCaptureEntry(input.captureId, preferredIdentity, env)
  if (found === undefined) {
    throw new DomainError(`capture entry ${input.captureId} not found`)
  }
  const effective = effectiveCaptureEntry(found.entry, now, retentionHours)
  if (effective.state === 'expired') {
    throw new DomainError(
      `capture classify: entry ${input.captureId} has expired — use \`track capture acknowledge ${input.captureId} --as <late-demand|not-a-demand|recorded-elsewhere>\``,
    )
  }
  if (effective.state !== 'captured') {
    throw new DomainError(
      `capture classify: entry ${input.captureId} is already in state "${effective.state}"`,
    )
  }

  if (input.as === 'not-a-demand') {
    const dismissed = updateCaptureEntry(
      effective.identity,
      effective.id,
      (cur) => {
        const { folder: _strippedFolder, ...rest } = cur
        return {
          ...rest,
          state: 'dismissed',
          text: null,
          classification: {
            as: 'not-a-demand',
            classifiedAt: now,
          },
        }
      },
      { env, now },
    )
    return { entry: dismissed, inscribed: false }
  }

  // DS-9 / V9: injected, subagent and background entries NEVER become a demand, follow-up or answer.
  if (FORBIDDEN_DEMAND_ORIGINS.has(effective.origin)) {
    throw new DomainError(
      `capture classify: entry ${effective.id} has origin "${effective.origin}" and cannot be classified as "${input.as}"`,
    )
  }

  if (input.as === 'new-demand') {
    if (input.title === undefined || input.title.trim() === '') {
      throw new DomainError('capture classify --as new-demand requires --title <short title>')
    }
  } else if (input.as === 'follow-up') {
    if (input.demandNumber === undefined || !Number.isInteger(input.demandNumber) || input.demandNumber < 1) {
      throw new DomainError('capture classify --as follow-up requires --demand <positive number>')
    }
  } else if (input.as === 'decision-answer') {
    if (input.decisionRef === undefined || input.decisionRef.trim() === '') {
      throw new DomainError('capture classify --as decision-answer requires --decision <number|id>')
    }
  }

  const sanitizedTitle =
    input.title !== undefined && input.title.trim() !== ''
      ? maskSecrets(input.title.trim()).text
      : undefined
  const sanitizedDecisionRef =
    input.decisionRef !== undefined && input.decisionRef.trim() !== ''
      ? maskSecrets(input.decisionRef.trim()).text
      : undefined

  const classified = updateCaptureEntry(
    effective.identity,
    effective.id,
    (cur) => ({
      ...cur,
      state: 'classified',
      classification: {
        as: input.as,
        classifiedAt: now,
        ...(sanitizedTitle !== undefined ? { title: sanitizedTitle } : {}),
        ...(input.demandNumber !== undefined ? { demandNumber: input.demandNumber } : {}),
        ...(sanitizedDecisionRef !== undefined ? { decisionRef: sanitizedDecisionRef } : {}),
      },
    }),
    { env, now },
  )

  try {
    const res = inscribeCaptureEntry(classified.id, classified.identity, ctx)
    return { entry: res.entry, inscribed: true, receipt: res.receipt }
  } catch (err) {
    if (err instanceof WritePolicyError || err instanceof InscriptionDeferredError) {
      return { entry: classified, inscribed: false, deferredReason: err.message }
    }
    throw err
  }
}

/**
 * Inscribe every `classified` entry of `identity` in chronological order (`track capture inscribe --all`).
 */
export function inscribeAllClassified(
  identity: string,
  ctx: InscribeContext,
): InscribeResult[] {
  const env = ctx.env ?? process.env
  const now = ctx.now ?? new Date().toISOString()
  const classified = listCaptures(identity, { env, now, state: 'classified' })
  const results: InscribeResult[] = []
  for (const entry of classified) {
    results.push(inscribeCaptureEntry(entry.id, identity, ctx))
  }
  if (results.length === 0) {
    sweepExpiredQueues({ env, now })
  }
  return results
}

export interface AcknowledgeInput {
  captureId: string
  as: CaptureAckKind
  text?: string | undefined
  title?: string | undefined
}

/**
 * Acknowledge an expired trace (DS-3, plan/07 Lot 2).
 * `late-demand` inscribes through the ordinary `cli` transport so the reader labels it `(non capté)`.
 */
export function acknowledgeExpiredCapture(
  input: AcknowledgeInput,
  preferredIdentity: string | undefined,
  ctx: InscribeContext,
): CaptureEntry {
  const env = ctx.env ?? process.env
  const now = ctx.now ?? new Date().toISOString()
  const retentionHours = resolveCaptureRetentionHours(env)

  const found = findCaptureEntry(input.captureId, preferredIdentity, env)
  if (found === undefined) {
    throw new DomainError(`capture entry ${input.captureId} not found`)
  }
  const effective = effectiveCaptureEntry(found.entry, now, retentionHours)
  if (effective.state !== 'expired') {
    throw new DomainError(
      `capture acknowledge: entry ${input.captureId} is in state "${effective.state}" (expected "expired")`,
    )
  }

  let demandId: string | undefined
  let demandNumber: number | undefined

  if (input.as === 'late-demand') {
    if (input.text === undefined || input.text.trim() === '') {
      throw new DomainError('capture acknowledge --as late-demand requires --text <text> or --stdin')
    }
    if (input.title === undefined || input.title.trim() === '') {
      throw new DomainError('capture acknowledge --as late-demand requires --title <short title>')
    }
    const journal = prepareInscriptionJournal({ ...ctx.resolveOpts, processEnv: env })
    const store = new EventStore(journal.eventsPath, {
      ...(ctx.tokenInput?.writerToken !== undefined ? { writerToken: ctx.tokenInput.writerToken } : {}),
      ...(ctx.tokenInput?.writerTokenFile !== undefined ? { writerTokenFile: ctx.tokenInput.writerTokenFile } : {}),
      env,
    })

    // Mask secrets AND private terms (when journal is versioned) before writing to events.jsonl (C1, V8).
    let textToInscribe = maskSecrets(input.text).text
    let titleToInscribe = maskSecrets(input.title.trim()).text
    let maskedAtInscription = false
    if (isVersionedJournal(journal.eventsPath, env)) {
      const policy = loadPolicyForJournal(journal.eventsPath, env)
      if (policy !== undefined) {
        const maskedText = maskPrivateTermsWithPolicy(textToInscribe, policy)
        if (maskedText.masked) {
          textToInscribe = maskedText.text
          maskedAtInscription = true
        }
        const maskedTitle = maskPrivateTermsWithPolicy(titleToInscribe, policy)
        if (maskedTitle.masked) {
          titleToInscribe = maskedTitle.text
          maskedAtInscription = true
        }
      }
    }

    const cliProv: Provenance = { transport: 'cli', proposed: false, auth: 'local-user' }
    const track = new Track(store, { by: ctx.by, prov: cliProv, now: () => now })
    const raised = track.raiseNumberedDemand({
      type: 'feature',
      raw: { text: textToInscribe, title: titleToInscribe },
      source: { kind: 'human', ref: effective.id },
      workspace: effective.identity,
      summary: titleToInscribe,
      key: effective.id,
      ...(maskedAtInscription ? { masked: true } : {}),
    })
    demandId = raised.demandId
    demandNumber = raised.number
  }

  return updateCaptureEntry(
    effective.identity,
    effective.id,
    (cur) => {
      const { folder: _strippedFolder, ...rest } = cur
      return {
        ...rest,
        state: 'acknowledged',
        text: null,
        expiredAt: cur.expiredAt ?? now,
        acknowledgement: {
          as: input.as,
          at: now,
          ...(demandId !== undefined ? { demandId } : {}),
          ...(demandNumber !== undefined ? { demandNumber } : {}),
        },
      }
    },
    { env, now },
  )
}
