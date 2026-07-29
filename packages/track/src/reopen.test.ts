// Regression expression (decision 01KYQ5RRN67190YMZ08EGGBSBT, owner GO on option A, 2026-07-29) — a `done`
// or `cancelled` item can be REOPENED, and the reopening carries its MOTIVE. Covers: the additive
// `realization.reopened` event (fold/validate/back-compat), the `reopenItem` facade (legality + fail-closed
// payload), the terminal-by-default guarantee of the ordinary `item realize` verb, the ingest kind + binding
// gate + workspace containment, the CLI verb, and the LOAD-BEARING consequence — a reopened item leaves the
// DONE bucket, so a workpackage percentage can recede to the truth.
//
// Boundary this suite does NOT claim: the motive is RECORDED, never verified. Track has no owner-UAT marker
// today (item 01KYQ5KM99FDGN1PZVFXR8PRVJ, WP9), so it cannot prove a closure lacked one.

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { runCli, type CliIO } from './cli/index.js'
import { readHead } from './events/head.js'
import { EventStore } from './events/store.js'
import type { EventCore, Provenance, Sha256, TrackEvent, Ulid } from './events/types.js'
import { EVENT_TYPES } from './events/types.js'
import { contentHashOf } from './events/frame.js'
import { validate } from './events/validate.js'
import { INGEST_CONTRACT_VERSION, WORK_EVENT_KINDS, WORK_EVENT_SCHEMA, type WorkEvent } from './ingest/contract.js'
import { ingest, type IngestContext } from './ingest/ingest.js'
import { mapWorkEvent } from './ingest/map.js'
import { DomainError, REOPEN_MOTIVES } from './model/item.js'
import { bucketOf } from './report/buckets.js'
import { computeWpTree } from './report/rollup.js'
import { Track } from './track.js'

let dir: string
let eventsPath: string
let store: EventStore
let t: Track

const now = (): string => '2026-07-29T12:00:00.000Z'
const counter = (): (() => Ulid) => {
  let i = 0
  return () => `id-${String(++i).padStart(4, '0')}`
}
const PROV: Provenance = { transport: 'cli', proposed: false, auth: 'local-user' }
const cfg = { baselineCommit: 'c1', requireAccepted: false }
const DOSSIER = {
  context: 'ship it or drop it',
  options: [
    { id: 'A', title: 'ship', summary: 'ship the thing' },
    { id: 'B', title: 'drop', summary: 'drop the thing' },
  ],
  qa: [],
  recommendation: { optionId: 'B', rationale: 'it is not wanted' },
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'track-reopen-'))
  eventsPath = join(dir, '.track', 'events.jsonl')
  store = new EventStore(eventsPath)
  t = new Track(store, { by: 'human:owner', now, newId: counter(), prov: PROV })
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const integral = (): boolean => validate(store.readAll(), readHead(eventsPath)).ok
const item = (title = 'a capability', over: Record<string, unknown> = {}): Ulid =>
  t.createItem({ kind: 'feature', title, workspace: 'ws', ...over })
const closeDone = (id: Ulid): void => {
  t.setRealization(id, 'in-progress')
  t.setRealization(id, 'done')
}
const realizationOf = (id: Ulid): string | undefined => t.state().items.get(id)?.realization

// ---- 1. contract pins --------------------------------------------------------------------------

describe('reopen — contract pins', () => {
  it('pins the new event type, the work-event kind, and the INGEST minor bump', () => {
    expect(EVENT_TYPES).toContain('realization.reopened')
    expect([...WORK_EVENT_KINDS]).toContain('item.reopen')
    expect(INGEST_CONTRACT_VERSION).toBe('2.1.0')
  })

  it('declares the two owner-ratified motives and nothing else', () => {
    expect([...REOPEN_MOTIVES]).toEqual(['closed-without-owner-uat', 'regression-observed'])
  })

  it('classes item.reopen as a BINDING write (it moves a workpackage percentage)', () => {
    expect(WORK_EVENT_SCHEMA['item.reopen'].settles).toBe('always')
    expect(WORK_EVENT_SCHEMA['item.reopen'].method).toBe('reopenItem')
  })
})

// ---- 2. the ordinary realize verb stays terminal ------------------------------------------------

describe('reopen — the ordinary realize verb is still terminal', () => {
  it('refuses done -> in-progress through item.realize (a reopening is never accidental)', () => {
    const id = item()
    closeDone(id)
    expect(() => t.setRealization(id, 'in-progress')).toThrow(/illegal realization transition done -> in-progress/)
    expect(realizationOf(id)).toBe('done')
  })

  it('refuses cancelled -> in-progress through item.realize', () => {
    const id = item()
    t.setRealization(id, 'cancelled')
    expect(() => t.setRealization(id, 'in-progress')).toThrow(
      /illegal realization transition cancelled -> in-progress/,
    )
    expect(realizationOf(id)).toBe('cancelled')
  })
})

// ---- 3. the reopenItem facade ------------------------------------------------------------------

describe('reopen — reopenItem facade', () => {
  it('reopens a done item to in-progress and keeps the log integral', () => {
    const id = item()
    closeDone(id)
    t.reopenItem(id, { motive: 'regression-observed', reason: 'the owner observes the loop does not relaunch' })
    expect(realizationOf(id)).toBe('in-progress')
    expect(integral()).toBe(true)
  })

  it('reopens a cancelled item to in-progress', () => {
    const id = item()
    t.setRealization(id, 'cancelled')
    t.reopenItem(id, { motive: 'closed-without-owner-uat', reason: 'the cancelled item describes an active demand' })
    expect(realizationOf(id)).toBe('in-progress')
  })

  it('appends ONE realization.reopened event carrying itemId + motive + reason', () => {
    const id = item()
    closeDone(id)
    t.reopenItem(id, { motive: 'regression-observed', reason: 'measured broken on 2026-07-29' })
    const appended = store.readAll().filter((e) => e.type === 'realization.reopened')
    expect(appended).toHaveLength(1)
    expect(appended[0]!.aggregate).toBe('item')
    expect(appended[0]!.aggregateId).toBe(id)
    expect(appended[0]!.payload).toEqual({
      itemId: id,
      motive: 'regression-observed',
      reason: 'measured broken on 2026-07-29',
    })
  })

  it('records the reopening trace on the item — the previous realization, the motive, the reason, who and when', () => {
    const id = item()
    closeDone(id)
    t.reopenItem(id, { motive: 'closed-without-owner-uat', reason: 'closed on a green suite, never seen by the owner' })
    expect(t.state().items.get(id)!.reopenings).toEqual([
      {
        from: 'done',
        motive: 'closed-without-owner-uat',
        reason: 'closed on a green suite, never seen by the owner',
        at: '2026-07-29T12:00:00.000Z',
        by: 'human:owner',
      },
    ])
  })

  it('keeps EVERY reopening — the closure it corrects is never erased', () => {
    const id = item()
    closeDone(id)
    t.reopenItem(id, { motive: 'closed-without-owner-uat', reason: 'first: no owner UAT' })
    t.setRealization(id, 'done')
    t.reopenItem(id, { motive: 'regression-observed', reason: 'second: it broke again' })
    const trace = t.state().items.get(id)!.reopenings!
    expect(trace.map((r) => [r.from, r.motive])).toEqual([
      ['done', 'closed-without-owner-uat'],
      ['done', 'regression-observed'],
    ])
    // the whole history is still in the log: two closures, two reopenings
    const types = store.readAll().filter((e) => e.aggregateId === id).map((e) => e.type)
    expect(types.filter((x) => x === 'realization.transition')).toHaveLength(3) // in-progress, done, done
    expect(types.filter((x) => x === 'realization.reopened')).toHaveLength(2)
  })

  it('refuses an item that is not closed', () => {
    const id = item()
    expect(() => t.reopenItem(id, { motive: 'regression-observed', reason: 'r' })).toThrow(/not closed/)
    t.setRealization(id, 'in-progress')
    expect(() => t.reopenItem(id, { motive: 'regression-observed', reason: 'r' })).toThrow(/not closed/)
    expect(store.readAll().some((e) => e.type === 'realization.reopened')).toBe(false)
  })

  it('refuses a rejected item — a no-go decision owns that state', () => {
    const target = item()
    const decisionId = t.createDecision({
      decisionKind: 'orientation',
      title: 'ship it?',
      workspace: 'ws',
      targets: [target],
      dossier: DOSSIER,
    })
    t.selectDecisionOption(decisionId, 'B', 'no-go')
    expect(realizationOf(target)).toBe('rejected')
    expect(() => t.reopenItem(target, { motive: 'regression-observed', reason: 'r' })).toThrow(/decision/)
  })

  it('refuses an unknown item', () => {
    expect(() => t.reopenItem('nope', { motive: 'regression-observed', reason: 'r' })).toThrow(/unknown item nope/)
  })

  it('refuses a decision aggregate (a decision has no delivered capability to regress)', () => {
    const target = item()
    const decisionId = t.createDecision({
      decisionKind: 'orientation',
      title: 'a decision',
      workspace: 'ws',
      targets: [target],
      dossier: DOSSIER,
    })
    expect(() => t.reopenItem(decisionId, { motive: 'regression-observed', reason: 'r' })).toThrow(DomainError)
  })

  it('refuses an unknown motive and an empty reason (fail-closed payload)', () => {
    const id = item()
    closeDone(id)
    expect(() =>
      t.reopenItem(id, { motive: 'because-i-said-so' as never, reason: 'r' }),
    ).toThrow(/motive/)
    expect(() => t.reopenItem(id, { motive: 'regression-observed', reason: '  ' })).toThrow(/reason/)
    expect(realizationOf(id)).toBe('done')
  })
})

// ---- 4. the load-bearing consequence: the percentage recedes ------------------------------------

describe('reopen — a workpackage percentage can recede to the truth', () => {
  it('moves the item out of DONE and back into TO-DO', () => {
    const id = item()
    closeDone(id)
    expect(bucketOf(t.state(), t.state().items.get(id)!, cfg)).toBe('DONE')
    t.reopenItem(id, { motive: 'regression-observed', reason: 'the delivered capability is broken' })
    expect(bucketOf(t.state(), t.state().items.get(id)!, cfg)).toBe('TO-DO')
  })

  it('recedes the WP rollup: 2/2 done becomes 1/2', () => {
    const wp = t.createItem({ kind: 'chore', title: 'WP', workspace: 'ws', role: 'workpackage' })
    const a = item('leaf a', { parentId: wp })
    const b = item('leaf b', { parentId: wp })
    closeDone(a)
    closeDone(b)
    const of = (): { done: number; active: number } => {
      const node = computeWpTree(t.state(), cfg).find((n) => n.id === wp)!
      return { done: node.done, active: node.active }
    }
    expect(of()).toEqual({ done: 2, active: 2 })
    t.reopenItem(b, { motive: 'regression-observed', reason: 'b regressed' })
    expect(of()).toEqual({ done: 1, active: 2 })
  })
})

// ---- 4b. the regression propagates to what depended on the reopened capability -----------------

describe('reopen — a linked-done dependency re-blocks what depended on the reopened item', () => {
  it('sends the dependent item back to AWAITED', () => {
    const dep = item('the capability others depend on')
    const dependent = item('work that needs it')
    t.openBlocker({
      targetId: dependent,
      kind: 'dependency',
      ref: dep,
      reason: 'needs the capability',
      resolutionRule: 'linked-done',
    })
    closeDone(dep)
    // the dependency is delivered ⇒ the derived blocker clears, the dependent is no longer AWAITED
    expect(bucketOf(t.state(), t.state().items.get(dependent)!, cfg)).toBe('TO-DO')
    t.reopenItem(dep, { motive: 'regression-observed', reason: 'the capability regressed' })
    // the regression propagates: the derived openness is revocable, so the dependent is AWAITED again
    expect(bucketOf(t.state(), t.state().items.get(dependent)!, cfg)).toBe('AWAITED')
  })
})

// ---- 5. integrity: a hand-written reopening must carry a legal motive ---------------------------

describe('reopen — validate rejects a motive-less reopening from a foreign writer', () => {
  const chain = (cores: EventCore[]): TrackEvent[] => {
    let prevHash: Sha256 | null = null
    const seqByAgg = new Map<string, number>()
    return cores.map((core) => {
      const seq = (seqByAgg.get(core.aggregateId) ?? 0) + 1
      seqByAgg.set(core.aggregateId, seq)
      const contentHash = contentHashOf(core)
      const ev: TrackEvent = { ...core, seq, prevHash, contentHash }
      prevHash = contentHash
      return ev
    })
  }
  const reopened = (payload: Record<string, unknown>): EventCore => ({
    id: 'evt-0001',
    type: 'realization.reopened',
    aggregate: 'item',
    aggregateId: 'item-A',
    at: '2026-07-29T12:00:00.000Z',
    by: 'foreign-writer',
    payload,
  })

  it('accepts every declared motive', () => {
    for (const motive of REOPEN_MOTIVES) {
      const res = validate(chain([reopened({ itemId: 'item-A', motive, reason: 'r' })]))
      expect(res.findings.filter((f) => f.kind === 'reopen-motive')).toEqual([])
    }
  })

  it('flags an undeclared motive, a missing motive, and an empty reason', () => {
    for (const payload of [
      { itemId: 'item-A', motive: 'invented', reason: 'r' },
      { itemId: 'item-A', reason: 'r' },
      { itemId: 'item-A', motive: 'regression-observed', reason: '' },
    ]) {
      const res = validate(chain([reopened(payload)]))
      expect(res.ok).toBe(false)
      expect(res.findings.some((f) => f.kind === 'reopen-motive')).toBe(true)
    }
  })
})

// ---- 6. the ingest seam ------------------------------------------------------------------------

describe('reopen — ingest seam', () => {
  const ev = (payload: Record<string, unknown>): WorkEvent => ({ v: 1, kind: 'item.reopen', payload })
  const ctx = (over: Partial<IngestContext> = {}): IngestContext => ({
    by: 'human:owner',
    workspace: 'ws',
    prov: PROV,
    now,
    newId: counter(),
    ...over,
  })

  it('maps item.reopen to reopenItem(itemId, {motive, reason})', () => {
    const m = mapWorkEvent(ev({ itemId: 'i', motive: 'regression-observed', reason: 'r' }))
    expect(m.method).toBe('reopenItem')
    expect(m.settles).toBe('always')
    expect(m.args).toEqual(['i', { motive: 'regression-observed', reason: 'r' }])
  })

  it('applies through an authenticated channel', () => {
    const id = item()
    closeDone(id)
    ingest([ev({ itemId: id, motive: 'regression-observed', reason: 'r' })], ctx(), store)
    expect(realizationOf(id)).toBe('in-progress')
  })

  it('refuses an unauthenticated channel (a reopening settles state)', () => {
    const id = item()
    closeDone(id)
    expect(() =>
      ingest(
        [ev({ itemId: id, motive: 'regression-observed', reason: 'r' })],
        ctx({ prov: { transport: 'http', proposed: true, auth: 'unauthenticated' } }),
        store,
      ),
    ).toThrow(/binding write/)
    expect(realizationOf(id)).toBe('done')
  })

  it('refuses to reach an item in another workspace (containment)', () => {
    const id = item()
    closeDone(id)
    expect(() =>
      ingest([ev({ itemId: id, motive: 'regression-observed', reason: 'r' })], ctx({ workspace: 'other' }), store),
    ).toThrow(/workspace/)
    expect(realizationOf(id)).toBe('done')
  })

  it('rejects a payload without a reason at the envelope', () => {
    expect(() => mapWorkEvent(ev({ itemId: 'i', motive: 'regression-observed' }))).toThrow(/reason/)
  })
})

// ---- 7. the CLI verb ---------------------------------------------------------------------------

describe('reopen — CLI', () => {
  let out: string[]
  let io: CliIO
  let cliDir: string

  beforeEach(() => {
    cliDir = mkdtempSync(join(tmpdir(), 'track-reopen-cli-'))
    out = []
    io = { cwd: cliDir, out: (s) => out.push(s), err: (s) => out.push(s) }
    expect(runCli(['init'], io)).toBe(0)
  })
  afterEach(() => rmSync(cliDir, { recursive: true, force: true }))

  const lastId = (): string => out.join('').trim().split('\n').pop()!.trim()

  const createDoneItem = (): string => {
    out = []
    runCli(['item', 'new', '--kind', 'feature', '--title', 'a capability', '--workspace', 'ws'], io)
    const id = lastId()
    runCli(['item', 'realize', id, 'in-progress'], io)
    runCli(['item', 'realize', id, 'done'], io)
    return id
  }

  it('reopens with a motive and a reason, and item show reads the trace back', () => {
    const id = createDoneItem()
    out = []
    expect(
      runCli(['item', 'reopen', id, '--motive', 'regression-observed', '--reason', 'the owner sees it broken'], io),
    ).toBe(0)
    out = []
    expect(runCli(['item', 'show', id], io)).toBe(0)
    const shown = JSON.parse(out.join('')) as {
      realization: string
      reopenings: Array<{ from: string; motive: string; reason: string }>
    }
    expect(shown.realization).toBe('in-progress')
    expect(shown.reopenings).toHaveLength(1)
    expect(shown.reopenings[0]!.from).toBe('done')
    expect(shown.reopenings[0]!.motive).toBe('regression-observed')
    expect(shown.reopenings[0]!.reason).toBe('the owner sees it broken')
  })

  it('requires a motive and a reason', () => {
    const id = createDoneItem()
    expect(runCli(['item', 'reopen', id, '--reason', 'r'], io)).not.toBe(0)
    expect(runCli(['item', 'reopen', id, '--motive', 'regression-observed'], io)).not.toBe(0)
    expect(runCli(['item', 'reopen', id, '--motive', 'invented', '--reason', 'r'], io)).not.toBe(0)
  })

  it('is idempotent on a repeated --client-token', () => {
    const id = createDoneItem()
    expect(
      runCli(['item', 'reopen', id, '--motive', 'regression-observed', '--reason', 'r', '--client-token', 'tok-1'], io),
    ).toBe(0)
    // the item is now in-progress; a retry of the SAME token must be a no-op, not an illegal-transition error
    out = []
    expect(
      runCli(['item', 'reopen', id, '--motive', 'regression-observed', '--reason', 'r', '--client-token', 'tok-1'], io),
    ).toBe(0)
    expect(out.join('')).toContain('no-op')
  })

  it('lists the verb in the usage', () => {
    out = []
    runCli(['--help'], io)
    expect(out.join('')).toContain('item reopen <itemId>')
  })
})
