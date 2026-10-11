/**
 * Named fault counters for supervision. Every fault-tolerant site in the
 * native terminal host bumps its own named counter so an operator can see
 * WHAT is being absorbed and how often — fault containment must never be
 * silent. The five contained sites are:
 *
 * - the host log sink (`crash-safe-log.ts`): stderr write failures;
 * - the pty `onData` guard (`host.ts`);
 * - the pty `onExit` guard (`host.ts`);
 * - the net.Server listener handler (`server.ts`), per classification;
 * - the process-level diagnostic writes (`process.ts`).
 *
 * Counters are per-process; supervision reads them through
 * `hostFaultCounters()` (tests, an attached debugger, a future ping op).
 */
export const HOST_FAULT_COUNTERS = {
  hostLogStderrSyncWriteFailed: "host-log.stderr-sync-write-failed",
  hostLogStderrStreamError: "host-log.stderr-stream-error",
  ptyDataCallbackContained: "pty.data-callback-contained",
  ptyExitCallbackContained: "pty.exit-callback-contained",
  serverListenerErrorRecoverable: "server.listener-error-recoverable",
  serverListenerErrorUnusable: "server.listener-error-unusable",
  serverListenerErrorUnknown: "server.listener-error-unknown",
  processShutdownWriteFailed: "process.shutdown-write-failed",
  processFatalWriteFailed: "process.fatal-write-failed",
} as const;

const counts = new Map<string, number>();

export function recordHostFault(counter: string): void {
  counts.set(counter, (counts.get(counter) ?? 0) + 1);
}

export function hostFaultCounters(): Readonly<Record<string, number>> {
  return Object.fromEntries(counts);
}
