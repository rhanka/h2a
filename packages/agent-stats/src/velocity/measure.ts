/**
 * Velocity L1 measure: timing records and CI metric separation.
 *
 * PR-open→merge is never rendered as agent active time, remaining dev time
 * or an installed date. CI service/envelope/span stay distinct and are never
 * added to open→merge. Milestones stay separate; installed is unknown here.
 */
import { getContract } from "./contract.js";
import type { CiMetrics, TimingRecord } from "./types.js";

export interface TimingRecordInput {
  repo: string;
  number: number;
  url?: string;
  createdAt: string;
  mergedAt: string | null;
}

export function buildTimingRecord(input: TimingRecordInput): TimingRecord {
  const contract = getContract();
  const openToMergeSeconds =
    input.mergedAt === null
      ? null
      : contract.openToMergeSample({ createdAt: input.createdAt, mergedAt: input.mergedAt });
  return {
    repo: input.repo,
    number: input.number,
    url: input.url,
    createdAt: input.createdAt,
    mergedAt: input.mergedAt,
    openToMergeSeconds,
    ciSeconds: null,
    installedAt: "unknown",
    installationTarget: "unknown",
    reviewRoundsActual: null,
    reviewMissingReason: "round evidence/coverage unavailable before L2/L3",
  };
}

export interface CiJobInput {
  name: string;
  startedAt: string;
  completedAt: string;
}

export function distinctCiMetrics(input: { jobs: CiJobInput[]; triggerAt: string }): CiMetrics {
  const contract = getContract();
  let serviceSumSeconds = 0;
  let longestJobSeconds = 0;
  let earliest = Number.POSITIVE_INFINITY;
  let latest = Number.NEGATIVE_INFINITY;
  for (const job of input.jobs) {
    const sample = contract.ciJobServiceSeconds({
      status: "completed",
      conclusion: "success",
      startedAt: job.startedAt,
      completedAt: job.completedAt,
    });
    const duration = sample ?? 0;
    serviceSumSeconds += duration;
    if (duration > longestJobSeconds) longestJobSeconds = duration;
    const start = Date.parse(job.startedAt);
    const end = Date.parse(job.completedAt);
    if (start < earliest) earliest = start;
    if (end > latest) latest = end;
  }
  const envelopeSeconds = Math.round((latest - earliest) / 1000);
  const workflowSpanSeconds = Math.round((latest - Date.parse(input.triggerAt)) / 1000);
  void contract.ciEnvelopeSeconds;
  return { serviceSumSeconds, longestJobSeconds, envelopeSeconds, workflowSpanSeconds };
}
