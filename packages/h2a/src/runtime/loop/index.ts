import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync, appendFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";

import { localStorePaths, safePathSegment } from "../local-files/paths.js";
import { isOsTemporaryPath } from "../path-safety.js";

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

export interface H2ALoopLaunchSpec {
  readonly profile: "claude" | "codex";
  readonly workspace: string;
  readonly prompt: string;
  readonly model: string;
  readonly name: string;
  readonly effort?: "low" | "medium" | "high" | "xhigh";
  readonly gateway?: "auto" | "required" | "off";
}

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
  readonly host:
    | "claude"
    | "codex"
    | "agy"
    | "gemini"
    | "mistral"
    | "hermes"
    | "opencode"
    | "shell";
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
  /** Complete opt-in specification for a canonical `h2a run` relaunch. */
  readonly launch?: H2ALoopLaunchSpec;
}

export interface H2ALoopPolicy {
  readonly tickMs: number;
  readonly idleMs: number;
  readonly maxRelaunches: number;
  readonly requireHumanTypingGuard: true;
  /**
   * Per-loop opt-in for durable, server-driven auto-ticking (L1). Default
   * false: a loop is NEVER auto-ticked unless it explicitly opts in, so
   * enabling the supervisor does not resurrect every existing loop at once
   * (the measured blast radius the double-opus review flagged). The global
   * kill-switch `H2A_LOOP_AUTOTICK_OFF` overrides this to off everywhere.
   * Optional for backward-compat: loops persisted before this field are read
   * as not-opted-in.
   */
  readonly autoTick?: boolean;
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
  readonly launch?: H2ALoopLaunchSpec;
}

export interface LoopReportInput {
  readonly instance?: string;
  readonly agentId?: string;
  readonly note: string;
  readonly artifacts?: unknown[];
  /** Explicit recovery for a legacy/staged empty loop. Never inferred. */
  readonly autoJoin?: boolean;
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
  autoTick: false,
  closeWhenRefsSatisfied: false,
  successCriteria: "all-targets-accepted",
  decisionGatePolicy: "all-go-or-waived"
};

const SAFE_LAUNCH_NAME = /^[A-Za-z0-9_-]{1,64}$/;
const SAFE_LAUNCH_MODEL = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
const MAX_LAUNCH_PROMPT_BYTES = 65_536;
const LOOP_LAUNCH_KEYS = new Set(["profile", "workspace", "prompt", "model", "name", "effort", "gateway"]);

/** Strict validation at every persistence/action boundary; returns a plain copy. */
export function validateLoopLaunchSpec(value: unknown): H2ALoopLaunchSpec {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("loop launch spec must be an object");
  }
  const raw = value as Record<string, unknown>;
  const unknown = Object.keys(raw).filter((key) => !LOOP_LAUNCH_KEYS.has(key));
  if (unknown.length > 0) throw new Error(`loop launch spec has unknown field(s): ${unknown.join(", ")}`);
  if (raw.profile !== "claude" && raw.profile !== "codex") {
    throw new Error("loop launch profile must be claude or codex");
  }
  if (typeof raw.workspace !== "string" || !isAbsolute(raw.workspace)) {
    throw new Error("loop launch workspace must be an absolute existing directory");
  }
  let workspace: string;
  try {
    workspace = realpathSync(raw.workspace);
    if (!statSync(workspace).isDirectory()) throw new Error("not-directory");
  } catch {
    throw new Error("loop launch workspace must be an absolute existing directory");
  }
  if (isOsTemporaryPath(workspace)) {
    throw new Error("loop launch workspace must be durable and may not be under the OS temporary directory");
  }
  if (typeof raw.prompt !== "string" || raw.prompt.trim().length === 0 || raw.prompt.includes("\0")) {
    throw new Error("loop launch prompt is required");
  }
  if (Buffer.byteLength(raw.prompt, "utf8") > MAX_LAUNCH_PROMPT_BYTES) {
    throw new Error(`loop launch prompt exceeds ${MAX_LAUNCH_PROMPT_BYTES} UTF-8 bytes`);
  }
  if (typeof raw.model !== "string" || !SAFE_LAUNCH_MODEL.test(raw.model)) {
    throw new Error("loop launch model is required and must be a safe model token");
  }
  if (typeof raw.name !== "string" || !SAFE_LAUNCH_NAME.test(raw.name)) {
    throw new Error('loop launch name is required (allowed: letters, digits, "_", "-")');
  }
  if (raw.effort !== undefined && !["low", "medium", "high", "xhigh"].includes(raw.effort as string)) {
    throw new Error("loop launch effort must be low, medium, high, or xhigh");
  }
  if (raw.gateway !== undefined && !["auto", "required", "off"].includes(raw.gateway as string)) {
    throw new Error("loop launch gateway must be auto, required, or off");
  }
  if (raw.profile === "codex" && raw.gateway === "required") {
    throw new Error("loop launch gateway required is supported only for claude");
  }
  return {
    profile: raw.profile,
    workspace,
    prompt: raw.prompt,
    model: raw.model,
    name: raw.name,
    ...(raw.effort !== undefined ? { effort: raw.effort as H2ALoopLaunchSpec["effort"] } : {}),
    ...(raw.gateway !== undefined ? { gateway: raw.gateway as H2ALoopLaunchSpec["gateway"] } : {})
  };
}

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
  const agents = (input.agents ?? []).map((agent) => {
    if (agent.launch === undefined) return agent;
    const launch = validateLoopLaunchSpec(agent.launch);
    if (agent.host !== launch.profile) {
      throw new Error(`loop agent host differs from launch profile: ${agent.id}`);
    }
    return { ...agent, launch };
  });
  const baseId = input.id ?? createLoopId(now);
  let id = baseId;
  mkdirSync(loopsDir(root), { recursive: true });
  let suffix = 0;
  for (;;) {
    try {
      mkdirSync(loopDir(root, id), { recursive: false });
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (input.id !== undefined) throw new Error(`loop already exists: ${id}`);
      suffix += 1;
      id = `${baseId}-${suffix}`;
    }
  }
  const dir = loopDir(root, id);
  const at = new Date(now).toISOString();
  const loop: H2AObjectiveLoop = {
    id,
    ownerSystem: "h2a",
    name: input.name ?? input.goal.slice(0, 80),
    goal: input.goal,
    status: "created",
    repos: [...(input.repos ?? [])],
    refs: [...(input.refs ?? [])],
    agents,
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

/**
 * Loop statuses that are terminal for AUTOMATIC wake (§7.3). This is the SINGLE
 * source of truth: the tick engine (`engine/tick.ts`) imports this constant for
 * its terminal / no-action gates, so the auto-tick eligibility gate below and
 * the executor can never disagree about what "terminal" means. `blocked` is
 * included deliberately — a blocked loop must not be woken by a tick; recovery
 * is explicit + CLI-only.
 */
export const H2A_TERMINAL_LOOP_STATUSES: ReadonlySet<H2ALoopStatus> = new Set([
  "done",
  "failed",
  "cancelled",
  "stopped",
  "blocked"
]);

/**
 * Fail-closed allow-list: the ONLY statuses a durable executor may auto-tick.
 * Eligibility is decided by MEMBERSHIP here, not by "not terminal" — so an
 * unknown / future / on-disk-corrupt status (never enumerated) is NOT eligible
 * by default. Together with {@link H2A_TERMINAL_LOOP_STATUSES} this partitions
 * the known `H2ALoopStatus` union (7 live + 5 terminal = 12). `waiting-human` is
 * live only as a RE-EVALUATION tick (so the loop notices the human acted); the
 * decision engine + `requireHumanTypingGuard` — not this projection — guarantee
 * no relaunch is issued while a human is the blocker.
 */
export const H2A_AUTOTICK_LIVE_STATUSES: ReadonlySet<H2ALoopStatus> = new Set([
  "created",
  "running",
  "active",
  "waiting-agent",
  "waiting-human",
  "stalled",
  "degraded"
]);

/** True once a loop has reached a status terminal for automatic wake. */
export function isLoopTerminal(loop: Pick<H2AObjectiveLoop, "status">): boolean {
  return H2A_TERMINAL_LOOP_STATUSES.has(loop.status);
}

/**
 * Global kill-switch for durable auto-ticking. When `H2A_LOOP_AUTOTICK_OFF` is
 * set to any non-empty, non-"0"/"false" value, NO loop is auto-ticked anywhere,
 * regardless of per-loop opt-in. This is the single lever to freeze the
 * supervisor without editing any loop.
 */
export function autoTickGloballyDisabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  const v = env["H2A_LOOP_AUTOTICK_OFF"];
  if (v === undefined) return false;
  const norm = v.trim().toLowerCase();
  return norm !== "" && norm !== "0" && norm !== "false";
}

/**
 * True when this loop is eligible for durable auto-ticking right now. Fail-closed
 * on every axis: the loop must (1) explicitly opt in — `policy?.autoTick === true`,
 * so a legacy/missing policy or missing field reads as not-opted-in and a shape-
 * corrupt on-disk loop never throws here; (2) be in an explicitly LIVE status
 * (unknown / terminal / corrupt status ⇒ not eligible); and (3) not be globally
 * frozen by the kill-switch.
 */
export function isLoopAutoTickEligible(
  loop: Pick<H2AObjectiveLoop, "status" | "policy">,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return (
    loop.policy?.autoTick === true &&
    H2A_AUTOTICK_LIVE_STATUSES.has(loop.status) &&
    !autoTickGloballyDisabled(env)
  );
}

/**
 * The loops the durable supervisor may auto-tick: opted-in (`policy.autoTick`),
 * in a LIVE status, and not globally disabled. Empty when the kill-switch is on.
 * Never throws on a shape-corrupt store: `listObjectiveLoops` skips unparsable
 * loop dirs, and the eligibility predicate is fail-closed on missing policy /
 * status (so a partially-written `state.json` is simply excluded, never a crash
 * that would hide every healthy loop). Read-only projection — acquiring the
 * per-loop executor lease and ticking is the supervisor's job (a later lot).
 */
export function listAutoTickLoops(
  root: string,
  env: NodeJS.ProcessEnv = process.env
): H2AObjectiveLoop[] {
  if (autoTickGloballyDisabled(env)) return [];
  return listObjectiveLoops(root).filter((loop) => isLoopAutoTickEligible(loop, env));
}

export function listLoopEvents(root: string, loopId: string): H2ALoopEvent[] {
  readObjectiveLoop(root, loopId);
  const file = eventsFile(root, loopId);
  if (!existsSync(file)) return [];
  // Fail-closed on a torn line: the event journal is a raw append log, and on a
  // shared (RWX/cross-pod) store a concurrent append can interleave a partial
  // line. One unparseable line must NOT throw out of every reader (which would
  // break the relaunch throttle and attendance); skip it instead.
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.length > 0)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as H2ALoopEvent];
      } catch {
        return [];
      }
    });
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
  const launch = input.launch === undefined ? undefined : validateLoopLaunchSpec(input.launch);
  const agent: H2ALoopAgent = {
    id,
    host: launch?.profile ?? "shell",
    role: input.role ?? "participant",
    placement: "local",
    status: "running",
    h2aInstance: input.instance,
    required: input.required ?? loop.agents.length === 0,
    joinedAt: at,
    ...(launch !== undefined ? { launch } : {})
  };
  const existing = loop.agents.find((a) => a.id === id);
  if (existing) {
    if (existing.h2aInstance === agent.h2aInstance) {
      const same = (input.role === undefined || existing.role === input.role) && (input.required === undefined || existing.required === input.required);
      if (!same) throw new Error(`agent already joined with different payload: ${id}`);
      if (launch !== undefined && existing.launch !== undefined && JSON.stringify(existing.launch) !== JSON.stringify(launch)) {
        throw new Error(`agent already joined with different launch spec: ${id}`);
      }
      if (launch !== undefined && existing.launch === undefined) {
        if (existing.host !== "shell" && existing.host !== launch.profile) {
          throw new Error(`agent host differs from launch profile: ${id}`);
        }
        const configured: H2ALoopAgent = { ...existing, host: launch.profile, launch };
        const next: H2AObjectiveLoop = {
          ...loop,
          agents: loop.agents.map((a) => a.id === id ? configured : a),
          updatedAt: at
        };
        writeLoopState(root, next);
        appendLoopEvent(root, {
          type: "loop.agent-launch-configured",
          loopId,
          at,
          payload: { loopId, agentId: id, profile: launch.profile, workspace: launch.workspace, name: launch.name, at }
        });
        return next;
      }
      return loop;
    }
    const canFillPlannedSlot = existing.h2aInstance === undefined && (input.role === undefined || existing.role === input.role);
    if (!canFillPlannedSlot) throw new Error(`agent already joined with different payload: ${id}`);
    if (launch !== undefined && existing.host !== "shell" && existing.host !== launch.profile) {
      throw new Error(`planned agent host differs from launch profile: ${id}`);
    }
    if (launch !== undefined && existing.launch !== undefined && JSON.stringify(existing.launch) !== JSON.stringify(launch)) {
      throw new Error(`planned agent has a different launch spec: ${id}`);
    }
    const filled: H2ALoopAgent = {
      ...existing,
      ...(launch !== undefined ? { host: launch.profile, launch } : {}),
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
  let loop = readObjectiveLoop(root, loopId);
  if (loop.status === "done" || loop.status === "stopped" || loop.status === "blocked") throw new Error(`loop is terminal: ${loop.status}`);
  let agent = resolveAgent(loop, input);
  if (!agent && input.autoJoin === true) {
    if (!input.instance) {
      throw new Error("loop report --auto-join requires an explicit instance");
    }
    if (loop.agents.length !== 0) {
      throw new Error("loop report auto-join is only valid for an empty loop; call h2a_loop_join explicitly");
    }
    loop = joinObjectiveLoop(root, loopId, {
      instance: input.instance,
      ...(input.agentId ? { agentId: input.agentId } : {}),
      role: "conductor",
      required: true
    }, now);
    agent = resolveAgent(loop, input);
  }
  if (!agent) {
    throw new Error("loop report requires an unambiguous enrolled agent; call h2a_loop_join first (or use autoJoin:true with an explicit instance on an empty loop)");
  }
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
