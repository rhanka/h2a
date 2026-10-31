// Request-lifecycle Part 1 (spec §1.1 / Lot L2) — the ADDITIVE item link/pin event. One link (a spec
// pin, a REASONED spec-exempt, delivery evidence, a cross-repo item, …) attaches to an EXISTING item
// via an append-only `item.link-added` on the item's own aggregate (next seq, zero mutation of prior
// events), reachable three ways: the Track facade (`addItemLink`), the CLI (`track item link` +
// repeatable `--link <kind=locator>` on `track item new`), and the ingest seam (`item.add-link`,
// settles:'evidence', workspace-contained, clientToken-idempotent). Covers the contract pins, the
// fail-closed link shape (assertItemLink — kind:'spec-exempt' REQUIRES its reason), the fold (dedup by
// exact (kind, locator, reason); creation-time links fold unchanged), pr-open stage derivation, and
// back-compat (validate().ok stays true; a reason-less link serializes reason-free).

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { runCli, type CliIO } from './cli/index.js'
import { readHead } from './events/head.js'
import { EventStore } from './events/store.js'
import { EVENT_TYPES } from './events/types.js'
import type { Provenance, TrackEvent, Ulid } from './events/types.js'
import { validate } from './events/validate.js'
import { INGEST_CONTRACT_VERSION, WORK_EVENT_KINDS, WORK_EVENT_SCHEMA } from './ingest/contract.js'
import type { WorkEvent } from './ingest/contract.js'
import { ingest, type IngestContext } from './ingest/ingest.js'
import { IngestError, mapWorkEvent } from './ingest/map.js'
import { DomainError } from './model/item.js'
import { deriveItemStageStatus } from './report/stage-status.js'
import { Track } from './track.js'

let dir: string
let eventsPath: string
let store: EventStore
let t: Track

const now = (): string => '2026-10-30T00:00:00.000Z'
const counter = (): (() => Ulid) => {
  let i = 0
  return () => `id-${String(++i).padStart(4, '0')}`
}
const PROV: Provenance = { transport: 'import', proposed: false, auth: 'local-user' }

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'track-item-link-'))
  eventsPath = join(dir, '.track', 'events.jsonl')
  store = new EventStore(eventsPath)
  t = new Track(store, { by: 'human:x', now, newId: counter() })
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const integral = (): boolean => validate(store.readAll(), readHead(eventsPath)).ok
const newItem = (title = 'L2 item'): Ulid => t.createItem({ kind: 'feature', title, workspace: 'ws' })
const eventsOf = (id: string): TrackEvent[] => store.readAll().filter((e) => e.aggregateId === id)

// ---- 1. contract pins -------------------------------------------------------------------------

describe('item.link-added / item.add-link — contract pins', () => {
  it('pins the persisted event type + the WorkEvent kind + the INGEST minor bump', () => {
    expect(EVENT_TYPES).toContain('item.link-added')
    expect([...WORK_EVENT_KINDS]).toContain('item.add-link')
    expect(INGEST_CONTRACT_VERSION).toBe('2.3.0')
  })

  it('pins method + settles + required fields for item.add-link', () => {
    const s = WORK_EVENT_SCHEMA['item.add-link']
    expect(s.method).toBe('addItemLink')
    expect(s.settles).toBe('evidence')
    expect(Object.entries(s.fields).filter(([, f]) => f.required).map(([n]) => n).sort()).toEqual([
      'itemId',
      'kind',
      'locator',
    ])
  })
})

// ---- 2. addItemLink facade ----------------------------------------------------------------------

describe('addItemLink facade', () => {
  it('appends item.link-added with seq 2 on the EXISTING aggregate, preserving event 1 and integrity', () => {
    const id = newItem()
    const hashBefore = eventsOf(id)[0]!.contentHash
    t.addItemLink(id, { kind: 'spec', locator: 'engram:spec/ONT.md#sha256:abc' })
    expect(eventsOf(id).map((e) => [e.type, e.seq])).toEqual([
      ['item.created', 1],
      ['item.link-added', 2],
    ])
    expect(eventsOf(id)[0]!.contentHash).toBe(hashBefore)
    expect(integral()).toBe(true)
  })

  it('folds the link into item.links; a reason-less link carries NO reason key (hash-minimal)', () => {
    const id = newItem()
    t.addItemLink(id, { kind: 'spec', locator: 'engram:spec/ONT.md#sha256:abc' })
    const links = t.state().items.get(id)!.links!
    expect(links).toEqual([{ kind: 'spec', locator: 'engram:spec/ONT.md#sha256:abc' }])
    expect('reason' in links[0]!).toBe(false)
    const ev = eventsOf(id).find((e) => e.type === 'item.link-added')!
    expect(JSON.stringify(ev.payload)).toBe('{"link":{"kind":"spec","locator":"engram:spec/ONT.md#sha256:abc"}}')
  })

  it('a pr-open link immediately derives stage pr with its locator as evidence', () => {
    const id = newItem()
    t.addItemLink(id, { kind: 'pr-open', locator: 'rhanka/h2a#42' })
    const state = t.state()
    const item = state.items.get(id)!
    const ss = deriveItemStageStatus(state, store.readAll(), item, 'c0')
    expect(ss.stage).toBe('pr')
    expect(ss.stageEvidence).toBe('rhanka/h2a#42')
  })

  it('folds an identical link only once (dedup by exact (kind, locator, reason))', () => {
    const id = newItem()
    t.addItemLink(id, { kind: 'pr-open', locator: 'rhanka/h2a#42' })
    t.addItemLink(id, { kind: 'pr-open', locator: 'rhanka/h2a#42' })
    expect(t.state().items.get(id)!.links).toHaveLength(1)
    t.addItemLink(id, { kind: 'spec-exempt', locator: 'none', reason: 'mechanical refactor' })
    t.addItemLink(id, { kind: 'spec-exempt', locator: 'none', reason: 'other motive' })
    expect(t.state().items.get(id)!.links).toHaveLength(3)
    expect(integral()).toBe(true)
  })

  it('back-compat: creation-time links fold unchanged; addItemLink appends AFTER them', () => {
    const id = t.createItem({
      kind: 'feature',
      title: 'linked',
      workspace: 'ws',
      links: [{ kind: 'related-item', locator: 'engram:01X' }],
    })
    t.addItemLink(id, { kind: 'spec', locator: 'engram:spec/ONT.md#sha256:abc' })
    expect(t.state().items.get(id)!.links).toEqual([
      { kind: 'related-item', locator: 'engram:01X' },
      { kind: 'spec', locator: 'engram:spec/ONT.md#sha256:abc' },
    ])
  })

  it('rejects an unknown item before any append', () => {
    expect(() => t.addItemLink('nope', { kind: 'spec', locator: 'x' })).toThrow(DomainError)
    expect(store.readAll()).toHaveLength(0)
  })

  it("rejects kind:'spec-exempt' without a reason BEFORE any append; with a reason it folds it", () => {
    const id = newItem()
    expect(() => t.addItemLink(id, { kind: 'spec-exempt', locator: 'none' })).toThrow(DomainError)
    expect(eventsOf(id)).toHaveLength(1) // item.created only — nothing appended
    t.addItemLink(id, { kind: 'spec-exempt', locator: 'none', reason: 'mechanical refactor' })
    expect(t.state().items.get(id)!.links).toEqual([
      { kind: 'spec-exempt', locator: 'none', reason: 'mechanical refactor' },
    ])
  })

  it('rejects blank kind/locator and a blank reason fail-closed', () => {
    const id = newItem()
    expect(() => t.addItemLink(id, { kind: '  ', locator: 'x' })).toThrow(DomainError)
    expect(() => t.addItemLink(id, { kind: 'spec', locator: '' })).toThrow(DomainError)
    expect(() => t.addItemLink(id, { kind: 'pr-open', locator: '#1', reason: '  ' })).toThrow(DomainError)
    expect(eventsOf(id)).toHaveLength(1)
  })

  it('trims kind/locator/reason and stamps a clientToken when supplied', () => {
    const id = newItem()
    t.addItemLink(id, { kind: ' spec ', locator: ' e:x ', reason: ' why ' }, 'tok-1')
    expect(t.state().items.get(id)!.links).toEqual([{ kind: 'spec', locator: 'e:x', reason: 'why' }])
    const ev = eventsOf(id).find((e) => e.type === 'item.link-added')!
    expect(ev.clientToken).toBe('tok-1')
  })
})

// ---- 3. CLI ----------------------------------------------------------------------------------------

describe('CLI — track item link + item new --link', () => {
  let out: string[]
  let errs: string[]
  let io: CliIO

  beforeEach(() => {
    out = []
    errs = []
    io = { cwd: dir, out: (s) => out.push(s), err: (s) => errs.push(s) }
  })

  const cliStore = (): EventStore => new EventStore(join(dir, '.track', 'events.jsonl'))
  const newViaCli = (): string => {
    expect(runCli(['init'], io)).toBe(0)
    out = []
    expect(runCli(['item', 'new', '--kind', 'feature', '--title', 'CLI item', '--workspace', 'ws'], io)).toBe(0)
    const id = out.join('').trim()
    out = []
    return id
  }

  it('track item link attaches a link to an existing item (rc 0, folds, integrity intact)', () => {
    const id = newViaCli()
    expect(runCli(['item', 'link', id, '--kind', 'pr-open', '--locator', 'rhanka/h2a#42'], io)).toBe(0)
    expect(out.join('')).toBe('ok\n')
    const s = cliStore()
    expect(new Track(s).state().items.get(id)!.links).toEqual([{ kind: 'pr-open', locator: 'rhanka/h2a#42' }])
    expect(validate(s.readAll(), readHead(join(dir, '.track', 'events.jsonl'))).ok).toBe(true)
  })

  it('spec-exempt without --reason exits non-zero BEFORE any append; with --reason it folds the reason', () => {
    const id = newViaCli()
    const s = cliStore()
    const before = s.readAll().length
    expect(runCli(['item', 'link', id, '--kind', 'spec-exempt', '--locator', 'none'], io)).toBe(1)
    expect(errs.join('')).toMatch(/spec-exempt/)
    expect(s.readAll().length).toBe(before)
    expect(runCli(['item', 'link', id, '--kind', 'spec-exempt', '--locator', 'none', '--reason', 'mechanical refactor'], io)).toBe(0)
    expect(new Track(s).state().items.get(id)!.links).toEqual([
      { kind: 'spec-exempt', locator: 'none', reason: 'mechanical refactor' },
    ])
  })

  it('--client-token makes a retry an explicit no-op', () => {
    const id = newViaCli()
    const argv = ['item', 'link', id, '--kind', 'spec', '--locator', 'e:s#sha256:ab', '--client-token', 'tok-cli']
    expect(runCli(argv, io)).toBe(0)
    out = []
    expect(runCli(argv, io)).toBe(0)
    expect(out.join('')).toBe('no-op: client-token already applied\n')
  })

  it('item new accepts REPEATABLE --link <kind=locator> (folded as creation links)', () => {
    expect(runCli(['init'], io)).toBe(0)
    out = []
    expect(
      runCli(
        [
          'item', 'new', '--kind', 'feature', '--title', 'L', '--workspace', 'ws',
          '--link', 'spec=e:s#sha256:ab',
          '--link', 'related-item=engram:01M57NGBMBM58YEFSS6MS5Y54Y',
        ],
        io,
      ),
    ).toBe(0)
    const id = out.join('').trim()
    expect(new Track(cliStore()).state().items.get(id)!.links).toEqual([
      { kind: 'spec', locator: 'e:s#sha256:ab' },
      { kind: 'related-item', locator: 'engram:01M57NGBMBM58YEFSS6MS5Y54Y' },
    ])
  })

  it('item new rejects a malformed --link (no "=") fail-closed, appending nothing', () => {
    expect(runCli(['init'], io)).toBe(0)
    expect(runCli(['item', 'new', '--kind', 'feature', '--title', 'L', '--workspace', 'ws', '--link', 'nope'], io)).toBe(1)
    expect(errs.join('')).toMatch(/--link/)
    expect(new Track(cliStore()).state().items.size).toBe(0)
  })
})

// ---- 4. ingest seam --------------------------------------------------------------------------------

describe('item.add-link — ingest seam', () => {
  const ev = (
    kind: 'item.create' | 'item.add-link',
    payload: Record<string, unknown>,
    clientToken?: string,
  ): WorkEvent => (clientToken !== undefined ? { v: 1, kind, payload, clientToken } : { v: 1, kind, payload })
  let n = 0
  const freshStore = (): { s: EventStore; path: string } => {
    const path = join(dir, `s${++n}`, '.track', 'events.jsonl')
    return { s: new EventStore(path), path }
  }
  const ctx = (over: Partial<IngestContext> = {}): IngestContext => ({
    by: 'human:t',
    workspace: 'ws',
    prov: PROV,
    now,
    newId: counter(),
    ...over,
  })

  it('mapWorkEvent maps item.add-link → addItemLink (settles:evidence, args [itemId, link])', () => {
    const cmd = mapWorkEvent(ev('item.add-link', { itemId: 'i', kind: 'pr-open', locator: 'rhanka/h2a#42' }))
    expect(cmd.method).toBe('addItemLink')
    expect(cmd.settles).toBe('evidence')
    expect(cmd.args).toEqual(['i', { kind: 'pr-open', locator: 'rhanka/h2a#42' }])
  })

  it('mapWorkEvent validates the link at the MAP boundary (DomainError ⇒ IngestError)', () => {
    expect(() => mapWorkEvent(ev('item.add-link', { itemId: 'i', kind: 'spec-exempt', locator: 'none' }))).toThrow(
      IngestError,
    )
    expect(() => mapWorkEvent(ev('item.add-link', { itemId: 'i', kind: 'spec', locator: 'e:s#sha256:ab' }))).not.toThrow()
  })

  it('rejects a missing required field fail-closed (the mapper)', () => {
    expect(() => mapWorkEvent(ev('item.add-link', { itemId: 'i', kind: 'k' }))).toThrow() // missing locator
    expect(() => mapWorkEvent(ev('item.add-link', { kind: 'k', locator: 'l' }))).toThrow() // missing itemId
  })

  it('an authenticated channel adds a link via ingest; folds + validate ok', () => {
    const { s, path } = freshStore()
    const c = ctx()
    const id = ingest([ev('item.create', { kind: 'feature', title: 'I', workspace: 'ws' })], c, s).ids[0] as string
    ingest([ev('item.add-link', { itemId: id, kind: 'spec', locator: 'e:s#sha256:ab' })], c, s)
    expect(new Track(s).state().items.get(id)!.links).toEqual([{ kind: 'spec', locator: 'e:s#sha256:ab' }])
    expect(validate(s.readAll(), readHead(path)).ok).toBe(true)
  })

  it('an UNAUTHENTICATED channel is rejected (binding gate — settles:evidence)', () => {
    const { s } = freshStore()
    const id = ingest([ev('item.create', { kind: 'feature', title: 'I', workspace: 'ws' })], ctx(), s).ids[0] as string
    expect(() =>
      ingest(
        [ev('item.add-link', { itemId: id, kind: 'spec', locator: 'e:s#sha256:ab' })],
        ctx({ prov: { transport: 'http', proposed: true, auth: 'unauthenticated' } }),
        s,
      ),
    ).toThrow()
    expect(new Track(s).state().items.get(id)!.links).toBeUndefined()
  })

  it('workspace containment — a W-pinned channel cannot link a V item', () => {
    const { s } = freshStore()
    const id = ingest(
      [ev('item.create', { kind: 'feature', title: 'I', workspace: 'ws-1' })],
      ctx({ workspace: 'ws-1' }),
      s,
    ).ids[0] as string
    expect(() =>
      ingest([ev('item.add-link', { itemId: id, kind: 'spec', locator: 'e:s#sha256:ab' })], ctx({ workspace: 'ws-2' }), s),
    ).toThrow(/workspace/)
    expect(new Track(s).state().items.get(id)!.links).toBeUndefined()
  })

  it('(workspace, clientToken) idempotency — a retried tokened add-link appends nothing', () => {
    const { s, path } = freshStore()
    const c = ctx()
    const id = ingest([ev('item.create', { kind: 'feature', title: 'I', workspace: 'ws' })], c, s).ids[0] as string
    const addLink = ev('item.add-link', { itemId: id, kind: 'pr-open', locator: 'rhanka/h2a#42' }, 'tok-add-link')
    ingest([addLink], c, s)
    ingest([addLink], c, s) // retried delivery — skipped
    expect(s.readAll().filter((e) => e.type === 'item.link-added')).toHaveLength(1)
    expect(new Track(s).state().items.get(id)!.links).toHaveLength(1)
    expect(validate(s.readAll(), readHead(path)).ok).toBe(true)
  })
})
