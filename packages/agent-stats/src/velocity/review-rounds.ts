/**
 * Velocity L2 review rounds: wave lifecycle (pure, no coverage invention).
 *
 * One manifest is one round; parallel reviewers of one submission are multiple
 * reviewer runs inside one manifest and one round. Without a coverage manifest
 * totals stay null with a reason — never zero. An open wave stays open.
 */

export interface WaveInput {
  roundId: string;
  candidateRevision: string;
  reviewerRuns: Array<{ runId: string }>;
  closed?: boolean;
  coverageManifestRef?: string | null;
}

export interface WaveSummary {
  completedCount: number | null;
  openRoundIds: string[];
  reviewerRunCount: number | null;
  roundIds: string[];
  missingReason?: string;
}

export function summarizeWaves(input: {
  repo: string;
  lotOccurrence: string;
  waves: WaveInput[];
  coverageManifestRef: string | null;
}): WaveSummary {
  void input.repo;
  void input.lotOccurrence;
  if (input.coverageManifestRef === null) {
    return {
      completedCount: null,
      openRoundIds: input.waves.filter((wave) => wave.closed !== true).map((wave) => wave.roundId),
      reviewerRunCount: null,
      roundIds: input.waves.map((wave) => wave.roundId),
      missingReason: "round evidence/coverage unavailable: no coverage manifest",
    };
  }
  const completed = input.waves.filter((wave) => wave.closed !== false);
  const reviewerRunCount = completed.reduce((total, wave) => total + wave.reviewerRuns.length, 0);
  return {
    completedCount: completed.length,
    openRoundIds: input.waves.filter((wave) => wave.closed === false).map((wave) => wave.roundId),
    reviewerRunCount,
    roundIds: input.waves.map((wave) => wave.roundId),
  };
}

export function joinWaveManifest(
  manifest: {
    repo: string;
    lotOccurrence: string;
    roundId: string;
    candidateRevision: string;
    reviewerRuns: Array<{ runId: string }>;
  },
  receipts: Array<{ runId: string }>,
): { roundId: string; reviewerRunCount: number } {
  void manifest.repo;
  void manifest.lotOccurrence;
  void manifest.candidateRevision;
  const wanted = new Set(manifest.reviewerRuns.map((entry) => entry.runId));
  const seen = new Set<string>();
  for (const receipt of receipts) {
    if (wanted.has(receipt.runId)) seen.add(receipt.runId);
  }
  return { roundId: manifest.roundId, reviewerRunCount: seen.size };
}

export function refuseIncompleteClosure(input: {
  roundId: string;
  reconciliationRef: string | null;
  resultRefs: string[];
}): void {
  if (input.reconciliationRef === null || input.resultRefs.length === 0) {
    throw new Error(`refuse wave closure without reconciliation for ${input.roundId}`);
  }
}
