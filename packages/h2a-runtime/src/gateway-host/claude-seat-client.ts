/**
 * Claude seat gateway composition (common seat model).
 *
 * Like every other seat, the Claude seat composes unconditionally with no
 * per-seat configuration: the mesh `ClaudeCodeRuntimeClient` on the h2a
 * runner joins the provider registry via `AnthropicAdapter`. The runner
 * resolves the official `claude` CLI from `PATH` at each attempt and
 * performs only generic spawn safety (absolute resolved path, exists).
 * There is no version pin, no digest fingerprint, and no attestation —
 * no other seat carries such machinery. A seat with no enrolled account
 * (or no `claude` on `PATH`) simply never serves a route: fail-closed per
 * attempt, never at composition.
 */
import { ClaudeCodeRuntimeClient } from "@sentropic/cluster-mesh/llm-mesh";
import { OfficialClaudeCodeCliRunner } from "../claude-code-cli-runner.js";

/**
 * Static descriptors. The mesh contract requires non-empty
 * `cliVersion` / `source` / `qualificationRef` strings; these name the
 * resolution mechanism and claim no verification.
 */
export const CLAUDE_SEAT_CAPABILITIES = {
  protocol: "claude-code-stream-json-v1" as const,
  cliVersion: "unpinned",
  source: "path-resolved-cli",
  qualificationRef: "unpinned:path-resolved-cli",
} as const;

/**
 * Build the mesh runtime client on the h2a runner. An explicit binary
 * path wins (test seam); otherwise the runner resolves `claude` from
 * `PATH` at each attempt. Composition never spawns.
 */
export function createClaudeSeatClient(binaryPath?: string): ClaudeCodeRuntimeClient {
  return new ClaudeCodeRuntimeClient({
    runner: new OfficialClaudeCodeCliRunner(
      binaryPath ? { binaryPath } : {},
    ),
    capabilities: { ...CLAUDE_SEAT_CAPABILITIES },
  });
}
