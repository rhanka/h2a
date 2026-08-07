import type * as nodePty from "node-pty";
import { accessSync, constants as fsConstants } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const LINUX_PARENT_DEATH_SIGNAL = "SIGUSR2";
const LINUX_FORCE_KILL_SIGNAL = "SIGUSR1";
const LINUX_PTY_GUARDIAN_SCRIPT = [
  'h2a_forward() { h2a_signal=$1; trap "" "$h2a_signal"; /bin/kill "-$h2a_signal" -- "-$$" 2>/dev/null || :; trap "h2a_forward $h2a_signal" "$h2a_signal"; }',
  'h2a_force() { trap - USR1 USR2; /bin/kill -KILL -- "-$$"; }',
  "trap 'h2a_forward HUP' HUP",
  "trap 'h2a_forward INT' INT",
  "trap 'h2a_forward TERM' TERM",
  "trap h2a_force USR1 USR2",
  '"$@" < /dev/tty &',
  "h2a_child=$!",
  "while true; do",
  '  wait "$h2a_child"',
  "  h2a_status=$?",
  '  kill -0 "$h2a_child" 2>/dev/null || exit "$h2a_status"',
  "done",
].join("\n");

function linuxSetprivPath(): string {
  for (const candidate of ["/usr/bin/setpriv", "/bin/setpriv"]) {
    try {
      accessSync(candidate, fsConstants.X_OK);
      return candidate;
    } catch {
      // Try the next fixed system path. Never resolve this boundary through PATH.
    }
  }
  throw new Error(
    "native terminal PTY crash containment requires util-linux setpriv",
  );
}

function guardedSpawnCommand(options: Parameters<PtySpawner>[0]): {
  command: string;
  args: string[];
} {
  if (process.platform !== "linux") {
    return { command: options.command, args: [...options.args] };
  }
  return {
    command: linuxSetprivPath(),
    args: [
      "--pdeathsig",
      LINUX_PARENT_DEATH_SIGNAL,
      "--",
      "/bin/sh",
      "-c",
      LINUX_PTY_GUARDIAN_SCRIPT,
      "h2a-pty-guardian",
      options.command,
      ...options.args,
    ],
  };
}

export type PtyHandle = {
  readonly pid: number;
  readonly cols: number;
  readonly rows: number;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(signal?: string): void;
  onData(handler: (chunk: string) => void): { dispose(): void };
  onExit(handler: (event: { exitCode: number; signal?: number }) => void): {
    dispose(): void;
  };
};

export type PtySpawner = (options: {
  command: string;
  args: ReadonlyArray<string>;
  cwd: string;
  env: Readonly<Record<string, string>>;
  cols: number;
  rows: number;
}) => PtyHandle;

export const nodePtySpawner: PtySpawner = (options) => {
  // Lazy load node-pty so test environments without the native binary still
  // import this module — they substitute a stub spawner.

  const pty: typeof nodePty = require("node-pty");
  const guarded = guardedSpawnCommand(options);
  const proc = pty.spawn(guarded.command, guarded.args, {
    cwd: options.cwd,
    env: options.env,
    cols: options.cols,
    rows: options.rows,
    name: "xterm-256color",
  });
  return {
    get pid() {
      return proc.pid;
    },
    get cols() {
      return options.cols;
    },
    get rows() {
      return options.rows;
    },
    write(data) {
      proc.write(data);
    },
    resize(cols, rows) {
      proc.resize(cols, rows);
    },
    kill(signal) {
      if (process.platform === "linux") {
        proc.kill(
          signal === "SIGKILL" ? LINUX_FORCE_KILL_SIGNAL : signal,
        );
      } else {
        proc.kill(signal);
      }
    },
    onData(handler) {
      const subscription = proc.onData(handler);
      return { dispose: () => subscription.dispose() };
    },
    onExit(handler) {
      const subscription = proc.onExit((event) => {
        const payload: { exitCode: number; signal?: number } = {
          exitCode: event.exitCode,
        };
        if (event.signal !== undefined) payload.signal = event.signal;
        handler(payload);
      });
      return { dispose: () => subscription.dispose() };
    },
  };
};
