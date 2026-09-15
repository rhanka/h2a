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
 * The RAW request value (still "auto" when neither flag was passed) is kept by
 * the caller for the registry pin decision (`gatewayMode !== "auto"` = explicit),
 * so an "auto" launch stays UNPINNED and restore keeps following the live
 * default; the explicit --gw/--no-gw re-emission on restore is unaffected.
 */
export function gatewayModeForProfile<T extends "auto" | "gateway" | "direct">(
  profile: string,
  requested: T,
): T | "direct" {
  if (!profileUsesLlmMeshGateway(profile)) return "direct";
  return requested === "auto" ? "direct" : requested;
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
