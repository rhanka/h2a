/**
 * Velocity L2 run receipts (closed DTO, no inference).
 */
export type RunOutcome = "success" | "failure" | "launch-failure" | "interrupted" | "censored";
export interface RunReceiptInput {
    repo: string;
    lotRef: string;
    runId: string;
    role: string;
    startedAt: string;
    finishedAt: string | null;
    outcome: RunOutcome | "success";
    requestedModel: string;
    observedModel: string;
    candidateRevision: string;
    roundId?: string;
}
export interface RunReceipt extends RunReceiptInput {
    schema: "h2a.velocity/run-receipt/1";
    finishedAt: string | null;
}
export declare function createRunReceipt(input: RunReceiptInput): RunReceipt;
//# sourceMappingURL=run-receipt.d.ts.map