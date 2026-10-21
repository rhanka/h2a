/**
 * Velocity L2 CI: full history across heads (pure, injected inputs only).
 */
export function groupCiByHead(runs) {
    const seen = new Map();
    for (const run of runs) {
        const key = `${run.headSha}#${run.attempt}`;
        if (!seen.has(key))
            seen.set(key, run);
    }
    return [...seen.values()];
}
export function quarantineReusedAttempts(runs) {
    const kept = [];
    const quarantined = [];
    for (const run of runs) {
        if (run.reusable === true) {
            quarantined.push({ ...run, reason: "reused attempt: start precedes own created_at" });
        }
        else {
            kept.push(run);
        }
    }
    return { kept, quarantined, openToMergeValid: true };
}
//# sourceMappingURL=ci.js.map