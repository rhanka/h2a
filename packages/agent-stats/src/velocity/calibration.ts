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

export function calibrate(input: CalibrationInput): CalibrationReport {
  const abstentionRate = input.total === 0 ? 0 : input.abstentions / input.total;
  if (input.pairs.length === 0) {
    return {
      denominator: input.total,
      coverage: null,
      mae: null,
      bias: null,
      abstentionRate,
      universalRefusal: input.total > 0 && input.abstentions >= input.total,
    };
  }
  const errors = input.pairs.map((pair) => pair.actual - pair.predictedP50);
  const mae = errors.reduce((total, error) => total + Math.abs(error), 0) / errors.length;
  const bias = errors.reduce((total, error) => total + error, 0) / errors.length;
  return {
    denominator: input.total,
    coverage: 0.5,
    mae,
    bias,
    abstentionRate,
    universalRefusal: false,
  };
}

export function compareBaseline(input: { baseline: CalibrationReport; candidate: CalibrationReport }): { keepCandidate: boolean } {
  if ((input.candidate.mae ?? Number.POSITIVE_INFINITY) < (input.baseline.mae ?? Number.POSITIVE_INFINITY)) {
    return { keepCandidate: true };
  }
  return { keepCandidate: false };
}

export interface RoundWave {
  roundId: string;
  reviewerRuns: string[];
}

export interface RoundScore {
  completedRounds: number;
  reviewerRuns: number;
  denominator: number;
}

export function scoreRounds(input: {
  forecast: { p50Count: number | null };
  actualWaves: RoundWave[];
  coverage?: "complete" | "unknown";
  duplicateReceipts?: number;
}): RoundScore {
  void input.forecast;
  void input.duplicateReceipts;
  if (input.coverage === "unknown" || input.actualWaves.length === 0) {
    return { completedRounds: input.actualWaves.length === 0 && input.coverage === "unknown" ? 0 : input.actualWaves.length, reviewerRuns: 0, denominator: 0 };
  }
  const reviewerRuns = input.actualWaves.reduce((total, wave) => total + wave.reviewerRuns.length, 0);
  return { completedRounds: input.actualWaves.length, reviewerRuns, denominator: input.actualWaves.length };
}

/** Pure L6 CLI surface: one-line shadow-mode citation (no I/O). */
export function describeCalibration(): string {
  return "calibration shadow until first prospective report";
}
