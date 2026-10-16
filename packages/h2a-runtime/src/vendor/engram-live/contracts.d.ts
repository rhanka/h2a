// Vendored types for the sibling .js — see its provenance header; do not hand-edit.
export declare const CONTRACT_NAME = "@sentropic/engram-live/contracts";
export declare const CONTRACT_VERSION = 1;
export declare const PRODUCER_NAME = "engram-live";
export declare const POLICY_VERSION = "live-git-indexing/1";
export type CapabilityId = "refs" | "history-dag" | "github-pr" | "index-snapshot" | "working-tree" | "diffs" | "code-analysis" | "retention-requests" | "reconciliation" | "publication";
export declare const CAPABILITY_IDS: readonly CapabilityId[];
/** The lot that implements each capability; part of the advertised contract. */
export declare const CAPABILITY_PLANNED_LOTS: Readonly<Record<CapabilityId, string>>;
export declare const NOT_IMPLEMENTED_REASON = "engram-live L1b supplies the package/factory seams and grammar loading only; this capability is explicitly unavailable until its lot lands";
export type CapabilityState = "available" | "unavailable";
export interface CapabilityStatus {
    readonly capability: CapabilityId;
    readonly state: CapabilityState;
    readonly reason: string;
    readonly plannedLot: string;
}
export declare function describeCapabilities(): readonly CapabilityStatus[];
export type CoverageState = "current" | "pending" | "partial" | "stale" | "unavailable";
export declare const COVERAGE_AXES: readonly string[];
export interface CoverageReport {
    readonly axis: string;
    readonly language?: string;
    readonly state: CoverageState;
    readonly reason?: string;
    readonly checkedAt: number;
}
export interface LiveScope {
    readonly tenant: string;
    readonly clone: string;
    readonly worktree?: string;
}
/**
 * Explicit live workspace declaration (L6a). Every declaration carries its
 * opaque identity triangle: declarationId (unique per declaration, stable
 * across every revision), plus its cloneId and worktreeId attachment, so a
 * revocation can target exactly one declaration. Identity uncertainty is
 * explicit (LIVE §12): an absent hostFingerprint is valid only when
 * identityUncertainty contains "missing_history". The product binding, when
 * present, is the complete (serverWorkspaceId, serverIssuer, bindingRevision)
 * triplet — never a partial binding.
 */
export interface WorkspaceDeclarationDto {
    readonly tenant: string;
    readonly principal: string;
    readonly hostFingerprint?: string;
    readonly identityUncertainty: readonly IdentityUncertaintyState[];
    readonly declarationId: string;
    readonly cloneId: string;
    readonly worktreeId: string;
    readonly authorizedRoots: readonly string[];
    readonly liveCapability: "live";
    readonly policyVersion: string;
    readonly declarationRevision: number;
    readonly serverWorkspaceId?: string;
    readonly serverIssuer?: string;
    readonly bindingRevision?: number;
}
export interface FactBatchDto {
    readonly scope: LiveScope;
    readonly producerName: string;
    readonly contractVersion: number;
    readonly policyVersion: string;
    readonly generationId: string;
    readonly batchId: string;
    readonly batchDigest: string;
    readonly facts: readonly unknown[];
}
export interface GrammarCoverageDto {
    readonly axis: "ast";
    readonly language: string;
    readonly state: CoverageState;
    readonly reason: string;
}
/** Languages with a pinned, packaged tree-sitter WASM grammar (L1b matrix). */
export declare const ADVERTISED_LANGUAGES: readonly string[];
export declare const GRAMMAR_UNAVAILABLE_REASON = "no packaged grammar is pinned for this language; AST coverage is explicitly unavailable";
export interface ValidationResult {
    readonly ok: boolean;
    readonly errors: readonly string[];
}
export declare function validateLiveScope(scope: unknown): ValidationResult;
export declare function validateWorkspaceDeclaration(declaration: unknown): ValidationResult;
export declare function validateFactBatch(batch: unknown): ValidationResult;
export declare function classifyDuplicateBatch(previous: FactBatchDto, next: FactBatchDto): "idempotent" | "refused";
/** The only capability value that activates live collection (Q4 A). */
export declare const EXPLICIT_LIVE_CAPABILITY: "live";
/**
 * Lifecycle kinds that never activate or remove a live declaration:
 * enrollment bind, transcript upload, code-workspace creation and agent
 * session open/end are distinct capabilities (spec §12).
 */
export declare const NON_ACTIVATING_LIFECYCLE_KINDS: readonly ["bind", "upload", "code-workspace-create", "session-open", "session-end"];
export type NonActivatingLifecycleKind = (typeof NON_ACTIVATING_LIFECYCLE_KINDS)[number];
export declare function isNonActivatingLifecycleKind(value: unknown): value is NonActivatingLifecycleKind;
export declare const OID_ALGORITHMS: readonly ["sha1", "sha256"];
export type OidAlgorithm = (typeof OID_ALGORITHMS)[number];
export declare const REVOCATION_REASONS: readonly ["workspace-remove", "owner-request", "policy-withdrawn"];
export type RevocationReason = (typeof REVOCATION_REASONS)[number];
export declare function isRevocationReason(value: unknown): value is RevocationReason;
/**
 * Explicit identity-coverage uncertainty states (LIVE §12). A repo with no
 * history (unborn HEAD) declares "missing_history"; a grafted (shallow)
 * history declares "shallow_history" while keeping its fingerprints, whose
 * coverage stays uncertain. An absent fingerprint is valid only under
 * "missing_history"; uncertainty never merges clones.
 */
export declare const IDENTITY_UNCERTAINTY_STATES: readonly ["missing_history", "shallow_history"];
export type IdentityUncertaintyState = (typeof IDENTITY_UNCERTAINTY_STATES)[number];
export declare function isIdentityUncertaintyState(value: unknown): value is IdentityUncertaintyState;
/** First declaration revision: the explicit activation is revision 1. */
export declare const INITIAL_DECLARATION_REVISION = 1;
/** First product binding revision; every rebind carries a strictly greater one. */
export declare const INITIAL_BINDING_REVISION = 1;
/** The three opaque id kinds minted by the canonical derivation. */
export declare const ID_KINDS: readonly ["clone", "worktree", "declaration"];
export type IdKind = (typeof ID_KINDS)[number];
/** Opaque id prefixes; a valid id of a kind starts with its prefix. */
export declare const ID_PREFIXES: Readonly<Record<IdKind, string>>;
export declare function isIdKind(value: unknown): value is IdKind;
/**
 * THE canonical identity serialization shared by every live opaque id
 * (cloneId, worktreeId, declarationId). Both seats and engram mint ids
 * from this exact function, so the same identity components always give
 * the same id on every side. The serialization is unambiguous: a JSON
 * array of the kind plus the components in order, so no component value
 * can shift a boundary. NUL is refused outright in every component, so the
 * ambiguous couples ("a\0b", "c") vs ("a", "b\0c") can never be
 * constructed. Pure and total over valid inputs; throws on malformed
 * components so no silent normalization can produce a colliding key.
 */
export declare function canonicalIdKey(kind: IdKind, components: readonly string[]): string;
/**
 * Local clone identity. hostScope bounds the clone to one host;
 * commonDirProjectFingerprint is the project fingerprint computed over the
 * common-dir history with the empty main-worktree component (spec §12) and
 * is optional: it may be absent only when identityUncertainty explicitly
 * contains "missing_history" (LIVE §12) — the hostScope + common-dir
 * realpath components keep clones distinct even then;
 * commonDirRealpath is the host-resolved common-dir path (host-local only,
 * never published to sentropic); cloneId is the scoped opaque identifier
 * minted from canonicalIdKey and safe to share; oidAlgorithm records the
 * repository object format.
 */
export interface CloneIdentityDto {
    readonly hostScope: string;
    readonly commonDirRealpath: string;
    readonly commonDirProjectFingerprint?: string;
    readonly cloneId: string;
    readonly oidAlgorithm: OidAlgorithm;
    readonly identityUncertainty: readonly IdentityUncertaintyState[];
}
/**
 * Worktree identity: one shared cloneId plus its own host-scoped opaque
 * worktreeId, isolated per-worktree fingerprint, path and resolved
 * git-dir. Linked worktrees share only authorized immutable analyses;
 * index snapshots and context-dependent resolution stay worktree-local
 * (spec §§3, 15). The worktree fingerprint is optional: absent only under
 * explicit "missing_history" uncertainty (LIVE §12).
 */
export interface WorktreeIdentityDto {
    readonly cloneId: string;
    readonly worktreeId: string;
    readonly worktreePath: string;
    readonly gitDir: string;
    readonly worktreeFingerprint?: string;
    readonly identityUncertainty: readonly IdentityUncertaintyState[];
}
/**
 * Private-purge request carried by every revocation. All purges are `true`
 * and committed history is always preserved: there is no field authorizing
 * deletion of committed facts.
 */
export interface PrivatePurgeRequestDto {
    readonly purgePrivateSnapshots: true;
    readonly purgeDerivedIndexes: true;
    readonly revokeDecryptability: true;
    readonly preserveCommittedHistory: true;
}
/**
 * Revocation of exactly one declaration: the opaque declarationId names the
 * single target (stable across that declaration's revisions, unique per
 * declaration), and cloneId/worktreeId carry its clone/worktree
 * attachment so the recipient purges the right scope without consulting
 * ambiguous public values. Withdrawing a whole clone revokes each of its
 * declarations, one unambiguous revocation each.
 */
export interface DeclarationRevocationDto {
    readonly declarationId: string;
    readonly tenant: string;
    readonly cloneId: string;
    readonly worktreeId: string;
    readonly declarationRevision: number;
    readonly reason: RevocationReason;
    readonly requestPrivatePurge: PrivatePurgeRequestDto;
}
/**
 * Lexical normalization applied to the host-resolved common-dir realpath
 * before key derivation: trailing slashes are stripped (the filesystem
 * root alone is kept). The host resolves symlinks to the realpath before
 * calling; this function performs no I/O.
 */
export declare function normalizeCommonDirRealpath(realpath: string): string;
export declare function validateCloneIdentity(identity: unknown): ValidationResult;
export declare function validateWorktreeIdentity(identity: unknown): ValidationResult;
export declare function validatePrivatePurgeRequest(request: unknown): ValidationResult;
export declare function validateDeclarationRevocation(revocation: unknown): ValidationResult;
//# sourceMappingURL=contracts.d.ts.map