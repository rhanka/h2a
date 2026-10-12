/**
 * Claude Code Seat Attempt Binding & Pre-Acquire Integration Seam.
 *
 * Enforces the mandatory pre-acquire integration gate (Section 3A):
 * An owner/account lock must be held from BEFORE acquisition through reaping and cleanup.
 *
 * At llm-mesh 0.25.0 baseline, LlmMeshFacade constructs its directory internally and calls
 * acquire before returning a prepared attempt. No public pre-acquire seam exists.
 * Per brief Section 3A & 7, seat gateway serving is halted until an additive seam is delivered.
 */
import type {
  ClaudeCodeCliCapabilities,
  ClaudeCodeCliRunner,
  ClaudeSeatFacadeLike,
} from "../claude-seat-mesh-contract.js";
import type { ClaudeAccountLease } from "../claude-code-cli-lifecycle.js";

export interface MeshSeamDependencyHandoff {
  readonly status: "blocked_pending_mesh_seam";
  readonly targetPackage: string;
  readonly pinnedBaseline: "0.25.0";
  readonly requiredSeam: string;
  readonly specification: string;
  readonly rationale: string;
}

/**
 * Section 3A gate: check whether a supported pre-acquire hook is exposed by the facade/mesh.
 */
export function isClaudeSeatGatewaySeamAvailable(facade?: ClaudeSeatFacadeLike): boolean {
  if (!facade) return false;
  // Check for supported pre-acquire attempt hook on facade or custom directory option
  return (
    typeof facade.createPreAcquireRoutePlanner === "function" ||
    typeof facade.setPreAcquireAttemptHook === "function"
  );
}

/**
 * Structured dependency handoff specification for the conductor / mesh maintainer.
 */
export function getClaudeSeatSeamDependencyHandoff(): MeshSeamDependencyHandoff {
  return {
    status: "blocked_pending_mesh_seam",
    targetPackage: "mesh seat package (pinned 0.25.0 in package.json)",
    pinnedBaseline: "0.25.0",
    requiredSeam: "Pre-acquire account attempt lease hook in AccountDirectoryPort / LlmMeshFacade",
    specification:
      "Minimal additive hook on LlmMeshFacade.createRoutePlanner or AccountDirectoryPort " +
      "that exposes trusted owner/account identity before acquisition and allows the host " +
      "to acquire and hold an exclusive lease until attempt completion, cleanup, and release.",
    rationale:
      "Holding a lock inside run() or after prepareAttempt() is too late because the service's " +
      "internal directory performs credential acquisition and refresh during prepareAttempt(). " +
      "Monkey-patching private service maps or serializing all accounts under a global lock is prohibited.",
  };
}

export interface AttemptRunnerBindingOptions {
  readonly lease: ClaudeAccountLease;
  readonly runner: ClaudeCodeCliRunner;
  readonly capabilities: ClaudeCodeCliCapabilities;
  readonly now?: () => number;
}

/**
 * Binds a trusted live lease to the ensuing attempt and ClaudeCodeCliRunner.
 * The lease is held through the whole inner stream — including the runner's
 * own reaping and file cleanup, which settle only when its iterator
 * completes — and released exactly once afterwards. Releasing on a terminal
 * event before the inner iterator completes would free the account while
 * the child tree is still being reaped, so the release lives only in the
 * outer finally.
 */
export function createBoundAttemptRunner(
  options: AttemptRunnerBindingOptions,
): ClaudeCodeCliRunner {
  const { lease, runner } = options;

  return {
    async *run(input) {
      let leaseReleased = false;
      try {
        const stream = runner.run(input);
        for await (const event of stream) {
          yield event;
        }
      } finally {
        if (!leaseReleased) {
          leaseReleased = true;
          await lease.release().catch(() => {});
        }
      }
    },
  };
}

/**
 * Bind the attempt runner without constructing the mesh runtime client:
 * client construction belongs to the mesh side once the pre-acquire seam
 * lands (gate 3A). Until then the bound runner is the servable unit.
 */
export function bindClaudeCodeAttemptRunner(
  options: AttemptRunnerBindingOptions,
): ClaudeCodeCliRunner {
  return createBoundAttemptRunner(options);
}
