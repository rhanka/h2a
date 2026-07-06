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
export {};
