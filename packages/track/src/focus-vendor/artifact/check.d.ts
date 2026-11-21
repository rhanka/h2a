import type { FocusDocument } from "../model.js";
import type { ReadabilityOptions, ValidationIssue } from "../validation/index.js";
import type { FocusAnchorEntry } from "./manifest.js";
export interface FocusArtifactCheckOptions {
    /** Optional previous focus.manifest.json: activates revision rules R3 and R4. */
    readonly previousManifest?: unknown;
    /** Maximum canonical UTF-8 byte length of dossier.json (defaults to 1 048 576; null disables). */
    readonly maxDocumentBytes?: number | null;
    /** Maximum UTF-16 length of `focus:<doc.ref>` bindingName (defaults to 128, radar profile). */
    readonly maxBindingNameLength?: number;
    /** Skip readability gate when caller checks structural/artifact identity only (defaults to false). */
    readonly skipReadability?: boolean;
    /** Optional readability profile forwarded to validateDecisionDossierReadability. */
    readonly readabilityOptions?: ReadabilityOptions;
}
export interface FocusArtifactCheckOk {
    readonly ok: true;
    readonly document: FocusDocument;
    readonly documentType: "decision" | "report";
    readonly schemaId: string;
    readonly bindingName: string;
    readonly documentDigest: string;
    readonly bytes: number;
    readonly canonicalJson: string;
    readonly anchors: readonly FocusAnchorEntry[];
    readonly retiredRefs: readonly string[];
    readonly revisionSeq: number;
}
export interface FocusArtifactCheckRefused {
    readonly ok: false;
    readonly issues: readonly ValidationIssue[];
}
export type FocusArtifactCheckResult = FocusArtifactCheckOk | FocusArtifactCheckRefused;
/** R5: non-empty, <= 128 characters, no whitespace and no control characters. */
export declare function isAnchorableId(value: string): boolean;
/**
 * Common Focus artifact gate (FA-H1 / SPEC-r3 §2.4 & §2.7).
 *
 * Always checks:
 * - Closed schema + semantic rules including R2 (`duplicate_id`) across all v1/v2 families
 * - Presentation readability gate (unless `skipReadability: true`)
 * - R5 (`focus-anchor-not-anchorable`) on `doc.ref` (header anchor) and every entity `id`
 * - R6 (`focus-anchor-equals-document-ref`) on every entity `id`
 * - `focus:<doc.ref>` bindingName profile ceiling (default 128)
 * - Canonical `dossier.json` UTF-8 size ceiling (default 1 048 576 bytes)
 *
 * When `previousManifest` is provided, also checks:
 * - R3 (`focus-anchor-kind-changed`) on every retained `id`
 * - R4 (`focus-anchor-reused`) against cumulative `previousManifest.retiredRefs`
 */
export declare function checkFocusArtifact(input: unknown, options?: FocusArtifactCheckOptions): FocusArtifactCheckResult;
/** Assert the common artifact gate or throw DecisionDossierValidationError with all structured issues. */
export declare function assertFocusArtifact(input: unknown, options?: FocusArtifactCheckOptions): FocusArtifactCheckOk;
