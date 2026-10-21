/**
 * Velocity L2 CI: full history across heads (pure, injected inputs only).
 */
export interface CiRun {
    headSha: string;
    attempt: number;
    conclusion?: string;
    startedAt?: string;
    reusable?: boolean;
}
export declare function groupCiByHead(runs: CiRun[]): CiRun[];
export interface QuarantineResult {
    kept: CiRun[];
    quarantined: Array<CiRun & {
        reason: string;
    }>;
    openToMergeValid: true;
}
export declare function quarantineReusedAttempts(runs: CiRun[]): QuarantineResult;
//# sourceMappingURL=ci.d.ts.map