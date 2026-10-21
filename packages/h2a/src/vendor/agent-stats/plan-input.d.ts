/**
 * Velocity L4 plan input: explicit nodes, edges and capacities (read-only).
 *
 * The plan port receives explicit IDs, precedence edges and capacities; it
 * never re-folds the Track journal nor invents edges from titles.
 */
export interface PlanNode {
    id: string;
    durationSeconds: number;
}
export interface PlanEdge {
    from: string;
    to: string;
}
export interface PlanInput {
    nodes: PlanNode[];
    edges: PlanEdge[];
    capacities: Record<string, number>;
    openGates?: string[];
    commonShocks?: Array<{
        id: string;
        durationSeconds: number;
    }>;
}
export interface BuiltPlan {
    nodes: PlanNode[];
    edges: PlanEdge[];
    capacities: Record<string, number>;
    sharedReviewQueue: boolean;
    commonShockSeconds: number;
    completionAt: null;
    blockedReason?: string;
}
export declare function buildPlanInput(input: PlanInput): BuiltPlan;
export declare function remainingTime(input: {
    quantileSeconds: number;
    elapsedSeconds: number;
}): number;
//# sourceMappingURL=plan-input.d.ts.map