import { mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { restoreTtyState, saveTtyState, statusFromSpawnResult } from "../terminal-reset.js";

const RECEIPT_ENV = "H2A_ATTACH_RESET_RECEIPT";
const GUARD_ENV = "H2A_CLIENT_RECOVERY_GUARD_ACTIVE";
const SUBPROCESS_ATTACH_MOD_ENV = "H2A_SUBPROCESS_ATTACH_MOD";
const SUBPROCESS_ATTACH_BASE_ENV = "H2A_SUBPROCESS_ATTACH_BASE";
const SUBPROCESS_ATTACH_ID_ENV = "H2A_SUBPROCESS_ATTACH_ID";

const UNDO_ORDER = [
  "status-bar",
  "child-modes",
  "h2a-margins",
  "h2a-mouse",
  "h2a-hygiene",
  "h2a-title",
] as const;

/**
 * Single registry of every outer-terminal state activated by h2a or the relayed
 * child during an attach. Every activation registers its undo sequence here and
 * publishes the composed receipt BEFORE writing the activation bytes to stdout,
 * so even an uncatchable SIGKILL leaves the surviving guard able to restore the
 * outer terminal to a clean fresh-terminal state (03-L0.5b Step 5; r2:469).
 */
export class TerminalUndoRegistry {
  readonly #entries = new Map<string, string>();
  #lastPublished = "";

  set(slot: string, undoSequence: string): void {
    if (!undoSequence) this.#entries.delete(slot);
    else this.#entries.set(slot, undoSequence);
  }

  delete(slot: string): void {
    this.#entries.delete(slot);
  }

  clear(): void {
    this.#entries.clear();
  }

  compose(): string {
    let out = "";
    const seen = new Set<string>();
    for (const slot of UNDO_ORDER) {
      const seq = this.#entries.get(slot);
      if (seq) out += seq;
      seen.add(slot);
    }
    for (const [slot, seq] of this.#entries) {
      if (!seen.has(slot) && seq) out += seq;
    }
    return out;
  }

  /** Publish the composed undo sequence if it changed since the last publish. */
  publish(sink: ((sequence: string) => void) | undefined, force = false): string {
    const seq = this.compose();
    if (!force && seq === this.#lastPublished) return seq;
    sink?.(seq);
    this.#lastPublished = seq;
    return seq;
  }
}

/** Publish before relaying changed modes to retain cleanup across attach death.
 * The launch parent creates the private directory; only this attach writes it.
 */
export function publishAttachReset(sequence: string): void {
  const path = process.env[RECEIPT_ENV];
  if (!path) return;
  writeFileSync(`${path}.tmp`, sequence, { mode: 0o600 });
  renameSync(`${path}.tmp`, path);
}

/** A surviving h2a launch parent can recover even an uncatchable attach death.
 * No host query is needed: the receipt describes output this attach relayed.
 */
export function withAttachTerminalRecovery<T>(launch: (env: NodeJS.ProcessEnv) => T): T {
  const directory = mkdtempSync(join(tmpdir(), "h2a-attach-"));
  const receipt = join(directory, "reset");
  writeFileSync(receipt, "", { mode: 0o600 });
  // Capture baseline termios and register as "guard" BEFORE the child changes it.
  const stdin = process.stdin;
  const stdout = process.stdout;
  const ttyState = saveTtyState(stdin, { stdout, role: "guard" });
  try {
    return launch({
      ...process.env,
      [RECEIPT_ENV]: receipt,
      [GUARD_ENV]: "1",
    });
  } finally {
    try {
      restoreTtyState(
        ttyState,
        stdin,
        () => {
          const reset = readFileSync(receipt, "utf8");
          if (reset) {
            if (typeof stdout.fd === "number") {
              writeSync(stdout.fd, reset);
            } else {
              stdout.write(reset);
            }
          }
        },
        stdout,
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }
}

export function withClientTerminalRecoverySubprocess<T>(
  runDirect: () => T,
  options?: {
    readonly stdin?: { readonly isTTY?: boolean; readonly fd?: unknown };
    readonly stdout?: { readonly isTTY?: boolean; readonly fd?: unknown };
    readonly env?: NodeJS.ProcessEnv;
    readonly execPath?: string;
    readonly execArgv?: ReadonlyArray<string>;
    readonly argv?: ReadonlyArray<string>;
    readonly mapSpawnResult?: (res: SpawnSyncReturns<Buffer | string>) => number;
  },
): T | number {
  const env = options?.env ?? process.env;
  const stdin = options?.stdin ?? process.stdin;
  const stdout = options?.stdout ?? process.stdout;
  const isTty = stdin.isTTY === true || stdout.isTTY === true;
  const entry = (options?.argv ?? process.argv)[1] ?? "";
  if (
    !isTty ||
    env[RECEIPT_ENV] ||
    env[GUARD_ENV] ||
    /\bvitest\b/i.test(entry)
  ) {
    return runDirect();
  }
  const args = [
    ...(options?.execArgv ?? process.execArgv),
    ...(options?.argv ?? process.argv).slice(1),
  ];
  return withAttachTerminalRecovery((guardEnv) => {
    const res = spawnSync(options?.execPath ?? process.execPath, args, {
      stdio: "inherit",
      env: guardEnv,
    });
    if (options?.mapSpawnResult) {
      return options.mapSpawnResult(res);
    }
    return statusFromSpawnResult(res);
  });
}

export async function runRemoteAttachInRecoverySubprocess(
  attachFn: () => Promise<void>,
  target: { readonly baseUrl: string; readonly sessionId: string },
  options?: {
    readonly stdin?: { readonly isTTY?: boolean; readonly fd?: unknown };
    readonly stdout?: { readonly isTTY?: boolean; readonly fd?: unknown };
    readonly env?: NodeJS.ProcessEnv;
    readonly execPath?: string;
    readonly execArgv?: ReadonlyArray<string>;
    readonly argv?: ReadonlyArray<string>;
  },
): Promise<number | undefined> {
  const env = options?.env ?? process.env;
  const stdin = options?.stdin ?? process.stdin;
  const stdout = options?.stdout ?? process.stdout;
  const isTty = stdin.isTTY === true || stdout.isTTY === true;
  const entry = (options?.argv ?? process.argv)[1] ?? "";
  if (
    !isTty ||
    env[RECEIPT_ENV] ||
    env[GUARD_ENV] ||
    /\bvitest\b/i.test(entry)
  ) {
    await attachFn();
    return undefined;
  }
  const attachModuleUrl = new URL("../attach.js", import.meta.url).href;
  const script = [
    `const mod = await import(process.env[${JSON.stringify(SUBPROCESS_ATTACH_MOD_ENV)}]);`,
    `const s = await mod.attach({ baseUrl: process.env[${JSON.stringify(SUBPROCESS_ATTACH_BASE_ENV)}], sessionId: process.env[${JSON.stringify(SUBPROCESS_ATTACH_ID_ENV)}] });`,
    `await s.finished;`,
  ].join(" ");
  const rawExecArgv = options?.execArgv ?? process.execArgv;
  const filteredExecArgv = rawExecArgv.filter((a) => a !== "--input-type=module");
  return withAttachTerminalRecovery((guardEnv) => {
    const res = spawnSync(
      options?.execPath ?? process.execPath,
      [...filteredExecArgv, "--input-type=module", "-e", script],
      {
        stdio: "inherit",
        env: {
          ...guardEnv,
          [SUBPROCESS_ATTACH_MOD_ENV]: attachModuleUrl,
          [SUBPROCESS_ATTACH_BASE_ENV]: target.baseUrl,
          [SUBPROCESS_ATTACH_ID_ENV]: target.sessionId,
        },
      },
    );
    return statusFromSpawnResult(res);
  });
}
