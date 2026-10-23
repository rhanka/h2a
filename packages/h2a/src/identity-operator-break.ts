/**
 * Hidden operator-break plumbing for the runtime CLI.
 *
 * The runtime package (`@sentropic/h2a-runtime`) must not name this package:
 * any static or dynamic `@sentropic/h2a` import in the runtime dist breaks
 * isolated installs with `ERR_MODULE_NOT_FOUND`. The runtime's
 * `identity unlock` / `lock break` verbs therefore spawn
 * `h2a __operator-break --lock <path> --token <t> [--assert-dead]` and relay
 * its stdio and exit code byte-for-byte, instead of importing the breakers.
 *
 * Hidden by design: not in the CLI contract, the command map, or `--help`.
 * The user-facing verbs stay `h2a identity unlock` and `h2a lock break`
 * (dispatched to the runtime, which delegates here). This module owns the
 * core-layout rule the runtime must not know (which lock paths are identity
 * locks) and the exact user-visible output previously printed by the
 * runtime, so the delegation is behavior-identical.
 *
 * Exit codes: 0 broken; 1 refused or failed (with the refusal on stderr);
 * 2 usage error. Stdout carries exactly one JSON line (the machine result).
 */

import { basename, dirname } from "node:path";

import { breakIdentityLockAsOperator } from "./runtime/local-files/identity-fence.js";
import {
  breakLockAsOperator,
  type OperatorBreakResult,
} from "./runtime/local-files/succession-lock.js";

export const OPERATOR_BREAK_VERB = "__operator-break";

export interface OperatorBreakStreams {
  stdout: { write(chunk: string): unknown };
  stderr: { write(chunk: string): unknown };
}

const USAGE =
  "usage: h2a __operator-break --lock <path> --token <token> [--assert-dead]\n" +
  "  Hidden plumbing for `h2a identity unlock` / `h2a lock break`; not for direct use.\n";

function parseArgs(argv: readonly string[]):
  | { ok: true; lock: string; token: string; assertDead: boolean }
  | { ok: false; message: string } {
  let lock: string | undefined;
  let token: string | undefined;
  let assertDead = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--lock" && i + 1 < argv.length) lock = argv[++i];
    else if (arg === "--token" && i + 1 < argv.length) token = argv[++i];
    else if (arg === "--assert-dead") assertDead = true;
    else return { ok: false, message: `unknown argument: ${arg}` };
  }
  if (lock === undefined) return { ok: false, message: "missing required --lock <path>" };
  if (token === undefined) return { ok: false, message: "missing required --token <token>" };
  return { ok: true, lock, token, assertDead };
}

export function runIdentityOperatorBreak(
  argv: readonly string[],
  streams: OperatorBreakStreams,
): number {
  const parsed = parseArgs(argv);
  if (!parsed.ok) {
    streams.stderr.write(`h2a __operator-break: ${parsed.message}\n${USAGE}`);
    return 2;
  }
  // Core-layout rule (was inlined in the runtime CLI): identity locks live at
  // `<root>/identity/.lock`; everything else is a succession lock.
  const identityLock = basename(parsed.lock) === ".lock" && basename(dirname(parsed.lock)) === "identity";
  let result: OperatorBreakResult;
  try {
    const breaker = identityLock ? breakIdentityLockAsOperator : breakLockAsOperator;
    result = breaker(parsed.lock, { expectToken: parsed.token, assertDead: parsed.assertDead });
  } catch (error) {
    streams.stderr.write(
      `[h2a] lock break failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 1;
  }
  const displayPath = identityLock ? "identity/.lock" : parsed.lock;
  streams.stdout.write(`${JSON.stringify({ path: displayPath, ...result })}\n`);
  if (!result.broken) {
    streams.stderr.write(
      `[h2a] lock break refused: ${result.reason}${result.pid !== undefined ? ` (pid ${result.pid})` : ""}\n`,
    );
    if (result.reason === "assert-dead-required") {
      streams.stderr.write("[h2a] verify the holder has stopped, then explicitly pass --assert-dead; no PID is killed\n");
    }
    return 1;
  }
  return 0;
}
