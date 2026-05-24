/**
 * Host bridge profile vocabulary (DEC-059).
 *
 * Formalizes the interop contract between `@sentropic/h2a` and external host
 * runtimes that embed `h2a mcp-serve` (e.g. `@sentropic/remote`).
 * The contract has five clauses from DEC-056:
 *
 *   1. identity        — how the host names h2a INSTANCE and where it surfaces it.
 *   2. lifecycle       — how the host's session states map to H2ASessionState.
 *   3. resource-limits — whether the host's resource limits are reflected on h2a
 *                        presence and whether h2a enforces them (V1: never).
 *   4. disclosure      — what disclosure boundary the host workspace draws.
 *   5. auth-boundary   — which trust boundary covers the shared `<root>/.h2a/`.
 *
 * V1 ships one canonical profile (`remote`) and the audit primitive.
 * Adding a new host means adding a profile + extending the audit fixtures —
 * no host-side runtime logic in `@sentropic/h2a` itself.
 */

import { H2A_SESSION_STATES, type H2ASessionState } from "./session.js";

export const H2A_HOST_BRIDGE_CLAUSES = [
  "identity",
  "lifecycle",
  "resource-limits",
  "disclosure",
  "auth-boundary"
] as const;

export type H2AHostBridgeClause = (typeof H2A_HOST_BRIDGE_CLAUSES)[number];

export interface H2AHostBridgeIdentityClause {
  /**
   * Template the host uses to derive the h2a INSTANCE id. The shell-style
   * `${PLACEHOLDER}` syntax is informational; the host's pod template engine
   * is responsible for the actual substitution.
   */
  readonly instanceTemplate: string;
  /** Mapping of h2a concept → host env var. */
  readonly envVarMap: {
    readonly instance: string;
    readonly host: string;
    readonly root: string;
  };
  /** Value of `host` reported on `h2a_session_open`. */
  readonly hostHint: string;
}

export interface H2AHostBridgeLifecycleClause {
  /**
   * Host lifecycle state → h2a session state. Every value MUST be in
   * `H2A_SESSION_STATES`. The audit refuses unknown targets.
   */
  readonly stateMap: Readonly<Record<string, H2ASessionState>>;
  /**
   * One-line plain-English description of when the transition happens
   * (e.g. "Pod scheduled → opening").
   */
  readonly description: string;
}

export interface H2AHostBridgeResourceLimitsClause {
  /** True if the host's CPU/RAM limits are surfaced on the h2a presence file. */
  readonly reflected: boolean;
  /** V1 invariant: h2a NEVER enforces host limits. Audit fails if `true`. */
  readonly enforced: false;
  /** Free text explaining where the reflected info lives. */
  readonly reflectedAs?: string;
}

export interface H2AHostBridgeDisclosureClause {
  /** What disclosure boundary the host workspace draws (informational). */
  readonly workspaceBoundary: string;
  /** Status of cross-workspace disclosure for this host. */
  readonly crossWorkspace: "deferred" | "supported" | "n/a";
  /** Pointer to the DEC governing cross-workspace evolution. */
  readonly crossWorkspaceReference?: string;
}

export interface H2AHostBridgeAuthBoundaryClause {
  /** Transport carrying the h2a session traffic (e.g. "filesystem (emptyDir)"). */
  readonly transport: string;
  /** Where trust enforcement happens (e.g. "Pod-level", "Namespace-level"). */
  readonly enforcement: string;
}

export interface H2AHostBridgeProfileDescriptor {
  readonly hostId: string;
  readonly label: string;
  readonly identity: H2AHostBridgeIdentityClause;
  readonly lifecycle: H2AHostBridgeLifecycleClause;
  readonly resourceLimits: H2AHostBridgeResourceLimitsClause;
  readonly disclosure: H2AHostBridgeDisclosureClause;
  readonly authBoundary: H2AHostBridgeAuthBoundaryClause;
  readonly references: readonly string[];
}

export interface H2AHostBridgeAuditResult {
  readonly ok: boolean;
  readonly hostId?: string;
  readonly clauses: readonly H2AHostBridgeClause[];
  readonly issues: readonly string[];
  readonly enforces: boolean;
}

export const H2A_HOST_BRIDGE_PROFILES = Object.freeze({
  "remote": Object.freeze({
    hostId: "remote",
    label: "@sentropic/remote session sidecar",
    identity: Object.freeze({
      instanceTemplate: "remote:${SESSION_ID}",
      envVarMap: Object.freeze({
        instance: "H2A_INSTANCE",
        host: "H2A_HOST",
        root: "H2A_ROOT"
      }),
      hostHint: "remote"
    }),
    lifecycle: Object.freeze({
      stateMap: Object.freeze({
        provisioning: "opening",
        running: "live",
        terminating: "draining",
        ended: "closed"
      }),
      description:
        "remote session-agent emits lifecycle events at Pod scheduling, container Ready, container Terminating and Pod Completed; each maps onto the matching H2ASessionState."
    }),
    resourceLimits: Object.freeze({
      reflected: true,
      enforced: false,
      reflectedAs:
        "informational labels on the h2a presence file; h2a never enforces remote CPU/RAM limits."
    }),
    disclosure: Object.freeze({
      workspaceBoundary:
        "one h2a coordination scope per remote session Pod; the emptyDir is the trust boundary.",
      crossWorkspace: "deferred",
      crossWorkspaceReference: "DEC-056 Scenarios B/C"
    }),
    authBoundary: Object.freeze({
      transport: "filesystem (emptyDir shared between the runtime container and the h2a-mcp sidecar)",
      enforcement: "Pod-level"
    }),
    references: ["DEC-056", "DEC-058", "DEC-059"] as const
  })
} as const satisfies Record<string, H2AHostBridgeProfileDescriptor>);

export type H2AHostBridgeProfileId = keyof typeof H2A_HOST_BRIDGE_PROFILES;

export function getHostBridgeProfile(
  hostId: string
): H2AHostBridgeProfileDescriptor | undefined {
  if (!Object.hasOwn(H2A_HOST_BRIDGE_PROFILES, hostId)) {
    return undefined;
  }
  return H2A_HOST_BRIDGE_PROFILES[hostId as H2AHostBridgeProfileId];
}

function isSessionState(value: unknown): value is H2ASessionState {
  return (
    typeof value === "string" &&
    H2A_SESSION_STATES.includes(value as H2ASessionState)
  );
}

/**
 * Validate that a host bridge profile (a) is registered, (b) carries the
 * five canonical clauses, (c) maps every host lifecycle state to a known
 * `H2ASessionState`, and (d) does NOT claim to enforce host resource limits
 * (V1 invariant per DEC-059).
 */
export function auditHostBridge(hostId: string): H2AHostBridgeAuditResult {
  const profile = getHostBridgeProfile(hostId);
  if (!profile) {
    return {
      ok: false,
      clauses: [],
      issues: [`unknown host bridge profile: ${hostId}`],
      enforces: false
    };
  }

  const issues: string[] = [];
  const clauses: H2AHostBridgeClause[] = [];

  // 1. identity
  if (
    typeof profile.identity.instanceTemplate === "string" &&
    typeof profile.identity.envVarMap.instance === "string" &&
    typeof profile.identity.envVarMap.host === "string" &&
    typeof profile.identity.envVarMap.root === "string" &&
    typeof profile.identity.hostHint === "string"
  ) {
    clauses.push("identity");
  } else {
    issues.push("identity clause: required string fields missing or malformed");
  }

  // 2. lifecycle: every mapped value must be a known H2ASessionState
  const stateMap = profile.lifecycle.stateMap;
  const unknownStates: string[] = [];
  for (const [hostState, mapped] of Object.entries(stateMap)) {
    if (!isSessionState(mapped)) {
      unknownStates.push(`${hostState}→${String(mapped)}`);
    }
  }
  if (unknownStates.length > 0) {
    issues.push(
      `lifecycle clause: unknown H2ASessionState mappings: ${unknownStates.join(", ")}`
    );
  } else if (Object.keys(stateMap).length === 0) {
    issues.push("lifecycle clause: stateMap must declare at least one mapping");
  } else {
    clauses.push("lifecycle");
  }

  // 3. resource-limits: enforced MUST be false (V1 invariant)
  if (profile.resourceLimits.enforced !== false) {
    issues.push(
      "resource-limits clause: V1 invariant violated — h2a must not enforce host resource limits"
    );
  } else if (typeof profile.resourceLimits.reflected !== "boolean") {
    issues.push("resource-limits clause: `reflected` must be a boolean");
  } else {
    clauses.push("resource-limits");
  }

  // 4. disclosure
  const xw = profile.disclosure.crossWorkspace;
  if (xw !== "deferred" && xw !== "supported" && xw !== "n/a") {
    issues.push(
      `disclosure clause: crossWorkspace must be "deferred" | "supported" | "n/a", got ${String(xw)}`
    );
  } else if (typeof profile.disclosure.workspaceBoundary !== "string") {
    issues.push("disclosure clause: workspaceBoundary must be a string");
  } else {
    clauses.push("disclosure");
  }

  // 5. auth-boundary
  if (
    typeof profile.authBoundary.transport === "string" &&
    typeof profile.authBoundary.enforcement === "string"
  ) {
    clauses.push("auth-boundary");
  } else {
    issues.push("auth-boundary clause: required fields missing or malformed");
  }

  return {
    ok: issues.length === 0,
    hostId: profile.hostId,
    clauses,
    issues,
    enforces: false
  };
}

/**
 * List the registered host bridge profile ids. Useful for tooling that wants
 * to display the supported bridges (e.g. `h2a host status` extension, or the
 * @sentropic/remote protocol schema generator).
 */
export function listHostBridgeProfiles(): readonly string[] {
  return Object.keys(H2A_HOST_BRIDGE_PROFILES);
}
