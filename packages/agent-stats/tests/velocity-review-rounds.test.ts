import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  joinWaveManifest,
  refuseIncompleteClosure,
} from "../src/velocity/review-rounds.js";

const tempDirs: string[] = [];
afterEach(() => {
  while (tempDirs.length > 0) rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

function tempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "velocity-l2-waves-"));
  tempDirs.push(dir);
  return dir;
}

describe("velocity review waves lifecycle", () => {
  it("joins a wave manifest with run receipts and refuses closure without reconciliation", () => {
    tempRoot();
    const manifest = {
      repo: "rhanka/h2a",
      lotOccurrence: "L1",
      roundId: "R1",
      candidateRevision: "sha1",
      reviewerRuns: [{ runId: "a" }, { runId: "b" }],
    };
    const joined = joinWaveManifest(manifest, [{ runId: "a" }, { runId: "b" }]);
    expect(joined.roundId).toBe("R1");
    expect(joined.reviewerRunCount).toBe(2);
    expect(() =>
      refuseIncompleteClosure({ roundId: "R1", reconciliationRef: null, resultRefs: [] }),
    ).toThrow(/reconciliation/);
  });

  it("keeps duplicate receipts from increasing round totals", () => {
    tempRoot();
    const manifest = {
      repo: "rhanka/h2a",
      lotOccurrence: "L1",
      roundId: "R1",
      candidateRevision: "sha1",
      reviewerRuns: [{ runId: "a" }],
    };
    const joined = joinWaveManifest(manifest, [{ runId: "a" }, { runId: "a" }]);
    expect(joined.reviewerRunCount).toBe(1);
  });
});
