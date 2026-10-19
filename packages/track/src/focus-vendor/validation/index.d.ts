/**
 * `@sentropic/focus/validate` — the typed runtime validator for the
 * `DecisionDossierDocument` (contract §4.2, R4).
 *
 * Two layers, matching the published JSON Schema asset
 * (`schemas/decision-dossier-document.v1.schema.json`,
 * `urn:sentropic:focus:DecisionDossierDocument:1.0.0`):
 *
 *   1. structure — closed shape check (unknown fields, wrong types, bad enums,
 *      an enabled snapshot interaction all refuse);
 *   2. semantics — unique node IDs, interaction targets resolvable to the
 *      dossier ref, a section id/targetRef or a nested option id/targetRef,
 *      an opaque provenance source binding (any string, per the published
 *      schema), and comprehension evidence whose dossier hash still matches
 *      the snapshot hash.
 *
 * Pure and dependency-free: no I/O, no clock, no mutation of the input.
 * Every recorded issue is a refusal — the schema is closed.
 */
export { READABILITY_LIMITS, READABILITY_BUDGETS, validateDecisionDossierReadability } from "./readability.js";
import type { DecisionDossierDocument } from "../model.js";
/** Stable schema ID of the published DecisionDossierDocument asset. */
export declare const DOSSIER_SCHEMA_ID = "urn:sentropic:focus:DecisionDossierDocument:1.0.0";
/** Version of the dossier schema, independent of the package version. */
export declare const DOSSIER_SCHEMA_VERSION = "1.0.0";
/** One machine-checkable validation failure. */
export interface ValidationIssue {
    /** JSON-path-style location, e.g. `$.sections[2].options[0].annotation`. */
    readonly path: string;
    /** Stable machine code (`missing_field`, `duplicate_id`, …). */
    readonly code: string;
    /** Human-readable detail; never echoes secrets (dossiers carry none). */
    readonly message: string;
}
export type ValidationResult<T> = {
    readonly ok: true;
    readonly value: T;
} | {
    readonly ok: false;
    readonly issues: readonly ValidationIssue[];
};
/** Thrown by {@link assertDecisionDossierDocument} on an invalid dossier. */
export declare class DecisionDossierValidationError extends Error {
    readonly issues: readonly ValidationIssue[];
    constructor(issues: readonly ValidationIssue[]);
}
/** Absence means historical v1; unknown explicit versions always refuse. */
export declare const validateDecisionDossierStructure: (value: unknown) => ValidationResult<DecisionDossierDocument>;
/** Semantic layer on a structurally valid dossier. Empty means valid. */
export declare const validateDecisionDossierSemantics: (doc: DecisionDossierDocument) => ValidationIssue[];
/** Full validation: structure first, then semantics. */
export declare const validateDecisionDossierDocument: (value: unknown) => ValidationResult<DecisionDossierDocument>;
/** Parse or throw {@link DecisionDossierValidationError}. */
export declare const assertDecisionDossierDocument: (value: unknown) => DecisionDossierDocument;
/** Presentation requires the backward-compatible structure AND the readability gate. */
export declare const validateDecisionDossierForPresentation: (value: unknown) => ValidationResult<DecisionDossierDocument>;
/** Refuse before any presentation or host rendering hook runs. */
export declare const assertDecisionDossierForPresentation: (value: unknown) => DecisionDossierDocument;
