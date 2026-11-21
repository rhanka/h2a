import { mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const RECEIPT_ENV = "H2A_ATTACH_RESET_RECEIPT";

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
  // Initialize the parent's TTY handle BEFORE the child changes its termios.
  const stdin = process.stdin;
  const wasRaw = stdin.isRaw === true;
  // libuv caches the parent's TTY mode, so setRawMode(false) alone can be a
  // no-op after a CHILD changes the kernel termios. Preserve the actual state.
  const ttyState = stdin.isTTY && process.platform !== "win32"
    ? spawnSync("stty", ["-g"], { stdio: [stdin.fd, "pipe", "ignore"], encoding: "utf8" })
    : undefined;
  try {
    return launch({ ...process.env, [RECEIPT_ENV]: receipt });
  } finally {
    try {
      const reset = readFileSync(receipt, "utf8");
      if (reset) writeSync(process.stdout.fd, reset);
    } finally {
      try {
        if (stdin.isTTY) stdin.setRawMode(wasRaw);
        if (ttyState?.status === 0 && ttyState.stdout.trim()) {
          spawnSync("stty", [ttyState.stdout.trim()], { stdio: [stdin.fd, "ignore", "ignore"] });
        }
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    }
  }
}
