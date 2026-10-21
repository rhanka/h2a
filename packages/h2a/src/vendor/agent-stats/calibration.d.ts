/**
 * Velocity L6 calibration: coverage with abstention, shadow mode (pure).
 */
export interface CalibrationPair {
    predictedP50: number;
    actual: number;
}
export interface CalibrationInput {
    pairs: CalibrationPair[];
    abstentions: number;
    total: number;
}
export interface CalibrationReport {
    denominator: number;
    coverage: number | null;
    mae: number | null;
    bias: number | null;
    abstentionRate: number;
    universalRefusal: boolean;
}
export declare function calibrate(input: CalibrationInput): CalibrationReport;
export declare function compareBaseline(input: {
    baseline: CalibrationReport;
    candidate: CalibrationReport;
}): {
    keepCandidate: boolean;
};
export interface RoundWave {
    roundId: string;
    reviewerRuns: string[];
}
export interface RoundScore {
    completedRounds: number;
    reviewerRuns: number;
    denominator: number;
}
export declare function scoreRounds(input: {
    forecast: {
        p50Count: number | null;
    };
    actualWaves: RoundWave[];
    coverage?: "complete" | "unknown";
    duplicateReceipts?: number;
}): RoundScore;
/** Pure L6 CLI surface: one-line shadow-mode citation (no I/O). */
export declare function describeCalibration(): string;
//# sourceMappingURL=calibration.d.ts.map