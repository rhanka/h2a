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
  | "cancelled";

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
  readonly successCriteria: "all-targets-accepted" | "all-targets-done-or-waived" | "policy-expression";
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
  readonly name: string;
  readonly goal: string;
  readonly repos?: H2ALoopRepoRef[];
  readonly refs?: H2ALoopTrackRef[];
  readonly agents?: H2ALoopAgent[];
  readonly policy?: Partial<H2ALoopPolicy>;
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
  if (!input.name) throw new Error("loop create requires --name");
  if (!input.goal) throw new Error("loop create requires --goal");
  const id = input.id ?? createLoopId(now);
  const dir = loopDir(root, id);
  if (existsSync(stateFile(root, id))) throw new Error(`loop already exists: ${id}`);
  mkdirSync(dir, { recursive: true });
  const at = new Date(now).toISOString();
  const loop: H2AObjectiveLoop = {
    id,
    ownerSystem: "h2a",
    name: input.name,
    goal: input.goal,
    status: "created",
    repos: [...(input.repos ?? [])],
    refs: [...(input.refs ?? [])],
    agents: [...(input.agents ?? [])],
    policy: { ...H2A_DEFAULT_LOOP_POLICY, ...(input.policy ?? {}), requireHumanTypingGuard: true },
    createdAt: at,
    updatedAt: at
  };
  writeFileSync(stateFile(root, id), `${JSON.stringify(loop, null, 2)}\n`, "utf8");
  writeFileSync(objectiveFile(root, id), `# ${input.name}\n\n${input.goal}\n`, "utf8");
  appendLoopEvent(root, { type: "loop.created", loopId: id, at, payload: { name: input.name, goal: input.goal } });
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
