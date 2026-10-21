import type { CiMetrics, TimingRecord } from "./types.js";
export interface TimingRecordInput {
    repo: string;
    number: number;
    url?: string;
    createdAt: string;
    mergedAt: string | null;
}
export declare function buildTimingRecord(input: TimingRecordInput): TimingRecord;
export interface CiJobInput {
    name: string;
    startedAt: string;
    completedAt: string;
}
export declare function distinctCiMetrics(input: {
    jobs: CiJobInput[];
    triggerAt: string;
}): CiMetrics;
//# sourceMappingURL=measure.d.ts.map