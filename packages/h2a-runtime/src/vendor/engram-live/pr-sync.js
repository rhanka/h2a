// @sentropic/engram-live/pr-sync — P1 neutral PR/object sync engine
// (spec/SPEC_LIVE_GIT_INDEXING.md §§4–5; plan/09 P1).
//
// Pagination/overlap/full-sweep reconciliation plus neutral PR/object jobs
// over INJECTED ports only: the GitHub page transport and the durable
// persistence are host-supplied fakes here (H/S implement production sides).
// Engram performs no network call, persists no token, invokes no
// repository-selected credential helper, and applies no count or age limit:
// every page is consumed, every state indexed, nothing erased.
import { PR_END_PROOF, validatePrPage, validatePrSyncCursor, validatePullRequestFact, } from "./contracts.js";
/** Neutral PR sync extractor version (checkpoints are per version). */
export const PR_SYNC_EXTRACTOR_VERSION = "engram-live/pr-sync/1";
/**
 * Overlap re-ask on incremental retries (milliseconds): the resume window
 * re-reads recently updated PRs so a page that moved during enumeration is
 * deduplicated instead of lost. Pure constant, consumed by hosts.
 */
export const PR_SYNC_OVERLAP_MS = 5 * 60 * 1000;
export class PrSyncError extends Error {
    kind;
    constructor(kind, message) {
        super(message);
        this.name = "PrSyncError";
        this.kind = kind;
    }
}
/**
 * Identity of one persisted observation: the complete observed fact. Two
 * rows sharing one head OID but differing by state, draft flag, refs, base,
 * merge evidence or timestamp are different observations and all persist;
 * only a byte-identical repeat collapses. The (PR, head OID) key is reserved
 * for object-job deduplication (objectJobIdentityKey), never for dropping
 * observations.
 */
export function observationIdentityKey(fact) {
    const mergeOid = fact.mergeOid ?? null;
    return JSON.stringify([
        fact.repositoryOwner,
        fact.repositoryRepo,
        fact.number,
        fact.state,
        fact.isDraft,
        fact.updatedAt,
        fact.headOid.algorithm,
        fact.headOid.oid,
        fact.headRef,
        fact.baseOid.algorithm,
        fact.baseOid.oid,
        fact.baseRef,
        mergeOid === null ? null : [mergeOid.algorithm, mergeOid.oid],
        fact.mergeStrategy ?? null,
    ]);
}
/**
 * Identity of one object-acquisition job: the PR plus the observed head OID.
 * Two jobs for one PR with different heads are different rows; recording
 * head B never replaces head A's job, failures or receipts.
 */
export function objectJobIdentityKey(job) {
    return `${job.repositoryOwner}/${job.repositoryRepo}#${job.prNumber}@${job.headOid.algorithm}:${job.headOid.oid}`;
}
/**
 * Deduplicate exact observation repeats by complete observation identity,
 * keeping one row per distinct fact. Observations whose metadata differs
 * (state, base, merge evidence, timestamp, …) are all kept: this is the
 * persistence rule (nothing erased), not the current view.
 */
export function deduplicatePrObservations(items) {
    const kept = new Map();
    for (const item of items) {
        const checked = validatePullRequestFact(item);
        if (!checked.ok) {
            throw new PrSyncError("protocol", `invalid PR item #${item.number}: ${checked.errors.join("; ")}`);
        }
        const key = observationIdentityKey(item);
        if (!kept.has(key)) {
            kept.set(key, item);
        }
    }
    return [...kept.values()].sort((left, right) => left.number - right.number || left.updatedAt - right.updatedAt);
}
/**
 * Current view over observations: one row per PR identity
 * (owner/repo/number), keeping the newest updatedAt record. Computed
 * separately AFTER every distinct observation is retained, so the live head
 * never erases the observed history.
 */
export function deduplicatePrPageItems(items) {
    const newest = new Map();
    for (const item of items) {
        const checked = validatePullRequestFact(item);
        if (!checked.ok) {
            throw new PrSyncError("protocol", `invalid PR item #${item.number}: ${checked.errors.join("; ")}`);
        }
        const key = `${item.repositoryOwner}/${item.repositoryRepo}#${item.number}`;
        const previous = newest.get(key);
        if (previous === undefined || item.updatedAt >= previous.updatedAt) {
            newest.set(key, item);
        }
    }
    return [...newest.values()].sort((left, right) => left.number - right.number);
}
/**
 * Refuse any row that does not belong to the requested repository: the
 * stored cursor and every received observation must carry the canonical
 * requested identity before any persistence or completion. A foreign row is
 * a protocol failure, never a silent adoption.
 */
export function assertSameRepository(expected, owner, repo, what) {
    if (owner !== expected.owner || repo !== expected.repo) {
        throw new PrSyncError("protocol", `${what} targets ${owner}/${repo} but the requested repository is ${expected.owner}/${expected.repo} (foreign rows never persist, foreign sweeps never complete)`);
    }
}
/**
 * ETag position key: one validator per (filter, cursor) position inside the
 * repository pass, so page N's ETag is never replayed for page M.
 */
export function etagPositionKey(cursor, updatedAtSince) {
    return `${updatedAtSince === null ? "-" : String(updatedAtSince)}|${cursor === null ? "<start>" : cursor}`;
}
/**
 * Require the explicit end-of-list proof: hasMore false without endProof is
 * a protocol failure, never a silent completion. hasMore true without a
 * continuation cursor is the same failure class.
 */
export function requireEndOfListProof(page) {
    const checked = validatePrPage(page);
    if (!checked.ok) {
        throw new PrSyncError("protocol", `invalid PR page: ${checked.errors.join("; ")}`);
    }
    if (page.hasMore === false && page.endProof !== PR_END_PROOF) {
        throw new PrSyncError("protocol", `PR sweep ends without end-of-list proof (hasMore false without endProof "${PR_END_PROOF}")`);
    }
    if (page.hasMore === true && (page.nextCursor === null || page.nextCursor.length === 0)) {
        throw new PrSyncError("protocol", "PR sweep continues without a continuation cursor (hasMore true without nextCursor)");
    }
}
/**
 * S mapping rule: metadata receipts never acknowledge a failed private
 * object acquisition. True only when every job is acquired AND verified:
 * the acquired OID equals the observed head OID, no residual error stands,
 * and known counters agree exactly (a partial count never acknowledges).
 */
export function canAcknowledgePrObjects(jobs) {
    if (jobs.length === 0)
        return false;
    return jobs.every((job) => {
        if (job.state !== "acquired")
            return false;
        if (job.acquiredOid === undefined || job.acquiredOid === null)
            return false;
        if (job.acquiredOid.algorithm !== job.headOid.algorithm || job.acquiredOid.oid !== job.headOid.oid)
            return false;
        if ((job.lastError ?? null) !== null)
            return false;
        const total = job.totalCommits ?? null;
        const acquired = job.acquiredCommits ?? null;
        if (total !== null && total <= 0)
            return false;
        if (total !== null && (acquired === null || acquired !== total))
            return false;
        return true;
    });
}
function staleCoverage(kind, lastSuccessAt, message) {
    const state = kind === "auth_required" || kind === "unavailable" ? "unavailable" : "stale";
    return [
        {
            axis: "pr-metadata",
            state,
            reason: `${kind}: ${message}; last success preserved, resume automatically with stale coverage`,
            ...(lastSuccessAt !== null ? { lastSuccessAt } : {}),
        },
        {
            axis: "object-availability",
            state: "unavailable",
            reason: `object jobs untouched by the metadata ${kind}; failed jobs stay failed until acquired`,
            ...(lastSuccessAt !== null ? { lastSuccessAt } : {}),
        },
        {
            axis: "pr-attribution",
            state: "partial",
            reason: "attribution stays pinned to the last observed bounds while the transport is down",
            ...(lastSuccessAt !== null ? { lastSuccessAt } : {}),
        },
    ];
}
/**
 * Recreate the pending object job of every persisted observation that has
 * none: after an interruption between saveObservation and recordObjectJob,
 * the observation is durable but its acquisition is not. The resume — this
 * pass's start and its proven end — heals that gap for retained observations,
 * even ones this sweep does not re-observe.
 */
async function ensureObjectJobsForObservations(persistence, repository) {
    const observations = await persistence.listObservations(repository);
    if (observations.length === 0)
        return;
    const jobs = await persistence.listObjectJobs(repository);
    const known = new Set(jobs.map((job) => objectJobIdentityKey(job)));
    for (const item of observations) {
        const key = objectJobIdentityKey({
            repositoryOwner: item.repositoryOwner,
            repositoryRepo: item.repositoryRepo,
            prNumber: item.number,
            headOid: item.headOid,
        });
        if (known.has(key))
            continue;
        await persistence.recordObjectJob({
            repositoryOwner: item.repositoryOwner,
            repositoryRepo: item.repositoryRepo,
            prNumber: item.number,
            headOid: item.headOid,
            state: "pending",
            attempts: 0,
            lastError: null,
            acquiredOid: null,
            totalCommits: null,
            acquiredCommits: null,
        });
        known.add(key);
    }
}
/**
 * Run one neutral PR sync pass: full pagination with overlap/dedup, durable
 * cursor advance only after proven completion, object jobs recorded as
 * pending independently of metadata, failures preserving last success with
 * stale coverage and durable retry state for automatic resume.
 */
export async function runPrSyncPass(input, ports) {
    const previous = await ports.persistence.loadCursor(input.repository);
    if (previous !== null) {
        const checked = validatePrSyncCursor(previous);
        if (!checked.ok) {
            throw new PrSyncError("protocol", `invalid stored PR cursor: ${checked.errors.join("; ")}`);
        }
        assertSameRepository(input.repository, previous.repositoryOwner, previous.repositoryRepo, "stored PR cursor");
    }
    const updatedAtSince = input.sweepKind === "incremental" && previous?.updatedAtCursor !== null && previous?.updatedAtCursor !== undefined
        ? Math.max(0, previous.updatedAtCursor - PR_SYNC_OVERLAP_MS)
        : null;
    // Validators stay bound to their position: one ETag per (filter, cursor).
    // A scalar lastEtag from an older cursor is never replayed: without a
    // recorded position it could validate the wrong page, so the request goes
    // out unconditionally instead.
    // Resume heals a prior interruption between saveObservation and
    // recordObjectJob before any new page lands.
    await ensureObjectJobsForObservations(ports.persistence, input.repository);
    const etags = { ...(previous?.etagsByCursor ?? {}) };
    const seen = [];
    const seenKeys = new Set();
    let exactDuplicates = 0;
    let cursor = null;
    let pages = 0;
    let lastEtag = previous?.lastEtag ?? null;
    let maxUpdatedAt = previous?.updatedAtCursor ?? null;
    const keepFailureCursor = async (kind, attempts, nextAfter) => {
        const kept = {
            repositoryOwner: input.repository.owner,
            repositoryRepo: input.repository.repo,
            updatedAtCursor: previous?.updatedAtCursor ?? null,
            lastSuccessAt: previous?.lastSuccessAt ?? null,
            lastEtag,
            etagsByCursor: { ...etags },
            sweepKind: input.sweepKind,
            pendingRetry: { kind, attempts, nextAfter },
        };
        await ports.persistence.saveCursor(kept);
        return kept;
    };
    for (;;) {
        const position = etagPositionKey(cursor, updatedAtSince);
        let result;
        try {
            result = await ports.transport.fetchPage({
                repository: input.repository,
                cursor,
                updatedAtSince,
                etag: etags[position] ?? null,
            });
        }
        catch (error) {
            const kind = "offline";
            const kept = await keepFailureCursor(kind, (previous?.pendingRetry?.attempts ?? 0) + 1, input.now + 60_000);
            const observations = await ports.persistence.listObservations(input.repository);
            return {
                state: "stale",
                observations,
                cursor: kept,
                coverage: staleCoverage(kind, kept.lastSuccessAt, error instanceof Error ? error.message : String(error)),
                stats: { pages, itemsSeen: seen.length, unique: 0, duplicates: exactDuplicates, observations: observations.length, objectJobsPending: 0 },
            };
        }
        if (result.ok === false) {
            const kept = await keepFailureCursor(result.kind, (previous?.pendingRetry?.attempts ?? 0) + 1, input.now + (result.retryAfterMs ?? 60_000));
            const observations = await ports.persistence.listObservations(input.repository);
            return {
                state: "stale",
                observations,
                cursor: kept,
                coverage: staleCoverage(result.kind, kept.lastSuccessAt, result.message),
                stats: { pages, itemsSeen: seen.length, unique: 0, duplicates: exactDuplicates, observations: observations.length, objectJobsPending: 0 },
            };
        }
        // Proven page first: every page is validated, and the terminator proof
        // is enforced per page so a truncated sweep never completes silently.
        const pageChecked = validatePrPage(result.page);
        if (!pageChecked.ok) {
            throw new PrSyncError("protocol", `invalid PR page: ${pageChecked.errors.join("; ")}`);
        }
        // Repository identity precedes any persistence: foreign rows never land.
        for (const item of result.page.items) {
            assertSameRepository(input.repository, item.repositoryOwner, item.repositoryRepo, `PR #${item.number} observation`);
        }
        // Per-page checkpoint: every distinct observation and its object job are
        // persisted now, so a later failure keeps the received pages. Only the
        // global success cursor waits for the proven end of list.
        for (const item of result.page.items) {
            seen.push(item);
            const key = observationIdentityKey(item);
            if (seenKeys.has(key)) {
                exactDuplicates += 1;
                continue;
            }
            seenKeys.add(key);
            await ports.persistence.saveObservation(item);
            if (maxUpdatedAt === null || item.updatedAt > maxUpdatedAt)
                maxUpdatedAt = item.updatedAt;
            // Object jobs advance independently and per OID: a new head OID adds a
            // pending job while the previous head's job — its failures and receipts
            // included — stays untouched. Metadata success never marks a job
            // acquired or failed.
            const jobs = await ports.persistence.listObjectJobs(input.repository);
            const existing = jobs.find((job) => job.prNumber === item.number
                && job.headOid.algorithm === item.headOid.algorithm
                && job.headOid.oid === item.headOid.oid);
            if (existing === undefined) {
                await ports.persistence.recordObjectJob({
                    repositoryOwner: item.repositoryOwner,
                    repositoryRepo: item.repositoryRepo,
                    prNumber: item.number,
                    headOid: item.headOid,
                    state: "pending",
                    attempts: 0,
                    lastError: null,
                    acquiredOid: null,
                    totalCommits: null,
                    acquiredCommits: null,
                });
            }
        }
        pages += 1;
        if (result.page.etag !== undefined && result.page.etag !== null) {
            lastEtag = result.page.etag;
            etags[position] = result.page.etag;
        }
        if (result.page.hasMore === false) {
            requireEndOfListProof(result.page);
            break;
        }
        requireEndOfListProof({ ...result.page, hasMore: true, nextCursor: result.page.nextCursor });
        cursor = result.page.nextCursor;
    }
    // The current view (newest per PR) is computed separately after every
    // distinct observation has been retained.
    const current = deduplicatePrPageItems(seen);
    const cursorOut = {
        repositoryOwner: input.repository.owner,
        repositoryRepo: input.repository.repo,
        updatedAtCursor: maxUpdatedAt,
        lastSuccessAt: input.now,
        lastEtag,
        etagsByCursor: { ...etags },
        sweepKind: input.sweepKind,
        pendingRetry: null,
    };
    // Proven end heals an interruption inside this sweep: every persisted
    // observation leaves with its acquisition job before completion.
    await ensureObjectJobsForObservations(ports.persistence, input.repository);
    await ports.persistence.saveCursor(cursorOut);
    const observations = await ports.persistence.listObservations(input.repository);
    const jobs = await ports.persistence.listObjectJobs(input.repository);
    const pending = jobs.filter((job) => job.state !== "acquired").length;
    const objectsAcknowledged = canAcknowledgePrObjects(jobs);
    return {
        state: "complete",
        observations,
        cursor: cursorOut,
        coverage: [
            { axis: "pr-metadata", state: "current", reason: `full sweep proven with ${PR_END_PROOF} over ${pages} pages`, lastSuccessAt: input.now },
            {
                axis: "object-availability",
                state: objectsAcknowledged ? "current" : "unavailable",
                reason: objectsAcknowledged
                    ? "every object job acquired and verified against its observed head"
                    : `${jobs.length} object job(s), ${pending} pending or failed or unverified: metadata success completes no object job`,
                lastSuccessAt: input.now,
            },
            { axis: "pr-attribution", state: "partial", reason: "attribution pins per-PR bounds separately (see pr-attribution)", lastSuccessAt: input.now },
        ],
        stats: {
            pages,
            itemsSeen: seen.length,
            unique: current.length,
            duplicates: exactDuplicates,
            observations: observations.length,
            objectJobsPending: pending,
        },
    };
}
