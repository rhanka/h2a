import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { runCli, type CliIO } from '../cli/index.js'
import { fold } from '../state/fold.js'
import { contentHashOf, stripFrame } from './frame.js'
import { headPath, readHead } from './head.js'
import { EventStore } from './store.js'
import type { CommandEvent, TrackEvent } from './types.js'
import { validate } from './validate.js'

// B0a — `.gitattributes merge=union` reconciles two branches that each appended DISJOINT events
// (different aggregates) to the single append-only `.track/events.jsonl`. The union driver keeps
// EVERY unique line from both parents, so the merged log is `P + A-suffix + B-suffix` (common
// prefix once, then both branches' new lines). These tests pin the DEFINED behaviour of that merged
// log: (1) every event survives — `readAll` enumerates all of them and `fold` fully recovers the
// state of all aggregates (the anti-loss property B0a buys); (2) `validate` is LOUD, not silently
// corrupt — the GLOBAL positional `prevHash` chain breaks at the A→B seam (exactly one `prev-hash`
// finding), because two independently-chained suffixes cannot both chain from the prefix tail once
// interleaved. The residual: the merged log is read/fold-recoverable but must be RE-SEALED (re-chained)
// before further `track` appends, since the store fail-closes on an invalid existing log.

let dir: string
let counter: number

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'track-union-'))
  counter = 0
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function evt(over: Partial<CommandEvent> = {}): CommandEvent {
  counter += 1
  return {
    id: `evt-${String(counter).padStart(4, '0')}`,
    type: 'item.created',
    aggregate: 'item',
    aggregateId: 'item-A',
    at: `2026-06-03T10:00:${String(counter).padStart(2, '0')}.000Z`,
    by: 'tester',
    payload: { k: counter },
    ...over,
  }
}

function nonEmptyLines(path: string): string[] {
  return readFileSync(path, 'utf8').split('\n').filter((l) => l.trim().length > 0)
}

/** Path under a throwaway tree whose parent `.track` dir is created up-front. */
function logPath(label: string): string {
  const p = join(dir, label, '.track', 'events.jsonl')
  mkdirSync(dirname(p), { recursive: true })
  return p
}

describe('B0a — union-merge of disjoint appends (common-prefix model)', () => {
  it('preserves every event and fully recovers state; validate is loud (one seam break)', () => {
    // Common prefix P (aggregate item-P, 2 events).
    const pPath = logPath('P')
    const pStore = new EventStore(pPath)
    pStore.appendCommand([evt({ aggregateId: 'item-P', payload: { kind: 'feature', title: 'P1', workspace: 'w' } })])
    pStore.appendCommand([evt({ aggregateId: 'item-P', type: 'realization.transition', payload: { to: 'in-progress' } })])
    const prefix = nonEmptyLines(pPath)
    expect(prefix.length).toBe(2)

    // Branch A continues from P (disjoint aggregate item-A).
    const aPath = logPath('A')
    copyFileSync(pPath, aPath)
    const aStore = new EventStore(aPath)
    aStore.appendCommand([evt({ aggregateId: 'item-A', payload: { kind: 'feature', title: 'A1', workspace: 'w' } })])
    aStore.appendCommand([evt({ aggregateId: 'item-A', type: 'realization.transition', payload: { to: 'done' } })])
    const aFull = nonEmptyLines(aPath) // P + A
    expect(aFull.length).toBe(4)

    // Branch B continues from P (disjoint aggregate item-B).
    const bPath = logPath('B')
    copyFileSync(pPath, bPath)
    const bStore = new EventStore(bPath)
    bStore.appendCommand([evt({ aggregateId: 'item-B', payload: { kind: 'feature', title: 'B1', workspace: 'w' } })])
    bStore.appendCommand([evt({ aggregateId: 'item-B', type: 'realization.transition', payload: { to: 'done' } })])
    const bFull = nonEmptyLines(bPath) // P + B
    expect(bFull.length).toBe(4)

    // The union-merge result = P + A-suffix + B-suffix (prefix kept once, both new tails appended).
    const aSuffix = aFull.slice(prefix.length)
    const bSuffix = bFull.slice(prefix.length)
    const merged = [...prefix, ...aSuffix, ...bSuffix]
    const mPath = logPath('M')
    writeFileSync(mPath, merged.join('\n') + '\n', 'utf8')

    // (1) Anti-loss: every event survives, and fold fully recovers all three aggregates.
    const all = new EventStore(mPath).readAll()
    expect(all.length).toBe(6)
    const state = fold(all)
    expect(state.items.has('item-P')).toBe(true)
    expect(state.items.has('item-A')).toBe(true)
    expect(state.items.has('item-B')).toBe(true)
    expect(state.items.get('item-A')!.realization).toBe('done')
    expect(state.items.get('item-B')!.realization).toBe('done')

    // (2) validate is LOUD: exactly one `prev-hash` finding at the A→B seam (index = |P|+|A| = 4).
    const result = validate(all)
    expect(result.ok).toBe(false)
    expect(result.findings).toHaveLength(1)
    expect(result.findings[0]!.kind).toBe('prev-hash')
    expect(result.findings[0]).toMatchObject({ kind: 'prev-hash', index: 4 })

    // Residual: the store fail-closes on the broken chain — further appends are refused until re-seal.
    expect(() =>
      new EventStore(mPath).appendCommand([evt({ aggregateId: 'item-C', payload: { kind: 'feature', title: 'C1', workspace: 'w' } })]),
    ).toThrow(/refusing to extend an invalid log/)
  })

  it('two no-common-ancestor logs concatenated: all present, one seam break', () => {
    // The simpler model the brief states verbatim: two independent disjoint logs, concatenated.
    const aPath = logPath('X')
    const aStore = new EventStore(aPath)
    aStore.appendCommand([evt({ aggregateId: 'item-X', payload: { kind: 'feature', title: 'X1', workspace: 'w' } })])
    aStore.appendCommand([evt({ aggregateId: 'item-X', type: 'realization.transition', payload: { to: 'done' } })])

    const bPath = logPath('Y')
    const bStore = new EventStore(bPath)
    bStore.appendCommand([evt({ aggregateId: 'item-Y', payload: { kind: 'feature', title: 'Y1', workspace: 'w' } })])
    bStore.appendCommand([evt({ aggregateId: 'item-Y', type: 'realization.transition', payload: { to: 'done' } })])

    const merged = [...nonEmptyLines(aPath), ...nonEmptyLines(bPath)]
    const mPath = logPath('Z')
    writeFileSync(mPath, merged.join('\n') + '\n', 'utf8')

    const all = new EventStore(mPath).readAll()
    expect(all.length).toBe(4)
    const result = validate(all)
    expect(result.ok).toBe(false)
    expect(result.findings).toHaveLength(1)
    expect(result.findings[0]!.kind).toBe('prev-hash')
    // The seam is B's first event (index 2): it carries prevHash=null but now follows A's last.
    expect(result.findings[0]).toMatchObject({ kind: 'prev-hash', index: 2, actual: null })
  })
})

// Lot L3 (spec-track-lifecycle §1.3 Part 3) — `.gitattributes merge=union` + `track reseal`. Union keeps
// EVERY line from both parents, so the merged log is `P + A-suffix + B-suffix` with a BROKEN positional
// chain (and, when both branches touch the same aggregate, duplicate `seq`, and a stale `head.json`).
// `reseal` repairs exactly that: it re-frames `seq`/`prevHash` in place while preserving every event
// `id`/`contentHash` (the hash domain is the frame-free `EventCore`), so `events-contains` containment
// survives a reseal. It fails closed — refusing to write — on a tampered core (`content-hash`), a
// duplicate id with divergent content (`duplicate-event-id`), or any `validate` finding the re-chaining
// cannot repair (e.g. an interleaved command batch, `batch-noncontiguous`).

/** Common prefix P (1 event on aggregate `item-P`), built through a real store so lines are framed. */
function buildPrefix(): { pPath: string; prefix: string[] } {
  const pPath = logPath('P')
  new EventStore(pPath).appendCommand([
    evt({ aggregateId: 'item-P', payload: { kind: 'feature', title: 'P1', workspace: 'w' } }),
  ])
  return { pPath, prefix: nonEmptyLines(pPath) }
}

/**
 * Lot L3 scenario: common prefix P, branch A appends 2 events on `item-A`, branch B appends 2 MORE
 * events on the SAME aggregate (the same-item case that yields `aggregate-seq` findings), union-merged
 * as P + A-suffix + B-suffix with branch B's `head.json` surviving the merge (the `head-mismatch`
 * case). No head is authoritative until reseal rewrites it.
 */
function unionSameAggregate(): { aPath: string; bPath: string; mPath: string } {
  const { pPath, prefix } = buildPrefix()

  const aPath = logPath('A')
  copyFileSync(pPath, aPath)
  const aStore = new EventStore(aPath)
  aStore.appendCommand([evt({ aggregateId: 'item-A', payload: { kind: 'feature', title: 'A1', workspace: 'w' } })])
  aStore.appendCommand([evt({ aggregateId: 'item-A', type: 'realization.transition', payload: { to: 'done' } })])
  const aFull = nonEmptyLines(aPath) // P + A

  const bPath = logPath('B')
  copyFileSync(pPath, bPath)
  const bStore = new EventStore(bPath)
  bStore.appendCommand([evt({ aggregateId: 'item-A', type: 'realization.transition', payload: { to: 'in-progress' } })])
  bStore.appendCommand([
    evt({
      aggregateId: 'item-A',
      type: 'item.report-updated',
      payload: { stage: { value: 'dev', evidence: 'e' }, status: 'progressing', facts: 'f' },
    }),
  ])
  const bFull = nonEmptyLines(bPath) // P + B

  const mPath = logPath('M')
  writeFileSync(mPath, [...aFull, ...bFull.slice(prefix.length)].join('\n') + '\n', 'utf8')
  // One side's head survives a union merge verbatim — here B's, anchoring inside A's suffix.
  copyFileSync(headPath(bPath), headPath(mPath))
  return { aPath, bPath, mPath }
}

function cliIO(cwd: string): { io: CliIO; out: string[]; err: string[] } {
  const out: string[] = []
  const err: string[] = []
  return { out, err, io: { cwd, out: (s: string) => out.push(s), err: (s: string) => err.push(s) } }
}

describe('Lot L3 — union + reseal (merge=union + track reseal)', () => {
  it('reseal re-chains the union-merged log (prev-hash + aggregate-seq + head-mismatch) into a validate-clean store', () => {
    const { aPath, bPath, mPath } = unionSameAggregate()
    const store = new EventStore(mPath)
    const before = store.readAll()
    expect(before).toHaveLength(5)

    // Pre-reseal, validate is LOUD with exactly the three union-merge finding kinds (both branches
    // touched item-A, and B's head anchors inside A's suffix).
    const loud = validate(before, readHead(mPath))
    expect(loud.ok).toBe(false)
    expect(new Set(loud.findings.map((f) => f.kind))).toEqual(
      new Set(['prev-hash', 'aggregate-seq', 'head-mismatch']),
    )

    // The union folded state, captured BEFORE the reseal (frames are fold-invisible).
    const unionState = fold(before)

    // Reseal re-chains in place: only B's 2 frames change (seq 1,2 -> 3,4 and B1's prevHash).
    expect(store.reseal()).toEqual({ events: 5, resealed: 2, deduplicated: 0 })

    const after = new EventStore(mPath).readAll()
    const integrity = validate(after, readHead(mPath))
    expect(integrity.ok).toBe(true)
    expect(integrity.findings).toEqual([])

    // Every event id + contentHash is preserved 1-for-1 across the reseal.
    expect(after.map((e) => `${e.id}:${e.contentHash}`).sort()).toEqual(
      before.map((e) => `${e.id}:${e.contentHash}`).sort(),
    )

    // fold(resealed) equals the union folded state.
    expect(fold(after)).toEqual(unionState)

    // events-contains passes for BOTH branches against the resealed log (ids survive a reseal).
    const contains = cliIO(dir)
    expect(runCli(['events-contains', '--base', aPath, '--candidate', mPath], contains.io)).toBe(0)
    expect(runCli(['events-contains', '--base', bPath, '--candidate', mPath], contains.io)).toBe(0)
  })

  it('track reseal (CLI) re-chains the union-merged log and prints frames/duplicates', () => {
    const { mPath } = unionSameAggregate()
    const { io, out } = cliIO(dirname(dirname(mPath)))
    expect(runCli(['reseal'], io)).toBe(0)
    expect(out.join('')).toBe('resealed 5 events (2 frames updated, 0 duplicates collapsed)\n')
    const after = new EventStore(mPath).readAll()
    expect(validate(after, readHead(mPath)).ok).toBe(true)
  })

  it('reseal fails closed on a tampered event core (content-hash) and leaves the file untouched', () => {
    const { mPath } = unionSameAggregate()
    // Tamper one payload field WITHOUT re-hashing the core (a hand-edit, not a merge artifact).
    const lines = nonEmptyLines(mPath)
    const tampered = lines.map((line, i) =>
      i === 3 ? JSON.stringify({ ...JSON.parse(line), by: 'attacker' }) : line,
    )
    writeFileSync(mPath, tampered.join('\n') + '\n', 'utf8')
    const bytesBefore = readFileSync(mPath, 'utf8')
    expect(() => new EventStore(mPath).reseal()).toThrow(/content-hash/)
    expect(readFileSync(mPath, 'utf8')).toBe(bytesBefore)
  })

  it('reseal collapses an exact duplicate line (cherry-picked union replay), keeping the first', () => {
    const dPath = logPath('D')
    const dStore = new EventStore(dPath)
    dStore.appendCommand([evt({ aggregateId: 'item-D', payload: { kind: 'feature', title: 'D1', workspace: 'w' } })])
    dStore.appendCommand([evt({ aggregateId: 'item-D', type: 'realization.transition', payload: { to: 'done' } })])
    const lines = nonEmptyLines(dPath) // 2 framed events
    // A cherry-picked commit union-merged: the first line appears twice at the tail.
    const dupPath = logPath('D2')
    writeFileSync(dupPath, [...lines, lines[0]!].join('\n') + '\n', 'utf8')

    const { io, out } = cliIO(dirname(dupPath))
    expect(runCli(['reseal'], io)).toBe(0)
    expect(out.join('')).toBe('resealed 2 events (0 frames updated, 1 duplicates collapsed)\n')
    const after = new EventStore(dupPath).readAll()
    expect(after).toHaveLength(2)
    expect(after.map((e) => e.id)).toEqual(lines.map((l) => (JSON.parse(l) as TrackEvent).id))
    expect(validate(after, readHead(dupPath)).ok).toBe(true)
  })

  it('reseal fails closed on a duplicate id with divergent content (duplicate-event-id)', () => {
    const ePath = logPath('E')
    new EventStore(ePath).appendCommand([
      evt({ aggregateId: 'item-E', payload: { kind: 'feature', title: 'E1', workspace: 'w' } }),
    ])
    const [line1] = nonEmptyLines(ePath)
    // A self-consistent forgery of the SAME id: different core, honestly re-hashed — each line
    // individually passes the content-hash guard; only the pair diverges.
    const original = JSON.parse(line1!) as TrackEvent
    const forged = { ...original, payload: { kind: 'bug', title: 'E1-forged', workspace: 'w' } }
    const forgedLine = JSON.stringify({ ...forged, contentHash: contentHashOf(stripFrame(forged)) })
    const xPath = logPath('E2')
    writeFileSync(xPath, [line1, forgedLine].join('\n') + '\n', 'utf8')
    const bytesBefore = readFileSync(xPath, 'utf8')
    expect(() => new EventStore(xPath).reseal()).toThrow(/duplicate-event-id/)
    expect(readFileSync(xPath, 'utf8')).toBe(bytesBefore)
  })

  it('reseal refuses a multi-event command batch interleaved across the merge seam (batch-noncontiguous)', () => {
    const { pPath, prefix } = buildPrefix()

    // Branch A appends a 3-event atomic command batch (cmdId + cmd:{i,n}).
    const aPath = logPath('A')
    copyFileSync(pPath, aPath)
    new EventStore(aPath).appendCommand(
      [
        evt({ aggregateId: 'item-A', payload: { kind: 'feature', title: 'A1', workspace: 'w' } }),
        evt({ aggregateId: 'item-A', type: 'realization.transition', payload: { to: 'in-progress' } }),
        evt({
          aggregateId: 'item-A',
          type: 'item.report-updated',
          payload: { stage: { value: 'dev', evidence: 'e' }, status: 'progressing', facts: 'f' },
        }),
      ],
      { cmdId: 'cmd-seam-01' },
    )
    const aFull = nonEmptyLines(aPath) // P + batch(3)

    const bPath = logPath('B')
    copyFileSync(pPath, bPath)
    const bStore = new EventStore(bPath)
    bStore.appendCommand([evt({ aggregateId: 'item-B', payload: { kind: 'feature', title: 'B1', workspace: 'w' } })])
    bStore.appendCommand([evt({ aggregateId: 'item-B', type: 'realization.transition', payload: { to: 'done' } })])
    const bSuffix = nonEmptyLines(bPath).slice(prefix.length)

    // Union-merge WITH an interleave: B's suffix lands INSIDE A's batch (members at 1, 2, 5).
    const sPath = logPath('S')
    writeFileSync(sPath, [...prefix, aFull[1]!, aFull[2]!, ...bSuffix, aFull[3]!].join('\n') + '\n', 'utf8')

    // Pre-reseal, validate already flags the interleaved batch; the re-chain cannot repair it.
    const loud = validate(new EventStore(sPath).readAll())
    expect(loud.findings.map((f) => f.kind)).toContain('batch-noncontiguous')
    const bytesBefore = readFileSync(sPath, 'utf8')
    expect(() => new EventStore(sPath).reseal()).toThrow(/batch-noncontiguous/)
    expect(readFileSync(sPath, 'utf8')).toBe(bytesBefore)
  })

  it('resealEvents (pure, re-exported from the events barrel) re-frames without touching id/contentHash', async () => {
    const { resealEvents } = await import('./reseal.js')
    const { mPath } = unionSameAggregate()
    const before = new EventStore(mPath).readAll()

    const { events, result } = resealEvents(before)
    expect(result).toEqual({ events: 5, resealed: 2, deduplicated: 0 })
    expect(events.map((e) => `${e.id}:${e.contentHash}`).sort()).toEqual(
      before.map((e) => `${e.id}:${e.contentHash}`).sort(),
    )

    // The resealed stream is positionally chained + per-aggregate contiguous by construction.
    let prevHash: string | null = null
    const lastSeq = new Map<string, number>()
    for (const e of events) {
      expect(e.prevHash).toBe(prevHash)
      expect(e.seq).toBe((lastSeq.get(e.aggregateId) ?? 0) + 1)
      lastSeq.set(e.aggregateId, e.seq)
      prevHash = e.contentHash
    }
    const head = { streamLength: events.length, lastContentHash: events[events.length - 1]!.contentHash }
    expect(validate(events, head).ok).toBe(true)

    // Public surface: the events barrel re-exports resealEvents.
    const barrel = await import('./index.js')
    expect(typeof barrel.resealEvents).toBe('function')
  })

  it('reseal is a byte-identical no-op on an already-valid log', () => {
    const aPath = logPath('A')
    const aStore = new EventStore(aPath)
    aStore.appendCommand([evt({ aggregateId: 'item-A', payload: { kind: 'feature', title: 'A1', workspace: 'w' } })])
    aStore.appendCommand([evt({ aggregateId: 'item-A', type: 'realization.transition', payload: { to: 'done' } })])
    const bytesBefore = readFileSync(aPath, 'utf8')
    expect(aStore.reseal()).toEqual({ events: 2, resealed: 0, deduplicated: 0 })
    expect(readFileSync(aPath, 'utf8')).toBe(bytesBefore)
  })

  it('the repo pins merge=union on the journal and the branch-lifecycle skill runs reseal at merge time', () => {
    const root = join(__dirname, '..', '..', '..', '..')
    const gitattributes = readFileSync(join(root, '.gitattributes'), 'utf8')
    expect(gitattributes).toContain('.track/events.jsonl merge=union')
    const skill = readFileSync(join(__dirname, '..', '..', '..', 'skills', 'branch-lifecycle', 'SKILL.md'), 'utf8')
    expect(skill).toContain('git merge origin/main && npx track reseal && npx track validate')
  })
})
