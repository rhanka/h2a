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
import { randomUUID } from "node:crypto";
import {
  closeSync,
  fstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { constants as osConstants } from "node:os";
import { join } from "node:path";
import { readProcessStartTime } from "./proc-identity.js";

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

/**
 * rev351r2-6: signal numbers for the 128+n exit-code mapping, read from the
 * running platform (`os.constants.signals`) with a Linux fallback for names
 * the platform does not know. A frozen literal got macOS/BSD numbers wrong
 * (SIGBUS 10 not 7, SIGUSR1 30 not 10, SIGCHLD 20, SIGSTOP 17, ...); the
 * operational signals (HUP/INT/QUIT/KILL/TERM/SEGV/ABRT) agree everywhere,
 * but crash-code mapping should still use the platform's own table.
 */
const FALLBACK_SIGNAL_NUMBERS: Readonly<Record<string, number>> = {
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

function platformSignalNumber(name: string): number {
  const fromOs = (osConstants.signals as Record<string, number | undefined>)[
    name
  ];
  if (typeof fromOs === "number") return fromOs;
  return FALLBACK_SIGNAL_NUMBERS[name] ?? 0;
}

/** POSIX signal numbers for the 128+n exit-code mapping. */
export const SIGNAL_NUMBERS: Readonly<Record<string, number>> =
  Object.fromEntries(
    Object.keys(FALLBACK_SIGNAL_NUMBERS).map((name) => [
      name,
      platformSignalNumber(name),
    ]),
  );

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

export type TtyStdin = Pick<
  NodeJS.ReadStream,
  "isTTY" | "isRaw" | "setRawMode"
> & {
  readonly fd?: unknown;
};

export type TtyStdout = {
  readonly isTTY?: boolean;
  readonly fd?: unknown;
};

export type SttySaveResult = {
  readonly status?: number | null;
  readonly stdout?: unknown;
};

/**
 * rev351r2-2: injectable `stty` runner so the save/restore logic is
 * unit-testable without a real TTY. The default shells out like before.
 */
export type SttySpawn = (
  args: ReadonlyArray<string>,
  options: { readonly stdinFd: number; readonly capture: boolean },
) => SttySaveResult;

const defaultSttySpawn: SttySpawn = (args, { stdinFd, capture }) => {
  const result = spawnSync("stty", [...args], {
    stdio: [stdinFd, capture ? "pipe" : "ignore", "ignore"],
    encoding: "utf8",
  });
  return result as SttySaveResult;
};

export type TtyDeviceIdentity = {
  readonly uid: number;
  readonly dev: number;
  readonly rdev: number;
  readonly key: string;
};

export type TtyBaselineRole = "guard" | "active";

export type TtyBaselineAcquireResult = {
  readonly key: string;
  readonly token: string;
  readonly baseline: string | undefined;
  readonly baselineWasRaw: boolean;
};

export type TtyBaselineSetSuspendedResult = {
  readonly shouldRestoreNow: boolean;
  readonly baseline: string | undefined;
  readonly baselineWasRaw: boolean | undefined;
};

export type TtyBaselineReleaseResult = {
  readonly released: boolean;
  readonly restoreBaseline: boolean;
  readonly isLastHolder: boolean;
  readonly baseline: string | undefined;
  readonly baselineWasRaw: boolean | undefined;
};

type TtyBaselineHolderRecord = {
  token: string;
  pid: number;
  startTime?: number;
  role: TtyBaselineRole;
  wasRaw: boolean;
  suspended: boolean;
};

type TtyBaselineFileRecord = {
  baseline?: string;
  baselineWasRaw?: boolean;
  holders: TtyBaselineHolderRecord[];
};

export type TtyBaselineRegistryOptions = {
  readonly env?: NodeJS.ProcessEnv;
  readonly runtimeDir?: string | null;
  readonly pid?: number;
  readonly now?: () => number;
  readonly isPidAlive?: (pid: number) => boolean;
  readonly readStartTime?: (pid: number) => number | undefined;
  readonly resolveDevice?: (fd: number) => TtyDeviceIdentity | undefined;
  readonly lockStaleMs?: number;
  readonly lockMaxRetries?: number;
  readonly lockRetryWaitMs?: number;
  readonly sleepMs?: (ms: number) => void;
};

const LOCK_SLEEP_SAB = new Int32Array(new SharedArrayBuffer(4));

function defaultSleepMs(ms: number): void {
  if (ms <= 0) return;
  Atomics.wait(LOCK_SLEEP_SAB, 0, 0, ms);
}

function defaultIsPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | undefined)?.code;
    return code === "EPERM";
  }
}

export function resolveTtyDeviceIdentity(fd: number): TtyDeviceIdentity | undefined {
  if (!Number.isInteger(fd) || fd < 0) return undefined;
  try {
    const st = fstatSync(fd);
    if (!st.isCharacterDevice()) return undefined;
    const uid = typeof process.getuid === "function" ? process.getuid() : 0;
    const dev = Number(st.dev);
    const rdev = Number(st.rdev);
    return { uid, dev, rdev, key: `${uid}-${dev}-${rdev}` };
  } catch {
    return undefined;
  }
}

/**
 * Coordinates the original controlling-TTY baseline (`stty -g` + `wasRaw`)
 * across guard parents, child attaches, suspend/resume, concurrent sessions,
 * and uncatchable worker crashes. Keyed by `(uid, st_dev, st_rdev)`.
 */
export class TtyBaselineRegistry {
  readonly #env: NodeJS.ProcessEnv | undefined;
  readonly #runtimeDir: string | null | undefined;
  readonly #pid: number | undefined;
  readonly #now: () => number;
  readonly #isPidAlive: (pid: number) => boolean;
  readonly #readStartTime: (pid: number) => number | undefined;
  readonly #resolveDevice: (fd: number) => TtyDeviceIdentity | undefined;
  readonly #lockStaleMs: number;
  readonly #lockMaxRetries: number;
  readonly #lockRetryWaitMs: number;
  readonly #sleepMs: (ms: number) => void;
  readonly #memoryRecords = new Map<string, TtyBaselineFileRecord>();

  constructor(options: TtyBaselineRegistryOptions = {}) {
    this.#env = options.env;
    this.#runtimeDir = options.runtimeDir;
    this.#pid = options.pid;
    this.#now = options.now ?? (() => Date.now());
    this.#isPidAlive = options.isPidAlive ?? defaultIsPidAlive;
    this.#readStartTime = options.readStartTime ?? readProcessStartTime;
    this.#resolveDevice = options.resolveDevice ?? resolveTtyDeviceIdentity;
    this.#lockStaleMs = options.lockStaleMs ?? 5000;
    this.#lockMaxRetries = options.lockMaxRetries ?? 40;
    this.#lockRetryWaitMs = options.lockRetryWaitMs ?? 5;
    this.#sleepMs = options.sleepMs ?? defaultSleepMs;
  }

  resolveKey(fd: number): TtyDeviceIdentity | undefined {
    return this.#resolveDevice(fd);
  }

  #resolveRootDir(): string | undefined {
    if (this.#runtimeDir !== undefined) {
      return this.#runtimeDir ? join(this.#runtimeDir, "h2a-tty-baseline") : undefined;
    }
    const env = this.#env ?? process.env;
    const xdg = env["XDG_RUNTIME_DIR"]?.trim();
    if (xdg) return join(xdg, "h2a-tty-baseline");
    const cfg = env["REMOTE_CLI_CONFIG_HOME"]?.trim();
    if (cfg) return join(cfg, "h2a-tty-baseline");
    return undefined;
  }

  #isHolderAlive(pid: number, recordedStartTime?: number): boolean {
    if (!this.#isPidAlive(pid)) return false;
    if (recordedStartTime !== undefined) {
      const currentStartTime = this.#readStartTime(pid);
      if (currentStartTime !== undefined && currentStartTime !== recordedStartTime) {
        return false;
      }
    }
    return true;
  }

  #pruneHolders(holders: readonly TtyBaselineHolderRecord[]): TtyBaselineHolderRecord[] {
    return holders.filter((h) => this.#isHolderAlive(h.pid, h.startTime));
  }

  #toKey(fdOrKey: number | string | TtyDeviceIdentity): string | undefined {
    if (typeof fdOrKey === "string") return fdOrKey;
    if (typeof fdOrKey === "number") {
      return this.#resolveDevice(fdOrKey)?.key;
    }
    return fdOrKey.key;
  }

  #withRecord<R>(
    key: string,
    mutate: (record: TtyBaselineFileRecord | undefined) => {
      next: TtyBaselineFileRecord | undefined;
      result: R;
    },
  ): R {
    const rootDir = this.#resolveRootDir();
    if (!rootDir) {
      const current = this.#memoryRecords.get(key);
      const clone: TtyBaselineFileRecord | undefined = current
        ? {
            ...(current.baseline !== undefined ? { baseline: current.baseline } : {}),
            ...(current.baselineWasRaw !== undefined
              ? { baselineWasRaw: current.baselineWasRaw }
              : {}),
            holders: current.holders.map((h) => ({ ...h })),
          }
        : undefined;
      const { next, result } = mutate(clone);
      if (!next || next.holders.length === 0) {
        this.#memoryRecords.delete(key);
      } else {
        this.#memoryRecords.set(key, next);
      }
      return result;
    }

    try {
      mkdirSync(rootDir, { recursive: true, mode: 0o700 });
    } catch {
      // Fallback safely to mutation on undefined if runtime dir cannot be created.
      const { result } = mutate(undefined);
      return result;
    }
    const filePath = join(rootDir, `${key}.json`);
    const lockPath = `${filePath}.lock`;
    const pid = this.#pid ?? process.pid;
    const startTime = this.#readStartTime(pid);
    let acquiredLock = false;

    for (let attempt = 0; attempt < this.#lockMaxRetries; attempt += 1) {
      try {
        const lockFd = openSync(lockPath, "wx", 0o600);
        try {
          writeSync(lockFd, `${pid}:${startTime ?? ""}`);
        } finally {
          closeSync(lockFd);
        }
        acquiredLock = true;
        break;
      } catch (err) {
        const code = (err as NodeJS.ErrnoException | undefined)?.code;
        if (code !== "EEXIST") break;
        let brokeStale = false;
        try {
          const lockRaw = readFileSync(lockPath, "utf8");
          const [pidPart, startPart] = lockRaw.trim().split(":");
          const lockPid = Number(pidPart);
          const lockStart = startPart ? Number(startPart) : undefined;
          const dead =
            !Number.isInteger(lockPid) ||
            lockPid <= 0 ||
            !this.#isHolderAlive(lockPid, Number.isFinite(lockStart) ? lockStart : undefined);
          let aged = false;
          if (!dead) {
            try {
              const st = statSync(lockPath);
              aged = this.#now() - st.mtimeMs >= this.#lockStaleMs;
            } catch {
              aged = true;
            }
          }
          if (dead || aged) {
            unlinkSync(lockPath);
            brokeStale = true;
          }
        } catch {
          // Another contender may have unlinked the lock between check steps.
        }
        if (!brokeStale) {
          this.#sleepMs(this.#lockRetryWaitMs);
        }
      }
    }

    try {
      let current: TtyBaselineFileRecord | undefined;
      try {
        const parsed = JSON.parse(readFileSync(filePath, "utf8")) as TtyBaselineFileRecord;
        if (parsed && Array.isArray(parsed.holders)) {
          current = parsed;
        }
      } catch {
        current = undefined;
      }

      const { next, result } = mutate(current);
      if (!next || next.holders.length === 0) {
        try {
          unlinkSync(filePath);
        } catch {
          // Ignore ENOENT
        }
      } else {
        const tmpPath = `${filePath}.${pid}.${randomUUID()}.tmp`;
        writeFileSync(tmpPath, JSON.stringify(next), { mode: 0o600 });
        renameSync(tmpPath, filePath);
      }
      return result;
    } finally {
      if (acquiredLock) {
        try {
          unlinkSync(lockPath);
        } catch {
          // Ignore ENOENT
        }
      }
    }
  }

  acquire(
    fdOrKey: number | string | TtyDeviceIdentity,
    options: {
      readonly role: TtyBaselineRole;
      readonly wasRaw: boolean;
      readonly captureBaseline: () => string | undefined;
    },
  ): TtyBaselineAcquireResult | undefined {
    const key = this.#toKey(fdOrKey);
    if (!key) return undefined;
    const pid = this.#pid ?? process.pid;
    const startTime = this.#readStartTime(pid);
    const token = randomUUID();

    return this.#withRecord<TtyBaselineAcquireResult>(key, (current) => {
      const holders = current ? this.#pruneHolders(current.holders) : [];
      const hasLiveNonSuspended = holders.some((h) => !h.suspended);
      // Capture baseline BEFORE entering raw/-opost, and NEVER overwrite an
      // already-live non-suspended session's S0 baseline with a dirty S1 capture.
      let baseline = current?.baseline;
      let baselineWasRaw = current?.baselineWasRaw;
      if (!hasLiveNonSuspended || baseline === undefined || baseline.length === 0) {
        const fresh = options.captureBaseline()?.trim();
        if (fresh) {
          baseline = fresh;
        } else if (!hasLiveNonSuspended) {
          baseline = undefined;
        }
        baselineWasRaw = options.wasRaw;
      } else if (baselineWasRaw === undefined) {
        baselineWasRaw = options.wasRaw;
      }

      holders.push({
        token,
        pid,
        ...(startTime !== undefined ? { startTime } : {}),
        role: options.role,
        wasRaw: options.wasRaw,
        suspended: false,
      });

      return {
        next: {
          ...(baseline !== undefined ? { baseline } : {}),
          ...(baselineWasRaw !== undefined ? { baselineWasRaw } : {}),
          holders,
        },
        result: {
          key,
          token,
          baseline,
          baselineWasRaw: baselineWasRaw ?? options.wasRaw,
        },
      };
    });
  }

  setSuspended(
    fdOrKey: number | string | TtyDeviceIdentity,
    token: string,
    suspended: boolean,
    options?: { readonly refreshBaseline?: () => string | undefined },
  ): TtyBaselineSetSuspendedResult | undefined {
    const key = this.#toKey(fdOrKey);
    if (!key) return undefined;
    return this.#withRecord<TtyBaselineSetSuspendedResult | undefined>(key, (current) => {
      if (!current) {
        return { next: undefined, result: undefined };
      }
      const holders = this.#pruneHolders(current.holders);
      const target = holders.find((h) => h.token === token);
      if (!target) {
        return {
          next: {
            ...(current.baseline !== undefined ? { baseline: current.baseline } : {}),
            ...(current.baselineWasRaw !== undefined ? { baselineWasRaw: current.baselineWasRaw } : {}),
            holders,
          },
          result: undefined,
        };
      }

      target.suspended = suspended;
      let baseline = current.baseline;
      if (!suspended && options?.refreshBaseline) {
        const otherLiveNonSuspended = holders.some((h) => h.token !== token && !h.suspended);
        if (!otherLiveNonSuspended) {
          const fresh = options.refreshBaseline()?.trim();
          if (fresh) baseline = fresh;
        }
      }
      const otherActive = holders.some(
        (h) => h.token !== token && h.role === "active" && !h.suspended,
      );
      return {
        next: {
          ...(baseline !== undefined ? { baseline } : {}),
          ...(current.baselineWasRaw !== undefined ? { baselineWasRaw: current.baselineWasRaw } : {}),
          holders,
        },
        result: {
          shouldRestoreNow: suspended ? !otherActive : false,
          baseline,
          baselineWasRaw: current.baselineWasRaw,
        },
      };
    });
  }

  release(
    fdOrKey: number | string | TtyDeviceIdentity,
    token: string,
  ): TtyBaselineReleaseResult | undefined {
    const key = this.#toKey(fdOrKey);
    if (!key) return undefined;
    return this.#withRecord<TtyBaselineReleaseResult>(key, (current) => {
      if (!current) {
        return {
          next: undefined,
          result: {
            released: false,
            restoreBaseline: true,
            isLastHolder: true,
            baseline: undefined,
            baselineWasRaw: undefined,
          },
        };
      }
      const pruned = this.#pruneHolders(current.holders);
      const remaining = pruned.filter((h) => h.token !== token);
      const otherActive = remaining.some((h) => h.role === "active" && !h.suspended);
      const isLastHolder = remaining.length === 0;
      return {
        next: isLastHolder
          ? undefined
          : {
              ...(current.baseline !== undefined ? { baseline: current.baseline } : {}),
              ...(current.baselineWasRaw !== undefined ? { baselineWasRaw: current.baselineWasRaw } : {}),
              holders: remaining,
            },
        result: {
          released: pruned.length !== remaining.length,
          restoreBaseline: !otherActive,
          isLastHolder,
          baseline: current.baseline,
          baselineWasRaw: current.baselineWasRaw,
        },
      };
    });
  }

  inspect(fdOrKey: number | string | TtyDeviceIdentity): TtyBaselineFileRecord | undefined {
    const key = this.#toKey(fdOrKey);
    if (!key) return undefined;
    const rootDir = this.#resolveRootDir();
    if (!rootDir) {
      const current = this.#memoryRecords.get(key);
      return current
        ? {
            ...(current.baseline !== undefined ? { baseline: current.baseline } : {}),
            ...(current.baselineWasRaw !== undefined
              ? { baselineWasRaw: current.baselineWasRaw }
              : {}),
            holders: current.holders.map((h) => ({ ...h })),
          }
        : undefined;
    }
    try {
      return JSON.parse(readFileSync(join(rootDir, `${key}.json`), "utf8")) as TtyBaselineFileRecord;
    } catch {
      return undefined;
    }
  }
}

export const defaultTtyBaselineRegistry = new TtyBaselineRegistry();

export type SaveTtyStateOptions = {
  readonly stdout?: TtyStdout | undefined;
  readonly stty?: SttySpawn | undefined;
  readonly registry?: TtyBaselineRegistry | null | undefined;
  readonly role?: TtyBaselineRole | undefined;
  readonly platform?: NodeJS.Platform | undefined;
};

export type TtyState = {
  readonly stdinFd: number | undefined;
  readonly stdoutFd?: number | undefined;
  readonly wasRaw: boolean;
  readonly saved: SttySaveResult | undefined;
  readonly stdoutSaved?: SttySaveResult | undefined;
};

type RegisteredEntry = {
  readonly registry: TtyBaselineRegistry;
  readonly key: string;
  readonly token: string;
  readonly fd: number;
};

type TtyStateMeta = {
  stdinEntry?: RegisteredEntry | undefined;
  stdoutEntry?: RegisteredEntry | undefined;
  restored: boolean;
  stty: SttySpawn;
  platform: NodeJS.Platform;
};

const ttyStateMeta = new WeakMap<TtyState, TtyStateMeta>();

function resolveNumericFd(stream?: { readonly fd?: unknown }): number | undefined {
  const fd = stream?.fd;
  return typeof fd === "number" && Number.isInteger(fd) && fd >= 0 ? fd : undefined;
}

function captureSttyMode(fd: number, stty: SttySpawn): SttySaveResult | undefined {
  try {
    return stty(["-g"], { stdinFd: fd, capture: true });
  } catch {
    return undefined;
  }
}

function sttyModeString(result: SttySaveResult | undefined): string | undefined {
  if (result?.status !== 0 || typeof result.stdout !== "string") return undefined;
  const trimmed = result.stdout.trim();
  return trimmed ? trimmed : undefined;
}

function resolveDistinctStdoutFd(
  stdinFd: number | undefined,
  stdout: TtyStdout | undefined,
  registry: TtyBaselineRegistry | null | undefined,
): number | undefined {
  if (stdout?.isTTY !== true) return undefined;
  const outFd = resolveNumericFd(stdout);
  if (outFd === undefined) return undefined;
  if (stdinFd === undefined) return outFd;
  if (outFd === stdinFd) return undefined;
  const resolveFn = registry
    ? (fd: number) => registry.resolveKey(fd)
    : resolveTtyDeviceIdentity;
  const inId = resolveFn(stdinFd);
  const outId = resolveFn(outFd);
  if (inId && outId) {
    return inId.key === outId.key ? undefined : outFd;
  }
  return outFd;
}

/**
 * rev351r2-2: single home for the termios save every client-terminal owner
 * (`withClientTerminalReset`, `run`, `attach`, `auth login`, `op`, `station`)
 * shares. Captures stdin raw mode plus `stty -g` on a real TTY (and distinct
 * `stdout.fd` if `stdout.isTTY === true` targets a different TTY device), using
 * `TtyBaselineRegistry` so concurrent or guarded attaches preserve `S0`.
 */
export function saveTtyState(
  stdin: TtyStdin,
  sttyOrOptions: SttySpawn | SaveTtyStateOptions = defaultSttySpawn,
  maybeOptions?: SaveTtyStateOptions,
): TtyState {
  const opts: SaveTtyStateOptions =
    typeof sttyOrOptions === "function"
      ? { ...maybeOptions, stty: sttyOrOptions }
      : sttyOrOptions ?? {};
  const stty = opts.stty ?? defaultSttySpawn;
  const platform = opts.platform ?? process.platform;
  const role = opts.role ?? "active";
  const registry = opts.registry === null ? null : (opts.registry ?? defaultTtyBaselineRegistry);
  const stdinWasRaw = (stdin as { isRaw?: boolean }).isRaw === true;
  const stdinFd = resolveNumericFd(stdin);
  const distinctStdoutFd = resolveDistinctStdoutFd(stdinFd, opts.stdout, registry);

  let effectiveWasRaw = stdinWasRaw;
  let saved: SttySaveResult | undefined;
  let stdoutSaved: SttySaveResult | undefined;
  let stdinEntry: RegisteredEntry | undefined;
  let stdoutEntry: RegisteredEntry | undefined;

  if (stdin.isTTY === true && stdinFd !== undefined && platform !== "win32") {
    let directCapture: SttySaveResult | undefined;
    const capture = (): string | undefined => {
      directCapture = captureSttyMode(stdinFd, stty);
      return sttyModeString(directCapture);
    };
    const acquired = registry?.acquire(stdinFd, {
      role,
      wasRaw: stdinWasRaw,
      captureBaseline: capture,
    });
    if (acquired) {
      effectiveWasRaw = acquired.baselineWasRaw;
      saved =
        acquired.baseline !== undefined
          ? { status: 0, stdout: `${acquired.baseline}\n` }
          : directCapture;
      stdinEntry = {
        registry: registry!,
        key: acquired.key,
        token: acquired.token,
        fd: stdinFd,
      };
    } else {
      saved = captureSttyMode(stdinFd, stty);
    }
  }

  if (distinctStdoutFd !== undefined && platform !== "win32") {
    let directOutCapture: SttySaveResult | undefined;
    const captureOut = (): string | undefined => {
      directOutCapture = captureSttyMode(distinctStdoutFd, stty);
      return sttyModeString(directOutCapture);
    };
    const acquiredOut = registry?.acquire(distinctStdoutFd, {
      role,
      wasRaw: false,
      captureBaseline: captureOut,
    });
    if (acquiredOut) {
      stdoutSaved =
        acquiredOut.baseline !== undefined
          ? { status: 0, stdout: `${acquiredOut.baseline}\n` }
          : directOutCapture;
      stdoutEntry = {
        registry: registry!,
        key: acquiredOut.key,
        token: acquiredOut.token,
        fd: distinctStdoutFd,
      };
    } else {
      stdoutSaved = captureSttyMode(distinctStdoutFd, stty);
    }
  }

  const state: TtyState = {
    stdinFd,
    ...(distinctStdoutFd !== undefined ? { stdoutFd: distinctStdoutFd } : {}),
    wasRaw: effectiveWasRaw,
    saved,
    ...(stdoutSaved !== undefined ? { stdoutSaved } : {}),
  };

  if (stdinEntry || stdoutEntry || opts.stdout !== undefined || opts.registry !== undefined) {
    ttyStateMeta.set(state, {
      stdinEntry,
      stdoutEntry,
      restored: false,
      stty,
      platform,
    });
  }

  return state;
}

function applySavedStty(
  fd: number | undefined,
  saved: SttySaveResult | undefined,
  baselineOverride: string | undefined,
  stty: SttySpawn,
): void {
  if (fd === undefined) return;
  const mode = baselineOverride?.trim() || sttyModeString(saved);
  if (!mode) return;
  try {
    stty([mode], { stdinFd: fd, capture: false });
  } catch {
    // Best effort; the VT reset above already ran.
  }
}

/**
 * rev351r2-2: single home for the termios restore. Emits the VT reset, puts
 * stdin raw mode back the way it was, then re-applies the saved `stty` state
 * (and distinct `stdout.fd` state if present) unless another active non-suspended
 * session still holds that TTY in `TtyBaselineRegistry`. Idempotent for states
 * created with `TtyBaselineRegistry` / `enterRawOutputTty`.
 */
export function restoreTtyState(
  state: TtyState,
  stdin: TtyStdin,
  doReset: () => void,
  sttyOrStdout: SttySpawn | TtyStdout = defaultSttySpawn,
  maybeStdout?: TtyStdout,
): void {
  const stty =
    typeof sttyOrStdout === "function"
      ? sttyOrStdout
      : (ttyStateMeta.get(state)?.stty ?? defaultSttySpawn);
  void maybeStdout;

  const meta = ttyStateMeta.get(state);
  if (meta) {
    if (meta.restored) return;
    meta.restored = true;
  }

  const stdinRel = meta?.stdinEntry
    ? meta.stdinEntry.registry.release(meta.stdinEntry.key, meta.stdinEntry.token)
    : undefined;
  const stdoutRel = meta?.stdoutEntry
    ? meta.stdoutEntry.registry.release(meta.stdoutEntry.key, meta.stdoutEntry.token)
    : undefined;

  const restoreStdin = stdinRel ? stdinRel.restoreBaseline : true;
  const restoreStdout = stdoutRel ? stdoutRel.restoreBaseline : true;
  const shouldRunReset = meta ? restoreStdin && restoreStdout : true;

  try {
    if (shouldRunReset) {
      doReset();
    }
  } catch {
    // Best effort on teardown; the caller's own outcome takes precedence.
  }

  if (restoreStdin) {
    const targetRaw = stdinRel?.baselineWasRaw ?? state.wasRaw;
    try {
      if (stdin.isTTY === true) {
        try {
          stdin.setRawMode?.(targetRaw);
        } catch {
          // Restoring raw must never mask the caller's outcome.
        }
      }
    } catch {
      // Best effort on teardown.
    }
    applySavedStty(state.stdinFd, state.saved, stdinRel?.baseline, stty);
  }

  if (restoreStdout && state.stdoutFd !== undefined) {
    applySavedStty(state.stdoutFd, state.stdoutSaved, stdoutRel?.baseline, stty);
  }
}

export type EnterRawOutputTtyOptions = {
  readonly stty?: SttySpawn | undefined;
  readonly registry?: TtyBaselineRegistry | null | undefined;
  readonly role?: TtyBaselineRole | undefined;
  readonly platform?: NodeJS.Platform | undefined;
};

function applyRawAndNoOpost(
  stdin: TtyStdin,
  stdout: TtyStdout | undefined,
  stty: SttySpawn,
  platform: NodeJS.Platform,
): void {
  if (stdin.isTTY === true) {
    try {
      stdin.setRawMode?.(true);
    } catch {
      // Non-raw-capable mock or closed fd.
    }
  }
  if (platform !== "win32" && stdout?.isTTY === true) {
    const outFd = resolveNumericFd(stdout);
    if (outFd !== undefined) {
      try {
        stty(["-opost"], { stdinFd: outFd, capture: false });
      } catch {
        // Non-TTY / closed fd fallback.
      }
    }
  }
}

/**
 * Capture baseline termios (with `TtyBaselineRegistry`), put `stdin` into raw
 * mode when `stdin.isTTY === true`, and apply `stty -opost` on `stdout.fd` ONLY
 * when on POSIX and `stdout?.isTTY === true`.
 */
export function enterRawOutputTty(
  stdin: TtyStdin,
  stdout?: TtyStdout,
  options: EnterRawOutputTtyOptions = {},
): TtyState {
  const stty = options.stty ?? defaultSttySpawn;
  const platform = options.platform ?? process.platform;
  const state = saveTtyState(stdin, {
    stdout,
    stty,
    registry: options.registry,
    role: options.role ?? "active",
    platform,
  });
  applyRawAndNoOpost(stdin, stdout, stty, platform);
  return state;
}

export type TtySuspendHandlerOptions = {
  readonly state: TtyState;
  readonly stdin: TtyStdin;
  readonly stdout?: TtyStdout;
  readonly beforeSuspend?: () => void;
  readonly afterResume?: () => void;
  readonly stty?: SttySpawn;
  readonly platform?: NodeJS.Platform;
  readonly processObj?: Pick<NodeJS.Process, "on" | "removeListener" | "kill" | "pid">;
};

/**
 * Install paired `SIGTSTP`/`SIGCONT` handlers so Ctrl+Z restores the baseline
 * TTY state before stopping and `fg` re-applies raw + `-opost` + UI repaint.
 */
export function installTtySuspendHandlers(options: TtySuspendHandlerOptions): () => void {
  const meta = ttyStateMeta.get(options.state);
  const platform = options.platform ?? meta?.platform ?? process.platform;
  if (platform === "win32") return () => {};

  const proc = options.processObj ?? process;
  const stty = options.stty ?? meta?.stty ?? defaultSttySpawn;
  let uninstalled = false;

  const onSigCont = (): void => {
    if (uninstalled) return;
    if (meta?.stdinEntry) {
      meta.stdinEntry.registry.setSuspended(
        meta.stdinEntry.key,
        meta.stdinEntry.token,
        false,
        { refreshBaseline: () => sttyModeString(captureSttyMode(meta.stdinEntry!.fd, stty)) },
      );
    }
    if (meta?.stdoutEntry) {
      meta.stdoutEntry.registry.setSuspended(
        meta.stdoutEntry.key,
        meta.stdoutEntry.token,
        false,
        { refreshBaseline: () => sttyModeString(captureSttyMode(meta.stdoutEntry!.fd, stty)) },
      );
    }
    proc.on("SIGTSTP", onSigTstp);
    applyRawAndNoOpost(options.stdin, options.stdout, stty, platform);
    try {
      options.afterResume?.();
    } catch {
      // Best effort on resume.
    }
  };

  const suspendStty: SttySpawn =
    stty === defaultSttySpawn
      ? (args, { stdinFd, capture }) =>
          spawnSync(
            "sh",
            ["-c", 'trap "" TTOU; exec stty "$@"', "h2a-stty", ...args],
            {
              stdio: [stdinFd, capture ? "pipe" : "ignore", "ignore"],
              encoding: "utf8",
            },
          ) as SttySaveResult
      : stty;

  const onSigTstp = (): void => {
    if (uninstalled) return;
    const inSusp = meta?.stdinEntry
      ? meta.stdinEntry.registry.setSuspended(meta.stdinEntry.key, meta.stdinEntry.token, true)
      : undefined;
    const outSusp = meta?.stdoutEntry
      ? meta.stdoutEntry.registry.setSuspended(meta.stdoutEntry.key, meta.stdoutEntry.token, true)
      : undefined;

    const shouldRestoreIn = inSusp ? inSusp.shouldRestoreNow : true;
    const shouldRestoreOut = outSusp ? outSusp.shouldRestoreNow : true;
    if (shouldRestoreIn && shouldRestoreOut) {
      try {
        options.beforeSuspend?.();
      } catch {
        // Best effort before suspend.
      }
    }
    if (shouldRestoreIn) {
      const targetRaw = inSusp?.baselineWasRaw ?? options.state.wasRaw;
      const inBaselineMode =
        inSusp?.baseline?.trim() || sttyModeString(options.state.saved);
      // On real POSIX TTYs, `suspendStty` uses kernel SIG_IGN on SIGTTOU so it
      // restores S0 (including canonical/echo/opost) atomically without risking
      // libuv's EINTR loop on `setRawMode` when a wrapper guard stopped first.
      if (stty !== defaultSttySpawn || !inBaselineMode || options.state.stdinFd === undefined) {
        try {
          if (options.stdin.isTTY === true) options.stdin.setRawMode?.(targetRaw);
        } catch {}
      }
      applySavedStty(
        options.state.stdinFd,
        options.state.saved,
        inSusp?.baseline,
        suspendStty,
      );
    }
    if (shouldRestoreOut && options.state.stdoutFd !== undefined) {
      applySavedStty(
        options.state.stdoutFd,
        options.state.stdoutSaved,
        outSusp?.baseline,
        suspendStty,
      );
    }

    proc.removeListener("SIGTSTP", onSigTstp);
    proc.removeListener("SIGCONT", onSigCont);
    proc.on("SIGCONT", onSigCont);
    try {
      proc.kill(proc.pid, "SIGTSTP");
    } catch {
      // Ignored in synthetic unit tests if kill throws.
    }
  };

  proc.on("SIGTSTP", onSigTstp);
  return () => {
    uninstalled = true;
    proc.removeListener("SIGTSTP", onSigTstp);
    proc.removeListener("SIGCONT", onSigCont);
  };
}

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
  stdin: TtyStdin = process.stdin,
  stdout?: TtyStdout,
): T {
  const effectiveStdout = stdout ?? (stdin === process.stdin ? process.stdout : undefined);
  const state = saveTtyState(stdin, effectiveStdout ? { stdout: effectiveStdout } : {});
  try {
    return run();
  } finally {
    restoreTtyState(state, stdin, reset);
  }
}
