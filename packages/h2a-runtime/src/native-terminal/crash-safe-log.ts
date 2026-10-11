/**
 * Crash-safe host log sink: the one channel the native terminal host may use
 * to reach an operator.
 *
 * A bare `process.stderr.write` is fatal to the host. The supervisor spawns
 * the host with stderr as a pipe it never reads and unrefs (`stdio: ["ignore",
 * "ignore", "pipe"]`), so when the supervisor process dies the pipe's read end
 * closes and the host's NEXT log line — typically the deferred durable-row
 * prune of `#schedulePruneOfExitedSession` — fails. Node reports that failure
 * ASYNCHRONOUSLY, as an `error` event on the stderr stream: `write()` sits
 * inside a try/catch and returns, then EPIPE surfaces on the host's event
 * loop where no listener exists, and the unhandled `error` event throws
 * `uncaughtException` (exit 1, supervisor restart: the 2026-10-10/11
 * crash-loop, host.js:590:36 via 1425:26 and 1454:62).
 *
 * Rules this sink enforces:
 * - a durable `error` listener on `process.stderr` turns asynchronous stream
 *   failures (EPIPE, ...) into observations instead of uncaught exceptions;
 * - a synchronous write throw OR the first async `error` marks stderr
 *   unusable forever: no line is ever written to that stream again;
 * - the logger's own failure is never reported into the failing stream;
 * - lines emitted while stderr is unusable are kept in a bounded most-recent
 *   buffer (diagnostic for an attached debugger), never unbounded memory.
 */
import { HOST_FAULT_COUNTERS, recordHostFault } from "./fault-counters.js";

const HOST_LOG_PREFIX = "[h2a-pty-host]";
const MAX_BUFFERED_HOST_LOG_LINES = 256;

let stderrUsable = true;
const bufferedLines: string[] = [];

function markStderrUnusable(): void {
  stderrUsable = false;
}

// Attached at module load, for the process lifetime: from the moment this
// sink is imported, an `error` arriving on process.stderr — including
// between two log lines — never finds the stream unhandled. Each observed
// death of the stream counts ONCE, on the transition.
process.stderr.on("error", () => {
  if (!stderrUsable) return;
  recordHostFault(HOST_FAULT_COUNTERS.hostLogStderrStreamError);
  markStderrUnusable();
});

/**
 * Append one host log line, tolerating a stderr that throws or has died.
 * Returns whether the line was delivered to a live stderr stream: a false
 * return means the line only reached the bounded post-mortem buffer, and the
 * CALLER (each contained site owns its named counter) reports that for
 * supervision.
 */
export function writeHostLogLine(line: string): boolean {
  const text = `${HOST_LOG_PREFIX} ${line}\n`;
  if (stderrUsable) {
    try {
      process.stderr.write(text);
      return true;
    } catch {
      // Synchronous write failure: stop touching the stream.
      recordHostFault(HOST_FAULT_COUNTERS.hostLogStderrSyncWriteFailed);
      markStderrUnusable();
    }
  }
  if (bufferedLines.length >= MAX_BUFFERED_HOST_LOG_LINES) bufferedLines.shift();
  bufferedLines.push(text);
  return false;
}

/** Test-only: restore the sink to its initial, healthy state. */
export function resetHostLogSinkForTests(): void {
  stderrUsable = true;
  bufferedLines.length = 0;
}

/** Test and debugger view of the sink: stderr status and buffered lines. */
export function hostLogSinkDiagnostics(): Readonly<{
  stderrUsable: boolean;
  bufferedLines: ReadonlyArray<string>;
}> {
  return { stderrUsable, bufferedLines: [...bufferedLines] };
}
