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
const HOST_LOG_PREFIX = "[h2a-pty-host]";
const MAX_BUFFERED_HOST_LOG_LINES = 256;

let stderrErrorListenerInstalled = false;
let stderrUsable = true;
const bufferedLines: string[] = [];

function markStderrUnusable(): void {
  stderrUsable = false;
}

function ensureStderrErrorListener(): void {
  if (stderrErrorListenerInstalled) return;
  stderrErrorListenerInstalled = true;
  // The listener is installed for the lifetime of the process: an `error`
  // arriving between two log lines must never find the stream unhandled.
  process.stderr.on("error", () => {
    markStderrUnusable();
  });
}

/** Append one host log line, tolerating a stderr that throws or has died. */
export function writeHostLogLine(line: string): void {
  const text = `${HOST_LOG_PREFIX} ${line}\n`;
  if (stderrUsable) {
    ensureStderrErrorListener();
    try {
      process.stderr.write(text);
      return;
    } catch {
      // Synchronous write failure: stop touching the stream.
      markStderrUnusable();
    }
  }
  if (bufferedLines.length >= MAX_BUFFERED_HOST_LOG_LINES) bufferedLines.shift();
  bufferedLines.push(text);
}

/** Test and debugger view of the sink: stderr status and buffered lines. */
export function hostLogSinkDiagnostics(): Readonly<{
  stderrUsable: boolean;
  bufferedLines: ReadonlyArray<string>;
}> {
  return { stderrUsable, bufferedLines: [...bufferedLines] };
}
