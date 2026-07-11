// friendly-parity — the cockpit re-base is BEHAVIOUR-PRESERVING (spec 2026-07-11 §5 step 3).
//
// The focus cockpit used to own its French mappers (`apps/focus/src/lib/track-model.ts`); those moved into
// the shared pure projection (`./friendly.ts`), and `buildFocusData` now delegates its rows to it
// (`directives.map(todoRowFr)` / `.slice(0,5).map(precoRowFr)` / human-decisions `.map(decisionRowFr)`).
// This test PINS parity: for a rich directive set it asserts the shared projection is BYTE-IDENTICAL to the
// PRE-REFACTOR cockpit mappers (reproduced verbatim below as the reference). A drift in either wording or
// row shape fails here — the same guarantee the focus `build`+`check` gate gives for the wiring.

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { EventStore } from '../events/store.js'
import { Track } from '../track.js'
import type { DecisionRow } from './build.js'
import { buildDirectives, type Directive } from './directive.js'
import { computeWpTree } from './rollup.js'
import { decisionRowFr, precoRowFr, subjectOf, todoRowFr } from './friendly.js'

// ---- the PRE-REFACTOR cockpit mappers, reproduced verbatim (the reference for parity) ------------------

type Tone = 'critical' | 'warning' | 'info' | 'neutral' | 'positive'
const oldClean = (s: string): string => s.replace(/\s+/g, ' ').trim()

function oldRankBadge(rank: string): { label: string; tone: Tone } {
  switch (rank) {
    case 'P1_GATE':
      return { label: 'Prioritaire', tone: 'critical' }
    case 'P2_ACCEPTANCE':
      return { label: 'À revérifier', tone: 'warning' }
    case 'P3_IN_PROGRESS':
      return { label: 'En cours', tone: 'info' }
    case 'P4_TODO_WSJF':
      return { label: 'À planifier', tone: 'neutral' }
    case 'P5_FALLBACK':
      return { label: 'À examiner', tone: 'neutral' }
    default:
      return { label: 'À examiner', tone: 'neutral' }
  }
}
function oldGatePhrase(gate: Directive['gate']): string | undefined {
  if (!gate) return undefined
  const base: Record<string, string> = {
    'decision-pending': 'En attente d’une décision',
    'engagement-pending': 'En attente d’un partenaire (h2a)',
    'external-dependency': 'Bloqué par une dépendance externe',
    'linked-dependency': 'Bloqué par une autre tâche',
    'manual-blocker': 'Bloqué manuellement',
    'spec-not-ready': 'À spécifier avant de démarrer',
    'acceptance-failed': 'Vérification en échec',
    'acceptance-stale': 'Vérification à refaire',
    'priority-missing': 'Priorité à définir'
  }
  const phrase = base[gate.code] ?? 'À examiner'
  if (gate.blockedByTitle && gate.blockedByTitle.trim() !== '') {
    return `${phrase} : « ${oldClean(gate.blockedByTitle)} »`
  }
  return phrase
}
function oldStepAction(step: string): string {
  const base: Record<string, string> = {
    'focus-decision': 'Instruire le dossier puis trancher',
    'settle-decision': 'Trancher la décision',
    'resume-engagement': 'Relancer le partenaire puis intégrer le retour',
    'resolve-external-blocker': 'Lever le blocage puis reprendre',
    'amend-spec': 'Rédiger la spécification',
    'fix-acceptance': 'Corriger puis relancer la vérification',
    'rerun-acceptance': 'Relancer la vérification sur le commit courant',
    'finish-increment': 'Terminer l’incrément en cours',
    'start-increment': 'Démarrer l’incrément (preuve + vérification)',
    'prioritize-backlog': 'Prioriser le backlog',
    'inspect-fallback': 'Inspecter l’état puis décider la suite'
  }
  return base[step] ?? 'Inspecter l’état puis décider la suite'
}
function oldModeActor(mode: string): string {
  switch (mode) {
    case 'human-decision':
      return 'Vous (décision)'
    case 'h2a-engagement':
      return 'Partenaire h2a'
    case 'subagent':
      return 'Sous-agent'
    case 'local':
      return 'Local'
    default:
      return 'À affecter'
  }
}
const oldAdviceNature = (kind: string): string => (kind === 'judgment-required' ? 'Décision' : 'Action')
const oldIsLaunchable = (d: Directive): boolean => d.mode === 'subagent' || d.mode === 'local'
function oldSubjectOf(d: Directive): string {
  const t = oldClean(d.target.title ?? d.target.id)
  return t.length > 90 ? t.slice(0, 88) + '…' : t
}
function oldShortWorkspace(ws?: string): string | undefined {
  if (!ws) return undefined
  const body = ws.startsWith('ws:') ? ws.slice(3) : ws
  return body.length > 10 ? `ws:${body.slice(0, 8)}…` : ws
}
function oldTodoRow(d: Directive): unknown {
  return {
    id: d.id,
    subject: oldSubjectOf(d),
    action: oldStepAction(d.step.code),
    actor: oldModeActor(d.mode),
    nature: oldAdviceNature(d.adviceKind),
    badge: oldRankBadge(d.rank),
    gate: oldGatePhrase(d.gate),
    launchable: oldIsLaunchable(d),
    wp: d.scope.wpLabel,
    fanIn: d.facts.fanIn,
    wsjf: d.facts.wsjf
  }
}
function oldPrecoRow(d: Directive): unknown {
  const gate = oldGatePhrase(d.gate)
  const lever =
    d.facts.fanIn && d.facts.fanIn > 0
      ? `Débloque ${d.facts.fanIn} autre(s) tâche(s)`
      : (gate ?? (d.mode === 'human-decision' ? 'Décision en attente' : 'Fait avancer le WP concerné'))
  return {
    id: d.id,
    title: oldSubjectOf(d),
    why: lever,
    action: oldStepAction(d.step.code),
    actor: oldModeActor(d.mode),
    badge: oldRankBadge(d.rank),
    launchable: oldIsLaunchable(d)
  }
}
function oldDecisionCard(d: Directive, repo: string): unknown {
  const concerns = oldSubjectOf(d)
  const wp = d.scope.wpLabel
  const why = oldGatePhrase(d.gate) ?? 'Décision d’orientation à trancher'
  return {
    id: d.id,
    question: d.gate?.blockedByTitle ? oldClean(d.gate.blockedByTitle) : concerns,
    concerns,
    action: oldStepAction(d.step.code),
    actor: oldModeActor(d.mode),
    project: repo,
    workspace: oldShortWorkspace(d.target.workspace),
    wp,
    summary: `Concerne « ${concerns} »${wp ? ` · ${wp}` : ''} — ${why}.`
  }
}

// ---- a rich directive set covering every mode / rank / gate / fan-in / wsjf / workspace ----------------

const now = (): string => '2026-06-09T00:00:00.000Z'
const cfg = { baselineCommit: 'c1', requireAccepted: false }
let dir: string
let t: Track

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'track-parity-'))
  t = new Track(new EventStore(join(dir, '.track', 'events.jsonl')), { by: 'human:x', now })
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const wp = (title: string): string => t.createItem({ kind: 'chore', title, workspace: 'ws', role: 'workpackage' })
const leaf = (title: string, parentId: string, kind: 'chore' | 'feature' = 'chore'): string =>
  t.createItem({ kind, title, workspace: 'ws', parentId })
const specified = (id: string): string => {
  t.setSpec(id, 'specified')
  return id
}

function richDirectives(): { directives: Directive[]; decisions: DecisionRow[] } {
  // acceptance debt, in-progress, spec-gate, prioritized to-do, unprioritized to-do, engagement,
  // dependency (fan-in ⇒ keystone), decision-wait, and a standalone pending decision with a workspace.
  const failing = specified(leaf('fail item with a deliberately very long title used to exercise the ninety-character subject clamp path end-to-end', wp('WP1'), 'feature'))
  t.recordRun(t.linkEvidence(t.addCriterion(failing, 'crit'), 'unit', 'loc'), { commit: 'c1', env: 'ci', runner: 'v', result: 'fail' })
  t.setRealization(specified(leaf('wip item', wp('WP2'))), 'in-progress')
  leaf('needs-spec', wp('WP3'))
  t.assessPriority(specified(leaf('valued', wp('WP4'))), { userBusinessValue: 5, timeCriticality: 3, riskReductionOpportunityEnablement: 2, jobSize: 1 })
  specified(leaf('unprioritized', wp('WP5')))
  t.createItem({ kind: 'feature', title: 'needs remote', workspace: 'ws', parentId: wp('WP6'), engagementRef: 'eng:remote-1' })

  const keystone = specified(leaf('X keystone', wp('WP7')))
  const dependent = specified(leaf('A dependent', wp('WP8')))
  t.openBlocker({ targetId: dependent, kind: 'dependency', ref: keystone, reason: 'needs X done' })

  const gated = leaf('gated leaf', wp('WP9'), 'feature')
  const decisions: DecisionRow[] = [
    // A decision blocking a leaf ⇒ surfaces as a decision-wait on that leaf (target.kind = 'item').
    { id: t.createDecision({ decisionKind: 'commitment', title: 'gate gated leaf', workspace: 'ws:89c4aa11deadbeefcafe', targets: [gated], dossier: { context: '', options: [], qa: [] } }), title: 'gate gated leaf', workspace: 'ws:89c4aa11deadbeefcafe', decisionKind: 'commitment', realization: 'to-do', outcome: 'pending' },
    // A standalone pending decision (no blocked leaf) ⇒ its OWN human-decision line (target.kind = 'decision'),
    // carrying a workspace short-form + a blockedByTitle. Passed as a plain row (no Track target needed).
    { id: 'D-standalone', title: 'standalone orientation', workspace: 'ws:0011deadbeefcafe2233', decisionKind: 'orientation', realization: 'to-do', outcome: 'pending', optionCount: 3 },
  ]
  return { directives: buildDirectives(computeWpTree(t.state(), cfg), decisions), decisions }
}

describe('friendly-parity — the shared projection reproduces the old cockpit rows byte-for-byte', () => {
  it('covers a rich directive set (all modes/ranks/gates + fan-in/wsjf/workspace)', () => {
    const { directives } = richDirectives()
    // The set is genuinely rich (proves the comparison is meaningful, not vacuous).
    expect(directives.length).toBeGreaterThanOrEqual(9)
    expect(new Set(directives.map((d) => d.mode))).toEqual(
      new Set(['subagent', 'h2a-engagement', 'human-decision']),
    )
    expect(directives.some((d) => d.facts.fanIn !== undefined)).toBe(true)
    expect(directives.some((d) => d.facts.wsjf !== undefined)).toBe(true)
    expect(directives.some((d) => d.target.workspace !== undefined)).toBe(true)
    expect(directives.some((d) => (d.target.title ?? '').length > 90)).toBe(true)
  })

  it('todoRowFr parity (the whole À-FAIRE list)', () => {
    const { directives } = richDirectives()
    for (const d of directives) {
      expect(todoRowFr(d)).toEqual(oldTodoRow(d))
      // Byte-parity too: same wording AND same key order after undefined-drop.
      expect(JSON.stringify(todoRowFr(d))).toBe(JSON.stringify(oldTodoRow(d)))
    }
  })

  it('precoRowFr parity (top-5 leviers)', () => {
    const { directives } = richDirectives()
    for (const d of directives.slice(0, 5)) {
      expect(precoRowFr(d)).toEqual(oldPrecoRow(d))
      expect(JSON.stringify(precoRowFr(d))).toBe(JSON.stringify(oldPrecoRow(d)))
    }
  })

  it('decisionRowFr parity (the decision cards, incl. workspace short-form + summary)', () => {
    const { directives } = richDirectives()
    const repo = 'my-repo'
    for (const d of directives.filter((x) => x.mode === 'human-decision')) {
      expect(decisionRowFr(d, repo)).toEqual(oldDecisionCard(d, repo))
      expect(JSON.stringify(decisionRowFr(d, repo))).toBe(JSON.stringify(oldDecisionCard(d, repo)))
    }
  })

  it('subjectOf parity (clean + 90-char clamp)', () => {
    const { directives } = richDirectives()
    for (const d of directives) expect(subjectOf(d)).toBe(oldSubjectOf(d))
  })
})
