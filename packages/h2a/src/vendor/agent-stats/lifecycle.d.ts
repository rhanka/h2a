/**
 * Velocity L2 lifecycle: lot starts and attribution (read-only, no inference).
 */
export interface LotStartInput {
    prOpenedAt: string;
    committerAt: string | null;
    firstCommitAt: string | null;
}
export interface LotStartResult {
    lotStart: null;
    negativeDuration: false;
    reason: string;
    firstCommitPolicy: "proxy-only-excluded-from-forecasts";
}
export declare function lotStartFromEvidence(input: LotStartInput): LotStartResult;
export interface AttributeInput {
    githubReviews: unknown[];
    externalReview?: {
        reviewer: string;
        evidenceRef: string;
    };
    authorLogin: string;
    host?: string;
}
export interface AttributeResult {
    reviewKept: boolean;
    model: "unattributed";
    agent: "unattributed";
}
export declare function attributeRole(input: AttributeInput): AttributeResult;
//# sourceMappingURL=lifecycle.d.ts.map