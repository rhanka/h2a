import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { lotStartFromEvidence } from "../src/velocity/lifecycle.js";
import { unionIntervals } from "../src/velocity/intervals.js";
import { lotSlotKey } from "../src/velocity/join.js";

const tempDirs: string[] = [];
afterEach(() => {
  while (tempDirs.length > 0) rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

function tempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "velocity-l2-ev-"));
  tempDirs.push(dir);
  return dir;
}

describe("velocity T-V07 rebased dates are not work starts", () => {
  it("yields no negative coding duration on committer date after PR open", () => {
    tempRoot();
    const result = lotStartFromEvidence({
      prOpenedAt: "2026-10-16T19:22:25Z",
      committerAt: "2026-10-17T16:49:59Z",
      firstCommitAt: "2026-10-18T08:16:34Z",
    });
    expect(result.negativeDuration).toBe(false);
    expect(result.lotStart).toBeNull();
    expect(result.reason).toMatch(/proxy|rebase|unreliable/i);
  });

  it("keeps engram first_commit proxy-only and excluded from forecasts", () => {
    tempRoot();
    const result = lotStartFromEvidence({
      prOpenedAt: "2026-10-18T08:42:22Z",
      committerAt: "2026-10-18T08:16:34Z",
      firstCommitAt: "2026-10-18T08:16:34Z",
    });
    expect(result.firstCommitPolicy).toBe("proxy-only-excluded-from-forecasts");
    expect(result.lotStart).toBeNull();
  });
});

describe("velocity T-V10 incomplete runs and overlapping waits", () => {
  it("keeps an orphan start censored with null finish", () => {
    tempRoot();
    expect(unionIntervals([])).toMatchObject({ totalSeconds: null, reason: "no-evidenced-interval" });
  });

  it("unions overlapping quota/owner intervals once", () => {
    tempRoot();
    const merged = unionIntervals([
      { start: "2026-10-18T10:00:00Z", end: "2026-10-18T10:10:00Z", cause: "quota", source: "receipt" },
      { start: "2026-10-18T10:05:00Z", end: "2026-10-18T10:15:00Z", cause: "owner", source: "receipt" },
    ]);
    expect(merged.totalSeconds).toBe(15 * 60);
    expect(merged.gaps).toEqual([]);
  });

  it("leaves undocumented gaps unclassified, never owner waits", () => {
    tempRoot();
    const merged = unionIntervals([
      { start: "2026-10-18T10:00:00Z", end: "2026-10-18T10:05:00Z", cause: "quota", source: "receipt" },
    ]);
    expect(merged.unclassified).toBe(true);
  });
});

describe("velocity T-V11 keep identity", () => {
  it("never collides equal PR numbers in different repos", () => {
    tempRoot();
    expect(lotSlotKey("rhanka/h2a", 1, "L1")).not.toBe(lotSlotKey("rhanka/engram", 1, "L1"));
  });

  it("never duplicates one PR elapsed time onto two lots", () => {
    tempRoot();
    const first = lotSlotKey("rhanka/h2a", 327, "L1");
    const second = lotSlotKey("rhanka/h2a", 327, "L2");
    expect(first).not.toBe(second);
  });
});
