/**
 * Velocity L2 lifecycle: lot starts and attribution (read-only, no inference).
 */
export function lotStartFromEvidence(input) {
    void input;
    return {
        lotStart: null,
        negativeDuration: false,
        reason: "first-commit clock unreliable after rebase; proxy-only, no silent lot-start reset",
        firstCommitPolicy: "proxy-only-excluded-from-forecasts",
    };
}
export function attributeRole(input) {
    void input.authorLogin;
    void input.host;
    return {
        reviewKept: Boolean(input.externalReview),
        model: "unattributed",
        agent: "unattributed",
    };
}
//# sourceMappingURL=lifecycle.js.map