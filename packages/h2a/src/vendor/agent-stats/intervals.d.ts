/**
 * Velocity L2 intervals: evidenced wait union (pure).
 */
export interface WaitInterval {
    start: string;
    end: string;
    cause: string;
    source: string;
}
export interface UnionResult {
    totalSeconds: number | null;
    reason?: string;
    gaps: Array<{
        start: string;
        end: string;
    }>;
    unclassified: boolean;
}
export declare function unionIntervals(intervals: WaitInterval[]): UnionResult;
//# sourceMappingURL=intervals.d.ts.map