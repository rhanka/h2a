// friendly-snapshot — the CANONICAL enum→French lexicon, pinned in ONE place (spec 2026-07-11 §5 step 4).
//
// Both surfaces render from this exact lexicon: the terminal (`format.ts` `directivePhrase` composes
// `stepActionFr`; the ACTIONS DÉRIVÉES scope cell is `directiveScopeLabelFr`) AND the cockpit
// (`apps/focus` `todoRowFr`/`precoRowFr`/`decisionRowFr` map rank/gate/step/mode/adviceKind/kind). A change
// to any French wording is a VISIBLE diff here — the single anti-re-drift guard both surfaces are checked
// against (the terminal via its goldens, the cockpit via its parity test, both ultimately these strings).

import { describe, expect, it } from 'vitest'

import type {
  DirectiveAdviceKind,
  DirectiveGateCode,
  DirectiveMode,
  DirectiveRank,
  DirectiveStepCode,
} from './directive.js'
import { acceptanceFr, adviceNatureFr, gatePhraseFr, kindFr, modeActorFr, rankBadgeFr, stepActionFr } from './friendly.js'

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
const KINDS = ['feature', 'bug', 'chore']
const ACCEPTANCES = ['pass', 'fail', 'stale', 'waived', 'unknown', 'n/a']

const canonicalLexicon = (): Record<string, Record<string, string>> => ({
  rank: Object.fromEntries(RANKS.map((r) => [r, `${rankBadgeFr(r).label} [${rankBadgeFr(r).tone}]`])),
  gate: Object.fromEntries(GATES.map((g) => [g, gatePhraseFr({ code: g }) ?? ''])),
  step: Object.fromEntries(STEPS.map((s) => [s, stepActionFr(s)])),
  mode: Object.fromEntries(MODES.map((m) => [m, modeActorFr(m)])),
  advice: Object.fromEntries(ADVICE.map((a) => [a, adviceNatureFr(a)])),
  kind: Object.fromEntries(KINDS.map((k) => [k, kindFr(k)])),
  acceptance: Object.fromEntries(ACCEPTANCES.map((a) => [a, acceptanceFr(a)])),
})

describe('friendly-snapshot — the canonical lexicon both surfaces render from', () => {
  it('pins every enum→French mapping (a wording change is a visible diff here)', () => {
    expect(canonicalLexicon()).toMatchInlineSnapshot(`
      {
        "acceptance": {
          "fail": "recette en échec",
          "n/a": "sans recette",
          "pass": "recette OK",
          "stale": "recette obsolète (à rejouer)",
          "unknown": "recette non évaluée",
          "waived": "recette dérogée",
        },
        "advice": {
          "derivable-next-step": "Action",
          "judgment-required": "Décision",
        },
        "gate": {
          "acceptance-failed": "Vérification en échec",
          "acceptance-stale": "Vérification à refaire",
          "decision-pending": "En attente d’une décision",
          "engagement-pending": "En attente d’un partenaire (h2a)",
          "external-dependency": "Bloqué par une dépendance externe",
          "linked-dependency": "Bloqué par une autre tâche",
          "manual-blocker": "Bloqué manuellement",
          "priority-missing": "Priorité à définir",
          "spec-not-ready": "À spécifier avant de démarrer",
        },
        "kind": {
          "bug": "Correctif",
          "chore": "Tâche",
          "feature": "Fonctionnalité",
        },
        "mode": {
          "h2a-engagement": "Partenaire h2a",
          "human-decision": "Vous (décision)",
          "local": "Local",
          "subagent": "Sous-agent",
        },
        "rank": {
          "P1_GATE": "Prioritaire [critical]",
          "P2_ACCEPTANCE": "À revérifier [warning]",
          "P3_IN_PROGRESS": "En cours [info]",
          "P4_TODO_WSJF": "À planifier [neutral]",
          "P5_FALLBACK": "À examiner [neutral]",
        },
        "step": {
          "amend-spec": "Rédiger la spécification",
          "finish-increment": "Terminer l’incrément en cours",
          "fix-acceptance": "Corriger puis relancer la vérification",
          "focus-decision": "Instruire le dossier puis trancher",
          "inspect-fallback": "Inspecter l’état puis décider la suite",
          "prioritize-backlog": "Prioriser le backlog",
          "rerun-acceptance": "Relancer la vérification sur le commit courant",
          "resolve-external-blocker": "Lever le blocage puis reprendre",
          "resume-engagement": "Relancer le partenaire puis intégrer le retour",
          "settle-decision": "Trancher la décision",
          "start-increment": "Démarrer l’incrément (preuve + vérification)",
        },
      }
    `)
  })
})
