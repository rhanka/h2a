import { spawn, spawnSync } from "node:child_process";

import type { CliProfile } from "./protocol-local.js";
import { resetClientTerminal, SIGNAL_NUMBERS } from "./terminal-reset.js";

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
  const wasRaw = (stdin as { isRaw?: boolean }).isRaw === true;
  const stdinFd = (stdin as { fd?: unknown }).fd;
  const savedTty =
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
  const restore = (): void => {
    try {
      doReset();
    } catch {
      // Best effort.
    }
    try {
      if (stdin.isTTY) stdin.setRawMode?.(wasRaw);
    } catch {
      // Never mask the login outcome.
    }
    try {
      const saved = savedTty as
        | { status?: number; stdout?: unknown }
        | undefined;
      if (
        saved?.status === 0 &&
        typeof saved.stdout === "string" &&
        saved.stdout.trim() &&
        typeof stdinFd === "number"
      ) {
        spawnSync("stty", [saved.stdout.trim()], {
          stdio: [stdinFd, "ignore", "ignore"],
        });
      }
    } catch {
      // Best effort.
    }
  };
  return new Promise((resolve) => {
    let settled = false;
    const finish = (code: number): void => {
      if (settled) return;
      settled = true;
      uninstallSignals();
      restore();
      resolve(code);
    };
    const signalHandlers = new Map<string, () => void>();
    const uninstallSignals = (): void => {
      for (const [signal, handler] of signalHandlers) {
        process.removeListener(signal, handler);
      }
      signalHandlers.clear();
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
    for (const signal of ["SIGHUP", "SIGINT", "SIGQUIT", "SIGTERM"] as const) {
      const handler = (): void => {
        try {
          child?.kill?.(signal);
        } catch {
          // Best effort forwarding before exiting.
        }
        try {
          restore();
        } finally {
          uninstallSignals();
          process.exit(128 + (SIGNAL_NUMBERS[signal] ?? 0));
        }
      };
      signalHandlers.set(signal, handler);
      process.on(signal, handler);
    }
    const childEvents = child as unknown as {
      on(event: string, listener: (...args: never[]) => void): unknown;
    };
    childEvents.on("error", () => finish(127));
    childEvents.on("close", (code: number | null, signal?: NodeJS.Signals) => {
      if (signal) finish(128 + (SIGNAL_NUMBERS[signal] ?? 0));
      else finish(code ?? 1);
    });
  });
}
