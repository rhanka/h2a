/**
 * EVO-12 hosted MCP — read-only tool allowlist (the load-bearing security
 * invariant, DEC-116 / EVO-11 key custody).
 *
 * The internet-facing hosted MCP (enrolled from claude.ai) exposes ONLY read
 * tools. No tool that takes a private key is ever routable on the hosted
 * surface, so the ed25519 private key never travels over the wire. Signing
 * stays on the keyring-holding side (local CLI / sidecar). This is a STRUCTURAL
 * deployment property, not a phase: `hostedReadOnlyDescriptors` throws if the
 * allowlist ever contains a private-key tool (defense-in-depth schema scan).
 */

import type { McpToolDescriptor, McpToolName } from "../mcp/tools.js";

/** Phase-1 read-only surface: "claude.ai has the info" (discover / nhi / posture). */
export const H2A_HOSTED_READONLY_TOOLS: readonly McpToolName[] = [
  "h2a_discover_instances",
  "h2a_discover_sessions",
  "h2a_nhi_inventory",
  "h2a_nhi_report",
  "h2a_conflict_posture",
  "h2a_blockage_list"
];

/** True iff the tool's input schema carries a private key (must never be hosted). */
export function toolTakesPrivateKey(descriptor: McpToolDescriptor): boolean {
  return JSON.stringify(descriptor.inputSchema ?? {}).includes("privateKeyPem");
}

export function isHostedReadOnlyTool(name: string): boolean {
  return (H2A_HOSTED_READONLY_TOOLS as readonly string[]).includes(name);
}

/**
 * The read-only descriptor subset to expose on the hosted MCP. THROWS if any
 * allowlisted tool takes a private key — the allowlist must never include a
 * signing tool (structural invariant, not a runtime hope).
 */
export function hostedReadOnlyDescriptors(
  all: readonly McpToolDescriptor[]
): McpToolDescriptor[] {
  const exposed = all.filter((d) => isHostedReadOnlyTool(d.name));
  const leaky = exposed.filter(toolTakesPrivateKey);
  if (leaky.length > 0) {
    throw new Error(
      `EVO-12 hosted allowlist must not include private-key tools: ${leaky
        .map((d) => d.name)
        .join(", ")}`
    );
  }
  return exposed;
}
