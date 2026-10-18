/**
 * `@sentropic/focus/registry/definitions` — the publisher-owned definition
 * surface for the `sentropic.focus` skill entry (contract §§3–4, R4).
 *
 * This module is SIDE-EFFECT-FREE: importing it reads no file, opens no
 * handle and touches no network. The JSON manifest is read only when
 * {@link loadFocusSkillDescriptor} is called; instruction text is read only
 * through the caller-supplied loader in {@link resolveFocusPresentation},
 * and only AFTER the presentation preflight succeeds — so an unavailable
 * presentation refuses with `unsupported_presentation` with zero instruction
 * loads.
 */
/** Canonical registry ID of the Focus skill. */
export declare const FOCUS_SKILL_ID = "sentropic.focus";
/** Public entry version of the first Focus registry release. */
export declare const FOCUS_ENTRY_VERSION = "2.0.0";
/** Entry-contract version this descriptor conforms to. */
export declare const FOCUS_CONTRACT_VERSION = "1.1.4";
/** Parameter-schema version of the Focus entry (contract §5.4). */
export declare const FOCUS_PARAMETERS_SCHEMA_VERSION = "1.0.0";
/** Existing skill-description limit enforced by the contract. */
export declare const MAX_SKILL_DESCRIPTION_LENGTH = 280;
export type FocusPresentation = "terminal" | "markdown" | "html" | "mcp-app";
export type FocusLocale = "en" | "fr";
export interface FocusParameters {
    readonly mode: "snapshot";
    readonly preferredPresentation: FocusPresentation;
    readonly locale: FocusLocale;
}
/** Exact §5.4 defaults, applied once before validation. */
export declare const FOCUS_PARAMETER_DEFAULTS: FocusParameters;
export interface DefinitionIssue {
    readonly path: string;
    readonly code: string;
    readonly message: string;
}
export type DefinitionResult<T> = {
    readonly ok: true;
    readonly value: T;
} | {
    readonly ok: false;
    readonly issues: readonly DefinitionIssue[];
};
export interface FocusAsset {
    readonly role: string;
    readonly path: string;
    readonly mediaType: string;
    readonly sha256: string;
}
export interface FocusDocumentSchemaRef {
    readonly name: string;
    readonly schemaId: string;
    readonly version: string;
    readonly assetPath: string;
    readonly sha256: string;
}
export interface FocusSkillPayload {
    readonly profile: "instructions";
    readonly metadata: {
        readonly category: string;
        readonly contextFilters: readonly string[];
        readonly permissions: readonly string[];
        readonly toolNames: readonly string[];
    };
    readonly instructionsAsset: string;
    readonly capabilities: ReadonlyArray<{
        readonly id: string;
        readonly description: string;
        readonly effect: "read-only" | "mutation";
        readonly permissions: readonly string[];
        readonly inputSchemaRef?: string;
        readonly outputSchemaRef?: string;
    }>;
    readonly tools: readonly unknown[];
    readonly documentSchemas: readonly FocusDocumentSchemaRef[];
    readonly dependencies: readonly unknown[];
}
export interface FocusEntryDescriptor {
    readonly format: "sentropic.registry-entry/v1";
    readonly contractVersion: string;
    readonly kind: "skill";
    readonly id: string;
    readonly name: string;
    readonly description: string;
    readonly entryVersion: string;
    readonly publisher: {
        readonly packageName: string;
        readonly packageVersion: string;
    };
    readonly compatibility: {
        readonly entryContract: string;
        readonly packages: ReadonlyArray<{
            readonly name: string;
            readonly range: string;
        }>;
        readonly schemaProfiles: readonly string[];
        readonly requiredHostFeatures: readonly string[];
        readonly optionalHostFeatures: readonly string[];
    };
    readonly parameters: {
        readonly schemaVersion: string;
        readonly schema: Record<string, unknown>;
        readonly defaults: Record<string, unknown>;
    };
    readonly bindings: readonly unknown[];
    readonly assets: readonly FocusAsset[];
    readonly skill: FocusSkillPayload;
}
/**
 * Closed validation of the publisher-owned Focus entry descriptor.
 * Pure: no I/O, so catalog-time checks perform zero instruction reads.
 */
export declare const validateFocusEntryDescriptor: (value: unknown) => DefinitionResult<FocusEntryDescriptor>;
/**
 * Validate Focus configuration values against the exact §5.4 profile.
 * Declared defaults apply once before validation; unknown keys refuse.
 */
export declare const validateFocusParameters: (value: unknown) => DefinitionResult<FocusParameters>;
export interface PresentationGate {
    /** True when the host registry holds a UI entry for Focus. */
    readonly uiRegistered: boolean;
    /** True when the host selected that UI entry for this session. */
    readonly uiSelected: boolean;
    /** True when the host qualified the selected UI entry. */
    readonly uiQualified: boolean;
    /** True only when the host supplies an HTML sanitization hook. */
    readonly htmlSanitizerAvailable: boolean;
}
export type PresentationResolution = {
    readonly ok: true;
    readonly instructions: string;
} | {
    readonly ok: false;
    readonly code: "unsupported_presentation";
    readonly message: string;
};
/**
 * Presentation preflight for the selected Focus configuration.
 * `loadInstructions` runs ONLY when the requested presentation is usable, so
 * an unavailable `mcp-app` (or an unsanitized `html`) refuses with
 * `unsupported_presentation` with zero instruction reads/loads.
 */
export declare const resolveFocusPresentation: (params: FocusParameters, gate: PresentationGate, loadInstructions: () => string) => PresentationResolution;
/**
 * Read the package-owned registry manifest (`registry/entries.v1.json`).
 * Called explicitly by the host; importing this module alone reads nothing.
 *
 * The compiled snapshot vendored into `@sentropic/track`
 * (`packages/track/src/focus-vendor/registry/entries.v1.json`) ships the
 * pinned 1.0.0 manifest alongside the compiled helper, so the vendor never
 * resolves a foreign `@sentropic/focus` copy: package layout first,
 * vendor-adjacent manifest second, and no cross-package fallback.
 */
export declare const loadFocusSkillDescriptor: () => unknown;
/** Recompute every asset/schema digest over the supplied bytes. */
export declare const verifyAssetDigests: (entry: FocusEntryDescriptor, readFile: (packageRelativePath: string) => Uint8Array | null) => DefinitionIssue[];
/** Refuse absolute paths, traversal, escapes and duplicates. */
export declare const assertSafeAssetPaths: (entry: Pick<FocusEntryDescriptor, "assets">) => DefinitionIssue[];
