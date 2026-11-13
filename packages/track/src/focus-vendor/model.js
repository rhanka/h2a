/**
 * Focus document model — the CONCRETE decision-dossier specialization (Focus-M1 L1).
 *
 * Per SPEC_VOL_FOCUS §3: a Focus is a renderable + interactive document over track data.
 * This file models the `DecisionDossierDocument` — the FIRST focus TYPE (a FocusDocument
 * whose primary outcome modality is a decision). ReportDocument reuses the evidence envelope
 * for explicitly informational reports, without decision nodes or interactions.
 *
 * This is the read-only FocusSnapshot split: affordances render as DISABLED metadata only
 * (no live commands). Live drivers (FocusLiveSession) are deferred (L3+).
 */
export const isReportDocument = (doc) => 'kind' in doc && doc.kind === 'report';
export const isEvidenceDossier = (doc) => 'schemaVersion' in doc && doc.schemaVersion === 2;
