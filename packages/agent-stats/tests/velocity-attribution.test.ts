import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { attributeRole } from "../src/velocity/lifecycle.js";
import { summarizeWaves } from "../src/velocity/review-rounds.js";

const tempDirs: string[] = [];
afterEach(() => {
  while (tempDirs.length > 0) rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

function tempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "velocity-l2-attr-"));
  tempDirs.push(dir);
  return dir;
}

describe("velocity T-V08 attribute only proven roles", () => {
  it("keeps an evidenced external review on zero GitHub reviews", () => {
    tempRoot();
    const role = attributeRole({
      githubReviews: [],
      externalReview: { reviewer: "wave-R1", evidenceRef: "receipt-1" },
      authorLogin: "rhanka",
    });
    expect(role.reviewKept).toBe(true);
    expect(role.model).toBe("unattributed");
  });

  it("never turns shared author rhanka into a model identity", () => {
    tempRoot();
    const role = attributeRole({ githubReviews: [], authorLogin: "rhanka" });
    expect(role.model).toBe("unattributed");
    expect(role.agent).toBe("unattributed");
  });

  it("counts one round for two parallel reviewers and two rounds after resubmission", () => {
    tempRoot();
    const summary = summarizeWaves({
      repo: "rhanka/h2a",
      lotOccurrence: "L1",
      waves: [
        {
          roundId: "R1",
          candidateRevision: "sha1",
          reviewerRuns: [{ runId: "a" }, { runId: "b" }],
          closed: true,
          coverageManifestRef: "manifest-1",
        },
        {
          roundId: "R2",
          candidateRevision: "sha2",
          reviewerRuns: [{ runId: "c" }],
          closed: true,
          coverageManifestRef: "manifest-1",
        },
      ],
      coverageManifestRef: "manifest-1",
    });
    expect(summary.completedCount).toBe(2);
    expect(summary.reviewerRunCount).toBe(3);
  });

  it("returns null counts without coverage proof, never zero", () => {
    tempRoot();
    const summary = summarizeWaves({
      repo: "rhanka/h2a",
      lotOccurrence: "L1",
      waves: [],
      coverageManifestRef: null,
    });
    expect(summary.completedCount).toBeNull();
    expect(summary.missingReason).toBeTruthy();
  });
});

describe("velocity T-V12 no relabelling of unsupported hosts", () => {
  it("keeps Muse/Vibe evidence unattributed without a parser or receipt", () => {
    tempRoot();
    const role = attributeRole({ githubReviews: [], host: "muse", authorLogin: "rhanka" });
    expect(role.agent).toBe("unattributed");
    const vibe = attributeRole({ githubReviews: [], host: "vibe", authorLogin: "rhanka" });
    expect(vibe.agent).toBe("unattributed");
  });
});
