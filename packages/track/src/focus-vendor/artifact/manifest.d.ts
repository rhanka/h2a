import type { FocusDocument } from "../model.js";
import type { ValidationResult } from "../validation/index.js";
export declare const FOCUS_ARTIFACT_TYPE: "focus-dossier";
export declare const FOCUS_DOSSIER_CONTRACT: "focus-dossier/1";
export declare const FOCUS_VIEWS_CONTRACT: "focus-views/1";
export declare const FOCUS_TEMPLATE_ID: "focus-dossier";
export declare const FOCUS_DOCUMENT_PATH: "dossier.json";
export declare const FOCUS_MANIFEST_PATH: "focus.manifest.json";
export declare const FOCUS_VIEWS_PATH: "views.json";
export declare const FOCUS_BINDING_NAME_PREFIX: "focus:";
export declare const FOCUS_MAX_DOCUMENT_BYTES: 1048576;
export declare const FOCUS_MAX_ANCHOR_LENGTH: 128;
export declare const FOCUS_DEFAULT_MAX_BINDING_NAME_LENGTH: 128;
declare const ANCHOR_FAMILIES: readonly ["section", "option", "source", "citation", "evidenceGroup", "annex"];
export type FocusAnchorFamily = (typeof ANCHOR_FAMILIES)[number];
export interface FocusAnchorEntry {
    readonly id: string;
    readonly family: FocusAnchorFamily;
    readonly kind: string;
}
export interface FocusAnchorWithPath extends FocusAnchorEntry {
    readonly path: string;
}
export interface FocusManifestDocument {
    readonly path: typeof FOCUS_DOCUMENT_PATH;
    readonly schemaId: string;
    readonly digest: string;
    readonly bytes: number;
    readonly type: "decision" | "report";
}
export interface FocusManifestFileEntry {
    readonly path: string;
    readonly digest: string;
    readonly bytes: number;
}
export interface FocusManifestRenderer {
    readonly name: string;
    readonly version: string;
    readonly entry: string;
    readonly digest: string;
    readonly files: readonly FocusManifestFileEntry[];
    readonly capabilities: readonly string[];
}
export interface FocusManifestValidator {
    readonly name: string;
    readonly version: string;
    readonly digest: string;
}
export interface FocusManifestRevision {
    readonly seq: number;
    readonly parentDigest: string | null;
    readonly createdAt: string;
}
/** Derived companion file listed in focus.manifest.json (empty when no derived file is emitted). */
export interface FocusDerivedFileEntry {
    readonly path: string;
    readonly digest: string;
    readonly bytes: number;
    readonly mimeType: string;
}
export interface FocusManifestGenerator {
    readonly name: string;
    readonly version: string;
}
/** Contract focus-dossier/1 (SPEC-r3 §2.4 & Annexe A). */
export interface FocusArtifactManifest {
    readonly artifactType: typeof FOCUS_ARTIFACT_TYPE;
    readonly contract: typeof FOCUS_DOSSIER_CONTRACT;
    readonly templateId: typeof FOCUS_TEMPLATE_ID;
    readonly document: FocusManifestDocument;
    readonly renderer: FocusManifestRenderer;
    readonly validator: FocusManifestValidator;
    readonly revision: FocusManifestRevision;
    readonly anchors: readonly FocusAnchorEntry[];
    readonly derived: readonly FocusDerivedFileEntry[];
    readonly retiredRefs: readonly string[];
    readonly generator: FocusManifestGenerator;
}
export interface FocusDiagramDerivedEntry {
    readonly scene: Readonly<Record<string, unknown>>;
    readonly views: Readonly<Record<string, unknown>>;
}
/** Contract focus-views/1 (SPEC-r3 §2.4.1): canonical, no timestamp. */
export interface FocusViewsDocument {
    readonly contract: typeof FOCUS_VIEWS_CONTRACT;
    readonly documentDigest: string;
    readonly rendererDigest: string;
    readonly diagrams: Readonly<Record<string, FocusDiagramDerivedEntry>>;
}
export interface BuildFocusArtifactManifestInput {
    readonly document: FocusDocument;
    readonly renderer: FocusManifestRenderer;
    readonly validator: FocusManifestValidator;
    readonly generator: FocusManifestGenerator;
    readonly derived?: readonly FocusDerivedFileEntry[];
    readonly previousManifest?: FocusArtifactManifest;
    readonly createdAt: string;
}
export interface BuildFocusViewsDocumentInput {
    readonly documentDigest: string;
    readonly rendererDigest: string;
    readonly diagrams: Readonly<Record<string, FocusDiagramDerivedEntry>>;
}
/** RFC 8785 canonical JSON string without trailing newline. */
export declare const canonicalJsonString: (value: unknown) => string;
/** UTF-8 bytes of RFC 8785 canonical JSON without trailing newline. */
export declare const canonicalJsonBytes: (value: unknown) => Uint8Array;
export declare const canonicalByteLength: (value: unknown) => number;
/** SHA-256 digest of raw bytes, prefixed with `sha256:`. Pure JS (Node & browser identical). */
export declare const digestBytes: (bytes: Uint8Array) => string;
/** Canonical document digest (`sha256:<hex>`), computed before any section enrichment. */
export declare const documentDigest: (doc: FocusDocument) => string;
/**
 * Canonical SHA-256 digest of the DS static kit manifest (SPEC-r3 §2.4.1):
 * RFC 8785 bytes without trailing newline, prefixed `sha256:`.
 */
export declare const rendererManifestDigest: (staticManifest: Readonly<Record<string, unknown>>) => string;
export declare const bindingNameForDocumentRef: (ref: string) => string;
export declare const resolveDocumentSchemaId: (doc: FocusDocument) => string;
/** Safe relative bundle path: no leading slash, no traversal, no backslash, no drive letter. */
export declare function isSafeBundleRelativePath(path: string): boolean;
/** Extract every anchorable entity definition with its exact JSON path (SPEC-r3 §2.7 R1). */
export declare function extractDocumentAnchorsWithPaths(doc: FocusDocument): FocusAnchorWithPath[];
/** Deterministic anchor table (`id`, `family`, `kind`) for `focus.manifest.json`. */
export declare function extractDocumentAnchors(doc: FocusDocument): FocusAnchorEntry[];
/**
 * Compute next revision metadata and cumulative retiredRefs (SPEC-r3 Annexe A & FA-H1 step 3):
 * - First revision: seq = 1, parentDigest = null, retiredRefs = []
 * - Same document (e.g., kit upgrade): seq, parentDigest and retiredRefs preserved
 * - Changed document: seq = prev.seq + 1, parentDigest = prev.document.digest, retiredRefs accumulated
 */
export declare function computeNextRevisionAndRetiredRefs(currentDigest: string, currentAnchors: readonly FocusAnchorEntry[], previousManifest?: FocusArtifactManifest): {
    readonly seq: number;
    readonly parentDigest: string | null;
    readonly retiredRefs: readonly string[];
};
export declare function buildDerivedFileEntry(path: string, value: unknown, mimeType: string): FocusDerivedFileEntry;
export declare function buildFocusViewsDocument(input: BuildFocusViewsDocumentInput): FocusViewsDocument;
export declare function buildFocusArtifactManifest(input: BuildFocusArtifactManifestInput): FocusArtifactManifest;
/** Closed validation for focus-views/1 companion JSON (SPEC-r3 §2.4.1). */
export declare function validateFocusViewsDocument(value: unknown, expected?: {
    readonly documentDigest?: string;
    readonly rendererDigest?: string;
}): ValidationResult<FocusViewsDocument>;
/** Closed validation for focus-dossier/1 manifest (SPEC-r3 Annexe A). */
export declare function validateFocusArtifactManifest(value: unknown): ValidationResult<FocusArtifactManifest>;
export {};
