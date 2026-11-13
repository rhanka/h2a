/**
 * RC2.authority-native — pre-spawn launch authorisation seam (MH-SEAM-ENV).
 *
 * Pure decision plumbing around `h2a run` production spawns. This module never
 * spawns, never touches the network, and performs no I/O beyond the injected
 * decision-port call. Layers 1-2 of `launch-check.ts` (conductor
 * recommendation, dry-run) are untouched.
 *
 * Protocol:
 * - `authorizeAgentLaunch` validates the request, asks the injected decision
 *   port, validates the decision shape, and returns it. With no port
 *   (harness-only env) or any port failure it refuses `policy_unavailable`.
 *   Two published allow forms verify: the bare B4 allow, and the rich allow
 *   carrying the opened L2 `AgentSession` description (R4-08, r2 co-sign
 *   §4.1) with its frozen, closed field set. A sub-agent launch authorises
 *   only when the allow runs UNDER the parent session — a sub-agent executor
 *   never opens a level-2 record of its own.
 * - `spawnOnAuthorizedLaunch` runs the caller's spawn step ONLY on an allowing
 *   decision, overriding the caller environment with exactly one variable:
 *   `H2A_AGENT_SESSION_ID` = the verified decision's agent session id. On any
 *   refusal the spawn step never runs and no child environment is produced.
 */

import { isSubagentAddress, parseSubagentAddress } from "../../subagents.js";

export const H2A_AGENT_SESSION_ID = "H2A_AGENT_SESSION_ID";

export const AGENT_SESSION_ID_RE =
  /^agent-session:[A-Za-z0-9][A-Za-z0-9._:-]*$/;

const ISO_INSTANT_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const MEMORIAL_AGENT_ID_RE = /^agent:[A-Za-z0-9][A-Za-z0-9._:-]*$/;

/** The L2 (R4-08) fields a rich allow must carry. */
const L2_REQUIRED_FIELDS = [
  "policyMode",
  "workspaceRef",
  "purposeRefs",
  "permittedTools",
  "requestCollectionAvailable"
] as const;

/** The L2 (R4-08) optional fields a rich allow may carry. */
const L2_OPTIONAL_FIELDS = [
  "memorialAgentId",
  "associationRevision",
  "scopeRestrictionLabel"
] as const;

/** Stable refusal vocabulary of the pre-spawn seam. */
export type AgentLaunchRefusalReason =
  | "policy_unavailable"
  | "invalid_request"
  | "invalid_decision"
  | "launch_refused";

/** What the runtime asks the local decision authority BEFORE any spawn. */
export interface AgentLaunchRequest {
  readonly h2aWorkspaceId: string;
  readonly durableWorkspaceIdHint: string;
  readonly realpath: string;
  readonly launchName?: string;
  readonly agentUuid?: string;
  readonly instanceId: string;
  readonly cliKind: string;
  readonly model?: string;
  readonly effort?: string;
  readonly parentAgentSessionId?: string;
  readonly subagentName?: string;
}

export interface AgentLaunchAllow {
  readonly allow: true;
  readonly agentSessionId: string;
  readonly policyRevision: string;
  readonly expiresAt: string;
}

/**
 * The rich allow form: the opened L2 `AgentSession` description (R4-08, r2
 * co-sign §4.1) the runtime executes under — granted purpose_ref map included.
 * The verified `purposeRefs` map is the granted SUBSET (an absent key = no
 * purpose granted for that scope); the daemon consumes `permittedTools` +
 * `policyRevision` per call. Extends the bare B4 allow, which stays a
 * published form on its own.
 */
export interface AgentLaunchL2Allow extends AgentLaunchAllow {
  readonly policyMode: "role" | "passthrough";
  readonly memorialAgentId?: string;
  readonly associationRevision?: string;
  readonly workspaceRef: string;
  readonly purposeRefs: Readonly<Record<"role" | "repo", string>>;
  readonly permittedTools: readonly string[];
  readonly requestCollectionAvailable: boolean;
  readonly scopeRestrictionLabel?: "role-memory-scope:interim-tenant-agent-workspace-v1";
}

export interface AgentLaunchDeny {
  readonly allow: false;
  readonly reason: string;
}

export type AgentLaunchDecision = AgentLaunchAllow | AgentLaunchL2Allow | AgentLaunchDeny;

export type AgentLaunchDecisionPort = (
  request: AgentLaunchRequest,
) => AgentLaunchDecision | Promise<AgentLaunchDecision>;

export type AuthorizedLaunch =
  | { readonly ok: true; readonly decision: AgentLaunchDecision }
  | { readonly ok: false; readonly reason: AgentLaunchRefusalReason };

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isValidRequest(request: unknown): request is AgentLaunchRequest {
  if (!request || typeof request !== "object") return false;
  const r = request as Record<string, unknown>;
  for (const key of [
    "h2aWorkspaceId",
    "durableWorkspaceIdHint",
    "realpath",
    "cliKind",
  ]) {
    if (!isNonEmptyString(r[key])) return false;
  }
  const instanceId = r["instanceId"];
  if (!isNonEmptyString(instanceId)) return false;
  for (const key of ["launchName", "agentUuid", "model", "effort"]) {
    if (r[key] !== undefined && typeof r[key] !== "string") return false;
  }
  // r2 §2.4 sub-agents: a sub-agent launch is expressible ONLY as the paired
  // `parentAgentSessionId` + `subagentName` on a `<parentInstance>~<name>`
  // instance address; a plain launch carries neither.
  const hasParent = r["parentAgentSessionId"] !== undefined;
  const hasName = r["subagentName"] !== undefined;
  if (hasParent !== hasName) return false;
  if (isSubagentAddress(instanceId) !== hasName) return false;
  if (hasParent && hasName) {
    const parent = r["parentAgentSessionId"];
    const name = r["subagentName"];
    if (!isNonEmptyString(parent) || !AGENT_SESSION_ID_RE.test(parent)) {
      return false;
    }
    if (!isNonEmptyString(name)) return false;
    const parsed = parseSubagentAddress(instanceId);
    if (!parsed || parsed.name !== name) return false;
  }
  return true;
}

/** The bare B4 allow form: session id + policy revision + expiry instant. */
function isValidBareAllow(d: Record<string, unknown>): boolean {
  return (
    d["allow"] === true &&
    typeof d["agentSessionId"] === "string" &&
    AGENT_SESSION_ID_RE.test(d["agentSessionId"]) &&
    isNonEmptyString(d["policyRevision"]) &&
    typeof d["expiresAt"] === "string" &&
    ISO_INSTANT_RE.test(d["expiresAt"]) &&
    Number.isFinite(Date.parse(d["expiresAt"]))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * The rich allow form: a CLOSED key set over the bare + L2 (R4-08) fields with
 * every field form verified — unknown fields never pass, an optional-only or
 * partial L2 attempt stays a refused shape.
 */
function isValidL2Allow(d: Record<string, unknown>): boolean {
  if (!isValidBareAllow(d)) return false;
  const allowedKeys = new Set<string>([
    "allow",
    "agentSessionId",
    "policyRevision",
    "expiresAt",
    ...L2_REQUIRED_FIELDS,
    ...L2_OPTIONAL_FIELDS
  ]);
  for (const key of Object.keys(d)) {
    if (!allowedKeys.has(key)) return false;
  }
  for (const field of L2_REQUIRED_FIELDS) {
    if (!(field in d)) return false;
  }
  if (d["policyMode"] !== "role" && d["policyMode"] !== "passthrough") return false;
  if (!isNonEmptyString(d["workspaceRef"])) return false;
  // The frozen type carries both scope kinds; the verified map is the granted
  // SUBSET (an absent key = no purpose granted for that scope) and an unknown
  // scope kind never passes.
  if (!isRecord(d["purposeRefs"])) return false;
  for (const [scopeKind, purposeRef] of Object.entries(d["purposeRefs"])) {
    if ((scopeKind !== "role" && scopeKind !== "repo") || !isNonEmptyString(purposeRef)) {
      return false;
    }
  }
  if (
    !Array.isArray(d["permittedTools"]) ||
    d["permittedTools"].some((tool) => typeof tool !== "string")
  ) {
    return false;
  }
  if (typeof d["requestCollectionAvailable"] !== "boolean") return false;
  if (
    d["memorialAgentId"] !== undefined &&
    (!isNonEmptyString(d["memorialAgentId"]) || !MEMORIAL_AGENT_ID_RE.test(d["memorialAgentId"]))
  ) {
    return false;
  }
  if (d["associationRevision"] !== undefined && !isNonEmptyString(d["associationRevision"])) {
    return false;
  }
  if (
    d["scopeRestrictionLabel"] !== undefined &&
    d["scopeRestrictionLabel"] !== "role-memory-scope:interim-tenant-agent-workspace-v1"
  ) {
    return false;
  }
  return true;
}

function isValidAllow(decision: unknown): decision is AgentLaunchAllow {
  if (!decision || typeof decision !== "object") return false;
  const d = decision as Record<string, unknown>;
  if (!isValidBareAllow(d)) return false;
  // A decision carrying ANY L2 (R4-08) field must be a full, closed-set valid
  // rich allow — partial or decorated forms never verify.
  const carriesL2 = [...L2_REQUIRED_FIELDS, ...L2_OPTIONAL_FIELDS].some(
    (field) => field in d
  );
  return !carriesL2 || isValidL2Allow(d);
}

/**
 * True when the allowing decision is well-formed (bare or L2 form) AND
 * unexpired at `now`. Expiry is compared on both entry paths: an expired
 * allow never authorises.
 */
export function isLiveAllow(decision: unknown, now: number = Date.now()): decision is AgentLaunchAllow {
  if (!isValidAllow(decision)) return false;
  const expires = Date.parse((decision as AgentLaunchAllow).expiresAt);
  return Number.isFinite(expires) && expires > now;
}

/**
 * Ask the decision authority whether the launch may proceed. Never spawns.
 * Refusals: `policy_unavailable` (no port / port failure),
 * `invalid_request` (malformed request), `invalid_decision` (malformed or
 * expired answer — P2-3: `expiresAt <= now` never authorises — or a
 * sub-agent allow not running under the parent session).
 */
export async function authorizeAgentLaunch(
  request: AgentLaunchRequest,
  port?: AgentLaunchDecisionPort,
): Promise<AuthorizedLaunch> {
  if (!isValidRequest(request)) {
    return { ok: false, reason: "invalid_request" };
  }
  if (port === undefined) {
    return { ok: false, reason: "policy_unavailable" };
  }
  let decision: AgentLaunchDecision;
  try {
    decision = await port(request);
  } catch {
    return { ok: false, reason: "policy_unavailable" };
  }
  if (!decision || typeof decision !== "object") {
    return { ok: false, reason: "invalid_decision" };
  }
  if ((decision as AgentLaunchDecision).allow === true) {
    // P2-3: an expired allow is not a decision — it refuses here, and
    // spawnOnAuthorizedLaunch re-checks expiry just before spawning.
    if (!isLiveAllow(decision)) return { ok: false, reason: "invalid_decision" };
    const allow = decision as AgentLaunchAllow;
    // r2 §2.4 sub-agents: an executor runs UNDER the parent's level-2 session
    // — no level-2 record of its own. An allow opening a different session id
    // for a sub-agent launch does not verify.
    if (
      request.parentAgentSessionId !== undefined &&
      allow.agentSessionId !== request.parentAgentSessionId
    ) {
      return { ok: false, reason: "invalid_decision" };
    }
    return { ok: true, decision: allow };
  }
  if ((decision as AgentLaunchDecision).allow === false) {
    const reason = (decision as AgentLaunchDeny).reason;
    if (!isNonEmptyString(reason)) return { ok: false, reason: "invalid_decision" };
    return { ok: true, decision: decision as AgentLaunchDeny };
  }
  return { ok: false, reason: "invalid_decision" };
}

export type SpawnOutcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: AgentLaunchRefusalReason | string };

/**
 * Run the caller's spawn step only on an allowing decision. The child
 * environment equals the caller environment with exactly one override:
 * `H2A_AGENT_SESSION_ID` = the verified decision id. Refusal: no spawn.
 */
export function spawnOnAuthorizedLaunch<T>(
  authorized: AuthorizedLaunch | AgentLaunchDeny,
  spawn: (env: Record<string, string>) => T,
  env: Readonly<Record<string, string>>,
): SpawnOutcome<T> {
  if (!authorized || typeof authorized !== "object") {
    return { ok: false, reason: "invalid_decision" };
  }
  if ("ok" in authorized) {
    if (!authorized.ok) return { ok: false, reason: authorized.reason };
    if (authorized.decision.allow !== true) {
      const reason = (authorized.decision as AgentLaunchDeny).reason;
      return { ok: false, reason: isNonEmptyString(reason) ? reason : "launch_refused" };
    }
    // P2-3: never trust the wrapper — revalidate shape AND expiry just
    // before spawning. A fabricated or stale wrapper never spawns.
    if (!isLiveAllow(authorized.decision)) {
      return { ok: false, reason: "invalid_decision" };
    }
    const childEnv: Record<string, string> = { ...env };
    childEnv[H2A_AGENT_SESSION_ID] = (authorized.decision as AgentLaunchAllow).agentSessionId;
    return { ok: true, value: spawn(childEnv) };
  }
  if ((authorized as AgentLaunchDeny).allow === false) {
    return { ok: false, reason: (authorized as AgentLaunchDeny).reason };
  }
  return { ok: false, reason: "invalid_decision" };
}
