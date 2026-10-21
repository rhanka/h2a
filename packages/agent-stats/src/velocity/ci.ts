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

export function groupCiByHead(runs: CiRun[]): CiRun[] {
  const seen = new Map<string, CiRun>();
  for (const run of runs) {
    const key = `${run.headSha}#${run.attempt}`;
    if (!seen.has(key)) seen.set(key, run);
  }
  return [...seen.values()];
}

export interface QuarantineResult {
  kept: CiRun[];
  quarantined: Array<CiRun & { reason: string }>;
  openToMergeValid: true;
}

export function quarantineReusedAttempts(runs: CiRun[]): QuarantineResult {
  const kept: CiRun[] = [];
  const quarantined: Array<CiRun & { reason: string }> = [];
  for (const run of runs) {
    if (run.reusable === true) {
      quarantined.push({ ...run, reason: "reused attempt: start precedes own created_at" });
    } else {
      kept.push(run);
    }
  }
  return { kept, quarantined, openToMergeValid: true };
}
