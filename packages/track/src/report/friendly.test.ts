// friendly — exhaustive unit coverage for the SHARED enum→French lexicon + per-directive projection
// (spec 2026-07-11-unified-report-presentation-layer §5 step 1). Every governed enum value is covered, an
// UNKNOWN value degrades to a sane fallback (never `undefined` / never a raw enum leak), and the projection
// row builders produce the documented friendly shapes. The module is PURE (no fs/Date.now/ANSI/HTML).

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import type {
  Directive,
  DirectiveAdviceKind,
  DirectiveGateCode,
  DirectiveMode,
  DirectiveRank,
  DirectiveStepCode,
} from './directive.js'
import {
  acceptanceFr,
  adviceNatureFr,
  cleanText,
  decisionRowFr,
  directiveScopeLabelFr,
  gatePhraseFr,
  isLaunchable,
  kindFr,
  modeActorFr,
  precoRowFr,
  rankBadgeFr,
  stepActionFr,
  subjectOf,
  todoRowFr,
} from './friendly.js'

// ---- the FULL governed enum value lists (a new value added to a union is a compile error here) ----------

const RANKS: DirectiveRank[] = ['P1_GATE', 'P2_ACCEPTANCE', 'P3_IN_PROGRESS', 'P4_TODO_WSJF', 'P5_FALLBACK']
const GATES: DirectiveGateCode[] = [
  'decision-pending', 'engagement-pending', 'external-dependency', 'linked-dependency', 'manual-blocker',
  'spec-not-ready', 'acceptance-failed', 'acceptance-stale', 'priority-missing',
]
const STEPS: DirectiveStepCode[] = [
  'focus-decision', 'settle-decision', 'resume-engagement', 'resolve-external-blocker', 'amend-spec',
  'fix-acceptance', 'rerun-acceptance', 'finish-increment', 'start-increment', 'prioritize-backlog',
  'inspect-fallback',
]
const MODES: DirectiveMode[] = ['human-decision', 'h2a-engagement', 'subagent', 'local']
const ADVICE: DirectiveAdviceKind[] = ['derivable-next-step', 'judgment-required']
const ACCEPTANCES = ['pass', 'fail', 'stale', 'waived', 'unknown', 'n/a']

/** No enum → French mapping may leak a raw enum token or an empty/`undefined` value. */
const isCleanFr = (s: string): boolean => s.length > 0 && !/[a-z]+-[a-z]+/.test(s) && s !== 'undefined'

// ---- 1. LEXICON — every enum value maps + unknown degrades (never `undefined`, never a raw enum) --------

describe('lexicon — rankBadgeFr', () => {
  it('maps every DirectiveRank to a labelled, toned badge', () => {
    for (const r of RANKS) {
      const b = rankBadgeFr(r)
      expect(b.label.length).toBeGreaterThan(0)
      expect(['critical', 'warning', 'info', 'neutral', 'positive']).toContain(b.tone)
    }
    expect(rankBadgeFr('P1_GATE')).toEqual({ label: 'Prioritaire', tone: 'critical' })
  })
  it('an unknown rank degrades to a neutral "À examiner"', () => {
    expect(rankBadgeFr('P9_FUTURE' as DirectiveRank)).toEqual({ label: 'À examiner', tone: 'neutral' })
  })
})

describe('lexicon — gatePhraseFr', () => {
  it('maps every DirectiveGateCode to a jargon-free French phrase', () => {
    for (const c of GATES) {
      const p = gatePhraseFr({ code: c })
      expect(p).toBeDefined()
      expect(isCleanFr(p!)).toBe(true)
    }
  })
  it('appends the blocking title when the gate names it', () => {
    expect(gatePhraseFr({ code: 'decision-pending', blockedByTitle: '  choose   DB  ' })).toBe(
      'En attente d’une décision : « choose DB »',
    )
  })
  it('undefined gate ⇒ undefined; unknown code ⇒ "À examiner"', () => {
    expect(gatePhraseFr(undefined)).toBeUndefined()
    expect(gatePhraseFr({ code: 'future-gate' as DirectiveGateCode })).toBe('À examiner')
  })
})

describe('lexicon — stepActionFr', () => {
  it('maps every DirectiveStepCode to a concrete action phrase', () => {
    for (const s of STEPS) expect(isCleanFr(stepActionFr(s))).toBe(true)
    expect(stepActionFr('fix-acceptance')).toBe('Corriger puis relancer la vérification')
  })
  it('an unknown step degrades to the inspect-fallback phrasing (forward-compat)', () => {
    expect(stepActionFr('future-step' as DirectiveStepCode)).toBe(stepActionFr('inspect-fallback'))
    expect(stepActionFr('future-step' as DirectiveStepCode)).toContain('Inspecter')
  })
})

describe('lexicon — modeActorFr / adviceNatureFr', () => {
  it('maps every DirectiveMode to an actor; unknown ⇒ "À affecter"', () => {
    for (const m of MODES) expect(modeActorFr(m).length).toBeGreaterThan(0)
    expect(modeActorFr('subagent')).toBe('Sous-agent')
    expect(modeActorFr('future-mode' as DirectiveMode)).toBe('À affecter')
  })
  it('maps every DirectiveAdviceKind to Décision/Action', () => {
    for (const a of ADVICE) expect(['Décision', 'Action']).toContain(adviceNatureFr(a))
    expect(adviceNatureFr('judgment-required')).toBe('Décision')
    expect(adviceNatureFr('derivable-next-step')).toBe('Action')
  })
})

describe('lexicon — kindFr / acceptanceFr', () => {
  it('maps known item kinds; unknown passes through verbatim', () => {
    expect(kindFr('feature')).toBe('Fonctionnalité')
    expect(kindFr('bug')).toBe('Correctif')
    expect(kindFr('chore')).toBe('Tâche')
    expect(kindFr('decision')).toBe('decision') // unknown-to-lexicon ⇒ passthrough
  })
  it('maps every acceptance state to its FR gloss; unknown passes through', () => {
    for (const a of ACCEPTANCES) expect(acceptanceFr(a).length).toBeGreaterThan(0)
    expect(acceptanceFr('fail')).toBe('recette en échec')
    expect(acceptanceFr('n/a')).toBe('sans recette')
    expect(acceptanceFr('brand-new')).toBe('brand-new')
  })
})

// ---- 2. helpers — cleanText / subjectOf / directiveScopeLabelFr / isLaunchable --------------------------

const mkDirective = (p: Partial<Directive> & { step?: { code: DirectiveStepCode } }): Directive =>
  ({
    id: p.id ?? 'item:x',
    target: p.target ?? { kind: 'item', id: 'x', title: 'a title' },
    scope: p.scope ?? {},
    mode: p.mode ?? 'subagent',
    adviceKind: p.adviceKind ?? 'derivable-next-step',
    ...(p.gate !== undefined ? { gate: p.gate } : {}),
    step: p.step ?? { code: 'start-increment' },
    rank: p.rank ?? 'P4_TODO_WSJF',
    facts: p.facts ?? { bucket: 'TO-DO', realization: 'to-do', acceptance: 'unknown', specStatus: 'specified' },
    affordances: p.affordances ?? [],
  }) as Directive

describe('helpers', () => {
  it('cleanText collapses whitespace runs and trims', () => {
    expect(cleanText('  a\n\t b   c ')).toBe('a b c')
  })
  it('subjectOf cleans + caps very long titles with an ellipsis (no silent cut)', () => {
    expect(subjectOf(mkDirective({ target: { kind: 'item', id: 'x', title: '  hi   there ' } }))).toBe('hi there')
    const long = 'x'.repeat(200)
    const s = subjectOf(mkDirective({ target: { kind: 'item', id: 'x', title: long } }))
    expect(s.length).toBe(89) // 88 chars + ellipsis
    expect(s.endsWith('…')).toBe(true)
  })
  it('directiveScopeLabelFr prefers gate.code, then wpLabel, then "-"', () => {
    expect(directiveScopeLabelFr(mkDirective({ gate: { code: 'spec-not-ready' } }))).toBe('spec-not-ready')
    expect(directiveScopeLabelFr(mkDirective({ scope: { wpLabel: 'WP2' } }))).toBe('WP2')
    expect(directiveScopeLabelFr(mkDirective({}))).toBe('-')
  })
  it('isLaunchable is true only for subagent/local', () => {
    expect(isLaunchable(mkDirective({ mode: 'subagent' }))).toBe(true)
    expect(isLaunchable(mkDirective({ mode: 'local' }))).toBe(true)
    expect(isLaunchable(mkDirective({ mode: 'human-decision' }))).toBe(false)
    expect(isLaunchable(mkDirective({ mode: 'h2a-engagement' }))).toBe(false)
  })
})

// ---- 3. PROJECTION — todo / preco / decision rows ------------------------------------------------------

describe('projection — todoRowFr', () => {
  it('builds a full friendly row; optional fields are drop-when-absent', () => {
    const row = todoRowFr(
      mkDirective({
        id: 'item:a',
        target: { kind: 'item', id: 'a', title: 'ship it' },
        mode: 'subagent',
        adviceKind: 'derivable-next-step',
        rank: 'P1_GATE',
        step: { code: 'amend-spec' },
        gate: { code: 'spec-not-ready' },
        scope: { wpLabel: 'WP1' },
        facts: { bucket: 'TO-DO', realization: 'to-do', acceptance: 'unknown', specStatus: 'to-specify', fanIn: 2, wsjf: 7 },
      }),
    )
    expect(row).toEqual({
      id: 'item:a',
      subject: 'ship it',
      action: 'Rédiger la spécification',
      actor: 'Sous-agent',
      nature: 'Action',
      badge: { label: 'Prioritaire', tone: 'critical' },
      gate: 'À spécifier avant de démarrer',
      launchable: true,
      wp: 'WP1',
      fanIn: 2,
      wsjf: 7,
    })
  })
  it('omits gate/wp/fanIn/wsjf when absent', () => {
    const row = todoRowFr(mkDirective({ id: 'item:b', target: { kind: 'item', id: 'b', title: 't' } }))
    expect(row).toEqual({
      id: 'item:b', subject: 't', action: 'Démarrer l’incrément (preuve + vérification)', actor: 'Sous-agent',
      nature: 'Action', badge: { label: 'À planifier', tone: 'neutral' }, launchable: true,
    })
  })
})

describe('projection — precoRowFr', () => {
  it('a fan-in directive gets a "débloque N" lever; else the gate; else a generic lever', () => {
    const withFanIn = precoRowFr(mkDirective({ facts: { bucket: 'TO-DO', realization: 'to-do', acceptance: 'unknown', specStatus: 'specified', fanIn: 3 } }))
    expect(withFanIn.why).toBe('Débloque 3 autre(s) tâche(s)')
    const withGate = precoRowFr(mkDirective({ gate: { code: 'acceptance-failed' } }))
    expect(withGate.why).toBe('Vérification en échec')
    const generic = precoRowFr(mkDirective({}))
    expect(generic.why).toBe('Fait avancer le WP concerné')
    const decision = precoRowFr(mkDirective({ mode: 'human-decision' }))
    expect(decision.why).toBe('Décision en attente')
  })
})

describe('projection — decisionRowFr', () => {
  it('builds a decision card with the question, concerns, project + a one-line summary', () => {
    const card = decisionRowFr(
      mkDirective({
        id: 'item:d',
        mode: 'human-decision',
        adviceKind: 'judgment-required',
        step: { code: 'focus-decision' },
        target: { kind: 'item', id: 'd', title: 'gated item', workspace: 'ws:89c4aa11deadbeef' },
        gate: { code: 'decision-pending', blockedByTitle: 'pick a database' },
        scope: { wpLabel: 'WP3' },
      }),
      'my-repo',
    )
    expect(card).toEqual({
      id: 'item:d',
      question: 'pick a database',
      concerns: 'gated item',
      action: 'Instruire le dossier puis trancher',
      actor: 'Vous (décision)',
      project: 'my-repo',
      workspace: 'ws:89c4aa11…',
      wp: 'WP3',
      summary: 'Concerne « gated item » · WP3 — En attente d’une décision : « pick a database ».',
    })
  })
})

// ---- 4. package-export wiring — the pure subpath is declared with types + import ------------------------

describe('package-export — the pure subpath is published (types + import)', () => {
  it('package.json exports "./report/friendly" with a types + import condition', () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as {
      exports: Record<string, unknown>
    }
    expect(pkg.exports['./report/friendly']).toEqual({
      types: './dist/report/friendly.d.ts',
      import: './dist/report/friendly.js',
    })
  })
})
