/**
 * Named fault counters for supervision. Every fault-tolerant site in the
 * native terminal host bumps its own named counter so an operator can see
 * WHAT is being absorbed and how often — fault containment must never be
 * silent. The contained sites are:
 *
 * - the host log sink (`crash-safe-log.ts`): stderr write failures;
 * - the pty `onData` guard (`host.ts`);
 * - the pty `onExit` guard (`host.ts`);
 * - the pty DSR reply write (`host.ts`);
 * - socket connection errors and client frame destroys (`server.ts`);
 * - the net.Server listener handler (`server.ts`), per classification;
 * - bounded respawn abandonment (`supervisor.ts`);
 * - the process-level diagnostic writes (`process.ts`).
 *
 * Counters are per-process; supervision reads them through
 * `hostFaultCounters()` (tests, an attached debugger, a future ping op).
 */
export const HOST_FAULT_COUNTERS = {
  // The four contractual R7.5 supervision counters (h2a_host_*), one per
  // NAMED fault site of the spec.
  hostSocketConnectionErrors: "h2a_host_socket_conn_errors",
  hostClientFrameDestroys: "h2a_host_client_frame_destroys",
  hostPtyWriteBreaks: "h2a_host_pty_write_breaks",
  hostPtyCallbackFailures: "h2a_host_pty_callback_failures",
  // Per-site distinct counters kept for finer supervision.
  hostLogStderrSyncWriteFailed: "host-log.stderr-sync-write-failed",
  hostLogStderrStreamError: "host-log.stderr-stream-error",
  ptyDataCallbackContained: "pty.data-callback-contained",
  ptyExitCallbackContained: "pty.exit-callback-contained",
  serverListenerErrorRecoverable: "server.listener-error-recoverable",
  serverListenerErrorExhausted: "server.listener-error-exhausted",
  serverListenerErrorUnusable: "server.listener-error-unusable",
  serverListenerErrorUnknown: "server.listener-error-unknown",
  supervisorRespawnAbandoned: "supervisor.respawn-abandoned",
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
