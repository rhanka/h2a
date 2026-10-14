import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import YAML from "yaml";

const repo = new URL("../../../", import.meta.url);
const workflow = name => YAML.parse(readFileSync(new URL(`.github/workflows/${name}`, repo), "utf8"));

test("should qualify Node 22 and 24 in CI and release with no Node 20 job", () => {
  const ci = workflow("ci.yml"), release = workflow("release.yml");
  assert.deepEqual(ci.jobs["build-and-test"].strategy.matrix.node, ["22", "24"]);
  assert.deepEqual(release.jobs.verify.strategy.matrix.node, ["22", "24"]);
  for (const name of ["ci.yml", "release.yml", "native-namespace-qualification.yml", "smoke.yml", "docker.yml", "codex-drift.yml"]) {
    for (const job of Object.values(workflow(name).jobs)) {
      for (const step of job.steps ?? []) assert.notEqual(String(step.with?.["node-version"]), "20");
    }
  }
});

test("should build the native namespace candidate in workspace dependency order", () => {
  const steps = workflow("native-namespace-qualification.yml").jobs["native-namespaces"].steps;
  const build = steps.findIndex(step => step.run === "npm run build");
  const qualify = steps.findIndex(step => String(step.run).includes("scripts/run-namespace-qualification.mjs"));
  assert.ok(build >= 0 && build < qualify, "the normal workspace build must precede native qualification");
  assert.equal(steps[build].if, undefined);
});

