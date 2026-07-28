// report-revamp — the conductor-grade `--wp` status (fait / à-faire(%·WP) / attendus).
// STRICT TDD: text render is escape-free, no doubled WP label, `--wp` drops the flat buckets, and
// the 3-table conductor view (FAIT / À-FAIRE / ATTENDUS) renders with correct membership.

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { EventStore } from './events/store.js'
import type { DecisionRow } from './report/build.js'
import { buildWpConductorView, formatWpConductor, formatWpTree } from './report/format.js'
import { computeWpTree } from './report/rollup.js'
import { reportHtml, reportText } from './read/commands.js'
import { TrackReader } from './read/contract.js'
import { Track } from './track.js'
import { runCli } from './cli/index.js'

let dir: string
let eventsPath: string
let store: EventStore
let t: Track

const now = (): string => '2026-06-09T00:00:00.000Z'
const cfg = { baselineCommit: 'c1', requireAccepted: false }
const base = { baselineCommit: 'c1' as const }

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'track-revamp-'))
  eventsPath = join(dir, '.track', 'events.jsonl')
  store = new EventStore(eventsPath)
  t = new Track(store, { by: 'human:x', now })
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const done = (id: string): void => {
  t.setRealization(id, 'in-progress')
  t.setRealization(id, 'done')
}

// ---- 1. text render is escape-free (markdown escaping leaks ONLY to md) ------------------------

describe('report-revamp — text render has NO backslash escapes', () => {
  it('formatWpTree(text) renders titles clean (no \\( \\) \\- escapes)', () => {
    const wp = t.createItem({ kind: 'chore', title: 'WP1 — Record Integrity', workspace: 'ws', role: 'workpackage' })
    t.createItem({ kind: 'chore', title: 'record-only (0.1.0)', workspace: 'ws', parentId: wp })
    const text = formatWpTree(computeWpTree(t.state(), cfg), 'text')
    expect(text).toContain('record-only (0.1.0)')
    expect(text).not.toContain('\\') // no backslash escapes anywhere in the text render
  })

  it('md render still escapes markdown metacharacters', () => {
    const wp = t.createItem({ kind: 'chore', title: 'WP1', workspace: 'ws', role: 'workpackage' })
    t.createItem({ kind: 'chore', title: 'record-only (0.1.0)', workspace: 'ws', parentId: wp })
    const md = formatWpTree(computeWpTree(t.state(), cfg), 'md')
    expect(md).toContain('\\(0.1.0\\)') // md target still escapes
  })
})

// ---- 2. no doubled `WPn · WPn` label ----------------------------------------------------------

describe('report-revamp — no doubled WP label', () => {
  it('strips a redundant leading "WPn — " from the WP item title', () => {
    const wp = t.createItem({ kind: 'chore', title: 'WP1 — Record Integrity', workspace: 'ws', role: 'workpackage' })
    t.createItem({ kind: 'chore', title: 'leaf', workspace: 'ws', parentId: wp })
    const text = formatWpConductor(computeWpTree(t.state(), cfg), 'text')
    expect(text).toContain('WP1 · Record Integrity')
    expect(text).not.toContain('WP1 · WP1')
    expect(text).not.toContain('WP1 — Record Integrity') // the raw stored prefix is gone
  })
})

// ---- 3. `--wp` omits the flat buckets; sections present --------------------------------------

describe('report-revamp — `--wp` structured view only (no flat bucket dump)', () => {
  function seed(): void {
    const wp1 = t.createItem({ kind: 'chore', title: 'WP1 — Done WP', workspace: 'ws', role: 'workpackage' })
    done(t.createItem({ kind: 'chore', title: 'd1', workspace: 'ws', parentId: wp1 }))

    const wp2 = t.createItem({ kind: 'chore', title: 'WP2 — Open WP', workspace: 'ws', role: 'workpackage' })
    t.createItem({ kind: 'chore', title: 'open-todo', workspace: 'ws', parentId: wp2 })
    const blocked = t.createItem({ kind: 'feature', title: 'awaited-leaf', workspace: 'ws', parentId: wp2 })
    // A pending decision keeps `blocked` AWAITED on a decision (createDecision opens a decision blocker).
    t.createDecision({
      decisionKind: 'commitment',
      title: 'gate awaited-leaf',
      workspace: 'ws',
      targets: [blocked],
      dossier: { context: '', options: [{ id: 'a', title: 'Option A', summary: 'first option' }, { id: 'b', title: 'Option B', summary: 'second option' }], qa: [], recommendation: { optionId: 'a', rationale: 'Option A is recommended' } },
    })
  }

  it('omits the flat AWAITED/DROPPED/DONE/TO-DO headings in --wp mode', () => {
    seed()
    const text = reportText(new TrackReader(eventsPath), { ...base, wpTree: true }, 'text')
    expect(text).not.toMatch(/^AWAITED \(/m)
    expect(text).not.toMatch(/^DROPPED \(/m)
    expect(text).not.toMatch(/^DONE \(/m)
    expect(text).not.toMatch(/^TO-DO \(/m)
  })



  it('CLI legacy JSON keeps --wp and --flat as deterministic compatibility projections', () => {
    seed()
    const out: string[] = []
    const err: string[] = []
    const io = { cwd: dir, out: (s: string) => out.push(s), err: (s: string) => err.push(s) }

    expect(runCli(['report', '--format', 'json', '--wp', '--commit', 'c1'], io)).toBe(0)
    const structured = JSON.parse(out.join()) as { wpTree?: unknown[] }
    expect(structured.wpTree?.length).toBeGreaterThan(0)

    out.length = 0
    expect(runCli(['report', '--format', 'json', '--commit', 'c1'], io)).toBe(0)
    const flat = JSON.parse(out.join()) as { wpTree?: unknown[]; buckets: Record<string, unknown[]> }
    expect(flat.wpTree).toBeUndefined()
    expect(flat.buckets).toHaveProperty('DONE')
    expect(flat.buckets).toHaveProperty('TO-DO')
  })

  it('the conductor view recommends next actions with an execution mode', () => {
    seed()
    const text = reportText(new TrackReader(eventsPath), { ...base, wpTree: true }, 'text')
    expect(text).toContain('DÉCISIONS/ACTIONS')
    expect(text).toMatch(/(action|décision) \(/)
    // Unified lexicon (spec 2026-07-11): the préconisation clause is the shared canonical action wording.
    expect(text).toMatch(/trancher|rédiger|relancer|corriger|démarrer|inspecter/i)
  })

  it('report --flat keeps the legacy flat-bucket behavior (deprecated back-compat)', () => {
    seed()
    const text = reportText(new TrackReader(eventsPath), { ...base, wpTree: false }, 'text')
    expect(text).toMatch(/^DONE \(/m)
    expect(text).toMatch(/^TO-DO \(/m)
  })


  it('report defaults to the conductor view when a WP forest exists (0.19.1)', () => {
    seed()
    const text = reportText(new TrackReader(eventsPath), { ...base, wpTree: true }, 'text')
    expect(text).toContain('FAIT')
    expect(text).toContain('À-FAIRE')
    expect(text).not.toMatch(/^TO-DO \(/m)
  })

  it('FAIT / À-FAIRE / ATTENDUS sections are present with correct membership', () => {
    seed()
    const text = reportText(new TrackReader(eventsPath), { ...base, wpTree: true }, 'text')
    expect(text).toContain('FAIT')
    expect(text).toContain('À-FAIRE')
    expect(text).toContain('DÉCISIONS/ACTIONS')
    expect(text).toContain('WP1 · Done WP')
    // global total = sum of all WP leaves (1 done of 3 active: d1 + open-todo + awaited-leaf) ⇒ 1/3, 33%
    expect(text).toContain('1/3 (33%)')
  })

  it('renders every nested WP as its own conductor row', () => {
    const root = t.createItem({ kind: 'chore', title: 'WP1 — Root', workspace: 'ws', role: 'workpackage' })
    const child = t.createItem({ kind: 'chore', title: 'Child', workspace: 'ws', role: 'workpackage', parentId: root })
    t.createItem({ kind: 'feature', title: 'child work', workspace: 'ws', parentId: child })

    const text = formatWpConductor(computeWpTree(t.state(), cfg), 'text')
    expect(text).toContain('WP1 · Root')
    expect(text).toContain('WP1.1 · Child')
  })

  it('an AWAITED leaf lands in ATTENDUS with a derived disposition', () => {
    seed()
    const text = reportText(new TrackReader(eventsPath), { ...base, wpTree: true }, 'text')
    expect(text).toContain('awaited-leaf')
    // AWAITED-on-a-decision ⇒ decision recommendation, not a passive blocker line
    expect(text).toContain('décision')
    // Unified lexicon (spec 2026-07-11): settle-decision now reads "Trancher la décision" (was
    // "trancher outcome") — the shared canonical wording the cockpit uses.
    expect(text).toContain('Trancher la décision')
  })

  it('an open OPEN (TO-DO) leaf appears under its WP in À-FAIRE', () => {
    seed()
    const text = reportText(new TrackReader(eventsPath), { ...base, wpTree: true }, 'text')
    expect(text).toContain('open-todo')
  })
})

// ---- 4. json path carries wpTree + global totals ----------------------------------------------

describe('report-revamp — json path keeps the machine contract + additive view model', () => {
  it('--format json preserves {buckets, wpTree, wpTotals} (0.19.0 contract) and adds an optional `view`', () => {
    const wp = t.createItem({ kind: 'chore', title: 'WP1', workspace: 'ws', role: 'workpackage' })
    done(t.createItem({ kind: 'chore', title: 'd', workspace: 'ws', parentId: wp }))
    t.createItem({ kind: 'chore', title: 'td', workspace: 'ws', parentId: wp })
    const json = reportText(new TrackReader(eventsPath), { ...base, wpTree: true }, 'json')
    const parsed = JSON.parse(json) as {
      buckets: Record<string, unknown[]>
      wpTree: unknown[]
      wpTotals: { done: number; active: number; pct: number | string }
      view?: {
        kind: string
        tables: { id: string; rows: Record<string, string>[] }[]
        directives: { id: string; step: { code: string }; mode: string }[]
        dispatchQueue: string[]
      }
    }
    // Machine contract UNCHANGED from 0.19.0.
    expect(parsed.buckets).toBeDefined()
    expect(parsed.wpTree).toBeDefined()
    expect(parsed.wpTotals).toEqual({ done: 1, active: 2, dropped: 0, pct: 50 })
    // Additive optional view model for presentation skills.
    expect(parsed.view!.kind).toBe('wp-conductor-report')
    expect(parsed.view!.tables.find((t) => t.id === 'done')!.rows[0]!['progress']).toBe('1/2 (50%)')
    // 1.14.0 — the actionable directives + the subagent dispatch queue are carried additively.
    expect(Array.isArray(parsed.view!.directives)).toBe(true)
    expect(parsed.view!.directives.length).toBeGreaterThanOrEqual(1)
    expect(Array.isArray(parsed.view!.dispatchQueue)).toBe(true)
  })
})

// ---- 4b. no silent truncation + md escaping (Codex 0.19.5 review nits) ------------------------

describe('report-revamp — the conductor is exhaustive and escapes md', () => {
  it('À-FAIRE lists every open leaf when a WP has more than 2', () => {
    const wp = t.createItem({ kind: 'chore', title: 'WP1 — Many', workspace: 'ws', role: 'workpackage' })
    for (const title of ['l1', 'l2', 'l3', 'l4']) t.createItem({ kind: 'chore', title, workspace: 'ws', parentId: wp })
    const text = formatWpConductor(computeWpTree(t.state(), cfg), 'text')
    for (const title of ['l1', 'l2', 'l3', 'l4']) expect(text).toContain(title)
    expect(text).not.toContain('autres')
  })

  it('DÉCISIONS/ACTIONS lists every pending decision when more than 8 exist', () => {
    const wp = t.createItem({ kind: 'chore', title: 'WP1', workspace: 'ws', role: 'workpackage' })
    t.createItem({ kind: 'chore', title: 'leaf', workspace: 'ws', parentId: wp })
    const decisions: DecisionRow[] = Array.from({ length: 9 }, (_, i) => ({
      id: `d${i}`, title: `dec${i}`, workspace: 'ws', decisionKind: 'commitment', realization: 'to-do', outcome: 'pending', structured: true,
      options: [{ id: 'a', title: 'A', summary: 'first' }, { id: 'b', title: 'B', summary: 'second' }],
      recommendation: { optionId: 'a', rationale: 'first is safer' },
    }))
    const text = formatWpConductor(computeWpTree(t.state(), cfg), 'text', decisions)
    for (const i of Array.from({ length: 9 }, (_, n) => n)) expect(text).toContain(`dec${i}`)
    expect(text).not.toContain('entrées non listées')
  })

  it('surfaces rows outside the WP leaves and reconciles the global total with the flat buckets', () => {
    const wp = t.createItem({ kind: 'chore', title: 'WP1', workspace: 'ws', role: 'workpackage' })
    const wpLeaf = t.createItem({ kind: 'feature', title: 'inside WP', workspace: 'ws', parentId: wp })
    done(wpLeaf)
    const orphanDoneA = t.createItem({ kind: 'feature', title: 'orphan done A', workspace: 'ws' })
    const orphanDoneB = t.createItem({ kind: 'feature', title: 'orphan done B', workspace: 'ws' })
    const orphanPending = t.createItem({ kind: 'feature', title: 'orphan pending decision', workspace: 'ws' })
    done(orphanDoneA)
    done(orphanDoneB)
    t.createDecision({
      decisionKind: 'commitment', title: 'decide orphan', workspace: 'ws', targets: [orphanPending],
      dossier: {
        context: 'Choose how to handle the orphan item.',
        options: [{ id: 'complete', title: 'Complete it', summary: 'Finish the item in this workpackage.' }, { id: 'defer', title: 'Defer it', summary: 'Leave it pending for a later window.' }],
        recommendation: { optionId: 'complete', rationale: 'The item is already in scope.' },
        qa: [],
      },
    })

    const reader = new TrackReader(eventsPath)
    const report = reader.report({ ...base, decisions: true, wpTree: true })
    const outside = report.outsideRollup ?? []
    expect(outside.map((row) => row.title)).toEqual(expect.arrayContaining(['orphan done A', 'orphan done B', 'orphan pending decision']))
    expect(outside.every((row) => row.wpId === undefined)).toBe(true)

    const rendered = reportText(reader, { ...base, decisions: true, wpTree: true }, 'text')
    expect(rendered).toContain('HORS ROLLUP')
    for (const row of outside) expect(rendered).toContain(row.title)

    const view = JSON.parse(reportText(reader, { ...base, decisions: true, wpTree: true }, 'json')) as {
      view: { tables: Array<{ id: string; rows: Record<string, string>[] }> }
    }
    const outsideRows = view.view.tables.find((table) => table.id === 'outside-rollup')!.rows
    for (const row of outside) {
      expect(outsideRows).toContainEqual(expect.objectContaining({ id: row.id, workspace: row.workspace, item: row.title }))
    }

    const json = JSON.parse(reportText(reader, { ...base, decisions: true, wpTree: true }, 'json')) as {
      buckets: Record<string, unknown[]>
      wpTotals: { done: number; active: number; dropped: number }
    }
    const rawCount = Object.values(json.buckets).flat().length
    expect(json.wpTotals.done + (json.wpTotals.active - json.wpTotals.done) + json.wpTotals.dropped).toBe(rawCount)
  })

  it('HTML keeps every outside-rollup item when there is no WP root', () => {
    t.createItem({ kind: 'feature', title: 'orphan A', workspace: 'ws' })
    const orphanB = t.createItem({ kind: 'feature', title: 'orphan B', workspace: 'ws' })
    done(orphanB)

    const html = reportHtml(new TrackReader(eventsPath), { ...base, decisions: true, wpTree: true })
    expect(html).toContain('HORS ROLLUP')
    expect(html).toContain('orphan A')
    expect(html).toContain('orphan B')
  })

  it('labels --active-roster totals as a filtered roster rather than global', () => {
    const active = t.createItem({ kind: 'chore', title: 'active WP', workspace: 'ws', role: 'workpackage' })
    t.createItem({ kind: 'feature', title: 'active item', workspace: 'ws', parentId: active })
    const terminal = t.createItem({ kind: 'chore', title: 'terminal WP', workspace: 'ws', role: 'workpackage' })
    t.createItem({ kind: 'feature', title: 'terminal item', workspace: 'ws', parentId: terminal })
    t.setRealization(terminal, 'cancelled')

    const text = reportText(new TrackReader(eventsPath), { ...base, wpTree: true, activeRoster: true }, 'text')
    expect(text).toContain('roster actif')
    expect(text).not.toMatch(/^global\s/m)
    expect(text).not.toContain('terminal WP')
  })

  it('moves a legacy optionless decision to À INSTRUIRE instead of the decision table', () => {
    const wp = t.createItem({ kind: 'chore', title: 'WP1', workspace: 'ws', role: 'workpackage' })
    t.createItem({ kind: 'chore', title: 'leaf', workspace: 'ws', parentId: wp })
    const legacy: DecisionRow = {
      id: 'legacy-1', title: 'Unstructured legacy choice', workspace: 'ws',
      decisionKind: 'orientation', realization: 'to-do', outcome: 'pending', structured: false,
    }
    const text = formatWpConductor(computeWpTree(t.state(), cfg), 'text', [legacy])
    expect(text).toContain('À INSTRUIRE')
    // Terminal tables can wrap within a title column; preserve both fragments rather than assuming adjacency.
    expect(text).toContain('Unstructured')
    expect(text).toContain('choice')
    const decisionsSection = text.slice(text.indexOf('DÉCISIONS/ACTIONS'))
    expect(decisionsSection).not.toContain('Unstructured legacy')
  })

  it('keeps a settled legacy outcome as history without pretending an option was selected', () => {
    const wp = t.createItem({ kind: 'chore', title: 'WP1', workspace: 'ws', role: 'workpackage' })
    t.createItem({ kind: 'chore', title: 'leaf', workspace: 'ws', parentId: wp })
    const legacy: DecisionRow = {
      id: 'legacy-settled', title: 'Historical outcome without options', workspace: 'ws',
      decisionKind: 'orientation', realization: 'done', outcome: 'go', structured: false,
    }
    const text = formatWpConductor(computeWpTree(t.state(), cfg), 'text', [legacy])
    expect(text).toContain('HISTORIQUE NON STRUCTURÉ')
    expect(text).toContain('Historical outcome')
    expect(text).toContain('without options')
    expect(text).toContain('outcome historique:go')
    expect(text).toContain('aucune option')
    expect(text).not.toContain('À INSTRUIRE')
  })

  it('renders only validated native alternatives in DÉCISIONS', () => {
    const wp = t.createItem({ kind: 'chore', title: 'WP1', workspace: 'ws', role: 'workpackage' })
    t.createItem({ kind: 'chore', title: 'leaf', workspace: 'ws', parentId: wp })
    const structured: DecisionRow = {
      id: 'structured-1', title: 'Recorded alternatives', workspace: 'ws', decisionKind: 'orientation',
      realization: 'to-do', outcome: 'pending', structured: true,
      options: [{ id: 'a', title: 'Safe route', summary: 'Require proof' }, { id: 'b', title: 'Fast route', summary: 'Use the alias' }],
      recommendation: { optionId: 'a', rationale: 'The route is safer' },
    }
    const text = formatWpConductor(computeWpTree(t.state(), cfg), 'text', [structured])
    expect(text).toContain('DÉCISIONS')
    expect(text).toContain('a: Safe route')
    expect(text).toContain('recommandée:a')
  })

  it('md render escapes markdown metacharacters in a crafted item title (no injection)', () => {
    const wp = t.createItem({ kind: 'chore', title: 'WP1', workspace: 'ws', role: 'workpackage' })
    t.createItem({ kind: 'chore', title: '**x** [a](b)', workspace: 'ws', parentId: wp })
    const md = formatWpConductor(computeWpTree(t.state(), cfg), 'md')
    expect(md).toContain('\\*\\*x\\*\\*') // ** escaped
    expect(md).toContain('\\[a\\]') // link bracket escaped
  })
})

// ---- 5. CLI end-to-end ------------------------------------------------------------------------

describe('report-revamp — legacy CLI JSON `track report --wp` end-to-end', () => {
  const cli = (...argv: string[]): { code: number; out: string; err: string } => {
    const out: string[] = []
    const err: string[] = []
    const io = { cwd: dir, out: (s: string) => out.push(s), err: (s: string) => err.push(s) }
    // sync commands only here → runCli returns a plain number (the async `focus` path is not exercised)
    return { code: runCli(argv, io) as number, out: out.join(''), err: err.join('') }
  }

  it('surfaces the WP label in the frozen machine projection', () => {
    cli('init')
    const wp = cli('item', 'new', '--kind', 'chore', '--title', 'WP1 — Record Integrity', '--workspace', 'ws', '--role', 'workpackage').out.trim()
    cli('item', 'new', '--kind', 'chore', '--title', 'record-only (0.1.0)', '--workspace', 'ws', '--parent', wp)
    const r = cli('report', '--format', 'json', '--wp', '--commit', 'c1')
    expect(r.code).toBe(0)
    const report = JSON.parse(r.out) as { wpTree: Array<{ label: string; title: string }> }
    expect(report.wpTree[0]).toMatchObject({ label: 'WP1', title: 'WP1 — Record Integrity' })
  })
})

// ---- 5. focus-wp-enrichment — per-row WP attribution (ALL buckets) + detail block ----------------
// The additive `wpId`/`wpLabel`/`detail` fields let the focus app display/sort/filter by workpackage
// and show per-item detail. Proven here for a DONE leaf (not only open items), an orphan (no WP), and
// parity with the directive's `scope` for the same item.

describe('focus-wp-enrichment — every bucket row carries WP + detail', () => {
  // FR gloss the row's machine acceptance is glossed to (mirrors ACCEPTANCE_FR in build.ts).
  const FR: Record<string, string> = {
    pass: 'recette OK',
    fail: 'recette en échec',
    stale: 'recette obsolète (à rejouer)',
    waived: 'recette dérogée',
    unknown: 'recette non évaluée',
    'n/a': 'sans recette',
  }

  it('attaches wpId/wpLabel to a DONE leaf (not only open items), matching the directive scope', () => {
    const wp = t.createItem({ kind: 'chore', title: 'WP1 — Theme', workspace: 'ws', role: 'workpackage' })
    const doneLeaf = t.createItem({ kind: 'feature', title: 'done-leaf', workspace: 'ws', parentId: wp, body: '  Ship the\n  thing  ' })
    done(doneLeaf)
    const todoLeaf = t.createItem({ kind: 'feature', title: 'todo-leaf', workspace: 'ws', parentId: wp })
    const orphan = t.createItem({ kind: 'feature', title: 'orphan', workspace: 'ws' }) // no WP ancestor

    const reader = new TrackReader(eventsPath)
    const report = reader.report({ ...base, wpTree: true })
    const rowById = new Map(
      [
        ...report.buckets.DONE,
        ...report.buckets['TO-DO'],
        ...report.buckets.AWAITED,
        ...report.buckets.DROPPED,
      ].map((r) => [r.id, r]),
    )

    // DONE leaf is enriched too — the whole point (WP derivable for EVERY bucket, not only open ones).
    const d = rowById.get(doneLeaf)!
    expect(d.bucket).toBe('DONE')
    expect(d.wpId).toBe(wp)
    expect(d.wpLabel).toBe('WP1')
    expect(d.detail.summary).toBe('Ship the thing') // cleaned to one line, whitespace collapsed
    expect(d.detail.acceptanceLabel).toBe(FR[d.acceptance]) // recette state 'en clair'

    // TO-DO leaf: same WP; no body ⇒ summary drop-when-absent; detail still present.
    const td = rowById.get(todoLeaf)!
    expect(td.wpId).toBe(wp)
    expect(td.wpLabel).toBe('WP1')
    expect(td.detail.summary).toBeUndefined()
    expect(td.detail.acceptanceLabel).toBe(FR[td.acceptance])

    // Orphan (no WP ancestor) ⇒ wpId/wpLabel drop-when-absent; detail block still present.
    const o = rowById.get(orphan)!
    expect(o.wpId).toBeUndefined()
    expect(o.wpLabel).toBeUndefined()
    expect(o.detail.acceptanceLabel).toBe(FR[o.acceptance])

    // Parity: a row's wpId/wpLabel == the matching directive's scope for the SAME item (one source of truth).
    const view = buildWpConductorView(report.wpTree!, report.decisions ?? [])
    const dir = view.directives.find((x) => x.target.id === todoLeaf)
    expect(dir?.scope.wpId).toBe(td.wpId)
    expect(dir?.scope.wpLabel).toBe(td.wpLabel)
  })
})
