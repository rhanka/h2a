/**
 * Focus document model — the CONCRETE decision-dossier specialization (Focus-M1 L1).
 *
 * Per SPEC_VOL_FOCUS §3: a Focus is a renderable + interactive document over track data.
 * This file models the `DecisionDossierDocument` — the FIRST focus TYPE (a FocusDocument
 * whose primary outcome modality is a decision). It is intentionally CONCRETE, not a generic
 * "Focus platform": the model stays decision-dossier-shaped until a 2nd modality is real.
 *
 * This is the read-only FocusSnapshot split: affordances render as DISABLED metadata only
 * (no live commands). Live drivers (FocusLiveSession) are deferred (L3+).
 */

/**
 * A stable reference to the source entity this document projects (e.g. a track decision id).
 * Opaque at L1 (fixture-driven); L2 binds it to the real track `DecisionDossierView`.
 */
export type FocusRef = string;

/**
 * A stable reference to a rendered element — every rendered node is an interaction target.
 * At L1 these are inert (affordances are disabled metadata); they exist so L3+ live drivers
 * can route commands without re-deriving identity.
 */
export type TargetRef = string;

/** Outcome modalities. The decision-dossier's primary modality is `decision`. */
export type OutcomeModality = "decision" | "orientation" | "amendment" | "comment";

/** Diagram syntaxes. Diagrams render as a FENCED fallback only at L1 (no diagram adapter). */
export type DiagramSyntax = "mermaid" | "plantuml";

/** Q/R validation state for a `question` node (recommendation = préco). */
export type QuestionValidationState = "open" | "answered" | "validated";

/** Annotation state for an `option` node (Claude-style accept/reject/comment). */
export type OptionAnnotationState = "none" | "accept" | "reject" | "comment";

/** Base fields shared by every rendered node: a stable id + an interaction target ref. */
interface FocusNodeBase {
  readonly id: string;
  readonly targetRef: TargetRef;
}

/** Markdown prose body. The renderer injects the markdown→string conversion (host hook). */
export interface ProseNode extends FocusNodeBase {
  readonly kind: "prose";
  readonly markdown: string;
  /** Explicit question covered by any choice discussed in this prose. */
  readonly questionId?: string;
}

/** A question with a recommended answer (préco) and a validation state. */
export interface QuestionNode extends FocusNodeBase {
  readonly kind: "question";
  readonly question: string;
  /** The recommended answer (préco). Optional — a question may be open with no préco yet. */
  readonly recommendedAnswer?: string;
  /** Recommended option among those linked to this question; reason in recommendedAnswer. */
  readonly recommendedOptionId?: string;
  /** The actual answer, when answered. */
  readonly answer?: string;
  readonly state: QuestionValidationState;
  /**
   * Readability: the decision context in plain words (what the owner needs to
   * know to answer in ~2 minutes). Optional at schema level; the readability
   * gate requires it before presentation.
   */
  readonly context?: string;
  /**
   * Readability: estimated reading time for this question (minutes, ≤ 2).
   * Optional at schema level; the readability gate requires it.
   */
  readonly readingTimeMinutes?: number;
}

/** A single option/proposal/alternative with a Claude-style annotation state. */
export interface OptionNode extends FocusNodeBase {
  readonly kind: "option";
  readonly label: string;
  readonly body?: string;
  readonly annotation: OptionAnnotationState;
  /** Optional free-text comment carried with a `comment` annotation. */
  readonly annotationComment?: string;
  /**
   * Readability: the one-line consequence of this option for the owner.
   * Optional at schema level; the readability gate requires it.
   */
  readonly consequence?: string;
}

/** A set of mutually-related options/proposals. */
export interface OptionSetNode extends FocusNodeBase {
  readonly kind: "optionSet";
  readonly title?: string;
  readonly options: readonly OptionNode[];
  /**
   * Readability: the id of the explicit question these options answer.
   * Optional at schema level; the readability gate requires it so no choice
   * is ever implied without an explicit question (no hidden decision).
   */
  readonly questionId?: string;
}

/** The modality-tagged outcome of the focus. */
export interface OutcomeNode extends FocusNodeBase {
  readonly kind: "outcome";
  readonly modality: OutcomeModality;
  readonly statement: string;
  /** The explicit question this decision, orientation or amendment resolves. */
  readonly questionId?: string;
}

/** One ordered step of the amendment trace. */
export interface AmendmentStep {
  readonly at: string;
  readonly author: string;
  readonly summary: string;
}

/** The ordered amendment trace, rendered as a section. */
export interface AmendmentTraceNode extends FocusNodeBase {
  readonly kind: "amendmentTrace";
  readonly steps: readonly AmendmentStep[];
}

/** A diagram. At L1 this renders as a fenced fallback only (no diagram adapter). */
export interface DiagramNode extends FocusNodeBase {
  readonly kind: "diagram";
  readonly syntax: DiagramSyntax;
  readonly source: string;
  readonly alt: string;
  /** diagram-core SemanticDocument, generic@1, without views/geometry/layout hints.
   * Kept as plain JSON until the private DS package publishes its schema. */
  readonly scene?: Readonly<Record<string, unknown>>;
}

/** The node families needed to render a decision-dossier. */
export type FocusNode =
  | ProseNode
  | QuestionNode
  | OptionSetNode
  | OutcomeNode
  | AmendmentTraceNode
  | DiagramNode;

/**
 * An affordance = a potential interaction surfaced on the snapshot. At L1 these are DISABLED
 * metadata only (read-only FocusSnapshot): no live command is submitted. L3+ FocusLiveSession
 * maps an affordance name → a track WorkEventKind. Never invent kinds.
 */
export interface Affordance {
  readonly name: string;
  /**
   * The target this affordance would act on. Resolves to the dossier `ref`
   * (whole-dossier amend), a section `id`/`targetRef`, or a nested option
   * `id`/`targetRef` — the same resolution scope the validator enforces.
   */
  readonly targetRef: TargetRef;
  /** Human-readable label for the disabled-affordance metadata. */
  readonly label: string;
  /**
   * Always `false` at L1 — the snapshot is read-only. Kept explicit so renderers print the
   * disabled state and L3+ can flip it for live sessions.
   */
  readonly enabled: false;
}

/**
 * Comprehension evidence carried VERBATIM from the dossier artifacts (subject/dossierHash/sig
 * intact, NOT re-derived lineage — the confused-deputy fix). At L1 it is opaque provenance.
 */
export interface ComprehensionEvidence {
  readonly subject: string;
  readonly dossierHash: string;
  readonly signature?: string;
}

/** Provenance of the projection (where the data came from + when it was read). */
export interface FocusProvenance {
  readonly source: string;
  readonly readAt: string;
  readonly comprehensionEvidence?: ComprehensionEvidence;
}

/** One glossary entry: an opaque code mapped to plain words for the reader. */
export interface GlossaryEntry {
  readonly term: string;
  readonly definition: string;
}

/**
 * Dossier-level readability statement: owner traceability, plain-words stakes,
 * the reading budget the per-question times must fit, and the glossary that
 * defines every code shown to the reader. Entirely optional at schema level
 * (backward compatible); the readability gate requires it before presentation.
 */
export interface DossierReadability {
  /**
   * The owner's literal request this dossier serves, quoted verbatim
   * (traceability). Exactly one of `ownerRequestQuote` / `noOwnerRequest`.
   */
  readonly ownerRequestQuote?: string;
  /**
   * Explicit flag: no owner request backs this dossier. Blocks presentation
   * until a request is quoted — never present a dossier carrying it.
   */
  readonly noOwnerRequest?: boolean;
  /** Why this matters to the owner, in plain words (not internal jargon). */
  readonly stakes?: string;
  /** Declared impact: low (reversible), medium (cost/disruption), high (lasting impact). */
  readonly stakesLevel?: "low" | "medium" | "high";
  /** Total reading budget in minutes (≤ 30), proportionate to the stakes. */
  readonly readingBudgetMinutes?: number;
  /** Every code shown to the reader, defined in plain words. */
  readonly glossary?: readonly GlossaryEntry[];
}

/**
 * The CONCRETE decision-dossier document — a FocusDocument whose primary outcome modality is a
 * decision. Maps to track `DecisionDossierView{outcome,dossier,comprehensionEvidence}` +
 * `amendmentTrace` (wired for real at L2).
 */
export interface DecisionDossierDocument {
  readonly ref: FocusRef;
  readonly subject: string;
  readonly title: string;
  /** OCC base hash for the snapshot — used by L3+ reconcile; inert metadata at L1. */
  readonly hash: string;
  /** Read cursor / version marker from the source. */
  readonly cursor: string;
  readonly sections: readonly FocusNode[];
  /** Disabled-affordance metadata (read-only snapshot). */
  readonly interactions: readonly Affordance[];
  readonly provenance: FocusProvenance;
  readonly amendmentTrace: readonly AmendmentStep[];
  /**
   * Readability statement. Optional at schema level (backward compatible);
   * the readability gate (`@sentropic/focus/validate`) requires it and
   * refuses presentation without it.
   */
  readonly readability?: DossierReadability;
}
