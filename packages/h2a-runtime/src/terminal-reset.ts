/**
 * Sane-state reset for h2a verbs that hand the REAL client terminal to a child
 * over inherited stdio (`tmux attach`, foreground CLI, `kubectl exec` attach).
 *
 * Unlike the native attach path (native-terminal/op.ts), these verbs never see
 * the child's output bytes, so there is nothing to track: emit a fixed,
 * idempotent reset that is a no-op on an already-sane terminal. The DEC set
 * and ordering mirror TerminalModeTracker's DEC_MODES so both mechanisms stay
 * comparable (see terminal-reset.test.ts for the cross-check).
 *
 * Covered exit paths: normal return, synchronous exception, and catchable
 * signals (SIGINT/SIGTERM/SIGHUP/SIGQUIT). Installing handlers keeps the
 * wrapper alive past the signal so the reset is actually written; the signal
 * is then re-raised with default disposition to preserve signal-death
 * semantics. Delivery during spawnSync is deferred by the runtime (the event
 * loop is blocked), so a signal landing mid-child only takes effect once the
 * child ends. SIGKILL/SIGSTOP stay uncatchable and remain a residual risk.
 */

import { writeSync } from "node:fs";

const ESC = "\x1b";

/**
 * Unconditional sane-state reset for the client terminal. Every sequence is a
 * no-op when the terminal is already sane: clearing an unset private mode,
 * showing a visible cursor, leaving the normal keypad, or zeroing
 * modifyOtherKeys changes nothing. Kitty's `=0u` clears the current flags but
 * cannot pop a stack the dead child pushed to — a best-effort bound of the
 * untracked path (the tracked native attach path pops exactly instead).
 */
export const CLIENT_TERMINAL_RESET_SEQUENCE =
  `${ESC}[?2026l` + // end synchronized output first
  `${ESC}[?1l` + // normal cursor keys
  `${ESC}[?1000l${ESC}[?1002l${ESC}[?1003l` + // mouse reporting
  `${ESC}[?1004l` + // focus reporting (the ^[[I/^[[O stuck symptom)
  `${ESC}[?1006l${ESC}[?1015l` + // mouse encoding
  `${ESC}[?2004l` + // bracketed paste
  `${ESC}[?47l${ESC}[?1047l${ESC}[?1049l` + // back to the normal screen
  `${ESC}[=0u` + // kitty keyboard flags to zero
  `${ESC}[?25h` + // visible cursor
  `${ESC}>` + // normal keypad
  `${ESC}[>4;0m`; // modifyOtherKeys off

/** Write the reset to a TTY stdout, synchronously so signal paths can use it. */
export function resetClientTerminal(
  stdout: { isTTY?: boolean; fd?: unknown } = process.stdout,
): boolean {
  try {
    if (stdout.isTTY !== true || typeof stdout.fd !== "number") return false;
    writeSync(stdout.fd, CLIENT_TERMINAL_RESET_SEQUENCE);
    return true;
  } catch {
    return false;
  }
}

const RESET_SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP", "SIGQUIT"] as const;

/**
 * Run `run` (usually one blocking inherit-stdio child) and restore the client
 * terminal on every exit path. Without installed handlers a signal would kill
 * this process immediately and the reset would never run; with them the
 * process survives until the child ends, resets, then re-raises the signal.
 */
export function withClientTerminalReset<T>(
  run: () => T,
  reset: () => void = () => {
    resetClientTerminal();
  },
): T {
  let signaled: (typeof RESET_SIGNALS)[number] | undefined;
  const handlers = new Map<(typeof RESET_SIGNALS)[number], () => void>();
  for (const signal of RESET_SIGNALS) {
    const handler = (): void => {
      signaled ??= signal;
      try {
        reset();
      } catch {
        // A last-resort path must never throw out of a signal handler.
      }
    };
    handlers.set(signal, handler);
    process.on(signal, handler);
  }
  try {
    const result = run();
    if (signaled !== undefined) process.kill(process.pid, signaled);
    return result;
  } finally {
    for (const [signal, handler] of handlers) {
      process.removeListener(signal, handler);
    }
    try {
      reset();
    } catch {
      // Best effort on teardown; run's own outcome takes precedence.
    }
  }
}
