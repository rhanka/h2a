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
/** Strict opaque batch/generation/key identifiers: prefixed, charset-closed. */
export declare function isStrictBatchId(value: unknown, prefix: string): value is string;
/**
 * Fixed-width generation identifiers (L4b-2 m9): `gen:` plus exactly
 * GENERATION_ID_WIDTH zero-padded decimal digits. Lexicographic order is
 * numeric order (`gen:0000000010` > `gen:0000000009`), so a newer delivery
 * is never durably rejected as stale. Producers mint monotone ids per
 * target; the host keeps only the highest accepted generation per target.
 */
export declare const GENERATION_ID_WIDTH = 10;
export declare function isStrictGenerationId(value: unknown): value is string;
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
 * The follow-up window for branch activity (spec §4). It selects followed
 * branches only; it never limits commit count, commit age, retained DAG
 * facts or already acquired PR history, and it never prunes anything.
 */
export declare const ACTIVITY_WINDOW_DAYS = 30;
/** A full ref name's kind, from its name alone. Tags are inventoried but never traversal roots. */
export type RefKind = "local-branch" | "remote-branch" | "pr-head" | "tag" | "other";
/** Which signal made a root a root (spec §4: record which signal selected it). */
export type RootSelectionSignal = "default-branch" | "active-window" | "pr-head" | "worktree-head" | "previously-ingested";
/** The two activity signals (spec §4): bootstrap tip committer time, or a later observed target change. */
export type ActivitySignalKind = "bootstrap-committer-time" | "observed-target-change";
/** An OID qualified by its object-format algorithm: equal OIDs under different algorithms are never the same object. */
export interface QualifiedOid {
    readonly algorithm: OidAlgorithm;
    readonly oid: string;
}
/** Hex length of an OID under one algorithm. */
export declare function oidHexLength(algorithm: OidAlgorithm): 40 | 64;
/** Strict algorithm-qualified OID check: lowercase hex of the algorithm's exact length. */
export declare function isValidQualifiedOid(value: QualifiedOid): boolean;
export declare function validateQualifiedOid(value: unknown): ValidationResult;
/**
 * One host observation of one ref (spec §3: Ref/RefObservation). `observedAt`
 * is polling time, never activity. `absent` marks a deletion observation: the
 * ref no longer resolves at this generation. `tipCommitterUnixSeconds` is the
 * bootstrap activity signal over the observed target; supplying it again on a
 * later observation of the same target refreshes nothing.
 */
export interface RawRefObservationDto {
    readonly refName: string;
    /** Observed target OID; empty when `absent` is true. */
    readonly oid: string;
    readonly observedAt: number;
    readonly absent?: boolean;
    readonly tipCommitterUnixSeconds?: number;
}
export declare function validateRawRefObservation(value: unknown): ValidationResult;
/** The activity provenance of a tracked ref: when it was last really worked on, and how that is known. */
export interface RefActivityDto {
    readonly activityAt: number;
    readonly signal: ActivitySignalKind;
}
/**
 * The neutral tracked state of one ref: creation, deletion and recreation are
 * separate observations (generation bumps once per reappearance after an
 * absence). `oid` is null exactly while the latest observation is a deletion;
 * `activity` is never refreshed by merely observing the same target again.
 */
export interface TrackedRefDto {
    readonly refName: string;
    readonly kind: RefKind;
    readonly oid: string | null;
    readonly generation: number;
    readonly activity: RefActivityDto | null;
    readonly deletedAt: number | null;
    readonly lastObservedAt: number;
}
/** The HEAD of one registered worktree, as the host resolved it. */
export type WorktreeHead = {
    readonly kind: "branch";
    readonly refName: string;
} | {
    readonly kind: "detached";
    readonly oid: string;
} | {
    readonly kind: "unborn";
};
/** One provenance record of why an OID is a root. */
export interface RootSourceDto {
    readonly signal: RootSelectionSignal;
    readonly refName: string | null;
    readonly worktreeId: string | null;
    readonly activityAt: number | null;
    readonly generation: number | null;
}
/** A selected history root: one qualified OID plus every provenance source that selected it. */
export interface SelectedRootDto {
    readonly qualifiedOid: QualifiedOid;
    /** Rev expression for the walk: always the observed OID (ref names are mobile provenance, never walk input). */
    readonly rev: string;
    readonly sources: readonly RootSourceDto[];
}
/**
 * A previously ingested root, retained for investigation whatever later
 * happens to its ref (expiry, deletion, recreation, force-push). Durable
 * retention/reconstruction itself is R1's lot; this record is the neutral
 * retained-root fact the persistence port keeps queryable.
 */
export interface RetainedRootDto {
    readonly cloneId: string;
    readonly algorithm: OidAlgorithm;
    readonly oid: string;
    readonly firstSeenAt: number;
    readonly firstSignal: RootSelectionSignal;
    readonly refName: string | null;
}
/** Authorized author/committer identity of a commit, as recorded in the object. */
export interface HistoryIdentityDto {
    readonly name: string;
    readonly email: string;
    readonly unixSeconds: number;
    readonly offsetMinutes: number;
}
/**
 * One immutable commit fact of the retained DAG (spec §3 Commit/Parent):
 * algorithm-qualified OID, tree, ORDERED parents, authorized identities and
 * message, extraction and policy versions. Shared immutably by every branch,
 * PR head and worktree that reaches it; there is no commit × branch edge.
 */
/**
 * One changed file of a commit against one ordered parent: the path is kept
 * as raw bytes (never line-parsed) and the line counts come from numstat
 * (null when the content is binary or non-textual).
 */
export interface HistoryFileChangeDto {
    readonly path: Uint8Array;
    readonly previousPath: Uint8Array | null;
    readonly status: string;
    readonly statusScore: number | null;
    readonly oldMode: string;
    readonly newMode: string;
    readonly oldOid: string;
    readonly newOid: string;
    readonly added: number | null;
    readonly deleted: number | null;
}
/** The changed files of one commit against one of its ordered parents. */
export interface HistoryParentDiffDto {
    /** -1 means the empty-tree comparison of a parentless (root) commit. */
    readonly parentIndex: number;
    readonly files: readonly HistoryFileChangeDto[];
}
export interface HistoryCommitFactDto {
    readonly cloneId: string;
    readonly algorithm: OidAlgorithm;
    readonly oid: string;
    readonly tree: string;
    readonly parents: readonly string[];
    readonly author: HistoryIdentityDto;
    readonly committer: HistoryIdentityDto;
    readonly subject: string;
    readonly message: Uint8Array;
    /** Changed files per ordered parent (L2a extraction); part of the durable fact. */
    readonly parentDiffs: readonly HistoryParentDiffDto[];
    readonly extractorVersion: string;
    readonly policyVersion: string;
}
/**
 * An extraction checkpoint (spec §6): an OID is marked extracted for one
 * extraction version only after the required fact set has durable
 * acknowledgement. A checkpoint is extraction progress, never complete
 * ancestry by itself: ancestry completeness is the separately derived
 * frontier (closure over recorded parents). A known-but-partial OID is not
 * a checkpoint and not a traversal stop.
 */
export interface HistoryCheckpointDto {
    readonly cloneId: string;
    readonly algorithm: OidAlgorithm;
    readonly oid: string;
    readonly tree: string;
    readonly parents: readonly string[];
    readonly extractorVersion: string;
    readonly policyVersion: string;
}
export interface HistoryCompletionQuery {
    readonly cloneId: string;
    readonly algorithm: OidAlgorithm;
    readonly extractorVersion: string;
    readonly policyVersion: string;
}
export interface HistoryCompletionState {
    /** OIDs extracted for this extractor version (extraction checkpoints). */
    readonly knownComplete: readonly string[];
    /**
     * The checkpoints behind knownComplete, parents included: the engine derives
     * the ancestry frontier (closure over parents) from these, so a checkpoint
     * whose parents are not durable never counts as complete ancestry.
     */
    readonly checkpoints: readonly HistoryCheckpointDto[];
    readonly retainedRoots: readonly RetainedRootDto[];
}
/**
 * THE injected persistence port (plan/09 L2b: a port, never a base). Engram
 * defines the contract only; cluster-mesh (L3) and the app implement it. The
 * interface deliberately exposes no commit × branch edge and no query surface
 * beyond completion and retained roots: branch membership is derived from the
 * retained DAG and current refs, never persisted (spec §4).
 */
export interface HistoryPersistencePort {
    loadCompletion(query: HistoryCompletionQuery): Promise<HistoryCompletionState>;
    persistCommitFact(fact: HistoryCommitFactDto): Promise<{
        received: true;
    }>;
    recordCompletion(checkpoint: HistoryCheckpointDto): Promise<{
        received: true;
    }>;
    recordRetainedRoot(root: RetainedRootDto): Promise<{
        received: true;
    }>;
}
/**
 * Explicit dag coverage (spec §4, A04): shallow boundaries, missing objects
 * and inaccessible roots are explicit gaps; a gap never silently degrades
 * into a current/complete claim.
 */
/**
 * Structured cause of a dag coverage gap: a missing object (an OID the clone
 * does not hold) versus a grafted shallow boundary (ancestry cut by the host
 * declaration). Anything else is a protocol failure the caller sees as a
 * thrown error, never as coverage.
 */
export type HistoryCoverageCause = "missing-object" | "shallow-boundary";
export interface HistoryCoverageReportDto {
    readonly axis: "dag";
    readonly state: CoverageState;
    readonly reason: string;
    readonly cause: HistoryCoverageCause;
    /** Grafted shallow boundary OIDs (state "partial"). */
    readonly boundary?: readonly QualifiedOid[];
    /** Missing object OIDs (state "unavailable"). */
    readonly missing?: readonly QualifiedOid[];
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
/** The coverage axis retention reports on: object availability, never DAG currency. */
export declare const RETENTION_COVERAGE_AXIS: "object-availability";
/** Why a retention coverage gap exists: a required receipt is not durably recorded. */
export type RetentionCoverageCause = "missing-receipt";
export interface RetentionCoverageReportDto {
    readonly axis: "object-availability";
    readonly state: CoverageState;
    readonly reason: string;
    readonly cause: RetentionCoverageCause;
    /** Required OIDs without a scoped durable receipt (state "unavailable"). */
    readonly missing?: readonly QualifiedOid[];
}
/**
 * One scoped retention request: the neutral producer asks the host to
 * acquire and protect the pinned committed object. Scope is tenant + clone
 * (clone-scoped, never worktree-scoped, never global). `firstSignal` is the
 * current pass's first L2b selection source for the OID (sources are
 * precedence-ordered: default, worktree, PR, window, then retained), and
 * `refName` carries the current pass's selecting ref when one exists, else
 * null (detached/retained roots). Neither is the historic first ingestion:
 * that provenance stays on RetainedRootDto (firstSignal/refName at first
 * sighting, kept queryable by the history persistence port), so a deleted
 * ref re-requested as previously-ingested loses no history — the historic
 * record is read there, not overwritten here.
 * No content field exists by construction.
 */
export interface RetentionRequestDto {
    readonly scope: LiveScope;
    readonly algorithm: OidAlgorithm;
    readonly oid: string;
    readonly firstSignal: RootSelectionSignal;
    readonly refName: string | null;
    readonly requestedAt: number;
}
/**
 * One scoped durable receipt: the host confirms the pinned object is
 * protected in its private store. `backupRef` is the opaque
 * coordinated-backup reference L8 coordinates (stable per scope/OID);
 * it carries no content and never publishes a raw pack.
 */
export interface RetentionReceiptDto {
    readonly scope: LiveScope;
    readonly algorithm: OidAlgorithm;
    readonly oid: string;
    readonly receivedAt: number;
    readonly backupRef: string;
}
/** The receipt lookup scope: tenant + clone plus the object-format algorithm. */
export interface RetentionReceiptQuery {
    readonly scope: LiveScope;
    readonly algorithm: OidAlgorithm;
}
export declare function validateRetentionRequest(request: unknown): ValidationResult;
export declare function validateRetentionReceipt(receipt: unknown): ValidationResult;
export declare function validateDeclarationRevocation(revocation: unknown): ValidationResult;
/** Every PR state indexed by live (drafts are open + isDraft true). */
export declare const PULL_REQUEST_STATES: readonly ["open", "closed", "merged"];
export type PullRequestState = (typeof PULL_REQUEST_STATES)[number];
export declare function isPullRequestState(value: unknown): value is PullRequestState;
/** Merge strategies stay distinguished; unknown means not yet evidenced. */
export declare const PULL_REQUEST_MERGE_STRATEGIES: readonly ["merge", "squash", "rebase", "unknown"];
export type PullRequestMergeStrategy = (typeof PULL_REQUEST_MERGE_STRATEGIES)[number];
export declare function isPullRequestMergeStrategy(value: unknown): value is PullRequestMergeStrategy;
/** Transport failure kinds: each preserves last success with stale coverage. */
export declare const PR_SYNC_ERROR_KINDS: readonly ["offline", "auth_required", "rate_limited", "unavailable", "protocol"];
export type PrSyncErrorKind = (typeof PR_SYNC_ERROR_KINDS)[number];
export declare function isPrSyncErrorKind(value: unknown): value is PrSyncErrorKind;
/** Neutral object-job lifecycle, independent of the metadata cursor. */
export declare const PR_OBJECT_JOB_STATES: readonly ["pending", "acquired", "failed"];
export type PrObjectJobState = (typeof PR_OBJECT_JOB_STATES)[number];
export declare function isPrObjectJobState(value: unknown): value is PrObjectJobState;
/** PR coverage axes (spec §12): metadata, objects and attribution separate. */
export declare const PR_COVERAGE_AXES: readonly ["pr-metadata", "object-availability", "pr-attribution"];
export type PrCoverageAxis = (typeof PR_COVERAGE_AXES)[number];
/** Explicit end-of-list proof: the only accepted complete-sweep terminator. */
export declare const PR_END_PROOF: "end-of-list";
export type PrEndProof = typeof PR_END_PROOF;
/** Service-owned refs for private PR acquisition (H executor, never the clone). */
export declare const PRIVATE_PR_REF_PREFIX = "refs/live-private/pr/";
/** Keys that must never enter a PR fact (tokens stay out of rows/logs). */
export declare const PR_FACT_FORBIDDEN_KEYS: readonly ["token", "credential", "secret", "authorization"];
/** A GitHub repository identity (owner + name, no URL, no credential). */
export interface GithubRepositoryDto {
    readonly owner: string;
    readonly repo: string;
}
/**
 * One neutral PR observation: identity, all-state state/dates, pinned
 * head/base observations and merge evidence. Historical bounds are pinned
 * values, never derived from today's base.
 */
export interface PullRequestFactDto {
    readonly repositoryOwner: string;
    readonly repositoryRepo: string;
    readonly number: number;
    readonly state: PullRequestState;
    readonly isDraft: boolean;
    readonly updatedAt: number;
    readonly headOid: QualifiedOid;
    readonly headRef: string;
    readonly baseOid: QualifiedOid;
    readonly baseRef: string;
    readonly mergeOid?: QualifiedOid | null;
    readonly mergeStrategy?: PullRequestMergeStrategy;
}
/** One transport page item: same shape as the persisted observation. */
export type PrPageItemDto = PullRequestFactDto;
/**
 * One GitHub listing page over the INJECTED transport. Termination is
 * coherent: hasMore false requires endProof AND a null nextCursor (a
 * continuation cursor with an end proof is contradictory, never complete);
 * hasMore true requires a non-empty nextCursor and carries no endProof.
 * page.etag, when present, is the validator for this exact
 * (repository, filter, cursor) position only, never for another page.
 */
export interface PrPageDto {
    readonly items: readonly PrPageItemDto[];
    readonly nextCursor: string | null;
    readonly hasMore: boolean;
    readonly endProof?: PrEndProof;
    readonly etag?: string | null;
}
/**
 * Durable sync cursor: continuation/retry state with overlap discipline.
 * Validators stay bound to their position: etagsByCursor maps one ETag per
 * requested (filter, cursor) position so a conditional retry never sends
 * page N's validator for page M. lastEtag keeps the most recently seen
 * validator for hosts that only read a scalar.
 */
export interface PrSyncCursorDto {
    readonly repositoryOwner: string;
    readonly repositoryRepo: string;
    readonly updatedAtCursor: number | null;
    readonly lastSuccessAt: number | null;
    readonly lastEtag: string | null;
    readonly etagsByCursor?: Record<string, string> | null;
    readonly sweepKind: "incremental" | "full";
    readonly pendingRetry?: {
        readonly kind: PrSyncErrorKind;
        readonly attempts: number;
        readonly nextAfter: number;
    } | null;
}
/** One neutral object-acquisition job, independent of the metadata cursor. */
export interface PrObjectJobDto {
    readonly repositoryOwner: string;
    readonly repositoryRepo: string;
    readonly prNumber: number;
    readonly headOid: QualifiedOid;
    readonly state: PrObjectJobState;
    readonly attempts: number;
    readonly lastError?: PrSyncErrorKind | null;
    readonly acquiredOid?: QualifiedOid | null;
    readonly totalCommits?: number | null;
    readonly acquiredCommits?: number | null;
}
/**
 * Pinned historical attribution, separate from ancestry. "complete" needs
 * observed head/base bounds plus at least one merge-base OID; anything else
 * is "partial" while the acquired ancestry stays available. An unknown base
 * stays an explicit null (never replaced by the head OID): a null baseOid
 * is always "partial".
 */
export interface PrAttributionDto {
    readonly repositoryOwner: string;
    readonly repositoryRepo: string;
    readonly prNumber: number;
    readonly baseOid: QualifiedOid | null;
    readonly headOid: QualifiedOid;
    readonly mergeBaseOids: readonly QualifiedOid[];
    readonly mergeOid?: QualifiedOid | null;
    readonly mergeStrategy: PullRequestMergeStrategy;
    readonly status: "complete" | "partial";
    readonly reason: string;
}
/** Explicit PR coverage per axis; unknown is never current. */
export interface PrCoverageDto {
    readonly axis: PrCoverageAxis;
    readonly state: CoverageState;
    readonly reason: string;
    readonly lastSuccessAt?: number | null;
}
/**
 * Metadata receipt for the S mapping: metadata completion never implies
 * object completion. S refuses to acknowledge a failed private acquisition.
 */
export interface PrMetadataReceiptDto {
    readonly batchId: string;
    readonly repositoryOwner: string;
    readonly repositoryRepo: string;
    readonly prNumbers: readonly number[];
    readonly cursor: PrSyncCursorDto;
    readonly metadataComplete: boolean;
    readonly objectComplete: boolean;
}
/** Private acquisition request for the H executor (pinned OID, service ref). */
export interface PrivateObjectAcquisitionRequestDto {
    readonly repositoryOwner: string;
    readonly repositoryRepo: string;
    readonly prNumber: number;
    readonly headOid: QualifiedOid;
    readonly serviceRef: string;
}
export declare function validateGithubRepository(value: unknown): ValidationResult;
export declare function validatePullRequestFact(value: unknown): ValidationResult;
export declare function validatePrPage(value: unknown): ValidationResult;
export declare function validatePrSyncCursor(value: unknown): ValidationResult;
export declare function validatePrObjectJob(value: unknown): ValidationResult;
export declare function validatePrAttribution(value: unknown): ValidationResult;
export declare function validatePrivateObjectAcquisitionRequest(value: unknown): ValidationResult;
/** Versioned local-diff normalization evidence (spec §8: rename detection and thresholds are versioned evidence). */
export declare const LOCAL_DIFF_NORMALIZER_VERSION = "local-diff-normalizer/1";
/** Versioned deterministic content-policy rules stamped on every L4b fact. */
export declare const CONTENT_POLICY_VERSION = "live-content-policy/1";
/** Explicit coverage marker when no protection key authorizes local content. */
export declare const CONTENT_UNAVAILABLE = "content_unavailable";
/** Files larger than this are excluded before any content read (matches the L4a capture bound). */
export declare const LOCAL_MAX_FILE_BYTES = 1048576;
/** The three distinct local comparisons (spec §8; GitNexus staged/unstaged/reference distinction). */
export declare const LOCAL_DIFF_KINDS: readonly ["staged", "unstaged", "conflict"];
export type LocalDiffKind = (typeof LOCAL_DIFF_KINDS)[number];
export declare function isLocalDiffKind(value: unknown): value is LocalDiffKind;
/** Immutable recorded endpoint of one local comparison. */
export declare const LOCAL_DIFF_ENDPOINT_LABELS: readonly ["HEAD", "index", "worktree", "empty-tree", "oid"];
export type LocalDiffEndpointLabel = (typeof LOCAL_DIFF_ENDPOINT_LABELS)[number];
export interface LocalDiffEndpointDto {
    readonly label: LocalDiffEndpointLabel;
    /** Null exactly for the worktree and empty-tree endpoints; otherwise an algorithm hex OID/digest. */
    readonly oid: string | null;
}
/** Why a path carries metadata only, never an invented text hunk. */
export declare const LOCAL_EXCLUSION_REASONS: readonly ["binary", "oversized", "unknown-size", "filtered", "protected", "symlink", "gitlink", "unstable-capture", "deleted"];
export type LocalExclusionReason = (typeof LOCAL_EXCLUSION_REASONS)[number];
/**
 * Closed withheld reasons (L4b M1: no free text toward the sink).
 * Secret-rule values name the matched deterministic rule only; the secret
 * itself never appears. `withheld-no-protection-key` is the no-key
 * downgrade of a single hunk.
 */
export declare const LOCAL_WITHHELD_REASONS: readonly ["withheld-secret-aws-access-key", "withheld-secret-github-token", "withheld-secret-private-key-block", "withheld-secret-credential-assignment", "withheld-secret-credentialed-url", "withheld-secret-unknown", "withheld-no-protection-key"];
export type LocalWithheldReason = (typeof LOCAL_WITHHELD_REASONS)[number];
export declare function isLocalWithheldReason(value: unknown): value is LocalWithheldReason;
/** Closed withheld reason for a matched deterministic secret rule (the secret itself never appears). */
export declare function withheldReasonForSecretRule(rule: string | null): LocalWithheldReason;
/** Closed seal algorithm allowlist (L4b M1: the S seat extends this list by contract amendment). */
export declare const LOCAL_SEAL_ALGORITHMS: readonly ["fake-seal/1"];
export type LocalSealAlgorithm = (typeof LOCAL_SEAL_ALGORITHMS)[number];
export declare function isLocalSealAlgorithm(value: unknown): value is LocalSealAlgorithm;
/**
 * Strict opaque key reference (L4b M1: host key custody identifier, never
 * free text). Charset-closed; the H seat mints values within this charset.
 */
export declare function isStrictKeyRef(value: unknown): value is string;
/**
 * Closed coverage reasons (L4b M1: no free sentence toward the sink).
 * Values carrying `content_unavailable` mark the explicit no-content
 * downgrade (CONTENT_UNAVAILABLE).
 */
export declare const LOCAL_COVERAGE_REASONS: readonly ["content_unavailable:no-key", "content_unavailable:unstable-capture", "content_unavailable:unknown-size", "content_unavailable:conflict-inventory-mismatch", "content_unavailable:policy-withheld", "partial:no-snapshot-payload", "current:sealed-latest"];
export type LocalCoverageReason = (typeof LOCAL_COVERAGE_REASONS)[number];
export declare function isLocalCoverageReason(value: unknown): value is LocalCoverageReason;
/** Closed snapshot metadata-only reasons (L4b M1: the no-key downgrade reason; L4b-2: the secret-exclusion reason). */
export declare const LOCAL_SNAPSHOT_METADATA_REASONS: readonly ["metadata:unstable-capture", "metadata:no-key", "metadata:no-payload", "metadata:policy-withheld"];
export type LocalSnapshotMetadataReason = (typeof LOCAL_SNAPSHOT_METADATA_REASONS)[number];
export declare function isLocalSnapshotMetadataReason(value: unknown): value is LocalSnapshotMetadataReason;
/** Strict snapshot identity: `lsnap:` plus the 64 hex characters minted at staging. */
export declare function isStrictSnapshotId(value: unknown): value is string;
/**
 * Hunk payload states. "open-lines" is transient pre-persistence evidence
 * only: it never reaches a sink or a store (validateSealedLocalDiff refuses
 * it). "sealed" is host-encrypted bytes; "withheld" is an explicit refusal.
 */
export type LocalHunkPayloadDto = {
    readonly state: "open-lines";
    readonly lines: readonly string[];
} | {
    readonly state: "sealed";
    readonly algorithm: LocalSealAlgorithm;
    readonly keyRef: string;
    readonly ciphertext: Uint8Array;
} | {
    readonly state: "withheld";
    readonly reason: LocalWithheldReason;
};
export interface LocalHunkDto {
    readonly startBefore: number;
    readonly countBefore: number;
    readonly startAfter: number;
    readonly countAfter: number;
    readonly payload: LocalHunkPayloadDto;
}
export declare const LOCAL_FILE_STATUSES: readonly ["added", "modified", "deleted", "conflict"];
export type LocalFileStatus = (typeof LOCAL_FILE_STATUSES)[number];
export interface LocalFileChangeDto {
    /** Raw path bytes, byte-exact (never line-parsed); a protected path stays as metadata with an explicit exclusion while its content is withheld. */
    readonly path: Uint8Array;
    readonly previousPath: Uint8Array | null;
    readonly status: LocalFileStatus;
    readonly oldMode: string;
    readonly newMode: string;
    readonly oldOid: string;
    readonly newOid: string;
    /** Numstat line counts; null for binary/non-textual content (spec §8). */
    readonly added: number | null;
    readonly deleted: number | null;
    readonly exclusion?: LocalExclusionReason;
    /** Conflict stages 1/2/3 as separate facts, present on conflict diffs only. */
    readonly stageOids?: Readonly<Record<string, string>>;
    readonly hunks: readonly LocalHunkDto[];
}
/** Explicit index/working-tree coverage (spec §12; A04/A09). */
export declare const LOCAL_COVERAGE_CAUSES: readonly ["unstable-capture", "missing-key", "policy-withheld"];
export type LocalCoverageCause = (typeof LOCAL_COVERAGE_CAUSES)[number];
export interface LocalCoverageReportDto {
    readonly axis: "index" | "working-tree";
    readonly state: CoverageState;
    readonly reason: LocalCoverageReason;
    readonly cause?: LocalCoverageCause;
}
/**
 * One neutral local diff: immutable endpoints, versioned normalization,
 * policy-screened files. A cumulative HEAD → worktree view is not a valid
 * L4b kind and never validates.
 */
export interface LocalDiffDto {
    readonly scope: LiveScope;
    readonly worktreeId: string;
    readonly kind: LocalDiffKind;
    readonly base: LocalDiffEndpointDto;
    readonly tip: LocalDiffEndpointDto;
    readonly comparedParent?: number | null;
    readonly mergeBase?: string | null;
    readonly normalizerVersion: string;
    readonly policyVersion: string;
    readonly files: readonly LocalFileChangeDto[];
    readonly coverage?: LocalCoverageReportDto;
}
/**
 * The sealed latest-state payload (Q2 B). "sealed" is host-encrypted bytes
 * produced BEFORE any persistent write; "metadata-only" is the no-key
 * downgrade carrying ranges/metadata alone.
 */
export type SealedSnapshotPayloadDto = {
    readonly state: "sealed";
    readonly algorithm: LocalSealAlgorithm;
    readonly keyRef: string;
    readonly ciphertext: Uint8Array;
} | {
    readonly state: "metadata-only";
    readonly reason: LocalSnapshotMetadataReason;
};
/**
 * The latest authorized local state only (Q2 B): no history is retained.
 * Replacement is indexed by target and generation at the sink (L4b M2):
 * the snapshot carries no predecessor pointer, so two concurrent captures
 * can never each retire only their own predecessor and leave two states.
 * The target includes the diff kind (L4b-2): staged and conflict snapshots
 * share the "index" axis but hold distinct targets, so a conflict arrival
 * never replaces the staged state.
 */
export interface LocalSnapshotDto {
    readonly scope: LiveScope;
    readonly worktreeId: string;
    readonly snapshotId: string;
    readonly kind: "index" | "working-tree";
    /** Which local comparison this state holds: staged and conflict are distinct index targets. */
    readonly diffKind: LocalDiffKind;
    readonly capturedAt: number;
    readonly diffDigest: string;
    readonly sealed: SealedSnapshotPayloadDto;
    readonly policyVersion: string;
}
export declare function validateLocalDiffEndpoint(endpoint: unknown): ValidationResult;
export declare function validateLocalCoverage(coverage: unknown): ValidationResult;
/** Structural validation of a derived (possibly transient) local diff. */
export declare function validateLocalDiff(diff: unknown): ValidationResult;
/**
 * Sink/store-bound validation: transient "open-lines" hunk payloads are
 * refused, so persist-then-mask cannot validate. Seal through the injected
 * host protection port first, or withhold explicitly.
 */
export declare function validateSealedLocalDiff(diff: unknown): ValidationResult;
/** Structural validation of the latest authorized local state (Q2 B). */
export declare function validateLocalSnapshot(snapshot: unknown): ValidationResult;
