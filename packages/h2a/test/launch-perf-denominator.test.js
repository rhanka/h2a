import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
test("should count pre-probe refusals as exceedances in the launch percentile", () => {
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../.."), prefix = `denominator-${process.pid}-${Date.now()}`;
  const evidence = join(repo, ".qual-tmp/evidence"), results = join(repo, ".qual-tmp/lab/results"), label = `${prefix}-candidate-n1-warm-idle-r1`;
  const fixture = join(results, label), plan = join(evidence, prefix + "-plan.json"), analysis = join(evidence, prefix + "-analysis.json");
  fs.mkdirSync(fixture, { recursive: true }); fs.mkdirSync(evidence, { recursive: true });
  const scenarios = [1, 2].map(sample => ({ label: `${prefix}-candidate-n1-warm-idle-r${sample}`, sourceSha: "synthetic-witness", n: 1 }));
  fs.writeFileSync(plan, JSON.stringify({ input: { scenarios } }));
  fs.writeFileSync(join(fixture, "result.json"), JSON.stringify({ sourceSha: "synthetic-witness", opts: { n: 1 }, results: [{ id: "one", exitCode: 0, receiptMs: 1000, lastProofToResultMs: null }], memory: { peakBytes: 1024, pss: [] }, survivors: [] }));
  fs.writeFileSync(join(fixture, "events.jsonl"), '{"name":"launch_begin","at":0}\n{"name":"launcher_exit","at":1000}\n');
  try {
    execFileSync(process.execPath, [join(repo, "scripts/launch-perf/analyze.mjs"), prefix]);
    const summary = JSON.parse(fs.readFileSync(analysis)).groups[0].summary;
    assert.equal(summary.plannedRequests, 2); assert.equal(summary.successes, 1); assert.equal(summary.underBudget, 1);
    assert.equal(summary.refusedBeforeProbe, 1);
    assert.equal(summary.launchComplete.n, 2); assert.equal(summary.launchComplete.p95, "EXCEEDANCE");
  } finally { fs.rmSync(fixture, { recursive: true, force: true }); fs.rmSync(plan, { force: true }); fs.rmSync(analysis, { force: true }); }
});
