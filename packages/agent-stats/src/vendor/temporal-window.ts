/**
 * h2a-owned temporal window filter for agent-stats project graphs.
 *
 * Provenance: logic vendored verbatim from engram `src/temporal-recall.ts`
 * (filterTemporalWindow + its local canonical helpers) at engram commit
 * e432240f8d5ea670efe672bfac52969d944cd59f. Only the closed-v1 pure
 * graph.json fallback is carried; the store/config paths of temporal-recall
 * are NOT imported. Type definitions mirror engram `src/storage/types.ts`
 * (GraphTimeWindow*) structurally so no graphology dependency is needed.
 */

import {
  TEMPORAL_INTERVAL_CONVENTION,
  closedTemporalBounds,
  overlapsClosedTemporalWindow,
} from "./temporal-interval.js";

export interface GraphTimeWindowNode {
  id: string;
  label: string;
  node_type?: string;
  community?: number;
  t: number;
  t_end?: number;
  [key: string]: unknown;
}

export interface GraphTimeWindowEdge {
  source: string;
  target: string;
  relation: string;
  confidence?: string;
  t: number;
  t_end?: number;
  [key: string]: unknown;
}

export interface GraphTimeWindow {
  interval_convention?: typeof TEMPORAL_INTERVAL_CONVENTION;
  nodes: GraphTimeWindowNode[];
  edges: GraphTimeWindowEdge[];
}

/** Minimal structural input: only nodes/links/edges are read. */
export interface TemporalSerializedGraph {
  nodes?: unknown;
  links?: unknown;
  edges?: unknown;
  [key: string]: unknown;
}

function temporalBounds(
  record: Record<string, unknown>,
  fromMs: number,
  toMs: number,
): { t: number; tEnd?: number } | undefined {
  const bounds = closedTemporalBounds(record);
  if (!bounds || !overlapsClosedTemporalWindow(record, fromMs, toMs)) return undefined;
  return bounds;
}

/**
 * The shared closed-v1 record-level membership predicate: `t <= toMs AND
 * (t_end absent OR t_end >= fromMs)`, with untimed, malformed and inverted
 * spans excluded.
 */
export function overlapsTemporalWindow(
  record: Record<string, unknown>,
  fromMs: number,
  toMs: number,
): boolean {
  return overlapsClosedTemporalWindow(record, fromMs, toMs);
}

function canonicalTemporalNode(
  raw: Record<string, unknown>,
  fromMs: number,
  toMs: number,
): GraphTimeWindowNode | undefined {
  if (typeof raw.id !== "string") return undefined;
  const bounds = temporalBounds(raw, fromMs, toMs);
  if (!bounds) return undefined;

  const { id: _rawId, ...attributes } = raw;
  const node: GraphTimeWindowNode = {
    ...attributes,
    id: raw.id,
    label: typeof raw.label === "string" && raw.label.length > 0 ? raw.label : raw.id,
    t: bounds.t,
  };

  // These are canonical GraphStore fields, so malformed file values cannot
  // spoof a different provider-neutral shape.
  delete node.node_type;
  delete node.community;
  delete node.t_end;
  if (typeof raw.node_type === "string" && raw.node_type.length > 0) {
    node.node_type = raw.node_type;
  }
  if (typeof raw.community === "number" && Number.isFinite(raw.community)) {
    node.community = raw.community;
  }
  if (bounds.tEnd !== undefined) node.t_end = bounds.tEnd;
  return node;
}

function canonicalTemporalEdge(
  raw: Record<string, unknown>,
  fromMs: number,
  toMs: number,
): GraphTimeWindowEdge | undefined {
  if (typeof raw.source !== "string" || typeof raw.target !== "string") return undefined;
  const bounds = temporalBounds(raw, fromMs, toMs);
  if (!bounds) return undefined;

  const { source: _rawSource, target: _rawTarget, ...attributes } = raw;
  const edge: GraphTimeWindowEdge = {
    ...attributes,
    source: raw.source,
    target: raw.target,
    relation: typeof raw.relation === "string" ? raw.relation : "RELATES_TO",
    t: bounds.t,
  };

  delete edge.confidence;
  delete edge.t_end;
  if (typeof raw.confidence === "string" && raw.confidence.length > 0) {
    edge.confidence = raw.confidence;
  }
  if (bounds.tEnd !== undefined) edge.t_end = bounds.tEnd;
  return edge;
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function sortWindow(window: GraphTimeWindow): GraphTimeWindow {
  const nodes = [...window.nodes].sort(
    (a, b) => a.t - b.t || compareText(a.id, b.id),
  );
  const edges = [...window.edges].sort(
    (a, b) =>
      a.t - b.t ||
      compareText(a.source, b.source) ||
      compareText(a.target, b.target) ||
      compareText(a.relation, b.relation),
  );
  return { interval_convention: TEMPORAL_INTERVAL_CONVENTION, nodes, edges };
}

/**
 * Pure graph.json fallback. Node and edge membership is deliberately
 * independent, so this is not an induced-subgraph operation.
 */
export function filterTemporalWindow(
  raw: TemporalSerializedGraph,
  fromMs: number,
  toMs: number,
): GraphTimeWindow {
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) {
    throw new RangeError("temporal window bounds must be finite numbers");
  }
  if (fromMs > toMs) {
    throw new RangeError("temporal window requires fromMs <= toMs");
  }

  const rawNodes = Array.isArray(raw.nodes) ? raw.nodes : [];
  const rawEdges = Array.isArray(raw.links)
    ? raw.links
    : Array.isArray(raw.edges)
      ? raw.edges
      : [];
  const nodes = rawNodes
    .map((node) => canonicalTemporalNode(node as Record<string, unknown>, fromMs, toMs))
    .filter((node): node is GraphTimeWindowNode => node !== undefined);
  const edges = rawEdges
    .map((edge) => canonicalTemporalEdge(edge as Record<string, unknown>, fromMs, toMs))
    .filter((edge): edge is GraphTimeWindowEdge => edge !== undefined);
  return sortWindow({ nodes, edges });
}
