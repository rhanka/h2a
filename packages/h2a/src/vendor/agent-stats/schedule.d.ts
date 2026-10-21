export interface ScheduleNode {
    id: string;
    durationSeconds: number;
}
export interface ScheduleEdge {
    from: string;
    to: string;
}
export interface TrialsSpec {
    draws: number;
    seed: number;
    samples: Record<string, number[]>;
}
export interface ScheduleInput {
    nodes: ScheduleNode[];
    edges: ScheduleEdge[];
    capacity: number;
    trials?: TrialsSpec;
}
export interface ScheduleResult {
    makespanSeconds: number;
    trialQuantiles?: {
        p50Seconds: number;
        p80Seconds: number;
        p95Seconds: number;
    };
    summedP80?: number;
}
export declare function validateGraph(nodes: Array<{
    id: string;
}>, edges: ScheduleEdge[]): void;
export declare function simulateSchedule(input: ScheduleInput): ScheduleResult;
//# sourceMappingURL=schedule.d.ts.map