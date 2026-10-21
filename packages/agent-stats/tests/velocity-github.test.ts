import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  assertCollectionComplete,
  dedupePrNumbers,
  joinRunViaHeadSha,
} from "../src/velocity/github.js";

const tempDirs: string[] = [];
afterEach(() => {
  while (tempDirs.length > 0) rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

function tempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "velocity-l1-gh-"));
  tempDirs.push(dir);
  process.env.XDG_RUNTIME_DIR = mkdtempSync(join(tmpdir(), "velocity-xdg-"));
  tempDirs.push(process.env.XDG_RUNTIME_DIR);
  return dir;
}

describe("velocity T-V03 detect incomplete acquisition", () => {
  it("forbids a complete claim on remaining page, API error or count mismatch", () => {
    tempRoot();
    expect(
      assertCollectionComplete({ hasNextPage: true, totalCount: 2, inclusionIds: [1, 2] }),
    ).toHaveLength(1);
    expect(
      assertCollectionComplete({ hasNextPage: false, totalCount: 3, inclusionIds: [1, 2] }),
    ).toHaveLength(1);
    expect(
      assertCollectionComplete({
        hasNextPage: false,
        totalCount: 2,
        inclusionIds: [1, 2],
        apiError: "boom",
      }),
    ).toHaveLength(1);
    expect(
      assertCollectionComplete({ hasNextPage: false, totalCount: 2, inclusionIds: [1, 2] }),
    ).toEqual([]);
  });

  it("never doubles n on duplicate pages", () => {
    tempRoot();
    expect(dedupePrNumbers([1, 2, 1, 3, 2])).toEqual([1, 2, 3]);
  });

  it("joins a run with empty pull_requests via head SHA", () => {
    tempRoot();
    const joined = joinRunViaHeadSha(
      { headSha: "abc123", pullRequests: [] },
      [{ number: 7, headSha: "abc123" }],
    );
    expect(joined).toMatchObject({ number: 7, headSha: "abc123" });
  });

  it("fails instead of skipping when the github fixture is absent", () => {
    tempRoot();
    expect(() => readFileSync(new URL("./fixtures/velocity/absent.json", import.meta.url))).toThrow();
  });
});

describe("velocity T-V05 stay read-only and isolated", () => {
  it("replays fixtures without network and rejects owner-state paths", async () => {
    tempRoot();
    const { loadGithubCohortSeconds } = await import("../src/velocity/observations.js");
    const raw = JSON.parse(
      readFileSync(new URL("./fixtures/velocity/github-sample.json", import.meta.url), "utf-8"),
    );
    const values = loadGithubCohortSeconds(raw, "sol-created-desc/1");
    expect(values).toHaveLength(20);
    expect(process.env.HOME).not.toContain(".config/sentropic");
  });
});
