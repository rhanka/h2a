import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";

import { localStorePaths, safePathSegment } from "../local-files/paths.js";

export type H2ALoopStatus =
  | "created"
  | "running"
  | "waiting-human"
  | "waiting-agent"
  | "stalled"
  | "degraded"
  | "done"
  | "failed"
  | "cancelled"
  | "active"
  | "stopped"
  | "blocked";

export type H2ALoopAgentStatus =
  | "planned"
  | "launching"
  | "running"
  | "idle"
  | "working"
  | "blocked"
  | "awaiting-decision"
  | "rate-limited"
  | "out-of-tokens"
  | "dead"
  | "done"
  | "failed"
  | "cancelled";

// Canonical objective binding: h2a loops orchestrate explicit track refs rather
// than creating a parallel backlog/status store. A single objective may span
// several workspaces and repositories via multiple refs.
export interface H2ALoopTrackRef {
  readonly system: "track";
  readonly repoKey: string;
  readonly workspace: string;
  readonly aggregateKind: "item" | "decision" | "blocker" | "criterion" | "evidence" | "wp";
  readonly aggregateId: string;
  readonly role: string;
  readonly baselineCommit?: string;
}

export interface H2ALoopRepoRef {
  readonly path: string;
  readonly role?: string;
  readonly remotePath?: string;
}

export interface H2ALoopAgent {
  readonly id: string;
  readonly host: "claude" | "codex" | "agy" | "gemini" | "mistral" | "opencode" | "shell";
  readonly driver?: string;
  readonly role: string;
  readonly placement:
    | "local"
    | "remote"
    | "auto"
    | "headless-local"
    | "headless-remote"
    | "interactive-local"
    | "interactive-remote";
  readonly status: H2ALoopAgentStatus;
  readonly h2aInstance?: string;
  readonly required?: boolean;
  readonly joinedAt?: string;
  readonly remoteAgentId?: string;
  readonly remoteJobId?: string;
  readonly trackRefs?: H2ALoopTrackRef[];
}

export interface H2ALoopPolicy {
  readonly tickMs: number;
  readonly idleMs: number;
  readonly maxRelaunches: number;
  readonly requireHumanTypingGuard: true;
  readonly closeWhenRefsSatisfied: boolean;
  readonly successCriteria: "explicit-done" | "all-targets-accepted" | "all-targets-done-or-waived" | "policy-expression";
  readonly decisionGatePolicy: "all-go-or-waived" | "advisory-only";
}

export interface H2AObjectiveLoop {
  readonly id: string;
  readonly ownerSystem: "h2a";
  readonly name: string;
  readonly goal: string;
  readonly status: H2ALoopStatus;
  readonly repos: H2ALoopRepoRef[];
  readonly refs: H2ALoopTrackRef[];
  readonly agents: H2ALoopAgent[];
  readonly policy: H2ALoopPolicy;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface H2ALoopEvent {
  readonly type: string;
  readonly loopId: string;
  readonly at: string;
  readonly payload?: unknown;
}

export interface CreateObjectiveLoopInput {
  readonly id?: string;
  readonly name?: string;
  readonly goal: string;
  readonly repos?: H2ALoopRepoRef[];
  readonly refs?: H2ALoopTrackRef[];
  readonly agents?: H2ALoopAgent[];
  readonly policy?: Partial<H2ALoopPolicy>;
}

export interface LoopJoinInput {
  readonly instance: string;
  readonly agentId?: string;
  readonly role?: string;
  readonly required?: boolean;
}

export interface LoopReportInput {
  readonly instance?: string;
  readonly agentId?: string;
  readonly note: string;
  readonly artifacts?: unknown[];
}

export interface LoopDoneInput {
  readonly instance?: string;
  readonly agentId?: string;
  readonly note?: string;
  readonly overrideRefs?: boolean;
  readonly human?: boolean;
}

export interface LoopStopInput {
  readonly reason?: string;
}

export const H2A_DEFAULT_LOOP_POLICY: H2ALoopPolicy = {
  tickMs: 60_000,
  idleMs: 900_000,
  maxRelaunches: 3,
  requireHumanTypingGuard: true,
  closeWhenRefsSatisfied: false,
  successCriteria: "all-targets-accepted",
  decisionGatePolicy: "all-go-or-waived"
};

function loopsDir(root: string): string {
  return join(localStorePaths(root).root, "loops");
}

function loopDir(root: string, loopId: string): string {
  return join(loopsDir(root), safePathSegment(loopId));
}

function stateFile(root: string, loopId: string): string {
  return join(loopDir(root, loopId), "state.json");
}

function eventsFile(root: string, loopId: string): string {
  return join(loopDir(root, loopId), "events.jsonl");
}

function objectiveFile(root: string, loopId: string): string {
  return join(loopDir(root, loopId), "objective.md");
}

export function createLoopId(now: number = Date.now()): string {
  return `loop-${now.toString(36)}`;
}

export function appendLoopEvent(root: string, event: H2ALoopEvent): H2ALoopEvent {
  mkdirSync(loopDir(root, event.loopId), { recursive: true });
  appendFileSync(eventsFile(root, event.loopId), `${JSON.stringify(event)}\n`, "utf8");
  return event;
}

export function createObjectiveLoop(
  root: string,
  input: CreateObjectiveLoopInput,
  now: number = Date.now()
): H2AObjectiveLoop {
  if (!input.goal) throw new Error("loop create requires --goal");
  const id = input.id ?? createLoopId(now);
  const dir = loopDir(root, id);
  if (existsSync(stateFile(root, id))) throw new Error(`loop already exists: ${id}`);
  mkdirSync(dir, { recursive: true });
  const at = new Date(now).toISOString();
  const loop: H2AObjectiveLoop = {
    id,
    ownerSystem: "h2a",
    name: input.name ?? input.goal.slice(0, 80),
    goal: input.goal,
    status: "created",
    repos: [...(input.repos ?? [])],
    refs: [...(input.refs ?? [])],
    agents: [...(input.agents ?? [])],
    policy: {
      ...H2A_DEFAULT_LOOP_POLICY,
      successCriteria: (input.refs ?? []).length === 0 ? "explicit-done" : H2A_DEFAULT_LOOP_POLICY.successCriteria,
      ...(input.policy ?? {}),
      requireHumanTypingGuard: true
    },
    createdAt: at,
    updatedAt: at
  };
  writeFileSync(stateFile(root, id), `${JSON.stringify(loop, null, 2)}\n`, "utf8");
  writeFileSync(objectiveFile(root, id), `# ${loop.name}\n\n${input.goal}\n`, "utf8");
  appendLoopEvent(root, {
    type: "loop.created",
    loopId: id,
    at,
    payload: { name: loop.name, goal: input.goal, mode: loop.agents.length > 1 ? "collective" : "mono", refs: loop.refs, policy: loop.policy }
  });
  for (const ref of loop.refs) appendLoopEvent(root, { type: "loop.track-linked", loopId: id, at, payload: ref });
  for (const agent of loop.agents) appendLoopEvent(root, { type: "loop.agent-added", loopId: id, at, payload: agent });
  return loop;
}

export function readObjectiveLoop(root: string, loopId: string): H2AObjectiveLoop {
  const file = stateFile(root, loopId);
  if (!existsSync(file)) throw new Error(`loop not found: ${loopId}`);
  return JSON.parse(readFileSync(file, "utf8")) as H2AObjectiveLoop;
}

export function listObjectiveLoops(root: string): H2AObjectiveLoop[] {
  let names: string[];
  try {
    names = readdirSync(loopsDir(root));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const loops: H2AObjectiveLoop[] = [];
  for (const name of names) {
    try {
      const parsed = JSON.parse(readFileSync(join(loopsDir(root), name, "state.json"), "utf8")) as H2AObjectiveLoop;
      loops.push(parsed);
    } catch {
      // skip malformed loop directories
    }
  }
  return loops.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function listLoopEvents(root: string, loopId: string): H2ALoopEvent[] {
  readObjectiveLoop(root, loopId);
  const file = eventsFile(root, loopId);
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as H2ALoopEvent);
}

/**
 * Transition a loop to a new status. IDEMPOTENT: if the loop is already at
 * `status`, nothing is written and `changed:false` is returned. On a real
 * change, rewrites `state.json` (status + updatedAt) and appends `loop.closed`
 * (for "done") or `loop.status-changed`. This is the ONLY store write the
 * objective-loop tick executor performs for the `close` action — no injection.
 */
export function updateObjectiveLoopStatus(
  root: string,
  loopId: string,
  status: H2ALoopStatus,
  opts: { now?: number; reason?: string } = {}
): { changed: boolean; loop: H2AObjectiveLoop } {
  const loop = readObjectiveLoop(root, loopId);
  if (loop.status === status) return { changed: false, loop };
  const now = opts.now ?? Date.now();
  const at = new Date(now).toISOString();
  const next: H2AObjectiveLoop = { ...loop, status, updatedAt: at };
  writeFileSync(stateFile(root, loopId), `${JSON.stringify(next, null, 2)}\n`, "utf8");
  appendLoopEvent(root, {
    type: status === "done" ? "loop.closed" : "loop.status-changed",
    loopId,
    at,
    payload: { status, ...(opts.reason !== undefined ? { reason: opts.reason } : {}) }
  });
  return { changed: true, loop: next };
}


function writeLoopState(root: string, loop: H2AObjectiveLoop): H2AObjectiveLoop {
  writeFileSync(stateFile(root, loop.id), `${JSON.stringify(loop, null, 2)}\n`, "utf8");
  return loop;
}

function resolveAgent(loop: H2AObjectiveLoop, input: { readonly instance?: string; readonly agentId?: string }): H2ALoopAgent | undefined {
  if (input.agentId) return loop.agents.find((a) => a.id === input.agentId);
  if (!input.instance) return undefined;
  const matches = loop.agents.filter((a) => a.h2aInstance === input.instance || a.id === input.instance);
  return matches.length === 1 ? matches[0] : undefined;
}

export function joinObjectiveLoop(
  root: string,
  loopId: string,
  input: LoopJoinInput,
  now: number = Date.now()
): H2AObjectiveLoop {
  if (!input.instance) throw new Error("loop join requires instance");
  const loop = readObjectiveLoop(root, loopId);
  if (loop.status === "done" || loop.status === "stopped") throw new Error(`loop is terminal: ${loop.status}`);
  const at = new Date(now).toISOString();
  const id = input.agentId ?? input.instance;
  const agent: H2ALoopAgent = {
    id,
    host: "shell",
    role: input.role ?? "participant",
    placement: "local",
    status: "running",
    h2aInstance: input.instance,
    required: input.required ?? loop.agents.length === 0,
    joinedAt: at
  };
  const existing = loop.agents.find((a) => a.id === id);
  if (existing) {
    if (existing.h2aInstance === agent.h2aInstance) {
      const same = (input.role === undefined || existing.role === input.role) && (input.required === undefined || existing.required === input.required);
      if (!same) throw new Error(`agent already joined with different payload: ${id}`);
      return loop;
    }
    const canFillPlannedSlot = existing.h2aInstance === undefined && (input.role === undefined || existing.role === input.role);
    if (!canFillPlannedSlot) throw new Error(`agent already joined with different payload: ${id}`);
    const filled: H2ALoopAgent = {
      ...existing,
      status: "running",
      h2aInstance: input.instance,
      required: input.required ?? existing.required ?? loop.agents.length === 0,
      joinedAt: at
    };
    const next: H2AObjectiveLoop = { ...loop, agents: loop.agents.map((a) => a.id === id ? filled : a), updatedAt: at };
    writeLoopState(root, next);
    appendLoopEvent(root, { type: "loop.agent-joined", loopId, at, payload: { loopId, agentId: id, instance: input.instance, role: filled.role, required: filled.required, filledPlannedSlot: true, at } });
    return next;
  }
  const next: H2AObjectiveLoop = { ...loop, agents: [...loop.agents, agent], updatedAt: at };
  writeLoopState(root, next);
  appendLoopEvent(root, { type: "loop.agent-joined", loopId, at, payload: { loopId, agentId: id, instance: input.instance, role: agent.role, required: agent.required, at } });
  return next;
}

export function reportObjectiveLoop(
  root: string,
  loopId: string,
  input: LoopReportInput,
  now: number = Date.now()
): H2AObjectiveLoop {
  if (!input.note) throw new Error("loop report requires note");
  const loop = readObjectiveLoop(root, loopId);
  if (loop.status === "done" || loop.status === "stopped" || loop.status === "blocked") throw new Error(`loop is terminal: ${loop.status}`);
  const agent = resolveAgent(loop, input);
  if (!agent) throw new Error("loop report requires an unambiguous enrolled agent");
  const at = new Date(now).toISOString();
  const next: H2AObjectiveLoop = { ...loop, updatedAt: at };
  writeLoopState(root, next);
  appendLoopEvent(root, { type: "loop.agent-report", loopId, at, payload: { loopId, agentId: agent.id, instance: agent.h2aInstance, note: input.note, at, ...(input.artifacts ? { artifacts: input.artifacts } : {}) } });
  return next;
}

export function declareObjectiveLoopDone(
  root: string,
  loopId: string,
  input: LoopDoneInput = {},
  now: number = Date.now()
): H2AObjectiveLoop {
  const loop = readObjectiveLoop(root, loopId);
  if (loop.status === "done" || loop.status === "stopped") return loop;
  if (input.overrideRefs && !input.human) throw new Error("overrideRefs is CLI-only and requires human confirmation");
  const agent = input.human ? undefined : resolveAgent(loop, input);
  if (!input.human && !agent && loop.agents.length > 0) throw new Error("loop done requires an unambiguous enrolled agent");
  const at = new Date(now).toISOString();
  const canClose = loop.refs.length === 0 || input.overrideRefs === true;
  const next: H2AObjectiveLoop = { ...loop, status: canClose ? "done" : loop.status, updatedAt: at };
  writeLoopState(root, next);
  appendLoopEvent(root, { type: "loop.done-declared", loopId, at, payload: { loopId, by: input.human ? "human" : agent?.h2aInstance ?? input.instance ?? agent?.id, agentId: agent?.id, note: input.note, overrideRefs: input.overrideRefs === true, at } });
  if (canClose) appendLoopEvent(root, { type: "loop.closed", loopId, at, payload: { status: "done", reason: input.overrideRefs ? "human override" : "explicit done" } });
  return next;
}

export function stopObjectiveLoop(
  root: string,
  loopId: string,
  input: LoopStopInput = {},
  now: number = Date.now()
): H2AObjectiveLoop {
  const loop = readObjectiveLoop(root, loopId);
  if (loop.status === "done" || loop.status === "stopped") return loop;
  const at = new Date(now).toISOString();
  const next: H2AObjectiveLoop = { ...loop, status: "stopped", updatedAt: at };
  writeLoopState(root, next);
  appendLoopEvent(root, { type: "loop.stopped", loopId, at, payload: { loopId, reason: input.reason, at } });
  return next;
}
