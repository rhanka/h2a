import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  groupCiByHead,
  quarantineReusedAttempts,
} from "../src/velocity/ci.js";

const tempDirs: string[] = [];
afterEach(() => {
  while (tempDirs.length > 0) rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

function tempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "velocity-l2-ci-"));
  tempDirs.push(dir);
  return dir;
}

describe("velocity T-V09 count cycles across heads", () => {
  it("preserves 5 ci runs on 5 heads including 3 failures, all attempt 1", () => {
    tempRoot();
    const runs = [
      { headSha: "h1", attempt: 1, conclusion: "success" },
      { headSha: "h2", attempt: 1, conclusion: "failure" },
      { headSha: "h3", attempt: 1, conclusion: "failure" },
      { headSha: "h4", attempt: 1, conclusion: "failure" },
      { headSha: "h5", attempt: 1, conclusion: "success" },
    ];
    const grouped = groupCiByHead(runs);
    expect(grouped).toHaveLength(5);
    expect(grouped.filter((entry) => entry.conclusion !== "success")).toHaveLength(3);
  });

  it("quarantines a reused attempt-2 while keeping open-to-merge valid", () => {
    tempRoot();
    const result = quarantineReusedAttempts([
      { headSha: "h1", attempt: 1, startedAt: "2026-10-18T10:00:00Z", reusable: false },
      { headSha: "h1", attempt: 2, startedAt: "2026-10-18T09:00:00Z", reusable: true },
    ]);
    expect(result.kept).toHaveLength(1);
    expect(result.quarantined).toHaveLength(1);
    expect(result.quarantined[0].reason).toMatch(/reused/i);
    expect(result.openToMergeValid).toBe(true);
  });
});
