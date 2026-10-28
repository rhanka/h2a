export const REMOTE_PROTOCOL_VERSION = "0.1.0";
export const REMOTE_SCHEMA_VERSION = "remote.protocol.v1";
export const CLI_PROFILES = [
  "shell",
  "codex",
  "opencode",
  "claude",
  "agy",
  "gemini",
  "mistral",
  "muse",
  "vibe",
] as const;

export type CliProfile = (typeof CLI_PROFILES)[number];

/** Profiles that actually consume the local Anthropic-compatible gateway env. */
export function profileUsesLlmMeshGateway(profile: string): boolean {
  return profile === "claude" || profile === "claude-code";
}

/**
 * Resolve the EFFECTIVE llm-mesh gateway posture for a launch.
 *
 * Owner decision (2026-09): a launch is DIRECT unless the gateway is asked for
 * EXPLICITLY (`--gw` / `--llm-gateway` / MCP gateway:'required'). The
 * non-explicit posture "auto" therefore resolves to "direct" here, so a child
 * launched from a session whose environment already carries
 * ANTHROPIC_BASE_URL/ANTHROPIC_AUTH_TOKEN no longer inherits the gateway — the
 * subsequent `injectLlmMeshGatewayEnv("direct")` scrubs those vars. Only an
 * explicit "gateway" engages it; "direct" stays direct. A profile that does not
 * consume the Anthropic-compatible gateway is always direct regardless.
 *
 * The effective value excludes "auto": callers can persist the actual launch
 * posture alongside the bare choice so resume reproduces it.
 */
export function gatewayModeForProfile(
  profile: string,
  requested: "auto" | "gateway" | "direct",
): "gateway" | "direct" {
  if (!profileUsesLlmMeshGateway(profile)) return "direct";
  return requested === "auto" ? "direct" : requested;
}

/**
 * Provenance of a persisted gateway pin: only an explicit operator choice
 * (`--gw` / `--no-gw`, MCP `required`/`off`) is recorded. A legacy pin has
 * no provenance — it may have been an explicit choice once, but the record
 * cannot prove it, so it must not authorize a gateway on its own.
 */
export type GatewayProvenance = "explicit";

/**
 * Resolve the EFFECTIVE gateway posture for resume/relaunch paths.
 *
 * An explicit CLI choice always wins (`--no-gw` beats even a proven gateway
 * pin). Without one, only a pin WITH explicit provenance keeps the gateway;
 * a legacy pin without provenance resolves to direct. Old rows keep their
 * data — only the routing decision ignores them.
 */
export function resolveResumedGatewayMode(
  profile: string,
  cliMode: "auto" | "gateway" | "direct",
  pinnedMode?: "gateway" | "direct",
  pinnedProvenance?: GatewayProvenance,
): "gateway" | "direct" {
  if (cliMode !== "auto") return gatewayModeForProfile(profile, cliMode);
  const pinned = pinnedProvenance === "explicit" ? (pinnedMode ?? "auto") : "auto";
  return gatewayModeForProfile(profile, pinned);
}
export type SessionTarget = "docker" | "k3s" | "scaleway-kapsule" | "gke";
export type UatExposurePolicy =
  | "operator-only"
  | "session-private"
  | "public-expiring";
export type RemoteEventEnvelope = {
  protocolVersion: typeof REMOTE_PROTOCOL_VERSION;
  schemaVersion: typeof REMOTE_SCHEMA_VERSION;
  eventId: string;
  sessionId: string;
  sequence: number;
  type: string;
  occurredAt: string;
  correlationId: string;
  actor: Record<string, unknown>;
  payload: Record<string, unknown>;
  metadata?: Record<string, unknown>;
};

export type TerminalOpened = {
  terminalId: string;
  shell: string;
  cwd?: string;
  cols?: number;
  rows?: number;
};
