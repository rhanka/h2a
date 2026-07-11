// track-model — the cockpit's reading layer over track's machine "conductor view".
//
// The enum→French LEXICON (rank/gate/step/mode/adviceKind/kind badges + phrases) and the per-directive
// PROJECTION (todo/preco/decision rows) are NO LONGER defined here: they live in the SHARED, pure track
// subpath `@sentropic/track/report/friendly`, so this cockpit and the terminal renderer can never re-word
// apart (spec 2026-07-11-unified-report-presentation-layer). This module now:
//   • statically imports that pure subpath and BUILDS the friendly rows server-side (buildFocusData),
//   • re-exports the shared lexicon under the cockpit's historical names (the /api endpoints + the Svelte
//     view keep importing `subjectOf`/`stepAction`/`modeActor`/`isLaunchable`/… from `$lib/track-model`),
//   • keeps the DS-only / cockpit-specific bits it always owned: the tone→variant mapping (in the Svelte
//     layer), the `harmonize` hook, and the DATED FAIT list (`doneList`/`frenchAgo`/dates).
//
// The subpath is PURE (transitively imports only `directive.ts` TYPES): safe in the SSR graph, and — since
// the Svelte client only `import type`s from here — never shipped to the browser.

import {
  cleanText,
  rankBadgeFr,
  gatePhraseFr,
  stepActionFr,
  modeActorFr,
  adviceNatureFr,
  kindFr,
  subjectOf,
  isLaunchable,
  todoRowFr,
  precoRowFr,
  decisionRowFr
} from '@sentropic/track/report/friendly';
import type {
  Directive,
  Keystone,
  FriendlyTone,
  FriendlyTodoRow,
  FriendlyPrecoRow,
  FriendlyDecisionRow
} from '@sentropic/track/report/friendly';

// Historical cockpit names kept for existing consumers (the /api/actions/launch + /api/decisions/inject
// endpoints, the Svelte view). Each is a thin re-export of the single shared implementation — no second copy.
export {
  cleanText as clean,
  rankBadgeFr as rankBadge,
  gatePhraseFr as gatePhrase,
  stepActionFr as stepAction,
  modeActorFr as modeActor,
  adviceNatureFr as adviceNature,
  kindFr,
  subjectOf,
  isLaunchable
};

// The friendly ROW shapes are the cockpit's public row types, under their historical names.
export type Tone = FriendlyTone;
export type TodoRow = FriendlyTodoRow;
export type PrecoRow = FriendlyPrecoRow;
export type DecisionCard = FriendlyDecisionRow;

// ---- machine data-boundary shapes (the `ReportPayload` report-view.ts parses; `tables` discarded) -------

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
  /** nearest owning WP container (byte-identical to the directive scope) — added by track report/build. */
  wpId?: string;
  wpLabel?: string;
  /** per-row detail block — one-line summary + a French acceptance label. */
  detail?: { summary?: string; acceptanceLabel?: string };
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
  /** itemId → ISO date it was last marked done (for the "réalisé le" / recency of the FAIT list). */
  dates: Record<string, string>;
  /** ISO date of the last release commit — anchors the "dernière période de dev" filter. */
  lastReleaseAt?: string;
}
export interface ReportError {
  ok: false;
  error: string;
}

// ---- cockpit-specific FAIT list (DATED — different granularity + inputs than the terminal's FAIT) -------

export interface DoneItem {
  id: string;
  title: string;
  kind: string;
  doneAt?: string;
  /** A short French relative date ("aujourd'hui", "il y a 3 j", "il y a 2 ans"). */
  ago?: string;
  /** The owning workpackage label ("WP2.1") — for the WP filter and a glanceable column. */
  wp?: string;
  /** French acceptance label ("recette OK", "recette non évaluée", …) — the verification outcome. */
  acceptance?: string;
  /** A one-line detail/summary of what was delivered (translated at render). */
  summary?: string;
}

/**
 * ISO date → a short French relative-time string, at day/month/year granularity (never a raw timestamp).
 * Cockpit-specific (the terminal FAIT is timeless): `now` stays a parameter, defaulted here at the edge.
 */
export function frenchAgo(iso: string | undefined, now: number = Date.now()): string | undefined {
  if (!iso) return undefined;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return undefined;
  const days = Math.floor((now - t) / 86_400_000);
  if (days <= 0) return "aujourd'hui";
  if (days === 1) return 'hier';
  if (days < 7) return `il y a ${days} j`;
  if (days < 31) return `il y a ${Math.floor(days / 7)} sem.`;
  if (days < 365) return `il y a ${Math.floor(days / 30)} mois`;
  const years = Math.floor(days / 365);
  return `il y a ${years} an${years > 1 ? 's' : ''}`;
}

/**
 * The FAIT list: delivered items, French-labelled, length-clamped, DATED, and ordered MOST-RECENT FIRST so
 * the report reads as "what was done lately" (dated items float to the top; undated ones fall to the bottom).
 * Capped to keep the fold light — the full history stays in track.
 */
export function doneList(buckets: Buckets, dates: Record<string, string>, limit = 30): DoneItem[] {
  return buckets.DONE.map((d) => {
    const t = cleanText(d.title);
    const doneAt = dates[d.id];
    return {
      id: d.id,
      title: t.length > 100 ? t.slice(0, 98) + '…' : t,
      kind: kindFr(d.kind),
      ...(d.wpLabel ? { wp: d.wpLabel } : {}),
      ...(d.detail?.acceptanceLabel ? { acceptance: d.detail.acceptanceLabel } : {}),
      ...(d.detail?.summary && cleanText(d.detail.summary) !== cleanText(d.title)
        ? { summary: cleanText(d.detail.summary) }
        : {}),
      ...(doneAt ? { doneAt, ago: frenchAgo(doneAt) } : {})
    };
  })
    .sort((a, b) => (b.doneAt ?? '').localeCompare(a.doneAt ?? ''))
    .slice(0, limit);
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
  /** ISO date of the last release — powers the "depuis dev" period option in the UI. */
  lastReleaseAt?: string;
}
export type FocusResult = FocusData | { ok: false; error: string };

export function buildFocusData(payload: ReportPayload | ReportError): FocusResult {
  if (!payload.ok) return { ok: false, error: payload.error };
  const v = payload.view;
  const todo = payload.buckets['TO-DO'].length + payload.buckets.AWAITED.length;
  const humanDecisions = v.directives.filter((d) => d.mode === 'human-decision');
  return {
    ok: true,
    repo: payload.repo,
    baselineCommit: payload.baselineCommit,
    generatedAt: payload.generatedAt,
    counts: {
      done: payload.buckets.DONE.length,
      todo,
      decisions: humanDecisions.length
    },
    // The friendly rows are built HERE, server-side, from the shared projection (one source of truth).
    todos: v.directives.map(todoRowFr),
    precos: v.directives.slice(0, 5).map(precoRowFr),
    decisions: humanDecisions.map((d) => decisionRowFr(d, payload.repo)),
    done: doneList(payload.buckets, payload.dates),
    ...(payload.lastReleaseAt ? { lastReleaseAt: payload.lastReleaseAt } : {}),
    ...(v.keystone ? { keystone: { title: cleanText(v.keystone.title), blocks: v.keystone.blocks } } : {})
  };
}
