/**
 * Claude seat gateway composition (common seat model).
 *
 * The other seats compose zero-arg mesh-internal transports in
 * `runtimeMesh()`; the Claude seat's transport is the local pinned CLI, so
 * h2a supplies the mesh `ClaudeCodeRuntimeClient` with its own runner —
 * the exact pairing the mesh defines (`ClaudeCodeRuntimeClient implements
 * AnthropicAdapterClient`, `{ runner, capabilities }`). Qualification inputs
 * come from the environment (never hardcoded, never inferred from the
 * installed CLI). Absent configuration composes nothing: the planner simply
 * has no Anthropic route — the same fail-closed per-attempt outcome as a
 * seat with no enrolled account.
 */
import { ClaudeCodeRuntimeClient } from "@sentropic/cluster-mesh/llm-mesh";
import {
  buildClaudeQualificationRef,
  DEFAULT_PINNED_CLI_VERSION,
  OfficialClaudeCodeCliRunner,
} from "../claude-code-cli-runner.js";

/** Pinned-CLI qualification inputs. Both required; digest is hex sha256. */
export const CLAUDE_BINARY_PATH_ENV = "H2A_CLAUDE_BINARY_PATH";
export const CLAUDE_BINARY_DIGEST_ENV = "H2A_CLAUDE_BINARY_DIGEST";

export interface ClaudeSeatClientConfig {
  readonly binaryPath: string;
  readonly expectedDigest: string;
}

const DIGEST_RE = /^[0-9a-f]{64}$/;

/**
 * Read seat qualification from the environment. Returns undefined when the
 * seat is unconfigured (either variable absent/blank) or the digest is not
 * a 64-hex fingerprint — the caller then composes no Anthropic route.
 * Never throws on unconfigured input.
 */
export function claudeSeatClientConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): ClaudeSeatClientConfig | undefined {
  const binaryPath = (env[CLAUDE_BINARY_PATH_ENV] ?? "").trim();
  const expectedDigest = (env[CLAUDE_BINARY_DIGEST_ENV] ?? "").trim().toLowerCase();
  if (!binaryPath || !DIGEST_RE.test(expectedDigest)) return undefined;
  return { binaryPath, expectedDigest };
}

/**
 * Build the mesh runtime client on the h2a runner. Attempt-time safety
 * (absolute path, existence, pinned version, digest match, qualification
 * attestation) stays runner-owned per attempt — composition never spawns.
 */
export function createClaudeSeatClient(
  config: ClaudeSeatClientConfig,
): ClaudeCodeRuntimeClient {
  const capabilities = {
    protocol: "claude-code-stream-json-v1" as const,
    cliVersion: DEFAULT_PINNED_CLI_VERSION,
    source: "pinned-cli",
    qualificationRef: buildClaudeQualificationRef(config.expectedDigest),
  };
  return new ClaudeCodeRuntimeClient({
    runner: new OfficialClaudeCodeCliRunner({
      binaryPath: config.binaryPath,
      expectedDigest: config.expectedDigest,
      capabilities,
    }),
    capabilities,
  });
}

/** Compose from the environment; undefined when the seat is unconfigured. */
export function createClaudeSeatClientFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): ClaudeCodeRuntimeClient | undefined {
  const config = claudeSeatClientConfigFromEnv(env);
  return config ? createClaudeSeatClient(config) : undefined;
}
