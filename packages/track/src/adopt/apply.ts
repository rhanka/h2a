import { createHash, timingSafeEqual } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { EventStore } from '../events/store.js'
import type { ActorId, Provenance, TrackEvent } from '../events/types.js'
import type { Option } from '../model/decision.js'
import type { DemandType } from '../model/demand.js'
import { DomainError, type ItemState } from '../model/item.js'
import { hasTextGateViolation, projectOwnerTable } from '../report/owner-table.js'
import { resolveOwnerTablePolicyFile } from '../state-home.js'
import { fold, type State } from '../state/fold.js'
import { Track, type DedupeHook } from '../track.js'
import {
  adoptionEntryClientToken,
  ALLOWED_ADOPTION_ACTIONS,
  buildAdoptionPlan,
  computeAdoptionPlanHash,
  type AdoptionPlan,
  type AdoptionPlanEntry,
  type BuildAdoptionPlanOptions,
} from './plan.js'

const CLI_PROV: Provenance = { transport: 'cli', proposed: false, auth: 'local-user' }

export interface AdoptionEntryResult {
  id: string
  status: 'applied' | 'already applied' | 'refused'
  reason?: string
}

export interface ApplyAdoptionResult {
  planHash: string
  results: AdoptionEntryResult[]
  applied: number
  alreadyApplied: number
  refused: number
}

export interface ApplyAdoptionOptions extends BuildAdoptionPlanOptions {
  by?: ActorId
  writerToken?: string
  writerTokenFile?: string
}

function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex')
}

function constantTimeHexEqual(a: string, b: string): boolean {
  const normA = a.replace(/^sha256:/iu, '').trim().toLowerCase()
  const normB = b.replace(/^sha256:/iu, '').trim().toLowerCase()
  if (normA.length === 0 || normA.length !== normB.length) return false
  return timingSafeEqual(Buffer.from(normA, 'utf8'), Buffer.from(normB, 'utf8'))
}

/**
 * Enforce exclusive write policy when `write-policy.json` beside `events.jsonl` declares
 * `mode: "exclusive"`. Refuses unless the holder presents the matching writer token.
 */
function assertWritePolicyAllows(eventsPath: string, options: ApplyAdoptionOptions): void {
  const policyPath = join(dirname(eventsPath), 'write-policy.json')
  if (!existsSync(policyPath)) return
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(policyPath, 'utf8'))
  } catch {
    throw new DomainError(`adopt apply: malformed write-policy.json at ${policyPath}`)
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return
  const policy = parsed as Record<string, unknown>
  if (policy['mode'] !== 'exclusive') return

  const holder = typeof policy['holder'] === 'string' && policy['holder'].trim() !== '' ? policy['holder'] : 'unknown'
  const epoch = typeof policy['epoch'] === 'number' ? policy['epoch'] : 0
  const expectedDigest =
    typeof policy['tokenHash'] === 'string'
      ? policy['tokenHash']
      : typeof policy['tokenDigest'] === 'string'
        ? policy['tokenDigest']
        : undefined

  let presented = options.writerToken
  if (presented === undefined && options.writerTokenFile !== undefined) {
    if (!existsSync(options.writerTokenFile)) {
      throw new DomainError(
        `adopt apply: refused — exclusive journal (holder: ${holder}, epoch: ${epoch}); token file not found`,
      )
    }
    presented = readFileSync(options.writerTokenFile, 'utf8').trim()
  }
  if (presented === undefined) {
    presented = process.env['TRACK_WRITER_TOKEN']
  }

  if (
    expectedDigest === undefined ||
    presented === undefined ||
    presented.trim() === '' ||
    !constantTimeHexEqual(sha256Hex(presented.trim()), expectedDigest)
  ) {
    throw new DomainError(
      `adopt apply: refused — journal is in exclusive write mode (holder: ${holder}, epoch: ${epoch}); only the holder may apply adoption plans`,
    )
  }
}

function tokenDedupe(key: string): DedupeHook {
  return (_inputs, existing): TrackEvent[] | null => {
    const matched = existing.filter((e) => e.clientToken === key)
    return matched.length > 0 ? matched : null
  }
}

function assertPlanObject(raw: unknown): AdoptionPlan {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new DomainError('adopt apply: plan file must be a JSON object')
  }
  const obj = raw as Record<string, unknown>
  if (obj['version'] !== 1) {
    throw new DomainError(`adopt apply: unsupported plan version "${String(obj['version'])}"`)
  }
  if (typeof obj['planHash'] !== 'string' || obj['planHash'].trim() === '') {
    throw new DomainError('adopt apply: plan must carry a non-empty planHash')
  }
  if (!Array.isArray(obj['entries'])) {
    throw new DomainError('adopt apply: plan must carry an entries array')
  }
  for (const e of obj['entries']) {
    if (typeof e !== 'object' || e === null || Array.isArray(e)) {
      throw new DomainError('adopt apply: each plan entry must be an object')
    }
    const rec = e as Record<string, unknown>
    if (typeof rec['id'] !== 'string' || rec['id'].trim() === '') {
      throw new DomainError('adopt apply: each plan entry must carry a non-empty id')
    }
    if (typeof rec['action'] !== 'string' || rec['action'].trim() === '') {
      throw new DomainError(`adopt apply: entry "${rec['id']}" must carry an action`)
    }
  }
  return raw as AdoptionPlan
}

function entryStructuralKey(entry: AdoptionPlanEntry): string {
  return JSON.stringify({
    id: entry.id,
    class: entry.class,
    kind: entry.kind,
    action: entry.action,
    element: entry.element,
    proposedWrite: entry.proposedWrite,
    ...(entry.pendingOn !== undefined ? { pendingOn: entry.pendingOn } : {}),
  })
}

function phaseOf(entry: AdoptionPlanEntry): number {
  if (entry.action === 'number-demand' || entry.action === 'reconstruct-demand' || entry.action === 'raise-initial-demand') {
    return 1
  }
  if (entry.action === 'instruct-decision') return 2
  return 3
}

function findItemBackingRow(state: State, rowNumber?: number, rowId?: string): ItemState | undefined {
  if (rowId !== undefined) {
    const directItem = state.items.get(rowId)
    if (directItem !== undefined) return directItem
    const demand = state.demands.get(rowId)
    if (demand !== undefined && (demand.itemIds?.length ?? 0) === 1) {
      return state.items.get(demand.itemIds![0]!)
    }
    return undefined
  }
  if (rowNumber !== undefined) {
    for (const demand of state.demands.values()) {
      if (demand.ownerNumber === rowNumber) {
        if ((demand.itemIds?.length ?? 0) === 1) {
          return state.items.get(demand.itemIds![0]!)
        }
        return undefined
      }
    }
    for (const item of state.items.values()) {
      if (item.report?.ownerNumber === rowNumber) return item
    }
  }
  return undefined
}

function optionLetterToIndex(letter: string): number {
  let idx = 0
  for (const ch of letter.toUpperCase()) {
    const code = ch.charCodeAt(0)
    if (code < 65 || code > 90) return -1
    idx = idx * 26 + (code - 64)
  }
  return idx - 1
}

function applySingleEntry(
  entry: AdoptionPlanEntry,
  key: string,
  track: Track,
  store: EventStore,
  eventsPath: string,
  options: ApplyAdoptionOptions,
): AdoptionEntryResult {
  if (!ALLOWED_ADOPTION_ACTIONS.has(entry.action)) {
    return {
      id: entry.id,
      status: 'refused',
      reason: `unsupported action "${String(entry.action)}" (this tool never settles, withdraws or archives decisions)`,
    }
  }

  if (entry.pendingOn === 'lot-2' || entry.action === 'number-decision') {
    return {
      id: entry.id,
      status: 'refused',
      reason: 'pending on lot 2 (decision numbering verb not yet available)',
    }
  }

  const res = entry.resolution
  if (entry.kind === 'to-decide' && (res === undefined || res === null || typeof res !== 'object' || Array.isArray(res))) {
    return {
      id: entry.id,
      status: 'refused',
      reason: `unresolved to-decide entry "${entry.id}"`,
    }
  }

  const dedupe = tokenDedupe(key)

  try {
    switch (entry.action) {
      case 'number-demand': {
        const demandId = String(entry.proposedWrite['demandId'] ?? entry.element.id ?? '')
        const num = Number(entry.proposedWrite['number'])
        track.withClientToken(key, () => track.numberDemand(demandId, num), { dedupe })
        return { id: entry.id, status: 'applied' }
      }

      case 'reconstruct-demand': {
        const itemId = String(entry.proposedWrite['itemId'] ?? entry.element.id ?? '')
        const num = Number(entry.proposedWrite['number'])
        const text = String(entry.proposedWrite['text'] ?? '')
        const rawType = entry.proposedWrite['type']
        const type: DemandType | undefined =
          rawType === 'feature' || rawType === 'defect' || rawType === 'chore' ? rawType : undefined
        track.withClientToken(
          key,
          () => track.adoptItemAsDemand(itemId, { number: num, text, ...(type !== undefined ? { type } : {}) }),
          { dedupe },
        )
        return { id: entry.id, status: 'applied' }
      }

      case 'raise-initial-demand': {
        const text = typeof res!['text'] === 'string' ? res!['text'].trim() : ''
        const workspace = typeof res!['workspace'] === 'string' ? res!['workspace'].trim() : ''
        if (text === '' || workspace === '') {
          return { id: entry.id, status: 'refused', reason: 'resolution requires non-empty "text" and "workspace"' }
        }
        const rawType = res!['type']
        const type: DemandType =
          rawType === 'defect' || rawType === 'chore' || rawType === 'feature' ? rawType : 'feature'
        const events = store.readAll()
        const view = projectOwnerTable(fold(events), events)
        const nums = [...view.registeredNumbers, ...view.archivedNumbers]
        const nextNum = (nums.length > 0 ? Math.max(...nums) : 0) + 1
        const demandId = track.withClientToken(
          key,
          () =>
            track.raiseDemand({
              type,
              workspace,
              raw: { text },
              source: { kind: 'human' },
            }),
          { dedupe },
        )
        track.withClientToken(`${key}:number`, () => track.numberDemand(demandId, nextNum), {
          dedupe: tokenDedupe(`${key}:number`),
        })
        return { id: entry.id, status: 'applied' }
      }

      case 'instruct-decision': {
        const decisionId = String(entry.proposedWrite['decisionId'] ?? entry.element.id ?? '')
        const current = track.state().decisions.get(decisionId)?.dossier
        if (current === undefined) {
          return { id: entry.id, status: 'refused', reason: `unknown decision ${decisionId}` }
        }
        const rawOptions = res!['options']
        const rawRec = res!['recommendation'] as Record<string, unknown> | undefined
        if (!Array.isArray(rawOptions) || rawOptions.length < 2) {
          return { id: entry.id, status: 'refused', reason: 'resolution requires at least 2 options' }
        }
        if (
          typeof rawRec !== 'object' ||
          rawRec === null ||
          typeof rawRec['optionId'] !== 'string' ||
          typeof rawRec['rationale'] !== 'string'
        ) {
          return {
            id: entry.id,
            status: 'refused',
            reason: 'resolution requires recommendation { optionId, rationale }',
          }
        }
        const context = typeof res!['context'] === 'string' ? res!['context'] : current.context
        track.withClientToken(
          key,
          () =>
            track.reviseDossier(decisionId, {
              ...current,
              context,
              options: rawOptions as Option[],
              recommendation: {
                optionId: rawRec['optionId'] as string,
                rationale: rawRec['rationale'] as string,
              },
            }),
          { dedupe },
        )
        return { id: entry.id, status: 'applied' }
      }

      case 'attach-dossier': {
        const decisionId = String(entry.proposedWrite['decisionId'] ?? entry.element.id ?? '')
        const dossierLink = typeof res!['dossierLink'] === 'string' ? res!['dossierLink'].trim() : ''
        if (dossierLink === '') {
          return { id: entry.id, status: 'refused', reason: 'resolution requires a non-empty "dossierLink"' }
        }
        const label = typeof res!['label'] === 'string' && res!['label'].trim() !== '' ? res!['label'].trim() : undefined
        track.addDecisionArtifact(
          decisionId,
          {
            kind: 'rendered-view',
            viewRef: dossierLink,
            ...(label !== undefined ? { label } : {}),
          },
          key,
        )
        return { id: entry.id, status: 'applied' }
      }

      case 'attach-decision': {
        const decisionId = String(entry.proposedWrite['decisionId'] ?? entry.element.id ?? '')
        const rowNumber =
          typeof res!['rowNumber'] === 'number' && Number.isInteger(res!['rowNumber']) && res!['rowNumber'] >= 1
            ? res!['rowNumber']
            : undefined
        const rowId = typeof res!['rowId'] === 'string' && res!['rowId'].trim() !== '' ? res!['rowId'].trim() : undefined
        if (rowNumber === undefined && rowId === undefined) {
          return {
            id: entry.id,
            status: 'refused',
            reason: 'resolution requires positive integer "rowNumber" or non-empty "rowId"',
          }
        }
        const currentEvents = store.readAll()
        const currentState = fold(currentEvents)
        const targetItem = findItemBackingRow(currentState, rowNumber, rowId)
        if (targetItem === undefined) {
          return {
            id: entry.id,
            status: 'refused',
            reason: `target row ${rowNumber !== undefined ? `#${rowNumber}` : rowId} has no backing item to carry decisionRefs; choose an item-backed row`,
          }
        }
        const view = projectOwnerTable(currentState, currentEvents, options)
        const decView = view.decisions.find((d) => d.id === decisionId)
        if (decView === undefined || decView.ref.trim() === '') {
          return {
            id: entry.id,
            status: 'refused',
            reason: `decision ${decisionId} has no display reference to attach`,
          }
        }
        const prevReport = targetItem.report ?? {}
        const prevRefs = prevReport.decisionRefs ?? []
        const nextRefs = prevRefs.includes(decView.ref) ? prevRefs : [...prevRefs, decView.ref]
        track.withClientToken(
          key,
          () => track.setReportStatus(targetItem.id, { ...prevReport, decisionRefs: nextRefs }),
          { dedupe },
        )
        return { id: entry.id, status: 'applied' }
      }

      case 'set-blocked-cause': {
        const cause = typeof res!['cause'] === 'string' ? res!['cause'].trim() : ''
        if (cause === '') {
          return { id: entry.id, status: 'refused', reason: 'resolution requires a non-empty "cause"' }
        }
        const rowId = String(entry.proposedWrite['rowId'] ?? entry.element.id ?? '')
        const currentState = track.state()
        const targetItem = findItemBackingRow(currentState, undefined, rowId)
        if (targetItem === undefined) {
          return { id: entry.id, status: 'refused', reason: `row ${rowId} has no backing item to record cause` }
        }
        const prevReport = targetItem.report ?? {}
        track.withClientToken(
          key,
          () => track.setReportStatus(targetItem.id, { ...prevReport, nextAction: cause }),
          { dedupe },
        )
        return { id: entry.id, status: 'applied' }
      }

      case 'rewrite-masked-text': {
        const text = typeof res!['text'] === 'string' ? res!['text'].trim() : ''
        if (text === '') {
          return { id: entry.id, status: 'refused', reason: 'resolution requires a non-empty "text"' }
        }
        const resolvedPolicy = resolveOwnerTablePolicyFile({
          flagPolicyPath: options.policyPath,
          trackDir: dirname(eventsPath),
        })
        if (
          hasTextGateViolation(text, {
            ...(options.policy !== undefined ? { policy: options.policy } : {}),
            ...(resolvedPolicy.defaultPolicyPath !== undefined
              ? { defaultPolicyPath: resolvedPolicy.defaultPolicyPath }
              : {}),
            statePolicyPath: resolvedPolicy.statePolicyPath,
            ...(resolvedPolicy.policyPath !== undefined ? { policyPath: resolvedPolicy.policyPath } : {}),
          })
        ) {
          return { id: entry.id, status: 'refused', reason: 'rewritten text still fails a text gate' }
        }
        const targetKind = String(entry.proposedWrite['targetKind'] ?? entry.element.kind)
        const targetId = String(entry.proposedWrite['id'] ?? entry.element.id ?? '')
        const currentState = track.state()
        if (targetKind === 'row') {
          const cell = String(entry.proposedWrite['cell'] ?? entry.element.cell ?? 'request')
          const demand = currentState.demands.get(targetId)
          if (cell === 'request' && demand !== undefined) {
            track.withClientToken(key, () => track.updateDemandOwnerSummary(demand.id, { summary: text }), { dedupe })
            return { id: entry.id, status: 'applied' }
          }
          const item = findItemBackingRow(currentState, undefined, targetId)
          if (item === undefined) {
            return { id: entry.id, status: 'refused', reason: `unknown row item ${targetId}` }
          }
          const prevReport = item.report ?? {}
          if (cell === 'request') {
            track.withClientToken(
              key,
              () => track.setReportStatus(item.id, { ...prevReport, ownerSummary: text }),
              { dedupe },
            )
            return { id: entry.id, status: 'applied' }
          }
          if (cell === 'done') {
            track.withClientToken(
              key,
              () => track.setReportStatus(item.id, { ...prevReport, facts: text }),
              { dedupe },
            )
            return { id: entry.id, status: 'applied' }
          }
          if (cell === 'todo') {
            track.withClientToken(
              key,
              () => track.setReportStatus(item.id, { ...prevReport, nextAction: text }),
              { dedupe },
            )
            return { id: entry.id, status: 'applied' }
          }
          return { id: entry.id, status: 'refused', reason: `cannot rewrite masked cell "${cell}" automatically` }
        }
        if (targetKind === 'decision') {
          const field = String(entry.proposedWrite['field'] ?? entry.element.field ?? '')
          const dec = currentState.decisions.get(targetId)
          if (dec === undefined) {
            return { id: entry.id, status: 'refused', reason: `unknown decision ${targetId}` }
          }
          if (field === 'recommendation' && dec.dossier.recommendation !== undefined) {
            track.withClientToken(
              key,
              () =>
                track.reviseDossier(dec.id, {
                  ...dec.dossier,
                  recommendation: { ...dec.dossier.recommendation!, rationale: text },
                }),
              { dedupe },
            )
            return { id: entry.id, status: 'applied' }
          }
          if (field === 'dossierLink') {
            const artifacts = (dec.dossier.artifacts ?? []).map((a) =>
              a.kind === 'rendered-view' ? { ...a, viewRef: text } : a,
            )
            track.withClientToken(
              key,
              () => track.reviseDossier(dec.id, { ...dec.dossier, artifacts }),
              { dedupe },
            )
            return { id: entry.id, status: 'applied' }
          }
          if (field.startsWith('option:')) {
            const idx = optionLetterToIndex(field.slice('option:'.length))
            const targetOpt = idx >= 0 ? dec.dossier.options[idx] : undefined
            if (targetOpt === undefined) {
              return { id: entry.id, status: 'refused', reason: `unknown option ${field} on decision ${targetId}` }
            }
            const nextLabel = typeof res!['title'] === 'string' && res!['title'].trim() !== '' ? res!['title'].trim() : targetOpt.title
            const nextSummary = typeof res!['summary'] === 'string' && res!['summary'].trim() !== '' ? res!['summary'].trim() : text
            const nextOptions = dec.dossier.options.map((o, i) =>
              i === idx ? { ...o, title: nextLabel, summary: nextSummary } : o,
            )
            track.withClientToken(
              key,
              () => track.reviseDossier(dec.id, { ...dec.dossier, options: nextOptions }),
              { dedupe },
            )
            return { id: entry.id, status: 'applied' }
          }
          return {
            id: entry.id,
            status: 'refused',
            reason: `decision field "${field}" is immutable and cannot be rewritten by adopt`,
          }
        }
        return { id: entry.id, status: 'refused', reason: `unsupported rewrite target kind "${targetKind}"` }
      }

      case 'resolve-row-gap': {
        const check = String(entry.proposedWrite['check'] ?? '')
        const rowId = String(entry.proposedWrite['rowId'] ?? entry.element.id ?? '')
        const currentState = track.state()
        if (check === 'row.withdrawn-no-reason') {
          const reason = typeof res!['reason'] === 'string' ? res!['reason'].trim() : ''
          if (reason === '') {
            return { id: entry.id, status: 'refused', reason: 'resolution requires a non-empty "reason"' }
          }
          const item = findItemBackingRow(currentState, undefined, rowId)
          if (item === undefined) {
            return { id: entry.id, status: 'refused', reason: `row ${rowId} has no backing item` }
          }
          track.withClientToken(
            key,
            () => track.setReportStatus(item.id, { ...(item.report ?? {}), facts: reason }),
            { dedupe },
          )
          return { id: entry.id, status: 'applied' }
        }
        if (check === 'row.request-missing') {
          const text = typeof res!['text'] === 'string' ? res!['text'].trim() : ''
          if (text === '') {
            return { id: entry.id, status: 'refused', reason: 'resolution requires a non-empty "text"' }
          }
          const demand = currentState.demands.get(rowId)
          if (demand !== undefined) {
            track.withClientToken(key, () => track.updateDemandOwnerSummary(demand.id, { summary: text }), { dedupe })
            return { id: entry.id, status: 'applied' }
          }
          const item = findItemBackingRow(currentState, undefined, rowId)
          if (item === undefined) {
            return { id: entry.id, status: 'refused', reason: `row ${rowId} has no backing item` }
          }
          track.withClientToken(
            key,
            () => track.setReportStatus(item.id, { ...(item.report ?? {}), ownerSummary: text }),
            { dedupe },
          )
          return { id: entry.id, status: 'applied' }
        }
        return { id: entry.id, status: 'refused', reason: `row gap "${check}" requires manual remediation` }
      }

      case 'resolve-desync':
        return {
          id: entry.id,
          status: 'refused',
          reason: 'document desynchronisation must be resolved on disk outside Track',
        }
    }
  } catch (error) {
    return {
      id: entry.id,
      status: 'refused',
      reason: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * Apply an adoption plan to the journal at `eventsPath`.
 * - Enforces exclusive write policy if present.
 * - Re-derives the plan from the journal and refuses a stale/mismatched plan.
 * - Idempotent: entries whose idempotency key is already in the journal are skipped as `already applied`.
 * - Refuses every unresolved `to-decide` entry by name and every unsupported/settling action.
 */
export function applyAdoptionPlan(
  eventsPath: string,
  rawPlan: unknown,
  options: ApplyAdoptionOptions = {},
): ApplyAdoptionResult {
  const plan = assertPlanObject(rawPlan)
  assertWritePolicyAllows(eventsPath, options)

  const expectedHash = computeAdoptionPlanHash(plan.entries)
  if (plan.planHash !== expectedHash) {
    throw new DomainError(
      `adopt apply: planHash mismatch — declared "${plan.planHash}" != computed "${expectedHash}"`,
    )
  }

  const store = new EventStore(eventsPath)
  const existingEvents = store.readAll()
  const existingTokens = new Set(
    existingEvents.map((e) => e.clientToken).filter((t): t is string => typeof t === 'string'),
  )

  const alreadyAppliedIds = new Set<string>()
  const remainingEntries: AdoptionPlanEntry[] = []
  for (const entry of plan.entries) {
    const key = adoptionEntryClientToken(plan.planHash, entry.id)
    if (existingTokens.has(key)) {
      alreadyAppliedIds.add(entry.id)
    } else {
      remainingEntries.push(entry)
    }
  }

  // Full idempotent replay: every entry was already applied — write nothing.
  if (remainingEntries.length === 0) {
    const results: AdoptionEntryResult[] = plan.entries.map((e) => ({
      id: e.id,
      status: 'already applied',
    }))
    return {
      planHash: plan.planHash,
      results,
      applied: 0,
      alreadyApplied: results.length,
      refused: 0,
    }
  }

  // Re-derive the plan from the current journal and ensure the plan still matches it.
  const freshPlan = buildAdoptionPlan(eventsPath, options)
  const hasUnsupportedAction = plan.entries.some((e) => !ALLOWED_ADOPTION_ACTIONS.has(e.action))

  if (!hasUnsupportedAction) {
    if (alreadyAppliedIds.size === 0) {
      if (
        freshPlan.planHash !== plan.planHash ||
        (plan.baseline !== undefined &&
          (plan.baseline.streamLength !== freshPlan.baseline.streamLength ||
            plan.baseline.lastContentHash !== freshPlan.baseline.lastContentHash))
      ) {
        throw new DomainError(
          'adopt apply: plan no longer matches the journal (re-run `track adopt plan`)',
        )
      }
    } else {
      const freshById = new Map(freshPlan.entries.map((e) => [e.id, e]))
      for (const rem of remainingEntries) {
        const fresh = freshById.get(rem.id)
        if (fresh === undefined || entryStructuralKey(fresh) !== entryStructuralKey(rem)) {
          throw new DomainError(
            `adopt apply: entry "${rem.id}" no longer matches the journal (re-run \`track adopt plan\`)`,
          )
        }
      }
    }
  }

  const track = new Track(store, {
    by: options.by ?? 'human:adopt',
    prov: CLI_PROV,
    ...(options.now !== undefined ? { now: () => options.now! } : {}),
  })

  const resultById = new Map<string, AdoptionEntryResult>()
  for (const id of alreadyAppliedIds) {
    resultById.set(id, { id, status: 'already applied' })
  }

  // Execute in safe dependency order (E1/E2 -> E5 -> E6/E4/E3/E7/E8/E9) while preserving plan order in output.
  const orderedRemaining = [...remainingEntries].sort((a, b) => phaseOf(a) - phaseOf(b))
  for (const entry of orderedRemaining) {
    const key = adoptionEntryClientToken(plan.planHash, entry.id)
    const entryResult = applySingleEntry(entry, key, track, store, eventsPath, options)
    resultById.set(entry.id, entryResult)
  }

  const results = plan.entries.map((e) => resultById.get(e.id)!)
  const applied = results.filter((r) => r.status === 'applied').length
  const alreadyApplied = results.filter((r) => r.status === 'already applied').length
  const refused = results.filter((r) => r.status === 'refused').length

  return {
    planHash: plan.planHash,
    results,
    applied,
    alreadyApplied,
    refused,
  }
}

export function formatApplyResultLines(result: ApplyAdoptionResult): string {
  if (result.results.length === 0) return ''
  return `${result.results
    .map((r) => (r.status === 'refused' ? `${r.id}: refused: ${r.reason ?? 'unknown reason'}` : `${r.id}: ${r.status}`))
    .join('\n')}\n`
}
