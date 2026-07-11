// track-model — the FRENCH, jargon-free reading layer over track's machine "conductor view".
//
// The track engine emits DIRECTIVES with a governed but technical vocabulary (rank=P1_GATE,
// adviceKind=derivable-next-step, gate.code=acceptance-stale, mode=subagent, …). This module is the ONLY
// place that vocabulary is translated into plain French for a human reader. Everything downstream
// (the Suivi view, the Focus view) consumes these friendly shapes — no raw enum ever reaches the screen.
//
// It is DS-agnostic on purpose: it returns a semantic `tone` key, and the Svelte layer maps that tone to a
// design-system Badge/Alert variant. Keeping the mapping here (not in a component) means the translation is
// testable and reused identically by every view.

// ---- machine shapes (mirror @sentropic/track's report/directive.ts, kept minimal & structural) ---------

export type DirectiveMode = 'human-decision' | 'h2a-engagement' | 'subagent' | 'local';
export type DirectiveAdviceKind = 'derivable-next-step' | 'judgment-required';
export type DirectiveRank =
  | 'P1_GATE'
  | 'P2_ACCEPTANCE'
  | 'P3_IN_PROGRESS'
  | 'P4_TODO_WSJF'
  | 'P5_FALLBACK';
export type DirectiveGateCode =
  | 'decision-pending'
  | 'engagement-pending'
  | 'external-dependency'
  | 'linked-dependency'
  | 'manual-blocker'
  | 'spec-not-ready'
  | 'acceptance-failed'
  | 'acceptance-stale'
  | 'priority-missing';
export type DirectiveStepCode =
  | 'focus-decision'
  | 'settle-decision'
  | 'resume-engagement'
  | 'resolve-external-blocker'
  | 'amend-spec'
  | 'fix-acceptance'
  | 'rerun-acceptance'
  | 'finish-increment'
  | 'start-increment'
  | 'prioritize-backlog'
  | 'inspect-fallback';

export interface DirectiveGate {
  code: DirectiveGateCode;
  ref?: string;
  blockedBy?: string;
  blockedByTitle?: string;
}
export interface DirectiveFacts {
  bucket: string;
  realization: string;
  acceptance: string;
  wsjf?: number;
  specStatus: string;
  accountable?: string;
  blockerRefs?: string[];
  fanIn?: number;
}
export interface Directive {
  id: string;
  target: { kind: string; id: string; title?: string; workspace?: string };
  scope: { wpId?: string; wpLabel?: string };
  mode: DirectiveMode;
  adviceKind: DirectiveAdviceKind;
  gate?: DirectiveGate;
  step: { code: DirectiveStepCode };
  rank: DirectiveRank;
  facts: DirectiveFacts;
  affordances: string[];
  commandHint?: string;
}
export interface Keystone {
  id: string;
  title: string;
  blocks: number;
}
export interface ConductorView {
  kind: string;
  locale: string;
  generalRecommendation: string;
  directives: Directive[];
  dispatchQueue: string[];
  keystone?: Keystone;
}

export interface BucketRow {
  id: string;
  title: string;
  kind: string;
  workspace: string;
  bucket: string;
  realization: string;
  acceptance: string;
}
export interface Buckets {
  AWAITED: BucketRow[];
  DROPPED: BucketRow[];
  DONE: BucketRow[];
  'TO-DO': BucketRow[];
}

export interface ReportPayload {
  ok: true;
  repo: string;
  baselineCommit: string;
  generatedAt: string;
  buckets: Buckets;
  view: ConductorView;
}
export interface ReportError {
  ok: false;
  error: string;
}

// ---- the FRENCH translation layer ----------------------------------------------------------------------

export type Tone = 'critical' | 'warning' | 'info' | 'neutral' | 'positive';

/** A machine `rank` → a friendly, human badge (label + semantic tone). Zero jargon leaks. */
export function rankBadge(rank: DirectiveRank): { label: string; tone: Tone } {
  switch (rank) {
    case 'P1_GATE':
      return { label: 'Prioritaire', tone: 'critical' };
    case 'P2_ACCEPTANCE':
      return { label: 'À revérifier', tone: 'warning' };
    case 'P3_IN_PROGRESS':
      return { label: 'En cours', tone: 'info' };
    case 'P4_TODO_WSJF':
      return { label: 'À planifier', tone: 'neutral' };
    case 'P5_FALLBACK':
      return { label: 'À examiner', tone: 'neutral' };
    default:
      return { label: 'À examiner', tone: 'neutral' };
  }
}

/** A machine `gate.code` → a clear French sentence a non-technical owner understands. */
export function gatePhrase(gate: DirectiveGate | undefined): string | undefined {
  if (!gate) return undefined;
  const base: Record<DirectiveGateCode, string> = {
    'decision-pending': 'En attente d’une décision',
    'engagement-pending': 'En attente d’un partenaire (h2a)',
    'external-dependency': 'Bloqué par une dépendance externe',
    'linked-dependency': 'Bloqué par une autre tâche',
    'manual-blocker': 'Bloqué manuellement',
    'spec-not-ready': 'À spécifier avant de démarrer',
    'acceptance-failed': 'Vérification en échec',
    'acceptance-stale': 'Vérification à refaire',
    'priority-missing': 'Priorité à définir'
  };
  const phrase = base[gate.code] ?? 'À examiner';
  // When the gate names WHAT blocks it (blockedByTitle), append it — that's the delegable, human detail.
  if (gate.blockedByTitle && gate.blockedByTitle.trim() !== '') {
    return `${phrase} : « ${clean(gate.blockedByTitle)} »`;
  }
  return phrase;
}

/** A machine `step.code` → the concrete next action, phrased for a human ("Action concrète" column). */
export function stepAction(step: DirectiveStepCode): string {
  const base: Record<DirectiveStepCode, string> = {
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
  };
  return base[step] ?? 'Inspecter l’état puis décider la suite';
}

/** A machine `mode` (the ROUTAGE / executor) → who should act, in plain French ("Acteur" column). */
export function modeActor(mode: DirectiveMode): string {
  switch (mode) {
    case 'human-decision':
      return 'Vous (décision)';
    case 'h2a-engagement':
      return 'Partenaire h2a';
    case 'subagent':
      return 'Sous-agent';
    case 'local':
      return 'Local';
    default:
      return 'À affecter';
  }
}

/** `adviceKind` → the nature of the item, in one friendly word. */
export function adviceNature(kind: DirectiveAdviceKind): string {
  return kind === 'judgment-required' ? 'Décision' : 'Action';
}

/**
 * Is this directive LAUNCHABLE by a sub-agent (⇒ it gets a checkbox in the bulk-action view)? Only
 * `subagent`/`local` directives can be dispatched to a sub-agent; `human-decision` needs a human and
 * `h2a-engagement` needs a peer, so those are shown but never checkable.
 */
export function isLaunchable(d: Directive): boolean {
  return d.mode === 'subagent' || d.mode === 'local';
}

/** Strip machine noise from a title for display (control chars, excess whitespace). */
export function clean(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** A short subject: the item title, trimmed to a sane length with an ellipsis (never a silent cut). */
export function subjectOf(d: Directive): string {
  const t = clean(d.target.title ?? d.target.id);
  return t.length > 90 ? t.slice(0, 88) + '…' : t;
}

// ---- derived view rows ---------------------------------------------------------------------------------

export interface TodoRow {
  id: string;
  subject: string;
  action: string;
  actor: string;
  nature: string;
  badge: { label: string; tone: Tone };
  gate?: string;
  launchable: boolean;
  wp?: string;
  fanIn?: number;
  wsjf?: number;
}

/** Every directive as a French "À-FAIRE" row (Sujet · Action concrète · Acteur · Priorité + gate). */
export function todoRows(view: ConductorView): TodoRow[] {
  return view.directives.map((d) => ({
    id: d.id,
    subject: subjectOf(d),
    action: stepAction(d.step.code),
    actor: modeActor(d.mode),
    nature: adviceNature(d.adviceKind),
    badge: rankBadge(d.rank),
    gate: gatePhrase(d.gate),
    launchable: isLaunchable(d),
    wp: d.scope.wpLabel,
    fanIn: d.facts.fanIn,
    wsjf: d.facts.wsjf
  }));
}

export interface PrecoRow {
  id: string;
  title: string;
  why: string;
  action: string;
  actor: string;
  badge: { label: string; tone: Tone };
  launchable: boolean;
}

/**
 * The PRÉCO block: the real highest-leverage moves (NOT "avancer par premier item ouvert"). The directive
 * list is already globally urgency-sorted by the engine; we surface the top moves with a concrete "why"
 * (the gate that makes it leverage) and the concrete action. The keystone (max fan-in) is handled
 * separately by the view when present.
 */
export function precoRows(view: ConductorView, limit = 5): PrecoRow[] {
  return view.directives.slice(0, limit).map((d) => {
    const gate = gatePhrase(d.gate);
    const lever =
      d.facts.fanIn && d.facts.fanIn > 0
        ? `Débloque ${d.facts.fanIn} autre(s) tâche(s)`
        : gate ?? (d.mode === 'human-decision' ? 'Décision en attente' : 'Fait avancer le WP concerné');
    return {
      id: d.id,
      title: subjectOf(d),
      why: lever,
      action: stepAction(d.step.code),
      actor: modeActor(d.mode),
      badge: rankBadge(d.rank),
      launchable: isLaunchable(d)
    };
  });
}

/** A machine item `kind` → a friendly French label. */
export function kindFr(k: string): string {
  return { feature: 'Fonctionnalité', bug: 'Correctif', chore: 'Tâche' }[k] ?? k;
}

export interface DecisionCard {
  id: string;
  question: string;
  concerns: string;
  action: string;
  actor: string;
  /** The project the decision belongs to (repo + workspace) so a multi-project focus stays legible. */
  project: string;
  workspace?: string;
  wp?: string;
  /** A one-line French summary of what the decision is about. */
  summary: string;
}

/** A workspace id (`ws:89c4…`) → a short, human-glanceable form. */
function shortWorkspace(ws?: string): string | undefined {
  if (!ws) return undefined;
  const body = ws.startsWith('ws:') ? ws.slice(3) : ws;
  return body.length > 10 ? `ws:${body.slice(0, 8)}…` : ws;
}

/** The decision cards: the genuine owner decisions, with the project they concern + a short summary. */
export function decisionCards(view: ConductorView, repo: string): DecisionCard[] {
  return view.directives
    .filter((d) => d.mode === 'human-decision')
    .map((d) => {
      const concerns = subjectOf(d);
      const wp = d.scope.wpLabel;
      const why = gatePhrase(d.gate) ?? 'Décision d’orientation à trancher';
      return {
        id: d.id,
        question: d.gate?.blockedByTitle ? clean(d.gate.blockedByTitle) : concerns,
        concerns,
        action: stepAction(d.step.code),
        actor: modeActor(d.mode),
        project: repo,
        workspace: shortWorkspace(d.target.workspace),
        wp,
        summary: `Concerne « ${concerns} »${wp ? ` · ${wp}` : ''} — ${why}.`
      };
    });
}

export interface DoneItem {
  id: string;
  title: string;
  kind: string;
}

/** The FAIT list: delivered items, French-labelled and length-clamped. */
export function doneList(buckets: Buckets): DoneItem[] {
  return buckets.DONE.map((d) => {
    const t = clean(d.title);
    return { id: d.id, title: t.length > 100 ? t.slice(0, 98) + '…' : t, kind: kindFr(d.kind) };
  });
}

export interface KeystoneView {
  title: string;
  blocks: number;
}

/**
 * The FULLY-FRIENDLY client payload — computed on the SERVER so NO raw machine enum (P1_GATE, adviceKind,
 * acceptance-stale, human-decision, …) ever ships to the browser. The client renders these shapes verbatim.
 */
export interface FocusData {
  ok: true;
  repo: string;
  baselineCommit: string;
  generatedAt: string;
  counts: { done: number; todo: number; decisions: number };
  todos: TodoRow[];
  precos: PrecoRow[];
  decisions: DecisionCard[];
  done: DoneItem[];
  keystone?: KeystoneView;
}
export type FocusResult = FocusData | { ok: false; error: string };

export function buildFocusData(payload: ReportPayload | ReportError): FocusResult {
  if (!payload.ok) return { ok: false, error: payload.error };
  const v = payload.view;
  const todo = payload.buckets['TO-DO'].length + payload.buckets.AWAITED.length;
  return {
    ok: true,
    repo: payload.repo,
    baselineCommit: payload.baselineCommit,
    generatedAt: payload.generatedAt,
    counts: {
      done: payload.buckets.DONE.length,
      todo,
      decisions: v.directives.filter((d) => d.mode === 'human-decision').length
    },
    todos: todoRows(v),
    precos: precoRows(v, 5),
    decisions: decisionCards(v, payload.repo),
    done: doneList(payload.buckets),
    ...(v.keystone ? { keystone: { title: clean(v.keystone.title), blocks: v.keystone.blocks } } : {})
  };
}
