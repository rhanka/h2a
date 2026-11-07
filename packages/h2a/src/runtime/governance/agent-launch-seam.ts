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
 * - `spawnOnAuthorizedLaunch` runs the caller's spawn step ONLY on an allowing
 *   decision, overriding the caller environment with exactly one variable:
 *   `H2A_AGENT_SESSION_ID` = the verified decision's agent session id. On any
 *   refusal the spawn step never runs and no child environment is produced.
 */

export const H2A_AGENT_SESSION_ID = "H2A_AGENT_SESSION_ID";

export const AGENT_SESSION_ID_RE =
  /^agent-session:[A-Za-z0-9][A-Za-z0-9._:-]*$/;

const ISO_INSTANT_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

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

export interface AgentLaunchDeny {
  readonly allow: false;
  readonly reason: string;
}

export type AgentLaunchDecision = AgentLaunchAllow | AgentLaunchDeny;

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
    "instanceId",
    "cliKind",
  ]) {
    if (!isNonEmptyString(r[key])) return false;
  }
  for (const key of ["launchName", "agentUuid", "model", "effort"]) {
    if (r[key] !== undefined && typeof r[key] !== "string") return false;
  }
  const hasParent = r["parentAgentSessionId"] !== undefined;
  const hasName = r["subagentName"] !== undefined;
  if (hasParent !== hasName) return false;
  if (hasParent && (!isNonEmptyString(r["parentAgentSessionId"]) || !isNonEmptyString(r["subagentName"]))) {
    return false;
  }
  return true;
}

function isValidAllow(decision: unknown): decision is AgentLaunchAllow {
  if (!decision || typeof decision !== "object") return false;
  const d = decision as Record<string, unknown>;
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

/**
 * True when the allowing decision is well-formed AND unexpired at `now`.
 * Expiry is compared on both entry paths: an expired allow never authorises.
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
 * expired answer — P2-3: `expiresAt <= now` never authorises).
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
    return { ok: true, decision: decision as AgentLaunchAllow };
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
