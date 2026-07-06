/** C1 — verify the working branch is the expected one (per the profile's `branchMatch`). */
export function checkBranch(input) {
    if (input.bypass) {
        return { pass: true, violations: [], bypass: input.bypass };
    }
    const { currentBranch, expectedBranch, profile } = input;
    const ok = profile.branchMatch === 'prefix'
        ? currentBranch.startsWith(expectedBranch)
        : currentBranch === expectedBranch;
    if (ok)
        return { pass: true, violations: [] };
    return {
        pass: false,
        violations: [
            {
                code: 'C1',
                message: `on branch '${currentBranch}', expected '${expectedBranch}' (${profile.branchMatch})`,
                severity: 'advisory',
            },
        ],
    };
}
