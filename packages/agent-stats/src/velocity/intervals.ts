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
  gaps: Array<{ start: string; end: string }>;
  unclassified: boolean;
}

export function unionIntervals(intervals: WaitInterval[]): UnionResult {
  if (intervals.length === 0) {
    return { totalSeconds: null, reason: "no-evidenced-interval", gaps: [], unclassified: true };
  }
  const sorted = [...intervals]
    .map((entry) => ({ ...entry, startMs: Date.parse(entry.start), endMs: Date.parse(entry.end) }))
    .sort((a, b) => a.startMs - b.startMs);
  const merged: Array<{ startMs: number; endMs: number }> = [];
  for (const entry of sorted) {
    const last = merged[merged.length - 1];
    if (last && entry.startMs <= last.endMs) {
      if (entry.endMs > last.endMs) last.endMs = entry.endMs;
    } else {
      merged.push({ startMs: entry.startMs, endMs: entry.endMs });
    }
  }
  let totalSeconds = 0;
  const gaps: Array<{ start: string; end: string }> = [];
  for (let index = 0; index < merged.length; index += 1) {
    totalSeconds += Math.round((merged[index].endMs - merged[index].startMs) / 1000);
    if (index > 0) {
      gaps.push({
        start: new Date(merged[index - 1].endMs).toISOString().replace(/\.\d{3}Z$/, "Z"),
        end: new Date(merged[index].startMs).toISOString().replace(/\.\d{3}Z$/, "Z"),
      });
    }
  }
  return { totalSeconds, gaps, unclassified: true };
}
