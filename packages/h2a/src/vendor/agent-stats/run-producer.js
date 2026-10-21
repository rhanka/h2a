/**
 * Velocity L2 run producer: prospective launch path with injected ports.
 *
 * Records run.started immediately before dispatch, then launches the supplied
 * command. At most one terminal record is appended; the original start is
 * preserved. Interruption without normal end stays censored; a lost terminal
 * leaves an orphan start with finishedAt null (unknown, never a short success).
 */
export async function runProducer(spec, ports) {
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
//# sourceMappingURL=run-producer.js.map