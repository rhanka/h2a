import { mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const RECEIPT_ENV = "H2A_ATTACH_RESET_RECEIPT";

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
