// Objective-loop tick — IO ADAPTERS (imperative shell).
//
// This is the ONLY loop-engine file allowed to reach `@sentropic/h2a-runtime`
// (lazy import). `decision.ts` and `tick.ts` stay runtime-free; the golden-rule
// scan in `remote-facade.test.js` enforces it. Consuming the TYPED projection
// (not parsed CLI stdout) is a double-consensus ruling (2026-07-02).

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { EventStore, Track } from "@sentropic/track";

import type { H2ALaunchContext } from "../../../session.js";
import type { H2ADriveRequest, H2ADriver } from "../../drive/index.js";
import { listDrumbeat, type H2ADrumbeatEntry } from "../../drumbeat/registry.js";
import {
  defaultRelauncherRuntime,
  paneHasRecentHumanActivity,
  tmuxSendSubmit,
  tmuxTarget,
  type RelauncherRuntime
} from "../../drumbeat/relaunchers.js";
import { createLocalStore } from "../../local-files/store.js";
import { listPresence } from "../../local-files/presence.js";
import { isOsTemporaryPath } from "../../path-safety.js";
import {
  listLoopEvents,
  readObjectiveLoop,
  updateObjectiveLoopStatus,
  validateLoopLaunchSpec,
  type H2ALoopDecisionGate,
  type H2ALoopLaunchSpec,
  type H2AObjectiveLoop,
  type H2ALoopTrackRef
} from "../index.js";
import { loopRefLocator, type AgentsSnapshot, type InboxSnapshot, type PendingDecision, type PresenceSnapshot, type PresenceView, type ProjectedAgent, type RefsRollup, type RefStatus, type TickAction } from "./decision.js";
import type { ActionContext, ActionEffectResult, ActionSink } from "./execute.js";

// --- Agents adapter (lazy runtime; degraded-clean on absence/failure) ---------
export async function readAgents(): Promise<AgentsSnapshot> {
  // Variable-typed specifier defeats tsc static resolution: `@sentropic/h2a`
  // must NEVER hard-depend on the heavy runtime (same trick as bin.ts).
  const RUNTIME_PKG: string = "@sentropic/h2a-runtime";
  try {
    const rt = (await import(RUNTIME_PKG)) as {
      projectAgentsForH2a?: () => { version?: number; agents?: unknown[] };
    };
    if (typeof rt.projectAgentsForH2a !== "function") {
      return { degraded: true, agents: [] };
    }
    const env = rt.projectAgentsForH2a();
    const agents = Array.isArray(env.agents) ? (env.agents as ProjectedAgent[]) : [];
    return {
      degraded: false,
      ...(typeof env.version === "number" ? { version: env.version } : {}),
      agents,
    };
  } catch {
    // Runtime not installed or failed → degraded; NEVER invent agent state.
    return { degraded: true, agents: [] };
  }
}

// --- Presence adapter (independent of runtime agents projection) --------------
// Interactive Claude/Codex sessions are often present on the h2a bus without
// being runtime-launched agents. The pure core needs that presence as plain data
// so it can plan a wake instead of an ask-only launch request.

/**
 * Resolve the self-declared work status the pure R3 idle gate consumes. The
 * presence FILE never carries `workStatus`: the host stop hook records it in the
 * durable drumbeat REGISTRY (`h2a drumbeat record --status …` → `recordStop`),
 * NOT in presence (see drumbeat/registry.ts). Without folding the registry back
 * in, the R3 gate's `paused`/`out-of-tokens` fast-path is permanently dead and a
 * just-stopped agent is never relanced until 15 min of MCP silence — the bug
 * behind "the objective-loop does not relance like /loop".
 *
 * A durable stop entry is honored ONLY when it is not terminal (an
 * escalated/rerouted stop is resolved) AND has NOT been superseded by fresher MCP
 * activity: if the agent has made a tool call since it declared the stop
 * (`lastMcpActivityAt > stoppedAt`) it has resumed, so the sticky `paused` entry
 * must NOT re-wake it — that is exactly the over-wake the R3 gate guards against.
 * A live presence `workStatus` (should the presence layer ever set one) always
 * wins over the registry. PURE: timestamps in, status out.
 */
export function resolveDeclaredWorkStatus(
  entry: H2ADrumbeatEntry | undefined,
  lastActivityAtMs: number | undefined
): string | undefined {
  if (!entry || entry.terminal !== undefined) return undefined;
  const stoppedAtMs = Date.parse(entry.stoppedAt);
  if (Number.isNaN(stoppedAtMs)) return undefined;
  if (lastActivityAtMs !== undefined && lastActivityAtMs > stoppedAtMs) return undefined;
  return entry.workStatus;
}

export function readPresenceSnapshot(root: string, now: number): PresenceSnapshot {
  const byInstance = new Map<string, PresenceView>();
  // Fold the durable drumbeat stop registry (keyed case-insensitively, like h2a
  // addressing) so the pure core sees self-declared stop status as plain data.
  const stopByInstance = new Map<string, H2ADrumbeatEntry>();
  try {
    for (const entry of listDrumbeat(root)) stopByInstance.set(entry.instance.toLowerCase(), entry);
  } catch {
    // registry unreadable → no self-declared status; the activity gate still applies.
  }
  for (const session of listPresence(root, { now })) {
    const lastActivityAtMs =
      session.lastMcpActivityAt === undefined ? undefined : Date.parse(session.lastMcpActivityAt);
    const safeLastActivityAtMs =
      lastActivityAtMs !== undefined && !Number.isNaN(lastActivityAtMs) ? lastActivityAtMs : undefined;
    // Presence's own workStatus wins; otherwise fold in the durable stop registry.
    const workStatus =
      session.workStatus ??
      resolveDeclaredWorkStatus(stopByInstance.get(session.instance.toLowerCase()), safeLastActivityAtMs);
    const view: PresenceView = {
      instance: session.instance,
      liveSession: true,
      hasTmuxLaunchContext: session.launchContext?.tmux !== undefined,
      // Drumbeat self-declared status (DEC-084) feeds the R3 idle gate in the core.
      ...(workStatus !== undefined ? { workStatus } : {}),
      ...(safeLastActivityAtMs !== undefined ? { lastActivityAtMs: safeLastActivityAtMs } : {})
    };
    // Key by folded instance: h2a addressing is case-insensitive/slug-stable
    // (0.40.0), so an enrolment whose casing differs from the presence record
    // must still resolve. The decision core folds the lookup identically.
    const key = session.instance.toLowerCase();
    const existing = byInstance.get(key);
    if (existing?.hasTmuxLaunchContext === true && !view.hasTmuxLaunchContext) continue;
    if (
      existing?.hasTmuxLaunchContext === view.hasTmuxLaunchContext &&
      existing.lastActivityAtMs !== undefined &&
      (view.lastActivityAtMs === undefined || existing.lastActivityAtMs > view.lastActivityAtMs)
    ) {
      continue;
    }
    byInstance.set(key, view);
  }
  return { byInstance };
}

// --- Track refs rollup adapter (READ-ONLY; single-writer preserved) -----------
// Resolves each declared loop ref to a status via the `track` CLI read seam
// (`track query --format json`, one query per loop repo, indexed by id). No
// writes → the append-only single-writer contract is never touched. Track absent
// / no repo answered → `degraded:true` (the pure core then never auto-closes).

/** Shape of a `track query --format json` row we consume. */
interface TrackQueryRow {
  readonly id?: string;
  readonly bucket?: string;
  readonly realization?: string;
  readonly acceptance?: string;
}

/**
 * PURE mapping: a track item's (bucket, realization, acceptance) → loop RefStatus.
 * Buckets: AWAITED | DROPPED | DONE | TO-DO. Conservative + unit-tested so the
 * semantics stay explicit and easy to tune. Unknown/missing → "unknown" (the
 * core treats that as NOT satisfied → never auto-closes on it).
 */
export function mapTrackAggregateToRefStatus(item: TrackQueryRow | undefined): RefStatus {
  if (!item) return "unknown";
  const bucket = (item.bucket ?? "").toUpperCase();
  const acceptance = (item.acceptance ?? "").toLowerCase();
  const realization = (item.realization ?? "").toLowerCase();
  if (bucket === "DONE") {
    return acceptance === "accepted" || acceptance === "pass" ? "accepted" : "done";
  }
  if (bucket === "DROPPED" || realization === "cancelled") return "rejected";
  if (bucket === "AWAITED" || bucket === "TO-DO") return "pending";
  return "unknown";
}

export function readRefsRollup(loop: H2AObjectiveLoop): RefsRollup {
  // No refs declared → nothing to resolve; not degraded (no track call).
  if (loop.refs.length === 0) return { degraded: false, refs: [] };

  const cwds = loop.repos.map((r) => r.path).filter((p): p is string => !!p);
  if (cwds.length === 0) cwds.push(process.cwd());

  const itemsById = new Map<string, TrackQueryRow>();
  let anyQueryOk = false;
  for (const cwd of cwds) {
    const res = spawnSync("track", ["query", "--format", "json"], { cwd, encoding: "utf8" });
    if (res.error || res.status !== 0 || !res.stdout) continue;
    try {
      const rows = JSON.parse(res.stdout) as unknown;
      if (Array.isArray(rows)) {
        anyQueryOk = true;
        for (const row of rows as TrackQueryRow[]) {
          if (row && typeof row.id === "string") itemsById.set(row.id, row);
        }
      }
    } catch {
      // non-JSON output → ignore this repo
    }
  }

  // `track` unreachable in every repo → degraded (do not invent ref state).
  if (!anyQueryOk) return { degraded: true, refs: [] };

  return {
    degraded: false,
    refs: loop.refs.map((r) => ({
      locator: loopRefLocator(r),
      status: mapTrackAggregateToRefStatus(itemsById.get(r.aggregateId)),
    })),
  };
}

// --- Inbox adapter (READ-ONLY) ------------------------------------------------
// The h2a bus is a negotiation protocol (register/propose/accept/reject/counter/
// withdraw/event/escalate). The clearest "needs a human/agent decision" signal is
// an `escalate` envelope sitting in an enrolled agent's inbox. We surface those as
// pending decisions so the loop reports `waiting-human` and routes them.
// TODO(next): also correlate unresolved `propose` (no matching accept/reject).

/** PURE: escalations in an inbox → pending decisions for `agentId`. */
export function pendingDecisionsFromInbox(
  envelopes: readonly { readonly id: string; readonly type: string }[],
  agentId: string,
): PendingDecision[] {
  return envelopes
    .filter((e) => e.type === "escalate")
    .map((e) => ({ id: e.id, forAgent: agentId }));
}

export function readInbox(loop: H2AObjectiveLoop, root: string): InboxSnapshot {
  const enrolled = loop.agents
    .map((a) => ({ agentId: a.id, instance: a.h2aInstance }))
    .filter((x): x is { agentId: string; instance: string } => typeof x.instance === "string");
  if (enrolled.length === 0) return { pendingDecisions: [] };

  let store: ReturnType<typeof createLocalStore>;
  try {
    store = createLocalStore({ root });
  } catch {
    return { pendingDecisions: [] };
  }

  const pending: PendingDecision[] = [];
  const seen = new Set<string>();
  for (const { agentId, instance } of enrolled) {
    let envelopes: Array<{ id: string; type: string }>;
    try {
      envelopes = store.readInbox(instance) as Array<{ id: string; type: string }>;
    } catch {
      continue;
    }
    for (const d of pendingDecisionsFromInbox(envelopes, agentId)) {
      if (!seen.has(d.id)) {
        seen.add(d.id);
        pending.push(d);
      }
    }
  }
  return { pendingDecisions: pending };
}

// --- Wake targeting (PURE decision; the tmux send is delegated to the driver) --
export type WakePlan =
  | {
      readonly kind: "wake";
      readonly instance: string;
      readonly host?: string;
      readonly launchContext: H2ALaunchContext;
      readonly instructionLine: string;
    }
  | { readonly kind: "skip"; readonly reason: string };

const WAKE_COOLDOWN_FLOOR_MS = 300_000; // 5 min

/**
 * PURE: given the loop, a target agent id, the FRESH sessions (already
 * expiry-filtered by listPresence) and prior wake timestamps, decide whether to
 * wake (and with what launchContext/line) or skip (and why). No IO. Freshness +
 * cooldown are the safety gates BEFORE the driver's own human-typing guard.
 */
export function planWakeTarget(input: {
  readonly loop: H2AObjectiveLoop;
  readonly agentId: string;
  readonly freshSessions: readonly { readonly instance: string; readonly launchContext?: H2ALaunchContext }[];
  readonly priorWakeAtByAgent: ReadonlyMap<string, number>;
  readonly priorWakeCountByAgent?: ReadonlyMap<string, number>;
  readonly now: number;
}): WakePlan {
  const agent = input.loop.agents.find((a) => a.id === input.agentId);
  if (!agent || agent.h2aInstance === undefined) return { kind: "skip", reason: "no-h2a-instance" };
  const maxRelaunches = input.loop.policy.maxRelaunches ?? Number.POSITIVE_INFINITY;
  if ((input.priorWakeCountByAgent?.get(input.agentId) ?? 0) >= maxRelaunches) {
    return { kind: "skip", reason: "max-relaunches" };
  }
  const cooldownMs = Math.max(input.loop.policy.tickMs, WAKE_COOLDOWN_FLOOR_MS);
  const last = input.priorWakeAtByAgent.get(input.agentId);
  if (last !== undefined && input.now - last < cooldownMs) return { kind: "skip", reason: "cooldown" };
  const session = input.freshSessions.find(
    (s) => s.instance === agent.h2aInstance && s.launchContext?.tmux !== undefined
  );
  if (!session || !session.launchContext || !session.launchContext.tmux) {
    return { kind: "skip", reason: "no-fresh-tmux-session" };
  }
  const instructionLine =
    `[h2a-wake reason=loop loopId=${input.loop.id} at=${new Date(input.now).toISOString()}] ` +
    `reprends l'objectif: ${input.loop.goal}`;
  return {
    kind: "wake",
    instance: agent.h2aInstance,
    ...(agent.host !== undefined ? { host: agent.host } : {}),
    launchContext: session.launchContext,
    instructionLine
  };
}

/** PURE: latest applied-wake epoch ms per agent, from the loop event journal. */
export function priorWakeAtByAgent(
  events: readonly { readonly type: string; readonly at: string; readonly payload?: unknown }[]
): Map<string, number> {
  const out = new Map<string, number>();
  for (const e of events) {
    if (e.type !== "loop.action.applied") continue;
    const p = e.payload as { action?: string; key?: string } | undefined;
    if (!p || p.action !== "wake" || typeof p.key !== "string" || !p.key.startsWith("wake:")) continue;
    const agentId = p.key.slice("wake:".length);
    const at = Date.parse(e.at);
    if (Number.isNaN(at)) continue;
    const prev = out.get(agentId);
    if (prev === undefined || at > prev) out.set(agentId, at);
  }
  return out;
}

export interface RelaunchHistory {
  readonly count: number;
  readonly latestAt?: number;
  readonly retryForbidden?: boolean;
}

/** Durable applied+failed attempt fold. Deferred/skipped events consume nothing. */
export function priorActionAttemptsByAgent(
  events: readonly { readonly type: string; readonly at: string; readonly payload?: unknown }[],
  action: "wake" | "request-launch"
): Map<string, RelaunchHistory> {
  const out = new Map<string, RelaunchHistory>();
  for (const event of events) {
    if (event.type !== "loop.action.applied" && event.type !== "loop.action.failed") continue;
    const payload = event.payload as { action?: string; key?: string; retrySafe?: boolean } | undefined;
    if (payload?.action !== action || typeof payload.key !== "string" || !payload.key.startsWith(`${action}:`)) continue;
    const agentId = payload.key.slice(`${action}:`.length);
    const prior = out.get(agentId) ?? { count: 0 };
    const parsedAt = Date.parse(event.at);
    out.set(agentId, {
      count: prior.count + 1,
      ...(!Number.isNaN(parsedAt) && (prior.latestAt === undefined || parsedAt > prior.latestAt)
        ? { latestAt: parsedAt }
        : prior.latestAt !== undefined ? { latestAt: prior.latestAt } : {}),
      ...((prior.retryForbidden === true || payload.retrySafe === false) ? { retryForbidden: true } : {})
    });
  }
  return out;
}

/** Shared per-agent wake+launch budget required by the loop relaunch policy. */
export function priorRelaunchAttemptsByAgent(
  events: readonly { readonly type: string; readonly at: string; readonly payload?: unknown }[]
): Map<string, RelaunchHistory> {
  const out = new Map<string, RelaunchHistory>();
  for (const event of events) {
    if (event.type !== "loop.action.applied" && event.type !== "loop.action.failed") continue;
    const payload = event.payload as { action?: string; key?: string; retrySafe?: boolean } | undefined;
    if (
      (payload?.action !== "wake" && payload?.action !== "request-launch") ||
      typeof payload.key !== "string" ||
      !payload.key.startsWith(`${payload.action}:`)
    ) continue;
    const agentId = payload.key.slice(`${payload.action}:`.length);
    const prior = out.get(agentId) ?? { count: 0 };
    const parsedAt = Date.parse(event.at);
    out.set(agentId, {
      count: prior.count + 1,
      ...(!Number.isNaN(parsedAt) && (prior.latestAt === undefined || parsedAt > prior.latestAt)
        ? { latestAt: parsedAt }
        : prior.latestAt !== undefined ? { latestAt: prior.latestAt } : {}),
      ...((prior.retryForbidden === true || payload.retrySafe === false) ? { retryForbidden: true } : {})
    });
  }
  return out;
}

// --- Launch request targeting (PURE intent; guarded spawn stays in the sink) --
export type LaunchPlan =
  | { readonly kind: "emit"; readonly host?: string; readonly reason: string }
  | { readonly kind: "skip"; readonly reason: string };

/**
 * PURE: decide whether to ASK for a launch of a missing enrolled agent. Bounded
 * by `policy.maxRelaunches` (stop asking after N) + a per-agent cooldown. h2a
 * ASKS (records in the loop journal / — later — an envelope to a remote); it
 * NEVER spawns arbitrary agents itself (spec objective-loop §Non-goals).
 */
export function planLaunchTarget(input: {
  readonly loop: H2AObjectiveLoop;
  readonly agentId: string;
  readonly priorCount: number;
  readonly priorLatestAt?: number;
  readonly retryForbidden?: boolean;
  readonly now: number;
}): LaunchPlan {
  const agent = input.loop.agents.find((a) => a.id === input.agentId);
  if (!agent) return { kind: "skip", reason: "unknown-agent" };
  if (input.retryForbidden === true) return { kind: "skip", reason: "prior-launch-state-unknown" };
  if (agent.launch === undefined) return { kind: "skip", reason: "no-launch-spec" };
  if (input.priorCount >= input.loop.policy.maxRelaunches) return { kind: "skip", reason: "max-relaunches" };
  const cooldownMs = Math.max(input.loop.policy.tickMs, WAKE_COOLDOWN_FLOOR_MS);
  if (input.priorLatestAt !== undefined && input.now - input.priorLatestAt < cooldownMs) {
    return { kind: "skip", reason: "cooldown" };
  }
  return {
    kind: "emit",
    ...(agent.host !== undefined ? { host: agent.host } : {}),
    reason: "enrolled agent missing while work pending"
  };
}

/** PURE: prior launch-request count + latest epoch ms per agent, from the journal. */
export function priorLaunchByAgent(
  events: readonly { readonly type: string; readonly at: string; readonly payload?: unknown }[]
): Map<string, RelaunchHistory> {
  return priorRelaunchAttemptsByAgent(events);
}

export const H2A_RUN_API_VERSION = "h2a.run/v1";

export interface LoopLaunchInvocation {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly input: string;
}

export interface LoopLaunchResult {
  readonly ok: boolean;
  readonly detail?: string;
  readonly retrySafe?: boolean;
}

export interface LoopLauncher {
  launch(spec: H2ALoopLaunchSpec): LoopLaunchResult | Promise<LoopLaunchResult>;
}

function isWithin(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/**
 * Last action-boundary guard. A persisted launch may target only the controller
 * workspace or an explicitly declared loop repository. This mirrors h2a_run's
 * startup-root boundary and prevents a forged/stale loop state from launching
 * an agent in an arbitrary readable directory.
 */
export function loopLaunchWorkspaceAllowed(
  loop: H2AObjectiveLoop,
  spec: H2ALoopLaunchSpec,
  controllerRoot = process.cwd()
): boolean {
  try {
    if (isOsTemporaryPath(spec.workspace)) return false;
  } catch {
    return false;
  }
  const roots = [controllerRoot, ...loop.repos.map((repo) => repo.path)];
  for (const candidateRoot of roots) {
    try {
      const root = realpathSync(candidateRoot);
      if (statSync(root).isDirectory() && isWithin(root, spec.workspace)) return true;
    } catch {
      // An absent/malformed declared root grants no authority.
    }
  }
  return false;
}

export function buildLoopLaunchInvocation(
  value: H2ALoopLaunchSpec,
  bin = fileURLToPath(new URL("../../../bin.js", import.meta.url))
): LoopLaunchInvocation {
  const spec = validateLoopLaunchSpec(value);
  return {
    command: process.execPath,
    args: [
      bin,
      "run",
      spec.profile,
      spec.workspace,
      "--no-attach",
      "--background",
      "--json",
      "--name",
      spec.name,
      "--prompt-stdin",
      "--h2a",
      ...(spec.gateway === "required" ? ["--gw"] : spec.gateway === "off" ? ["--no-gw"] : []),
      "--model",
      spec.model,
      ...(spec.effort !== undefined ? ["--effort", spec.effort] : [])
    ],
    cwd: spec.workspace,
    input: spec.prompt
  };
}

function validateLoopLaunchResult(value: unknown, spec: H2ALoopLaunchSpec): void {
  if (!value || typeof value !== "object") throw new Error("launch output is not an object");
  const result = value as Record<string, unknown>;
  const session = result.session as Record<string, unknown> | undefined;
  const attach = result.attach as Record<string, unknown> | undefined;
  const attachArgs = attach?.args;
  // The native-terminal host keys a session by name, not a tmux pane, so a native
  // `h2a.run.result` omits `session.pane` and stamps `session.host = "native"`.
  // The `%N` pane shape is therefore required only for the tmux host (missing
  // host = legacy tmux); an unrecognized host value is rejected. Mirrors the
  // MCP h2a_run validator in runtime/mcp/agent-launch.ts.
  const host = session?.host;
  const isNative = host === "native";
  const hostOk = host === undefined || host === "native" || host === "tmux";
  const paneOk = isNative
    ? session === undefined ||
      session.pane === undefined ||
      typeof session.pane === "string"
    : Boolean(session) &&
      typeof session!.pane === "string" &&
      /^%\d+$/.test(session!.pane as string);
  const gatewayIsEffective = spec.profile === "codex" || spec.gateway === "off"
    ? session?.gateway === "direct"
    : spec.gateway === "required"
      ? session?.gateway === "gateway"
      : session?.gateway === "gateway" || session?.gateway === "direct";
  if (
    result.kind !== "h2a.run.result" ||
    result.version !== 1 ||
    result.apiVersion !== H2A_RUN_API_VERSION ||
    typeof result.runtimeVersion !== "string" ||
    !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(result.runtimeVersion) ||
    result.ok !== true ||
    result.state !== "started" ||
    !session ||
    session.id !== spec.name ||
    !hostOk ||
    typeof session.tmuxSession !== "string" ||
    session.tmuxSession.length === 0 ||
    !paneOk ||
    session.profile !== spec.profile ||
    session.workspace !== spec.workspace ||
    session.mode !== "interactive" ||
    session.background !== true ||
    session.h2aSidecar !== true ||
    !Number.isInteger(session.pid) ||
    (session.pid as number) <= 0 ||
    !gatewayIsEffective ||
    !attach ||
    attach.command !== "h2a" ||
    !Array.isArray(attachArgs) ||
    attachArgs.length !== 2 ||
    attachArgs[0] !== "attach" ||
    attachArgs[1] !== spec.name
  ) {
    throw new Error("invalid h2a.run.result contract");
  }
}

export function executeLoopLaunchWithSpawn(
  value: H2ALoopLaunchSpec,
  spawn: typeof spawnSync = spawnSync
): LoopLaunchResult {
  const spec = validateLoopLaunchSpec(value);
  const invocation = buildLoopLaunchInvocation(spec);
  const result = spawn(invocation.command, [...invocation.args], {
    cwd: invocation.cwd,
    input: invocation.input,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    shell: false,
    timeout: 30_000,
    maxBuffer: 1_048_576
  });
  if (result.error) {
    const code = (result.error as NodeJS.ErrnoException).code;
    return {
      ok: false,
      detail: code === "ETIMEDOUT" ? "launch status unknown after runtime timeout" : result.error.message,
      retrySafe: false
    };
  }
  if (result.status !== 0) {
    const detail = (result.stderr ?? "").trim().slice(-2_000);
    return {
      ok: false,
      detail: `h2a run failed (exit ${result.status ?? "?"})${detail ? `: ${detail}` : ""}`,
      retrySafe: !/already exists|duplicate/i.test(detail)
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse((result.stdout ?? "").trim());
    validateLoopLaunchResult(parsed, spec);
  } catch (error) {
    return { ok: false, detail: `incompatible h2a runtime: ${(error as Error).message}`, retrySafe: false };
  }
  return { ok: true, detail: `started ${spec.profile} session ${spec.name}` };
}

const defaultLoopLauncher: LoopLauncher = {
  launch(spec) {
    return executeLoopLaunchWithSpawn(spec);
  }
};

export type LoopWakeOutcome = "done" | "deferred-human" | "failed";

export interface LoopWakeDriver {
  drive(request: H2ADriveRequest): LoopWakeOutcome | Promise<LoopWakeOutcome>;
}

/** Typed local-tmux seam: human deferral and transport failure are distinct. */
export function localTmuxLoopWakeDriver(options: {
  runtime?: Pick<RelauncherRuntime, "run" | "capture">;
  log?: (line: string) => void;
} = {}): LoopWakeDriver {
  const runtime = options.runtime ?? defaultRelauncherRuntime;
  return {
    drive(request) {
      const tmux = request.launchContext?.tmux;
      if (!tmux) return "failed";
      const target = tmuxTarget(tmux);
      if (paneHasRecentHumanActivity(runtime, target)) {
        options.log?.(`loop-wake[local-tmux]: ${request.to} -> ${target} deferred-human`);
        return "deferred-human";
      }
      const ok = tmuxSendSubmit(runtime, target, request.instructionLine);
      options.log?.(`loop-wake[local-tmux]: ${request.to} -> ${target} ${ok ? "done" : "failed"}`);
      return ok ? "done" : "failed";
    }
  };
}

const LOOP_DECISION_ACTOR = "h2a:loop-supervisor";

function isStructuredDecisionGate(
  ref: H2ALoopTrackRef,
): ref is H2ALoopTrackRef & { readonly decisionGate: H2ALoopDecisionGate } {
  const gate = ref.decisionGate;
  return ref.role === "decision-gate" &&
    gate !== undefined &&
    typeof gate.id === "string" && gate.id.length > 0 &&
    (gate.decisionKind === "orientation" || gate.decisionKind === "commitment") &&
    typeof gate.title === "string" && gate.title.length > 0 &&
    typeof gate.context === "string" &&
    Array.isArray(gate.options) && gate.options.length >= 2 &&
    gate.options.every((option) =>
      typeof option.id === "string" && option.id.length > 0 &&
      typeof option.title === "string" && option.title.length > 0 &&
      typeof option.summary === "string" && option.summary.length > 0,
    ) &&
    typeof gate.recommendation?.optionId === "string" &&
    typeof gate.recommendation.rationale === "string" && gate.recommendation.rationale.length > 0 &&
    gate.options.some((option) => option.id === gate.recommendation.optionId) &&
    typeof gate.target?.itemId === "string" && gate.target.itemId.length > 0 &&
    typeof gate.target.workspace === "string" && gate.target.workspace.length > 0;
}

function decisionGateForAction(
  loop: H2AObjectiveLoop,
  action: TickAction,
): (H2ALoopTrackRef & { readonly decisionGate: H2ALoopDecisionGate }) | undefined {
  return loop.refs.find((ref) =>
    isStructuredDecisionGate(ref) &&
    (action.refLocator === loopRefLocator(ref) || action.decisionId === ref.decisionGate.id),
  ) as (H2ALoopTrackRef & { readonly decisionGate: H2ALoopDecisionGate }) | undefined;
}

/** Stable Track identity for one open gate revision and target lifecycle episode. */
function decisionSourceKey(
  loopId: string,
  ref: H2ALoopTrackRef,
  gate: H2ALoopDecisionGate,
  episode: number,
): string {
  const revision = createHash("sha256")
    .update(JSON.stringify({ locator: loopRefLocator(ref), gate, episode }))
    .digest("hex");
  return `h2a-loop-decision:${loopId}:${gate.id}:${revision}`;
}

type LedgerResolution =
  | { readonly track: Track }
  | { readonly reason: "track-ledger-unavailable" | "track-target-not-found" };

/**
 * Find the ledger that owns the gate target. Loop repos are the primary source;
 * the h2a root (and its workspace parent for legacy `.h2a` roots) are fallbacks.
 * No directory is created here: a missing ledger is an observable failed route.
 */
function resolveTrackLedger(
  loop: H2AObjectiveLoop,
  ctx: ActionContext,
  gate: H2ALoopDecisionGate,
): LedgerResolution {
  const roots = [...new Set([
    ...loop.repos.map((repo) => repo.path),
    ctx.root,
    dirname(ctx.root),
  ])];
  let foundLedger = false;
  for (const root of roots) {
    const eventsPath = join(root, ".track", "events.jsonl");
    if (!existsSync(eventsPath)) continue;
    foundLedger = true;
    const track = new Track(new EventStore(eventsPath), { by: LOOP_DECISION_ACTOR });
    const target = track.state().items.get(gate.target.itemId);
    if (target?.workspace === gate.target.workspace) return { track };
  }
  return { reason: foundLedger ? "track-target-not-found" : "track-ledger-unavailable" };
}

function routeLoopDecision(action: TickAction, ctx: ActionContext): ActionEffectResult {
  let loop: H2AObjectiveLoop;
  try {
    loop = readObjectiveLoop(ctx.root, ctx.loopId);
  } catch (error) {
    return { outcome: "failed", detail: `loop-unavailable: ${(error as Error).message}`, retrySafe: false };
  }
  const ref = decisionGateForAction(loop, action);
  if (ref === undefined) {
    return { outcome: "failed", detail: "decision-gate-not-found", retrySafe: false };
  }

  const gate = ref.decisionGate;
  try {
    const ledger = resolveTrackLedger(loop, ctx, gate);
    if ("reason" in ledger) return { outcome: "failed", detail: ledger.reason, retrySafe: true };
    const episode = ledger.track.state().items.get(gate.target.itemId)?.reopenings?.length ?? 0;
    const sourceKey = decisionSourceKey(loop.id, ref, gate, episode);

    const existing = [...ledger.track.state().decisions.values()].find(
      (decision) => decision.sourceKey === sourceKey,
    );
    if (existing !== undefined) {
      return { outcome: "routed", detail: `decision-already-raised:${existing.id}` };
    }

    const decisionId = ledger.track.createDecision({
      decisionKind: gate.decisionKind,
      title: gate.title,
      workspace: gate.target.workspace,
      targets: [gate.target.itemId],
      sourceKey,
      dossier: {
        context: gate.context,
        options: gate.options.map((option) => ({
          id: option.id,
          title: option.title,
          summary: option.summary,
          ...(option.pros === undefined ? {} : { pros: [...option.pros] }),
          ...(option.cons === undefined ? {} : { cons: [...option.cons] }),
        })),
        qa: (gate.qa ?? []).map((entry) => ({
          id: entry.id,
          question: entry.question,
          ...(entry.answer === undefined ? {} : { answer: entry.answer }),
        })),
        recommendation: {
          optionId: gate.recommendation.optionId,
          rationale: gate.recommendation.rationale,
        },
      },
    });
    return { outcome: "routed", detail: `decision-raised:${decisionId}` };
  } catch (error) {
    return { outcome: "failed", detail: `track-ledger-write-failed: ${(error as Error).message}`, retrySafe: true };
  }
}

// --- Action sink (effects for `--execute`) ------------------------------------
// `close` = idempotent store status flip (ZERO injection). `wake` = fresh-session
// + shared-budget typed local-tmux driver, distinguishing human deferral from a
// failed injection. `request-launch` = complete launch specs only, through the
// strict h2a.run/v1 stdin+JSON bridge. NEVER chain/headless/auto — a human defer
// must not fall back to another injection path.
export function buildActionSink(opts: {
  /** Back-compat boolean seam: false means human-deferred. Prefer wakeDriver. */
  driver?: H2ADriver;
  wakeDriver?: LoopWakeDriver;
  launcher?: LoopLauncher;
  /** Workspace boundary captured by the objective-loop controller. */
  controllerRoot?: string;
} = {}): ActionSink {
  const wakeDriver: LoopWakeDriver = opts.wakeDriver ?? (opts.driver
    ? {
        async drive(request) {
          return await opts.driver!.drive(request) ? "done" : "deferred-human";
        }
      }
    : localTmuxLoopWakeDriver());
  const launcher = opts.launcher ?? defaultLoopLauncher;
  return {
    async close(_action, ctx) {
      const { changed } = updateObjectiveLoopStatus(ctx.root, ctx.loopId, "done", {
        now: ctx.now,
        reason: "objective-loop tick: all primary/target refs satisfied"
      });
      return changed ? "done" : "skipped";
    },
    async requestLaunch(action, ctx) {
      const loop = readObjectiveLoop(ctx.root, ctx.loopId);
      const prior = priorRelaunchAttemptsByAgent(listLoopEvents(ctx.root, ctx.loopId)).get(action.agentId ?? "") ?? { count: 0 };
      const plan = planLaunchTarget({
        loop,
        agentId: action.agentId ?? "",
        priorCount: prior.count,
        ...(prior.latestAt !== undefined ? { priorLatestAt: prior.latestAt } : {}),
        ...(prior.retryForbidden === true ? { retryForbidden: true } : {}),
        now: ctx.now
      });
      if (plan.kind !== "emit") return { outcome: "skipped", detail: plan.reason };
      const agent = loop.agents.find((candidate) => candidate.id === action.agentId);
      if (!agent?.launch) return { outcome: "skipped", detail: "no-launch-spec" };
      let spec: H2ALoopLaunchSpec;
      try {
        spec = validateLoopLaunchSpec(agent.launch);
      } catch (error) {
        return { outcome: "skipped", detail: `invalid launch spec: ${(error as Error).message}` };
      }
      if (agent.host !== spec.profile) {
        return { outcome: "skipped", detail: "launch profile differs from persisted agent host" };
      }
      if (!loopLaunchWorkspaceAllowed(loop, spec, opts.controllerRoot ?? process.cwd())) {
        return { outcome: "skipped", detail: "launch workspace is outside the controller and declared repo boundaries" };
      }
      const launched = await launcher.launch(spec);
      return launched.ok
        ? { outcome: "done", ...(launched.detail ? { detail: launched.detail } : {}) }
        : {
            outcome: "failed",
            ...(launched.detail ? { detail: launched.detail } : {}),
            ...(launched.retrySafe !== undefined ? { retrySafe: launched.retrySafe } : {})
          };
    },
    async wake(action, ctx) {
      const loop = readObjectiveLoop(ctx.root, ctx.loopId);
      const wakeHistory = priorRelaunchAttemptsByAgent(listLoopEvents(ctx.root, ctx.loopId));
      const freshSessions = listPresence(ctx.root, { now: ctx.now }).map((s) => ({
        instance: s.instance,
        ...(s.launchContext !== undefined ? { launchContext: s.launchContext } : {})
      }));
      const plan = planWakeTarget({
        loop,
        agentId: action.agentId ?? "",
        freshSessions,
        priorWakeAtByAgent: new Map(
          [...wakeHistory]
            .filter((entry): entry is [string, RelaunchHistory & { latestAt: number }] => entry[1].latestAt !== undefined)
            .map(([agentId, history]) => [agentId, history.latestAt])
        ),
        priorWakeCountByAgent: new Map(
          [...wakeHistory]
            .map(([agentId, history]) => [agentId, history.count])
        ),
        now: ctx.now
      });
      if (plan.kind === "skip") return { outcome: "skipped", detail: plan.reason };
      // localTmuxDriver ONLY — never chain/headless/auto (RISK #1). It applies the
      // human-typing guard at the last moment and DEFERS (false) if a human is
      // active in the pane; a defer stays pending and re-fires next tick.
      const outcome = await wakeDriver.drive({
        to: plan.instance,
        ...(plan.host !== undefined ? { host: plan.host } : {}),
        instructionLine: plan.instructionLine,
        launchContext: plan.launchContext
      });
      if (outcome === "done") return "done";
      if (outcome === "deferred-human") return "deferred";
      return "failed";
    },
    async routeDecision(action, ctx) {
      return routeLoopDecision(action, ctx);
    }
  };
}
