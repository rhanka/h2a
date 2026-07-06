/**
 * Assemble a NEUTRAL `VerificationRun` from check results. harness EMITS this artifact and
 * never writes into `@sentropic/track` — a track-side adapter ingests it (no track import here).
 */
export function toVerificationRun(checks, ctx) {
    const verificationChecks = checks.map((c) => ({
        code: c.code,
        category: c.category,
        pass: c.result.pass,
        violations: c.result.violations,
    }));
    const violations = checks.flatMap((c) => c.result.violations);
    const pass = verificationChecks.every((c) => c.pass);
    return {
        schemaVersion: 1,
        runId: ctx.runId,
        commit: ctx.commit,
        branch: ctx.branch,
        env: ctx.env,
        runner: ctx.runner,
        category: ctx.category,
        command: ctx.command,
        result: pass ? 'pass' : 'fail',
        startedAt: ctx.startedAt,
        finishedAt: ctx.finishedAt,
        checks: verificationChecks,
        violations,
        artifactLocator: ctx.artifactLocator ?? `verification-run:${ctx.runId}`,
        artifacts: ctx.artifacts ?? [],
    };
}
