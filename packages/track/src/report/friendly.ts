// friendly — the SHARED, PURE enum→French LEXICON + per-directive PROJECTION for the track report.
//
// WHY. The track "conductor view" (`directives[]`, the locked machine contract) is rendered as a French,
// jargon-free report in TWO surfaces that used to drift: the terminal renderer (`report/format.ts`) and
// the focus cockpit (`apps/focus/src/lib/track-model.ts`). Each maintained its OWN enum→French mapping and
// its own per-directive row shapes. This module is the SINGLE source of truth for that translation, so the
// two surfaces can never silently re-word apart (spec 2026-07-11-unified-report-presentation-layer).
//
// PURITY CONTRACT (spec §3/§4). This module is a pure subpath (`@sentropic/track/report/friendly`):
//   - NO `fs` / `child_process` / MCP / CLI / ANSI / HTML — it is safe to bundle into an SSR/browser graph.
//   - `import type` ONLY (from `./directive.js`) — every runtime import is erased, so `friendly.js` has zero
//     runtime dependencies.
//   - NO `Date.now()` — any freshness/`now` is a PARAMETER (the terminal is timeless; dated views are the
//     caller's concern). This module takes none today.
//   - It emits SEMANTIC French strings, whitespace-normalized, but NOT format-escaped: each renderer keeps
//     its own escaping (terminal `MD_META`/cell-`|`; cockpit DS/`clean`; html `escapeHtml`) — §6.

import type {
  Directive,
  DirectiveAdviceKind,
  DirectiveGate,
  DirectiveGateCode,
  DirectiveMode,
  DirectiveRank,
  DirectiveStepCode,
} from './directive.js'

// Re-export the machine directive TYPES a consumer (the cockpit) needs, so a single PURE subpath import
// carries both the lexicon/projection functions AND the types they operate on (no barrel value-import,
// which would poison an SSR/browser bundle with track's node-only `cli`/`mcp`/`events`).
export type {
  Directive,
  DirectiveAdviceKind,
  DirectiveGate,
  DirectiveGateCode,
  DirectiveMode,
  DirectiveRank,
  DirectiveStepCode,
  Keystone,
} from './directive.js'

/** The semantic tone key a badge carries; the renderer maps it to its own DS/ANSI variant (§4.4). */
export type FriendlyTone = 'critical' | 'warning' | 'info' | 'neutral' | 'positive'

/**
 * Whitespace-normalize a free-text string (collapse control/space runs to one space, trim). PURE.
 * This is normalization, NOT format-escaping — each renderer still owns its escaping (§6).
 */
export function cleanText(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

// ---- LEXICON — enum → canonical French (one wording, both surfaces) --------------------------------

const RANK_BADGE: Record<DirectiveRank, { label: string; tone: FriendlyTone }> = {
  P1_GATE: { label: 'Prioritaire', tone: 'critical' },
  P2_ACCEPTANCE: { label: 'À revérifier', tone: 'warning' },
  P3_IN_PROGRESS: { label: 'En cours', tone: 'info' },
  P4_TODO_WSJF: { label: 'À planifier', tone: 'neutral' },
  P5_FALLBACK: { label: 'À examiner', tone: 'neutral' },
}

/** A machine `rank` → a friendly human badge (label + semantic tone). Unknown ⇒ neutral "À examiner". */
export function rankBadgeFr(rank: DirectiveRank): { label: string; tone: FriendlyTone } {
  return RANK_BADGE[rank] ?? { label: 'À examiner', tone: 'neutral' }
}

const GATE_PHRASE: Record<DirectiveGateCode, string> = {
  'decision-pending': 'En attente d’une décision',
  'engagement-pending': 'En attente d’un partenaire (h2a)',
  'external-dependency': 'Bloqué par une dépendance externe',
  'linked-dependency': 'Bloqué par une autre tâche',
  'manual-blocker': 'Bloqué manuellement',
  'spec-not-ready': 'À spécifier avant de démarrer',
  'acceptance-failed': 'Vérification en échec',
  'acceptance-stale': 'Vérification à refaire',
  'priority-missing': 'Priorité à définir',
}

/**
 * A machine `gate` → a clear French sentence. When the gate NAMES what blocks it (`blockedByTitle`), that
 * human detail is appended (`… : « <title> »`). Unknown gate code ⇒ "À examiner". Absent gate ⇒ undefined.
 */
export function gatePhraseFr(gate: DirectiveGate | undefined): string | undefined {
  if (!gate) return undefined
  const phrase = GATE_PHRASE[gate.code] ?? 'À examiner'
  if (gate.blockedByTitle && gate.blockedByTitle.trim() !== '') {
    return `${phrase} : « ${cleanText(gate.blockedByTitle)} »`
  }
  return phrase
}

const STEP_ACTION: Record<DirectiveStepCode, string> = {
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
  'inspect-fallback': 'Inspecter l’état puis décider la suite',
}

/**
 * A machine `step.code` → the concrete next action, phrased for a human. An UNKNOWN step.code (a future
 * governed vocabulary entry this build predates) degrades to the `inspect-fallback` phrasing — forward-compat.
 */
export function stepActionFr(step: DirectiveStepCode): string {
  return STEP_ACTION[step] ?? 'Inspecter l’état puis décider la suite'
}

/** A machine `mode` (the ROUTAGE / executor) → who should act, in plain French. */
export function modeActorFr(mode: DirectiveMode): string {
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

/** `adviceKind` → the nature of the item, in one friendly word. */
export function adviceNatureFr(kind: DirectiveAdviceKind): string {
  return kind === 'judgment-required' ? 'Décision' : 'Action'
}

const KIND_FR: Record<string, string> = {
  feature: 'Fonctionnalité',
  bug: 'Correctif',
  chore: 'Tâche',
}

/** A machine item `kind` → a friendly French label (unknown kinds pass through verbatim). */
export function kindFr(k: string): string {
  return KIND_FR[k] ?? k
}

const ACCEPTANCE_FR: Record<string, string> = {
  pass: 'recette OK',
  fail: 'recette en échec',
  stale: 'recette obsolète (à rejouer)',
  waived: 'recette dérogée',
  unknown: 'recette non évaluée',
  'n/a': 'sans recette',
}

/**
 * A machine acceptance/recette state → its FR gloss (the report locale). Canonical wording; kept byte-aligned
 * with `report/build.ts`'s `ACCEPTANCE_FR` (the buckets `detail.acceptanceLabel` source), so the same words
 * describe recette everywhere. Unknown ⇒ passthrough.
 */
export function acceptanceFr(acceptance: string): string {
  return ACCEPTANCE_FR[acceptance] ?? acceptance
}

/** The `scope/gate` label for a directive: its gate code if any, else its WP label, else `-`. */
export function directiveScopeLabelFr(d: Directive): string {
  return d.gate?.code ?? d.scope.wpLabel ?? '-'
}

// ---- PROJECTION — per-directive friendly rows ------------------------------------------------------

const SUBJECT_MAX = 90

/** A short subject: the item title, whitespace-normalized, capped with an ellipsis (never a silent cut). */
export function subjectOf(d: Directive): string {
  const t = cleanText(d.target.title ?? d.target.id)
  return t.length > SUBJECT_MAX ? t.slice(0, 88) + '…' : t
}

/**
 * Is this directive LAUNCHABLE by a sub-agent? Only `subagent`/`local` directives can be dispatched; a
 * `human-decision` needs a human and an `h2a-engagement` needs a peer, so those are shown but not checkable.
 */
export function isLaunchable(d: Directive): boolean {
  return d.mode === 'subagent' || d.mode === 'local'
}

/** One directive as an "À-FAIRE" row (Sujet · Action concrète · Acteur · Nature · Priorité + gate). */
export interface FriendlyTodoRow {
  id: string
  subject: string
  action: string
  actor: string
  nature: string
  badge: { label: string; tone: FriendlyTone }
  gate?: string
  launchable: boolean
  wp?: string
  fanIn?: number
  wsjf?: number
}

export function todoRowFr(d: Directive): FriendlyTodoRow {
  const gate = gatePhraseFr(d.gate)
  return {
    id: d.id,
    subject: subjectOf(d),
    action: stepActionFr(d.step.code),
    actor: modeActorFr(d.mode),
    nature: adviceNatureFr(d.adviceKind),
    badge: rankBadgeFr(d.rank),
    ...(gate !== undefined ? { gate } : {}),
    launchable: isLaunchable(d),
    ...(d.scope.wpLabel !== undefined ? { wp: d.scope.wpLabel } : {}),
    ...(d.facts.fanIn !== undefined ? { fanIn: d.facts.fanIn } : {}),
    ...(d.facts.wsjf !== undefined ? { wsjf: d.facts.wsjf } : {}),
  }
}

/** One directive as a "PRÉCO / levier" row: the concrete move + WHY it is leverage. */
export interface FriendlyPrecoRow {
  id: string
  title: string
  why: string
  action: string
  actor: string
  badge: { label: string; tone: FriendlyTone }
  launchable: boolean
}

export function precoRowFr(d: Directive): FriendlyPrecoRow {
  const gate = gatePhraseFr(d.gate)
  const lever =
    d.facts.fanIn !== undefined && d.facts.fanIn > 0
      ? `Débloque ${d.facts.fanIn} autre(s) tâche(s)`
      : (gate ?? (d.mode === 'human-decision' ? 'Décision en attente' : 'Fait avancer le WP concerné'))
  return {
    id: d.id,
    title: subjectOf(d),
    why: lever,
    action: stepActionFr(d.step.code),
    actor: modeActorFr(d.mode),
    badge: rankBadgeFr(d.rank),
    launchable: isLaunchable(d),
  }
}

/** A workspace id (`ws:89c4…`) → a short, human-glanceable form. PURE. */
function shortWorkspace(ws: string | undefined): string | undefined {
  if (!ws) return undefined
  const body = ws.startsWith('ws:') ? ws.slice(3) : ws
  return body.length > 10 ? `ws:${body.slice(0, 8)}…` : ws
}

/** One human-decision directive as a decision card: the question, what it concerns, the next move. */
export interface FriendlyDecisionRow {
  id: string
  question: string
  concerns: string
  action: string
  actor: string
  /** The project the decision belongs to (so a multi-project focus stays legible). */
  project: string
  workspace?: string
  wp?: string
  /** A one-line French summary of what the decision is about. */
  summary: string
}

export function decisionRowFr(d: Directive, repo: string): FriendlyDecisionRow {
  const concerns = subjectOf(d)
  const wp = d.scope.wpLabel
  const why = gatePhraseFr(d.gate) ?? 'Décision d’orientation à trancher'
  const ws = shortWorkspace(d.target.workspace)
  return {
    id: d.id,
    question: d.gate?.blockedByTitle ? cleanText(d.gate.blockedByTitle) : concerns,
    concerns,
    action: stepActionFr(d.step.code),
    actor: modeActorFr(d.mode),
    project: repo,
    ...(ws !== undefined ? { workspace: ws } : {}),
    ...(wp !== undefined ? { wp } : {}),
    summary: `Concerne « ${concerns} »${wp ? ` · ${wp}` : ''} — ${why}.`,
  }
}
