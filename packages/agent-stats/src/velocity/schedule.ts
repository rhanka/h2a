/**
 * Velocity L4 schedule: whole-graph simulation with explicit capacity.
 *
 * Quantiles come from simulated schedule outcomes, never summed per-lot
 * quantiles. WP containment and IMPLEMENTS are not precedences.
 */
import { getContract } from "./contract.js";

export interface ScheduleNode {
  id: string;
  durationSeconds: number;
}

export interface ScheduleEdge {
  from: string;
  to: string;
}

export interface TrialsSpec {
  draws: number;
  seed: number;
  samples: Record<string, number[]>;
}

export interface ScheduleInput {
  nodes: ScheduleNode[];
  edges: ScheduleEdge[];
  capacity: number;
  trials?: TrialsSpec;
}

export interface ScheduleResult {
  makespanSeconds: number;
  trialQuantiles?: { p50Seconds: number; p80Seconds: number; p95Seconds: number };
  summedP80?: number;
}

export function validateGraph(nodes: Array<{ id: string }>, edges: ScheduleEdge[]): void {
  const adjacency = new Map<string, string[]>();
  for (const node of nodes) adjacency.set(node.id, []);
  for (const edge of edges) {
    const list = adjacency.get(edge.from);
    if (!list || !adjacency.has(edge.to)) throw new Error(`unknown edge endpoint: ${edge.from}->${edge.to}`);
    list.push(edge.to);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visited.has(id)) return;
    if (visiting.has(id)) throw new Error(`graph cycle detected at ${id}`);
    visiting.add(id);
    for (const next of adjacency.get(id) ?? []) visit(next);
    visiting.delete(id);
    visited.add(id);
  };
  for (const node of nodes) visit(node.id);
}

function scheduleOnce(durations: Map<string, number>, edges: ScheduleEdge[], capacity: number): number {
  const predecessors = new Map<string, Set<string>>();
  const successors = new Map<string, Set<string>>();
  for (const id of durations.keys()) {
    predecessors.set(id, new Set());
    successors.set(id, new Set());
  }
  for (const edge of edges) {
    predecessors.get(edge.to)?.add(edge.from);
    successors.get(edge.from)?.add(edge.to);
  }
  const remaining = new Map(durations);
  const running: Array<{ id: string; finish: number }> = [];
  const finished = new Set<string>();
  let clock = 0;
  const ready = (): string[] =>
    [...remaining.keys()].filter(
      (id) => !running.some((entry) => entry.id === id) && [...(predecessors.get(id) ?? [])].every((dep) => finished.has(dep)),
    );
  while (remaining.size > 0 || running.length > 0) {
    for (const id of ready()) {
      if (running.length >= Math.max(1, capacity)) break;
      const duration = remaining.get(id) ?? 0;
      remaining.delete(id);
      running.push({ id, finish: clock + duration });
    }
    if (running.length === 0) throw new Error("deadlocked schedule: missing capacity or predecessor");
    running.sort((a, b) => a.finish - b.finish);
    const next = running.shift();
    if (!next) break;
    clock = next.finish;
    finished.add(next.id);
  }
  return clock;
}

function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

export function simulateSchedule(input: ScheduleInput): ScheduleResult {
  validateGraph(input.nodes.map((node) => ({ id: node.id })), input.edges);
  const base = new Map(input.nodes.map((node) => [node.id, node.durationSeconds]));
  const makespanSeconds = scheduleOnce(base, input.edges, input.capacity);
  if (!input.trials) return { makespanSeconds };
  const contract = getContract();
  const outcomes: number[] = [];
  const random = lcg(input.trials.seed);
  for (let draw = 0; draw < input.trials.draws; draw += 1) {
    const durations = new Map<string, number>();
    for (const node of input.nodes) {
      const samples = input.trials.samples[node.id] ?? [node.durationSeconds];
      const pick = samples[Math.floor(random() * samples.length) % samples.length];
      durations.set(node.id, pick);
    }
    outcomes.push(scheduleOnce(durations, input.edges, input.capacity));
  }
  outcomes.sort((a, b) => a - b);
  const summedP80 = input.nodes.reduce((total, node) => {
    const samples = [...(input.trials?.samples[node.id] ?? [node.durationSeconds])].sort((a, b) => a - b);
    return total + contract.nearestRank(samples, 0.8);
  }, 0);
  return {
    makespanSeconds,
    trialQuantiles: {
      p50Seconds: contract.nearestRank(outcomes, 0.5),
      p80Seconds: contract.nearestRank(outcomes, 0.8),
      p95Seconds: contract.nearestRank(outcomes, 0.95),
    },
    summedP80,
  };
}
