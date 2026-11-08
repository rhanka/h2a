/**
 * Release-side Node qualification wiring (v0.98.9-rc.3 verify incident).
 *
 * The v0.98.9-rc.3 verify run (42431777636) proved the single-job release
 * `npm test` cannot re-execute the post-#354 suite: the M17 campaign
 * (mh-l5-concurrency) grazes its own 1350s producer backstop while the
 * aggregate `tests` budget is 21 minutes, and it started ~12 minutes into
 * that budget on both legs. ci.yml's answer (edd77a39c) was to run M17, the
 * bulk lane and duration-balanced node shards as PRODUCERS and import their
 * same-run sealed proofs behind the aggregate npm test. A release that does
 * not import those proofs gates a suite subset that already proved
 * unfinishable — so release.yml must invoke the same producer graph at the
 * gated release SHA and verify must consume the exact same-run evidence.
 *
 * This is a parse+assert test: it pins the reusable node-qualification.yml
 * graph, the release.yml job that calls it, and the verify imports.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

import { m17Context } from "../../../scripts/m17-ci-evidence.mjs";
import { SHARD_COUNT } from "../../../scripts/ci-node-shards.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..", "..");
const readWorkflow = (name) =>
  YAML.parse(readFileSync(resolve(REPO_ROOT, ".github", "workflows", name), "utf8"));

test("release.yml calls the Node qualification graph at the resolved release SHA before verify", () => {
  const release = readWorkflow("release.yml");
  const entry = release.jobs["node-qualification"];
  assert.ok(entry, "release.yml must carry a node-qualification job");
  assert.equal(entry.uses, "./.github/workflows/node-qualification.yml");
  assert.equal(entry.needs, "resolve-release-sha");
  assert.equal(entry.if, undefined, "a skipped qualification must never have satisfied verify");
  assert.equal(entry.with["release-sha"], "${{ needs.resolve-release-sha.outputs.release-sha }}",
    "the producers must gate the ONE resolved SHA, never a mutable tag or GITHUB_SHA");
  assert.deepEqual(release.jobs.verify.needs, ["resolve-release-sha", "native-recovery", "node-qualification"],
    "verify must consume the qualification verdict: a failed or cancelled producer blocks the release");
  assert.equal(entry.steps, undefined, "the release entry must delegate, never inline producer steps");
});

test("verify imports the same-run M17, bulk and shard evidence behind npm test", () => {
  const release = readWorkflow("release.yml");
  const verify = release.jobs.verify;
  const steps = verify.steps;
  const trust = steps.findIndex((step) => step.run === "node --test packages/h2a/test/run-test-gates.test.js");
  const npmTest = steps.findIndex((step) => step.run === "npm test");
  assert.ok(trust !== -1 && npmTest !== -1 && trust < npmTest);
  const downloads = steps.filter((step) => String(step.uses ?? "") === "actions/download-artifact@v4");
  const runId = "${{ github.run_id }}";
  const node = "${{ matrix.node }}";
  const wanted = [
    `m17-${runId}-node${node}`,
    `bulk-${runId}-node${node}`,
    ...Array.from({ length: SHARD_COUNT }, (_, index) => `node-shard-${runId}-node${node}-shard${index}`),
  ];
  assert.deepEqual(downloads.map((step) => step.with.name), wanted,
    "verify must download this leg's M17 and bulk proofs plus every shard envelope — a missing artifact fails the download, and a renamed one never reaches npm test");
  for (const step of downloads) {
    assert.equal(step.if, undefined, "a conditional import can silently skip evidence");
  }
  for (const step of downloads) assert.ok(steps.indexOf(step) > trust && steps.indexOf(step) < npmTest,
    "the evidence must be in place before npm test runs");
  const paths = new Map(downloads.map((step) => {
    const artifact = step.with.name.startsWith("m17-") ? "m17" : step.with.name.startsWith("bulk-") ? "bulk" : "node-shards";
    return [artifact, step.with.path];
  }));
  assert.deepEqual(paths, new Map([["m17", "tmp/m17-import"], ["bulk", "tmp/bulk-import"], ["node-shards", "tmp/node-shards"]]));
  assert.deepEqual(verify.steps.find((step) => step.run === "npm test").env, {
    H2A_TEST_CI_M17_REPORT: "${{ github.workspace }}/tmp/m17-import/proof.json",
    H2A_TEST_CI_BULK_REPORT: "${{ github.workspace }}/tmp/bulk-import/proof.json",
    H2A_TEST_NODE_SHARD_DIR: "${{ github.workspace }}/tmp/node-shards",
    H2A_TEST_EXPECTED_SHA: "${{ needs.resolve-release-sha.outputs.release-sha }}",
  }, "npm test must consume the imported proofs and pin the gated SHA (GITHUB_SHA is the default-branch head on a backfill dispatch)");
});

test("the qualification mutation holes stay red: dropped producers, renamed evidence, unpinned SHA", () => {
  const release = readFileSync(resolve(REPO_ROOT, ".github", "workflows", "release.yml"), "utf8");
  for (const [before, after] of [
    ["needs: [resolve-release-sha, native-recovery, node-qualification]",
      "needs: [resolve-release-sha, native-recovery]"],
    ["name: m17-${{ github.run_id }}-node${{ matrix.node }}\n          path: tmp/m17-import",
      "name: m17-last-success\n          path: tmp/m17-import"],
    ["name: node-shard-${{ github.run_id }}-node${{ matrix.node }}-shard3", "name: node-shard-${{ github.run_id }}-node${{ matrix.node }}-shard0"],
    ["H2A_TEST_NODE_SHARD_DIR: ${{ github.workspace }}/tmp/node-shards", "H2A_OPTIONAL_SHARD_DIR: ${{ github.workspace }}/tmp/node-shards"],
    ["H2A_TEST_EXPECTED_SHA: ${{ needs.resolve-release-sha.outputs.release-sha }}", "H2A_TEST_EXPECTED_SHA: ${{ github.sha }}"],
  ]) {
    assert.ok(release.includes(before), `mutation baseline missing: ${before}`);
    assert.throws(() => assertWiring(release.replaceAll(before, after)), before);
  }
});

function assertWiring(source) {
  const release = YAML.parse(source);
  const entry = release.jobs["node-qualification"];
  assert.ok(entry && entry.uses === "./.github/workflows/node-qualification.yml");
  assert.deepEqual(release.jobs.verify.needs, ["resolve-release-sha", "native-recovery", "node-qualification"]);
  const runId = "${{ github.run_id }}";
  const node = "${{ matrix.node }}";
  const names = release.jobs.verify.steps
    .filter((step) => step.uses === "actions/download-artifact@v4")
    .map((step) => step.with.name);
  assert.deepEqual(names, [
    `m17-${runId}-node${node}`,
    `bulk-${runId}-node${node}`,
    ...Array.from({ length: SHARD_COUNT }, (_, index) => `node-shard-${runId}-node${node}-shard${index}`),
  ]);
  const npmTest = release.jobs.verify.steps.find((step) => step.run === "npm test");
  assert.deepEqual(npmTest.env, {
    H2A_TEST_CI_M17_REPORT: "${{ github.workspace }}/tmp/m17-import/proof.json",
    H2A_TEST_CI_BULK_REPORT: "${{ github.workspace }}/tmp/bulk-import/proof.json",
    H2A_TEST_NODE_SHARD_DIR: "${{ github.workspace }}/tmp/node-shards",
    H2A_TEST_EXPECTED_SHA: "${{ needs.resolve-release-sha.outputs.release-sha }}",
  });
}

test("node-qualification.yml reuses the ci producer graph at the gated release SHA", () => {
  const wf = readWorkflow("node-qualification.yml");
  assert.equal(wf.on.workflow_call.inputs["release-sha"].required, true,
    "the reusable workflow must REQUIRE the resolved release SHA");
  assert.equal(wf.on.workflow_dispatch, undefined, "dispatching the producers without a gated SHA gates nothing");
  const sha = "${{ inputs.release-sha }}";
  for (const [id, timeout, extra] of [
    ["m17-qualification", 25, "m17"],
    ["bulk-qualification", 25, "bulk"],
    ["node-shard", 20, "shard"],
  ]) {
    const job = wf.jobs[id];
    assert.ok(job, `node-qualification.yml must carry the ${id} producer`);
    assert.equal(job["runs-on"], "ubuntu-24.04");
    assert.equal(job["timeout-minutes"], timeout);
    assert.deepEqual(job.strategy.matrix.node, ["22", "24"]);
    assert.equal(job.env.H2A_TEST_EXPECTED_SHA, sha,
      `${id} must bind every sealed proof to the gated release SHA`);
    const checkout = job.steps.find((step) => step.uses === "actions/checkout@v4");
    assert.equal(checkout.with.ref, sha, `${id} must check out the gated release SHA`);
    assert.equal(checkout.with["fetch-depth"], 0, `${id} needs the full tree the ci producers use`);
    const setups = job.steps.filter((step) => String(step.uses ?? "").startsWith("actions/setup-node"));
    assert.equal(setups.length, 1, `${id} must carry exactly one setup-node`);
    assert.equal(setups[0].with["node-version"], "${{ matrix.node }}",
      `${id} floats the matrix link like verify; a hard pin drifts from the importing leg (owner decision pending)`);
  }
  const m17 = wf.jobs["m17-qualification"];
  assert.equal(m17.needs, undefined, "the M17 producer has no upstream dependency beyond the SHA");
  assert.ok(m17.steps.some((step) => step.run === "node scripts/ci-m17-proof.mjs run"));
  assert.ok(m17.steps.some((step) => step.run === "node scripts/ci-m17-proof.mjs finalize"));
  assert.equal(m17.steps.find((step) => step.name === "Remove the private M17 data volume").if,
    "${{ always() && env.H2A_TEST_M17_TMPDIR != '' }}",
    "the M17 volume cleanup must stay unconditional-always; a success()-gated cleanup leaks the volume on red runs");
  const bulk = wf.jobs["bulk-qualification"];
  assert.equal(bulk.needs, undefined);
  assert.ok(bulk.steps.some((step) => step.run === "node scripts/ci-bulk-proof.mjs"));
  assert.equal(bulk.steps.find((step) => String(step.run ?? "").includes("node scripts/ci-bulk-proof.mjs")).env.H2A_TEST_CI_BULK_OUTPUT,
    "${{ github.workspace }}/tmp/bulk-export");
  const shard = wf.jobs["node-shard"];
  assert.deepEqual(shard.needs, ["m17-qualification", "bulk-qualification"]);
  assert.equal(shard.if, "${{ always() }}",
    "the shard legs must run and FAIL when a producer fails, never skip green");
  assert.deepEqual(shard.strategy.matrix.shard, [0, 1, 2, 3]);
  assert.equal(shard.steps.find((step) => step.name === "Require both complete M17 qualifications").run,
    'test "$M17_RESULT" = success');
  assert.equal(shard.steps.find((step) => step.name === "Require both complete bulk qualifications").run,
    'test "$BULK_RESULT" = success');
  assert.ok(shard.steps.some((step) => String(step.run).includes("scripts/run-node-shard.mjs")),
    "the shards execute the dedicated shard runner, never the full gate entrypoint");
  assert.ok(!shard.steps.some((step) => String(step.run ?? "").includes("run-test-gates.mjs")),
    "a shard running the full gate would duplicate every suite");
  const runId = "${{ github.run_id }}";
  const node = "${{ matrix.node }}";
  for (const prefix of ["m17", "bulk"]) {
    assert.ok(shard.steps.some((step) => step.uses === "actions/download-artifact@v4" &&
      step.with.name === `${prefix}-${runId}-node${node}`),
      `each shard leg must reverify the ${prefix} producer succeeded on its own node leg`);
  }
  const uploads = new Map([
    ["m17-qualification", `m17-${runId}-node${node}`],
    ["bulk-qualification", `bulk-${runId}-node${node}`],
    ["node-shard", `node-shard-${runId}-node${node}-shard${"${{ matrix.shard }}"}`],
  ]);
  for (const [id, name] of uploads) {
    const upload = wf.jobs[id].steps.find((step) => step.uses === "actions/upload-artifact@v4");
    assert.ok(upload, `${id} must upload its sealed evidence`);
    assert.equal(upload.with.name, name, "artifact names must match what verify downloads, this run and leg");
    assert.equal(upload.with["if-no-files-found"], "error", "a missing proof must fail the producer, not the consumer");
  }
});

test("the reusable producer mutations stay red: unpinned SHA, skipped legs, renamed artifacts", () => {
  const source = readFileSync(resolve(REPO_ROOT, ".github", "workflows", "node-qualification.yml"), "utf8");
  for (const [before, after] of [
    ["H2A_TEST_EXPECTED_SHA: ${{ inputs.release-sha }}", "H2A_TEST_EXPECTED_SHA: ${{ github.sha }}"],
    ["ref: ${{ inputs.release-sha }}", "ref: main"],
    ["shard: [0, 1, 2, 3]", "shard: [0, 1, 2]"],
    ["run: node scripts/run-node-shard.mjs --shard=${{ matrix.shard }}", "run: node scripts/run-test-gates.mjs"],
    ['run: test "$M17_RESULT" = success', "run: true"],
    ['run: test "$BULK_RESULT" = success', "run: true"],
    ["name: node-shard-${{ github.run_id }}-node${{ matrix.node }}-shard${{ matrix.shard }}", "name: node-shard-shared"],
    ["if-no-files-found: error", "if-no-files-found: warn"],
  ]) {
    assert.ok(source.includes(before), `mutation baseline missing: ${before}`);
    assert.throws(() => assertProducerGraph(source.replaceAll(before, after)), before);
  }
});

function assertProducerGraph(source) {
  const wf = YAML.parse(source);
  const producers = ["m17-qualification", "bulk-qualification", "node-shard"];
  for (const id of producers) {
    const job = wf.jobs[id];
    assert.ok(job, `missing producer: ${id}`);
    assert.equal(job.env.H2A_TEST_EXPECTED_SHA, "${{ inputs.release-sha }}");
    assert.equal(job.steps.find((step) => step.uses === "actions/checkout@v4").with.ref, "${{ inputs.release-sha }}");
    const upload = job.steps.find((step) => step.uses === "actions/upload-artifact@v4");
    assert.equal(upload.with["if-no-files-found"], "error");
  }
  const shard = wf.jobs["node-shard"];
  assert.deepEqual(shard.strategy.matrix.shard, [0, 1, 2, 3]);
  assert.ok(shard.steps.some((step) => String(step.run ?? "").includes("scripts/run-node-shard.mjs")));
  assert.ok(!shard.steps.some((step) => String(step.run ?? "").includes("run-test-gates.mjs")));
  assert.equal(shard.steps.find((step) => step.name === "Require both complete M17 qualifications").run, 'test "$M17_RESULT" = success');
  assert.equal(shard.steps.find((step) => step.name === "Require both complete bulk qualifications").run, 'test "$BULK_RESULT" = success');
  const runId = "${{ github.run_id }}";
  const node = "${{ matrix.node }}";
  assert.equal(wf.jobs["m17-qualification"].steps.find((step) => step.uses === "actions/upload-artifact@v4").with.name,
    `m17-${runId}-node${node}`);
  assert.equal(wf.jobs["bulk-qualification"].steps.find((step) => step.uses === "actions/upload-artifact@v4").with.name,
    `bulk-${runId}-node${node}`);
  assert.equal(shard.steps.find((step) => step.uses === "actions/upload-artifact@v4").with.name,
    `node-shard-${runId}-node${node}-shard${"${{ matrix.shard }}"}`);
}

test("m17Context accepts the release workflow behind the pinned SHA and rejects drift or foreign workflows", () => {
  const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPO_ROOT, encoding: "utf8" }).trim();
  const base = { GITHUB_ACTIONS: "true", GITHUB_REPOSITORY: "rhanka/h2a",
    GITHUB_RUN_ID: "424242", GITHUB_RUN_ATTEMPT: "1" };
  // Backfill dispatch shape: GITHUB_SHA is the default-branch head and does
  // NOT match the gated checkout, so the release must pass the resolved SHA.
  const context = m17Context(REPO_ROOT, { ...base, GITHUB_WORKFLOW: "release",
    GITHUB_SHA: "f".repeat(40), H2A_TEST_EXPECTED_SHA: head });
  assert.equal(context.workflow, "release");
  assert.equal(context.sha, head, "the sealed context must bind HEAD — the gated tree that runs the tests");
  assert.throws(() => m17Context(REPO_ROOT, { ...base, GITHUB_WORKFLOW: "release", GITHUB_SHA: "f".repeat(40) }),
    "without the override a backfill dispatch binds the wrong SHA and must fail closed");
  assert.throws(() => m17Context(REPO_ROOT, { ...base, GITHUB_WORKFLOW: "smoke", H2A_TEST_EXPECTED_SHA: head }),
    "a workflow outside {ci, release} is a foreign proof context");
  assert.throws(() => m17Context(REPO_ROOT, { ...base, GITHUB_WORKFLOW: "release",
    GITHUB_SHA: head, H2A_TEST_EXPECTED_SHA: "f".repeat(40) }),
    "an override that disagrees with the checkout must fail closed");
  // ci keeps its default contract: PR merge checkout, no override needed.
  assert.equal(m17Context(REPO_ROOT, { ...base, GITHUB_WORKFLOW: "ci", GITHUB_SHA: head }).sha, head);
});
