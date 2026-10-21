import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

import { runProducer } from "../src/velocity/run-producer.js";
import { createRunReceipt } from "../src/velocity/run-receipt.js";

const tempDirs: string[] = [];
afterEach(() => {
  while (tempDirs.length > 0) rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

function tempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "velocity-l2-prod-"));
  tempDirs.push(dir);
  return dir;
}

describe("velocity T-V36 produce prospective receipts", () => {
  it("persists start before dispatch and a single terminal record on success", async () => {
    const sink = tempRoot();
    const events: string[] = [];
    const result = await runProducer(
      {
        repo: "rhanka/h2a",
        lotRef: "lot-1",
        runId: "run-1",
        role: "author",
        candidateRevision: "sha1",
        receiptsDir: sink,
      },
      {
        clock: { now: () => "2026-10-18T10:00:00Z", advance: () => "2026-10-18T10:01:00Z" },
        spawn: async () => ({ status: 0, startedAt: "2026-10-18T10:00:00Z", finishedAt: "2026-10-18T10:01:00Z" }),
        sink: { write: (line: string) => events.push(line) },
      },
    );
    expect(result.startPersistedBeforeDispatch).toBe(true);
    expect(result.terminalCount).toBe(1);
    expect(result.outcome).toBe("success");
  });

  it("keeps interruption without normal end censored", async () => {
    const sink = tempRoot();
    const result = await runProducer(
      {
        repo: "rhanka/h2a",
        lotRef: "lot-1",
        runId: "run-2",
        role: "author",
        candidateRevision: "sha1",
        receiptsDir: sink,
      },
      {
        clock: { now: () => "2026-10-18T10:00:00Z", advance: () => "2026-10-18T10:01:00Z" },
        spawn: async () => ({ status: null, interrupted: true }),
        sink: { write: () => undefined },
      },
    );
    expect(result.outcome).toBe("censored");
    expect(result.finishedAt).toBeNull();
  });

  it("creates a closed receipt only from the launch path, never prewritten", () => {
    tempRoot();
    const receipt = createRunReceipt({
      repo: "rhanka/h2a",
      lotRef: "lot-1",
      runId: "run-3",
      role: "reviewer",
      startedAt: "2026-10-18T10:00:00Z",
      finishedAt: "2026-10-18T10:05:00Z",
      outcome: "success",
      requestedModel: "model-a",
      observedModel: "model-b",
      candidateRevision: "sha1",
    });
    expect(receipt.runId).toBe("run-3");
    expect(receipt.requestedModel).toBe("model-a");
    expect(receipt.observedModel).toBe("model-b");
    expect(() => readFileSync(join("fixtures", "absent-receipt.jsonl"), "utf-8")).toThrow();
  });

  it("joins real producer output from the checkout-only launch path", () => {
    const sink = tempRoot();
    expect(readdirSync(sink)).toEqual([]);
    const child = spawnSync(
      process.execPath,
      [
        new URL("../../../scripts/velocity-run.mjs", import.meta.url).pathname,
        "--repo",
        "rhanka/h2a",
        "--lot",
        "lot-1",
        "--run",
        "run-smoke",
        "--role",
        "author",
        "--candidate",
        "sha1",
        "--receipts",
        sink,
      ],
      { encoding: "utf8" },
    );
    expect(child.status).toBe(0);
    const lines = readFileSync(join(sink, "run-smoke.jsonl"), "utf-8").trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).phase).toBe("started");
    expect(JSON.parse(lines[1]).outcome).toBe("success");
  });
});
