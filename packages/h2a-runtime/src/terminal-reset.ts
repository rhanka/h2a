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
 * Sync limitation (rev351-1): the wrapped child runs in a BLOCKING spawnSync,
 * which owns a private libuv loop. A JS `process.on(signal)` handler installed
 * around it can never run synchronously: delivery is deferred until the event
 * loop regains control, and removing the listener right after spawnSync
 * destroys the pending signal. Trapping therefore swallows the signal (exit 0)
 * and blocks the wrapper until the child ends on its own (plus it breaks
 * Ctrl-C in the reconnect loop). So this wrapper installs NO signal handlers:
 * a signal addressed to the wrapper itself keeps its default disposition (the
 * wrapper dies promptly, like SIGKILL — residual, no reset possible), while a
 * signal that kills only the CHILD is observed synchronously via r.signal and
 * mapped to 128+n by statusFromSpawnResult (never 0).
 */

import { spawnSync } from "node:child_process";
import { writeSync } from "node:fs";

const ESC = "\x1b";

/**
 * Unconditional sane-state reset for the client terminal. Every sequence is a
 * no-op when the terminal is already sane: clearing an unset private mode,
 * showing a visible cursor, leaving the normal keypad, or zeroing
 * modifyOtherKeys changes nothing.
 *
 * Prefix `\x18` (CAN) + `ESC \` (ST) aborts a truncated CSI/OSC sequence when
 * the child died mid-write; without it the reset itself could be swallowed
 * inside the incomplete sequence. Kitty keyboard stacks are per-screen
 * (main vs alternate, cf. terminal-modes.ts): pop up to 16 entries and zero
 * flags BEFORE leaving the alternate screen, then pop again after returning
 * to the main screen. Without a byte stream there is no exact stack to pop,
 * so the maximal pop is the best-effort bound (the tracked native attach path
 * pops exactly instead).
 */
export const CLIENT_TERMINAL_RESET_SEQUENCE =
  `\x18${ESC}\\` + // abort any truncated CSI/OSC first
  `${ESC}[?2026l` + // end synchronized output first
  `${ESC}[<16u${ESC}[=0u` + // pop Kitty alternate-screen stack before leaving it
  `${ESC}[?1l` + // normal cursor keys
  `${ESC}[?1000l${ESC}[?1002l${ESC}[?1003l` + // mouse reporting
  `${ESC}[?1004l` + // focus reporting (the ^[[I/^[[O stuck symptom)
  `${ESC}[?1006l${ESC}[?1015l` + // mouse encoding
  `${ESC}[?2004l` + // bracketed paste
  `${ESC}[?47l${ESC}[?1047l${ESC}[?1049l` + // back to the normal screen
  `${ESC}[<16u${ESC}[=0u` + // pop Kitty main-screen stack after returning
  `${ESC}[?25h` + // visible cursor
  `${ESC}>` + // normal keypad
  `${ESC}[>4;0m`; // modifyOtherKeys off

/** Write the reset to a TTY stdout, synchronously so teardown paths can use it. */
export function resetClientTerminal(
  stdout: { isTTY?: boolean; fd?: unknown; write?: (chunk: string) => unknown } = process.stdout,
): boolean {
  try {
    if (stdout.isTTY !== true) return false;
    if (typeof stdout.fd === "number") {
      writeSync(stdout.fd, CLIENT_TERMINAL_RESET_SEQUENCE);
    } else {
      stdout.write?.(CLIENT_TERMINAL_RESET_SEQUENCE);
    }
    return true;
  } catch {
    return false;
  }
}

/** POSIX signal numbers for the 128+n exit-code mapping. */
export const SIGNAL_NUMBERS: Readonly<Record<string, number>> = {
  SIGHUP: 1,
  SIGINT: 2,
  SIGQUIT: 3,
  SIGILL: 4,
  SIGTRAP: 5,
  SIGABRT: 6,
  SIGBUS: 7,
  SIGFPE: 8,
  SIGKILL: 9,
  SIGUSR1: 10,
  SIGSEGV: 11,
  SIGUSR2: 12,
  SIGPIPE: 13,
  SIGALRM: 14,
  SIGTERM: 15,
  SIGSTKFLT: 16,
  SIGCHLD: 17,
  SIGCONT: 18,
  SIGSTOP: 19,
  SIGTSTP: 20,
  SIGTTIN: 21,
  SIGTTOU: 22,
  SIGURG: 23,
  SIGXCPU: 24,
  SIGXFSZ: 25,
  SIGVTALRM: 26,
  SIGPROF: 27,
  SIGWINCH: 28,
  SIGIO: 29,
  SIGPWR: 30,
  SIGSYS: 31,
};

export type SpawnResultLike = {
  readonly status: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly error?: unknown;
};

/**
 * Map a spawnSync result to a process exit code that preserves signal-death
 * semantics. A child killed by a signal has status null: the old `?? 0`
 * reported that as success. Now it reports 128+signo; a spawn error reports
 * 127; a null status with no signal and no error (should not happen) reports
 * 1 rather than 0.
 */
export function statusFromSpawnResult(result: SpawnResultLike): number {
  if (result.signal) return 128 + (SIGNAL_NUMBERS[result.signal] ?? 0);
  if (result.error !== undefined && result.error !== null) return 127;
  return result.status ?? 1;
}

type StdinLike = Pick<NodeJS.ReadStream, "isTTY" | "isRaw" | "setRawMode"> & {
  readonly fd?: unknown;
};

/**
 * Run `run` (usually one blocking inherit-stdio child) and restore the client
 * terminal on every SYNCHRONOUS exit path (normal return, sync exception,
 * child signal death observed via its spawn result). Restores termios
 * (`stty -g`) and stdin raw mode like withAttachTerminalRecovery, plus the
 * unconditional VT reset. Installs no signal handlers (see header): trapping
 * around spawnSync would swallow and block.
 */
export function withClientTerminalReset<T>(
  run: () => T,
  reset: () => void = () => {
    resetClientTerminal();
  },
  stdin: StdinLike = process.stdin,
): T {
  const wasRaw = stdin.isRaw === true;
  const stdinFd = (stdin as { fd?: unknown }).fd;
  const ttyState =
    stdin.isTTY === true &&
    typeof stdinFd === "number" &&
    process.platform !== "win32"
      ? (() => {
          try {
            return spawnSync("stty", ["-g"], {
              stdio: [stdinFd, "pipe", "ignore"],
              encoding: "utf8",
            });
          } catch {
            return undefined;
          }
        })()
      : undefined;
  try {
    return run();
  } finally {
    try {
      reset();
    } catch {
      // Best effort on teardown; run's own outcome takes precedence.
    }
    try {
      if (stdin.isTTY === true) {
        try {
          stdin.setRawMode?.(wasRaw);
        } catch {
          // Restoring raw must never mask run's outcome.
        }
      }
      const saved = ttyState as
        | { status?: number; stdout?: unknown }
        | undefined;
      if (
        saved?.status === 0 &&
        typeof saved.stdout === "string" &&
        saved.stdout.trim() &&
        typeof stdinFd === "number"
      ) {
        try {
          spawnSync("stty", [saved.stdout.trim()], {
            stdio: [stdinFd, "ignore", "ignore"],
          });
        } catch {
          // Best effort; the VT reset above already ran.
        }
      }
    } catch {
      // Best effort on teardown; run's own outcome takes precedence.
    }
  }
}
