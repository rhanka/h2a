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
  commonShocks?: Array<{ id: string; durationSeconds: number }>;
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

export function buildPlanInput(input: PlanInput): BuiltPlan {
  const ids = new Set(input.nodes.map((node) => node.id));
  for (const edge of input.edges) {
    if (!ids.has(edge.from) || !ids.has(edge.to)) {
      throw new Error(`unknown plan edge endpoint: ${edge.from}->${edge.to}`);
    }
  }
  const commonShockSeconds = (input.commonShocks ?? []).reduce((total, shock) => total + shock.durationSeconds, 0);
  const sharedReviewQueue = (input.capacities.reviewer ?? 0) === 1 && input.nodes.length > 1;
  const blockedReason =
    (input.openGates ?? []).length > 0
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

export function remainingTime(input: { quantileSeconds: number; elapsedSeconds: number }): number {
  return Math.max(0, input.quantileSeconds - input.elapsedSeconds);
}
