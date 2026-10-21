/**
 * Velocity L4 plan input: explicit nodes, edges and capacities (read-only).
 *
 * The plan port receives explicit IDs, precedence edges and capacities; it
 * never re-folds the Track journal nor invents edges from titles.
 */
export function buildPlanInput(input) {
    const ids = new Set(input.nodes.map((node) => node.id));
    for (const edge of input.edges) {
        if (!ids.has(edge.from) || !ids.has(edge.to)) {
            throw new Error(`unknown plan edge endpoint: ${edge.from}->${edge.to}`);
        }
    }
    const commonShockSeconds = (input.commonShocks ?? []).reduce((total, shock) => total + shock.durationSeconds, 0);
    const sharedReviewQueue = (input.capacities.reviewer ?? 0) === 1 && input.nodes.length > 1;
    const blockedReason = (input.openGates ?? []).length > 0
        ? `unresolved gate: ${(input.openGates ?? []).join(", ")}`
        : Object.keys(input.capacities).length === 0
            ? "missing capacity: no unconditional completion timestamp"
            : undefined;
    return {
        nodes: input.nodes,
        edges: input.edges,
        capacities: input.capacities,
        sharedReviewQueue,
        commonShockSeconds,
        completionAt: null,
        blockedReason,
    };
}
export function remainingTime(input) {
    return Math.max(0, input.quantileSeconds - input.elapsedSeconds);
}
//# sourceMappingURL=plan-input.js.map