import { spawn } from "node:child_process";

import type { CliProfile } from "./protocol-local.js";
import {
  resetClientTerminal,
  restoreTtyState,
  saveTtyState,
  SIGNAL_NUMBERS,
} from "./terminal-reset.js";

/**
 * The local enrollment command for each profile that ships a non-interactive
 * (or terminal-driven) login. Profiles without an entry authenticate through
 * their own in-CLI flow (e.g. `agy` opens a browser / prints an SSH-mode URL).
 */
const PROFILE_LOGIN: Partial<Record<CliProfile, LoginCommand>> = {
  codex: { command: "codex", args: ["login"] },
  claude: { command: "claude", args: ["auth", "login"] },
};

export type LoginCommand = {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
};

export function getLoginCommand(profile: CliProfile): LoginCommand | undefined {
  return PROFILE_LOGIN[profile];
}

export type RunInteractive = (cmd: LoginCommand) => Promise<number>;

/**
 * rev351r2-4: how long the login waits for a forwarded parent signal to take
 * effect before escalating to SIGKILL. Cooperative children die in
 * milliseconds; only a signal-ignoring child ever sees the SIGKILL.
 */
const LOGIN_SIGNAL_GRACE_MS = 500;

export type InteractiveLoginDeps = {
  readonly spawnImpl?: (
    command: string,
    args: ReadonlyArray<string>,
    options: { stdio: "inherit" },
  ) => {
    on(event: string, listener: (...args: never[]) => void): unknown;
    kill?(signal?: NodeJS.Signals): boolean;
  };
  readonly reset?: () => void;
  readonly stdin?: Pick<NodeJS.ReadStream, "isTTY" | "isRaw" | "setRawMode"> & {
    readonly fd?: unknown;
  };
  readonly stdout?: { isTTY?: boolean; fd?: unknown };
};

/**
 * rev351-3.3: `h2a auth login` hands the REAL terminal to the CLI login flow
 * over inherited stdio. Reset the VT modes and restore termios/raw on every
 * exit path (clean exit, spawn error, child signal death mapped to 128+n).
 * Async spawn: the event loop runs, so parent signals forward to the child,
 * reset, then exit 128+n (like the native attach path).
 */
export function runInteractiveLogin(
  cmd: LoginCommand,
  deps: InteractiveLoginDeps = {},
): Promise<number> {
  const spawnImpl =
    deps.spawnImpl ??
    ((command: string, args: ReadonlyArray<string>, options: { stdio: "inherit" }) =>
      spawn(command, [...args], options));
  const doReset =
    deps.reset ??
    (() => {
      resetClientTerminal(
        (deps.stdout as { isTTY?: boolean; fd?: unknown }) ?? process.stdout,
      );
    });
  const stdin = deps.stdin ?? process.stdin;
  // rev351r2-2: shared save/restore home (terminal-reset.ts), no local copy.
  const ttyState = saveTtyState(stdin);
  const restore = (): void => {
    restoreTtyState(ttyState, stdin, doReset);
  };
  return new Promise((resolve) => {
    let settled = false;
    // rev351r2-4: set once a parent signal arrives; the child `close` below
    // then exits 128+n instead of resolving the login promise, and `finish`
    // stays out of the way so a late spawn error cannot resolve after exit.
    let signaled: { readonly number: number } | null = null;
    let graceTimer: NodeJS.Timeout | null = null;
    const signalHandlers = new Map<string, () => void>();
    const uninstallSignals = (): void => {
      for (const [signal, handler] of signalHandlers) {
        process.removeListener(signal, handler);
      }
      signalHandlers.clear();
    };
    const exitAfterSignal = (): void => {
      const pending = signaled;
      if (!pending) return;
      signaled = null;
      if (graceTimer) {
        clearTimeout(graceTimer);
        graceTimer = null;
      }
      try {
        restore();
      } finally {
        uninstallSignals();
        process.exit(128 + pending.number);
      }
    };
    const finish = (code: number): void => {
      if (settled || signaled) return;
      settled = true;
      uninstallSignals();
      restore();
      resolve(code);
    };
    let child:
      | { kill?(signal?: NodeJS.Signals): boolean }
      | undefined;
    try {
      child = spawnImpl(cmd.command, [...cmd.args], { stdio: "inherit" }) as {
        kill?(signal?: NodeJS.Signals): boolean;
      };
    } catch {
      finish(127);
      return;
    }
    const childEvents = child as unknown as {
      on(event: string, listener: (...args: never[]) => void): unknown;
    };
    for (const signal of ["SIGHUP", "SIGINT", "SIGQUIT", "SIGTERM"] as const) {
      const handler = (): void => {
        if (signaled) {
          // Second signal during the grace wait: escalate and leave at once.
          if (graceTimer) {
            clearTimeout(graceTimer);
            graceTimer = null;
          }
          try {
            child?.kill?.("SIGKILL");
          } catch {
            // Best effort escalation before exiting.
          }
          exitAfterSignal();
          return;
        }
        signaled = { number: SIGNAL_NUMBERS[signal] ?? 0 };
        try {
          child?.kill?.(signal);
        } catch {
          // Best effort forwarding before waiting for the child.
        }
        if (!signaled) return;
        // rev351r2-4: wait for the forwarded signal to take effect instead of
        // exiting at once — a child that ignores it (trap '' TERM) would
        // otherwise survive orphaned and scribble after the prompt returns.
        graceTimer = setTimeout(() => {
          graceTimer = null;
          try {
            child?.kill?.("SIGKILL");
          } catch {
            // Best effort escalation; the close below exits.
          }
          // A real child always reports close after SIGKILL; never hang the
          // login if it somehow does not.
          graceTimer = setTimeout(exitAfterSignal, LOGIN_SIGNAL_GRACE_MS);
          graceTimer.unref?.();
        }, LOGIN_SIGNAL_GRACE_MS);
        graceTimer.unref?.();
      };
      signalHandlers.set(signal, handler);
      process.on(signal, handler);
    }
    childEvents.on("error", () => finish(127));
    childEvents.on("close", (code: number | null, signal?: NodeJS.Signals) => {
      if (signaled) {
        exitAfterSignal();
        return;
      }
      if (signal) finish(128 + (SIGNAL_NUMBERS[signal] ?? 0));
      else finish(code ?? 1);
    });
  });
}
