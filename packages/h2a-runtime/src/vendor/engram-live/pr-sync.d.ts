import { type GithubRepositoryDto, type PrCoverageDto, type PrObjectJobDto, type PrPageDto, type PrSyncCursorDto, type PrSyncErrorKind, type PullRequestFactDto } from "./contracts.js";
/** Neutral PR sync extractor version (checkpoints are per version). */
export declare const PR_SYNC_EXTRACTOR_VERSION = "engram-live/pr-sync/1";
/**
 * Overlap re-ask on incremental retries (milliseconds): the resume window
 * re-reads recently updated PRs so a page that moved during enumeration is
 * deduplicated instead of lost. Pure constant, consumed by hosts.
 */
export declare const PR_SYNC_OVERLAP_MS: number;
export declare class PrSyncError extends Error {
    readonly kind: PrSyncErrorKind;
    constructor(kind: PrSyncErrorKind, message: string);
}
export interface PrPageRequest {
    readonly repository: GithubRepositoryDto;
    readonly cursor: string | null;
    readonly updatedAtSince: number | null;
    /**
     * Conditional validator bound to this exact (repository, filter, cursor)
     * position: the engine replays only the ETag stored for the requested
     * position, never another page's validator. Null means no validator yet.
     */
    readonly etag: string | null;
}
export type PrTransportResult = {
    readonly ok: true;
    readonly page: PrPageDto;
} | {
    readonly ok: false;
    readonly kind: PrSyncErrorKind;
    readonly message: string;
    readonly retryAfterMs?: number;
};
/**
 * INJECTED GitHub listing transport (neutral port). Production H: serves it
 * with the approved installed `gh` binary, host-controlled credentials and
 * ETag/rate-limit handling; tests serve fixture pages. No network in engram.
 * The request carries no count limit: the engine never sends a ceiling.
 */
export interface GithubPrTransportPort {
    fetchPage(request: PrPageRequest): Promise<PrTransportResult>;
}
/**
 * INJECTED durable PR persistence (neutral port, never a base). Engram owns
 * no database; cluster-mesh/app implement it behind this shape (S mapping).
 * Retention contract: saveObservation keeps every distinct observation —
 * a moved head, a state change, a base change or new merge evidence appends
 * a row, never erases the previous one; only byte-identical repeats
 * collapse. Object jobs are keyed by (repository, PR, head OID): recording
 * head B never replaces head A's job, its failures or its receipts.
 */
export interface PrSyncPersistencePort {
    loadCursor(repository: GithubRepositoryDto): Promise<PrSyncCursorDto | null>;
    saveCursor(cursor: PrSyncCursorDto): Promise<void>;
    saveObservation(fact: PullRequestFactDto): Promise<void>;
    listObservations(repository: GithubRepositoryDto): Promise<readonly PullRequestFactDto[]>;
    recordObjectJob(job: PrObjectJobDto): Promise<void>;
    updateObjectJob(job: PrObjectJobDto): Promise<void>;
    listObjectJobs(repository: GithubRepositoryDto): Promise<readonly PrObjectJobDto[]>;
}
export interface PrSyncInput {
    readonly repository: GithubRepositoryDto;
    readonly sweepKind: "incremental" | "full";
    readonly now: number;
}
export interface PrSyncStats {
    readonly pages: number;
    readonly itemsSeen: number;
    readonly unique: number;
    readonly duplicates: number;
    readonly observations: number;
    readonly objectJobsPending: number;
}
export interface PrSyncOutcome {
    readonly state: "complete" | "stale";
    readonly observations: readonly PullRequestFactDto[];
    readonly cursor: PrSyncCursorDto;
    readonly coverage: readonly PrCoverageDto[];
    readonly stats: PrSyncStats;
}
/**
 * Identity of one persisted observation: the complete observed fact. Two
 * rows sharing one head OID but differing by state, draft flag, refs, base,
 * merge evidence or timestamp are different observations and all persist;
 * only a byte-identical repeat collapses. The (PR, head OID) key is reserved
 * for object-job deduplication (objectJobIdentityKey), never for dropping
 * observations.
 */
export declare function observationIdentityKey(fact: PullRequestFactDto): string;
/**
 * Identity of one object-acquisition job: the PR plus the observed head OID.
 * Two jobs for one PR with different heads are different rows; recording
 * head B never replaces head A's job, failures or receipts.
 */
export declare function objectJobIdentityKey(job: Pick<PrObjectJobDto, "repositoryOwner" | "repositoryRepo" | "prNumber" | "headOid">): string;
/**
 * Deduplicate exact observation repeats by complete observation identity,
 * keeping one row per distinct fact. Observations whose metadata differs
 * (state, base, merge evidence, timestamp, …) are all kept: this is the
 * persistence rule (nothing erased), not the current view.
 */
export declare function deduplicatePrObservations(items: readonly PullRequestFactDto[]): readonly PullRequestFactDto[];
/**
 * Current view over observations: one row per PR identity
 * (owner/repo/number), keeping the newest updatedAt record. Computed
 * separately AFTER every distinct observation is retained, so the live head
 * never erases the observed history.
 */
export declare function deduplicatePrPageItems(items: readonly PullRequestFactDto[]): readonly PullRequestFactDto[];
/**
 * Refuse any row that does not belong to the requested repository: the
 * stored cursor and every received observation must carry the canonical
 * requested identity before any persistence or completion. A foreign row is
 * a protocol failure, never a silent adoption.
 */
export declare function assertSameRepository(expected: GithubRepositoryDto, owner: string, repo: string, what: string): void;
/**
 * ETag position key: one validator per (filter, cursor) position inside the
 * repository pass, so page N's ETag is never replayed for page M.
 */
export declare function etagPositionKey(cursor: string | null, updatedAtSince: number | null): string;
/**
 * Require the explicit end-of-list proof: hasMore false without endProof is
 * a protocol failure, never a silent completion. hasMore true without a
 * continuation cursor is the same failure class.
 */
export declare function requireEndOfListProof(page: PrPageDto): void;
/**
 * S mapping rule: metadata receipts never acknowledge a failed private
 * object acquisition. True only when every job is acquired AND verified:
 * the acquired OID equals the observed head OID, no residual error stands,
 * and known counters agree exactly (a partial count never acknowledges).
 */
export declare function canAcknowledgePrObjects(jobs: readonly PrObjectJobDto[]): boolean;
/**
 * Run one neutral PR sync pass: full pagination with overlap/dedup, durable
 * cursor advance only after proven completion, object jobs recorded as
 * pending independently of metadata, failures preserving last success with
 * stale coverage and durable retry state for automatic resume.
 */
export declare function runPrSyncPass(input: PrSyncInput, ports: {
    readonly transport: GithubPrTransportPort;
    readonly persistence: PrSyncPersistencePort;
}): Promise<PrSyncOutcome>;
