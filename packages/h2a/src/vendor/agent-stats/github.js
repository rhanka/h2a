/**
 * Velocity L1 GitHub collection helpers (pure, injected inputs only).
 *
 * Read-only: pagination proof, count checks, dedupe and head-SHA joins are
 * computed over explicitly supplied values. No network, no Git/Track writes.
 */
import { getContract } from "./contract.js";
export function assertCollectionComplete(state) {
    const contract = getContract();
    const diagnostics = contract.assertSnapshotComplete({
        hasNextPage: state.hasNextPage,
        totalCount: state.totalCount,
        inclusionIds: state.inclusionIds,
    });
    const out = diagnostics.map((entry) => ({
        code: entry.code,
        message: entry.message,
        path: entry.path,
    }));
    if (state.apiError) {
        out.push({ code: "api-error", message: String(state.apiError), path: "apiError" });
    }
    return out;
}
export function dedupePrNumbers(ids) {
    return getContract().dedupeIds(ids);
}
export function joinRunViaHeadSha(run, pullRequests) {
    if (run.pullRequests.length > 0)
        return run.pullRequests[0];
    const match = pullRequests.find((pr) => pr.headSha === run.headSha);
    if (!match)
        throw new Error(`no PR joins run head ${run.headSha}`);
    return match;
}
//# sourceMappingURL=github.js.map