/**
 * Operator break verbs (`identity unlock`, `lock break`) without a
 * core import.
 *
 * Breaking an identity or succession lock needs the core lock protocols, so
 * this package cannot implement it — but it also cannot import
 * `@sentropic/h2a` (undeclared runtime→core edge: isolated installs crash
 * with `ERR_MODULE_NOT_FOUND`). Instead the verbs delegate to the core CLI's
 * hidden `__operator-break` plumbing over the `h2a` binary (the same spawn
 * pattern `central-mcp.ts` already uses for `mcp-central-serve`) and relay
 * stdio and the exit code byte-for-byte, so user-visible behavior is
 * unchanged where core is installed.
 *
 * Fail-closed without core: a missing `h2a` binary (ENOENT) or an
 * already-delegated call (the hop marker, which guards new-runtime/old-core
 * skew where the hidden verb would dispatch back here and fork recursions)
 * prints a clean refusal instead of a module crash.
 */

import { spawnSync } from "node:child_process";

export const OPERATOR_BREAK_VERB = "__operator-break";
export const OPERATOR_BREAK_HOP_ENV = "H2A_OPERATOR_BREAK_HOP";
/**
 * Set by core on `process.env` when it dispatches to this runtime
 * (same-process dispatch): the exact core entry implementing the hidden
 * plumbing. Spawning it via `process.execPath` never depends on PATH and
 * always hits the lockstep core — which matters in test/dev checkouts where
 * no `h2a` binary is installed.
 */
export const CORE_ENTRY_ENV = "H2A_CORE_ENTRY";

export function coreSpawnTarget(env: NodeJS.ProcessEnv): { command: string; prefixArgs: string[] } {
  const entry = env[CORE_ENTRY_ENV];
  if (typeof entry === "string" && entry.length > 0) {
    return { command: process.execPath, prefixArgs: [entry] };
  }
  return { command: "h2a", prefixArgs: [] };
}

export interface OperatorBreakRunner {
  spawn: typeof spawnSync;
  env: NodeJS.ProcessEnv;
  stderr: { write(chunk: string): unknown };
  setExitCode: (code: number) => void;
}

const realRunner = (setExitCode: (code: number) => void): OperatorBreakRunner => ({
  spawn: spawnSync,
  env: process.env,
  stderr: process.stderr,
  setExitCode,
});

export function operatorBreak(
  lockPath: string,
  token: string,
  assertDead: boolean,
  setExitCode: (code: number) => void,
  runner: OperatorBreakRunner = realRunner(setExitCode),
): void {
  if (runner.env[OPERATOR_BREAK_HOP_ENV]) {
    runner.stderr.write(
      "[h2a] lock break unavailable: already delegated to the core CLI (version skew: update core and runtime lockstep)\n",
    );
    runner.setExitCode(1);
    return;
  }
  const target = coreSpawnTarget(runner.env);
  const args = [
    ...target.prefixArgs,
    OPERATOR_BREAK_VERB,
    "--lock", lockPath,
    "--token", token,
    ...(assertDead ? ["--assert-dead"] : []),
  ];
  // NB: spawnSync reports a failed spawn on `result.error` — it only throws
  // for invalid arguments. Both shapes mean the delegation cannot run.
  let result: ReturnType<typeof spawnSync>;
  try {
    result = runner.spawn(target.command, args, {
      stdio: "inherit",
      env: { ...runner.env, [OPERATOR_BREAK_HOP_ENV]: "1" },
    });
  } catch (error) {
    result = { status: null, error: error as Error } as ReturnType<typeof spawnSync>;
  }
  const spawnError = (result as { error?: NodeJS.ErrnoException }).error;
  if (spawnError) {
    if (spawnError.code === "ENOENT") {
      runner.stderr.write("[h2a] lock break unavailable: the core h2a CLI is not installed beside this runtime\n");
    } else {
      runner.stderr.write(
        `[h2a] lock break unavailable: cannot delegate to the core h2a CLI (${spawnError.code ?? spawnError.message})\n`,
      );
    }
    runner.setExitCode(1);
    return;
  }
  if (typeof result.status === "number") runner.setExitCode(result.status);
  else runner.setExitCode(1);
}
