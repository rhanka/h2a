// report-revamp — the additive CONTENT (§A) + the two render modes (§B inline, §C DS html). STRICT TDD:
// the machine `directives[]` schema grows ADDITIVELY (adviceKind, gate.blockedBy, facts.fanIn, keystone)
// while the inline/html renders reuse the SAME directive set (no second engine). Escaping + cohort-collapse
// are proven render-only.

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { EventStore } from '../events/store.js'
import { Track } from '../track.js'
import { buildDirectives, keystoneOf } from './directive.js'
import {
  buildWpConductorView,
  collapseLeafCohorts,
  formatWpConductorInline,
} from './format.js'
import { formatWpConductorHtml, renderReportHtml } from './html.js'
import { computeWpTree } from './rollup.js'

const now = (): string => '2026-07-10T00:00:00.000Z'
const cfg = { baselineCommit: 'c1', requireAccepted: false }

let dir: string
let t: Track

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'track-modes-'))
  let sequence = 0
  t = new Track(new EventStore(join(dir, '.track', 'events.jsonl')), {
    by: 'human:x', now, newId: () => `id-${String(++sequence).padStart(4, '0')}`,
  })
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const wp = (title: string): string => t.createItem({ kind: 'chore', title, workspace: 'ws', role: 'workpackage' })
const leaf = (title: string, parentId: string): string => t.createItem({ kind: 'chore', title, workspace: 'ws', parentId })
const specified = (id: string): string => {
  t.setSpec(id, 'specified')
  return id
}
const tree = (): ReturnType<typeof computeWpTree> => computeWpTree(t.state(), cfg)

// ---- §A2 adviceKind — orthogonal to mode, never a 5th mode value ----------------------------------

describe('§A2 — adviceKind is derived from mode (orthogonal axis)', () => {
  it('a subagent directive is derivable-next-step; a human-decision directive is judgment-required', () => {
    const w = wp('WP1')
    specified(leaf('todo', w))
    t.assessPriority(leaf('valued', w), { userBusinessValue: 5, timeCriticality: 1, riskReductionOpportunityEnablement: 1, jobSize: 1 })
    const gated = leaf('gated', wp('WP2'))
    t.createDecision({ decisionKind: 'commitment', title: 'gate gated', workspace: 'ws', targets: [gated], dossier: { context: '', options: [{ id: 'a', title: 'Option A', summary: 'first option' }, { id: 'b', title: 'Option B', summary: 'second option' }], qa: [], recommendation: { optionId: 'a', rationale: 'Option A is recommended' } } })

    const ds = buildDirectives(tree())
    const sub = ds.find((d) => d.mode === 'subagent')!
    const human = ds.find((d) => d.mode === 'human-decision')!
    expect(sub.adviceKind).toBe('derivable-next-step')
    expect(human.adviceKind).toBe('judgment-required')
    // every directive carries the field (additive, always present)
    for (const d of ds) expect(['derivable-next-step', 'judgment-required']).toContain(d.adviceKind)
  })
})

// ---- §A1 gate.blockedBy — ADDITIVE, never mutates gate.ref ----------------------------------------

describe('§A1 — gate.blockedBy names the item-cible without mutating the actionable gate.ref', () => {
  it('a dependency gate keeps ref = blockerId (handle) AND adds blockedBy = depended-on item id + title', () => {
    const keystone = specified(leaf('X keystone', wp('WPX')))
    const a = specified(leaf('A dependent', wp('WPA')))
    t.openBlocker({ targetId: a, kind: 'dependency', ref: keystone, reason: 'needs X done' })

    const d = buildDirectives(tree()).find((x) => x.target.id === a)!
    expect(d.step.code).toBe('resolve-external-blocker')
    expect(d.gate?.ref).toBeDefined()
    expect(d.gate?.ref).not.toBe(keystone) // ref is the blocker HANDLE, not the target item
    expect(d.gate?.blockedBy).toBe(keystone) // the item-cible, named additively
    expect(d.gate?.blockedByTitle).toBe('X keystone')
  })
})

// ---- §A5 fan-in + keystone — pure, deterministic, tie-break ULID ----------------------------------

describe('§A5 — 1-hop fan-in keystone (item that blocks the most others)', () => {
  it('keystoneOf picks the max fan-in item; facts.fanIn is carried on its directive', () => {
    const keystone = specified(leaf('X keystone', wp('WPX')))
    for (const [n, wpTitle] of [['A', 'WPA'], ['B', 'WPB']] as const) {
      const dep = specified(leaf(`${n} dependent`, wp(wpTitle)))
      t.openBlocker({ targetId: dep, kind: 'dependency', ref: keystone, reason: 'needs X' })
    }
    const k = keystoneOf(tree())
    expect(k).toBeDefined()
    expect(k!.id).toBe(keystone)
    expect(k!.blocks).toBe(2)

    const view = buildWpConductorView(tree())
    expect(view.keystone).toEqual({ id: keystone, title: 'X keystone', blocks: 2 })
    const kd = view.directives.find((d) => d.target.id === keystone)!
    expect(kd.facts.fanIn).toBe(2)
  })

  it('no open dependency ⇒ no keystone (drop-when-absent)', () => {
    specified(leaf('lonely', wp('WP1')))
    expect(keystoneOf(tree())).toBeUndefined()
    expect(buildWpConductorView(tree()).keystone).toBeUndefined()
  })
})

// ---- §A3 cohort-collapse — render-only, strictly intra-WP ------------------------------------------

describe('§A3 — cohort-collapse folds identical open leaves (render-only)', () => {
  it('N identical to-specify leaves collapse to one cohort with a count; directives[] stay per-leaf', () => {
    const w = wp('WP1')
    for (const title of ['l1', 'l2', 'l3', 'l4']) leaf(title, w)
    const cohorts = collapseLeafCohorts(tree()[0]!.leaves)
    expect(cohorts).toHaveLength(1)
    expect(cohorts[0]).toMatchObject({ tag: 'à spécifier', count: 4 })
    expect(cohorts[0]!.titles).toEqual(['l1', 'l2', 'l3', 'l4'])
  })
})

// ---- §B inline mode — compact, width-calibrated, 3 blocks, cohort + keystone -----------------------

describe('§B — inline render (compact, one-screen)', () => {
  it('keeps FAIT / À-FAIRE / PRÉCO, collapses cohorts, and truncates to width', () => {
    const w = wp('WP1 — Many')
    for (const title of ['aaaa', 'bbbb', 'cccc', 'dddd']) leaf(title, w)
    const out = formatWpConductorInline(tree(), [], { width: 60 })
    expect(out).toContain('FAIT')
    expect(out).toContain('À-FAIRE')
    expect(out).toContain('PRÉCO')
    expect(out).toContain('4× à spécifier') // cohort-collapsed, not 4 separate lines
    for (const line of out.split('\n')) expect(line.length).toBeLessThanOrEqual(60) // width-calibrated
  })

  it('surfaces the keystone bottleneck in the PRÉCO header', () => {
    const keystone = specified(leaf('X keystone', wp('WPX')))
    const dep = specified(leaf('A dependent', wp('WPA')))
    t.openBlocker({ targetId: dep, kind: 'dependency', ref: keystone, reason: 'needs X' })
    const out = formatWpConductorInline(tree(), [], { width: 100 })
    expect(out).toMatch(/PRÉCO\s+\(goulot: X keystone bloque 1\)/)
  })
})

// ---- §C html mode — DS-compatible fragment via the shared presenter --------------------------------

describe('§C — DS-compatible html fragment (shared presenter path)', () => {
  it('emits a namespaced <article> with sectioned tables and data-* directive variants', () => {
    const w = wp('WP1')
    specified(leaf('todo', w))
    const html = formatWpConductorHtml(tree())
    expect(html.startsWith('<article class="report-document" data-kind="wp-conductor-report"')).toBe(true)
    expect(html).toContain('<section class="report-section" data-section="done">')
    expect(html).toContain('<table class="report-table">')
    expect(html).toContain('class="report-directive"')
    expect(html).toContain('data-advice-kind="derivable-next-step"')
    expect(html).toContain('data-mode="subagent"')
    expect(html).toContain('</article>')
  })

  it('escapes a forged item title (no markup injection, §A4)', () => {
    const w = wp('WP1')
    leaf('<img src=x onerror=alert(1)>', w)
    const html = formatWpConductorHtml(tree())
    expect(html).not.toContain('<img src=x')
    expect(html).toContain('&lt;img src=x')
  })

  it('runs the whole fragment through the host sanitizeHtml hook', () => {
    const w = wp('WP1')
    specified(leaf('todo', w))
    const wrapped = renderReportHtml(buildWpConductorView(tree()), { sanitizeHtml: (h) => `<!--sane-->${h}` })
    expect(wrapped.startsWith('<!--sane--><article class="report-document"')).toBe(true)
  })
})
