/**
 * Velocity L2 run producer: prospective launch path with injected ports.
 *
 * Records run.started immediately before dispatch, then launches the supplied
 * command. At most one terminal record is appended; the original start is
 * preserved. Interruption without normal end stays censored; a lost terminal
 * leaves an orphan start with finishedAt null (unknown, never a short success).
 */

export interface ProducerSpec {
  repo: string;
  lotRef: string;
  runId: string;
  role: string;
  candidateRevision: string;
  receiptsDir: string;
}

export interface ProducerPorts {
  clock: { now: () => string; advance: () => string };
  spawn: () => Promise<{ status: number | null; startedAt?: string; finishedAt?: string; interrupted?: boolean }>;
  sink: { write: (line: string) => void };
}

export interface ProducerResult {
  startPersistedBeforeDispatch: boolean;
  terminalCount: number;
  outcome: "success" | "failure" | "censored";
  finishedAt: string | null;
}

export async function runProducer(spec: ProducerSpec, ports: ProducerPorts): Promise<ProducerResult> {
  void spec.receiptsDir;
  const startedAt = ports.clock.now();
  ports.sink.write(JSON.stringify({ runId: spec.runId, startedAt, phase: "started" }));
  const startPersistedBeforeDispatch = true;
  const outcome = await ports.spawn();
  if (outcome.interrupted === true || outcome.status === null) {
    return { startPersistedBeforeDispatch, terminalCount: 0, outcome: "censored", finishedAt: null };
  }
  const finishedAt = outcome.finishedAt ?? ports.clock.advance();
  ports.sink.write(JSON.stringify({ runId: spec.runId, startedAt, finishedAt, phase: "terminal" }));
  return {
    startPersistedBeforeDispatch,
    terminalCount: 1,
    outcome: outcome.status === 0 ? "success" : "failure",
    finishedAt,
  };
}
